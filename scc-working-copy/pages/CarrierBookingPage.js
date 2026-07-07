class CarrierBookingPage {
    constructor(page, frame) {
        this.page = page;
        this.frame = frame;
        this.loadingOverlay = '#loading.ui-loading-overlay';
        this.clearButton = { name: 'Clear All Filters' };
        this.expandFilter = '.ui-icon-circlesmall-plus';
        this.collapseFilter = '.ui-icon-circlesmall-minus';
        this.asnField = '#searchparam_apppoitem_UDF_Text_5_input';
        this.applyButton = '#searchSubmitButton';
        this.statusDropDown = '#searchparam_appvbStatus_multiselect_button';
        this.selectAllCheck = '#resultTable-select-all';
        this.vbValue = '[title*="VB-000"]';
        this.statusCell = '[id^="resultfield_appvbStatus"]';
        this.editBooking = { name: 'Edit Booking' };
    }

    async waitForGridToBeReady() {
        await this.frame.locator(this.loadingOverlay).waitFor({ state: 'hidden', timeout: 60000 });
    }

    async expandandClearFilter() {
        // Wait for the page to finish navigating before interacting with the iframe
        await this.page.waitForLoadState('domcontentloaded');
        await this.frame.locator('body').waitFor({ state: 'attached', timeout: 15000 });
        // Wait for any loading overlay to clear before touching filter buttons
        await this.frame.locator(this.loadingOverlay).waitFor({ state: 'hidden', timeout: 60000 }).catch(() => {});
        const clearFilterButton = this.frame.getByRole('button', this.clearButton);
        try {
            if (await clearFilterButton.isVisible({ timeout: 5000 })) {
                await clearFilterButton.click();
            }
            else {
                await this.frame.locator(this.expandFilter).waitFor({ timeout: 5000 });
                await this.frame.locator(this.expandFilter).click();
                await clearFilterButton.click({ timeout: 10000 });
            }
        } catch (e) {
            // Frame may have reloaded; try expanding filter as fallback
            await this.frame.locator(this.loadingOverlay).waitFor({ state: 'hidden', timeout: 30000 }).catch(() => {});
            await this.frame.locator(this.expandFilter).waitFor({ timeout: 10000 });
            await this.frame.locator(this.expandFilter).click();
            await clearFilterButton.click({ timeout: 10000 });
        }
    }
    async searchWithasnAndstatus(asns) {
        await this.frame.locator(this.asnField).click();
        await this.frame.locator(this.asnField).fill(asns);
        // Wait for any loading triggered by the ASN fill to settle before touching the status dropdown
        await this.frame.locator(this.loadingOverlay).waitFor({ state: 'hidden', timeout: 10000 }).catch(() => {});
        await this.frame.locator(this.statusDropDown).click();
        // Wait for the multiselect panel to open before interacting with options
        const draftOption = this.frame.getByLabel('Draft', { exact: true });
        await draftOption.waitFor({ state: 'visible', timeout: 5000 }).catch(() => {});
        await draftOption.check().catch(async () => {
            // Fallback: find the label by text and click it
            await this.frame.locator('label').filter({ hasText: /^Draft$/ }).first().click().catch(() => {});
        });
        // Close dropdown by clicking ASN field (neutral — already filled, click just repositions cursor)
        // This commits the Draft selection to the filter form before Apply runs
        await this.frame.locator(this.asnField).click();
        await this.frame.locator(this.applyButton).click();
        await this.frame.locator(this.collapseFilter).click();
    }
    async searchWithAsn(asns) {
        await this.frame.locator(this.asnField).click();
        await this.frame.locator(this.asnField).fill(asns);
        await this.frame.locator(this.applyButton).click();
        await this.frame.locator(this.collapseFilter).click();
    }
    async getVBReference() {
        await this.waitForGridToBeReady();
        await this.frame.locator(this.vbValue).first().waitFor({ timeout: 10000 });
        return (await this.frame.locator(this.vbValue).first().textContent()).trim();
    }

    // Returns { vbReference, bookingStatus } for the first active (non-cancelled) booking row.
    // When waitForNonDraft:true, scans ALL rows for a Submitted/Approved booking first;
    // only retries (up to 4×2s) when every active row is still Draft.
    async getActiveBookingResult({ waitForNonDraft = false } = {}) {
        const maxAttempts = waitForNonDraft ? 8 : 1;
        for (let attempt = 1; attempt <= maxAttempts; attempt++) {
            await this.waitForGridToBeReady();
            const rows = this.frame.locator('#resultTable .ui-grid-body-row');
            await rows.first().waitFor({ state: 'visible', timeout: 10000 }).catch(() => {});
            const rowCount = await rows.count();
            let firstDraftResult = null; // best fallback if no non-Draft row is found
            for (let i = 0; i < rowCount; i++) {
                const row = rows.nth(i);
                const statusCell = row.locator('[id^="resultfield_appvbStatus"]');
                if (await statusCell.count() === 0) continue;
                const status = (await statusCell.first().textContent({ timeout: 2000 }).catch(() => '')).trim();
                // Skip stale cancelled / rejected / voided bookings
                if (/cancelled|rejected|voided/i.test(status)) continue;
                const vbCell = row.locator('[title*="VB-000"]');
                if (await vbCell.count() === 0) continue;
                const vbReference = (await vbCell.first().textContent({ timeout: 2000 }).catch(() => '')).trim();
                if (!vbReference) continue;
                if (waitForNonDraft && /^draft$/i.test(status)) {
                    // Keep this as fallback but keep scanning — a Submitted row may be further down
                    if (!firstDraftResult) firstDraftResult = { vbReference, bookingStatus: status };
                    continue;
                }
                return { vbReference, bookingStatus: status };
            }
            // All active rows are still Draft — wait and retry
            if (firstDraftResult && attempt < maxAttempts) {
                console.log(`[getActiveBookingResult] All active rows are Draft (e.g. ${firstDraftResult.vbReference}), waiting 3s… (attempt ${attempt}/${maxAttempts})`);
                await new Promise(resolve => setTimeout(resolve, 3000));
            } else if (firstDraftResult) {
                return firstDraftResult; // gave up waiting, return best available
            }
        }
        // Fallback: return first row regardless of status
        const vbReference = (await this.frame.locator(this.vbValue).first().textContent().catch(() => 'Unknown')).trim();
        const bookingStatus = (await this.frame.locator(this.statusCell).first().textContent().catch(() => 'Unknown')).trim() || 'Unknown';
        return { vbReference, bookingStatus };
    }

    async getBookingStatus(vbReference, { waitForNonDraft = false } = {}) {
        const maxAttempts = waitForNonDraft ? 8 : 1;
        let status = 'Unknown';
        for (let attempt = 1; attempt <= maxAttempts; attempt++) {
            status = await this._readBookingStatus(vbReference);
            if (!waitForNonDraft || status.toLowerCase() !== 'draft') break;
            console.log(`[getBookingStatus] Status is Draft on attempt ${attempt}/${maxAttempts}, re-searching for fresh status…`);
            await new Promise(resolve => setTimeout(resolve, 3000));
            // Re-click Apply to pull fresh data from the server — re-reading the DOM alone won't
            // reflect a status change SCC processed in the background since the last search.
            await this.frame.locator(this.applyButton).click().catch(() => {});
            await this.waitForGridToBeReady();
        }
        return status;
    }

    async _readBookingStatus(vbReference) {
        await this.waitForGridToBeReady();

        // If a VB reference is provided, find the matching row's status
        if (vbReference) {
            const rows = this.frame.locator('#resultTable .ui-grid-body-row');
            const rowCount = await rows.count();
            for (let i = 0; i < rowCount; i++) {
                const row = rows.nth(i);
                const vbCell = row.locator('[id^="resultfield_appvbBookingNo"]');
                if (await vbCell.count() > 0) {
                    const vbText = (await vbCell.first().textContent({ timeout: 2000 })).trim();
                    if (vbText === vbReference) {
                        const statusCell = row.locator('[id^="resultfield_appvbStatus"]');
                        if (await statusCell.count() > 0) {
                            return (await statusCell.first().textContent({ timeout: 2000 })).trim() || 'Unknown';
                        }
                    }
                }
            }
            console.log(`VB ${vbReference} not found in grid rows — returning Unknown to avoid wrong status`);
            return 'Unknown'; // do NOT fall back to first row; caller should not trigger approval on Unknown
        }

        // No VBRef provided — fall back to first status cell
        const statusLocator = this.frame.locator(this.statusCell).first();
        try {
            await statusLocator.waitFor({ state: 'visible', timeout: 5000 });
            const statusText = (await statusLocator.textContent()).trim();
            if (statusText) return statusText;
            const titleText = await statusLocator.getAttribute('title');
            return titleText ? titleText.trim() : 'Unknown';
        } catch {
            return 'Unknown';
        }
    }
    async selectAndEditBooking() {
        const selectAll = this.frame.locator(this.selectAllCheck);
        const editButton = this.frame.getByRole('button', this.editBooking);

        await selectAll.waitFor({ state: 'visible', timeout: 15000 });

        for (let attempt = 1; attempt <= 8; attempt += 1) {
            await this.frame.locator(this.loadingOverlay).waitFor({ state: 'hidden', timeout: 10000 }).catch(() => {});

            // When multiple rows are present select only the FIRST (newest) row.
            // Selecting all rows with select-all leaves Edit Booking disabled in SCC.
            const rows = this.frame.locator('#resultTable .ui-grid-body-row');
            const rowCount = await rows.count();
            const targetCheckbox = rowCount > 1
                ? rows.first().locator('input[type="checkbox"]').first()
                : selectAll;

            const isChecked = await targetCheckbox.isChecked().catch(() => false);
            if (!isChecked) {
                // Use jQuery trigger('click') via evaluate — SCC's checkboxes use jQuery event
                // listeners that don't respond to vanilla DOM events (dispatchEvent/el.click())
                await targetCheckbox.evaluate(el => {
                    if (typeof jQuery !== 'undefined') jQuery(el).trigger('click');
                    else if (typeof $ !== 'undefined') $(el).trigger('click');
                    else el.click();
                }).catch(() => {});
                await new Promise(r => setTimeout(r, 500));
            }

            const ariaDisabled = await editButton.getAttribute('aria-disabled');
            const className = (await editButton.getAttribute('class')) || '';
            const isDisabled = ariaDisabled === 'true' || className.includes('ui-state-disabled') || className.includes('ui-button-disabled');

            if (!isDisabled) {
                await editButton.click();
                await this.waitForGridToBeReady();
                return;
            }

            console.log(`[selectAndEditBooking] Edit button still disabled on attempt ${attempt}/8 (rows=${rowCount})`);
            await this.page.waitForTimeout(500);
        }

        throw new Error('Edit Booking remained disabled after selecting booking rows');
    }
}
module.exports = { CarrierBookingPage }