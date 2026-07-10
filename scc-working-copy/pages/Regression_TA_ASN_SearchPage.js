import { Regression_TA_BasePage } from './Regression_TA_BasePage.js';
import { expect } from '@playwright/test';

export class Regression_TA_ASNSearchPage extends Regression_TA_BasePage {
  get mainFrame() {
    return this.frame('mainFrame');
  }

  get detailFrame() {
    return this.frame('detailFrame');
  }

  async searchASN(asnId) {
    const row = this.mainFrame.getByRole('row', {
      name: 'ASN / IWT ID Equals',
      exact: true
    });

    const textbox = row.getByRole('textbox');
    await textbox.click();
    await textbox.fill(asnId);
    await this.mainFrame.getByRole('button', { name: 'Search', exact: true }).click();

    const resultLink = this.mainFrame.getByRole('link', { name: asnId, exact: true }).first();

    try {
      await resultLink.waitFor({ state: 'visible', timeout: 5000 });
    } catch (error) {
      return false;
    }

    return true; // result visible in grid — spec takes screenshot of results list
  }

  async clickResultLink(asnId) {
    const resultLink = this.mainFrame.getByRole('link', { name: asnId, exact: true }).first();
    await resultLink.click();
    // Detail loads into detailFrame — wait for 'Line Items' tab as the ready signal
    await this.detailFrame.getByText('Line Items', { exact: true }).waitFor({ state: 'visible', timeout: 60000 });
  }

  async clickTab(tabName) {
    // Tabs (Main, Line Items, Events, etc.) are in detailFrame, not mainFrame
    const tab = this.detailFrame.getByText(tabName, { exact: true }).first();
    await tab.waitFor({ state: 'visible', timeout: 15000 });
    await tab.click({ timeout: 10000 });
    await this.page.waitForTimeout(1000); // reduced from 2000ms — tab content typically loads in <1s
  }

  async verifyResults() {
    await expect(this.page.locator('#navigationBackAreaId'))
      .toContainText('Back to Search Results');
  }

  async clickBack() {
    await this.page.getByRole('button', { name: 'Back to Search Results', exact: true }).click();
  }
}
