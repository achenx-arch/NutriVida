# Reporte final de FASE 3 — Autenticación, RBAC y ciberseguridad base

**FASE 3 COMPLETADA.** Cierre: 29 de septiembre de 2026.
No se avanzó a FASE 4. PostgreSQL sigue siendo la única fuente activa.

## Referencias y decisiones aprobadas

Se revisaron los cinco UML oficiales, trazabilidad de FASE 1 y FASE 2, autenticación,
rutas, servicios, repositorios, frontend y metadatos reales de PostgreSQL.
La aprobación posterior al preanálisis autorizó usuario opcional en auditoría y
corregir referencias indefinidas/duplicadas del diagrama de casos de uso.

| Requerimiento/regla | Referencia | Implementación |
|---|---|---|
| Autenticación, JWT, cuenta activa | UC1/UC2; Usuario/Rol; AUTH/SEC/RUSER | auth.js, sistema.js, usuarios PostgreSQL; bcrypt conservado, HS256 y expiración |
| Backend como autoridad RBAC | Roles definitivos; UC3/5/11/15/18; SEC | autenticarUsuario, requerirRol/requerirRoles/requerirPermiso |
| Propiedad de perfil e historial | UC3/UC15; perfil_cliente y conversaciones_ia | Identidad persistida del token; nunca UUID del body/query para elegir propietario |
| Auditoría anónima aprobada | Modelo y clases de Auditoria; AUD/RAUD | FK nullable, LOGIN_FALLIDO con NULL y datos mínimos |
| Headers, límites, validaciones | Ciberseguridad base; API/SEC | Helmet, CSP, rate limiting, CORS y middleware de validación |
| Cierre de sesión | Revisión de logout de FASE 3; AUTH/AUD/RAUD | Evento LOGOUT y huella SHA-256 del token para revocación persistente |
| Preservar datos de FASE 2 | UUID, hashes, cifrado, migraciones inmutables | Comparación de huellas de todas las filas antes/después de la migración |

## UML modificados

- `docs/uml/1. Modelo_Relacional_NutriVida_AI.txt`: auditoria.id_usuario admite NULL;
  cardinalidad Usuario 0..1 por evento, conservando FK.
- `docs/uml/3. Casos_Uso_NutriVida_AI.txt` (clases): Usuario 0..1 — Auditoria.
- `docs/uml/2. Casos_Uso_NutriVida_AI.txt`: eliminadas UC51 y UC52, que no tenían
  definición funcional; eliminadas dos conexiones duplicadas empleado → UC2.
  Se conserva empleado → UC2/UC5 y todas las funciones definidas de los demás roles.
- Secuencia y componentes: sin modificaciones.

Los cinco validaron con PlantUML 1.2025.10. La nueva prueba semántica verifica que
cada UC referenciado esté declarado y no existan conexiones duplicadas: PlantUML
aceptaba las referencias implícitas y la validación sintáctica anterior no bastaba.
Los permisos futuros del empleado en inventario/pedidos siguen sujetos a sus fases;
no se eliminó una función declarada ni se concedieron permisos administrativos.

## Migración y preservación

Creada y aplicada `database/migrations/002_auditoria_usuario_opcional.sql`:

- Retira solamente NOT NULL de auditoria.id_usuario; mantiene FK y datos existentes.
- Añade índice parcial de recurso_accedido para eventos LOGOUT y búsqueda de revocación.
- No cambia las 16 tablas de negocio ni añade tablas.

El migrador confirmó 001_esquema.sql y 001_roles.sql como ya aplicadas, sin cambiar
sus checksums. El control técnico ahora contiene tres registros. La comparación
ordenada de huellas de **todas las filas de las 16 tablas** resultó idéntica antes y
después de migrar. `.env`, `data/db.json` y ambos SQL originales permanecieron
intactos. No se reimportó JSON ni se modificaron contraseñas, claves o roles reales.

## Archivos creados

- `database/migrations/002_auditoria_usuario_opcional.sql`.
- `src/middleware/validarSolicitud.js`.
- `src/middleware/seguridadHttp.js`.
- `tests/fase3.test.js`.
- `docs/trazabilidad-fase3.md` (iniciado como preanálisis; actualizado con evidencia final).

## Archivos modificados

