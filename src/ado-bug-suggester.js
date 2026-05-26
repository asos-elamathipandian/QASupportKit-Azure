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
      "not working", "rejected", "invalid", "missing field", "p2",
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
    `Given the bug title and description below, generate HTML content for the "Repro Steps" field.\n` +
    `Structure it with four clearly labelled sections:\n` +
    `1. <b>Description:</b> — one paragraph summary\n` +
    `2. <b>Steps to Reproduce:</b> — numbered <ol> list of steps\n` +
    `3. <b>Expected Result:</b> — one paragraph\n` +
    `4. <b>Test Data:</b> — any relevant test data or "N/A"\n\n` +
    `Bug Title: ${title}\n` +
    `Description: ${description || "(none provided)"}\n\n` +
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
  const text = (description || title || "").trim();
  const lower = text.toLowerCase();

  // ── Extract identifiers from description ──────────────────────────────────
  const identifiers = [];
  const asnMatch   = text.match(/\bASN\s*[:\-]?\s*(\d{10,})/i);
  const poMatch    = text.match(/\bPO\s*[:\-]?\s*(\d{5,})/i);
  const suppMatch  = text.match(/supplier\s*[:\-]?\s*(\d{5,})/i);
  if (asnMatch)  identifiers.push(`ASN: ${asnMatch[1]}`);
  if (poMatch)   identifiers.push(`PO: ${poMatch[1]}`);
  if (suppMatch) identifiers.push(`Supplier: ${suppMatch[1]}`);
  const testData = identifiers.length
    ? identifiers.join(", ")
    : "Use relevant test data from the current sprint";

  // ── Detect message type / area and build domain-specific steps ────────────
  let steps = [];

  const isAsn     = lower.includes("asn") || asnMatch;
  const isVbkcon  = lower.includes("vbkcon") || lower.includes("carrier booking") || lower.includes("booking");
  const isVbkreq  = lower.includes("vbkreq");
  const isGpm     = lower.includes("gpm");
  const isBst     = lower.includes("bst") || lower.includes("bulk status");
  const isPo      = lower.includes("po feed") || lower.includes("po ") || poMatch;
  const isScc     = lower.includes("scc") || lower.includes("wms");

  if (isVbkcon || isVbkreq) {
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
  } else if (isScc || isScc) {
    steps = [
      `Login to E2open SCC`,
      `Navigate to the relevant ASN / booking section`,
      `Perform the relevant action as described`,
      `Check the system response and log output`,
      `Verify the expected outcome in WMS`,
    ];
  } else {
    // Generic E2Open inbound flow
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

  // ── Derive expected result by inverting the problem ───────────────────────
  let expected = "";
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

  return (
    `<b>Description:</b><br/>${text}<br/><br/>` +
    `<b>Steps to Reproduce:</b><br/><ol>${stepsHtml}</ol>` +
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
  const text = (description || "").trim();
  // Take up to the first sentence-ending punctuation
  const firstSentence = text.split(/[.!?\n]/)[0].trim();
  const candidate = firstSentence || text;
  // Capitalise first letter and cap length
  const capped = candidate.length > 100 ? candidate.substring(0, 97) + "..." : candidate;
  return capped.charAt(0).toUpperCase() + capped.slice(1);
}

module.exports = { suggestPriorityAndSeverity, suggestReproSteps, suggestTitle };
