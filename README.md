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

2. Start the app:

	npm start

3. Open:

	http://localhost:3000

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
