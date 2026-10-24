# Casos de prueba — NutriAsistente IA

Evidencia de pruebas manuales realizadas sobre el prototipo, con entradas
válidas e inválidas, tal como exige la sección 3 de la guía del Proyecto
Final ("Evidencia de pruebas: casos con entradas válidas e inválidas").

Todos los casos se probaron con `curl` contra el servidor corriendo en
`http://localhost:3000`. Puedes reproducirlos tú mismo con los comandos
indicados, o grabarlos como parte del video de demostración.

---

## 1. Registro de usuario

### 1.1 Caso válido
```bash
curl -X POST http://localhost:3000/api/auth/register \
  -H "Content-Type: application/json" \
  -d '{"nombre":"Ana Perez","correo":"ana@example.com","password":"MiClave123"}'
```
**Resultado esperado:** `201 Created`, se devuelve `token` y datos del usuario.

### 1.2 Caso inválido — datos mal formados
```bash
curl -X POST http://localhost:3000/api/auth/register \
  -H "Content-Type: application/json" \
  -d '{"nombre":"A","correo":"no-es-correo","password":"123"}'
```
**Resultado esperado:** `400 Bad Request` con el detalle de cada campo inválido
(nombre muy corto, correo mal formado, contraseña menor a 8 caracteres).

### 1.3 Caso inválido — correo duplicado
Repetir la petición 1.1 con el mismo correo.
**Resultado esperado:** `400 Bad Request`, "Ya existe una cuenta registrada con ese correo."

---

## 2. Inicio de sesión

### 2.1 Caso válido
```bash
curl -X POST http://localhost:3000/api/auth/login \
  -H "Content-Type: application/json" \
  -d '{"correo":"ana@example.com","password":"MiClave123"}'
```
**Resultado esperado:** `200 OK`, se devuelve `token`.

### 2.2 Caso inválido — contraseña incorrecta
```bash
curl -X POST http://localhost:3000/api/auth/login \
  -H "Content-Type: application/json" \
  -d '{"correo":"ana@example.com","password":"incorrecta"}'
```
**Resultado esperado:** `401 Unauthorized`, mensaje genérico "Correo o
contraseña incorrectos" (no revela si el correo existe, por seguridad).

---

## 3. Perfil de salud

### 3.1 Caso válido — guardar perfil
```bash
curl -X PUT http://localhost:3000/api/perfil \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer <TOKEN>" \
  -d '{"condicionesMedicas":"Diabetes tipo 2","alergias":"Gluten","objetivoNutricional":"Bajar de peso"}'
```
**Resultado esperado:** `200 OK`, devuelve el perfil en texto claro (para el
propio dueño), pero se verifica en `data/db.json` que quedó **cifrado**.

### 3.2 Caso inválido — sin token
```bash
curl -X PUT http://localhost:3000/api/perfil \
  -H "Content-Type: application/json" \
  -d '{"condicionesMedicas":"Diabetes"}'
```
**Resultado esperado:** `401 Unauthorized`.

---

## 4. Consulta nutricional (flujo principal con IA)

### 4.1 Caso inválido — entrada vacía (RF-11)
```bash
curl -X POST http://localhost:3000/api/consultas \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer <TOKEN>" \
  -d '{"texto":""}'
```
**Resultado esperado:** `400 Bad Request`, "La consulta no puede estar vacía."

### 4.2 Caso inválido — texto que excede el máximo permitido
```bash
curl -X POST http://localhost:3000/api/consultas \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer <TOKEN>" \
  -d "{\"texto\":\"$(python3 -c 'print("a"*600)')\"}"
```
**Resultado esperado:** `400 Bad Request`, indica el máximo de 500 caracteres.

### 4.3 Caso inválido — sin autenticación
```bash
curl -X POST http://localhost:3000/api/consultas \
  -H "Content-Type: application/json" \
  -d '{"texto":"hola"}'
```
**Resultado esperado:** `401 Unauthorized`.

### 4.4 Caso válido — consulta normal
```bash
curl -X POST http://localhost:3000/api/consultas \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer <TOKEN>" \
  -d '{"texto":"Quiero bajar de peso, que me recomiendas?"}'
```
**Resultado esperado (API key válida):** `200 OK`, con la recomendación
generada por la IA basada en el perfil y el catálogo.

### 4.5 Caso de error simulado — falla de la API de IA (RF-10)
Se probó colocando una `ANTHROPIC_API_KEY` inválida en `.env`.
**Resultado obtenido:**
```json
{"error":"El servicio de IA no pudo procesar la solicitud en este momento.","codigo":"FALLA_SERVICIO"}
```
La consulta queda registrada en el historial con `estado: "ERROR"`, y el
mensaje al usuario no expone ningún detalle interno de la API (RNF-06).
Este es el caso que debes mostrar en el video de demostración como "caso
con error".

---

## 5. Administración (catálogo y revisión de consultas)

### 5.1 Caso válido — alta de producto (rol ADMINISTRADOR)
```bash
curl -X POST http://localhost:3000/api/productos \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer <TOKEN_ADMIN>" \
  -d '{"nombre":"Agua saborizada NutriVida","categoria":"Bebidas","ingredientes":"Agua, extracto natural de fruta","valoresNutricionales":"10 kcal, sin azucar"}'
```
**Resultado esperado:** `201 Created`.

### 5.2 Caso inválido — cliente intenta acceder a función de administrador
```bash
curl -X POST http://localhost:3000/api/productos \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer <TOKEN_CLIENTE>" \
  -d '{"nombre":"Producto no autorizado"}'
```
**Resultado esperado:** `403 Forbidden`, "No tienes permisos para esta acción."

---

## 6. Verificación de cifrado (evidencia de seguridad)

Tras ejecutar el caso 3.1, se inspeccionó `data/db.json` directamente:

```json
{
  "condicionesMedicas": "cd31067dea0d1bc1653540c8:5d1e84dce0dbb07af9fabd91f8b7a6e8:2ed6ec959d9a807a0475d54a8db399",
  "alergias": "95e9fb6b8121b9271e32117d:156966d63a27d21f12475a08e422c7d6:2a2225877223"
}
```

Se confirma que los datos de salud **nunca se almacenan en texto plano**
(RNF-02), y que la contraseña se guarda como hash bcrypt, nunca en claro
(RNF-04).

---

## Resumen

| # | Caso | Tipo | Resultado |
|---|------|------|-----------|
| 1.1 | Registro válido | Válido | ✅ 201 Created |
| 1.2 | Registro con datos mal formados | Inválido | ✅ 400 Bad Request |
| 1.3 | Registro con correo duplicado | Inválido | ✅ 400 Bad Request |
| 2.1 | Login válido | Válido | ✅ 200 OK |
| 2.2 | Login con contraseña incorrecta | Inválido | ✅ 401 Unauthorized |
| 3.1 | Guardar perfil de salud | Válido | ✅ 200 OK (cifrado verificado) |
| 3.2 | Guardar perfil sin token | Inválido | ✅ 401 Unauthorized |
| 4.1 | Consulta vacía | Inválido | ✅ 400 Bad Request |
| 4.2 | Consulta muy larga | Inválido | ✅ 400 Bad Request |
| 4.3 | Consulta sin token | Inválido | ✅ 401 Unauthorized |
| 4.4 | Consulta válida | Válido | ✅ 200 OK |
| 4.5 | Falla simulada de la API de IA | Error controlado | ✅ 503 con mensaje genérico |
| 5.1 | Alta de producto (admin) | Válido | ✅ 201 Created |
| 5.2 | Acceso de cliente a función admin | Inválido | ✅ 403 Forbidden |
