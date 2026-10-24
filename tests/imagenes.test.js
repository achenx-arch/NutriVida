// Imágenes de productos: rutas locales seguras, endpoint de solo lectura (RBAC) y API de productos.
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs'), os = require('node:os'), path = require('node:path');
const { randomUUID } = require('node:crypto');
const DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'nv-imagenes-'));
process.env.IMAGENES_PRODUCTOS_DIR = DIR; // antes de cargar la configuración
process.env.JWT_SECRET = 'imagenes-sintetico';
process.env.ENCRYPTION_KEY = 'cd'.repeat(32);
const { validarRutaImagen, listarImagenes } = require('../src/security/imagenesProductos');
const { ficha } = require('../src/security/catalogoValidacion');

// Fixtures: archivos válidos y maliciosos dentro y fuera del directorio.
const webp = Buffer.from('RIFF\x24\x00\x00\x00WEBPVP8 ', 'binary');
fs.writeFileSync(path.join(DIR, 'granola-natural.webp'), webp);
fs.writeFileSync(path.join(DIR, 'barra-2.png'), webp);
fs.writeFileSync(path.join(DIR, 'malicioso.svg'), '<svg onload="alert(1)"/>');
fs.writeFileSync(path.join(DIR, 'script.php.webp'), webp);
fs.writeFileSync(path.join(DIR, 'Mayusculas.webp'), webp);
fs.writeFileSync(path.join(DIR, 'vacio.webp'), '');
fs.writeFileSync(path.join(DIR, 'enorme.webp'), Buffer.alloc(2 * 1024 * 1024 + 1));
fs.mkdirSync(path.join(DIR, 'carpeta.webp'));
const fuera = fs.mkdtempSync(path.join(os.tmpdir(), 'nv-fuera-'));
fs.writeFileSync(path.join(fuera, 'secreto.webp'), webp);
let symlink = true;
try { fs.symlinkSync(path.join(fuera, 'secreto.webp'), path.join(DIR, 'enlace.webp')); } catch { symlink = false; }
process.on('exit', () => { fs.rmSync(DIR, { recursive: true, force: true }); fs.rmSync(fuera, { recursive: true, force: true }); });
const fallo = m => { throw Object.assign(new Error(m), { status: 400 }); };

test('Rutas válidas: solo /images/productos/<slug>.webp|png|jpg existentes', () => {
  assert.equal(validarRutaImagen('/images/productos/granola-natural.webp', fallo), '/images/productos/granola-natural.webp');
  assert.equal(validarRutaImagen('/images/productos/barra-2.png', fallo), '/images/productos/barra-2.png');
  assert.equal(validarRutaImagen(null, fallo), null);
  assert.equal(validarRutaImagen('', fallo), null);
  assert.equal(ficha('productos', { imagenUrl: '/images/productos/granola-natural.webp' }).imagenUrl, '/images/productos/granola-natural.webp');
  assert.equal(ficha('productos', { imagenUrl: null }).imagenUrl, null);
});

test('Path traversal, esquemas inseguros y codificaciones se rechazan', () => {
  for (const v of ['/images/productos/../producto.svg', '/images/productos/../../.env', '/images/productos/..%2f..%2f.env',
    '/images/productos/%2e%2e/x.webp', '/images/productos\\..\\x.webp', '/images/productos//granola-natural.webp',
    '/images/productos/./granola-natural.webp', 'images/productos/granola-natural.webp', '/images/granola-natural.webp',
    '/IMAGES/productos/granola-natural.webp', '/images/productos/granola-natural.webp?x=1', '/images/productos/granola-natural.webp#a',
    '/images/productos/granola-natural.webp\u0000.png', 'https://example.test/a.webp', 'http://example.test/a.webp',
    '//example.test/a.webp', 'javascript:alert(1)', 'data:image/webp;base64,AAAA', 'file:///etc/passwd',
    ' /images/productos/granola-natural.webp', '/images/productos/' + 'a'.repeat(120) + '.webp', 42, {}, [], true])
    assert.throws(() => validarRutaImagen(v, fallo), e => e.status === 400, String(v));
});

test('Extensiones: sin SVG, ejecutables, dobles extensiones, mayúsculas, vacíos, enormes ni directorios', () => {
  for (const n of ['malicioso.svg', 'script.php.webp', 'Mayusculas.webp', 'vacio.webp', 'enorme.webp', 'carpeta.webp',
    'x.exe', 'x.html', 'x.js', 'x.webp.exe', 'x.gif', 'no-existe.webp', 'granola-natural.WEBP', '-inicio.webp', 'doble--guion.webp'])
    assert.throws(() => validarRutaImagen('/images/productos/' + n, fallo), e => e.status === 400, n);
  if (symlink) assert.throws(() => validarRutaImagen('/images/productos/enlace.webp', fallo), e => e.status === 400, 'enlace simbólico');
});

