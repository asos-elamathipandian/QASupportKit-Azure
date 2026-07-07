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

    // Wait for the auth redirect chain to land back on the CLP launchpad.
    // waitForURL is precise — it only resolves once the URL actually matches,
    // unlike waitForNavigation/networkidle which can silently time out mid-redirect.
    await this.page.waitForURL('**/CLPSTG_e2clp/**', { timeout: 90000 }).catch(() => {});
    await this.page.waitForLoadState('domcontentloaded', { timeout: 30000 }).catch(() => {});

    // Dismiss Maestro popup if it appears (it blocks clicks on dashboard links)
    try {
      const exploreBtn = this.page.getByRole('button', { name: 'Explore on my own' });
      await exploreBtn.waitFor({ state: 'visible', timeout: 5000 });
      await exploreBtn.click();
    } catch {
      // Popup not present, continue
    }

    // Navigate directly to the SCC app. Use 'domcontentloaded' so goto returns as soon as the
    // HTML is parsed — Menu appears well before all page resources finish loading.
    // The waitFor on the toggle is the real gate; we proceed the moment Menu is visible.
    await this.page.goto('https://asos.staging.e2open.com/asos/', { waitUntil: 'domcontentloaded', timeout: 90000 });
    await this.page.locator('.eto-header__menu-toggle').first().waitFor({ state: 'visible', timeout: 120000 });

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
