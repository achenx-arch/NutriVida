// FASE 9B-2 — Datos alimentarios estructurados del CLIENTE (preferencias, restricciones dietéticas y alérgenos) en
// preferencias_cliente (sin migración), con uso en recomendaciones SOLO si autoriza_contexto_ia === true (opción A).
// PostgreSQL: esquema temporal nv_test_* en DB_TEST_NAME. Ollama simulado que captura cada prompt y JSON Schema.
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { randomUUID, createHash } = require('node:crypto');
const fs = require('node:fs'), path = require('node:path');
process.env.JWT_SECRET = 'fase9b2'; process.env.ENCRYPTION_KEY = 'ef'.repeat(32);
const C = require('../src/services/catalogoAlimentacion');
const E = require('../src/services/evaluadorAlimentario');
const R = require('../src/services/relevanciaIA');
const IA = require('../src/services/iaService');
const { RESTRICCIONES: DICCIONARIO } = require('../src/services/catalogoRestricciones');

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
const PROHIBIDAS = /100\s*%\s*segur|libre de al[eé]rgenos|apto para cel[ií]ac|garantizado sin trazas/i;

test('Catálogo: solo se habilitan códigos con evaluación conservadora respaldada por el diccionario de FASE 9B-1', () => {
  assert.deepEqual(C.codigosHabilitados('alergenos'), ['MANI', 'FRUTOS_SECOS', 'GLUTEN', 'LACTEOS', 'SOYA', 'SESAMO']);
  assert.deepEqual(C.codigosHabilitados('restricciones'), ['VEGETARIANO', 'VEGANO', 'SIN_LACTEOS', 'SIN_LACTOSA', 'SIN_GLUTEN', 'SIN_AZUCAR_ANADIDO']);
  assert.deepEqual(C.codigosHabilitados('preferencias'), ['INTEGRALES', 'FRUTAS', 'BEBIDAS_NATURALES', 'SNACKS_SALUDABLES']);
  // Condición 5: pescado, mariscos y huevo sin ingredientes genéricos en el diccionario → deshabilitados.
  for (const c of ['HUEVO', 'PESCADO', 'MARISCOS']) { assert.equal(DICCIONARIO[c].genericos.length, 0, c); assert.equal(C.habilitado('alergenos', c), false, c); }
  assert.equal(C.habilitado('restricciones', 'SIN_AZUCAR'), false, 'sin azúcar total excluido');
  for (const c of [...C.codigosHabilitados('alergenos'), ...C.codigosHabilitados('restricciones')]) assert.ok(DICCIONARIO[c].genericos.length > 0, `${c} con genéricos`);
  // Un ingrediente GENÉRICO o ambiguo vuelve el producto NO_VERIFICABLE (nunca "seguro por ausencia de coincidencias").
  const genericos = { MANI: 'Aceite vegetal', FRUTOS_SECOS: 'Semillas', GLUTEN: 'Harina', LACTEOS: 'Crema', SOYA: 'Lecitina', SESAMO: 'Semillas',
    VEGETARIANO: 'Caldo', VEGANO: 'Manteca', SIN_LACTEOS: 'Crema', SIN_LACTOSA: 'Queso', SIN_GLUTEN: 'Avena', SIN_AZUCAR_ANADIDO: 'Endulzantes' };
  for (const [codigo, ingrediente] of Object.entries(genericos)) {
    const r = C.restriccionesDePerfil({ alergenos: [codigo], restricciones: [codigo] });
    const ev = E.evaluarProducto({ nombre: 'Producto X', descripcion: '', ingredientesLista: ['Agua', ingrediente] }, r);
    assert.equal(ev.estado, 'NO_VERIFICABLE', `${codigo} + ${ingrediente}`);
  }
  // Severidades y códigos deshabilitados ignorados (no se inventa compatibilidad).
  assert.deepEqual(C.restriccionesDePerfil({ alergenos: ['MANI', 'HUEVO'], restricciones: ['VEGANO', 'SIN_AZUCAR'], preferencias: ['FRUTAS'] }),
    [{ codigo: 'MANI', severidad: 'ALERGIA', origen: 'PERFIL' }, { codigo: 'VEGANO', severidad: 'ESTRICTA', origen: 'PERFIL' }]);
  assert.ok(C.opciones().alergenos.find(o => o.codigo === 'PESCADO').motivo);
});

