# FASE 8 — NutriVida AI (consultas con Ollama local)

Estado: **IMPLEMENTADA Y VERIFICADA** (pendiente la verificación final en Windows con
`tests\verificar-mejoras-ia.cmd`, ver §7).  
Última actualización: 2026-10-01.

FASE 9 (uso del historial de consumo y de conversaciones previas en el contexto de la IA) **no está
implementada** y no forma parte de este documento.

---

## 1. Trazabilidad

| Requerimiento | UML / PostgreSQL | Servicio / Repositorio | Ruta | UI | Pruebas |
|---|---|---|---|---|---|
| Enviar consulta | `consultas_ia`, `conversaciones_ia` | `ModuloConsultas.enviar` | `POST /api/consultas` (CLIENTE) | `#consultaForm`, `#respuestaBox` | `fase8.test.js`, `ia-escenarios.test.js` |
| Historial propio | `consultas_ia`, `conversaciones_ia` | `ModuloConsultas.historial` | `GET /api/consultas` (CLIENTE) | `#historialList` | `fase8.test.js`, `ia-tarjetas.test.js` |
| Revisión por personal | `conversaciones_ia.revisada`, `auditoria` | `ModuloConsultas.listarAdministracion` / `revisar` | `GET /api/consultas/admin`, `PUT /api/consultas/:id/revisar` (permiso REVISAR_CONSULTAS) | Administración | `fase8.test.js` |
| Selección de candidatos por relevancia | lectura de `productos`, `categorias`, `inventario`, `producto_ingrediente` (sin cambios de esquema) | `relevanciaIA.seleccionarCandidatos`, `RepositorioProductos.seleccionarCandidatosIA` | `POST /api/consultas` | — | `ia-relevancia.test.js`, `ia-productos-reales.js` (R1–R8) |
| Integración con Ollama | — (sin tablas nuevas) | `ServicioIA` → `OllamaProvider` (`POST /api/generate`, JSON Schema) | — | — | `fase8.test.js`, `ia-productos-reales.js` |
| Tarjetas de productos recomendados | **sin cambios en el modelo** (lectura de `productos`, `categorias`, `inventario`) | `RepositorioProductos.resolverRecomendados` | campo nuevo `productosRecomendados` en `POST /api/consultas` | `#recomendacionesIA` | `ia-tarjetas.test.js`, `ia-tarjetas-browser.js`, `uml.test.js` |
| Consultas médicas sin Ollama | `consultas_ia` (RESPONDIDA), `conversaciones_ia` | `esConsultaMedica` en `ServicioIA` | `POST /api/consultas` | `#respuestaBox` | `ia-tarjetas.test.js`, `ia-productos-reales.js` (E–E4) |

Configuración (`.env`, sin API key): `OLLAMA_BASE_URL` (por defecto `http://localhost:11434`),
`OLLAMA_MODEL` (vacío → `SERVICIO_IA_NO_CONFIGURADO`), `OLLAMA_TIMEOUT_MS` (recomendado 60000 por el arranque en frío).

---

## 2. Qué hace Ollama y qué resuelve PostgreSQL

| Responsabilidad | Ollama (llama3.1) | Backend / PostgreSQL |
|---|---|---|
| Elegir candidatos | Selecciona **solo IDs** del `enum` de candidatos enviado (máx. 5) y un `tipo` (RECOMENDACION / ORIENTACION_GENERAL / CONSULTA_MEDICA) | Elegibilidad en SQL (activo, categoría activa, precio > 0, existencia > 0) y **relevancia** en `relevanciaIA.js` (§9) |
| Nombre, descripción, categoría, precio, imagen, disponibilidad, existencia | **Nunca** los genera; si los devuelve, la respuesta se rechaza (`RESPUESTA_INVALIDA`, 502) | Los obtiene de PostgreSQL con `resolverRecomendados(ids)` **después** de validar los IDs |
| Texto final al cliente | No se muestra texto libre del modelo | `redactar()` arma un texto determinista con los productos resueltos |
| Imagen | — | Solo `/images/productos/<slug>.(webp|png|jpg)` validada en disco (`rutaImagenSegura`); si no es válida → `null` y el frontend usa `/images/producto.svg` |
| Consultas médicas | **No se llama** | Detector del backend → mensaje médico seguro |
| Acceso a datos | No accede a PostgreSQL, SQL, usuarios, secretos ni herramientas | Contexto mínimo: consulta, perfil (solo con consentimiento) y candidatos |

