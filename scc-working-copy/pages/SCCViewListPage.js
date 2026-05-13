class SCCViewListPage {
    constructor(frame) {
        this.frame = frame;
        this.orderSearchLink = { name: 'ASOS Order Search', exact: true };
        this.carrierBookingDetail = { name: 'ASOS Carrier Booking Detail' };
        this.carrierApproval = { name: 'ASOS Carrier Booking Approvals', exact: true };
    }

    async navigateToOrderSearch() {
        await this.frame.getByRole('link', this.orderSearchLink).click();
    }
    async navigateToCarrierBooking() {
        await this.frame.getByRole('link', this.carrierBookingDetail).click();
    }
    async navigateToCarrierApproval() {
        await this.frame.getByRole('link', this.carrierApproval).click();
    }

}
module.exports = { SCCViewListPage }