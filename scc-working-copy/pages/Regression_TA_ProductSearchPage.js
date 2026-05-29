import { Regression_TA_BasePage } from './Regression_TA_BasePage.js';
import { expect } from '@playwright/test';

export class Regression_TA_ProductSearchPage extends Regression_TA_BasePage {

  get mainFrame() {
    return this.frame('mainFrame');
  }

  async searchProduct(sku) {
    await this.mainFrame
      .getByRole('row', { name: 'Product ID (SKU) Starts With', exact: true })
      .getByRole('textbox')
      .fill(sku);

    await this.mainFrame.getByRole('button', { name: 'Search', exact: true }).click();

    const resultLink = this.mainFrame.getByRole('link', { name: sku, exact: true }).first();

    try {
      await resultLink.waitFor({ state: 'visible', timeout: 5000 });
    } catch (error) {
      return false;
    }

    return true; // result visible in grid — spec takes screenshot of results list
  }

  async verifyBackButton() {
    await expect(this.page.locator('#navigationBackAreaId'))
      .toContainText('Back to Search Results');
  }

  async clickBack() {
    await this.page.getByRole('button', { name: 'Back to Search Results' }).click();
  }
}

