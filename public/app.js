// Frontend del prototipo NutriAsistente IA.
// Consume la API REST del backend (src/routes/*) usando fetch.
// No usa frameworks: JS puro para mantener el prototipo simple de ejecutar.

const API = "/api";
let token = localStorage.getItem("nutrivida_token") || null;
let usuarioActual = JSON.parse(localStorage.getItem("nutrivida_usuario") || "null");
const esPersonal = (usuario) => ["PERSONAL_NUTRIVIDA", "EMPLEADO", "ADMINISTRADOR"].includes(usuario?.rol);

// La API comprueba los permisos reales; esta función solo controla la presentación.
const puede = (permiso) => Array.isArray(usuarioActual?.permisos)
  ? usuarioActual.permisos.includes(permiso)
  : usuarioActual?.rol === "ADMINISTRADOR";

// ---------- Utilidades ----------
async function apiFetch(path, options = {}) {
  const tokenSolicitud = token;
  const headers = { "Content-Type": "application/json", ...(options.headers || {}) };
  if (tokenSolicitud) headers.Authorization = `Bearer ${tokenSolicitud}`;

  const resp = await fetch(`${API}${path}`, { ...options, headers });
  const contentType = resp.headers.get("content-type") || "";
  const data = contentType.includes("application/json") ? await resp.json() : null;

  if (!resp.ok) {
    // Un 401 de una ruta protegida corresponde a la sesión local, no al saldo de IA.
    // Una petición antigua tampoco debe cerrar una sesión que acaba de renovarse.
    if (resp.status === 401 && !path.startsWith("/auth/") && token === tokenSolicitud) {
      cerrarSesion();
      document.getElementById("loginForm").classList.add("active");
      document.getElementById("registerForm").classList.remove("active");
      document.querySelectorAll(".tab-btn").forEach((btn) => {
        btn.classList.toggle("active", btn.dataset.tab === "login");
      });
      mostrarErrorAuth("Tu sesión venció o dejó de ser válida. Inicia sesión nuevamente.");
      document.getElementById("loginCorreo").focus();
    }
    const err = new Error(data?.error || `Error ${resp.status}`);
    err.status = resp.status;
    err.codigo = data?.codigo;
    throw err;
  }
  return data;
}

function guardarSesion(nuevoToken, usuario) {
  token = nuevoToken;
  usuarioActual = usuario;
  localStorage.setItem("nutrivida_token", token);
  localStorage.setItem("nutrivida_usuario", JSON.stringify(usuario));
}

function cerrarSesion() {
  cancelarEdicionProducto();
  token = null;
  usuarioActual = null;
  localStorage.removeItem("nutrivida_token");
  localStorage.removeItem("nutrivida_usuario");
  render();
}

// ---------- Render principal ----------
function render() {
  const viewAuth = document.getElementById("viewAuth");
  const viewCliente = document.getElementById("viewCliente");
  const viewAdmin = document.getElementById("viewAdmin");
  const userBox = document.getElementById("userBox");

  viewAuth.classList.add("hidden");
  viewCliente.classList.add("hidden");
  viewAdmin.classList.add("hidden");
  userBox.classList.add("hidden");

  if (!usuarioActual) {
    window.nutrividaRender?.(null);
    viewAuth.classList.remove("hidden");
    return;
  }

  userBox.classList.remove("hidden");
  document.getElementById("userName").textContent =
    `${usuarioActual.nombre} (${usuarioActual.rol === "ADMINISTRADOR" ? "Administrador" : esPersonal(usuarioActual) ? "Empleado" : "Cliente"})`;

  if (window.nutrividaRender) { window.nutrividaRender(usuarioActual); return; }

  if (esPersonal(usuarioActual)) {
    viewAdmin.classList.remove("hidden");
    document.getElementById("productoForm").classList.toggle("hidden", !puede("GESTIONAR_CATALOGO"));
    document.getElementById("revisionConsultasCard").classList.toggle("hidden", !puede("REVISAR_CONSULTAS"));
    cargarProductos();
    if (puede("REVISAR_CONSULTAS")) cargarConsultasAdmin();
  } else {
    viewCliente.classList.remove("hidden");
    cargarPerfil();
    cargarHistorial();
  }
}

