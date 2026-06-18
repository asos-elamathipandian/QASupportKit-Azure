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
    // Wait for the auth redirect to complete (navigates away from authn page).
    // waitForNavigation is faster than networkidle but still ensures the redirect happened.
    await this.page.waitForNavigation({ waitUntil: 'domcontentloaded', timeout: 30000 }).catch(() => {});

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
      await this.page.frameLocator('iframe[name="clientframe"]').locator('body').waitFor({ timeout: 30000 });
      return;
    } catch {
      // Fallback to dashboard click flow — navigate back to launchpad first
      // (the failed goto above may have left us on the SCC app page where no dashboard tiles exist).
    }

    await this.page.goto('https://asos.staging.e2open.com/CLPSTG_e2clp/e2clp/#/', { waitUntil: 'domcontentloaded' });
    await this.page.locator('a').filter({ hasText: 'ASOS SCC' }).first().waitFor({ state: 'visible', timeout: 30000 });
    await this.page.locator('a').filter({ hasText: 'ASOS SCC' }).first().click();
    await this.page.locator('#table-example-1').getByText('ASOS SCC', { exact: true }).waitFor({ state: 'visible', timeout: 15000 });
    await this.page.locator('#table-example-1').getByText('ASOS SCC', { exact: true }).click();
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
