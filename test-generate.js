/**
 * Quick local test: generate all updated XML messages using inputs.example.json
 */
const path = require("path");
const inputs = require("./config/inputs.example.json");

const { writeAsnFeedFile } = require("./src/asn-feed");
const { writeAsnPadexFile } = require("./src/asn-padex");
const { writePoFeedFile } = require("./src/po-feed");
const { writeVbkconFile } = require("./src/vbkcon");
const { writeBulkStatusFile } = require("./src/bulk-status");

const outputDir = path.join(__dirname, "output", "test-run");

async function main() {
  const { asn, po, sku, skuQty, ace, carrier } = inputs;

  console.log("=== Generating XMLs with inputs.example.json ===\n");
  console.log("Inputs:", JSON.stringify(inputs, null, 2), "\n");

  // 1. ASN Feed
  const asnFeed = await writeAsnFeedFile({ asn, po, sku, skuQty, outputDir });
  console.log("[ASN Feed]", asnFeed.fileName);
  console.log(asnFeed.xmlContent, "\n");

  // 2. ASN Padex
  const asnPadex = await writeAsnPadexFile({ asn, po, sku, skuQty, outputDir });
  console.log("[ASN Padex]", asnPadex.fileName);
  console.log(asnPadex.xmlContent, "\n");

  // 3. PO Feed
  const poFeed = await writePoFeedFile({ po, sku, skuQty, optionId: "OPT001", carrier, outputDir });
  console.log("[PO Feed]", poFeed.fileName);
  console.log(poFeed.xmlContent, "\n");

  // 4. VBKCON
  const vbkcon = await writeVbkconFile({ ace, carrier, outputDir, abvCounterFile: path.join(outputDir, "abv-counter.json") });
  console.log("[VBKCON]", vbkcon.fileName);
  console.log(vbkcon.xmlContent, "\n");

  // 5. Bulk Status
  const bulkStatus = await writeBulkStatusFile({ asn, carrier, outputDir });
  console.log("[Bulk Status]", bulkStatus.fileName);
  console.log(bulkStatus.xmlContent, "\n");

  console.log("=== All files written to:", outputDir, "===");
}

main().catch(console.error);
