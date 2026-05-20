// pages/REG_TA_ProductPage.js

const { expect } = require('@playwright/test');

class REG_TA_ProductPage {
  /**
   * @param {import('@playwright/test').Page} page
   */
  constructor(page) {
    this.page = page;

    this.menuSelectors = [
      '.eto-header__menu-toggle',
      'button.eto-header__menu-toggle',
      'button[aria-label*="menu" i]',
      'button[title*="menu" i]'
    ];
    this.productsButton = page.getByRole('button', { name: 'Products' });
    this.searchGeneralLink = page
      .locator('li')
      .filter({ hasText: 'Search General' })
      .locator('a');

    this.mainFrame = page.frameLocator('iframe[name="mainFrame"]');
  }

  async openMenuIfCollapsed() {
    for (const selector of this.menuSelectors) {
      const toggle = this.page.locator(selector).first();
      if (await toggle.count()) {
        await toggle.waitFor({ state: 'visible', timeout: 10000 });
        const expanded = await toggle.getAttribute('aria-expanded').catch(() => null);
        if (expanded !== 'true') {
          await toggle.click();
          await this.page.waitForTimeout(300);
        }
        return;
      }
    }
    throw new Error('Menu toggle button was not found using known selectors');
  }

  async navigateToProductSearch() {
    await this.openMenuIfCollapsed();
    await this.productsButton.waitFor({ state: 'visible', timeout: 10000 });
    await this.productsButton.click();
    await this.searchGeneralLink.waitFor({ state: 'visible', timeout: 10000 });
    await this.searchGeneralLink.click();
  }

  async searchProduct(sku) {
    const row = this.mainFrame.getByRole('row', {
      name: 'Product ID (SKU) Starts With',
      exact: true
    });

    await row.getByRole('textbox').fill(sku);
    await this.mainFrame.getByRole('button', { name: 'Search' }).click();
    await this.mainFrame.getByRole('link', { name: sku, exact: true }).click();
  }

  async verifyProductDetailsAndReturn() {
    const backSection = this.page.locator('#navigationBackAreaId');
    await expect(backSection).toContainText('Back to Search Results');
    await this.page.getByRole('button', { name: 'Back to Search Results' }).click();
  }
}

module.exports = REG_TA_ProductPage;