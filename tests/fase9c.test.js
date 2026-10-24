// FASE 9C — Personalización con un resumen LIMITADO del historial de compras ENTREGADAS, solo con autoriza_historial_ia.
// PostgreSQL: esquema temporal nv_test_* en DB_TEST_NAME; pedidos SINTÉTICOS insertados en ese esquema temporal.
// Ollama simulado que captura cada prompt y JSON Schema. Nunca escribe en nutrivida_db.
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { randomUUID, createHash } = require('node:crypto');
const fs = require('node:fs'), path = require('node:path');
process.env.JWT_SECRET = 'fase9c'; process.env.ENCRYPTION_KEY = 'ab'.repeat(32);
const H = require('../src/services/historialIA');
const R = require('../src/services/relevanciaIA');
const C = require('../src/services/catalogoAlimentacion');
const IA = require('../src/services/iaService');

const BARRAS = 'Barras Energéticas Naturales', BEBF = 'Bebidas Funcionales (Energéticas Naturales)', BEBS = 'Bebidas Saludables (Jugos Naturales y Smoothies)',
  CEREALES = 'Cereales Integrales para Desayuno', CHIPS = 'Chips Saludables (Plátano, Yuca o Vegetales)', PAN = 'Pan Integral Saludable';
const DATOS = [
  [BARRAS, 'Barras y Snacks', 'Productos nutritivos diseñados para aportar energía de forma rápida y saludable, ideales para estudiantes, deportistas y personas activas.',
    'Avena integral, Frutas deshidratadas (pasas, arándanos), Frutos secos (almendras, maní, nueces), Miel natural, Semillas (chía, linaza)'],
  [BEBF, 'Bebidas', 'Bebidas naturales elaboradas con té verde, jengibre, limón y miel.', 'Jengibre, Limón, Miel, Té verde'],
  [BEBS, 'Bebidas', 'Bebidas naturales ricas en vitaminas, diseñadas para hidratar y nutrir el cuerpo.',
    'Agua purificada o leche vegetal, Endulzantes naturales (miel o Stevia), Frutas frescas (naranja, piña, mango, fresa)'],
  [CEREALES, 'Panadería y Cereales', 'Granos integrales para mañanas nutritivas.', 'Avena, Chía, Frutas, Miel, Quinoa'],
  [CHIPS, 'Barras y Snacks', 'Snacks crujientes horneados, sin grasas saturadas.', 'Aceite vegetal mínimo, Plátano, yuca o vegetales, Sal natural'],
  [PAN, 'Panadería y Cereales', 'Pan elaborado con harinas integrales, alto en fibra y bajo en azúcares refinados.', 'Agua, Harina integral, Levadura, Semillas'],
];
const separar = s => s.split(/, (?![^(]*\))/);
const REALES = DATOS.map(([nombre, categoria, descripcion, ingredientes]) => ({ id: randomUUID(), nombre, categoria, descripcion, ingredientes,
  ingredientesLista: separar(ingredientes), valoresNutricionales: '' }));
const P = n => REALES.find(p => p.nombre === n);

