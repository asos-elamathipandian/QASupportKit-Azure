// Azure DevOps Daily Email Report (Node.js port)
// - Queries ADO for bugs and test execution
// - Generates HTML report
// - Sends via SMTP
//
// Requires: ADO PAT token, SMTP credentials in environment or config

const fetch = require('node-fetch');
const nodemailer = require('nodemailer');
const fs = require('fs');
const path = require('path');
const os = require('os');
const { execFile } = require('child_process');
const { promisify } = require('util');

const execFileAsync = promisify(execFile);

// Load config (reuse PowerShell config.json structure)
const configPath = path.join(__dirname, '../RaiseADOBugs/config.json');
const config = JSON.parse(fs.readFileSync(configPath, 'utf8'));

const org = config.AzureDevOps.Organization;
const project = config.AzureDevOps.Project;
const baseUrl = config.AzureDevOps.BaseUrl;
const bugQueryId = config.AzureDevOps.BugQueryId;
const testPlanId = config.AzureDevOps.TestPlanId;
const testSuiteId = config.AzureDevOps.TestSuiteId;
const testPlanQueryId = config.AzureDevOps.TestPlanQueryId;
const patEnvVar = config.AzureDevOps.PatTokenEnvVar;

const recipients = config.Email.Recipients;
const fromAddr = config.Email.From;
const subject = config.Email.Subject;
const smtpServer = config.Email.SmtpServer;
const smtpPort = config.Email.Port;
const useSsl = config.Email.UseSsl;
const psReportScriptPath = path.join(__dirname, '../RaiseADOBugs/Send-ADOReport.ps1');

function isCloudRuntime() {
  // Azure App Service exposes WEBSITE_* environment variables.
  return Boolean(
    process.env.WEBSITE_SITE_NAME ||
    process.env.WEBSITE_INSTANCE_ID ||
    process.env.WEBSITE_RESOURCE_GROUP
  );
}

function getAdoRootUrl() {
  const rawBase = String(baseUrl || 'https://dev.azure.com').replace(/\/+$/, '');
  const orgProjectSuffix = `/${org}/${project}`.toLowerCase();
  if (rawBase.toLowerCase().endsWith(orgProjectSuffix)) {
    return rawBase;
  }
  return `${rawBase}/${org}/${project}`;
}

const adoRootUrl = getAdoRootUrl();

function isPlaceholder(value, placeholders) {
  const text = String(value || '').trim().toLowerCase();
  return placeholders.some((p) => text === p.toLowerCase());
}

function getAdoAvailability(options = {}) {
  const { requireDelivery = true } = options;
  const issues = [];

  if (isCloudRuntime()) {
    issues.push('ADO email feature is disabled in cloud runtime. Use local app for ADO preview/send.');
    return {
      available: false,
      issues,
    };
  }

  if (isPlaceholder(org, ['yourorg', ''])) {
    issues.push('Set AzureDevOps.Organization in RaiseADOBugs/config.json');
  }
  if (isPlaceholder(project, ['yourproject', ''])) {
    issues.push('Set AzureDevOps.Project in RaiseADOBugs/config.json');
  }
  if (isPlaceholder(bugQueryId, ['00000000-0000-0000-0000-000000000000', ''])) {
    issues.push('Set AzureDevOps.BugQueryId in RaiseADOBugs/config.json');
  }
  if (!Array.isArray(recipients) || recipients.length === 0 || recipients.some((r) => String(r).includes('example.com'))) {
    issues.push('Set Email.Recipients to real email address(es) in RaiseADOBugs/config.json');
  }
  if (isPlaceholder(fromAddr, ['noreply@example.com', ''])) {
    issues.push('Set Email.From in RaiseADOBugs/config.json');
  }
  if (!process.env[patEnvVar] && !process.env.ADO_PAT_TOKEN) {
    issues.push(`Set ${patEnvVar || 'ADO_PAT_TOKEN'} environment variable with a valid ADO PAT`);
  }
  const hasOutlookFallback = process.platform === 'win32' && fs.existsSync(psReportScriptPath);
  if (requireDelivery && !process.env.SMTP_PASSWORD && !hasOutlookFallback) {
    issues.push('Set SMTP_PASSWORD environment variable');
  }

  return {
    available: issues.length === 0,
    issues,
  };
}

