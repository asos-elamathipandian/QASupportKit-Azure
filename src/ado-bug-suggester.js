"use strict";

// ── ADO Bug Field Suggester ──────────────────────────────────────────────────
// Suggests priority, severity, and repro steps content from bug title/description.
// Priority/severity use keyword heuristics (no external deps).
// Repro steps use Azure OpenAI if configured, otherwise fall back to a template.

const fetch = require("node-fetch");

// Checked in order — first match wins
const PRIORITY_RULES = [
  {
    keywords: [
      "blocked", "cannot", "crash", "down", "data loss", "500", "unresponsive",
      "stuck", "no response", "critical", "showstopper", "production", "p1",
      "not processing", "not sending", "not receiving", "failed to send",
    ],
    priority: "1",
    severity: "1 - Critical",
  },
  {
    keywords: [
      "fail", "error", "incorrect", "broken", "wrong result", "mismatch",
      "not working", "rejected", "invalid", "missing field", "not found", "p2",
      "unexpected", "not matching", "discrepancy", "failure",
    ],
    priority: "2",
    severity: "2 - High",
  },
  {
    keywords: [
      "slow", "delayed", "intermittent", "flaky", "inconsistent",
      "occasional", "sometimes", "p3", "performance",
    ],
    priority: "3",
    severity: "3 - Medium",
  },
];

/**
 * Returns suggested { priority, severity } based on title + description keywords.
 * Defaults to priority 3 / severity "3 - Medium" if no rule matches.
 */
function suggestPriorityAndSeverity(title, description) {
  const combined = `${title || ""} ${description || ""}`.toLowerCase();
  for (const rule of PRIORITY_RULES) {
    if (rule.keywords.some((k) => combined.includes(k))) {
      return { priority: rule.priority, severity: rule.severity };
    }
  }
  return { priority: "3", severity: "3 - Medium" };
}

/**
 * Returns suggested HTML repro steps string.
 * Uses Azure OpenAI if AZURE_OPENAI_ENDPOINT + AZURE_OPENAI_KEY are set;
 * otherwise returns a structured template.
 */
async function suggestReproSteps(title, description) {
  const endpoint = process.env.AZURE_OPENAI_ENDPOINT;
  const apiKey = process.env.AZURE_OPENAI_KEY;
  const deployment = process.env.AZURE_OPENAI_DEPLOYMENT || "gpt-4o";

  if (!endpoint || !apiKey) {
    return buildReproTemplate(title, description);
  }

  const baseUrl = endpoint.replace(/\/+$/, "");
  const url = `${baseUrl}/openai/deployments/${deployment}/chat/completions?api-version=2024-02-01`;

  const prompt =
    `You are a QA engineer writing an Azure DevOps bug work item.\n` +
    `Given the bug title and notes below, generate HTML content for the "Repro Steps" field.\n` +
    `Structure it with five clearly labelled sections:\n` +
    `1. <b>Description:</b> — one paragraph context summary\n` +
    `2. <b>Steps to Reproduce:</b> — numbered <ol> list (use the user's steps if provided)\n` +
    `3. <b>Actual Result:</b> — what actually happened (the bug)\n` +
    `4. <b>Expected Result:</b> — what should have happened\n` +
    `5. <b>Test Data:</b> — relevant IDs or "N/A"\n\n` +
    `Bug Title: ${title}\n` +
    `Notes: ${description || "(none provided)"}\n\n` +
    `Return only the HTML. No markdown, no code fences, no extra explanation.`;

  try {
    const res = await fetch(url, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "api-key": apiKey,
      },
      body: JSON.stringify({
        messages: [{ role: "user", content: prompt }],
        max_tokens: 700,
        temperature: 0.3,
      }),
    });

    if (!res.ok) {
      console.warn("[ado-bug-suggester] OpenAI request failed:", res.status);
      return buildReproTemplate(title, description);
    }

    const data = await res.json();
    const content = data?.choices?.[0]?.message?.content;
    if (!content) return buildReproTemplate(title, description);
    return content.trim();
  } catch (err) {
    console.warn("[ado-bug-suggester] OpenAI error, using template:", err.message);
    return buildReproTemplate(title, description);
  }
}

