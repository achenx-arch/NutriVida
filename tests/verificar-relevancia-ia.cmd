@echo off
REM Verificacion REAL de la relevancia de candidatos de NutriVida AI (PostgreSQL y Ollama locales).
REM SOLO LECTURA sobre nutrivida_db: no modifica productos, precios, inventario, pedidos, conversaciones
REM ni auditoria. data/db.json se compara por SHA-256 antes y despues. Las pruebas usan nutrivida_test_db.
setlocal
chcp 65001 >nul
cd /d "%~dp0.."
set "OUT=docs\evidencias\relevancia-ia-implementada"
if not exist "%OUT%" mkdir "%OUT%"
set "RES=%OUT%\resumen.log"
> "%RES%" echo RELEVANCIA IA - %DATE% %TIME%
certutil -hashfile data\db.json SHA256 > "%OUT%\db-json-antes.log" 2>&1

echo [1/9] Diagnostico de relevancia con el algoritmo implementado (solo lectura) ...
node database\scripts\diagnosticar-relevancia-ia.js > "%OUT%\diagnostico-relevancia.txt" 2>&1
>> "%RES%" echo diagnostico-relevancia EXIT=%ERRORLEVEL%
node database\scripts\diagnosticar-relevancia-ia.js --json > "%OUT%\diagnostico-relevancia.json" 2>&1
echo [2/9] Pruebas de relevancia ...
call npm.cmd run test:ia-relevancia > "%OUT%\ia-relevancia.log" 2>&1
>> "%RES%" echo ia-relevancia EXIT=%ERRORLEVEL%
echo [3/9] Suite completa (npm test) ...
call npm.cmd test > "%OUT%\npm-test.log" 2>&1
>> "%RES%" echo npm-test EXIT=%ERRORLEVEL%
echo [4/9] NutriVida AI con catalogo y Ollama REALES (incluye R1-R8, sin escrituras) ...
call npm.cmd run ia:productos-reales > "%OUT%\ia-productos-reales.log" 2>&1
>> "%RES%" echo ia-productos-reales EXIT=%ERRORLEVEL%
echo [5/9] Navegador: tarjetas IA ...
call npm.cmd run test:browser:ia-tarjetas > "%OUT%\navegador-ia-tarjetas.log" 2>&1
>> "%RES%" echo navegador-ia-tarjetas EXIT=%ERRORLEVEL%
echo [6/9] Navegador: FASES 6-8 (FASE 8 con Ollama real) ...
call npm.cmd run test:browser:fase6-8 > "%OUT%\navegador-fase6-8.log" 2>&1
>> "%RES%" echo navegador-fase6-8 EXIT=%ERRORLEVEL%
echo [7/9] Auditoria del catalogo real (solo lectura) ...
call npm.cmd run catalogo:auditar > "%OUT%\auditoria-catalogo.log" 2>&1
>> "%RES%" echo auditoria-catalogo EXIT=%ERRORLEVEL%
echo [8/9] Verificador de importacion e integridad historica ...
call npm.cmd run db:verificar-importacion > "%OUT%\verificar-importacion.log" 2>&1
>> "%RES%" echo verificar-importacion EXIT=%ERRORLEVEL%
echo [9/9] data/db.json sin cambios ...
certutil -hashfile data\db.json SHA256 > "%OUT%\db-json-despues.log" 2>&1
fc /b "%OUT%\db-json-antes.log" "%OUT%\db-json-despues.log" >nul
>> "%RES%" echo db-json-sin-cambios EXIT=%ERRORLEVEL%
echo.
type "%RES%"
echo.
echo Listo. Resultados en %OUT%. Avisale a Claude.
pause
