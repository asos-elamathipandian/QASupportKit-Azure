<#
.SYNOPSIS
    Automated Azure DevOps Bug & Test Execution Report
.DESCRIPTION
    Queries ADO shared queries for Bugs and Test Plan progress,
    formats results into HTML tables, and sends an email report.
.NOTES
    Requires: ADO PAT token set in environment variable ADO_PAT_TOKEN
    Schedule via Windows Task Scheduler using Register-ScheduledTask.ps1
#>

[CmdletBinding()]
param(
    [string]$ConfigPath,
    [switch]$PreviewOnly,
    [string]$TargetDate,
    [ValidateSet('Auto','Red','Amber','Green')]
    [string]$RagStatus,
    [string]$RagReason
)

$ErrorActionPreference = "Stop"

# Resolve script root (handles cases where $PSScriptRoot is empty)
$scriptDir = if ($PSScriptRoot) { $PSScriptRoot } else { Split-Path -Parent $MyInvocation.MyCommand.Definition }
if (-not $ConfigPath) { $ConfigPath = Join-Path $scriptDir "config.json" }

#region --- Load Configuration ---
if (-not (Test-Path $ConfigPath)) {
    throw "Config file not found at: $ConfigPath"
}

$config = Get-Content $ConfigPath -Raw | ConvertFrom-Json
$org        = $config.AzureDevOps.Organization
$project    = $config.AzureDevOps.Project
$baseUrl    = $config.AzureDevOps.BaseUrl
$bugQueryId  = $config.AzureDevOps.BugQueryId
$testQueryId = $config.AzureDevOps.TestPlanQueryId
$testPlanId  = $config.AzureDevOps.TestPlanId
$testSuiteId = $config.AzureDevOps.TestSuiteId
$tstmTestPlanId  = $config.AzureDevOps.TstmTestPlanId
$tstmTestSuiteId = $config.AzureDevOps.TstmTestSuiteId
$patEnvVar  = $config.AzureDevOps.PatTokenEnvVar

$recipients = $config.Email.Recipients
$fromAddr   = $config.Email.From
$subject    = "$($config.Email.Subject) - $(Get-Date -Format 'dd MMM yyyy')"
$smtpServer = $config.Email.SmtpServer
$smtpPort   = $config.Email.Port
$useSsl     = $config.Email.UseSsl

$targetDateStr          = if ($TargetDate) { $TargetDate } else { $config.TargetDate.Date }
$targetDateLabel        = $config.TargetDate.Label
$amberThresholdDays     = $config.TargetDate.AmberThresholdDays
$greenThresholdDays     = $config.TargetDate.GreenThresholdDays
$ragOverride            = if ($RagStatus) { $RagStatus } else { $config.TargetDate.RagOverride }
$ragReasonText          = if ($RagReason) { $RagReason } else { $config.TargetDate.RagReason }
#endregion

#region --- Authentication ---
$pat = [System.Environment]::GetEnvironmentVariable($patEnvVar, "User")
if ([string]::IsNullOrWhiteSpace($pat)) {
    $pat = $env:ADO_PAT_TOKEN
}
if ([string]::IsNullOrWhiteSpace($pat)) {
    throw "PAT token not found. Set environment variable '$patEnvVar' with your ADO Personal Access Token."
}

$encodedPat = [Convert]::ToBase64String([Text.Encoding]::ASCII.GetBytes(":$pat"))
$headers = @{
    Authorization  = "Basic $encodedPat"
    "Content-Type" = "application/json"
}
#endregion

#region --- Helper Functions ---
function Invoke-ADOApi {
    param(
        [string]$Uri,
        [string]$Method = "GET",
        [hashtable]$Headers
    )
    try {
        $response = Invoke-RestMethod -Uri $Uri -Method $Method -Headers $Headers -UseBasicParsing
        return $response
    }
    catch {
        Write-Error "ADO API call failed: $($_.Exception.Message) | URI: $Uri"
        throw
    }
}

function Get-QueryResults {
    param(
        [string]$QueryId,
        [hashtable]$Headers
    )

    $queryUri = "https://dev.azure.com/$org/$project/_apis/wit/wiql/$($QueryId)?api-version=7.1"
    $queryResult = Invoke-ADOApi -Uri $queryUri -Headers $Headers

    $wiList = @($queryResult.workItems)
    if ($null -eq $queryResult.workItems -or $wiList.Count -eq 0) {
        return @()
    }

    # Batch fetch work item details (max 200 per batch)
    $workItems = @()
    $ids = @($wiList | Select-Object -ExpandProperty id)
    $batchSize = 200

    for ($i = 0; $i -lt $ids.Count; $i += $batchSize) {
        $batchIds = $ids[$i..([Math]::Min($i + $batchSize - 1, $ids.Count - 1))]
        $idsParam = ($batchIds -join ",")
        $fields = "System.Id,System.Title,System.State,System.AssignedTo,Microsoft.VSTS.Common.Priority,System.CreatedDate,System.ChangedDate,System.WorkItemType,Microsoft.VSTS.Common.Severity"
        $detailsUri = "https://dev.azure.com/$org/$project/_apis/wit/workitems?ids=$idsParam&fields=$fields&api-version=7.1"
        $details = Invoke-ADOApi -Uri $detailsUri -Headers $Headers
        $workItems += @($details.value)
    }

    return $workItems
}

function Get-TestPointResults {
    param(
        [int]$PlanId,
        [int]$SuiteId,
        [hashtable]$Headers
    )

    # Fetch all test points from the test plan suite (handles pagination)
    $allPoints = @()
    $continuationToken = $null
    do {
        $uri = "https://dev.azure.com/$org/$project/_apis/test/Plans/$PlanId/Suites/$SuiteId/points?api-version=7.1"
        if ($continuationToken) {
            $uri += "&continuationToken=$continuationToken"
        }
        $response = Invoke-ADOApi -Uri $uri -Headers $Headers
        if ($response.value) {
            $allPoints += @($response.value)
        }
        $continuationToken = if ($response.PSObject.Properties['continuationToken']) { $response.continuationToken } else { $null }
    } while ($continuationToken)

    return $allPoints
}

