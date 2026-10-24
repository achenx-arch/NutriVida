# FASE 9B-2 — Preferencias alimentarias y restricciones persistentes del cliente

Estado: **APROBADA Y CERRADA** el 2026-10-15 (ver §15). Verificación final en Windows: 16/16 comprobaciones con `EXIT=0`.
Fecha: 2026-10-15. **Sin migración** (no existe la 008). FASE 9C y posteriores: no iniciadas.

## 1. Objetivo y alcance

El cliente puede consultar, registrar, actualizar y eliminar desde «Mi perfil → Mi alimentación»:

- preferencias alimentarias;
- restricciones dietéticas;
- alérgenos declarados.

Las recomendaciones de NutriVida AI aplican estos datos **solo** si existe `perfil_cliente.autoriza_contexto_ia === true` (opción A aprobada). La compatibilidad la sigue decidiendo exclusivamente el evaluador del backend (FASE 9B-1); Ollama nunca decide qué es seguro.

## 2. Decisiones funcionales aplicadas

| # | Decisión | Implementación |
|---|---|---|
| 1 | Campo libre «Alergias» sin interpretar ni migrar | Se conserva igual. Solo los alérgenos **seleccionados** filtran. Un aviso visible en «Mi alimentación» lo explica |
| 2 | «Tengo alergias» pide aclaración aunque haya alérgenos guardados | `RESTRICCION_AMBIGUA` se mantiene. Las demás consultas siempre aplican lo guardado y autorizado |
| 3 | Contradicción entre consulta y perfil | Mensaje fijo `RESTRICCION.CONTRADICCION`: sin Ollama, sin tarjetas y sin borrar nada |
| 4 | Catálogo | 4 preferencias y 6 restricciones. `SIN_AZUCAR` total queda excluido (visible pero deshabilitado) |
| 5 | Pescado y mariscos | **Deshabilitados**, igual que **huevo**: el diccionario de 9B-1 no declara ingredientes genéricos para ellos (ver §5) |
| 6 | Opción A estricta | Lo guardado solo se usa con `autoriza_contexto_ia === true`. `autoriza_historial_ia` no lo sustituye. Guardar no activa ningún consentimiento |
| 7 | Sin migración 008 | Se reutiliza `preferencias_cliente`, con AES-256-GCM, transacción, bloqueo y auditoría sin valores |
| 8 | 9B-1 intacta | Las restricciones de la consulta, el filtro antes de Ollama y la re-evaluación de tarjetas no cambian |
| 9 | Bono de relevancia | +0,5 por coincidencia, máximo +1, solo entre productos permitidos y relevantes |

## 3. Estructura de preferencias (`src/services/catalogoAlimentacion.js`, versión 1)

| Grupo | Códigos habilitados | Uso |
|---|---|---|
| Preferencias | `INTEGRALES`, `FRUTAS`, `BEBIDAS_NATURALES`, `SNACKS_SALUDABLES` | Solo el bono de relevancia; nunca excluyen ni permiten |
| Restricciones | `VEGETARIANO`, `VEGANO`, `SIN_LACTEOS`, `SIN_LACTOSA`, `SIN_GLUTEN`, `SIN_AZUCAR_ANADIDO` | Evaluador 9B-1, severidad ESTRICTA |
| Alérgenos | `MANI`, `FRUTOS_SECOS`, `GLUTEN`, `LACTEOS`, `SOYA`, `SESAMO` | Evaluador 9B-1, severidad ALERGIA |
| Deshabilitados | `SIN_AZUCAR` (requiere información nutricional), `HUEVO`, `PESCADO`, `MARISCOS` (sin genéricos) | Se muestran deshabilitados con su motivo. La API los rechaza con 400 |

Las preferencias se reconocen con datos reales del producto:

- **Integrales:** «integral» en el nombre o en los ingredientes.
- **Frutas:** «fruta» en los ingredientes.
- **Bebidas naturales:** categoría Bebidas y «natural» en el nombre o la descripción.
- **Snacks saludables:** categoría o nombre con «snack».

## 4. Persistencia y cifrado