---

## 3. Flujo de una consulta

1. `POST /api/consultas` (CLIENTE, validación de entrada, límite de solicitudes de IA).
2. Se crea la consulta (`PENDIENTE`).
3. **Detector médico** (antes de cualquier otra cosa): si la consulta menciona de forma explícita enfermedad,
   síntomas, diagnóstico, medicamento, medicina, dosis, tratamiento, prescripción, curar o diabetes
   (palabras completas, sin distinguir mayúsculas ni tildes en las variantes contempladas) →
   respuesta `MEDICA`, **sin llamar a Ollama**, sin tarjetas, consulta `RESPONDIDA`. Funciona también con Ollama apagado
   o sin configurar.
4. Si el modelo no está configurado → `SERVICIO_IA_NO_CONFIGURADO` (503).
5. Sin candidatos → texto `SIN_PRODUCTOS`, sin llamar al modelo.
6. Llamada a Ollama con JSON Schema (`enum` = IDs candidatos); validación estricta en el backend.
7. Si `tipo = RECOMENDACION`: los IDs se **resuelven otra vez** en PostgreSQL. Un producto que dejó de estar
   activo/disponible entre la respuesta del modelo y la resolución **no se muestra**; si no queda ninguno, se responde `GENERAL`.
8. Consulta e interacción se guardan juntas (`RESPONDIDA` o `ERROR`) y se audita (`consulta_ia` / `consulta_ia_error`).
9. Respuesta: contrato anterior **+** `productosRecomendados` (solo en la respuesta en vivo; no se persiste;
   el historial sigue mostrando únicamente texto).

Errores controlados: `OLLAMA_NO_DISPONIBLE`, `MODELO_OLLAMA_NO_ENCONTRADO`, `TIMEOUT`, `ERROR_RESPUESTA_OLLAMA` (503);
`RESPUESTA_INVALIDA`, `RESPUESTA_IA_VACIA` (502). El resto del sistema sigue disponible.

---

## 4. Tarjetas (frontend)

- `mostrarRecomendaciones()` en `public/app.js`: solo `createElement`/`textContent` (sin `innerHTML`).
- Cada tarjeta: imagen, categoría, nombre, descripción corta, precio (`Q x.xx`) y disponibilidad (Disponible / Bajo stock).
- Imagen solo si coincide con `/images/productos/<slug>.(webp|png|jpg)`; en otro caso o ante error de carga → `/images/producto.svg`.
- CSP sin cambios (`img-src 'self'`). Cuadrícula responsive (1 columna ≤ 540 px), identidad verde existente.

---

## 5. Cambios de esta iteración

| Archivo | Cambio |
|---|---|
| `src/services/iaService.js` | detector médico ampliado de forma acotada; `generarRecomendacionDetallada()` (texto, tipo, IDs, si consultó el modelo); `redactar()` exportado |
| `src/repositories/postgres/productos.js` | `resolverRecomendados(ids)` (solo lectura, conserva el orden del modelo) |
| `src/security/imagenesProductos.js` | `rutaImagenSegura()` |
| `src/services/consultasService.js` | resolución en PostgreSQL y campo `productosRecomendados` |
| `public/app.js`, `public/index.html`, `public/styles.css` | contenedor y tarjetas |
| `tests/ia-tarjetas.test.js`, `tests/ia-tarjetas-browser.js` | pruebas nuevas |
| `tests/fase8.test.js`, `tests/uml.test.js`, `tests/fase6-8-browser.js`, `tests/ia-productos-reales.js` | ajustes y nuevas comprobaciones |

Sin migraciones, sin cambios en el modelo PostgreSQL, sin cambios en productos, precios, inventario ni estados.

---

## 6. Pruebas (entorno de verificación con PostgreSQL embebido; Ollama no disponible allí)

