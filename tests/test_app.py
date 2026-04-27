"""Tests for QASupportKit-Azure.

Covers:
- Dashboard renders all enabled and disabled features.
- XML generators produce valid XML (ASN, Order, Inventory).
- Local-only stub endpoints return HTTP 503 with the correct JSON error structure.
- Blob download returns 400 when parameters are missing.
"""

import json
import pytest
from lxml import etree

from app import create_app


@pytest.fixture()
def client():
    app = create_app()
    app.config["TESTING"] = True
    with app.test_client() as c:
        yield c


# ── Dashboard ─────────────────────────────────────────────────────────────────

class TestDashboard:
    def test_index_ok(self, client):
        r = client.get("/")
        assert r.status_code == 200

    def test_index_has_enabled_links(self, client):
        r = client.get("/")
        body = r.data.decode()
        assert "/xml/generate/asn" in body
        assert "/xml/generate/order" in body
        assert "/xml/generate/inventory" in body
        assert "/sftp/" in body
        assert "/blob/" in body

    def test_index_has_local_only_badges(self, client):
        r = client.get("/")
        body = r.data.decode()
        # All four disabled features should appear
        for feature in ("ASN Lookup", "Carrier Booking", "Full SCC Flow", "ADO Email"):
            assert feature in body, f"Expected '{feature}' on dashboard"
        # Badge text should appear at least once
        assert "Local Only" in body

    def test_index_disabled_buttons_not_linked(self, client):
        """Disabled features should NOT have live hrefs to local-only stubs."""
        r = client.get("/")
        body = r.data.decode()
        assert "/local-only/" not in body


# ── XML Generators ────────────────────────────────────────────────────────────

class TestXMLGenerators:
    def test_asn_page_get(self, client):
        r = client.get("/xml/generate/asn")
        assert r.status_code == 200

    def test_asn_generates_valid_xml(self, client):
        r = client.post("/xml/generate/asn", data={
            "shipment_id": "SHP-001",
            "carrier": "DHL",
            "tracking_number": "123ABC",
            "ship_date": "2024-06-01",
            "items": "SKU-A\nSKU-B",
            "generate": "1",
        })
        assert r.status_code == 200
        body = r.data.decode()
        assert "SHP-001" in body
        assert "DHL" in body
        # Both items should appear as separate Item elements in the output
        assert "SKU-A" in body
        assert "SKU-B" in body

    def test_asn_download_returns_xml_file(self, client):
        r = client.post("/xml/generate/asn", data={
            "shipment_id": "SHP-DL",
            "carrier": "UPS",
            "tracking_number": "TRK-999",
            "ship_date": "2024-06-02",
            "items": "SKU-X\nSKU-Y",
            "download": "1",
        })
        assert r.status_code == 200
        assert r.content_type.startswith("application/xml")
        root = etree.fromstring(r.data)
        assert root.tag == "ASN"
        assert root.findtext("ShipmentID") == "SHP-DL"
        items = [el.text for el in root.find("Items").findall("Item")]
        assert "SKU-X" in items
        assert "SKU-Y" in items

    def test_order_generates_valid_xml(self, client):
        r = client.post("/xml/generate/order", data={
            "order_id": "ORD-555",
            "customer_name": "Alice",
            "delivery_date": "2024-07-01",
            "order_lines": "SKU-001 x2",
            "download": "1",
        })
        assert r.status_code == 200
        root = etree.fromstring(r.data)
        assert root.tag == "Order"
        assert root.findtext("OrderID") == "ORD-555"
        assert root.findtext("CustomerName") == "Alice"

    def test_inventory_generates_valid_xml(self, client):
        r = client.post("/xml/generate/inventory", data={
            "warehouse_id": "WH-LON-01",
            "update_date": "2024-06-15",
            "skus": "SKU-001, 100\nSKU-002, 50",
            "download": "1",
        })
        assert r.status_code == 200
        root = etree.fromstring(r.data)
        assert root.tag == "InventoryUpdate"
        assert root.findtext("WarehouseID") == "WH-LON-01"
        skus = root.find("SKUs")
        assert skus is not None
        codes = [sku.get("code") for sku in skus.findall("SKU")]
        assert "SKU-001" in codes
        assert "SKU-002" in codes


# ── SFTP Upload ───────────────────────────────────────────────────────────────

class TestSFTPUpload:
    def test_sftp_page_get(self, client):
        r = client.get("/sftp/")
        assert r.status_code == 200

    def test_sftp_missing_fields_shows_error(self, client):
        from io import BytesIO
        r = client.post("/sftp/", data={
            "host": "",
            "port": "22",
            "username": "",
            "password": "",
            "remote_path": "/",
        }, content_type="multipart/form-data")
        assert r.status_code == 200
        assert "required" in r.data.decode().lower()


# ── Blob Search ───────────────────────────────────────────────────────────────

class TestBlobSearch:
    def test_blob_page_get(self, client):
        r = client.get("/blob/")
        assert r.status_code == 200

    def test_blob_download_missing_params(self, client):
        r = client.post("/blob/download", data={})
        assert r.status_code == 400


# ── Local-Only Stubs ──────────────────────────────────────────────────────────

class TestLocalOnlyStubs:
    @pytest.mark.parametrize("path,feature", [
        ("/local-only/asn-lookup",     "ASN Lookup"),
        ("/local-only/carrier-booking","Carrier Booking"),
        ("/local-only/scc-flow",       "Full SCC Flow"),
        ("/local-only/ado-email",      "ADO Email"),
    ])
    def test_stub_get_returns_503(self, client, path, feature):
        r = client.get(path)
        assert r.status_code == 503
        payload = json.loads(r.data)
        assert payload["error"] == "LOCAL_ONLY_FEATURE"
        assert payload["feature"] == feature
        assert "intentionally disabled on Azure" in payload["message"]

    @pytest.mark.parametrize("path", [
        "/local-only/asn-lookup",
        "/local-only/carrier-booking",
        "/local-only/scc-flow",
        "/local-only/ado-email",
    ])
    def test_stub_post_returns_503(self, client, path):
        r = client.post(path, data={"foo": "bar"})
        assert r.status_code == 503
        payload = json.loads(r.data)
        assert payload["error"] == "LOCAL_ONLY_FEATURE"