- **Tabla existente `preferencias_cliente`:** una fila por grupo y cliente.
  - `tipo`: `PREFERENCIA_ALIMENTARIA`, `RESTRICCION_DIETETICA` o `ALERGENO_DECLARADO`.
  - `descripcion`: la lista de códigos en JSON, cifrada con `GestorSeguridad.cifrarDatoSensible`.
  - `version_cifrado = 2`.
- **Compatibilidad:**
  - `RepositorioUsuarios.guardar()` solo reemplaza los 3 tipos de texto libre (`CONDICION_DECLARADA`, `ALERGIA_DECLARADA`, `OBJETIVO_GENERAL`), así que editar el perfil no borra la alimentación.
  - No se modifica `perfil_cliente`, de modo que el verificador de importación no cambia.
- **Rutas** (`src/routes/perfil.routes.js`, montadas en `/api/perfil`: JWT y `requerirRol("CLIENTE")`; el usuario sale **solo** del JWT):

| Método y ruta | Cuerpo | Respuesta | Auditoría |
|---|---|---|---|
| `GET /api/perfil/alimentacion` | — | `{alimentacion, opciones, consentimientos}` | `consulta_alimentacion_propia` |
| `PUT /api/perfil/alimentacion` | `{preferencias?, restricciones?, alergenos?}` | `{alimentacion, consentimientos}` | `actualizacion_alimentacion_perfil`, con `datos_nuevos = {grupos:[…]}` y nunca valores |

- **Semántica del PUT:** reemplazo **por grupo**.
  - Un grupo omitido no se toca.
  - `[]` borra ese grupo.
  - El cuerpo debe traer al menos un grupo.
- **Validación** (`validarSolicitud("alimentacion")`), rechaza con 400:
  - claves desconocidas, incluido `idUsuario`;
  - valores que no son listas, o elementos que no son textos o superan 40 caracteres;
  - códigos repetidos;
  - códigos desconocidos o deshabilitados;
  - listas más largas que el catálogo.
- **Transacción:**
  1. `SELECT … FROM usuarios … FOR UPDATE`, que serializa actualizaciones simultáneas para que no haya duplicados.
  2. `DELETE` e `INSERT` del grupo.
  3. Auditoría en la **misma** transacción.
- **Lectura:** un registro que no se puede descifrar **no se ignora**; produce 500 `ALIMENTACION_ILEGIBLE`, porque ignorarlo podría ocultar una alergia. Las respuestas nunca incluyen texto cifrado.
- **Modo JSON heredado:** 503 `ALIMENTACION_NO_DISPONIBLE`.

## 5. Reglas del evaluador

Antes de habilitar un código se comprobó que el diccionario de 9B-1 declara **ingredientes genéricos** para él. Así, un ingrediente ambiguo vuelve el producto `NO_VERIFICABLE`, nunca «sin conflicto» por falta de coincidencias. La prueba lo verifica código por código, por ejemplo: MANI con «Aceite vegetal», GLUTEN con «Harina», SIN_LACTOSA con «Queso», VEGETARIANO con «Caldo».

`HUEVO`, `PESCADO` y `MARISCOS` tienen la lista de genéricos vacía. Un producto con «masa», «salsa» o «caldo» quedaría como sin conflicto, así que se mantienen deshabilitados. No se modificó el diccionario de 9B-1.

Cambios aditivos en `evaluadorAlimentario.js`:

- `prepararConsulta` devuelve además `negadas`, los códigos que la consulta niega. La detección de 9B-1 no cambia.
- `combinarRestricciones(consulta, perfil)`: unión sin duplicados en la que gana la severidad más alta; ninguna anula a la otra.
- `contradicciones(negadas, perfil)`: trata GLUTEN↔SIN_GLUTEN y LACTEOS↔SIN_LACTEOS como la misma familia.

Flujo en `consultasService.enviar`:

1. La consulta médica tiene prioridad.
2. `prepararConsulta`.
3. Si hay consentimiento de perfil, se leen los datos guardados.
4. Se unen las restricciones.
5. Si la consulta es ambigua, se responde la aclaración; si hay contradicción, el mensaje fijo.
6. Elegibles, evaluador y exclusión de INCOMPATIBLE y NO_VERIFICABLE.
7. Relevancia con bono solo entre los permitidos.
8. Ollama.
9. Validación de IDs.
10. Resolución en PostgreSQL y **re-evaluación con todas las restricciones**.
11. Tarjetas y aviso.

