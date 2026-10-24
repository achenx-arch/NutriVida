const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { execFileSync } = require("node:child_process");

process.env.OLLAMA_MODEL = "modelo-prueba";
process.env.JWT_SECRET = "secreto-exclusivo-fase1";
process.env.ENCRYPTION_KEY = "cd".repeat(32);
const { crearStore } = require("../src/data/store");
const { crearSistema, ModuloPerfilCliente, ModuloPerfilSalud } = require("../src/services/sistema");
const { crearApp } = require("../src/app");
const { Empleado, Administrador, PersonalNutriVida, PerfilCliente, PerfilSalud } = require("../src/domain/modelos");
const { generarToken, hashPassword } = require("../src/security/auth");
const { crearContextoIA } = require("../src/services/contextoIA");
const { ServicioIA, GENERAL } = require("../src/services/iaService");

function almacen(t) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "nutri-fase1-"));
  t.after(() => {
    assert.equal(path.dirname(path.resolve(dir)), path.resolve(os.tmpdir()));
    assert.ok(path.basename(dir).startsWith("nutri-fase1-"));
    fs.rmSync(dir, { recursive: true, force: true });
  });
  const archivo = path.join(dir, "db.json");
  return { dir, archivo, store: crearStore(archivo) };
}

async function servidor(t, sistema) {
  const server = crearApp(sistema).listen(0, "127.0.0.1");
  await new Promise((resolve) => server.once("listening", resolve));
  t.after(() => new Promise((resolve) => server.close(resolve)));
  return async (method, ruta, datos, token, crudo = false) => {
    const res = await fetch(`http://127.0.0.1:${server.address().port}/api${ruta}`, {
      method, headers: { "Content-Type": "application/json", ...(token ? { Authorization: `Bearer ${token}` } : {}) },
      ...(datos === undefined ? {} : { body: crudo ? datos : JSON.stringify(datos) }),
    });
    return { status: res.status, data: res.status === 204 ? null : await res.json() };
  };
}
const registro = (correo) => ({ nombre: "Cliente prueba", correo, password: "Clave12345" });

test("Registro rechaza tipos incorrectos de correo sin crear cuentas", async (t) => {
  const { store } = almacen(t);
  const api = await servidor(t, crearSistema({ store }));
  for (const correo of [["valido@example.com"], { valor: "valido@example.com" }, 123, true, null]) {
    const res = await api("POST", "/auth/register", registro(correo));
    assert.equal(res.status, 400);
    assert.match(res.data.error, /correo/);
  }
  assert.equal(store.listar("usuarios").length, 0);
  const res = await api("POST", "/auth/register", registro("  VALIDO@example.com  "));
  assert.equal(res.status, 201);
  assert.equal(res.data.usuario.correo, "valido@example.com");
});

