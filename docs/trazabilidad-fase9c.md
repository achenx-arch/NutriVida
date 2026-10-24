# FASE 9C — Personalización con un resumen limitado del historial de compras entregadas

Estado: **APROBADA Y CERRADA** el 2026-10-15 (ver §14). Verificación final en Windows: 19/19 comprobaciones con `EXIT=0` (`tests\verificar-fase9c.cmd`).
Fecha: 2026-10-15. Sin migraciones.

## 1. Objetivo

Mejorar la relevancia de las recomendaciones de NutriVida AI con los **patrones comprobables de compras entregadas** del cliente, usando únicamente el consentimiento independiente `autoriza_historial_ia`, sin revelar el historial a Ollama y sin debilitar las restricciones alimentarias de FASE 9B-1 y 9B-2.

## 2. Alcance

**Incluye:**

- un resumen limitado, de solo lectura y en memoria;
- un bono de relevancia secundario y acotado;
- textos explicativos en la casilla existente;
- pruebas, verificador para Windows y documentación.

**Fuera de alcance:**

- historial de conversaciones;
- persistencia de resúmenes;
- nuevas rutas o consentimientos;
- migraciones;
- cambios de catálogo, pedidos, inventario o Ollama.

## 3. Arquitectura utilizada (diagnóstico de la Etapa A)

- **Tablas:**
  - `pedidos` tiene `id_cliente`, `estado` (con CHECK de 6 estados) y `fecha_pedido`.
  - `detalle_pedido` relaciona `id_pedido`, `id_producto` y `cantidad`.
  - Un disparador diferido de la base impide pedidos sin detalles («Pedido sin detalles»).
- **ENTREGADO es terminal:** `TRANSICIONES_PERMITIDAS.ENTREGADO = []`. No existen devoluciones ni anulaciones posteriores en el modelo, por lo que no se inventaron reglas para ellas.
- **Reutilización:** se aprovecha el repositorio de la FASE 7 (`RepositorioHistorialConsumo`), que ya trabaja solo con pedidos ENTREGADO. No se creó un módulo duplicado.
- **Fecha de la ventana:** `fecha_pedido`. El modelo no guarda la fecha real de entrega; la FASE 7 ya usa el mismo criterio.
- **Consentimiento:** `perfil_cliente.autoriza_historial_ia` (migración 007) se lee en cada consulta con `leerConsentimientos`, donde solo `=== true` autoriza. La casilla de la interfaz ya existía desde la FASE 9A.

## 4. Archivos

| Archivo | Cambio |
|---|---|
| `src/services/historialIA.js` | **Nuevo:** límites, normalización defensiva del resumen y `bonoHistorial` |
| `src/repositories/postgres/historialConsumo.js` | `resumenIA(idCliente)`: SQL parametrizado, transacción `READ ONLY` |
| `src/services/relevanciaIA.js` | Opción `historial` en `seleccionarCandidatos`; el bono también ordena dentro de cada categoría en las consultas generales |
| `src/repositories/postgres/productos.js` | Pasa `historial` a la relevancia |
| `src/services/consultasService.js` | `leerHistorialAutorizado(cliente)`, que se ejecuta solo con consentimiento y continúa sin historial si la lectura falla |
| `src/services/contextoIA.js` | Solo el comentario: las compras nunca forman parte del contexto que recibe Ollama |
| `public/index.html` | Explicación bajo la casilla «Personalización con mis compras anteriores» |
| `tests/fase9c.test.js`, `tests/fase9c-browser.js`, `tests/fase9c-ollama-real.js`, `tests/verificar-fase9c.cmd` | **Nuevos** |
| `package.json` | Se agrega `fase9c.test.js` a `test`; scripts `test:fase9c`, `test:browser:fase9c` y `test:fase9c:ollama` |
| `docs/uml/3`, `docs/uml/4`, `docs/uml/5` | Clases (`ResumenHistorialIA`), secuencia (bloque opcional de historial) y componentes |
| `README.md` y este documento | Estado de la fase |