test('Listado de solo lectura: únicamente archivos válidos, sin rutas del sistema', () => {
  const lista = listarImagenes();
  assert.deepEqual(lista.map(i => i.nombre), ['barra-2.png', 'granola-natural.webp']);
  assert.ok(lista.every(i => i.url === '/images/productos/' + i.nombre && Number.isInteger(i.bytes)));
  assert.doesNotMatch(JSON.stringify(lista), new RegExp(DIR.replace(/[\\/]/g, '.')));
});

test('Frontend: tarjetas con textContent, fallback y selector sin HTML dinámico; CSP sin imágenes externas', () => {
  const pub = f => fs.readFileSync(path.join(__dirname, '../public', f), 'utf8');
  const catalogo = pub('catalogo.js'), html = pub('index.html'), css = pub('styles.css');
  assert.ok(!/innerHTML\s*=/.test(catalogo));
  assert.match(catalogo, /img\.src=p\.imagenUrl\|\|"\/images\/producto\.svg"/);
  assert.match(catalogo, /addEventListener\("error",\(\)=>\{img\.src="\/images\/producto\.svg";\}/);
  assert.match(catalogo, /e\("p",p\.descripcion,"product-desc"\)/);
  assert.match(html, /<select id="comercialImagen">/);
  assert.doesNotMatch(html, /URL HTTPS/);
  assert.match(css, /\.product-desc \{[^}]*-webkit-line-clamp:3/);
  assert.ok(fs.existsSync(path.join(__dirname, '../public/images/producto.svg')), 'fallback interno existente');
  const { crearSeguridadHttp } = require('../src/middleware/seguridadHttp');
  assert.ok(crearSeguridadHttp);
  assert.match(fs.readFileSync(path.join(__dirname, '../src/middleware/seguridadHttp.js'), 'utf8'), /"img-src":\["'self'"\]/);
});

test('API PostgreSQL: RBAC del endpoint y producto con imagen local', async t => {
  const { crearPool } = require('../src/database/pool');
  const { migrar } = require('../src/database/migraciones');
  const { crearSistema } = require('../src/services/sistema');
  const { crearApp } = require('../src/app');
  const { Administrador, Empleado } = require('../src/domain/modelos');
  const { generarToken } = require('../src/security/auth');
  const id = randomUUID().replaceAll('-', ''), schema = 'nv_test_' + id, control = 'nv_test_control_' + id;
  const gestor = crearPool({ pruebas: true }); await gestor.query(`CREATE SCHEMA ${schema}`);
  const pool = crearPool({ pruebas: true, schema }); let server;
  t.after(async () => { if (server) await new Promise(r => server.close(r)); await pool.end();
    try { await gestor.query(`DROP SCHEMA ${schema} CASCADE`); await gestor.query(`DROP SCHEMA IF EXISTS ${control} CASCADE`); } finally { await gestor.end(); } });
  await migrar(pool, { esquemaControl: control });
  const sistema = crearSistema({ pool });
  const admin = new Administrador({ nombre: 'Admin img', correo: 'admin-img@example.test', passwordHash: 'h' });
  const empleado = new Empleado({ nombre: 'Empleado img', correo: 'empleado-img@example.test', passwordHash: 'h' });
  await sistema.repositorios.usuarios.guardar(admin); await sistema.repositorios.usuarios.guardar(empleado);
  const cliente = await sistema.registrar({ nombre: 'Cliente img', correo: 'cliente-img@example.test', password: 'Clave12345' });
  server = crearApp(sistema).listen(0, '127.0.0.1'); await new Promise(r => server.once('listening', r));
  const api = async (method, url, body, token) => {
    const r = await fetch(`http://127.0.0.1:${server.address().port}/api${url}`, { method,
      headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: 'Bearer ' + token } : {}) }, body: body === undefined ? undefined : JSON.stringify(body) });
    return { status: r.status, data: await r.json().catch(() => null), csp: r.headers.get('content-security-policy') };
  };
  const ta = generarToken(admin), te = generarToken(empleado), tc = generarToken(cliente);

  await t.test('RBAC: sin sesión 401, CLIENTE y EMPLEADO 403, ADMINISTRADOR 200', async () => {
    assert.equal((await api('GET', '/productos/imagenes')).status, 401);
    assert.equal((await api('GET', '/productos/imagenes', undefined, tc)).status, 403);
    assert.equal((await api('GET', '/productos/imagenes', undefined, te)).status, 403);
    const r = await api('GET', '/productos/imagenes', undefined, ta);
    assert.equal(r.status, 200);
    assert.deepEqual(r.data.imagenes.map(i => i.url), ['/images/productos/barra-2.png', '/images/productos/granola-natural.webp']);
    assert.equal((await api('GET', '/productos/imagenes?ruta=../', undefined, ta)).status, 400);
    assert.match(r.csp, /img-src 'self'(;|$)/);
  });

  let producto;
  await t.test('Crear y editar producto con imagen local; quitarla; rechazos sin efectos', async () => {
    const cat = (await api('POST', '/categorias', { nombre: 'Snacks img' }, ta)).data.categoria;
    const r = await api('POST', '/productos', { nombre: 'Granola natural', categoriaId: cat.id, imagenUrl: '/images/productos/granola-natural.webp' }, ta);
    assert.equal(r.status, 201); producto = r.data.producto;
    assert.equal(producto.imagenUrl, '/images/productos/granola-natural.webp');
    assert.equal((await pool.query('SELECT imagen_url FROM productos WHERE id_producto=$1', [producto.id])).rows[0].imagen_url, '/images/productos/granola-natural.webp');
    for (const imagenUrl of ['https://example.test/a.webp', '/images/productos/malicioso.svg', '/images/productos/../producto.svg', '/images/productos/no-existe.webp'])
      assert.equal((await api('PUT', `/productos/${producto.id}`, { imagenUrl }, ta)).status, 400, imagenUrl);
    assert.equal((await pool.query('SELECT imagen_url FROM productos WHERE id_producto=$1', [producto.id])).rows[0].imagen_url, '/images/productos/granola-natural.webp');
    assert.equal((await api('PUT', `/productos/${producto.id}`, { imagenUrl: '/images/productos/barra-2.png' }, ta)).data.producto.imagenUrl, '/images/productos/barra-2.png');
    assert.equal((await api('PUT', `/productos/${producto.id}`, { imagenUrl: null }, ta)).data.producto.imagenUrl, null);
    assert.equal((await api('PUT', `/productos/${producto.id}`, { imagenUrl: '/images/productos/granola-natural.webp' }, te)).status, 403);
    assert.ok((await pool.query("SELECT count(*)::int n FROM auditoria WHERE entidad='productos' AND id_entidad=$1", [producto.id])).rows[0].n >= 3);
    assert.doesNotMatch(JSON.stringify((await pool.query('SELECT * FROM productos WHERE id_producto=$1', [producto.id])).rows[0]), /base64|RIFF/);
  });

  await t.test('XSS: nombre/descripcion con HTML se guardan como texto plano y la imagen sigue siendo ruta validada', async () => {
    const cat = (await api('POST', '/categorias', { nombre: 'Cat xss' }, ta)).data.categoria;
    const r = await api('POST', '/productos', { nombre: '<img src=x onerror=alert(1)>', descripcion: '<script>alert(2)</script>', categoriaId: cat.id, imagenUrl: '/images/productos/granola-natural.webp' }, ta);
    assert.equal(r.status, 201);
    assert.equal(r.data.producto.imagenUrl, '/images/productos/granola-natural.webp');
    assert.equal((await api('POST', '/productos', { nombre: 'X', categoriaId: cat.id, imagenUrl: 'javascript:alert(1)' }, ta)).status, 400);
  });
});

