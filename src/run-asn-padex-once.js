const { writeAsnPadexFile } = require("./asn-padex");
const { uploadFileToSftp } = require("./sftp");
const { buildSftpConfigFromEnv } = require("./sftp-config");
const {
  getOutputDir,
  loadEnvironment,
  loadInputsFile,
} = require("./app-config");

loadEnvironment();

async function main() {
  const args = process.argv.slice(2).filter(a => a !== "--no-upload");
  const noUpload = process.argv.includes("--no-upload");
  let [asn, po, sku, skuQty] = args;

  if (!asn || !po || !sku) {
    const inputs = loadInputsFile();
    asn = asn || inputs.asn;
    po  = po  || inputs.po;
    sku = sku || inputs.sku;
    skuQty = skuQty || inputs.skuQty;
  }

  if (!asn || !po || !sku) {
    throw new Error(
      "Usage: node src/run-asn-padex-once.js <ASN> <PO> <SKU> [<SKU_QTY>] [--no-upload]\n" +
      "  Or set asn, po, sku, and skuQty in config/inputs.json"
    );
  }

  const outputDir = getOutputDir(process.env);

  const generated = await writeAsnPadexFile({
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

  process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
}

main().catch((error) => {
  process.stderr.write(`${error.message}\n`);
  process.exit(1);
});