test('Bono de historial: determinista, acotado (máx. +0,5) y solo con datos del resumen', () => {
  assert.deepEqual(H.LIMITES_HISTORIAL, { dias: 90, pedidos: 20, productos: 5, categorias: 5 });
  const r = H.normalizarResumen({ pedidosConsiderados: 4, productos: [{ productoId: P(BEBS).id, pedidos: 3 }, { productoId: P(BARRAS).id, pedidos: 1 }],
    categorias: [{ categoria: 'Bebidas', pedidos: 3 }, { categoria: 'Barras y Snacks', pedidos: 1 }] });
  assert.deepEqual(H.bonoHistorial(P(BEBS), r), { bono: 0.5, motivos: ['PRODUCTO_RECURRENTE', 'CATEGORIA_FRECUENTE'] }, 'tope +0,5');
  assert.deepEqual(H.bonoHistorial(P(BEBF), r), { bono: 0.25, motivos: ['CATEGORIA_FRECUENTE'] });
  assert.deepEqual(H.bonoHistorial(P(BARRAS), r), { bono: 0.25, motivos: ['PRODUCTO_COMPRADO'] });
  assert.deepEqual(H.bonoHistorial(P(PAN), r), { bono: 0, motivos: [] });
  assert.deepEqual(H.bonoHistorial(P(PAN), null), { bono: 0, motivos: [] });
  // Normalización defensiva: sin campos extra, sin valores no válidos, con límites.
  const n = H.normalizarResumen({ pedidosConsiderados: 2, idPedidos: [1, 2], correo: 'x@y.z', productos: Array.from({ length: 9 }, (_, i) => ({ productoId: 'p' + i, pedidos: 1, precio: 9 })),
    categorias: [{ categoria: 'X', pedidos: 0 }, { categoria: 'Y', pedidos: 2, total: 99 }] });
  assert.deepEqual(Object.keys(n), ['pedidosConsiderados', 'productos', 'categorias']);
  assert.equal(n.productos.length, 5); assert.deepEqual(Object.keys(n.productos[0]), ['productoId', 'pedidos']);
  assert.deepEqual(n.categorias, [{ categoria: 'Y', pedidos: 2 }]);
  assert.deepEqual(H.normalizarResumen(null), H.vacio());
});

test('Relevancia con historial: señal secundaria, nunca agrega ni rescata productos', () => {
  const resumen = H.normalizarResumen({ pedidosConsiderados: 3, productos: [{ productoId: P(BEBS).id, pedidos: 2 }, { productoId: P(BARRAS).id, pedidos: 3 }],
    categorias: [{ categoria: 'Bebidas', pedidos: 2 }, { categoria: 'Barras y Snacks', pedidos: 3 }] });
  const sel = (q, o = {}) => R.seleccionarCandidatos(REALES, q, undefined, o);
  // Empate exacto (6 = 6): el historial lo decide; sin historial, orden por nombre (idéntico a FASE 9B-2).
  assert.deepEqual(sel('¿Qué bebidas tienen?').candidatos.map(p => p.nombre), [BEBF, BEBS]);
  let s = sel('¿Qué bebidas tienen?', { historial: resumen });
  assert.deepEqual(s.candidatos.map(p => p.nombre), [BEBS, BEBF]);
  const bs = s.puntuaciones.find(x => x.producto.nombre === BEBS);
  assert.equal(bs.puntos, 6, 'la puntuación base no cambia'); assert.equal(bs.bonoHistorial, 0.5);
  assert.deepEqual(R.PESOS, { nombre: 3, categoria: 2, ingredientes: 2, descripcion: 1, valoresNutricionales: 1 });
  // No supera una coincidencia más fuerte: Chips (3) sigue antes que Barras (2 + 0,5).
  assert.deepEqual(sel('Busco un snack', { historial: resumen }).candidatos.map(p => p.nombre), [CHIPS, BARRAS]);
  // Nunca agrega productos sin relación con la consulta (Barras comprada 3 veces no aparece al buscar bebidas).
  assert.ok(!s.candidatos.some(p => p.nombre === BARRAS));
  assert.ok(s.puntuaciones.filter(x => x.puntos === 0).every(x => x.bonoHistorial === undefined));
  // Sin coincidencias: sigue sin coincidencias.
  assert.equal(sel('pizza de pepperoni', { historial: resumen }).tipo, 'SIN_COINCIDENCIAS');
  // Restricciones prioritarias: un producto excluido nunca vuelve por historial.
  s = sel('Busco un snack', { historial: resumen, restricciones: C.restriccionesDePerfil({ alergenos: ['MANI'] }) });
  assert.ok(!s.candidatos.some(p => p.nombre === BARRAS));
  // General: mismo número y misma rotación por categorías.
  const a = sel('¿Qué productos tienen?'), g = sel('¿Qué productos tienen?', { historial: resumen });
  assert.equal(g.candidatos.length, a.candidatos.length); assert.deepEqual(g.candidatos.map(p => p.categoria), a.candidatos.map(p => p.categoria));
  // Compatible con el bono de preferencias (se suman, cada uno acotado).
  s = sel('Busco un snack', { historial: resumen, preferencias: ['FRUTAS', 'INTEGRALES'] });
  const barras = s.puntuaciones.find(x => x.producto.nombre === BARRAS);
  assert.equal(barras.bonoPreferencias, 1); assert.equal(barras.bonoHistorial, 0.5); assert.deepEqual(s.candidatos.map(p => p.nombre), [BARRAS, CHIPS]);
});

