import { test, expect } from '@playwright/test';
import { Regression_TA_LoginPage } from '../pages/Regression_TA_LoginPage.js';

const fs = require('fs');
const path = require('path');
const { FileReader } = require('./utils/FileReader.js');
const { SCCHomepage } = require('../pages/SCCHomePage.js');
const { SCCViewListPage } = require('../pages/SCCViewListPage.js');
const { ListenDialog } = require('./utils/ListenDialog.js');
const { OrderSearchPage } = require('../pages/OrderSearchPage.js');
const { CarrierBookingPage } = require('../pages/CarrierBookingPage.js');
const { CarrierBookingEditPage } = require('../pages/CarrierBookingEditPage.js');
const { CarrierBookingApprovalPage } = require('../pages/CarrierBookingApproval.js');
const loginData = require('../tests-examples/Regression_TA_loginData.json');

const asnFilePath = 'tests\\asns.txt';
const fileReader = new FileReader(asnFilePath);
const asnFromFile = fileReader.getFileContents();
const RESULTS_FILE = path.join(__dirname, '..', 'multi-lines-edit-results.json');

test.setTimeout(600 * 1000);

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

async function retryStep(label, action, attempts = 2, delayMs = 1500) {
  let lastError;
  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    try {
      return await action();
    } catch (error) {
      lastError = error;
      console.log(`[multi-lines-edit] ${label} failed on attempt ${attempt}/${attempts}: ${error.message}`);
      if (attempt === attempts) throw error;
      await new Promise(resolve => setTimeout(resolve, delayMs * attempt));
    }
  }
  throw lastError;
}

async function acceptDialogIfPresent(listenDialog) {
  await listenDialog.acceptDialog().catch(() => {});
}

async function dismissMaestroPopup(page) {
  try {
    const exploreBtn = page.getByRole('button', { name: 'Explore on my own' });
    await exploreBtn.waitFor({ state: 'visible', timeout: 5000 });
    await exploreBtn.click();
  } catch {
    // Popup not present, continue
  }
}

async function navigateToOrderSearch(scchomePage, sccviewlistPage, listenDialog) {
  await retryStep('navigate to Order Search', async () => {
    await scchomePage.navigateToViewList();
    await sccviewlistPage.navigateToOrderSearch();
    await acceptDialogIfPresent(listenDialog);
  });
}

async function navigateToCarrierBooking(scchomePage, sccviewlistPage, listenDialog) {
  await retryStep('navigate to Carrier Booking Detail', async () => {
    await scchomePage.navigateToViewList();
    await sccviewlistPage.navigateToCarrierBooking();
    await acceptDialogIfPresent(listenDialog);
  });
}

async function navigateToCarrierApproval(scchomePage, sccviewlistPage) {
  await retryStep('navigate to Carrier Approval', async () => {
    await scchomePage.navigateToViewList();
    await sccviewlistPage.navigateToCarrierApproval();
  });
}

// ---------------------------------------------------------------------------
// Test
// ---------------------------------------------------------------------------

