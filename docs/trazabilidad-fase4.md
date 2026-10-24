# Reporte final de FASE 4 — Catálogo comercial NutriVida

**FASE 4 COMPLETADA.** PostgreSQL continúa como única fuente activa.
No se inició FASE 5: no se implementaron movimientos, stock operativo, carrito,
pedidos, consumo, Ollama, personalización definitiva ni dashboard.

## Referencias y trazabilidad

Se revisaron los cinco UML oficiales, los reportes de FASE 1/2/3, código y esquema
real de PostgreSQL. No se añadieron tablas, estados ni campos de negocio.

| Requerimiento | UML | PostgreSQL | Servicio / endpoint | Interfaz | Prueba |
|---|---|---|---|---|---|
| Categorías | UC19; Categoria; CAT/RPROD | categorias | CatalogoComercialService; /api/categorias | Vista Categorías | FASE4 Categorías: crear/editar/duplicados/desactivar |
| Ingredientes | UC20; Ingrediente | ingredientes | Servicio; /api/ingredientes | Vista Ingredientes | FASE4 Ingredientes y navegador |
| Asociaciones | ProductoIngrediente | producto_ingrediente | guardarProducto transaccional | Selección de registros y cantidad opcional | Asociación normalizada, reemplazo y rollback |
| Producto comercial | UC18; Producto | productos | /api/productos, /:id, /:id/estado | Vista Productos | Precio, categoría, activación, edición y baja lógica |
| Consulta y detalle | UC5; Producto/Categoria | productos JOIN categorias | GET /api/productos y /:id | Tarjetas y diálogo de detalle | Tres roles; producto heredado oculto; navegador |
| Búsqueda/filtros | UC6; CAT/RPROD | ILIKE parametrizado, FK y EXISTS | GET con nombre/categoria/ingrediente | Buscador y dos filtros | Combinación, paginación, SQL injection como valor |
| Seguridad | SEC/AUTH; Usuario/Rol | usuarios, roles, auditoria | Middleware existente y validación comercial | Controles por rol | CLIENTE/EMPLEADO sin escritura; ADMIN autorizado |
| Auditoría | AUD/RAUD; Auditoria | auditoria | Misma transacción que la mutación | Mensajes de resultado | Acciones esperadas y rollback por fallo de auditoría |
| Preservación | UUID y datos legados aprobados | datos_legado sin modificación | Lectura administrativa para completar ficha | Panel histórico de solo lectura | Completar legado conserva JSONB y no crea inventario |
| Disponibilidad | Producto–Inventario 0..1; secuencia IA | LEFT JOIN inventario solo lectura | Campo calculado disponibilidad | Etiqueta sin promesa de venta | SIN_CONFIGURAR con inventario ausente |

## UML

**Ninguno modificado en FASE 4.** Los cinco se validaron nuevamente con PlantUML
1.2025.10 y la regresión semántica de casos de uso permanece satisfactoria.
El modelo ya incluye descripción, precio, imagen_url, estado y fechas de producto,
categorías, ingredientes y cantidad_descriptiva de la asociación.

Ingredientes no tiene estado ni fechas en el esquema aprobado: se implementaron
creación y edición, sin inventar activación/desactivación ni campos temporales.
INCOMPLETO es una descripción visual, no un nuevo enum: productos.estado sigue
siendo BOOLEAN. Precio NULL se mantiene mientras el producto sea inactivo.

El dibujo UC6 conecta explícitamente al Cliente. La instrucción aprobada de FASE 4
extiende búsqueda/filtros a Empleado y Administrador dentro de su consulta de catálogo
UC5. Se implementó esa autorización explícita; no se modificó el UML en silencio.
Queda como mejora documental añadir ambas asociaciones a UC6, sin cambiar permisos.

## Migración nueva

`database/migrations/003_catalogo_indices.sql`:

- Índices únicos de nombres normalizados para categorías e ingredientes: recortar
  extremos, colapsar espacios y comparar en minúsculas. No se eliminan acentos.
- Índice de productos por estado, lower(nombre) e UUID para ordenación.
- Se reutilizan los índices de categoría y ambos sentidos producto–ingrediente de 001.
- No se reescriben migraciones anteriores ni se renombran/fusionan registros.
  Si hubiera duplicados normalizados, la migración abortaría para resolverlos explícitamente.

