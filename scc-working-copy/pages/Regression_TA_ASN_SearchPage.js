import { Regression_TA_BasePage } from './Regression_TA_BasePage.js';
import { expect } from '@playwright/test';

export class Regression_TA_ASNSearchPage extends Regression_TA_BasePage {
  get mainFrame() {
    return this.frame('mainFrame');
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

    await resultLink.click();
    return true;
  }

  async verifyResults() {
    await expect(this.page.locator('#navigationBackAreaId'))
      .toContainText('Back to Search Results');
  }

  async clickBack() {
    await this.page.getByRole('button', { name: 'Back to Search Results', exact: true }).click();
  }
}
