"use strict";

console.log("[STARTUP] web-server.js loading...");
console.log("[STARTUP] PORT =", process.env.PORT);
console.log("[STARTUP] NODE_ENV =", process.env.NODE_ENV);
console.log("[STARTUP] cwd =", process.cwd());

const express = require("express");
const path = require("path");
const fs = require("fs");
const { writeVbkconFile } = require("./vbkcon");
const { writeBulkStatusFile } = require("./bulk-status");
const { writeCarrierShipmentFile } = require("./carrier-shipment");
const { writeAsnFcbkcFile } = require("./asn-fcbkc");
const { writeAsnRcvFile } = require("./asn-rcv");
const { writeAsnPadexFile } = require("./asn-padex");
const { writeAsnFeedFile } = require("./asn-feed");
const { writeGpmFile } = require("./gpm");
const { writePoFeedFile } = require("./po-feed");
const { uploadFileToSftp } = require("./sftp");
const { buildSftpConfigFromEnv, buildProdSftpConfigFromEnv } = require("./sftp-config");
const { searchBlobsByAsn, searchBlobsByAsnNameAndContent, searchBlobsByPoNameAndContent, searchBlobsCarrierFeedByAsn, downloadBlobs } = require("./blob-search");
const {
  getAbvCounterFile,
  getCarrierSequenceFile,
  getOutputDir,
  getStateDir,
  loadEnvironment,
} = require("./app-config");
const {
  getSccAvailability,
  getSccSessionStatus,
  bootstrapSccSession,
  clearSccSession,
  lookupAsn,
  createSingleAsnBooking,
  createMultiAsnBooking,
  createFullSccFlow,
  cancelActiveSpec,
} = require("./scc-launcher");

loadEnvironment();

// Ensure required directories exist (they are gitignored so won't be present on Azure)
[getOutputDir(process.env), getStateDir(process.env)].forEach((dir) => {
  console.log("[STARTUP] Ensuring dir:", dir);
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
});

const app = express();
app.use(express.json({ limit: "10mb" }));
app.use(express.static(path.join(__dirname, "..", "public")));

// Health check endpoint (useful for Azure probes)
app.get("/api/health", (req, res) => {
  res.json({ ok: true, uptime: process.uptime(), pid: process.pid });
});

const PORT = process.env.PORT || 3000;

async function upload(filePath) {
  const sftpConfig = buildSftpConfigFromEnv(process.env);
  const result = await uploadFileToSftp({
    localFilePath: filePath,
    remoteDir: sftpConfig.remoteDir,
    connectionOptions: sftpConfig.connectionOptions,
  });
  return result.remotePath;
}

function validate(body, fields) {
  const missing = fields.filter((f) => !body[f] || !String(body[f]).trim());
  return missing.length ? `Missing required fields: ${missing.join(", ")}` : null;
}

// ── Live progress log ─────────────────────────────────────────────────────────

let progressLog = [];

function clearProgress() {
  progressLog = [];
}

function addProgress(message) {
  const entry = { ts: new Date().toLocaleTimeString(), message };
  progressLog.push(entry);
  console.log(`[PROGRESS] ${entry.ts} — ${message}`);
}

