# FASE 9B-1 — Evaluador determinista de restricciones alimentarias

Estado: **VERIFICADA EN WINDOWS Y CERRADA** (`tests\verificar-fase9b1.cmd`: 13 comprobaciones con EXIT=0, con PostgreSQL y Ollama reales).
Fecha: 2026-10-14. Sin migraciones nuevas (no existe la 008). FASE 9B-2, 9C, 9D y FASE 10: no iniciadas.

## 1. Problema

Hallazgo crítico del preanálisis de FASE 9B: la consulta **"Soy alérgico al maní"** enviaba a Ollama
*Barras Energéticas Naturales*, cuyo ingrediente declarado es `Frutos secos (almendras, maní, nueces)`.

Causa raíz:

- La selección de candidatos (`relevanciaIA.seleccionarCandidatos`) solo medía relevancia. No evaluaba compatibilidad.
- Ante restricciones, `opcionesSeleccion` solo **omitía el respaldo del backend**. Los candidatos (incluido el producto con
  maní) seguían llegando al prompt y al `enum` del JSON Schema.
- El modelo podía elegir ese producto y el backend lo validaba como correcto, porque estaba entre los candidatos.

## 2. Reglas implementadas

| # | Regla | Dónde |
|---|---|---|
| R1 | La consulta médica se atiende primero, con un mensaje fijo y sin interpretar restricciones ni llamar a Ollama | `consultasService.enviar`, `ServicioIA` |
| R2 | Solo cuentan las restricciones **declaradas en la consulta actual**. No cuentan menciones, preguntas ("¿Las barras contienen maní?") ni negaciones ("No soy alérgico al maní") | `evaluadorAlimentario.prepararConsulta` |
| R3 | Cada producto elegible se clasifica como `INCOMPATIBLE`, `NO_VERIFICABLE` o `SIN_CONFLICTO_DETECTADO`; con varias restricciones gana el estado más grave | `evaluarProducto` |
| R4 | Se excluyen los productos `INCOMPATIBLE` y `NO_VERIFICABLE` **antes** de la relevancia y de Ollama | `filtrarProductos` dentro de `seleccionarCandidatos` |
| R5 | La relevancia se calcula solo entre los productos permitidos, con un máximo de 5 y los mismos pesos (nombre 3, categoría 2, ingredientes 2, descripción 1, información nutricional 1). No hay bonificación por preferencias | `relevanciaIA` |
| R6 | Los términos de la restricción **no suman relevancia**: "Quiero un snack sin maní" busca "snack" | `consultaRelevancia` |
| R7 | Si no hay permitidos, o lo pedido solo coincide con excluidos, se responde un mensaje fijo **sin llamar a Ollama** y sin respaldo | `SIN_CANDIDATOS_RESTRICCION`, `SOLICITUD_EXCLUIDA`, `respuestaFija` |
| R8 | Ante una alergia ambigua ("Tengo alergias") se pide el ingrediente y no se llama a Ollama | `RESTRICCION_AMBIGUA` |
| R9 | Con restricciones, el respaldo del backend se abstiene. Además, solo puede tomar IDs de candidatos ya permitidos | `opcionesSeleccion` |
| R10 | Los IDs que devuelve Ollama se validan contra el `enum` de candidatos permitidos. Un ID excluido o inventado produce 502 `RESPUESTA_INVALIDA` | `validarRecomendacionesContraCandidatos` (sin cambios) |
| R11 | Antes de crear las tarjetas, cada producto se **re-evalúa con los datos frescos de PostgreSQL**. Si cambió y ya no cumple, se descarta | `RepositorioProductos.resolverRecomendados(ids, { restricciones })` |
| R12 | Una recomendación hecha bajo restricción lleva un aviso prudente. Nunca se usa "100 % seguro", "Libre de alérgenos", "Apto para celíacos" ni "Garantizado sin trazas" | `AVISO_RESTRICCION` |

Mensajes fijos (`iaService.RESTRICCION`):

- **Alergia ambigua:** "Para evitar recomendar productos incompatibles, indica a qué ingrediente eres alérgico o qué restricción debemos respetar."
- **Información insuficiente** (motivo `NO_VERIFICABLE`): "No tenemos información suficiente para comprobar qué productos cumplen la restricción que indicaste."
- **Sin candidatos** (todos incompatibles, o todas las tarjetas descartadas al re-evaluar): "No encontramos productos que podamos recomendar con la información disponible para esa restricción."
- **Producto incompatible** (lo pedido declara el ingrediente): "Este producto declara un ingrediente que coincide con la restricción indicada, por lo que no lo incluimos en las recomendaciones."

