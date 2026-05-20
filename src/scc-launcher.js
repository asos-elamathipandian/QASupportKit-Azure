/**
 * SCC Carrier Booking Automation - Playwright-based E2Open SCC interaction
 * Handles: ASN lookup, single ASN booking, multi-ASN booking
 * Location: Only on localhost:3000, disabled on cloud App Service
 */

const { chromium } = require('playwright');
const fs = require('fs');
const path = require('path');
const { spawn } = require('child_process');

const SCC_BASE_URL = 'https://asos.staging.e2open.com/pages/accept?destination=%2fasos%2f';
const LOCAL_SCC_COPY_DIR = process.env.SCC_LOCAL_COPY_DIR || path.resolve(process.cwd(), 'scc-working-copy');
const DEFAULT_LOGIN_DATA_FILE = path.join(LOCAL_SCC_COPY_DIR, 'tests-examples', 'Regression_TA_loginData.json');

function loadSccCredentials() {
  const loginDataFile = process.env.SCC_LOGIN_DATA_FILE || DEFAULT_LOGIN_DATA_FILE;
  let fileData = {};

  try {
    if (fs.existsSync(loginDataFile)) {
      fileData = JSON.parse(fs.readFileSync(loginDataFile, 'utf8'));
      console.log(`[SCC] Loaded credentials from ${loginDataFile}`);
    } else {
      console.log(`[SCC] Login data file not found at ${loginDataFile}, using env fallback`);
    }
  } catch (err) {
    console.log(`[SCC] Failed to read login data file (${loginDataFile}): ${err.message}`);
  }

  const username = process.env.SCC_USERNAME || fileData.username || 'elamathipandian';
  const email = process.env.SCC_EMAIL || fileData.email || (username.includes('@') ? username : `${username}@asos.com`);
  const password = process.env.SCC_PASSWORD || fileData.password || 'Sept@2024';

  return { username, email, password };
}

const SCC_CREDS = loadSccCredentials();
const SCC_USERNAME = SCC_CREDS.username;
const SCC_EMAIL = SCC_CREDS.email;
const SCC_PASSWORD = SCC_CREDS.password;
const SCC_HEADLESS = String(process.env.SCC_HEADLESS || 'true').toLowerCase() === 'true';
const SCC_SESSION_STATE_FILE = process.env.SCC_SESSION_STATE_FILE || path.resolve(process.cwd(), 'state', 'scc-storage-state.json');
const SCC_MENU_TOGGLE_SELECTOR = '.eto-header__menu-toggle';
const SCC_SESSION_MAX_AGE_MS = Number(process.env.SCC_SESSION_MAX_AGE_MS || 30 * 60 * 1000);
const WORKING_AUTOMATION_ROOT = process.env.SCC_AUTOMATION_ROOT || process.cwd();

function getWorkingAutomationPaths() {
  return {
    root: WORKING_AUTOMATION_ROOT,
    asnLookupSpec: path.join(LOCAL_SCC_COPY_DIR, 'tests', 'ASNLookup.spec.js'),
    singleBookingSpec: path.join(LOCAL_SCC_COPY_DIR, 'tests', 'SingleASNBookingMultipleTimes.spec.js'),
    multiBookingSpec: path.join(LOCAL_SCC_COPY_DIR, 'tests', 'MultiASNSingleBooking.spec.js'),
    fullFlowSpec: path.join(LOCAL_SCC_COPY_DIR, 'tests', 'FullSCCFlow.spec.js'),
    asnsFile: path.join(LOCAL_SCC_COPY_DIR, 'tests', 'asns.txt'),
    asnLookupResults: path.join(LOCAL_SCC_COPY_DIR, 'asn-lookup-results.json'),
    bookingResults: path.join(LOCAL_SCC_COPY_DIR, 'booking-results.json'),
    fullFlowResults: path.join(LOCAL_SCC_COPY_DIR, 'full-scc-flow-results.json'),
  };
}

