// FASE 9B-1 — Evaluador determinista de restricciones alimentarias declaradas en la consulta ACTUAL.
// Hallazgo crítico corregido: "Soy alérgico al maní" enviaba a Ollama "Barras Energéticas Naturales" (declara maní).
// Cubre: detección, evaluador, integración con la relevancia, respaldo, ServicioIA sin modelo y API + PostgreSQL
// (esquema temporal nv_test_*) con un Ollama simulado que captura cada prompt y JSON Schema.
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { randomUUID, createHash } = require('node:crypto');
const fs = require('node:fs'), path = require('node:path');
process.env.JWT_SECRET = 'fase9b1'; process.env.ENCRYPTION_KEY = 'cd'.repeat(32);
const E = require('../src/services/evaluadorAlimentario');
const R = require('../src/services/relevanciaIA');
const IA = require('../src/services/iaService');

// Fixture = los 6 productos elegibles reales (mismos datos que tests/ia-relevancia.test.js).
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
const codigos = q => E.prepararConsulta(q).restricciones.map(r => r.codigo + '/' + r.severidad);
const estado = (n, q) => E.evaluarProducto(P(n), E.prepararConsulta(q).restricciones).estado;
const PROHIBIDAS = /100\s*%\s*segur|libre de al[eé]rgenos|apto para cel[ií]ac|garantizado sin trazas|sin trazas garantizad/i;

test('Detección: solo restricciones DECLARADAS en la consulta (no menciones, preguntas ni negaciones)', () => {
  const casos = [
    ['Soy alérgico al maní', ['MANI/ALERGIA']],
    ['No puedo comer cacahuate', ['MANI/ESTRICTA']],
    ['Quiero algo sin maní', ['MANI/ESTRICTA']],
    ['¿Las barras contienen maní?', []],
    ['Tengo alergias', []],
    ['No soy alérgico al maní', []],
    ['Quiero productos veganos', ['VEGANO/ESTRICTA']],
    ['Busco algo sin gluten', ['SIN_GLUTEN/ESTRICTA']],
    ['Sin azúcar', ['SIN_AZUCAR/ESTRICTA']],
    ['Bajo en azúcar', ['NUTRICIONAL/ESTRICTA']],
    // Adicionales
    ['Soy celíaco', ['GLUTEN/ALERGIA']],
    ['Soy intolerante a la lactosa', ['SIN_LACTOSA/ALERGIA']],
    ['Tengo alergia a la soya y al huevo', ['HUEVO/ALERGIA', 'SOYA/ALERGIA']],
    ['Sin embargo quiero bebidas', []],
    ['Quiero algo alto en proteína', []],
    ['Hola', []],
  ];
  for (const [q, esperado] of casos) assert.deepEqual(codigos(q).sort(), esperado.sort(), q);
  assert.equal(E.prepararConsulta('Tengo alergias').ambigua, true, 'alergia sin ingrediente → ambigua');
  assert.equal(E.prepararConsulta('Soy alérgico').ambigua, true);
  assert.equal(E.prepararConsulta('No tengo alergias').ambigua, false, 'negación: ni restricción ni ambigüedad');
  assert.equal(E.prepararConsulta('Soy alérgico al maní').ambigua, false);
  const bajo = E.prepararConsulta('Bajo en azúcar').restricciones[0];
  assert.equal(bajo.calificador, 'BAJO'); assert.equal(bajo.nutriente, 'azúcar');
  const pers = E.prepararConsulta('Soy alérgico a la canela').restricciones[0];
  assert.deepEqual([pers.codigo, pers.termino, pers.severidad], ['PERSONALIZADA', 'canela', 'ALERGIA'], 'término no catalogado: se respeta literal');
});

test('Detección: los términos de la restricción NO entran a la relevancia', () => {
  assert.equal(E.prepararConsulta('Quiero un snack sin maní').consultaRelevancia, 'quiero un snack');
  assert.equal(E.prepararConsulta('Soy alérgico al maní').consultaRelevancia, '');
  assert.equal(E.prepararConsulta('Soy alérgico al maní, ¿qué bebidas tienen?').consultaRelevancia, 'que bebidas tienen');
  assert.ok(!R.terminosConsulta(E.prepararConsulta('Busco algo sin gluten').consultaRelevancia).includes('gluten'));
  // Una pregunta sobre un ingrediente sí es búsqueda normal (no se elimina el término).
  assert.match(E.prepararConsulta('¿Las barras contienen maní?').consultaRelevancia, /barras.*mani/);
});

