const { writeCarrierShipmentFile } = require("./carrier-shipment");
const { uploadFileToSftp } = require("./sftp");
const { buildSftpConfigFromEnv } = require("./sftp-config");
const {
  getCarrierSequenceFile,
  getOutputDir,
  loadEnvironment,
  loadInputsFile,
} = require("./app-config");

loadEnvironment();

async function main() {
  const args = process.argv.slice(2).filter(a => a !== "--no-upload");
  const noUpload = process.argv.includes("--no-upload");
  let [asn, po, sku, skuQty, carrier] = args;

  if (!asn || !po || !sku) {
    const inputs = loadInputsFile();
    asn = asn || inputs.asn;
    po  = po  || inputs.po;
    sku = sku || inputs.sku;
    skuQty = skuQty || inputs.skuQty;
    carrier = carrier || inputs.carrier;
  }

  if (!asn || !po || !sku) {
    throw new Error(
      "Usage: node src/run-shipment-once.js <ASN> <PO> <SKU> [<SKU_QTY>] [<CARRIER>] [--no-upload]\n" +
      "  Or set asn, po, sku, skuQty, and carrier in config/inputs.json"
    );
  }

  const outputDir = getOutputDir(process.env);

  const generated = await writeCarrierShipmentFile({
    asn,
    po,
    sku,
    skuQty,
    carrier,
    outputDir,
    sequenceFile: getCarrierSequenceFile(process.env),
  });

  const result = {
    ok: true,
    fileName: generated.fileName,
    filePath: generated.filePath,
    sequence: generated.sequence,
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
