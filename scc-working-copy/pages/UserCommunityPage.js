class UserCommunityPage {
    constructor(page) {
        this.page = page;
        this.dropDown = '#dropdownlist';
        this.option = 'staging-idp.staging.e2open.com';
        this.selectButton = { name: 'Select' };
    }
    async selectDropDownAndProceed() {
        await this.page.locator(this.dropDown).selectOption(this.option);
        await this.page.getByRole('button', this.selectButton).click();

    }
}
module.exports = { UserCommunityPage };