import { test } from '@playwright/test';
import { Regression_TA_LoginPage } from '../pages/Regression_TA_LoginPage.js';

const fs = require('fs');
const path = require('path');
const { SCCHomepage } = require('../pages/SCCHomePage.js');
const { SCCViewListPage } = require('../pages/SCCViewListPage.js');
const { ListenDialog } = require('./utils/ListenDialog.js');
const { OrderSearchPage } = require('../pages/OrderSearchPage.js');
const { CarrierBookingPage } = require('../pages/CarrierBookingPage.js');
const { CarrierBookingEditPage } = require('../pages/CarrierBookingEditPage.js');
const { CarrierBookingApprovalPage } = require('../pages/CarrierBookingApproval.js');
const loginData = require('../tests-examples/Regression_TA_loginData.json');

const asnInput = process.env.FULL_FLOW_ASN_VALUE || '';
const RESULTS_FILE = path.resolve(__dirname, '..', 'full-scc-flow-results.json');
const AUTH_STATE_FILE = path.resolve(__dirname, '..', 'asn-lookup-auth.json');
const AUTH_STATE_MAX_AGE_MS = 30 * 60 * 1000;

test.setTimeout(300_000);

function writeResults(data) {
  try {
    fs.writeFileSync(RESULTS_FILE, JSON.stringify(data, null, 2), 'utf-8');
    console.log(`[full-flow] Results written to ${RESULTS_FILE}`);
  } catch (e) {
    console.log(`[full-flow] Failed to write results: ${e.message}`);
  }
}

function hasFreshAuthState() {
  try {
    if (!fs.existsSync(AUTH_STATE_FILE)) return false;
    return (Date.now() - fs.statSync(AUTH_STATE_FILE).mtimeMs) < AUTH_STATE_MAX_AGE_MS;
  } catch { return false; }
}

async function dismissMaestroPopup(page) {
  try {
    const btn = page.getByRole('button', { name: 'Explore on my own' });
    await btn.waitFor({ state: 'visible', timeout: 3000 });
    await btn.click();
  } catch {}
}

async function retryStep(label, action, attempts = 2, delayMs = 1500) {
  let lastError;
  for (let i = 1; i <= attempts; i++) {
    try { return await action(); }
    catch (e) {
      lastError = e;
      console.log(`[full-flow] ${label} attempt ${i}/${attempts} failed: ${e.message}`);
      if (i < attempts) await new Promise(r => setTimeout(r, delayMs * i));
    }
  }
  throw lastError;
}

async function fullLogin(page) {
  const lp = new Regression_TA_LoginPage(page);
  await lp.goToLogin();
  await lp.enterEmail(loginData.email);
  await lp.enterCredentials(loginData.username, loginData.password);
  await dismissMaestroPopup(page);
  await page.context().storageState({ path: AUTH_STATE_FILE });
  console.log('[full-flow] Auth state saved');
}

async function resumeSession(page) {
  await page.goto('https://asos.staging.e2open.com/asos/', { waitUntil: 'domcontentloaded' });
  await page.locator('.eto-header__menu-toggle').first().waitFor({ state: 'visible', timeout: 10000 });
  console.log('[full-flow] Resumed session from saved auth state');
}