- Los UML 1, 2 y 3 indicados arriba.
- `src/security/auth.js`: JWT y RBAC; verificación de revocación de sesión.
- `src/security/validate.js`: UUID compartido y límites del registro.
- `src/config/env.js`: CORS_ORIGINS y modo de producción.
- `src/app.js`: composición de headers, limitadores, CORS y auditoría por petición.
- `src/routes/auth.routes.js`: validación estricta y logout autenticado.
- `src/routes/perfil.routes.js`: solo CLIENTE y validación de perfil propio.
- `src/routes/consultas.routes.js`: body/query/UUID y roles existentes.
- `src/routes/productos.routes.js`: parámetros, campos y tamaños permitidos.
- `src/domain/modelos.js`: eventos de auditoría con usuario NULL.
- `src/services/sistema.js`: LOGIN_EXITOSO/LOGIN_FALLIDO y comparación bcrypt uniforme.
- `src/services/auditService.js`: fachada compatible que respeta el driver activo;
  deja de instanciar directamente JSON y dispone de cierre del pool.
- `src/repositories/postgres/auditoria.js`: consulta parametrizada de revocación.
- `src/repositories/postgres/base.js`: duplicados como HTTP 409.
- `src/repositories/index.js`: revocación en adaptador JSON de pruebas/compatibilidad.
- `src/repositories/usuarios.js`: inactivos y duplicados 409 en compatibilidad JSON.
- `public/app.js`: logout remoto y listener de revisión sin JavaScript inline.
- `tests/fase1.test.js`, `tests/sistema.test.js`, `tests/postgres.test.js`,
  `tests/uml.test.js`: regresiones conservadas y ampliadas.
- `package.json`, `package-lock.json`, `.env.example`, `README.md`.
- Logs locales del servidor regenerados al reiniciar; no contienen credenciales.

## Dependencias

Añadidas directamente: **helmet 8.3.0** y **express-rate-limit 8.7.0**.
No se añadió Zod, ORM ni dependencias de módulos posteriores.
Se fijó mediante override la dependencia transitiva **qs 6.16.0**: los rangos de
Express/body-parser mantenían una versión afectada. No se actualizó Express de major.

