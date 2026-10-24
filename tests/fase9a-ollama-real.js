// FASE 9A con Ollama REAL: el contexto que realmente sale hacia Ollama respeta los consentimientos y la lista blanca.
// Esquema temporal en DB_TEST_NAME, cliente y catálogo SINTÉTICOS. No escribe en nutrivida_db ni usa cuentas reales.
// Si Ollama no está disponible, los casos que lo requieren se reportan como OMITIDOS (nunca como aprobados).
//   node tests/fase9a-ollama-real.js
process.env.JWT_SECRET = 'fase9a-ollama-real'; process.env.ENCRYPTION_KEY = 'cd'.repeat(32);
const assert = require('node:assert/strict'), { randomUUID } = require('node:crypto');
const env = require('../src/config/env');
const { crearPool } = require('../src/database/pool'), { migrar } = require('../src/database/migraciones');
const { crearSistema } = require('../src/services/sistema'), { Administrador } = require('../src/domain/modelos');
const { ServicioIA, MEDICA } = require('../src/services/iaService'), { OllamaProvider } = require('../src/services/ollamaProvider');

(async () => {
  const id = randomUUID().replaceAll('-', ''), schema = 'nv_test_' + id, control = 'nv_test_control_' + id;
  const gestor = crearPool({ pruebas: true }), pool = crearPool({ pruebas: true, schema }), resultados = []; let creado = false;
  const registrar = (caso, estado, detalle = {}) => { resultados.push({ caso, estado, ...detalle }); console.log(`${estado === 'APROBADA' ? '✔' : estado === 'OMITIDA' ? '↷' : '✘'} ${caso}`); };
  try {
    await gestor.query(`CREATE SCHEMA ${schema}`); creado = true; await migrar(pool, { esquemaControl: control });
    const enviados = [];
    const real = new OllamaProvider({ timeoutMs: Math.max(env.ollamaTimeoutMs, 60000), transporte: async (url, opts) => { if (opts?.body) enviados.push(JSON.parse(opts.body)); return fetch(url, opts); } });
    const salud = await new OllamaProvider().comprobarSalud();
    const sistema = crearSistema({ pool, ia: new ServicioIA({ ollamaProvider: real }) });
    const admin = new Administrador({ nombre: 'Admin real 9A', correo: 'admin-real9a@example.test', passwordHash: 'hash-sintetico' });
    await sistema.repositorios.usuarios.guardar(admin);
    const cat = (await sistema.catalogoComercial.guardar(admin.id, 'categorias', null, { nombre: 'Bebidas' })).id;
    for (const nombre of ['Bebidas Funcionales sintéticas', 'Bebidas Saludables sintéticas']) {
      const p = await sistema.catalogoComercial.guardar(admin.id, 'productos', null, { nombre, categoriaId: cat, descripcion: 'Bebida sintética de prueba.', precio: '15.00', estado: true, stockMinimo: 1 });
      await sistema.inventario.registrar(admin.id, { productoId: p.id, tipo: 'AJUSTE', cantidad: 10, motivo: 'FASE 9A real' });
    }
    const cliente = await sistema.registrar({ nombre: 'Cliente real 9A', correo: 'cliente-real9a@example.test', password: 'Clave12345' });
    await sistema.perfil.actualizar(cliente.id, { condicionesMedicas: 'CONDICION_SINTETICA_9A', alergias: 'ALERGIA_SINTETICA_9A', objetivoNutricional: 'Más energía por la mañana' });
    if (!salud.disponible || !salud.tieneModeloConfigurado) {
      registrar('Ollama real', 'OMITIDA', { motivo: !salud.disponible ? `OLLAMA_NO_DISPONIBLE en ${env.ollamaBaseUrl}` : `modelo "${env.ollamaModel}" no instalado` });
    } else {
      for (const [perfil, historial] of [[false, false], [true, false], [false, true], [true, true]]) {
        await sistema.perfil.actualizarConsentimientos(cliente.id, { autorizaContextoIA: perfil, autorizaHistorialIA: historial });
        const n = enviados.length, inicio = Date.now();
        const r = await sistema.consultas.enviar(cliente.id, '¿Qué bebidas tienen disponibles?');
        const generar = enviados.slice(n).find(b => b.prompt), contexto = JSON.parse(generar.prompt), cuerpo = JSON.stringify(generar);
        assert.deepEqual(Object.keys(contexto).sort(), ['consulta', 'perfil', 'productos']);
        assert.doesNotMatch(cuerpo, /CONDICION_SINTETICA_9A|ALERGIA_SINTETICA_9A|cliente-real9a@example\.test|Cliente real 9A/);
        assert.ok(!cuerpo.includes(cliente.id), 'sin identificador del usuario');
        if (perfil) assert.deepEqual(contexto.perfil, { objetivoNutricional: 'Más energía por la mañana' }); else assert.equal(contexto.perfil, null);
        // Sin perfil autorizado: consulta específica con candidatos → al menos una tarjeta. Con perfil autorizado, las
        // alergias declaradas (solo uso en backend) hacen que el respaldo se abstenga: las tarjetas dependen del modelo.
        if (!perfil) assert.ok(r.productosRecomendados.length > 0, 'consulta específica con candidatos → al menos una tarjeta');
        registrar(`Consentimientos perfil=${perfil} historial=${historial}: contexto minimizado y tarjetas`, 'APROBADA',
          { ms: Date.now() - inicio, perfilEnviado: contexto.perfil ? Object.keys(contexto.perfil) : null, tarjetas: r.productosRecomendados.length });
      }
      const n = enviados.length, r = await sistema.consultas.enviar(cliente.id, '¿Qué medicamento debo tomar?');
      assert.equal(r.respuestaIA, MEDICA); assert.equal(enviados.length, n);
      registrar('Consulta médica con consentimiento: sin llamar a Ollama', 'APROBADA');
    }
    const apagado = crearSistema({ pool, ia: new ServicioIA({ ollamaProvider: new OllamaProvider({ baseUrl: 'http://127.0.0.1:9', model: env.ollamaModel || 'x', timeoutMs: 2000 }) }) });
    await assert.rejects(apagado.consultas.enviar(cliente.id, '¿Qué bebidas tienen disponibles?'), e => e.status === 503);
    registrar('Ollama apagado: error controlado 503', 'APROBADA');
  } catch (e) { registrar('Error inesperado', 'FALLIDA', { error: e.message }); }
  finally {
    await pool.end();
    try { if (creado) { await gestor.query(`DROP SCHEMA ${schema} CASCADE`); await gestor.query(`DROP SCHEMA IF EXISTS ${control} CASCADE`); } } finally { await gestor.end(); }
  }
  const resumen = { modelo: env.ollamaModel, aprobadas: resultados.filter(r => r.estado === 'APROBADA').length, omitidas: resultados.filter(r => r.estado === 'OMITIDA').length,
    fallidas: resultados.filter(r => r.estado === 'FALLIDA').length, datos: 'sintéticos en DB_TEST_NAME (esquema temporal)', resultados };
  console.log(JSON.stringify(resumen, null, 1));
  if (resumen.fallidas) process.exitCode = 1;
})();
