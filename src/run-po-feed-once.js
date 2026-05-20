const { writePoFeedFile } = require("./po-feed");
const { uploadFileToSftp } = require("./sftp");
const { buildSftpConfigFromEnv } = require("./sftp-config");
const { getOutputDir, loadEnvironment, loadInputsFile } = require("./app-config");

loadEnvironment();

async function main() {
  const args = process.argv.slice(2).filter(a => a !== "--no-upload");
  const noUpload = process.argv.includes("--no-upload");
  let [po, sku, skuQty, carrier] = args;

  if (!po || !sku) {
    const inputs = loadInputsFile();
    po = po || inputs.po;
    sku = sku || inputs.sku;
    skuQty = skuQty || inputs.skuQty || "1";
    carrier = carrier || inputs.carrier || "DT";
  }

  if (!po || !sku) {
    throw new Error(
      "Usage: node src/run-po-feed-once.js [PO] [SKU] [SKU_QTY] [CARRIER] [--no-upload]\n" +
      "  Or set po, sku, skuQty, carrier in config/inputs.json"
    );
  }

  skuQty = skuQty || "1";
  carrier = carrier || "DT";
  const outputDir = getOutputDir(process.env);

  const generated = await writePoFeedFile({ po, sku, skuQty, carrier, outputDir });

  const result = {
    ok: true,
    fileName: generated.fileName,
    filePath: generated.filePath,
    uploaded: false,
  };

  if (!noUpload) {
    const sftpConfig = buildSftpConfigFromEnv(process.env);

    const uploadResult = await uploadFileToSftp({
      localFilePath: generated.filePath,
      remoteDir: sftpConfig.remoteDir,
      connectionOptions: sftpConfig.connectionOptions,
    });

    result.uploaded = true;
    result.remotePath = uploadResult.remotePath;
  }

  console.log(JSON.stringify(result, null, 2));
}

main().catch((error) => {
  console.error("Error:", error.message);
  process.exit(1);
});