function shouldUsePowerShellFallback(error) {
  if (!error) return false;
  const message = String(error.message || '').toLowerCase();
  return (
    message.includes('etimedout') ||
    message.includes('econnrefused') ||
    message.includes('ehostunreach') ||
    message.includes('network') ||
    message.includes('smtp') ||
    message.includes('535') ||
    message.includes('authentication') ||
    message.includes('credentials') ||
    message.includes('unauthorized')
  );
}

async function sendViaPowerShellOutlook() {
  if (process.platform !== 'win32') {
    throw new Error('PowerShell Outlook fallback is only supported on Windows');
  }
  if (!fs.existsSync(psReportScriptPath)) {
    throw new Error(`PowerShell report script not found at ${psReportScriptPath}`);
  }

  const args = [
    '-NoProfile',
    '-ExecutionPolicy',
    'Bypass',
    '-File',
    psReportScriptPath,
  ];

  const { stdout, stderr } = await execFileAsync('powershell.exe', args, {
    cwd: path.dirname(psReportScriptPath),
    windowsHide: true,
    timeout: 180000,
    maxBuffer: 1024 * 1024 * 10,
    env: process.env,
  });

  const combined = `${stdout || ''}\n${stderr || ''}`;
  if (combined.toLowerCase().includes('outlook send failed')) {
    throw new Error(`PowerShell Outlook send failed. Output: ${combined.trim()}`);
  }
}

async function sendViaPowerShellOutlookWithHtml({ html, subjectLine }) {
  if (process.platform !== 'win32') {
    throw new Error('PowerShell Outlook fallback is only supported on Windows');
  }

  const tempDir = path.join(os.tmpdir(), 'qa-ado-email');
  if (!fs.existsSync(tempDir)) {
    fs.mkdirSync(tempDir, { recursive: true });
  }

  const stamp = `${Date.now()}-${Math.floor(Math.random() * 10000)}`;
  const htmlPath = path.join(tempDir, `ado-preview-${stamp}.html`);
  const psPath = path.join(tempDir, `ado-send-${stamp}.ps1`);
  fs.writeFileSync(htmlPath, html, 'utf8');

  const recipientsArg = recipients.join(';');
  const psScript = [
    'param(',
    '  [string]$HtmlPath,',
    '  [string]$Subject,',
    '  [string]$RecipientsArg',
    ')',
    "$ErrorActionPreference = 'Stop'",
    '$outlook = New-Object -ComObject Outlook.Application',
    '$mail = $outlook.CreateItem(0)',
    '$mail.Subject = $Subject',
    '$mail.HTMLBody = Get-Content -Raw -Path $HtmlPath',
    '$recipients = $RecipientsArg -split \';\' | Where-Object { -not [string]::IsNullOrWhiteSpace($_) }',
    'foreach ($recipient in $recipients) {',
    '  $mail.Recipients.Add($recipient) | Out-Null',
    '}',
    '$mail.Recipients.ResolveAll() | Out-Null',
    '$mail.Send()',
    '[System.Runtime.InteropServices.Marshal]::ReleaseComObject($mail) | Out-Null',
    '[System.Runtime.InteropServices.Marshal]::ReleaseComObject($outlook) | Out-Null',
  ].join('\n');
  fs.writeFileSync(psPath, psScript, 'utf8');

  try {
    await execFileAsync('powershell.exe', [
      '-NoProfile',
      '-ExecutionPolicy',
      'Bypass',
      '-File',
      psPath,
      '-HtmlPath',
      htmlPath,
      '-Subject',
      subjectLine,
      '-RecipientsArg',
      recipientsArg,
    ], {
      windowsHide: true,
      timeout: 180000,
      maxBuffer: 1024 * 1024 * 10,
      env: process.env,
    });
  } finally {
    if (fs.existsSync(htmlPath)) fs.unlinkSync(htmlPath);
    if (fs.existsSync(psPath)) fs.unlinkSync(psPath);
  }
}

