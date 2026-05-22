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

// ── PROD SFTP config — reads PROD_SFTP_* env vars, fully isolated ────────────
function buildProdSftpConfigFromEnv(env) {
  const host = env.PROD_SFTP_HOST;
  const port = Number(env.PROD_SFTP_PORT || "22");
  const username = env.PROD_SFTP_USERNAME;
  const remoteDir = env.PROD_SFTP_REMOTE_DIR;

  const privateKeyPath = env.PROD_SFTP_PRIVATE_KEY_PATH;
  const passphrase = env.PROD_SFTP_PASSPHRASE;
  const password = env.PROD_SFTP_PASSWORD;

  if (!host || !username || !remoteDir) {
    throw new Error(
      "PROD SFTP config missing. Set PROD_SFTP_HOST, PROD_SFTP_USERNAME and PROD_SFTP_REMOTE_DIR"
    );
  }

  const connectionOptions = {
    host,
    port,
    username,
    readyTimeout: 30000,
  };

  const inlineKey = env.PROD_SFTP_PRIVATE_KEY; // key content for Azure (base64-encoded or raw)

  if (inlineKey) {
    // Decode base64 if the value doesn't look like a PEM header
    const decoded = inlineKey.startsWith("-----")
      ? inlineKey.replace(/\\n/g, "\n")
      : Buffer.from(inlineKey, "base64").toString("utf8");
    connectionOptions.privateKey = decoded;
    if (passphrase) connectionOptions.passphrase = passphrase;
  } else if (privateKeyPath) {
    const absoluteKeyPath = path.resolve(privateKeyPath);
    connectionOptions.privateKey = fs.readFileSync(absoluteKeyPath, "utf8");
    if (passphrase) connectionOptions.passphrase = passphrase;
  } else if (password) {
    connectionOptions.password = password;
  } else {
    throw new Error(
      "PROD SFTP auth missing. Set PROD_SFTP_PRIVATE_KEY (inline), PROD_SFTP_PRIVATE_KEY_PATH (file), or PROD_SFTP_PASSWORD."
    );
  }

  return {
    connectionOptions,
    remoteDir,
  };
}

module.exports = {
  buildSftpConfigFromEnv,
  buildProdSftpConfigFromEnv,
};
