# FASE 9A — Consentimientos independientes y protección del contexto de NutriVida AI

Estado: **APROBADA Y CERRADA**. Aprobación formal del responsable: 2026-10-15 (ver §16).
Verificación inicial en Windows: 2026-10-14 (`tests\verificar-fase9a.cmd`: 11 comprobaciones con `EXIT=0`, con PostgreSQL y Ollama reales; ver §14).
También pasó como regresión en las verificaciones de FASE 9B-1, 9B-2 y 9C (ver §15).
Las fases 9B-1, 9B-2 y 9C se iniciaron después con autorización del responsable.

*Estado original, conservado como antecedente (2026-10-13):* «IMPLEMENTADA EN CÓDIGO; PENDIENTE DE VERIFICACIÓN EN WINDOWS».
En ese momento la migración 007 **no** se había aplicado a `nutrivida_db` (requería aprobación: `npm run db:migrar`). FASE 9B/9C/9D y FASE 10 no se habían iniciado.

## 1. Objetivo

Permitir que el CLIENTE autorice o revoque **por separado** (a) el uso de su perfil alimentario y (b) el uso de su historial
de compras entregadas para personalizar NutriVida AI, y garantizar que ningún dato no permitido llegue a Ollama.

## 2. Decisiones aplicadas

| ID | Decisión | Implementación |
|---|---|---|
| D-01 | Consentimientos independientes | `perfil_cliente.autoriza_contexto_ia` (perfil) y `autoriza_historial_ia` (compras, migración 007) |
| D-02 | Denegado por defecto | Solo `TRUE` autoriza (`leerConsentimientos`); NULL/FALSE/ausente = no; ningún TRUE implícito; columna nueva nace NULL |
| D-03 | Condiciones médicas excluidas | Lista blanca `CAMPOS_PERFIL_PERMITIDOS = ["objetivoNutricional"]` en `contextoIA.js`; condiciones y alergias quedan cifradas, sin cambios |
| D-04 | Conversaciones fuera de alcance | Sin cambios en el contexto |
| D-05 | Revocación efectiva | El consentimiento se lee en cada consulta; revocar no borra perfil, pedidos ni conversaciones |
| D-06 | Seguridad y compatibilidad | JWT, `requerirRol("CLIENTE")`, validación estricta, auditoría transaccional, manejo de errores existente |

## 3. Trazabilidad

| Requerimiento | UML | PostgreSQL | Backend | Frontend | Pruebas |
|---|---|---|---|---|---|
| Dos consentimientos independientes | Relacional (`autoriza_historial_ia`), Clases (`PerfilCliente`), Casos de uso (UC26) | `007_consentimiento_historial_ia.sql` | `RepositorioUsuarios.actualizarConsentimientos`, `ModuloPerfilCliente` | `#consentimientosIA` | `fase9a.test.js`, `fase9a-browser.js` |
| Minimización hacia Ollama | Secuencia (lista blanca), Componentes (nota) | — | `crearContextoIA`, `ModuloConsultas.enviar` | — | `fase9a.test.js`, `fase9a-ollama-real.js`, `fase8.test.js` |
| Auditoría | — | `auditoria` (sin cambios) | misma transacción que el cambio | — | `fase9a.test.js` |
| Integridad histórica | — | — | `importacion.js` (`EVENTOS_CONSENTIMIENTO`) | — | `fase9a.test.js`, `verificador.test.js` |

## 4. Migración 007

`ALTER TABLE perfil_cliente ADD COLUMN IF NOT EXISTS autoriza_historial_ia BOOLEAN;`

- Nace NULL para todos (nadie queda autorizado); no toca UUID, contraseñas, datos cifrados, pedidos ni conversaciones;
  no modifica `autoriza_contexto_ia`. Idempotente y registrada una sola vez por checksum (`schema_migrations`).
- Probada en esquemas aislados de `nutrivida_test_db` (datos previos intactos, doble ejecución).
- **Reversión** (manual, con aprobación): `ALTER TABLE perfil_cliente DROP COLUMN IF EXISTS autoriza_historial_ia;` y borrar
  la fila `migrations/007_consentimiento_historial_ia.sql` de `infra.schema_migrations`. Riesgo: se pierden los
  consentimientos de historial otorgados (no hay otros datos en esa columna).