// ---------- Autenticación ----------
document.querySelectorAll(".tab-btn").forEach((btn) => {
  btn.addEventListener("click", () => {
    document.querySelectorAll(".tab-btn").forEach((b) => b.classList.remove("active"));
    document.querySelectorAll(".tab-panel").forEach((p) => p.classList.remove("active"));
    btn.classList.add("active");
    document.getElementById(`${btn.dataset.tab}Form`).classList.add("active");
  });
});

function mostrarErrorAuth(mensaje) {
  const el = document.getElementById("authError");
  el.textContent = mensaje;
  el.classList.remove("hidden");
}

document.getElementById("loginForm").addEventListener("submit", async (e) => {
  e.preventDefault();
  document.getElementById("authError").classList.add("hidden");
  try {
    const data = await apiFetch("/auth/login", {
      method: "POST",
      body: JSON.stringify({
        correo: document.getElementById("loginCorreo").value,
        password: document.getElementById("loginPassword").value,
      }),
    });
    guardarSesion(data.token, data.usuario);
    render();
  } catch (err) {
    mostrarErrorAuth(err.message);
  }
});

document.getElementById("registerForm").addEventListener("submit", async (e) => {
  e.preventDefault();
  document.getElementById("authError").classList.add("hidden");
  try {
    const data = await apiFetch("/auth/register", {
      method: "POST",
      body: JSON.stringify({
        nombre: document.getElementById("regNombre").value,
        correo: document.getElementById("regCorreo").value,
        password: document.getElementById("regPassword").value,
      }),
    });
    guardarSesion(data.token, data.usuario);
    render();
  } catch (err) {
    mostrarErrorAuth(err.message);
  }
});

document.getElementById("logoutBtn").addEventListener("click", async () => {
  try { await apiFetch("/auth/logout", {method:"POST"}); cerrarSesion(); }
  catch(err) { if(err.status===401) cerrarSesion(); else alert("No se pudo cerrar la sesión en el servidor. Intenta de nuevo."); }
});

// ---------- Perfil de salud (cliente) ----------
// Sincronización del consentimiento (corrección FASE 9B-2 del defecto heredado de FASE 9A):
// - cargaPerfilActual: solo la carga MÁS RECIENTE puede pintar el estado (una respuesta antigua se descarta).
// - versionConsentimiento: aumenta al ENVIAR un cambio de consentimiento y otra vez al TERMINAR ese envío. Si cambió
//   mientras una carga estaba en curso (o la carga empezó con un guardado en vuelo), su respuesta puede ser anterior
//   al cambio y NO sobrescribe el estado confirmado.
// - Mientras se carga o se guarda, las casillas permanecen deshabilitadas.
const TEXTO_CARGANDO_CONSENTIMIENTO = "Cargando tu autorización…";
let cargaPerfilActual = 0, versionConsentimiento = 0, cargandoConsentimientos = false, guardandoConsentimiento = false;
async function cargarPerfil() {
  const carga = ++cargaPerfilActual, version = versionConsentimiento;
  cargandoConsentimientos = true;
  bloquearConsentimientos();
  if (!guardandoConsentimiento) mensajeConsentimiento(TEXTO_CARGANDO_CONSENTIMIENTO);
  let data = null, fallo = null;
  try { data = await apiFetch("/perfil"); } catch (err) { console.error(err); fallo = err; }
  if (carga !== cargaPerfilActual) return; // Respuesta de una carga anterior: la más reciente decide.
  cargandoConsentimientos = false;
  if (data) {
    const p = data.perfilSalud || {};
    document.getElementById("perfilCondiciones").value = p.condicionesMedicas || "";
    document.getElementById("perfilAlergias").value = p.alergias || "";
    document.getElementById("perfilObjetivo").value = p.objetivoNutricional || "";
  }
  if (version !== versionConsentimiento) {
    // Se envió un cambio de consentimiento después de iniciar esta carga: su respuesta puede ser anterior a ese
    // cambio. Se conserva el último estado CONFIRMADO por el servidor (o el que confirme el guardado en curso).
    mostrarConsentimientos(consentimientosGuardados);
    if (document.getElementById("consentMsg").textContent === TEXTO_CARGANDO_CONSENTIMIENTO) mensajeConsentimiento("");
  } else if (fallo) {
    mostrarConsentimientos(null, "No se pudo cargar el estado de tus autorizaciones. Revisa la conexión y pulsa Reintentar.");
  } else if (!consentimientosValidos(data.consentimientos)) {
    // Si la respuesta no trae los consentimientos (p. ej. un servidor iniciado antes de FASE 9A) no se bloquea en
    // silencio: se informa y se ofrece reintentar.
    mostrarConsentimientos(null, "No se pudo leer el estado de tus autorizaciones desde el servidor. Si NutriVida se actualizó, reinicia el servidor y pulsa Reintentar.");
  } else {
    mostrarConsentimientos(data.consentimientos);
    mensajeConsentimiento("");
  }
  cargarAlimentacion();
}

