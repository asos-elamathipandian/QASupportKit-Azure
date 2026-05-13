class CarrierBookingEditPage {
    constructor(frame) {
        this.frame = frame;
        this.loadingOverlay = '#loading.ui-loading-overlay';
        this.editrecordRows = '[id^="resultfield_appvbitemNoOfCarton_APP_PO--"]';
        this.numOfCartons = '[id^="resultfield_appvbitemNoOfCarton_APP_PO--"]';
        this.applyAllButton = '#applyAllButtonPanel';
        this.weightField = '[id$="appvbitem_UDF_Number_4-content-cell"]';
        this.fillweightField = '[id^="resultfield_appvbitem_UDF_Number_4_APP_PO"]';
        this.cargoReadyDate = '[id$="appvbCargoReadyDate-content-cell"]';
        this.fillCargoReadyDate = '[id^="resultfield_appvbCargoReadyDate_APP_PO"]';
        this.cargoDeliveryDate = '[id$="appvbCargoDeliveryDate-content-cell"]';
        this.fillcargoDeliveryDate = '[id^="resultfield_appvbCargoDeliveryDate_APP_PO"]';
        this.trafficModeOrigin = '[id$="appvbTrafficModeOrigin-content-cell"]';
        this.filltrafficModeOrigin = '[id^="resultfield_appvbTrafficModeOrigin_APP_PO"]';
        this.editBooking = { name: 'Edit Booking' };
        this.saveAfterEdit = { name: 'Save' };
        this.selectEditedBookingResult = '#resultTable-select-all';
        this.submitBookingAfterEdit = { name: 'Submit Booking' };
    }

    async waitForGridToBeReady() {
        await this.frame.locator(this.loadingOverlay).waitFor({ state: 'hidden', timeout: 15000 });
    }

    async safeClick(locator) {
        try {
            await locator.click({ timeout: 4000 });
        } catch {
            await locator.click({ force: true });
        }
    }

    async editCarrierBookingDetails() {
        const recordCount = await this.frame.locator(this.editrecordRows).count();
        for (let i = 0; i < recordCount; i++) {
            await this.safeClick(this.frame.locator(this.numOfCartons).nth(i));
            await this.frame.getByPlaceholder('#,##').fill('1');
            await this.safeClick(this.frame.locator(this.applyAllButton));
            await this.safeClick(this.frame.locator(this.weightField).nth(i));
            await this.safeClick(this.frame.locator(this.fillweightField).nth(i));
            await this.frame.getByPlaceholder('#,##').fill('0.01');
            await this.safeClick(this.frame.locator(this.applyAllButton));
        }
    }
    async selectDatepickerDay() {
        const dayNum = String(new Date().getDate());
        const dayLink = this.frame.locator('#ui-datepicker-div td[data-handler="selectDay"] a')
            .filter({ hasText: new RegExp(`^${dayNum}$`) }).first();
        await dayLink.waitFor({ state: 'visible', timeout: 10000 });
        await dayLink.click();
    }

    async editCarrierHeaderDetails() {
        await this.safeClick(this.frame.locator(this.cargoReadyDate).first());
        await this.safeClick(this.frame.locator(this.fillCargoReadyDate).first());
        await this.selectDatepickerDay();
        await this.safeClick(this.frame.locator(this.applyAllButton));
        await this.safeClick(this.frame.locator(this.cargoDeliveryDate).first());
        await this.safeClick(this.frame.locator(this.fillcargoDeliveryDate).first());
        await this.selectDatepickerDay();
        await this.safeClick(this.frame.locator(this.applyAllButton));
        await this.safeClick(this.frame.locator(this.trafficModeOrigin).first());
        await this.frame.locator(this.filltrafficModeOrigin).first().selectOption('CFS');
        await this.safeClick(this.frame.locator(this.applyAllButton));
    }
    async saveSubmitAfterEdit() {
        await this.safeClick(this.frame.getByRole('button', this.saveAfterEdit));
        await this.waitForGridToBeReady();
        await this.frame.locator(this.selectEditedBookingResult).check();
        await this.safeClick(this.frame.getByRole('button', this.submitBookingAfterEdit));

    }
}
module.exports = { CarrierBookingEditPage }