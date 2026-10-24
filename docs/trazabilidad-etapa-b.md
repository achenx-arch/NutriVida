# ETAPA B — Catálogo oficial del PDF e imágenes de productos

Estado: **CARGA COMPLETADA Y VERIFICADA EN `nutrivida_db`** (2026-10-02 02:22 UTC).
Cierre formal pendiente de la auditoría de solo lectura del estado actual (`tests\verificar-etapa-b.cmd`).

## 1. Trazabilidad

| Requerimiento | Caso de uso | Clase (UML 3) | PostgreSQL (UML 1) | Componente (UML 5) | Código | Pruebas |
|---|---|---|---|---|---|---|
| Imagen por producto | UC18 Gestionar productos · UC5 Consultar catálogo | `Producto.imagenUrl` | `productos.imagen_url VARCHAR(500)` (migración 001, sin migración nueva) | Recursos estáticos `/images/productos/` · Servicio de Catálogo | `src/security/imagenesProductos.js`, `catalogoValidacion.js`, `GET /api/productos/imagenes`, `public/catalogo.js` | `tests/imagenes.test.js`, `tests/catalogo-imagenes-browser.js` |
| Catálogo oficial (20 productos) | UC18 | `Producto`, `Categoria`, `Ingrediente`, `ProductoIngrediente` | `productos`, `categorias`, `ingredientes`, `producto_ingrediente`, `auditoria` | Servicio/Repositorio de Catálogo · Auditoría | `database/scripts/cargar-catalogo-pdf.js`, `catalogo-pdf-estado.js`, `auditar-catalogo.js` | `tests/catalogo-pdf.test.js` |
| IA con productos reales | UC11, UC13, UC14 | `AsistenteNutriVida`, `ContextoIA` | `productos` + `inventario` (lectura) · `conversaciones_ia`/`mensajes_ia` | Servicio NutriVida AI → Cliente de Integración IA → Ollama | `listarDisponiblesIA()`, `iaService.js`, `ollamaProvider.js` | `tests/ia-escenarios.test.js`, `tests/ia-productos-reales.js`, `tests/fase8.test.js` |

## 2. Origen de los datos

- Fuente: `NutriVida(1).pdf` (16 páginas), SHA-256 `8e4e8a2ae480722b2c26441d11cb37c3999bafa1427969b40f373b0ac4db3203`.
- `docs/fuentes/catalogo-pdf/manifiesto-productos.json` (SHA-256 `432a9218f188ae3c…`): textos **literales** del PDF
  (nombre, descripción, ingredientes, procedimiento de elaboración), página/figura de cada imagen.
- `docs/fuentes/catalogo-pdf/propuesta-carga.json` (SHA-256 `03e0fb95f2fce24a…`): carga aprobada por el usuario.
- Procedimientos de elaboración: **solo** en el manifiesto; no se almacenan en PostgreSQL.

## 3. Decisiones aprobadas

- **Categorías de diseño del sistema** (no provienen del PDF): Barras y Snacks, Bebidas, Suplementos,
  Orgánicos y Naturales, Panadería y Cereales, Comidas Preparadas, Lácteos y Alternativas, Untables y Postres.
  "Suplementos" ya existía (importación FASE 2) y se **reutilizó sin modificarla**.
- **Descripciones**: 16 literales del PDF; 4 neutralizadas (productos 4, 6, 9 y 12) para no presentar afirmaciones
  de salud como hechos. Cada una conserva `descripcionOriginalPdf` y `motivoNeutralizacion`.
- **Imágenes**: asociadas por la etiqueta impresa en el empaque (en el PDF, desde el producto 10 cada figura
  aparece bajo el producto anterior). Galletas: caja grande; Leches Vegetales: "Leche de almendra";
  Postres: "Brownie integral". Alternativas solo como evidencia en `docs/fuentes/`.
- **Datos no inventados**: precio, stock, stock mínimo, valores nutricionales y cantidades de ingredientes = NULL.

## 4. Imágenes

- Solo locales en `public/images/productos/` (WebP; sin SVG; sin URLs externas). PostgreSQL guarda solo la ruta.
- 20 imágenes principales: WebP calidad 90, sin metadatos, sin ampliar (85–293 px de ancho en el PDF);
  SHA-256 de cada archivo registrado en el manifiesto y comprobado antes de la carga y en la verificación.
- CSP `img-src 'self'`. Validación: ruta `/images/productos/<slug>.(webp|png|jpg)`, archivo regular existente,
  sin enlaces simbólicos, ≤ 2 MB. Administración: selector de solo lectura con vista previa; sin subida de archivos.