// ---------- FASE 9A: consentimientos independientes ----------
// La casilla SOLO refleja lo que PostgreSQL confirmó: nunca se muestra activada antes de la respuesta del servidor.
const CONSENTIMIENTOS_UI = { consentPerfil: "autorizaContextoIA", consentHistorial: "autorizaHistorialIA" };
let consentimientosGuardados = null;
function mensajeConsentimiento(texto, error = false) {
  const msg = document.getElementById("consentMsg");
  msg.textContent = texto; msg.classList.toggle("msg-error", error); msg.classList.toggle("hidden", !texto);
}
function consentimientosValidos(estado) {
  return !!estado && typeof estado === "object" && typeof estado.autorizaContextoIA === "boolean" && typeof estado.autorizaHistorialIA === "boolean";
}
function bloquearConsentimientos() {
  for (const id of Object.keys(CONSENTIMIENTOS_UI)) document.getElementById(id).disabled = true;
}
// Única función que pinta las casillas y el aviso de «Mi alimentación»: ambos salen del MISMO estado confirmado.
// NULL/FALSE (o sin dato válido) = no autorizado.
function mostrarConsentimientos(estado, error) {
  consentimientosGuardados = consentimientosValidos(estado) ? { autorizaContextoIA: estado.autorizaContextoIA === true, autorizaHistorialIA: estado.autorizaHistorialIA === true } : null;
  document.getElementById("consentReintentar").classList.toggle("hidden", !!consentimientosGuardados);
  for (const [id, campo] of Object.entries(CONSENTIMIENTOS_UI)) {
    const casilla = document.getElementById(id);
    casilla.checked = consentimientosGuardados ? consentimientosGuardados[campo] : false;
    casilla.disabled = !consentimientosGuardados || cargandoConsentimientos || guardandoConsentimiento;
  }
  if (error) mensajeConsentimiento(error, true);
  avisoAlimentacion();
}
document.getElementById("consentReintentar").addEventListener("click", () => { cargarPerfil(); });
for (const [id, campo] of Object.entries(CONSENTIMIENTOS_UI)) {
  document.getElementById(id).addEventListener("change", async (e) => {
    const casilla = e.target;
    // Sin estado confirmado, durante una carga o con otro guardado en curso no se envía nada.
    if (!consentimientosGuardados || cargandoConsentimientos || guardandoConsentimiento) {
      casilla.checked = consentimientosGuardados ? consentimientosGuardados[campo] : false; return;
    }
    const solicitado = casilla.checked;
    // Volver al estado guardado mientras el servidor confirma.
    casilla.checked = consentimientosGuardados[campo];
    guardandoConsentimiento = true; versionConsentimiento++;
    bloquearConsentimientos();
    mensajeConsentimiento("Guardando…");
    try {
      // Límite de espera: la interfaz nunca queda bloqueada indefinidamente.
      const data = await apiFetch("/perfil/consentimiento", { method: "PUT", body: JSON.stringify({ [campo]: solicitado }),
        ...(typeof AbortSignal !== "undefined" && AbortSignal.timeout ? { signal: AbortSignal.timeout(15000) } : {}) });
      if (!consentimientosValidos(data.consentimientos)) throw new Error("respuesta del servidor no válida");
      guardandoConsentimiento = false; versionConsentimiento++;
      mostrarConsentimientos(data.consentimientos);
      mensajeConsentimiento(solicitado ? "Autorización guardada." : "Autorización retirada.");
    } catch (err) {
      guardandoConsentimiento = false; versionConsentimiento++;
      mostrarConsentimientos(consentimientosGuardados);
      const motivo = err?.name === "TimeoutError" || err?.name === "AbortError" ? "el servidor no respondió a tiempo"
        : err instanceof TypeError || !err.message ? "no hubo conexión con el servidor" : err.message;
      // Nunca se presenta como guardado. Si el servidor no respondió, el estado real podría ser otro: se ofrece consultarlo.
      mensajeConsentimiento(`No se guardó el cambio: ${motivo}. Se muestra el último estado confirmado; pulsa «Reintentar» para consultar el estado guardado.`, true);
      document.getElementById("consentReintentar").classList.remove("hidden");
    }
  });
}

