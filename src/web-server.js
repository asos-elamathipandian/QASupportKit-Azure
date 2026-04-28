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
const { buildSftpConfigFromEnv } = require("./sftp-config");
const { searchBlobsByAsn, searchBlobsByAsnNameAndContent, downloadBlobs } = require("./blob-search");
const {
  getAbvCounterFile,
  getCarrierSequenceFile,
  getOutputDir,
  getStateDir,
  loadEnvironment,
} = require("./app-config");

loadEnvironment();

// Ensure required directories exist (they are gitignored so won't be present on Azure)
[getOutputDir(process.env), getStateDir(process.env)].forEach((dir) => {
  console.log("[STARTUP] Ensuring dir:", dir);
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
});

const app = express();
app.use(express.json());
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

// ── Individual endpoints ──────────────────────────────────────────────────────

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
    const remotePath = await upload(gen.filePath);
    res.json({ ok: true, fileName: gen.fileName, uploaded: true, remotePath });
  } catch (e) {
    res.status(500).json({ ok: false, error: e.message });
  }
});

app.post("/api/generate/bst", async (req, res) => {
  const err = validate(req.body, ["asn", "carrier"]);
  if (err) return res.status(400).json({ ok: false, error: err });
  try {
    const { asn, carrier } = req.body;
    const outputDir = getOutputDir(process.env);
    const gen = await writeBulkStatusFile({ asn, carrier, outputDir });
    const remotePath = await upload(gen.filePath);
    res.json({ ok: true, fileName: gen.fileName, uploaded: true, remotePath });
  } catch (e) {
    res.status(500).json({ ok: false, error: e.message });
  }
});

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
    const remotePath = await upload(gen.filePath);
    res.json({
      ok: true,
      fileName: gen.fileName,
      uploaded: true,
      remotePath,
      sequence: gen.sequence,
    });
  } catch (e) {
    res.status(500).json({ ok: false, error: e.message });
  }
});

app.post("/api/generate/asn-fcbkc", async (req, res) => {
  const err = validate(req.body, ["asn"]);
  if (err) return res.status(400).json({ ok: false, error: err });
  try {
    const { asn } = req.body;
    const outputDir = getOutputDir(process.env);
    const gen = await writeAsnFcbkcFile({ asn, outputDir });
    const remotePath = await upload(gen.filePath);
    res.json({ ok: true, fileName: gen.fileName, uploaded: true, remotePath });
  } catch (e) {
    res.status(500).json({ ok: false, error: e.message });
  }
});

app.post("/api/generate/asn-rcv", async (req, res) => {
  const err = validate(req.body, ["asn"]);
  if (err) return res.status(400).json({ ok: false, error: err });
  try {
    const { asn } = req.body;
    const outputDir = getOutputDir(process.env);
    const gen = await writeAsnRcvFile({ asn, outputDir });
    const remotePath = await upload(gen.filePath);
    res.json({ ok: true, fileName: gen.fileName, uploaded: true, remotePath });
  } catch (e) {
    res.status(500).json({ ok: false, error: e.message });
  }
});

app.post("/api/generate/asn-padex", async (req, res) => {
  const err = validate(req.body, ["asn", "po", "sku"]);
  if (err) return res.status(400).json({ ok: false, error: err });
  try {
    const { asn, po, sku, skuQty = "1" } = req.body;
    const outputDir = getOutputDir(process.env);
    const gen = await writeAsnPadexFile({ asn, po, sku, skuQty, outputDir });
    const remotePath = await upload(gen.filePath);
    res.json({ ok: true, fileName: gen.fileName, uploaded: true, remotePath });
  } catch (e) {
    res.status(500).json({ ok: false, error: e.message });
  }
});

app.post("/api/generate/asn-feed", async (req, res) => {
  const err = validate(req.body, ["asn", "po", "sku"]);
  if (err) return res.status(400).json({ ok: false, error: err });
  try {
    const { asn, po, sku, skuQty = "1" } = req.body;
    const outputDir = getOutputDir(process.env);
    const gen = await writeAsnFeedFile({ asn, po, sku, skuQty, outputDir });
    const remotePath = await upload(gen.filePath);
    res.json({ ok: true, fileName: gen.fileName, uploaded: true, remotePath });
  } catch (e) {
    res.status(500).json({ ok: false, error: e.message });
  }
});

app.post("/api/generate/gpm", async (req, res) => {
  const err = validate(req.body, ["sku", "optionId"]);
  if (err) return res.status(400).json({ ok: false, error: err });
  try {
    const { sku, optionId } = req.body;
    const outputDir = getOutputDir(process.env);
    const gen = await writeGpmFile({ sku, optionId, outputDir });

    // Multiple SKUs → multiple files
    if (gen.files) {
      const uploaded = [];
      for (const f of gen.files) {
        const remotePath = await upload(f.filePath);
        uploaded.push({ fileName: f.fileName, sku: f.sku, uploaded: true, remotePath });
      }
      return res.json({ ok: true, files: uploaded });
    }

    // Single SKU
    const remotePath = await upload(gen.filePath);
    res.json({ ok: true, fileName: gen.fileName, uploaded: true, remotePath });
  } catch (e) {
    res.status(500).json({ ok: false, error: e.message });
  }
});

app.post("/api/generate/po-feed", async (req, res) => {
  const err = validate(req.body, ["po", "sku", "optionId"]);
  if (err) return res.status(400).json({ ok: false, error: err });
  try {
    const { po, sku, skuQty = "1", optionId, carrier = "DT" } = req.body;
    const outputDir = getOutputDir(process.env);
    const gen = await writePoFeedFile({ po, sku, skuQty, optionId, carrier, outputDir });
    const remotePath = await upload(gen.filePath);
    res.json({ ok: true, fileName: gen.fileName, uploaded: true, remotePath });
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

// ── Local-only feature stubs (return disabled status for UI) ──────────────────

app.post("/api/asn-lookup", (req, res) => {
  res.json({ ok: false, error: "ASN Lookup is only available on the local version (requires Playwright browser)." });
});

app.post("/api/booking/create-single", (req, res) => {
  res.json({ ok: false, error: "Carrier Booking is only available on the local version (requires Playwright browser)." });
});

app.post("/api/booking/create-multi", (req, res) => {
  res.json({ ok: false, error: "Carrier Booking is only available on the local version (requires Playwright browser)." });
});

app.post("/api/full-scc-flow", (req, res) => {
  res.json({ ok: false, error: "Full SCC Flow is only available on the local version (requires Playwright browser)." });
});

app.get("/api/progress", (req, res) => {
  res.json({ entries: [], total: 0 });
});

app.post("/api/cancel", (req, res) => {
  res.json({ ok: true, message: "Nothing running" });
});

app.get("/api/ado-status", (req, res) => {
  res.json({ available: false });
});

app.post("/api/preview-status-email", (req, res) => {
  res.json({ ok: false, error: "ADO Email is only available on the local version." });
});

app.post("/api/send-status-email", (req, res) => {
  res.json({ ok: false, error: "ADO Email is only available on the local version." });
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
