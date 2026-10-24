@echo off
REM VERIFICACION FINAL DE CIERRE DE ETAPA B (unico script).
REM SOLO LECTURA sobre nutrivida_db: no carga productos, no cambia precios, inventario, estados,
REM conversaciones ni auditoria. No modifica data/db.json (se compara su SHA-256 antes y despues).
REM Las pruebas automatizadas usan nutrivida_test_db con esquemas temporales.
setlocal
chcp 65001 >nul
cd /d "%~dp0.."
set "OUT=docs\evidencias\cierre-final-etapa-b"
if not exist "%OUT%" mkdir "%OUT%"
set "RES=%OUT%\resumen.log"
> "%RES%" echo CIERRE ETAPA B - %DATE% %TIME%
certutil -hashfile data\db.json SHA256 > "%OUT%\db-json-antes.log" 2>&1

echo [1/10] Verificador de importacion e integridad historica ...
call npm.cmd run db:verificar-importacion > "%OUT%\verificar-importacion.log" 2>&1
>> "%RES%" echo verificar-importacion EXIT=%ERRORLEVEL%
echo [2/10] Las 4 conversaciones heredadas ...
node tests\conversaciones-heredadas.js > "%OUT%\conversaciones-heredadas.log" 2>&1
>> "%RES%" echo conversaciones-heredadas EXIT=%ERRORLEVEL%
echo [3/10] Auditoria del catalogo real ...
call npm.cmd run catalogo:auditar > "%OUT%\auditoria-catalogo.log" 2>&1
>> "%RES%" echo auditoria-catalogo EXIT=%ERRORLEVEL%
echo [4/10] Suite completa (npm test) ...
call npm.cmd test > "%OUT%\npm-test.log" 2>&1
>> "%RES%" echo npm-test EXIT=%ERRORLEVEL%
echo [5/10] Tarjetas y flujo medico ...
call npm.cmd run test:ia-tarjetas > "%OUT%\ia-tarjetas.log" 2>&1
>> "%RES%" echo ia-tarjetas EXIT=%ERRORLEVEL%
echo [6/10] NutriVida AI con catalogo y Ollama REALES (sin escrituras) ...
call npm.cmd run ia:productos-reales > "%OUT%\ia-productos-reales.log" 2>&1
>> "%RES%" echo ia-productos-reales EXIT=%ERRORLEVEL%
echo [7/10] Navegador: tarjetas IA ...
call npm.cmd run test:browser:ia-tarjetas > "%OUT%\navegador-ia-tarjetas.log" 2>&1
>> "%RES%" echo navegador-ia-tarjetas EXIT=%ERRORLEVEL%
echo [8/10] Navegador: imagenes ...
call npm.cmd run test:browser:imagenes > "%OUT%\navegador-imagenes.log" 2>&1
>> "%RES%" echo navegador-imagenes EXIT=%ERRORLEVEL%
echo [9/10] Navegador: FASES 4-5 y FASES 6-8 (FASE 8 con Ollama real) ...
call npm.cmd run test:browser:fase5 > "%OUT%\navegador-fase4-5.log" 2>&1
>> "%RES%" echo navegador-fase4-5 EXIT=%ERRORLEVEL%
call npm.cmd run test:browser:fase6-8 > "%OUT%\navegador-fase6-8.log" 2>&1
>> "%RES%" echo navegador-fase6-8 EXIT=%ERRORLEVEL%
echo [10/10] Verificador de importacion (repeticion final) y data/db.json ...
call npm.cmd run db:verificar-importacion > "%OUT%\verificar-importacion-final.log" 2>&1
>> "%RES%" echo verificar-importacion-final EXIT=%ERRORLEVEL%
certutil -hashfile data\db.json SHA256 > "%OUT%\db-json-despues.log" 2>&1
fc /b "%OUT%\db-json-antes.log" "%OUT%\db-json-despues.log" >nul
>> "%RES%" echo db-json-sin-cambios EXIT=%ERRORLEVEL%
echo.
type "%RES%"
echo.
echo Listo. Resultados en %OUT%. Avisale a Claude.
pause
