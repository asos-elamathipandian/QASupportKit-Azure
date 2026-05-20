<#
.SYNOPSIS
    Quick setup: set your PAT token and run the report immediately.
.EXAMPLE
    .\Run-Report.ps1 -Pat "your-ado-pat-token"
#>

[CmdletBinding()]
param(
    [Parameter(Mandatory = $false)]
    [string]$Pat,
    [switch]$PreviewOnly,
    [string]$TargetDate,
    [ValidateSet('Auto','Red','Amber','Green')]
    [string]$RagStatus,
    [string]$RagReason
)

$ErrorActionPreference = "Stop"

# Set PAT if provided
if (-not [string]::IsNullOrWhiteSpace($Pat)) {
    [System.Environment]::SetEnvironmentVariable("ADO_PAT_TOKEN", $Pat, "User")
    $env:ADO_PAT_TOKEN = $Pat
    Write-Host "PAT token saved to user environment variable." -ForegroundColor Green
}

# Verify PAT exists
$existingPat = [System.Environment]::GetEnvironmentVariable("ADO_PAT_TOKEN", "User")
if ([string]::IsNullOrWhiteSpace($existingPat) -and [string]::IsNullOrWhiteSpace($env:ADO_PAT_TOKEN)) {
    Write-Error "No PAT token found. Run with: .\Run-Report.ps1 -Pat 'your-token'"
    return
}

# Run the report
$scriptPath = Join-Path $PSScriptRoot "Send-ADOReport.ps1"
$reportArgs = @{}
if ($PreviewOnly) { $reportArgs['PreviewOnly'] = $true }
if ($TargetDate)  { $reportArgs['TargetDate'] = $TargetDate }
if ($RagStatus)   { $reportArgs['RagStatus'] = $RagStatus }
if ($RagReason)   { $reportArgs['RagReason'] = $RagReason }
& $scriptPath @reportArgs
