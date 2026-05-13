class OrderSearchPage {
    constructor(page, frame) {
        this.page = page;
        this.frame = frame;
        this.loadingOverlay = '#loading.ui-loading-overlay';
        this.clearButton = { name: 'Clear All Filters' };
        this.expandFilter = '.ui-icon-circlesmall-plus';
        this.asnField = '#searchparam_apppoitem_UDF_Text_5_input';
        this.applyButton = '#searchSubmitButton';
        this.selectAllCheck = '#resultTable-select-all';
        this.createBooking = { name: 'Create Booking' };
        this.closeMessageBlock = '[title="Close"]';
        this.closeResultMessage = { name: 'close' };
    }

    async waitForGridToBeReady() {
        await this.frame.locator(this.loadingOverlay).waitFor({ state: 'hidden', timeout: 15000 });
    }

    async clearFilter() {
        try {
            await this.frame.locator(this.closeMessageBlock).click({ timeout: 5000 });
        } catch {
            // Message block may not be present or frame may have reloaded
        }
        const clearFilterButton = this.frame.getByRole('button', this.clearButton);
        if (await clearFilterButton.isVisible()) {
            await clearFilterButton.click();
        }
        else {
            await this.frame.locator(this.expandFilter).click();
            await clearFilterButton.click();
        }
    }
    async fillasnAndSearch(asns) {
        await this.frame.locator(this.asnField).click();
        await this.frame.locator(this.asnField).fill(asns);
        await this.frame.locator(this.applyButton).click();
    }
    async selectAndCreateBooking() {
        const selectAll = this.frame.locator(this.selectAllCheck);
        const createBookingBtn = this.frame.getByRole('button', this.createBooking);

        await selectAll.waitFor({ state: 'visible', timeout: 15000 });

        for (let attempt = 1; attempt <= 5; attempt += 1) {
            await this.waitForGridToBeReady();

            try {
                await selectAll.check({ timeout: 3000 });
            } catch {
                await selectAll.click({ force: true });
            }

            const checked = await selectAll.isChecked().catch(() => false);
            if (checked) {
                await createBookingBtn.click({ timeout: 10000 });
                return;
            }

            await this.page.waitForTimeout(1000 * attempt);
        }

        throw new Error('Select All checkbox was not selected in Order Search');
    }
    async closeResult() {
        try {
            await this.page.getByRole('button', this.closeResultMessage).click({ timeout: 5000 });
        } catch {
            // Page may have already navigated or closed the message block
        }
    }
}
module.exports = { OrderSearchPage }