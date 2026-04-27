"""XML Generator routes — available on Azure."""

from flask import Blueprint, render_template, request, Response
from lxml import etree

xml_bp = Blueprint("xml", __name__, url_prefix="/xml")


def _build_asn_xml(data: dict) -> bytes:
    root = etree.Element("ASN")
    etree.SubElement(root, "ShipmentID").text = data.get("shipment_id", "")
    etree.SubElement(root, "Carrier").text = data.get("carrier", "")
    etree.SubElement(root, "TrackingNumber").text = data.get("tracking_number", "")
    etree.SubElement(root, "ShipDate").text = data.get("ship_date", "")
    items_el = etree.SubElement(root, "Items")
    for raw in data.get("items", "").splitlines():
        raw = raw.strip()
        if raw:
            etree.SubElement(items_el, "Item").text = raw
    return etree.tostring(root, pretty_print=True, xml_declaration=True, encoding="UTF-8")


def _build_order_xml(data: dict) -> bytes:
    root = etree.Element("Order")
    etree.SubElement(root, "OrderID").text = data.get("order_id", "")
    etree.SubElement(root, "CustomerName").text = data.get("customer_name", "")
    etree.SubElement(root, "DeliveryDate").text = data.get("delivery_date", "")
    lines_el = etree.SubElement(root, "OrderLines")
    for raw in data.get("order_lines", "").splitlines():
        raw = raw.strip()
        if raw:
            etree.SubElement(lines_el, "Line").text = raw
    return etree.tostring(root, pretty_print=True, xml_declaration=True, encoding="UTF-8")


def _build_inventory_xml(data: dict) -> bytes:
    root = etree.Element("InventoryUpdate")
    etree.SubElement(root, "WarehouseID").text = data.get("warehouse_id", "")
    etree.SubElement(root, "UpdateDate").text = data.get("update_date", "")
    skus_el = etree.SubElement(root, "SKUs")
    for raw in data.get("skus", "").splitlines():
        raw = raw.strip()
        if raw:
            parts = raw.split(",")
            sku_el = etree.SubElement(skus_el, "SKU")
            sku_el.set("code", parts[0].strip())
            sku_el.text = parts[1].strip() if len(parts) > 1 else "0"
    return etree.tostring(root, pretty_print=True, xml_declaration=True, encoding="UTF-8")


@xml_bp.route("/")
def index():
    return render_template("xml_generator.html")


@xml_bp.route("/generate/asn", methods=["GET", "POST"])
def generate_asn():
    xml_output = None
    if request.method == "POST":
        xml_bytes = _build_asn_xml(request.form)
        xml_output = xml_bytes.decode("utf-8")
        if "download" in request.form:
            return Response(
                xml_bytes,
                mimetype="application/xml",
                headers={"Content-Disposition": "attachment; filename=asn.xml"},
            )
    return render_template("xml_asn.html", xml_output=xml_output)


@xml_bp.route("/generate/order", methods=["GET", "POST"])
def generate_order():
    xml_output = None
    if request.method == "POST":
        xml_bytes = _build_order_xml(request.form)
        xml_output = xml_bytes.decode("utf-8")
        if "download" in request.form:
            return Response(
                xml_bytes,
                mimetype="application/xml",
                headers={"Content-Disposition": "attachment; filename=order.xml"},
            )
    return render_template("xml_order.html", xml_output=xml_output)


@xml_bp.route("/generate/inventory", methods=["GET", "POST"])
def generate_inventory():
    xml_output = None
    if request.method == "POST":
        xml_bytes = _build_inventory_xml(request.form)
        xml_output = xml_bytes.decode("utf-8")
        if "download" in request.form:
            return Response(
                xml_bytes,
                mimetype="application/xml",
                headers={"Content-Disposition": "attachment; filename=inventory.xml"},
            )
    return render_template("xml_inventory.html", xml_output=xml_output)
