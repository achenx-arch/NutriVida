const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");

// Claves exclusivas de pruebas, antes de cargar configuración. No se llama a un proveedor real.
process.env.OLLAMA_MODEL = "modelo-prueba";
process.env.JWT_SECRET = "secreto-jwt-exclusivo-pruebas-locales";
process.env.ENCRYPTION_KEY = "ab".repeat(32);
const { crearStore } = require("../src/data/store");
const { migrarDatos } = require("../src/repositories");
const { crearSistema } = require("../src/services/sistema");
const { crearApp } = require("../src/app");
const { ServicioIA, GENERAL } = require("../src/services/iaService");
const { GestorSeguridad } = require("../src/security/GestorSeguridad");
const { Usuario, Cliente, PersonalNutriVida, Administrador, Consulta, Interaccion, PerfilSalud, Producto } = require("../src/domain/modelos");
const { hashPassword, generarToken } = require("../src/security/auth");

function almacen(t) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "nutri-uml-"));
  t.after(() => {
    const destino = path.resolve(dir);
    assert.equal(path.dirname(destino), path.resolve(os.tmpdir()));
    assert.ok(path.basename(destino).startsWith("nutri-uml-"));
    fs.rmSync(destino, { recursive: true, force: true });
  });
  const archivo = path.join(dir, "db.json");
  return { archivo, store: crearStore(archivo) };
}

test("Clases UML: herencia, métodos, separación de entidades y cifrado persistido", async (t) => {
  const { store, archivo } = almacen(t);
  const seguridad = new GestorSeguridad();
  let cuerpo;
  const ia = new ServicioIA({ seguridad, transporte: async (url, options) => {
    cuerpo = JSON.parse(options.body);
    assert.equal(options.headers["x-api-key"], undefined);
    assert.equal(cuerpo.model, "modelo-prueba");
    assert.equal(store.listar("consultas")[0].estado, "PENDIENTE");
    return { ok: true, json: async () => ({ response: JSON.stringify({tipo:"ORIENTACION_GENERAL",productos:[]}) }) };
  } });
  const sistema = crearSistema({ store, ia, seguridad });
  const cliente = await sistema.registrar({ nombre: "Cliente Prueba", correo: "cliente@example.com", password: "Clave12345" });
  assert.ok(cliente instanceof Cliente && cliente instanceof Usuario);
  assert.equal(await cliente.autenticar("Clave12345"), true);
  assert.equal(await cliente.autenticar("incorrecta"), false);
  assert.ok(cliente.enviarConsulta(" Hola ") instanceof Consulta);
  const perfil = await sistema.perfil.actualizar(cliente.id, { condicionesMedicas: "Condición reservada", alergias: "Alergia reservada", objetivoNutricional: "Objetivo reservado" });
  assert.ok(perfil instanceof PerfilSalud);
  assert.ok(perfil.id);
  // FASE 8: sin candidatos no se llama al modelo; se registra un producto sintético para ejercitar el proveedor.
  sistema.repositorios.productos.guardar(new Producto({ nombre: "Producto sintético", categoria: "Prueba" }));
  const respuesta = await sistema.consultas.enviar(cliente.id, "Pregunta reservada");
  assert.equal(respuesta.estado, "RESPONDIDA");
  assert.equal(respuesta.respuestaIA, GENERAL);
  assert.doesNotMatch(cuerpo.prompt, /Condición reservada|Alergia reservada|Objetivo reservado/);
  assert.equal(store.listar("consultas").length, 1);
  assert.equal(store.listar("interacciones").length, 1);
  assert.equal(store.listar("consultas")[0].respuestaIA, undefined);
  assert.equal(store.listar("interacciones")[0].consultaId, respuesta.id);
  assert.notEqual(store.listar("interacciones")[0].id, respuesta.id);
  const historial = cliente.verHistorial(sistema.repositorios.interacciones);
  assert.ok(historial[0] instanceof Interaccion);
  assert.equal(historial[0].consulta, "Pregunta reservada");
  const textoDisco = fs.readFileSync(archivo, "utf8");
  for (const texto of ["Condición reservada", "Alergia reservada", "Objetivo reservado", "Pregunta reservada", GENERAL, "Clave12345"]) {
    assert.ok(!textoDisco.includes(texto), `No persistir en claro: ${texto}`);
  }
  const recargado = crearSistema({ store: crearStore(archivo), ia });
  assert.equal((await recargado.perfil.obtener(cliente.id)).id, perfil.id);
  assert.equal((await recargado.consultas.historial(cliente.id))[0].respuestaIA, GENERAL);
  assert.throws(() => historial[0].registrar(recargado.repositorios.interacciones, recargado.repositorios.consultas.buscarPorId(respuesta.id)), /ya tiene/);
  assert.equal(store.listar("interacciones").length, 1);
});