function Get-TestOutcomeDonutChart {
    param(
        [array]$TestPoints,
        [string]$ChartTitle = 'Test Cases Stats'
    )

    if ($TestPoints.Count -eq 0) {
        return "<p style='color:#666;'>No test point data available.</p>"
    }

    Add-Type -AssemblyName System.Drawing

    $total = $TestPoints.Count

    # Group by outcome (top-level .outcome field, or "Not Run" if blank)
    $grouped = $TestPoints | Group-Object {
        $outcome = $_.outcome
        if ([string]::IsNullOrWhiteSpace($outcome) -or $outcome -eq 'Unspecified') { 'Not Run' }
        else { $outcome }
    }

    # Outcome colors (matching ADO test chart palette)
    $outcomeColors = @{
        'Passed'        = [System.Drawing.Color]::FromArgb(0, 200, 0)     # Bright Green
        'Failed'        = [System.Drawing.Color]::FromArgb(255, 0, 0)      # Bright Red
        'Blocked'       = [System.Drawing.Color]::FromArgb(158, 158, 158)  # Grey
        'Not Run'       = [System.Drawing.Color]::FromArgb(33, 150, 243)   # Blue
        'NotApplicable' = [System.Drawing.Color]::FromArgb(120, 144, 156)  # Blue Grey
        'Paused'        = [System.Drawing.Color]::FromArgb(255, 152, 0)    # Orange
        'In Progress'   = [System.Drawing.Color]::FromArgb(33, 150, 243)   # Blue
        'None'          = [System.Drawing.Color]::FromArgb(158, 158, 158)  # Grey
    }
    $defaultColor = [System.Drawing.Color]::FromArgb(96, 125, 139)

    # Calculate passed percentage for center
    $passedCount = ($grouped | Where-Object { $_.Name -eq 'Passed' } | Measure-Object -Property Count -Sum).Sum
    if ($null -eq $passedCount) { $passedCount = 0 }
    $passedPct = [math]::Round(($passedCount / $total) * 100, 0)

    # --- Generate Donut Chart PNG ---
    $imgWidth = 600
    $imgHeight = 300
    $bmp = New-Object System.Drawing.Bitmap($imgWidth, $imgHeight)
    $g = [System.Drawing.Graphics]::FromImage($bmp)
    $g.SmoothingMode = [System.Drawing.Drawing2D.SmoothingMode]::AntiAlias
    $g.TextRenderingHint = [System.Drawing.Text.TextRenderingHint]::ClearTypeGridFit
    $g.Clear([System.Drawing.Color]::White)

    # Donut dimensions
    $donutSize = 220
    $donutX = 30
    $donutY = ($imgHeight - $donutSize) / 2
    $donutRect = New-Object System.Drawing.Rectangle($donutX, $donutY, $donutSize, $donutSize)
    $innerSize = 130
    $innerX = $donutX + ($donutSize - $innerSize) / 2
    $innerY = $donutY + ($donutSize - $innerSize) / 2

    # Draw donut slices
    $startAngle = -90.0
    $sortedGroups = $grouped | Sort-Object Count -Descending
    foreach ($s in $sortedGroups) {
        $sweepAngle = ($s.Count / $total) * 360.0
        $color = if ($outcomeColors.ContainsKey($s.Name)) { $outcomeColors[$s.Name] } else { $defaultColor }
        $brush = New-Object System.Drawing.SolidBrush($color)
        $g.FillPie($brush, $donutRect, $startAngle, $sweepAngle)
        $brush.Dispose()
        $startAngle += $sweepAngle
    }

    # Cut out center
    $whiteBrush = New-Object System.Drawing.SolidBrush([System.Drawing.Color]::White)
    $g.FillEllipse($whiteBrush, $innerX, $innerY, $innerSize, $innerSize)
    $whiteBrush.Dispose()

    # Center percentage
    $pctFont = New-Object System.Drawing.Font("Segoe UI", 28, [System.Drawing.FontStyle]::Bold)
    $pctBrush = New-Object System.Drawing.SolidBrush([System.Drawing.Color]::FromArgb(51, 51, 51))
    $pctText = "${passedPct}%"
    $pctSize = $g.MeasureString($pctText, $pctFont)
    $pctX = $innerX + ($innerSize - $pctSize.Width) / 2
    $pctY = $innerY + ($innerSize - $pctSize.Height) / 2 - 8
    $g.DrawString($pctText, $pctFont, $pctBrush, $pctX, $pctY)
    $pctFont.Dispose()

    # "Passed" label
    $labelFont = New-Object System.Drawing.Font("Segoe UI", 10)
    $labelBrush = New-Object System.Drawing.SolidBrush([System.Drawing.Color]::FromArgb(120, 120, 120))
    $labelText = "Passed"
    $labelSize = $g.MeasureString($labelText, $labelFont)
    $labelX = $innerX + ($innerSize - $labelSize.Width) / 2
    $labelY = $pctY + $pctSize.Height - 6
    $g.DrawString($labelText, $labelFont, $labelBrush, $labelX, $labelY)
    $labelFont.Dispose()

    # Legend
    $legendX = $donutX + $donutSize + 40
    $legendY = 40
    $legendFont = New-Object System.Drawing.Font("Segoe UI", 11)
    $legendCountFont = New-Object System.Drawing.Font("Segoe UI", 11, [System.Drawing.FontStyle]::Bold)
    $textBrush = New-Object System.Drawing.SolidBrush([System.Drawing.Color]::FromArgb(80, 80, 80))

    foreach ($s in $sortedGroups) {
        $color = if ($outcomeColors.ContainsKey($s.Name)) { $outcomeColors[$s.Name] } else { $defaultColor }
        $pct = [math]::Round(($s.Count / $total) * 100, 1)
        $swatchBrush = New-Object System.Drawing.SolidBrush($color)
        $g.FillRectangle($swatchBrush, $legendX, $legendY + 2, 14, 14)
        $swatchBrush.Dispose()
        $legendEntry = "$($s.Name): $($s.Count) (${pct}%)"
        $g.DrawString($legendEntry, $legendFont, $textBrush, ($legendX + 22), $legendY)
        $legendY += 30
    }

    $legendY += 10
    $g.DrawString("Total: $total", $legendCountFont, $textBrush, $legendX, $legendY)

    $legendFont.Dispose()
    $legendCountFont.Dispose()
    $textBrush.Dispose()
    $pctBrush.Dispose()
    $labelBrush.Dispose()
    $g.Dispose()

    # Convert to base64 PNG
    $ms = New-Object System.IO.MemoryStream
    $bmp.Save($ms, [System.Drawing.Imaging.ImageFormat]::Png)
    $base64 = [Convert]::ToBase64String($ms.ToArray())
    $ms.Dispose()
    $bmp.Dispose()

    return @"
    <div style="margin:16px 0;padding:16px 20px;background:#f8f9fa;border:1px solid #e0e0e0;border-radius:8px;text-align:center;">
        <h4 style="margin:0 0 12px 0;color:#333;font-family:Segoe UI,Arial,sans-serif;text-align:left;">$ChartTitle</h4>
        <img src="data:image/png;base64,$base64" alt="$ChartTitle" style="max-width:100%;height:auto;" />
    </div>
"@
}