test("Arranque real sin proveedor IA: salud, login, perfil y administración disponibles", (t) => {
  const { dir, archivo } = almacen(t);
  const raiz = path.resolve(__dirname, "..");
  // Proceso nuevo sin .env, sin modelo IA y sin acceso a la base del proyecto.
  const script = `
    const assert = require('node:assert/strict');
    const raiz = ${JSON.stringify(raiz)};
    const { crearSistema } = require(raiz + '/src/services/sistema');
    const { crearApp } = require(raiz + '/src/app');
    const { crearStore } = require(raiz + '/src/data/store');
    const { Administrador } = require(raiz + '/src/domain/modelos');
    const { generarToken } = require(raiz + '/src/security/auth');
    const store = crearStore(${JSON.stringify(archivo)});
    global.fetch = async () => { throw new Error('No debe invocarse un proveedor sin modelo'); };
    (async () => {
      const sistema = crearSistema({ store });
      const app = crearApp(sistema);
      const server = app.listen(0, '127.0.0.1');
      await new Promise(r => server.once('listening', r));
      try {
        const http = require('node:http');
        const api = (method, ruta, body, token) => new Promise((resolve, reject) => {
          const req = http.request({ hostname: '127.0.0.1', port: server.address().port, path: '/api' + ruta, method,
            headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: 'Bearer ' + token } : {}) } }, res => {
            let data = ''; res.on('data', c => data += c); res.on('end', () => resolve({ status: res.statusCode, data: JSON.parse(data) }));
          });
          req.on('error', reject); req.end(body ? JSON.stringify(body) : undefined);
        });
        assert.equal((await api('GET', '/salud')).status, 200);
        const datos = { nombre: 'Cliente', correo: 'cliente@example.com', password: 'Clave12345' };
        assert.equal((await api('POST', '/auth/register', datos)).status, 201);
        const login = await api('POST', '/auth/login', {correo:datos.correo,password:datos.password});
        assert.equal(login.status, 200);
        const token = login.data.token;
        assert.equal((await api('PUT', '/perfil', { alergias: 'Declarada' }, token)).status, 200);
        assert.equal((await api('GET', '/perfil', null, token)).data.perfilSalud.alergias, 'Declarada');
        assert.equal((await api('GET', '/productos', null, token)).status, 200);
        const admin = new Administrador({ nombre: 'Administrador', correo: 'admin@example.com' });
        sistema.repositorios.usuarios.guardar(admin);
        const tokenAdmin = generarToken(admin);
        assert.equal((await api('POST', '/productos', { nombre: 'Producto' }, tokenAdmin)).status, 201);
        assert.equal((await api('GET', '/consultas/admin', null, tokenAdmin)).status, 200);
        const consulta = await api('POST', '/consultas', { texto: 'Hola' }, token);
        assert.equal(consulta.status, 503);
        assert.equal(consulta.data.codigo, 'SERVICIO_IA_NO_CONFIGURADO');
        const historial = await api('GET', '/consultas', null, token);
        assert.equal(historial.data.consultas[0].estado, 'ERROR');
        assert.equal(historial.data.consultas[0].respuestaIA, null);
        assert.equal((await api('POST', '/auth/login', {correo:datos.correo,password:datos.password})).status, 200);
        console.log('ARRANQUE_SIN_IA_OK');
      } finally { await new Promise(r => server.close(r)); }
    })().catch(e => { console.error(e); process.exitCode = 1; });
  `;
  const entorno = { ...process.env };
  delete entorno.OLLAMA_MODEL;
  const salida = execFileSync(process.execPath, ["-e", script], { cwd: dir, env: entorno, timeout: 15000, encoding: "utf8", stdio: ["pipe", "pipe", "pipe"] });
  assert.match(salida, /ARRANQUE_SIN_IA_OK/);
});

test("Roles nuevos y legados: permisos se resuelven desde la cuenta, sin ascensos por JWT", async (t) => {
  const { store } = almacen(t);
  const sistema = crearSistema({ store });
  const passwordHash = await hashPassword("Clave12345");
  const cuentas = [new Empleado({ correo: "empleado@example.com", passwordHash }),
    new Administrador({ correo: "admin@example.com", passwordHash }),
    new PersonalNutriVida({ correo: "legado@example.com", passwordHash })];
  cuentas.forEach((u) => sistema.repositorios.usuarios.guardar(u));
  const api = await servidor(t, sistema);
  for (const [i, cuenta] of cuentas.entries()) {
    const login = await api("POST", "/auth/login", { correo: cuenta.correo, password: "Clave12345" });
    assert.equal(login.status, 200);
    assert.equal(login.data.usuario.rol, i === 1 ? "ADMINISTRADOR" : "EMPLEADO");
    assert.deepEqual(login.data.usuario.permisos.slice().sort(), i === 1 ? ["GESTIONAR_CATALOGO", "GESTIONAR_INVENTARIO", "REVISAR_CONSULTAS"] : ["GESTIONAR_INVENTARIO"]);
    // Simular tokens antiguos con un rol de mayor privilegio que el actual.
    const token = generarToken({ ...cuenta, rol: "ADMINISTRADOR" });
    assert.equal((await api("GET", "/productos", undefined, token)).status, 200);
    assert.equal((await api("GET", "/consultas/admin", undefined, token)).status, i === 1 ? 200 : 403);
    assert.equal((await api("POST", "/productos", { nombre: "Producto" }, token)).status, i === 1 ? 201 : 403);
  }
  const legado = cuentas[2];
  await sistema.perfil.actualizar(legado.id, { alergias: "Dato anterior" });
  assert.equal(store.buscarPorId("usuarios", legado.id).rol, "PERSONAL_NUTRIVIDA");
  const token = generarToken(cuentas[1]);
  store.actualizar("usuarios", cuentas[1].id, { rol: "EMPLEADO" });
  assert.equal((await api("GET", "/consultas/admin", undefined, token)).status, 403);
  store.eliminar("usuarios", cuentas[1].id);
  assert.equal((await api("GET", "/productos", undefined, token)).status, 401);
});

