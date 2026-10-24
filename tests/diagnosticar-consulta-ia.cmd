@echo off
REM Diagnostico de SOLO LECTURA: navegador sin tarjetas vs pruebas automaticas.
REM No modifica datos ni codigo. No guarda conversaciones. No registra correo, perfil ni textos sensibles.
setlocal
chcp 65001 >nul
cd /d "%~dp0.."
set "OUT=docs\evidencias\diagnostico-consulta-ia"
if not exist "%OUT%" mkdir "%OUT%"
set /p "CORREO=Correo de la cuenta CLIENTE usada en el navegador: "
echo [1/2] Proceso Node que atiende el puerto 3000 vs fecha del codigo ...
powershell -NoProfile -Command "$c=Get-NetTCPConnection -LocalPort 3000 -State Listen -ErrorAction SilentlyContinue | Select-Object -First 1; if(-not $c){'Ningun proceso escucha en el puerto 3000'} else { $p=Get-Process -Id $c.OwningProcess; 'Proceso: ' + $p.ProcessName + ' PID ' + $p.Id; 'Inicio del servidor: ' + $p.StartTime.ToString('yyyy-MM-dd HH:mm:ss') }; 'iaService.js modificado: ' + (Get-Item src\services\iaService.js).LastWriteTime.ToString('yyyy-MM-dd HH:mm:ss'); 'consultasService.js modificado: ' + (Get-Item src\services\consultasService.js).LastWriteTime.ToString('yyyy-MM-dd HH:mm:ss')" > "%OUT%\servidor.log" 2>&1
type "%OUT%\servidor.log"
echo [2/2] Mismo camino que la API con tu cuenta y Ollama real (sin escrituras) ...
node database\scripts\diagnosticar-consulta-ia.js --correo "%CORREO%" --ollama > "%OUT%\diagnostico.json" 2>&1
>> "%OUT%\diagnostico.json" echo EXIT=%ERRORLEVEL%
echo.
echo Listo. Resultados en %OUT%. Avisale a Claude.
pause