test("Migración: conserva cuentas, ids, fechas, revisión e historial; es idempotente", async (t) => {
  const { store, archivo } = almacen(t);
  const seguridad = new GestorSeguridad();
  const hash = await hashPassword("ClaveAnterior123");
  const fecha = "2026-08-01T10:00:00.000Z";
  store.transaccion((d) => {
    d.usuarios.push({ id: "u1", nombre: "Anterior", correo: "anterior@example.com", rol: "ADMINISTRADOR", passwordHash: hash,
      perfilSalud: { condicionesMedicas: seguridad.cifrarDatoSensible("Dato anterior"), alergias: null, objetivoNutricional: "Objetivo anterior" } });
    d.consultas.push({ id: "c1", clienteId: "u1", texto: "Pregunta anterior", respuestaIA: "Respuesta anterior", revisada: true, estado: "RESPONDIDA", fecha });
    d.consultas.push({ id: "c2", clienteId: "u1", texto: "Falló antes", respuestaIA: null, revisada: false, estado: "ERROR", fecha });
  });
  const sistema = crearSistema({ store });
  migrarDatos(store, sistema.repositorios); // Solo fixture temporal: la utilidad histórica sigue disponible.
  const personal = sistema.repositorios.usuarios.buscarPorId("u1");
  assert.ok(personal instanceof PersonalNutriVida && personal instanceof Usuario);
  assert.equal(personal.rol, "ADMINISTRADOR");
  assert.ok(personal.area);
  assert.equal(await personal.autenticar("ClaveAnterior123"), true);
  const anteriores = await sistema.consultas.listarAdministracion(personal.id);
  assert.equal(anteriores.length, 2);
  assert.deepEqual([anteriores[0].id, anteriores[0].fecha, anteriores[0].revisada, anteriores[0].respuestaIA], ["c1", fecha, true, "Respuesta anterior"]);
  assert.equal((await sistema.perfil.obtener("u1")).condicionesMedicas, "Dato anterior");
  const antes = fs.readFileSync(archivo, "utf8");
  migrarDatos(store, crearSistema({ store }).repositorios);
  assert.equal(fs.readFileSync(archivo, "utf8"), antes);
  assert.ok(!antes.includes("Pregunta anterior"));
  assert.ok(!antes.includes("Objetivo anterior"));
});

test("Persistencia: un archivo inválido y una migración fallida nunca se sobrescriben", (t) => {
  const { store, archivo } = almacen(t);
  fs.writeFileSync(archivo, "{invalido");
  assert.throws(() => store.insertar("productos", { nombre: "Prueba" }));
  assert.equal(fs.readFileSync(archivo, "utf8"), "{invalido");
  fs.writeFileSync(archivo, JSON.stringify({ usuarios: [{ id: "u", rol: "CLIENTE", perfilSalud: { condicionesMedicas: "cifrado-corrupto" } }] }));
  const antes = fs.readFileSync(archivo, "utf8");
  assert.throws(() => migrarDatos(store, crearSistema({ store }).repositorios));
  assert.equal(fs.readFileSync(archivo, "utf8"), antes);
});

test("ServicioIA: límites, fallos, JSON inválido, contenido vacío y timeout durante el cuerpo", async () => {
  const casos = [
    [async () => ({ ok: false, status: 429 }), "LIMITE_USO", 429],
    [async () => ({ ok: false, status: 500 }), "ERROR_RESPUESTA_OLLAMA", 503],
    [async () => { throw new Error("detalle privado"); }, "OLLAMA_NO_DISPONIBLE", 503],
    [async () => ({ ok: true, json: async () => { throw new SyntaxError("detalle privado"); } }), "RESPUESTA_INVALIDA", 502],
    [async () => ({ ok: true, json: async () => ({ response: "  " }) }), "RESPUESTA_IA_VACIA", 502],
    [async () => ({ ok: true, json: async () => ({ content: {} }) }), "RESPUESTA_INVALIDA", 502],
    [async () => new Promise(() => {}), "TIMEOUT", 504],
    [async () => ({ ok: true, json: () => new Promise(() => {}) }), "TIMEOUT", 504],
  ];
  for (const [transporte, codigo, status] of casos) {
    const ia = new ServicioIA({ transporte, timeoutMs: 15 });
    await assert.rejects(ia.generarRecomendacion(null, [{ id: 'producto-sintetico', nombre: 'Producto sintético' }], "Hola"), (err) => {
      assert.equal(err.codigo, codigo); assert.equal(err.status, status);
      assert.ok(!err.message.includes("detalle privado")); return true;
    });
  }
});