test('Full SCC Flow', async ({ browser }) => {
  if (!asnInput) throw new Error('FULL_FLOW_ASN_VALUE environment variable is required');

  const asnList = asnInput.split(',').map(a => a.trim()).filter(Boolean);
  console.log(`[full-flow] Processing ASNs: ${asnList.join(', ')}`);

  // ── Login ──
  const useSaved = hasFreshAuthState();
  let context, page;

  if (useSaved) {
    console.log('[full-flow] Reusing saved auth state');
    context = await browser.newContext({ storageState: AUTH_STATE_FILE });
    page = await context.newPage();
    try { await resumeSession(page); } catch {
      console.log('[full-flow] Saved auth stale, performing full login');
      await context.close();
      context = await browser.newContext();
      page = await context.newPage();
      await fullLogin(page);
    }
  } else {
    console.log('[full-flow] No saved auth state, performing full login');
    context = await browser.newContext();
    page = await context.newPage();
    await fullLogin(page);
  }

  const frame = page.frameLocator('iframe[name="clientframe"]');
  const scchomePage = new SCCHomepage(page);
  const sccviewlistPage = new SCCViewListPage(frame);
  const listenDialog = new ListenDialog(page);
  const ordersearchPage = new OrderSearchPage(page, frame);
  const carrierbookingPage = new CarrierBookingPage(page, frame);
  const carrierbookingeditPage = new CarrierBookingEditPage(frame, page);
  const carrierbookingapprovalPage = new CarrierBookingApprovalPage(frame);

  // ── Step 1: ASN Lookup ──
  console.log('[full-flow] Step 1: ASN Lookup');

  await retryStep('navigate to Order Search', async () => {
    await scchomePage.navigateToViewList();
    await sccviewlistPage.navigateToOrderSearch();
    await listenDialog.acceptDialog().catch(() => {});
  });

  await retryStep('search ASN', async () => {
    try { await ordersearchPage.clearFilter(); } catch {}
    await ordersearchPage.fillasnAndSearch(asnInput);
  });

  // Wait for results to render
  await frame.locator('#loading.ui-loading-overlay').waitFor({ state: 'hidden', timeout: 15000 }).catch(() => {});
  await page.waitForTimeout(2000);

  // Extract data from result rows
  const details = [];
  let hasActiveBooking = false;
  const activeBookingInfo = [];

  const dataRows = frame.locator('#resultTable .ui-grid-body-row');
  const rowCount = await dataRows.count();
  console.log(`[full-flow] Found ${rowCount} result row(s)`);

  if (rowCount === 0) {
    const result = { ok: false, error: 'ASN(s) not found in SCC Order Search', asns: asnInput, details: [] };
    writeResults(result);
    console.log(`FULL_FLOW_RESULT: ${JSON.stringify(result)}`);
    await context.close();
    throw new Error(result.error);
  }

  for (let i = 0; i < rowCount; i++) {
    const row = dataRows.nth(i);
    const cell = async (field) => {
      const el = row.locator(`[id^="resultfield_${field}"]`);
      return (await el.count()) > 0 ? (await el.first().textContent({ timeout: 2000 })).trim() : '';
    };

    const asn = await cell('apppoitem_UDF_Text_5');
    const po = await cell('apppoBuyerOrderNo');
    const sku = await cell('apppoitemStyleNo');
    const units = await cell('apppoitemQuantity');
    const carrier = await cell('apppo_UDF_Text_4');
    const bookingStatus = await cell('appvbStatus');
    const vbRef = await cell('appvbBookingNo');

    console.log(`[full-flow] Row ${i}: ASN=${asn} PO=${po} SKU=${sku} Units=${units} Carrier=${carrier} Status=${bookingStatus} VB=${vbRef}`);

    if (bookingStatus && bookingStatus.toLowerCase() !== 'cancelled') {
      hasActiveBooking = true;
      activeBookingInfo.push(`${asn} (${bookingStatus} / ${vbRef})`);
    }

    details.push({ asn, po, sku, units, carrier, bookingStatus, vbRef });
  }

  if (hasActiveBooking) {
    const result = {
      ok: false,
      error: `Active (non-cancelled) booking already exists: ${activeBookingInfo.join(', ')}`,
      asns: asnInput,
      details
    };
    writeResults(result);
    console.log(`FULL_FLOW_RESULT: ${JSON.stringify(result)}`);
    await context.close();
    throw new Error(result.error);
  }

  console.log('[full-flow] Validation passed — no active bookings');

  // ── Step 2: Create Booking ──
  console.log('[full-flow] Step 2: Creating booking');

  await listenDialog.acceptDialog();
  // Use .click() instead of .check() — .check() fails when cancelled booking rows
  // cause the select-all checkbox state to not toggle as expected
  await frame.locator('#resultTable-select-all').waitFor();
  await frame.locator('#resultTable-select-all').evaluate(el => {
    if (typeof jQuery !== 'undefined') jQuery(el).trigger('click');
    else if (typeof $ !== 'undefined') $(el).trigger('click');
    else el.click();
  });
  await frame.getByRole('button', { name: 'Create Booking' }).click();
  await ordersearchPage.closeResult();

  // ── Step 3: Edit Carrier Booking ──
  console.log('[full-flow] Step 3: Editing carrier booking');

  await scchomePage.navigateToViewList();
  await sccviewlistPage.navigateToCarrierBooking();
  await listenDialog.acceptDialog();
  await carrierbookingPage.expandandClearFilter();
  await carrierbookingPage.searchWithasnAndstatus(asnInput);

  // Extract VB reference from results
  const vbElement = frame.locator('[title*="VB-000"]').first();
  await vbElement.waitFor({ timeout: 15000 });
  const vbReference = (await vbElement.textContent()).trim();
  console.log(`[full-flow] VB Reference: ${vbReference}`);

  await carrierbookingPage.selectAndEditBooking();
  await carrierbookingeditPage.editCarrierBookingDetails();
  await carrierbookingeditPage.editCarrierHeaderDetails();
  await listenDialog.acceptDialog();
  await carrierbookingeditPage.saveSubmitAfterEdit();
  await listenDialog.acceptDialog();

  // ── Step 4: Check booking status and approve only if needed ──
  console.log('[full-flow] Step 4: Checking booking status after submission');
  // Close any error banner from the submit (e.g. "Fail to execute", tolerance exception)
  await frame.locator('[title="Close"], .eto-toast__close, [aria-label="Close"]').first()
    .click({ timeout: 3000 }).catch(() => {});

  await scchomePage.navigateToViewList();
  await sccviewlistPage.navigateToCarrierBooking();
  await listenDialog.acceptDialog();
  await carrierbookingPage.expandandClearFilter();
  // Search without status filter to see whatever status the booking has now
  await carrierbookingPage.searchWithAsn(asnInput);

  const postSubmitStatus = await carrierbookingPage.getBookingStatus(vbReference);
  console.log(`[full-flow] Post-submit booking status: ${postSubmitStatus} (for ${vbReference})`);

  let finalBookingStatus = postSubmitStatus;
  let approvalNeeded = false;
  if (postSubmitStatus.toLowerCase() === 'draft') {
    approvalNeeded = true;
    console.log('[full-flow] Booking status is Draft — approval required');

    await scchomePage.navigateToViewList();
    await sccviewlistPage.navigateToCarrierApproval();
    await ordersearchPage.clearFilter();
    await carrierbookingapprovalPage.fillasnAndSearch(asnInput);
    await carrierbookingapprovalPage.selectAndApproveBooking();

    // Read actual post-approval status from carrier booking list
    await scchomePage.navigateToViewList();
    await sccviewlistPage.navigateToCarrierBooking();
    await listenDialog.acceptDialog().catch(() => {});
    await carrierbookingPage.expandandClearFilter();
    await carrierbookingPage.searchWithAsn(asnInput);
    finalBookingStatus = await carrierbookingPage.getBookingStatus(vbReference).catch(() => 'Approved');
    console.log(`[full-flow] Post-approval booking status: ${finalBookingStatus}`);
    console.log('[full-flow] Booking approved successfully');
  } else {
    console.log(`[full-flow] Booking status is "${postSubmitStatus}" — already submitted, no approval needed`);
  }

  // ── Write final results ──
  // Filter out cancelled booking rows; if all are cancelled (re-booking scenario)
  // deduplicate by ASN+PO+SKU to avoid showing stale cancelled entries
  const nonCancelled = details.filter(d => !d.bookingStatus || d.bookingStatus.toLowerCase() !== 'cancelled');
  let outputDetails;
  if (nonCancelled.length > 0) {
    outputDetails = nonCancelled;
  } else {
    // All rows are cancelled — deduplicate by ASN+PO+SKU
    const seen = new Set();
    outputDetails = details.filter(d => {
      const key = `${d.asn}|${d.po}|${d.sku}`;
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });
  }

  const result = {
    ok: true,
    vbReference,
    bookingStatus: finalBookingStatus,
    approvalPerformed: approvalNeeded,
    asns: asnInput,
    details: outputDetails.map(d => ({
      asn: d.asn,
      po: d.po,
      sku: d.sku,
      units: d.units,
      carrier: d.carrier
    }))
  };
  writeResults(result);
  console.log(`FULL_FLOW_RESULT: ${JSON.stringify(result)}`);

  await context.close();
});