function Format-WorkItemsToHtml {
    param(
        [array]$WorkItems,
        [string]$TableTitle,
        [string]$AccentColor = "#0078D4",
        [hashtable]$Headers
    )

    if ($WorkItems.Count -eq 0) {
        return "<p style='color:#666;'>No items found.</p>"
    }

    $rows = foreach ($wi in $WorkItems) {
        $f = $wi.fields
        $id = $f.'System.Id'
        $title = [System.Net.WebUtility]::HtmlEncode($f.'System.Title')
        $state = [System.Net.WebUtility]::HtmlEncode($f.'System.State')
        $assignedTo = if ($f.'System.AssignedTo') {
            [System.Net.WebUtility]::HtmlEncode($f.'System.AssignedTo'.displayName)
        } else { "Unassigned" }
        $priority = $f.'Microsoft.VSTS.Common.Priority'
        $severity = if ($f.'Microsoft.VSTS.Common.Severity') {
            [System.Net.WebUtility]::HtmlEncode($f.'Microsoft.VSTS.Common.Severity')
        } else { "-" }
        $created = if ($f.'System.CreatedDate') {
            (Get-Date $f.'System.CreatedDate').ToString("dd MMM yyyy")
        } else { "-" }

        # Fetch latest comment
        $latestComment = "-"
        if ($Headers) {
            try {
                $commentsUri = "https://dev.azure.com/$org/$project/_apis/wit/workItems/$id/comments?`$top=1&order=desc&api-version=7.1-preview.4"
                $commentsResp = Invoke-ADOApi -Uri $commentsUri -Headers $Headers
                if ($commentsResp.comments -and @($commentsResp.comments).Count -gt 0) {
                    $rawText = @($commentsResp.comments)[0].text
                    # Strip HTML tags from comment
                    $plainText = $rawText -replace '<[^>]+>', '' -replace '&nbsp;', ' ' -replace '&#\d+;', ''
                    $plainText = $plainText.Trim()
                    if ($plainText.Length -gt 120) {
                        $plainText = $plainText.Substring(0, 120) + "..."
                    }
                    $latestComment = [System.Net.WebUtility]::HtmlEncode($plainText)
                }
            } catch {
                $latestComment = "-"
            }
        }

        # Color-code state
        $stateColor = switch ($state) {
            "New"       { "#E8A317" }
            "Active"    { "#0078D4" }
            "Resolved"  { "#2E8B57" }
            "Closed"    { "#808080" }
            default     { "#333333" }
        }

        # Color-code priority
        $priorityBadge = switch ($priority) {
            1 { "<span style='background:#D32F2F;color:white;padding:2px 8px;border-radius:3px;font-size:12px;'>P1</span>" }
            2 { "<span style='background:#F57C00;color:white;padding:2px 8px;border-radius:3px;font-size:12px;'>P2</span>" }
            3 { "<span style='background:#FBC02D;color:#333;padding:2px 8px;border-radius:3px;font-size:12px;'>P3</span>" }
            4 { "<span style='background:#90A4AE;color:white;padding:2px 8px;border-radius:3px;font-size:12px;'>P4</span>" }
            default { "<span style='padding:2px 8px;font-size:12px;'>-</span>" }
        }

        $itemUrl = "$baseUrl/_workitems/edit/$id"

        @"
        <tr>
            <td style="padding:5px 8px;border-bottom:1px solid #e0e0e0;"><a href="$itemUrl" style="color:#0078D4;text-decoration:none;font-weight:600;">$id</a></td>
            <td style="padding:5px 8px;border-bottom:1px solid #e0e0e0;">$title</td>
            <td style="padding:5px 8px;border-bottom:1px solid #e0e0e0;"><span style="color:$stateColor;font-weight:600;">$state</span></td>
            <td style="padding:5px 8px;border-bottom:1px solid #e0e0e0;">$severity</td>
            <td style="padding:5px 8px;border-bottom:1px solid #e0e0e0;">$assignedTo</td>
            <td style="padding:5px 8px;border-bottom:1px solid #e0e0e0;font-size:11px;color:#555;max-width:200px;">$latestComment</td>
        </tr>
"@
    }

    $count = $WorkItems.Count
    return @"
    <table style="border-collapse:collapse;width:100%;font-family:Segoe UI,Arial,sans-serif;font-size:12px;margin-top:8px;">
        <thead>
            <tr style="background:#FFCDD2;color:#333;">
                <th style="padding:2px 6px;text-align:left;font-size:11px;">ID</th>
                <th style="padding:2px 6px;text-align:left;font-size:11px;">Title</th>
                <th style="padding:2px 6px;text-align:left;font-size:11px;">State</th>
                <th style="padding:2px 6px;text-align:left;font-size:11px;">Severity</th>
                <th style="padding:2px 6px;text-align:left;font-size:11px;">Assigned To</th>
                <th style="padding:2px 6px;text-align:left;font-size:11px;">Latest Comment</th>
            </tr>
        </thead>
        <tbody>
            $($rows -join "`n")
        </tbody>
    </table>
"@
}

