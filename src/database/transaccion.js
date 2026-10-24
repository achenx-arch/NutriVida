async function transaccion(pool, operacion, dbExistente = null) {
  if (dbExistente) return operacion(dbExistente);
  const cliente = await pool.connect();
  let descartar = false;
  try {
    await cliente.query("BEGIN");
    const resultado = await operacion(cliente);
    await cliente.query("COMMIT");
    return resultado;
  } catch (err) {
    try { await cliente.query("ROLLBACK"); } catch { descartar = true; }
    throw err;
  } finally { cliente.release(descartar); }
}
module.exports = { transaccion };

