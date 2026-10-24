// Comprobaciones locales de los flujos UML: sin .env, datos reales ni llamadas a proveedores de IA.
const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

const escapar = (t) => String(t ?? "").replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;").replaceAll('"', "&quot;");
function nodoFalso(tag) {
  const clases = new Set();
  return { tag, textContent: "", className: "", type: "", dataset: {}, hijos: [],
    classList: { add: (c) => clases.add(c), contains: (c) => clases.has(c) },
    append(...h) { this.hijos.push(...h); },
    addEventListener(tipo, fn) { this.eventos = { ...(this.eventos || {}), [tipo]: fn }; },
    set innerHTML(v) { assert.fail("innerHTML prohibido para datos dinámicos"); },
    get innerHTML() { return escapar(this.textContent) + this.hijos.map(serializar).join(""); } };
}
function serializar(n) {
  if (n && "texto" in n) return escapar(n.texto);
  const datos = Object.entries(n.dataset || {}).map(([k, v]) => ` data-${k}="${escapar(v)}"`).join("");
  return `<${n.tag}${datos}>${n.innerHTML}</${n.tag}>`;
}

function interfaz(rol = null) {
  const elementos = new Map();
  for (const [, id] of fs.readFileSync(path.join(__dirname, "../public/index.html"), "utf8").matchAll(/id="([^"]+)"/g)) {
    const clases = new Set();
    elementos.set(id, {
      value: "", textContent: "", innerHTML: "", disabled: false, eventos: {},
      classList: { add: (c) => clases.add(c), remove: (c) => clases.delete(c),
        contains: (c) => clases.has(c),
        toggle: (c, activo) => activo ? clases.add(c) : clases.delete(c) },
      addEventListener(tipo, fn) { this.eventos[tipo] = fn; },
      reset() {}, focus() {},
      // DOM seguro: los nodos hijos se serializan escapados solo para poder inspeccionarlos.
      hijos: [],
      replaceChildren(...hijos) { this.hijos = [...hijos]; this.innerHTML = hijos.map(serializar).join(""); },
      append(...hijos) { this.hijos.push(...hijos); this.innerHTML += hijos.map(serializar).join(""); },
    });
  }
  const llamadas = [];
  let confirmar = true;
  let fallar = false;
  let productos = [{ id: "p1", nombre: "Original", categoria: "Bebida", ingredientes: "Agua", valoresNutricionales: "0 kcal" }];
  const almacenamiento = new Map(rol ? [
    ["nutrivida_usuario", JSON.stringify({ nombre: "Personal", rol })],
    ["nutrivida_token", "token-simulado"],
  ] : []);
  const contexto = vm.createContext({
    document: {
      getElementById: (id) => { assert.ok(elementos.has(id), `Elemento existente: ${id}`); return elementos.get(id); },
      querySelectorAll: () => [],
      createElement: (tag) => nodoFalso(tag),
      createTextNode: (texto) => ({ texto: String(texto) }),
    },
    window: { confirm: () => confirmar },
    localStorage: { getItem: (key) => almacenamiento.get(key) ?? null,
      setItem: (key, value) => almacenamiento.set(key, value), removeItem: (key) => almacenamiento.delete(key) },
    console, setTimeout, alert:()=>{},
    fetch: async (url, options) => {
      const method = options.method || "GET";
      llamadas.push({ url, method, body: options.body && JSON.parse(options.body) });
      let data = {};
      let status = 200;
      if (fallar && method !== "GET") { status = 503; data = { error: "Falla simulada" }; }
      else if (method === "GET" && url === "/api/productos") data = { productos };
      else if (method === "GET" && ["/api/consultas", "/api/consultas/admin"].includes(url)) data = { consultas: [] };
      else if (method === "PUT") productos = productos.map((p) => p.id === "p1" ? { ...p, ...JSON.parse(options.body) } : p);
      else if (method === "DELETE") { productos = []; status = 204; }
      return { ok: status < 400, status, headers: { get: () => status === 204 ? "" : "application/json" }, json: async () => data };
    },
  });
  vm.runInContext(fs.readFileSync(path.join(__dirname, "../public/app.js"), "utf8"), contexto);
  return {
    elementos, llamadas, contexto, almacenamiento,
    confirmar: (v) => { confirmar = v; }, fallar: (v) => { fallar = v; },
    click: (accion) => elementos.get("productosList").eventos.click({ target: { closest: () => ({ dataset: { producto: "p1", accion } }) } }),
    enviar: (id) => elementos.get(id).eventos.submit({ preventDefault() {}, target: elementos.get(id) }),
  };
}