function Format-TestPlanItemsToHtml {
    param(
        [array]$WorkItems,
        [hashtable]$Headers
    )

    if ($WorkItems.Count -eq 0) {
        return "<p style='color:#666;'>No items found.</p>"
    }

    $rows = foreach ($wi in $WorkItems) {
        $f = $wi.fields
        $id = $f.'System.Id'
        $title = [System.Net.WebUtility]::HtmlEncode($f.'System.Title')
        $state = [System.Net.WebUtility]::HtmlEncode($f.'System.State')
        $assignedTo = if ($f.'System.AssignedTo') {
            [System.Net.WebUtility]::HtmlEncode($f.'System.AssignedTo'.displayName)
        } else { "Unassigned" }
        $created = if ($f.'System.CreatedDate') {
            (Get-Date $f.'System.CreatedDate').ToString("dd MMM yyyy")
        } else { "-" }

        # Get test case count via testplan API (root suite ID = planId + 1)
        $tcCount = 0
        try {
            $rootSuiteId = $id + 1
            $ptsResp = Invoke-ADOApi -Uri "https://dev.azure.com/$org/$project/_apis/testplan/Plans/$id/Suites/$rootSuiteId/TestPoint?api-version=7.1" -Headers $Headers
            if ($ptsResp.count) {
                $tcCount = $ptsResp.count
            } elseif ($ptsResp.value) {
                $tcCount = @($ptsResp.value).Count
            }
        } catch {
            $tcCount = "-"
        }

        $stateColor = switch ($state) {
            "Active"    { "#0078D4" }
            "Inactive"  { "#808080" }
            default     { "#333333" }
        }

        $itemUrl = "$baseUrl/_testPlans/define?planId=$id"

        @"
        <tr>
            <td style="padding:5px 8px;border-bottom:1px solid #e0e0e0;"><a href="$itemUrl" style="color:#0078D4;text-decoration:none;font-weight:600;">$id</a></td>
            <td style="padding:5px 8px;border-bottom:1px solid #e0e0e0;">$title</td>
            <td style="padding:5px 8px;border-bottom:1px solid #e0e0e0;"><span style="color:$stateColor;font-weight:600;">$state</span></td>
            <td style="padding:5px 8px;border-bottom:1px solid #e0e0e0;text-align:center;font-weight:600;">$tcCount</td>
            <td style="padding:5px 8px;border-bottom:1px solid #e0e0e0;">$assignedTo</td>
        </tr>
"@
    }

    $count = $WorkItems.Count
    return @"
    <table style="border-collapse:collapse;width:100%;font-family:Segoe UI,Arial,sans-serif;font-size:12px;margin-top:8px;">
        <thead>
            <tr style="background:#BBDEFB;color:#333;">
                <th style="padding:2px 6px;text-align:left;font-size:11px;">ID</th>
                <th style="padding:2px 6px;text-align:left;font-size:11px;">CR</th>
                <th style="padding:2px 6px;text-align:left;font-size:11px;">State</th>
                <th style="padding:2px 6px;text-align:center;font-size:11px;">Test Cases</th>
                <th style="padding:2px 6px;text-align:left;font-size:11px;">Assigned To</th>
            </tr>
        </thead>
        <tbody>
            $($rows -join "`n")
        </tbody>
    </table>
"@
}

function Get-SummaryStats {
    param([array]$WorkItems, [string]$Label)

    $total = $WorkItems.Count
    $byState = $WorkItems | Group-Object { $_.fields.'System.State' } | Sort-Object Count -Descending
    $byPriority = $WorkItems | Where-Object {
        $p = $_.fields.PSObject.Properties['Microsoft.VSTS.Common.Priority']
        $null -ne $p -and $null -ne $p.Value
    } | Group-Object { "P$($_.fields.'Microsoft.VSTS.Common.Priority')" } | Sort-Object Name

    $stateCards = foreach ($g in $byState) {
        "<span style='display:inline-block;margin:4px;padding:6px 14px;background:#f0f0f0;border-radius:4px;font-size:13px;'><strong>$($g.Name)</strong>: $($g.Count)</span>"
    }
    $priorityCards = foreach ($g in $byPriority) {
        "<span style='display:inline-block;margin:4px;padding:6px 14px;background:#f0f0f0;border-radius:4px;font-size:13px;'><strong>$($g.Name)</strong>: $($g.Count)</span>"
    }

    return @"
    <div style="margin:12px 0;padding:12px 16px;background:#f8f9fa;border-left:4px solid #0078D4;border-radius:4px;">
        <strong>$Label Summary:</strong> $total total<br/>
        <div style="margin-top:6px;">By State: $($stateCards -join " ")</div>
        <div style="margin-top:4px;">By Priority: $($priorityCards -join " ")</div>
    </div>
"@
}

function Get-DonutChart {
    param([array]$WorkItems, [string]$ChartTitle = 'Progress', [string]$CenterLabel = 'Complete')

    if ($WorkItems.Count -eq 0) {
        return "<p style='color:#666;'>No test data available for progress chart.</p>"
    }

    Add-Type -AssemblyName System.Drawing

    $total = $WorkItems.Count
    $byState = $WorkItems | Group-Object { $_.fields.'System.State' }

    # State colors (matching ADO tile chart palette)
    $stateColors = @{
        'Closed'      = [System.Drawing.Color]::FromArgb(76, 175, 80)    # Green
        'Done'        = [System.Drawing.Color]::FromArgb(76, 175, 80)
        'Resolved'    = [System.Drawing.Color]::FromArgb(139, 195, 74)   # Light Green
        'Active'      = [System.Drawing.Color]::FromArgb(33, 150, 243)   # Blue
        'In Progress' = [System.Drawing.Color]::FromArgb(33, 150, 243)
        'Design'      = [System.Drawing.Color]::FromArgb(255, 152, 0)    # Orange
        'Ready'       = [System.Drawing.Color]::FromArgb(255, 152, 0)
        'New'         = [System.Drawing.Color]::FromArgb(158, 158, 158)  # Grey
    }
    $defaultColor = [System.Drawing.Color]::FromArgb(96, 125, 139)

    # Classify for center percentage
    $doneStates = @('Closed', 'Done', 'Resolved')
    $doneCount = ($byState | Where-Object { $_.Name -in $doneStates } | Measure-Object -Property Count -Sum).Sum
    if ($null -eq $doneCount) { $doneCount = 0 }
    $donePct = [math]::Round(($doneCount / $total) * 100, 0)

    # --- Generate Donut Chart PNG ---
    $imgWidth = 600
    $imgHeight = 300
    $bmp = New-Object System.Drawing.Bitmap($imgWidth, $imgHeight)
    $g = [System.Drawing.Graphics]::FromImage($bmp)
    $g.SmoothingMode = [System.Drawing.Drawing2D.SmoothingMode]::AntiAlias
    $g.TextRenderingHint = [System.Drawing.Text.TextRenderingHint]::ClearTypeGridFit
    $g.Clear([System.Drawing.Color]::White)

    # Donut dimensions
    $donutSize = 220
    $donutX = 30
    $donutY = ($imgHeight - $donutSize) / 2
    $donutRect = New-Object System.Drawing.Rectangle($donutX, $donutY, $donutSize, $donutSize)
    $innerSize = 130
    $innerX = $donutX + ($donutSize - $innerSize) / 2
    $innerY = $donutY + ($donutSize - $innerSize) / 2

    # Draw donut slices
    $startAngle = -90.0
    $sortedStates = $byState | Sort-Object Count -Descending
    foreach ($s in $sortedStates) {
        $sweepAngle = ($s.Count / $total) * 360.0
        $color = if ($stateColors.ContainsKey($s.Name)) { $stateColors[$s.Name] } else { $defaultColor }
        $brush = New-Object System.Drawing.SolidBrush($color)
        $g.FillPie($brush, $donutRect, $startAngle, $sweepAngle)
        $brush.Dispose()
        $startAngle += $sweepAngle
    }

    # Cut out center (donut hole)
    $whiteBrush = New-Object System.Drawing.SolidBrush([System.Drawing.Color]::White)
    $g.FillEllipse($whiteBrush, $innerX, $innerY, $innerSize, $innerSize)
    $whiteBrush.Dispose()

    # Draw center percentage text
    $pctFont = New-Object System.Drawing.Font("Segoe UI", 28, [System.Drawing.FontStyle]::Bold)
    $pctBrush = New-Object System.Drawing.SolidBrush([System.Drawing.Color]::FromArgb(51, 51, 51))
    $pctText = "${donePct}%"
    $pctSize = $g.MeasureString($pctText, $pctFont)
    $pctX = $innerX + ($innerSize - $pctSize.Width) / 2
    $pctY = $innerY + ($innerSize - $pctSize.Height) / 2 - 8
    $g.DrawString($pctText, $pctFont, $pctBrush, $pctX, $pctY)
    $pctFont.Dispose()

    # Center label below percentage
    $labelFont = New-Object System.Drawing.Font("Segoe UI", 10)
    $labelBrush = New-Object System.Drawing.SolidBrush([System.Drawing.Color]::FromArgb(120, 120, 120))
    $labelText = $CenterLabel
    $labelSize = $g.MeasureString($labelText, $labelFont)
    $labelX = $innerX + ($innerSize - $labelSize.Width) / 2
    $labelY = $pctY + $pctSize.Height - 6
    $g.DrawString($labelText, $labelFont, $labelBrush, $labelX, $labelY)
    $labelFont.Dispose()

    # --- Draw Legend (right side) ---
    $legendX = $donutX + $donutSize + 40
    $legendY = 40
    $legendFont = New-Object System.Drawing.Font("Segoe UI", 11)
    $legendCountFont = New-Object System.Drawing.Font("Segoe UI", 11, [System.Drawing.FontStyle]::Bold)
    $textBrush = New-Object System.Drawing.SolidBrush([System.Drawing.Color]::FromArgb(80, 80, 80))

    foreach ($s in $sortedStates) {
        $color = if ($stateColors.ContainsKey($s.Name)) { $stateColors[$s.Name] } else { $defaultColor }
        $pct = [math]::Round(($s.Count / $total) * 100, 1)

        # Color swatch
        $swatchBrush = New-Object System.Drawing.SolidBrush($color)
        $g.FillRectangle($swatchBrush, $legendX, $legendY + 2, 14, 14)
        $swatchBrush.Dispose()

        # State name and count
        $legendText = "$($s.Name): $($s.Count) (${pct}%)"
        $g.DrawString($legendText, $legendFont, $textBrush, ($legendX + 22), $legendY)
        $legendY += 30
    }

    # Total at bottom of legend
    $legendY += 10
    $totalText = "Total: $total"
    $g.DrawString($totalText, $legendCountFont, $textBrush, $legendX, $legendY)

    $legendFont.Dispose()
    $legendCountFont.Dispose()
    $textBrush.Dispose()
    $pctBrush.Dispose()
    $labelBrush.Dispose()
    $g.Dispose()

    # Convert to base64 PNG
    $ms = New-Object System.IO.MemoryStream
    $bmp.Save($ms, [System.Drawing.Imaging.ImageFormat]::Png)
    $base64 = [Convert]::ToBase64String($ms.ToArray())
    $ms.Dispose()
    $bmp.Dispose()

    return @"
    <div style="margin:16px 0;padding:16px 20px;background:#f8f9fa;border:1px solid #e0e0e0;border-radius:8px;text-align:center;">
        <h4 style="margin:0 0 12px 0;color:#333;font-family:Segoe UI,Arial,sans-serif;text-align:left;">$ChartTitle</h4>
        <img src="data:image/png;base64,$base64" alt="$ChartTitle" style="max-width:100%;height:auto;" />
    </div>
"@
}
#endregion

