"use strict";

const { BlobServiceClient } = require("@azure/storage-blob");

/**
 * Search Azure Blob Storage for XML files containing a given ASN in their content.
 *
 * @param {object} opts
 * @param {string} opts.asn            - ASN reference to search for inside XML content
 * @param {string} opts.connectionString - Azure Storage connection string (from env)
 * @param {string} opts.containerName  - Blob container name
 * @param {number} [opts.maxBlobs=200] - Max blobs to scan (newest first)
 * @param {string} [opts.prefix]       - Optional blob name prefix filter
 * @param {number} [opts.hoursBack=48] - Only scan blobs modified within this many hours
 * @returns {Promise<{matches: Array, scanned: number, skipped: number}>}
 */
async function searchBlobsByAsn({
  asn,
  connectionString,
  containerName,
  maxBlobs = 200,
  prefix,
  hoursBack = 48,
}) {
  const blobServiceClient = BlobServiceClient.fromConnectionString(connectionString);
  const containerClient = blobServiceClient.getContainerClient(containerName);

  const cutoff = new Date(Date.now() - hoursBack * 60 * 60 * 1000);
  const matches = [];
  let scanned = 0;
  let skipped = 0;

  // Build date-based prefixes to avoid scanning the entire container.
  // Blobs are stored as IN/YYYY/MM/DD/filename.xml
  // Reverse order: newest dates first so recent blobs are prioritised.
  const datePrefixes = [];
  const d = new Date(cutoff);
  while (d <= new Date()) {
    const ymd = `IN/${d.getUTCFullYear()}/${String(d.getUTCMonth() + 1).padStart(2, "0")}/${String(d.getUTCDate()).padStart(2, "0")}/`;
    datePrefixes.push(ymd);
    d.setUTCDate(d.getUTCDate() + 1);
  }
  datePrefixes.reverse();

  // Collect blobs from each date prefix
  const blobs = [];
  for (const datePrefix of datePrefixes) {
    const effectivePrefix = prefix ? `${datePrefix}${prefix}` : datePrefix;
    for await (const blob of containerClient.listBlobsFlat({ prefix: effectivePrefix })) {
      if (!blob.name.endsWith(".xml") && !blob.name.endsWith(".XML")) {
        skipped++;
        continue;
      }
      blobs.push(blob);
      if (blobs.length >= maxBlobs) break;
    }
    if (blobs.length >= maxBlobs) break;
  }

  // Download and search content in parallel (batches of 10)
  const BATCH_SIZE = 10;
  for (let i = 0; i < blobs.length; i += BATCH_SIZE) {
    const batch = blobs.slice(i, i + BATCH_SIZE);
    const results = await Promise.all(
      batch.map(async (blob) => {
        scanned++;
        try {
          const blobClient = containerClient.getBlobClient(blob.name);
          const downloadResponse = await blobClient.download(0);
          const content = await streamToString(downloadResponse.readableStreamBody);

          if (content.includes(asn)) {
            // Generate a SAS-free download URL (the connection string already has SAS)
            const url = blobClient.url;
            return {
              name: blob.name,
              size: blob.properties.contentLength,
              lastModified: blob.properties.lastModified?.toISOString(),
              url,
            };
          }
        } catch (err) {
          // Skip blobs that fail to download
          console.error(`[blob-search] Failed to read ${blob.name}: ${err.message}`);
        }
        return null;
      })
    );
    matches.push(...results.filter(Boolean));
  }

  return { matches, scanned, skipped };
}

async function streamToString(readableStream) {
  const chunks = [];
  for await (const chunk of readableStream) {
    chunks.push(typeof chunk === "string" ? Buffer.from(chunk) : chunk);
  }
  return Buffer.concat(chunks).toString("utf8");
}

/**
 * Download specific blobs by name to a local directory.
 *
 * @param {object} opts
 * @param {string[]} opts.blobNames       - Full blob paths (e.g. "IN/2026/04/23/file.xml")
 * @param {string}   opts.connectionString - Azure Storage connection string
 * @param {string}   opts.containerName    - Blob container name
 * @param {string}   opts.outputDir        - Local directory to save files into
 * @returns {Promise<{downloaded: string[], failed: Array<{name: string, error: string}>}>}
 */
async function downloadBlobs({ blobNames, connectionString, containerName, outputDir }) {
  const fs = require("fs");
  const path = require("path");

  if (!fs.existsSync(outputDir)) {
    fs.mkdirSync(outputDir, { recursive: true });
  }

  const blobServiceClient = BlobServiceClient.fromConnectionString(connectionString);
  const containerClient = blobServiceClient.getContainerClient(containerName);

  const downloaded = [];
  const failed = [];

  for (const blobName of blobNames) {
    try {
      const blobClient = containerClient.getBlobClient(blobName);
      const downloadResponse = await blobClient.download(0);
      const content = await streamToString(downloadResponse.readableStreamBody);

      // Use just the filename, not the full path
      const fileName = path.basename(blobName);
      const localPath = path.join(outputDir, fileName);
      fs.writeFileSync(localPath, content, "utf8");
      downloaded.push(localPath);
    } catch (err) {
      failed.push({ name: blobName, error: err.message });
    }
  }

  return { downloaded, failed };
}

