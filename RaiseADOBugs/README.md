# AIM Test Execution Progress & Bug Report

Automated PowerShell agent that queries Azure DevOps for bug and test plan data, generates an HTML report with donut charts, and sends it via Outlook.

## Prerequisites

- **Windows** with PowerShell 5.1+
- **Outlook** desktop app (signed in) — used for sending emails via COM automation
- **ADO Personal Access Token (PAT)** with scopes:
  - `Work Items (Read)`
  - `Test Management (Read)`

## Setup

### 1. Set your PAT token

Run once to save your PAT as an environment variable:

```powershell
.\Run-Report.ps1 -Pat "your-pat-token-here"
```

Or set it manually:

```powershell
[Environment]::SetEnvironmentVariable("ADO_PAT_TOKEN", "your-pat-token", "User")
```

### 2. (Optional) Register daily scheduled task

```powershell
.\Register-ScheduledTask.ps1
```

This creates a Windows Task Scheduler job that runs the report daily at 09:00.

## Usage

```powershell
.\Run-Report.ps1
```

Reports are saved to the `reports/` folder and emailed via Outlook.

## Configuration — config.json

| Setting | Value | Description |
|---------|-------|-------------|
| `Organization` | `asos` | ADO organization name |
| `Project` | `Inbound` | ADO project name |
| `BugQueryId` | `a3fdd1b4-c240-4cd7-a577-d208b4162bce` | Shared query ID for bugs |
| `TestPlanQueryId` | `8137f9dc-880d-43cc-9cf0-c636a02d1337` | Shared query ID for test plan items (Report-Testplan) |
| `TestPlanId` | `1192299` | ADO Test Plan ID (CR144) |
| `TestSuiteId` | `1192300` | ADO Test Suite ID within the test plan |
| `PatTokenEnvVar` | `ADO_PAT_TOKEN` | Environment variable name storing the PAT |
| `Recipients` | `elamathi.pandian@asos.com` | Email recipients (array) |
| `Subject` | `AIM Test Execution Progress & Bug Report` | Email subject line |

## Shared Queries

The report pulls data from two ADO shared queries:

1. **Bug Query** (`a3fdd1b4-c240-4cd7-a577-d208b4162bce`)
   - Returns bug work items with fields: ID, Title, State, Severity, Assigned To
   - Latest comment is fetched separately via the Comments API

2. **Test Plan Query — Report-Testplan** (`8137f9dc-880d-43cc-9cf0-c636a02d1337`)
   - Returns test plan work items with fields: ID, Title, State, Assigned To, Created Date
   - Test case count per item is fetched from the Test Plan API

## Test Plan & Suite

| Item | ID | Notes |
|------|----|-------|
| Test Plan | `1192299` | CR144 test plan |
| Test Suite | `1192300` | Root suite under the plan |

- Test point outcomes (Passed/Failed/Blocked/Not Run) are fetched from the **Test Plan API**: `_apis/testplan/Plans/{planId}/Suites/{suiteId}/TestPoint`
- The donut chart ("CR144 Test Cases Stats") is generated from these test points
- Test case counts per work item use `rootSuiteId = planId + 1` convention

## Email Report Sections

1. **Today's Highlights** — bullet points summarising today's test executions, plan updates, new/updated bugs, and new comments
2. **Test Plan Items & Test Cases Progress** — work items table + CR144 donut chart
3. **Overall Bug Report** — bugs table + bug stats donut chart

## Files

| File | Purpose |
|------|---------|
| `Send-ADOReport.ps1` | Main script — queries ADO, builds HTML, sends email |
| `Run-Report.ps1` | Quick-run helper, accepts `-Pat` parameter |
| `Register-ScheduledTask.ps1` | Sets up daily Windows Task Scheduler job |
| `config.json` | All configuration settings |
| `reports/` | Generated HTML report files |

## Adding Recipients

Edit `config.json` and add email addresses to the `Recipients` array:

```json
"Recipients": [
  "elamathi.pandian@asos.com",
  "another.person@asos.com"
]
```

## Adding a New Test Plan

Update `config.json` with the new plan and suite IDs:

```json
"TestPlanId": 1234567,
"TestSuiteId": 1234568
```

The suite ID is typically `planId + 1` for the root suite.

## Web UI Integration (XMLGeneratorUploader)

The report can also be previewed, edited, and sent from the **ASOS E2Open Toolkit** web UI running at `http://localhost:3000`.

### Architecture

```
Browser (localhost:3000)
  │
  ├─ POST /api/preview-status-email
  │    → Node.js spawns: powershell.exe Run-Report.ps1 -PreviewOnly
  │    → Script generates HTML, saves to reports/, outputs PREVIEW_PATH=<file>
  │    → Node reads the file, returns { ok, html, filePath }
  │    → Browser renders HTML inside an iframe (srcdoc)
  │
  ├─ POST /api/send-status-email
  │    → Node.js spawns: powershell.exe Run-Report.ps1
  │    → Script generates a fresh report and sends via Outlook COM
  │
  └─ POST /api/send-edited-email  { html: "<edited HTML>" }
       → Node saves edited HTML to reports/ with _edited suffix
       → Reads config.json for Recipients and Subject
       → Spawns PowerShell inline to send via Outlook COM:
           New-Object -ComObject Outlook.Application → CreateItem(0) → Send()
```

### UI Features

| Feature | Description |
|---------|-------------|
| **Preview Report** | Generates the report and displays it in a modal iframe |
| **Edit Mode** | Toggle `designMode` on the iframe — click any text to edit inline (WYSIWYG) |
| **Send Email Now** (from preview) | Sends the **edited** version via `POST /api/send-edited-email` |
| **Send Email** (standalone button) | Generates a **fresh** report and sends immediately (no preview) |

### Key Implementation Details

- **Editable preview**: Uses `iframe.contentDocument.designMode = "on"` to make the rendered HTML fully editable in the browser. The edited HTML is extracted via `frameDoc.documentElement.innerHTML` before sending.
- **Edited email flow**: The `send-edited-email` endpoint saves the HTML to `reports/ADO_Report_<timestamp>_edited.html`, then spawns a PowerShell process that reads the file and sends it via Outlook COM — same mechanism as the main script.
- **Config-driven**: Recipients, subject line, and all ADO settings are read from `config.json` — no hardcoded values in the backend.
- **Separation of concerns**: The standalone "Send Email" button always regenerates from ADO (fresh data). The preview "Send Email Now" button sends whatever is currently in the iframe (including edits).

### Files Modified

| File | Changes |
|------|---------|
| `XMLGeneratorUploader/public/index.html` | Preview modal with Edit toggle, edit indicator, and send-edited flow |
| `XMLGeneratorUploader/src/web-server.js` | `POST /api/send-edited-email` endpoint (save + Outlook COM send) |
