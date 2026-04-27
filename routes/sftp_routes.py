"""SFTP upload route — available on Azure."""

import os
import io
import paramiko
from flask import Blueprint, render_template, request, flash, redirect, url_for

sftp_bp = Blueprint("sftp", __name__, url_prefix="/sftp")


@sftp_bp.route("/", methods=["GET", "POST"])
def upload():
    result = None
    error = None

    if request.method == "POST":
        host = request.form.get("host", "").strip()
        port = int(request.form.get("port", 22) or 22)
        username = request.form.get("username", "").strip()
        password = request.form.get("password", "")
        remote_path = request.form.get("remote_path", "/").strip()
        uploaded_file = request.files.get("file")

        if not host or not username or not uploaded_file or not uploaded_file.filename:
            error = "Host, username and file are all required."
        else:
            try:
                transport = paramiko.Transport((host, port))
                transport.connect(username=username, password=password)
                sftp = paramiko.SFTPClient.from_transport(transport)
                file_bytes = uploaded_file.read()
                dest = os.path.join(remote_path, uploaded_file.filename).replace("\\", "/")
                sftp.putfo(io.BytesIO(file_bytes), dest)
                sftp.close()
                transport.close()
                result = f"File '{uploaded_file.filename}' uploaded successfully to {host}:{dest}"
            except Exception as exc:
                error = f"SFTP upload failed: {exc}"

    return render_template("sftp_upload.html", result=result, error=error)
