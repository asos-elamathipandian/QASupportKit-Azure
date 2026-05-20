import { test } from '@playwright/test';
import path from 'path';
import { promises as fs } from 'fs';
const data = require('../tests-examples/Regression_TA_loginData.json');
import { Regression_TA_LoginPage } from '../pages/Regression_TA_LoginPage.js';
import { Regression_TA_MenuPage } from '../pages/Regression_TA_MenuPage.js';
import { Regression_TA_POSearchPage } from '../pages/Regression_TA_PO_SearchPage.js';

const screenshotDir = path.resolve('test-results', 'screenshots');

async function captureScreenshot(page, filename) {
  await fs.mkdir(screenshotDir, { recursive: true });
  const screenshotPath = path.resolve(screenshotDir, filename);
  await page.screenshot({ path: screenshotPath, fullPage: true });
  return screenshotPath;
}

test('Regression | PO / IWT Advice search flow', async ({ page }) => {
  const loginPage = new Regression_TA_LoginPage(page);
  const menuPage = new Regression_TA_MenuPage(page);
  const poSearchPage = new Regression_TA_POSearchPage(page);

  await loginPage.goToLogin();
  await loginPage.enterEmail(data.email);
  await loginPage.enterCredentials(data.username, data.password);

  await menuPage.openLogistics();
  const poFound = await poSearchPage.searchPO(data.poId);
  const screenshotName = `po-${data.poId}-${Date.now()}.png`;
  if (!poFound) {
    await page.waitForTimeout(5000);
    await captureScreenshot(page, screenshotName);
    throw new Error(`PO ${data.poId} not found`);
  }
  await poSearchPage.verifyResults();
  await page.waitForTimeout(15000);
  await captureScreenshot(page, screenshotName);
});