module.exports = { searchBlobsByAsn, searchBlobsByAsnNameAndContent, searchBlobsByPoNameAndContent, downloadBlobs };

/**
 * Search Azure Blob Storage for XML files where the ASN appears in BOTH
 * the blob file name AND the file content.
 */
async function searchBlobsByAsnNameAndContent({
  asn,
  connectionString,
  containerName,
  maxBlobs = 500,
  hoursBack = 1440,
}) {
  const blobServiceClient = BlobServiceClient.fromConnectionString(connectionString);
  const containerClient = blobServiceClient.getContainerClient(containerName);

  const cutoff = new Date(Date.now() - hoursBack * 60 * 60 * 1000);
  const matches = [];
  let scanned = 0;
  let skipped = 0;

  // Collect blobs whose name contains the ASN
  const blobs = [];
  for await (const blob of containerClient.listBlobsFlat()) {
    if (!blob.name.includes(asn)) {
      skipped++;
      continue;
    }
    if (!blob.name.endsWith(".xml") && !blob.name.endsWith(".XML")) {
      skipped++;
      continue;
    }
    if (blob.properties.lastModified && blob.properties.lastModified < cutoff) {
      skipped++;
      continue;
    }
    blobs.push(blob);
    if (blobs.length >= maxBlobs) break;
  }

  // Download and verify ASN also appears in content (batches of 10)
  const BATCH_SIZE = 10;
  for (let i = 0; i < blobs.length; i += BATCH_SIZE) {
    const batch = blobs.slice(i, i + BATCH_SIZE);
    const results = await Promise.all(
      batch.map(async (blob) => {
        scanned++;
        try {
          const blobClient = containerClient.getBlobClient(blob.name);
          const downloadResponse = await blobClient.download(0);
          const content = await streamToString(downloadResponse.readableStreamBody);

          if (content.includes(asn)) {
            return {
              name: blob.name,
              size: blob.properties.contentLength,
              lastModified: blob.properties.lastModified?.toISOString(),
              url: blobClient.url,
            };
          }
        } catch (err) {
          console.error(`[blob-search-asn] Failed to read ${blob.name}: ${err.message}`);
        }
        return null;
      })
    );
    matches.push(...results.filter(Boolean));
  }

  return { matches, scanned, skipped };
}

/**
 * Search Azure Blob Storage for XML files where the PO appears in BOTH
 * the blob file name AND the file content.
 * Blobs are stored under aimpurchaseorder/YYYY/MM/DD/
 */
async function searchBlobsByPoNameAndContent({
  po,
  connectionString,
  containerName,
  maxBlobs = 500,
  hoursBack = 1440,
}) {
  const blobServiceClient = BlobServiceClient.fromConnectionString(connectionString);
  const containerClient = blobServiceClient.getContainerClient(containerName);

  const cutoff = new Date(Date.now() - hoursBack * 60 * 60 * 1000);
  const matches = [];
  let scanned = 0;
  let skipped = 0;

  // Build date-based prefixes: aimpurchaseorder/YYYY/MM/DD/
  const datePrefixes = [];
  const d = new Date(cutoff);
  while (d <= new Date()) {
    const ymd = `aimpurchaseorder/${d.getUTCFullYear()}/${String(d.getUTCMonth() + 1).padStart(2, "0")}/${String(d.getUTCDate()).padStart(2, "0")}/`;
    datePrefixes.push(ymd);
    d.setUTCDate(d.getUTCDate() + 1);
  }
  datePrefixes.reverse();

  // Collect blobs whose name contains the PO
  const blobs = [];
  for (const datePrefix of datePrefixes) {
    for await (const blob of containerClient.listBlobsFlat({ prefix: datePrefix })) {
      if (!blob.name.includes(po)) {
        skipped++;
        continue;
      }
      if (!blob.name.endsWith(".xml") && !blob.name.endsWith(".XML")) {
        skipped++;
        continue;
      }
      blobs.push(blob);
      if (blobs.length >= maxBlobs) break;
    }
    if (blobs.length >= maxBlobs) break;
  }

  // Download and verify PO also appears in content (batches of 10)
  const BATCH_SIZE = 10;
  for (let i = 0; i < blobs.length; i += BATCH_SIZE) {
    const batch = blobs.slice(i, i + BATCH_SIZE);
    const results = await Promise.all(
      batch.map(async (blob) => {
        scanned++;
        try {
          const blobClient = containerClient.getBlobClient(blob.name);
          const downloadResponse = await blobClient.download(0);
          const content = await streamToString(downloadResponse.readableStreamBody);

          if (content.includes(po)) {
            return {
              name: blob.name,
              size: blob.properties.contentLength,
              lastModified: blob.properties.lastModified?.toISOString(),
              url: blobClient.url,
            };
          }
        } catch (err) {
          console.error(`[blob-search-po] Failed to read ${blob.name}: ${err.message}`);
        }
        return null;
      })
    );
    matches.push(...results.filter(Boolean));
  }

  return { matches, scanned, skipped };
}
