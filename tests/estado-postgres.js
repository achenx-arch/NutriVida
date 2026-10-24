// Reporte de SOLO LECTURA del estado PostgreSQL (desarrollo y pruebas). No modifica datos.
const { crearPool } = require('../src/database/pool');
const consultar = async (cli, sql, args = []) => { try { return (await cli.query(sql, args)).rows; } catch (e) { return [{ error: e.code || e.message }]; } };
(async () => {
  const salida = {};
  for (const [nombre, pruebas] of [['desarrollo', false], ['pruebas', true]]) {
    const raiz = crearPool({ pruebas }); let pool;
    try {
      pool = await raiz.connect();
      await pool.query('SET default_transaction_read_only = on'); // sesión de solo lectura
      const r = {};
      r.base = (await consultar(pool, 'SELECT current_database() db'))[0]?.db;
      r.migraciones = (await consultar(pool, "SELECT version FROM infra.schema_migrations ORDER BY version")).map(x => x.version || x.error);
      r.tablasPublic = Number((await consultar(pool, "SELECT count(*) n FROM information_schema.tables WHERE table_schema='public'"))[0]?.n);
      r.esquemasTemporalesNvTest = Number((await consultar(pool, "SELECT count(*) n FROM information_schema.schemata WHERE schema_name LIKE 'nv\\_test\\_%'"))[0]?.n);
      if (!pruebas) {
        r.conversacionesIA = (await consultar(pool, 'SELECT count(*)::int n FROM conversaciones_ia'))[0];
        // Inventario de conversaciones sin contenido (cifrado): origen, estado y mensajes por tipo.
        r.conversacionesDetalle = await consultar(pool, `SELECT left(c.id_conversacion::text,8) id, c.fecha_inicio, c.estado,
          (c.datos_legado IS NOT NULL) heredada, (c.id_interaccion_origen IS NOT NULL) con_interaccion_origen,
          count(m.*) FILTER (WHERE m.tipo='USUARIO')::int usuario, count(m.*) FILTER (WHERE m.tipo='ASISTENTE')::int asistente,
          count(m.*) FILTER (WHERE m.tipo='SISTEMA')::int sistema
          FROM conversaciones_ia c LEFT JOIN mensajes_ia m USING(id_conversacion)
          GROUP BY c.id_conversacion ORDER BY c.fecha_inicio, c.id_conversacion`);
        r.mensajesIA = (await consultar(pool, "SELECT tipo, count(*)::int n FROM mensajes_ia GROUP BY tipo ORDER BY tipo"));
        r.productos = (await consultar(pool, 'SELECT count(*)::int total, count(*) FILTER (WHERE estado)::int activos, count(*) FILTER (WHERE precio IS NULL)::int sin_precio FROM productos'))[0];
        r.inventarios = (await consultar(pool, 'SELECT count(*)::int n FROM inventario'))[0];
        r.pedidos = (await consultar(pool, 'SELECT estado, count(*)::int n FROM pedidos GROUP BY estado ORDER BY estado'));
        r.vistaHistorial = (await consultar(pool, "SELECT count(*)::int n FROM information_schema.views WHERE table_name='v_historial_consumo'"))[0];
        r.tablaHistorialConsumo = (await consultar(pool, "SELECT count(*)::int n FROM information_schema.tables WHERE table_name='historial_consumo' AND table_type='BASE TABLE'"))[0];
        r.roles = (await consultar(pool, 'SELECT r.nombre, count(u.*)::int n FROM roles r LEFT JOIN usuarios u USING(id_rol) GROUP BY r.nombre ORDER BY r.nombre'));
      }
      salida[nombre] = r;
    } catch (e) { salida[nombre] = { error: e.codigo || e.code || e.message }; }
    finally { pool?.release(); await raiz.end(); }
  }
  console.log(JSON.stringify(salida, null, 2));
})();
