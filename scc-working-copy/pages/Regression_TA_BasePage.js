export class Regression_TA_BasePage {
  constructor(page) {
    this.page = page;
  }

  frame(name) {
    return this.page.frameLocator(`iframe[name="${name}"]`);
  }
}