// ---------- FASE 9B-2: Mi alimentación ----------
// Opciones y selección SIEMPRE desde el servidor (PostgreSQL). Guardar no cambia el consentimiento; ante un error las
// casillas conservan lo que el cliente marcó (no se pierde la selección) y se informa que no se guardó.
const GRUPOS_ALIMENTACION = { preferencias: "alimPreferencias", restricciones: "alimRestricciones", alergenos: "alimAlergenos" };
const AVISO_SIN_CONTEXTO = "Las preferencias y restricciones guardadas no se utilizarán automáticamente en las recomendaciones mientras no autorices el uso del contexto de tu perfil. Puedes indicar tus restricciones directamente en cada consulta.";
const AVISO_CON_CONTEXTO = "Autorizaste el uso del contexto de tu perfil: tus restricciones y alérgenos seleccionados se aplican al filtrar las recomendaciones y tus preferencias ayudan a ordenarlas. Ninguna recomendación es una certificación.";
let opcionesAlimentacion = null, cargaAlimentacionActual = 0, versionAlimentacion = 0, guardandoAlimentacion = false;
function mensajeAlimentacion(texto, error = false) {
  const msg = document.getElementById("alimentacionMsg");
  msg.textContent = texto; msg.classList.toggle("msg-error", error); msg.classList.toggle("hidden", !texto);
}
function avisoAlimentacion() {
  const aviso = document.getElementById("alimentacionEstado");
  if (!consentimientosGuardados) { aviso.classList.add("hidden"); return; }
  const activo = consentimientosGuardados.autorizaContextoIA === true;
  aviso.textContent = activo ? AVISO_CON_CONTEXTO : AVISO_SIN_CONTEXTO;
  aviso.classList.toggle("activo", activo); aviso.classList.remove("hidden");
}
function alimentacionValida(a) { return !!a && Object.keys(GRUPOS_ALIMENTACION).every((g) => Array.isArray(a[g])); }
function mostrarAlimentacion(seleccion) {
  for (const [grupo, id] of Object.entries(GRUPOS_ALIMENTACION)) {
    const elegidos = new Set(seleccion[grupo]);
    document.getElementById(id).replaceChildren(...opcionesAlimentacion[grupo].map((o) => {
      const label = document.createElement("label"), input = document.createElement("input"), texto = document.createElement("span"), nota = document.createElement("small");
      label.className = "opcion-alimentacion" + (o.habilitada ? "" : " deshabilitada");
      input.type = "checkbox"; input.dataset.grupo = grupo; input.dataset.codigo = o.codigo;
      input.checked = o.habilitada && elegidos.has(o.codigo); input.disabled = !o.habilitada;
      texto.textContent = o.etiqueta + (o.habilitada ? "" : " (no disponible)"); nota.textContent = o.explicacion || "";
      texto.append(nota); label.append(input, texto); return label;
    }));
  }
}
function seleccionAlimentacion() {
  const salida = {};
  for (const [grupo, id] of Object.entries(GRUPOS_ALIMENTACION))
    salida[grupo] = [...document.querySelectorAll(`#${id} input[type=checkbox]:checked:not(:disabled)`)].map((i) => i.dataset.codigo);
  return salida;
}
async function cargarAlimentacion() {
  const carga = ++cargaAlimentacionActual, version = versionAlimentacion;
  const guardar = document.getElementById("alimentacionGuardar");
  guardar.disabled = true; document.getElementById("alimentacionReintentar").classList.add("hidden");
  mensajeAlimentacion("Cargando…");
  try {
    const data = await apiFetch("/perfil/alimentacion", typeof AbortSignal !== "undefined" && AbortSignal.timeout ? { signal: AbortSignal.timeout(15000) } : {});
    if (carga !== cargaAlimentacionActual) return; // una carga más reciente decide
    if (!alimentacionValida(data.alimentacion) || !alimentacionValida(data.opciones)) throw new Error("respuesta del servidor no válida");
    opcionesAlimentacion = data.opciones;
    // Si se guardó durante esta carga, su respuesta es anterior: se conserva lo confirmado por el guardado.
    if (version === versionAlimentacion) mostrarAlimentacion(data.alimentacion);
    if (!guardandoAlimentacion) { guardar.disabled = false; mensajeAlimentacion(""); }
  } catch (err) {
    if (carga !== cargaAlimentacionActual) return;
    console.error(err);
    document.getElementById("alimentacionReintentar").classList.remove("hidden");
    mensajeAlimentacion("No se pudo cargar tu información alimentaria. Si NutriVida se actualizó, reinicia el servidor y pulsa Reintentar.", true);
  }
  avisoAlimentacion();
}
document.getElementById("alimentacionReintentar").addEventListener("click", cargarAlimentacion);
document.getElementById("alimentacionGuardar").addEventListener("click", async () => {
  if (!opcionesAlimentacion) return;
  const boton = document.getElementById("alimentacionGuardar");
  boton.disabled = true; versionAlimentacion++; guardandoAlimentacion = true; mensajeAlimentacion("Guardando…");
  try {
    // Reemplazo explícito de los tres grupos (una lista vacía borra ese grupo).
    const data = await apiFetch("/perfil/alimentacion", { method: "PUT", body: JSON.stringify(seleccionAlimentacion()),
      ...(typeof AbortSignal !== "undefined" && AbortSignal.timeout ? { signal: AbortSignal.timeout(15000) } : {}) });
    if (!alimentacionValida(data.alimentacion)) throw new Error("respuesta del servidor no válida");
    mostrarAlimentacion(data.alimentacion);
    mensajeAlimentacion("Tu información alimentaria se guardó.");
  } catch (err) {
    const motivo = err?.name === "TimeoutError" || err?.name === "AbortError" ? "el servidor no respondió a tiempo"
      : err instanceof TypeError || !err.message ? "no hubo conexión con el servidor" : err.message;
    mensajeAlimentacion(`No se guardó: ${motivo}. Tu selección sigue en pantalla para que puedas reintentar.`, true);
  } finally { guardandoAlimentacion = false; boton.disabled = false; }
});