async function generateAdoReportHtmlViaPowerShell() {
  if (process.platform !== 'win32') {
    throw new Error('PowerShell report generation is only supported on Windows');
  }
  if (!fs.existsSync(psReportScriptPath)) {
    throw new Error(`PowerShell report script not found at ${psReportScriptPath}`);
  }

  const { stdout, stderr } = await execFileAsync('powershell.exe', [
    '-NoProfile',
    '-ExecutionPolicy',
    'Bypass',
    '-File',
    psReportScriptPath,
    '-ConfigPath',
    configPath,
    '-PreviewOnly',
  ], {
    cwd: path.dirname(psReportScriptPath),
    windowsHide: true,
    timeout: 240000,
    maxBuffer: 1024 * 1024 * 10,
    env: process.env,
  });

  const combined = `${stdout || ''}\n${stderr || ''}`;
  const match = combined.match(/PREVIEW_PATH=(.+)/i);
  if (!match) {
    throw new Error(`PowerShell preview did not return a report path. Output: ${combined.trim()}`);
  }

  const reportPath = match[1].trim();
  if (!fs.existsSync(reportPath)) {
    throw new Error(`PowerShell preview report not found at ${reportPath}`);
  }

  const html = fs.readFileSync(reportPath, 'utf8');
  const dateLabel = new Date().toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' });

  return {
    ok: true,
    html,
    subject: `${subject} - ${dateLabel}`,
    reportPath,
  };
}

function getPAT() {
  return process.env[patEnvVar] || process.env.ADO_PAT_TOKEN;
}

function adoHeaders() {
  const pat = getPAT();
  if (!pat) throw new Error('ADO PAT token not found in environment');
  const encodedPat = Buffer.from(':' + pat).toString('base64');
  return {
    'Authorization': `Basic ${encodedPat}`,
    'Content-Type': 'application/json',
  };
}

async function adoApi(uri, method = 'GET') {
  const res = await fetch(uri, { method, headers: adoHeaders() });
  if (!res.ok) {
    if (res.status === 401) {
      throw new Error('ADO API 401 Unauthorized. Check ADO PAT token, Organization, Project, and query IDs in RaiseADOBugs/config.json');
    }
    throw new Error(`ADO API error: ${res.status} ${res.statusText}`);
  }
  return res.json();
}

async function getQueryResults(queryId) {
  const queryUri = `${adoRootUrl}/_apis/wit/wiql/${queryId}?api-version=7.1`;
  const queryResult = await adoApi(queryUri);
  const wiList = queryResult.workItems || [];
  if (!wiList.length) return [];
  // Batch fetch work item details (max 200 per batch)
  const ids = wiList.map(wi => wi.id);
  const batchSize = 200;
  let workItems = [];
  for (let i = 0; i < ids.length; i += batchSize) {
    const batchIds = ids.slice(i, i + batchSize);
    const idsParam = batchIds.join(',');
    const fields = 'System.Id,System.Title,System.State,System.AssignedTo,Microsoft.VSTS.Common.Priority,System.CreatedDate,System.ChangedDate,System.WorkItemType,Microsoft.VSTS.Common.Severity';
    const detailsUri = `${adoRootUrl}/_apis/wit/workitems?ids=${idsParam}&fields=${fields}&api-version=7.1`;
    const details = await adoApi(detailsUri);
    workItems = workItems.concat(details.value);
  }
  return workItems;
}

async function getTestPoints(planId, suiteId) {
  let allPoints = [];
  let continuationToken = null;
  do {
    let uri = `${adoRootUrl}/_apis/test/Plans/${planId}/Suites/${suiteId}/points?api-version=7.1`;
    if (continuationToken) uri += `&continuationToken=${continuationToken}`;
    const response = await adoApi(uri);
    if (response.value) allPoints = allPoints.concat(response.value);
    continuationToken = response.continuationToken || null;
  } while (continuationToken);
  return allPoints;
}

function htmlEscape(str) {
  return String(str).replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;','\'':'&#39;'}[c]));
}