**Sin cambios:**

- El modelo relacional: se usan las tablas existentes, sin columnas ni tablas nuevas.
- Los casos de uso: UC26 y UC11 ya cubren el flujo.

## 5. Reglas de consentimiento

1. **Quién autoriza:** solo `autoriza_historial_ia === true` permite leer compras. FALSE, NULL, la ausencia del dato o un error de lectura equivalen a «no autorizado».
2. **Independencia:** `autoriza_contexto_ia` **no** sustituye al consentimiento de historial, ni al revés. Las cuatro combinaciones están probadas.
3. **Identidad:** el cliente se toma del JWT (`cliente.id`). No existe ningún identificador enviado por el navegador y no hay rutas nuevas.
4. **Sin autorización no hay lectura:** sin consentimiento, `resumenIA` **no se invoca**; las pruebas lo verifican contando las llamadas. Tampoco se lee el historial en las consultas médicas, ambiguas o contradictorias.
5. **Retirada inmediata:** el consentimiento se lee en cada solicitud, así que tras retirarlo la siguiente consulta ya no usa compras.
6. **Nunca automático:** ningún flujo activa el consentimiento.
7. **Interfaz:** solo muestra lo confirmado por el servidor, con la sincronización de la 9B-2 (cargas antiguas descartadas, casillas bloqueadas durante la carga o el guardado, y Reintentar ante un fallo).

## 6. Consulta del historial (`resumenIA`)

- **Transacción:** `REPEATABLE READ, READ ONLY`, con SQL parametrizado (`$1` cliente, `$2` días, `$3` pedidos).
- **Pedidos considerados:** `id_cliente = cliente del JWT`, `estado = 'ENTREGADO'`, `fecha_pedido` no nula y dentro de los últimos 90 días, y con al menos un detalle. Se toman los 20 más recientes.
- **Excluidos:**
  - pedidos en PENDIENTE, CONFIRMADO, EN_PREPARACION, LISTO o CANCELADO;
  - carritos, porque no son pedidos;
  - pedidos de otros clientes;
  - pedidos sin fecha;
  - pedidos fuera de la ventana.
- **Productos:** la recomendación sigue exigiendo que el producto esté activo, con categoría activa, precio y existencias. Un producto del historial que esté inactivo o sin existencias **no se recomienda**; el bono solo se aplica sobre candidatos que ya son elegibles.

## 7. Resumen limitado

El resumen tiene esta forma:

`{ pedidosConsiderados, productos: [{ productoId, pedidos }] (máx. 5), categorias: [{ categoria, pedidos }] (máx. 5) }`

- **No contiene:**
  - identificadores de pedido;
  - nombres de cliente, correos, direcciones, teléfonos o datos de pago;
  - precios, cantidades o totales;
  - información médica o alergias.
- `normalizarResumen` descarta cualquier campo inesperado.
- **Vive solo en memoria durante la solicitud:**
  - no se guarda en ninguna tabla;
  - no se registra en la auditoría ni en los mensajes de la conversación;
  - **no se envía a Ollama**.
- Si la lectura falla, se escribe en la consola un único aviso genérico, sin datos, y la recomendación continúa sin personalización.
- Las compras solo indican **preferencias observadas**: no se interpretan como necesidades, seguridad ni compatibilidad.

## 8. Algoritmo de relevancia

Orden de la recomendación:

1. Consulta médica.
2. Restricciones de la consulta.
3. Restricciones guardadas (solo con `autoriza_contexto_ia`).
4. Productos elegibles.
5. Evaluador y exclusión.
6. Relevancia de la consulta (pesos 3/2/2/1/1 sin cambios).
7. Bono de preferencias (máximo +1, solo con contexto autorizado).
8. **Bono de historial** (máximo +0,5, solo con historial autorizado).
9. Como máximo 5 candidatos hacia Ollama.
10. Validación de IDs.
11. Re-evaluación antes de las tarjetas.

