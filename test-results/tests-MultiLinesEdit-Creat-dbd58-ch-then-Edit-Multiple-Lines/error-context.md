# Instructions

- Following Playwright test failed.
- Explain why, be concise, respect Playwright best practices.
- Provide a snippet of code with the fix, if possible.

# Test info

- Name: tests\MultiLinesEdit.spec.js >> Create Draft Booking via Order Search then Edit Multiple Lines
- Location: tests\MultiLinesEdit.spec.js:83:5

# Error details

```
TimeoutError: locator.waitFor: Timeout 30000ms exceeded.
Call log:
  - waiting for locator('a').filter({ hasText: 'ASOS SCC' }).first() to be visible

```

# Page snapshot

```yaml
- generic [ref=e2]:
  - generic [ref=e5]:
    - img "About e2open" [ref=e6]
    - link "About e2open" [ref=e7] [cursor=pointer]:
      - /url: https://www.e2open.com/company/
  - generic [ref=e9]:
    - generic [ref=e11]: Welcome to e2open! Please log in to continue.
    - generic [ref=e15]:
      - textbox "Enter your email" [active] [ref=e18]
      - generic [ref=e20] [cursor=pointer]:
        - checkbox "Remember my email" [ref=e21]
        - generic [ref=e23]: Remember my email
      - generic [ref=e24]:
        - button "Continue" [disabled]
    - link "Need help? Contact Support" [ref=e28] [cursor=pointer]:
      - /url: http://www.e2open.com/about/support/
    - alert [ref=e30]:
      - text: info
      - generic [ref=e31]:
        - generic [ref=e32]: Regular Maintenance Hours
        - text: Users of the e2open system may experience temporary disruptions to service 8:00 AM to 12:00 PM
        - link "US Pacific time" [ref=e33] [cursor=pointer]:
          - /url: http://www.timeanddate.com/worldclock/city.html?n=224
        - text: each Saturday.
  - contentinfo [ref=e34]:
    - generic [ref=e35]:
      - text: Copyright © 2024 -
      - text: E2open, LLC. All rights reserved.
    - link "Privacy Policy" [ref=e36] [cursor=pointer]:
      - /url: https://www.e2open.com/company/privacy-policy
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
  11 |     await this.page.getByRole('textbox', { name: 'Enter your email' }).fill(email);
  12 |     await this.page.getByRole('button', { name: 'Continue' }).click();
  13 |   }
  14 | 
  15 |   async enterCredentials(username, password) {
  16 |     await this.page.getByRole('textbox', { name: 'Enter your username' }).fill(username);
  17 |     await this.page.getByRole('textbox', { name: 'Enter your password' }).fill(password);
  18 |     await this.page.getByRole('button', { name: 'Login' }).click();
  19 |     // Wait for the auth redirect to complete (navigates away from authn page).
  20 |     // waitForNavigation is faster than networkidle but still ensures the redirect happened.
  21 |     await this.page.waitForNavigation({ waitUntil: 'domcontentloaded', timeout: 30000 }).catch(() => {});
  22 | 
  23 |     try {
  24 |       await this.page.goto('https://asos.staging.e2open.com/CLPSTG_e2clp/e2clp/#/');
  25 |     } catch (error) {
  26 |       if (!String(error.message).includes('net::ERR_ABORTED')) {
  27 |         throw error;
  28 |       }
  29 |     }
  30 | 
  31 |     // Dismiss Maestro popup if it appears (it blocks clicks on dashboard links)
  32 |     try {
  33 |       const exploreBtn = this.page.getByRole('button', { name: 'Explore on my own' });
  34 |       await exploreBtn.waitFor({ state: 'visible', timeout: 5000 });
  35 |       await exploreBtn.click();
  36 |     } catch {
  37 |       // Popup not present, continue
  38 |     }
  39 | 
  40 |     // Prefer direct SCC app landing; dashboard clicks are flaky on transient sessions.
  41 |     try {
  42 |       await this.page.goto('https://asos.staging.e2open.com/asos/', { waitUntil: 'domcontentloaded' });
  43 |       await this.page.frameLocator('iframe[name="clientframe"]').locator('body').waitFor({ timeout: 30000 });
  44 |       return;
  45 |     } catch {
  46 |       // Fallback to dashboard click flow — navigate back to launchpad first
  47 |       // (the failed goto above may have left us on the SCC app page where no dashboard tiles exist).
  48 |     }
  49 | 
  50 |     await this.page.goto('https://asos.staging.e2open.com/CLPSTG_e2clp/e2clp/#/', { waitUntil: 'domcontentloaded' });
> 51 |     await this.page.locator('a').filter({ hasText: 'ASOS SCC' }).first().waitFor({ state: 'visible', timeout: 30000 });
     |                                                                          ^ TimeoutError: locator.waitFor: Timeout 30000ms exceeded.
  52 |     await this.page.locator('a').filter({ hasText: 'ASOS SCC' }).first().click();
  53 |     await this.page.locator('#table-example-1').getByText('ASOS SCC', { exact: true }).waitFor({ state: 'visible', timeout: 15000 });
  54 |     await this.page.locator('#table-example-1').getByText('ASOS SCC', { exact: true }).click();
  55 |     await this.page.goto('https://asos.staging.e2open.com/asos/', { waitUntil: 'domcontentloaded' });
  56 | 
  57 |     // await this.page.waitForURL('**/desktop/**', { timeout: 20000 }).catch(async () => {
  58 |     //   try {
  59 |     //   await this.page.goto('https://asos.staging.e2open.com', {
  60 |     //       waitUntil: 'domcontentloaded'
  61 |     //    });
  62 |     //  } catch (error) {
  63 |     //      if (!String(error.message).includes('net::ERR_ABORTED')) {
  64 |     //       throw error;
  65 |     //    }
  66 |     //  }
  67 |     // };
  68 |   }
  69 | }
  70 | 
```