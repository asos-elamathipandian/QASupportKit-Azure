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
        if (this.page) await this.page.waitForLoadState('domcontentloaded').catch(() => {});
        await this.waitForGridToBeReady();

        // Diagnose: dump all element IDs in the edit grid so we can verify selectors
        const allIds = await this.frame.evaluate(() =>
            Array.from(document.querySelectorAll('[id]'))
                .map(el => el.id)
                .filter(id => id && (id.includes('NoOfCarton') || id.includes('UDF_Number_4') || id.includes('content-cell')))
                .slice(0, 40)
        ).catch(() => []);
        console.log('[DIAG] Edit grid IDs:', JSON.stringify(allIds));

        // Try the specific selector; if not found, fall back to any cell matching carton-like IDs
        const cartonSelector = allIds.some(id => id.includes('content-cell'))
            ? '[id*="appvbitemNoOfCarton"][id*="content-cell"]'
            : '[id*="NoOfCarton"]';
        const weightSelector = allIds.some(id => id.includes('UDF_Number_4'))
            ? '[id*="UDF_Number_4"][id*="content-cell"]'
            : '[id*="UDF_Number_4"]';
        console.log(`[DIAG] Using cartonSelector="${cartonSelector}" weightSelector="${weightSelector}"`);

        // Wait for first carton cell
        await this.frame.locator(cartonSelector)
            .first().waitFor({ state: 'visible', timeout: 30000 });

        // ── Cartons: fill every row that still shows 0 ──
        // Repeat until no unfilled rows remain (avoids needing an accurate row count)
        for (let pass = 0; pass < 20; pass++) {
            await this.waitForGridToBeReady();
            // Find the first carton content-cell whose displayed value is 0 or empty
            const allCartonCells = this.frame.locator(cartonSelector);
            const cellCount = await allCartonCells.count();
            let filledAny = false;
            for (let i = 0; i < cellCount; i++) {
                const cell = allCartonCells.nth(i);
                const val = (await cell.textContent({ timeout: 2000 }).catch(() => '')).trim().replace(/,/g, '');
                if (val === '' || val === '0' || val === '0.00' || parseFloat(val) === 0) {
                    await this.safeClick(cell);
                    await new Promise(r => setTimeout(r, 500));
                    if (this.page) {
                        await this.page.keyboard.press('Control+a');
                        await this.page.keyboard.type('1');
                        await new Promise(r => setTimeout(r, 400));
                    } else {
                        await this.frame.locator(this.numOfCartons).first().fill('1').catch(async () => {
                            await this.frame.getByPlaceholder('#,##0').first().fill('1');
                        });
                    }
                    await this.safeClick(this.frame.locator(this.applyAllButton));
                    await this.waitForGridToBeReady();
                    filledAny = true;
                    break; // re-query after each Apply All so indexes stay fresh
                }
            }
            if (!filledAny) break; // all carton cells are filled
        }

        // ── Weights: fill every row that still shows 0 ──
        await this.frame.locator(weightSelector)
            .first().waitFor({ state: 'visible', timeout: 30000 }).catch(() => {});

        for (let pass = 0; pass < 20; pass++) {
            await this.waitForGridToBeReady();
            const allWeightCells = this.frame.locator(weightSelector);
            const cellCount = await allWeightCells.count();
            let filledAny = false;
            for (let i = 0; i < cellCount; i++) {
                const cell = allWeightCells.nth(i);
                const val = (await cell.textContent({ timeout: 2000 }).catch(() => '')).trim().replace(/,/g, '');
                if (val === '' || val === '0' || val === '0.00' || parseFloat(val) === 0) {
                    await this.safeClick(cell);
                    await new Promise(r => setTimeout(r, 500));
                    if (this.page) {
                        await this.page.keyboard.press('Control+a');
                        await this.page.keyboard.type('0.01');
                        await new Promise(r => setTimeout(r, 400));
                    } else {
                        await this.frame.locator(this.fillweightField).first().fill('0.01').catch(async () => {
                            await this.frame.getByPlaceholder('#,##0.##').first().fill('0.01');
                        });
                    }
                    await this.safeClick(this.frame.locator(this.applyAllButton));
                    await this.waitForGridToBeReady();
                    filledAny = true;
                    break;
                }
            }
            if (!filledAny) break;
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