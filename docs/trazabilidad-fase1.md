# Trazabilidad de FASE 1 — NutriVida AI

La revisión usa la auditoría de FASE 0, el prompt maestro, las decisiones
aprobadas y los cinco diagramas oficiales disponibles. Esta fase prepara la
aplicación existente; no implementa toda la arquitectura objetivo.

## Fuentes oficiales verificadas

Se leyeron completos los cinco archivos. Todos contienen código PlantUML con
`@startuml` y `@enduml`. La extensión actual es `.txt`; no se renombraron ni se
modificaron. No se realizó renderizado con PlantUML.

| Referencia | Archivo real | Contenido |
|---|---|---|
| D1 | [1. Modelo_Relacional_NutriVida_AI.txt](<uml/1. Modelo_Relacional_NutriVida_AI.txt>) | Modelo PostgreSQL: 16 tablas y relaciones |
| D2 | [2. Casos_Uso_NutriVida_AI.txt](<uml/2. Casos_Uso_NutriVida_AI.txt>) | Actores y casos UC1–UC25 |
| D3 | [3. Casos_Uso_NutriVida_AI.txt](<uml/3. Casos_Uso_NutriVida_AI.txt>) | **Diagrama de clases**, según su título y contenido |
| D4 | [4. Secuencia_IA_NutriVida.txt](<uml/4. Secuencia_IA_NutriVida.txt>) | Recomendación personalizada y manejo de error |
| D5 | [5. Componentes_NutriVida_AI.txt](<uml/5. Componentes_NutriVida_AI.txt>) | Presentación, negocio, repositorios, seguridad e integración |

Los nombres `.puml` anunciados previamente no son los nombres guardados actualmente.
La documentación `implementacion-uml.md` describe la versión anterior y no es
la referencia arquitectónica objetivo.

## Requerimiento → casos → clases → modelo → secuencia → componentes → código

Los números de requerimientos siguientes corresponden a secciones del prompt
maestro. «Pendiente» significa que no se implementa en FASE 1.

| Requerimiento | Casos D2 | Clases D3 | Modelo D1 | Secuencia D4 | Componentes D5 | Código y alcance actual |
|---|---|---|---|---|---|---|
| §8–9: acceso y roles | UC1, UC2, UC23 | Usuario, Rol | usuarios, roles | Validar token | AUTH, USERS, SEC, RUSER | `security/auth.js`, `domain/roles.js`, `services/sistema.js`, `repositories/usuarios.js`: JWT, tres roles canónicos y excepción legada. Gestión completa de usuarios/roles pendiente. |
| §17: perfil y preferencias | UC3, UC4 | PerfilCliente, PreferenciaCliente | perfil_cliente, preferencias_cliente | Consultar autorización; preferencias solo si autoriza | USERS, RUSER, NAI | `domain/modelos.js`, `services/perfilService.js`: PerfilCliente con alias PerfilSalud y datos JSON existentes. Campos nuevos, preferencias y consentimiento pendientes. |
| §10–11: catálogo | UC5, UC6, UC18–20 | Producto, Categoria, Ingrediente, ProductoIngrediente | productos, categorias, ingredientes, producto_ingrediente | Consultar productos activos y existencia | CAT, RPROD | `services/catalogoService.js`, `repositories/index.js`, `routes/productos.routes.js`: CRUD existente. Normalización, precio, estado y búsqueda final pendientes. |
| §14–16: contexto y recomendación | UC11–14 | AsistenteNutriVida, ContextoIA | Perfil, preferencias, productos, pedidos y conversaciones | Construir contexto seguro; enviar consulta + contexto | NAI → IAClient → IA | `services/consultasService.js` orquesta; `contextoIA.js` selecciona campos; `iaService.js` integra Claude. DTO transitorio; consentimiento, recuperación pertinente y Ollama pendientes. |
| §19: historial propio | UC15, UC16 | ConversacionIA, MensajeIA | conversaciones_ia, mensajes_ia | Guardar consulta y respuesta | NAI, RAI | `services/consultasService.js` y repositorios de consultas/interacciones conservan aislamiento y cifrado. Se mantiene el historial JSON; migración pendiente. |
| §4, §22: errores IA | UC17 | AsistenteNutriVida.manejarError, ErrorSistema | errores_sistema | Error controlado → mensaje al cliente | IAClient, NAI, AUD | `iaService.js`, `consultasService.js`, `errors/ErrorAplicacion.js`, `middleware/errorHandler.js`: errores públicos controlados; arranque independiente de IA. Tabla de errores pendiente. |
| §21, §23: auditoría y seguridad | UC25 y acceso protegido | Auditoria, Usuario | auditoria | Validación; auditoría/logs | SEC, AUD, RAUD | `security/`, `BitacoraAuditoria`, repositorio JSON: cifrado, JWT, validación y eventos actuales. Auditoría ampliada y dashboard pendientes. |
| §7, §12–13: inventario, pedidos y consumo | UC7–10, UC21–22 | Inventario, MovimientoInventario, Pedido, DetallePedido | inventario, movimientos_inventario, pedidos, detalle_pedido | Recuperar consumo y existencia | INV, ORD, HIST, RINV, RORD | Pendiente por completo. FASE 1 no crea tablas, inventario, pedidos ni historial de consumo. |