## 6. Relevancia

- `seleccionarCandidatos(…, { restricciones, preferencias })`:
  - **Consultas específicas:** `bonoPreferencias` (+0,5 por preferencia, máximo +1) solo para productos permitidos con `puntos > 0`. `puntos` conserva la puntuación base (pesos 3/2/2/1/1 sin cambios) y el bono queda aparte en `bonoPreferencias` para poder probarlo.
  - **Consultas generales:** el mismo número de candidatos y la misma rotación por categorías; dentro de cada categoría, los preferidos van primero.
  - **Sin coincidencias:** sin cambios.
- Las preferencias solo se leen con consentimiento. Nunca rescatan un excluido ni agregan productos sin relación con la consulta.

## 7. Integración con Ollama

- Sin cambios en el modelo, el esquema ni la lista blanca (`objetivoNutricional`). **No** se envían alérgenos, restricciones ni preferencias.
- Ollama solo recibe candidatos ya filtrados.
- Un ID excluido o inventado produce 502.
- El respaldo automático se abstiene con cualquier restricción.
- Si el modelo devuelve `[]` bajo restricciones del perfil, la respuesta es «Aplicamos las restricciones guardadas en tu perfil [y las de tu consulta]: excluimos …», sin enumerar los alérgenos y nunca con el texto general.

## 8. Casos de prueba

| Archivo | Cobertura |
|---|---|
| `tests/fase9b2.test.js` (11) | **Catálogo:** habilitados y deshabilitados; NO_VERIFICABLE por cada genérico. **Unión y contradicciones.** **Bono:** +0,5 / máx. +1; consultas específicas, generales y sin coincidencias; no rescata excluidos. **A. Persistencia:** guardar, consultar, reemplazo por grupo, `[]`, cifrado, texto libre intacto, concurrencia de 6 PUT, sin texto cifrado en respuestas. **Validación:** 13 cuerpos rechazados. **Aislamiento, roles (403) y 401;** auditoría sin valores; el consentimiento no se activa. **B.** Los 7 casos de consentimiento. **C.** Seguridad alimentaria: Barras con maní, producto sin conflicto con aviso, perfil + consulta, vegano, sin gluten, múltiples sin candidatos, ID excluido 502, `[]` con mensaje de perfil, contradicción, ambigua y re-evaluación. **D.** Relevancia con y sin consentimiento; bebidas con 2 tarjetas. **Integridad:** sin frases prohibidas y `data/db.json` intacto |
| `tests/fase9b2-browser.js` (8) | Opciones del servidor (4/7/9), deshabilitadas y aviso; clics reales; guardado cifrado; recarga; error de red sin perder la selección; sin consentimiento no se aplica; con consentimiento, Barras excluida y aviso de trazas; revocación; 390 px; sin errores JavaScript ni de CSP |
| `tests/fase9b2-ollama-real.js` | Ollama real: maní guardado nunca enviado con consentimiento; sin datos del perfil en el cuerpo; revocación; restricción de la consulta sin consentimiento; contradicción y ambigua sin modelo; Ollama apagado da 503 |

## 9. Limitaciones conocidas

- Huevo, pescado y mariscos no se pueden seleccionar hasta que el diccionario incluya ingredientes genéricos conservadores.
- `LACTEOS` y `SIN_LACTEOS` solo tienen como genérico «crema». Ingredientes compuestos sin declarar (por ejemplo «chocolate») no se marcarían como no verificables.
- La detección de contradicciones cubre negaciones directas («No soy alérgico al maní», «No soy vegano», «No soy celíaco»). Formulaciones indirectas no se detectan; en ese caso se aplica lo guardado, que es lo más restrictivo.
- El bono depende de palabras del catálogo real. Si los nombres cambian, una preferencia puede dejar de coincidir.
- Con varias restricciones juntas es habitual que no quede ningún candidato; se responde con el mensaje fijo de restricción.
- **Interfaz (preexistente de 9A):** si se cambia el consentimiento antes de que termine de cargar «Mi perfil», la respuesta tardía de la carga puede mostrar el estado anterior en pantalla. El valor en PostgreSQL es el correcto y al recargar se ve bien. Las pruebas de navegador esperan a que termine la carga. No se corrigió para no salir del alcance.

