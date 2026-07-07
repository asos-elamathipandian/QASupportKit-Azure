# QA Support Kit Azure

QA Support Kit Azure is a web application used by QA and support teams to generate, validate, review, and deliver test/integration payloads across inbound logistics workflows.

The app combines XML generation utilities, SFTP upload helpers, storage search tools, and operational actions into one UI so common support tasks can be completed quickly with less manual effort.

## What This Project Provides

- XML generation and review flows for multiple message types
- Upload support for configured SFTP destinations
- Search and retrieval tools for storage/blob based artifacts
- Carrier and WMS event helper workflows
- ADO status email workflow for local runtime (preview, edit, send)

## Runtime Behavior

### Localhost

Most features are available in local runtime, including local-only tools and ADO email.

### Azure App Service (Cloud)

Core XML and search features remain available.

Some actions are intentionally disabled in cloud runtime and shown with a Local Only badge, including:

- ASN Lookup
- Carrier Booking
- Full SCC Flow
- ADO Email

This is by design to avoid dependencies that require local desktop/runtime components.

## Tech Stack

- Node.js runtime for API orchestration and backend processing
- Express.js web framework for REST endpoints
- Vanilla JavaScript + HTML/CSS frontend served from `public`
- Playwright for SCC browser automation workflows
- Azure Storage Blob SDK for blob search and file retrieval
- Nodemailer for SMTP-based email sending
- PowerShell (Outlook COM) fallback for local Windows email delivery
- `ssh2-sftp-client` for SFTP uploads
- Azure App Service compatible deployment model

## Architecture Overview

High-level request flow:

1. Browser UI (public/index.html) triggers actions using fetch calls.
2. Express API (src/web-server.js) validates input and routes each action.
3. Service modules execute domain work:
	- XML generation modules build payloads.
	- Blob modules query/download from Azure Blob Storage.
	- SCC module runs Playwright automation for ASN lookup.
	- ADO email module generates HTML report and sends via SMTP or PowerShell Outlook fallback.
4. Optional SFTP upload module transfers generated files to configured endpoints.
5. API returns JSON responses; UI renders progress, success, and error states.

Environment and runtime behavior:

- Localhost enables local-only features such as SCC automation and ADO email send.
- Cloud runtime (Azure App Service) keeps core XML and blob features, while local-only flows are intentionally restricted.

## Run Locally

1. Install dependencies:

	npm install

2. Create a `.env` file in the project root with the following values:

	```
	SFTP_HOST=<sftp hostname>
	SFTP_PORT=22
	SFTP_USERNAME=<username>
	SFTP_REMOTE_DIR=<remote path e.g. /outbound>

	# Choose one authentication method:
	SFTP_PASSWORD=<password>
	# OR
	SFTP_PRIVATE_KEY_PATH=<path to .ppk or .pem key file>
	SFTP_PASSPHRASE=<passphrase if key is protected>

	# Azure Blob Storage — for searching E2Open outbound files
	AZURE_BLOB_CONNECTION_STRING=<blob SAS connection string>
	AZURE_BLOB_CONTAINER=<container name e.g. sftp-inbound>
	```

	> The `.env` file is gitignored — never commit it. Ask the team lead for the correct values.

3. Start the app:

	npm start

4. Open:

	http://localhost:3000

## SCC Carrier Booking Automation

The SCC automation module uses Playwright to drive the E2Open SCC staging portal end-to-end. All flows are local-only (disabled in cloud runtime).

### Available Flows

| Flow | Description |
|------|-------------|
| **Single ASN per Booking** | Loops through each ASN and creates one booking per ASN — edit, submit, approve |
| **All ASNs × One Booking** | Combines all ASNs into a single booking — edit, submit, approve |
| **Full SCC Flow** | One-click flow: ASN lookup → create booking → edit → submit → approve |
| **Cancel Booking** | Cancels an existing booking by ASN + VB reference |