// Helper: Create SVG donut chart (base64 data URI)
function createDonutChartSvg(items, title = 'Stats', label = 'Passed') {
  if (!items.length) {
    return '<p style="color:#666;">No data available.</p>';
  }

  const total = items.length;
  
  // Group by outcome or state
  const grouped = items.reduce((acc, item) => {
    let key = item.outcome || item.fields?.['System.State'] || 'Unknown';
    if (!key || key === 'Unspecified') key = 'Not Run';
    acc[key] = (acc[key] || 0) + 1;
    return acc;
  }, {});

  // Sort by count descending
  const sorted = Object.entries(grouped).sort((a, b) => b[1] - a[1]);
  
  // Color palette
  const colors = {
    'Passed': '#00C800', 'Failed': '#FF0000', 'Blocked': '#9E9E9E', 'Not Run': '#2196F3',
    'Closed': '#4CAF50', 'Done': '#4CAF50', 'Resolved': '#8BC34A', 'Active': '#2196F3',
    'In Progress': '#2196F3', 'New': '#9E9E9E', 'Design': '#FF9800', 'Ready': '#FF9800',
  };

  // Calculate percentages and center label
  const centerValue = Math.round((sorted.filter(([k]) => k === 'Passed' || k === 'Closed' || k === 'Done' || k === 'Resolved')[0]?.[1] || 0) / total * 100);
  
  // Build SVG
  let svg = '<svg viewBox="0 0 600 300" xmlns="http://www.w3.org/2000/svg" style="max-width:100%;height:auto;background:#fff;">';
  svg += '<circle cx="300" cy="150" r="140" fill="#f8f9fa" stroke="#e0e0e0" stroke-width="1"/>';
  
  // Donut slices
  let angle = -90;
  sorted.forEach(([name, count]) => {
    const percent = count / total * 100;
    const sweep = count / total * 360;
    const color = colors[name] || '#607D8B';
    
    // Create pie slice path
    const startRad = (angle) * Math.PI / 180;
    const endRad = (angle + sweep) * Math.PI / 180;
    const x1 = 300 + 140 * Math.cos(startRad);
    const y1 = 150 + 140 * Math.sin(startRad);
    const x2 = 300 + 140 * Math.cos(endRad);
    const y2 = 150 + 140 * Math.sin(endRad);
    const largeArc = sweep > 180 ? 1 : 0;
    
    const path = `M 300 150 L ${x1} ${y1} A 140 140 0 ${largeArc} 1 ${x2} ${y2} Z`;
    svg += `<path d="${path}" fill="${color}" stroke="#fff" stroke-width="2"/>`;
    
    angle += sweep;
  });

  // Donut hole
  svg += `<circle cx="300" cy="150" r="85" fill="white" stroke="none"/>`;
  
  // Center percentage
  svg += `<text x="300" y="140" font-size="32" font-weight="bold" text-anchor="middle" fill="#333">${centerValue}%</text>`;
  svg += `<text x="300" y="162" font-size="14" text-anchor="middle" fill="#999">${label}</text>`;
  
  // Legend
  let legendY = 30;
  sorted.forEach(([name, count]) => {
    const percent = Math.round(count / total * 100);
    const color = colors[name] || '#607D8B';
    svg += `<rect x="380" y="${legendY}" width="14" height="14" fill="${color}"/>`;
    svg += `<text x="400" y="${legendY + 12}" font-size="12" fill="#333">${name}: ${count} (${percent}%)</text>`;
    legendY += 25;
  });
  svg += `<text x="380" y="${legendY + 5}" font-size="13" font-weight="bold" fill="#333">Total: ${total}</text>`;
  
  svg += '</svg>';

  // SVG to data URI
  const base64 = Buffer.from(svg).toString('base64');
  return `<div style="margin:16px 0;padding:16px 20px;background:#f8f9fa;border:1px solid #e0e0e0;border-radius:8px;">
    <h4 style="margin:0 0 12px 0;color:#333;font-family:Segoe UI,Arial,sans-serif;">${title}</h4>
    <img src="data:image/svg+xml;base64,${base64}" alt="${title}" style="max-width:100%;height:auto;" />
  </div>`;
}