test('Create Draft Booking via Order Search then Edit Multiple Lines', async ({ page }) => {
  // Auto-accept all dialogs so they never block the edit form
  page.on('dialog', async dialog => {
    console.log(`[dialog] Auto-accepting: ${dialog.message()}`);
    await dialog.accept();
  });

  console.log(`[multi-lines-edit] Processing ASNs: ${asnFromFile}`);

  // --- Login ---
  const loginPage = new Regression_TA_LoginPage(page);
  await loginPage.goToLogin();
  await loginPage.enterEmail(loginData.email);
  await loginPage.enterCredentials(loginData.username, loginData.password);
  await dismissMaestroPopup(page);

  // --- Setup page objects ---
  const frame = page.frameLocator('iframe[name="clientframe"]');
  const scchomePage = new SCCHomepage(page);
  const sccviewlistPage = new SCCViewListPage(frame);
  const listenDialog = new ListenDialog(page);
  const ordersearchPage = new OrderSearchPage(page, frame);
  const carrierbookingPage = new CarrierBookingPage(page, frame);
  const carrierbookingeditPage = new CarrierBookingEditPage(frame, page);
  const carrierbookingapprovalPage = new CarrierBookingApprovalPage(frame);

  // --- Step 1: Search ASNs in Order Search and create a Draft booking ---
  await navigateToOrderSearch(scchomePage, sccviewlistPage, listenDialog);
  await retryStep('search ASN and create booking', async () => {
    await ordersearchPage.clearFilter();
    await ordersearchPage.fillasnAndSearch(asnFromFile);
    await acceptDialogIfPresent(listenDialog);
    await ordersearchPage.selectAndCreateBooking();
    await ordersearchPage.closeResult();
  });

  // --- Step 2: Navigate to Carrier Booking Detail and edit the multiple lines ---
  await navigateToCarrierBooking(scchomePage, sccviewlistPage, listenDialog);
  let submittedVbRef = null;
  await retryStep('filter, edit and submit booking lines', async () => {
    await carrierbookingPage.expandandClearFilter();
    await carrierbookingPage.searchWithasnAndstatus(asnFromFile);
    await carrierbookingPage.waitForGridToBeReady();

    const rowCount = await frame.locator('#resultTable .ui-grid-body-row').count();
    if (rowCount === 0) {
      throw new Error(`No Draft booking rows found for ASNs: ${asnFromFile} after booking creation.`);
    }
    console.log(`[multi-lines-edit] Found ${rowCount} booking line(s) to edit.`);

    // Select all rows and open the inline multi-line edit form
    await carrierbookingPage.selectAndEditBooking();

    // Edit line-level fields for all rows: No. of Cartons + Unit Weight
    await carrierbookingeditPage.editCarrierBookingDetails();

    // Edit header-level fields for all rows:
    //   Cargo Ready Date, Cargo Delivery Date,
    //   Carrier Booking Request Date, Traffic Mode (Origin)
    await carrierbookingeditPage.editCarrierHeaderDetails();

    await acceptDialogIfPresent(listenDialog);

    // Save and submit; captures the VB reference
    submittedVbRef = await carrierbookingeditPage.saveSubmitAfterEdit();
    await acceptDialogIfPresent(listenDialog);
  }, 2, 2000);

  // --- Step 3: Verify booking status ---
  const { vbReference, bookingStatus } = await retryStep('verify booking status after submit', async () => {
    await carrierbookingPage.expandandClearFilter();
    await carrierbookingPage.searchWithAsn(asnFromFile);
    if (submittedVbRef) {
      await carrierbookingPage.waitForGridToBeReady();
      const status = await carrierbookingPage.getBookingStatus(submittedVbRef, { waitForNonDraft: true });
      return { vbReference: submittedVbRef, bookingStatus: status };
    }
    return await carrierbookingPage.getActiveBookingResult({ waitForNonDraft: true });
  }, 3, 2000);

  console.log(`[multi-lines-edit] VB Reference : ${vbReference}`);
  console.log(`[multi-lines-edit] Booking Status: ${bookingStatus}`);

  // Write results for downstream tools
  const asnEntries = asnFromFile.split(',').map(a => a.trim()).filter(a => a.length > 0);
  const resultsToWrite = asnEntries.map(asn => ({ asn, vbReference, bookingStatus }));
  fs.writeFileSync(RESULTS_FILE, JSON.stringify(resultsToWrite, null, 2), 'utf-8');

  // --- Step 4: Approval flow if still Draft after submit ---
  if (bookingStatus.toLowerCase() === 'draft') {
    console.log('[multi-lines-edit] Booking is still Draft — running approval flow.');
    await retryStep('approve draft booking', async () => {
      await navigateToCarrierApproval(scchomePage, sccviewlistPage);
      await carrierbookingapprovalPage.fillasnAndSearch(asnFromFile);
      await carrierbookingapprovalPage.selectAndApproveBooking();
    }, 2, 2500);
  } else if (bookingStatus.toLowerCase() === 'submitted') {
    console.log('[multi-lines-edit] Booking status is Submitted — waiting for approver action.');
  } else {
    console.log(`[multi-lines-edit] Booking status after submit: ${bookingStatus}`);
  }

  expect(['submitted', 'approved', 'draft']).toContain(bookingStatus.toLowerCase());
  console.log('[multi-lines-edit] Test completed successfully.');
});
