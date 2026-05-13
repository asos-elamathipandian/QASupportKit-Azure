class SCCHomepage {
    constructor(page) {
        this.page = page;
        this.menuButton = '.eto-header__menu-toggle';
        this.DDPTools = '[title="DDP, WIP & Tools"]';
        this.viewListLink = { name: 'View List', exact: true };
    }
    async openMenuIfCollapsed() {
        const toggle = this.page.locator(this.menuButton).first();
        await toggle.waitFor({ state: 'visible', timeout: 30000 });
        const expanded = await toggle.getAttribute('aria-expanded');
        if (expanded !== 'true') {
            await toggle.click();
            // Allow menu animation to complete before interacting with items
            await this.page.waitForTimeout(500);
        }
    }
    async navigateToViewList() {
        await this.openMenuIfCollapsed();
        const ddpTools = this.page.locator(this.DDPTools).first();
        await ddpTools.waitFor({ state: 'visible', timeout: 10000 });
        await ddpTools.click();
        const viewList = this.page.getByRole('link', this.viewListLink);
        await viewList.waitFor({ state: 'visible', timeout: 10000 });
        await viewList.click();
    }
}
module.exports = { SCCHomepage };