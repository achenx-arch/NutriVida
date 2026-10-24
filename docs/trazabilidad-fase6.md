# FASE 6 — Carrito y Pedidos

Estado: **COMPLETADA Y VERIFICADA**.  
Fecha: 2026-09-29.

---

## 1. Referencias y Trazabilidad

| Requerimiento | UML / PostgreSQL | Repository / Service | Route / Controller | UI | Pruebas |
| --- | --- | --- | --- | --- | --- |
| Carrito de compras | `pedidos`, `detalle_pedido` | Frontend `localStorage` | Backend valida en `POST /api/pedidos` | `public/carrito.js`, `#cartPanel` | `tests/fase6.test.js` |
| Precio histórico de PostgreSQL | `productos.precio`, `detalle_pedido.precio_unitario` | `RepositorioPedidos.crear` | `POST /api/pedidos` | Vista detalle de pedido | `tests/fase6.test.js` |
| Confirmación transaccional | `pedidos`, `inventario`, `movimientos_inventario` | `RepositorioPedidos.transicionarEstado` (lock determinista `FOR UPDATE`) | `PATCH /api/pedidos/:id/estado` | Vista "Mis pedidos" y "Gestión de Pedidos" | `tests/fase6.test.js` |
| Cancelación e Idempotencia | `pedidos`, `movimientos_inventario` | Reposición única mediante `ENTRADA` en `RepositorioPedidos` | `PATCH /api/pedidos/:id/estado` | Botón cancelar en UI | `tests/fase6.test.js` |
| Aislamiento por Cliente | `pedidos.id_cliente` | JWT `req.usuario.id` | Rutas `/api/pedidos` protegidas con auth | Menú por rol | `tests/fase6.test.js` |

---

## 2. Máquina de Estados de Pedido

```
  PENDIENTE ──────────► CONFIRMADO ──────────► EN_PREPARACION ──────────► LISTO ──────────► ENTREGADO
      │                    │                       │                      │
      ▼                    ▼                       ▼                      ▼
  CANCELADO            CANCELADO               CANCELADO              CANCELADO
(sin movimiento)    (repone stock 1x)       (repone stock 1x)      (repone stock 1x)
```

1. **PENDIENTE**: Estado inicial al crear el pedido. **NO descuenta stock**. Guarda `precio_unitario` extraído de PostgreSQL (`productos.precio`).
2. **CONFIRMADO**: Ocurre la validación de inventario y descuento atómico (`SALIDA` en `movimientos_inventario`). Si un producto carece de existencias, ocurre `ROLLBACK` total.
3. **EN_PREPARACION / LISTO / ENTREGADO**: Flujo operacional del pedido. Stock ya descontado.
4. **CANCELADO**:
   - Desde `PENDIENTE`: Se cancela sin movimientos de inventario.
   - Desde `CONFIRMADO`, `EN_PREPARACION` o `LISTO`: Se realiza una reposición de inventario (`ENTRADA`) **exactamente una vez**. La idempotencia en backend garantiza que una solicitud duplicada no altere inventario adicional.

---

## 3. Verificación de Resultados

- Migración `005_pedidos_indices.sql` aplicada a `nutrivida_db` y verificada en `nutrivida_test_db`.
- **118 pruebas aprobadas, 0 fallidas, 0 omitidas** (`npm test`).
- 13 pruebas específicas de FASE 6 aprobadas en `tests/fase6.test.js`.
- Concurrencia de confirmación: comprobada la serialización segura y la prevención de existencias negativas.

---

## 4. Verificación vigente (2026-10-01)

Corrección implementada y verificada durante la recuperación de FASES 6–8:

- Transición a `PENDIENTE` solicitada por EMPLEADO/ADMINISTRADOR: el control de roles la admite como solicitud
  y es la **máquina de estados** la que la rechaza con **409** (antes se respondía 403 por rol, ocultando la regla
  de negocio). `src/services/pedidosService.js`; prueba en `tests/fase6.test.js`.

Resultados actuales: `tests/fase6.test.js` 22/22; navegador FASES 6–8 11/11 en Windows con Edge y Ollama real
(`docs/evidencias/cierre-etapa-b/navegador-fase6-8.log`); `npm test` sin fallos.