## 5. Mecanismo de carga

- `npm run catalogo:cargar-pdf -- --admin <correo>`: **simulación** completa con ROLLBACK.
  `--confirmar`: una sola transacción; cualquier error → ROLLBACK completo.
- Validación previa: SHA-256 de imágenes, coincidencia propuesta/manifiesto, ausencia de datos no documentados,
  trazabilidad de descripciones e ingredientes exactos.
- **Idempotencia**: UUID determinista por producto (documento + número). Producto idéntico → se omite;
  modificado → se aborta sin sobrescribir; homónimo existente → se aborta (nunca se fusiona).
- **Auditoría** (`recurso_accedido = cli:catalogo:cargar-pdf`, responsable: ADMINISTRADOR indicado):
  CREAR_CATEGORIA, CREAR_INGREDIENTE, ASOCIAR_INGREDIENTE_PRODUCTO, CREAR_PRODUCTO y un evento
  CARGA_CATALOGO_PDF con los SHA-256 del documento, la propuesta y el manifiesto.

## 6. Resultado de la carga (Windows, `docs/evidencias/carga-catalogo-pdf/`)

- 7 categorías creadas + 1 reutilizada; 58 ingredientes; 20 productos; 75 relaciones producto-ingrediente.
- Total 25 productos (5 heredados + 20 PDF). Todos INACTIVOS, precio NULL, sin inventario ni movimientos.
- Verificación de la carga: **31/31**. 5 heredados intactos. Integridad histórica: **OK**.
- `npm test` 227/227; navegador: imágenes 8/8, FASES 4–5 22/22, FASES 6–8 OK.

## 7. Cambios posteriores (configuración manual de demostración)

Después de la carga, el ADMINISTRADOR configuró desde la interfaz precio, activación e inventario de algunos
productos. No son errores: `npm run catalogo:auditar` (solo lectura) clasifica cada producto como
A) heredado, B) PDF sin cambios o C) PDF configurado después, y exige evidencia en `auditoria`
(ACTUALIZAR_PRODUCTO, CONFIGURAR_INVENTARIO, AJUSTE/ENTRADA/SALIDA_INVENTARIO). Un cambio sin auditoría
se reporta como `C_SIN_AUDITORIA_REVISAR`. Resultado actual: `docs/evidencias/cierre-etapa-b/auditoria-catalogo.log`.

## 8. NutriVida AI con productos reales

Arquitectura vigente: Frontend → Express (`POST /api/consultas`) → `ModuloConsultas` → `ServicioIA`
(contexto mínimo + JSON Schema) → `OllamaProvider` (HTTP) → Ollama. Ollama no accede a PostgreSQL, SQL,
usuarios, secretos ni herramientas: solo recibe consulta, perfil (únicamente con consentimiento TRUE) y como
máximo 5 candidatos (`listarDisponiblesIA()`: activo, categoría activa, precio > 0, existencia > 0).
El modelo devuelve solo IDs del `enum` de candidatos; el backend valida los IDs, los **resuelve otra vez en
PostgreSQL** (`resolverRecomendados`: activo, categoría activa, precio > 0, existencia > 0) y redacta el texto solo con
los productos resueltos. Ollama nunca aporta nombre, descripción, categoría, precio, imagen ni disponibilidad.
Detalle completo en `docs/trazabilidad-fase8.md`.

## 9. Pruebas

| Prueba | Alcance |
|---|---|
| `tests/catalogo-pdf.test.js` | plan, SHA-256, datos no documentados, simulación, homónimo, ROLLBACK a mitad, carga, verificación, idempotencia, API |
| `tests/imagenes.test.js`, `tests/catalogo-imagenes-browser.js` | rutas, traversal, extensiones, RBAC, XSS, fallback, responsive |
| `tests/ia-escenarios.test.js` | IA A–L con PostgreSQL y modelo simulado |
| `tests/ia-productos-reales.js` | IA A–L con catálogo y Ollama **reales** (sin escrituras) |
| `database/scripts/auditar-catalogo.js` | estado actual A/B/C, candidatos IA, imágenes e integridad histórica |

## 10. UML

Corregido (el UML representa el sistema real; sin FASE 9 nueva y sin cambios en el modelo relacional):

- Secuencia IA: `POST /api/ai/consultas` → `POST /api/consultas`; participante Frontend → HTML / CSS / JavaScript;
  servicio de IA → Ollama local (llama3.1), llamada HTTP local `POST /api/generate`.
