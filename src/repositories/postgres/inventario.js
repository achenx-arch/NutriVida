const {Base,iso}=require('./base');
const {randomUUID}=require('crypto');
const {ErrorAplicacion}=require('../../errors/ErrorAplicacion');
const fallo=(m,s=409)=>{throw new ErrorAplicacion(m,s);};
const estado=(n,min)=>n==null?'SIN_CONFIGURAR':n===0?'SIN_EXISTENCIA':min!=null&&n<=min?'BAJO_STOCK':'CON_EXISTENCIA';
const comercial=p=>p.estado&&p.categoria_activa&&Number(p.precio)>0&&p.nombre.trim().length>=2;
const movimientosPermitidos=(p,n)=>comercial(p)?n==null?['AJUSTE']:['ENTRADA','SALIDA','AJUSTE']:n==null?[]:['AJUSTE'];
const dto=r=>({id:String(r.id_movimiento),productoId:r.id_producto,producto:r.producto,usuarioId:r.id_usuario,responsable:r.responsable,tipo:r.tipo,cantidad:r.cantidad,existenciaAnterior:r.existencia_anterior,existenciaNueva:r.existencia_nueva,motivo:r.motivo,fecha:iso(r.fecha)});
class RepositorioInventario extends Base {
 async listar(f){
  return this.tx(async db=>{
   await db.query('SET TRANSACTION ISOLATION LEVEL REPEATABLE READ, READ ONLY');
   const args=[],where=f.nombre?(args.push('%'+f.nombre.replace(/[\\%_]/g,'\\$&')+'%'),' WHERE p.nombre ILIKE $1'):'';
   const from=' FROM productos p JOIN categorias c USING(id_categoria) LEFT JOIN inventario i USING(id_producto)';
   const total=Number((await db.query('SELECT count(*) n'+from+where,args)).rows[0].n);
   args.push(f.limit,(f.page-1)*f.limit);
   const rows=(await db.query('SELECT p.id_producto,p.nombre,p.estado,p.precio,p.stock_minimo,c.estado categoria_activa,i.cantidad,i.fecha_actualizacion'+from+where+` ORDER BY lower(p.nombre),p.id_producto LIMIT $${args.length-1} OFFSET $${args.length}`,args)).rows;
   return {inventario:rows.map(p=>({productoId:p.id_producto,producto:p.nombre,activo:p.estado,existencia:p.cantidad,stockMinimo:p.stock_minimo,estado:estado(p.cantidad,p.stock_minimo),movimientosPermitidos:movimientosPermitidos(p,p.cantidad),fechaActualizacion:iso(p.fecha_actualizacion)})),paginacion:{page:f.page,limit:f.limit,total,pages:Math.ceil(total/f.limit)}};
  });
 }
 async historial(f){
  return this.tx(async db=>{
   await db.query('SET TRANSACTION ISOLATION LEVEL REPEATABLE READ, READ ONLY');
   const args=[],conds=[],add=(sql,v)=>{args.push(v);conds.push(sql.replace('?',`$${args.length}`));};
   if(f.producto)add('m.id_producto=?',f.producto);if(f.usuario)add('m.id_usuario=?',f.usuario);if(f.tipo)add('m.tipo=?',f.tipo);
   // Fechas de calendario de Guatemala, límite superior exclusivo.
   if(f.desde)add("m.fecha >= (?::date::timestamp AT TIME ZONE 'America/Guatemala')",f.desde);
   if(f.hasta)add("m.fecha < ((?::date+1)::timestamp AT TIME ZONE 'America/Guatemala')",f.hasta);
   const where=conds.length?' WHERE '+conds.join(' AND '):'',from=' FROM movimientos_inventario m JOIN productos p USING(id_producto) JOIN usuarios u USING(id_usuario)';
   const total=Number((await db.query('SELECT count(*) n'+from+where,args)).rows[0].n);
   args.push(f.limit,(f.page-1)*f.limit);
   const rows=(await db.query('SELECT m.*,p.nombre producto,u.nombre responsable'+from+where+` ORDER BY m.fecha DESC,m.id_movimiento DESC LIMIT $${args.length-1} OFFSET $${args.length}`,args)).rows;
   return {movimientos:rows.map(dto),paginacion:{page:f.page,limit:f.limit,total,pages:Math.ceil(total/f.limit)}};
  });
 }
 async registrar(usuarioId,d,{db:txDb=null,omitePermisos=false,compensacionPedido=null}={}){
  return this.tx(async db=>{
   await db.query('SELECT pg_advisory_xact_lock(20660401)');
   const u=(await db.query('SELECT u.estado,u.nombre,r.nombre rol FROM usuarios u JOIN roles r USING(id_rol) WHERE id_usuario=$1 FOR SHARE OF u',[usuarioId])).rows[0];
   if(!u?.estado)fallo('Usuario no encontrado o inactivo.',401);
   if(!omitePermisos && !['EMPLEADO','ADMINISTRADOR'].includes(u.rol))fallo('No tienes permisos para esta acción.',403);
   const p=(await db.query('SELECT p.*,c.estado categoria_activa FROM productos p JOIN categorias c USING(id_categoria) WHERE id_producto=$1 FOR UPDATE OF p',[d.productoId])).rows[0];
   if(!p)fallo('Producto no encontrado.',404);
   const inv=(await db.query('SELECT * FROM inventario WHERE id_producto=$1 FOR UPDATE',[d.productoId])).rows[0];
   const anterior=inv?.cantidad??null;
   let compensacion=false;
   if(compensacionPedido){
    if(!txDb || !omitePermisos || d.tipo!=='ENTRADA' || !inv)fallo('Compensación no válida.');
    const historico=(await db.query(`SELECT d.cantidad FROM pedidos ped JOIN detalle_pedido d USING(id_pedido)
     WHERE ped.id_pedido=$1 AND d.id_detalle=$2 AND d.id_producto=$3
       AND ped.estado IN ('CONFIRMADO','EN_PREPARACION','LISTO') FOR UPDATE OF ped`,
     [compensacionPedido.pedidoId,compensacionPedido.detalleId,d.productoId])).rows[0];
    if(!historico || historico.cantidad!==d.cantidad)fallo('Compensación no válida.');
    compensacion=true;
   }
   if(!compensacion && !movimientosPermitidos(p,anterior).includes(d.tipo))fallo(anterior===null?'Completa y activa el producto; configura primero mediante AJUSTE.':'El producto inactivo solo permite AJUSTE justificado.');
   const nueva=d.tipo==='AJUSTE'?d.cantidad:d.tipo==='ENTRADA'?anterior+d.cantidad:anterior-d.cantidad;
   if(nueva<0)fallo('La salida supera la existencia disponible.');
   if(nueva>2147483647)fallo('La existencia supera el límite permitido.');
   if(anterior===nueva)fallo('El ajuste debe modificar la existencia actual.');
   if(inv)await db.query('UPDATE inventario SET cantidad=$2,fecha_actualizacion=clock_timestamp() WHERE id_producto=$1',[d.productoId,nueva]);
   else await db.query('INSERT INTO inventario(id_producto,cantidad,fecha_actualizacion) VALUES($1,$2,clock_timestamp())',[d.productoId,nueva]);
   const r=(await db.query('INSERT INTO movimientos_inventario(id_producto,id_usuario,tipo,cantidad,existencia_anterior,existencia_nueva,motivo,fecha) VALUES($1,$2,$3,$4,$5,$6,$7,clock_timestamp()) RETURNING *',[d.productoId,usuarioId,d.tipo,d.cantidad,anterior,nueva,d.motivo])).rows[0];
   const evento=async accion=>db.query('INSERT INTO auditoria(id_auditoria,id_usuario,accion,entidad,id_entidad,datos_anteriores,datos_nuevos,fecha) VALUES($1,$2,$3,$4,$5,$6,$7,clock_timestamp())',[randomUUID(),usuarioId,accion,'inventario',d.productoId,{existencia:anterior},{existencia:nueva,movimientoId:String(r.id_movimiento)}]);
   if(!inv)await evento('CONFIGURAR_INVENTARIO');
   await evento(d.tipo+'_INVENTARIO');
   return dto({...r,producto:p.nombre,responsable:u.nombre});
  },txDb);
 }
}
module.exports={RepositorioInventario,estado};