test("Catálogo: editar conserva el producto, cancelar vuelve a creación y eliminar exige confirmación", async () => {
  const ui = interfaz();
  await vm.runInContext("cargarProductos()", ui.contexto);
  await ui.click("editar");
  assert.equal(ui.elementos.get("prodNombre").value, "Original");
  ui.elementos.get("prodNombre").value = "Actualizado";
  await ui.enviar("productoForm");
  assert.equal(ui.llamadas.find((r) => r.method === "PUT").url, "/api/productos/p1");
  assert.match(ui.elementos.get("productosList").innerHTML, /Actualizado/);
  await ui.click("editar");
  ui.elementos.get("productoCancelarBtn").eventos.click();
  await ui.enviar("productoForm");
  assert.equal(ui.llamadas.filter((r) => r.method === "POST").length, 1);
  ui.confirmar(false);
  await ui.click("eliminar");
  assert.equal(ui.llamadas.filter((r) => r.method === "DELETE").length, 0);
  ui.confirmar(true);
  await ui.click("eliminar");
  assert.equal(ui.llamadas.filter((r) => r.method === "DELETE").length, 1);
  assert.match(ui.elementos.get("productosList").innerHTML, /No hay productos/);
});

test("Una edición fallida conserva el formulario para reintentar", async () => {
  const ui = interfaz();
  await vm.runInContext("cargarProductos()", ui.contexto);
  await ui.click("editar");
  ui.fallar(true);
  await ui.enviar("productoForm");
  assert.match(ui.elementos.get("productoMsg").textContent, /Falla simulada/);
  assert.equal(ui.elementos.get("productoGuardarBtn").disabled, false);
  assert.equal(ui.elementos.get("prodNombre").value, "Original");
  ui.fallar(false);
  await ui.enviar("productoForm");
  assert.equal(ui.llamadas.filter((r) => r.method === "PUT").length, 2);
});

test("Una consulta fallida también vuelve a cargar el historial", async () => {
  const ui = interfaz();
  ui.fallar(true);
  await ui.enviar("consultaForm");
  assert.ok(ui.llamadas.some((r) => r.url === "/api/consultas" && r.method === "GET"));
  assert.match(ui.elementos.get("respuestaBox").textContent, /Falla simulada/);
});

test("El personal del UML y las sesiones antiguas acceden a la pantalla administrativa", async () => {
  for (const rol of ["PERSONAL_NUTRIVIDA", "ADMINISTRADOR"]) {
    const ui = interfaz(rol);
    await new Promise(setImmediate);
    assert.equal(ui.elementos.get("viewAdmin").classList.contains("hidden"), false);
    assert.equal(ui.elementos.get("viewCliente").classList.contains("hidden"), true);
    assert.equal(ui.llamadas.some((r) => r.url === "/api/consultas/admin"), rol === "ADMINISTRADOR");
  }
});

const respuesta401 = () => ({ ok: false, status: 401,
  headers: { get: () => "application/json" }, json: async () => ({ error: "Token inválido o expirado." }) });

test("Una sesión vencida limpia las credenciales y muestra el formulario de ingreso", async () => {
  const ui = interfaz("PERSONAL_NUTRIVIDA");
  await new Promise(setImmediate);
  ui.contexto.fetch = async () => respuesta401();
  await assert.rejects(vm.runInContext('apiFetch("/consultas/admin")', ui.contexto), { status: 401 });
  assert.equal(ui.almacenamiento.size, 0);
  assert.equal(ui.elementos.get("viewAuth").classList.contains("hidden"), false);
  assert.equal(ui.elementos.get("viewAdmin").classList.contains("hidden"), true);
  assert.match(ui.elementos.get("authError").textContent, /Inicia sesión nuevamente/);
});