function Format-TestPointsToHtml {
    param([array]$TestPoints)

    if ($TestPoints.Count -eq 0) {
        return "<h3 style='color:#0078D4;'>Test Cases</h3><p style='color:#666;'>No test cases found.</p>"
    }

    $rows = foreach ($tp in $TestPoints) {
        $id = $tp.testCase.id
        $title = [System.Net.WebUtility]::HtmlEncode($tp.testCase.name)
        $outcome = if ([string]::IsNullOrWhiteSpace($tp.outcome) -or $tp.outcome -eq 'Unspecified') { 'Not Run' } else { $tp.outcome }
        $configuration = if ($tp.configuration) { [System.Net.WebUtility]::HtmlEncode($tp.configuration.name) } else { "-" }

        # Get assigned to from workItemProperties
        $assignedTo = "Unassigned"
        if ($tp.workItemProperties) {
            $assignedProp = $tp.workItemProperties | Where-Object { $_.workItem.key -eq 'System.AssignedTo' }
            if ($assignedProp -and $assignedProp.workItem.value) {
                $assignedTo = [System.Net.WebUtility]::HtmlEncode(($assignedProp.workItem.value -replace '<.*>', '').Trim())
            }
        }

        # Last run info
        $lastRun = "-"
        if ($tp.lastResultDetails -and $tp.lastResultDetails.dateCompleted) {
            $lastRun = (Get-Date $tp.lastResultDetails.dateCompleted).ToString("dd MMM yyyy")
        }

        # Color-code outcome
        $outcomeColor = switch ($outcome) {
            'Passed'    { '#00C800' }
            'Failed'    { '#FF0000' }
            'Blocked'   { '#9E9E9E' }
            'Not Run'   { '#2196F3' }
            'Paused'    { '#FF9800' }
            default     { '#607D8B' }
        }

        $itemUrl = $tp.testCase.webUrl
        if (-not $itemUrl) { $itemUrl = "$baseUrl/_workitems/edit/$id" }

        @"
        <tr>
            <td style="padding:8px 12px;border-bottom:1px solid #e0e0e0;"><a href="$itemUrl" style="color:#0078D4;text-decoration:none;font-weight:600;">$id</a></td>
            <td style="padding:8px 12px;border-bottom:1px solid #e0e0e0;">$title</td>
            <td style="padding:8px 12px;border-bottom:1px solid #e0e0e0;"><span style="color:$outcomeColor;font-weight:600;">$outcome</span></td>
            <td style="padding:8px 12px;border-bottom:1px solid #e0e0e0;">$configuration</td>
            <td style="padding:8px 12px;border-bottom:1px solid #e0e0e0;">$assignedTo</td>
            <td style="padding:8px 12px;border-bottom:1px solid #e0e0e0;">$lastRun</td>
        </tr>
"@
    }

    $count = $TestPoints.Count
    return @"
    <h3 style="color:#0078D4;margin:24px 0 8px 0;font-family:Segoe UI,Arial,sans-serif;">Test Cases ($count items)</h3>
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
        <tbody>
            $($rows -join "`n")
        </tbody>
    </table>
"@
}

