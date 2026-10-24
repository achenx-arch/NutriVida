const {Base}=require("./base");
const {Producto}=require("../../domain/modelos");
const {ErrorAplicacion}=require("../../errors/ErrorAplicacion");
const SELECT=`SELECT p.*,c.nombre AS categoria,
 COALESCE((SELECT string_agg(i.nombre, ', ' ORDER BY i.id_ingrediente) FROM producto_ingrediente pi JOIN ingredientes i USING(id_ingrediente) WHERE pi.id_producto=p.id_producto),'') AS ingredientes_normalizados
 FROM productos p JOIN categorias c USING(id_categoria)`;
// FASE 9B-1: para la IA se lee además la LISTA de ingredientes normalizados (un elemento por ingrediente) que usa
// el evaluador alimentario. Solo en las consultas de la IA: la respuesta de la API de productos no cambia.
const SELECT_IA=SELECT.replace(" AS ingredientes_normalizados",` AS ingredientes_normalizados,
 COALESCE((SELECT json_agg(i.nombre ORDER BY i.id_ingrediente) FROM producto_ingrediente pi JOIN ingredientes i USING(id_ingrediente) WHERE pi.id_producto=p.id_producto),'[]'::json) AS ingredientes_lista`);
// Elegibles para la IA: activo, categoría activa, precio > 0 y existencia > 0. Tope de lectura acotado.
const SELECT_ELEGIBLES_IA=SELECT_IA+` WHERE p.estado=TRUE AND c.estado=TRUE AND p.precio>0
 AND EXISTS(SELECT 1 FROM inventario inv WHERE inv.id_producto=p.id_producto AND inv.cantidad>0)
 ORDER BY p.nombre,p.id_producto LIMIT 200`;
