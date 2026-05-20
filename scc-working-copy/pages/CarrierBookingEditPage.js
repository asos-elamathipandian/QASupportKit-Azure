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

        // Fill cartons for all rows — no Apply All per row (avoid mid-fill navigation)
        for (let i = 0; i < recordCount; i++) {
            const cartonCell = this.frame.locator(this.numOfCartons).nth(i);
            await this.safeClick(cartonCell);
            await new Promise(r => setTimeout(r, 400));
            // Target the input inside this specific cell (only one inline editor opens at a time)
            await cartonCell.locator('input').first().fill('1').catch(async () => {
                await this.frame.getByPlaceholder('#,##').first().fill('1');
            });
        }

        // Fill weights for all rows — no Apply All per row
        for (let i = 0; i < recordCount; i++) {
            await this.safeClick(this.frame.locator(this.weightField).nth(i));
            await this.safeClick(this.frame.locator(this.fillweightField).nth(i));
            await this.frame.locator(this.fillweightField).nth(i).fill('0.01').catch(async () => {
                await this.frame.getByPlaceholder('#,##').first().fill('0.01');
            });
        }

        // Single Apply All at the end to confirm all entered values
        await this.safeClick(this.frame.locator(this.applyAllButton));
        await this.waitForGridToBeReady();
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
        // Capture the VB reference of the booking we are about to submit
        const vbReference = await this.frame.locator('[title*="VB-000"]').first()
            .textContent({ timeout: 5000 }).then(t => t.trim()).catch(() => null);
        await this.safeClick(this.frame.getByRole('button', this.submitBookingAfterEdit));
        // Wait for SCC to process the submission — overlay may appear briefly then clear
        await this.frame.locator(this.loadingOverlay).waitFor({ state: 'visible', timeout: 5000 }).catch(() => {});
        await this.waitForGridToBeReady();
        return vbReference;
    }
}
module.exports = { CarrierBookingEditPage }