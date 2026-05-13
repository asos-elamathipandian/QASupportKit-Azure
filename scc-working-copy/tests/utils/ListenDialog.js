class ListenDialog {
    constructor(page) {
        this.page = page;
    }
    async acceptDialog() {
        this.page.once('dialog', dialog => {
            console.log(`Dialog message: ${dialog.message()}`);
            dialog.accept().catch(() => { });
        });
    }
    async dismissDialog() {
        this.page.once('dialog', dialog => {
            console.log(`Dialog message: ${dialog.message()}`);
            dialog.dismiss().catch(() => { });
        });
    }
}
module.exports = { ListenDialog };