function escHtml(str) {
  return (str || '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function buildReproTemplate(title, description) {
  // Strip optional label prefix that users sometimes prepend
  let rawText = (description || title || "").trim();
  rawText = rawText.replace(/^(?:description|notes?|steps?|title)\s*[:\-\u2013]\s*/i, "").trim();
  const text = rawText;
  const lower = text.toLowerCase();

  // ── Extract identifiers from user's notes ─────────────────────────────────
  const identifiers = [];
  const asnMatch  = text.match(/\bASN\s*[-:\u2013]?\s*(\d{10,})/i);
  const poMatch   = text.match(/\bPO\s*[-:\u2013]?\s*(\d{5,})/i);
  const suppMatch = text.match(/supplier\s*[-:\u2013]?\s*(\d{5,})/i);
  if (asnMatch)  identifiers.push(`ASN: ${asnMatch[1]}`);
  if (poMatch)   identifiers.push(`PO: ${poMatch[1]}`);
  if (suppMatch) identifiers.push(`Supplier: ${suppMatch[1]}`);  // Also capture bare "Test data: X" or "Test ASN: X" values
  if (identifiers.length === 0) {
    const tdLine = text.match(/test\s*(?:asn|case|data)?\s*[-:\u2013]\s*([^\n]+)/i);
    if (tdLine) identifiers.push(tdLine[1].trim());
  }  const testData = identifiers.length
    ? identifiers.join(", ")
    : "Use relevant test data from the current sprint";

  // ── Extract actual/expected result — works anywhere in text (mid-sentence) ─
  const actualRx   = /actual\s*(?:result)?\s*[-:\u2013]\s*([\s\S]+?)(?=\s*expected\s*(?:result)?\s*[-:\u2013]|\s*test\s*(?:asn|data)\s*[-:\u2013]|\s*$)/i;
  const expectedRx = /expected\s*(?:result)?\s*[-:\u2013]\s*([\s\S]+?)(?=\s*actual\s*(?:result)?\s*[-:\u2013]|\s*test\s*(?:asn|data)\s*[-:\u2013]|\s*$)/i;
  const actualLineMatch   = text.match(actualRx);
  const expectedLineMatch = text.match(expectedRx);
  const userActualInline = actualLineMatch   ? actualLineMatch[1].trim().replace(/[.!?]$/, "")   : null;
  const userExpected     = expectedLineMatch ? expectedLineMatch[1].trim().replace(/[.!?]$/, "") : null;

  // ── Build clean text for step parsing (strip actual/expected/test-data) ───
  const stepText = text
    .replace(new RegExp(actualRx.source,   "gi"), "")
    .replace(new RegExp(expectedRx.source, "gi"), "")
    .replace(/test\s*(?:asn|data)\s*[-:\u2013]\s*[\s\S]*/gi, "")
    .trim();

  // ── Extract user-written numbered steps: newline-based first, then inline ──
  const stepLineRegex = /^(?:step\s*)?(\d+)[.:\-\)]\s*(.+)/;
  const byLine = stepText.split(/\r?\n/).map((l) => l.trim()).filter((l) => stepLineRegex.test(l));
  let userStepLines = [];
  if (byLine.length >= 1) {
    // Numbered lines (1. 2. 3.) — strip the number prefix
    userStepLines = byLine.map((l) => l.replace(/^(?:step\s*)?\d+[.:\-\)]\s*/i, "").trim());
  } else {
    // Inline numbered: "1. Login. 2. Navigate. 3. Click."
    const inlineParts = stepText.split(/\s+(?=\d+\.\s)/);
    const inlineSteps = inlineParts
      .map((s) => s.trim())
      .filter((s) => /^\d+\.\s/.test(s))
      .map((s) => s.replace(/^\d+\.\s+/, "").replace(/[.!?]$/, "").trim())
      .filter((s) => s.length > 0);
    if (inlineSteps.length >= 2) {
      userStepLines = inlineSteps;
    } else {
      // Plain unnumbered lines — take them as-is so user's steps are always respected
      const plainLines = stepText.split(/\r?\n/).map((l) => l.trim()).filter((l) => l.length > 3);
      if (plainLines.length >= 1) userStepLines = plainLines;
    }
  }

  // ── Build steps from user input (steps are mandatory) ───────────────────
  const steps = userStepLines;

  const stepsHtml = steps.map((s) => `<li>${escHtml(s)}</li>`).join("");

  // ── Derive expected result — only use what the user provided, never hallucinate ──
  const expected = userExpected || "";

  // ── Build description: actual result + "in [tool]" extracted from step 1 ───
  // Only use text-before-steps if the split actually found a "1." boundary (intro text)
  const stepParts = stepText.split(/(?:^|\n)\s*1\.\s*/);
  const beforeFirstStep = stepParts.length > 1 ? stepParts[0].trim() : "";
  let descriptionText;
  if (beforeFirstStep && beforeFirstStep.length > 3) {
    descriptionText = beforeFirstStep;
  } else if (userActualInline) {
    // Detect product/tool — scan all steps, not just step 1
    let product = "";
    for (const s of userStepLines) {
      if (/scc/i.test(s))        { product = "E2open SCC"; break; }
      if (/e2open/i.test(s))     { product = "E2open";     break; }
      if (/wms/i.test(s))        { product = "WMS";        break; }
      if (/ris/i.test(s))        { product = "RIS";        break; }
      // Generic: extract tool name from "Login to X" / "Open X" / "Navigate to X"
      const m = s.match(/login\s+to\s+(.+)/i)
             || s.match(/(?:open|launch)\s+(.+)/i)
             || s.match(/navigate\s+to\s+(?:the\s+)?(.+?)(?:\s+screen|\s+page|\s+tab|\s+section|,|$)/i);
      if (m) {
        product = m[1].trim().replace(/[.!?,]$/, "")
          .replace(/\b(\w)/g, (_, c) => c.toUpperCase());
        break;
      }
    }

    const base = userActualInline.replace(/[.!?]$/, "");
    // Clean the base for use as a description sentence — strip XML tags, attributes,
    // reference codes and numeric IDs so only plain wording remains.
    const cleanBase = base
      .replace(/\w+\s*=\s*"[^"]*"/g, '')       // strip XML attributes  e.g. Qualifier="QUR"
      .replace(/<[^>]*>/g, ' ')                 // strip XML/HTML tags
      .replace(/\b[A-Za-z]{1,5}\d{4,}\b/g, '') // strip ref codes like P0020232071675770574
      .replace(/\b\d+\b/g, '')                  // strip all remaining standalone numbers
      .replace(/\s{2,}/g, ' ')
      .trim();
    // Only append the tool name if it is a specific sub-system (SCC, WMS, RIS etc.).
    // Generic "E2open" on its own is too broad and clutters the description.
    const isSpecificTool = product && product !== "E2open";
    const alreadyMentioned = isSpecificTool && new RegExp(product.split(" ")[0], "i").test(cleanBase);
    descriptionText = (isSpecificTool && !alreadyMentioned)
      ? `${cleanBase.charAt(0).toUpperCase() + cleanBase.slice(1)} in ${product}.`
      : `${cleanBase.charAt(0).toUpperCase() + cleanBase.slice(1)}.`;
  } else {
    descriptionText = text.split(/[.!?\n]/)[0].trim() || text;
  }

  const userActual = userActualInline;

  // ── Derive actual result ──────────────────────────────────────────────────
  let actual = userActual || "";
  if (!actual) {
    if (lower.includes("500") || lower.includes("exception")) {
      actual = "A 500 / Internal Server Error is returned and the message fails to process";
    } else if (lower.includes("rejected")) {
      actual = "The message is rejected by the system with an error";
    } else if (lower.includes("not appear") || lower.includes("not showing") || lower.includes("not visible")) {
      actual = "The expected data / lines are not visible in the downstream system";
    } else if (lower.includes("not process") || lower.includes("not being process")) {
      actual = "The message is not being processed — status shows ERROR or remains pending";
    } else if (lower.includes("fail") || lower.includes("error")) {
      actual = "The operation fails with an error in the E2open message log";
    } else if (lower.includes("missing")) {
      actual = "The expected data is missing from the downstream system";
    } else {
      actual = descriptionText;
    }
  }

  const fmtBlock = (str) => {
    const cleaned = (str || '').trim().replace(/(\r?\n){2,}/g, '\n');
    return escHtml(cleaned).replace(/\r?\n/g, '<br/>');
  };

  return (
    `<b>Description:</b><br/>${escHtml(descriptionText)}<br/><br/>` +
    `<b>Steps to Reproduce:</b><br/><ol>${stepsHtml}</ol>` +
    `<b>Actual Result:</b><br/>${fmtBlock(actual)}<br/><br/>` +
    (expected ? `<b>Expected Result:</b><br/>${fmtBlock(expected)}<br/><br/>` : "") +
    `<b>Test Data:</b><br/>${escHtml(testData)}`
  );
}