document.getElementById("perfilForm").addEventListener("submit", async (e) => {
  e.preventDefault();
  const msg = document.getElementById("perfilMsg");
  try {
    await apiFetch("/perfil", {
      method: "PUT",
      body: JSON.stringify({
        condicionesMedicas: document.getElementById("perfilCondiciones").value,
        alergias: document.getElementById("perfilAlergias").value,
        objetivoNutricional: document.getElementById("perfilObjetivo").value,
      }),
    });
    msg.textContent = "Perfil guardado correctamente.";
    msg.classList.remove("hidden");
    setTimeout(() => msg.classList.add("hidden"), 3000);
  } catch (err) {
    msg.textContent = `Error: ${err.message}`;
    msg.classList.remove("hidden");
  }
});

// ---------- Consulta al asistente ----------
const consultaTexto = document.getElementById("consultaTexto");
consultaTexto.addEventListener("input", () => {
  document.getElementById("contador").textContent = `${consultaTexto.value.length} / 500`;
});

document.getElementById("consultaForm").addEventListener("submit", async (e) => {
  e.preventDefault();
  const btn = document.getElementById("consultaBtn");
  const box = document.getElementById("respuestaBox");
  const tarjetas = document.getElementById("recomendacionesIA");
  tarjetas.replaceChildren();
  tarjetas.classList.add("hidden");
  box.classList.add("hidden");
  box.classList.remove("error-box");
  btn.disabled = true;
  btn.textContent = "Consultando al asistente...";

  try {
    const data = await apiFetch("/consultas", {
      method: "POST",
      body: JSON.stringify({ texto: consultaTexto.value }),
    });
    box.textContent = data.consulta.respuestaIA;
    box.classList.remove("hidden");
    mostrarRecomendaciones(tarjetas, data.consulta.productosRecomendados);
    consultaTexto.value = "";
    document.getElementById("contador").textContent = "0 / 500";
  } catch (err) {
    box.textContent = `No se pudo procesar tu consulta: ${err.message}`;
    box.classList.add("error-box");
    box.classList.remove("hidden");
  } finally {
    btn.disabled = false;
    btn.textContent = "Enviar consulta";
    cargarHistorial();
  }
});