Avisos (`iaService.AVISO_RESTRICCION`):

- **ALERGIA:** se usa con alergias, intolerancias, sin gluten, sin lácteos o con términos personalizados. El texto aclara que no se verificó la ausencia de alérgenos ni de trazas y pide revisar la etiqueta.
- **DIETA:** se usa con vegano, vegetariano o restricciones de azúcar. El texto aclara que es "no detectamos conflicto…; esto no es una certificación".

## 3. Diccionario y límites

`src/services/catalogoRestricciones.js` es un diccionario **cerrado**, en su versión 1. Contiene:

- **Alérgenos:** MANI, FRUTOS_SECOS, GLUTEN, LACTEOS, HUEVO, SOYA, SESAMO, PESCADO y MARISCOS.
- **Dietas:** VEGANO, VEGETARIANO, SIN_LACTEOS, SIN_LACTOSA, SIN_GLUTEN, SIN_AZUCAR_ANADIDO y SIN_AZUCAR.

Para cada código define:

- `menciones`: cómo lo nombra el cliente.
- `incompatibles`: términos que, si aparecen, prueban un conflicto.
- `excepciones`: por ejemplo, "leche vegetal" o "mantequilla de maní" no son lácteos.
- `genericos`: términos que podrían contenerlo, por ejemplo "aceite vegetal" o "frutos secos". Producen `NO_VERIFICABLE`.

Equivalencias que se rechazan expresamente:

- "sin lactosa" ≠ "sin lácteos"
- vegetariano ≠ vegano
- "sin azúcar" ≠ "sin azúcar añadido" ≠ "bajo en azúcar"

Restricciones especiales:

- **Términos no catalogados** (por ejemplo, "alérgico a la canela"): restricción `PERSONALIZADA`. Se compara el término literal y la lista de genéricos universales.
- **"Bajo en X" y "sin azúcar":** requieren información nutricional verificable que el catálogo no tiene, así que el resultado es `NO_VERIFICABLE`.
- **"Alto/rico en X":** no es una restricción. Se trata como criterio de búsqueda, igual que antes.

Reglas sobre los textos del producto:

- Un ingrediente con alternativa ("Agua purificada **o** leche vegetal") que contiene un término incompatible es `NO_VERIFICABLE`.
- En el nombre o la descripción, una mención del término es `INCOMPATIBLE`.
- Una declaración comercial ("sin maní", "bajo en…") es `NO_VERIFICABLE`, porque nunca se toma como prueba de ausencia.
- Un producto sin ingredientes declarados es `NO_VERIFICABLE`.
- `trazasVerificadas` siempre vale `false`.

Límites conocidos:

- La detección es léxica, por segmentos de puntuación, con negación limitada a 3 palabras previas. Frases muy indirectas pueden no detectarse; en ese caso el comportamiento es el previo a 9B-1.
- Los sinónimos fuera del diccionario no se reconocen como alérgenos catalogados. Se tratan como `PERSONALIZADA` con el término literal.
- "No puedo comer X" se trata como restricción **estricta**, no como alergia. El efecto de filtrado es el mismo y el aviso de trazas también aplica.

## 4. Archivos