test("Un 401 al ingresar mantiene el error de credenciales y no se confunde con sesión vencida", async () => {
  const ui = interfaz();
  ui.contexto.fetch = async () => ({ ...respuesta401(), json: async () => ({ error: "Correo o contraseña incorrectos." }) });
  await ui.enviar("loginForm");
  assert.equal(ui.elementos.get("authError").textContent, "Correo o contraseña incorrectos.");
});

test("Un 401 atrasado no borra una sesión renovada", async () => {
  const ui = interfaz("PERSONAL_NUTRIVIDA");
  await new Promise(setImmediate);
  let responder;
  ui.contexto.fetch = () => new Promise((resolve) => { responder = resolve; });
  const peticion = vm.runInContext('apiFetch("/consultas/admin")', ui.contexto);
  vm.runInContext('guardarSesion("token-nuevo", { nombre: "Personal", rol: "PERSONAL_NUTRIVIDA" })', ui.contexto);
  responder(respuesta401());
  await assert.rejects(peticion, { status: 401 });
  assert.equal(ui.almacenamiento.get("nutrivida_token"), "token-nuevo");
  assert.equal(ui.elementos.get("viewAdmin").classList.contains("hidden"), false);
});


test("Errores remotos se muestran como texto en ambos historiales", async () => {
  const ui = interfaz();
  const mensaje = '<img src=x onerror="alert(1)"><script>alert(2)</script>';
  ui.contexto.fetch = async () => ({ ok: false, status: 503,
    headers: { get: () => "application/json" }, json: async () => ({ error: mensaje }) });
  for (const [funcion, id] of [["cargarHistorial", "historialList"], ["cargarConsultasAdmin", "consultasAdminList"]]) {
    const elemento = ui.elementos.get(id);
    Object.defineProperty(elemento, "innerHTML", { configurable: true, get: () => "", set: () => assert.fail("Un error no debe interpretarse como HTML") });
    await vm.runInContext(`${funcion}()`, ui.contexto);
    assert.equal(elemento.textContent, mensaje);
    assert.equal(elemento.classList.contains("error"), true);
  }
});

test("Empleado nuevo ve catálogo sin edición ni historial de clientes", async () => {
  const ui = interfaz("EMPLEADO");
  await new Promise(setImmediate);
  assert.equal(ui.elementos.get("viewAdmin").classList.contains("hidden"), false);
  assert.equal(ui.elementos.get("productoForm").classList.contains("hidden"), true);
  assert.equal(ui.elementos.get("revisionConsultasCard").classList.contains("hidden"), true);
  assert.ok(!ui.llamadas.some((r) => r.url === "/api/consultas/admin"));
  assert.doesNotMatch(ui.elementos.get("productosList").innerHTML, /data-accion/);
});

test("Administrador conserva controles según permisos de la API", async () => {
  const ui = interfaz();
  vm.runInContext('guardarSesion("token", { nombre: "Administrador", rol: "ADMINISTRADOR", permisos: ["GESTIONAR_CATALOGO", "REVISAR_CONSULTAS"] }); render()', ui.contexto);
  await new Promise(setImmediate);
  assert.equal(ui.elementos.get("productoForm").classList.contains("hidden"), false);
  assert.equal(ui.elementos.get("revisionConsultasCard").classList.contains("hidden"), false);
  assert.match(ui.elementos.get("productosList").innerHTML, /data-accion/);
});


test("FASE3 frontend: logout confirma al servidor antes de eliminar credenciales", async()=>{
 const ui=interfaz("ADMINISTRADOR");
 await ui.elementos.get("logoutBtn").eventos.click();
 assert.ok(ui.llamadas.some(r=>r.url==="/api/auth/logout"&&r.method==="POST"));
 assert.equal(ui.almacenamiento.has("nutrivida_token"),false);
 const falla=interfaz("ADMINISTRADOR");falla.fallar(true);
 await falla.elementos.get("logoutBtn").eventos.click();
 assert.equal(falla.almacenamiento.has("nutrivida_token"),true);
});
test("FASE3 frontend: revisión por evento compatible con CSP",async()=>{
 const ui=interfaz("ADMINISTRADOR");
 ui.elementos.get("consultasAdminList").eventos.click({target:{dataset:{revisar:"consulta-sintetica"}}});
 await new Promise(r=>setImmediate(r));
 assert.ok(ui.llamadas.some(r=>r.url==="/api/consultas/consulta-sintetica/revisar"&&r.method==="PUT"));
});