test("API completa: roles, perfil, consulta/IA/error, aislamiento, catálogo y revisión", async (t) => {
  const { store } = almacen(t);
  let errorServicio = false;
  let llamadasIA = 0;
  const ia = new ServicioIA({ transporte: async () => {
    llamadasIA++;
    return errorServicio ? { ok: false, status: 429 }
      : { ok: true, json: async () => ({ response: JSON.stringify({tipo:"ORIENTACION_GENERAL",productos:[]}) }) };
  } });
  const sistema = crearSistema({ store, ia });
  const personal = new Administrador({ nombre: "Personal", correo: "personal@example.com", passwordHash: await hashPassword("Clave12345"), area: "Nutrición" });
  sistema.repositorios.usuarios.guardar(personal);
  const server = crearApp(sistema).listen(0, "127.0.0.1");
  await new Promise((resolve) => server.once("listening", resolve));
  t.after(() => new Promise((resolve) => server.close(resolve)));
  async function api(method, ruta, body, token) {
    const res = await fetch(`http://127.0.0.1:${server.address().port}/api${ruta}`, {
      method, headers: { "Content-Type": "application/json", ...(token ? { Authorization: `Bearer ${token}` } : {}) },
      ...(body ? { body: JSON.stringify(body) } : {}),
    });
    return { status: res.status, data: res.status === 204 ? null : await res.json() };
  }
  assert.equal((await api("POST", "/auth/register", { nombre: "Cliente", correo: "cliente@example.com", password: "Clave12345", rol: "PERSONAL_NUTRIVIDA" })).status,400);
  const registro = await api("POST", "/auth/register", { nombre: "Cliente", correo: "cliente@example.com", password: "Clave12345" });
  assert.equal(registro.status, 201);
  assert.equal(registro.data.usuario.rol, "CLIENTE");
  const token = registro.data.token;
  const tokenPersonal = generarToken(personal);
  assert.equal((await api("POST", "/auth/login", { correo: "cliente@example.com", password: "Clave12345" })).status, 200);
  assert.equal((await api("POST", "/auth/register", { nombre: "Duplicado", correo: "cliente@example.com", password: "Clave12345" })).status, 409);
  assert.equal((await api("POST", "/consultas", { texto: "Hola" })).status, 401);
  assert.equal((await api("POST", "/consultas", { texto: "" }, token)).status, 400);
  assert.equal((await api("POST", "/consultas", { texto: "x".repeat(501) }, token)).status, 400);
  assert.equal(llamadasIA, 0);
  assert.equal(store.listar("consultas").length, 0);
  const perfil = await api("PUT", "/perfil", { condicionesMedicas: "Dato reservado" }, token);
  assert.equal(perfil.data.perfilSalud.condicionesMedicas, "Dato reservado");
  const sintetico = sistema.repositorios.productos.guardar(new Producto({ nombre: "Producto sintético", categoria: "Prueba" }));
  const respuesta = await api("POST", "/consultas", { texto: "Hola" }, token);
  assert.equal(respuesta.data.consulta.estado, "RESPONDIDA");
  errorServicio = true;
  assert.equal((await api("POST", "/consultas", { texto: "Otro intento" }, token)).status, 429);
  sistema.repositorios.productos.eliminar(sintetico.id);
  const historial = (await api("GET", "/consultas", null, token)).data.consultas;
  assert.equal(historial.length, 2);
  assert.ok(historial.some((c) => c.estado === "ERROR" && c.interaccionId));
  assert.equal(store.listar("interacciones").length, 2);
  const otro = await api("POST", "/auth/register", { nombre: "Otro", correo: "otro@example.com", password: "Clave12345" });
  assert.equal((await api("GET", "/consultas", null, otro.data.token)).data.consultas.length, 0);
  assert.equal((await api("GET", "/perfil", null, otro.data.token)).data.perfilSalud, null);
  assert.equal((await api("GET", "/consultas/admin", null, token)).status, 403);
  assert.equal((await api("POST", "/consultas", { texto: "Hola" }, tokenPersonal)).status, 403);
  assert.equal((await api("PUT", `/consultas/${respuesta.data.consulta.id}/revisar`, {}, tokenPersonal)).data.consulta.revisada, true);
  assert.equal((await api("GET", "/consultas/admin", null, tokenPersonal)).data.consultas.length, 2);
  assert.equal((await api("POST", "/productos", { nombre: "Producto" }, token)).status, 403);
  const producto = (await api("POST", "/productos", { nombre: "Producto" }, tokenPersonal)).data.producto;
  assert.equal((await api("PUT", `/productos/${producto.id}`, { nombre: "Cambio" }, tokenPersonal)).data.producto.nombre, "Cambio");
  assert.equal((await api("DELETE", `/productos/${producto.id}`, null, token)).status, 403);
  assert.equal((await api("DELETE", `/productos/${producto.id}`, null, tokenPersonal)).status, 204);
  assert.equal((await api("GET", "/productos", null, token)).data.productos.length, 0);
  const jwt = require("jsonwebtoken");
  const tokenAnterior = jwt.sign({ sub: personal.id, rol: "ADMINISTRADOR" }, process.env.JWT_SECRET, {expiresIn:"8h"});
  assert.equal((await api("GET", "/consultas/admin", null, tokenAnterior)).status, 200);
  const acciones = store.listar("auditoria").map((e) => e.accion);
  for (const accion of ["consulta_ia", "consulta_ia_error", "revision_consulta", "alta_producto", "edicion_producto", "baja_producto"]) assert.ok(acciones.includes(accion));
});