- Sin 007 aplicada: la lectura funciona (no autorizado) y `PUT /api/perfil/consentimiento` responde **503 `MIGRACION_007_PENDIENTE`**.

## 5. Endpoints

| Método y ruta | Rol | Contrato |
|---|---|---|
| `GET /api/perfil` | CLIENTE | `{ perfilSalud, consentimientos: { autorizaContextoIA, autorizaHistorialIA } }` (campo nuevo, compatible) |
| `PUT /api/perfil/consentimiento` | CLIENTE | Cuerpo: uno o ambos booleanos `autorizaContextoIA`, `autorizaHistorialIA`. Respuesta: `{ consentimientos }` |

Validación (`validarSolicitud("consentimiento")`): solo esas dos propiedades, al menos una, valores estrictamente
`true/false`; sin parámetros de consulta. El usuario sale **solo del JWT**; `idUsuario`/`id_usuario` → 400.
Errores con la estructura actual `{ error, codigo }` (400, 401, 403, 503).

## 6. Controles de seguridad

- Autorización en backend: `autenticarUsuario` + `requerirRol("CLIENTE")`; EMPLEADO/ADMINISTRADOR → 403.
- Concurrencia: `SELECT … FOR UPDATE` sobre la fila del perfil; cada solicitud actualiza solo sus columnas.
- Transacción única: actualización + auditoría; si la auditoría falla, el consentimiento no cambia (ROLLBACK).
- Solo se auditan **cambios efectivos** (revocar algo NULL no genera evento).
- Respuestas sin contraseñas, hashes ni secretos; los errores no exponen detalles internos.

**Contrato de datos hacia Ollama** (`crearContextoIA`): `{ consulta, perfil: { objetivoNutricional ≤ 200 } | null, productos[≤5] }`.
Nunca: condiciones médicas, alergias en texto libre, correo, nombre, IDs de usuario o pedidos, tokens, contraseñas,
datos cifrados. El consentimiento de historial **todavía no habilita ningún dato** (FASE 9B/9C).
Las alergias/condiciones del perfil autorizado se usan **solo en el backend** para que el respaldo automático se abstenga
(comportamiento previo, sin cambios); nunca se envían al modelo.

**Revocación y consultas en curso**: el consentimiento se lee al inicio de cada consulta. Una consulta posterior a la
revocación no usa el contexto. Si una solicitud ya había enviado el objetivo a Ollama local antes de revocar, esa
solicitud termina con el contexto ya enviado; **no es posible retirarlo**. No hay cachés persistentes del perfil.

## 7. Matriz de permisos

| Acción | CLIENTE (propio) | CLIENTE (ajeno) | EMPLEADO | ADMINISTRADOR | Sin sesión |
|---|---|---|---|---|---|
| Ver perfil y consentimientos | Sí | No (no existe ruta por ID) | 403 | 403 | 401 |
| Otorgar / revocar | Sí | No (`idUsuario` → 400) | 403 | 403 | 401 |

## 8. Auditoría

`consentimiento_perfil_ia_otorgado`, `consentimiento_perfil_ia_revocado`, `consentimiento_historial_ia_otorgado`,
`consentimiento_historial_ia_revocado`. Registro: acción, actor (`id_usuario` del JWT), recurso `usuarios/<id>`, fecha.
Sin `datos_anteriores/datos_nuevos`. El verificador de importación acepta un cambio de `autoriza_contexto_ia` en un perfil
importado solo si el **último** evento de consentimiento de perfil de ese usuario coincide con el valor actual
(`CAMBIO_POSTERIOR_AUDITADO`); un cambio por SQL sin evento sigue siendo `IMPORTACION_CONFLICTO`.

## 9. Archivos

- **Creados**: `database/migrations/007_consentimiento_historial_ia.sql`, `tests/fase9a.test.js`, `tests/fase9a-browser.js`,
  `tests/fase9a-ollama-real.js`, `tests/verificar-fase9a.cmd`, `docs/trazabilidad-fase9a.md`.
