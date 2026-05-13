import { Regression_TA_BasePage } from './Regression_TA_BasePage.js';

export class Regression_TA_LoginPage extends Regression_TA_BasePage {
  async goToLogin() {
    await this.page.goto('https://asos.staging.e2open.com/pages/accept?destination=%2fCLPSTG_e2clp%2fe2clp%2f%3f');
    await this.page.getByRole('button', { name: 'Agree and proceed' }).click();
    //await this.page.goto('https://authn.staging.e2open.com/ui/');
  }

  async enterEmail(email) {
    await this.page.getByRole('textbox', { name: 'Enter your email' }).fill(email);
    await this.page.getByRole('button', { name: 'Continue' }).click();
  }

  async enterCredentials(username, password) {
    await this.page.getByRole('textbox', { name: 'Enter your username' }).fill(username);
    await this.page.getByRole('textbox', { name: 'Enter your password' }).fill(password);
    await this.page.getByRole('button', { name: 'Login' }).click();
    await this.page.waitForLoadState('networkidle');

    try {
      await this.page.goto('https://asos.staging.e2open.com/CLPSTG_e2clp/e2clp/#/');
    } catch (error) {
      if (!String(error.message).includes('net::ERR_ABORTED')) {
        throw error;
      }
    }

    // Dismiss Maestro popup if it appears (it blocks clicks on dashboard links)
    try {
      const exploreBtn = this.page.getByRole('button', { name: 'Explore on my own' });
      await exploreBtn.waitFor({ state: 'visible', timeout: 5000 });
      await exploreBtn.click();
    } catch {
      // Popup not present, continue
    }

    // Prefer direct SCC app landing; dashboard clicks are flaky on transient sessions.
    try {
      await this.page.goto('https://asos.staging.e2open.com/asos/', { waitUntil: 'domcontentloaded' });
      await this.page.frameLocator('iframe[name="clientframe"]').locator('body').waitFor({ timeout: 15000 });
      return;
    } catch {
      // Fallback to dashboard click flow.
    }

    await this.page.locator('a').filter({ hasText: 'ASOS SCC' }).nth(1).click({ timeout: 15000 });
    await this.page.locator('#table-example-1').getByText('ASOS SCC', { exact: true }).click({ timeout: 15000 });
    await this.page.goto('https://asos.staging.e2open.com/asos/', { waitUntil: 'domcontentloaded' });

    // await this.page.waitForURL('**/desktop/**', { timeout: 20000 }).catch(async () => {
    //   try {
    //   await this.page.goto('https://asos.staging.e2open.com', {
    //       waitUntil: 'domcontentloaded'
    //    });
    //  } catch (error) {
    //      if (!String(error.message).includes('net::ERR_ABORTED')) {
    //       throw error;
    //    }
    //  }
    // };
  }
}