Avisos revisados: [GHSA-4mjr-xmp4-gh2g](https://github.com/advisories/GHSA-4mjr-xmp4-gh2g)
y [GHSA-x5fp-wj9c-mxmx](https://github.com/advisories/GHSA-x5fp-wj9c-mxmx).
Resultado final de `npm.cmd audit --omit=dev`: **0 vulnerabilidades reportadas**.
Esto es evidencia del análisis de dependencias, no una garantía de ausencia de fallos.

## Controles implementados

- Registro siempre CLIENTE; un rol enviado por el navegador se rechaza como propiedad
  inesperada. Nombre/correo con límites de columnas; contraseña nueva mínimo 8
  caracteres, máximo 72 bytes UTF-8 para evitar truncamiento silencioso de bcrypt.
- Hash bcrypt con coste 10; se conservan hashes históricos. Login mantiene respuesta
  genérica para usuario inexistente, inactivo o contraseña incorrecta. Comparación
  contra hash simulado si no hay cuenta para reducir diferencias de coste evidentes;
  no se promete igualdad absoluta de tiempos.
- JWT firmado HS256, expiración 8 horas y jti aleatorio por emisión. Se rechazan otros
  algoritmos, sujeto no UUID, expiración ausente, token vencido y Bearer malformado.
  JWT antiguos correctamente firmados y con expiración siguen funcionando; su rol
  no sustituye el de PostgreSQL. Cuenta inactiva o inexistente invalida el acceso.
- Logout POST /api/auth/logout autenticado. Registra una huella SHA-256, nunca JWT
  completo, y cada petición protegida consulta su revocación. Persiste tras reiniciar
  y afecta solo ese token. Otras sesiones siguen válidas. Si falla logout, el frontend
  no anuncia cierre exitoso ni elimina silenciosamente la sesión local.
- Perfil/historial usan req.usuario.id. Body y query con UUID ajeno se rechazan;
  rutas por UUID para perfil/historial no existen y devuelven 404.
- Esquemas pequeños centralizados: tipos, tamaños, UUID de recursos y listas exactas
  de campos. Registro/login/perfil/productos/consultas rechazan propiedades inesperadas;
  las rutas actuales no admiten query. No se limita la seguridad a ocultar botones.
- Helmet con CSP script-src 'self', script-src-attr 'none' y estilos locales.
  La revisión administrativa usa listeners. En desarrollo HTTP local no se fuerza
  upgrade-insecure-requests ni HSTS; production los habilita y requiere HTTPS.
- CORS sin wildcard. CORS_ORIGINS contiene una lista exacta separada por comas;
  vacía no concede lectura desde otros orígenes. La web del mismo origen funciona.
  CORS no reemplaza autenticación ni impide por sí mismo peticiones de otros clientes.
- Limitadores por IP y proceso: API 600/15 min; login 30/15 min; registro 20/15 min;
  consultas POST 30/min. Devuelven 429, Retry-After y headers RateLimit.
  No se confía en X-Forwarded-For mediante trust proxy indiscriminado.
- Errores centralizados sin stack, SQL, claves o mensajes internos. 400 validación,
  401 autenticación, 403 permisos, 404 inexistente, 409 conflicto, 429 límite,
  500 interno y 503 almacenamiento/proveedor no disponible. Se conservan 413 y los
  códigos específicos anteriores de IA para mantener contratos válidos.

## Matriz RBAC de rutas existentes

| Operación | CLIENTE | EMPLEADO | ADMINISTRADOR |
|---|---|---|---|
| Login / logout | Sí | Sí | Sí |
| Catálogo GET /api/productos | Sí | Sí | Sí |
| Perfil propio GET/PUT /api/perfil | Sí | No | No |
| Consulta IA POST /api/consultas | Sí | No | No |
| Historial propio GET /api/consultas | Sí | No | No |
| Historial administrativo /api/consultas/admin | No | No | Sí |
| Marcar consulta revisada | No | No | Sí |
| Crear/editar/eliminar productos | No | No | Sí |

Registro público solo crea CLIENTE. Salud y archivos públicos no requieren token.
Gestión completa de categorías, ingredientes, inventario, pedidos, usuarios, auditoría
y dashboard no se añadieron como rutas nuevas. La revisión administrativa de consultas
conserva el permiso existente aprobado; no habilita perfil ajeno ni edición ajena.

## Eventos de seguridad

| Evento | Identidad y contenido |
|---|---|
| LOGIN_EXITOSO | Usuario real y recurso fijo usuarios; sin credenciales |
| LOGIN_FALLIDO | id_usuario NULL, auth/login, fecha; no guarda correo intentado ni contraseña |
| ACCESO_DENEGADO | Usuario autenticado, recurso fijo api/protegida y fecha |
| LOGOUT | Usuario real y recurso sesion/<sha256>; sin token recuperable |

Se mantienen eventos anteriores de registro, perfil, catálogo y consultas.
Los intentos que el limitador rechaza no escriben otro evento por cada solicitud.
CAMBIO_ROL no se fabrica: todavía no existe una operación de gestión de roles en
la aplicación. Las pruebas cambian roles en datos sintéticos directamente por SQL;
eso comprueba permisos persistidos, no implementa ni audita un módulo nuevo.
Su evento transaccional pertenece a la futura operación administrativa correspondiente.

## Pruebas y errores corregidos

`npm.cmd test`: **67 aprobadas, 0 fallidas, 0 omitidas** (incluye contenedores de Node).
Se conservan las 51 pruebas anteriores, adaptando expectativas que FASE 3 endurece:
registro con rol inesperado ahora 400, duplicado 409, nombre de evento LOGIN_EXITOSO,
login con solo correo/password, tokens de prueba con expiración y control de tres
migraciones. No se eliminaron casos de regresión válidos.

Añadidas 16 pruebas: 11 casos de FASE 3, 3 subpruebas PostgreSQL reales y 2 de frontend.
Cubren login correcto/incorrecto/inexistente, auditoría NULL/identificada, JWT inválido,
expirado/sin exp/algoritmo distinto, falta de token, RBAC por tres roles, cuenta inactiva,
roles cambiados con JWT vigente, UUID y payload, propiedad, 409, límites, Helmet/CORS,
ausencia de hashes/secretos, logout persistente y navegación compatible con CSP.
Las regresiones conservan PostgreSQL y el arranque/API sin proveedor IA.

Errores detectados durante implementación y corregidos:

- La cadena de middleware de autenticación ignoraba el error enviado al callback:
  ahora lo propaga antes de resolver req.usuario, conservando 401 en lugar de 500.
- Fixtures de login enviaban nombre; se ajustaron al contrato estricto y se añadió
  prueba específica de rechazo de propiedades inesperadas.
- El fixture de JWT antiguo no tenía expiración; se preservó la prueba de compatibilidad
  con expiración válida y se añadió el caso de rechazo sin exp.
- El handler inline era incompatible con CSP; se reemplazó y probó con eventos DOM.
- La auditoría de dependencias detectó qs vulnerable; override a versión corregida,
  reinstalación y suite completa satisfactoria.

Verificaciones adicionales:

- Cinco UML válidos y prueba semántica de referencias/conexiones.
- Nueva migración aplicada en base principal, sin modificar SQL previos ni filas.
- FK nullable comprobada en PostgreSQL real, FK no nula inválida sigue rechazada.
- npm audit: 0 vulnerabilidades.
- Servidor reiniciado con persistencia postgres en http://localhost:3000.
- /, /styles.css, /app.js y /api/salud: 200 y headers Helmet; /api/perfil sin token: 401.
- Ninguna prueba usó cuentas/contraseñas personales reales o llamó al proveedor IA.
  Pruebas PostgreSQL en esquemas temporales de nutrivida_test_db; limpieza al terminar.
- Frontend probado con DOM simulado; la revisión visual manual no se sustituye por ello.

## Comprobación manual

1. Abrir http://localhost:3000 y recargar con Ctrl+F5; iniciar sesión normalmente.
2. Cliente: revisar/guardar su perfil y ver su historial. Empleado: catálogo sin CRUD.
   Administrador explícito, si existe: CRUD/revisión. No se promovieron cuentas reales.
3. Cerrar sesión y comprobar retorno al login. Un JWT copiado antes de cerrar debe
   devolver 401 en /api/perfil; una sesión distinta del mismo usuario sigue funcionando.
4. En herramientas del navegador comprobar CSP y X-Content-Type-Options. Las acciones
   de revisión deben funcionar sin handlers inline. La consola no debe mostrar CSP
   bloqueando scripts legítimos del propio proyecto.
5. Verificar límites mediante `npm.cmd run test:fase3` con valores bajos aislados;
   no hace falta bloquear deliberadamente la IP de la demostración real.
6. Ejecutar `npm.cmd test` para toda la suite. Para una instalación existente en otro
   equipo aplicar `npm.cmd run db:migrar` antes de arrancar esta versión.
7. Sin IA: la prueba automatizada ya cubre funcionamiento y HTTP 503 controlado.
   Para prueba manual, en una terminal aparte usar ANTHROPIC_API_KEY con un espacio
   y arrancar el servidor; no cambiar .env ni secretos para esta comprobación.

## Deuda y diferencias restantes

- Sesiones siguen usando Bearer en localStorage; migración a cookies HttpOnly exigiría
  diseño CSRF y cambios explícitos de contratos. No se implementaron refresh tokens,
  recuperación de contraseña ni cierre global de todas las sesiones.
- Revocación usa auditoría persistente e índice; no eliminar eventos LOGOUT de tokens
  aún vigentes. Plan de retención/volumen y almacén compartido de limitadores quedan
  para despliegue con varios procesos. Los límites actuales se reinician con el proceso.
- HTTPS y configuración exacta de proxy/orígenes deben ajustarse al despliegue real;
  no habilitar trust proxy globalmente. Renovar revisión de dependencias periódicamente.
- La búsqueda actual de usuario hidrata perfil en memoria; separar identidad mínima
  de carga del perfil puede reducir trabajo en autenticación. No se imprime su contenido.
- CAMBIO_ROL, auditoría de gestión de usuarios y consulta administrativa de bitácora
  se conectarán al implementar esas operaciones; no hay endpoints ficticios ahora.
- UML representa arquitectura final: React/TypeScript, Ollama, pedidos, inventario,
  consumo y personalización siguen pendientes. Se conserva HTML/CSS/JS, Claude y
  /api/consultas con {texto}; no se reconstruyó la interfaz ni se avanzó a FASE 4.
- Los dos UML ajustados y PostgreSQL coinciden en la identidad opcional de auditoría.
  La revocación es un detalle técnico del componente AUTH/AUD, sin tabla nueva ni
  contradicción de cardinalidades. Los alias de clases/DTO de compatibilidad continúan.
