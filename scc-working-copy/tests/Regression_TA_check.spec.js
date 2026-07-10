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
const sku    = process.env.TA_CHECK_SKU  !== undefined ? process.env.TA_CHECK_SKU  : loginData.sku;
const poId   = process.env.TA_CHECK_PO   !== undefined ? process.env.TA_CHECK_PO   : loginData.poId;
const asnRaw = process.env.TA_CHECK_ASN  !== undefined ? process.env.TA_CHECK_ASN  : (loginData.asnId || '');
// Support comma-separated ASN IDs — the TA shipment field accepts only one at a time,
// so we iterate through each one individually in a single browser session.
const asnIds = asnRaw ? asnRaw.split(',').map(s => s.trim()).filter(Boolean) : [];

const resultsFile   = process.env.TA_RESULTS_FILE   || path.resolve('test-results', 'ta-check-results.json');
const screenshotDir = process.env.TA_SCREENSHOT_DIR || path.resolve('test-results', 'screenshots');

async function shot(page, filename) {
  await fs.mkdir(screenshotDir, { recursive: true });
  const p = path.resolve(screenshotDir, filename);
  await page.screenshot({ path: p, fullPage: true });
  return filename;
}

// Screenshot just the named iframe element — crops to its exact rendered height, no blank space.
async function shotIframe(page, iframeName, filename) {
  await fs.mkdir(screenshotDir, { recursive: true });
  const p = path.resolve(screenshotDir, filename);
  const el = await page.$(`iframe[name="${iframeName}"]`);
  if (el) {
    await el.screenshot({ path: p });
  } else {
    await page.screenshot({ path: p, fullPage: true });
  }
  return filename;
}

// Expand the named iframe + all overflow-scroll containers inside it so
// fullPage: true captures every row (not just what fits in the viewport).
async function expandIframe(page, frameName) {
  const frame = page.frames().find(f => f.name() === frameName);
  if (frame) {
    // Single evaluate: expand overflow containers, collapse empty ones, then measure height.
    // Merged from two separate round-trips into one to reduce IPC overhead.
    const contentHeight = await frame.evaluate(() => {
      function expand(el) {
        const s = window.getComputedStyle(el);
        if (s.display === 'none' || s.visibility === 'hidden') return;
        if (['auto', 'scroll', 'hidden'].includes(s.overflow) || ['auto', 'scroll', 'hidden'].includes(s.overflowY)) {
          if (el.scrollHeight > el.clientHeight) {
            el.style.height    = el.scrollHeight + 'px';
            el.style.maxHeight = 'none';
            el.style.overflow  = 'visible';
            el.style.overflowY = 'visible';
          }
        }
        if (s.maxHeight && s.maxHeight !== 'none' && s.maxHeight !== '0px') {
          el.style.maxHeight = 'none';
        }
        for (const c of el.children) expand(c);
      }
      expand(document.body);

      function collapse(el) {
        const s = window.getComputedStyle(el);
        if (s.display === 'none' || s.visibility === 'hidden') return;
        if (el.clientHeight > el.scrollHeight + 40 && el.clientHeight > 100) {
          el.style.height    = el.scrollHeight + 'px';
          el.style.minHeight = '0';
        }
        for (const c of el.children) collapse(c);
      }
      collapse(document.body);

      // Measure: use the bottom of the lowest visible, non-empty element.
      let maxY = 0;
      function walk(el) {
        const s = window.getComputedStyle(el);
        if (s.display === 'none' || s.visibility === 'hidden') return;
        if (s.position === 'fixed' || s.position === 'sticky') return;
        const rect = el.getBoundingClientRect();
        if (rect.width > 0 && rect.height > 0) {
          const hasContent = (el.children.length === 0 && (el.textContent || '').trim().length > 0)
            || ['INPUT', 'SELECT', 'TEXTAREA', 'IMG'].includes(el.tagName);
          if (hasContent) {
            const bottom = rect.top + rect.height + window.pageYOffset;
            if (bottom > maxY) maxY = bottom;
          }
        }
        for (const c of el.children) walk(c);
      }
      walk(document.body);
      return maxY > 50 ? maxY : Math.max(document.body.scrollHeight, document.documentElement.scrollHeight);
    });

    await page.evaluate(({ name, h }) => {
      const el = document.querySelector(`iframe[name="${name}"]`);
      if (el) el.style.height = (h + 20) + 'px';
    }, { name: frameName, h: contentHeight });
  }
}

