# Reporte de FASE 2 — PostgreSQL e importación controlada

**Estado: FASE 2 COMPLETADA.**
Cierre verificado el 29 de septiembre de 2026. Conexiones correctas a
`nutrivida_db` y `nutrivida_test_db`; migraciones e importación real verificadas.
PostgreSQL es la fuente principal mediante `PERSISTENCE_DRIVER=postgres` en `.env`.
Se preservaron JWT_SECRET, ENCRYPTION_KEY y el JSON original. No se avanzó a FASE 3.

## UML oficiales

Los nombres reales siguen siendo los cinco `.txt` dentro de `docs/uml/`.
Se actualizaron antes de crear SQL y se validaron los cinco con PlantUML
1.2025.10 (`-checkonly -charset UTF-8`), código de salida 0.
El JAR se descargó como herramienta temporal; no se añadió como dependencia.

| Diagrama | Modificación aprobada |
|---|---|
| `1. Modelo_Relacional_NutriVida_AI.txt` | UUID históricos y FK; TIMESTAMPTZ; usuario opcional en errores; inventario 0..1; productos incompletos; JSONB histórico; estado/revisión/interacción; recurso de auditoría; tabla técnica. |
| `2. Casos_Uso_NutriVida_AI.txt` | Empleado y administrador pueden consultar UC5; empleado no recibe UC18. |
| `3. Casos_Uso_NutriVida_AI.txt` (clases) | Identificadores UUID, campos de preservación, cardinalidad opcional y EstadoConsulta. |
| `4. Secuencia_IA_NutriVida.txt` | Sin cambios. |
| `5. Componentes_NutriVida_AI.txt` | Sin cambios. |

Dos detalles de persistencia conservan los formularios existentes sin emplear
JSONB para datos nuevos: `productos.valores_nutricionales TEXT` y
`preferencias_cliente.descripcion TEXT` con `version_cifrado`. El segundo permite
cifrar nuevas declaraciones sin truncarlas al tamaño VARCHAR(200) inicial.
Los textos antiguos permanecen exactamente en datos_legado; no se convierten
automáticamente en preferencias, ingredientes ni consentimiento.

## Trazabilidad

| Requerimiento / caso de uso | Clases / modelo | Componente / código |
|---|---|---|
| UUID, acceso UC1/UC2 | Usuario/Rol; usuarios/roles | RUSER: `repositories/postgres/usuarios.js`; AUTH conserva bcrypt/JWT. |
| Perfil UC3/UC4 | PerfilCliente/PreferenciaCliente; perfil_cliente/preferencias_cliente | RUSER: lectura cifrada legada y escritura nueva normalizada. No UI nueva de preferencias. |
| Catálogo UC5/UC18 | Producto/Categoria/Ingrediente; cuatro tablas de catálogo | RPROD: adapter del CRUD existente, sin precios/stock inventados ni catálogo completo de FASE 4. |
| IA UC11/UC15/UC16 | ConversacionIA/MensajeIA; conversaciones_ia/mensajes_ia | NAI → RAI: adaptadores consultas/interacciones, propietario filtrado y mensajes cifrados. Claude permanece. |
| UC17 y seguridad | ErrorSistema/Auditoria | Errores controlados, tabla errores_sistema preparada; auditoría existente usa PostgreSQL. Registro ampliado queda pendiente. |
| Integridad futura | Inventario/Pedido/DetallePedido | Tablas y restricciones presentes en SQL; sin flujos comerciales. |
| Secuencia y componentes | Servicio → repositorio → PostgreSQL | Pool, transacción, migrador y selector explícito. El navegador no accede a la base ni al proveedor IA. |

## Esquema

16 tablas de negocio: roles, usuarios, perfil_cliente, preferencias_cliente,
categorias, productos, ingredientes, producto_ingrediente, inventario,
movimientos_inventario, pedidos, detalle_pedido, conversaciones_ia, mensajes_ia,
auditoria y errores_sistema. Tabla técnica: `infra.schema_migrations`.

UUID: usuarios, perfil_cliente, productos, conversaciones_ia, auditoria y sus FK.
El resto usa identidades BIGINT; producto_ingrediente tiene PK compuesta.
`auditoria.id_entidad TEXT` admite referencias polimórficas UUID/BIGINT.
PK/FK/UNIQUE/CHECK/NOT NULL protegen integridad; los índices cubren propietario,
referencias y búsquedas. El correo es único tras normalizar espacios y mayúsculas.
Los números comerciales excluyen negativos/cero según su función y valores NaN.
Triggers diferidos protegen pedido con al menos un detalle y conversación con al
menos un mensaje al COMMIT. No implementan confirmación, inventario o venta.
Las fechas históricas desconocidas son NULL; no se rellenan con la fecha de importación.

## Preservación y datos nuevos

- UUID y hashes se copian, sin renumeración ni regeneración de contraseñas.
- Se preservan las cadenas cifradas y la versión; no se imprimen contenidos.
- El nombre completo no se divide para inventar apellidos.
- Cuentas existentes se mantienen habilitadas para conservar login. Rol origen
  y área se conservan solo como trazabilidad; no conceden privilegios.
