# Instructions

- Following Playwright test failed.
- Explain why, be concise, respect Playwright best practices.
- Provide a snippet of code with the fix, if possible.

# Test info

- Name: tests\Regression_TA_check.spec.js >> E2open TA | Check SKU, PO and ASN availability
- Location: tests\Regression_TA_check.spec.js:140:5

# Error details

```
TimeoutError: locator.waitFor: Timeout 120000ms exceeded.
Call log:
  - waiting for locator('a').filter({ hasText: /^ASOS$/ }) to be visible

```

# Page snapshot

```yaml
- generic [ref=e3]:
  - banner [ref=e4]:
    - generic [ref=e5]:
      - navigation [ref=e6]:
        - button " Menu" [disabled] [ref=e7] [cursor=pointer]
      - img "Launchpad" [ref=e8]
      - generic [ref=e9]: Launchpad
      - generic [ref=e11] [cursor=pointer]: help
      - generic [ref=e15] [cursor=pointer]: person_outline
  - generic [ref=e16]:
    - list [ref=e17]:
      - listitem [ref=e18]:
        - link "home" [ref=e19] [cursor=pointer]:
          - /url: "#"
          - generic [ref=e20]: home
      - listitem [ref=e21]: Dashboard
    - list [ref=e22]:
      - listitem [ref=e23]:
        - text: Dashboard
        - generic [ref=e24] [cursor=pointer]: help
      - listitem [ref=e25]:
        - radiogroup [ref=e27]:
          - generic "Tile View" [ref=e28]:
            - radio "view_module" [ref=e29]
            - generic [ref=e31] [cursor=pointer]: view_module
          - generic "List View" [ref=e32]:
            - radio "view_list" [checked] [ref=e33]
            - generic [ref=e35] [cursor=pointer]: view_list
  - generic [ref=e37]:
    - img [ref=e38]
    - heading "Loading..." [level=3] [ref=e45]
  - generic [ref=e46]: Loading...
```

# Test source

```ts
  1  | import { Regression_TA_BasePage } from './Regression_TA_BasePage.js';
  2  | 
  3  | export class Regression_TA_LoginPageTA extends Regression_TA_BasePage {
  4  |   async goToLogin() {
  5  |     // Encoded destination routes post-login redirect to the Angular launchpad (#/)
  6  |     await this.page.goto('https://asos.staging.e2open.com/pages/accept?destination=%2fCLPSTG_e2clp%2fe2clp%2f%3f');
  7  |     await this.page.getByRole('button', { name: 'Agree and proceed' }).click().catch(() => {});
  8  |   }
  9  | 
  10 |   async enterEmail(email) {
  11 |     await this.page.getByRole('textbox', { name: 'Enter your email' }).fill(email);
  12 |     await this.page.getByRole('button', { name: 'Continue' }).click();
  13 |   }
  14 | 
  15 |   async enterCredentials(username, password) {
  16 |     await this.page.getByRole('textbox', { name: 'Enter your username' }).fill(username);
  17 |     await this.page.getByRole('textbox', { name: 'Enter your username' }).press('Tab');
  18 |     await this.page.getByRole('textbox', { name: 'Enter your password' }).fill(password);
  19 |     await this.page.getByRole('button', { name: 'Login' }).click();
  20 |     // Wait for post-login redirect to settle
  21 |     await this.page.waitForNavigation({ waitUntil: 'domcontentloaded', timeout: 60000 }).catch(() => {});
  22 |     await this.page.waitForLoadState('networkidle', { timeout: 30000 }).catch(() => {});
  23 | 
  24 |     // If e2open staging server shows 'Request Timed Out', click through to the launchpad
  25 |     const returnBtn = this.page.getByRole('button', { name: 'Return to Applications Page' });
  26 |     if (await returnBtn.isVisible({ timeout: 2000 }).catch(() => false)) {
  27 |       console.log('[TA-LOGIN] Server timeout page detected — clicking Return to Applications Page');
  28 |       await returnBtn.click();
  29 |       await this.page.waitForNavigation({ waitUntil: 'domcontentloaded', timeout: 30000 }).catch(() => {});
  30 |       await this.page.waitForLoadState('networkidle', { timeout: 30000 }).catch(() => {});
  31 |     }
  32 | 
  33 |     // Click ASOS tenant link (exact <a> match avoids 'ASOS SCC')
> 34 |     await this.page.locator('a').filter({ hasText: /^ASOS$/ }).waitFor({ state: 'visible', timeout: 120000 });
     |                                                                ^ TimeoutError: locator.waitFor: Timeout 120000ms exceeded.
  35 |     await this.page.locator('a').filter({ hasText: /^ASOS$/ }).click();
  36 |     // Second launchpad: click 'ASOS Trade Automation UAT'
  37 |     await this.page.locator('#table-example-1').getByText('ASOS Trade Automation UAT').click({ timeout: 30000 });
  38 |     // Wait for the TA app to fully load all modules (networkidle ensures async nav items are rendered)
  39 |     await this.page.waitForLoadState('networkidle', { timeout: 60000 }).catch(() => {});
  40 |     await this.page.waitForTimeout(1000); // extra buffer for Angular rendering
  41 |   }
  42 | }
  43 | 
```