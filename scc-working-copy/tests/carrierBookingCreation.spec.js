const { test, expect } = require('@playwright/test');
const { CookiePage } = require('../pages/CookiePage');
const { LoginPage } = require('../pages/LoginPage');
const { SCCHomepage } = require('../pages/SCCHomePage');
const { SCCViewListPage } = require('../pages/SCCViewListPage');
const { ListenDialog } = require('./utils/ListenDialog');
const { OrderSearchPage } = require('../pages/OrderSearchPage');
const { CarrierBookingPage } = require('../pages/CarrierBookingPage');
const { CarrierBookingEditPage } = require('../pages/CarrierBookingEditPage');
require('dotenv').config();

// Test data
const URL = 'https://asos.staging.e2open.com/pages/accept?destination=%2fasos%2f';
const USERNAME = process.env.USERID;
const PASSWORD = process.env.PASSWORD;
const ASN_FILE = 'tests\\asns.txt';
const { FileReader } = require('./utils/FileReader');
const asnFromFile = new FileReader(ASN_FILE).getFileContents();

// Helper to ensure we have credentials
function assertCreds() {
  if (!USERNAME || !PASSWORD) throw new Error('Missing USERID or PASSWORD in .env');
}

// Carrier Booking Creation Flow
// Splits logical steps using test.step for better trace visualisation

test('Create Carrier Booking from ASN', async ({ page }) => {
  assertCreds();
  const frame = page.frameLocator('iframe[name="clientframe"]');
  const cookiePage = new CookiePage(page);
  const loginPage = new LoginPage(page);
  const homePage = new SCCHomepage(page);
  const viewListPage = new SCCViewListPage(frame);
  const listenDialog = new ListenDialog(page);
  const orderSearchPage = new OrderSearchPage(page, frame);
  const carrierBookingPage = new CarrierBookingPage(frame);
  const carrierBookingEditPage = new CarrierBookingEditPage(frame);

  await test.step('Navigate & Accept Cookies', async () => {
    await cookiePage.gotoPage(URL);
    await cookiePage.agreeCookies();
  });

  // Step intentionally skipped: User Community selection.
  // Assumption: Direct navigation to URL now lands on SSO email screen or already selected tenant.

  await test.step('Manual SSO Login (user action)', async () => {
    // User manually enters email & completes SSO.
    // Script will dynamically handle community selection if it reappears and wait for menu/app readiness.
    
    // Debug info before attempting menu
    console.log('=== DEBUG: Post-login state ===');
    console.log('URL:', page.url());
    console.log('Menu button count:', await page.locator('.eto-header__menu-toggle').count());
    console.log('Iframe count:', await page.locator('iframe[name="clientframe"]').count());
    
    await loginPage.ensurePostLoginAndMenu();
    
    // Verify menu opened or continue anyway
    console.log('=== DEBUG: After menu attempt ===');
    await page.screenshot({ path: 'debug-after-menu.png', fullPage: true }).catch(() => {});
  });

  await test.step('Search ASN and Create Booking', async () => {
    await homePage.navigateToViewList();
    await viewListPage.navigateToOrderSearch();
    await listenDialog.acceptDialog();
    await orderSearchPage.clearFilter();
    await orderSearchPage.fillasnAndSearch(asnFromFile);
    await listenDialog.acceptDialog();
    await orderSearchPage.selectAndCreateBooking();
    await orderSearchPage.closeResult();
  });

  await test.step('Edit Carrier Booking Details', async () => {
    await homePage.navigateToViewList();
    await viewListPage.navigateToCarrierBooking();
    await listenDialog.acceptDialog();
    await carrierBookingPage.expandandClearFilter();
    await carrierBookingPage.searchWithasnAndstatus(asnFromFile);
    await carrierBookingPage.selectAndEditBooking();
    await carrierBookingEditPage.editCarrierBookingDetails();
    await carrierBookingEditPage.editCarrierHeaderDetails();
    await listenDialog.acceptDialog();
    await carrierBookingEditPage.saveSubmitAfterEdit();
    await listenDialog.acceptDialog();
  });

  // Basic assertion placeholder (improve with actual VB value capture)
  await test.step('Validate Submission Placeholder', async () => {
    // Here you would assert a success toast or presence of booking in list
    // For now we just assert page title contains ASOS as a lightweight check
    await expect(page).toHaveTitle(/ASOS/i);
  });
});
