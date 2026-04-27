const fs = require("fs");
const path = require("path");

function buildSftpConfigFromEnv(env) {
  const host = env.SFTP_HOST;
  const port = Number(env.SFTP_PORT || "22");
  const username = env.SFTP_USERNAME;
  const remoteDir = env.SFTP_REMOTE_DIR;

  const privateKeyPath = env.SFTP_PRIVATE_KEY_PATH;
  const passphrase = env.SFTP_PASSPHRASE;
  const password = env.SFTP_PASSWORD;

  if (!host || !username || !remoteDir) {
    throw new Error(
      "SFTP config missing. Set SFTP_HOST, SFTP_USERNAME and SFTP_REMOTE_DIR"
    );
  }

  const connectionOptions = {
    host,
    port,
    username,
    readyTimeout: 30000,
  };

  if (privateKeyPath) {
    const absoluteKeyPath = path.resolve(privateKeyPath);
    connectionOptions.privateKey = fs.readFileSync(absoluteKeyPath, "utf8");
    if (passphrase) {
      connectionOptions.passphrase = passphrase;
    }
  } else if (env.SFTP_PRIVATE_KEY_CONTENT) {
    // Support inline key content (for Azure App Service / cloud environments)
    // Azure App Settings may use literal \r\n or \n — restore to real newlines
    connectionOptions.privateKey = env.SFTP_PRIVATE_KEY_CONTENT
      .replace(/\\r\\n/g, "\n")
      .replace(/\\n/g, "\n");
    if (passphrase) {
      connectionOptions.passphrase = passphrase;
    }
  } else if (password) {
    connectionOptions.password = password;
  } else {
    throw new Error(
      "SFTP auth missing. Set SFTP_PASSWORD, or SFTP_PRIVATE_KEY_PATH with optional SFTP_PASSPHRASE."
    );
  }

  return {
    connectionOptions,
    remoteDir,
  };
}

module.exports = {
  buildSftpConfigFromEnv,
};