**Bono de historial** (`historialIA.bonoHistorial`):

- +0,5 si el producto aparece en **2 o más** pedidos entregados de la ventana;
- +0,25 si aparece en uno solo;
- +0,25 si su categoría aparece en 2 o más pedidos;
- **tope de +0,5** por producto.

**Justificación del peso:**

- +0,5 es la mitad de la coincidencia exacta más débil (descripción = 1) y la mitad del tope de preferencias.
- Puede desempatar o reordenar productos con puntuaciones muy cercanas, por ejemplo dos bebidas con 6 puntos.
- No supera una coincidencia más fuerte: Chips (3) sigue antes que Barras (2 + 0,5).

**Condiciones que no cambian:**

- Se aplica solo a productos **permitidos** con `puntos > 0`. Nunca agrega productos sin relación con la consulta ni rescata excluidos.
- En las consultas generales mantiene el número de candidatos y la rotación por categorías; solo ordena dentro de cada categoría.
- La consulta sin coincidencias sigue respondiendo «sin coincidencias».
- `puntos` conserva la puntuación base; `bonoHistorial` y `motivosHistorial` quedan aparte para poder auditarlos en las pruebas.

## 9. Seguridad y privacidad

- JWT y `requerirRol("CLIENTE")` en `/api/consultas`, sin cambios; aislamiento por `id_cliente` en el SQL.
- **Ollama:** el contexto mantiene la lista blanca (consulta, perfil permitido y productos). La prueba verifica las claves exactas y que no aparezcan palabras de compras.
- **Auditoría:** las acciones de consulta no guardan datos de compras (`datos_anteriores` y `datos_nuevos` en NULL).
- **Sin efectos sobre los datos:** recomendar no modifica pedidos, detalles, estados ni inventario; la prueba compara una huella antes y después.
- No se agregaron rutas.
- Los errores no exponen detalles internos.

## 10. Pruebas

**`tests/fase9c.test.js`** (10 pruebas):

- **Bono:** valores, tope y normalización defensiva.
- **Relevancia con historial:**
  - desempate;
  - no supera coincidencias más fuertes;
  - no agrega productos;
  - restricciones prioritarias;
  - consulta general y sin coincidencias;
  - compatible con el bono de preferencias.
- **API + PostgreSQL** (esquema temporal y pedidos sintéticos):
  - **Resumen:** solo ENTREGADO, ventana, sin fecha, tope de 20, cliente propio, sin identificadores; cliente sin historial y cliente sin ningún ENTREGADO.
  - **Consentimiento:**
    - NULL, solo perfil, solo historial, ambos, retirada y ambos desactivados, contando las lecturas del historial;
    - se lee una sola vez y con el cliente del JWT;
    - nunca se activa solo.
  - **Privacidad:**
    - el cuerpo enviado a Ollama no lleva compras;
    - la respuesta y la auditoría tampoco;
    - no hay tablas ni preferencias nuevas.
  - **Seguridad alimentaria:**
    - una restricción explícita sobre un producto comprado prevalece;
    - una restricción guardada + historial también prevalece, con aviso prudente;
    - la consulta médica no lee el historial.
  - **Catálogo:** productos inactivos y sin existencias no se recomiendan.
  - **Fallas y aislamiento:**
    - un error al leer el historial deja la recomendación sin personalización y sin exponer el error;
    - el respaldo y «sin coincidencias» se conservan;
    - los pedidos de otro cliente no influyen.
  - **Integridad:**
    - pedidos, detalles e inventario intactos;
    - sin rutas nuevas;
    - `data/db.json` sin cambios;
    - un ENTREGADO sin productos es rechazado por la base.

**`tests/fase9c-browser.js`** (7 comprobaciones, navegador real):

