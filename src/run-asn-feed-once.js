const { writeAsnFeedFile } = require("./asn-feed");
const { uploadFileToSftp } = require("./sftp");
const { buildSftpConfigFromEnv } = require("./sftp-config");
const { getOutputDir, loadEnvironment, loadInputsFile } = require("./app-config");

loadEnvironment();

async function main() {
  const args = process.argv.slice(2).filter(a => a !== "--no-upload");
  const noUpload = process.argv.includes("--no-upload");
  let [sku, po, skuQty] = args;

  if (!sku || !po) {
    const inputs = loadInputsFile();
    sku = sku || inputs.sku;
    po = po || inputs.po;
    skuQty = skuQty || inputs.skuQty || "1";
  }

  if (!sku || !po) {
    throw new Error(
      "Usage: node src/run-asn-feed-once.js [SKU] [PO] [SKU_QTY] [--no-upload]\n" +
      "  Or set sku, po, skuQty in config/inputs.json"
    );
  }

  const inputs = loadInputsFile();
  const asn = inputs.asn;
  if (!asn) {
    throw new Error("asn is required in config/inputs.json");
  }

  skuQty = skuQty || "1";
  const outputDir = getOutputDir(process.env);

  const generated = await writeAsnFeedFile({
    asn,
    po,
    sku,
    skuQty,
    outputDir,
  });

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
