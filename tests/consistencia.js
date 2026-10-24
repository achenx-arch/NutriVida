/**
 * Prueba de consistencia de datos — NutriAsistente IA
 * =================================================================
 * Cubre el requisito de la Ficha de Avance 2 (sección 14 de la guía):
 *   "Que la información se mantiene consistente después de varias operaciones"
 *
 * Ejecuta una secuencia larga de operaciones encadenadas y verifica, en cada
 * punto, que los datos siguen íntegros, correctamente cifrados en disco y
 * correctamente descifrados al leerse.
 *
 * Uso:
 *   1. Levantar el servidor en otra terminal:  npm start
 *   2. En esta terminal:                       npm run test:consistencia
 *
 * No requiere API key válida: los pasos que llaman a la IA aceptan tanto una
 * respuesta exitosa como un error controlado, porque lo que se está probando
 * es la CONSISTENCIA DE LOS DATOS, no la respuesta del modelo.
 */

const fs = require("fs");
const path = require("path");

const BASE = process.env.BASE_URL || "http://localhost:3000";
const DB_PATH = path.join(__dirname, "..", "data", "db.json");

// Usuario único por corrida, para no chocar con datos previos
const SUFIJO = Date.now();
const USUARIO = {
  nombre: "Usuario Consistencia",
  correo: `consistencia_${SUFIJO}@example.com`,
  password: "ClaveSegura123",
};

// ------------------------------------------------------------------
// Utilidades de reporte
// ------------------------------------------------------------------
let pasos = 0;
let fallos = 0;

const C = {
  reset: "\x1b[0m",
  verde: "\x1b[32m",
  rojo: "\x1b[31m",
  cian: "\x1b[36m",
  gris: "\x1b[90m",
  amarillo: "\x1b[33m",
};

function seccion(titulo) {
  console.log(`\n${C.cian}── ${titulo} ${"─".repeat(Math.max(0, 58 - titulo.length))}${C.reset}`);
}

function ok(mensaje) {
  pasos++;
  console.log(`  ${C.verde}✓${C.reset} ${mensaje}`);
}

function fallo(mensaje, detalle) {
  pasos++;
  fallos++;
  console.log(`  ${C.rojo}✗ ${mensaje}${C.reset}`);
  if (detalle) console.log(`    ${C.gris}${detalle}${C.reset}`);
}

function verificar(condicion, mensaje, detalle) {
  if (condicion) ok(mensaje);
  else fallo(mensaje, detalle);
}

function info(mensaje) {
  console.log(`  ${C.gris}· ${mensaje}${C.reset}`);
}

// ------------------------------------------------------------------
// Cliente HTTP mínimo
// ------------------------------------------------------------------
async function api(metodo, ruta, { token, body } = {}) {
  const headers = { "Content-Type": "application/json" };
  if (token) headers.Authorization = `Bearer ${token}`;

  const resp = await fetch(`${BASE}${ruta}`, {
    method: metodo,
    headers,
    body: body ? JSON.stringify(body) : undefined,
  });

  let data = null;
  try {
    data = await resp.json();
  } catch {
    data = null;
  }
  return { status: resp.status, data };
}

/** Lee el registro crudo del usuario tal como está guardado en disco. */
function leerUsuarioEnDisco(correo) {
  const db = JSON.parse(fs.readFileSync(DB_PATH, "utf-8"));
  return db.usuarios.find((u) => u.correo === correo) || null;
}

function leerAuditoriaDeUsuario(usuarioId) {
  const db = JSON.parse(fs.readFileSync(DB_PATH, "utf-8"));
  return (db.auditoria || []).filter((a) => a.usuarioId === usuarioId);
}

/** Un valor cifrado tiene el formato iv:authTag:datos (todo hexadecimal). */
function pareceCifrado(valor) {
  if (typeof valor !== "string") return false;
  const partes = valor.split(":");
  return partes.length === 3 && partes.every((p) => /^[0-9a-f]+$/i.test(p) && p.length > 0);
}

