@echo off
REM Diagnostico de SOLO LECTURA de la relevancia de candidatos de NutriVida AI (propuesta no implementada).
REM Solo SELECT en una transaccion READ ONLY. No llama a Ollama. No modifica productos, inventario,
REM auditoria, conversaciones ni data/db.json (se compara su SHA-256 antes y despues).
setlocal
chcp 65001 >nul
cd /d "%~dp0.."
set "OUT=docs\evidencias\relevancia-ia"
if not exist "%OUT%" mkdir "%OUT%"
certutil -hashfile data\db.json SHA256 > "%OUT%\db-json-antes.log" 2>&1
echo [1/2] Informe legible ...
node database\scripts\diagnosticar-relevancia-ia.js > "%OUT%\diagnostico-relevancia.txt" 2>&1
>> "%OUT%\diagnostico-relevancia.txt" echo EXIT=%ERRORLEVEL%
echo [2/2] Informe JSON ...
node database\scripts\diagnosticar-relevancia-ia.js --json > "%OUT%\diagnostico-relevancia.json" 2>&1
certutil -hashfile data\db.json SHA256 > "%OUT%\db-json-despues.log" 2>&1
fc /b "%OUT%\db-json-antes.log" "%OUT%\db-json-despues.log" >nul
> "%OUT%\db-json-sin-cambios.log" echo db-json-sin-cambios EXIT=%ERRORLEVEL%
echo.
echo Listo. Resultados en %OUT%. Avisale a Claude.
pause