| Archivo | Cambio |
|---|---|
| `src/services/catalogoRestricciones.js` | **Nuevo.** Diccionario cerrado |
| `src/services/evaluadorAlimentario.js` | **Nuevo.** `prepararConsulta`, `evaluarProducto`, `filtrarProductos`, `requiereAvisoAlergenos` (funciones puras) |
| `src/services/relevanciaIA.js` | Filtro previo en `seleccionarCandidatos` con la opción `{ restricciones }`; tipos `SIN_CANDIDATOS_RESTRICCION` y `SOLICITUD_EXCLUIDA`; `opcionesSeleccion` agrega `respuestaFija`; stopwords "pero, soy, tengo, estoy" |
| `src/services/iaService.js` | `RESTRICCION`, `AVISO_RESTRICCION`, `respuestaRestriccion`; `respuestaFija` se atiende después de la consulta médica y antes de comprobar la configuración (funciona con Ollama apagado) |
| `src/services/consultasService.js` | Orden médica → restricciones → selección → Ollama → resolución con re-evaluación → aviso. Agrega la ruta para el repositorio JSON |
| `src/repositories/postgres/productos.js` | `SELECT_IA` con `ingredientes_lista` (solo para la IA); `seleccionarCandidatosIA(consulta, { restricciones })`; `resolverRecomendados(ids, { restricciones })` re-evalúa. **La forma de las tarjetas y de la API de productos no cambia** |
| `tests/fase9b1.test.js` | **Nuevo.** 7 pruebas y 12 subpruebas (detección, evaluador, relevancia, ServicioIA, API + PostgreSQL) |
| `tests/fase9b1-browser.js` | **Nuevo.** Navegador real, 8 comprobaciones |
| `tests/fase9b1-ollama-real.js` | **Nuevo.** Ollama real, flujo completo en un esquema temporal |
| `tests/ia-productos-reales.js` | Mismo flujo que la API (`prepararConsulta`, restricciones y re-evaluación); R13 actualizado; casos M1–M6 |
| `tests/ia-relevancia.test.js` | "Bebidas sin azúcar" ahora espera el mensaje fijo `SIN_INFORMACION` sin llamar al modelo (antes: GENERAL tras consultar al modelo) |
| `tests/verificar-fase9b1.cmd` | **Nuevo.** Verificación en Windows → `docs/evidencias/fase9b1/` |
| `package.json` | `test` incluye `fase9b1.test.js`; scripts `test:fase9b1`, `test:browser:fase9b1` y `test:fase9b1:ollama` |
| `docs/uml/3. Casos_Uso_NutriVida_AI.txt` (diagrama de clases) | `EvaluadorAlimentario`, `EstadoCompatibilidad` y sus dependencias |
| `docs/uml/4. Secuencia_IA_NutriVida.txt` | Médica → evaluador → elegibles → exclusión → relevancia → mensaje fijo o Ollama → validación → resolución y re-evaluación |
| `docs/uml/5. Componentes_NutriVida_AI.txt` | Componente "Evaluador Alimentario" |
| `README.md` | Estado de la FASE 9B-1 |

Revisados sin cambios:

- **Modelo relacional:** no hay cambios de esquema; se usan `producto_ingrediente` e `ingredientes` existentes.
- **Casos de uso:** el caso "Consultar NutriVida AI" ya cubre el flujo; no hace falta un actor ni un caso nuevo.

## 5. Flujo (orden obligatorio)

1. **Médica:** `esConsultaMedica`. Si lo es, se responde el mensaje médico fijo.
2. **Interpretar restricciones:** `prepararConsulta(texto)`. Si es ambigua, se responde el mensaje fijo.
3. **Elegibles de PostgreSQL:** productos activos, con categoría activa, precio > 0 y existencia > 0, junto con su lista de ingredientes.
4. **Evaluador:** cada elegible se clasifica en uno de los tres estados.
5. **Exclusión:** se descartan los `INCOMPATIBLE` y `NO_VERIFICABLE`. Si no queda ninguno, o lo pedido está excluido, se responde el mensaje fijo.
6. **Relevancia:** se calcula solo entre los permitidos.
7. **Máximo 5 candidatos.**
8. **Ollama:** recibe únicamente productos permitidos, en el prompt y en el `enum`.
9. **Validación de IDs:** un ID excluido o inventado produce 502.
10. **Resolución en PostgreSQL:** se leen los datos frescos.
11. **Re-evaluación:** se descartan los productos que ya no cumplen. Si no queda ninguno, se responde el mensaje "Sin candidatos".
12. **Tarjetas:** se muestran con el texto que redacta el backend más el aviso prudente.

## 6. Consentimientos

- Solo se usan las restricciones de la **consulta actual**.
- Las alergias guardadas en el perfil **no** se leen para el nuevo filtrado; eso corresponde a FASE 9B-2. Siguen sirviendo, como antes y solo en el backend, para que el respaldo se abstenga cuando el perfil está autorizado.
- Se mantiene la lógica de contexto de 9A: la lista blanca `objetivoNutricional`.
- No se usa el historial de compras.
- No hay cambios en los consentimientos.
- Las restricciones no se envían a Ollama como dato de perfil. La consulta del cliente viaja, como antes, en `consulta`.
- La auditoría no guarda texto de restricciones. Esto se verifica en `fase9b1.test.js`.

## 7. Pruebas (VM con PostgreSQL embebido; Ollama no disponible en la VM)

| Prueba | Resultado |
|---|---|
| `tests/fase9b1.test.js` | 19/19 aprobadas |
| `npm test`, mitad 1 (uml, sistema, fase1, importación, postgres, fase3–5) | 107/107 |
| `npm test`, mitad 2 (fase6–8, roles, verificador, imágenes, catálogo-pdf, ia-escenarios, ia-tarjetas, ia-relevancia, fase9a, fase9b1) | 223 aprobadas, 0 fallidas, 1 omitida (inferencia real con Ollama: no disponible en la VM) |
| `tests/fase9b1-browser.js` (Chromium) | 8/8 |
| Regresión de navegador: `ia-tarjetas-browser` 6/6, `fase9a-browser` 11/11, `fase6-8-browser` 10/11 con 1 omitida (preexistente) | sin fallas |
| `tests/fase9b1-ollama-real.js` | 4 aprobadas, 1 omitida (Ollama no disponible en la VM) |
| PlantUML (diagramas 1–5) | renderizan sin errores |

