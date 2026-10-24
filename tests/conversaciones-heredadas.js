// Comprobación de SOLO LECTURA de las 4 conversaciones heredadas tras "Marcar como revisada".
// Usa el verificador oficial (transacción READ ONLY) y exige, para cada una, exactamente
// revisada + fecha_actualizacion clasificadas como CAMBIO_POSTERIOR_AUDITADO por revision_consulta.
// No imprime contenido de conversaciones ni mensajes.   node tests/conversaciones-heredadas.js
const { origen } = require('../database/scripts/comun');
const { crearPool } = require('../src/database/pool');
const { verificarImportacion } = require('../src/database/importacion');
const IDS = ['13df080b', '3eeace7a', 'dcac7a1e', '0cc22223'];
(async () => {
  const pool = crearPool(); let salida;
  try {
    const r = await verificarImportacion(pool, origen());
    const conv = r.cambiosPosteriores.filter(c => c.tabla === 'conversaciones_ia');
    const detalle = IDS.map(p => {
      const c = conv.filter(x => x.id.startsWith(p));
      const campos = c.map(x => x.campo).sort().join(',');
      const ok = campos === 'fecha_actualizacion,revisada' && c.every(x => x.clasificacion === 'CAMBIO_POSTERIOR_AUDITADO' && x.evidencia?.accion === 'revision_consulta');
      return { id: p, campos, evidencia: c[0]?.evidencia || null, resultado: ok ? 'OK' : 'FALLÓ' };
    });
    const otras = conv.filter(x => !IDS.some(p => x.id.startsWith(p))).map(x => x.id.slice(0, 8));
    salida = { integridadHistorica: r.integridadHistorica, conversacionesHeredadas: detalle, otrasConversacionesConCambios: otras,
      resultado: r.integridadHistorica === 'OK' && detalle.every(d => d.resultado === 'OK') && !otras.length ? 'OK' : 'FALLÓ' };
  } catch (e) {
    salida = { resultado: 'FALLÓ', codigo: e.codigo || e.message, conflictos: (e.conflictos || []).map(c => ({ ...c, id: String(c.id).slice(0, 8) })) };
  } finally { await pool.end(); }
  console.log(JSON.stringify(salida, null, 1));
  if (salida.resultado !== 'OK') process.exitCode = 1;
})();