function Get-TodaysHighlights {
    param(
        [array]$TestPoints,
        [array]$TstmTestPoints,
        [array]$TestPlanItems,
        [array]$Bugs,
        [hashtable]$Headers
    )

    $today = (Get-Date).Date
    $highlights = @()

    # --- Test Case Highlights (by test plan/suite) ---
    # Group test points by their plan/suite and check for today's activity
    $todayTestUpdates = @()
    foreach ($tp in $TestPoints) {
        $lastRunDate = $null
        if ($tp.lastResultDetails -and $tp.lastResultDetails.dateCompleted) {
            $lastRunDate = (Get-Date $tp.lastResultDetails.dateCompleted).Date
        }
        if ($lastRunDate -eq $today) {
            $todayTestUpdates += $tp
        }
    }

    if ($todayTestUpdates.Count -gt 0) {
        # Group by configuration (acts as suite grouping)
        $byConfig = $todayTestUpdates | Group-Object { if ($_.configuration) { $_.configuration.name } else { "Default" } }
        foreach ($cg in $byConfig) {
            $byOutcome = $cg.Group | Group-Object { if ([string]::IsNullOrWhiteSpace($_.outcome) -or $_.outcome -eq 'Unspecified') { 'Not Run' } else { $_.outcome } }
            $outcomeSummary = ($byOutcome | ForEach-Object { "$($_.Count) $($_.Name)" }) -join ", "
            $highlights += @{
                Icon = "&#9989;"
                Category = "Test Execution (CR144)"
                Text = "<strong>$($cg.Name)</strong>: $($cg.Group.Count) test case(s) updated - $outcomeSummary"
            }
        }
    } else {
        $highlights += @{
            Icon = "&#128203;"
            Category = "Test Execution (CR144)"
            Text = "No test executions recorded today"
        }
    }

    # --- TSTM Test Case Highlights ---
    $todayTstmUpdates = @()
    foreach ($tp in $TstmTestPoints) {
        $lastRunDate = $null
        if ($tp.lastResultDetails -and $tp.lastResultDetails.dateCompleted) {
            $lastRunDate = (Get-Date $tp.lastResultDetails.dateCompleted).Date
        }
        if ($lastRunDate -eq $today) {
            $todayTstmUpdates += $tp
        }
    }

    if ($todayTstmUpdates.Count -gt 0) {
        $byConfig = $todayTstmUpdates | Group-Object { if ($_.configuration) { $_.configuration.name } else { "Default" } }
        foreach ($cg in $byConfig) {
            $byOutcome = $cg.Group | Group-Object { if ([string]::IsNullOrWhiteSpace($_.outcome) -or $_.outcome -eq 'Unspecified') { 'Not Run' } else { $_.outcome } }
            $outcomeSummary = ($byOutcome | ForEach-Object { "$($_.Count) $($_.Name)" }) -join ", "
            $highlights += @{
                Icon = "&#9989;"
                Category = "Test Execution (TSTM)"
                Text = "<strong>$($cg.Name)</strong>: $($cg.Group.Count) test case(s) updated - $outcomeSummary"
            }
        }
    } else {
        $highlights += @{
            Icon = "&#128203;"
            Category = "Test Execution (TSTM)"
            Text = "No test executions recorded today"
        }
    }

    # --- Test Plan level highlights ---
    foreach ($wi in $TestPlanItems) {
        $f = $wi.fields
        $changedDate = $null
        if ($f.'System.ChangedDate') {
            $changedDate = (Get-Date $f.'System.ChangedDate').Date
        }
        if ($changedDate -eq $today) {
            $planTitle = [System.Net.WebUtility]::HtmlEncode($f.'System.Title')
            $highlights += @{
                Icon = "&#128196;"
                Category = "Test Plan"
                Text = "<strong>$planTitle</strong> (ID: $($f.'System.Id')) was updated today"
            }
        }
    }

    # --- Bug Highlights ---
    $todayBugUpdates = @()
    $newBugsToday = @()
    foreach ($wi in $Bugs) {
        $f = $wi.fields
        $changedDate = if ($f.'System.ChangedDate') { (Get-Date $f.'System.ChangedDate').Date } else { $null }
        $createdDate = if ($f.'System.CreatedDate') { (Get-Date $f.'System.CreatedDate').Date } else { $null }

        if ($createdDate -eq $today) {
            $newBugsToday += $wi
        }
        elseif ($changedDate -eq $today) {
            $todayBugUpdates += $wi
        }
    }

    if ($newBugsToday.Count -gt 0) {
        $bugTitles = ($newBugsToday | ForEach-Object {
            $t = [System.Net.WebUtility]::HtmlEncode($_.fields.'System.Title')
            $i = $_.fields.'System.Id'
            "<a href='$baseUrl/_workitems/edit/$i' style='color:#0078D4;text-decoration:none;'>$i</a> - $t"
        }) -join "<br/>&nbsp;&nbsp;&nbsp;&nbsp;"
        $highlights += @{
            Icon = "&#128308;"
            Category = "Bugs"
            Text = "<strong>$($newBugsToday.Count) new bug(s) raised today:</strong><br/>&nbsp;&nbsp;&nbsp;&nbsp;$bugTitles"
        }
    }

    if ($todayBugUpdates.Count -gt 0) {
        $stateUpdates = ($todayBugUpdates | ForEach-Object {
            $t = [System.Net.WebUtility]::HtmlEncode($_.fields.'System.Title')
            $i = $_.fields.'System.Id'
            $s = $_.fields.'System.State'
            "<a href='$baseUrl/_workitems/edit/$i' style='color:#0078D4;text-decoration:none;'>$i</a> - $t [<strong>$s</strong>]"
        }) -join "<br/>&nbsp;&nbsp;&nbsp;&nbsp;"
        $highlights += @{
            Icon = "&#128260;"
            Category = "Bugs"
            Text = "<strong>$($todayBugUpdates.Count) bug(s) updated today:</strong><br/>&nbsp;&nbsp;&nbsp;&nbsp;$stateUpdates"
        }
    }

    if ($newBugsToday.Count -eq 0 -and $todayBugUpdates.Count -eq 0) {
        $highlights += @{
            Icon = "&#128155;"
            Category = "Bugs"
            Text = "No bug updates today"
        }
    }

    # --- Also check for today's comments on bugs ---
    $bugsWithNewComments = @()
    foreach ($wi in $Bugs) {
        $id = $wi.fields.'System.Id'
        try {
            $commentsUri = "https://dev.azure.com/$org/$project/_apis/wit/workItems/$id/comments?`$top=1&order=desc&api-version=7.1-preview.4"
            $commentsResp = Invoke-ADOApi -Uri $commentsUri -Headers $Headers
            if ($commentsResp.comments -and @($commentsResp.comments).Count -gt 0) {
                $commentDate = (Get-Date @($commentsResp.comments)[0].createdDate).Date
                if ($commentDate -eq $today) {
                    $bugsWithNewComments += $id
                }
            }
        } catch { }
    }
    if ($bugsWithNewComments.Count -gt 0) {
        $commentLinks = ($bugsWithNewComments | ForEach-Object {
            "<a href='$baseUrl/_workitems/edit/$_' style='color:#0078D4;text-decoration:none;'>$_</a>"
        }) -join ", "
        $highlights += @{
            Icon = "&#128172;"
            Category = "Bugs"
            Text = "New comments added today on bug(s): $commentLinks"
        }
    }

    # --- Build HTML ---
    $highlightItems = foreach ($h in $highlights) {
        @"
        <div style="margin:4px 0;font-size:13px;color:#333;font-family:Segoe UI,Arial,sans-serif;">$($h.Icon) <strong>$($h.Category):</strong> $($h.Text)</div>
"@
    }

    return @"
    <div style="margin:4px 0;padding:4px 0;">
        $($highlightItems -join "`n")
    </div>
"@
}