// Keywords to pick up from Playwright stdout/stderr as progress updates
const PROGRESS_PATTERNS = [
  // Explicit progress marker (tests can use: console.log("PROGRESS: message"))
  { re: /PROGRESS:\s*(.+)/i, extract: (m) => m[1].trim() },

  // Actual prefixes used by Playwright specs
  { re: /\[asn-lookup\]\s*(.+)/i, extract: (m) => m[1].trim() },
  { re: /\[booking-step\]\s*(.+)/i, extract: (m) => m[1].trim() },
  { re: /\[full-flow\]\s*(.+)/i, extract: (m) => m[1].trim() },
  { re: /\[multi-lines-edit\]\s*(.+)/i, extract: (m) => m[1].trim() },

  // Key data markers from specs
  { re: /ASN_LOOKUP_RESULTS?:\s*(.+)/i, extract: (m) => "ASN lookup complete" },
  { re: /FULL_FLOW_RESULT:\s*/i, extract: () => "Full flow result received" },
  { re: /VB Reference:\s*(VB-\S+)/i, extract: (m) => `VB Reference: ${m[1]}` },
  { re: /Booking Status:\s*(\w+)/i, extract: (m) => `Booking status: ${m[1]}` },
  { re: /Booking completed for ASN:\s*(.+)/i, extract: (m) => `Booking completed for ASN: ${m[1].trim()}` },
  { re: /Multi-ASN booking completed/i, extract: () => "Multi-ASN booking completed" },
  { re: /Step\s*(\d+)/i, extract: (m) => `Step ${m[1]} in progress…` },

  // Common Playwright / browser actions
  { re: /navigating to|goto\(|page\.goto/i, extract: () => "Navigating to portal…" },
  { re: /logging in|login|signed in|authenticated|credentials/i, extract: () => "Logging in to SCC…" },
  { re: /searching|order search|search.*page/i, extract: () => "Searching records…" },
  { re: /found (\d+) record/i, extract: (m) => `Found ${m[1]} record(s)` },
  { re: /creating.*booking|create.*booking|new booking/i, extract: () => "Creating new booking…" },
  { re: /draft.*created|booking.*draft/i, extract: () => "Draft VB created" },
  { re: /editing|edit.*booking/i, extract: () => "Editing VB details…" },
  { re: /adding.*asn|asn.*added/i, extract: () => "Adding ASN to booking…" },
  { re: /submitting|submit.*booking/i, extract: () => "Submitting VB…" },
  { re: /approv/i, extract: () => "Processing approval…" },
  { re: /approved/i, extract: () => "VB approved ✓" },

  // Playwright test runner output
  { re: /(\d+) passed/i, extract: (m) => `${m[1]} test(s) passed ✓` },
  { re: /(\d+) failed/i, extract: (m) => `${m[1]} test(s) failed ✕` },
  { re: /timed?\s*out/i, extract: () => "Operation timed out" },
];

// Noise lines to skip (Playwright runner boilerplate)
const NOISE_PATTERNS = [
  /^\s*$/,
  /^Running \d+ test/i,
  /^npx playwright/i,
  /^Using.*config/i,
  /^\s*at\s+/,           // stack traces
  /^node_modules/,
  /^\d+\s*\|/,           // source code lines in error output
  /^=+$/,                // separator lines
];

function parseStdoutForProgress(data) {
  const text = data.toString();
  const lines = text.split("\n").map((l) => l.trim()).filter(Boolean);
  for (const line of lines) {
    // Skip noise
    if (NOISE_PATTERNS.some((p) => p.test(line))) continue;

    let matched = false;
    for (const pat of PROGRESS_PATTERNS) {
      const m = line.match(pat.re);
      if (m) {
        const msg = pat.extract(m);
        // Avoid duplicate consecutive messages
        if (progressLog.length === 0 || progressLog[progressLog.length - 1].message !== msg) {
          addProgress(msg);
        }
        matched = true;
        break;
      }
    }

    // If no pattern matched but line contains a console.log from the spec, show it raw
    if (!matched && line.length > 5 && line.length < 200) {
      // Only show lines that look like intentional log output (contains letters, not just symbols)
      if (/[a-zA-Z]{3,}/.test(line) && !/^[\s\d.:]+$/.test(line)) {
        const msg = line.substring(0, 150);
        if (progressLog.length === 0 || progressLog[progressLog.length - 1].message !== msg) {
          addProgress(msg);
        }
      }
    }
  }
}

app.get("/api/progress", (req, res) => {
  const since = parseInt(req.query.since, 10) || 0;
  const entries = progressLog.slice(since);
  res.json({ entries, total: progressLog.length });
});

// ── Individual endpoints ──────────────────────────────────────────────────────

// Step 1: Generate VBKCON XML and return for review (no upload yet)
app.post("/api/generate/vbkcon", async (req, res) => {
  const err = validate(req.body, ["ace"]);
  if (err) return res.status(400).json({ ok: false, error: err });
  try {
    const { ace, carrier = "DT" } = req.body;
    const outputDir = getOutputDir(process.env);
    const gen = await writeVbkconFile({
      ace,
      carrier,
      outputDir,
      abvCounterFile: getAbvCounterFile(process.env),
    });
    // Read XML content from file
    const xmlContent = fs.readFileSync(gen.filePath, "utf8");
    res.json({ ok: true, fileName: gen.fileName, xml: xmlContent });
  } catch (e) {
    res.status(500).json({ ok: false, error: e.message });
  }
});

// Step 2: Accept reviewed/edited VBKCON XML and upload to SFTP
app.post("/api/upload/vbkcon", async (req, res) => {
  const err = validate(req.body, ["fileName", "xml"]);
  if (err) return res.status(400).json({ ok: false, error: err });
  try {
    const { fileName, xml } = req.body;
    const outputDir = getOutputDir(process.env);
    const filePath = path.join(outputDir, fileName);
    fs.writeFileSync(filePath, xml, "utf8");
    const remotePath = await upload(filePath);
    res.json({ ok: true, fileName, uploaded: true, remotePath });
  } catch (e) {
    res.status(500).json({ ok: false, error: e.message });
  }
});

// Step 1: Generate BST XML and return for review (no upload yet)
app.post("/api/generate/bst", async (req, res) => {
  const err = validate(req.body, ["asn", "carrier"]);
  if (err) return res.status(400).json({ ok: false, error: err });
  try {
    const { asn, carrier } = req.body;
    const outputDir = getOutputDir(process.env);
    const gen = await writeBulkStatusFile({ asn, carrier, outputDir });
    const xmlContent = fs.readFileSync(gen.filePath, "utf8");
    res.json({ ok: true, fileName: gen.fileName, xml: xmlContent });
  } catch (e) {
    res.status(500).json({ ok: false, error: e.message });
  }
});

// Step 2: Accept reviewed/edited BST XML and upload to SFTP
app.post("/api/upload/bst", async (req, res) => {
  const err = validate(req.body, ["fileName", "xml"]);
  if (err) return res.status(400).json({ ok: false, error: err });
  try {
    const { fileName, xml } = req.body;
    const outputDir = getOutputDir(process.env);
    const filePath = path.join(outputDir, fileName);
    fs.writeFileSync(filePath, xml, "utf8");
    const remotePath = await upload(filePath);
    res.json({ ok: true, fileName, uploaded: true, remotePath });
  } catch (e) {
    res.status(500).json({ ok: false, error: e.message });
  }
});

// Step 1: Generate Carrier Shipment XML and return for review (no upload yet)
app.post("/api/generate/shipment", async (req, res) => {
  const err = validate(req.body, ["asn", "po", "sku"]);
  if (err) return res.status(400).json({ ok: false, error: err });
  try {
    const { asn, po, sku, skuQty = "1", carrier = "DT" } = req.body;
    const outputDir = getOutputDir(process.env);
    const gen = await writeCarrierShipmentFile({
      asn,
      po,
      sku,
      skuQty,
      carrier,
      outputDir,
      sequenceFile: getCarrierSequenceFile(process.env),
    });
    const xmlContent = fs.readFileSync(gen.filePath, "utf8");
    res.json({ ok: true, fileName: gen.fileName, xml: xmlContent, sequence: gen.sequence });
  } catch (e) {
    res.status(500).json({ ok: false, error: e.message });
  }
});

// Step 2: Accept reviewed/edited Carrier Shipment XML and upload to SFTP
app.post("/api/upload/shipment", async (req, res) => {
  const err = validate(req.body, ["fileName", "xml"]);
  if (err) return res.status(400).json({ ok: false, error: err });
  try {
    const { fileName, xml } = req.body;
    const outputDir = getOutputDir(process.env);
    const filePath = path.join(outputDir, fileName);
    fs.writeFileSync(filePath, xml, "utf8");
    const remotePath = await upload(filePath);
    res.json({ ok: true, fileName, uploaded: true, remotePath });
  } catch (e) {
    res.status(500).json({ ok: false, error: e.message });
  }
});

// Step 1: Generate ASN FCBKC XML and return for review (no upload yet)
app.post("/api/generate/asn-fcbkc", async (req, res) => {
  const err = validate(req.body, ["asn"]);
  if (err) return res.status(400).json({ ok: false, error: err });
  try {
    const { asn } = req.body;
    const outputDir = getOutputDir(process.env);
    const gen = await writeAsnFcbkcFile({ asn, outputDir });
    const xmlContent = fs.readFileSync(gen.filePath, "utf8");
    res.json({ ok: true, fileName: gen.fileName, xml: xmlContent });
  } catch (e) {
    res.status(500).json({ ok: false, error: e.message });
  }
});

// Step 2: Accept reviewed/edited ASN FCBKC XML and upload to SFTP
app.post("/api/upload/asn-fcbkc", async (req, res) => {
  const err = validate(req.body, ["fileName", "xml"]);
  if (err) return res.status(400).json({ ok: false, error: err });
  try {
    const { fileName, xml } = req.body;
    const outputDir = getOutputDir(process.env);
    const filePath = path.join(outputDir, fileName);
    fs.writeFileSync(filePath, xml, "utf8");
    const remotePath = await upload(filePath);
    res.json({ ok: true, fileName, uploaded: true, remotePath });
  } catch (e) {
    res.status(500).json({ ok: false, error: e.message });
  }
});

// Step 1: Generate ASN RCV XML and return for review (no upload yet)
app.post("/api/generate/asn-rcv", async (req, res) => {
  const err = validate(req.body, ["asn"]);
  if (err) return res.status(400).json({ ok: false, error: err });
  try {
    const { asn } = req.body;
    const outputDir = getOutputDir(process.env);
    const gen = await writeAsnRcvFile({ asn, outputDir });
    const xmlContent = fs.readFileSync(gen.filePath, "utf8");
    res.json({ ok: true, fileName: gen.fileName, xml: xmlContent });
  } catch (e) {
    res.status(500).json({ ok: false, error: e.message });
  }
});

// Step 2: Accept reviewed/edited ASN RCV XML and upload to SFTP
app.post("/api/upload/asn-rcv", async (req, res) => {
  const err = validate(req.body, ["fileName", "xml"]);
  if (err) return res.status(400).json({ ok: false, error: err });
  try {
    const { fileName, xml } = req.body;
    const outputDir = getOutputDir(process.env);
    const filePath = path.join(outputDir, fileName);
    fs.writeFileSync(filePath, xml, "utf8");
    const remotePath = await upload(filePath);
    res.json({ ok: true, fileName, uploaded: true, remotePath });
  } catch (e) {
    res.status(500).json({ ok: false, error: e.message });
  }
});

// Step 1: Generate ASN PADEX XML and return for review (no upload yet)
app.post("/api/generate/asn-padex", async (req, res) => {
  const err = validate(req.body, ["asn", "po", "sku"]);
  if (err) return res.status(400).json({ ok: false, error: err });
  try {
    const { asn, po, sku, skuQty = "1" } = req.body;
    const outputDir = getOutputDir(process.env);
    const gen = await writeAsnPadexFile({ asn, po, sku, skuQty, outputDir });
    const xmlContent = fs.readFileSync(gen.filePath, "utf8");
    res.json({ ok: true, fileName: gen.fileName, xml: xmlContent });
  } catch (e) {
    res.status(500).json({ ok: false, error: e.message });
  }
});

// Step 2: Accept reviewed/edited ASN PADEX XML and upload to SFTP
app.post("/api/upload/asn-padex", async (req, res) => {
  const err = validate(req.body, ["fileName", "xml"]);
  if (err) return res.status(400).json({ ok: false, error: err });
  try {
    const { fileName, xml } = req.body;
    const outputDir = getOutputDir(process.env);
    const filePath = path.join(outputDir, fileName);
    fs.writeFileSync(filePath, xml, "utf8");
    const remotePath = await upload(filePath);
    res.json({ ok: true, fileName, uploaded: true, remotePath });
  } catch (e) {
    res.status(500).json({ ok: false, error: e.message });
  }
});

// Step 1: Generate ASN FEED XML and return for review (no upload yet)
app.post("/api/generate/asn-feed", async (req, res) => {
  const err = validate(req.body, ["asn", "po", "sku"]);
  if (err) return res.status(400).json({ ok: false, error: err });
  try {
    const { asn, po, sku, skuQty = "1" } = req.body;
    const outputDir = getOutputDir(process.env);
    const gen = await writeAsnFeedFile({ asn, po, sku, skuQty, outputDir });
    const xmlContent = fs.readFileSync(gen.filePath, "utf8");
    res.json({ ok: true, fileName: gen.fileName, xml: xmlContent });
  } catch (e) {
    res.status(500).json({ ok: false, error: e.message });
  }
});

// Step 2: Accept reviewed/edited ASN FEED XML and upload to SFTP
app.post("/api/upload/asn-feed", async (req, res) => {
  const err = validate(req.body, ["fileName", "xml"]);
  if (err) return res.status(400).json({ ok: false, error: err });
  try {
    const { fileName, xml } = req.body;
    const outputDir = getOutputDir(process.env);
    const filePath = path.join(outputDir, fileName);
    fs.writeFileSync(filePath, xml, "utf8");
    const remotePath = await upload(filePath);
    res.json({ ok: true, fileName, uploaded: true, remotePath });
  } catch (e) {
    res.status(500).json({ ok: false, error: e.message });
  }
});


// Step 1: Generate GPM XML and return for review (no upload yet)
app.post("/api/generate/gpm", async (req, res) => {
  const err = validate(req.body, ["sku", "optionId"]);
  if (err) return res.status(400).json({ ok: false, error: err });
  try {
    const { sku, optionId } = req.body;
    const outputDir = getOutputDir(process.env);
    const gen = await writeGpmFile({ sku, optionId, outputDir });

    // Multiple SKUs → multiple files
    if (gen.files) {
      const files = [];
      for (const f of gen.files) {
        // Read XML content from file
        const xmlContent = fs.readFileSync(f.filePath, "utf8");
        files.push({ fileName: f.fileName, sku: f.sku, xml: xmlContent });
      }
      return res.json({ ok: true, files });
    }

    // Single SKU
    const xmlContent = fs.readFileSync(gen.filePath, "utf8");
    res.json({ ok: true, fileName: gen.fileName, xml: xmlContent });
  } catch (e) {
    res.status(500).json({ ok: false, error: e.message });
  }
});

// Step 2: Accept reviewed/edited XML and upload to SFTP
app.post("/api/upload/gpm", async (req, res) => {
  const err = validate(req.body, ["fileName", "xml"]);
  if (err) return res.status(400).json({ ok: false, error: err });
  try {
    const { fileName, xml } = req.body;
    const outputDir = getOutputDir(process.env);
    const filePath = path.join(outputDir, fileName);
    fs.writeFileSync(filePath, xml, "utf8");
    const remotePath = await upload(filePath);
    res.json({ ok: true, fileName, uploaded: true, remotePath });
  } catch (e) {
    res.status(500).json({ ok: false, error: e.message });
  }
});
// Step 1: Generate PO FEED XML and return for review (no upload yet)
app.post("/api/generate/po-feed", async (req, res) => {
  const err = validate(req.body, ["po", "sku", "optionId"]);
  if (err) return res.status(400).json({ ok: false, error: err });
  try {
    const { po, sku, skuQty = "1", optionId, carrier = "DT" } = req.body;
    const outputDir = getOutputDir(process.env);
    const gen = await writePoFeedFile({ po, sku, skuQty, optionId, carrier, outputDir });
    const xmlContent = fs.readFileSync(gen.filePath, "utf8");
    res.json({ ok: true, fileName: gen.fileName, xml: xmlContent });
  } catch (e) {
    res.status(500).json({ ok: false, error: e.message });
  }
});

// Step 2: Accept reviewed/edited PO FEED XML and upload to SFTP
app.post("/api/upload/po-feed", async (req, res) => {
  const err = validate(req.body, ["fileName", "xml"]);
  if (err) return res.status(400).json({ ok: false, error: err });
  try {
    const { fileName, xml } = req.body;
    const outputDir = getOutputDir(process.env);
    const filePath = path.join(outputDir, fileName);
    fs.writeFileSync(filePath, xml, "utf8");
    const remotePath = await upload(filePath);
    res.json({ ok: true, fileName, uploaded: true, remotePath });
  } catch (e) {
    res.status(500).json({ ok: false, error: e.message });
  }
});

// ── Generate All (order: VBKCON → BST → Shipment → FCBKC → RCV → PADEX) ─────

app.post("/api/generate/all", async (req, res) => {
  const err = validate(req.body, ["asn", "po", "sku", "ace"]);
  if (err) return res.status(400).json({ ok: false, error: err });

  const { asn, po, sku, skuQty = "1", ace, carrier = "DT" } = req.body;
  const outputDir = getOutputDir(process.env);
  const results = {};

  // 1. VBKCON
  try {
    const gen = await writeVbkconFile({
      ace,
      carrier,
      outputDir,
      abvCounterFile: getAbvCounterFile(process.env),
    });
    results.vbkcon = {
      ok: true,
      fileName: gen.fileName,
      uploaded: true,
      remotePath: await upload(gen.filePath),
    };
  } catch (e) {
    results.vbkcon = { ok: false, error: e.message };
  }

  // 2. BST
  try {
    const gen = await writeBulkStatusFile({ asn, carrier, outputDir });
    results.bst = {
      ok: true,
      fileName: gen.fileName,
      uploaded: true,
      remotePath: await upload(gen.filePath),
    };
  } catch (e) {
    results.bst = { ok: false, error: e.message };
  }

  // 3. Carrier Shipment
  try {
    const gen = await writeCarrierShipmentFile({
      asn,
      po,
      sku,
      skuQty,
      carrier,
      outputDir,
      sequenceFile: getCarrierSequenceFile(process.env),
    });
    results.shipment = {
      ok: true,
      fileName: gen.fileName,
      uploaded: true,
      remotePath: await upload(gen.filePath),
    };
  } catch (e) {
    results.shipment = { ok: false, error: e.message };
  }

  // 4. ASN FCBKC
  try {
    const gen = await writeAsnFcbkcFile({ asn, outputDir });
    results.asnFcbkc = {
      ok: true,
      fileName: gen.fileName,
      uploaded: true,
      remotePath: await upload(gen.filePath),
    };
  } catch (e) {
    results.asnFcbkc = { ok: false, error: e.message };
  }

  // 5. ASN RCV
  try {
    const gen = await writeAsnRcvFile({ asn, outputDir });
    results.asnRcv = {
      ok: true,
      fileName: gen.fileName,
      uploaded: true,
      remotePath: await upload(gen.filePath),
    };
  } catch (e) {
    results.asnRcv = { ok: false, error: e.message };
  }

  // 6. ASN PADEX
  try {
    const gen = await writeAsnPadexFile({ asn, po, sku, skuQty, outputDir });
    results.asnPadex = {
      ok: true,
      fileName: gen.fileName,
      uploaded: true,
      remotePath: await upload(gen.filePath),
    };
  } catch (e) {
    results.asnPadex = { ok: false, error: e.message };
  }

  res.json({ ok: Object.values(results).every((r) => r.ok), results });
});

// ── PROD SFTP Upload (fully isolated — uses PROD_SFTP_* env vars only) ────────

async function uploadToProd(filePath) {
  const sftpConfig = buildProdSftpConfigFromEnv(process.env);
  const result = await uploadFileToSftp({
    localFilePath: filePath,
    remoteDir: sftpConfig.remoteDir,
    connectionOptions: sftpConfig.connectionOptions,
  });
  return result.remotePath;
}

// Accept pre-modified XML files from the browser, save, then push to PROD SFTP
app.post("/api/prod-upload", async (req, res) => {
  const err = validate(req.body, ["fileName", "xml"]);
  if (err) return res.status(400).json({ ok: false, error: err });
  try {
    const { fileName, xml } = req.body;
    // Reject any path traversal attempt
    const safeFileName = path.basename(fileName);
    if (!safeFileName || safeFileName !== fileName) {
      return res.status(400).json({ ok: false, error: "Invalid file name" });
    }
    // Basic XML syntax validation — reject if the content doesn't look like valid XML
    const trimmed = xml.trim();
    if (!trimmed.startsWith("<")) {
      return res.status(400).json({ ok: false, error: "Invalid XML: content does not start with '<'" });
    }
    // Check for unclosed root tag as a lightweight well-formedness guard
    const rootTagMatch = trimmed.match(/^<[?!].*?>?\s*<([\w:.-]+)[\s>]/);
    const rootTag = rootTagMatch ? rootTagMatch[1] : null;
    if (rootTag && !trimmed.includes(`</${rootTag}>`)) {
      return res.status(400).json({ ok: false, error: `Invalid XML: missing closing tag </${rootTag}>` });
    }
    const outputDir = getOutputDir(process.env);
    const filePath = path.join(outputDir, safeFileName);
    fs.writeFileSync(filePath, xml, "utf8");
    const remotePath = await uploadToProd(filePath);
    res.json({ ok: true, fileName: safeFileName, uploaded: true, remotePath });
  } catch (e) {
    res.status(500).json({ ok: false, error: e.message });
  }
});

// ── Blob Search & Download ────────────────────────────────────────────────────

app.post("/api/blob-search", async (req, res) => {
  const { asn, hoursBack = 1440, maxBlobs = 1000 } = req.body;
  if (!asn || !asn.trim()) return res.status(400).json({ ok: false, error: "asn is required" });

  const connectionString = process.env.AZURE_BLOB_CONNECTION_STRING;
  if (!connectionString) {
    return res.status(500).json({ ok: false, error: "AZURE_BLOB_CONNECTION_STRING not configured" });
  }

  try {
    const containerName = process.env.AZURE_BLOB_CONTAINER || "sftp-inbound";
    const result = await searchBlobsByAsn({ asn: asn.trim(), connectionString, containerName, hoursBack, maxBlobs });
    res.json({ ok: true, ...result });
  } catch (e) {
    res.status(500).json({ ok: false, error: e.message });
  }
});

app.post("/api/blob-download", async (req, res) => {
  const { blobNames } = req.body;
  if (!Array.isArray(blobNames) || blobNames.length === 0) {
    return res.status(400).json({ ok: false, error: "blobNames array is required" });
  }

  const connectionString = process.env.AZURE_BLOB_CONNECTION_STRING;
  if (!connectionString) {
    return res.status(500).json({ ok: false, error: "AZURE_BLOB_CONNECTION_STRING not configured" });
  }

  try {
    const containerName = process.env.AZURE_BLOB_CONTAINER || "sftp-inbound";
    const outputDir = getOutputDir(process.env);
    const result = await downloadBlobs({ blobNames, connectionString, containerName, outputDir });
    res.json({ ok: true, ...result });
  } catch (e) {
    res.status(500).json({ ok: false, error: e.message });
  }
});

app.get("/api/blob-file", async (req, res) => {
  const blobName = req.query.name;
  if (!blobName) return res.status(400).json({ ok: false, error: "name query param is required" });

  // Validate blob path stays within expected container prefix
  if (blobName.includes("..") || blobName.startsWith("/")) {
    return res.status(400).json({ ok: false, error: "Invalid blob name" });
  }

  const connectionString = process.env.AZURE_BLOB_CONNECTION_STRING;
  if (!connectionString) {
    return res.status(500).json({ ok: false, error: "AZURE_BLOB_CONNECTION_STRING not configured" });
  }

  try {
    const { BlobServiceClient } = require("@azure/storage-blob");
    const containerName = process.env.AZURE_BLOB_CONTAINER || "sftp-inbound";
    const blobServiceClient = BlobServiceClient.fromConnectionString(connectionString);
    const containerClient = blobServiceClient.getContainerClient(containerName);
    const blobClient = containerClient.getBlobClient(blobName);

    const downloadResponse = await blobClient.download(0);
    const fileName = blobName.split("/").pop();

    res.setHeader("Content-Disposition", `attachment; filename="${fileName}"`);
    res.setHeader("Content-Type", "application/xml");
    if (downloadResponse.contentLength) {
      res.setHeader("Content-Length", downloadResponse.contentLength);
    }
    downloadResponse.readableStreamBody.pipe(res);
  } catch (e) {
    res.status(500).json({ ok: false, error: e.message });
  }
});

// ── E2Open ASN Blob Search (asscteunintebbe2e) ───────────────────────────────

app.post("/api/blob-search-asn", async (req, res) => {
  const { asn, hoursBack = 1440, maxBlobs = 500 } = req.body;
  if (!asn || !asn.trim()) return res.status(400).json({ ok: false, error: "asn is required" });

  const connectionString = process.env.AZURE_BLOB_E2OPEN_ASN_CONNECTION_STRING;
  if (!connectionString) {
    return res.status(500).json({ ok: false, error: "AZURE_BLOB_E2OPEN_ASN_CONNECTION_STRING not configured" });
  }

  try {
    const containerName = process.env.AZURE_BLOB_E2OPEN_ASN_CONTAINER || "sds-asn-e2open";
    const result = await searchBlobsByAsnNameAndContent({ asn: asn.trim(), connectionString, containerName, hoursBack, maxBlobs });
    res.json({ ok: true, ...result });
  } catch (e) {
    res.status(500).json({ ok: false, error: e.message });
  }
});

app.get("/api/blob-file-asn", async (req, res) => {
  const blobName = req.query.name;
  if (!blobName) return res.status(400).json({ ok: false, error: "name query param is required" });

  if (blobName.includes("..") || blobName.startsWith("/")) {
    return res.status(400).json({ ok: false, error: "Invalid blob name" });
  }

  const connectionString = process.env.AZURE_BLOB_E2OPEN_ASN_CONNECTION_STRING;
  if (!connectionString) {
    return res.status(500).json({ ok: false, error: "AZURE_BLOB_E2OPEN_ASN_CONNECTION_STRING not configured" });
  }

  try {
    const { BlobServiceClient } = require("@azure/storage-blob");
    const containerName = process.env.AZURE_BLOB_E2OPEN_ASN_CONTAINER || "sds-asn-e2open";
    const blobServiceClient = BlobServiceClient.fromConnectionString(connectionString);
    const containerClient = blobServiceClient.getContainerClient(containerName);
    const blobClient = containerClient.getBlobClient(blobName);

    const downloadResponse = await blobClient.download(0);
    const fileName = blobName.split("/").pop();

    res.setHeader("Content-Disposition", `attachment; filename="${fileName}"`);
    res.setHeader("Content-Type", "application/xml");
    if (downloadResponse.contentLength) {
      res.setHeader("Content-Length", downloadResponse.contentLength);
    }
    downloadResponse.readableStreamBody.pipe(res);
  } catch (e) {
    res.status(500).json({ ok: false, error: e.message });
  }
});

// ── E2Open PO Feed Blob Search (asbamintstgeunendtoend01) ────────────────────

app.post("/api/blob-search-po", async (req, res) => {
  const { po, hoursBack = 1440, maxBlobs = 500 } = req.body;
  if (!po || !po.trim()) return res.status(400).json({ ok: false, error: "po is required" });

  const connectionString = process.env.AZURE_BLOB_E2OPEN_PO_CONNECTION_STRING;
  if (!connectionString) {
    return res.status(500).json({ ok: false, error: "AZURE_BLOB_E2OPEN_PO_CONNECTION_STRING not configured" });
  }

  try {
    const containerName = process.env.AZURE_BLOB_E2OPEN_PO_CONTAINER || "bam033v-aimpurchaseorder-endtoend";
    const result = await searchBlobsByPoNameAndContent({ po: po.trim(), connectionString, containerName, hoursBack, maxBlobs });
    res.json({ ok: true, ...result });
  } catch (e) {
    res.status(500).json({ ok: false, error: e.message });
  }
});

app.get("/api/blob-file-po", async (req, res) => {
  const blobName = req.query.name;
  if (!blobName) return res.status(400).json({ ok: false, error: "name query param is required" });

  if (blobName.includes("..") || blobName.startsWith("/")) {
    return res.status(400).json({ ok: false, error: "Invalid blob name" });
  }

  const connectionString = process.env.AZURE_BLOB_E2OPEN_PO_CONNECTION_STRING;
  if (!connectionString) {
    return res.status(500).json({ ok: false, error: "AZURE_BLOB_E2OPEN_PO_CONNECTION_STRING not configured" });
  }

  try {
    const { BlobServiceClient } = require("@azure/storage-blob");
    const containerName = process.env.AZURE_BLOB_E2OPEN_PO_CONTAINER || "bam033v-aimpurchaseorder-endtoend";
    const blobServiceClient = BlobServiceClient.fromConnectionString(connectionString);
    const containerClient = blobServiceClient.getContainerClient(containerName);
    const blobClient = containerClient.getBlobClient(blobName);

    const downloadResponse = await blobClient.download(0);
    const fileName = blobName.split("/").pop();

    res.setHeader("Content-Disposition", `attachment; filename="${fileName}"`);
    res.setHeader("Content-Type", "application/xml");
    if (downloadResponse.contentLength) {
      res.setHeader("Content-Length", downloadResponse.contentLength);
    }
    downloadResponse.readableStreamBody.pipe(res);
  } catch (e) {
    res.status(500).json({ ok: false, error: e.message });
  }
});

// ── PO Carrier Feed Blob Search (bam036-asnin-endtoend) ─────────────────────

app.post("/api/blob-search-carrier-feed", async (req, res) => {
  const { asn, maxBlobs = 500 } = req.body;
  if (!asn || !asn.trim()) return res.status(400).json({ ok: false, error: "asn is required" });

  const connectionString = process.env.AZURE_BLOB_E2OPEN_PO_CONNECTION_STRING;
  if (!connectionString) {
    return res.status(500).json({ ok: false, error: "AZURE_BLOB_E2OPEN_PO_CONNECTION_STRING not configured" });
  }

  try {
    const containerName = process.env.AZURE_BLOB_CARRIER_FEED_CONTAINER || "bam036-asnin-endtoend";
    const result = await searchBlobsCarrierFeedByAsn({ asn: asn.trim(), connectionString, containerName, maxBlobs });
    res.json({ ok: true, ...result });
  } catch (e) {
    res.status(500).json({ ok: false, error: e.message });
  }
});

app.get("/api/blob-file-carrier-feed", async (req, res) => {
  const blobName = req.query.name;
  if (!blobName) return res.status(400).json({ ok: false, error: "name query param is required" });

  if (blobName.includes("..") || blobName.startsWith("/")) {
    return res.status(400).json({ ok: false, error: "Invalid blob name" });
  }

  const connectionString = process.env.AZURE_BLOB_E2OPEN_PO_CONNECTION_STRING;
  if (!connectionString) {
    return res.status(500).json({ ok: false, error: "AZURE_BLOB_E2OPEN_PO_CONNECTION_STRING not configured" });
  }

  try {
    const { BlobServiceClient } = require("@azure/storage-blob");
    const containerName = process.env.AZURE_BLOB_CARRIER_FEED_CONTAINER || "bam036-asnin-endtoend";
    const blobServiceClient = BlobServiceClient.fromConnectionString(connectionString);
    const containerClient = blobServiceClient.getContainerClient(containerName);
    const blobClient = containerClient.getBlobClient(blobName);

    const downloadResponse = await blobClient.download(0);
    const fileName = blobName.split("/").pop();

    res.setHeader("Content-Disposition", `attachment; filename="${fileName}"`);
    res.setHeader("Content-Type", "application/xml");
    if (downloadResponse.contentLength) {
      res.setHeader("Content-Length", downloadResponse.contentLength);
    }
    downloadResponse.readableStreamBody.pipe(res);
  } catch (e) {
    res.status(500).json({ ok: false, error: e.message });
  }
});

// ── Local-only feature stubs (return disabled status for UI) ──────────────────

// --- SCC ASN Lookup (localhost only) ---
app.get("/api/scc/status", (req, res) => {
  res.json(getSccAvailability());
});

app.get("/api/scc/session-status", (req, res) => {
  res.json({ ok: true, session: getSccSessionStatus() });
});

app.post("/api/scc/session/bootstrap", async (req, res) => {
  try {
    const availability = getSccAvailability();
    if (!availability.available) {
      return res.status(503).json({ ok: false, error: availability.issues[0] || "SCC unavailable" });
    }

    const timeoutMs = Number(req.body?.timeoutMs) || 180000;
    const result = await bootstrapSccSession({ timeoutMs });
    res.json({ ok: true, result, session: getSccSessionStatus() });
  } catch (err) {
    console.error('[API] SCC Session Bootstrap error:', err.message);
    res.status(500).json({ ok: false, error: err.message });
  }
});

app.post("/api/scc/session/clear", (req, res) => {
  try {
    clearSccSession();
    res.json({ ok: true, session: getSccSessionStatus() });
  } catch (err) {
    console.error('[API] SCC Session Clear error:', err.message);
    res.status(500).json({ ok: false, error: err.message });
  }
});

app.post("/api/scc/asn-lookup", async (req, res) => {
  try {
    const availability = getSccAvailability();
    if (!availability.available) {
      return res.status(503).json({ ok: false, error: availability.issues[0] || 'SCC unavailable' });
    }

    const { asn } = req.body;
    if (!asn || !String(asn).trim()) {
      return res.status(400).json({ ok: false, error: "asn is required" });
    }

    const asnList = String(asn).split(',').map(a => a.trim()).filter(a => a);
    if (asnList.length === 0) {
      return res.status(400).json({ ok: false, error: "valid ASN list required" });
    }

    console.log(`[API] ASN Lookup requested for: ${asnList.join(',')}`);
    clearProgress();
    addProgress('Starting ASN lookup…');
    const result = await lookupAsn(asnList, { onProgress: parseStdoutForProgress, onStep: addProgress });
    res.json({ ok: true, result });
  } catch (err) {
    console.error('[API] ASN Lookup error:', err.message);
    res.status(500).json({ ok: false, error: err.message });
  }
});

// --- SCC Single ASN Booking (localhost only) ---
app.post("/api/scc/booking/create-single", async (req, res) => {
  try {
    const availability = getSccAvailability();
    if (!availability.available) {
      return res.status(503).json({ ok: false, error: availability.issues[0] || 'SCC unavailable' });
    }

    const { asn } = req.body;
    if (!asn || !String(asn).trim()) {
      return res.status(400).json({ ok: false, error: 'asn is required' });
    }

    const asnList = String(asn).split(',').map(a => a.trim()).filter(a => a);
    if (asnList.length === 0) {
      return res.status(400).json({ ok: false, error: 'valid ASN list required' });
    }

    console.log(`[API] Single ASN booking requested for: ${asnList.join(',')}`);
    clearProgress();
    addProgress('Starting single booking creation…');
    const result = await createSingleAsnBooking(asnList, { onProgress: parseStdoutForProgress, onStep: addProgress });
    res.json({ ok: true, result });
  } catch (err) {
    console.error('[API] Single ASN Booking error:', err.message);
    res.status(500).json({ ok: false, error: err.message });
  }
});

// --- SCC Multi-ASN Booking (localhost only) ---
app.post("/api/scc/booking/create-multi", async (req, res) => {
  try {
    const availability = getSccAvailability();
    if (!availability.available) {
      return res.status(503).json({ ok: false, error: availability.issues[0] || 'SCC unavailable' });
    }

    const { asn } = req.body;
    if (!asn || !String(asn).trim()) {
      return res.status(400).json({ ok: false, error: 'asn is required' });
    }

    const asnList = String(asn).split(',').map(a => a.trim()).filter(a => a);
    if (asnList.length === 0) {
      return res.status(400).json({ ok: false, error: 'valid ASN list required' });
    }

    console.log(`[API] Multi-ASN booking requested for: ${asnList.join(',')}`);
    clearProgress();
    addProgress('Starting multi-ASN booking creation…');
    const result = await createMultiAsnBooking(asnList, { onProgress: parseStdoutForProgress, onStep: addProgress });
    res.json({ ok: true, result });
  } catch (err) {
    console.error('[API] Multi-ASN Booking error:', err.message);
    res.status(500).json({ ok: false, error: err.message });
  }
});

// --- Backward-compatible SCC aliases ---
app.post("/api/asn-lookup", async (req, res) => {
  try {
    const { asn } = req.body;
    if (!asn || !String(asn).trim()) return res.status(400).json({ ok: false, error: 'asn is required' });

    const availability = getSccAvailability();
    if (!availability.available) {
      return res.status(503).json({ ok: false, error: availability.issues[0] || 'SCC unavailable' });
    }

    const asnList = String(asn).split(',').map(a => a.trim()).filter(a => a);
    const result = await lookupAsn(asnList);
    res.json({ ok: true, result });
  } catch (err) {
    res.status(500).json({ ok: false, error: err.message });
  }
});

app.post("/api/booking/create-single", async (req, res) => {
  try {
    const { asn } = req.body;
    if (!asn || !String(asn).trim()) return res.status(400).json({ ok: false, error: 'asn is required' });

    const availability = getSccAvailability();
    if (!availability.available) {
      return res.status(503).json({ ok: false, error: availability.issues[0] || 'SCC unavailable' });
    }

    const asnList = String(asn).split(',').map(a => a.trim()).filter(a => a);
    const result = await createSingleAsnBooking(asnList);
    res.json({ ok: true, result });
  } catch (err) {
    res.status(500).json({ ok: false, error: err.message });
  }
});

app.post("/api/booking/create-multi", async (req, res) => {
  try {
    const { asn } = req.body;
    if (!asn || !String(asn).trim()) return res.status(400).json({ ok: false, error: 'asn is required' });

    const availability = getSccAvailability();
    if (!availability.available) {
      return res.status(503).json({ ok: false, error: availability.issues[0] || 'SCC unavailable' });
    }

    const asnList = String(asn).split(',').map(a => a.trim()).filter(a => a);
    const result = await createMultiAsnBooking(asnList);
    res.json({ ok: true, result });
  } catch (err) {
    res.status(500).json({ ok: false, error: err.message });
  }
});

// --- Full SCC Flow (localhost automation) ---
app.post("/api/full-scc-flow", async (req, res) => {
  try {
    const availability = getSccAvailability();
    if (!availability.available) {
      return res.status(503).json({ ok: false, error: availability.issues[0] || 'SCC unavailable' });
    }

    const { asn } = req.body;
    if (!asn || !String(asn).trim()) {
      return res.status(400).json({ ok: false, error: 'asn is required' });
    }

    const asnList = String(asn).split(',').map(a => a.trim()).filter(a => a);
    if (asnList.length === 0) {
      return res.status(400).json({ ok: false, error: 'valid ASN list required' });
    }

    console.log(`[API] Full SCC flow requested for: ${asnList.join(',')}`);
    clearProgress();
    addProgress('Starting full SCC flow…');
    const result = await createFullSccFlow(asnList, { onProgress: parseStdoutForProgress, onStep: addProgress });
    res.json({ ok: true, result });
  } catch (err) {
    console.error('[API] Full SCC Flow error:', err.message);
    res.status(500).json({ ok: false, error: err.message });
  }
});

app.post("/api/cancel", (req, res) => {
  const killed = cancelActiveSpec();
  clearProgress();
  addProgress('⛔ Operation cancelled by user.');
  res.json({ ok: true, message: killed ? 'Playwright process killed' : 'Nothing running' });
});

// ADO Email Report (enabled when config and env are valid)
const { sendAdoReportEmail, sendEditedAdoReportEmail, getAdoAvailability, generateAdoReportHtml } = require("./ado-email");

// ── ADO Bug Creation ──────────────────────────────────────────────────────────
const { suggestPriorityAndSeverity, suggestReproSteps, suggestTitle, suggestAssignee } = require("./ado-bug-suggester");
const { createAdoBug } = require("./ado-bug-creator");

// Suggest title, priority, severity, and repro steps from description
app.post("/api/ado/suggest-fields", async (req, res) => {
  try {
    const { title = "", description = "" } = req.body || {};
    const { priority, severity } = suggestPriorityAndSeverity(title || description, description);
    const assignee = suggestAssignee(description);
    const [reproSteps, suggestedTitle] = await Promise.all([
      suggestReproSteps(title || description, description),
      title ? Promise.resolve(null) : suggestTitle(description),
    ]);
    res.json({ ok: true, title: suggestedTitle, priority, severity, assignee, reproSteps });
  } catch (e) {
    res.status(500).json({ ok: false, error: e.message });
  }
});

// Create a Bug work item in ADO
app.post("/api/ado/create-bug", async (req, res) => {
  try {
    const {
      title,
      areaPath,
      iterationPath,
      assignedTo,
      reproSteps,
      priority,
      severity,
      testCaseId,
      discoveredInEnvironment,
    } = req.body || {};

    if (!title || !String(title).trim()) {
      return res.status(400).json({ ok: false, error: "Bug title is required." });
    }

    const result = await createAdoBug({
      title,
      areaPath,
      iterationPath,
      assignedTo,
      reproSteps,
      priority,
      severity,
      testCaseId,
      discoveredInEnvironment,
    });

    res.json({ ok: true, id: result.id, url: result.url });
  } catch (e) {
    res.status(500).json({ ok: false, error: e.message });
  }
});

app.get("/api/ado-status", (req, res) => {
  res.json(getAdoAvailability());
});

app.post("/api/preview-status-email", async (req, res) => {
  try {
    const report = await generateAdoReportHtml();
    res.json({ ok: true, html: report.html, subject: report.subject, summary: report.summary });
  } catch (e) {
    res.status(500).json({ ok: false, error: e.message });
  }
});

app.post("/api/send-status-email", async (req, res) => {
  try {
    const { html, subject } = req.body || {};
    const result = await sendAdoReportEmail({ htmlOverride: html, subjectOverride: subject });
    res.json({ ok: true, message: "ADO status email sent.", transport: result.transport });
  } catch (e) {
    res.status(500).json({ ok: false, error: e.message });
  }
});

app.post("/api/send-edited-email", async (req, res) => {
  try {
    const { html, subject } = req.body || {};
    const result = await sendEditedAdoReportEmail({ html, subjectOverride: subject });
    res.json({
      ok: true,
      message: "Edited ADO status email sent.",
      transport: result.transport,
      savedPath: result.savedPath,
      subject: result.subject,
    });
  } catch (e) {
    res.status(500).json({ ok: false, error: e.message });
  }
});

// ── Start ─────────────────────────────────────────────────────────────────────

// Safety net: log unhandled errors without crashing the server
process.on("uncaughtException", (err) => {
  console.error("[uncaughtException]", err.message);
});
process.on("unhandledRejection", (reason) => {
  console.error("[unhandledRejection]", reason);
});

const server = app.listen(PORT, () => {
  console.log(`\nQA Support Kit  →  http://localhost:${PORT}\n`);
});

// Allow long-running requests — skip on iisnode (named pipe)
if (typeof PORT === "number" || /^\d+$/.test(PORT)) {
  server.timeout = 0;
  server.requestTimeout = 0;
  server.headersTimeout = 0;
  server.keepAliveTimeout = 620000;
}
