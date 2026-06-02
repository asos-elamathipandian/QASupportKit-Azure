/**
 * E2open TA UI Checker
 * Runs the Regression_TA_check.spec.js Playwright spec with user-supplied SKU/PO/ASN,
 * then reads back the results JSON and screenshot files.
 */

const { spawn } = require('child_process');
const path = require('path');
const fs = require('fs');

const SCC_WORKING_COPY = path.resolve(process.cwd(), 'scc-working-copy');
const SCREENSHOT_DIR = path.join(SCC_WORKING_COPY, 'test-results', 'screenshots');
const TA_RESULTS_FILE = path.join(SCC_WORKING_COPY, 'test-results', 'ta-check-results.json');
const SPEC_PATH = 'tests/Regression_TA_check.spec.js';
const TIMEOUT_MS = 5 * 60 * 1000; // 5 minutes

function getPlaywrightBin() {
  const rootDir = path.resolve(__dirname, '..');
  return process.platform === 'win32'
    ? path.join(rootDir, 'node_modules', '.bin', 'playwright.cmd')
    : path.join(rootDir, 'node_modules', '.bin', 'playwright');
}

let _taActiveChild = null;

function cancelTaCheck() {
  if (_taActiveChild) {
    try { _taActiveChild.kill('SIGTERM'); } catch (_) {}
    _taActiveChild = null;
    return true;
  }
  return false;
}

function runTaCheck({ sku, poId, asnId, onProgress } = {}) {
  return new Promise((resolve, reject) => {
    const playwrightBin = getPlaywrightBin();
    const cmd = `"${playwrightBin}" test "${SPEC_PATH}" --reporter=line --workers=1 --timeout=180000`;

    const env = Object.assign({}, process.env, {
      CI: 'true',
      TA_CHECK_SKU: sku || '',
      TA_CHECK_PO: poId || '',
      TA_CHECK_ASN: asnId || '',
      TA_RESULTS_FILE,
      TA_SCREENSHOT_DIR: SCREENSHOT_DIR,
    });

    console.log(`[TA] Running: ${cmd}`);
    // Clear stale results from any previous run before starting
    try { if (fs.existsSync(TA_RESULTS_FILE)) fs.unlinkSync(TA_RESULTS_FILE); } catch (_) {}
    const child = spawn(cmd, [], { cwd: SCC_WORKING_COPY, shell: true, env });
    _taActiveChild = child;

    let stdout = '';
    let stderr = '';

    child.stdout.on('data', (chunk) => {
      const text = chunk.toString();
      stdout += text;
      if (onProgress) onProgress(text);
      console.log('[TA]', text.trimEnd());
    });

    child.stderr.on('data', (chunk) => {
      const text = chunk.toString();
      stderr += text;
      if (onProgress) onProgress(text);
    });

    const killTimer = setTimeout(() => {
      child.kill();
      reject(new Error('TA check timed out after 5 minutes'));
    }, TIMEOUT_MS);

    child.on('close', (code) => {
      _taActiveChild = null;
      clearTimeout(killTimer);

      let results = null;
      try {
        if (code === 0 && fs.existsSync(TA_RESULTS_FILE)) {
          results = JSON.parse(fs.readFileSync(TA_RESULTS_FILE, 'utf8'));
        }
      } catch (_) {}

      if (results) {
        resolve(results);
      } else if (code !== 0) {
        const tail = (stdout + '\n' + stderr)
          .split('\n')
          .filter(l => l.trim() && !/DeprecationWarning|DEP\d+|\(Use `node|^\s+at /i.test(l))
          .slice(-20)
          .join('\n');
        reject(new Error(`TA check failed (exit ${code}):\n${tail.substring(0, 1000)}`));
      } else {
        resolve({ sku: null, po: null, asn: null });
      }
    });

    child.on('error', (err) => {
      _taActiveChild = null;
      clearTimeout(killTimer);
      reject(new Error(`Spawn error: ${err.message}`));
    });
  });
}

module.exports = { runTaCheck, cancelTaCheck, SCREENSHOT_DIR, TA_RESULTS_FILE };
