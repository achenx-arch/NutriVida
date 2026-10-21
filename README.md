# NutriAsistente IA

Asistente nutricional con Inteligencia Artificial para **NutriVida Products S.A.**
Proyecto Final — Análisis de Sistemas II (Código 037), Universidad Mariano
Gálvez de Guatemala. Trabajo individual.

Sistema de información que integra un **modelo local mediante Ollama** (FASE 8)
para orientar a clientes sobre qué productos del catálogo de NutriVida pueden
explorar. El backend selecciona candidatos reales en PostgreSQL y valida cada
respuesta; el modelo no diagnostica, no prescribe ni accede a datos o herramientas.

---

## Índice

- [Arquitectura](#arquitectura)
- [Requisitos previos](#requisitos-previos)
- [Instalación](#instalación)
- [Variables de entorno](#variables-de-entorno)
- [Ejecución](#ejecución)
- [Estructura del proyecto](#estructura-del-proyecto)
- [Seguridad implementada](#seguridad-implementada)
- [Manejo de errores](#manejo-de-errores)
- [Pruebas](#pruebas)
- [Endpoints de la API](#endpoints-de-la-api)

---

## Arquitectura

FASES 1–8 implementadas. **PostgreSQL es la fuente principal local**, con
migraciones e importación JSON verificadas. Se conservan el JSON original, su
respaldo, los UUID, hashes y datos cifrados. Inventario (FASE 5), carrito y
pedidos (FASE 6), historial de consumo (FASE 7) y NutriVida AI con Ollama
(FASE 8) están implementados; ver [trazabilidad FASE 6](./docs/trazabilidad-fase6.md),
[FASE 7](./docs/trazabilidad-fase7.md) y [FASE 8](./docs/trazabilidad-fase8.md).
FASE 9 (personalización) se desarrolló por subfases: 9A, 9B-1, 9B-2 y 9C están implementadas, verificadas
en Windows y **aprobadas y cerradas**. El uso de conversaciones anteriores como contexto no forma parte de
esas subfases y no está implementado.
FASE 9A (consentimientos independientes de perfil y de compras, y lista blanca de datos hacia Ollama) está
**aprobada y cerrada** (verificación inicial en Windows el 14/10/2026: 11/11 `EXIT=0`; aprobación formal el 15/10/2026);
ver [trazabilidad FASE 9A](./docs/trazabilidad-fase9a.md). Requiere la migración 007.
FASE 9B-1 (evaluador determinista de restricciones alimentarias declaradas en la consulta: excluye
productos incompatibles o no verificables ANTES de Ollama y re-evalúa las tarjetas) está **aprobada y cerrada**
(verificación en Windows: 13 comprobaciones `EXIT=0` con `tests\verificar-fase9b1.cmd`); ver
[trazabilidad FASE 9B-1](./docs/trazabilidad-fase9b1.md). Sin migraciones nuevas.
FASE 9B-2 («Mi alimentación»: preferencias, restricciones dietéticas y alérgenos estructurados en
`preferencias_cliente`, aplicados a NutriVida AI solo con el consentimiento de perfil) está **aprobada y cerrada**
(verificación final en Windows: 16/16 `EXIT=0`); ver [trazabilidad FASE 9B-2](./docs/trazabilidad-fase9b2.md). Sin migraciones nuevas.
FASE 9C (personalización con un resumen limitado de compras ENTREGADAS, solo con el consentimiento de historial;
bono de relevancia en el backend, nunca enviado a Ollama) está **aprobada y cerrada**
(verificación final en Windows: 19/19 `EXIT=0` con `tests\verificar-fase9c.cmd`); ver [trazabilidad FASE 9C](./docs/trazabilidad-fase9c.md). Sin migraciones nuevas.

Consulta el [reporte de FASE 2](./docs/trazabilidad-fase2.md) para UML, archivos,
reglas de preservación, resultados y comprobaciones manuales.
Los cinco diagramas oficiales están en `docs/uml/` y fueron leídos para revisar
esta fase. Sus nombres reales son:

1. [Modelo relacional](<docs/uml/1. Modelo_Relacional_NutriVida_AI.txt>).
2. [Casos de uso](<docs/uml/2. Casos_Uso_NutriVida_AI.txt>).
3. [Clases](<docs/uml/3. Casos_Uso_NutriVida_AI.txt>) (el nombre del archivo dice casos de uso, pero su contenido es de clases).
4. [Secuencia IA](<docs/uml/4. Secuencia_IA_NutriVida.txt>).
5. [Componentes](<docs/uml/5. Componentes_NutriVida_AI.txt>).

Contienen PlantUML aunque su extensión sea `.txt`. En FASE 2 se ajustaron modelo
relacional, casos de uso y clases conforme a las decisiones aprobadas; secuencia
y componentes mantienen su intención original. Los cinco fueron validados.
La [trazabilidad de FASE 1](./docs/trazabilidad-fase1.md) relaciona requerimientos,
casos, clases, modelo, secuencia, componentes y código; distingue las funciones
actuales de las pendientes e identifica decisiones necesarias antes de migrar.
Los diagramas antiguos y [su documentación](./docs/implementacion-uml.md) son
históricos y no constituyen la arquitectura objetivo.

El sistema sigue una arquitectura en tres capas (presentación, lógica de
negocio, acceso a datos), documentada en detalle en el diagrama de
componentes del documento técnico. Resumen:

```
Frontend (public/)  →  API REST (Express)  →  Lógica de negocio  →  Persistencia (PostgreSQL)
                                    ↓
                     ServicioIA → OllamaProvider (HTTP local)
                                    ↓
                       Ollama (OLLAMA_BASE_URL, OLLAMA_MODEL)
```

## Requisitos previos

- [Node.js](https://nodejs.org/) 18 o superior (se probó con Node 22).
- PostgreSQL (verificado con 18), con bases separadas para aplicación y pruebas.
- [Ollama](https://ollama.com/) local, **opcional**: solo hace falta para respuestas de NutriVida AI.
  Instala el modelo tú mismo (`ollama pull <modelo>`); la aplicación nunca descarga modelos.
  Verificado con `llama3.1:latest` (8B). Sin Ollama, el resto del sistema funciona y la IA responde 503 controlado.

## Instalación

```bash
# 1. Clonar el repositorio
git clone <url-de-tu-repositorio>
cd nutriasistente-ia

# 2. Instalar dependencias
npm install

# 3. Configurar variables de entorno
cp .env.example .env
# Edita .env y completa tus propios valores (ver sección siguiente)
```

## Variables de entorno

Copia `.env.example` a `.env` y completa los siguientes valores. **El
archivo `.env` nunca se sube al repositorio** (está en `.gitignore`).

| Variable | Descripción |
|---|---|
| `PORT` | Puerto del servidor (por defecto 3000). |
| `OLLAMA_BASE_URL` | URL del servicio Ollama (por defecto `http://localhost:11434`). |
| `OLLAMA_MODEL` | Nombre exacto de un modelo instalado (`ollama list`). Vacío: las consultas de IA devuelven HTTP 503 `SERVICIO_IA_NO_CONFIGURADO` sin llamadas externas. No hay modelo por defecto. |
| `OLLAMA_TIMEOUT_MS` | Límite (ms) que cubre conexión **y lectura completa** de la respuesta. Recomendado 60000: la primera inferencia carga el modelo en memoria. |
| `JWT_SECRET` | Cadena larga y aleatoria usada para firmar los tokens de sesión. |
| `ENCRYPTION_KEY` | Llave AES-256 (64 caracteres hex / 32 bytes) para cifrar datos sensibles. |
| `SEED_ADMIN_*` | Datos del administrador creado explícitamente con `npm run seed`. Contraseña propia obligatoria (mínimo 8 caracteres), sin valor predeterminado. Una cuenta existente conserva su rol. |

Para generar una `ENCRYPTION_KEY` válida:
```bash
node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
```

## Ejecución

```bash
# Antes del primer arranque: configurar PostgreSQL y ejecutar db:migrar (ver abajo)
# 1. Solo para una instalación nueva: cargar administrador y catálogo de ejemplo
npm run seed

# 2. Iniciar el servidor
npm start

# El prototipo queda disponible en http://localhost:3000
```

Inicia sesión como administrador con el correo/contraseña definidos en
`SEED_ADMIN_CORREO` / `SEED_ADMIN_PASSWORD` de tu `.env`, o regístrate
como cliente nuevo desde la misma pantalla.

El arranque ya no ejecuta conversiones ni reescribe el JSON existente. Se conserva
la utilidad histórica `migrarDatos` y sus pruebas sobre archivos temporales;
no se ejecutó ninguna migración sobre la base del proyecto en FASE 1.
Conserva `JWT_SECRET` y `ENCRYPTION_KEY` actuales para mantener sesiones y descifrado.

En Windows PowerShell, si `npm.ps1` está bloqueado, utiliza `npm.cmd start` y
`npm.cmd run test:uml`, sin cambiar la política de ejecución.

## Primer administrador de desarrollo (asignación de roles)

El registro público **solo crea CLIENTE** (enviar `rol` devuelve 400). Para asignar
un rol a una cuenta **que ya existe**, usa los scripts de terminal:

```powershell
npm.cmd run usuario:listar                                   # solo lectura: ID corto, nombre, correo, rol, activo
npm.cmd run usuario:asignar-rol -- <correo> ADMINISTRADOR     # CLIENTE | EMPLEADO | ADMINISTRADOR
```

`usuario:asignar-rol` valida argumentos y rol antes de conectarse, localiza la cuenta
por correo normalizado con `SELECT … FOR UPDATE`, rechaza cuentas inexistentes o
inactivas, no hace nada si el rol ya es el mismo y, en una sola transacción, cambia
únicamente `usuarios.id_rol` y `fecha_actualizacion` y registra `CAMBIO_ROL` en
`auditoria` (rol anterior/nuevo, sin correo, hashes ni datos cifrados). No crea
cuentas ni contraseñas y no toca perfiles, pedidos, conversaciones ni inventario.
Nada se promueve automáticamente. El rol se resuelve desde PostgreSQL en cada
solicitud; vuelve a iniciar sesión para que la interfaz muestre el menú del nuevo rol.

## Imágenes de productos

Solo imágenes **locales** en `public/images/productos/` (WebP preferido; PNG/JPG si es
necesario; **sin SVG**). PostgreSQL guarda únicamente `productos.imagen_url` con la forma
`/images/productos/<slug>.webp` (columna existente desde la migración 001; no hay migración
nueva). El backend rechaza URLs externas, traversal, dobles extensiones, enlaces simbólicos,
archivos vacíos o mayores de 2 MB y rutas a archivos inexistentes. La administración elige
una imagen existente con vista previa (`GET /api/productos/imagenes`, solo ADMINISTRADOR,
lectura); no hay subida desde el navegador. `public/images/producto.svg` es el respaldo
interno cuando falta la imagen. La CSP permite imágenes solo desde el propio origen.

Catálogo oficial del PDF: `docs/fuentes/catalogo-pdf/manifiesto-productos.json` conserva el
texto literal; `propuesta-carga.json` contiene la carga aprobada (categorías del sistema y 4
descripciones neutralizadas con su original y motivo). `npm run catalogo:cargar-pdf -- --admin
<correo>` simula (ROLLBACK); con `--confirmar` carga en una sola transacción, idempotente y
auditada (`cli:catalogo:cargar-pdf`). Los 20 productos quedan inactivos, sin precio, inventario,
stock mínimo ni valores nutricionales. `npm run catalogo:estado-pdf -- verificar <antes.json>`
verifica la carga en modo lectura. Los procedimientos de elaboración solo están en la documentación.

## Estructura del proyecto

```
nutriasistente-ia/
├── src/
│   ├── config/env.js          # Config centralizada (lee y valida variables de entorno)
│   ├── data/store.js          # Adaptador JSON legado y pruebas
│   ├── database/             # Pool PostgreSQL, migrador, transacciones e importador
│   ├── domain/                # Clases y enumeraciones del UML original
│   ├── repositories/          # Repositorios de usuarios, productos, consultas, interacciones y auditoría
│   ├── security/
│   │   ├── GestorSeguridad.js # Fachada de cifrado, validación y credenciales
│   │   ├── crypto.js          # Cifrado AES-256-GCM de datos sensibles
│   │   ├── validate.js        # Validación y saneamiento de entradas
│   │   └── auth.js            # Hashing de contraseñas + JWT
│   ├── services/
│   │   ├── sistema.js         # Composición, registro/login y exportaciones compatibles
│   │   ├── perfilService.js   # PerfilCliente; alias ModuloPerfilSalud
│   │   ├── catalogoService.js # Operaciones del catálogo
│   │   ├── consultasService.js # Consultas, historial y revisión
│   │   ├── contextoIA.js      # Selección explícita de campos para IA
│   │   ├── iaService.js       # ServicioIA: prompt, validación de candidatos y seguridad médica
│   │   ├── ollamaProvider.js  # Único protocolo HTTP con Ollama (errores y timeout)
│   │   └── auditService.js    # Bitácora de auditoría
│   ├── routes/                # Endpoints REST (auth, perfil, consultas, productos)
│   ├── middleware/errorHandler.js
│   ├── seed.js                 # Datos iniciales
│   ├── app.js                  # Composición de componentes y controladores
│   └── server.js               # Punto de entrada
├── public/                     # Frontend (HTML/CSS/JS sin frameworks)
├── tests/casos-prueba.md       # Evidencia de pruebas (entradas válidas e inválidas)
├── database/                    # Migraciones SQL, roles y scripts de importación
├── data/db.json                 # Origen histórico conservado; no recibe escrituras en modo PostgreSQL
├── .env.example
├── .gitignore
└── package.json
```

## Seguridad implementada

Ciberseguridad como eje transversal del proyecto (obligatorio según la
guía del curso):

- **Gestión de credenciales (RNF-01):** el secreto JWT, la llave de cifrado y
  las credenciales de PostgreSQL se leen exclusivamente de variables de entorno (`src/config/env.js`),
  nunca están escritos en el código fuente, y `.env` está excluido del
  repositorio vía `.gitignore`.
- **Cifrado de datos sensibles (RNF-02):** condiciones médicas, alergias,
  objetivo nutricional, consultas y respuestas se cifran con AES-256-GCM (`src/security/crypto.js`)
  antes de guardarse, y solo se descifran en memoria cuando se necesitan.
- **Autenticación y control de acceso (RNF-03):** todos los endpoints que
  exponen datos personales requieren un token JWT válido; las funciones
  de catálogo y revisión exigen permisos comprobados contra la cuenta persistida.
  Un rol antiguo incluido en el JWT no concede permisos por sí mismo.
- **Contraseñas con hash (RNF-04):** se usa bcrypt, nunca se almacena ni
  se compara texto plano.
- **Validación de entradas (RF-11):** toda consulta se sanea y limita en
  longitud antes de persistirse o enviarse a la IA (`src/security/validate.js`).
- **Auditoría (RF-12 / RNF-10):** cada acceso a datos sensibles o consulta
  a la IA queda registrado con usuario, acción y fecha (`src/services/auditService.js`).

## Compatibilidad temporal de FASE 1

- Roles canónicos: `CLIENTE`, `EMPLEADO`, `ADMINISTRADOR`. El registro público
  siempre crea clientes. Un empleado nuevo no recibe facultades administrativas.
- `PERSONAL_NUTRIVIDA` se presenta como `EMPLEADO`, conservando su valor original
  en el JSON original. La decisión aprobada de FASE 2 elimina los privilegios
  derivados del rol legado: se migra a EMPLEADO y el origen se conserva solo
  como trazabilidad. Catálogo de lectura para empleados; CRUD y revisión para
  ADMINISTRADOR. Ninguna cuenta se promueve automáticamente.
- `PerfilCliente` es el nombre actual de la clase; `PerfilSalud` es un alias de
  la misma clase. `ModuloPerfilSalud` también sigue exportado. Se conservan el
  campo JSON/API `perfilSalud` y sus tres campos cifrados para evitar pérdidas.
  `perfilCliente` permite acceder al mismo perfil desde los servicios nuevos.
  El esquema relacional prepara preferencias y `autorizaContextoIA`; la interfaz
  completa corresponde a fases posteriores. No se añade consentimiento ficticio.
- Los servicios y rutas esperan las operaciones de repositorios con `await`.
  Los repositorios JSON continúan siendo síncronos; los adaptadores PostgreSQL son asíncronos. Los consumidores internos
  de servicios deben usar `await`; se mantienen nombres de exportación y DTO HTTP.
  `repositories/index.js` reexporta `RepositorioUsuarios` desde `usuarios.js`.
- IA recibe `{ consulta, perfil, productos }`, con una lista explícita de campos
  permitidos. No se envían correo, identificadores, hashes ni metadatos adicionales.
  La firma anterior de tres argumentos sigue disponible. Se conserva el uso
  previo de los tres campos del perfil en el adaptador JSON de compatibilidad.
  En PostgreSQL, consentimiento NULL no autoriza enviar el perfil y solo productos
  activos con inventario positivo son candidatos. La gestión completa del
  consentimiento y selección personalizada corresponde a FASE 9 (subfases 9A–9C, ya cerradas).
- Solo `ErrorAplicacion` y sus subclases publican mensajes preparados para el
  usuario. Los errores internos se convierten en un mensaje genérico; los logs
  registran estado/código sin consultas, claves ni mensajes del proveedor.

## Comprobación manual de FASE 1

1. Reinicia el servidor con `npm.cmd start` (o `npm start`) y abre
   `http://localhost:3000`. Recarga con Ctrl+F5 y vuelve a iniciar sesión para
   obtener el rol y los permisos actualizados.
2. Como cliente, guarda el perfil y revisa tu historial. Otra cuenta debe ver
   solamente sus propias consultas. Como administrador,
   comprueba alta, edición, cancelación de edición y eliminación de un producto
   de prueba; revisa una consulta. El empleado legado ahora tiene solo lectura. Los botones deben tener borde verde legible.
3. Para probar sin IA sin editar `.env`, detén el servidor y abre una terminal
   PowerShell nueva en el proyecto. Ejecuta `$env:OLLAMA_MODEL = ' '` (un espacio)
   y después `npm.cmd start`; o simplemente cierra Ollama. Login, perfil, catálogo,
   inventario, pedidos e historial deben funcionar; una consulta mostrará un error
   controlado y quedará en el historial como `ERROR`.
4. Para volver a usar Ollama, detén ese servidor, cierra esa terminal e inicia
   normalmente desde otra con `npm.cmd start`.

También puedes comprobar el arranque sin IA sin tocar los datos reales:
`node --test --test-name-pattern="Arranque real sin proveedor" tests/fase1.test.js`.

## Pendiente para fases posteriores

FASE 2 finalizó con importación y cambio a PostgreSQL verificados. Se mantienen
los contratos HTTP y clases de compatibilidad; los adaptadores traducen consultas
e interacciones a conversaciones y mensajes. La seguridad base de FASE 3 está implementada. La gestión completa de usuarios,
los permisos de módulos futuros y la operación de inventario siguen pendientes.

Las reglas acordadas para fases de inventario/pedidos siguen pendientes: `PENDIENTE`
no descuenta; `CONFIRMADO` descuenta en una transacción; preparación/listo/entregado
mantienen ese descuento; cancelar restaura exactamente una vez si hubo descuento.
Solo `ENTREGADO` alimentará el historial de consumo. Ollama corresponde a FASE 8;
consentimiento y contexto personalizado, a FASE 9 (subfases 9A–9C, ya cerradas).

## Manejo de errores

`src/services/ollamaProvider.js` e `iaService.js` clasifican de forma controlada:

| Situación | `codigo` | HTTP |
|---|---|---|
| `OLLAMA_MODEL` vacío (no se llama a Ollama) | `SERVICIO_IA_NO_CONFIGURADO` | 503 |
| Conexión rechazada / Ollama apagado | `OLLAMA_NO_DISPONIBLE` | 503 |
| Timeout de conexión **o de lectura del cuerpo** | `TIMEOUT` | 504 |
| Modelo inexistente (HTTP 404 de Ollama) | `MODELO_OLLAMA_NO_ENCONTRADO` | 503 |
| Otro error HTTP de Ollama | `ERROR_RESPUESTA_OLLAMA` | 503 |
| Límite (HTTP 429) | `LIMITE_USO` | 429 |
| Respuesta vacía | `RESPUESTA_IA_VACIA` | 502 |
| JSON inválido, fuera de contrato o producto no candidato | `RESPUESTA_INVALIDA` | 502 |

Todas las respuestas de error usan `{ "error": "<mensaje>", "codigo": "<CODIGO>" }`.

En todos los casos, el cliente recibe un mensaje claro y genérico (nunca
detalles internos), y la consulta queda registrada con `estado: "ERROR"`
para trazabilidad (ver `src/middleware/errorHandler.js`).

## Pruebas

Ejecuta `npm run test:uml` para verificar los controles del catálogo y los flujos de
API representados en UML. Usan transporte de IA simulado y archivos temporales
con persistencia y cifrado reales; no consumen proveedores externos ni modifican `data/db.json`.
La suite incluye las regresiones de FASE 1: tipos de correo, proceso nuevo sin
clave de IA, roles legados/nuevos, permisos frente a JWT antiguos, repositorios
simulados asíncronos, aislamiento del historial, compatibilidad del perfil,
contexto IA limitado, errores internos y errores del frontend tratados como texto.
La revisión con los cinco diagramas añade validación de estructura del contexto y
regresiones de rechazos IA sin objeto Error: nunca deben producir una respuesta
HTTP de éxito ni auditoría de éxito. Resultado de esta revisión: **25 pruebas
aprobadas, 0 fallidas**.
Las pruebas del frontend usan un DOM simulado; no sustituyen la revisión visual.
`test:consistencia` es un script separado que utiliza un servidor y datos reales;
no forma parte de esta suite aislada.

Ver [`tests/casos-prueba.md`](./tests/casos-prueba.md) para la evidencia
completa de pruebas con entradas válidas e inválidas (registro, login,
perfil, consultas, manejo de errores de la IA, y control de acceso por rol).

## Endpoints de la API

| Método | Ruta | Descripción | Auth |
|---|---|---|---|
| POST | `/api/auth/register` | Registro de cliente | — |
| POST | `/api/auth/login` | Inicio de sesión | — |
| POST | `/api/auth/logout` | Revocar sesión actual | Usuario autenticado |
| GET | `/api/perfil` | Obtener perfil propio | Cliente |
| PUT | `/api/perfil` | Crear/editar perfil propio | Cliente |
| POST | `/api/consultas` | Enviar consulta nutricional (flujo con IA) | Cliente |
| GET | `/api/consultas` | Historial propio de consultas | Cliente |
| GET | `/api/consultas/admin` | Ver todas las consultas | Administrador |
| PUT | `/api/consultas/:id/revisar` | Marcar consulta como revisada | Administrador |
| GET | `/api/productos` | Listar catálogo | Usuario autenticado |
| POST | `/api/productos` | Crear producto | Administrador |
| PUT | `/api/productos/:id` | Editar producto | Administrador |
| DELETE | `/api/productos/:id` | Desactivar producto sin borrado físico | Administrador |
| GET | `/api/inventario`, `/api/inventario/movimientos` | Existencias e historial | Empleado / Administrador |
| POST | `/api/inventario/movimientos` | ENTRADA, SALIDA o AJUSTE | Empleado / Administrador |
| POST | `/api/pedidos` | Crear pedido PENDIENTE (precios desde PostgreSQL) | Cliente |
| GET | `/api/pedidos`, `/api/pedidos/:id` | Propios (cliente) o todos (personal) | Usuario autenticado |
| PATCH | `/api/pedidos/:id/estado` | CLIENTE: solo `CANCELADO` de su pedido. EMPLEADO/ADMIN: estados operativos | Según rol |
| GET | `/api/historial-consumo` | "Mi consumo": solo pedidos ENTREGADOS, identidad desde JWT | Cliente |

**Contrato de `POST /api/consultas`** (FASE 8): `200 { "consulta": { "id", "texto",
"estado", "fecha", "respuestaIA", "revisada", "interaccionId", ... } }`. La respuesta
de la IA está en `data.consulta.respuestaIA` (no existe `data.respuesta`). En error:
`{ "error", "codigo" }` y la consulta queda registrada con estado `ERROR`.

Las operaciones indicadas como Administrador ya no aceptan el rol legado como fuente de privilegios.

---

**Nota:** este es un prototipo académico. El catálogo de productos y los
datos de NutriVida Products S.A. son de carácter ilustrativo para efectos
del Proyecto Final del curso.

## PostgreSQL — configuración y ejecución controlada

La instalación local usa `nutrivida_db` y `nutrivida_test_db`, verificadas con
PostgreSQL 18. Las instrucciones siguientes sirven para una instalación nueva;
el corte local ya está realizado y `.env` selecciona `postgres`.
Crea una base exclusiva de aplicación y otra exclusiva de pruebas, con un usuario
que pueda crear esquemas y tablas en ambas. Configura solo en `.env`:

```dotenv
DB_HOST=
DB_PORT=
DB_NAME=
DB_USER=
DB_PASSWORD=
DB_TEST_NAME=
PERSISTENCE_DRIVER=json
```

No cambies `JWT_SECRET` ni `ENCRYPTION_KEY`. No compartas la contraseña en logs,
SQL, documentación o mensajes. `DB_TEST_NAME` debe ser diferente de `DB_NAME`.
Las pruebas crean y eliminan únicamente esquemas aleatorios `nv_test_*` dentro
de la base de pruebas; no eliminan bases ni datos existentes.

Con las variables configuradas, ejecutar primero:

```powershell
npm.cmd run db:validar-json
npm.cmd run test:postgres
npm.cmd run db:migrar
```

Detén los procesos que escriban JSON antes de importar. El indicador siguiente
confirma que has detenido esas escrituras; no detiene el servidor por sí mismo:

```powershell
npm.cmd run db:importar-json -- --confirmar-corte
npm.cmd run db:verificar-importacion
```

`db:verificar-importacion` tiene dos niveles. **Integridad histórica estricta**:
UUID, `password_hash`, `fecha_creacion`, correo, `datos_legado` (cifrado heredado),
conversaciones, mensajes y auditoría importados, y rol salvo `CAMBIO_ROL` auditado;
cualquier diferencia sin respaldo produce `IMPORTACION_CONFLICTO`. **Cambios
posteriores** (`fecha_actualizacion`, campos de perfil, edición de productos heredados,
rol con `CAMBIO_ROL`) se informan como `CAMBIO_POSTERIOR_AUDITADO` solo si existe
auditoría posterior que los respalde. `node database/scripts/diagnosticar-importacion.js`
detalla cada diferencia (solo lectura) con la auditoría alrededor de su fecha.

La importación crea un respaldo privado en `data/backups/`, usa transacción y
verifica UUID, hashes, cifrado, fechas y relaciones. El original no se borra.
Una repetición idéntica se acepta; cambios en registros existentes producen un
conflicto sin sobrescritura. El verificador compara registros del origen; no es
una herramienta para revertir modificaciones hechas después de comenzar a usar
PostgreSQL. Si el JSON cambia durante el corte, se cancela la importación.

**Solo después de una verificación satisfactoria**, establece
`PERSISTENCE_DRIVER=postgres` en `.env` y reinicia con `npm.cmd start`. El arranque
identifica la persistencia seleccionada. Si PostgreSQL falla, el sistema devuelve
un error controlado; no cambia a JSON ni escribe en ambas fuentes. No vuelvas a
JSON tras recibir escrituras en PostgreSQL sin un plan explícito de conciliación.

Los productos importados quedan inactivos, con precio y stock mínimo nulos y sin
inventario. El catálogo puede mostrarlos para revisión; no son candidatos de IA.
Los perfiles importados no tienen consentimiento inferido. Los campos históricos
cifrados se preservan en JSONB; nuevas ediciones del formulario se guardan como
declaraciones cifradas en `preferencias_cliente`, sin otorgar consentimiento.
Los nuevos ingredientes declarados por el formulario se guardan en las tablas
normalizadas; la importación no divide automáticamente el texto histórico.

El importador no crea administradores. La cuenta PERSONAL_NUTRIVIDA existente
pasa a EMPLEADO. El comando `seed` solo crea un administrador si se ejecuta
expresamente con sus datos y un correo nuevo; no promueve una cuenta existente.

## Pruebas y UML de FASE 2

```powershell
npm.cmd test
npm.cmd run test:importacion
npm.cmd run test:postgres
```

Resultado al cierre de FASE 2: **51 aprobadas, 0 fallidas y 0 omitidas**, incluidas
16 subpruebas reales PostgreSQL.

Sin DB_* la suite PostgreSQL se marca pendiente (omitida), nunca aprobada por
simulación. Para verificar los cinco UML, configura `PLANTUML_JAR` con un JAR
local de PlantUML y ejecuta `npm.cmd run uml:validar`. Java/PlantUML son herramientas
de validación documental; no son dependencias de ejecución del proyecto.

Las migraciones se registran con checksum en `infra.schema_migrations`. No edites
una migración aplicada: agrega una versión nueva. Solo hay 16 tablas de negocio y
una tabla técnica. Los SQL no contienen credenciales.


## Seguridad base de FASE 3

Consulta el [reporte de FASE 3](docs/trazabilidad-fase3.md) para archivos, UML,
migración, matriz RBAC, eventos y límites de la implementación.

- Helmet/CSP activos; JWT HS256 con expiración de 8 horas; estado y rol comprobados
  en PostgreSQL en cada acceso protegido. Cuenta inactiva no puede iniciar ni continuar sesión.
- Logout revoca el token en servidor mediante huella SHA-256 en auditoría; no se guarda
  el JWT completo. La revocación persiste al reiniciar y no cierra otras sesiones.
- Registro público solo CLIENTE. Propiedades inesperadas y UUID inválidos se rechazan;
  perfil e historial siempre pertenecen a la identidad autenticada. Duplicados: HTTP 409.
- Login fallido registra usuario NULL; login exitoso/denegaciones usan identidad real.
  No hay cambios de rol automáticos ni se registran contraseñas, tokens o secretos.
- Límites por IP: 600 solicitudes API/15 min, 30 login/15 min, 20 registro/15 min y
  30 consultas IA/min. Al exceder, HTTP 429 con Retry-After. Almacén por proceso.
- `CORS_ORIGINS` permite orígenes exactos separados por comas. Vacío mantiene la web
  del mismo origen y no concede lectura CORS a otros. No configurar wildcard.
- `NODE_ENV=production` activa HSTS/upgrade HTTPS; desarrollo local sigue con HTTP.
  No se modifica `.env` automáticamente. No habilitar proxies indiscriminadamente.

Dependencias nuevas: Helmet y express-rate-limit. Override de qs 6.16.0 para corregir
avisos de la dependencia transitiva. No se agregó Zod ni módulos comerciales.
Aplica `npm.cmd run db:migrar` antes de arrancar en otra instalación: la migración
002 permite auditoría anónima y mantiene su FK; nunca edites la 001 ya aplicada.

Pruebas finales: `npm.cmd test` → **67 aprobadas, 0 fallidas, 0 omitidas**.
`npm.cmd run test:fase3` ejecuta los casos de seguridad aislados; PostgreSQL real se
verifica además en la suite completa. `npm.cmd audit --omit=dev` → 0 vulnerabilidades
reportadas al cierre. Los resultados de secciones anteriores son evidencia histórica.

Quedan pendientes los módulos posteriores, gestión completa de usuarios/roles,
retención de auditoría, límites compartidos para varios procesos y configuración
HTTPS del despliegue. No se avanzó a FASE 4.


## Catálogo comercial — FASE 4

El [reporte de FASE 4](docs/trazabilidad-fase4.md) contiene trazabilidad, endpoints,
reglas, migración, archivos y evidencia visual. El módulo actual usa PostgreSQL;
la documentación de fases anteriores describe su estado histórico.

- Cliente: Inicio, Catálogo con tarjetas/buscador/filtros/detalle, NutriVida AI y perfil.
- Empleado: consulta del catálogo. No tiene operaciones de administración.
- Administrador: vistas separadas de categorías, ingredientes y productos; se
  conserva la revisión de consultas existente. Permisos verificados en backend.
- Ingredientes asociados mediante IDs y producto_ingrediente, con cantidad descriptiva
  opcional. No se reciben listas de nombres separadas por comas en la API comercial.
- Producto activo requiere nombre, categoría activa y precio >0. No necesita stock
  en esta fase. Los cinco heredados permanecen inactivos y sin precio hasta completarlos
  manualmente. El catálogo de cliente/empleado estará vacío mientras no haya activos.
- Categorías con productos activos no pueden desactivarse hasta desactivar esos
  productos. DELETE producto ahora desactiva y conserva referencias históricas.
- Imagen opcional HTTPS o /images/; placeholder local. Sin upload ni binarios en DB.
  Importe decimal sin moneda inferida. Disponibilidad por configurar no significa stock cero.

La migración `003_catalogo_indices.sql` ya se aplicó localmente. En otra instalación:

```powershell
npm.cmd run db:migrar
npm.cmd start
```

GET `/api/productos?nombre=avena&categoria=1&ingrediente=2&page=1&limit=12`
combina filtros parametrizados en PostgreSQL. Límite máximo 100. Solo administrador
puede filtrar estado=activo/inactivo/todos. GET `/api/productos/:id` devuelve detalle.
GET/POST `/api/categorias` y `/api/ingredientes`, PUT `/:id` para editar; categorías
admite PUT `/:id/estado`. Productos admite POST, PUT `/:id`, PUT `/:id/estado` y DELETE
como baja lógica. Todas las escrituras son exclusivas del administrador.

Las mutaciones comerciales y su auditoría son transaccionales. No se crearon precios,
stock ni cuentas administrativas automáticamente. No se alteró .env ni se reimportó JSON.

Verificación final: **82 pruebas aprobadas, 0 fallidas, 0 omitidas**, más **11
comprobaciones en navegador real**, con datos sintéticos. Cinco UML válidos y
npm audit sin vulnerabilidades reportadas.

```powershell
npm.cmd test
npm.cmd run test:fase4
# Opcional, requiere Chrome/Edge local; usa solo la base de pruebas:
npm.cmd run test:browser
```

Las [capturas de evidencia](docs/evidencias/fase4-catalogo-desktop.png) muestran datos
sintéticos, no productos reales publicados. No se implementaron inventario operativo,
carrito, pedidos, consumo, Ollama, personalización definitiva ni dashboard.
**No se avanzó a FASE 5.**