async function cargarHistorial() {
  const cont = document.getElementById("historialList");
  try {
    const data = await apiFetch("/consultas");
    cont.classList.remove("error");
    // Texto de API/IA siempre como textContent (FASE 6.5 / 7.4 / 8).
    if (data.consultas.length === 0) {
      cont.replaceChildren(nodoTexto("p", "Todavía no tienes consultas registradas.", "muted"));
      return;
    }
    cont.replaceChildren(...data.consultas.map((c) => {
      const item = nodoTexto("div", undefined, "item");
      const meta = nodoTexto("div", new Date(c.fecha).toLocaleString("es-GT") + " ", "meta");
      meta.append(nodoEstado(c.estado));
      item.append(meta, nodoTexto("strong", "Tú: "), document.createTextNode(c.texto ?? ""), document.createElement("br"));
      if (c.respuestaIA) item.append(nodoTexto("strong", "NutriVida AI: "), document.createTextNode(c.respuestaIA));
      return item;
    }));
  } catch (err) {
    cont.textContent = err.message;
    cont.classList.add("error");
  }
}

// ---------- Administración: catálogo ----------
let productosCatalogo = [];
let productoEnEdicion = null;
const productoGuardarBtn = document.getElementById("productoGuardarBtn");
const productoCancelarBtn = document.getElementById("productoCancelarBtn");

function mensajeProducto(texto) {
  const msg = document.getElementById("productoMsg");
  msg.textContent = texto;
  msg.classList.toggle("hidden", !texto);
}

function cancelarEdicionProducto() {
  productoEnEdicion = null;
  document.getElementById("productoForm").reset();
  productoGuardarBtn.textContent = "Agregar producto";
  productoCancelarBtn.classList.add("hidden");
  mensajeProducto("");
}

