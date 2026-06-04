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

  const inlineKey = env.SFTP_PRIVATE_KEY_CONTENT; // key content for Azure (base64-encoded, raw PEM, or PPK)

  if (inlineKey) {
    // Pass PEM/PPK as-is (unescape literal \n); otherwise assume base64-encoded
    const isTextKey = inlineKey.startsWith("-----") || inlineKey.startsWith("PuTTY-User-Key-File");
    const decoded = isTextKey
      ? inlineKey.replace(/\\n/g, "\n")
      : Buffer.from(inlineKey, "base64").toString("utf8");
    connectionOptions.privateKey = decoded;
    if (passphrase) connectionOptions.passphrase = passphrase;
  } else if (privateKeyPath) {
    const absoluteKeyPath = path.resolve(privateKeyPath);
    connectionOptions.privateKey = fs.readFileSync(absoluteKeyPath, "utf8");
    if (passphrase) {
      connectionOptions.passphrase = passphrase;
    }
  } else if (password) {
    connectionOptions.password = password;
  } else {
    throw new Error(
      "SFTP auth missing. Set SFTP_PRIVATE_KEY (inline), SFTP_PRIVATE_KEY_PATH (file), or SFTP_PASSWORD."
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

  const inlineKey = env.PROD_SFTP_PRIVATE_KEY; // key content for Azure (base64-encoded, raw PEM, or PPK)

  if (inlineKey) {
    // Pass PEM/PPK as-is (unescape literal \n); otherwise assume base64-encoded
    const isTextKey = inlineKey.startsWith("-----") || inlineKey.startsWith("PuTTY-User-Key-File");
    const decoded = isTextKey
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