Casos cubiertos en `fase9b1.test.js`:

- **Detección:** las 10 consultas obligatorias más 6 adicionales.
- **Evaluador:** tabla de estados sobre los 6 productos reales y casos sintéticos (alternativas, excepciones, declaraciones comerciales, sin ingredientes, varias restricciones, restricción personalizada y genéricos).
- **Relevancia:** el maní nunca llega a ser candidato, `SOLICITUD_EXCLUIDA`, `SIN_CANDIDATOS_RESTRICCION`, respaldo omitido y pesos sin cambio.
- **ServicioIA:** mensajes fijos sin modelo, tanto con Ollama apagado como sin configurar; la consulta médica tiene prioridad.
- **API + PostgreSQL** (esquema temporal `nv_test_*`):
  - el producto con maní no aparece en el prompt ni en el `enum`;
  - si Ollama devuelve un ID excluido o inventado, la API responde 502;
  - con Ollama apagado responde 503, y los mensajes fijos siguen funcionando;
  - los casos sin candidatos no llaman al modelo;
  - el respaldo se abstiene;
  - un producto modificado **durante** la consulta pierde su tarjeta;
  - la consulta médica tiene prioridad;
  - con una dieta se muestra el aviso de no certificación;
  - las alergias del perfil no filtran ni viajan a Ollama;
  - regresión de las 4 consultas reales;
  - no aparecen frases prohibidas;
  - la auditoría no contiene restricciones;
  - `data/db.json` no cambia.

## 8. Evidencias

`tests\verificar-fase9b1.cmd` genera `docs/evidencias/fase9b1/`:

- `resumen.log`
- Pruebas: `fase9b1-test.log`, `npm-test.log`, `ia-relevancia.log`, `fase9a.log`
- Servidor: `diagnostico-servidor.log`
- Navegador: `navegador-fase9b1.log`, `navegador-ia-tarjetas.log`, `navegador-fase9a.log`
- Ollama real: `fase9b1-ollama-real.log`, `ia-productos-reales.log` (catálogo real, solo lectura)
- Integridad: `verificar-importacion.log`, `conversaciones-heredadas.log`, `db-json-antes.log` / `db-json-despues.log`
- Capturas: `fase9b1-*.png`

**Pendiente:** ejecutarlo en Windows con PostgreSQL y Ollama reales.

## 9. Riesgos residuales

- **Etiqueta real del producto:** `SIN_CONFLICTO_DETECTADO` se basa solo en los ingredientes declarados. El catálogo no declara trazas, contaminación cruzada ni certificaciones; por eso existe el aviso y no hay garantías.
- **Cobertura del diccionario:** la detección léxica puede no reconocer formulaciones inusuales. En ese caso no se filtra, igual que antes de 9B-1, y el respaldo sigue absteniéndose con el patrón amplio `hayRestricciones`.
- **Consulta que viaja a Ollama:** el texto de la consulta del cliente se sigue enviando a Ollama, igual que antes, aunque mencione una alergia. Ollama no decide compatibilidad ni recibe excluidos.
- **Exclusión prudente:** excluir los `NO_VERIFICABLE` puede dejar sin recomendaciones algunas restricciones, por ejemplo "sin azúcar" con el catálogo actual. Es el comportamiento elegido.
- **Repositorio JSON (modo legado):** se aplica la misma función pura, pero sin re-evaluación en la resolución, porque ese repositorio no resuelve tarjetas.

## 10. Pendientes para FASE 9B-2 (no implementados)

- Usar las alergias o restricciones **guardadas en el perfil** (con consentimiento) en el filtrado, y decidir cómo combinarlas con las de la consulta.
- Definir si hacen falta campos estructurados de alimentación (posible migración 008) en lugar de texto libre cifrado.
- Hacer visible en la interfaz la restricción aplicada, si se aprueba.
- Ampliar o versionar el diccionario según los ingredientes reales del catálogo.

## 11. Revisión tras las pruebas manuales en Windows (2026-10-14)

### Diagnóstico

`docs/evidencias/fase9b1/diagnostico-servidor.log` indica:

- servidor de `npm start` iniciado a las **21:25:56**;
- último cambio del código backend a las **22:13:20**;
- resultado: **"el servidor es ANTERIOR al código actual"**.

