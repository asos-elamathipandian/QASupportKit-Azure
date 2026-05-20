import { test } from '@playwright/test';
import path from 'path';
import { promises as fs } from 'fs';
const data = require('../tests-examples/Regression_TA_loginData.json');
import { Regression_TA_LoginPage } from '../pages/Regression_TA_LoginPage.js';
import { Regression_TA_MenuPage } from '../pages/Regression_TA_MenuPage.js';
import { Regression_TA_ASNSearchPage } from '../pages/Regression_TA_ASN_SearchPage.js';

const reportPath = path.resolve('test-results', 'search-status.txt');
const screenshotDir = path.resolve('test-results', 'screenshots');

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

test('Regression | ASN / IWT search flow', async ({ page }) => {
  const loginPage = new Regression_TA_LoginPage(page);
  const menuPage = new Regression_TA_MenuPage(page);
  const asnSearchPage = new Regression_TA_ASNSearchPage(page);

  await loginPage.goToLogin();
  await loginPage.enterEmail(data.email);
  await loginPage.enterCredentials(data.username, data.password);

  await menuPage.openLogistics('Shipment Search Search Power');
  const asnFound = await asnSearchPage.searchASN(data.asnId);
  const screenshotName = `asn-${data.asnId}-${Date.now()}.png`;

  if (asnFound) {
    await asnSearchPage.verifyResults();
    await page.waitForTimeout(15000);
    await captureScreenshot(page, screenshotName);
    await appendReport('ASN found');
    await asnSearchPage.clickBack();
  } else {
    await page.waitForTimeout(5000);
    await captureScreenshot(page, screenshotName);
    await appendReport('No asn found');
  }
});
