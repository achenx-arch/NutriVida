// ETAPA B: carga controlada de los 20 productos del PDF (esquema temporal nv_test_*).
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs'), os = require('node:os'), path = require('node:path');
const { randomUUID } = require('node:crypto');
process.env.JWT_SECRET = 'catalogo-pdf-sintetico'; process.env.ENCRYPTION_KEY = 'ab'.repeat(32);
const { crearPool } = require('../src/database/pool');
const { migrar } = require('../src/database/migraciones');
const { importarJson, verificarImportacion } = require('../src/database/importacion');
const { crearSistema } = require('../src/services/sistema');
const { crearApp } = require('../src/app');
const { Administrador } = require('../src/domain/modelos');
const { generarToken } = require('../src/security/auth');
const { cargarCatalogo, prepararPlan, CATEGORIAS } = require('../database/scripts/cargar-catalogo-pdf');
const { instantanea, verificar } = require('../database/scripts/catalogo-pdf-estado');
const { fuente } = require('./fixtures/fase2');

test('Plan: valida archivos, SHA-256 y ausencia de datos no documentados antes de tocar la base', () => {
  const plan = prepararPlan();
  assert.equal(plan.productos.length, 20);
  assert.equal(new Set(plan.productos.map(p => p.id)).size, 20);
  assert.deepEqual(prepararPlan().productos.map(p => p.id), plan.productos.map(p => p.id), 'IDs deterministas');
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'nv-pdf-img-'));
  try {
    assert.throws(() => prepararPlan({ dirImagenes: tmp }), e => e.codigo === 'IMAGEN_NO_COPIADA');
    for (const p of plan.productos) fs.copyFileSync(path.join(__dirname, '../public', p.imagenUrl), path.join(tmp, path.basename(p.imagenUrl)));
    fs.appendFileSync(path.join(tmp, 'postres-saludables.webp'), 'x');
    assert.throws(() => prepararPlan({ dirImagenes: tmp }), e => e.codigo === 'IMAGEN_SHA256_DISTINTO');
  } finally { fs.rmSync(tmp, { recursive: true, force: true }); }
  const base = fs.mkdtempSync(path.join(os.tmpdir(), 'nv-pdf-prop-'));
  try {
    const orig = path.join(__dirname, '../docs/fuentes/catalogo-pdf');
    fs.copyFileSync(path.join(orig, 'manifiesto-productos.json'), path.join(base, 'manifiesto-productos.json'));
    const prop = JSON.parse(fs.readFileSync(path.join(orig, 'propuesta-carga.json'), 'utf8'));
    for (const [campo, valor, codigo] of [['precio', '10.00', 'DATO_NO_DOCUMENTADO'], ['estado', 'ACTIVO', 'DATO_NO_DOCUMENTADO'], ['stock', 5, 'DATO_NO_DOCUMENTADO'],
      ['descripcionCatalogo', 'Cura la diabetes', 'DESCRIPCION_SIN_TRAZABILIDAD'], ['ingredientes', ['Avena 50 g'], 'INGREDIENTES_NO_COINCIDEN'], ['categoriaSistema', 'Otra', 'CATEGORIA_INVALIDA']]) {
      const copia = structuredClone(prop); copia.productos[0][campo] = valor;
      fs.writeFileSync(path.join(base, 'propuesta-carga.json'), JSON.stringify(copia));
      assert.throws(() => prepararPlan({ base }), e => e.codigo === codigo, campo);
    }
  } finally { fs.rmSync(base, { recursive: true, force: true }); }
});

