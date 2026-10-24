@echo off
REM Roles + diagnostico IMPORTACION_CONFLICTO. Todo de SOLO LECTURA sobre nutrivida_db.
REM NO ejecuta usuario:asignar-rol. Las salidas son .log (ignoradas por git: contienen correos).
setlocal
chcp 65001 >nul
cd /d "%~dp0.."
set "OUT=docs\evidencias\verificacion-roles"
if not exist "%OUT%" mkdir "%OUT%"

echo [1/4] Pruebas de roles ...
call npm.cmd run test:roles > "%OUT%\roles-test.log" 2>&1
>> "%OUT%\roles-test.log" echo EXIT=%ERRORLEVEL%

echo [2/4] Suite completa (npm test) ...
call npm.cmd test > "%OUT%\npm-test.log" 2>&1
>> "%OUT%\npm-test.log" echo EXIT=%ERRORLEVEL%

echo [3/4] Listado de usuarios (solo lectura) ...
call npm.cmd run usuario:listar > "%OUT%\usuarios.log" 2>&1

echo [4/4] Diagnostico de IMPORTACION_CONFLICTO (solo lectura) ...
node database\scripts\diagnosticar-importacion.js > "%OUT%\diagnostico-importacion.log" 2>&1

echo.
echo Listo. Resultados en %OUT%. Avisale a Claude.
pause