test("PerfilCliente conserva alias, datos cifrados y archivo intacto durante el arranque", async (t) => {
  const { store, archivo } = almacen(t);
  const sistema = crearSistema({ store });
  const cliente = await sistema.registrar(registro("perfil@example.com"));
  const perfil = await sistema.perfil.actualizar(cliente.id, {
    condicionesMedicas: "Condición anterior", alergias: "Alergia anterior", objetivoNutricional: "Objetivo anterior",
  });
  assert.equal(PerfilCliente, PerfilSalud);
  assert.equal(ModuloPerfilCliente, ModuloPerfilSalud);
  assert.ok(perfil instanceof PerfilCliente);
  const antes = fs.readFileSync(archivo, "utf8");
  const recargado = crearSistema({ store: crearStore(archivo) });
  const usuario = recargado.repositorios.usuarios.buscarPorId(cliente.id);
  assert.deepEqual(usuario.perfilCliente, perfil);
  assert.equal(usuario.perfilSalud, usuario.perfilCliente);
  assert.equal(fs.readFileSync(archivo, "utf8"), antes);
  assert.doesNotMatch(antes, /Condición anterior|Alergia anterior|Objetivo anterior/);
  assert.equal(Object.hasOwn(usuario.perfilCliente, "autorizaContextoIA"), false);
});

test("Servicios y rutas esperan repositorios asíncronos y mantienen aislamiento del historial", async (t) => {
  const { store } = almacen(t);
  let contexto;
  const sistema = crearSistema({ store, ia: { async generarRecomendacion(dto) { contexto = dto; return "Respuesta"; } } });
  for (const nombre of ["usuarios", "productos", "consultas", "interacciones"]) {
    sistema.repositorios[nombre] = new Proxy(sistema.repositorios[nombre], {
      get(target, key) {
        if (typeof target[key] !== "function") return target[key];
        return (...args) => new Promise((resolve, reject) => setImmediate(() => {
          try { resolve(target[key](...args)); } catch (err) { reject(err); }
        }));
      },
    });
  }
  const auditoria = sistema.repositorios.auditoria;
  const guardar = auditoria.guardar.bind(auditoria);
  auditoria.guardar = (...args) => new Promise((resolve) => setImmediate(() => resolve(guardar(...args))));
  const api = await servidor(t, sistema);
  const cliente = (await api("POST", "/auth/register", registro("async@example.com"))).data;
  assert.equal((await api("POST", "/auth/login", {correo:"async@example.com",password:"Clave12345"})).status, 200);
  assert.ok(store.listar("auditoria").some((e) => e.accion === "LOGIN_EXITOSO"));
  assert.equal((await api("PUT", "/perfil", { alergias: "Declarada" }, cliente.token)).status, 200);
  const admin = new Administrador({ correo: "admin@example.com" });
  await sistema.repositorios.usuarios.guardar(admin);
  const tokenAdmin = generarToken(admin);
  const producto = (await api("POST", "/productos", { nombre: "Inicial" }, tokenAdmin)).data.producto;
  assert.equal((await api("PUT", `/productos/${producto.id}`, { nombre: "Editado" }, tokenAdmin)).data.producto.nombre, "Editado");
  const consulta = (await api("POST", "/consultas", { texto: "Hola" }, cliente.token)).data.consulta;
  assert.equal(consulta.estado, "RESPONDIDA");
  assert.equal(contexto.perfil, null);
  assert.equal(contexto.productos[0].nombre, "Editado");
  assert.equal((await api("GET", "/consultas", undefined, cliente.token)).data.consultas.length, 1);
  const otro = (await api("POST", "/auth/register", registro("otro@example.com"))).data;
  assert.deepEqual((await api("GET", "/consultas", undefined, otro.token)).data.consultas, []);
  assert.equal((await api("GET", "/consultas/admin", undefined, tokenAdmin)).data.consultas.length, 1);
  assert.equal((await api("PUT", `/consultas/${consulta.id}/revisar`, {}, tokenAdmin)).data.consulta.revisada, true);
  assert.equal((await api("DELETE", `/productos/${producto.id}`, undefined, tokenAdmin)).status, 204);
});