test('Carga PostgreSQL: simulación, homónimos, rollback, carga, verificación e idempotencia', async t => {
  const id = randomUUID().replaceAll('-', ''), schema = 'nv_test_' + id, control = 'nv_test_control_' + id;
  const gestor = crearPool({ pruebas: true }); await gestor.query(`CREATE SCHEMA ${schema}`);
  const pool = crearPool({ pruebas: true, schema }); const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'nv-pdf-'));
  let server;
  t.after(async () => { if (server) await new Promise(r => server.close(r)); await pool.end();
    try { await gestor.query(`DROP SCHEMA ${schema} CASCADE`); await gestor.query(`DROP SCHEMA IF EXISTS ${control} CASCADE`); } finally { await gestor.end(); }
    fs.rmSync(dir, { recursive: true, force: true }); });
  await migrar(pool, { esquemaControl: control });
  const datos = fuente(), archivo = path.join(dir, 'db.json'); fs.writeFileSync(archivo, JSON.stringify(datos));
  await importarJson(pool, archivo, { backupDir: path.join(dir, 'bk') });
  const sistema = crearSistema({ pool });
  const admin = new Administrador({ nombre: 'Admin PDF', correo: 'admin-pdf@example.test', passwordHash: 'h' });
  await sistema.repositorios.usuarios.guardar(admin);
  // Estado previo realista: una categoría y un ingrediente ya existen (se reutilizan sin modificarse).
  const supl = await sistema.catalogoComercial.guardar(admin.id, 'categorias', null, { nombre: 'Suplementos', descripcion: 'Previa' });
  const avena = await sistema.catalogoComercial.guardar(admin.id, 'ingredientes', null, { nombre: 'Avena' });
  const previo = await sistema.catalogoComercial.guardar(admin.id, 'productos', null, { nombre: 'Producto previo', categoriaId: supl.id, precio: '9.00', estado: true });
  const huellaPrevia = async () => JSON.stringify((await pool.query('SELECT * FROM productos WHERE id_producto=$1', [previo.id])).rows) + JSON.stringify((await pool.query('SELECT * FROM categorias WHERE id_categoria=$1', [supl.id])).rows);
  const huella0 = await huellaPrevia();
  const conteo = async () => (await pool.query(`SELECT (SELECT count(*) FROM productos) p,(SELECT count(*) FROM categorias) c,(SELECT count(*) FROM ingredientes) i,
    (SELECT count(*) FROM producto_ingrediente) pi,(SELECT count(*) FROM auditoria) a,(SELECT count(*) FROM inventario) inv`)).rows[0];
  const plan = prepararPlan(); const ids = plan.productos.map(p => p.id);
  const cargados = async () => Number((await pool.query('SELECT count(*) FROM productos WHERE id_producto=ANY($1::uuid[])', [ids])).rows[0].count);

  await t.test('Requiere ADMINISTRADOR activo existente', async () => {
    await assert.rejects(cargarCatalogo(pool, { adminCorreo: '' }), /USO/);
    await assert.rejects(cargarCatalogo(pool, { adminCorreo: 'nadie@example.test', confirmar: true }), e => e.codigo === 'ADMINISTRADOR_NO_ENCONTRADO');
    await assert.rejects(cargarCatalogo(pool, { adminCorreo: datos.usuarios[0].correo, confirmar: true }), e => e.codigo === 'ADMINISTRADOR_NO_ENCONTRADO'); // CLIENTE
  });

  await t.test('Simulación (sin --confirmar): ejecuta todo y hace ROLLBACK', async () => {
    const antes = await conteo();
    const r = await cargarCatalogo(pool, { adminCorreo: admin.correo });
    assert.equal(r.confirmado, false); assert.equal(r.productosCreados, 20);
    assert.deepEqual(await conteo(), antes);
  });

  await t.test('Homónimo existente: aborta sin fusionar ni escribir nada', async () => {
    const intruso = await sistema.catalogoComercial.guardar(admin.id, 'productos', null, { nombre: 'Helados  saludables', categoriaId: supl.id });
    const antes = await conteo();
    await assert.rejects(cargarCatalogo(pool, { adminCorreo: admin.correo, confirmar: true }), e => e.codigo === 'NOMBRE_YA_EXISTE_EN_OTRO_PRODUCTO');
    assert.deepEqual(await conteo(), antes);
    await pool.query('DELETE FROM producto_ingrediente WHERE id_producto=$1', [intruso.id]); // limpieza del fixture sintético
    await pool.query('DELETE FROM productos WHERE id_producto=$1', [intruso.id]);
  });

  await t.test('Error a mitad de la carga → ROLLBACK completo', async () => {
    const antes = await conteo(); let inserciones = 0;
    const falla = { connect: async () => { const c = await pool.connect(), q = c.query.bind(c);
      c.query = (sql, ...r) => typeof sql === 'string' && sql.startsWith('INSERT INTO productos') && ++inserciones === 15 ? Promise.reject(Object.assign(new Error('fallo inducido'), { code: '23514' })) : q(sql, ...r);
      const liberar = c.release.bind(c); c.release = (...a) => { c.query = q; c.release = liberar; return liberar(...a); }; return c; } };
    await assert.rejects(cargarCatalogo(falla, { adminCorreo: admin.correo, confirmar: true }));
    assert.equal(inserciones, 15); assert.deepEqual(await conteo(), antes); assert.equal(await cargados(), 0);
  });

  let antes;
  await t.test('Carga confirmada: 20 productos, 8 categorías, ingredientes, imágenes, inactivos y sin precio/inventario', async () => {
    antes = await instantanea(pool);
    const r = await cargarCatalogo(pool, { adminCorreo: admin.correo, confirmar: true });
    assert.equal(r.productosCreados, 20); assert.equal(r.productosYaCargados, 0);
    assert.deepEqual(r.categoriasReutilizadas, ['Suplementos']); assert.equal(r.categoriasCreadas.length, 7);
    assert.ok(r.ingredientesReutilizados >= 1);
    const v = await verificar(pool, antes);
    assert.equal(v.resultado, 'OK', JSON.stringify(v.fallidas));
    assert.equal(await huellaPrevia(), huella0, 'categoría y producto previos sin modificar');
    assert.equal((await pool.query('SELECT count(*)::int n FROM producto_ingrediente WHERE id_ingrediente=$1', [avena.id])).rows[0].n, 2, 'Avena reutilizada (Snacks y Cereales)');
    const yogurt = (await pool.query('SELECT descripcion FROM productos WHERE id_producto=$1', [ids[8]])).rows[0];
    assert.equal(yogurt.descripcion, 'Producto lácteo o vegetal con cultivos probióticos y frutas naturales.');
    assert.equal((await pool.query("SELECT count(*)::int n FROM productos WHERE id_producto=ANY($1::uuid[]) AND descripcion ~* 'inmunol|digesti|mejorar la salud|intolerantes'", [ids])).rows[0].n, 0);
    assert.equal((await verificarImportacion(pool, archivo)).integridadHistorica, 'OK');
  });

  await t.test('Idempotencia: segunda ejecución no crea nada ni duplica auditoría', async () => {
    const c = await conteo();
    const r = await cargarCatalogo(pool, { adminCorreo: admin.correo, confirmar: true });
    assert.equal(r.productosCreados, 0); assert.equal(r.productosYaCargados, 20); assert.deepEqual(r.categoriasCreadas, []);
    assert.deepEqual(await conteo(), c);
  });

  await t.test('Producto ya cargado pero modificado: aborta sin sobrescribir', async () => {
    await pool.query("UPDATE productos SET descripcion='editada' WHERE id_producto=$1", [ids[0]]);
    await assert.rejects(cargarCatalogo(pool, { adminCorreo: admin.correo, confirmar: true }), e => e.codigo === 'PRODUCTO_YA_CARGADO_DIFIERE');
    assert.equal((await pool.query('SELECT descripcion FROM productos WHERE id_producto=$1', [ids[0]])).rows[0].descripcion, 'editada');
    await pool.query('UPDATE productos SET descripcion=$2 WHERE id_producto=$1', [ids[0], plan.productos[0].descripcion]);
  });

  await t.test('API: inactivos no visibles para CLIENTE; ADMINISTRADOR los ve con imagen local válida', async () => {
    server = crearApp(sistema).listen(0, '127.0.0.1'); await new Promise(r => server.once('listening', r));
    const cliente = await sistema.registrar({ nombre: 'Cliente PDF', correo: 'cliente-pdf@example.test', password: 'Clave12345' });
    const api = async (url, token) => { const r = await fetch(`http://127.0.0.1:${server.address().port}/api${url}`, { headers: { Authorization: 'Bearer ' + token } }); return { status: r.status, data: await r.json() }; };
    const c = await api('/productos?limit=100', generarToken(cliente));
    assert.ok(!c.data.productos.some(p => ids.includes(p.id)));
    const a = await api('/productos?limit=100&estado=inactivo', generarToken(admin));
    const pdf = a.data.productos.filter(p => ids.includes(p.id));
    assert.equal(pdf.length, 20);
    assert.ok(pdf.every(p => p.precio === null && p.estado === false && p.disponibilidad === 'SIN_CONFIGURAR' && /^\/images\/productos\/[a-z0-9-]+\.webp$/.test(p.imagenUrl)));
    const { validarRutaImagen } = require('../src/security/imagenesProductos');
    for (const p of pdf) assert.equal(validarRutaImagen(p.imagenUrl, m => { throw new Error(m); }), p.imagenUrl);
    assert.deepEqual([...new Set(pdf.map(p => p.categoria))].sort(), [...CATEGORIAS].sort());
  });
});
