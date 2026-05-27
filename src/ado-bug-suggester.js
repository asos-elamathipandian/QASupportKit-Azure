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
  if (byLine.length >= 2) {
    userStepLines = byLine.map((l) => l.replace(/^(?:step\s*)?\d+[.:\-\)]\s*/i, "").trim());
  } else {
    // Inline: "1. Login. 2. Navigate. 3. Click." — split at whitespace before "N. "
    const inlineParts = stepText.split(/\s+(?=\d+\.\s)/);
    const inlineSteps = inlineParts
      .map((s) => s.trim())
      .filter((s) => /^\d+\.\s/.test(s))
      .map((s) => s.replace(/^\d+\.\s+/, "").replace(/[.!?]$/, "").trim())
      .filter((s) => s.length > 0);
    if (inlineSteps.length >= 2) userStepLines = inlineSteps;
  }

  // ── Build steps: use user's steps if present, else domain defaults ─────────
  let steps = [];

  const isAsn     = lower.includes("asn") || asnMatch;
  const isVbkcon  = lower.includes("vbkcon") || lower.includes("carrier booking") || lower.includes("booking");
  const isVbkreq  = lower.includes("vbkreq");
  const isGpm     = lower.includes("gpm");
  const isBst     = lower.includes("bst") || lower.includes("bulk status");
  const isPo      = lower.includes("po feed") || lower.includes("po ") || poMatch;
  const isScc     = lower.includes("scc") || lower.includes("wms");

  if (userStepLines.length >= 2) {
    // User provided their own steps — use them directly
    steps = userStepLines;
  } else if (isVbkcon || isVbkreq) {
    const msgRef = asnMatch ? ` for ASN ${asnMatch[1]}` : "";
    steps = [
      `Login to E2open`,
      `Navigate to the Carrier Booking / Outbound message log`,
      `Trigger${msgRef} and locate the VBKREQ / VBKCON message in the logs`,
      `Validate VBKREQ and VBKCON message content against expected values`,
      `Check whether the files are processed with status SUCCESS or ERROR`,
      `If ERROR — capture the error message / rejection reason from the logs`,
      `Verify the booking confirmation is reflected correctly in the downstream system`,
    ];
  } else if (isAsn) {
    const asnRef = asnMatch ? ` (${asnMatch[1]})` : "";
    steps = [
      `Login to E2open`,
      `Trigger / send the inbound ASN${asnRef} from the supplier`,
      `Navigate to the inbound message log and locate the ASN`,
      `Validate VBKREQ, VBKCON entries associated with the ASN on the logs`,
      `Check whether the ASN file is processed with status SUCCESS or ERROR`,
      `If ERROR — capture the error message and rejection reason from the logs`,
      `Verify the ASN shipment lines appear correctly in WMS / downstream system`,
    ];
  } else if (isGpm) {
    steps = [
      `Login to E2open`,
      `Navigate to the GPM / Product Master message log`,
      `Trigger or locate the GPM message in the logs`,
      `Check whether the GPM file is processed with status SUCCESS or ERROR`,
      `If ERROR — capture the error message from the logs`,
      `Verify the product / item data is correctly reflected in the downstream system`,
    ];
  } else if (isBst) {
    steps = [
      `Login to E2open`,
      `Navigate to the BST / Bulk Status message log`,
      `Trigger or locate the BST message in the logs`,
      `Check whether the BST file is processed with status SUCCESS or ERROR`,
      `If ERROR — capture the rejection reason from the logs`,
      `Verify the status update is reflected correctly in the downstream system`,
    ];
  } else if (isPo) {
    const poRef = poMatch ? ` (${poMatch[1]})` : "";
    steps = [
      `Login to E2open`,
      `Navigate to the PO Feed / Inbound Purchase Order log`,
      `Locate the PO${poRef} message in the logs`,
      `Check whether the PO Feed file is processed with status SUCCESS or ERROR`,
      `If ERROR — capture the error message and rejection reason from the logs`,
      `Verify the PO data is correctly reflected in the downstream system`,
    ];
  } else if (isScc) {
    steps = [
      `Login to E2open SCC`,
      `Navigate to the relevant ASN / booking section`,
      `Perform the relevant action as described`,
      `Check the system response and log output`,
      `Verify the expected outcome in WMS`,
    ];
  } else {
    steps = [
      `Login to E2open`,
      `Navigate to the relevant message / transaction log`,
      `Locate the affected message or transaction`,
      `Validate the message on the logs`,
      `Check whether the file / transaction is processed with status SUCCESS or ERROR`,
      `If ERROR — capture the error message and rejection reason from the logs`,
      `Verify the expected outcome in the downstream system`,
    ];
  }

  const stepsHtml = steps.map((s) => `<li>${s}</li>`).join("");

  // ── Derive expected result ────────────────────────────────────────────────
  let expected = userExpected || "";
  if (!expected) {
    if (lower.includes("not process") || lower.includes("not being process")) {
      expected = "The message / file should be processed successfully with status SUCCESS and reflect correctly in the downstream system";
    } else if (lower.includes("reject") || lower.includes("rejected")) {
      expected = "The message should be accepted by E2open and processed with status SUCCESS";
    } else if (lower.includes("500") || lower.includes("error") || lower.includes("exception")) {
      expected = "The operation should complete without errors and the file should be processed with status SUCCESS";
    } else if (lower.includes("missing") || lower.includes("not appear") || lower.includes("not show")) {
      expected = "The expected data / lines should appear in the downstream system after successful processing";
    } else if (lower.includes("fail") || lower.includes("failing")) {
      expected = "The operation should complete successfully with status SUCCESS on the E2open logs";
    } else if (lower.includes("slow") || lower.includes("delay") || lower.includes("timeout")) {
      expected = "The system should process and respond within the expected SLA / time threshold";
    } else if (isVbkcon || isVbkreq) {
      expected = "VBKREQ and VBKCON should be generated and processed with status SUCCESS; booking confirmation should be visible in the downstream system";
    } else if (isAsn) {
      expected = "ASN should be accepted by E2open, processed with status SUCCESS, and all shipment lines should be visible in WMS";
    } else {
      expected = "The file / message should be processed with status SUCCESS and the expected outcome should be visible in the downstream system";
    }
  }

  // ── Build description: actual result + "in [tool]" extracted from step 1 ───
  const beforeFirstStep = stepText.split(/\s*1\.\s/)[0].trim();
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
    // Don't append if the actual result already names the tool
    const alreadyMentioned = product && new RegExp(product.split(" ")[0], "i").test(base);
    descriptionText = (product && !alreadyMentioned)
      ? `${base.charAt(0).toUpperCase() + base.slice(1)} in ${product}.`
      : `${base.charAt(0).toUpperCase() + base.slice(1)}.`;
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

  return (
    `<b>Description:</b><br/>${descriptionText}<br/><br/>` +
    `<b>Steps to Reproduce:</b><br/><ol>${stepsHtml}</ol>` +
    `<b>Actual Result:</b><br/>${actual}<br/><br/>` +
    `<b>Expected Result:</b><br/>${expected}<br/><br/>` +
    `<b>Test Data:</b><br/>${testData}`
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
  // If text starts with a numbered step, derive title from actual result + domain prefix
  if (/^\d+\.\s/.test(text)) {
    const actualM = text.match(/actual\s*(?:result)?\s*[-:\u2013]\s*(.+?)(?=\s*expected\s*(?:result)?\s*[-:\u2013]|\s*test\s*(?:asn|data)\s*[-:\u2013]|\s*$)/i);
    if (actualM) {
      const basis = actualM[1].trim().replace(/[.!?]$/, "");
      const isScc = /scc/i.test(text);
      const isInbound = /\basn\b|inbound|vbkreq|vbkcon/i.test(text);
      const prefix = isScc ? "SCC \u2014 " : isInbound ? "Inbound \u2014 " : "";
      const capped = basis.length > 90 ? basis.substring(0, 87) + "..." : basis;
      return (prefix + capped.charAt(0).toUpperCase() + capped.slice(1)).trim();
    }
    // Fall back: skip all step fragments and use next non-step sentence
    const noSteps = text.replace(/\d+\.\s+[^.]+\.?/g, " ").trim();
    const first = noSteps.split(/[.!?\n]/)[0].trim();
    if (first && first.length > 5) return first.charAt(0).toUpperCase() + first.slice(1);
  }
  const firstSentence = text.split(/[.!?\n]/)[0].trim();
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