## 10. Evidencias y resultados (VM: PostgreSQL embebido, sin Ollama)

- **`npm test`**, ejecutado en tres partes: 343 pruebas; 342 aprobadas y 1 omitida (inferencia real con Ollama, que no está disponible en la VM). `fase9b2.test.js`: 11/11.
- **Navegador:**
  - `fase9b2`: 8/8;
  - regresiones: `fase9b1` 9/9, `fase9a` 11/11, `ia-tarjetas` 6/6.
- **`fase9b2-ollama-real.js`:**
  - con la VM sin Ollama: 3 aprobadas y 1 omitida;
  - con un servidor que imita la API de Ollama (no es el modelo real): 8/8, tanto cuando elige todo como cuando no elige nada.
- **PlantUML:** los 5 diagramas tienen sintaxis válida; `uml.test.js` 14/14.
- **Windows:** pendiente `tests\verificar-fase9b2.cmd`, que guarda todo en `docs/evidencias/fase9b2/`. La parte B informa por separado si el servidor de `npm start` ejecuta el código actual.

## 11. Archivos

**Nuevos:**
- `src/services/catalogoAlimentacion.js`
- `tests/fase9b2.test.js`, `tests/fase9b2-browser.js`, `tests/fase9b2-ollama-real.js` y `tests/verificar-fase9b2.cmd`
- este documento

**Modificados:**
- `src/repositories/postgres/usuarios.js`: `obtenerAlimentacion`, `actualizarAlimentacion`.
- `src/services/perfilService.js`, `src/routes/perfil.routes.js` y `src/middleware/validarSolicitud.js`.
- `src/services/consultasService.js`.
- `src/services/evaluadorAlimentario.js`: `negadas`, `combinarRestricciones`, `contradicciones`.
- `src/services/relevanciaIA.js`: bono, `CONTRADICCION_PERFIL` y origen PERFIL.
- `src/services/iaService.js`: `CONTRADICCION` y mensaje con origen perfil.
- `src/repositories/postgres/productos.js`: pasa las preferencias a la relevancia.
- `public/index.html`, `public/app.js` y `public/styles.css`.
- `package.json`.
- Los 5 diagramas de `docs/uml/`.
- `README.md`.

**Sin cambios:** migraciones, esquema, `importacion.js`, catálogo, precios, inventario, pedidos, conversaciones, `data/db.json` y la configuración de Ollama.

## 12. Resultados en Windows e incidencia TIMEOUT de R10 (2026-10-15)

`tests\verificar-fase9b2.cmd`, con PostgreSQL y Ollama reales: **14 de 15 comprobaciones con `EXIT=0`**. La única falla fue `ia-productos-reales EXIT=1`, causada por el caso R10 («Busco bebidas»): TIMEOUT, HTTP 504, 64 339 ms. El caso R11, con los mismos candidatos, respondió en 4 913 ms.

**Diagnóstico a partir del registro `server.log` de Ollama** (solo lectura):

- La petición de R10 entró a las 15:58:50 y quedó registrada como **500 «1m4s»**: es la única cancelación en todo el historial de registros.
- Llegó a procesar el prompt (561 tokens) y generó **3 tokens**; después se detuvo hasta que el cliente la canceló a los 60 s.
- Se descartan las otras causas:
  - el modelo no se quedó generando sin fin (solo produjo 3 tokens);
  - no había peticiones simultáneas: el registro muestra una a la vez;
  - el modelo ya estaba cargado desde las 15:55:06.
- **Historial:** de 259 generaciones, la mediana es 7,6 s y el 99 % termina en 23,9 s o menos; solo esta superó los 60 s.
- **Entorno:** NVIDIA T600 Laptop de 4 GB, con 13 de las 33 capas del modelo en la GPU y el resto en la CPU.

**Repetición aislada** con `tests/diagnosticar-timeout-ia.js`. El script lee el catálogo en una transacción de solo lectura, la cierra antes de llamar a Ollama, hace las solicitudes una a la vez y usa un límite de diagnóstico de 180 s. Evidencia: `docs/evidencias/fase9b2/diagnostico-timeout.log`, guardado por PowerShell en UTF-16, por lo que algunas tildes aparecen alteradas.

