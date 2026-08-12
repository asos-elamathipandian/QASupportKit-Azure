import { test } from '@playwright/test';
import { Regression_TA_LoginPage } from '../pages/Regression_TA_LoginPage.js';

const fs = require('fs');
const path = require('path');
const { SCCHomepage } = require('../pages/SCCHomePage.js');
const { SCCViewListPage } = require('../pages/SCCViewListPage.js');
const { CarrierBookingPage } = require('../pages/CarrierBookingPage.js');
const loginData = require('../tests-examples/Regression_TA_loginData.json');

const cancelAsn   = process.env.CANCEL_ASN_VALUE  || '';
const cancelVbRef = process.env.CANCEL_VB_VALUE   || '';
const RESULTS_FILE = path.resolve(__dirname, '..', 'cancel-booking-results.json');

test.setTimeout(120_000);

test('Cancel Booking', async ({ page }) => {
  if (!cancelVbRef) throw new Error('CANCEL_VB_VALUE environment variable is required');

  // Auto-accept all SCC confirmation dialogs
  page.on('dialog', async dialog => {
    console.log(`[dialog] Auto-accepting: ${dialog.message()}`);
    await dialog.accept();
  });

  const loginPage = new Regression_TA_LoginPage(page);
  await loginPage.goToLogin();
  await loginPage.enterEmail(loginData.email);
  await loginPage.enterCredentials(loginData.username, loginData.password);

  const frame = page.frameLocator('iframe[name="clientframe"]');
  const scchomePage      = new SCCHomepage(page);
  const sccviewlistPage  = new SCCViewListPage(frame);
  const carrierbookingPage = new CarrierBookingPage(page, frame);

  await scchomePage.navigateToViewList();
  await sccviewlistPage.navigateToCarrierBooking();

  // Expand filters — search by ASN+VB if ASN provided, otherwise by VB only
  await carrierbookingPage.expandandClearFilter();
  if (cancelAsn) {
    await carrierbookingPage.searchWithAsnAndVbRef(cancelAsn, cancelVbRef);
  } else {
    await carrierbookingPage.searchWithVbRef(cancelVbRef);
  }

  console.log(`[cancel] Cancelling booking ${cancelVbRef}${cancelAsn ? ` for ASN(s) ${cancelAsn}` : ''}`);
  const finalStatus = await carrierbookingPage.cancelAllMatchingRows(cancelVbRef);
  console.log(`[cancel] Final booking status: ${finalStatus}`);

  const asnList = cancelAsn ? cancelAsn.split(',').map(a => a.trim()).filter(Boolean) : [cancelVbRef];
  const results = asnList.map(a => ({ asn: a, vbReference: cancelVbRef, bookingStatus: finalStatus }));
  fs.writeFileSync(RESULTS_FILE, JSON.stringify(results, null, 2), 'utf-8');
  console.log(`CANCEL_RESULT: ${JSON.stringify(results[0])}`);
});
