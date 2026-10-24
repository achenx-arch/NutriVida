const {ErrorValidacion,sanearTexto,UUID}=require("./validate");
function fallo(m="Datos del catálogo no válidos."){throw new ErrorValidacion(m);}
function objeto(v,permitidos){if(!v||typeof v!=="object"||Array.isArray(v)||Object.keys(v).some(k=>!permitidos.includes(k)))fallo("La solicitud contiene propiedades inesperadas.");}
function texto(v,max,min=0){if(typeof v!=="string")fallo("Se esperaba texto.");const s=sanearTexto(v);if(s.length<min||s.length>max)fallo(`El texto debe tener entre ${min} y ${max} caracteres.`);return s;}
function identificador(v){if(!["string","number"].includes(typeof v)||!/^\d{1,19}$/.test(String(v))||(typeof v==="number"&&!Number.isSafeInteger(v)))fallo("Identificador no válido.");const n=BigInt(v);if(n<1n||n>9223372036854775807n)fallo("Identificador no válido.");return String(n);}
function uuid(v){if(typeof v!=="string"||!UUID.test(v))fallo("El UUID no es válido.");return v;}
function booleano(v){if(typeof v!=="boolean")fallo("El estado debe ser booleano.");return v;}
function precio(v){if(v===null)return null;if(!["number","string"].includes(typeof v)||!/^\d{1,8}(\.\d{1,2})?$/.test(String(v))||Number(v)<=0)fallo("El precio debe ser mayor que cero, con hasta dos decimales.");return Number(v).toFixed(2);}
// Solo imágenes locales existentes en /images/productos/ (sin HTTPS externo, SVG ni traversal).
function imagen(v){return require("./imagenesProductos").validarRutaImagen(v,fallo);}
function ficha(tipo,b,crear=false){const producto=tipo==="productos";const keys=producto?["nombre","categoriaId","descripcion","precio","imagenUrl","estado","ingredientes","valoresNutricionales","stockMinimo"]:tipo==="categorias"?["nombre","descripcion","estado"]:["nombre","descripcion"];objeto(b,keys);if(!Object.keys(b).length)fallo("Indica los campos que deseas guardar.");const r={};
 if(crear||b.nombre!==undefined)r.nombre=texto(b.nombre,producto?120:tipo==="categorias"?80:100,2);
 if(b.descripcion!==undefined)r.descripcion=b.descripcion===null?null:texto(b.descripcion,producto?5000:250);
 if(b.estado!==undefined)r.estado=booleano(b.estado);
 if(producto){
  if(crear||b.categoriaId!==undefined)r.categoriaId=identificador(b.categoriaId);
  if(b.precio!==undefined)r.precio=precio(b.precio);
  if(b.imagenUrl!==undefined)r.imagenUrl=imagen(b.imagenUrl);
  if(b.valoresNutricionales!==undefined)r.valoresNutricionales=b.valoresNutricionales===null?null:texto(b.valoresNutricionales,2000);
  if(b.stockMinimo!==undefined){if(b.stockMinimo!==null&&(!Number.isInteger(b.stockMinimo)||b.stockMinimo<0||b.stockMinimo>2147483647))fallo("Stock mínimo no válido.");r.stockMinimo=b.stockMinimo;}
  if(b.ingredientes!==undefined){if(!Array.isArray(b.ingredientes)||b.ingredientes.length>100)fallo("Selecciona hasta 100 ingredientes mediante sus identificadores.");r.ingredientes=b.ingredientes.map(i=>{objeto(i,["id","cantidadDescriptiva"]);return {id:identificador(i.id),cantidadDescriptiva:i.cantidadDescriptiva==null?null:texto(i.cantidadDescriptiva,100)};});if(new Set(r.ingredientes.map(i=>i.id)).size!==r.ingredientes.length)fallo("No repitas ingredientes.");}
 }
 return r;
}
function filtros(q,admin=false,tipo="productos"){
 objeto(q,tipo==="productos"?["nombre","categoria","ingrediente","estado","page","limit"]:["nombre","estado","page","limit"]);const r={page:1,limit:12};
 for(const k of ["page","limit"]){if(q[k]!==undefined){if(typeof q[k]!=="string"||!/^\d{1,6}$/.test(q[k]))fallo("Paginación no válida.");r[k]=Number(q[k]);if(r[k]<1||r[k]>(k==="limit"?100:100000))fallo("Paginación fuera del límite permitido.");}}
 if(q.nombre!==undefined)r.nombre=texto(q.nombre,120);
 for(const k of ["categoria","ingrediente"])if(q[k]!==undefined)r[k]=identificador(q[k]);
 if(q.estado!==undefined){if(!admin||!["activo","inactivo","todos"].includes(q.estado)||tipo==="ingredientes")fallo("Filtro de estado no permitido.");r.estado=q.estado;}
 return r;
}
module.exports={ficha,filtros,identificador,uuid,booleano,objeto};