- Componentes: Frontend → HTML / CSS / JavaScript; `AI_API_KEY` → `OLLAMA_BASE_URL / OLLAMA_MODEL (sin API key)`;
  servicio de IA → Ollama local; conexión HTTP local `POST /api/generate`.

Diferencias que se mantienen documentadas (no se modificaron, pendientes de decisión):

- Secuencia IA: el bloque de consulta de historial de consumo y de conversaciones previas corresponde a FASE 9 (no implementada).
- Secuencia IA: la rama de error muestra `INSERT errores_sistema` y HTTP 503; el sistema real guarda la consulta en estado
  `ERROR`, audita `consulta_ia_error` y responde 503 o 502 según el código; no escribe en `errores_sistema`.
- Secuencia IA: no muestra el atajo médico sin Ollama ni la resolución de tarjetas en PostgreSQL.
- Clases: `ContextoIA.historialConsumo`/`historialConversacion` = FASE 9.

## 11. Mejoras de NutriVida AI (implementadas)

- **Tarjetas**: campo nuevo `productosRecomendados` en `POST /api/consultas` (solo respuesta en vivo; no se persiste).
  Imagen, nombre, descripción, categoría, precio y disponibilidad provienen de PostgreSQL. Imagen solo desde
  `/images/productos/`; si falta o no es válida → `/images/producto.svg`. Renderizado con `createElement`/`textContent`.
- **Consultas médicas**: detección en el backend antes de llamar al modelo; mensaje médico seguro, sin tarjetas,
  consulta `RESPONDIDA`, funciona con Ollama apagado. "Hola", "¿qué productos tienen?", "quiero desayunar" y consultas
  comerciales con palabras de bienestar no se clasifican como médicas.
- Sin migraciones ni cambios en datos. Pruebas: `tests/ia-tarjetas.test.js` 14/14, navegador 6/6, `npm test` 255/256 (1 omitida: Ollama real).
- Verificación en Windows: `tests\verificar-mejoras-ia.cmd` → `docs\evidencias\mejoras-ia\`.

## 12. Estado del cierre formal de ETAPA B

Evidencias de Windows (`docs/evidencias/cierre-etapa-b/`, `docs/evidencias/mejoras-ia/`): catálogo, imágenes, IA real,
tarjetas, flujo médico, `npm test` y navegador correctos. Las salidas de inventario adicionales (Barras 22→20,
Bebidas Saludables 15→12) corresponden a pruebas manuales de pedidos del responsable y se conservan.

`db:verificar-importacion` informaba `IMPORTACION_CONFLICTO` en 4 conversaciones heredadas (13df080b, 3eeace7a,
dcac7a1e, 0cc22223): solo `revisada` (false → true) y `fecha_actualizacion`, mensajes idénticos, cada una con un
`revision_consulta` de la misma conversación a ≤ 100 ms. Corrección aprobada y aplicada en `src/database/importacion.js`
(`evidenciaRevision`): esos dos campos se clasifican como `CAMBIO_POSTERIOR_AUDITADO` solo si

1. difieren únicamente `revisada` y/o `fecha_actualizacion`;
2. `revisada` pasa de false/vacío a true;
3. existe `revision_consulta` posterior a la importación con `recurso_accedido` = `consultas/<id>` exacto;
4. a ≤ 5 s de `fecha_actualizacion`;
5. el revisor es EMPLEADO o ADMINISTRADOR y no es el propietario;
6. la conversación conserva `id_interaccion_origen`;
7. `mensajes_ia`, contenido, estado, propietario, datos heredados y auditoría importada siguen estrictos.

No se modificaron conversaciones, auditoría ni `data/db.json`. Pruebas: `tests/verificador.test.js` 22/22 (caso legítimo,
otro campo, estado, true→false, sin evento, evento de otra conversación, fuera de 5 s, revisor CLIENTE, revisor
propietario, sin interacción de origen, mensaje alterado); `npm test` 266/267 (1 omitida: Ollama real).

Verificación final única: `tests\verificar-cierre-etapa-b.cmd` → `docs\evidencias\cierre-final-etapa-b\` (Windows, 2026-10-02):
los 12 pasos con `EXIT=0`; `npm test` 267/267 sin omitidas; integridad histórica OK; las 4 conversaciones heredadas
`CAMBIO_POSTERIOR_AUDITADO` por `revision_consulta`; IA real 18/18 sin productos inventados; navegador 22/22, 11/11, 6/6, 8/8;
`data/db.json` sin cambios. **ETAPA B: CERRADA.**

La mejora posterior de relevancia de candidatos se documenta en `docs/trazabilidad-fase8.md` §9.
