@echo off
REM Verificacion final de las mejoras de NutriVida AI (tarjetas de productos + flujo medico sin Ollama).
REM SOLO LECTURA sobre nutrivida_db: no carga productos, no cambia precios, inventario ni estados.
REM Las pruebas automatizadas usan nutrivida_test_db con esquemas temporales.
setlocal
chcp 65001 >nul
cd /d "%~dp0.."
set "OUT=docs\evidencias\mejoras-ia"
if not exist "%OUT%" mkdir "%OUT%"
echo [1/7] Suite completa (npm test) ...
call npm.cmd test > "%OUT%\npm-test.log" 2>&1
>> "%OUT%\npm-test.log" echo EXIT=%ERRORLEVEL%
echo [2/7] Pruebas de tarjetas y flujo medico ...
call npm.cmd run test:ia-tarjetas > "%OUT%\ia-tarjetas.log" 2>&1
>> "%OUT%\ia-tarjetas.log" echo EXIT=%ERRORLEVEL%
echo [3/7] NutriVida AI con catalogo y Ollama REALES (incluye tarjetas resueltas en PostgreSQL, sin escrituras) ...
call npm.cmd run ia:productos-reales > "%OUT%\ia-productos-reales.log" 2>&1
>> "%OUT%\ia-productos-reales.log" echo EXIT=%ERRORLEVEL%
echo [4/7] Navegador: tarjetas IA ...
call npm.cmd run test:browser:ia-tarjetas > "%OUT%\navegador-ia-tarjetas.log" 2>&1
>> "%OUT%\navegador-ia-tarjetas.log" echo EXIT=%ERRORLEVEL%
echo [5/7] Navegador: regresion imagenes y FASES 4-8 (FASE 8 con Ollama real) ...
call npm.cmd run test:browser:imagenes > "%OUT%\navegador-imagenes.log" 2>&1
>> "%OUT%\navegador-imagenes.log" echo EXIT=%ERRORLEVEL%
call npm.cmd run test:browser:fase5 > "%OUT%\navegador-fase4-5.log" 2>&1
>> "%OUT%\navegador-fase4-5.log" echo EXIT=%ERRORLEVEL%
call npm.cmd run test:browser:fase6-8 > "%OUT%\navegador-fase6-8.log" 2>&1
>> "%OUT%\navegador-fase6-8.log" echo EXIT=%ERRORLEVEL%
echo [6/7] Auditoria del catalogo real (solo lectura) ...
call npm.cmd run catalogo:auditar > "%OUT%\auditoria-catalogo.log" 2>&1
>> "%OUT%\auditoria-catalogo.log" echo EXIT=%ERRORLEVEL%
echo [7/7] Verificador de importacion y diagnostico (solo lectura) ...
call npm.cmd run db:verificar-importacion > "%OUT%\verificar-importacion.log" 2>&1
>> "%OUT%\verificar-importacion.log" echo EXIT=%ERRORLEVEL%
node database\scripts\diagnosticar-importacion.js > "%OUT%\diagnostico-importacion.log" 2>&1
>> "%OUT%\diagnostico-importacion.log" echo EXIT=%ERRORLEVEL%
echo.
echo Listo. Resultados en %OUT% (logs y capturas docs\evidencias\ia-tarjetas-*.png). Avisale a Claude.
pause
