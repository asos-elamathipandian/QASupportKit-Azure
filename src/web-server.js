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
const { searchBlobsByAsn, searchBlobsByAsnNameAndContent, searchBlobsByPoNameAndContent, searchBlobsCarrierFeedByAsn, downloadBlobs } = require("./blob-search");
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

// --- Cloud-enabled ASN Lookup ---
app.post("/api/asn-lookup", (req, res) => {
  const { asn } = req.body;
  // TODO: Implement real cloud lookup logic here
  if (!asn || !asn.trim()) return res.status(400).json({ ok: false, error: "asn is required" });
  res.json({ ok: true, result: `Lookup for ASN(s): ${asn} (cloud placeholder)` });
});

// --- Cloud-enabled Carrier Booking ---
app.post("/api/booking/create-single", (req, res) => {
  const { asn } = req.body;
  // TODO: Implement real cloud booking logic here
  if (!asn || !asn.trim()) return res.status(400).json({ ok: false, error: "asn is required" });
  res.json({ ok: true, result: `Single booking created for ASN(s): ${asn} (cloud placeholder)` });
});

app.post("/api/booking/create-multi", (req, res) => {
  const { asn } = req.body;
  // TODO: Implement real cloud multi-booking logic here
  if (!asn || !asn.trim()) return res.status(400).json({ ok: false, error: "asn is required" });
  res.json({ ok: true, result: `Multi-ASN booking created for ASN(s): ${asn} (cloud placeholder)` });
});

// --- Cloud-enabled Full SCC Flow ---
app.post("/api/full-scc-flow", (req, res) => {
  const { asn } = req.body;
  // TODO: Implement real cloud full SCC flow logic here
  if (!asn || !asn.trim()) return res.status(400).json({ ok: false, error: "asn is required" });
  res.json({ ok: true, result: `Full SCC flow completed for ASN(s): ${asn} (cloud placeholder)` });
});

app.get("/api/progress", (req, res) => {
  res.json({ entries: [], total: 0 });
});

app.post("/api/cancel", (req, res) => {
  res.json({ ok: true, message: "Nothing running" });
});

// ADO Email Report (enabled when config and env are valid)
const { sendAdoReportEmail, getAdoAvailability, generateAdoReportHtml } = require("./ado-email");

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
