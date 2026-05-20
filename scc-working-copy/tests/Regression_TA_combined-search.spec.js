import { test } from '@playwright/test';
import path from 'path';
import { promises as fs } from 'fs';
const data = require('../tests-examples/Regression_TA_loginData.json');
import { Regression_TA_LoginPage } from '../pages/Regression_TA_LoginPage.js';
import { Regression_TA_MenuPage } from '../pages/Regression_TA_MenuPage.js';
import { Regression_TA_ProductSearchPage } from '../pages/Regression_TA_ProductSearchPage.js';
import { Regression_TA_POSearchPage } from '../pages/Regression_TA_PO_SearchPage.js';
import { Regression_TA_ASNSearchPage } from '../pages/Regression_TA_ASN_SearchPage.js';

const reportPath = path.resolve('test-results', 'search-status.txt');
const screenshotDir = path.resolve('test-results', 'screenshots');

async function resetReport() {
  await fs.mkdir(path.dirname(reportPath), { recursive: true });
  await fs.writeFile(reportPath, '');
}

async function appendReport(message) {
  const timestamp = new Date().toISOString();
  const line = `[${timestamp}] ${message}\n`;
  await fs.mkdir(path.dirname(reportPath), { recursive: true });
  await fs.writeFile(reportPath, line, { flag: 'a' });
}

async function captureScreenshot(page, filename) {
  await fs.mkdir(screenshotDir, { recursive: true });
  const screenshotPath = path.resolve(screenshotDir, filename);
  await page.screenshot({ path: screenshotPath, fullPage: true });
  return screenshotPath;
}

test('Regression | Combined SKU, PO and ASN search flow', async ({ page }) => {
  const loginPage = new Regression_TA_LoginPage(page);
  const menuPage = new Regression_TA_MenuPage(page);
  const productSearch = new Regression_TA_ProductSearchPage(page);
  const poSearch = new Regression_TA_POSearchPage(page);
  const asnSearch = new Regression_TA_ASNSearchPage(page);

  await resetReport();

  await loginPage.goToLogin();
  await loginPage.enterEmail(data.email);
  await loginPage.enterCredentials(data.username, data.password);

  await menuPage.openProducts();
  const skuFound = await productSearch.searchProduct(data.sku);
  const skuScreenshotName = `sku-${data.sku}-${Date.now()}.png`;

  if (skuFound) {
    await productSearch.verifyBackButton();
    await page.waitForTimeout(10000);
    await captureScreenshot(page, skuScreenshotName);
    await appendReport('SKU found');
    await productSearch.clickBack();
  } else {
    await captureScreenshot(page, skuScreenshotName);
    await appendReport('No sku found');
  }

  await menuPage.openLogistics();
  const poFound = await poSearch.searchPO(data.poId);
  const poScreenshotName = `po-${data.poId}-${Date.now()}.png`;

  if (poFound) {
    await poSearch.verifyResults();
    await page.waitForTimeout(20000);
    await captureScreenshot(page, poScreenshotName);
    await appendReport('PO found');
    await poSearch.clickBack();
  } else {
    await page.waitForTimeout(5000);
    await captureScreenshot(page, poScreenshotName);
    await appendReport('No po found');
  }

  await menuPage.openLogistics('Shipment Search Search Power');
  const asnFound = await asnSearch.searchASN(data.asnId);
  const asnScreenshotName = `asn-${data.asnId}-${Date.now()}.png`;

  if (asnFound) {
    await asnSearch.verifyResults();
    await page.waitForTimeout(15000);
    await captureScreenshot(page, asnScreenshotName);
    await appendReport('ASN found');
    await asnSearch.clickBack();
  } else {
    await page.waitForTimeout(5000);
    await captureScreenshot(page, asnScreenshotName);
    await appendReport('No asn found');
  }

  await appendReport(`Summary: SKU=${skuFound ? 'found' : 'not found'}, PO=${poFound ? 'found' : 'not found'}, ASN=${asnFound ? 'found' : 'not found'}`);
});
