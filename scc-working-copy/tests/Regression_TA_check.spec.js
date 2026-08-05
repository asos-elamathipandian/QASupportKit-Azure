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

// Purpose-built frame expansion for the Events tab — avoids the collapse() step
// in the generic expandIframe() which incorrectly shrinks parent containers when
// their heights exceed their content height at full zoom.
// Three passes handle nested clipping hierarchies: after children are expanded in
// pass N their parent sees the updated scrollHeight in pass N+1.
async function expandFrameFull(page, frameName) {
  const frame = page.frames().find(f => f.name() === frameName);
  if (!frame) return;
  // Three passes — each pass lets parent containers see their children's expanded
  // dimensions and expand themselves in the next pass.
  // Both vertical (height) AND horizontal (width) overflow are expanded so no
  // columns are clipped on the right side of the screenshot.
  for (let pass = 0; pass < 3; pass++) {
    await frame.evaluate(() => {
      document.querySelectorAll('*').forEach(el => {
        const s = window.getComputedStyle(el);
        // ── vertical ──
        const clippedV = ['auto', 'scroll', 'hidden'].includes(s.overflow) ||
                         ['auto', 'scroll', 'hidden'].includes(s.overflowY);
        if (clippedV && el.scrollHeight > el.clientHeight) {
          el.style.height    = el.scrollHeight + 'px';
          el.style.maxHeight = 'none';
          el.style.overflow  = 'visible';
          el.style.overflowY = 'visible';
        }
        if (s.maxHeight && s.maxHeight !== 'none' && s.maxHeight !== '0px') {
          el.style.maxHeight = 'none';
        }
        // ── horizontal ──
        const clippedH = ['auto', 'scroll', 'hidden'].includes(s.overflow) ||
                         ['auto', 'scroll', 'hidden'].includes(s.overflowX);
        if (clippedH && el.scrollWidth > el.clientWidth) {
          el.style.width    = el.scrollWidth + 'px';
          el.style.maxWidth = 'none';
          el.style.overflowX = 'visible';
        }
        if (s.maxWidth && s.maxWidth !== 'none' && s.maxWidth !== '0px') {
          el.style.maxWidth = 'none';
        }
      });
    });
  }
  // Measure full content dimensions inside the frame
  const { h, w } = await frame.evaluate(() => ({
    h: Math.max(document.body.scrollHeight, document.documentElement.scrollHeight),
    w: Math.max(document.body.scrollWidth,  document.documentElement.scrollWidth),
  }));
  // Set iframe element size in the outer page
  await page.evaluate(({ name, h, w }) => {
    const el = document.querySelector(`iframe[name="${name}"]`);
    if (el) {
      el.style.height = (h + 30) + 'px';
      el.style.width  = (w + 30) + 'px';
    }
  }, { name: frameName, h, w });
  // Wait for the browser to reflow before reading outer container scrollHeights
  await page.waitForTimeout(300);
  // Expand outer-page containers (both axes) so they don't clip the larger iframe
  await page.evaluate(() => {
    for (let pass = 0; pass < 2; pass++) {
      document.querySelectorAll('*').forEach(el => {
        const s = window.getComputedStyle(el);
        if (['auto', 'scroll', 'hidden'].includes(s.overflow) ||
            ['auto', 'scroll', 'hidden'].includes(s.overflowY)) {
          if (el.scrollHeight > el.clientHeight) {
            el.style.height    = el.scrollHeight + 'px';
            el.style.maxHeight = 'none';
            el.style.overflow  = 'visible';
            el.style.overflowY = 'visible';
          }
        }
        if (['auto', 'scroll', 'hidden'].includes(s.overflow) ||
            ['auto', 'scroll', 'hidden'].includes(s.overflowX)) {
          if (el.scrollWidth > el.clientWidth) {
            el.style.width    = el.scrollWidth + 'px';
            el.style.maxWidth = 'none';
            el.style.overflowX = 'visible';
          }
        }
      });
    }
  });
  await page.waitForTimeout(200); // let outer re-layout settle before screenshot
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
    // Accept any select with 2+ numeric options — not just ones that include exactly 10
    if (numerics.length >= 2) {
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
    let asnEventsFiles  = [];
    // Always navigate via the Logistics menu for each ASN —
    // clickBack() does not return to the shipment search form in mainFrame
    await menuPage.openLogistics('Shipment Search Search Power');
    console.log('[TA] Logistics menu opened (ASN search)');
    const asnFound = await asnPage.searchASN(asnId);
    if (asnFound) {
      console.log(`[TA] ASN ${asnId}: FOUND ✓`);
      // Expand mainFrame so all search-result rows and columns are visible
      await expandFrameFull(page, 'mainFrame');
      await shotIframe(page, 'mainFrame', asnFile);
      // Drill into detail page
      console.log(`[TA] ASN ${asnId}: opening detail...`);
      await asnPage.clickResultLink(asnId);
      await expandFrameFull(page, 'detailFrame');
      await shotIframe(page, 'detailFrame', asnDetailFile);
      // Line Items tab
      console.log(`[TA] ASN ${asnId}: capturing Line Items tab...`);
      await asnPage.clickTab('Line Items');
      await expandFrameFull(page, 'detailFrame');
      await shotIframe(page, 'detailFrame', asnLineFile);
      // Events tab — extract ALL rows via DOM clone so the fixed-height scroll container
      // cannot hide any events from the screenshot.
      console.log(`[TA] ASN ${asnId}: capturing Events tab...`);
      await asnPage.clickTab('Events');
      await page.waitForTimeout(3000); // Events load via XHR — wait for first page

      // Maximise page size so all rows are present in the DOM before we clone.
      await expandTablePagination(page, 'detailFrame');
      await expandTablePagination(page, 'detailFrame');

      const frEvents = page.frames().find(f => f.name() === 'detailFrame');
      let domExtractionDone = false;

      if (frEvents) {
        // Clone the events table HTML — cloneNode includes ALL rows regardless of scroll
        const { eventsHtml, pageLabel } = await frEvents.evaluate(() => {
          // Pick the table/grid with the most data rows (events table heuristic)
          let best = null, bestRows = 0;
          document.querySelectorAll('table, [role="grid"], [role="table"]').forEach(el => {
            const n = el.querySelectorAll('tr, [role="row"]').length;
            if (n > bestRows) { best = el; bestRows = n; }
          });
          // Also capture the pagination label ("1 to 15 of 15") for context
          const paginationEl = document.querySelector(
            '[class*="pagination"], [class*="pager"], .pageinfo, #pageinfo'
          );
          const pageLabel = paginationEl ? paginationEl.textContent.trim() : '';
          return { eventsHtml: best ? best.cloneNode(true).outerHTML : null, pageLabel };
        });

        if (eventsHtml) {
          const evtFile = `asn-${asnId}-events-${ts}.png`;
          const evtPath = path.resolve(screenshotDir, evtFile);
          await fs.mkdir(screenshotDir, { recursive: true });

          // Render the cloned table in a clean minimal page — no height constraints
          const cleanPage = await page.context().newPage();
          await cleanPage.setContent(
            `<!DOCTYPE html><html><head><meta charset="utf-8"><style>
             body{font-family:Arial,sans-serif;font-size:12px;padding:10px;margin:0;background:#fff}
             h4{margin:0 0 6px;font-size:12px;color:#444}
             table{border-collapse:collapse;width:100%}
             th,td{border:1px solid #ccc;padding:4px 8px;text-align:left;white-space:nowrap;font-size:11px}
             th{background:#e8e8e8;font-weight:bold}
             tr:nth-child(even) td{background:#f7f7f7}
             </style></head><body>
             <h4>ASN ${asnId} — Events${pageLabel ? ' (' + pageLabel + ')' : ''}</h4>
             ${eventsHtml}
             </body></html>`
          );
          await cleanPage.screenshot({ path: evtPath, fullPage: true });
          await cleanPage.close();
          asnEventsFiles.push(evtFile);
          console.log(`[TA] ASN ${asnId}: events captured via DOM extraction — all rows visible (${evtFile})`);
          domExtractionDone = true;

          // Also paginate and capture remaining pages if the table has a "next page"
          let evtPg = 2;
          const MAX_EVT_PAGES = 15;
          while (evtPg <= MAX_EVT_PAGES) {
            const fr2 = page.frames().find(f => f.name() === 'detailFrame');
            if (!fr2) break;
            let nextClicked = false;
            for (const loc of [
              fr2.locator('a').filter({ hasText: /^>$/ }).first(),
              fr2.locator('button').filter({ hasText: /^>$/ }).first(),
              fr2.locator('[title="Next Page"]').first(),
              fr2.locator('[aria-label="Next Page"]').first(),
            ]) {
              try {
                if (await loc.isVisible({ timeout: 600 })) {
                  await loc.click({ timeout: 3000 });
                  nextClicked = true;
                  break;
                }
              } catch (_) {}
            }
            if (!nextClicked) break;
            await page.waitForTimeout(2500);
            const { eventsHtml: nextHtml, pageLabel: nextLabel } = await fr2.evaluate(() => {
              let best = null, bestRows = 0;
              document.querySelectorAll('table, [role="grid"]').forEach(el => {
                const n = el.querySelectorAll('tr, [role="row"]').length;
                if (n > bestRows) { best = el; bestRows = n; }
              });
              const p = document.querySelector('[class*="pagination"],[class*="pager"],.pageinfo,#pageinfo');
              return { eventsHtml: best ? best.cloneNode(true).outerHTML : null, pageLabel: p ? p.textContent.trim() : '' };
            });
            if (!nextHtml) break;
            const pgFile = `asn-${asnId}-events-p${evtPg}-${ts}.png`;
            const pgPath = path.resolve(screenshotDir, pgFile);
            const pgPage = await page.context().newPage();
            await pgPage.setContent(
              `<!DOCTYPE html><html><head><meta charset="utf-8"><style>
               body{font-family:Arial,sans-serif;font-size:12px;padding:10px;margin:0;background:#fff}
               h4{margin:0 0 6px;font-size:12px;color:#444}
               table{border-collapse:collapse;width:100%}
               th,td{border:1px solid #ccc;padding:4px 8px;text-align:left;white-space:nowrap;font-size:11px}
               th{background:#e8e8e8;font-weight:bold}
               tr:nth-child(even) td{background:#f7f7f7}
               </style></head><body>
               <h4>ASN ${asnId} — Events page ${evtPg}${nextLabel ? ' (' + nextLabel + ')' : ''}</h4>
               ${nextHtml}</body></html>`
            );
            await pgPage.screenshot({ path: pgPath, fullPage: true });
            await pgPage.close();
            asnEventsFiles.push(pgFile);
            console.log(`[TA] ASN ${asnId}: events page ${evtPg} captured (${pgFile})`);
            evtPg++;
          }
        }
      }

      // Fallback: iframe screenshot if DOM extraction yielded nothing
      if (!domExtractionDone) {
        const evtFile = `asn-${asnId}-events-${ts}.png`;
        await expandFrameFull(page, 'detailFrame');
        await shotIframe(page, 'detailFrame', evtFile);
        asnEventsFiles.push(evtFile);
        console.log(`[TA] ASN ${asnId}: events page 1 captured (fallback) (${evtFile})`);
      }

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
        ? { results: asnFile, detail: asnDetailFile, lineItems: asnLineFile, events: asnEventsFiles }
        : { results: asnFile }
    });
  }

  // ── Write results JSON ────────────────────────────────────────────────────
  await fs.mkdir(path.dirname(resultsFile), { recursive: true });
  await fs.writeFile(resultsFile, JSON.stringify(results, null, 2), 'utf8');
});
