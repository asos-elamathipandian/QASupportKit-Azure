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
        await this.frame.locator(this.selectAllCheck).waitFor();
        await this.waitForGridToBeReady();
        await this.frame.locator(this.selectAllCheck).check();
        await this.frame.getByRole('button', this.approveBooking).click();
    }

}
module.exports = { CarrierBookingApprovalPage }