@echo off
REM FASE 9A: verificacion real (PostgreSQL y Ollama locales). Las pruebas usan nutrivida_test_db con esquemas
REM temporales y cuentas SINTETICAS. No escribe en nutrivida_db, no usa tu cuenta ni cambia tus consentimientos.
REM NO aplica la migracion 007 a nutrivida_db (eso requiere tu aprobacion: npm run db:migrar).
setlocal
chcp 65001 >nul
cd /d "%~dp0.."
set "OUT=docs\evidencias\fase9a"
if not exist "%OUT%" mkdir "%OUT%"
set "RES=%OUT%\resumen.log"
> "%RES%" echo FASE 9A - %DATE% %TIME%
certutil -hashfile data\db.json SHA256 > "%OUT%\db-json-antes.log" 2>&1

echo [1-5/10] Migracion 007 en esquema aislado, consentimientos, seguridad, auditoria y minimizacion de contexto ...
call npm.cmd run test:fase9a > "%OUT%\fase9a-test.log" 2>&1
>> "%RES%" echo fase9a-migracion-consentimientos-seguridad-auditoria-contexto EXIT=%ERRORLEVEL%
echo [6/10] Suite completa (npm test) ...
call npm.cmd test > "%OUT%\npm-test.log" 2>&1
>> "%RES%" echo npm-test EXIT=%ERRORLEVEL%
echo [7/10] Regresion de relevancia y respaldo (pruebas + catalogo y Ollama reales, solo lectura) ...
call npm.cmd run test:ia-relevancia > "%OUT%\ia-relevancia.log" 2>&1
>> "%RES%" echo ia-relevancia EXIT=%ERRORLEVEL%
call npm.cmd run ia:productos-reales > "%OUT%\ia-productos-reales.log" 2>&1
>> "%RES%" echo ia-productos-reales EXIT=%ERRORLEVEL%
echo [8/10] Navegador: consentimientos, tarjetas y FASES 6-8 ...
call npm.cmd run test:browser:fase9a > "%OUT%\navegador-fase9a.log" 2>&1
>> "%RES%" echo navegador-fase9a EXIT=%ERRORLEVEL%
call npm.cmd run test:browser:ia-tarjetas > "%OUT%\navegador-ia-tarjetas.log" 2>&1
>> "%RES%" echo navegador-ia-tarjetas EXIT=%ERRORLEVEL%
call npm.cmd run test:browser:fase6-8 > "%OUT%\navegador-fase6-8.log" 2>&1
>> "%RES%" echo navegador-fase6-8 EXIT=%ERRORLEVEL%
echo [9/10] Ollama real con consentimientos (cliente sintetico, esquema temporal) ...
call npm.cmd run test:fase9a:ollama > "%OUT%\fase9a-ollama-real.log" 2>&1
>> "%RES%" echo fase9a-ollama-real EXIT=%ERRORLEVEL%
echo [10/10] Integridad historica, conversaciones heredadas y data/db.json ...
call npm.cmd run db:verificar-importacion > "%OUT%\verificar-importacion.log" 2>&1
>> "%RES%" echo verificar-importacion EXIT=%ERRORLEVEL%
node tests\conversaciones-heredadas.js > "%OUT%\conversaciones-heredadas.log" 2>&1
>> "%RES%" echo conversaciones-heredadas EXIT=%ERRORLEVEL%
certutil -hashfile data\db.json SHA256 > "%OUT%\db-json-despues.log" 2>&1
fc /b "%OUT%\db-json-antes.log" "%OUT%\db-json-despues.log" >nul
>> "%RES%" echo db-json-sin-cambios EXIT=%ERRORLEVEL%
echo.
type "%RES%"
echo.
echo Listo. Resultados en %OUT% (capturas: docs\evidencias\fase9a-consentimientos-*.png). Avisale a Claude.
pause
