import { test } from '@playwright/test';
import path from 'path';
import { promises as fs } from 'fs';
const loginData = require('../tests-examples/Regression_TA_loginData.json');
import { Regression_TA_LoginPageTA } from '../pages/Regression_TA_LoginPageTA.js';
import { Regression_TA_MenuPage } from '../pages/Regression_TA_MenuPage.js';
import { Regression_TA_ProductSearchPage } from '../pages/Regression_TA_ProductSearchPage.js';
import { Regression_TA_POSearchPage } from '../pages/Regression_TA_PO_SearchPage.js';
import { Regression_TA_ASNSearchPage } from '../pages/Regression_TA_ASN_SearchPage.js';

// Values passed from ta-checker.js via env vars.
// Use !== undefined so an empty string means "skip this search" (not fall back to loginData).
const sku   = process.env.TA_CHECK_SKU  !== undefined ? process.env.TA_CHECK_SKU  : loginData.sku;
const poId  = process.env.TA_CHECK_PO   !== undefined ? process.env.TA_CHECK_PO   : loginData.poId;
const asnId = process.env.TA_CHECK_ASN  !== undefined ? process.env.TA_CHECK_ASN  : loginData.asnId;

const resultsFile   = process.env.TA_RESULTS_FILE   || path.resolve('test-results', 'ta-check-results.json');
const screenshotDir = process.env.TA_SCREENSHOT_DIR || path.resolve('test-results', 'screenshots');

async function shot(page, filename) {
  await fs.mkdir(screenshotDir, { recursive: true });
  const p = path.resolve(screenshotDir, filename);
  await page.screenshot({ path: p, fullPage: false });
  return filename;
}

test.setTimeout(240000); // 4 minutes — login SSO takes up to 60s + 3 searches

test('E2open TA | Check SKU, PO and ASN availability', async ({ page }) => {
  const loginPage   = new Regression_TA_LoginPageTA(page);
  const menuPage    = new Regression_TA_MenuPage(page);
  const productPage = new Regression_TA_ProductSearchPage(page);
  const poPage      = new Regression_TA_POSearchPage(page);
  const asnPage     = new Regression_TA_ASNSearchPage(page);

  const results = { sku: null, po: null, asn: null, timestamp: new Date().toISOString() };

  await loginPage.goToLogin();
  console.log('[TA] Navigating to E2open TA login page...');
  await loginPage.enterEmail(loginData.email);
  console.log('[TA] Email entered, submitting...');
  await loginPage.enterCredentials(loginData.username, loginData.password);
  console.log('[TA] Logged in successfully');

  // ── SKU ──────────────────────────────────────────────────────────────────
  if (sku) {
    console.log(`[TA] Searching SKU: ${sku}`);
    const skuFile = `sku-${sku}-${Date.now()}.png`;
    await menuPage.openProducts();
    console.log('[TA] Products menu opened');
    const skuFound = await productPage.searchProduct(sku);
    if (skuFound) {
      console.log(`[TA] SKU ${sku}: FOUND ✓`);
      await page.waitForTimeout(2000); // let results grid settle
      await shot(page, skuFile);
    } else {
      console.log(`[TA] SKU ${sku}: NOT FOUND`);
      await shot(page, skuFile);
    }
    results.sku = { id: sku, found: skuFound, screenshot: skuFile };
  }

  // ── PO ───────────────────────────────────────────────────────────────────
  if (poId) {
    console.log(`[TA] Searching PO: ${poId}`);
    const poFile = `po-${poId}-${Date.now()}.png`;
    await menuPage.openLogistics();
    console.log('[TA] Logistics menu opened (PO search)');
    const poFound = await poPage.searchPO(poId, { timeout: 8000, openResult: false });
    if (poFound) {
      console.log(`[TA] PO ${poId}: FOUND ✓`);
      await page.waitForTimeout(2000);
      await shot(page, poFile);
    } else {
      console.log(`[TA] PO ${poId}: NOT FOUND`);
      await shot(page, poFile);
    }
    results.po = { id: poId, found: poFound, screenshot: poFile };
  }

  // ── ASN ──────────────────────────────────────────────────────────────────
  if (asnId) {
    console.log(`[TA] Searching ASN: ${asnId}`);
    const asnFile = `asn-${asnId}-${Date.now()}.png`;
    await menuPage.openLogistics('Shipment Search Search Power');
    console.log('[TA] Logistics menu opened (ASN search)');
    const asnFound = await asnPage.searchASN(asnId);
    if (asnFound) {
      console.log(`[TA] ASN ${asnId}: FOUND ✓`);
      await page.waitForTimeout(2000); // let results grid settle
      await shot(page, asnFile);
    } else {
      console.log(`[TA] ASN ${asnId}: NOT FOUND`);
      await shot(page, asnFile);
    }
    results.asn = { id: asnId, found: asnFound, screenshot: asnFile };
  }

  // ── Write results JSON ────────────────────────────────────────────────────
  await fs.mkdir(path.dirname(resultsFile), { recursive: true });
  await fs.writeFile(resultsFile, JSON.stringify(results, null, 2), 'utf8');
});
