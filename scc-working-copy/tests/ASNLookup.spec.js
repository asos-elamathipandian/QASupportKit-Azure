import { test, expect } from '@playwright/test';
import { Regression_TA_LoginPage } from '../pages/Regression_TA_LoginPage.js';

const fs = require('fs');
const path = require('path');
const { SCCHomepage } = require('../pages/SCCHomePage.js');
const { SCCViewListPage } = require('../pages/SCCViewListPage.js');
const { ListenDialog } = require('./utils/ListenDialog.js');
const { OrderSearchPage } = require('../pages/OrderSearchPage.js');
const loginData = require('../tests-examples/Regression_TA_loginData.json');

// ASN is passed via environment variable
const asnToLookup = process.env.ASN_LOOKUP_VALUE || '';

const RESULTS_FILE = path.resolve(__dirname, '..', 'asn-lookup-results.json');

// Auth state file for session reuse across lookups
const AUTH_STATE_FILE = path.resolve(__dirname, '..', 'asn-lookup-auth.json');
const AUTH_STATE_MAX_AGE_MS = 30 * 60 * 1000; // 30 minutes

test.setTimeout(120 * 1000);

function hasFreshAuthState() {
  try {
    if (!fs.existsSync(AUTH_STATE_FILE)) return false;
    const stat = fs.statSync(AUTH_STATE_FILE);
    return (Date.now() - stat.mtimeMs) < AUTH_STATE_MAX_AGE_MS;
  } catch {
    return false;
  }
}

async function dismissMaestroPopup(page) {
  try {
    const exploreBtn = page.getByRole('button', { name: 'Explore on my own' });
    await exploreBtn.waitFor({ state: 'visible', timeout: 3000 });
    await exploreBtn.click();
  } catch {
    // Popup not present, continue
  }
}

async function retryStep(label, action, attempts = 2, delayMs = 1500) {
  let lastError;
  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    try {
      return await action();
    } catch (error) {
      lastError = error;
      console.log(`[asn-lookup] ${label} failed on attempt ${attempt}/${attempts}: ${error.message}`);
      if (attempt === attempts) throw error;
      await new Promise((resolve) => setTimeout(resolve, delayMs * attempt));
    }
  }
  throw lastError;
}

async function fullLogin(page) {
  const loginPage = new Regression_TA_LoginPage(page);
  await loginPage.goToLogin();
  await loginPage.enterEmail(loginData.email);
  await loginPage.enterCredentials(loginData.username, loginData.password);
  await dismissMaestroPopup(page);
  // Save auth state for future reuse
  await page.context().storageState({ path: AUTH_STATE_FILE });
  console.log('[asn-lookup] Auth state saved for reuse');
}

async function resumeSession(page) {
  // Go directly to ASOS SCC with saved cookies
  await page.goto('https://asos.staging.e2open.com/asos/', { waitUntil: 'domcontentloaded' });
  // Verify we're actually authenticated by checking for the menu
  const menuToggle = page.locator('.eto-header__menu-toggle').first();
  await menuToggle.waitFor({ state: 'visible', timeout: 10000 });
  console.log('[asn-lookup] Resumed session from saved auth state');
}