function Get-TargetDateRagHtml {
    param(
        [string]$TargetDateStr,
        [string]$Label,
        [int]$AmberDays,
        [int]$GreenDays,
        [string]$Override = 'Auto',
        [string]$Reason = ''
    )

    if ([string]::IsNullOrWhiteSpace($TargetDateStr)) {
        return ""
    }

    $targetDate = [datetime]::ParseExact($TargetDateStr, 'yyyy-MM-dd', $null)
    $today = (Get-Date).Date
    $daysRemaining = ($targetDate - $today).Days

    if ($daysRemaining -lt 0) {
        $daysText = "$([Math]::Abs($daysRemaining)) day(s) overdue"
    } else {
        $daysText = "$daysRemaining day(s) remaining"
    }

    # RAG logic — manual override takes priority
    $effectiveRag = $Override
    if ([string]::IsNullOrWhiteSpace($effectiveRag) -or $effectiveRag -eq 'Auto') {
        if ($daysRemaining -lt 0) {
            $effectiveRag = 'Red'
        } elseif ($daysRemaining -le $AmberDays) {
            $effectiveRag = 'Amber'
        } else {
            $effectiveRag = 'Green'
        }
    }

    switch ($effectiveRag) {
        'Red' {
            $ragColor  = '#D32F2F'
            $ragBg     = '#FFEBEE'
            $ragBorder = '#D32F2F'
            $ragLabel  = if ($daysRemaining -lt 0) { 'OVERDUE' } else { 'BLOCKED' }
            $ragIcon   = '&#128308;'
        }
        'Amber' {
            $ragColor  = '#F57C00'
            $ragBg     = '#FFF3E0'
            $ragBorder = '#F57C00'
            $ragLabel  = 'AT RISK'
            $ragIcon   = '&#128992;'
        }
        default {
            $ragColor  = '#2E7D32'
            $ragBg     = '#E8F5E9'
            $ragBorder = '#2E7D32'
            $ragLabel  = 'ON TRACK'
            $ragIcon   = '&#128994;'
        }
    }

    # Build reason line if provided
    $reasonHtml = ''
    if (-not [string]::IsNullOrWhiteSpace($Reason)) {
        $safeReason = [System.Net.WebUtility]::HtmlEncode($Reason)
        $reasonHtml = "<br/><span style='font-size:12px;color:$ragColor;font-style:italic;'>Reason: $safeReason</span>"
    }

    $formattedDate = $targetDate.ToString('dd MMM yyyy')

    return @"
    <div style="margin:16px 0 30px 0;">
        <table cellpadding="0" cellspacing="0" border="0" style="margin:0 0 2px 0;"><tr><td style="font-family:Segoe UI,Arial,sans-serif;color:#0078D4;font-size:15px;font-weight:bold;line-height:1;padding:0 0 0 0;border-bottom:2px solid #0078D4;">Target Date:</td></tr></table>
        <div style="margin:12px 0;padding:16px 20px;background:$ragBg;border-left:5px solid $ragBorder;border-radius:4px;font-family:Segoe UI,Arial,sans-serif;">
            <table cellpadding="0" cellspacing="0" border="0" style="width:100%;">
                <tr>
                    <td style="vertical-align:middle;">
                        <span style="font-size:14px;color:#333;"><strong>$Label</strong></span><br/>
                        <span style="font-size:22px;font-weight:bold;color:$ragColor;">$formattedDate</span><br/>
                        <span style="font-size:13px;color:#555;">$daysText</span>$reasonHtml
                    </td>
                    <td style="text-align:right;vertical-align:middle;width:140px;">
                        <span style="font-size:28px;">$ragIcon</span><br/>
                        <span style="display:inline-block;margin-top:4px;padding:4px 14px;background:$ragColor;color:white;border-radius:4px;font-size:13px;font-weight:bold;letter-spacing:1px;">$ragLabel</span>
                    </td>
                </tr>
            </table>
        </div>
    </div>
"@
}

#region --- Main Execution ---
Write-Host "=== ADO Report Generator ===" -ForegroundColor Cyan
Write-Host "Timestamp: $(Get-Date -Format 'yyyy-MM-dd HH:mm:ss')"
Write-Host ""

# Step 1: Query Bug data
Write-Host "Querying Bug data..." -ForegroundColor Yellow
[array]$bugs = @(Get-QueryResults -QueryId $bugQueryId -Headers $headers)
Write-Host "  Found $($bugs.Count) bugs." -ForegroundColor Green

# Step 2: Query Test Plan donut from Test Points API (CR144)
Write-Host "Querying CR144 Test Plan (Plan=$testPlanId, Suite=$testSuiteId)..." -ForegroundColor Yellow
[array]$testPoints = @(Get-TestPointResults -PlanId $testPlanId -SuiteId $testSuiteId -Headers $headers)
Write-Host "  Found $($testPoints.Count) CR144 test points." -ForegroundColor Green

# Step 2b: Query TSTM Test Plan donut from Test Points API
Write-Host "Querying TSTM Test Plan (Plan=$tstmTestPlanId, Suite=$tstmTestSuiteId)..." -ForegroundColor Yellow
[array]$tstmTestPoints = @(Get-TestPointResults -PlanId $tstmTestPlanId -SuiteId $tstmTestSuiteId -Headers $headers)
Write-Host "  Found $($tstmTestPoints.Count) TSTM test points." -ForegroundColor Green