/**
 * Generates a concise bug title from a description.
 * Uses Azure OpenAI if configured; falls back to extracting the first sentence.
 */
async function suggestTitle(description) {
  const endpoint = process.env.AZURE_OPENAI_ENDPOINT;
  const apiKey = process.env.AZURE_OPENAI_KEY;
  const deployment = process.env.AZURE_OPENAI_DEPLOYMENT || "gpt-4o";

  if (!endpoint || !apiKey) {
    return buildTitleFallback(description);
  }

  const baseUrl = endpoint.replace(/\/+$/, "");
  const url = `${baseUrl}/openai/deployments/${deployment}/chat/completions?api-version=2024-02-01`;

  const prompt =
    `You are a QA engineer writing an Azure DevOps bug title.\n` +
    `Generate a concise, clear bug title (maximum 12 words) from the description below.\n` +
    `Do not use quotes or punctuation at the end. Return only the title text.\n\n` +
    `Description: ${description}`;

  try {
    const res = await fetch(url, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "api-key": apiKey,
      },
      body: JSON.stringify({
        messages: [{ role: "user", content: prompt }],
        max_tokens: 60,
        temperature: 0.3,
      }),
    });

    if (!res.ok) return buildTitleFallback(description);

    const data = await res.json();
    const content = data?.choices?.[0]?.message?.content;
    if (!content) return buildTitleFallback(description);
    return content.trim().replace(/^["']|["']$/g, "");
  } catch {
    return buildTitleFallback(description);
  }
}

