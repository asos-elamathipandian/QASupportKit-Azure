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
        const rowCount = await this.frame.locator('#resultTable .ui-grid-body-row').count();
        if (rowCount === 0) {
            console.log('[CarrierBookingApproval] No rows in approval grid — booking may already be Submitted/Approved. Skipping.');
            return;
        }
        const checkbox = this.frame.locator(this.selectAllCheck);
        await checkbox.waitFor({ state: 'visible', timeout: 15000 });
        await this.waitForGridToBeReady();

        const approveButton = this.frame.getByRole('button', this.approveBooking);

        // Retry selecting rows until Approve button becomes enabled (mirrors Edit Booking pattern)
        for (let attempt = 1; attempt <= 8; attempt++) {
            await this.frame.locator(this.loadingOverlay).waitFor({ state: 'hidden', timeout: 10000 }).catch(() => {});
            const isChecked = await checkbox.isChecked().catch(() => false);
            if (!isChecked) {
                await checkbox.evaluate(el => {
                    if (typeof jQuery !== 'undefined') jQuery(el).trigger('click');
                    else if (typeof $ !== 'undefined') $(el).trigger('click');
                    else el.click();
                }).catch(() => {});
            }
            // Give SCC time to enable action buttons after selection
            await new Promise(r => setTimeout(r, 500));
            const ariaDisabled = await approveButton.getAttribute('aria-disabled').catch(() => 'true');
            const className = (await approveButton.getAttribute('class').catch(() => '')) || '';
            const isDisabled = ariaDisabled === 'true' || className.includes('ui-state-disabled') || className.includes('ui-button-disabled');
            if (!isDisabled) {
                await approveButton.click();
                // Wait for approval to process
                await this.frame.locator(this.loadingOverlay).waitFor({ state: 'visible', timeout: 5000 }).catch(() => {});
                await this.frame.locator(this.loadingOverlay).waitFor({ state: 'hidden', timeout: 30000 }).catch(() => {});
                return;
            }
            console.log(`[CarrierBookingApproval] Approve button still disabled on attempt ${attempt}/8, retrying...`);
            await new Promise(r => setTimeout(r, 500));
        }
        throw new Error('Approve button remained disabled after selecting rows');
    }

}
module.exports = { CarrierBookingApprovalPage }