/* Historial propio; identidad resuelta exclusivamente por el backend. */
(() => {
  const $ = id => document.getElementById(id);
  const nodo = (tipo, texto) => { const n = document.createElement(tipo); n.textContent = texto; return n; };
  let usuario = null, version = 0, secuencia = 0, pagina = 1;
  async function cargarHistorialConsumo(page = 1) {
    if (usuario?.rol !== 'CLIENTE') return;
    const ses = version, seq = ++secuencia;
    pagina = page;
    $('consumoMsg').textContent = 'Cargando consumo…';
    try {
      const q = new URLSearchParams({ page, limit: 10, busqueda: $('consumoBusqueda').value });
      const d = await apiFetch('/historial-consumo?' + q);
      if (ses !== version || seq !== secuencia) return;
      const r = d.resumen;
      $('consumoResumen').textContent = `${r.totalComprasRealizadas} compras · ${r.totalUnidadesConsumidas} unidades · ${r.totalProductosDistintos} productos distintos · Categoría más consumida: ${r.categoriaMasConsumida || 'Sin consumo'}`;
      const lista = $('consumoList'); lista.replaceChildren();
      for (const h of d.historial) {
        const card = document.createElement('article'); card.className = 'admin-item';
        card.append(nodo('h2', h.producto), nodo('p', h.categoria),
          nodo('p', `${h.cantidadTotal} unidades · ${h.numeroCompras} compras`),
          nodo('p', 'Último pedido (fecha de creación): ' + (h.ultimaFecha ? new Date(h.ultimaFecha).toLocaleString('es-GT') : 'Sin fecha')),
          nodo('p', 'Precio promedio: ' + h.precioPromedioFormateado));
        lista.append(card);
      }
      if (!d.historial.length) lista.append(nodo('p', 'No hay consumo registrado para estos filtros. Solo se incluyen pedidos ENTREGADOS.'));
      $('consumoPage').textContent = `Página ${d.paginacion.page} de ${d.paginacion.pages}`;
      $('consumoPrev').disabled = page <= 1; $('consumoNext').disabled = page >= d.paginacion.pages;
      $('consumoMsg').textContent = '';
    } catch (err) {
      if (ses !== version || seq !== secuencia) return;
      $('consumoList').replaceChildren(); $('consumoResumen').textContent = ''; $('consumoMsg').textContent = err.message;
    }
  }
  $('consumoFilters').addEventListener('submit', e => { e.preventDefault(); cargarHistorialConsumo(1); });
  $('consumoPrev').addEventListener('click', () => cargarHistorialConsumo(Math.max(1, pagina - 1)));
  $('consumoNext').addEventListener('click', () => cargarHistorialConsumo(pagina + 1));
  window.NutriVidaConsumo = { cargarHistorialConsumo, sesion(u) {
    usuario = u; version++; secuencia++; pagina = 1;
    $('consumoList').replaceChildren(); $('consumoResumen').textContent = ''; $('consumoMsg').textContent = ''; $('consumoBusqueda').value = '';
  } };
})();