| Prueba | Resultado |
|---|---|
| `npm test` (regresión completa) | 256 pruebas: 255 aprobadas, 0 fallidas, 1 omitida (Ollama real) |
| `tests/ia-tarjetas.test.js` | 14/14: 1 y varios productos, resolución en PostgreSQL, ID inventado y datos comerciales del modelo rechazados, producto que deja de estar disponible, imagen faltante → fallback, ningún candidato, consulta general, saludo, prompt injection, médica con Ollama activo y apagado, medicamento/dosis/tratamiento, bienestar comercial no médica, historial solo texto |
| `tests/fase8.test.js` | 44 aprobadas, 1 omitida (Ollama real) |
| `tests/uml.test.js` | 14/14 (incluye tarjetas: XSS como texto, rutas `https:`/`javascript:`/traversal → fallback) |
| Navegador `test:browser:ia-tarjetas` | 6/6: 3 tarjetas en vivo, XSS/fallback, 390 px una columna sin desborde, médica sin tarjetas ni modelo, historial solo texto, sin errores JS/CSP |
| Navegador imágenes / FASES 4–5 / FASES 6–8 | 8/8, 22/22, 10/10 + 1 omitida (Ollama real) |

Evidencias: `docs/evidencias/ia-tarjetas-desktop.png`, `docs/evidencias/ia-tarjetas-movil.png`.

---

## 7. Verificación final en Windows (PostgreSQL y Ollama reales)

