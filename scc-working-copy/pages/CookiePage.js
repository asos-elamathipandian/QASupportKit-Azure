class CookiePage {
    constructor(page) {
        this.page = page;
        this.agreeButton = { name: 'Agree and proceed' };
    }
    async gotoPage(URL) {
        await this.page.goto(URL);
    }
    async agreeCookies() {
        await this.page.getByRole('button', this.agreeButton).click();
    }
}
module.exports = { CookiePage };