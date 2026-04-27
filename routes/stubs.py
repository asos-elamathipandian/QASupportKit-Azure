"""Stub routes for "Local Only" features.

These endpoints are intentionally disabled on Azure.  They exist purely to
surface a clear, human-readable error message if they are somehow reached
(e.g. direct URL, API call, CI script).  The corresponding UI elements are
rendered as greyed-out with a lock icon and a "Local Only" badge so that
users cannot accidentally trigger them.
"""

from flask import Blueprint, jsonify

stubs_bp = Blueprint("stubs", __name__, url_prefix="/local-only")

_ERROR = (
    "This feature ({feature}) is only available in a local development "
    "environment and has been intentionally disabled on Azure. "
    "Please run the tool locally to use this functionality."
)


def _disabled(feature: str):
    return (
        jsonify(
            {
                "error": "LOCAL_ONLY_FEATURE",
                "feature": feature,
                "message": _ERROR.format(feature=feature),
            }
        ),
        503,
    )


@stubs_bp.route("/asn-lookup", methods=["GET", "POST"])
def asn_lookup():
    return _disabled("ASN Lookup")


@stubs_bp.route("/carrier-booking", methods=["GET", "POST"])
def carrier_booking():
    return _disabled("Carrier Booking")


@stubs_bp.route("/scc-flow", methods=["GET", "POST"])
def scc_flow():
    return _disabled("Full SCC Flow")


@stubs_bp.route("/ado-email", methods=["GET", "POST"])
def ado_email():
    return _disabled("ADO Email")
