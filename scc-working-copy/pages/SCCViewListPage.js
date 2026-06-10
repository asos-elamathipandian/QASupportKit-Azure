class SCCViewListPage {
    constructor(frame) {
        this.frame = frame;
        this.orderSearchLink = { name: 'ASOS Order Search', exact: true };
        this.carrierBookingDetail = { name: 'ASOS Carrier Booking Detail' };
        this.carrierApproval = { name: 'ASOS Carrier Booking Approvals', exact: true };
    }

    async navigateToOrderSearch() {
        const link = this.frame.getByRole('link', this.orderSearchLink);
        await link.waitFor({ state: 'visible', timeout: 30000 });
        await link.click();
    }
    async navigateToCarrierBooking() {
        const link = this.frame.getByRole('link', this.carrierBookingDetail);
        await link.waitFor({ state: 'visible', timeout: 30000 });
        await link.click();
    }
    async navigateToCarrierApproval() {
        const link = this.frame.getByRole('link', this.carrierApproval);
        await link.waitFor({ state: 'visible', timeout: 30000 });
        await link.click();
    }

}
module.exports = { SCCViewListPage }