async function runWorkingSpec(specPath, envVars = {}, timeoutMs = 300000, options = {}) {
  // Run from scc-working-copy so specs resolve asns.txt, playwright.config.js, etc. correctly
  const specCwd = LOCAL_SCC_COPY_DIR;
  const relativeSpecPath = path.relative(specCwd, specPath).replace(/\\/g, '/');
  const onProgress = (options && options.onProgress) || null;

  // Playwright binary lives in the root project's node_modules (not scc-working-copy)
  const rootDir = path.resolve(__dirname, '..');
  const playwrightBin = process.platform === 'win32'
    ? path.join(rootDir, 'node_modules', '.bin', 'playwright.cmd')
    : path.join(rootDir, 'node_modules', '.bin', 'playwright');

  const headedFlag = SCC_HEADLESS ? '' : ' --headed';
  const cmdString = `"${playwrightBin}" test "${relativeSpecPath}" --reporter=line --workers=1${headedFlag}`;

  // CI=true enables real-time stdout flushing through the pipe
  const env = Object.assign({}, process.env, { CI: 'true' }, envVars);

  console.log(`[SPEC] Executing in ${specCwd}: ${cmdString}`);

  return new Promise((resolve, reject) => {
    const child = spawn(cmdString, [], { cwd: specCwd, shell: true, env });

    let stdout = '';
    let stderr = '';

    child.stdout.on('data', (chunk) => {
      const text = chunk.toString();
      stdout += text;
      if (onProgress) onProgress(text);
      console.log('[SPEC] stdout:', text.trimEnd());
    });

    child.stderr.on('data', (chunk) => {
      const text = chunk.toString();
      stderr += text;
      if (onProgress) onProgress(text);
      console.log('[SPEC] stderr:', text.trimEnd());
    });

    const killTimer = setTimeout(() => {
      child.kill();
      reject(new Error(`Spec execution timed out after ${timeoutMs}ms`));
    }, timeoutMs);

    child.on('close', (code) => {
      clearTimeout(killTimer);
      if (code !== 0) {
        // Filter Node.js deprecation warnings / stack traces — show last meaningful lines
        const meaningful = (stdout + '\n' + stderr)
          .split('\n')
          .filter(l => l.trim() && !/DeprecationWarning|DEP\d+|\(Use `node|^\s+at /i.test(l))
          .slice(-30)
          .join('\n');
        reject(new Error(`Spec exited with code ${code}:\n${meaningful.substring(0, 1500)}`));
      } else {
        resolve({ success: true, stdout, stderr });
      }
    });

    child.on('error', (err) => {
      clearTimeout(killTimer);
      reject(new Error(`Spec spawn error: ${err.message}`));
    });
  });
}

function writeAsnsInput(asnList) {
  const { asnsFile } = getWorkingAutomationPaths();
  const normalized = Array.isArray(asnList) ? asnList.join(',') : String(asnList || '');
  fs.writeFileSync(asnsFile, normalized, 'utf8');
}

function readJsonIfExists(filePath) {
  if (!fs.existsSync(filePath)) return null;
  return JSON.parse(fs.readFileSync(filePath, 'utf8'));
}

async function finalizeSccLanding(page) {
  await page.waitForLoadState('networkidle').catch(() => {});

  // Dismiss optional popup that blocks interactions.
  await page.getByRole('button', { name: 'Explore on my own' }).click({ timeout: 3000 }).catch(() => {});

  // Mirror proven flow from existing working project.
  await page.goto('https://asos.staging.e2open.com/CLPSTG_e2clp/e2clp/#/', { waitUntil: 'domcontentloaded' }).catch(() => {});
  await page.locator('a').filter({ hasText: 'ASOS SCC' }).nth(1).click({ timeout: 12000 }).catch(() => {});
  await page.locator('#table-example-1').getByText('ASOS SCC', { exact: true }).click({ timeout: 12000 }).catch(() => {});
  await page.goto('https://asos.stging.e2open.com/asos/', { waitUntil: 'domcontentloaded' }).catch(() => {});

  await page.locator(SCC_MENU_TOGGLE_SELECTOR).first().waitFor({ state: 'visible', timeout: 30000 });
}

function getSccSessionStatus() {
  const exists = fs.existsSync(SCC_SESSION_STATE_FILE);
  return {
    exists,
    sessionFile: SCC_SESSION_STATE_FILE,
    lastUpdated: exists ? fs.statSync(SCC_SESSION_STATE_FILE).mtime.toISOString() : null,
  };
}

function hasFreshSessionState() {
  try {
    if (!fs.existsSync(SCC_SESSION_STATE_FILE)) return false;
    const stat = fs.statSync(SCC_SESSION_STATE_FILE);
    return (Date.now() - stat.mtimeMs) < SCC_SESSION_MAX_AGE_MS;
  } catch {
    return false;
  }
}

async function fullLoginAndSave(context, page) {
  console.log('[SCC] Performing full login...');
  await page.goto(SCC_BASE_URL, { waitUntil: 'domcontentloaded' });
  await page.getByRole('button', { name: 'Agree and proceed' }).click({ timeout: 6000 }).catch(() => {});

  // Email/Continue step can be optional depending on SSO state; keep it best-effort.
  const emailBox = page.getByRole('textbox', { name: /Enter your email/i });
  if (await emailBox.isVisible({ timeout: 4000 }).catch(() => false)) {
    await emailBox.fill(SCC_EMAIL).catch(() => {});
    // Continue can be disabled transiently; prefer Enter and do not hard-fail.
    await emailBox.press('Enter').catch(() => {});
    await page.waitForTimeout(700);
  }

  const usernameBox = page.locator('input[aria-label*="username" i], input[placeholder*="username" i], #username, input[name="username"]').first();
  const passwordBox = page.locator('input[aria-label*="password" i], input[placeholder*="password" i], #password, input[name="password"], input[type="password"]').first();
  const hasCredentialsScreen = await usernameBox.isVisible({ timeout: 15000 }).catch(() => false);
  if (hasCredentialsScreen) {
    await usernameBox.fill(SCC_USERNAME);
    await passwordBox.fill(SCC_PASSWORD);
    await page.getByRole('button', { name: /Login/i }).click({ timeout: 10000 }).catch(async () => {
      await passwordBox.press('Enter');
    });
  }

  await finalizeSccLanding(page);
  fs.mkdirSync(path.dirname(SCC_SESSION_STATE_FILE), { recursive: true });
  await context.storageState({ path: SCC_SESSION_STATE_FILE });
  console.log('[SCC] Auth state saved');
}

async function bootstrapSccSession(options = {}) {
  const timeoutMs = Number(options.timeoutMs) > 0 ? Number(options.timeoutMs) : 180000;
  fs.mkdirSync(path.dirname(SCC_SESSION_STATE_FILE), { recursive: true });

  const browser = await chromium.launch({ headless: SCC_HEADLESS });
  const context = await browser.newContext();
  const page = await context.newPage();

  try {
    console.log('[SCC] Starting session bootstrap...');
    await fullLoginAndSave(context, page);

    // Extend wait budget if caller requested a higher timeout.
    if (timeoutMs > 30000) {
      await page.locator(SCC_MENU_TOGGLE_SELECTOR).first().waitFor({ state: 'visible', timeout: timeoutMs }).catch(() => {});
    }

    await browser.close();

    return {
      ok: true,
      message: 'SCC session initialized successfully.',
      sessionFile: SCC_SESSION_STATE_FILE,
    };
  } catch (err) {
    const debugPath = path.resolve(process.cwd(), 'output', 'scc-bootstrap-debug.png');
    await page.screenshot({ path: debugPath, fullPage: true }).catch(() => {});
    await browser.close();
    throw new Error(`Manual SCC session bootstrap failed: ${err.message}. Debug screenshot: ${debugPath}`);
  }
}

function clearSccSession() {
  if (fs.existsSync(SCC_SESSION_STATE_FILE)) {
    fs.unlinkSync(SCC_SESSION_STATE_FILE);
  }
}

/**
 * Check if running on cloud (Azure App Service)
 */
function isCloudRuntime() {
  return Boolean(
    process.env.WEBSITE_SITE_NAME ||
    process.env.WEBSITE_INSTANCE_ID ||
    process.env.WEBSITE_RESOURCE_GROUP
  );
}

/**
 * Get SCC availability status
 */
function getSccAvailability(options = {}) {
  const issues = [];

  if (isCloudRuntime()) {
    issues.push('SCC Playwright automation is disabled in cloud runtime. Use local app (localhost:3000) for SCC operations.');
    return {
      available: false,
      issues,
      reason: 'cloud-disabled',
    };
  }

  if (!SCC_USERNAME || !SCC_PASSWORD) {
    issues.push('Set SCC_USERNAME and SCC_PASSWORD environment variables');
  }

  return {
    available: issues.length === 0,
    issues,
    reason: issues.length > 0 ? 'config-missing' : 'available',
    session: getSccSessionStatus(),
  };
}

/**
 * Launch browser and login to SCC
 */
async function launchAndLogin() {
  const browser = await chromium.launch({ headless: SCC_HEADLESS });
  let context;
  let page;

  try {
    if (hasFreshSessionState()) {
      console.log('[SCC] Reusing saved auth state...');
      context = await browser.newContext({ storageState: SCC_SESSION_STATE_FILE });
      page = await context.newPage();
      await page.goto('https://asos.staging.e2open.com/asos/', { waitUntil: 'domcontentloaded' }).catch(() => {});
      const menuVisible = await page.locator(SCC_MENU_TOGGLE_SELECTOR).first().isVisible({ timeout: 10000 }).catch(() => false);
      if (!menuVisible) {
        await context.close().catch(() => {});
        context = await browser.newContext();
        page = await context.newPage();
        await fullLoginAndSave(context, page);
      }
    } else {
      console.log('[SCC] No fresh auth state. Performing full login...');
      context = await browser.newContext();
      page = await context.newPage();
      await fullLoginAndSave(context, page);
    }

    await page.waitForTimeout(800);

    console.log('[SCC] Session restored');
    return { browser, context, page };
  } catch (err) {
    const debugPath = require('path').resolve(process.cwd(), 'output', 'scc-login-debug.png');
    await page.screenshot({ path: debugPath, fullPage: true }).catch(() => {});
    await browser.close();
    throw new Error(`SCC login failed: ${err.message}. Debug screenshot: ${debugPath}`);
  }
}

/**
 * Navigate to ASOS Order Search in SCC
 */
async function navigateToOrderSearch(page) {
  await page.getByRole('button', { name: 'menu Menu' }).click();
  await page.waitForTimeout(500);
  await page.getByRole('button', { name: 'DDP, WIP & Tools' }).click();
  await page.waitForTimeout(500);
  await page.getByRole('link', { name: 'View List', exact: true }).click();
  await page.waitForTimeout(1000);
  
  const frame = page.frameLocator('iframe[name="clientframe"]');
  await frame.getByRole('link', { name: 'ASOS Order Search', exact: true }).click();
  await page.waitForTimeout(1000);
  
  return frame;
}

/**
 * Lookup ASNs in SCC Order Search
 * Returns: Array of matching orders
 */
async function lookupAsn(asnList, options = {}) {
  if (!Array.isArray(asnList)) {
    asnList = [asnList];
  }
  const onStep = options.onStep || null;

  const paths = getWorkingAutomationPaths();
  const asnString = asnList.join(',');
  console.log(`[SCC] Running working ASN lookup spec for: ${asnString}`);

  if (onStep) onStep(`Looking up ASN${asnList.length > 1 ? 's' : ''}: ${asnString}`);
  if (onStep) onStep('Launching Playwright browser\u2026');

  try {
    await runWorkingSpec(paths.asnLookupSpec, {
      ASN_LOOKUP_VALUE: asnString,
    }, 240000, options);

    if (onStep) onStep('Playwright test completed, reading results\u2026');
    const result = readJsonIfExists(paths.asnLookupResults);
    const matchCount = Number(result?.totalRecords || 0);
    const found = matchCount > 0;
    if (onStep) onStep(found ? `\u2705 Found ${matchCount} record${matchCount !== 1 ? 's' : ''}` : '\u26a0\ufe0f ASN not found in SCC');

    return {
      success: true,
      asns: asnList,
      matchCount,
      found,
      raw: result,
      message: found ? 'ASN found' : 'ASN not found',
    };
  } catch (err) {
    if (onStep) onStep(`\u274c Error: ${err.message.substring(0, 120)}`);
    throw new Error(`ASN lookup failed via working automation: ${err.message}`);
  }
}

/**
 * Create single ASN booking in SCC
 * One booking per ASN
 */
async function createSingleAsnBooking(asnList, options = {}) {
  if (!Array.isArray(asnList)) {
    asnList = [asnList];
  }
  const onStep = options.onStep || null;

  const paths = getWorkingAutomationPaths();
  writeAsnsInput(asnList);
  console.log(`[SCC] Running working single-booking spec for ASNs: ${asnList.join(',')}`);

  if (onStep) onStep(`Creating single booking for ${asnList.length} ASN${asnList.length > 1 ? 's' : ''}`);
  if (onStep) onStep('Launching Playwright browser\u2026');

  try {
    await runWorkingSpec(paths.singleBookingSpec, {}, 600000, options);

    if (onStep) onStep('Playwright test completed, reading booking results\u2026');
    const result = readJsonIfExists(paths.bookingResults) || [];
    const count = Array.isArray(result) ? result.length : asnList.length;
    if (onStep) onStep(`\u2705 ${count} booking${count !== 1 ? 's' : ''} created successfully`);

    return {
      success: true,
      asns: asnList,
      count,
      results: result,
      message: `Single booking flow completed via working automation project`,
    };
  } catch (err) {
    if (onStep) onStep(`\u274c Error: ${err.message.substring(0, 120)}`);
    throw new Error(`Single booking failed via working automation: ${err.message}`);
  }
}

/**
 * Create multi-ASN booking in SCC
 * All ASNs in one booking
 */
async function createMultiAsnBooking(asnList, options = {}) {
  if (!Array.isArray(asnList)) {
    asnList = [asnList];
  }
  const onStep = options.onStep || null;

  const paths = getWorkingAutomationPaths();
  writeAsnsInput(asnList);
  console.log(`[SCC] Running working multi-booking spec for ASNs: ${asnList.join(',')}`);

  if (onStep) onStep(`Creating multi-ASN booking for ${asnList.length} ASN${asnList.length > 1 ? 's' : ''}`);
  if (onStep) onStep('Launching Playwright browser\u2026');

  try {
    await runWorkingSpec(paths.multiBookingSpec, {}, 600000, options);

    if (onStep) onStep('Playwright test completed, reading booking results\u2026');
    const result = readJsonIfExists(paths.bookingResults) || [];
    const count = Array.isArray(result) ? result.length : asnList.length;
    if (onStep) onStep(`\u2705 Multi-ASN booking created with ${count} ASN${count !== 1 ? 's' : ''}`);

    return {
      success: true,
      asns: asnList,
      count,
      results: result,
      message: `Multi-ASN booking flow completed via working automation project`,
    };
  } catch (err) {
    if (onStep) onStep(`\u274c Error: ${err.message.substring(0, 120)}`);
    throw new Error(`Multi-ASN booking failed via working automation: ${err.message}`);
  }
}

/**
 * Full SCC flow (lookup + booking + submit/approve) via working spec
 */
async function createFullSccFlow(asnList, options = {}) {
  if (!Array.isArray(asnList)) {
    asnList = [asnList];
  }
  const onStep = options.onStep || null;

  const paths = getWorkingAutomationPaths();
  const asnString = asnList.join(',');
  console.log(`[SCC] Running working full-flow spec for ASNs: ${asnString}`);

  if (onStep) onStep(`Starting full SCC flow for: ${asnString}`);
  if (onStep) onStep('Launching Playwright browser\u2026');

  try {
    await runWorkingSpec(paths.fullFlowSpec, {
      FULL_FLOW_ASN_VALUE: asnString,
    }, 900000, options);

    if (onStep) onStep('Playwright test completed, reading flow results\u2026');
    const result = readJsonIfExists(paths.fullFlowResults) || {
      ok: true,
      asns: asnString,
      details: [],
    };
    const rowCount = Array.isArray(result.details) ? result.details.length : 0;
    if (onStep) onStep(`\u2705 Full SCC flow completed \u2014 ${rowCount} row${rowCount !== 1 ? 's' : ''} processed`);

    return {
      success: true,
      asns: asnList,
      result,
      message: 'Full SCC flow completed via working automation project',
    };
  } catch (err) {
    throw new Error(`Full SCC flow failed via working automation: ${err.message}`);
  }
}

module.exports = {
  isCloudRuntime,
  getSccAvailability,
  getSccSessionStatus,
  bootstrapSccSession,
  clearSccSession,
  lookupAsn,
  createSingleAsnBooking,
  createMultiAsnBooking,
  createFullSccFlow,
};
