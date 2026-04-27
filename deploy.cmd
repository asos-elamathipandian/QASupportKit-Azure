@echo off
echo Installing npm packages...
cd %DEPLOYMENT_TARGET%
call npm install --production
echo Done.
