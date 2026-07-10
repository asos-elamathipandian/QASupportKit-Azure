import { Regression_TA_BasePage } from './Regression_TA_BasePage.js';

export class Regression_TA_MenuPage extends Regression_TA_BasePage {

  async openMainMenu() {
    await this.page.getByRole('button', { name: 'menu Menu' }).click({ timeout: 30000 });
    // Wait for the menu to actually open (replaces fixed 800ms animation sleep)
    await this.page.getByRole('button', { name: 'Logistics' }).waitFor({ state: 'visible', timeout: 5000 }).catch(() => {});
  }

  async openProducts() {
    await this.openMainMenu();
    await this.page.getByRole('button', { name: 'Products' }).click({ timeout: 30000 });
    await this.page.getByText('General').nth(2).click({ timeout: 15000 });
  }

  // Opens the PO / IWT Advice Search page (first item under Logistics)
  async openLogisticsForPO() {
    await this.openMainMenu();
    await this.page.getByRole('button', { name: 'Logistics' }).click({ timeout: 30000 });
    await this.page
      .locator('.eto-header__menu-column > ul > li > .eto-menu__group > li > .eto-menu__link')
      .first()
      .click({ timeout: 15000 });
  }

  // Opens the Shipment / ASN Search page (first item in third Logistics column)
  async openLogisticsForASN() {
    await this.openMainMenu();
    await this.page.getByRole('button', { name: 'Logistics' }).click({ timeout: 30000 });
    await this.page
      .locator('.eto-header__menu-column > ul:nth-child(3) > li > .eto-menu__group > li > .eto-menu__link')
      .first()
      .click({ timeout: 15000 });
  }

  // Backward-compat: called by spec with no arg (PO) or 'Shipment...' string (ASN)
  async openLogistics(type = 'PO') {
    if (type === 'ASN' || type.includes('Shipment') || type.includes('ASN')) {
      await this.openLogisticsForASN();
    } else {
      await this.openLogisticsForPO();
    }
  }
}