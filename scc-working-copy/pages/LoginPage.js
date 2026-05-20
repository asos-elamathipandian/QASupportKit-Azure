// class LoginPage {
//     constructor(page) {
//         this.page = page;
//         this.username = '#email';
//        //this.password = '#password';
//         this.loginButton = '#submit';
//     }
//     async fillCredentialsAndLogin(username, password) {
//         await this.page.locator(this.username).click();
//         await this.page.locator(this.username).fill(username);
//         //await this.page.locator(this.username).press('Tab');
//         //await this.page.locator(this.password).fill(password);
//         await this.page.locator(this.loginButton).click();
//     }
// }
// module.exports = { LoginPage };

class LoginPage {
  constructor(page) {
    this.page = page;
    // Primary selector (update if app adds data-testid)
    this.email = '#email';
    this.password = '#password';
    this.loginButton = '#submit';
    this._emailSelectorUsed = null;
    this.continueButtonRole = { name: 'Continue' }; // SSO continue button
    this._postAuthFrameSelector = 'iframe[name="clientframe"]';
    this.menuButton = '.eto-header__menu-toggle';
    // Community selection fallback
    this.communityDropdown = '#dropdownlist';
    this.communityOptionValue = 'staging-idp.staging.e2open.com';
    this.communitySelectButton = { name: 'Select' };
  }

  async ensureEmailField() {
    const candidateSelectors = [
      this.email,
      'input[formcontrolname="email"]',
      '[data-testid="login-email-input"]',
      'input[type="email"]#email'
    ];
    for (const sel of candidateSelectors) {
      const loc = this.page.locator(sel).first();
      if (await loc.count() > 0) {
        await loc.waitFor({ state: 'visible' });
        this._emailSelectorUsed = sel;
        return loc;
      }
    }
    throw new Error('Email field not found using known selectors');
  }

  async loginWithCredentials(email, password) {
    const emailField = await this.ensureEmailField();
    console.log(`[LoginPage] Attempting to fill email using selector: ${this._emailSelectorUsed} with value length=${email ? email.length : 0}`);
    await this.safeFill(emailField, email, 'email');
    const passwordField = this.page.locator(this.password);
    await passwordField.waitFor({ state: 'visible' });
    console.log(`[LoginPage] Attempting to fill password with length=${password ? password.length : 0}`);
    await this.safeFill(passwordField, password, 'password');
    const loginBtn = this.page.locator(this.loginButton);
    await loginBtn.waitFor({ state: 'visible' });
    await loginBtn.click();
  }

  /**
   * SSO flow where only email is needed then redirect happens (no password field).
   * 1. Try to locate email field quickly; if found fill & click Continue.
   * 2. If not found within short timeout, assume automatic SSO redirect will occur.
   * 3. Wait for post-auth evidence (iframe or app navbar) before returning.
   */
  async loginWithEmailSSO(email) {
    console.log('[LoginPage] Starting SSO email-only flow');
    let emailField = null;
    try {
      // Shorter timeout for SSO screen; if not found we fallback to waiting redirect
      emailField = await this.page.locator(this.email).first();
      await emailField.waitFor({ state: 'visible', timeout: 3000 });
      this._emailSelectorUsed = this.email;
    } catch (e) {
      console.warn('[LoginPage] Email input not visible within 3s; assuming auto-redirect SSO.');
    }

    if (emailField) {
      await this.safeFill(emailField, email, 'email');
      // Try Continue button
      const continueBtn = this.page.getByRole('button', this.continueButtonRole);
      if (await continueBtn.count()) {
        await continueBtn.first().click({ timeout: 5000 }).catch(err => console.warn('[LoginPage] Continue click failed', err));
      } else {
        // Fallback: press Enter in field
        await emailField.press('Enter').catch(() => {});
      }
    }

    // Wait for post-auth condition (iframe or password for next step or URL change)
    await this.waitForPostAuth();
  }

  async waitForPostAuth() {
    const start = Date.now();
    const maxMs = 20000;
    while (Date.now() - start < maxMs) {
      // Various signals of successful navigation
      const frameExists = await this.page.locator(this._postAuthFrameSelector).count();
      if (frameExists) {
        console.log('[LoginPage] Post-auth iframe detected');
        return;
      }
      const passwordVisible = await this.page.locator(this.password).first().isVisible().catch(() => false);
      if (passwordVisible) {
        console.log('[LoginPage] Password field visible - switched to credential login stage');
        return;
      }
      await this.page.waitForTimeout(500);
    }
    console.warn('[LoginPage] Post-auth wait timed out after 20s');
  }

  async waitForMenuReady(timeoutMs = 60000) {
    console.log('[LoginPage] Waiting for menu button after manual SSO...');
    await this.page.locator(this.menuButton).waitFor({ state: 'visible', timeout: timeoutMs });
    console.log('[LoginPage] Menu button visible. Proceeding.');
  }

