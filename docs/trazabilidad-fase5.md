# FASE 5 — Preanálisis, inventario y movimientos

Estado: **COMPLETADA Y VERIFICADA**.
Fecha: 2026-09-29.
FASE 4 y FASE 5 cerradas satisfactoriamente.


## Referencias revisadas

Los cinco archivos oficiales son legibles:

1. `docs/uml/1. Modelo_Relacional_NutriVida_AI.txt`.
2. `docs/uml/2. Casos_Uso_NutriVida_AI.txt`.
3. `docs/uml/3. Casos_Uso_NutriVida_AI.txt` (contiene el diagrama de clases).
4. `docs/uml/4. Secuencia_IA_NutriVida.txt`.
5. `docs/uml/5. Componentes_NutriVida_AI.txt`.

Se contrastaron las trazabilidades de FASE 1–4, las migraciones 001–003,
la semilla de roles y el repositorio comercial, roles y gestor de transacciones actuales.
La secuencia IA y los componentes siguen describiendo partes de la arquitectura final;
esta fase no implementa Ollama, React/TypeScript, pedidos ni personalización.

## Evidencia e inconsistencias

### AJUSTE absoluto y trazabilidad

`database/migrations/001_esquema.sql`, líneas 59–64, define
`movimientos_inventario.cantidad INTEGER NOT NULL CHECK(cantidad>0)`.
El modelo relacional y MovimientoInventario solo incluyen tipo, cantidad, motivo y
fecha, además de identidad y relaciones. No incluyen existencia anterior ni nueva.

Esto impide guardar directamente el conteo absoluto cero en cantidad y no permite
interpretar inequívocamente un ajuste ascendente o descendente con su estado previo.
Guardar cifras dentro del motivo no sustituiría campos verificables. Tampoco se
debe confundir inventario inexistente con un inventario de cantidad cero.

La comprobación de solo lectura de la base principal encontró **0 inventarios,
0 movimientos y 5 productos con datos legados**. Las columnas reales de movimientos
coinciden con esa migración. No se modificaron datos de negocio.

La sección 5 de la autorización exige: «DETENTE y propón el ajuste mínimo antes de
modificar UML o PostgreSQL». Por eso no se creó ni ejecutó una migración nueva.

### Acceso del empleado

El caso UC21, Gestionar inventario, actualmente solo tiene asociación con
Administrador. La sección 7 autoriza expresamente al EMPLEADO a consultar y
registrar ENTRADA, SALIDA y AJUSTE. Se propone añadir `empleado --> UC21` y una nota
de alcance que no otorgue administración del catálogo ni de usuarios.

### Productos incompletos e inactivos

FASE 4 define activación con nombre válido, categoría activa y precio positivo;
descripción, ingredientes, imagen, información nutricional y stock mínimo son
opcionales. No establece qué movimientos físicos admite un producto desactivado.
Los UML tampoco resuelven esa regla. La sección 8 pide reportar esta ambigüedad.
Bloquear todo impediría corregir existencias tras una baja; permitir todo sin
distinción permitiría operaciones comerciales sobre productos retirados.

## Propuesta concreta para aprobación

### 1. Cambio mínimo de modelo y nueva migración

Crear, después de aprobarse, `database/migrations/004_inventario_movimientos.sql`:

- Añadir `existencia_anterior INTEGER NULL`, no negativa cuando exista. NULL
  significa exclusivamente configuración inicial sin registro previo de inventario.
- Añadir `existencia_nueva INTEGER NOT NULL`, no negativa.
- ENTRADA y SALIDA mantienen cantidad entera estrictamente positiva y representan
  unidades agregadas/retiradas. Requieren inventario previamente configurado.
- AJUSTE utiliza cantidad como **conteo absoluto final**, entero mayor o igual a
  cero. `existencia_nueva = cantidad`; su diferencia se calcula contra la anterior.
- Sustituir el CHECK general de cantidad por restricciones según tipo y
  restricciones que comprueben la relación anterior/cantidad/nueva. Mantener el
  CHECK de inventario no negativo y todas las FK.
- Para ENTRADA: nueva = anterior + cantidad; para SALIDA: nueva = anterior − cantidad.
  Validar límites INTEGER y efectuar cálculos de comprobación sin desbordamientos.
- Motivo obligatorio y fecha del servidor para las nuevas operaciones.
- Añadir índices necesarios para filtros y paginación del historial.

No modificar migraciones ya aplicadas. Como actualmente no hay movimientos, no se
necesita reconstruir historia. La migración deberá comprobar nuevamente esta
precondición y detenerse si aparecieron movimientos, antes de exigir valores
históricos que no existen; nunca inventará existencias anteriores.

Actualizar únicamente modelo relacional y clase MovimientoInventario con los dos
atributos y notas de semántica, y casos de uso para la asociación de EMPLEADO.
Secuencia IA y componentes no necesitan cambio por esta propuesta. Validar los cinco.

### 2. Configuración y reglas operativas propuestas

La primera configuración sería un AJUSTE explícito, con conteo real y motivo:
anterior NULL, nueva igual al conteo declarado, incluso cero. Crearía inventario,
movimiento y eventos CONFIGURAR_INVENTARIO/AJUSTE_INVENTARIO en una transacción.
Los eventos distinguirían configuración y operación sin duplicar todo el movimiento.
No crear inventarios automáticamente ni tratar una primera ENTRADA como un cero
histórico supuesto. Rechazar AJUSTE sin cambio cuando ya existe inventario.

