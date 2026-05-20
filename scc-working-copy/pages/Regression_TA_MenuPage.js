import { Regression_TA_BasePage } from './Regression_TA_BasePage.js';

export class Regression_TA_MenuPage extends Regression_TA_BasePage {

  constructor(page) {
    super(page);
    this.menuSelectors = [
      '.eto-header__menu-toggle',
      'button.eto-header__menu-toggle',
      'button[aria-label*="menu" i]',
      'button[title*="menu" i]',
      'button[title="View menu items"]',
      'button:has-text("Menu")'
    ];
  }

  async openMainMenu() {
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
    throw new Error('Main menu toggle not found');
  }

  async openProducts() {
    await this.openMainMenu();
    await this.page.getByRole('button', { name: 'Products' }).click();
    await this.page.getByText('General').nth(2).click();
  }

  async openLogistics(itemText = 'PO / IWT Advice Search Power') {
    await this.openMainMenu();
    await this.page.getByRole('button', { name: 'Logistics' }).click();
    await this.page
      .locator('li')
      .filter({ hasText: itemText })
      .locator('a')
      .first()
      .click();
  }
}