Se comprobó antes de migrar que no había duplicados normalizados en la base real.
Migración 003 aplicada; 001, 002 y seed de roles reconocidos como ya aplicados, con
sus checksums originales. Control técnico: cuatro registros; tablas de negocio: 16.
La comparación ordenada de huellas de **todas las filas de las 16 tablas** fue
idéntica antes/después. `.env`, `data/db.json`, migraciones previas y cinco UML
permanecieron intactos durante el corte.

Productos reales al cierre del corte: **5 totales, 5 inactivos con precio NULL**.
No se asignaron precios, existencias, ingredientes ni categorías diferentes a los
productos reales. Las nuevas fichas de las pruebas existieron exclusivamente en
esquemas temporales de nutrivida_test_db, posteriormente eliminados.

## Archivos creados

- `database/migrations/003_catalogo_indices.sql`.
- `src/security/catalogoValidacion.js`.
- `src/repositories/postgres/catalogoComercial.js`.
- `src/services/catalogoComercialService.js`.
- `src/routes/catalogoComercial.routes.js`.
- `public/catalogo.js`.
- `public/images/producto.svg` (recurso visual predeterminado, sin fotografía ficticia).
- `tests/fase4.test.js`.
- `tests/fase4-browser.js` (navegador real local mediante CDP; sin dependencia nueva).
- `docs/trazabilidad-fase4.md`.
- `docs/evidencias/fase4-catalogo-desktop.png`.
- `docs/evidencias/fase4-catalogo-movil.png`.
- `docs/evidencias/fase4-administracion.png`.

## Archivos modificados

- `src/repositories/postgres/index.js`: composición del repositorio comercial.
- `src/repositories/postgres/productos.js`: candidatos IA requieren categoría activa
  además de los requisitos previos. No se cambia proveedor ni personalización.
- `src/services/sistema.js`: composición del servicio comercial.
- `src/app.js`: rutas comerciales cuando el driver activo es PostgreSQL.
- `src/middleware/seguridadHttp.js`: imágenes HTTPS en img-src; scripts/estilos y el
  resto de protecciones se mantienen. No se permite JavaScript inline ni eval.
- `public/index.html`, `public/styles.css`, `public/app.js`: navegación, vistas y
  conexión del módulo visual nuevo conservando login/perfil/IA/revisión/logout.
- `tests/postgres.test.js`: misma cobertura anterior con DTO normalizado e historial
  de cuatro migraciones. Crear ingrediente/categoría precede a su asociación.
- `package.json`: scripts de prueba FASE 4 y navegador.
- `README.md`: comportamiento comercial real, endpoints e instrucciones.
- Logs locales regenerados al reiniciar el servidor, sin credenciales.

**Dependencias nuevas: ninguna.** Se mantienen Helmet, rate limiting y controles de
FASE 3. `npm.cmd audit --omit=dev` terminó con 0 vulnerabilidades reportadas.

## Endpoints

Todas estas rutas requieren identidad autenticada y cuenta activa. Identificadores
de productos: UUID. Categorías e ingredientes: BIGINT positivo representado como
cadena decimal para no perder precisión. Los errores conservan el formato central.

| Método | Ruta | Acceso | Operación |
|---|---|---|---|
| GET | /api/productos | Tres roles | Lista filtrada y paginada |
| GET | /api/productos/:id | Tres roles | Detalle; inactivo devuelve 404 a CLIENTE/EMPLEADO |
| POST | /api/productos | ADMINISTRADOR | Crear ficha comercial o borrador |
| PUT | /api/productos/:id | ADMINISTRADOR | Edición parcial y reemplazo explícito de asociaciones |
| PUT | /api/productos/:id/estado | ADMINISTRADOR | Activar/desactivar con {estado:boolean} |
| DELETE | /api/productos/:id | ADMINISTRADOR | Alias compatible de desactivación; nunca DELETE físico |
| GET | /api/categorias | Tres roles | Lista paginada; solo activas para cliente/empleado |
| POST | /api/categorias | ADMINISTRADOR | Crear |
| PUT | /api/categorias/:id | ADMINISTRADOR | Editar |
| PUT | /api/categorias/:id/estado | ADMINISTRADOR | Activar/desactivar |
| GET | /api/ingredientes | Tres roles | Lista paginada para consulta/filtros |
| POST | /api/ingredientes | ADMINISTRADOR | Crear |
| PUT | /api/ingredientes/:id | ADMINISTRADOR | Editar |