| Condición del producto | Regla propuesta |
| --- | --- |
| Activo, nombre válido, precio positivo y categoría activa | Configuración inicial y los tres tipos de movimiento |
| Inactivo o categoría inactiva, con inventario existente | Solo AJUSTE físico justificado; bloquear ENTRADA/SALIDA y no activar el producto |
| Inactivo o incompleto, sin inventario | Bloquear configuración hasta completar y activar la ficha comercial |
| Inexistente | 404, sin efectos |

No volver obligatorios campos opcionales de FASE 4. EMPLEADO y ADMINISTRADOR tendrían
consulta, configuración y movimientos bajo estas mismas reglas, con historial
operativo compartido y paginado. CLIENTE no tendría acceso a esos endpoints.
Solo ADMINISTRADOR seguiría editando productos y stock mínimo mediante el catálogo.

Con stock mínimo NULL no se inventa un umbral: una existencia positiva se presenta
como NORMAL; cero tiene prioridad sobre BAJO STOCK; fila ausente significa SIN
INVENTARIO CONFIGURADO. La moneda GTQ / `Q 25.00` ya está aprobada y no requiere
otra decisión: se aplicará en presentación, conservando precios NUMERIC.

## Implementación prevista tras la decisión

| Requerimiento | UML / PostgreSQL | Transacción y servicio | Endpoint propuesto | Interfaz / prueba prevista |
| --- | --- | --- | --- | --- |
| Configurar sin inventar stock | Producto–Inventario 0..1, MovimientoInventario; inventario/movimientos | InventarioService → repositorio, fila de producto bloqueada y creación atómica | POST /api/inventario/movimientos con AJUSTE inicial | Formulario con conteo y motivo; ausencia frente a cero, primera configuración concurrente |
| ENTRADA/SALIDA/AJUSTE | UC21, tipos y campos propuestos; CHECK/FK | Actualización + movimiento + auditoría con mismo cliente SQL | POST /api/inventario/movimientos | Selector de tipo; cantidades inválidas, ajuste a cero y salida excesiva |
| Consulta y alertas | Inventario/Producto.stockMinimo; LEFT JOIN | Lectura paginada y estado calculado | GET /api/inventario | Buscador/tabla; cuatro estados y productos no permitidos |
| Historial | MovimientoInventario–Usuario–Producto | Filtros SQL por producto, tipo, intervalo de fecha y responsable | GET /api/inventario/movimientos | Historial legible; filtros, paginación y RBAC |
| Seguridad | SEC, INV, RINV, AUD; auditoria | JWT/RBAC backend, validación y error centralizado | Los tres endpoints protegidos | CLIENTE denegado; EMPLEADO/ADMIN autorizados; auditoría consistente |
| Catálogo y moneda | Producto–Inventario; precio NUMERIC | DTO de disponibilidad, sin compra | GET /api/productos y detalle existentes | Q y disponibilidad; regresión del catálogo |

La transacción bloquearía primero la fila de producto, que existe incluso antes
de configurar inventario, y después la fila de inventario cuando exista. Así se
serializan dos configuraciones iniciales y movimientos del mismo producto.
Coordinar el orden de bloqueos con edición/desactivación del catálogo y categoría;
revalidar el estado antes de escribir. Ante cualquier fallo, ROLLBACK de inventario,
movimiento y auditoría; nunca usar conexiones separadas dentro de la operación.

Archivos previstos (todavía sin cambios):

- Los tres UML afectados y la nueva migración 004 descritos arriba.
- Nuevos `src/repositories/postgres/inventario.js`, `src/services/inventarioService.js`,
  `src/routes/inventario.routes.js`, `src/security/inventarioValidacion.js`.
- `src/repositories/postgres/index.js`, `src/services/sistema.js`, `src/app.js` y
  `src/domain/roles.js`: composición y permisos específicos de inventario.
- `src/repositories/postgres/catalogoComercial.js`: disponibilidad calculada.
- Nuevo `public/inventario.js`; `public/index.html`, `public/catalogo.js` y
  `public/styles.css`: navegación, formularios, historial y moneda.
- Nuevo `tests/fase5.test.js`, pruebas de navegador correspondientes, `package.json`
  y pruebas anteriores solo donde cambie un contrato válido, por ejemplo número de
  migraciones o menú EMPLEADO. Conservar las 82 verificaciones anteriores.
- Este documento y README, únicamente con resultados reales al finalizar.

No se prevén dependencias nuevas. Riesgos: semántica de cantidad según tipo,
concurrencia de primera configuración y desactivación, conservación de permisos
administrativos, estados de disponibilidad y navegación previa. Se cubrirán con
integración PostgreSQL, fallos inducidos de auditoría, salidas simultáneas, pruebas
HTTP de roles y comprobaciones de navegador con datos sintéticos.

## Verificación y Cierre de la FASE 5

- Migración `004_inventario_movimientos.sql` aplicada exitosamente en `nutrivida_db` y verificada en `nutrivida_test_db`.
- Cinco diagramas UML validados.
- `npm test`: **105 aprobadas, 0 fallidas, 0 omitidas**.
- Pruebas de navegador headless real (`npm run test:browser:fase5`): **22 comprobaciones aprobadas, 0 fallidas**.
- Integridad de datos heredados: los 5 productos heredados continúan intactos sin precio ni inventario inventado.
- Inventario operativo con soporte para ENTRADA, SALIDA y AJUSTE transaccionales y protección contra concurrencia/stock negativo.

