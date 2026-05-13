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

const asnFilePath = path.join(__dirname, 'asns.txt');
const fileReader = new FileReader(asnFilePath);
const asnFromFile = fileReader.getFileContents();
const asnList = asnFromFile.split(',').map(a => a.trim()).filter(a => a.length > 0);
const RESULTS_FILE = path.join(__dirname, '..', 'booking-results.json');

async function retryStep(label, action, attempts = 2, delayMs = 1500) {
  let lastError;
  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    try {
      return await action();
    } catch (error) {
      lastError = error;
      console.log(`[booking-step] ${label} failed on attempt ${attempt}/${attempts}: ${error.message}`);
      if (attempt === attempts) {
        throw error;
      }
      await new Promise((resolve) => setTimeout(resolve, delayMs * attempt));
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
  await retryStep('navigate to Carrier Booking', async () => {
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

test('Single ASN Booking - Create separate booking for each ASN', async ({ page }) => {
  test.setTimeout(240 * 1000 * asnList.length);
  const bookingResults = [];

  const loginPage = new Regression_TA_LoginPage(page);

  // Login once
  await loginPage.goToLogin();
  await loginPage.enterEmail(loginData.email);
  await loginPage.enterCredentials(loginData.username, loginData.password);
  await dismissMaestroPopup(page);

  const frame = page.frameLocator('iframe[name="clientframe"]');
  const scchomePage = new SCCHomepage(page);
  const sccviewlistPage = new SCCViewListPage(frame);
  const listenDialog = new ListenDialog(page);
  const ordersearchPage = new OrderSearchPage(page, frame);
  const carrierbookingPage = new CarrierBookingPage(page, frame);
  const carrierbookingeditPage = new CarrierBookingEditPage(frame);
  const carrierbookingapprovalPage = new CarrierBookingApprovalPage(frame);

  // Loop through each ASN and create a separate booking
  for (let i = 0; i < asnList.length; i++) {
    const currentASN = asnList[i];
    console.log(`Processing ASN ${i + 1} of ${asnList.length}: ${currentASN}`);

    // Navigate to Order Search and create booking for this ASN
    await navigateToOrderSearch(scchomePage, sccviewlistPage, listenDialog);
    await retryStep(`create booking for ASN ${currentASN}`, async () => {
      await ordersearchPage.clearFilter();
      await ordersearchPage.fillasnAndSearch(currentASN);
      await acceptDialogIfPresent(listenDialog);
      await ordersearchPage.selectAndCreateBooking();
      await ordersearchPage.closeResult();
    });

    // Navigate to Carrier Booking and edit
    await navigateToCarrierBooking(scchomePage, sccviewlistPage, listenDialog);
    await retryStep(`edit booking for ASN ${currentASN}`, async () => {
      await carrierbookingPage.expandandClearFilter();
      await carrierbookingPage.searchWithasnAndstatus(currentASN);
      await carrierbookingPage.selectAndEditBooking();
      await carrierbookingeditPage.editCarrierBookingDetails();
      await carrierbookingeditPage.editCarrierHeaderDetails();
      await acceptDialogIfPresent(listenDialog);
      await carrierbookingeditPage.saveSubmitAfterEdit();
      await acceptDialogIfPresent(listenDialog);
    }, 2, 2000);

    // Fetch booking outcome
    const { vbReference, bookingStatus } = await retryStep(`fetch outcome for ASN ${currentASN}`, async () => {
      await carrierbookingPage.expandandClearFilter();
      await carrierbookingPage.searchWithAsn(currentASN);
      const vbRef = await carrierbookingPage.getVBReference();
      const status = await carrierbookingPage.getBookingStatus();
      return { vbReference: vbRef, bookingStatus: status };
    }, 3, 2000);

    console.log(`VB Reference: ${vbReference}`);
    console.log(`Booking Status: ${bookingStatus}`);
    bookingResults.push({ asn: currentASN, vbReference, bookingStatus });

    // Approve if status is Draft
    if (bookingStatus.toLowerCase() === 'draft') {
      console.log('Status is Draft. Proceeding with approval flow.');
      await retryStep(`approve booking for ASN ${currentASN}`, async () => {
        await navigateToCarrierApproval(scchomePage, sccviewlistPage);
        await ordersearchPage.clearFilter();
        await carrierbookingapprovalPage.fillasnAndSearch(currentASN);
        await carrierbookingapprovalPage.selectAndApproveBooking();
      }, 2, 2500);
    } else if (bookingStatus.toLowerCase() === 'submitted') {
      console.log('Status is Submitted. Skipping approval flow.');
    } else {
      console.log(`Unexpected booking status: ${bookingStatus}. Skipping approval flow.`);
    }

    console.log(`Booking completed for ASN: ${currentASN}`);
    // Write results after each ASN so partial results are available on failure
    fs.writeFileSync(RESULTS_FILE, JSON.stringify(bookingResults, null, 2), 'utf-8');
  }

  console.log(`All ${asnList.length} bookings completed successfully.`);
});
