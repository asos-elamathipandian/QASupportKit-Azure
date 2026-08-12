class CarrierBookingEditPage {
    constructor(frame, page = null) {
        this.frame = frame;
        this.page = page;
        this.loadingOverlay = '#loading.ui-loading-overlay';
        // content-cell is always in DOM; resultfield_ input only exists when that cell is active
        this.cartonContentCell = '[id$="appvbitemNoOfCarton-content-cell"]';
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
        const recordCount = await this.frame.locator(this.editrecordRows).count();
        console.log(`[edit] Found ${recordCount} carton row(s)`);

        // Fill cartons — resultfield_ elements may be the inputs themselves or wrappers
        for (let i = 0; i < recordCount; i++) {
            const cartonCell = this.frame.locator(this.numOfCartons).nth(i);
            await this.safeClick(cartonCell);
            await new Promise(r => setTimeout(r, 400));
            // Try filling the element directly first (handles case where resultfield_ IS the input)
            const directFilled = await cartonCell.fill('1', { timeout: 3000 }).then(() => true).catch(() => false);
            if (!directFilled) {
                await cartonCell.locator('input').first().fill('1', { timeout: 5000 }).catch(async () => {
                    await this.frame.getByPlaceholder('#,##0').first().fill('1', { timeout: 5000 }).catch(() => {});
                });
            }
            console.log(`[edit] Carton row ${i} filled: ${directFilled ? 'direct' : 'fallback'}`);
        }

        // Fill weights
        for (let i = 0; i < recordCount; i++) {
            await this.safeClick(this.frame.locator(this.weightField).nth(i));
            const weightInput = this.frame.locator(this.fillweightField).nth(i);
            await this.safeClick(weightInput);
            const directFilled = await weightInput.fill('0.01', { timeout: 3000 }).then(() => true).catch(() => false);
            if (!directFilled) {
                await weightInput.locator('input').first().fill('0.01', { timeout: 5000 }).catch(async () => {
                    await this.frame.getByPlaceholder('#,##0.##').first().fill('0.01', { timeout: 5000 }).catch(() => {});
                });
            }
            console.log(`[edit] Weight row ${i} filled: ${directFilled ? 'direct' : 'fallback'}`);
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
        await this.waitForGridToBeReady();

        await this.safeClick(this.frame.locator(this.cargoReadyDate).first());
        await this.safeClick(this.frame.locator(this.fillCargoReadyDate).first());
        await this.selectDatepickerDay();
        await this.safeClick(this.frame.locator(this.applyAllButton));
        await this.waitForGridToBeReady();

        await this.safeClick(this.frame.locator(this.cargoDeliveryDate).first());
        await this.safeClick(this.frame.locator(this.fillcargoDeliveryDate).first());
        await this.selectDatepickerDay();
        await this.safeClick(this.frame.locator(this.applyAllButton));
        await this.waitForGridToBeReady();

        // Click the content cell first, wait for the inline select to activate, then choose CFS
        await this.safeClick(this.frame.locator(this.trafficModeOrigin).first());
        await this.frame.locator(this.filltrafficModeOrigin).first()
            .waitFor({ state: 'visible', timeout: 8000 });
        await this.frame.locator(this.filltrafficModeOrigin).first().selectOption('CFS');
        await this.safeClick(this.frame.locator(this.applyAllButton));
        await this.waitForGridToBeReady();
    }
    async saveSubmitAfterEdit() {
        await this.safeClick(this.frame.getByRole('button', this.saveAfterEdit));
        await this.waitForGridToBeReady();
        const selectAllCb = this.frame.locator(this.selectEditedBookingResult);
        await selectAllCb.waitFor({ state: 'visible', timeout: 10000 });
        await selectAllCb.evaluate(el => {
            if (typeof jQuery !== 'undefined') jQuery(el).trigger('click');
            else if (typeof $ !== 'undefined') $(el).trigger('click');
            else el.click();
        }).catch(() => {});
        await new Promise(r => setTimeout(r, 400));
        const vbReference = await this.frame.locator('[title*="VB-000"]').first()
            .textContent({ timeout: 5000 }).then(t => t.trim()).catch(() => null);

        await this.safeClick(this.frame.getByRole('button', this.submitBookingAfterEdit));

        // Wait for SCC to process. The iframe may briefly lose its execution context
        // (e.g. "Fail to execute" banner or Tolerance Exception) but the main page stays alive.
        // After 3 seconds the iframe will have reloaded; read the status then.
        await new Promise(r => setTimeout(r, 3000));
        let bookingStatus = 'Draft';
        try {
            await this.frame.locator('#resultTable-select-all')
                .waitFor({ state: 'visible', timeout: 10000 });
            const cell = this.frame.locator('[id^="resultfield_appvbStatus"]').first();
            const status = await cell.textContent({ timeout: 5000 }).then(t => t.trim()).catch(() => '');
            if (status) bookingStatus = status;
        } catch {
            // Iframe had an error (tolerance exception, submit fail) — booking is Draft
            // Main page is still alive; the approval flow will navigate from here.
            console.log('[saveSubmitAfterEdit] Submit resulted in Draft/error — proceeding to approval.');
        }

        return { vbReference, bookingStatus };
    }
}
module.exports = { CarrierBookingEditPage }