test("Contexto IA explícito excluye identidades y campos ajenos; firma antigua sigue disponible", async () => {
  const dto = crearContextoIA({ consulta: "Hola", correo: "privado@example.com", passwordHash: "privado",
    perfil: { id: "privado", alergias: "Declarada", historiaPrivada: "secreto" },
    productos: [{ id: "producto-publico", nombre: "Producto", costoInterno: "secreto" }] });
  assert.doesNotMatch(JSON.stringify(dto), /privado|secreto/);
  const cuerpos = [];
  const ia = new ServicioIA({ transporte: async (url, options) => {
    cuerpos.push(options.body);
    return { ok: true, json: async () => ({ response: JSON.stringify({tipo:"ORIENTACION_GENERAL",productos:[]}) }) };
  } });
  assert.equal(await ia.generarRecomendacion(dto), GENERAL);
  assert.equal(await ia.generarRecomendacion(dto.perfil, dto.productos, dto.consulta), GENERAL);
  assert.equal(cuerpos[0], cuerpos[1]);
});

test("Errores de dependencias y JSON malformado no exponen detalles internos", async (t) => {
  const { store } = almacen(t);
  const sistema = crearSistema({ store });
  const cliente = await sistema.registrar(registro("errores@example.com"));
  sistema.repositorios.productos.listar = async () => { throw Object.assign(new Error("ruta/privada clave-secreta"), { status: 400 }); };
  const api = await servidor(t, sistema);
  const res = await api("GET", "/productos", undefined, generarToken(cliente));
  assert.equal(res.status, 500);
  assert.doesNotMatch(JSON.stringify(res.data), /privada|secreta|stack/);
  const invalido = await api("POST", "/auth/login", '{"secreto":"privado",', undefined, true);
  assert.equal(invalido.status, 400);
  assert.doesNotMatch(JSON.stringify(invalido.data), /secreto|privado/);
  const grande = await api("POST", "/auth/login", { texto: "x".repeat(52000) });
  assert.equal(grande.status, 413);
});

test("Contexto IA malformado se rechaza antes de llamar al proveedor", async () => {
  let llamadas = 0;
  const ia = new ServicioIA({ transporte: async () => { llamadas++; } });
  for (const contexto of [null, [], "privado", { consulta: "Hola", perfil: [] },
    { consulta: "Hola", perfil: "privado" }, { consulta: "Hola", productos: {} },
    { consulta: "Hola", productos: [null] }, { consulta: "Hola", productos: ["privado"] }]) {
    await assert.rejects(ia.generarRecomendacion(contexto), (err) => {
      assert.equal(err.status, 400);
      assert.doesNotMatch(err.message, /privado|TypeError|Cannot/);
      return true;
    });
  }
  assert.equal(llamadas, 0);
});

test("Rechazos no convencionales del transporte IA conservan el error controlado", async () => {
  for (const motivo of [undefined, null, false, 0, "clave-privada", { detalle: "clave-privada" }]) {
    const ia = new ServicioIA({ transporte: async () => { throw motivo; } });
    await assert.rejects(ia.generarRecomendacion({ consulta: "Hola", productos: [{ id: 'producto-sintetico', nombre: 'Producto sintético' }] }), (err) => {
      assert.equal(err.status, 503);
      assert.equal(err.codigo, "OLLAMA_NO_DISPONIBLE");
      assert.doesNotMatch(err.message, /clave-privada|TypeError|Cannot/);
      return true;
    });
  }
});

test("Un rechazo vacío del adaptador IA devuelve error y conserva historial y auditoría", async (t) => {
  const { store } = almacen(t);
  let motivo;
  const sistema = crearSistema({ store, ia: { async generarRecomendacion() { throw motivo; } } });
  const cliente = await sistema.registrar(registro("rechazos@example.com"));
  const api = await servidor(t, sistema);
  const token = generarToken(cliente);
  const motivos = [undefined, null, false, 0, "clave-privada", { detalle: "clave-privada" }];
  for (motivo of motivos) {
    const res = await api("POST", "/consultas", { texto: "Hola" }, token);
    assert.equal(res.status, 503);
    assert.equal(res.data.codigo, "FALLA_SERVICIO");
    assert.doesNotMatch(JSON.stringify(res.data), /clave-privada/);
  }
  const historial = (await api("GET", "/consultas", undefined, token)).data.consultas;
  assert.equal(historial.length, motivos.length);
  assert.ok(historial.every((c) => c.estado === "ERROR" && c.respuestaIA === null && c.interaccionId));
  const acciones = store.listar("auditoria");
  assert.equal(acciones.filter((e) => e.accion === "consulta_ia_error").length, motivos.length);
  assert.equal(acciones.filter((e) => e.accion === "consulta_ia").length, 0);
});
