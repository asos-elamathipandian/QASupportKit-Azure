import { Regression_TA_BasePage } from './Regression_TA_BasePage.js';
import { expect } from '@playwright/test';

export class Regression_TA_POSearchPage extends Regression_TA_BasePage {
  get mainFrame() {
    return this.frame('mainFrame');
  }

  async waitForSearchReady() {
    const row = this.mainFrame.getByRole('row', {
      name: 'PO / IWT Advice ID Equals',
      exact: true
    });
    await row.waitFor({ state: 'visible', timeout: 10000 });
    await row.getByRole('textbox').waitFor({ state: 'visible', timeout: 10000 });
  }

  async searchPO(poId, options = {}) {
    const { openResult = true, timeout = 5000 } = options;
    const row = this.mainFrame.getByRole('row', {
      name: 'PO / IWT Advice ID Equals',
      exact: true
    });

    const input = row.getByRole('textbox');
    await input.click();
    await input.fill(poId);
    await this.mainFrame.getByRole('button', { name: 'Search', exact: true }).click();

    const resultLink = this.mainFrame.getByRole('link', { name: poId, exact: true }).first();

    try {
      await resultLink.waitFor({ state: 'visible', timeout });
    } catch (error) {
      return false;
    }

    if (openResult) {
      await resultLink.click();
    }

    return true;
  }

  async verifyResults() {
    await expect(this.page.locator('#navigationBackAreaId'))
      .toContainText('Back to Search Results');
  }

  async clickBack() {
    await this.page.getByRole('button', { name: 'Back to Search Results', exact: true }).click();
    await this.waitForSearchReady();
  }
}
