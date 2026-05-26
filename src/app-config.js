const fs = require("fs");
const path = require("path");
const dotenv = require("dotenv");

function loadEnvironment() {
  // override: true ensures .env values replace any pre-existing process.env values
  // (e.g. stale Windows system/user env vars from a previous setup)
  dotenv.config({ path: path.resolve(process.cwd(), "config/.env"), override: true });
  dotenv.config({ override: true });
}

function loadInputsFile() {
  const inputsPath = path.resolve(process.cwd(), "config/inputs.json");
  if (!fs.existsSync(inputsPath)) {
    return {};
  }

  return JSON.parse(fs.readFileSync(inputsPath, "utf8"));
}

function getOutputDir(env = process.env) {
  return env.OUTPUT_DIR || path.resolve(process.cwd(), "output");
}

function getStateDir(env = process.env) {
  return env.STATE_DIR || path.resolve(process.cwd(), "state");
}

function getAbvCounterFile(env = process.env) {
  return env.ABV_COUNTER_FILE || path.join(getStateDir(env), "abv-counter.json");
}

function getCarrierSequenceFile(env = process.env) {
  return (
    env.CARRIER_SEQUENCE_FILE ||
    path.join(getStateDir(env), "carrier-sequence.json")
  );
}

module.exports = {
  getAbvCounterFile,
  getCarrierSequenceFile,
  getOutputDir,
  getStateDir,
  loadEnvironment,
  loadInputsFile,
};