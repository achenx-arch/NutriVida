@echo off
REM ETAPA B: carga controlada de los 20 productos del PDF en nutrivida_db.
REM 1) instantanea  2) simulacion (ROLLBACK)  3) pausa para confirmar  4) carga (COMMIT)  5) verificacion
REM Productos INACTIVOS, precio NULL, sin inventario. Idempotente: repetirlo no duplica nada.
setlocal
chcp 65001 >nul
cd /d "%~dp0.."
set "ADMIN=achen32@gmail.com"
set "OUT=docs\evidencias\carga-catalogo-pdf"
if not exist "%OUT%" mkdir "%OUT%"

echo [1/7] Instantanea ANTES (solo lectura) ...
node database\scripts\catalogo-pdf-estado.js instantanea > "%OUT%\antes.log" 2>&1
if errorlevel 1 ( type "%OUT%\antes.log" & echo No se pudo leer PostgreSQL. Sin cambios. & pause & exit /b 1 )

echo [2/7] Simulacion completa (se revierte con ROLLBACK) ...
node database\scripts\cargar-catalogo-pdf.js --admin "%ADMIN%" > "%OUT%\simulacion.log" 2>&1
type "%OUT%\simulacion.log"
if errorlevel 1 ( echo La simulacion fallo. NO se cargo nada. & pause & exit /b 1 )

echo.
echo Revisa la simulacion. Presiona una tecla para CONFIRMAR la carga, o cierra esta ventana para cancelar.
pause >nul

echo [3/7] Carga confirmada (una sola transaccion) ...
node database\scripts\cargar-catalogo-pdf.js --admin "%ADMIN%" --confirmar > "%OUT%\carga.log" 2>&1
type "%OUT%\carga.log"
if errorlevel 1 ( echo La carga fallo: ROLLBACK completo, sin cambios. & pause & exit /b 1 )

echo [4/7] Verificacion de la carga (solo lectura) ...
node database\scripts\catalogo-pdf-estado.js verificar "%OUT%\antes.log" > "%OUT%\verificacion.log" 2>&1
>> "%OUT%\verificacion.log" echo EXIT=%ERRORLEVEL%

echo [5/7] Integridad historica (verificador de importacion) ...
call npm.cmd run db:verificar-importacion > "%OUT%\verificar-importacion.log" 2>&1
>> "%OUT%\verificar-importacion.log" echo EXIT=%ERRORLEVEL%

echo [6/7] Pruebas: suite completa, imagenes y catalogo PDF ...
call npm.cmd test > "%OUT%\npm-test.log" 2>&1
>> "%OUT%\npm-test.log" echo EXIT=%ERRORLEVEL%

echo [7/7] Navegador: imagenes y FASES 4-8 ...
call npm.cmd run test:browser:imagenes > "%OUT%\navegador-imagenes.log" 2>&1
call npm.cmd run test:browser:fase5 > "%OUT%\navegador-fase4-5.log" 2>&1
call npm.cmd run test:browser:fase6-8 > "%OUT%\navegador-fase6-8.log" 2>&1

echo.
echo Listo. Resultados en %OUT%. Reinicia el servidor (Ctrl+C y npm.cmd start) y avisale a Claude.
pause
