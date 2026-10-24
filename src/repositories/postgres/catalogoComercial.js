const {Base,iso}=require("./base");
const {randomUUID}=require("crypto");
const {ErrorAplicacion}=require("../../errors/ErrorAplicacion");
const error=(m,s=400)=>{throw new ErrorAplicacion(m,s);};
const simple=t=>{if(!["categorias","ingredientes"].includes(t))throw new Error("ENTIDAD_INVALIDA");return {tabla:t,id:t==="categorias"?"id_categoria":"id_ingrediente",singular:t==="categorias"?"CATEGORIA":"INGREDIENTE"};};
const literal=s=>s.replace(/[\\%_]/g,"\\$&");
const FROM=" FROM productos p JOIN categorias c USING(id_categoria) LEFT JOIN inventario inv USING(id_producto)";
const SELECT=`SELECT p.*,c.nombre AS categoria,c.estado AS categoria_activa,inv.cantidad AS existencia,
 COALESCE((SELECT jsonb_agg(jsonb_build_object('id',i.id_ingrediente::text,'nombre',i.nombre,'cantidadDescriptiva',pi.cantidad_descriptiva) ORDER BY i.nombre,i.id_ingrediente)
 FROM producto_ingrediente pi JOIN ingredientes i USING(id_ingrediente) WHERE pi.id_producto=p.id_producto),'[]'::jsonb) AS ingredientes`;