test('API + PostgreSQL: consentimiento de historial, pedidos ENTREGADO, aislamiento, privacidad y regresiones', async t => {
  const { crearPool } = require('../src/database/pool'), { migrar } = require('../src/database/migraciones');
  const { crearSistema } = require('../src/services/sistema'), { crearApp } = require('../src/app');
  const { Administrador } = require('../src/domain/modelos'), { generarToken } = require('../src/security/auth');
  const { OllamaProvider } = require('../src/services/ollamaProvider');
  const dbJson = path.join(__dirname, '..', 'data', 'db.json');
  const huella = () => fs.existsSync(dbJson) ? createHash('sha256').update(fs.readFileSync(dbJson)).digest('hex') : 'ausente';
  const huellaInicial = huella();
  const id = randomUUID().replaceAll('-', ''), schema = 'nv_test_' + id, control = 'nv_test_control_' + id;
  const gestor = crearPool({ pruebas: true }); await gestor.query(`CREATE SCHEMA ${schema}`);
  const pool = crearPool({ pruebas: true, schema }); let server;
  t.after(async () => { if (server) await new Promise(r => server.close(r)); await pool.end();
    try { await gestor.query(`DROP SCHEMA ${schema} CASCADE`); await gestor.query(`DROP SCHEMA IF EXISTS ${control} CASCADE`); } finally { await gestor.end(); } });
  await migrar(pool, { esquemaControl: control });
  let modo = 'todos'; const llamadas = []; const ids = {};
  const transporte = async (url, opts) => {
    const req = JSON.parse(opts.body); llamadas.push(req);
    const enumIds = req.format.properties.productos.items?.properties?.id?.enum || [];
    const r = modo === 'vacio' ? { tipo: 'ORIENTACION_GENERAL', productos: [] } : { tipo: enumIds.length ? 'RECOMENDACION' : 'ORIENTACION_GENERAL', productos: enumIds.map(id => ({ id })) };
    return { ok: true, json: async () => ({ response: JSON.stringify(r) }) };
  };
  const sistema = crearSistema({ pool, ia: new IA.ServicioIA({ ollamaProvider: new OllamaProvider({ model: 'modelo-prueba', transporte }) }) });
  // Espía SIN cambiar el comportamiento: cuenta lecturas del historial y con qué cliente.
  const lecturas = []; const original = sistema.repositorios.historialConsumo.resumenIA.bind(sistema.repositorios.historialConsumo);
  let fallarHistorial = false;
  sistema.repositorios.historialConsumo.resumenIA = async (uid, ...a) => { lecturas.push(uid); if (fallarHistorial) throw new Error('fallo simulado de lectura'); return original(uid, ...a); };
  const admin = new Administrador({ nombre: 'Admin 9C', correo: 'admin-9c@example.test', passwordHash: 'h' });
  await sistema.repositorios.usuarios.guardar(admin);
  const guardar = (tipo, datos) => sistema.catalogoComercial.guardar(admin.id, tipo, null, datos);
  const categorias = {}, ingredientes = {};
  for (const n of ['Barras y Snacks', 'Bebidas', 'Panadería y Cereales']) categorias[n] = (await guardar('categorias', { nombre: n })).id;
  const ing = async n => ingredientes[n] ??= (await guardar('ingredientes', { nombre: n })).id;
  for (const p of REALES) {
    const lista = []; for (const n of p.ingredientesLista) lista.push({ id: await ing(n) });
    const g = await guardar('productos', { nombre: p.nombre, categoriaId: categorias[p.categoria], descripcion: p.descripcion, precio: '12.50', estado: true, stockMinimo: 3, ingredientes: lista });
    await sistema.inventario.registrar(admin.id, { productoId: g.id, tipo: 'AJUSTE', cantidad: 50, motivo: 'Fase 9C' }); ids[p.nombre] = g.id;
  }
  const registrar = n => sistema.registrar({ nombre: 'Cliente ' + n, correo: `cliente-${n}@example.test`, password: 'Clave12345' });
  const A = await registrar('a'), B = await registrar('b'), Csin = await registrar('sin'), D = await registrar('noentregado'), E = await registrar('muchos');
  // Pedidos SINTÉTICOS en el esquema temporal (fixture): estado y fecha controlados.
  // La base exige que todo pedido tenga detalles al confirmar (disparador diferido "Pedido sin detalles"): misma transacción.
  const pedido = async (cliente, estado, productos, dias = 5) => {
    const db = await pool.connect();
    try {
      await db.query('BEGIN');
      const r = await db.query(`INSERT INTO pedidos(id_cliente,estado,subtotal,total,fecha_pedido,fecha_actualizacion) VALUES($1,$2,10,10,${dias === null ? 'NULL' : `CURRENT_TIMESTAMP - make_interval(days=>${Number(dias)})`},CURRENT_TIMESTAMP) RETURNING id_pedido`, [cliente.id, estado]);
      for (const n of productos) await db.query('INSERT INTO detalle_pedido(id_pedido,id_producto,cantidad,precio_unitario,subtotal) VALUES($1,$2,1,12.50,12.50)', [r.rows[0].id_pedido, ids[n]]);
      await db.query('COMMIT'); return r.rows[0].id_pedido;
    } catch (e) { await db.query('ROLLBACK'); throw e; } finally { db.release(); }
  };
  await pedido(A, 'ENTREGADO', [BEBS], 2); await pedido(A, 'ENTREGADO', [BEBS, BARRAS], 10); await pedido(A, 'ENTREGADO', [CHIPS], 30);
  for (const est of ['PENDIENTE', 'CONFIRMADO', 'EN_PREPARACION', 'LISTO', 'CANCELADO']) await pedido(A, est, [BEBF, CEREALES, PAN]);
  await pedido(A, 'ENTREGADO', [BEBF, BEBF], 120); await pedido(A, 'ENTREGADO', [BEBF], null);       // fuera de ventana / sin fecha verificable
  // Un pedido ENTREGADO sin productos no puede existir: la base lo rechaza (disparador "Pedido sin detalles").
  await assert.rejects(pedido(A, 'ENTREGADO', []), /Pedido sin detalles/);
  for (let i = 0; i < 4; i++) await pedido(B, 'ENTREGADO', [BEBF]);
  for (const est of ['PENDIENTE', 'LISTO', 'CANCELADO']) await pedido(D, est, [BEBS]);
  for (let i = 0; i < 25; i++) await pedido(E, 'ENTREGADO', [BEBF], i < 3 ? 1 : 3);      // los 3 más recientes: BEBF
  for (let i = 0; i < 3; i++) await pedido(E, 'ENTREGADO', [BEBS], 60);                  // fuera de los 20 más recientes
  server = crearApp(sistema, { limites: { ia: 1000 } }).listen(0, '127.0.0.1'); await new Promise(r => server.once('listening', r));
  const api = async (method, ruta, body, usuario) => { const r = await fetch(`http://127.0.0.1:${server.address().port}/api${ruta}`, { method,
    headers: { 'Content-Type': 'application/json', ...(usuario ? { Authorization: 'Bearer ' + generarToken(usuario) } : {}) }, ...(body !== undefined ? { body: JSON.stringify(body) } : {}) });
    return { status: r.status, data: await r.json() }; };
  const q = (texto, u = A) => api('POST', '/consultas', { texto }, u);
  const consentir = (u, c) => api('PUT', '/perfil/consentimiento', c, u);
  const enviados = () => JSON.parse(llamadas.at(-1).prompt).productos.map(p => p.nombre);
  const tarjetas = r => (r.data.consulta?.productosRecomendados || []).map(p => p.nombre);
  const fotoPedidos = async () => createHash('sha256').update(JSON.stringify((await pool.query(`SELECT p.id_pedido,p.id_cliente,p.estado,p.subtotal,p.total,p.fecha_pedido,p.fecha_actualizacion,
    COALESCE(json_agg(d ORDER BY d.id_detalle) FILTER (WHERE d.id_detalle IS NOT NULL),'[]') det FROM pedidos p LEFT JOIN detalle_pedido d USING(id_pedido) GROUP BY p.id_pedido ORDER BY p.id_pedido`)).rows)).digest('hex');
  const fotoInventario = async () => JSON.stringify((await pool.query('SELECT id_producto,cantidad FROM inventario ORDER BY id_producto')).rows);
  const pedidosAntes = await fotoPedidos(), inventarioAntes = await fotoInventario();

  await t.test('Resumen: solo ENTREGADO con productos, ventana de 90 días, 20 pedidos, cliente propio y sin identificadores', async () => {
    const r = await original(A.id);
    assert.equal(r.pedidosConsiderados, 3, 'excluye no entregados, fuera de ventana y sin fecha verificable');
    assert.deepEqual(r.productos, [{ productoId: ids[BEBS], pedidos: 2 }, ...[{ productoId: ids[BARRAS], pedidos: 1 }, { productoId: ids[CHIPS], pedidos: 1 }].sort((x, y) => x.productoId.localeCompare(y.productoId))]);
    assert.deepEqual(r.categorias, [{ categoria: 'Barras y Snacks', pedidos: 2 }, { categoria: 'Bebidas', pedidos: 2 }]);
    assert.ok(!r.productos.some(p => p.productoId === ids[BEBF]), 'BEBF solo en no entregados / fuera de ventana / de otro cliente');
    assert.doesNotMatch(JSON.stringify(r), /id_pedido|correo|cliente|precio|total|@/i);
    assert.deepEqual(await original(Csin.id), H.vacio(), 'sin pedidos');
    assert.deepEqual(await original(D.id), H.vacio(), 'pedidos sin ningún ENTREGADO');
    const e = await original(E.id);
    assert.equal(e.pedidosConsiderados, 20, 'tope de 20 pedidos'); assert.deepEqual(e.productos, [{ productoId: ids[BEBF], pedidos: 20 }], 'los 3 BEBS quedan fuera de los 20 más recientes');
    assert.deepEqual((await original(B.id)).productos, [{ productoId: ids[BEBF], pedidos: 4 }], 'cada cliente solo ve lo suyo');
  });

  await t.test('Consentimiento: NULL, FALSE, TRUE e independencia de los dos consentimientos', async () => {
    modo = 'todos'; let n = lecturas.length;
    let r = await q('¿Qué bebidas tienen?'); assert.deepEqual(enviados(), [BEBF, BEBS], 'NULL: sin historial'); assert.equal(lecturas.length, n, 'NULL: no se lee el historial');
    await consentir(A, { autorizaContextoIA: true });                         // perfil sí, historial no
    r = await q('¿Qué bebidas tienen?'); assert.deepEqual(enviados(), [BEBF, BEBS]); assert.equal(lecturas.length, n, 'el consentimiento de perfil no sustituye al de historial');
    await consentir(A, { autorizaContextoIA: false, autorizaHistorialIA: true }); // historial sí, perfil no
    r = await q('¿Qué bebidas tienen?'); assert.deepEqual(enviados(), [BEBS, BEBF], 'historial autorizado: BEBS (2 pedidos) primero');
    assert.deepEqual(lecturas.slice(n), [A.id], 'se lee una vez y solo del cliente del JWT');
    assert.deepEqual(tarjetas(r), [BEBS, BEBF], 'tarjetas = candidatos válidos, en el orden del modelo');
    await consentir(A, { autorizaContextoIA: true });                         // ambos
    r = await q('¿Qué bebidas tienen?'); assert.deepEqual(enviados(), [BEBS, BEBF]);
    await consentir(A, { autorizaHistorialIA: false });                       // retiro: efecto inmediato
    n = lecturas.length; r = await q('¿Qué bebidas tienen?'); assert.deepEqual(enviados(), [BEBF, BEBS]); assert.equal(lecturas.length, n);
    await consentir(A, { autorizaContextoIA: false });                        // ambos desactivados
    r = await q('¿Qué bebidas tienen?'); assert.deepEqual(enviados(), [BEBF, BEBS]); assert.equal(lecturas.length, n);
    // Nunca se activa automáticamente.
    const pc = (await pool.query('SELECT autoriza_contexto_ia, autoriza_historial_ia FROM perfil_cliente WHERE id_usuario=$1', [A.id])).rows[0];
    assert.deepEqual(pc, { autoriza_contexto_ia: false, autoriza_historial_ia: false });
  });

  await t.test('Privacidad: el historial nunca llega a Ollama, a la respuesta, a la auditoría ni se persiste', async () => {
    await consentir(A, { autorizaHistorialIA: true }); modo = 'todos';
    const r = await q('¿Qué bebidas tienen?');
    const cuerpo = llamadas.at(-1), prompt = JSON.parse(cuerpo.prompt);
    assert.deepEqual(Object.keys(prompt).sort(), ['consulta', 'perfil', 'productos']); assert.equal(prompt.perfil, null);
    assert.ok(prompt.productos.every(p => Object.keys(p).sort().join() === 'categoria,descripcion,id,ingredientes,nombre,precio,valoresNutricionales'));
    assert.doesNotMatch(JSON.stringify(cuerpo), /pedido|historial|compra|recurrente|frecuente|cliente-a|@example/i);
    assert.doesNotMatch(JSON.stringify(r.data), /pedidosConsiderados|bonoHistorial|historial de compras|recurrente/i);
    const aud = (await pool.query("SELECT accion, datos_anteriores, datos_nuevos FROM auditoria WHERE id_usuario=$1 AND accion LIKE 'consulta_ia%'", [A.id])).rows;
    assert.ok(aud.length > 0 && aud.every(a => a.datos_anteriores == null && a.datos_nuevos == null), 'auditoría sin contenido de compras');
    const tablas = (await pool.query("SELECT table_name FROM information_schema.tables WHERE table_schema=$1", [schema])).rows.map(x => x.table_name).sort();
    assert.ok(!tablas.some(t => /resumen|historial_ia/.test(t)), 'ninguna tabla nueva de resúmenes');
    const prefs = (await pool.query("SELECT DISTINCT tipo FROM preferencias_cliente WHERE id_usuario=$1", [A.id])).rows.map(x => x.tipo);
    assert.ok(!prefs.some(t => /HISTORIAL|COMPRA/.test(t)), 'no se guarda el resumen en el perfil');
  });

  await t.test('Seguridad alimentaria: restricciones (consulta y perfil) prevalecen sobre el historial', async () => {
    await consentir(A, { autorizaHistorialIA: true, autorizaContextoIA: false }); modo = 'todos';
    // Barras comprada antes, pero la consulta declara alergia al maní.
    let n = llamadas.length, r = await q('Soy alérgico al maní, ¿qué barras tienen?');
    assert.equal(r.data.consulta.respuestaIA, IA.RESTRICCION.PRODUCTO_INCOMPATIBLE); assert.equal(llamadas.length, n); assert.deepEqual(tarjetas(r), []);
    r = await q('Soy alérgico al maní, busco un snack');
    assert.ok(!(llamadas.length > n && enviados().includes(BARRAS))); assert.ok(!tarjetas(r).includes(BARRAS));
    // Restricción guardada (contexto autorizado) + historial: Barras nunca vuelve.
    await api('PUT', '/perfil/alimentacion', { alergenos: ['MANI'] }, A); await consentir(A, { autorizaContextoIA: true });
    r = await q('¿Qué productos tienen?'); assert.ok(!enviados().includes(BARRAS) && !tarjetas(r).includes(BARRAS));
    assert.ok(r.data.consulta.respuestaIA.endsWith(IA.AVISO_RESTRICCION.ALERGIA), 'aviso prudente: el historial no garantiza nada');
    await api('PUT', '/perfil/alimentacion', { alergenos: [] }, A); await consentir(A, { autorizaContextoIA: false });
    // Consulta médica: prioridad absoluta, sin leer historial ni llamar al modelo.
    n = lecturas.length; const m = llamadas.length; r = await q('¿Qué medicamento debo tomar?');
    assert.equal(r.data.consulta.respuestaIA, IA.MEDICA); assert.equal(lecturas.length, n); assert.equal(llamadas.length, m);
  });

  await t.test('Productos inactivos o sin existencias del historial no se recomiendan', async () => {
    modo = 'todos';
    await pool.query('UPDATE productos SET estado=FALSE WHERE id_producto=$1', [ids[BEBS]]); // fixture sintético
    let r = await q('¿Qué bebidas tienen?'); assert.deepEqual(enviados(), [BEBF]); assert.deepEqual(tarjetas(r), [BEBF]);
    await pool.query('UPDATE productos SET estado=TRUE WHERE id_producto=$1', [ids[BEBS]]);
    const inv = (await pool.query('SELECT cantidad FROM inventario WHERE id_producto=$1', [ids[BEBS]])).rows[0].cantidad;
    await pool.query('UPDATE inventario SET cantidad=0 WHERE id_producto=$1', [ids[BEBS]]);
    r = await q('¿Qué bebidas tienen?'); assert.deepEqual(enviados(), [BEBF]);
    await pool.query('UPDATE inventario SET cantidad=$2 WHERE id_producto=$1', [ids[BEBS], inv]);
  });

  await t.test('Sin historial, sin ENTREGADO, aislamiento y error temporal: recomendaciones sin personalización', async () => {
    modo = 'todos';
    for (const u of [Csin, D]) {
      await consentir(u, { autorizaHistorialIA: true });
      const r = await q('¿Qué bebidas tienen?', u); assert.equal(r.status, 200); assert.deepEqual(enviados(), [BEBF, BEBS]);
    }
    // B compró BEBF 4 veces: su historial no afecta a A ni al revés.
    await consentir(B, { autorizaHistorialIA: true });
    let r = await q('¿Qué bebidas tienen?', B); assert.deepEqual(enviados(), [BEBF, BEBS]);
    r = await q('¿Qué bebidas tienen?', A); assert.deepEqual(enviados(), [BEBS, BEBF]);
    // Error temporal al leer el historial: continúa sin personalización, sin exponer el error.
    fallarHistorial = true;
    try { r = await q('¿Qué bebidas tienen?', A); } finally { fallarHistorial = false; }
    assert.equal(r.status, 200); assert.deepEqual(enviados(), [BEBF, BEBS]); assert.doesNotMatch(JSON.stringify(r.data), /fallo simulado|historial/i);
    // Modelo sin elegir productos: el respaldo y los mensajes de FASE 9B se conservan.
    modo = 'vacio'; r = await q('¿Qué bebidas tienen disponibles?', A); modo = 'todos';
    assert.deepEqual(tarjetas(r).sort(), [BEBF, BEBS].sort());
    r = await q('Quiero pizza de pepperoni', A); assert.ok(r.data.consulta.respuestaIA.startsWith(IA.SIN_COINCIDENCIAS_BASE));
  });

  await t.test('Integridad: pedidos, detalles e inventario intactos; sin rutas nuevas; data/db.json sin cambios', async () => {
    assert.equal(await fotoPedidos(), pedidosAntes, 'recomendar no modifica pedidos ni su estado');
    assert.equal(await fotoInventario(), inventarioAntes, 'recomendar no modifica inventario');
    for (const ruta of ['/historial-ia', '/consultas/historial-compras', '/perfil/historial']) assert.notEqual((await api('GET', ruta, undefined, A)).status, 200, ruta);
    assert.equal(huella(), huellaInicial);
  });
});
