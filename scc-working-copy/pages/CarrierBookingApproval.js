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
        // Wait briefly for overlay to appear first (navigation may take a moment to trigger it)
        await this.frame.locator(this.loadingOverlay).waitFor({ state: 'visible', timeout: 5000 }).catch(() => {});
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
        // SCC auto-selects rows on load — only click if not already checked
        const isChecked = await checkbox.isChecked().catch(() => false);
        if (!isChecked) {
            await checkbox.click({ force: true });
        }
        await this.frame.getByRole('button', this.approveBooking).click();
        // Wait for approval to process
        await this.frame.locator(this.loadingOverlay).waitFor({ state: 'visible', timeout: 5000 }).catch(() => {});
        await this.frame.locator(this.loadingOverlay).waitFor({ state: 'hidden', timeout: 30000 }).catch(() => {});
    }

}
module.exports = { CarrierBookingApprovalPage }