- **Modificados**: `src/repositories/postgres/usuarios.js`, `src/domain/modelos.js`, `src/services/perfilService.js`,
  `src/routes/perfil.routes.js`, `src/middleware/validarSolicitud.js`, `src/services/contextoIA.js`,
  `src/services/consultasService.js`, `src/database/importacion.js`, `public/index.html`, `public/app.js`, `public/styles.css`,
  `tests/fase8.test.js` (expectativa de D-03), `database/scripts/diagnosticar-consulta-ia.js`, `package.json`, UML 1, 2, 3, 4 y 5, `README.md`.
- Sin cambios: algoritmo de relevancia, respaldo, `iaService.js`, modelo de Ollama, esquema de respuestas, catálogo, inventario, pedidos.

## 10. Pruebas (entorno de verificación: PostgreSQL embebido, sin Ollama)

| Prueba | Resultado |
|---|---|
| `tests/fase9a.test.js` | 22/22 (contrato de datos, migración 007, perfil inexistente, actualización parcial, auditoría, 401/403, payloads inválidos, sin secretos, concurrencia, fallo transaccional, contexto con/sin consentimientos, revocación en curso, prompt injection, Ollama apagado, médica, regresión de bebidas/desayuno/snack, integridad histórica, 503 sin 007) |
| `npm test` | 312: 311 aprobadas, 0 fallidas, 1 omitida (Ollama real) |
| `tests/fase9a-browser.js` | 8/8 (estado real, no activada antes de confirmar, teclado, revocación, fallo de red, responsive 390 px, sin errores JS/CSP) |
| Navegador regresión | tarjetas 6/6, FASES 4–5 22/22, FASES 6–8 10/10 + 1 omitida, imágenes 8/8 |
| `tests/fase9a-ollama-real.js` | lógica validada con un Ollama simulado (6/6); con Ollama real: 6/6 en Windows el 2026-10-14 (§14) |

Evidencias: `docs/evidencias/fase9a-consentimientos-desktop.png`, `docs/evidencias/fase9a-consentimientos-movil.png`
(generadas en el entorno de verificación; Windows las regenera).

## 11. Riesgos

- La migración 007 debe aplicarse a `nutrivida_db` con aprobación; hasta entonces el PUT responde 503 controlado.
- El texto del consentimiento de compras anuncia un uso que aún no existe (FASE 9B/9C); hoy no envía ningún dato.
- El formulario de perfil sigue pidiendo condiciones médicas (se guardan cifradas y nunca van a la IA).
- Una solicitud ya enviada a Ollama local no puede "retirarse" tras la revocación.
- Las alergias se consideran (solo en backend) únicamente con consentimiento de perfil; el filtro de alergias es FASE 9B/9C.

## 12. Pendientes para FASE 9B / 9C

- Preferencias y restricciones alimentarias (tipos nuevos en `preferencias_cliente`) e interfaz.
- Filtro de seguridad por alergias y mensajes de compatibilidad.
- Resumen limitado de compras ENTREGADAS (con `autoriza_historial_ia`) y bonos de relevancia.
- Etiqueta "Personalizada" / "General" en las respuestas.

## 13. Corrección puntual (2026-10-14): casillas deshabilitadas en el navegador

- **Síntoma** (Windows, verificación manual): perfil cargado, ambas casillas grises, sin mensaje y sin errores JS.
- **Causa**: `GET /api/perfil` respondió **sin** `consentimientos`. El único camino del frontend que produce ese estado
  es `mostrarConsentimientos(undefined)`, que deshabilitaba las casillas en silencio. El código actual del backend siempre
  incluye `consentimientos` (probado en `fase9a.test.js` y en Edge con `verificar-fase9a.cmd`, 8/8). La respuesta sin ese
  campo corresponde a un proceso Node **iniciado antes de FASE 9A**: `express.static` sirve el HTML/JS nuevos desde disco,
  pero las rutas cargadas en memoria son las anteriores. Comprobación: `tests\diagnosticar-servidor.cmd` (solo lectura).
- **Corrección** (`public/app.js`, `public/index.html`): validación estricta de la respuesta; si faltan los consentimientos
  o falla la carga, mensaje claro y botón **Reintentar** (nunca bloqueo silencioso); límite de 15 s al guardar
  (la interfaz no queda bloqueada); el estado solo se actualiza con una respuesta válida del servidor.
