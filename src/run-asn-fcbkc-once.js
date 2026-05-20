const { writeAsnFcbkcFile } = require("./asn-fcbkc");
const { uploadFileToSftp } = require("./sftp");
const { buildSftpConfigFromEnv } = require("./sftp-config");
const { getOutputDir, loadEnvironment, loadInputsFile } = require("./app-config");

loadEnvironment();

async function main() {
  const args = process.argv.slice(2).filter(a => a !== "--no-upload");
  const noUpload = process.argv.includes("--no-upload");
  let [asn] = args;

  if (!asn) {
    const inputs = loadInputsFile();
    asn = inputs.asn;
  }

  if (!asn) {
    throw new Error(
      "Usage: node src/run-asn-fcbkc-once.js <ASN> [--no-upload]\n" +
      "  Or set asn in config/inputs.json"
    );
  }

  const outputDir = getOutputDir(process.env);
  const generated = await writeAsnFcbkcFile({ asn, outputDir });

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