// Format detailed test cases table (matching PowerShell Format-TestPointsToHtml)
function formatTestCasesTable(testPoints) {
  if (!testPoints.length) return '<h3 style="color:#0078D4;">Test Cases</h3><p style="color:#666;">No test cases found.</p>';
  
  const outcomeColors = {
    'Passed': '#00C800', 'Failed': '#FF0000', 'Blocked': '#9E9E9E',
    'Not Run': '#2196F3', 'Paused': '#FF9800'
  };

  let rows = testPoints.slice(0, 100).map(tp => {
    const id = tp.testCase?.id || '-';
    const title = htmlEscape(tp.testCase?.name || 'Unknown');
    let outcome = tp.outcome || 'Unspecified';
    if (!outcome || outcome === 'Unspecified') outcome = 'Not Run';
    const outcomeColor = outcomeColors[outcome] || '#607D8B';
    const configuration = tp.configuration?.name ? htmlEscape(tp.configuration.name) : '-';
    
    let assignedTo = 'Unassigned';
    if (tp.workItemProperties && Array.isArray(tp.workItemProperties)) {
      const assignProp = tp.workItemProperties.find(p => p.workItem?.key === 'System.AssignedTo');
      if (assignProp?.workItem?.value) {
        assignedTo = htmlEscape(assignProp.workItem.value.replace(/<.*>/g, '').trim());
      }
    }
    
    let lastRun = '-';
    if (tp.lastResultDetails?.dateCompleted) {
      const date = new Date(tp.lastResultDetails.dateCompleted);
      lastRun = date.toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' });
    }
    
    const url = tp.testCase?.webUrl || `${baseUrl}/_workitems/edit/${id}`;
    
    return `<tr>
      <td style="padding:8px 12px;border-bottom:1px solid #e0e0e0;"><a href="${url}" style="color:#0078D4;text-decoration:none;font-weight:600;">${id}</a></td>
      <td style="padding:8px 12px;border-bottom:1px solid #e0e0e0;">${title}</td>
      <td style="padding:8px 12px;border-bottom:1px solid #e0e0e0;"><span style="color:${outcomeColor};font-weight:600;">${outcome}</span></td>
      <td style="padding:8px 12px;border-bottom:1px solid #e0e0e0;">${configuration}</td>
      <td style="padding:8px 12px;border-bottom:1px solid #e0e0e0;">${assignedTo}</td>
      <td style="padding:8px 12px;border-bottom:1px solid #e0e0e0;">${lastRun}</td>
    </tr>`;
  }).join('');

  const count = testPoints.length;
  return `<h3 style="color:#0078D4;margin:24px 0 8px 0;font-family:Segoe UI,Arial,sans-serif;">Test Cases (${count} items)</h3>
    <table style="border-collapse:collapse;width:100%;font-family:Segoe UI,Arial,sans-serif;font-size:14px;">
      <thead>
        <tr style="background:#0078D4;color:white;">
          <th style="padding:10px 12px;text-align:left;">ID</th>
          <th style="padding:10px 12px;text-align:left;">Title</th>
          <th style="padding:10px 12px;text-align:left;">Outcome</th>
          <th style="padding:10px 12px;text-align:left;">Configuration</th>
          <th style="padding:10px 12px;text-align:left;">Assigned To</th>
          <th style="padding:10px 12px;text-align:left;">Last Run</th>
        </tr>
      </thead>
      <tbody>${rows}</tbody>
    </table>`;
}