- Perfil histórico: JSONB contiene únicamente los tres campos cifrados y versión.
  Nuevas ediciones del formulario utilizan tipos de declaración en preferencias,
  cifrados y versionados. Consentimiento histórico NULL, nunca supuesto TRUE.
- Categorías se obtienen de valores realmente existentes. Ingredientes/texto
  nutricional históricos se preservan en JSONB. Nuevas ediciones usan columnas
  y relaciones. Nuevos productos del formulario incompleto también quedan inactivos.
- Una conversación conserva el UUID de consulta, estado, revisión e identidad de
  interacción. Datos de interacción sin equivalente se preservan delimitados en
  JSONB. Pregunta → USUARIO; respuesta → ASISTENTE solo si existe. No títulos ni
  fechas de actualización inventados. La conversación nueva actual también
  conserva el contrato de estado/revisión de los servicios existentes.
- Auditoría conserva recurso completo. id_entidad solo se extrae de una ruta
  simple inequívoca; no se asigna a rutas compuestas como usuarios/id/consultas.

## Conteos y ejecución

Validación real del JSON (sin escribir ni descifrar):

| Entidad | Origen | Destino esperado | Destino real |
|---|---:|---:|---|
| Usuarios | 2 | 2 | 2 |
| Perfiles | 1 | 1 | 1 |
| Productos | 5 | 5 inactivos | 5 inactivos |
| Categorías distintas | 3 | 3 | 3 |
| Consultas / conversaciones | 4 | 4 | 4 |
| Interacciones | 4 | Referencias conservadas | 4 referencias |
| Mensajes USUARIO | 4 preguntas | 4 | 4 |
| Mensajes ASISTENTE | 0 respuestas | 0 | 0 |
| Auditoría | 22 | 22 | 22 |
| Inventario | Sin información | 0 filas | 0 |

Todas las consultas históricas están en ERROR. El JSON guardado al momento del
corte contenía 22 auditorías, frente a las 19 del preanálisis; se importaron las
22 reales. No se generaron respuestas para estas consultas.

Migraciones reales: `migrations/001_esquema.sql` y `seeds/001_roles.sql`, ambas
aplicadas y registradas con checksum en `infra.schema_migrations` (2 registros).
Se comprobaron las 16 tablas de negocio. Roles: 3 definiciones; cuentas: 1 CLIENTE,
1 EMPLEADO, 0 ADMINISTRADOR. No se promovió ninguna cuenta.

Importación real: **satisfactoria y verificada** mediante transacción y posterior
verificación independiente. Se detuvo el servidor JSON antes de importar y se
reinició usando PostgreSQL después de verificar. El respaldo privado
`data/backups/db-<sha256>.json` y el JSON original son idénticos byte por byte.
Se comprobaron UUID, hashes, cadenas cifradas, fechas, relaciones y referencias
de interacción sin mostrar ni descifrar los datos históricos.
Preferencias, ingredientes normalizados, producto_ingrediente, inventario,
movimientos, pedidos, detalles y errores permanecen sin filas al cierre del corte.
Fuente principal actual: **PostgreSQL**. No hay dual-write ni fallback automático.
Credenciales exclusivamente en `.env`; se retiraron los valores DB del ejemplo.

## Archivos creados

- `database/migrations/001_esquema.sql`, `database/seeds/001_roles.sql`.
- `database/scripts/comun.js`, `migrar.js`, `validar-json.js`, `importar-json.js`,
  `verificar-importacion.js`, `validar-uml.js`.
- `src/database/pool.js`, `transaccion.js`, `migraciones.js`, `importacion.js`.
- `src/repositories/crearRepositorios.js`.
- `src/repositories/postgres/base.js`, `index.js`, `usuarios.js`, `productos.js`,
  `consultas.js`, `interacciones.js`, `auditoria.js`.
- `tests/fixtures/fase2.js`, `tests/importacion.test.js`, `tests/postgres.test.js`.
- `docs/trazabilidad-fase2.md`.

## Archivos modificados

- Los diagramas 1, 2 y 3 indicados arriba.
- `src/config/env.js`, `src/domain/roles.js`, `src/server.js`, `src/seed.js`.
- `src/services/sistema.js`, `src/services/consultasService.js`.
- `public/app.js`: presentación coherente con empleado sin privilegios legados.
- `tests/sistema.test.js`, `tests/fase1.test.js`, `tests/uml.test.js`: se conservan
  regresiones; solo se actualizan expectativas de permisos ya revocadas por decisión aprobada.
- `package.json`, `package-lock.json`, `.env.example`, `.gitignore`, `README.md`.
- `.env` local: selección de PostgreSQL, conservando las claves y credenciales.
- `server.stdout.log` / `server.stderr.log`: regenerados al reiniciar el servidor;
  no son código ni contienen credenciales. Respaldo privado en `data/backups/`.

Dependencia directa añadida: **pg 8.23.0**, con sus dependencias transitivas. Sin ORM,
Zod, Helmet, rate limiting u Ollama. La versión exacta queda en package-lock.json.

## Pruebas y límites de la evidencia