- **Prueba** (`tests/fase9a-browser.js`, 11/11): reproduce la respuesta sin `consentimientos`, verifica aviso + Reintentar,
  y ejecuta con **clic real del ratón** activar perfil → activar historial → revocar perfil → **recargar** la página,
  comprobando PostgreSQL y la auditoría en cada paso.

## 14. Verificación inicial en Windows (2026-10-14)

Ejecución de `tests\verificar-fase9a.cmd` el 14/10/2026 a las 14:59 (hora local). El navegador fue Microsoft Edge, con PostgreSQL y Ollama `llama3.1:latest` reales y datos sintéticos en esquemas temporales de `nutrivida_test_db`. Evidencias en `docs/evidencias/fase9a/`.

| Comprobación | Resultado | Detalle del registro |
|---|---|---|
| `fase9a-migracion-consentimientos-seguridad-auditoria-contexto` | EXIT=0 | 22/22 |
| `npm-test` | EXIT=0 | 312/312, 0 omitidas |
| `ia-relevancia` | EXIT=0 | — |
| `ia-productos-reales` | EXIT=0 | sin casos fallidos |
| `navegador-fase9a` | EXIT=0 | 8/8 (versión de la prueba anterior a la corrección del §13) |
| `navegador-ia-tarjetas` | EXIT=0 | — |
| `navegador-fase6-8` | EXIT=0 | 11/11 |
| `fase9a-ollama-real` | EXIT=0 | 6 aprobadas, 0 omitidas, 0 fallidas |
| `verificar-importacion` | EXIT=0 | — |
| `conversaciones-heredadas` | EXIT=0 | — |
| `db-json-sin-cambios` | EXIT=0 | mismo SHA-256 antes y después |

**Resultado: 11 de 11 comprobaciones con `EXIT=0`.**

- La prueba de navegador ampliada a 11/11 (§13) no tiene un registro propio de esa fecha. Su **primera evidencia registrada** en Windows es la verificación de FASE 9B-1 del 14/10/2026 a las 23:21 (§15).
- Esta verificación usa esquemas temporales y no prueba el estado de `nutrivida_db`. Las evidencias del repositorio no registran cuándo se aplicó la migración 007 a `nutrivida_db`.

## 15. Regresiones posteriores en Windows

FASE 9A se volvió a comprobar como regresión dentro de los verificadores de las fases siguientes. Evidencias en `docs/evidencias/<fase>/fase9a.log` y `navegador-fase9a.log`.

| Verificación | Fecha y hora local | `fase9a` (API) | `navegador-fase9a` | Resultado global del verificador |
|---|---|---|---|---|
| `tests\verificar-fase9b1.cmd` | 14/10/2026, 23:21 | EXIT=0 (22/22) | EXIT=0 (11/11) | 13 comprobaciones con EXIT=0 |
| `tests\verificar-fase9b2.cmd` | 15/10/2026, 21:33 | EXIT=0 (22/22) | EXIT=0 (11/11) | 16/16 EXIT=0 |
| `tests\verificar-fase9c.cmd` | 15/10/2026, 23:20 | EXIT=0 (22/22) | EXIT=0 (11/11) | 19/19 EXIT=0 |

Estas ejecuciones son regresiones posteriores; no reemplazan la verificación inicial del §14. La actualización de este documento es solo documental: no se modificaron código, pruebas, migraciones, bases de datos ni datos históricos.

## 16. Aprobación y cierre

**FASE 9A queda APROBADA Y CERRADA** por autorización formal del responsable del proyecto, el 2026-10-15.

- **Verificación inicial en Windows:** 2026-10-14, 14:59, con 11/11 `EXIT=0` (§14).
- **Regresiones aprobadas:** en las verificaciones de FASE 9B-1, 9B-2 y 9C (§15).
- **Prueba de navegador ampliada (11/11):** su primera evidencia registrada es la verificación de FASE 9B-1.
- **Migración 007 en `nutrivida_db`:** no hay evidencia de la fecha exacta en que se aplicó. Las verificaciones automáticas usan esquemas temporales de `nutrivida_test_db`, así que este documento **no** presenta la aplicación de 007 en `nutrivida_db` como verificada directamente.
- **Alcance del cierre:** fue solo documental. No se modificaron código funcional, pruebas, migraciones, bases de datos ni datos históricos, y no se inició ninguna fase adicional.