function producto(r,admin=false){if(!r)return null;const p={id:r.id_producto,nombre:r.nombre,categoriaId:String(r.id_categoria),categoria:r.categoria,categoriaActiva:r.categoria_activa,descripcion:r.descripcion,precio:r.precio,imagenUrl:r.imagen_url,estado:r.estado,ingredientes:r.ingredientes,valoresNutricionales:r.valores_nutricionales,stockMinimo:r.stock_minimo,fechaCreacion:iso(r.fecha_creacion),fechaActualizacion:iso(r.fecha_actualizacion),disponibilidad:require("./inventario").estado(r.existencia,r.stock_minimo)};if(admin)p.datosLegado=r.datos_legado;return p;}
function entidad(r,t){const {id}=simple(t);return {id:String(r[id]),nombre:r.nombre,descripcion:r.descripcion,...(t==="categorias"?{estado:r.estado,fechaCreacion:iso(r.fecha_creacion)}:{})};}
class RepositorioCatalogoComercial extends Base {
 async bloqueo(db){await db.query("SELECT pg_advisory_xact_lock(20660401)");}
 async evento(db,usuarioId,accion,tipo,id){await db.query("INSERT INTO auditoria(id_auditoria,id_usuario,accion,entidad,id_entidad,recurso_accedido,fecha) VALUES($1,$2,$3,$4,$5,$6,CURRENT_TIMESTAMP)",[randomUUID(),usuarioId,accion,tipo,String(id),`${tipo}/${id}`]);}
 async listarProductos(f,admin){const args=[],cond=[];const param=v=>{args.push(v);return '$'+args.length;};if(!admin)cond.push("p.estado=TRUE","c.estado=TRUE","p.precio>0");else if(f.estado&&f.estado!=="todos")cond.push(`p.estado=${param(f.estado==="activo")}`);
 if(f.nombre)cond.push(`p.nombre ILIKE ${param('%'+literal(f.nombre)+'%')}`);
 if(f.categoria)cond.push(`p.id_categoria=${param(f.categoria)}`);
 if(f.ingrediente)cond.push(`EXISTS(SELECT 1 FROM producto_ingrediente filtro WHERE filtro.id_producto=p.id_producto AND filtro.id_ingrediente=${param(f.ingrediente)})`);
 const where=cond.length?' WHERE '+cond.join(' AND '):'';const total=Number((await this.query('SELECT count(*) AS n'+FROM+where,args)).rows[0].n);const limit=param(f.limit),offset=param((f.page-1)*f.limit);
 const rows=(await this.query(SELECT+FROM+where+` ORDER BY lower(p.nombre),p.id_producto LIMIT ${limit} OFFSET ${offset}`,args)).rows;
 return {productos:rows.map(r=>producto(r,admin)),paginacion:{page:f.page,limit:f.limit,total,pages:Math.ceil(total/f.limit)}};
 }
 async detalle(id,admin){const r=(await this.query(SELECT+FROM+' WHERE p.id_producto=$1'+(admin?'':' AND p.estado=TRUE AND c.estado=TRUE AND p.precio>0'),[id])).rows[0];if(!r)error("Producto no encontrado.",404);return producto(r,admin);}
 async listarEntidades(t,f,admin){const {tabla,id}=simple(t),a=[],c=[];if(t==="categorias"){if(!admin)c.push('estado=TRUE');else if(f.estado&&f.estado!=="todos"){a.push(f.estado==="activo");c.push('estado=$'+a.length);}}
 if(f.nombre){a.push('%'+literal(f.nombre)+'%');c.push('nombre ILIKE $'+a.length);}const w=c.length?' WHERE '+c.join(' AND '):'';const total=Number((await this.query(`SELECT count(*) AS n FROM ${tabla}`+w,a)).rows[0].n);a.push(f.limit,(f.page-1)*f.limit);const rows=(await this.query(`SELECT * FROM ${tabla}${w} ORDER BY lower(nombre),${id} LIMIT $${a.length-1} OFFSET $${a.length}`,a)).rows;
 return {[t]:rows.map(r=>entidad(r,t)),paginacion:{page:f.page,limit:f.limit,total,pages:Math.ceil(total/f.limit)}};
 }
 async guardarEntidad(t,id,datos,usuarioId){const x=simple(t);return this.tx(async db=>{await this.bloqueo(db);let anterior={};if(id){anterior=(await db.query(`SELECT * FROM ${x.tabla} WHERE ${x.id}=$1 FOR UPDATE`,[id])).rows[0];if(!anterior)error("Registro no encontrado.",404);}
 const r={...anterior,...datos};if(t==="categorias"&&r.estado===false&&(await db.query('SELECT 1 FROM productos WHERE id_categoria=$1 AND estado=TRUE LIMIT 1',[id])).rowCount)error("Desactiva primero los productos activos de esta categoría.",409);
 let guardado;if(!id){guardado=(await db.query(t==="categorias"?'INSERT INTO categorias(nombre,descripcion,estado,fecha_creacion) VALUES($1,$2,$3,CURRENT_TIMESTAMP) RETURNING *':'INSERT INTO ingredientes(nombre,descripcion) VALUES($1,$2) RETURNING *',t==="categorias"?[r.nombre,r.descripcion??null,r.estado??true]:[r.nombre,r.descripcion??null])).rows[0];}
 else{guardado=(await db.query(`UPDATE ${x.tabla} SET nombre=$2,descripcion=$3${t==="categorias"?',estado=$4':''} WHERE ${x.id}=$1 RETURNING *`,t==="categorias"?[id,r.nombre,r.descripcion,r.estado]:[id,r.nombre,r.descripcion])).rows[0];}
 const accion=!id?'CREAR_':t==="categorias"&&datos.estado===false&&anterior.estado!==false?'DESACTIVAR_':'ACTUALIZAR_';await this.evento(db,usuarioId,accion+x.singular,t,guardado[x.id]);return entidad(guardado,t);
 });}
 async guardarProducto(id,d,usuarioId){return this.tx(async db=>{await this.bloqueo(db);let anterior=null;if(id){anterior=(await db.query(SELECT+FROM+' WHERE p.id_producto=$1 FOR UPDATE OF p',[id])).rows[0];if(!anterior)error("Producto no encontrado.",404);}
 const previo=anterior?producto(anterior,true):{};const v={estado:false,precio:null,descripcion:null,imagenUrl:null,stockMinimo:null,valoresNutricionales:null,...previo,...d};id ||= randomUUID();
 const cat=(await db.query('SELECT estado FROM categorias WHERE id_categoria=$1 FOR SHARE',[v.categoriaId])).rows[0];if(!cat)error("La categoría no existe.");if(v.estado&&(!cat.estado||!v.precio||Number(v.precio)<=0))error("Para activar, selecciona una categoría activa y un precio mayor que cero.");
 if(d.ingredientes!==undefined){const ids=d.ingredientes.map(i=>i.id);const encontrados=await db.query('SELECT id_ingrediente FROM ingredientes WHERE id_ingrediente=ANY($1::bigint[]) FOR SHARE',[ids]);if(encontrados.rowCount!==ids.length)error("Uno o más ingredientes no existen.");}
 if(anterior)await db.query('UPDATE productos SET id_categoria=$2,nombre=$3,descripcion=$4,precio=$5,imagen_url=$6,estado=$7,valores_nutricionales=$8,stock_minimo=$9,fecha_actualizacion=CURRENT_TIMESTAMP WHERE id_producto=$1',[id,v.categoriaId,v.nombre,v.descripcion,v.precio,v.imagenUrl,v.estado,v.valoresNutricionales,v.stockMinimo]);
 else await db.query('INSERT INTO productos(id_producto,id_categoria,nombre,descripcion,precio,imagen_url,estado,valores_nutricionales,stock_minimo,fecha_creacion,fecha_actualizacion) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,CURRENT_TIMESTAMP,CURRENT_TIMESTAMP)',[id,v.categoriaId,v.nombre,v.descripcion,v.precio,v.imagenUrl,v.estado,v.valoresNutricionales,v.stockMinimo]);
 if(d.ingredientes!==undefined){await db.query('DELETE FROM producto_ingrediente WHERE id_producto=$1',[id]);for(const i of d.ingredientes)await db.query('INSERT INTO producto_ingrediente(id_producto,id_ingrediente,cantidad_descriptiva) VALUES($1,$2,$3)',[id,i.id,i.cantidadDescriptiva]);await this.evento(db,usuarioId,'ASOCIAR_INGREDIENTE_PRODUCTO','productos',id);}
 await this.evento(db,usuarioId,!anterior?'CREAR_PRODUCTO':d.estado===false&&anterior.estado!==false?'DESACTIVAR_PRODUCTO':'ACTUALIZAR_PRODUCTO','productos',id);
 return producto((await db.query(SELECT+FROM+' WHERE p.id_producto=$1',[id])).rows[0],true);
 });}
}
module.exports={RepositorioCatalogoComercial};