| Consulta | Intentos | HTTP 200 | JSON válido y IDs dentro de los candidatos | Mín. | Mediana | Máx. | Más de 60 s |
|---|---|---|---|---|---|---|---|
| R10 «Busco bebidas» | 10 | 10 | 10 | 973 ms | 1 062 ms | 19 945 ms (incluye 11 689 ms de carga inicial del modelo) | 0 |
| R11 «Muéstrame las bebidas disponibles» | 3 | 3 | 3 | 4 231 ms | 4 248 ms | 4 262 ms | 0 |

- En todos los intentos se generaron 12 tokens en unos 0,85 s; el resto del tiempo fue lectura del prompt y carga del modelo.
- **Conclusión:** **incidencia intermitente de Ollama en este equipo, no reproducida en la repetición aislada.** No se encontró ningún defecto en el código.
- **Lo que se mantiene sin cambios:**
  - `OLLAMA_TIMEOUT_MS=60000`;
  - **sin reintentos automáticos**, porque duplicarían la carga en la GPU y la espera del cliente;
  - ningún cambio de código.
- **Comportamiento ante un TIMEOUT:** la aplicación responde 504 `TIMEOUT`, distinto de 502 `RESPUESTA_INVALIDA` y de las respuestas fijas por restricciones. No usa el respaldo ni muestra tarjetas, registra la consulta como ERROR con su auditoría y cancela la petición en Ollama.
- **Advertencia:** que 13 repeticiones terminen bien **no descarta** futuros bloqueos intermitentes; solo indica que no se reprodujeron en esta muestra y en estas condiciones del equipo.

## 13. Defecto pendiente: sincronización visual del consentimiento (heredado de FASE 9A)

**Reproducido en el navegador real** (VM, PostgreSQL de prueba; no se modificó código):

1. Se abre «Mi perfil»; la petición `GET /api/perfil` sale cuando el consentimiento todavía es `NULL`.
2. Mientras su respuesta sigue en camino, el cliente marca «Personalización con mi perfil». `PUT /api/perfil/consentimiento` responde y PostgreSQL queda en **TRUE**; la casilla aparece marcada.
3. Llega la respuesta antigua del GET y vuelve a pintar la casilla **desmarcada** y el aviso de «Mi alimentación» como **no autorizado**, aunque en PostgreSQL sigue **TRUE**.

Resultado medido: `casillaTrasGuardar=true`, `bdTrasGuardar=true`, `casillaTrasRespuestaAntigua=false`, `avisoActivo=false`, `bdFinal=true`.

**Impacto:** los datos y la auditoría son correctos y el backend aplica el valor real. Pero la pantalla le dice al cliente que **no** autorizó, mientras sus restricciones y preferencias sí se aplican. Es un defecto funcional de interfaz relacionado con el consentimiento. Desde 9B-2 tiene más peso, porque ese consentimiento decide si se usan los datos de «Mi alimentación». Recargar la página muestra el estado correcto.

**Corrección propuesta** (autorizada y aplicada, ver §14), solo en `public/app.js`:

- Un contador de versión del consentimiento que aumenta con cada cambio confirmado por el servidor.
- `cargarPerfil` guarda ese contador al iniciar y no aplica los consentimientos de su respuesta si cambió mientras tanto.
- Además, las casillas se deshabilitan mientras «Mi perfil» se está cargando.

Prueba de regresión propuesta: el mismo escenario en el navegador, reteniendo la respuesta del GET y verificando que la casilla y el aviso reflejan TRUE.

## 14. Corrección de la sincronización del consentimiento (autorizada el 2026-10-15)

### Causa

En `public/app.js`, `cargarPerfil()` aplicaba **siempre** el consentimiento que traía la respuesta de `GET /api/perfil`, sin comprobar si seguía vigente. Ocurrían tres problemas:

- Las casillas quedaban habilitadas durante la carga, con el estado anterior.
- Una respuesta que el servidor había calculado **antes** de un `PUT /api/perfil/consentimiento` podía llegar **después** de la confirmación de ese PUT y volver a pintar el estado viejo, tanto la casilla como el aviso de «Mi alimentación».
- Dos cargas seguidas podían terminar en desorden.