1. Casilla existente con su explicación; sin consentimientos duplicados.
2. Sin consentimiento: recomendaciones sin personalización.
3. Activación en carrera (PUT retenido y carga antigua), independiente del consentimiento de perfil y del aviso de «Mi alimentación».
4. Con consentimiento: orden ajustado y Ollama sin compras.
5. Fallo al retirar el consentimiento, con Reintentar.
6. Retirada con efecto inmediato y pedidos conservados.
7. Recarga y ausencia de errores.

**`tests/fase9c-ollama-real.js`** (Ollama real):

- orden ajustado y cuerpo sin compras;
- retirada;
- restricción explícita sin modelo;
- Ollama apagado → 503;
- pedidos intactos.

**`tests/verificar-fase9c.cmd`:** 19 comprobaciones con `EXIT` individual, que incluyen:

- las pruebas de FASE 9C;
- `npm test`;
- regresiones de 9A, 9B-1, 9B-2 y relevancia;
- navegador de 9C, 9B-2 (dos pruebas), 9B-1, 9A y tarjetas;
- Ollama real de 9C, 9B-2 y 9B-1;
- el catálogo real en modo de solo lectura;
- importación, conversaciones heredadas y `data/db.json`.

El servidor principal (`npm start`) se revisa aparte y solo de forma informativa.

## 11. Resultados (VM: PostgreSQL embebido, sin Ollama)

| Prueba | Resultado |
|---|---|
| `fase9c.test.js` | 10/10 |
| `npm test`, ejecutado en tres partes | 353 pruebas: 352 aprobadas y 1 omitida (inferencia real con Ollama) |
| Navegador `fase9c` | 7/7 |
| Regresiones de navegador: `fase9a` 11/11, `fase9b1` 9/9, `fase9b2` 8/8, `fase9b2-consentimiento` 8/8, `ia-tarjetas` 6/6 | Todas aprobadas |
| `fase9c-ollama-real.js` sin Ollama | 2 aprobadas, 1 omitida |
| `fase9c-ollama-real.js` contra un servidor que imita la API de Ollama (no es el modelo real) | 4/4 |
| PlantUML (diagramas modificados) | Sintaxis válida; `uml.test.js` 14/14 |

### Verificación final en Windows (PostgreSQL y Ollama reales)

Ejecución del 15/10/2026 a las 23:20 con `tests\verificar-fase9c.cmd` (verificador corregido, ver §13).

| Comprobación (PARTE A, obligatoria) | Resultado |
|---|---|
| `fase9c-historial-consentimiento-privacidad-relevancia` | EXIT=0 |
| `npm-test` (suite completa) | EXIT=0 |
| Regresiones `fase9a`, `fase9b1`, `fase9b2`, `ia-relevancia` | EXIT=0 |
| Navegador: `fase9c`, `fase9b2`, `fase9b2-consentimiento`, `fase9b1`, `fase9a`, `ia-tarjetas` | EXIT=0 |
| Ollama real: `fase9c`, `fase9b2`, `fase9b1` | EXIT=0 |
| Catálogo real con Ollama real: `ia-productos-reales` | EXIT=0 |
| `verificar-importacion`, `conversaciones-heredadas`, `db-json-sin-cambios` | EXIT=0 |
| **RESULTADO GLOBAL PARTE A** | **APROBADO, 19 de 19 comprobaciones con código 0** |

La PARTE B (servidor de `npm start`) es solo informativa. El verificador llegó hasta «Listo» y `pause` sin errores de sintaxis de CMD. Evidencias en `docs/evidencias/fase9c/` (`resumen.log` y registros por prueba).

Además, el responsable realizó pruebas manuales en la interfaz: activó y retiró los consentimientos, y se mostraron los mensajes de confirmación correctos.

## 12. Limitaciones

