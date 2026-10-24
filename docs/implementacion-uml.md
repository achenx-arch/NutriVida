# Implementación de los UML originales

Los cuatro PNG originales de la carpeta superior son la referencia del diseño.
No se modificaron. Se retiraron las versiones alternativas creadas durante la
revisión anterior y se implementaron las piezas faltantes en el programa.

## Clases conectadas al programa

| Elemento del diagrama original | Implementación utilizada |
|---|---|
| Usuario, Cliente y PersonalNutriVida | [domain/modelos.js](../src/domain/modelos.js): herencia, autenticación, perfil, envío de consultas, historial, gestión del catálogo y revisión. |
| RolUsuario | [domain/roles.js](../src/domain/roles.js): CLIENTE y PERSONAL_NUTRIVIDA. ADMINISTRADOR es un alias de compatibilidad para datos y tokens anteriores. |
| PerfilSalud | Tiene UUID propio, validación y relación con Usuario. Sus tres campos de texto se cifran al persistirse. |
| Consulta / EstadoConsulta | Entidad independiente con id, clienteId, texto, fecha y estado; saneamiento y validación antes de registrar PENDIENTE. |
| Interaccion | Entidad independiente con id, consultaId, clienteId, consulta, respuestaIA, fecha y revisada. Su método registrar persiste el resultado junto con el estado final de Consulta. |
| Producto | Entidad con atributos del catálogo y método actualizar; utilizada por el repositorio y por PersonalNutriVida. |
| BitacoraAuditoria | Clase con id, usuarioId, accion, recursoAccedido y fecha. registrarAcceso utiliza el repositorio de auditoría. |
| GestorSeguridad | [security/GestorSeguridad.js](../src/security/GestorSeguridad.js): cifrarDatoSensible, descifrarDatoSensible, obtenerApiKey y validarEntrada. |
| ServicioIA | [services/iaService.js](../src/services/iaService.js): modelo, endpoint, generarRecomendacion y manejarError. La llamada a Claude atraviesa esta clase. |

Las clases no son ejemplos aislados: las rutas invocan los módulos de negocio,
estos utilizan las entidades y los repositorios reconstruyen instancias al leer.

## Componentes y casos de uso

- [app.js](../src/app.js) compone los controladores REST y el middleware. [server.js](../src/server.js) inicia el servidor.
- [services/sistema.js](../src/services/sistema.js) contiene los módulos de consultas, perfil de salud y catálogo.
- [repositories/index.js](../src/repositories/index.js) implementa repositorios de Usuarios, Productos, Consultas, Interacciones y Auditoría.
- [data/store.js](../src/data/store.js) realiza la persistencia. Los repositorios comparten este adaptador JSON; no acceden directamente desde las rutas al archivo.
- Las operaciones de registro, login, perfil, consulta, historial, catálogo y revisión están conectadas a los controladores correspondientes.
- El frontend permite crear, editar y eliminar productos, cancelar una edición y revisar consultas. Reconoce el rol PERSONAL_NUTRIVIDA y las sesiones anteriores de administrador.

El almacenamiento sigue siendo un archivo, permitido por la guía. No se agregaron
credenciales DB ficticias: serían necesarias al cambiar el adaptador por un motor
de base de datos. La API externa usa HTTPS; el servidor de desarrollo local sigue
usando HTTP. Un despliegue HTTPS requiere certificado/configuración del entorno.

## Secuencia implementada

1. El controlador autentica al cliente y delega al módulo de consultas.
2. GestorSeguridad y Consulta validan/sanean la entrada; una entrada inválida no genera una llamada a IA.
3. Se registra Consulta con estado PENDIENTE.
4. Los repositorios recuperan el perfil descifrado y el catálogo.
5. ServicioIA construye el mensaje y obtiene la clave mediante GestorSeguridad.
6. La respuesta se registra como Interaccion y Consulta pasa a RESPONDIDA. Ambos cambios se guardan en una transacción del archivo.
7. Ante un error de IA, se conserva una interacción sin respuesta y Consulta pasa a ERROR; se registra auditoría y se devuelve un mensaje controlado.
8. El frontend muestra el resultado y vuelve a cargar el historial, también cuando la IA falla.

Una consulta en curso todavía no tiene interacción. Al completarse, exitosa o
fallida, tiene una sola interacción; el repositorio rechaza duplicados.

El tiempo de espera cubre encabezados y cuerpo de respuesta. Se manejan errores
de conexión/servicio, límite de uso, timeout, JSON inválido y contenido sin texto.
Se mantienen códigos HTTP específicos: 429, 502, 503 y 504.

## Compatibilidad y persistencia

Al iniciar el servidor o ejecutar `npm run seed`, la migración convierte el formato
anterior una sola vez (`versionEsquema: 2`):

- Conserva ids de usuarios y consultas, contraseñas, fechas, estados, respuestas y revisión.
- Convierte ADMINISTRADOR a PERSONAL_NUTRIVIDA y agrega el área del personal.
- Asigna un UUID al perfil y separa las interacciones del registro de consulta.
- Cifra condiciones, alergias, objetivos, preguntas y respuestas mediante AES-256-GCM.
- Mantiene la forma de las respuestas HTTP que necesita el frontend, uniendo Consulta e Interaccion al consultar el historial.

La migración utiliza la clave de cifrado existente. Si no se puede descifrar un
perfil o el JSON está dañado, el proceso falla sin reemplazar el archivo. No debe
cambiarse ENCRYPTION_KEY para intentar reparar datos ya cifrados.

La escritura usa un archivo temporal y un reemplazo atómico. Esta solución está
pensada para una instancia del servidor; no implementa coordinación entre varios
procesos que escriban simultáneamente sobre el mismo archivo.

## Verificación

```bash
npm run test:uml
```

Pruebas de clases/herencia, migración e idempotencia, cifrado, conservación ante
errores, transporte IA, rutas HTTP, permisos, aislamiento entre clientes y controles
del frontend. La persistencia usa archivos temporales reales y la IA usa un
transporte simulado. No se consumen créditos de Claude.

También se comprobó la migración sobre una copia temporal de los datos existentes:
se conservaron ids, estados, textos, respuestas y revisiones, sin modificar el
`data/db.json` original durante esa comprobación.

No se realizó una consulta a Claude ni una prueba visual completa en navegador.