test('Evaluador: unión conservadora consulta + perfil y contradicciones', () => {
  const q = E.prepararConsulta('Busco algo sin gluten').restricciones, perfil = C.restriccionesDePerfil({ alergenos: ['MANI'] });
  assert.deepEqual(E.combinarRestricciones(q, perfil).map(r => r.codigo), ['SIN_GLUTEN', 'MANI'], 'ninguna anula a la otra');
  const dup = E.combinarRestricciones(E.prepararConsulta('Quiero algo sin maní').restricciones, perfil);
  assert.equal(dup.length, 1); assert.equal(dup[0].severidad, 'ALERGIA', 'gana la severidad más alta');
  assert.deepEqual(E.prepararConsulta('No soy alérgico al maní').negadas, ['MANI']);
  assert.deepEqual(E.contradicciones(['MANI'], perfil), ['MANI']);
  assert.deepEqual(E.contradicciones(['GLUTEN'], C.restriccionesDePerfil({ restricciones: ['SIN_GLUTEN'] })), ['GLUTEN']);
  assert.deepEqual(E.contradicciones(['SOYA'], perfil), []);
  // Sin perfil, la detección de FASE 9B-1 no cambia.
  assert.deepEqual(E.prepararConsulta('Soy alérgico al maní').restricciones.map(r => r.codigo), ['MANI']);
});

test('Bono de preferencias: +0,5 por coincidencia, máx. +1, sin agregar productos ni rescatar excluidos', () => {
  const todas = Object.keys(C.PREFERENCIAS);
  assert.deepEqual(REALES.map(p => C.bonoPreferencias(p, todas).bono), [1, 0.5, 1, 1, 0.5, 0.5]);
  assert.equal(C.bonoPreferencias(P(BARRAS), ['INTEGRALES']).bono, 0.5);
  const sel = (q, o = {}) => R.seleccionarCandidatos(REALES, q, undefined, o);
  // Específica: mismos candidatos; el bono puede reordenar empates cercanos.
  let a = sel('Busco un snack'), b = sel('Busco un snack', { preferencias: ['FRUTAS', 'INTEGRALES'] });
  assert.deepEqual(a.candidatos.map(p => p.nombre), [CHIPS, BARRAS]); assert.deepEqual(b.candidatos.map(p => p.nombre), [BARRAS, CHIPS]);
  assert.equal(b.puntuaciones.find(x => x.producto.nombre === BARRAS).puntos, 2, 'la puntuación base no cambia');
  assert.equal(b.puntuaciones.find(x => x.producto.nombre === BARRAS).bonoPreferencias, 1);
  assert.ok(b.puntuaciones.filter(x => x.puntos === 0).every(x => x.bonoPreferencias === undefined), 'sin bono para irrelevantes');
  assert.deepEqual(R.PESOS, { nombre: 3, categoria: 2, ingredientes: 2, descripcion: 1, valoresNutricionales: 1 });
  // Bebidas: mismo conjunto.
  b = sel('¿Qué bebidas tienen disponibles?', { preferencias: ['FRUTAS'] });
  assert.deepEqual(b.candidatos.map(p => p.nombre).sort(), [BEBF, BEBS].sort()); assert.equal(b.candidatos[0].nombre, BEBS);
  // General: mismo número y rotación por categorías.
  a = sel('¿Qué productos tienen?'); b = sel('¿Qué productos tienen?', { preferencias: ['INTEGRALES'] });
  assert.equal(b.candidatos.length, a.candidatos.length); assert.deepEqual(b.candidatos.map(p => p.categoria), a.candidatos.map(p => p.categoria));
  assert.equal(b.tipo, 'GENERAL');
  // Sin coincidencias: sigue sin coincidencias.
  assert.equal(sel('pizza de pepperoni', { preferencias: ['FRUTAS'] }).tipo, 'SIN_COINCIDENCIAS');
  // Un producto excluido nunca vuelve por bono.
  b = sel('Busco un snack', { preferencias: ['FRUTAS', 'INTEGRALES', 'SNACKS_SALUDABLES'], restricciones: C.restriccionesDePerfil({ alergenos: ['MANI'] }) });
  assert.ok(!b.candidatos.some(p => p.nombre === BARRAS));
});