/**
 * Fallback: extract and clean the first sentence of the description,
 * capped at 100 characters.
 */
function buildTitleFallback(description) {
  let text = (description || "").trim();
  text = text.replace(/^(?:description|notes?|steps?|title)\s*[:\-\u2013]\s*/i, "").trim();

  // Always try actual result first — most meaningful summary for a bug title
  const actualM = text.match(/actual\s*(?:result)?\s*[-:\u2013]\s*(.+?)(?:\n|$)/i);
  if (actualM && actualM[1].trim().length > 3) {
    const basis = actualM[1].trim().replace(/[.!?]$/, "");
    const isScc = /scc/i.test(text);
    const isInbound = /\basn\b|inbound|vbkreq|vbkcon/i.test(text);
    const prefix = isScc ? "SCC \u2014 " : isInbound ? "Inbound \u2014 " : "";
    const capped = basis.length > 90 ? basis.substring(0, 87) + "..." : basis;
    return (prefix + capped.charAt(0).toUpperCase() + capped.slice(1)).trim();
  }

  // No actual result — use first meaningful non-step, non-label line
  const lines = text.split(/\n/);
  for (const line of lines) {
    const clean = line.replace(/^\d+[.\-:\)]\s*/, "").trim();
    if (clean.length > 5 && !/^(?:actual|expected|steps?|test\s*(?:data|asn))\s*[-:\u2013]/i.test(clean)) {
      const capped = clean.length > 100 ? clean.substring(0, 97) + "..." : clean;
      return capped.charAt(0).toUpperCase() + capped.slice(1);
    }
  }

  // Last resort: strip any leading "N." and use first sentence
  const firstSentence = text.replace(/^\d+\.\s*/, "").split(/[.!?\n]/)[0].trim();
  const candidate = firstSentence || text;
  const capped = candidate.length > 100 ? candidate.substring(0, 97) + "..." : candidate;
  return capped.charAt(0).toUpperCase() + capped.slice(1);
}

/**
 * Suggests an assignee based on keywords in the notes.
 * Assignee values must match the dropdown options in the UI.
 */
function suggestAssignee(description) {
  const lower = (description || "").toLowerCase();
  // E2open integration platform keywords take priority — most inbound supply chain bugs live here
  if (
    lower.includes("e2open") || lower.includes("vbkcon") || lower.includes("vbkreq") ||
    lower.includes("asn") || lower.includes("gpm") || lower.includes("bst") ||
    lower.includes("po feed") || lower.includes("message log") || lower.includes("inbound")
  ) return "E2open";
  // ASOS sub-teams (only if no E2open keywords found)
  if (lower.includes(" ris ") || lower.includes("returns") || lower.includes("reverse")) return "ASOS RIS";
  if (lower.includes(" rms ") || lower.includes("range") || lower.includes("product range")) return "ASOS RMS";
  if (lower.includes("sct") || lower.includes("warehouse") || lower.includes("wms")) return "ASOS SCT";
  return "E2open"; // default
}

module.exports = { suggestPriorityAndSeverity, suggestReproSteps, suggestTitle, suggestAssignee };