test('Evaluador: estados sobre los 6 productos reales (INCOMPATIBLE / NO_VERIFICABLE / SIN_CONFLICTO_DETECTADO)', () => {
  const { INCOMPATIBLE: I, NO_VERIFICABLE: N, SIN_CONFLICTO: S } = E.ESTADOS;
  const tabla = {
    'Soy alérgico al maní': [I, S, S, S, N, N],
    'Busco algo sin gluten': [N, S, S, N, S, N],
    'Quiero productos veganos': [I, I, N, I, S, S],
    'Sin azúcar': [I, I, N, I, N, N],
    'Bajo en azúcar': [N, N, N, N, N, N],
    'Sin lácteos': [S, S, S, S, S, S],
  };
  for (const [q, esperados] of Object.entries(tabla))
    assert.deepEqual(REALES.map(p => estado(p.nombre, q)), esperados, q);
  // Motivo del maní en las barras: ingrediente declarado.
  const ev = E.evaluarProducto(P(BARRAS), E.prepararConsulta('Soy alérgico al maní').restricciones);
  assert.ok(ev.motivos.some(m => m.regla === 'ALERGENO_DECLARADO' && /maní/.test(m.ingrediente)));
  assert.equal(ev.trazasVerificadas, false, 'nunca se afirma ausencia de trazas');
  // "leche vegetal" no es lácteo; un ingrediente con alternativa ("o") es NO_VERIFICABLE, nunca compatible por omisión.
  assert.equal(estado(BEBS, 'Soy alérgico a la leche'), S);
  assert.equal(estado(BEBS, 'Soy alérgico a la fresa'), I);
});

test('Evaluador: casos sintéticos (alternativas, declaraciones comerciales, sin ingredientes, varias restricciones)', () => {
  const r = q => E.prepararConsulta(q).restricciones;
  const prod = (o) => ({ id: 'x', nombre: 'Producto X', categoria: 'C', descripcion: '', ingredientes: '', valoresNutricionales: '', ...o });
  const { INCOMPATIBLE: I, NO_VERIFICABLE: N, SIN_CONFLICTO: S } = E.ESTADOS;
  assert.equal(E.evaluarProducto(prod({ ingredientes: 'Leche o bebida de almendra' }), r('Sin lácteos')).estado, N, 'alternativa con ingrediente incompatible');
  assert.equal(E.evaluarProducto(prod({ ingredientes: 'Mantequilla de maní, Avena' }), r('Soy alérgico al maní')).estado, I);
  assert.equal(E.evaluarProducto(prod({ ingredientes: 'Mantequilla de maní, Avena' }), r('Sin lácteos')).estado, S, '"mantequilla de maní" no es lácteo');
  assert.equal(E.evaluarProducto(prod({ ingredientes: 'Avena', descripcion: 'Barra sin maní' }), r('Soy alérgico al maní')).estado, N, 'declaración comercial no verificada');
  assert.equal(E.evaluarProducto(prod({ ingredientes: 'Avena', nombre: 'Galleta de maní' }), r('Soy alérgico al maní')).estado, I, 'mención en el nombre');
  assert.equal(E.evaluarProducto(prod({ ingredientes: '' }), r('Soy alérgico al maní')).estado, N, 'sin ingredientes declarados');
  assert.equal(E.evaluarProducto(prod({ ingredientesLista: ['Avena', 'Huevo'] }), r('Soy alérgico al maní y al huevo')).estado, I, 'todas deben cumplirse');
  assert.equal(E.evaluarProducto(prod({ ingredientesLista: ['Avena', 'Canela'] }), r('Soy alérgico a la canela')).estado, I, 'término personalizado');
  assert.equal(E.evaluarProducto(prod({ ingredientesLista: ['Avena', 'Saborizantes'] }), r('Soy alérgico a la canela')).estado, N, 'ingrediente genérico');
  assert.equal(E.evaluarProducto(prod({ ingredientesLista: ['Avena'] }), []).estado, S, 'sin restricciones no hay filtro');
  const f = E.filtrarProductos(REALES, r('Soy alérgico al maní'));
  assert.deepEqual(f.permitidos.map(p => p.nombre), [BEBF, BEBS, CEREALES]);
  assert.deepEqual(f.excluidos.map(x => x.producto.nombre), [BARRAS, CHIPS, PAN]);
  assert.equal(E.filtrarProductos(REALES, []).permitidos.length, 6);
});

