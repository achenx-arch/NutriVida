const {objeto,uuid}=require('./catalogoValidacion');
const {ErrorValidacion,sanearTexto}=require('./validate');
const TIPOS=['ENTRADA','SALIDA','AJUSTE'];
const fallo=m=>{throw new ErrorValidacion(m);};
function movimiento(b){
 objeto(b,['productoId','tipo','cantidad','motivo']);
 const productoId=uuid(b.productoId);
 if(!TIPOS.includes(b.tipo))fallo('Tipo de movimiento no válido.');
 if(!Number.isInteger(b.cantidad)||b.cantidad<(b.tipo==='AJUSTE'?0:1)||b.cantidad>2147483647)fallo('Indica una cantidad entera válida; AJUSTE admite cero.');
 if(typeof b.motivo!=='string')fallo('El motivo es obligatorio.');
 const motivo=sanearTexto(b.motivo);
 if(!motivo.length||motivo.length>250)fallo('El motivo debe tener entre 1 y 250 caracteres.');
 return {productoId,tipo:b.tipo,cantidad:b.cantidad,motivo};
}
function filtros(q,historial=false){
 objeto(q,historial?['producto','tipo','desde','hasta','usuario','page','limit']:['nombre','page','limit']);
 const f={page:1,limit:12};
 for(const k of ['page','limit'])if(q[k]!==undefined){if(typeof q[k]!=='string'||!/^\d{1,6}$/.test(q[k]))fallo('Paginación no válida.');f[k]=Number(q[k]);if(f[k]<1||f[k]>(k==='limit'?100:100000))fallo('Paginación fuera del límite.');}
 if(q.nombre!==undefined){if(typeof q.nombre!=='string'||q.nombre.length>120)fallo('Búsqueda no válida.');f.nombre=sanearTexto(q.nombre);}
 for(const k of ['producto','usuario'])if(q[k]!==undefined)f[k]=uuid(q[k]);
 if(q.tipo!==undefined){if(!TIPOS.includes(q.tipo))fallo('Tipo no válido.');f.tipo=q.tipo;}
 for(const k of ['desde','hasta'])if(q[k]!==undefined){const d=q[k];if(typeof d!=='string'||!/^\d{4}-\d{2}-\d{2}$/.test(d)||!Number.isFinite(Date.parse(d))||new Date(d).toISOString().slice(0,10)!==d||d<'0001-01-01'||d>'9998-12-31')fallo('La fecha debe ser válida (AAAA-MM-DD).');f[k]=d;}
 if(f.desde&&f.hasta&&f.desde>f.hasta)fallo('El intervalo de fechas no es válido.');
 return f;
}
module.exports={movimiento,filtros};
