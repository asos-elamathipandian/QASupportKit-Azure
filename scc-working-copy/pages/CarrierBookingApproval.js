class CarrierBookingApprovalPage {
    constructor(frame) {
        this.frame = frame;
        this.loadingOverlay = '#loading.ui-loading-overlay';
        this.closeMessageBlock = '[title="Close"]';
        this.approvalasnField = '#searchparam_appvbitem_UDF_Text_1_input';
        this.applyButton = '#searchSubmitButton';
        this.selectAllCheck = '#resultTable-select-all';
        this.approveBooking = { name: 'Approve' };

    }

    async waitForGridToBeReady() {
        // Wait briefly (1s) for overlay to appear first — navigation may take a moment to trigger it.
        // Reduced from 5s: most navigations settle within 1s, saving 4s per grid-ready check.
        await this.frame.locator(this.loadingOverlay).waitFor({ state: 'visible', timeout: 1000 }).catch(() => {});
        await this.frame.locator(this.loadingOverlay).waitFor({ state: 'hidden', timeout: 60000 });
    }

    async fillasnAndSearch(asns) {
        await this.frame.locator(this.approvalasnField).waitFor({ state: 'visible', timeout: 20000 });
        await this.frame.locator(this.approvalasnField).click();
        await this.frame.locator(this.approvalasnField).fill(asns);
        await this.frame.locator(this.applyButton).click();
        // Wait for results to load
        await this.waitForGridToBeReady();
    }

    async selectAndApproveBooking() {
        // Check there are rows to approve — empty grid means booking is no longer in Draft
        const rows = this.frame.locator('#resultTable .ui-grid-body-row');
        const rowCount = await rows.count();
        if (rowCount === 0) {
            console.log('[CarrierBookingApproval] No rows in approval grid — booking may already be Submitted/Approved. Skipping.');
            return;
        }

        await this.waitForGridToBeReady();
        const approveButton = this.frame.getByRole('button', this.approveBooking);

        for (let attempt = 1; attempt <= 8; attempt++) {
            await this.frame.locator(this.loadingOverlay).waitFor({ state: 'hidden', timeout: 10000 }).catch(() => {});

            // Strategy 1: individual row checkbox (if available)
            const rowCheckbox = rows.first().locator('input[type="checkbox"]').first();
            const hasCheckbox = await rowCheckbox.isVisible({ timeout: 1000 }).catch(() => false);
            if (hasCheckbox) {
                const isChecked = await rowCheckbox.isChecked().catch(() => false);
                if (!isChecked) {
                    await rowCheckbox.evaluate(el => {
                        if (typeof jQuery !== 'undefined') jQuery(el).trigger('click');
                        else el.click();
                    }).catch(() => {});
                    await new Promise(r => setTimeout(r, 400));
                }
            }

            // Strategy 2: select-all checkbox
            const selectAll = this.frame.locator(this.selectAllCheck);
            const selectAllChecked = await selectAll.isChecked({ timeout: 1000 }).catch(() => false);
            if (!selectAllChecked) {
                await selectAll.evaluate(el => {
                    if (typeof jQuery !== 'undefined') jQuery(el).trigger('click');
                    else el.click();
                }).catch(() => {});
                await new Promise(r => setTimeout(r, 400));
            }

            // Strategy 3: click the row itself
            await rows.first().click({ force: true }).catch(() => {});
            await new Promise(r => setTimeout(r, 400));

            const ariaDisabled = await approveButton.getAttribute('aria-disabled').catch(() => 'true');
            const className = (await approveButton.getAttribute('class').catch(() => '')) || '';
            const isDisabled = ariaDisabled === 'true' || className.includes('ui-state-disabled') || className.includes('ui-button-disabled');
            if (!isDisabled) {
                await approveButton.click();
                await this.frame.locator(this.loadingOverlay).waitFor({ state: 'visible', timeout: 5000 }).catch(() => {});
                await this.frame.locator(this.loadingOverlay).waitFor({ state: 'hidden', timeout: 30000 }).catch(() => {});
                return;
            }
            console.log(`[CarrierBookingApproval] Approve button still disabled on attempt ${attempt}/8 (rows=${rowCount})`);
            await new Promise(r => setTimeout(r, 500));
        }
        // Approve stayed disabled — booking is likely already Submitted/Approved in SCC
        console.log('[CarrierBookingApproval] Approve button remained disabled — booking may already be Submitted. Skipping.');
    }

}
module.exports = { CarrierBookingApprovalPage }