GET productos acepta `nombre`, `categoria` (ID), `ingrediente` (ID), `page`, `limit`.
Solo ADMINISTRADOR puede usar `estado=activo|inactivo|todos`; su listado sin ese filtro
incluye borradores para administración. Cliente/empleado siempre requieren producto
activo, categoría activa y precio positivo. La vista Catálogo del administrador
solicita activos; la vista Productos permite gestionar todos los estados.

GET categorías/ingredientes acepta nombre/page/limit; categorías permite estado
solo al administrador. Página predeterminada 1, límite 12, máximo 100, page máximo
100000. Respuesta: lista y paginacion {page,limit,total,pages}; orden estable por
nombre e ID. Búsqueda por subcadena literal, escapando % y _ como datos. SQL siempre
parametrizado; el filtrado de productos y conteo no se ejecutan en frontend.

POST/PUT producto usa nombre, categoriaId, descripcion, precio, imagenUrl, estado,
valoresNutricionales, stockMinimo e ingredientes:[{id,cantidadDescriptiva?}]. No acepta
strings separados por comas ni campos de existencias. Omitir ingredientes en PUT
conserva relaciones; [] las retira explícitamente. Los datos históricos siguen en
JSONB de solo lectura y no se reinterpretan automáticamente como asociaciones.

## Reglas y transacciones

- Nombre obligatorio válido y categoría existente al crear un producto. Se permite
  borrador inactivo con precio desconocido; un precio informado debe ser >0, hasta
  dos decimales y dentro de NUMERIC(10,2). Se rechazan cero, negativos, NaN y exponentes.
- Activar exige nombre válido, categoría activa y precio positivo. No exige inventario
  ni crea una fila de stock. Desactivar conserva UUID, producto e historial relacionado.
- Una categoría con productos activos devuelve 409 al intentar desactivarla: primero
  se desactivan esos productos. No se altera silenciosamente su estado en cascada.
  Esto preserva la regla ya aprobada de categoría activa para productos activos.
- Ingredientes se seleccionan por ID existente; IDs duplicados o desconocidos se
  rechazan. La cantidad descriptiva es opcional y no se infiere.
- Escrituras comerciales, relaciones y auditoría comparten una transacción. Un bloqueo
  transaccional de catálogo coordina cambios de categoría/activación, además de locks
  de filas. Fallo en asociación o auditoría revierte toda la operación.
- Descripción, imagen, valores nutricionales y stock mínimo son opcionales. Stock
  mínimo es un dato de referencia del modelo, no una existencia ni movimiento.
- Imágenes: URL HTTPS sin usuario/contraseña, o ruta local /images/ con extensión
  permitida. Sin binarios en PostgreSQL, upload, proxy de imágenes ni descarga desde
  el backend. Placeholder local si no existe imagen o falla la carga. Imagen remota
  usa referrerPolicy=no-referrer. CSP solo amplía img-src a HTTPS; mantiene scripts
  y estilos locales. No se interpreta HTML remoto en el módulo nuevo.
- No se inventa moneda: el modelo no la especifica y la UI muestra importe decimal.
- Disponibilidad es calculada leyendo inventario si existe; SIN_CONFIGURAR indica
  ausencia de registro. Activación de catálogo no promete disponibilidad para compra.

## Interfaz por rol

Se conservó HTML/CSS/JS y se evolucionó la identidad verde, tipografía, espacios y
navegación. Hay estados vacíos, mensajes de éxito/error, imagen predeterminada,
controles de paginación, etiquetas y adaptación móvil.

- CLIENTE: Inicio, Catálogo, NutriVida AI, Mi perfil y Cerrar sesión.
- EMPLEADO: Catálogo y Cerrar sesión.
- ADMINISTRADOR: Catálogo, Categorías, Ingredientes, Productos y Cerrar sesión.
  Se conserva además Consultas para la revisión ya existente; no es un módulo nuevo.