test('Relevancia: el evaluador excluye ANTES de puntuar; el respaldo nunca contiene excluidos', () => {
  const sel = q => { const pc = E.prepararConsulta(q); return R.seleccionarCandidatos(REALES, pc.consultaRelevancia, undefined, { restricciones: pc.restricciones }); };
  let s = sel('Soy alérgico al maní');
  assert.equal(s.tipo, 'GENERAL'); assert.ok(!s.candidatos.some(p => p.nombre === BARRAS), 'el maní nunca es candidato');
  assert.deepEqual(R.opcionesSeleccion(s, { consulta: 'Soy alérgico al maní' }), { restriccionAplicada: { incompatibles: 1, noVerificables: 2, categorias: ['Bebidas', 'Panadería y Cereales'] } });
  s = sel('Soy alérgico al maní, ¿qué barras tienen?');
  assert.equal(s.tipo, 'SOLICITUD_EXCLUIDA'); assert.equal(s.motivo, 'INCOMPATIBLE'); assert.deepEqual(s.candidatos, []);
  s = sel('Quiero un snack sin maní');
  assert.equal(s.tipo, 'SOLICITUD_EXCLUIDA'); assert.equal(s.motivo, 'NO_VERIFICABLE', 'chips: aceite vegetal genérico');
  s = sel('Soy alérgico al maní, quiero bebidas');
  assert.equal(s.tipo, 'ESPECIFICA'); assert.deepEqual(s.candidatos.map(p => p.nombre), [BEBF, BEBS]);
  assert.deepEqual(R.opcionesSeleccion(s, { consulta: 'Soy alérgico al maní, quiero bebidas' }),
    { respaldoOmitido: 'RESTRICCIONES', restriccionAplicada: { incompatibles: 1, noVerificables: 2, categorias: ['Bebidas', 'Panadería y Cereales'] } });
  s = sel('Sin azúcar'); assert.equal(s.tipo, 'SIN_CANDIDATOS_RESTRICCION'); assert.equal(s.motivo, 'NO_VERIFICABLE');
  assert.deepEqual(R.opcionesSeleccion(s), { respuestaFija: { tipo: 'SIN_CANDIDATOS_RESTRICCION', motivo: 'NO_VERIFICABLE' } });
  // Aunque se llamara al respaldo con una selección filtrada, solo puede devolver permitidos.
  s = sel('Soy alérgico al maní, busco barras y bebidas');
  assert.ok(R.respaldoEspecifico(s).every(p => p.nombre !== BARRAS));
  assert.ok(s.candidatos.every(p => E.evaluarProducto(p, s.restricciones).estado === E.ESTADOS.SIN_CONFLICTO));
  // Sin restricciones: selección idéntica a la versión anterior (pesos 3/2/2/1/1, sin bonificaciones).
  s = sel('Busco un snack'); assert.deepEqual(s.candidatos.map(p => p.nombre), [CHIPS, BARRAS]);
  assert.deepEqual(R.PESOS, { nombre: 3, categoria: 2, ingredientes: 2, descripcion: 1, valoresNutricionales: 1 });
  assert.deepEqual(R.opcionesSeleccion({ tipo: 'RESTRICCION_AMBIGUA' }), { respuestaFija: { tipo: 'RESTRICCION_AMBIGUA' } });
});

