<#
.SYNOPSIS
    Registers a Windows Scheduled Task to run the ADO report daily.
.DESCRIPTION
    Creates a scheduled task that runs Send-ADOReport.ps1 at the configured time.
    Run this script once with elevated (Admin) privileges.
#>

[CmdletBinding()]
param(
    [string]$TaskName = "ADO_DailyReport",
    [string]$TriggerTime = "09:00",
    [string]$ScriptPath = (Join-Path $PSScriptRoot "Send-ADOReport.ps1")
)

$ErrorActionPreference = "Stop"

# Verify script exists
if (-not (Test-Path $ScriptPath)) {
    throw "Script not found: $ScriptPath"
}

# Build the action
$action = New-ScheduledTaskAction `
    -Execute "powershell.exe" `
    -Argument "-NoProfile -ExecutionPolicy Bypass -File `"$ScriptPath`"" `
    -WorkingDirectory $PSScriptRoot

# Build the trigger (daily at specified time)
$trigger = New-ScheduledTaskTrigger -Daily -At $TriggerTime

# Settings: run even if not logged in, don't stop on battery
$settings = New-ScheduledTaskSettingsSet `
    -AllowStartIfOnBatteries `
    -DontStopIfGoingOnBatteries `
    -StartWhenAvailable `
    -RunOnlyIfNetworkAvailable

# Check if task already exists
$existingTask = Get-ScheduledTask -TaskName $TaskName -ErrorAction SilentlyContinue
if ($existingTask) {
    Write-Host "Task '$TaskName' already exists. Updating..." -ForegroundColor Yellow
    Set-ScheduledTask -TaskName $TaskName -Action $action -Trigger $trigger -Settings $settings
    Write-Host "Task updated successfully." -ForegroundColor Green
}
else {
    Register-ScheduledTask `
        -TaskName $TaskName `
        -Action $action `
        -Trigger $trigger `
        -Settings $settings `
        -Description "Sends automated ADO Bug & Test Execution report email daily." `
        -RunLevel Highest

    Write-Host "Scheduled task '$TaskName' created successfully." -ForegroundColor Green
}

Write-Host ""
Write-Host "Task Details:" -ForegroundColor Cyan
Write-Host "  Name:      $TaskName"
Write-Host "  Schedule:  Daily at $TriggerTime"
Write-Host "  Script:    $ScriptPath"
Write-Host ""
Write-Host "To run immediately:  Start-ScheduledTask -TaskName '$TaskName'" -ForegroundColor Yellow
Write-Host "To remove:           Unregister-ScheduledTask -TaskName '$TaskName'" -ForegroundColor Yellow
