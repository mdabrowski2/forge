@echo off
rem forge dev-mode launcher (Smart App Control blocks the packaged exe)
cd /d "%~dp0"
"C:\Users\mateu\AppData\Roaming\npm\node_modules\bun\bin\bun.exe" run electron:start