// Find pagination <select> controls inside the frame (those offering page-size options
// like 10 / 25 / 50 / 100) and switch them to the largest available value so that
// all rows are rendered before the screenshot.
async function expandTablePagination(page, frameName) {
  const frame = page.frames().find(f => f.name() === frameName);
  if (!frame) return;
  let changed = 0;
  const selects = await frame.$$('select');
  for (const sel of selects) {
    const opts = await sel.evaluate(s =>
      Array.from(s.options).map(o => ({ v: o.value, t: o.text, selected: o.selected }))
    );
    const numerics = opts
      .map(o => ({ ...o, n: parseInt(o.v) || parseInt(o.t) }))
      .filter(o => !isNaN(o.n) && o.n > 0);
    if (numerics.some(o => o.n === 10) && numerics.some(o => o.n > 10)) {
      const largest = numerics.reduce((a, b) => a.n > b.n ? a : b);
      if (!largest.selected) {
        await sel.selectOption(largest.v, { force: true });  // force skips visibility check on hidden native select
        changed++;
      }
    }
  }
  if (changed > 0) await page.waitForTimeout(3000); // let table re-render
}

test.setTimeout(600000); // 10 minutes — login SSO + 3 searches + ASN detail tabs

test('E2open TA | Check SKU, PO and ASN availability', async ({ page }) => {
  const loginPage   = new Regression_TA_LoginPageTA(page);
  const menuPage    = new Regression_TA_MenuPage(page);
  const productPage = new Regression_TA_ProductSearchPage(page);
  const poPage      = new Regression_TA_POSearchPage(page);
  const asnPage     = new Regression_TA_ASNSearchPage(page);

  const results = { sku: null, po: null, asns: [], timestamp: new Date().toISOString() };

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
      await shot(page, poFile);
    } else {
      console.log(`[TA] PO ${poId}: NOT FOUND`);
      await shot(page, poFile);
    }
    results.po = { id: poId, found: poFound, screenshot: poFile };
  }

  // ── ASN(s) ───────────────────────────────────────────────────────────────
  for (let asnIdx = 0; asnIdx < asnIds.length; asnIdx++) {
    const asnId = asnIds[asnIdx];
    console.log(`[TA] Searching ASN: ${asnId} (${asnIdx + 1}/${asnIds.length})`);
    const ts = Date.now();
    const asnFile       = `asn-${asnId}-${ts}.png`;
    const asnDetailFile = `asn-${asnId}-detail-${ts}.png`;
    const asnLineFile   = `asn-${asnId}-lineitems-${ts}.png`;
    const asnEventsFile = `asn-${asnId}-events-${ts}.png`;
    // Always navigate via the Logistics menu for each ASN —
    // clickBack() does not return to the shipment search form in mainFrame
    await menuPage.openLogistics('Shipment Search Search Power');
    console.log('[TA] Logistics menu opened (ASN search)');
    const asnFound = await asnPage.searchASN(asnId);
    if (asnFound) {
      console.log(`[TA] ASN ${asnId}: FOUND ✓`);
      await shot(page, asnFile);
      // Drill into detail page
      console.log(`[TA] ASN ${asnId}: opening detail...`);
      await asnPage.clickResultLink(asnId);
      await expandIframe(page, 'detailFrame');
      await shotIframe(page, 'detailFrame', asnDetailFile);
      // Line Items tab
      console.log(`[TA] ASN ${asnId}: capturing Line Items tab...`);
      await asnPage.clickTab('Line Items');
      await expandIframe(page, 'detailFrame');
      await shotIframe(page, 'detailFrame', asnLineFile);
      // Events tab
      console.log(`[TA] ASN ${asnId}: capturing Events tab...`);
      await asnPage.clickTab('Events');
      // Zoom out the detailFrame so the grid renders all rows without pagination clipping
      // (equivalent to pressing Ctrl+- in the browser — same effect user confirmed works)
      const detailFr = page.frames().find(f => f.name() === 'detailFrame');
      if (detailFr) await detailFr.evaluate(() => { document.body.style.zoom = '0.7'; });
      await page.waitForTimeout(200); // reduced from 1000ms — zoom is a synchronous CSS change
      await expandIframe(page, 'detailFrame');
      await shotIframe(page, 'detailFrame', asnEventsFile);
      // Back to search results
      await asnPage.clickBack();
    } else {
      console.log(`[TA] ASN ${asnId}: NOT FOUND`);
      await shot(page, asnFile);
    }
    results.asns.push({
      id: asnId, found: asnFound,
      screenshot: asnFile,
      screenshots: asnFound
        ? { results: asnFile, detail: asnDetailFile, lineItems: asnLineFile, events: asnEventsFile }
        : { results: asnFile }
    });
  }

  // ── Write results JSON ────────────────────────────────────────────────────
  await fs.mkdir(path.dirname(resultsFile), { recursive: true });
  await fs.writeFile(resultsFile, JSON.stringify(results, null, 2), 'utf8');
});
