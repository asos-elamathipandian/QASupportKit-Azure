const path = require("path");
const Client = require("ssh2-sftp-client");

async function uploadFileToSftp({
  localFilePath,
  remoteDir,
  connectionOptions,
}) {
  const sftp = new Client();
  const remotePath = `${remoteDir.replace(/\/$/, "")}/${path.basename(localFilePath)}`;

  try {
    await sftp.connect(connectionOptions);

    await sftp.put(localFilePath, remotePath);
    return { remotePath };
  } finally {
    await sftp.end();
  }
}

module.exports = {
  uploadFileToSftp,
};