- **Ventana:** se calcula sobre `fecha_pedido`, porque no existe la fecha real de entrega. Si los pedidos entregados de la base real tienen más de 90 días, el historial no tendrá efecto visible.
- **Categoría:** se usa la categoría **actual** del producto, no la que tenía al momento de la compra.
- **Alcance del bono:** es intencionadamente pequeño. Solo reordena entre opciones relevantes y no hace aparecer productos que la consulta no pide.
- **Lectura por consulta:** el resumen se lee en cada consulta autorizada (una consulta de solo lectura, acotada), sin caché, para respetar la retirada inmediata.
- **Disponibilidad:** el resumen solo existe en PostgreSQL; el modo JSON heredado no tiene historial y funciona sin personalización.

## 13. Incidencias y correcciones

- Al preparar los datos de prueba, la base rechazó un pedido sin detalles mediante el disparador «Pedido sin detalles». Los datos se insertan ahora en una transacción, y la prueba verifica explícitamente ese rechazo. Es un comportamiento correcto de la base, no un defecto de FASE 9C.
- No se encontraron defectos funcionales dentro del alcance durante la implementación.
- **Verificador de Windows (`tests/verificar-fase9c.cmd`).** Después de `[9/9]` aparecía «No se esperaba . en este momento.». Causa: en la línea de ATENCION de la PARTE B, el texto `(FASE 9C)` estaba dentro de un bloque `&& ( ... )`; el `)` sin escapar cerraba el bloque y CMD rechazaba la línea completa al analizarla, hubiera o no coincidencia de `findstr`. El script se detenía allí, antes de mostrar el resumen y de `pause`. El verificador de FASE 9B-2 usaba un texto sin paréntesis. Corrección: se quitaron los paréntesis del texto. Además, el verificador calcula ahora un RESULTADO GLOBAL solo con la PARTE A: devuelve 0 únicamente si hay 19 líneas `EXIT=0` y ninguna con otro código. La PARTE B sigue siendo informativa. No se quitó ninguna prueba. Prueba aislada: `tests\probar-final-verificador-fase9c.cmd`.
- **Ejecución en Windows del 15/10/2026, 22:46:** 18 de 19 comprobaciones obtuvieron `EXIT=0`. `ia-productos-reales` dio `EXIT=1` porque M5 terminó en `TIMEOUT` (504). El registro de Ollama muestra una generación iniciada hacia las 22:51:52. Generó 2 tokens y terminó a las 23:08:58 con 500 tras 17 min 6 s, cuando el cliente cerró la conexión. La medición del caso fue de 1 026 586 ms, aunque el límite configurado es 60 000 ms. Que ni Ollama ni el temporizador de Node avanzaran durante unos 17 minutos es compatible con una suspensión o pausa del equipo, pero no está confirmado. No se modificó el tiempo de espera ni se agregaron reintentos. Hay que repetir la verificación.
- **Cierre de la incidencia de sintaxis de CMD:** en la ejecución del 15/10/2026 a las 23:20, el verificador corregido completó los nueve bloques, mostró el resumen, «Listo» y «Presione una tecla para continuar», y no volvió a aparecer el error. Incidencia **cerrada**.
- **Antecedente: TIMEOUT intermitentes de Ollama.** El TIMEOUT de M5 (22:46) se conserva como antecedente, junto con el incidente R10 de FASE 9B-2 (ver `docs/trazabilidad-fase9b2.md`). No se reprodujo en la verificación final (`ia-productos-reales` EXIT=0) y **no se considera un defecto funcional actualmente reproducido**. El tiempo de espera sigue en 60 000 ms, sin reintentos.

## 14. Estado de aprobación

**FASE 9C queda APROBADA Y CERRADA** el 2026-10-15, por autorización del responsable del proyecto, tras la verificación final en Windows (19/19 `EXIT=0`, §11) y las pruebas manuales de consentimiento.

- El cierre solo actualizó la documentación (este documento y `README.md`). No se modificaron código funcional, pruebas, migraciones, bases de datos, Ollama ni datos históricos.
- Las fases anteriores (9A, 9B-1 y 9B-2) permanecen cerradas.
- No se ha iniciado ninguna fase posterior. Cualquier fase nueva requiere autorización explícita.
