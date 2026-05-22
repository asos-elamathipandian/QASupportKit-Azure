class CarrierBookingEditPage {
    constructor(frame, page = null) {
        this.frame = frame;
        this.page = page;
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
        this.carrierBookingRequestDate = '[id$="appvbCarrierBookingRequestDate-content-cell"]';
        this.fillCarrierBookingRequestDate = '[id^="resultfield_appvbCarrierBookingRequestDate_APP_PO"]';
        this.editBooking = { name: 'Edit Booking' };
        this.saveAfterEdit = { name: 'Save' };
        this.selectEditedBookingResult = '#resultTable-select-all';
        this.submitBookingAfterEdit = { name: 'Submit Booking' };
    }

    async waitForGridToBeReady() {
        await this.frame.locator(this.loadingOverlay).waitFor({ state: 'hidden', timeout: 60000 });
    }

    async safeClick(locator) {
        try {
            await locator.click({ timeout: 4000 });
        } catch {
            await locator.click({ force: true });
        }
    }

    async editCarrierBookingDetails() {
        // Ensure the outer page has finished any navigation before touching iframe content.
        // This prevents 'Target page, context or browser has been closed' on locator.fill.
        if (this.page) await this.page.waitForLoadState('domcontentloaded').catch(() => {});
        // Ensure the edit form has fully loaded before interacting with inline editors
        await this.waitForGridToBeReady();
        // Wait for the first editable row to be present and visible
        await this.frame.locator(this.editrecordRows).first().waitFor({ state: 'visible', timeout: 30000 });
        const recordCount = await this.frame.locator(this.editrecordRows).count();

        // Fill cartons for all rows.
        // SCC's inline editor input is NOT a DOM child of the resultfield_ cell — it appears
        // as a sibling/overlay. After safeClick the input is already focused, so use
        // keyboard to clear + type, which works regardless of DOM structure.
        for (let i = 0; i < recordCount; i++) {
            const cartonCell = this.frame.locator(this.numOfCartons).nth(i);
            await this.safeClick(cartonCell);
            await new Promise(r => setTimeout(r, 500));
            if (this.page) {
                await this.page.keyboard.press('Control+a');
                await this.page.keyboard.type('1');
            } else {
                // Fallback when page not available: fill directly on the resultfield_ element
                await cartonCell.fill('1').catch(async () => {
                    await this.frame.getByPlaceholder('#,##0').first().fill('1');
                });
            }
        }

        // Apply All after cartons — commits the last open inline editor and reloads the grid
        // Without this the last row's confirm button overlaps the Unit Weight cell
        await this.safeClick(this.frame.locator(this.applyAllButton));
        await this.waitForGridToBeReady();
        await this.frame.locator(this.editrecordRows).first().waitFor({ state: 'visible', timeout: 30000 });

        // Fill weights for all rows — two-click activation: content-cell first, then result-field input
        const weightRecordCount = await this.frame.locator(this.fillweightField).count();
        for (let i = 0; i < weightRecordCount; i++) {
            await this.frame.locator(this.loadingOverlay).waitFor({ state: 'hidden', timeout: 10000 }).catch(() => {});
            await this.safeClick(this.frame.locator(this.weightField).nth(i));
            await new Promise(r => setTimeout(r, 300));
            await this.safeClick(this.frame.locator(this.fillweightField).nth(i));
            await new Promise(r => setTimeout(r, 500));
            if (this.page) {
                await this.page.keyboard.press('Control+a');
                await this.page.keyboard.type('0.01');
            } else {
                await this.frame.locator(this.fillweightField).nth(i).fill('0.01').catch(async () => {
                    await this.frame.getByPlaceholder('#,##0.##').first().fill('0.01');
                });
            }
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
        // Carrier Booking Request Date — skip gracefully if field is not present in this view
        const carrierReqDateCell = this.frame.locator(this.carrierBookingRequestDate).first();
        const hasCarrierReqDate = await carrierReqDateCell.count().then(c => c > 0).catch(() => false);
        if (hasCarrierReqDate) {
            await this.safeClick(carrierReqDateCell);
            const fillField = this.frame.locator(this.fillCarrierBookingRequestDate).first();
            await fillField.waitFor({ state: 'visible', timeout: 5000 }).catch(() => {});
            await this.safeClick(fillField);
            await this.selectDatepickerDay();
            await this.safeClick(this.frame.locator(this.applyAllButton));
        }
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