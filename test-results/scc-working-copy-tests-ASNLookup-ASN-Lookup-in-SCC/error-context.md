# Instructions

- Following Playwright test failed.
- Explain why, be concise, respect Playwright best practices.
- Provide a snippet of code with the fix, if possible.

# Test info

- Name: scc-working-copy\tests\ASNLookup.spec.js >> ASN Lookup in SCC
- Location: scc-working-copy\tests\ASNLookup.spec.js:78:5

# Error details

```
Error: locator.fill: Target page, context or browser has been closed
```

# Test source

```ts
  1  | import { Regression_TA_BasePage } from './Regression_TA_BasePage.js';
  2  | 
  3  | export class Regression_TA_LoginPage extends Regression_TA_BasePage {
  4  |   async goToLogin() {
  5  |     await this.page.goto('https://asos.staging.e2open.com/pages/accept?destination=%2fCLPSTG_e2clp%2fe2clp%2f%3f');
  6  |     await this.page.getByRole('button', { name: 'Agree and proceed' }).click();
  7  |     //await this.page.goto('https://authn.staging.e2open.com/ui/');
  8  |   }
  9  | 
  10 |   async enterEmail(email) {
> 11 |     await this.page.getByRole('textbox', { name: 'Enter your email' }).fill(email);
     |                                                                        ^ Error: locator.fill: Target page, context or browser has been closed
  12 |     await this.page.getByRole('button', { name: 'Continue' }).click();
  13 |   }
  14 | 
  15 |   async enterCredentials(username, password) {
  16 |     await this.page.getByRole('textbox', { name: 'Enter your username' }).fill(username);
  17 |     await this.page.getByRole('textbox', { name: 'Enter your password' }).fill(password);
  18 |     await this.page.getByRole('button', { name: 'Login' }).click();
  19 |     await this.page.waitForLoadState('networkidle');
  20 | 
  21 |     try {
  22 |       await this.page.goto('https://asos.staging.e2open.com/CLPSTG_e2clp/e2clp/#/');
  23 |     } catch (error) {
  24 |       if (!String(error.message).includes('net::ERR_ABORTED')) {
  25 |         throw error;
  26 |       }
  27 |     }
  28 | 
  29 |     // Dismiss Maestro popup if it appears (it blocks clicks on dashboard links)
  30 |     try {
  31 |       const exploreBtn = this.page.getByRole('button', { name: 'Explore on my own' });
  32 |       await exploreBtn.waitFor({ state: 'visible', timeout: 5000 });
  33 |       await exploreBtn.click();
  34 |     } catch {
  35 |       // Popup not present, continue
  36 |     }
  37 | 
  38 |     // Prefer direct SCC app landing; dashboard clicks are flaky on transient sessions.
  39 |     try {
  40 |       await this.page.goto('https://asos.staging.e2open.com/asos/', { waitUntil: 'domcontentloaded' });
  41 |       await this.page.frameLocator('iframe[name="clientframe"]').locator('body').waitFor({ timeout: 15000 });
  42 |       return;
  43 |     } catch {
  44 |       // Fallback to dashboard click flow.
  45 |     }
  46 | 
  47 |     await this.page.locator('a').filter({ hasText: 'ASOS SCC' }).nth(1).click({ timeout: 15000 });
  48 |     await this.page.locator('#table-example-1').getByText('ASOS SCC', { exact: true }).click({ timeout: 15000 });
  49 |     await this.page.goto('https://asos.staging.e2open.com/asos/', { waitUntil: 'domcontentloaded' });
  50 | 
  51 |     // await this.page.waitForURL('**/desktop/**', { timeout: 20000 }).catch(async () => {
  52 |     //   try {
  53 |     //   await this.page.goto('https://asos.staging.e2open.com', {
  54 |     //       waitUntil: 'domcontentloaded'
  55 |     //    });
  56 |     //  } catch (error) {
  57 |     //      if (!String(error.message).includes('net::ERR_ABORTED')) {
  58 |     //       throw error;
  59 |     //    }
  60 |     //  }
  61 |     // };
  62 |   }
  63 | }
  64 | 
```