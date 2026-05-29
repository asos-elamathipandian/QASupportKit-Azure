import { Regression_TA_BasePage } from './Regression_TA_BasePage.js';

export class Regression_TA_LoginPageTA extends Regression_TA_BasePage {
  async goToLogin() {
    // Encoded destination routes post-login redirect to the Angular launchpad (#/)
    await this.page.goto('https://asos.staging.e2open.com/pages/accept?destination=%2fCLPSTG_e2clp%2fe2clp%2f%3f');
    await this.page.getByRole('button', { name: 'Agree and proceed' }).click().catch(() => {});
  }

  async enterEmail(email) {
    await this.page.getByRole('textbox', { name: 'Enter your email' }).fill(email);
    await this.page.getByRole('button', { name: 'Continue' }).click();
  }

  async enterCredentials(username, password) {
    await this.page.getByRole('textbox', { name: 'Enter your username' }).fill(username);
    await this.page.getByRole('textbox', { name: 'Enter your username' }).press('Tab');
    await this.page.getByRole('textbox', { name: 'Enter your password' }).fill(password);
    await this.page.getByRole('button', { name: 'Login' }).click();
    // Wait for post-login redirect to settle
    await this.page.waitForNavigation({ waitUntil: 'domcontentloaded', timeout: 60000 }).catch(() => {});
    await this.page.waitForLoadState('networkidle', { timeout: 30000 }).catch(() => {});

    // If e2open staging server shows 'Request Timed Out', click through to the launchpad
    const returnBtn = this.page.getByRole('button', { name: 'Return to Applications Page' });
    if (await returnBtn.isVisible({ timeout: 2000 }).catch(() => false)) {
      console.log('[TA-LOGIN] Server timeout page detected — clicking Return to Applications Page');
      await returnBtn.click();
      await this.page.waitForNavigation({ waitUntil: 'domcontentloaded', timeout: 30000 }).catch(() => {});
      await this.page.waitForLoadState('networkidle', { timeout: 30000 }).catch(() => {});
    }

    // Click ASOS tenant link (exact <a> match avoids 'ASOS SCC')
    await this.page.locator('a').filter({ hasText: /^ASOS$/ }).waitFor({ state: 'visible', timeout: 60000 });
    await this.page.locator('a').filter({ hasText: /^ASOS$/ }).click();
    // Second launchpad: click 'ASOS Trade Automation UAT'
    await this.page.locator('#table-example-1').getByText('ASOS Trade Automation UAT').click({ timeout: 30000 });
    // Wait for the TA app to fully load all modules (networkidle ensures async nav items are rendered)
    await this.page.waitForLoadState('networkidle', { timeout: 60000 }).catch(() => {});
    await this.page.waitForTimeout(1000); // extra buffer for Angular rendering
  }
}