const {seleccionarCandidatos}=require("../../services/relevanciaIA");
const {evaluarProducto,ESTADOS}=require("../../services/evaluadorAlimentario");
// Producto para la IA y el evaluador: mismos datos que hidratar + descripción + lista de ingredientes normalizados
// (solo si los ingredientes vigentes son los normalizados; un registro heredado conserva su texto declarado).
function hidratarIA(r){
 const p=hidratar(r);p.descripcion=r.descripcion||"";
 const heredado=r.fecha_actualizacion===null&&r.datos_legado?.ingredientes;
 if(!heredado&&Array.isArray(r.ingredientes_lista))p.ingredientesLista=r.ingredientes_lista;
 return p;
}
function hidratar(r){
 if(!r)return null;
 const p=new Producto({id:r.id_producto,nombre:r.nombre,categoria:r.categoria,
  ingredientes:r.fecha_actualizacion===null?(r.datos_legado?.ingredientes||r.ingredientes_normalizados):r.ingredientes_normalizados,
  valoresNutricionales:r.valores_nutricionales??r.datos_legado?.valoresNutricionales??""});
 p.estado=r.estado;p.precio=r.precio;p.stockMinimo=r.stock_minimo;
 return p;
}
class RepositorioProductos extends Base {
 async listar(){return (await this.query(SELECT+" ORDER BY p.nombre,p.id_producto")).rows.map(hidratar);}
 // Selección comercial acotada: SQL fijo de SOLO LECTURA (elegibilidad), relevancia calculada en el backend
 // (src/services/relevanciaIA.js) con datos reales del producto. Nunca instrucciones del LLM.
 async seleccionarCandidatosIA(consulta = '', opciones = {}){
  const filas=(await this.query(SELECT_ELEGIBLES_IA)).rows;
  const elegibles=filas.map(hidratarIA);
  // FASE 9B-1: restricciones declaradas en la consulta actual → el evaluador excluye ANTES de la relevancia.
  // FASE 9B-2: preferencias autorizadas → bono moderado de relevancia (solo entre permitidos que ya coinciden).
  return seleccionarCandidatos(elegibles, String(consulta||""), undefined, {restricciones:Array.isArray(opciones.restricciones)?opciones.restricciones:[],
   preferencias:Array.isArray(opciones.preferencias)?opciones.preferencias:[],
   // FASE 9C: resumen de compras entregadas (solo si el servicio lo leyó con consentimiento de historial).
   historial:opciones.historial||null});
 }
 // Compatibilidad: solo la lista de candidatos (máx. 5).
 async listarDisponiblesIA(consulta = ''){ return (await this.seleccionarCandidatosIA(consulta)).candidatos; }
 // Re-resuelve IDs ya validados: SOLO productos que SIGUEN visibles y con existencia (mismas reglas que
 // listarDisponiblesIA). Datos comerciales siempre desde PostgreSQL, nunca desde el modelo. Conserva el orden.
 async resolverRecomendados(ids = [], opciones = {}){
  if(!Array.isArray(ids)||!ids.length)return [];
  const restricciones=Array.isArray(opciones.restricciones)?opciones.restricciones:[];
  let filas=(await this.query(SELECT_IA.replace("FROM productos p JOIN categorias c USING(id_categoria)",
   "FROM productos p JOIN categorias c USING(id_categoria) JOIN inventario inv USING(id_producto)").replace("SELECT p.*,","SELECT p.*,inv.cantidad,")+
   ` WHERE p.id_producto=ANY($1::uuid[]) AND p.estado=TRUE AND c.estado=TRUE AND p.precio>0 AND inv.cantidad>0`,[ids])).rows;
  // FASE 9B-1: RE-EVALUACIÓN con los datos frescos de PostgreSQL (ingredientes, nombre, descripción, información
  // nutricional). Si el producto cambió durante la consulta y ya no pasa el evaluador, NO se muestra su tarjeta.
  if(restricciones.length)filas=filas.filter(r=>evaluarProducto(hidratarIA(r),restricciones).estado===ESTADOS.SIN_CONFLICTO);
  const {estado}=require("./inventario"),{rutaImagenSegura}=require("../../security/imagenesProductos");
  const porId=new Map(filas.map(r=>[r.id_producto,r]));
  return ids.filter(id=>porId.has(id)).map(id=>{const r=porId.get(id);return {id:r.id_producto,nombre:r.nombre,descripcion:r.descripcion,
   categoria:r.categoria,precio:Number(r.precio).toFixed(2),precioFormateado:`Q ${Number(r.precio).toFixed(2)}`,
   imagenUrl:rutaImagenSegura(r.imagen_url),disponibilidad:estado(r.cantidad,r.stock_minimo)};});
 }
 async buscarPorId(id){return hidratar((await this.query(SELECT+" WHERE p.id_producto=$1",[id])).rows[0]);}
 async guardar(p){
  await this.tx(async db=>{
   // El contrato actual expresa ingredientes por comas; cada término declarado se normaliza sin inferir cantidades.
   const nombres=[...new Set(p.ingredientes.split(",").map(x=>x.trim()).filter(Boolean))];
   if(nombres.some(x=>x.length>100))throw new ErrorAplicacion("Cada ingrediente debe tener como máximo 100 caracteres.",400);
   const cat=(await db.query("INSERT INTO categorias(nombre,fecha_creacion) VALUES($1,CURRENT_TIMESTAMP) ON CONFLICT(nombre) DO UPDATE SET nombre=EXCLUDED.nombre RETURNING id_categoria",[p.categoria])).rows[0];
   await db.query(`INSERT INTO productos(id_producto,id_categoria,nombre,valores_nutricionales,estado,fecha_creacion,fecha_actualizacion)
    VALUES($1,$2,$3,$4,FALSE,CURRENT_TIMESTAMP,CURRENT_TIMESTAMP)
    ON CONFLICT(id_producto) DO UPDATE SET id_categoria=EXCLUDED.id_categoria,nombre=EXCLUDED.nombre,
     valores_nutricionales=EXCLUDED.valores_nutricionales,fecha_actualizacion=CURRENT_TIMESTAMP`,[p.id,cat.id_categoria,p.nombre,p.valoresNutricionales]);
   await db.query("DELETE FROM producto_ingrediente WHERE id_producto=$1",[p.id]);
   for(const nombre of nombres){
    const i=(await db.query("INSERT INTO ingredientes(nombre) VALUES($1) ON CONFLICT(nombre) DO UPDATE SET nombre=EXCLUDED.nombre RETURNING id_ingrediente",[nombre])).rows[0];
    await db.query("INSERT INTO producto_ingrediente(id_producto,id_ingrediente) VALUES($1,$2)",[p.id,i.id_ingrediente]);
   }
  });
  return this.buscarPorId(p.id);
 }
 async eliminar(id){
  return this.tx(async db=>{
   const p=await db.query("SELECT id_producto FROM productos WHERE id_producto=$1 FOR UPDATE",[id]);
   if(!p.rowCount)return false;
   const usados=await db.query(`SELECT 1 FROM detalle_pedido WHERE id_producto=$1 UNION ALL SELECT 1 FROM movimientos_inventario WHERE id_producto=$1 UNION ALL SELECT 1 FROM inventario WHERE id_producto=$1`,[id]);
   if(usados.rowCount){await db.query("UPDATE productos SET estado=FALSE,fecha_actualizacion=CURRENT_TIMESTAMP WHERE id_producto=$1",[id]);return true;}
   await db.query("DELETE FROM producto_ingrediente WHERE id_producto=$1",[id]);
   await db.query("DELETE FROM productos WHERE id_producto=$1",[id]);
   return true;
  });
 }
}
module.exports={RepositorioProductos};