Los datos y la auditoría siempre fueron correctos; el problema estaba solo en la interfaz. Se reprodujo con la respuesta retenida mediante DevTools: casilla y aviso en «no autorizado» con PostgreSQL en TRUE.

### Cambios (solo `public/app.js`; sin cambios en backend, API, base de datos ni datos)

- **`cargaPerfilActual`:** cada carga de «Mi perfil» recibe un número. Solo la **más reciente** puede pintar el estado; las respuestas de cargas anteriores se descartan.
- **`versionConsentimiento`:** aumenta al **enviar** un cambio de consentimiento y otra vez al **terminar** el envío. Si cambió durante una carga, o la carga empezó con un guardado en vuelo, la respuesta de esa carga puede ser anterior al cambio. En ese caso no sobrescribe el último estado **confirmado por el servidor**.
- **Mientras se carga** (`cargandoConsentimientos`) o se guarda (`guardandoConsentimiento`), las dos casillas permanecen **deshabilitadas** y se muestra «Cargando tu autorización…».
- **Una sola fuente de estado:** `mostrarConsentimientos()` pinta la casilla y el aviso de «Mi alimentación» a partir del mismo estado confirmado. Solo `true` cuenta como autorización; NULL, FALSE o un dato no válido equivalen a «no autorizado».
- **Fallo al guardar** (red, tiempo agotado o respuesta perdida): nunca se presenta como guardado. Se muestra el último estado confirmado, junto con el mensaje «pulsa «Reintentar» para consultar el estado guardado» y el botón **Reintentar**, que vuelve a leer el estado real. Esto cubre el caso en que el servidor sí guardó pero la respuesta no llegó.
- **«Mi alimentación»:** recibió la misma protección.
  - `cargaAlimentacionActual` hace que solo la carga más reciente pinte las casillas.
  - `versionAlimentacion` evita que una carga anterior sobrescriba lo que acaba de confirmar un guardado.
  - Durante un guardado, la carga no habilita el botón ni borra el mensaje «Guardando…».

### Pruebas

`tests/fase9b2-consentimiento-browser.js` (navegador real, 8 comprobaciones):

1. **Carga normal:** casillas deshabilitadas mientras carga; NULL se muestra como no autorizado; aviso sincronizado.
2. **Respuesta tardía de una carga anterior** (otro dispositivo autoriza entre las dos cargas): la respuesta antigua se descarta.
3. **Activación en carrera:** PUT retenido y nueva carga cuya respuesta es anterior al guardado. La casilla solo se marca tras la confirmación y la carga antigua no la desmarca. Un clic durante la carga no envía nada.
4. **Desactivación:** confirmada por el servidor y aviso sincronizado.
5. **Fallo al guardar:**
   - con la red bloqueada;
   - con la respuesta perdida cuando el servidor sí guardó.

   En ambos casos no se muestra como guardado, y Reintentar recupera el estado real.
6. **Sincronización con «Mi alimentación»:** en ambos sentidos; guardar la alimentación no activa el consentimiento.
7. **Recarga de la página:** recupera el estado confirmado, incluida la selección de alérgenos.
8. Sin excepciones JavaScript ni bloqueos CSP.

**Resultados en la VM:**

| Prueba | Resultado |
|---|---|
| `fase9b2-consentimiento-browser.js` | 8/8 |
| Regresiones de navegador: `fase9a-browser` 11/11, `fase9b2-browser` 8/8, `fase9b1-browser` 9/9, `ia-tarjetas-browser` 6/6 | Todas aprobadas |
| `npm test` | 343 pruebas: 342 aprobadas y 1 omitida (inferencia con Ollama real, que no está disponible en la VM) |

La reproducción del defecto con el código anterior dio `casillaTrasRespuestaAntigua=false` y `bdFinal=true`. Con la corrección, la casilla queda deshabilitada durante la carga y el escenario 3 confirma que la respuesta antigua ya no sobrescribe el estado.

`tests/verificar-fase9b2.cmd` incorpora el paso `navegador-fase9b2-consentimiento` (`npm run test:browser:fase9b2:consentimiento`).