test('ServicioIA: respuestas fijas de restricción sin llamar al modelo (incluso con Ollama apagado o sin configurar)', async () => {
  const { OllamaProvider } = require('../src/services/ollamaProvider');
  let llamadas = 0;
  const transporte = async () => { llamadas++; throw new Error('ECONNREFUSED'); };
  for (const proveedor of [new OllamaProvider({ model: 'modelo-prueba', transporte }), new OllamaProvider({ model: '', transporte })]) {
    const ia = new IA.ServicioIA({ ollamaProvider: proveedor });
    const casos = [[{ tipo: 'RESTRICCION_AMBIGUA' }, IA.RESTRICCION.AMBIGUA],
      [{ tipo: 'SIN_CANDIDATOS_RESTRICCION', motivo: 'NO_VERIFICABLE' }, IA.RESTRICCION.SIN_INFORMACION],
      [{ tipo: 'SIN_CANDIDATOS_RESTRICCION', motivo: 'INCOMPATIBLE' }, IA.RESTRICCION.SIN_CANDIDATOS],
      [{ tipo: 'SOLICITUD_EXCLUIDA', motivo: 'INCOMPATIBLE' }, IA.RESTRICCION.PRODUCTO_INCOMPATIBLE],
      [{ tipo: 'SOLICITUD_EXCLUIDA', motivo: 'NO_VERIFICABLE' }, IA.RESTRICCION.SIN_INFORMACION]];
    for (const [fija, texto] of casos) {
      const r = await ia.generarRecomendacionDetallada({ consulta: 'Soy alérgico al maní', productos: [] }, { respuestaFija: fija });
      assert.equal(r.texto, texto); assert.equal(r.consultoModelo, false); assert.deepEqual(r.productoIds, []);
    }
    // La consulta médica sigue teniendo prioridad sobre cualquier restricción.
    const m = await ia.generarRecomendacionDetallada({ consulta: 'Soy alérgico al maní, ¿qué medicamento tomo?', productos: [] }, { respuestaFija: { tipo: 'RESTRICCION_AMBIGUA' } });
    assert.equal(m.texto, IA.MEDICA);
  }
  assert.equal(llamadas, 0, 'nunca se contactó al modelo');
  for (const t of [...Object.values(IA.RESTRICCION), ...Object.values(IA.AVISO_RESTRICCION)]) assert.doesNotMatch(t, PROHIBIDAS, t);
  assert.match(IA.AVISO_RESTRICCION.ALERGIA, /trazas/); assert.match(IA.AVISO_RESTRICCION.DIETA, /no es una certificación/);
});