test('ASN Lookup in SCC', async ({ browser }) => {
  if (!asnToLookup) {
    throw new Error('ASN_LOOKUP_VALUE environment variable is required');
  }

  const useSavedAuth = hasFreshAuthState();
  let context;
  let page;

  if (useSavedAuth) {
    console.log('[asn-lookup] Reusing saved auth state (skipping login)');
    context = await browser.newContext({ storageState: AUTH_STATE_FILE });
    page = await context.newPage();
    try {
      await resumeSession(page);
    } catch {
      // Saved state is stale, fall back to full login
      console.log('[asn-lookup] Saved auth stale, performing full login');
      await context.close();
      context = await browser.newContext();
      page = await context.newPage();
      await fullLogin(page);
    }
  } else {
    console.log('[asn-lookup] No saved auth state, performing full login');
    context = await browser.newContext();
    page = await context.newPage();
    await fullLogin(page);
  }

  const frame = page.frameLocator('iframe[name="clientframe"]');
  const scchomePage = new SCCHomepage(page);
  const sccviewlistPage = new SCCViewListPage(frame);
  const listenDialog = new ListenDialog(page);
  const ordersearchPage = new OrderSearchPage(page, frame);

  // Navigate to ASOS Order Search
  await retryStep('navigate to Order Search', async () => {
    await scchomePage.navigateToViewList();
    await sccviewlistPage.navigateToOrderSearch();
    await listenDialog.acceptDialog().catch(() => {});
  });

  // Clear existing filters and search for the ASN
  await retryStep('search ASN', async () => {
    try {
      await ordersearchPage.clearFilter();
    } catch {
      console.log('[asn-lookup] clearFilter skipped (no message block on first load)');
    }
    await ordersearchPage.fillasnAndSearch(asnToLookup);
    await listenDialog.acceptDialog().catch(() => {});
  });

  // Wait for loading overlay to disappear
  await frame.locator('#loading.ui-loading-overlay').waitFor({ state: 'hidden', timeout: 15000 }).catch(() => {});

  // Brief wait for grid render
  await page.waitForTimeout(2000);

  // Parse individual ASNs from the comma-separated input
  const asnList = asnToLookup.split(',').map(a => a.trim()).filter(Boolean);
  const perAsn = {};
  for (const asn of asnList) {
    perAsn[asn] = { found: false, records: 0 };
  }

  // Detect results using multiple strategies
  let totalRecords = 0;
  let gridHasResults = false;

  // Strategy 1: Check the record count text (e.g. "1 records — record 1 - 1")
  try {
    const recordCountText = await frame.locator('.paging-text, .record-count, [class*="paging"]').first().textContent({ timeout: 5000 });
    console.log(`[asn-lookup] Record count text: ${recordCountText}`);
    const countMatch = recordCountText.match(/(\d+)\s*records?/i);
    if (countMatch && parseInt(countMatch[1], 10) > 0) {
      totalRecords = parseInt(countMatch[1], 10);
      gridHasResults = true;
    }
  } catch {
    console.log('[asn-lookup] Could not read record count text');
  }

  // Strategy 2: Check if select-all checkbox is visible
  if (!gridHasResults) {
    try {
      const selectAll = frame.locator('#resultTable-select-all');
      await selectAll.waitFor({ state: 'visible', timeout: 3000 });
      gridHasResults = true;
      console.log('[asn-lookup] Found via select-all checkbox');
    } catch {
      console.log('[asn-lookup] select-all checkbox not visible');
    }
  }

  // Strategy 3: Check for any data row with a checkbox input in the result table
  if (!gridHasResults) {
    try {
      const dataRows = frame.locator('#resultTable input[type="checkbox"]');
      const count = await dataRows.count();
      console.log(`[asn-lookup] Row checkboxes found: ${count}`);
      gridHasResults = count > 1;
    } catch {
      console.log('[asn-lookup] Could not count row checkboxes');
    }
  }

  // Strategy 4: Look for record count in body text
  if (!gridHasResults) {
    try {
      const bodyText = await frame.locator('body').textContent({ timeout: 3000 });
      if (/\d+\s*records/i.test(bodyText)) {
        const m = bodyText.match(/(\d+)\s*records/i);
        if (m && parseInt(m[1], 10) > 0) {
          totalRecords = parseInt(m[1], 10);
          gridHasResults = true;
          console.log(`[asn-lookup] Found via body text: ${m[0]}`);
        }
      }
    } catch {
      console.log('[asn-lookup] Could not read body text');
    }
  }

  // Extract per-ASN record counts from result table rows
  const rowDetails = []; // collected row-level data: { asn, po, sku, qty, ... }

  if (gridHasResults) {
    // E2Open uses a custom div-based ui-grid, not standard HTML tables.
    // Data rows are div.ui-grid-body-row inside #resultTable.
    // Cell values live in spans with id pattern: resultfield_{fieldName}_{rowId}
    try {
      const dataRows = frame.locator('#resultTable .ui-grid-body-row');
      const rowCount = await dataRows.count();
      console.log(`[asn-lookup] Data rows found: ${rowCount}`);
      if (totalRecords === 0) totalRecords = rowCount;

      for (let i = 0; i < rowCount; i++) {
        try {
          const row = dataRows.nth(i);

          // Helper to extract cell text using E2Open's resultfield_ id pattern
          const getCellText = async (fieldName) => {
            const cell = row.locator(`[id^="resultfield_${fieldName}"]`);
            if (await cell.count() > 0) {
              return (await cell.first().textContent({ timeout: 2000 })).trim();
            }
            return '';
          };

          const asn = await getCellText('apppoitem_UDF_Text_5');
          const po = await getCellText('apppoBuyerOrderNo');
          const sku = await getCellText('apppoitemStyleNo');
          const optionId = await getCellText('apppoitemStyleName');
          const units = await getCellText('apppoitemQuantity');
          const poSkuQty = await getCellText('apppoitem_UDF_Number_2');
          const bookedUnits = await getCellText('apppoitemBookedQty');
          const receivedUnits = await getCellText('apppoitemReceivedQty');
          const poStatus = await getCellText('apppoitemStatus');
          const bookingStatus = await getCellText('appvbStatus');
          const vbRef = await getCellText('appvbBookingNo');
          const carrier = await getCellText('apppo_UDF_Text_4');

          console.log(`[asn-lookup] Row ${i}: ASN=${asn}, PO=${po}, SKU=${sku}, Units=${units}, Carrier=${carrier}`);

          // Match to input ASN list
          let matchedAsn = null;
          for (const a of asnList) {
            if (asn === a || asn.includes(a)) {
              matchedAsn = a;
              perAsn[a].found = true;
              perAsn[a].records += 1;
              break;
            }
          }

          if (matchedAsn) {
            rowDetails.push({
              asn: matchedAsn, po, sku, optionId, units,
              poSkuQty, bookedUnits, receivedUnits,
              poStatus, bookingStatus, vbRef, carrier
            });
          }
        } catch (rowErr) {
          console.log(`[asn-lookup] Could not read row ${i}: ${rowErr.message}`);
        }
      }
    } catch (err) {
      console.log(`[asn-lookup] Failed to extract grid data: ${err.message}`);
    }

    // Fallback: if no per-ASN results found via rows, check full table/body text
    const anyMatched = Object.values(perAsn).some(v => v.found);
    if (!anyMatched) {
      console.log('[asn-lookup] Row parsing found nothing, trying full text fallback');
      try {
        const tableText = await frame.locator('#resultTable').textContent({ timeout: 5000 });
        console.log(`[asn-lookup] Table text length: ${tableText.length}`);
        for (const asn of asnList) {
          if (tableText.includes(asn)) {
            perAsn[asn].found = true;
            console.log(`[asn-lookup] Found ${asn} in table text`);
          }
        }
      } catch (err2) {
        console.log(`[asn-lookup] Table text fallback failed: ${err2.message}`);
        try {
          const bodyText = await frame.locator('body').textContent({ timeout: 5000 });
          for (const asn of asnList) {
            if (bodyText.includes(asn)) {
              perAsn[asn].found = true;
              console.log(`[asn-lookup] Found ${asn} in body text`);
            }
          }
        } catch {
          // Last resort: if grid has results and single ASN, mark found
          if (asnList.length === 1) {
            perAsn[asnList[0]].found = true;
            perAsn[asnList[0]].records = totalRecords;
          }
        }
      }
    }
  }

  // Aggregate details per ASN
  for (const asn of asnList) {
    if (!perAsn[asn].details) perAsn[asn].details = [];
    for (const d of rowDetails) {
      if (d.asn === asn) {
        perAsn[asn].details.push({
          po: d.po || '', sku: d.sku || '', optionId: d.optionId || '',
          units: d.units || '', poSkuQty: d.poSkuQty || '',
          bookedUnits: d.bookedUnits || '', receivedUnits: d.receivedUnits || '',
          poStatus: d.poStatus || '', bookingStatus: d.bookingStatus || '',
          vbRef: d.vbRef || '', carrier: d.carrier || ''
        });
      }
    }
  }

  // Write structured results to a JSON file for the web server to read
  const lookupResults = { totalRecords, perAsn, rowDetails };
  try {
    fs.writeFileSync(RESULTS_FILE, JSON.stringify(lookupResults, null, 2), 'utf-8');
    console.log(`[asn-lookup] Results written to ${RESULTS_FILE}`);
  } catch (e) {
    console.log(`[asn-lookup] Failed to write results file: ${e.message}`);
  }

  // Output structured results as JSON for the caller to parse
  console.log(`ASN_LOOKUP_RESULTS: ${JSON.stringify({ totalRecords, perAsn })}`);

  // Keep legacy output for backward compatibility
  const anyFound = Object.values(perAsn).some(v => v.found);
  console.log(`ASN_LOOKUP_RESULT: ${anyFound ? 'FOUND' : 'NOT_FOUND'}`);
  console.log(`ASN_LOOKUP_ASN: ${asnToLookup}`);

  await context.close();
});