test('Manifiesto ETAPA B: 20 productos, solo datos documentados, nombres seguros y SHA-256 verificable', () => {
  const { createHash } = require('node:crypto');
  const base = path.join(__dirname, '../docs/fuentes/catalogo-pdf');
  const m = JSON.parse(fs.readFileSync(path.join(base, 'manifiesto-productos.json'), 'utf8'));
  assert.equal(m.productos.length, 20);
  assert.deepEqual(m.productos.map(p => p.numero), Array.from({ length: 20 }, (_, i) => i + 1));
  const RUTA = /^\/images\/productos\/[a-z0-9]+(?:-[a-z0-9]+)*\.webp$/;
  for (const p of m.productos) {
    assert.ok(p.nombre && p.descripcion && p.ingredientes.length > 0, p.nombre);
    assert.deepEqual(p.noDocumentado, { precio: null, stock: null, stockMinimo: null, valoresNutricionales: null, categoria: null });
    assert.ok(p.ingredientes.every(i => i.cantidadDescriptiva === null && i.nombre.length <= 100));
    for (const img of [p.imagen, ...p.imagen.alternativas]) {
      assert.match(img.rutaPropuesta, RUTA);
      assert.ok(img.anchoPx <= 800);
      const bytes = fs.readFileSync(path.join(base, 'imagenes', img.archivoPropuesto));
      assert.equal(createHash('sha256').update(bytes).digest('hex'), img.sha256, img.archivoPropuesto);
      assert.equal(bytes.subarray(8, 12).toString(), 'WEBP');
    }
  }
  assert.equal(new Set(m.productos.map(p => p.imagen.archivoPropuesto)).size, 20);
});