test('API + PostgreSQL: filtro antes de Ollama, validación de IDs, respaldo protegido y re-evaluación de tarjetas', async t => {
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
  // Ollama simulado: captura prompt + JSON Schema; distintos comportamientos del modelo.
  let modo = 'todos', antesDeResponder = null; const llamadas = []; const ids = {};
  const transporte = async (url, opts) => {
    const req = JSON.parse(opts.body); llamadas.push(req);
    if (modo === 'apagado') throw new Error('ECONNREFUSED');
    const enumIds = req.format.properties.productos.items?.properties?.id?.enum || [];
    const r = { todos: { tipo: enumIds.length ? 'RECOMENDACION' : 'ORIENTACION_GENERAL', productos: enumIds.map(id => ({ id })) },
      vacio: { tipo: 'ORIENTACION_GENERAL', productos: [] },
      excluido: { tipo: 'RECOMENDACION', productos: [{ id: ids[BARRAS] }] },
      inventado: { tipo: 'RECOMENDACION', productos: [{ id: randomUUID() }] } }[modo];
    if (antesDeResponder) await antesDeResponder();
    return { ok: true, json: async () => ({ response: JSON.stringify(r) }) };
  };
  const sistema = crearSistema({ pool, ia: new IA.ServicioIA({ ollamaProvider: new OllamaProvider({ model: 'modelo-prueba', transporte }) }) });
  const admin = new Administrador({ nombre: 'Admin 9B1', correo: 'admin-9b1@example.test', passwordHash: 'h' });
  await sistema.repositorios.usuarios.guardar(admin);
  const cliente = await sistema.registrar({ nombre: 'Cliente 9B1', correo: 'cliente-9b1@example.test', password: 'Clave12345' });
  const guardar = (tipo, datos) => sistema.catalogoComercial.guardar(admin.id, tipo, null, datos);
  const categorias = {}, ingredientes = {};
  for (const n of ['Barras y Snacks', 'Bebidas', 'Panadería y Cereales']) categorias[n] = (await guardar('categorias', { nombre: n })).id;
  const ing = async n => ingredientes[n] ??= (await guardar('ingredientes', { nombre: n })).id;
  for (const p of REALES) {
    const lista = []; for (const n of p.ingredientesLista) lista.push({ id: await ing(n) });
    const g = await guardar('productos', { nombre: p.nombre, categoriaId: categorias[p.categoria], descripcion: p.descripcion, precio: '12.50', estado: true, stockMinimo: 3, ingredientes: lista });
    await sistema.inventario.registrar(admin.id, { productoId: g.id, tipo: 'AJUSTE', cantidad: 10, motivo: 'Fase 9B-1' }); ids[p.nombre] = g.id;
  }
  // Límite de IA ampliado SOLO en esta instancia de prueba (opción existente de crearApp): la prueba envía >30 consultas/min.
  server = crearApp(sistema, { limites: { ia: 500 } }).listen(0, '127.0.0.1'); await new Promise(r => server.once('listening', r));
  const tc = generarToken(cliente);
  const consultar = async texto => { const r = await fetch(`http://127.0.0.1:${server.address().port}/api/consultas`, { method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + tc }, body: JSON.stringify({ texto }) }); return { status: r.status, data: await r.json() }; };
  const tarjetas = r => (r.data.consulta?.productosRecomendados || []).map(p => p.nombre);
  const enviados = () => JSON.parse(llamadas.at(-1).prompt).productos.map(p => p.nombre);
  const enumUltimo = () => llamadas.at(-1).format.properties.productos.items?.properties?.id?.enum || [];
  const respuestas = [];
  const q = async texto => { const r = await consultar(texto); respuestas.push(r); return r; };

  await t.test('Repositorio: candidatos con lista de ingredientes y sin cambiar la API de productos', async () => {
    const s = await sistema.repositorios.productos.seleccionarCandidatosIA('', { restricciones: E.prepararConsulta('Soy alérgico al maní').restricciones });
    assert.ok(!s.candidatos.some(p => p.nombre === BARRAS));
    assert.ok(s.excluidos.some(x => x.producto.nombre === BARRAS && x.estado === 'INCOMPATIBLE'));
    const lista = await sistema.repositorios.productos.listar();
    assert.ok(lista.every(p => !('ingredientesLista' in p)), 'la API de productos no cambia');
  });

  await t.test('Hallazgo crítico: "Soy alérgico al maní" → el producto con maní NUNCA llega a Ollama (prompt ni JSON Schema)', async () => {
    modo = 'todos'; const n = llamadas.length, r = await q('Soy alérgico al maní');
    assert.equal(r.status, 200); assert.equal(llamadas.length, n + 1);
    assert.ok(!enviados().includes(BARRAS)); assert.ok(!enumUltimo().includes(ids[BARRAS]));
    assert.ok(!llamadas.at(-1).prompt.includes(ids[BARRAS]) && !llamadas.at(-1).prompt.includes('Frutos secos'));
    for (const x of [CHIPS, PAN]) assert.ok(!enviados().includes(x), 'NO_VERIFICABLE también se excluye');
    assert.ok(!tarjetas(r).includes(BARRAS));
    assert.ok(r.data.consulta.respuestaIA.endsWith(IA.AVISO_RESTRICCION.ALERGIA), 'aviso prudente de alérgenos y trazas');
    // El perfil no se envía (sin consentimiento) y la restricción no se envía como dato de perfil.
    assert.equal(JSON.parse(llamadas.at(-1).prompt).perfil, null);
  });

  await t.test('Ollama devuelve un ID excluido o inventado → 502 RESPUESTA_INVALIDA, sin tarjetas', async () => {
    for (const m of ['excluido', 'inventado']) {
      modo = m; const r = await q('Soy alérgico al maní, quiero bebidas'); modo = 'todos';
      assert.equal(r.status, 502, m); assert.equal(r.data.codigo, 'RESPUESTA_INVALIDA', m);
    }
  });

  await t.test('Ollama apagado: 503 con candidatos; respuestas fijas siguen funcionando sin modelo', async () => {
    modo = 'apagado';
    let r = await q('Soy alérgico al maní, quiero bebidas'); assert.equal(r.status, 503); assert.equal(r.data.codigo, 'OLLAMA_NO_DISPONIBLE');
    const n = llamadas.length;
    r = await q('Tengo alergias'); assert.equal(r.status, 200); assert.equal(r.data.consulta.respuestaIA, IA.RESTRICCION.AMBIGUA);
    r = await q('Sin azúcar'); assert.equal(r.status, 200); assert.equal(r.data.consulta.respuestaIA, IA.RESTRICCION.SIN_INFORMACION);
    assert.equal(llamadas.length, n, 'sin llamadas al modelo'); modo = 'todos';
  });

  await t.test('Sin candidatos permitidos o producto pedido excluido: mensaje fijo, sin modelo, sin tarjetas, RESPONDIDA', async () => {
    const n = llamadas.length;
    for (const [texto, esperado] of [['Tengo alergias', IA.RESTRICCION.AMBIGUA], ['Sin azúcar', IA.RESTRICCION.SIN_INFORMACION],
      ['Bajo en azúcar', IA.RESTRICCION.SIN_INFORMACION], ['Soy alérgico al maní, ¿qué barras tienen?', IA.RESTRICCION.PRODUCTO_INCOMPATIBLE],
      ['Quiero un snack sin maní', IA.RESTRICCION.SIN_INFORMACION]]) {
      const r = await q(texto); assert.equal(r.status, 200, texto); assert.equal(r.data.consulta.respuestaIA, esperado, texto);
      assert.deepEqual(tarjetas(r), [], texto); assert.equal(r.data.consulta.estado, 'RESPONDIDA');
    }
    assert.equal(llamadas.length, n);
  });

  await t.test('Respaldo: se abstiene con restricciones; nunca muestra excluidos', async () => {
    modo = 'vacio';
    let r = await q('Soy alérgico al maní, quiero bebidas'); assert.deepEqual(tarjetas(r), []);
    assert.equal(r.data.consulta.respuestaIA, IA.restriccionAplicada({ incompatibles: 1, noVerificables: 2, categorias: ['Bebidas', 'Panadería y Cereales'] }));
    r = await q('Soy alérgico al maní, busco barras y bebidas'); assert.ok(!tarjetas(r).includes(BARRAS)); assert.deepEqual(tarjetas(r), []);
    const ev = (await pool.query("SELECT COUNT(*)::int n FROM auditoria WHERE accion='consulta_ia_respaldo_backend' AND recurso_accedido=$1", ['consultas/' + r.data.consulta.id])).rows[0].n;
    assert.equal(ev, 0);
    modo = 'todos';
  });

  await t.test('Re-evaluación: si el producto cambia DURANTE la consulta y ya no cumple, no se crea su tarjeta', async () => {
    modo = 'todos';
    const maniId = (await pool.query("INSERT INTO ingredientes(nombre) VALUES('Maní tostado') ON CONFLICT(nombre) DO UPDATE SET nombre=EXCLUDED.nombre RETURNING id_ingrediente")).rows[0].id_ingrediente;
    antesDeResponder = () => pool.query('INSERT INTO producto_ingrediente(id_producto,id_ingrediente) VALUES($1,$2) ON CONFLICT DO NOTHING', [ids[BEBF], maniId]); // fixture sintético
    try {
      const r = await q('Soy alérgico al maní, quiero bebidas');
      assert.equal(r.status, 200); assert.ok(enviados().includes(BEBF), 'era permitido al seleccionar');
      assert.deepEqual(tarjetas(r), [BEBS], 'la tarjeta del producto que cambió se descarta');
      assert.ok(!r.data.consulta.respuestaIA.includes(BEBF));
    } finally { antesDeResponder = null; await pool.query('DELETE FROM producto_ingrediente WHERE id_producto=$1 AND id_ingrediente=$2', [ids[BEBF], maniId]); }
    // Si todas las tarjetas caen en la re-evaluación: mensaje de restricción, sin tarjetas.
    antesDeResponder = () => pool.query('INSERT INTO producto_ingrediente(id_producto,id_ingrediente) VALUES($1,$2),($3,$2) ON CONFLICT DO NOTHING', [ids[BEBF], maniId, ids[BEBS]]);
    try {
      const r = await q('Soy alérgico al maní, quiero bebidas');
      assert.deepEqual(tarjetas(r), []); assert.equal(r.data.consulta.respuestaIA, IA.RESTRICCION.SIN_CANDIDATOS);
    } finally { antesDeResponder = null; await pool.query('DELETE FROM producto_ingrediente WHERE id_ingrediente=$1', [maniId]); }
  });

  await t.test('Consulta médica: prioridad absoluta, sin modelo ni tarjetas', async () => {
    const n = llamadas.length, r = await q('Soy alérgico al maní y tengo diabetes, ¿qué medicamento tomo?');
    assert.equal(r.data.consulta.respuestaIA, IA.MEDICA); assert.equal(llamadas.length, n); assert.deepEqual(tarjetas(r), []);
  });

  await t.test('Dieta: aviso de no certificación; tarjetas solo de permitidos', async () => {
    modo = 'todos'; const r = await q('Soy vegano, busco snacks');
    assert.deepEqual(enviados(), [CHIPS]); assert.deepEqual(tarjetas(r), [CHIPS]);
    assert.ok(r.data.consulta.respuestaIA.endsWith(IA.AVISO_RESTRICCION.DIETA));
    const g = await q('Busco algo sin gluten');
    for (const x of [BARRAS, CEREALES, PAN]) assert.ok(!enviados().includes(x) && !tarjetas(g).includes(x));
    assert.ok(g.data.consulta.respuestaIA.endsWith(IA.AVISO_RESTRICCION.ALERGIA), '"sin gluten" recibe aviso de trazas');
  });

  await t.test('Las alergias del PERFIL no filtran todavía (FASE 9B-2) ni se envían a Ollama; el respaldo sigue absteniéndose', async () => {
    await sistema.perfil.actualizar(cliente.id, { alergias: 'Maní', objetivoNutricional: 'Más energía' });
    await pool.query('UPDATE perfil_cliente SET autoriza_contexto_ia=TRUE WHERE id_usuario=$1', [cliente.id]);
    try {
      modo = 'todos'; await q('Busco barras');
      assert.ok(enviados().includes(BARRAS), 'sin restricción en la consulta: el filtro de 9B-1 no lee el perfil');
      const prompt = JSON.parse(llamadas.at(-1).prompt);
      assert.deepEqual(Object.keys(prompt.perfil), ['objetivoNutricional']); assert.doesNotMatch(llamadas.at(-1).prompt, /alergi/i);
      modo = 'vacio'; const r = await q('Busco barras'); assert.deepEqual(tarjetas(r), [], 'respaldo omitido por alergias del perfil autorizado');
    } finally { await pool.query('UPDATE perfil_cliente SET autoriza_contexto_ia=FALSE WHERE id_usuario=$1', [cliente.id]); modo = 'todos'; }
  });

  await t.test('Regresión: consultas sin restricciones conservan candidatos, respaldo y tarjetas', async () => {
    modo = 'vacio';
    for (const [texto, esperado] of [['¿Qué bebidas tienen disponibles?', [BEBF, BEBS]], ['¿Qué bebidas saludables venden?', [BEBS]],
      ['busco de snak', [CHIPS, BARRAS]], ['Quiero algo para desayunar', [CEREALES]]]) {
      const r = await q(texto); assert.equal(r.status, 200, texto); assert.deepEqual(tarjetas(r), esperado, texto);
      assert.ok(!r.data.consulta.respuestaIA.includes(IA.AVISO_RESTRICCION.ALERGIA), 'sin aviso cuando no hay restricción');
    }
    modo = 'todos'; let r = await q('Hola'); assert.equal(r.status, 200);
    r = await q('¿Las barras contienen maní?'); assert.equal(r.status, 200); assert.ok(enviados().includes(BARRAS), 'una pregunta no es una restricción');
  });

  await t.test('Revisión manual en Windows: los 6 casos (mensaje, candidatos enviados, llamada a Ollama y tarjetas)', async () => {
    const aplicada = (incompatibles, noVerificables, categorias) => IA.restriccionAplicada({ incompatibles, noVerificables, categorias });
    // [consulta, ¿llama a Ollama?, candidatos enviados, texto si el modelo no elige ninguno, tarjetas y aviso si elige todos]
    const CASOS = [
      ['Tengo alergias', false, [], IA.RESTRICCION.AMBIGUA, [], null],
      ['Busco algo sin gluten', true, [CHIPS, BEBF, BEBS], aplicada(0, 3, ['Barras y Snacks', 'Bebidas']), [CHIPS, BEBF, BEBS], IA.AVISO_RESTRICCION.ALERGIA],
      ['Quiero productos veganos', true, [CHIPS, PAN], aplicada(3, 1, ['Barras y Snacks', 'Panadería y Cereales']), [CHIPS, PAN], IA.AVISO_RESTRICCION.DIETA],
      ['Quiero un snack sin maní', false, [], IA.RESTRICCION.SIN_INFORMACION, [], null],
      ['Soy alérgico al maní', true, [BEBF, CEREALES, BEBS], aplicada(1, 2, ['Bebidas', 'Panadería y Cereales']), [BEBF, CEREALES, BEBS], IA.AVISO_RESTRICCION.ALERGIA],
    ];
    for (const m of ['vacio', 'todos']) {
      modo = m;
      for (const [texto, llama, enviadosEsperados, textoVacio, tarjetasTodos, aviso] of CASOS) {
        const n = llamadas.length, r = await q(texto), t = r.data.consulta.respuestaIA;
        assert.equal(r.status, 200, texto); assert.equal(llamadas.length, n + (llama ? 1 : 0), `${texto}: llamada a Ollama`);
        if (llama) { assert.deepEqual(enviados(), enviadosEsperados, `${texto}: candidatos permitidos`); assert.deepEqual(enumUltimo().length, enviadosEsperados.length); }
        // Nunca el texto general del catálogo ni "sin coincidencias" para una consulta con restricción.
        assert.notEqual(t, IA.GENERAL, texto); assert.ok(!t.startsWith(IA.SIN_COINCIDENCIAS_BASE), texto);
        if (m === 'vacio' || !llama) { assert.equal(t, textoVacio, `${texto} (${m})`); assert.deepEqual(tarjetas(r), [], texto); }
        else { assert.deepEqual(tarjetas(r), tarjetasTodos, texto); assert.ok(t.endsWith(aviso), `${texto}: aviso`); }
      }
      // Caso 6: sin restricción, se conserva el comportamiento (2 tarjetas; con el modelo vacío, por el respaldo).
      const r = await q('¿Qué bebidas tienen disponibles?');
      assert.deepEqual(tarjetas(r), [BEBF, BEBS], `bebidas (${m})`); assert.ok(r.data.consulta.respuestaIA.startsWith('Opciones del catálogo: '));
      assert.ok(!r.data.consulta.respuestaIA.includes(IA.AVISO_RESTRICCION.ALERGIA));
    }
    modo = 'todos';
    // Distinción: sin productos relevantes (SIN_COINCIDENCIAS) ≠ productos excluidos por la restricción.
    let r = await q('Soy alérgico al maní, busco pizza'); assert.ok(r.data.consulta.respuestaIA.startsWith(IA.SIN_COINCIDENCIAS_BASE));
    r = await q('Soy alérgico al maní, ¿qué barras tienen?'); assert.equal(r.data.consulta.respuestaIA, IA.RESTRICCION.PRODUCTO_INCOMPATIBLE);
  });

  await t.test('Ninguna respuesta usa frases prohibidas; auditoría sin texto de restricciones; data/db.json intacto', async () => {
    for (const r of respuestas) assert.doesNotMatch(JSON.stringify(r.data), PROHIBIDAS);
    const filas = (await pool.query('SELECT accion, datos_anteriores, datos_nuevos FROM auditoria')).rows;
    assert.ok(!JSON.stringify(filas).match(/man[ií]|alergi|gluten|vegan/i), 'la auditoría no guarda restricciones');
    assert.equal(huella(), huellaInicial);
  });
});