productoCancelarBtn.addEventListener("click", cancelarEdicionProducto);

document.getElementById("productosList").addEventListener("click", async (event) => {
  const button = event.target.closest("button[data-producto]");
  if (!button) return;
  const producto = productosCatalogo.find((p) => p.id === button.dataset.producto);
  if (!producto) return;

  if (button.dataset.accion === "editar") {
    productoEnEdicion = producto.id;
    document.getElementById("prodNombre").value = producto.nombre;
    document.getElementById("prodCategoria").value = producto.categoria;
    document.getElementById("prodIngredientes").value = producto.ingredientes;
    document.getElementById("prodValores").value = producto.valoresNutricionales;
    productoGuardarBtn.textContent = "Guardar cambios";
    productoCancelarBtn.classList.remove("hidden");
    mensajeProducto(`Editando: ${producto.nombre}`);
    document.getElementById("prodNombre").focus();
    return;
  }

  if (button.dataset.accion !== "eliminar" || !window.confirm(`¿Eliminar el producto "${producto.nombre}"?`)) return;
  button.disabled = true;
  try {
    await apiFetch(`/productos/${encodeURIComponent(producto.id)}`, { method: "DELETE" });
    if (productoEnEdicion === producto.id) cancelarEdicionProducto();
    mensajeProducto("Producto eliminado.");
    await cargarProductos();
  } catch (err) {
    mensajeProducto(`Error: ${err.message}`);
  } finally {
    button.disabled = false;
  }
});

async function cargarProductos() {
  const cont = document.getElementById("productosList");
  try {
    const data = await apiFetch("/productos");
    productosCatalogo = data.productos;
    if (!data.productos.length) { cont.replaceChildren(nodoTexto("p", "No hay productos registrados.", "muted")); return; }
    cont.replaceChildren(...data.productos.map((p) => {
      const item = nodoTexto("div", undefined, "item");
      item.append(nodoTexto("strong", p.nombre), document.createTextNode(" — "), nodoTexto("span", p.categoria, "muted"),
        document.createElement("br"), document.createTextNode(p.ingredientes ?? ""), document.createElement("br"),
        nodoTexto("span", p.valoresNutricionales, "muted"));
      if (puede("GESTIONAR_CATALOGO")) {
        const acciones = document.createElement("div");
        for (const [accion, etiqueta] of [["editar", "Editar"], ["eliminar", "Eliminar"]]) {
          const b = nodoTexto("button", etiqueta, "btn-ghost-admin");
          b.type = "button"; b.dataset.accion = accion; b.dataset.producto = p.id;
          acciones.append(b);
        }
        item.append(acciones);
      }
      return item;
    }));
  } catch (err) {
    cont.textContent = `Error: ${err.message}`;
  }
}

document.getElementById("productoForm").addEventListener("submit", async (e) => {
  e.preventDefault();
  const id = productoEnEdicion;
  productoGuardarBtn.disabled = true;
  try {
    await apiFetch(id ? `/productos/${encodeURIComponent(id)}` : "/productos", {
      method: id ? "PUT" : "POST",
      body: JSON.stringify({
        nombre: document.getElementById("prodNombre").value,
        categoria: document.getElementById("prodCategoria").value,
        ingredientes: document.getElementById("prodIngredientes").value,
        valoresNutricionales: document.getElementById("prodValores").value,
      }),
    });
    cancelarEdicionProducto();
    mensajeProducto(id ? "Producto actualizado." : "Producto agregado.");
    await cargarProductos();
  } catch (err) {
    mensajeProducto(`Error: ${err.message}`);
  } finally {
    productoGuardarBtn.disabled = false;
  }
});