- Categorías e ingredientes: formularios/listados independientes, edición y validación.
  Categorías dispone de activación/desactivación; ingredientes no tiene estado ficticio.
- Productos: formulario independiente, categoría seleccionable, precio/imagen/descripción,
  ingredientes normalizados con cantidades opcionales, publicación y listado administrativo.
- Los cinco heredados aparecen al administrador; el panel histórico ayuda a completarlos
  manualmente sin convertir automáticamente el texto anterior ni inventar información.
- No se muestran módulos funcionales de inventario, pedidos o dashboard.

Capturas con **datos exclusivamente sintéticos**, no productos reales publicados:

- [Catálogo escritorio](evidencias/fase4-catalogo-desktop.png).
- [Catálogo móvil](evidencias/fase4-catalogo-movil.png).
- [Administración](evidencias/fase4-administracion.png).

## Auditoría

En la misma transacción de cada operación administrativa:
CREAR_CATEGORIA, ACTUALIZAR_CATEGORIA, DESACTIVAR_CATEGORIA,
CREAR_INGREDIENTE, ACTUALIZAR_INGREDIENTE, CREAR_PRODUCTO,
ACTUALIZAR_PRODUCTO, DESACTIVAR_PRODUCTO y ASOCIAR_INGREDIENTE_PRODUCTO.
La asociación representa el conjunto enviado, incluido un reemplazo por conjunto
vacío. Una reactivación se registra como actualización. No se generan eventos de
baja de ingrediente porque esa acción no existe en el modelo.

Se guarda usuario identificado, acción, entidad, ID, recurso fijo y fecha. No se
registran payloads completos, contraseñas, tokens ni secretos. Los eventos de
seguridad de FASE 3 continúan operativos.

## Pruebas y evidencia

- `npm.cmd test`: **82 aprobadas, 0 fallidas, 0 omitidas**.
- Se conservaron las 67 regresiones: la prueba PostgreSQL de productos ahora crea
  categoría/ingredientes explícitos y envía IDs; el contador técnico espera cuatro
  migraciones. No se eliminaron pruebas válidas.
- FASE 4 aporta 15 entradas al conteo de Node: validación, contenedor PostgreSQL y
  13 subpruebas. Cubre categorías, duplicados normalizados, edición, desactivación,
  ingredientes, asociaciones, RBAC de lectura/escritura, legado inactivo, precios,
  categoría inexistente/inactiva, búsqueda combinada, paginación, inyección como dato,
  payload, edición atómica, baja lógica con detalle histórico y auditoría atómica.
- `npm.cmd run test:browser`: **11 comprobaciones aprobadas, 0 fallidas**, adicionales
  a la suite de 82; ejecutadas en Edge headless real, que usa el mismo protocolo CDP
  del verificador Chrome/Edge. Login/navegación de tres roles, tarjetas, filtro,
  detalle, móvil sin desbordamiento, formularios, asociación, edición y desactivación.
  Sin excepciones JavaScript ni errores CSP. Capturas inspeccionadas visualmente.
- `npm.cmd run uml:validar`: cinco diagramas válidos.
- `npm.cmd audit --omit=dev`: 0 vulnerabilidades reportadas.
- Migración real aplicada con huellas de filas intactas; servidor reiniciado con
  persistencia postgres. Página, catalogo.js, SVG y salud HTTP 200; productos,
  categorías e ingredientes sin token HTTP 401. Helmet permanece activo.

Durante la implementación, dos expectativas antiguas fallaron por el nuevo contrato
normalizado y la cuarta migración; se adaptaron preservando sus verificaciones.
La prueba inicial de Chrome tuvo problemas de sincronización/cierre del navegador:
se añadieron esperas de carga y timeout CDP, se limpió el esquema temporal interrumpido
y se completó la prueba en Edge. Ninguno de esos intentos afectó datos reales.

Las pruebas de base se ejecutan en esquemas aleatorios validados nv_test_* de
nutrivida_test_db y los eliminan al terminar. Las pruebas históricas JSON usan
archivos temporales, nunca data/db.json. No hay dual-write ni fallback.

