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
        await this.frame.locator(this.loadingOverlay).waitFor({ state: 'hidden', timeout: 15000 });
    }

    async fillasnAndSearch(asns) {
        await this.frame.locator(this.approvalasnField).click();
        await this.frame.locator(this.approvalasnField).fill(asns);
        await this.frame.locator(this.applyButton).click();
    }
    async selectAndApproveBooking() {
        await this.waitForGridToBeReady();
        // Check there are rows to approve — empty grid means booking is no longer in Draft
        const rowCount = await this.frame.locator('#resultTable .ui-grid-body-row').count();
        if (rowCount === 0) {
            console.log('[CarrierBookingApproval] No rows in approval grid — booking may already be Submitted/Approved. Skipping.');
            return;
        }
        const checkbox = this.frame.locator(this.selectAllCheck);
        await checkbox.waitFor();
        await this.waitForGridToBeReady();
        // SCC auto-selects rows on load — only click if not already checked
        const isChecked = await checkbox.isChecked().catch(() => false);
        if (!isChecked) {
            await checkbox.click({ force: true });
        }
        await this.frame.getByRole('button', this.approveBooking).click();
    }

}
module.exports = { CarrierBookingApprovalPage }