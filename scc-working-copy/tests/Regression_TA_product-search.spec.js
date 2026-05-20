import { test, expect } from '@playwright/test';
import path from 'path';
import { promises as fs } from 'fs';
const data = require('../tests-examples/Regression_TA_loginData.json');
import { Regression_TA_LoginPage } from '../pages/Regression_TA_LoginPage.js';
import { Regression_TA_MenuPage } from '../pages/Regression_TA_MenuPage.js';
import { Regression_TA_ProductSearchPage } from '../pages/Regression_TA_ProductSearchPage.js';

const reportPath = path.resolve('test-results', 'sku-status.txt');
const screenshotDir = path.resolve('test-results', 'screenshots');

async function writeSkuReport(message) {
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

test('Regression | Product Search Flow using POM + JSON (JS version)', async ({ page }) => {

  const loginPage = new Regression_TA_LoginPage(page);
  const menuPage = new Regression_TA_MenuPage(page);
  const productSearch = new Regression_TA_ProductSearchPage(page);

  await loginPage.goToLogin();
  await loginPage.enterEmail(data.email);
  await loginPage.enterCredentials(data.username, data.password);

  await menuPage.openProducts();
  const skuFound = await productSearch.searchProduct(data.sku);
  const screenshotName = `sku-${data.sku}-${Date.now()}.png`;

  if (skuFound) {
    await productSearch.verifyBackButton();
    await page.waitForTimeout(10000);
    await captureScreenshot(page, screenshotName);
    await writeSkuReport('SKU found');
    await productSearch.clickBack();
  } else {
    await captureScreenshot(page, screenshotName);
    await writeSkuReport('No sku found');
  }
});