"""QASupportKit-Azure — main Flask application entry point."""

import os
from datetime import datetime, timezone
from flask import Flask, render_template

from routes.xml_routes import xml_bp
from routes.sftp_routes import sftp_bp
from routes.blob_routes import blob_bp
from routes.stubs import stubs_bp


def create_app() -> Flask:
    app = Flask(__name__)
    app.secret_key = os.environ.get("FLASK_SECRET_KEY", "dev-secret-change-me")

    # ── Feature flags ──────────────────────────────────────────────────────────
    # AZURE_DEPLOYMENT is set to "1" in the App Service environment variables.
    # When running locally the flag is absent / falsy, so local-only features
    # are still available via the normal (non-stub) routes.
    app.config["AZURE_DEPLOYMENT"] = os.environ.get("AZURE_DEPLOYMENT", "0") == "1"

    # ── Blueprints ─────────────────────────────────────────────────────────────
    app.register_blueprint(xml_bp)
    app.register_blueprint(sftp_bp)
    app.register_blueprint(blob_bp)
    app.register_blueprint(stubs_bp)   # stubs always registered; UI hides them

    # ── Template globals ───────────────────────────────────────────────────────
    @app.context_processor
    def inject_now():
        return {"now": datetime.now(timezone.utc)}

    # ── Dashboard ──────────────────────────────────────────────────────────────
    @app.route("/")
    def index():
        return render_template("index.html")

    return app


app = create_app()

if __name__ == "__main__":
    debug = os.environ.get("FLASK_DEBUG", "0") == "1"
    app.run(debug=debug, port=5000)