// Format bugs table with colors
function formatBugTable(bugs) {
  if (!bugs.length) return '<p style="color:#666;">No bugs found.</p>';
  
  const stateColors = { 'New': '#E8A317', 'Active': '#0078D4', 'Resolved': '#2E8B57', 'Closed': '#808080' };
  const priorityBadges = { 1: 'P1', 2: 'P2', 3: 'P3', 4: 'P4' };
  
  let rows = bugs.slice(0, 50).map(bug => {
    const id = bug.fields['System.Id'];
    const title = htmlEscape(bug.fields['System.Title']);
    const state = bug.fields['System.State'] || '-';
    const stateColor = stateColors[state] || '#333';
    const severity = bug.fields['Microsoft.VSTS.Common.Severity'] || '-';
    const assigned = bug.fields['System.AssignedTo']?.displayName || 'Unassigned';
    const priority = bug.fields['Microsoft.VSTS.Common.Priority'];
    const priorityBadge = priority ? `<span style="background:#F57C00;color:white;padding:2px 6px;border-radius:3px;font-size:11px;">${priorityBadges[priority] || 'P-'}</span>` : '-';
    const url = `${baseUrl}/_workitems/edit/${id}`;
    
    return `<tr style="border-bottom:1px solid #e0e0e0;">
      <td style="padding:8px;"><a href="${url}" style="color:#0078D4;text-decoration:none;font-weight:600;">${id}</a></td>
      <td style="padding:8px;">${title}</td>
      <td style="padding:8px;"><span style="color:${stateColor};font-weight:600;">${state}</span></td>
      <td style="padding:8px;">${severity}</td>
      <td style="padding:8px;">${assigned}</td>
      <td style="padding:8px;">${priorityBadge}</td>
    </tr>`;
  }).join('');

  return `<table style="border-collapse:collapse;width:100%;font-family:Segoe UI,Arial,sans-serif;font-size:13px;">
    <thead>
      <tr style="background:#FFCDD2;color:#333;">
        <th style="padding:8px;text-align:left;font-size:11px;">ID</th>
        <th style="padding:8px;text-align:left;font-size:11px;">Title</th>
        <th style="padding:8px;text-align:left;font-size:11px;">State</th>
        <th style="padding:8px;text-align:left;font-size:11px;">Severity</th>
        <th style="padding:8px;text-align:left;font-size:11px;">Assigned To</th>
        <th style="padding:8px;text-align:left;font-size:11px;">Priority</th>
      </tr>
    </thead>
    <tbody>${rows}</tbody>
  </table>`;
}

// Get today's highlights
async function getTodaysHighlights(bugs, testPoints) {
  const today = new Date().toISOString().split('T')[0];
  let highlights = [];
  
  // New bugs today
  const newBugsToday = bugs.filter(b => {
    const created = b.fields['System.CreatedDate'];
    return created && created.split('T')[0] === today;
  });
  
  if (newBugsToday.length > 0) {
    highlights.push(`<div style="margin:4px 0;font-size:13px;color:#333;">🔴 <strong>Bugs:</strong> ${newBugsToday.length} new bug(s) raised today</div>`);
  }
  
  // Test executions today
  const testTodayCount = testPoints.filter(t => {
    const lastRun = t.lastResultDetails?.dateCompleted;
    return lastRun && lastRun.split('T')[0] === today;
  }).length;
  
  if (testTodayCount > 0) {
    highlights.push(`<div style="margin:4px 0;font-size:13px;color:#333;">✅ <strong>Test Execution:</strong> ${testTodayCount} test case(s) executed today</div>`);
  } else {
    highlights.push(`<div style="margin:4px 0;font-size:13px;color:#333;">📋 <strong>Test Execution:</strong> No test executions recorded today</div>`);
  }
  
  if (highlights.length === 0) {
    highlights.push(`<div style="margin:4px 0;font-size:13px;color:#999;">No highlights for today</div>`);
  }
  
  return highlights.join('\n');
}

// Get target date RAG status HTML
function getTargetDateRagHtml(targetDateStr, label) {
  if (!targetDateStr) return '';
  
  const target = new Date(targetDateStr);
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const daysRemaining = Math.ceil((target - today) / (1000 * 60 * 60 * 24));
  
  let ragColor, ragBg, ragBorder, ragLabel, ragIcon;
  
  if (daysRemaining < 0) {
    ragColor = '#D32F2F'; ragBg = '#FFEBEE'; ragBorder = '#D32F2F';
    ragLabel = 'OVERDUE'; ragIcon = '🔴';
  } else if (daysRemaining <= 3) {
    ragColor = '#F57C00'; ragBg = '#FFF3E0'; ragBorder = '#F57C00';
    ragLabel = 'AT RISK'; ragIcon = '🟠';
  } else {
    ragColor = '#2E7D32'; ragBg = '#E8F5E9'; ragBorder = '#2E7D32';
    ragLabel = 'ON TRACK'; ragIcon = '🟢';
  }
  
  const daysText = daysRemaining < 0 ? `${Math.abs(daysRemaining)} day(s) overdue` : `${daysRemaining} day(s) remaining`;
  const formattedDate = target.toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' });
  
  return `<div style="margin:16px 0 30px 0;">
    <table cellpadding="0" cellspacing="0" border="0" style="margin:0 0 2px 0;"><tr><td style="font-family:Segoe UI,Arial,sans-serif;color:#0078D4;font-size:15px;font-weight:bold;border-bottom:2px solid #0078D4;">Target Date:</td></tr></table>
    <div style="margin:12px 0;padding:16px 20px;background:${ragBg};border-left:5px solid ${ragBorder};border-radius:4px;">
      <table cellpadding="0" cellspacing="0" border="0" style="width:100%;">
        <tr>
          <td style="vertical-align:middle;">
            <span style="font-size:14px;color:#333;"><strong>${label}</strong></span><br/>
            <span style="font-size:22px;font-weight:bold;color:${ragColor};">${formattedDate}</span><br/>
            <span style="font-size:13px;color:#555;">${daysText}</span>
          </td>
          <td style="text-align:right;vertical-align:middle;width:140px;">
            <span style="font-size:28px;">${ragIcon}</span><br/>
            <span style="display:inline-block;margin-top:4px;padding:4px 14px;background:${ragColor};color:white;border-radius:4px;font-size:13px;font-weight:bold;">${ragLabel}</span>
          </td>
        </tr>
      </table>
    </div>
  </div>`;
}