test('API + PostgreSQL: persistencia, seguridad, consentimiento y seguridad alimentaria de FASE 9B-2', async t => {
  const { crearPool } = require('../src/database/pool'), { migrar } = require('../src/database/migraciones');
  const { crearSistema } = require('../src/services/sistema'), { crearApp } = require('../src/app');
  const { Administrador, Empleado } = require('../src/domain/modelos'), { generarToken } = require('../src/security/auth');
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
  let modo = 'todos', antesDeResponder = null; const llamadas = []; const ids = {};
  const transporte = async (url, opts) => {
    const req = JSON.parse(opts.body); llamadas.push(req);
    const enumIds = req.format.properties.productos.items?.properties?.id?.enum || [];
    const r = { todos: { tipo: enumIds.length ? 'RECOMENDACION' : 'ORIENTACION_GENERAL', productos: enumIds.map(id => ({ id })) },
      vacio: { tipo: 'ORIENTACION_GENERAL', productos: [] }, excluido: { tipo: 'RECOMENDACION', productos: [{ id: ids[BARRAS] }] } }[modo];
    if (antesDeResponder) await antesDeResponder();
    return { ok: true, json: async () => ({ response: JSON.stringify(r) }) };
  };
  const sistema = crearSistema({ pool, ia: new IA.ServicioIA({ ollamaProvider: new OllamaProvider({ model: 'modelo-prueba', transporte }) }) });
  const admin = new Administrador({ nombre: 'Admin 9B2', correo: 'admin-9b2@example.test', passwordHash: 'h' });
  const empleado = new Empleado({ nombre: 'Empleado 9B2', correo: 'empleado-9b2@example.test', passwordHash: 'h' });
  await sistema.repositorios.usuarios.guardar(admin); await sistema.repositorios.usuarios.guardar(empleado);
  const guardar = (tipo, datos) => sistema.catalogoComercial.guardar(admin.id, tipo, null, datos);
  const categorias = {}, ingredientes = {};
  for (const n of ['Barras y Snacks', 'Bebidas', 'Panadería y Cereales']) categorias[n] = (await guardar('categorias', { nombre: n })).id;
  const ing = async n => ingredientes[n] ??= (await guardar('ingredientes', { nombre: n })).id;
  for (const p of REALES) {
    const lista = []; for (const n of p.ingredientesLista) lista.push({ id: await ing(n) });
    const g = await guardar('productos', { nombre: p.nombre, categoriaId: categorias[p.categoria], descripcion: p.descripcion, precio: '12.50', estado: true, stockMinimo: 3, ingredientes: lista });
    await sistema.inventario.registrar(admin.id, { productoId: g.id, tipo: 'AJUSTE', cantidad: 10, motivo: 'Fase 9B-2' }); ids[p.nombre] = g.id;
  }
  const cliente = await sistema.registrar({ nombre: 'Cliente 9B2', correo: 'cliente-9b2@example.test', password: 'Clave12345' });
  const otro = await sistema.registrar({ nombre: 'Otro 9B2', correo: 'otro-9b2@example.test', password: 'Clave12345' });
  server = crearApp(sistema, { limites: { ia: 1000 } }).listen(0, '127.0.0.1'); await new Promise(r => server.once('listening', r));
  const api = async (method, ruta, body, usuario = cliente) => { const r = await fetch(`http://127.0.0.1:${server.address().port}/api${ruta}`, { method,
    headers: { 'Content-Type': 'application/json', ...(usuario ? { Authorization: 'Bearer ' + generarToken(usuario) } : {}) }, ...(body !== undefined ? { body: JSON.stringify(body) } : {}) });
    return { status: r.status, data: await r.json() }; };
  const consultar = (texto, usuario = cliente) => api('POST', '/consultas', { texto }, usuario);
  const tarjetas = r => (r.data.consulta?.productosRecomendados || []).map(p => p.nombre);
  const enviados = () => JSON.parse(llamadas.at(-1).prompt).productos.map(p => p.nombre);
  const consentir = (usuario, cambios) => api('PUT', '/perfil/consentimiento', cambios, usuario);
  const filas = async uid => (await pool.query("SELECT tipo, descripcion, version_cifrado FROM preferencias_cliente WHERE id_usuario=$1 ORDER BY id_preferencia", [uid])).rows;
  const respuestas = [];
  const q = async (texto, usuario) => { const r = await consultar(texto, usuario); respuestas.push(r); return r; };

  await t.test('A. Persistencia: guardar, consultar, reemplazar por grupo, borrar con [], sin duplicados, cifrado', async () => {
    let r = await api('GET', '/perfil/alimentacion');
    assert.equal(r.status, 200); assert.deepEqual(r.data.alimentacion, { preferencias: [], restricciones: [], alergenos: [] });
    assert.deepEqual(r.data.consentimientos, { autorizaContextoIA: false, autorizaHistorialIA: false });
    assert.equal(r.data.opciones.alergenos.find(o => o.codigo === 'PESCADO').habilitada, false);
    // Datos del perfil de texto libre previos: deben sobrevivir.
    await api('PUT', '/perfil', { alergias: 'Texto libre previo', objetivoNutricional: 'Más energía' });
    r = await api('PUT', '/perfil/alimentacion', { preferencias: ['FRUTAS'], restricciones: ['VEGANO'], alergenos: ['MANI', 'SOYA'] });
    assert.equal(r.status, 200); assert.deepEqual(r.data.alimentacion, { preferencias: ['FRUTAS'], restricciones: ['VEGANO'], alergenos: ['MANI', 'SOYA'] });
    let f = await filas(cliente.id);
    const nuevas = f.filter(x => Object.values(C.TIPOS_ALIMENTACION).includes(x.tipo));
    assert.equal(nuevas.length, 3); assert.ok(nuevas.every(x => x.version_cifrado === 2 && !/MANI|SOYA|VEGANO|FRUTAS/.test(x.descripcion)), 'cifrado AES-256-GCM');
    assert.equal(f.length, 6, '3 de texto libre + 3 estructuradas');
    // Reemplazo por grupo: lo omitido no cambia.
    r = await api('PUT', '/perfil/alimentacion', { preferencias: ['INTEGRALES', 'FRUTAS'] });
    assert.deepEqual(r.data.alimentacion, { preferencias: ['INTEGRALES', 'FRUTAS'], restricciones: ['VEGANO'], alergenos: ['MANI', 'SOYA'] });
    r = await api('PUT', '/perfil/alimentacion', { restricciones: [] });
    assert.deepEqual(r.data.alimentacion.restricciones, []); assert.deepEqual(r.data.alimentacion.alergenos, ['MANI', 'SOYA']);
    assert.equal((await filas(cliente.id)).filter(x => x.tipo === 'RESTRICCION_DIETETICA').length, 0, '[] borra el grupo');
    // Editar el perfil libre no borra los datos estructurados.
    await api('PUT', '/perfil', { alergias: 'Texto libre nuevo' });
    r = await api('GET', '/perfil/alimentacion'); assert.deepEqual(r.data.alimentacion.alergenos, ['MANI', 'SOYA']);
    assert.equal((await api('GET', '/perfil')).data.perfilSalud.alergias, 'Texto libre nuevo', 'el campo libre se conserva sin interpretación');
    // Concurrencia: 6 reemplazos simultáneos → una sola fila por grupo.
    await Promise.all(['MANI', 'SOYA', 'GLUTEN', 'LACTEOS', 'SESAMO', 'FRUTOS_SECOS'].map(c => api('PUT', '/perfil/alimentacion', { alergenos: [c] })));
    assert.equal((await filas(cliente.id)).filter(x => x.tipo === 'ALERGENO_DECLARADO').length, 1);
    // Respuestas sin datos cifrados.
    const cifrados = (await filas(cliente.id)).map(x => x.descripcion).filter(Boolean); // texto libre vacío se guarda como ''
    r = await api('GET', '/perfil/alimentacion'); assert.ok(cifrados.every(c => !JSON.stringify(r.data).includes(c)));
    await api('PUT', '/perfil/alimentacion', { alergenos: ['MANI'], restricciones: [], preferencias: [] });
  });

  await t.test('A. Validación: códigos desconocidos o deshabilitados, duplicados, tipos, propiedades extra → 400', async () => {
    for (const body of [{}, { alergenos: 'MANI' }, { alergenos: ['MANI', 'MANI'] }, { alergenos: ['PIZZA'] }, { alergenos: ['PESCADO'] }, { alergenos: ['HUEVO'] },
      { restricciones: ['SIN_AZUCAR'] }, { preferencias: ['VEGANO'] }, { alergenos: [1] }, { otro: [] }, { idUsuario: otro.id, alergenos: [] },
      { alergenos: Array(10).fill('MANI') }, { alergenos: null }])
      assert.equal((await api('PUT', '/perfil/alimentacion', body)).status, 400, JSON.stringify(body));
    assert.deepEqual((await api('GET', '/perfil/alimentacion')).data.alimentacion.alergenos, ['MANI'], 'los rechazos no cambian nada');
  });

  await t.test('A. Aislamiento, roles y auditoría sin valores; el consentimiento nunca se activa', async () => {
    assert.deepEqual((await api('GET', '/perfil/alimentacion', undefined, otro)).data.alimentacion.alergenos, [], 'otro cliente no ve datos ajenos');
    for (const u of [admin, empleado]) { assert.equal((await api('GET', '/perfil/alimentacion', undefined, u)).status, 403); assert.equal((await api('PUT', '/perfil/alimentacion', { alergenos: [] }, u)).status, 403); }
    assert.equal((await api('GET', '/perfil/alimentacion', undefined, null)).status, 401);
    const ev = (await pool.query("SELECT accion, datos_anteriores, datos_nuevos FROM auditoria WHERE id_usuario=$1 AND accion LIKE '%alimentacion%'", [cliente.id])).rows;
    assert.ok(ev.some(e => e.accion === 'actualizacion_alimentacion_perfil') && ev.some(e => e.accion === 'consulta_alimentacion_propia'));
    assert.doesNotMatch(JSON.stringify(ev), /MANI|SOYA|VEGANO|FRUTAS|GLUTEN/);
    const pc = (await pool.query('SELECT autoriza_contexto_ia, autoriza_historial_ia FROM perfil_cliente WHERE id_usuario=$1', [cliente.id])).rows[0];
    assert.ok(pc.autoriza_contexto_ia !== true && pc.autoriza_historial_ia !== true, 'guardar no activa consentimientos');
  });

  await t.test('B. Consentimiento: los 7 casos obligatorios (alergia guardada al maní)', async () => {
    modo = 'todos';
    // 6) Guardado sin consentimiento + 3) NULL: no se aplica.
    let r = await q('¿Qué productos tienen?'); assert.ok(enviados().includes(BARRAS), 'NULL: no se aplica lo guardado'); assert.ok(tarjetas(r).includes(BARRAS));
    // 7) Restricción escrita en la consulta con consentimiento NULL/FALSE: se aplica (FASE 9B-1).
    r = await q('Soy alérgico al maní'); assert.ok(!enviados().includes(BARRAS));
    // 4) Historial TRUE + contexto FALSE: no se aplica.
    await consentir(cliente, { autorizaHistorialIA: true, autorizaContextoIA: false });
    r = await q('¿Qué productos tienen?'); assert.ok(enviados().includes(BARRAS), 'historial no sustituye al consentimiento de perfil');
    // 2) FALSE: no se aplica.
    r = await q('Busco un snack'); assert.deepEqual(enviados(), [CHIPS, BARRAS]);
    // 1) TRUE: se aplica.
    await consentir(cliente, { autorizaContextoIA: true });
    r = await q('¿Qué productos tienen?');
    for (const x of [BARRAS, CHIPS, PAN]) { assert.ok(!enviados().includes(x), x); assert.ok(!tarjetas(r).includes(x), x); }
    assert.ok(r.data.consulta.respuestaIA.endsWith(IA.AVISO_RESTRICCION.ALERGIA));
    // Ollama nunca recibe alérgenos, restricciones ni preferencias del perfil (solo la lista blanca de 9A).
    const prompt = JSON.parse(llamadas.at(-1).prompt);
    assert.deepEqual(Object.keys(prompt.perfil), ['objetivoNutricional']); assert.doesNotMatch(llamadas.at(-1).prompt, /MANI|alergeno|restriccion|preferencia|Texto libre/i);
    // 5) TRUE → FALSE: desde la siguiente consulta deja de aplicarse.
    await consentir(cliente, { autorizaContextoIA: false });
    r = await q('¿Qué productos tienen?'); assert.ok(enviados().includes(BARRAS));
    // Los datos guardados siguen ahí (revocar no borra).
    assert.deepEqual((await api('GET', '/perfil/alimentacion')).data.alimentacion.alergenos, ['MANI']);
    await consentir(cliente, { autorizaHistorialIA: false });
  });

  await t.test('C. Seguridad alimentaria con datos guardados y consentimiento activo', async () => {
    await consentir(cliente, { autorizaContextoIA: true }); modo = 'todos';
    // Barras con maní: nunca candidata ni tarjeta, ni pidiéndola explícitamente.
    let n = llamadas.length, r = await q('¿Qué barras tienen?');
    assert.equal(r.data.consulta.respuestaIA, IA.RESTRICCION.PRODUCTO_INCOMPATIBLE); assert.equal(llamadas.length, n); assert.deepEqual(tarjetas(r), []);
    // Producto sin conflicto detectado → tarjeta con aviso (no certificación).
    r = await q('Quiero bebidas'); assert.deepEqual(tarjetas(r), [BEBF, BEBS]); assert.ok(r.data.consulta.respuestaIA.endsWith(IA.AVISO_RESTRICCION.ALERGIA));
    // Restricción guardada + restricción adicional en la consulta: ambas.
    r = await q('Busco algo sin gluten'); for (const x of [BARRAS, CEREALES, PAN, CHIPS]) assert.ok(!enviados().includes(x), x);
    assert.deepEqual(enviados(), [BEBF, BEBS]);
    // Vegano guardado.
    await api('PUT', '/perfil/alimentacion', { alergenos: [], restricciones: ['VEGANO'] });
    r = await q('Busco un snack'); assert.deepEqual(enviados(), [CHIPS]); assert.ok(r.data.consulta.respuestaIA.endsWith(IA.AVISO_RESTRICCION.DIETA));
    // Sin gluten guardado.
    await api('PUT', '/perfil/alimentacion', { restricciones: ['SIN_GLUTEN'] });
    r = await q('¿Qué productos tienen?'); for (const x of [BARRAS, CEREALES, PAN]) assert.ok(!enviados().includes(x), x);
    // Múltiples restricciones: no queda ningún permitido → mensaje fijo, sin modelo.
    await api('PUT', '/perfil/alimentacion', { alergenos: ['MANI'], restricciones: ['VEGANO', 'SIN_GLUTEN'] });
    n = llamadas.length; r = await q('¿Qué productos tienen?');
    assert.equal(r.data.consulta.respuestaIA, IA.RESTRICCION.SIN_INFORMACION); assert.equal(llamadas.length, n); assert.deepEqual(tarjetas(r), []);
    await api('PUT', '/perfil/alimentacion', { restricciones: [] });
    // Ollama devuelve un producto excluido → 502.
    modo = 'excluido'; r = await q('Quiero bebidas'); modo = 'todos'; assert.equal(r.status, 502); assert.equal(r.data.codigo, 'RESPUESTA_INVALIDA');
    // Ollama devuelve [] → explicación del filtrado con origen PERFIL (nunca el texto general).
    modo = 'vacio'; r = await q('¿Qué productos tienen?'); modo = 'todos';
    assert.equal(r.data.consulta.respuestaIA, IA.restriccionAplicada({ incompatibles: 1, noVerificables: 2, categorias: ['Bebidas', 'Panadería y Cereales'], perfil: true }));
    modo = 'vacio'; r = await q('Busco algo sin gluten, quiero bebidas'); modo = 'todos';
    assert.ok(r.data.consulta.respuestaIA.startsWith(IA.RESTRICCION_APLICADA_PERFIL_BASE + ' y las de tu consulta'));
    // Contradicción: mensaje fijo, sin modelo ni tarjetas, sin borrar lo guardado.
    n = llamadas.length; r = await q('No soy alérgico al maní, ¿qué barras tienen?');
    assert.equal(r.data.consulta.respuestaIA, IA.RESTRICCION.CONTRADICCION); assert.equal(llamadas.length, n); assert.deepEqual(tarjetas(r), []);
    assert.deepEqual((await api('GET', '/perfil/alimentacion')).data.alimentacion.alergenos, ['MANI']);
    // Ambigua: aclaración aunque haya alérgenos guardados; ninguna recomendación posterior los ignora.
    r = await q('Tengo alergias'); assert.equal(r.data.consulta.respuestaIA, IA.RESTRICCION.AMBIGUA);
    r = await q('¿Qué productos tienen?'); assert.ok(!enviados().includes(BARRAS));
    // Re-evaluación: el producto cambia durante la consulta → su tarjeta se descarta.
    const maniId = (await pool.query("INSERT INTO ingredientes(nombre) VALUES('Maní tostado 9B2') RETURNING id_ingrediente")).rows[0].id_ingrediente;
    antesDeResponder = () => pool.query('INSERT INTO producto_ingrediente(id_producto,id_ingrediente) VALUES($1,$2) ON CONFLICT DO NOTHING', [ids[BEBF], maniId]); // fixture sintético
    try { r = await q('Quiero bebidas'); assert.ok(enviados().includes(BEBF)); assert.deepEqual(tarjetas(r), [BEBS]); }
    finally { antesDeResponder = null; await pool.query('DELETE FROM producto_ingrediente WHERE id_ingrediente=$1', [maniId]); }
  });

  await t.test('D. Relevancia con preferencias: solo con consentimiento; no agrega ni rescata productos', async () => {
    await api('PUT', '/perfil/alimentacion', { alergenos: [], restricciones: [], preferencias: ['FRUTAS', 'INTEGRALES'] });
    modo = 'todos';
    await consentir(cliente, { autorizaContextoIA: false });
    let r = await q('Busco un snack'); assert.deepEqual(enviados(), [CHIPS, BARRAS], 'sin consentimiento: sin bono');
    await consentir(cliente, { autorizaContextoIA: true });
    r = await q('Busco un snack'); assert.deepEqual(enviados(), [BARRAS, CHIPS], 'con consentimiento: el bono reordena (Barras 2+1 = Chips 3)');
    r = await q('¿Qué productos tienen?'); assert.equal(enviados().length, 5);
    let n = llamadas.length; r = await q('Quiero pizza de pepperoni');
    assert.ok(r.data.consulta.respuestaIA.startsWith(IA.SIN_COINCIDENCIAS_BASE)); assert.equal(llamadas.length, n);
    // "¿Qué bebidas tienen disponibles?" conserva las 2 bebidas (también por el respaldo cuando el modelo no elige).
    // Con alergias en TEXTO LIBRE autorizadas el respaldo se abstiene (regla previa, sin cambios):
    modo = 'vacio'; r = await q('¿Qué bebidas tienen disponibles?'); assert.deepEqual(tarjetas(r), [], 'texto libre de alergias: respaldo omitido');
    await api('PUT', '/perfil', { alergias: '' });
    modo = 'vacio'; r = await q('¿Qué bebidas tienen disponibles?'); modo = 'todos';
    assert.deepEqual(tarjetas(r).sort(), [BEBF, BEBS].sort()); assert.ok(r.data.consulta.respuestaIA.startsWith('Opciones del catálogo: '));
    // Restricción estricta + preferencias: el bono nunca rescata un excluido.
    await api('PUT', '/perfil/alimentacion', { alergenos: ['MANI'], preferencias: ['FRUTAS', 'INTEGRALES', 'SNACKS_SALUDABLES'] });
    r = await q('Quiero algo con avena'); assert.ok(!(llamadas.at(-1) && enviados().includes(BARRAS)));
    assert.ok(!tarjetas(r).includes(BARRAS));
    await api('PUT', '/perfil/alimentacion', { alergenos: [], preferencias: [] });
    await consentir(cliente, { autorizaContextoIA: false });
  });

  await t.test('Integridad: sin frases de garantía; data/db.json intacto; perfil y consentimientos sin cambios implícitos', async () => {
    for (const r of respuestas) assert.doesNotMatch(JSON.stringify(r.data), PROHIBIDAS);
    assert.equal(huella(), huellaInicial);
    const f = await filas(otro.id); assert.ok(f.every(x => !Object.values(C.TIPOS_ALIMENTACION).includes(x.tipo)), 'otro cliente sin datos alimentarios');
  });
});
