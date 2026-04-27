"""Azure Blob Storage search/download route — available on Azure."""

import logging
import os
from markupsafe import escape
from flask import Blueprint, render_template, request, Response
from azure.storage.blob import BlobServiceClient
from azure.core.exceptions import ResourceNotFoundError, AzureError

logger = logging.getLogger(__name__)

blob_bp = Blueprint("blob", __name__, url_prefix="/blob")


def _get_client(conn_str: str) -> BlobServiceClient:
    return BlobServiceClient.from_connection_string(conn_str)


@blob_bp.route("/", methods=["GET", "POST"])
def search():
    blobs = []
    error = None
    conn_str = request.form.get("conn_str", os.environ.get("AZURE_STORAGE_CONNECTION_STRING", ""))
    container = request.form.get("container", "").strip()
    prefix = request.form.get("prefix", "").strip()

    if request.method == "POST" and "search" in request.form:
        if not conn_str or not container:
            error = "Connection string and container name are required."
        else:
            try:
                client = _get_client(conn_str)
                container_client = client.get_container_client(container)
                blobs = [
                    b.name
                    for b in container_client.list_blobs(name_starts_with=prefix or None)
                ]
                if not blobs:
                    pass  # template handles the empty-results case
            except ResourceNotFoundError:
                error = f"Container '{container}' not found."
            except AzureError as exc:
                logger.exception("Azure error during blob list")
                error = "Azure error: could not list blobs. Check connection string and container name."

    return render_template(
        "blob_search.html",
        blobs=blobs,
        error=error,
        conn_str=conn_str,
        container=container,
        prefix=prefix,
    )


@blob_bp.route("/download", methods=["POST"])
def download():
    conn_str = request.form.get("conn_str", "").strip()
    container = request.form.get("container", "").strip()
    blob_name = request.form.get("blob_name", "").strip()

    if not conn_str or not container or not blob_name:
        return "Missing parameters.", 400

    try:
        client = _get_client(conn_str)
        blob_client = client.get_blob_client(container=container, blob=blob_name)
        stream = blob_client.download_blob()
        data = stream.readall()
        filename = blob_name.split("/")[-1]
        safe_filename = escape(filename)
        return Response(
            data,
            mimetype="application/octet-stream",
            headers={"Content-Disposition": f"attachment; filename={safe_filename}"},
        )
    except ResourceNotFoundError:
        return "Requested blob was not found.", 404
    except AzureError:
        logger.exception("Azure error during blob download")
        return "Azure error: could not download blob.", 500