// ---------- Administración: revisión de consultas ----------
async function cargarConsultasAdmin() {
  const cont = document.getElementById("consultasAdminList");
  try {
    const data = await apiFetch("/consultas/admin");
    cont.classList.remove("error");
    if (data.consultas.length === 0) {
      cont.replaceChildren(nodoTexto("p", "No hay consultas registradas todavía.", "muted"));
      return;
    }
    cont.replaceChildren(...data.consultas.map((c) => {
      const item = nodoTexto("div", undefined, "item");
      const meta = nodoTexto("div", `${c.clienteNombre ?? ""} — ${new Date(c.fecha).toLocaleString("es-GT")} `, "meta");
      meta.append(nodoEstado(c.estado));
      if (c.revisada) meta.append(nodoTexto("span", " ✓ Revisada", "badge-revisada"));
      item.append(meta, nodoTexto("strong", "Consulta: "), document.createTextNode(c.texto ?? ""), document.createElement("br"));
      if (c.respuestaIA) item.append(nodoTexto("strong", "Respuesta: "), document.createTextNode(c.respuestaIA), document.createElement("br"));
      if (!c.revisada) { const b = nodoTexto("button", "Marcar como revisada", "btn-ghost-admin"); b.dataset.revisar = c.id; item.append(b); }
      return item;
    }));
  } catch (err) {
    cont.textContent = err.message;
    cont.classList.add("error");
  }
}

async function marcarRevisada(id) {
  try {
    await apiFetch(`/consultas/${id}/revisar`, { method: "PUT" });
    cargarConsultasAdmin();
  } catch (err) {
    alert(err.message);
  }
}
document.getElementById("consultasAdminList").addEventListener("click", (event) => {
  const id=event.target?.dataset?.revisar;
  if(id && puede("REVISAR_CONSULTAS")) marcarRevisada(id);
});

// ---------- Helpers ----------
// Tarjetas de productos recomendados: SOLO datos oficiales resueltos por el backend en PostgreSQL
// (la IA únicamente eligió IDs). Construcción con createElement/textContent; sin innerHTML.
const RUTA_IMAGEN_PRODUCTO = /^\/images\/productos\/[a-z0-9]+(?:-[a-z0-9]+)*\.(?:webp|png|jpe?g)$/;
const DISPONIBILIDAD_IA = { CON_EXISTENCIA: "Disponible", BAJO_STOCK: "Bajo stock" };
function mostrarRecomendaciones(cont, productos) {
  cont.replaceChildren();
  const lista = Array.isArray(productos) ? productos : [];
  cont.classList.toggle("hidden", lista.length === 0);
  for (const p of lista) {
    const card = nodoTexto("article", undefined, "product-card ia-card");
    const img = document.createElement("img");
    img.src = typeof p.imagenUrl === "string" && RUTA_IMAGEN_PRODUCTO.test(p.imagenUrl) ? p.imagenUrl : "/images/producto.svg";
    img.alt = String(p.nombre ?? "");
    img.loading = "lazy"; img.width = 600; img.height = 450;
    img.addEventListener("error", () => { img.src = "/images/producto.svg"; }, { once: true });
    const body = nodoTexto("div", undefined, "product-card-body");
    body.append(nodoTexto("span", p.categoria, "product-category"), nodoTexto("h3", p.nombre));
    if (p.descripcion) body.append(nodoTexto("p", p.descripcion, "product-desc"));
    body.append(nodoTexto("p", p.precioFormateado || "", "product-price"),
      nodoTexto("span", DISPONIBILIDAD_IA[p.disponibilidad] || "Disponible", "availability"));
    card.append(img, body);
    cont.append(card);
  }
}

function nodoTexto(tipo, texto, clase) {
  const n = document.createElement(tipo);
  if (texto !== undefined) n.textContent = texto ?? "";
  if (clase) n.className = clase;
  return n;
}
const ESTADOS_CONSULTA = ["PENDIENTE", "RESPONDIDA", "ERROR"];
function nodoEstado(estado) {
  const n = nodoTexto("span", estado, "estado");
  if (ESTADOS_CONSULTA.includes(estado)) n.classList.add(estado);
  return n;
}

// ---------- Inicio ----------
render();