# Step 3: Query Test Plan items from shared query (Report-Testplan)
Write-Host "Querying Test Plan items from shared query..." -ForegroundColor Yellow
[array]$testItems = @(Get-QueryResults -QueryId $testQueryId -Headers $headers)
Write-Host "  Found $($testItems.Count) test items." -ForegroundColor Green

# Step 4: Build HTML email body
Write-Host "Building HTML report..." -ForegroundColor Yellow

# Generate today's highlights
Write-Host "Generating today's highlights..." -ForegroundColor Yellow
$todaysHighlights = Get-TodaysHighlights -TestPoints $testPoints -TstmTestPoints $tstmTestPoints -TestPlanItems $testItems -Bugs $bugs -Headers $headers

$cr144Chart = Get-TestOutcomeDonutChart -TestPoints $testPoints -ChartTitle "CR144 Test Cases Stats"
$tstmChart = Get-TestOutcomeDonutChart -TestPoints $tstmTestPoints -ChartTitle "TSTM Suite Test Cases Stats"
$testTable = Format-TestPlanItemsToHtml -WorkItems $testItems -Headers $headers
$bugChart = Get-DonutChart -WorkItems $bugs -ChartTitle "Bug Stats" -CenterLabel "Resolved"
$bugTable = Format-WorkItemsToHtml -WorkItems $bugs -TableTitle "Bug Report" -AccentColor "#D32F2F" -Headers $headers
$targetDateHtml = Get-TargetDateRagHtml -TargetDateStr $targetDateStr -Label $targetDateLabel -AmberDays $amberThresholdDays -GreenDays $greenThresholdDays -Override $ragOverride -Reason $ragReasonText

$htmlBody = @"
<!DOCTYPE html>
<html>
<head><meta charset="utf-8"></head>
<body style="font-family:Segoe UI,Arial,sans-serif;color:#333;margin:0;padding:20px;background:#ffffff;">
    <div style="max-width:960px;margin:0 auto;">
        <div style="background:linear-gradient(135deg,#0078D4,#005A9E);padding:20px 24px;border-radius:8px 8px 0 0;">
            <h1 style="color:white;margin:0;font-size:22px;">Test Execution Progress &amp; Bug Report</h1>
        </div>

        <div style="padding:16px 24px;background:#ffffff;border:1px solid #e0e0e0;border-top:none;border-radius:0 0 8px 8px;">
            <p style="font-size:15px;color:#333;margin:0 0 16px 0;">Hi All,<br/><br/>Please find below the latest testing summary for E2open CRs in the E2E test environment.</p>

            <!-- ===== Topic 1: Today's Highlights ===== -->
            <div style="margin:16px 0 30px 0;">
                <table cellpadding="0" cellspacing="0" border="0" style="margin:0 0 2px 0;"><tr><td style="font-family:Segoe UI,Arial,sans-serif;color:#0078D4;font-size:15px;font-weight:bold;line-height:1;padding:0 0 0 0;border-bottom:2px solid #0078D4;">Key Highlights:</td></tr></table>
                $todaysHighlights
            </div>

            <!-- ===== Topic 2: Test Plan ===== -->
            <div style="margin:16px 0 30px 0;">
                <table cellpadding="0" cellspacing="0" border="0" style="margin:0 0 2px 0;"><tr><td style="font-family:Segoe UI,Arial,sans-serif;color:#0078D4;font-size:15px;font-weight:bold;line-height:1;padding:0 0 0 0;border-bottom:2px solid #0078D4;">Test Plan Items &amp; Test Cases Progress:</td></tr></table>
                $testTable
                <table cellpadding="0" cellspacing="0" border="0" style="width:100%;margin-top:20px;">
                    <tr>
                        <td style="width:50%;vertical-align:top;padding-right:10px;">$cr144Chart</td>
                        <td style="width:50%;vertical-align:top;padding-left:10px;">$tstmChart</td>
                    </tr>
                </table>
            </div>

            <!-- ===== Topic 3: Bug Report ===== -->
            <div style="margin:16px 0 30px 0;">
                <table cellpadding="0" cellspacing="0" border="0" style="margin:0 0 2px 0;"><tr><td style="font-family:Segoe UI,Arial,sans-serif;color:#0078D4;font-size:15px;font-weight:bold;line-height:1;padding:0 0 0 0;border-bottom:2px solid #0078D4;">Overall Bug Report:</td></tr></table>
                $bugTable
                <div style="margin-top:20px;">
                    $bugChart
                </div>
            </div>

            <!-- ===== Topic 4: Target Date RAG Status ===== -->
            $targetDateHtml
        </div>

        <div style="padding:12px 24px;text-align:center;color:#999;font-size:12px;">
            Automated report from Azure DevOps | <a href="$baseUrl" style="color:#0078D4;">Open Project</a>
        </div>
    </div>
</body>
</html>
"@

# Step 4: Save report as HTML file first
$reportDir = Join-Path $scriptDir "reports"
if (-not (Test-Path $reportDir)) {
    New-Item -Path $reportDir -ItemType Directory -Force | Out-Null
}
$reportFile = Join-Path $reportDir "ADO_Report_$(Get-Date -Format 'yyyyMMdd_HHmmss').html"
$htmlBody | Out-File -FilePath $reportFile -Encoding UTF8
Write-Host "Report saved to: $reportFile" -ForegroundColor Green

if ($PreviewOnly) {
    Write-Host "PREVIEW_PATH=$reportFile" -ForegroundColor Cyan
    Write-Host "Preview mode - email not sent." -ForegroundColor Yellow
} else {
    # Step 5: Send Email via Outlook (uses your logged-in session - no passwords needed)
    Write-Host "Sending email via Outlook..." -ForegroundColor Yellow
    try {
        $outlook = New-Object -ComObject Outlook.Application
        $mail = $outlook.CreateItem(0)
        $mail.Subject = $subject
        $mail.HTMLBody = $htmlBody
        foreach ($recipient in $recipients) {
            $mail.Recipients.Add($recipient) | Out-Null
        }
        $mail.Recipients.ResolveAll() | Out-Null
        $mail.Send()

        # Release COM objects
        [System.Runtime.InteropServices.Marshal]::ReleaseComObject($mail) | Out-Null
        [System.Runtime.InteropServices.Marshal]::ReleaseComObject($outlook) | Out-Null

        Write-Host "Email sent successfully to: $($recipients -join ', ')" -ForegroundColor Green
    }
    catch {
        Write-Warning "Outlook send failed: $($_.Exception.Message)"
        Write-Host "Report is still available at: $reportFile" -ForegroundColor Yellow
        Write-Host "Tip: Make sure Outlook is open and signed in." -ForegroundColor Cyan
    }
}

Write-Host ""
Write-Host "=== Report Complete ===" -ForegroundColor Cyan
#endregion
