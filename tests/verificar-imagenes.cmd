@echo off
REM ETAPA A (imagenes de productos): pruebas, navegador y verificador. No carga productos ni modifica nutrivida_db.
setlocal
chcp 65001 >nul
cd /d "%~dp0.."
set "OUT=docs\evidencias\verificacion-imagenes"
if not exist "%OUT%" mkdir "%OUT%"
echo [1/5] Pruebas de imagenes ...
call npm.cmd run test:imagenes > "%OUT%\imagenes-test.log" 2>&1
echo [2/5] Suite completa ...
call npm.cmd test > "%OUT%\npm-test.log" 2>&1
>> "%OUT%\npm-test.log" echo EXIT=%ERRORLEVEL%
echo [3/5] Navegador: imagenes del catalogo ...
call npm.cmd run test:browser:imagenes > "%OUT%\navegador-imagenes.log" 2>&1
echo [4/5] Navegador: regresion FASES 4-8 ...
call npm.cmd run test:browser:fase5 > "%OUT%\navegador-fase4-5.log" 2>&1
call npm.cmd run test:browser:fase6-8 > "%OUT%\navegador-fase6-8.log" 2>&1
echo [5/5] Verificador de importacion (solo lectura) ...
call npm.cmd run db:verificar-importacion > "%OUT%\verificar-importacion.log" 2>&1
>> "%OUT%\verificar-importacion.log" echo EXIT=%ERRORLEVEL%
echo.
echo Listo. Resultados en %OUT%. Reinicia el servidor (Ctrl+C y npm.cmd start) para ver los cambios.
pause
