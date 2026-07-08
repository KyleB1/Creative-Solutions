@echo off
setlocal
cd /d "%~dp0"

echo Starting Creative Solutions server on http://localhost:4000
node server.js

endlocal