### Falla `navegador-fase9a EXIT=1` de la ejecución de las 20:44

**Qué muestra el registro:**
- Pasaron 7 de 11 comprobaciones, incluidas todas las de consentimiento: autorización solo tras la confirmación, teclado, revocación y fallo de red.
- Falló la espera de 8 s **después de `Page.reload({ignoreCache:true})`**: `typeof apiFetch==='function' && appNav visible`.
- No hubo excepciones JavaScript (`[]`) ni errores HTTP de la API en el registro.

**No corresponde al defecto visual:** el paso que falló viene después de todas las comprobaciones de consentimiento y solo espera a que la página termine de recargarse.

**Indicios de lentitud del equipo en esa ventana:**
- Según la hora de escritura de los registros, `navegador-fase9b1` tardó ~9 s, `navegador-fase9a` ~48 s (8 s de ellos esperando) y `navegador-ia-tarjetas` ~30 s. En la ejecución anterior de las 15:55 tardaron unos 4 s cada uno.
- Entre las 20:45 y las 20:47, la prueba de inferencia real de `npm test` mantuvo a Ollama generando (una generación de 1 min 32 s tras cargar el modelo), y el modelo siguió residente en memoria y GPU.

**No reproducible en la VM:** 3 ejecuciones normales y 3 con la CPU del navegador ralentizada 1×, 8× y 20× pasaron, con recargas de 1,1 a 1,8 s.

**Conclusión:** espera de recarga agotada por lentitud transitoria del equipo. **No hay evidencia de un defecto del código.** No se modificó `fase9a-browser.js`. Si se repite en la nueva verificación, se propondrá agregarle diagnósticos ante la falla (captura de pantalla, URL, `readyState` y estado de la sesión) antes de cualquier otro cambio.

## 15. Cierre formal de FASE 9B-2 (2026-10-15)

**FASE 9B-2 queda APROBADA Y CERRADA** por autorización del responsable del proyecto.

**Verificación final en Windows** (`tests\verificar-fase9b2.cmd`, PostgreSQL y Ollama reales; evidencias en `docs/evidencias/fase9b2/`): **16/16 comprobaciones con `EXIT=0`**. Incluyen:

- persistencia, consentimiento, seguridad alimentaria y relevancia;
- la nueva prueba de sincronización del consentimiento (`navegador-fase9b2-consentimiento`);
- las regresiones de FASE 9A y FASE 9B-1, de relevancia y de navegador;
- las pruebas con Ollama real;
- el catálogo real en modo de solo lectura;
- la integridad de la importación, las conversaciones heredadas y `data/db.json` sin cambios.

**Verificación manual en el navegador**, realizada por el responsable:

- **Consentimiento activado:** casilla marcada, mensaje «Autorización guardada» y aviso de «Mi alimentación» como autorizado.
- **Consentimiento desactivado:** casilla desmarcada, mensaje «Autorización retirada» y aviso de «Mi alimentación» como no autorizado.
- **Compras anteriores:** la autorización de uso de compras anteriores permanece desactivada; es independiente.

**Resultado del cierre:**

1. **Condición de carrera del consentimiento** (heredada de FASE 9A): **corregida y verificada** (§13 y §14), con prueba automatizada y comprobación manual.
2. **TIMEOUT de R10:** registrado como **incidencia intermitente de Ollama**, no reproducida en las pruebas posteriores (§12): repetición aislada 13/13 y verificación final 16/16. Se mantienen `OLLAMA_TIMEOUT_MS=60000` y la ausencia de reintentos automáticos.
3. **Defectos funcionales:** **no existen defectos funcionales conocidos pendientes** que bloqueen el cierre de esta fase. Las limitaciones de §9 son restricciones de alcance documentadas, no defectos:
   - huevo, pescado y mariscos deshabilitados;
   - cobertura limitada de genéricos de lácteos;
   - detección de contradicciones limitada a negaciones directas;
   - dependencia del bono respecto a las palabras del catálogo.
4. **Sin cambios estructurales:** no hubo migraciones ni cambios de esquema, y no se modificaron datos históricos.
5. **FASE 9C:** **no iniciada**. Requiere autorización independiente.