`npm.cmd test`: **51 aprobadas, 0 fallidas, 0 omitidas**. El ejecutor cuenta
35 pruebas principales y 16 subpruebas PostgreSQL; entre las principales está
el contenedor de esas 16. Se ejecutó antes y después de seleccionar PostgreSQL.
Incluye las 25 regresiones previas, 9 pruebas de importador/infraestructura y la
suite real PostgreSQL, sin sustituirla por mocks.

La suite `tests/postgres.test.js` comprueba conexión, migración desde esquema
vacío, repetición, 16 tablas + control, PK/FK/UNIQUE/CHECK, UUID/TIMESTAMPTZ,
COMMIT/ROLLBACK, importación, repetición/conflicto, hashes/cifrado, normalización,
permisos, aislamiento y API sin IA. Usa `nutrivida_test_db` y esquemas temporales
propios; elimina solo esos esquemas al terminar. Los datos de prueba son sintéticos.

Otras verificaciones ejecutadas:

- Conexiones reales a ambas bases, en el orden solicitado: correctas.
- `npm.cmd run db:migrar`: esquema y roles aplicados.
- `npm.cmd run db:validar-json`: satisfactorio, con los conteos de este reporte.
- `npm.cmd run db:importar-json -- --confirmar-corte`: `verificada: true`.
- `npm.cmd run db:verificar-importacion`: `verificada: true`.
- `npm.cmd run uml:validar`: los cinco diagramas válidos con PlantUML.
- Sintaxis: 52 archivos JavaScript correctos en la preparación de esta fase.
- Huellas de JSON y claves JWT/cifrado: sin cambios durante el corte.
- Servidor real en `http://localhost:3000`, arranque identificado como `postgres`.
  `/`, `/styles.css` y `/api/salud`: HTTP 200; `/api/perfil` sin token: HTTP 401.
  Login, CRUD, perfil e historial se verificaron con PostgreSQL y cuentas sintéticas
  en pruebas. No se usaron contraseñas ni se descifraron perfiles reales para logs.

No aparecieron fallos de pruebas o importación en la ejecución real. El bloqueo
previo era que las variables DB no estaban guardadas; quedó resuelto al guardarlas.
La inspección de procesos requirió lectura con permisos adicionales de Windows;
permitió identificar y detener exclusivamente el servidor anterior del proyecto.

## Comprobación manual

1. Abrir `http://localhost:3000`, recargar con Ctrl+F5 y volver a iniciar sesión
   con las credenciales habituales. Si el servidor está detenido, `npm.cmd start`.
2. Como cliente, revisar perfil e historial: se conservan las cuatro consultas
   históricas en ERROR; no aparecen respuestas inventadas. Otra cuenta solo verá
   sus propias consultas. Guardar un perfil es una operación nueva en PostgreSQL.
3. Como empleado legado, consultar catálogo: no debe tener CRUD administrativo.
   Los cinco productos importados están inactivos y carecen de precio/stock;
   no son productos habilitados para venta ni candidatos para recomendaciones IA.
4. No existe administrador creado por la migración. El CRUD se comprobó con un
   administrador sintético en la base de pruebas. Para crear uno real, utilizar
   explícitamente el proceso de alta autorizado con un correo nuevo; no promover
   automáticamente la cuenta del empleado.
5. Para comprobar sin proveedor, detener el servidor y, en una terminal nueva,
   ejecutar `$env:ANTHROPIC_API_KEY = ' '` y `npm.cmd start`. Login, perfil y catálogo
   siguen disponibles; una consulta devuelve `SERVICIO_IA_NO_CONFIGURADO` y queda
   en ERROR. Esta prueba manual sí agrega una consulta real. Cerrar esa terminal
   y reiniciar normalmente para recuperar la configuración habitual de Claude.
6. `npm.cmd test` vuelve a ejecutar las regresiones en entornos aislados; no consume
   Claude ni modifica los datos reales. La verificación de importación compara el
   estado de corte: modificaciones posteriores legítimas pueden producir conflictos.

No restaurar automáticamente JSON después de recibir escrituras en PostgreSQL.
Mantener el respaldo y acordar conciliación si se necesita volver atrás.

## Diferencias restantes y deuda técnica

El código conserva los contratos HTTP antiguos y las clases de compatibilidad;
los nuevos adaptadores los traducen al modelo relacional. El frontend sigue siendo
HTML/CSS/JS y Claude continúa como proveedor. Los diagramas de secuencia/componentes
representan la arquitectura completa futura, no funcionalidades ya entregadas.
No hay carrito, flujo de pedidos/inventario, consumo, personalización definitiva,
Ollama ni dashboard. Ajustes de inventario y sus reglas comerciales se implementarán
en su fase; esta fase solo fija restricciones de almacenamiento.
La auditoría y errores ampliados, permisos definitivos y consentimiento editable
continúan en fases posteriores. La antigua documentación FASE 1 queda como registro
histórico; las decisiones vigentes de permisos están en este reporte y README.

Referencias técnicas: [transacciones pg](https://node-postgres.com/features/transactions),
[consultas parametrizadas](https://node-postgres.com/features/queries) y
[validación PlantUML](https://plantuml.com/command-line).