`tests\verificar-mejoras-ia.cmd` → `docs\evidencias\mejoras-ia\`. Solo lectura sobre `nutrivida_db`.
Incluye `ia:productos-reales` (escenarios A–L + E2 médica con Ollama apagado, E3 dosis/medicina,
E4 bienestar comercial), que ahora también resuelve las tarjetas en PostgreSQL y verifica que ninguna
tarjeta ni nombre quede fuera de los candidatos.

## 8. Limitaciones conocidas

- `listarDisponiblesIA()` envía como máximo 5 candidatos; con 6 productos activos, uno puede no aparecer en una consulta concreta.
- Las tarjetas no se guardan en el historial (decisión: no modificar el modelo de conversaciones).
- El detector médico es deliberadamente acotado: consultas médicas redactadas sin esas palabras siguen el flujo normal,
  donde el `SYSTEM` prompt y el tipo `CONSULTA_MEDICA` del esquema siguen aplicando.

---

## 9. Relevancia de candidatos (2026-10-12)

**Problema** (diagnóstico de solo lectura en Windows, `docs/evidencias/relevancia-ia/`): `listarDisponiblesIA()` ordenaba por
coincidencia sí/no en nombre o categoría y, después, alfabéticamente, con `LIMIT 5`. Con 6 productos elegibles, todas las
consultas recibían el mismo conjunto de 5 (Pan Integral nunca entraba) y "para" o "pan" generaban coincidencias falsas.

**Algoritmo** (`src/services/relevanciaIA.js`, funciones puras):

- Normalización: minúsculas, sin tildes, palabras vacías y calificadores (alto, bajo, rico, con, sin…) eliminados,
  reducción simple de plurales/conjugaciones (bebidas→bebid, desayunar/desayuno→desayun).
- Tolerancia a errores: Damerau-Levenshtein ≤ 1 entre palabras de 4+ letras (snak→snack), con la mitad del peso.
- Pesos: nombre 3, categoría 2, ingredientes 2, descripción 1, información nutricional declarada 1. Solo datos escritos en el producto.
- **Específica**: solo productos con puntuación > 0, máx. 5, por puntuación y nombre; nunca se completa con irrelevantes.
- **General** (solo palabras genéricas o saludos: "¿Qué productos tienen?", "Hola"): muestra determinista por categorías
  (categorías y productos por nombre, un producto por categoría en cada ronda, máx. 5).
- **Sin coincidencias**: no se llama a Ollama; texto "No encontré productos del catálogo disponible que coincidan con tu
  búsqueda. Puedes preguntar por alguna de estas categorías: …" (categorías reales elegibles). Distinto de `SIN_PRODUCTOS`
  (ningún producto elegible).
- El flujo médico sigue evaluándose primero. JSON Schema (`enum` de IDs), `validarRecomendacionesContraCandidatos()` y la
  resolución de tarjetas en PostgreSQL no cambian. El contexto del modelo incluye ahora la descripción real (≤ 300 caracteres).

**Resultado con el catálogo real** (diagnóstico de Windows, confirmado por `tests/ia-relevancia.test.js`):

| Consulta | Candidatos |
|---|---|
| Busco un snack / busco de snak | Chips Saludables, Barras Energéticas |
| Quiero algo para desayunar | Cereales Integrales |
| ¿Qué bebidas tienen? | Bebidas Funcionales, Bebidas Saludables |
| Quiero algo alto en proteína | ninguno → sin coincidencias (ningún producto declara proteína) |
| ¿Qué productos tienen? | Barras, Bebidas Funcionales, Cereales, Chips, Bebidas Saludables (Pan Integral queda 6.º) |
| Quiero algo con avena | Barras Energéticas, Cereales Integrales |
| Algo con miel | Bebidas Funcionales, Barras, Bebidas Saludables, Cereales |

Sin migraciones ni cambios de datos. Verificación real: `tests\verificar-relevancia-ia.cmd` → `docs\evidencias\relevancia-ia-implementada\`
(ejecutada en Windows el 2026-10-12: 9/9 pasos con EXIT=0; reveló el problema de §10).

---

## 10. Respaldo del backend en consultas específicas (2026-10-12)

**Problema comprobado en Windows** (`docs/evidencias/relevancia-ia-implementada/ia-productos-reales.log` y pruebas manuales):
con candidatos relevantes, llama3.1 devolvió `ORIENTACION_GENERAL` con `productos: []` en "¿Qué bebidas tienen (disponibles)?",
"busco de snak" y "Quiero algo para desayunar". El JSON Schema lo permite (sin `minItems`), la validación lo acepta y el
texto final era el genérico. Las verificaciones reales anteriores solo exigían "sin IDs inventados".

**Corrección** (`relevanciaIA.opcionesSeleccion` / `respaldoEspecifico`, `ServicioIA.generarRecomendacionDetallada`):

- Se activa SOLO si: la selección es ESPECÍFICA, hay candidatos con puntuación > 0, el modelo devolvió `ORIENTACION_GENERAL`
  con `[]`, la consulta no es médica y no hay restricciones declaradas (en la consulta: "sin …", "libre de", alergia,
  intolerancia, celiaquía, "evitar", vegano/vegetariano, "no puedo comer/tomar/consumir"; o en el perfil AUTORIZADO:
  alergias o condiciones). Con restricciones el backend se abstiene y conserva la respuesta general.
- Respaldo = candidatos que cubren más términos distintos de la consulta, en orden de puntuación, máx. 5. Ej.: "bebidas" →
  Bebidas Funcionales y Bebidas Saludables; "bebidas saludables" → solo Bebidas Saludables.
- Nunca ante `CONSULTA_MEDICA`, ID inventado, respuesta inválida o error de transporte. Un subconjunto válido elegido por el
  modelo se respeta. Los IDs se resuelven otra vez en PostgreSQL (estado, categoría, precio, existencia) antes del texto y
  las tarjetas; el texto mantiene "Revisa los ingredientes declarados antes de elegir" (no presenta el producto como seguro).
- Trazabilidad: evento de auditoría `consulta_ia_respaldo_backend` con recurso `consultas/<id>` (sin texto ni perfil).
  El contrato de la API no cambia.
- Sin cambios en PostgreSQL, migraciones, inventario, pedidos, conversaciones ni UML.

Pruebas: `tests/ia-relevancia.test.js` 23/23 (reproduce los casos reales con Ollama simulado devolviendo `ORIENTACION_GENERAL`
y `[]`); `ia-productos-reales.js` exige ahora al menos una tarjeta en consultas específicas válidas (R9–R13 nuevos);
`fase6-8-browser.js` exige tarjetas en la consulta real de snack. Verificación real: `tests\verificar-respaldo-ia.cmd` →
`docs\evidencias\respaldo-ia\` (**pendiente de ejecutar en Windows**).
