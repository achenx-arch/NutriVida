@echo off
REM Promocion AUTORIZADA y unica: achen32@gmail.com  CLIENTE -> ADMINISTRADOR.
REM Usa exclusivamente: npm run usuario:asignar-rol. Todo lo demas es de solo lectura.
setlocal
chcp 65001 >nul
cd /d "%~dp0.."
set "CORREO=achen32@gmail.com"
set "OUT=docs\evidencias\verificacion-roles\promocion"
if not exist "%OUT%" mkdir "%OUT%"

echo [1/8] Pruebas de roles y verificador ...
call npm.cmd run test:roles > "%OUT%\roles-test.log" 2>&1
call npm.cmd run test:verificador > "%OUT%\verificador-test.log" 2>&1

echo [2/8] Instantanea ANTES (solo lectura) ...
node tests\promocion.js instantanea "%CORREO%" > "%OUT%\antes.log" 2>&1
if errorlevel 1 ( echo No se pudo leer la cuenta. Se detiene sin cambios. & pause & exit /b 1 )

echo [3/8] Promocion: npm run usuario:asignar-rol -- "%CORREO%" ADMINISTRADOR
call npm.cmd run usuario:asignar-rol -- "%CORREO%" ADMINISTRADOR > "%OUT%\asignar-rol.log" 2>&1
type "%OUT%\asignar-rol.log"

echo [4/8] Instantanea DESPUES y comparacion ...
node tests\promocion.js instantanea "%CORREO%" > "%OUT%\despues.log" 2>&1
node tests\promocion.js comparar "%OUT%\antes.log" "%OUT%\despues.log" > "%OUT%\comparacion.log" 2>&1

echo [5/8] Usuarios (solo lectura) ...
call npm.cmd run usuario:listar > "%OUT%\usuarios.log" 2>&1

echo [6/8] Verificador de importacion (dos niveles) ...
call npm.cmd run db:verificar-importacion > "%OUT%\verificar-importacion.log" 2>&1
>> "%OUT%\verificar-importacion.log" echo EXIT=%ERRORLEVEL%

echo [7/8] Diagnostico con ventana de auditoria ...
node database\scripts\diagnosticar-importacion.js > "%OUT%\diagnostico.log" 2>&1

echo [8/8] Suite completa (npm test) ...
call npm.cmd test > "%OUT%\npm-test.log" 2>&1
>> "%OUT%\npm-test.log" echo EXIT=%ERRORLEVEL%

echo.
echo Listo. Resultados en %OUT%. Avisale a Claude.
pause