test("FASE8 frontend: respuestas IA y consultas se renderizan como texto, nunca como HTML", async () => {
  const ui = interfaz();
  const ataque = '<img src=x onerror="alert(1)">';
  ui.contexto.fetch = async () => ({ ok: true, status: 200, headers: { get: () => "application/json" },
    json: async () => ({ consultas: [{ id: "c1", fecha: "2026-09-30T12:00:00.000Z", estado: 'RESPONDIDA" onclick="x', texto: ataque, respuestaIA: ataque, clienteNombre: ataque, revisada: false }] }) });
  for (const [funcion, id] of [["cargarHistorial", "historialList"], ["cargarConsultasAdmin", "consultasAdminList"]]) {
    await vm.runInContext(`${funcion}()`, ui.contexto);
    const html = ui.elementos.get(id).innerHTML;
    assert.doesNotMatch(html, /<img/);
    assert.match(html, /&lt;img src=x onerror=&quot;alert\(1\)&quot;&gt;/);
  }
  assert.doesNotMatch(fs.readFileSync(path.join(__dirname, "../public/app.js"), "utf8"), /innerHTML\s*=/);
});

test("NutriVida AI: tarjetas con textContent, imágenes solo /images/productos/ y fallback", async () => {
  const ui = interfaz();
  const cont = ui.elementos.get("recomendacionesIA");
  vm.runInContext(`mostrarRecomendaciones(document.getElementById("recomendacionesIA"), ${JSON.stringify([
    { id: "1", nombre: "<img src=x onerror=alert(1)>", descripcion: "<script>alert(2)</script>", categoria: "Barras y Snacks", precioFormateado: "Q 10.50", disponibilidad: "CON_EXISTENCIA", imagenUrl: "/images/productos/barras-energeticas-naturales.webp" },
    { id: "2", nombre: "Sin imagen", descripcion: null, categoria: "Bebidas", precioFormateado: "Q 15.30", disponibilidad: "BAJO_STOCK", imagenUrl: null },
    { id: "3", nombre: "Ruta externa", categoria: "Bebidas", precioFormateado: "Q 1.00", disponibilidad: "CON_EXISTENCIA", imagenUrl: "https://evil.example/x.webp" },
    { id: "4", nombre: "Traversal", categoria: "Bebidas", precioFormateado: "Q 1.00", disponibilidad: "CON_EXISTENCIA", imagenUrl: "/images/productos/../producto.svg" },
    { id: "5", nombre: "Script", categoria: "Bebidas", precioFormateado: "Q 1.00", disponibilidad: "CON_EXISTENCIA", imagenUrl: "javascript:alert(1)" }])})`, ui.contexto);
  assert.equal(cont.hijos.length, 5);
  const img = c => c.hijos.find(h => h.tag === "img");
  assert.equal(img(cont.hijos[0]).src, "/images/productos/barras-energeticas-naturales.webp");
  for (const c of cont.hijos.slice(1)) assert.equal(img(c).src, "/images/producto.svg");
  assert.equal(typeof img(cont.hijos[0]).eventos.error, "function", "fallback si la imagen falla");
  const cuerpo = cont.hijos[0].hijos.find(h => h.tag === "div");
  assert.deepEqual(cuerpo.hijos.map(h => h.textContent), ["Barras y Snacks", "<img src=x onerror=alert(1)>", "<script>alert(2)</script>", "Q 10.50", "Disponible"]);
  assert.doesNotMatch(cont.innerHTML, /<img src=x|<script>/);
  assert.equal(cont.hijos[1].hijos.find(h => h.tag === "div").hijos.at(-1).textContent, "Bajo stock");
  assert.equal(cont.classList.contains("hidden"), false);
  vm.runInContext(`mostrarRecomendaciones(document.getElementById("recomendacionesIA"), undefined)`, ui.contexto);
  assert.equal(cont.hijos.length, 0); assert.equal(cont.classList.contains("hidden"), true);
});
