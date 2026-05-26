"use strict";

// ── ADO Bug Creator ──────────────────────────────────────────────────────────
// Creates a Bug work item in Azure DevOps via the Work Items REST API.
// All fields map to standard ADO Bug fields. Test case is linked as "Related".

const fetch = require("node-fetch");
const path = require("path");
const fs = require("fs");

const configPath = path.join(__dirname, "../RaiseADOBugs/config.json");
const config = JSON.parse(fs.readFileSync(configPath, "utf8"));

const org = config.AzureDevOps.Organization;
const project = config.AzureDevOps.Project;
const patEnvVar = config.AzureDevOps.PatTokenEnvVar;

function getAuthHeader() {
  const pat = process.env[patEnvVar];
  if (!pat || pat.trim() === "") {
    throw new Error(
      `ADO PAT token not set. Add it to your environment as: ${patEnvVar}`
    );
  }
  return "Basic " + Buffer.from(":" + pat.trim()).toString("base64");
}

/**
 * Creates an ADO Bug work item and optionally links it to a test case.
 *
 * @param {object} params
 * @param {string} params.title
 * @param {string} [params.areaPath]       defaults to project name
 * @param {string} [params.iterationPath]  defaults to "<project>\\Iteration 1"
 * @param {string} [params.assignedTo]     display name or email
 * @param {string} [params.reproSteps]     HTML string for the Repro Steps field
 * @param {string|number} [params.priority] 1–4
 * @param {string} [params.severity]       e.g. "2 - High"
 * @param {string|number} [params.testCaseId] work item ID to link as Related
 * @returns {{ id: number, url: string }}
 */
async function createAdoBug({
  title,
  areaPath,
  iterationPath,
  assignedTo,
  reproSteps,
  priority,
  severity,
  testCaseId,
}) {
  if (!title || !title.trim()) {
    throw new Error("Bug title is required.");
  }

  const auth = getAuthHeader();
  const encodedProject = encodeURIComponent(project);
  const apiUrl =
    `https://dev.azure.com/${org}/${encodedProject}/_apis/wit/workitems/$Bug?api-version=7.1`;

  console.log(`[ado-bug-creator] POST ${apiUrl}`);
  console.log(`[ado-bug-creator] PAT length: ${process.env[patEnvVar] ? process.env[patEnvVar].length : "NOT SET"}`);
  console.log(`[ado-bug-creator] Auth header starts: ${auth.substring(0, 12)}...`);

  const resolvedArea = areaPath && areaPath.trim() ? areaPath.trim() : project;
  const resolvedIteration =
    iterationPath && iterationPath.trim()
      ? iterationPath.trim()
      : `${project}\\Iteration 1`;
  const resolvedPriority = parseInt(priority, 10);
  const resolvedSeverity = severity || "3 - Medium";

  const patchDoc = [
    { op: "add", path: "/fields/System.Title", value: title.trim() },
    { op: "add", path: "/fields/System.AreaPath", value: resolvedArea },
    { op: "add", path: "/fields/System.IterationPath", value: resolvedIteration },
    {
      op: "add",
      path: "/fields/Microsoft.VSTS.TCM.ReproSteps",
      value: reproSteps || "",
    },
    {
      op: "add",
      path: "/fields/Microsoft.VSTS.Common.Priority",
      value: Number.isFinite(resolvedPriority) ? resolvedPriority : 3,
    },
    {
      op: "add",
      path: "/fields/Microsoft.VSTS.Common.Severity",
      value: resolvedSeverity,
    },
  ];

  if (assignedTo && assignedTo.trim()) {
    patchDoc.push({
      op: "add",
      path: "/fields/System.AssignedTo",
      value: assignedTo.trim(),
    });
  }

  // Link to related test case
  if (testCaseId) {
    const tcId = String(testCaseId).trim();
    if (tcId) {
      patchDoc.push({
        op: "add",
        path: "/relations/-",
        value: {
          rel: "System.LinkTypes.Related",
          url: `https://dev.azure.com/${org}/_apis/wit/workItems/${tcId}`,
          attributes: { comment: "Related test case" },
        },
      });
    }
  }

  const res = await fetch(apiUrl, {
    method: "POST",
    headers: {
      Authorization: auth,
      "Content-Type": "application/json-patch+json",
    },
    body: JSON.stringify(patchDoc),
  });

  if (!res.ok) {
    const errText = await res.text();
    console.log(`[ado-bug-creator] ADO error ${res.status}:`, errText);
    throw new Error(`ADO API responded with ${res.status}: ${errText}`);
  }

  const data = await res.json();
  const workItemId = data.id;
  const workItemUrl =
    data._links?.html?.href ||
    `https://dev.azure.com/${org}/${project}/_workitems/edit/${workItemId}`;

  return { id: workItemId, url: workItemUrl };
}

module.exports = { createAdoBug };