// ------------------------------------------------------------------
// Prueba principal
// ------------------------------------------------------------------
async function main() {
  console.log(`\n${C.cian}╔══════════════════════════════════════════════════════════╗`);
  console.log(`║  PRUEBA DE CONSISTENCIA DE DATOS — NutriAsistente IA     ║`);
  console.log(`╚══════════════════════════════════════════════════════════╝${C.reset}`);
  console.log(`${C.gris}Servidor: ${BASE}${C.reset}`);
  console.log(`${C.gris}Usuario de prueba: ${USUARIO.correo}${C.reset}`);

  // --- Comprobación previa: servidor arriba ---
  try {
    const salud = await api("GET", "/api/salud");
    if (salud.status !== 200) throw new Error("respuesta inesperada");
  } catch {
    console.log(
      `\n${C.rojo}No se pudo contactar al servidor en ${BASE}.${C.reset}\n` +
        `Levántalo primero con:  ${C.amarillo}npm start${C.reset}\n`
    );
    process.exit(1);
  }

  // ================================================================
  seccion("1. Registro del usuario");
  // ================================================================
  const registro = await api("POST", "/api/auth/register", { body: USUARIO });
  verificar(registro.status === 201, "El registro devuelve 201 Created", `status=${registro.status}`);

  let token = registro.data?.token;
  const usuarioId = registro.data?.usuario?.id;
  verificar(Boolean(token), "Se recibe un token de sesión");
  verificar(Boolean(usuarioId), "Se recibe el id del usuario");

  const enDiscoTrasRegistro = leerUsuarioEnDisco(USUARIO.correo);
  verificar(Boolean(enDiscoTrasRegistro), "El usuario quedó persistido en disco");
  verificar(
    enDiscoTrasRegistro && enDiscoTrasRegistro.passwordHash !== USUARIO.password,
    "La contraseña NO se guarda en texto plano (hash bcrypt)",
    enDiscoTrasRegistro ? `guardado: ${String(enDiscoTrasRegistro.passwordHash).slice(0, 25)}...` : ""
  );

  // ================================================================
  seccion("2. Primer guardado del perfil de salud");
  // ================================================================
  const PERFIL_1 = {
    condicionesMedicas: "Diabetes tipo 2",
    alergias: "Gluten",
    objetivoNutricional: "Bajar de peso",
  };

  const put1 = await api("PUT", "/api/perfil", { token, body: PERFIL_1 });
  verificar(put1.status === 200, "El perfil se guarda correctamente", `status=${put1.status}`);
  verificar(
    put1.data?.perfilSalud?.condicionesMedicas === PERFIL_1.condicionesMedicas,
    "La respuesta devuelve el dato descifrado correctamente"
  );

  const disco1 = leerUsuarioEnDisco(USUARIO.correo);
  verificar(
    pareceCifrado(disco1?.perfilSalud?.condicionesMedicas),
    "En disco, 'condicionesMedicas' está CIFRADO (formato iv:tag:datos)"
  );
  verificar(
    pareceCifrado(disco1?.perfilSalud?.alergias),
    "En disco, 'alergias' está CIFRADO"
  );
  verificar(
    !String(disco1?.perfilSalud?.condicionesMedicas).includes("Diabetes"),
    "El texto original NO aparece legible en disco"
  );
  info(`en disco: ${String(disco1?.perfilSalud?.condicionesMedicas).slice(0, 48)}...`);

  // ================================================================
  seccion("3. Lectura del perfil (ida y vuelta del cifrado)");
  // ================================================================
  const get1 = await api("GET", "/api/perfil", { token });
  verificar(get1.status === 200, "El perfil se lee correctamente");
  verificar(
    get1.data?.perfilSalud?.condicionesMedicas === PERFIL_1.condicionesMedicas &&
      get1.data?.perfilSalud?.alergias === PERFIL_1.alergias,
    "El dato descifrado coincide EXACTAMENTE con el original"
  );

  // ================================================================
  seccion("4. Consultas a la IA (se generan varias interacciones)");
  // ================================================================
  const CONSULTAS = [
    "¿Qué producto me recomiendas para bajar de peso?",
    "¿Tienen algo sin gluten?",
    "¿Qué bebida funcional me sirve?",
  ];

  let consultasCreadas = 0;
  for (const texto of CONSULTAS) {
    const r = await api("POST", "/api/consultas", { token, body: { texto } });
    // 200 = la IA respondió; 4xx/5xx = error controlado de la API externa.
    // En AMBOS casos la consulta debe haber quedado registrada.
    const manejado = r.status === 200 || (r.status >= 400 && Boolean(r.data?.error));
    if (manejado) consultasCreadas++;
    info(`"${texto.slice(0, 38)}..." → status ${r.status}`);
  }
  verificar(
    consultasCreadas === CONSULTAS.length,
    `Las ${CONSULTAS.length} consultas fueron procesadas o fallaron de forma controlada`
  );

  const historial1 = await api("GET", "/api/consultas", { token });
  verificar(
    historial1.data?.consultas?.length === CONSULTAS.length,
    `El historial contiene exactamente ${CONSULTAS.length} consultas`,
    `encontradas: ${historial1.data?.consultas?.length}`
  );
  verificar(
    historial1.data?.consultas?.every((c) => ["RESPONDIDA", "ERROR", "PENDIENTE"].includes(c.estado)),
    "Toda consulta quedó con un estado válido (ninguna a medias)"
  );
  verificar(
    historial1.data?.consultas?.every((c) => c.clienteId === usuarioId),
    "Todas las consultas pertenecen al usuario correcto"
  );

  // ================================================================
  seccion("5. Edición del perfil (el dato cambia, el historial NO)");
  // ================================================================
  const PERFIL_2 = {
    condicionesMedicas: "Hipertensión arterial",
    alergias: "Lactosa",
    objetivoNutricional: "Ganar masa muscular",
  };

  const put2 = await api("PUT", "/api/perfil", { token, body: PERFIL_2 });
  verificar(put2.status === 200, "El perfil se actualiza correctamente");

  const get2 = await api("GET", "/api/perfil", { token });
  verificar(
    get2.data?.perfilSalud?.condicionesMedicas === PERFIL_2.condicionesMedicas &&
      get2.data?.perfilSalud?.alergias === PERFIL_2.alergias,
    "El perfil refleja los datos NUEVOS"
  );

  const disco2 = leerUsuarioEnDisco(USUARIO.correo);
  verificar(
    pareceCifrado(disco2?.perfilSalud?.condicionesMedicas),
    "El dato actualizado también quedó cifrado en disco"
  );
  verificar(
    disco1?.perfilSalud?.condicionesMedicas !== disco2?.perfilSalud?.condicionesMedicas,
    "El valor cifrado cambió respecto al anterior (no quedó pegado el viejo)"
  );

  const historial2 = await api("GET", "/api/consultas", { token });
  verificar(
    historial2.data?.consultas?.length === CONSULTAS.length,
    "El historial de consultas se conservó intacto tras editar el perfil"
  );

  // ================================================================
  seccion("6. Cierre y reapertura de sesión");
  // ================================================================
  token = null; // simula cerrar sesión

  const sinToken = await api("GET", "/api/perfil");
  verificar(sinToken.status === 401, "Sin token, el perfil queda protegido (401)", `status=${sinToken.status}`);

  const login = await api("POST", "/api/auth/login", {
    body: { correo: USUARIO.correo, password: USUARIO.password },
  });
  verificar(login.status === 200, "Se puede volver a iniciar sesión");
  token = login.data?.token;

  const get3 = await api("GET", "/api/perfil", { token });
  verificar(
    get3.data?.perfilSalud?.condicionesMedicas === PERFIL_2.condicionesMedicas,
    "Tras reingresar, el perfil sigue correcto y descifrable"
  );

  const historial3 = await api("GET", "/api/consultas", { token });
  verificar(
    historial3.data?.consultas?.length === CONSULTAS.length,
    "Tras reingresar, el historial sigue completo"
  );

  // ================================================================
  seccion("7. Aislamiento entre usuarios");
  // ================================================================
  const OTRO = {
    nombre: "Otro Usuario",
    correo: `otro_${SUFIJO}@example.com`,
    password: "OtraClave123",
  };
  const regOtro = await api("POST", "/api/auth/register", { body: OTRO });
  const tokenOtro = regOtro.data?.token;

  const historialOtro = await api("GET", "/api/consultas", { token: tokenOtro });
  verificar(
    historialOtro.data?.consultas?.length === 0,
    "Un usuario nuevo NO ve las consultas de otro usuario",
    `vio: ${historialOtro.data?.consultas?.length}`
  );

  const perfilOtro = await api("GET", "/api/perfil", { token: tokenOtro });
  verificar(
    !perfilOtro.data?.perfilSalud?.condicionesMedicas,
    "Un usuario nuevo NO ve el perfil de salud de otro usuario"
  );

  const adminOtro = await api("GET", "/api/consultas/admin", { token: tokenOtro });
  verificar(
    adminOtro.status === 403,
    "Un CLIENTE no puede entrar al panel de administración (403)",
    `status=${adminOtro.status}`
  );

  // ================================================================
  seccion("8. Bitácora de auditoría");
  // ================================================================
  const auditoria = leerAuditoriaDeUsuario(usuarioId);
  verificar(auditoria.length > 0, `Se registraron ${auditoria.length} eventos de auditoría`);
  verificar(
    auditoria.every((a) => a.accion && a.fecha && a.recursoAccedido),
    "Todo evento tiene acción, recurso y fecha"
  );
  const acciones = [...new Set(auditoria.map((a) => a.accion))];
  info(`acciones registradas: ${acciones.join(", ")}`);

  // ================================================================
  // Resumen
  // ================================================================
  const exitosos = pasos - fallos;
  console.log(`\n${C.cian}╔══════════════════════════════════════════════════════════╗${C.reset}`);
  if (fallos === 0) {
    console.log(
      `${C.cian}║${C.reset}  ${C.verde}RESULTADO: ${exitosos}/${pasos} verificaciones correctas${C.reset}` +
        " ".repeat(Math.max(0, 22 - String(exitosos).length - String(pasos).length)) +
        `${C.cian}║${C.reset}`
    );
    console.log(
      `${C.cian}║${C.reset}  La información se mantiene consistente.                 ${C.cian}║${C.reset}`
    );
  } else {
    console.log(
      `${C.cian}║${C.reset}  ${C.rojo}RESULTADO: ${fallos} fallo(s) de ${pasos} verificaciones${C.reset}` +
        " ".repeat(Math.max(0, 20 - String(fallos).length - String(pasos).length)) +
        `${C.cian}║${C.reset}`
    );
  }
  console.log(`${C.cian}╚══════════════════════════════════════════════════════════╝${C.reset}\n`);

  process.exit(fallos === 0 ? 0 : 1);
}

main().catch((err) => {
  console.error(`\n${C.rojo}Error inesperado durante la prueba:${C.reset}`, err.message);
  process.exit(1);
});