// Main: Generate full ADO report HTML (matching PowerShell version)
async function generateAdoReportHtml() {
  const availability = getAdoAvailability({ requireDelivery: false });
  if (!availability.available) {
    throw new Error(`ADO preview is not configured: ${availability.issues.join('; ')}`);
  }

  const report = await generateAdoReportHtmlViaPowerShell();
  return {
    ok: true,
    html: report.html,
    subject: report.subject,
    summary: {
      source: 'powershell',
      reportPath: report.reportPath,
    },
  };
}

async function sendAdoReportEmail(options = {}) {
  const { htmlOverride, subjectOverride } = options;
  const availability = getAdoAvailability();
  if (!availability.available) {
    throw new Error(`ADO email is not configured: ${availability.issues.join('; ')}`);
  }

  let htmlToSend = htmlOverride;
  let subjectToSend = subjectOverride;

  if (!htmlToSend || !subjectToSend) {
    const report = await generateAdoReportHtml();
    htmlToSend = htmlToSend || report.html;
    subjectToSend = subjectToSend || report.subject;
  }

  const hasSmtpPassword = Boolean(process.env.SMTP_PASSWORD);
  console.log(`[EMAIL] SMTP_PASSWORD set: ${hasSmtpPassword}`);
  
  if (!hasSmtpPassword) {
    console.log('[EMAIL] Using PowerShell Outlook COM fallback (SMTP_PASSWORD not set)');
    await sendViaPowerShellOutlookWithHtml({ html: htmlToSend, subjectLine: subjectToSend });
    return { transport: 'outlook-fallback' };
  }

  // Send via SMTP
  // For port 587: use STARTTLS (secure: false, then upgrade)
  // For port 465: use direct TLS (secure: true)
  const isPort587 = smtpPort === 587 || smtpPort === '587';
  const secureOption = isPort587 ? false : useSsl;
  
  console.log(`[EMAIL] Using SMTP (server: ${smtpServer}, port: ${smtpPort}, secure: ${secureOption})`);
  const transporter = nodemailer.createTransport({
    host: smtpServer,
    port: smtpPort,
    secure: secureOption,
    auth: {
      user: fromAddr,
      pass: process.env.SMTP_PASSWORD
    }
  });
  try {
    await transporter.sendMail({
      from: fromAddr,
      to: recipients.join(','),
      subject: subjectToSend,
      html: htmlToSend
    });
    return { transport: 'smtp' };
  } catch (error) {
    console.log(`[EMAIL] SMTP failed: ${error.message}. Attempting PowerShell Outlook fallback...`);
    if (shouldUsePowerShellFallback(error)) {
      await sendViaPowerShellOutlookWithHtml({ html: htmlToSend, subjectLine: subjectToSend });
      return { transport: 'outlook-fallback' };
    }
    throw error;
  }
}

module.exports = { 
  sendAdoReportEmail, 
  getAdoAvailability, 
  generateAdoReportHtml 
};