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
        await this.frame.locator(this.loadingOverlay).waitFor({ state: 'hidden', timeout: 15000 });
    }

    async expandandClearFilter() {
        // Wait for the page to finish navigating before interacting with the iframe
        await this.page.waitForLoadState('domcontentloaded');
        await this.frame.locator('body').waitFor({ state: 'attached', timeout: 15000 });
        const clearFilterButton = this.frame.getByRole('button', this.clearButton);
        try {
            if (await clearFilterButton.isVisible({ timeout: 5000 })) {
                await clearFilterButton.click();
            }
            else {
                await this.frame.locator(this.expandFilter).waitFor({ timeout: 5000 });
                await this.frame.locator(this.expandFilter).click();
                await clearFilterButton.click();
            }
        } catch (e) {
            // Frame may have reloaded; try expanding filter as fallback
            await this.frame.locator(this.expandFilter).waitFor({ timeout: 10000 });
            await this.frame.locator(this.expandFilter).click();
            await clearFilterButton.click();
        }
    }
    async searchWithasnAndstatus(asns) {
        await this.frame.locator(this.asnField).click();
        await this.frame.locator(this.asnField).fill(asns);
        await this.frame.locator(this.statusDropDown).click();
        await this.frame.getByLabel('Draft', { exact: true }).check();
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
    async getBookingStatus(vbReference) {
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
            console.log(`VB ${vbReference} not found in grid rows, falling back to first row`);
        }

        const statusLocator = this.frame.locator(this.statusCell).first();
        try {
            await statusLocator.waitFor({ state: 'visible', timeout: 5000 });
            const statusText = (await statusLocator.textContent()).trim();
            if (statusText) {
                return statusText;
            }
            const titleText = await statusLocator.getAttribute('title');
            return titleText ? titleText.trim() : 'Unknown';
        } catch {
            // Booking Status column may not be visible in the current grid layout
            console.log('Booking Status column not found in grid. Checking criterion summary...');
            const criterionText = await this.frame.locator('.summary-section, [class*="criterion"], [class*="summary"]').first().textContent().catch(() => '');
            if (criterionText.toLowerCase().includes('submitted')) return 'Submitted';
            if (criterionText.toLowerCase().includes('draft')) return 'Draft';
            return 'Unknown';
        }
    }
    async selectAndEditBooking() {
        const selectAll = this.frame.locator(this.selectAllCheck);
        const editButton = this.frame.getByRole('button', this.editBooking);

        await selectAll.waitFor({ state: 'visible', timeout: 15000 });

        for (let attempt = 1; attempt <= 8; attempt += 1) {
            await this.waitForGridToBeReady();

            // Ensure at least one row is selected before trying Edit.
            await selectAll.check({ force: true }).catch(async () => {
                await selectAll.click();
            });

            const ariaDisabled = await editButton.getAttribute('aria-disabled');
            const className = (await editButton.getAttribute('class')) || '';
            const isDisabled = ariaDisabled === 'true' || className.includes('ui-state-disabled') || className.includes('ui-button-disabled');

            if (!isDisabled) {
                await editButton.click();
                return;
            }

            await this.page.waitForTimeout(1500);
        }

        throw new Error('Edit Booking remained disabled after selecting booking rows');
    }
}
module.exports = { CarrierBookingPage }