Las rutas conservan sus contratos HTTP y delegan en servicios asíncronos.
Los repositorios JSON siguen siendo síncronos, pero los servicios esperan sus
resultados para permitir futuros adaptadores asíncronos. No se introdujo una
capa de controladores adicional porque las rutas actuales ya cumplen esa función.

## Compatibilidad aprobada y límites

- `PERSONAL_NUTRIVIDA` equivale a `EMPLEADO` al presentar la cuenta. El valor
  persistido se conserva. Solo las cuentas legadas mantienen temporalmente
  catálogo y revisión; los empleados nuevos no reciben esos permisos.
- La composición futura Usuario–Rol no exige eliminar ahora las clases legadas
  Cliente/PersonalNutriVida. Estas se conservan como compatibilidad, no como una
  propuesta para sustituir el diagrama de clases.
- PerfilCliente conserva por ahora los tres campos cifrados de PerfilSalud.
  No se inventan preferencias ni `autorizaContextoIA`. La separación de perfil
  y preferencias de D1/D3 se realizará en las fases correspondientes.
- El contexto explícito actual contiene `consulta`, `perfil` y `productos`.
  Excluye campos ajenos, pero aún usa los tres campos previos del perfil y el
  catálogo existente. No constituye la personalización con consentimiento de D4.
- D4 usa `/api/ai/consultas` con `{ mensaje }`; FASE 1 conserva
  `/api/consultas` con `{ texto }`. Tampoco cambia `{ error, codigo }` por el
  sobre de errores futuro. Se preservan 504 para timeout, 429 para límite y
  502 para respuesta inválida; D4 resume los fallos externos como 503.
- D4/D5 muestran React + TypeScript y PostgreSQL. La autorización de FASE 1
  mantiene HTML/CSS/JS, JSON y Claude. Esto es una transición explícita, no
  una implementación completa de esos componentes futuros.
- El arranque no migra ni reescribe datos. La utilidad JSON histórica
  `migrarDatos` permanece exportada y se prueba exclusivamente con fixtures.

## Inconsistencias que requieren decisión antes de la fase afectada

No se modificó el UML. Las siguientes son propuestas, no decisiones aprobadas:

1. **Usuario opcional en errores:** D1 declara `id_usuario <<FK,NULL>>`, pero su
   relación gráfica exige un usuario. D3 y §6 permiten `0..1`. Propuesta mínima:
   representar `0..1` en el extremo Usuario del vínculo con errores_sistema,
   conservando la columna nullable. Resolver antes del esquema de FASE 2.
2. **Estado de consultas antiguas:** la decisión aprobada exige conservarlo,
   pero D1/D3 no muestran un campo equivalente en conversaciones/mensajes.
   Propuesta: acordar un campo opcional de estado de origen o metadatos de
   migración vinculados al mensaje, preservando el valor real y la información
   relacionada existente (por ejemplo revisión), sin fabricar respuestas ni fechas.
   Precisar esa representación antes de modificar UML o ejecutar la migración.
3. **Catálogo para empleado:** §8 permite consultar productos al empleado;
   D2 conecta UC5 solo con Cliente. Propuesta mínima: añadir la asociación
   Empleado → UC5 al aprobar la revisión documental. FASE 1 conserva el acceso
   de lectura ya autorizado; no le concede gestión del catálogo.

Estas diferencias no obligan a modificar las correcciones de FASE 1. La
implementación de los elementos futuros afectados queda pendiente de decisión.

## Verificación ejecutada

- Base previa: 22 pruebas aprobadas, 0 fallidas.
- Tres regresiones nuevas reprodujeron fallos antes de corregirlos: contexto
  malformado generaba error interno; rechazos nulos del transporte escapaban al
  manejo controlado; rechazo vacío del adaptador producía HTTP 200 y auditoría
  de éxito aunque la consulta se guardaba con estado ERROR.
- Corrección: validar la estructura del DTO, inspeccionar errores con acceso
  seguro y normalizar rechazos sin objeto Error antes de auditar/devolver el fallo.
- `npm.cmd run test:uml`: **25 aprobadas, 0 fallidas**, incluidas las 22 previas.
- La suite usa datos temporales y transporte IA simulado; incluye proceso nuevo
  sin proveedor configurado. No consume Claude ni modifica la base del proyecto.
- Las pruebas del frontend usan DOM simulado. La comprobación visual se realiza
  siguiendo [las instrucciones del README](../README.md#comprobación-manual-de-fase-1).

## Deuda técnica

FASE 2: resolver las discrepancias del esquema, PostgreSQL, 16 tablas, estrategia
de respaldo/migración preservando información real y transacciones entre operaciones.
El JSON actual no coordina varios procesos ni una transacción completa de servicio.

Fases posteriores: permisos definitivos sin alias legado; preferencias y catálogo
normalizados; inventario/pedidos; consumo exclusivamente de ENTREGADOS; Ollama;
consentimiento y contexto pertinente; conversaciones; auditoría/dashboard.

Se mantienen las reglas aprobadas de pedidos: PENDIENTE no descuenta; CONFIRMADO
descuenta mediante transacción; preparación/listo/entregado mantienen el descuento;
CANCELADO restaura exactamente una vez cuando corresponda. No se implementaron aquí.
