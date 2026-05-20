const { writeVbkconFile } = require("./vbkcon");
const { uploadFileToSftp } = require("./sftp");
const { buildSftpConfigFromEnv } = require("./sftp-config");
const {
  getAbvCounterFile,
  getOutputDir,
  loadEnvironment,
  loadInputsFile,
} = require("./app-config");

loadEnvironment();

async function main() {
  const args = process.argv.slice(2).filter(a => a !== "--no-upload");
  const noUpload = process.argv.includes("--no-upload");
  let [ace, carrier] = args;

  if (!ace) {
    const inputs = loadInputsFile();
    ace = inputs.ace;
    carrier = carrier || inputs.carrier;
  }

  if (!ace) {
    throw new Error(
      "Usage: node src/run-once.js <ACE> [<CARRIER>] [--no-upload]\n" +
      "  Or set ace and carrier in config/inputs.json"
    );
  }

  const outputDir = getOutputDir(process.env);

  const generated = await writeVbkconFile({
    ace,
    carrier,
    outputDir,
    abvCounterFile: getAbvCounterFile(process.env),
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