  /**
   * Robust post-auth readiness:
   *  - Optionally select community if dropdown appears.
   *  - Wait for either menu, iframe content, or a known navigation element.
   *  - Open menu if not already open.
   */
  async ensurePostLoginAndMenu(options = {}) {
    const {
      timeoutMs = 90000,
      pollIntervalMs = 1000,
      autoSelectCommunity = true
    } = options;

    const start = Date.now();
    let communityHandled = false;

    while (Date.now() - start < timeoutMs) {
      // Community selection if needed
      if (autoSelectCommunity && !communityHandled && await this.page.locator(this.communityDropdown).count()) {
        console.log('[LoginPage] Community dropdown detected; selecting option');
        try {
          await this.page.locator(this.communityDropdown).selectOption(this.communityOptionValue);
          await this.page.getByRole('button', this.communitySelectButton).click();
          communityHandled = true;
        } catch (e) {
          console.warn('[LoginPage] Failed to select community:', e);
        }
        // After selection, loop again to allow redirect/content load
      }

      // Menu directly available
      if (await this.page.locator(this.menuButton).first().isVisible().catch(() => false)) {
        console.log('[LoginPage] Menu button found');
        await this.openMenuIfNeeded();
        return;
      }

      // Iframe present (app content likely loaded)
      if (await this.page.locator(this._postAuthFrameSelector).count()) {
        console.log('[LoginPage] App iframe detected, attempting to open menu');
        const menuLoc = this.page.locator(this.menuButton);
        if (await menuLoc.count()) {
          await this.openMenuIfNeeded();
          return;
        }
      }

      // Check URL pattern as fallback
      const currentUrl = this.page.url();
      if (/e2open\.com\/pages\//i.test(currentUrl) && await this.page.locator(this._postAuthFrameSelector).count()) {
        console.log('[LoginPage] URL indicates post-login pages; attempting menu open');
        await this.openMenuIfNeeded();
        return;
      }

      await this.page.waitForTimeout(pollIntervalMs);
    }
    throw new Error('Post-login menu not ready within timeout');
  }

  async openMenuIfNeeded() {
    console.log('[LoginPage] Attempting to open menu...');
    
    // Try multiple selector strategies
    const selectors = [
      this.menuButton,
      'button.eto-header__menu-toggle',
      '[class*="menu-toggle"]',
      'button[aria-label*="menu" i]',
      'button[title*="menu" i]'
    ];

    for (const selector of selectors) {
      const loc = this.page.locator(selector).first();
      const count = await loc.count();
      console.log(`[LoginPage] Selector '${selector}' found ${count} element(s)`);
      
      if (count > 0) {
        const isVisible = await loc.isVisible().catch(() => false);
        console.log(`[LoginPage] Element visible: ${isVisible}`);
        
        if (isVisible) {
          try {
            // Wait for actionability
            await loc.waitFor({ state: 'visible', timeout: 5000 });
            await loc.click({ timeout: 5000, force: false });
            console.log('[LoginPage] Menu clicked successfully');
            // Small wait for menu to animate/open
            await this.page.waitForTimeout(500);
            return;
          } catch (e) {
            console.warn(`[LoginPage] Click failed for '${selector}':`, e.message);
            // Try force click as fallback
            try {
              await loc.click({ force: true });
              console.log('[LoginPage] Menu force-clicked successfully');
              await this.page.waitForTimeout(500);
              return;
            } catch (e2) {
              console.warn(`[LoginPage] Force click also failed:`, e2.message);
            }
          }
        }
      }
    }
    
    console.error('[LoginPage] All menu click strategies failed');
    // Don't throw - allow flow to continue; menu might already be open
  }

  // Backward compatibility with older test code calling fillCredentialsAndLogin
  async fillCredentialsAndLogin(username, password) {
    return this.loginWithCredentials(username, password);
  }

  async safeFill(locator, value, label) {
    const text = value ?? '';
    for (let attempt = 1; attempt <= 3; attempt++) {
      try {
        await locator.waitFor({ state: 'visible', timeout: 5000 });
        await locator.click({ timeout: 5000 });
        // Clear existing content (Ctrl+A then Delete) for reliability
        await locator.press('Control+A').catch(() => {});
        await locator.press('Delete').catch(() => {});
        // Primary strategy: fill()
        await locator.fill(text, { timeout: 5000 });
        const afterFill = await locator.inputValue();
        if (afterFill === text) {
          return;
        }
        console.warn(`[LoginPage] fill() did not stick for ${label}. After fill value='${afterFill}'. Attempt ${attempt}. Trying type()`);
        // Secondary: type with slight delay (emits key events)
        await locator.press('Control+A').catch(() => {});
        await locator.type(text, { delay: 30 });
        const afterType = await locator.inputValue();
        if (afterType === text) {
          return;
        }
        console.warn(`[LoginPage] type() did not stick for ${label}. Value='${afterType}'. Attempt ${attempt}. Trying DOM set + events`);
        // Tertiary: direct DOM value set + dispatch input/change
        await locator.evaluate((el, v) => {
          // Use the native value setter to ensure frameworks (Angular/React) pick up change
          const prototype = Object.getPrototypeOf(el);
          const descriptor = Object.getOwnPropertyDescriptor(prototype, 'value');
          if (descriptor && descriptor.set) {
            descriptor.set.call(el, v);
          } else {
            el.value = v;
          }
          el.dispatchEvent(new Event('input', { bubbles: true }));
          el.dispatchEvent(new Event('change', { bubbles: true }));
          el.dispatchEvent(new Event('blur', { bubbles: true }));
        }, text);
        const afterDomSet = await locator.inputValue();
        if (afterDomSet === text) {
          return;
        }
        console.warn(`[LoginPage] DOM set did not persist for ${label}. Value='${afterDomSet}'.`);
        if (attempt < 3) {
          await this.page.waitForTimeout(500);
          continue;
        }
        throw new Error(`Failed to set value for ${label} after 3 strategies (final='${afterDomSet}')`);
      } catch (err) {
        if (attempt === 3) {
          throw new Error(`Failed to fill ${label} after 3 attempts: ${err}`);
        }
        await this.page.waitForTimeout(500);
      }
    }
  }
}
module.exports = { LoginPage };