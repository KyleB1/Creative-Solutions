@echo off
setlocal
cd /d "%~dp0"

echo Starting Creative Solutions server on http://localhost:3000
node server.js

endlocal
