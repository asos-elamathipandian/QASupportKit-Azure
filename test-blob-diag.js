"use strict";
// Diagnostic: use actual searchBlobsByAsn function to test ASN 42170000001978

const { searchBlobsByAsn } = require("./src/blob-search");

const asn = "42170000001978";
const connectionString = process.env.AZURE_BLOB_CONNECTION_STRING;
const containerName = process.env.AZURE_BLOB_CONTAINER || "sftp-inbound";

if (!connectionString) {
  console.error("AZURE_BLOB_CONNECTION_STRING not set");
  process.exit(1);
}

(async () => {
  console.log(`Searching for ASN: ${asn} in container: ${containerName}`);
  console.log(`hoursBack=1440 (60 days)\n`);
  const start = Date.now();
  const result = await searchBlobsByAsn({ asn, connectionString, containerName, hoursBack: 1440, maxBlobs: 1000 });
  const elapsed = ((Date.now() - start) / 1000).toFixed(1);
  console.log(`\nDone in ${elapsed}s`);
  console.log(`Scanned: ${result.scanned}, Skipped: ${result.skipped}, Matches: ${result.matches.length}`);
  result.matches.forEach(m => console.log(`  MATCH: ${m.name} (${m.lastModified})`));
})().catch(err => {
  console.error("Error:", err.message);
  process.exit(1);
});
