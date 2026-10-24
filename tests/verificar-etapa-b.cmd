@echo off
REM Cierre ETAPA B: auditoria de SOLO LECTURA del catalogo real, IA con Ollama real y regresion.
REM No modifica productos, precios ni inventario. No vuelve a cargar el PDF.
setlocal
chcp 65001 >nul
cd /d "%~dp0.."
set "OUT=docs\evidencias\cierre-etapa-b"
if not exist "%OUT%" mkdir "%OUT%"
echo [1/5] Auditoria del catalogo real (A/B/C, candidatos IA, imagenes, integridad historica) ...
call npm.cmd run catalogo:auditar > "%OUT%\auditoria-catalogo.log" 2>&1
>> "%OUT%\auditoria-catalogo.log" echo EXIT=%ERRORLEVEL%
echo [2/5] NutriVida AI con productos y Ollama REALES (escenarios A-L, sin escrituras) ...
call npm.cmd run ia:productos-reales > "%OUT%\ia-productos-reales.log" 2>&1
>> "%OUT%\ia-productos-reales.log" echo EXIT=%ERRORLEVEL%
echo [3/5] Verificador de importacion ...
call npm.cmd run db:verificar-importacion > "%OUT%\verificar-importacion.log" 2>&1
>> "%OUT%\verificar-importacion.log" echo EXIT=%ERRORLEVEL%
echo [4/5] Suite completa (npm test) ...
call npm.cmd test > "%OUT%\npm-test.log" 2>&1
>> "%OUT%\npm-test.log" echo EXIT=%ERRORLEVEL%
echo [5/5] Navegador: imagenes y FASES 4-8 ...
call npm.cmd run test:browser:imagenes > "%OUT%\navegador-imagenes.log" 2>&1
call npm.cmd run test:browser:fase5 > "%OUT%\navegador-fase4-5.log" 2>&1
call npm.cmd run test:browser:fase6-8 > "%OUT%\navegador-fase6-8.log" 2>&1
echo.
echo Listo. Resultados en %OUT%. Avisale a Claude.
pause