Las pruebas manuales se hicieron, por lo tanto, contra la lógica **previa a 9B-1**. Ese servidor no tenía evaluador. Con el respaldo previo y los 6 productos reales, esa lógica reproduce exactamente las 5 respuestas observadas:

| Consulta | Términos (lógica anterior) | Selección anterior | Respuesta observada |
|---|---|---|---|
| Tengo alergias | teng, alergi | SIN_COINCIDENCIAS | "No encontré productos…" |
| Busco algo sin gluten | gluten | SIN_COINCIDENCIAS | "No encontré productos…" |
| Quiero productos veganos | vegan | SIN_COINCIDENCIAS | "No encontré productos…" |
| Quiero un snack sin maní | snack, mani | ESPECIFICA (Barras, Chips, Bebidas); respaldo omitido; el modelo devolvió [] | GENERAL |
| Soy alérgico al maní | soy, alergic, mani | ESPECIFICA (**Barras** + Bebidas → Ollama); el modelo devolvió [] | GENERAL |

Además, ese servidor sigue enviando las Barras (con maní) a Ollama. Hasta reiniciarlo, el defecto crítico sigue activo en el navegador.

**Defecto real del código nuevo**, confirmado en `ia-productos-reales.log` (caso M1, Ollama real):

- Con una restricción y sin términos de producto ("Soy alérgico al maní", "sin gluten", "veganos"), la selección es GENERAL entre los productos permitidos.
- Si llama3.1 responde `ORIENTACION_GENERAL` con `[]`, se mostraba el texto general del catálogo ("Indica qué producto o categoría buscas"), sin explicar el filtrado.

### Corrección mínima

- `relevanciaIA.opcionesSeleccion` agrega `restriccionAplicada` cuando hay una restricción declarada y la selección es GENERAL o ESPECIFICA. Incluye el número de productos INCOMPATIBLES, el de NO_VERIFICABLES y las categorías de los permitidos, todo tomado de PostgreSQL.
- `ServicioIA`: si el modelo no elige productos y hay `restriccionAplicada`, responde `restriccionAplicada(...)`, de tipo `RESTRICCION_APLICADA`. Ejemplo: "Aplicamos la restricción que indicaste: excluimos 1 producto que declara un ingrediente incompatible y 2 productos cuya información no permite comprobarla. Indica qué producto o categoría buscas entre las opciones restantes: Bebidas, Panadería y Cereales."
- Lo que no cambia: el evaluador, los pesos, los mensajes fijos, el respaldo (sigue absteniéndose con restricciones), los candidatos, el esquema, los datos y el modelo.

### Distinción entre los dos casos

- **Sin productos relevantes:** el texto empieza por `SIN_COINCIDENCIAS_BASE` y la consulta no coincide con ningún producto.
- **Productos excluidos por la restricción:** se usa uno de estos mensajes:
  - `PRODUCTO_INCOMPATIBLE` o `SIN_INFORMACION`, cuando lo pedido está excluido;
  - `SIN_CANDIDATOS` o `SIN_INFORMACION`, cuando no queda ningún producto permitido;
  - `RESTRICCION_APLICADA`, cuando hay permitidos pero el modelo no eligió ninguno.

### Pruebas y herramientas agregadas

- **`fase9b1.test.js`**, subprueba "Revisión manual en Windows". Cubre los 6 casos con el modelo vacío y con el modelo eligiendo todo, y verifica en cada uno: mensaje, candidatos enviados, llamada a Ollama, tarjetas y aviso. Al final añade las dos consultas de distinción. El límite de IA se amplía solo en esa instancia de prueba (opción existente `limites` de `crearApp`).
- **`fase9b1-browser.js`:** paso 6b, en el que el modelo no elige productos, y captura `fase9b1-restriccion-aplicada.png`.
- **`ia-productos-reales.js`:** M1 exige una respuesta coherente; se agregan M7 (sin gluten) y M8 (veganos).
- **`fase9b1-ollama-real.js`:** si no hay tarjetas, la respuesta no puede ser el texto general.
- **Nuevo diagnóstico de solo lectura** `database/scripts/diagnosticar-restricciones-ia.js` (`npm run ia:diagnosticar-restricciones -- --ollama`). Muestra, para los 6 casos: detección, elegibles, evaluador por producto, relevancia, candidatos, llamada a Ollama, respuesta y tarjetas.
- **`verificar-fase9b1.cmd`:** ejecuta ese diagnóstico. Si el servidor de `npm start` es anterior al código, agrega **ATENCION** al resumen.
