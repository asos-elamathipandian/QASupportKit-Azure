const { writeGpmFile } = require("./gpm");
const { uploadFileToSftp } = require("./sftp");
const { buildSftpConfigFromEnv } = require("./sftp-config");
const { getOutputDir, loadEnvironment, loadInputsFile } = require("./app-config");

loadEnvironment();

async function main() {
  const args = process.argv.slice(2).filter(a => a !== "--no-upload");
  const noUpload = process.argv.includes("--no-upload");
  let [sku, optionId] = args;

  if (!sku) {
    const inputs = loadInputsFile();
    sku = inputs.sku;
    optionId = optionId || inputs.optionId;
  }

  if (!sku || !optionId) {
    throw new Error(
      "Usage: node src/run-gpm-once.js <SKU> <OPTION_ID> [--no-upload]\n" +
      "  Or set sku, optionId in config/inputs.json"
    );
  }

  const outputDir = getOutputDir(process.env);

  const generated = await writeGpmFile({ sku, optionId, outputDir });

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