### Flow Summary

Each booking flow follows these steps:

1. **Login** — navigates to `asos.staging.e2open.com`, logs in via CLP, lands on the SCC app
2. **Create Booking** — navigates to Order Search, searches by ASN, selects record, clicks Create Booking
3. **Edit Booking** — navigates to Carrier Booking Detail, filters by ASN + Draft status, selects newest booking row, fills carton/weight/cargo dates/traffic mode, saves
4. **Submit Booking** — selects the saved booking row, clicks Submit, handles confirmation dialog
5. **Check Status** — reads the booking status directly from the carrier booking list after submit:
   - `Submitted` → records result, done
   - `Draft` → proceeds to approval flow
6. **Approval Flow** *(if Draft)* — navigates to Carrier Booking Approval, searches by ASN, selects row, clicks Approve
7. **Read Final Status** — navigates back to Carrier Booking Detail and reads the live post-approval status from SCC

### Cancel Booking Flow

1. Navigate to Carrier Booking Detail (Menu → DDP Tools → View List → ASOS Carrier Booking Detail)
2. Search by ASN
3. Find the row matching the VB reference
4. Select the row and click Cancel Booking
5. Wait for processing and read the actual status from the SCC grid

### Key Technical Notes

- **jQuery checkbox trigger** — SCC uses jQuery UI custom checkboxes that do not respond to standard DOM events. All checkbox interactions use `jQuery(el).trigger('click')` via Playwright's `evaluate()`.
- **Single-row selection** — SCC's Edit Booking and Approve buttons only enable when exactly one row is selected. When multiple rows are present the newest (first) row is selected automatically.
- **Tolerance exception handling** — When SCC raises a "Booking Tolerance Exception" after submit, the iframe context may become temporarily unavailable. The automation closes any error banner and proceeds to the approval flow using the live main page.
- **Headed mode** — `SCC_HEADLESS=false` in `config/.env` runs Chrome visibly. This is loaded by `loadEnvironment()` before `scc-launcher.js` initialises its constants.
- **Post-approval status** — After the approval step completes the automation navigates back to the carrier booking list and reads the actual SCC status (not hard-coded).

### Configuration

Set in `config/.env`:

```
SCC_HEADLESS=false        # Show Chrome window during automation
```

SCC credentials are read from `scc-working-copy/tests-examples/Regression_TA_loginData.json`.

---

## Configuration Notes

- App config files are under config and RaiseADOBugs
- Environment variables are used for sensitive values (for example ADO PAT and SMTP credentials)
- For cloud deployments, set required app settings in App Service configuration

## Troubleshooting

### App Does Not Start Locally

- Symptom: `npm start` fails or exits quickly.
- Check:
	- Run `npm install` to ensure dependencies are present.
	- Confirm no old Node process is holding port 3000.
	- Restart terminal and run `npm start` again.

### ADO Preview/Send Fails Locally

- Symptom: ADO email preview/send shows an error.
- Check:
	- Ensure `ADO_PAT_TOKEN` is set in your local environment.
	- Verify `RaiseADOBugs/config.json` values (organization, project, query IDs, recipients).
	- Confirm `RaiseADOBugs/Send-ADOReport.ps1` exists.

### SMTP Send Fails

- Symptom: SMTP timeout or connection error.
- Check:
	- Confirm `SMTP_PASSWORD` is set.
	- Validate network route to SMTP host/port.
	- Local app can fall back to Outlook/PowerShell path where applicable.

### ADO Email Missing In Cloud

- Symptom: ADO Email card is disabled in App Service.
- Expected: This is intentional.
- Reason: ADO email is disabled in cloud runtime to avoid desktop/runtime dependencies.

### "Works On Local, Not In App Service"

- Check:
	- Verify App Service configuration settings are present and correct.
	- Confirm required secrets/environment variables are configured in App Service.
	- Use app logs to inspect endpoint errors and missing configuration values.