## Cómo probar manualmente

1. Abrir http://localhost:3000, recargar Ctrl+F5 e iniciar sesión normalmente.
   El servidor ya quedó actualizado. En otra instalación ejecutar db:migrar antes
   de npm.cmd start. No cambiar JWT_SECRET ni ENCRYPTION_KEY.
2. CLIENTE: Inicio → Catálogo. Con los cinco heredados todavía inactivos se verá el
   estado vacío; es el comportamiento correcto. Cuando un administrador complete y
   active un producto, probar búsqueda, filtros y detalle. Perfil/IA siguen disponibles.
3. EMPLEADO: comprobar que solo tiene Catálogo y salida. No aparecen formularios de
   administración; solicitudes administrativas directas reciben 403.
4. ADMINISTRADOR explícito: crear/editar categoría, crear/editar ingrediente y abrir
   Productos. Editar uno de los heredados, introducir datos reales, seleccionar
   categoría e ingredientes y un precio válido. Activar y comprobar visibilidad.
   Desactivar para retirarlo del catálogo sin perder el registro. No hace falta stock.
5. Probar desactivar una categoría que tiene productos activos: debe explicar el 409.
   Desactivar esos productos primero y repetir. Ingredientes no ofrece un estado inexistente.
6. Probar una ficha sin imagen: aparece el placeholder. Una URL inválida muestra error;
   HTTPS válida se carga como imagen sin habilitar scripts externos.
7. Cerrar sesión y volver a ingresar; la revocación y RBAC continúan funcionando.
8. `npm.cmd test` ejecuta toda la suite; `npm.cmd run test:fase4` aísla el catálogo.
   `npm.cmd run test:browser` necesita Chrome/Edge local y ambas DB configuradas;
   solo usa datos sintéticos. Puede requerir permisos de ejecución del navegador.

No se creó ni promovió ninguna cuenta real. Si no existe un ADMINISTRADOR, su alta
requiere el procedimiento explícito existente con SEED_ADMIN_* y correo nuevo;
`npm.cmd run seed` no promueve una cuenta ya existente. No compartir credenciales.

## Deuda y diferencias restantes

- FASE 5 establecerá administración de existencias/movimientos y sus reglas. El
  catálogo activo aún no equivale a habilitación de compra; no hay carrito/pedidos.
- Definir moneda de presentación antes de incorporar compra; hoy no se infiere.
- Catálogos grandes pueden necesitar índice trigram para búsquedas por subcadena;
  no se instaló extensión. Los índices actuales apoyan unicidad, joins y ordenación;
  no se afirma que B-tree acelere todas las búsquedas ILIKE '%texto%'.
- Conteo y página se leen en dos consultas; una edición concurrente puede variar el
  total entre ambas. Escrituras comerciales sí son atómicas y coordinadas.
- El bloqueo transaccional de escritura es global al catálogo, adecuado al prototipo;
  ajustar granularidad si aumenta la concurrencia. Paginación de categorías/ingredientes
  existe en backend; sus formularios cargan páginas completas de referencias en la UI.
- Se preservan adaptadores/clases/controles del catálogo anterior para contratos de
  pruebas JSON y servicios legados. El servidor real monta solo el catálogo comercial
  PostgreSQL. No se implementa catálogo nuevo en JSON ni escritura simultánea.
- El detalle comercial usa objetos DTO validados para los campos del modelo relacional;
  la clase Producto legada permanece para servicios existentes. No se reemplaza la
  arquitectura por objetos JSONB: nuevos ingredientes siempre son relaciones SQL.
- El diagrama de componentes sigue representando React/TypeScript y arquitectura
  final; se conserva HTML/CSS/JS por autorización explícita. Secuencia IA aún representa
  módulos futuros; Claude, contexto actual y rutas existentes permanecen.
- UC6: mejora documental de asociaciones de Empleado/Administrador descrita arriba;
  los permisos implementados son los autorizados expresamente para esta fase.
- Se mantienen las deudas de despliegue/retención y gestión completa de usuarios de
  FASE 3. No se añadió ninguna función operativa de FASE 5 o posterior.
