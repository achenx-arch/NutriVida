const { ErrorValidacion, validarRegistro, UUID } = require("../security/validate");
const { GRUPOS, CATALOGO, habilitado } = require("../services/catalogoAlimentacion");
function objeto(value) { return value && typeof value === "object" && !Array.isArray(value); }
function texto(value, nombre, max, obligatorio=false) {
  if (value === undefined && !obligatorio) return;
  if (typeof value !== "string" || value.length > max || (obligatorio && !value.trim())) throw new ErrorValidacion(`El campo ${nombre} no es válido.`);
}
const campos = { registro:["nombre","correo","password"],login:["correo","password"],perfil:["condicionesMedicas","alergias","objetivoNutricional"],producto:["nombre","categoria","ingredientes","valoresNutricionales"],consulta:["texto"],consentimiento:["autorizaContextoIA","autorizaHistorialIA"],alimentacion:[...GRUPOS],vacio:[] };
function validarSolicitud(tipo="vacio", { id=false }={}) {
 return (req,res,next)=>{try{
  if(Object.keys(req.query).length) throw new ErrorValidacion("No se permiten parámetros de consulta en esta ruta.");
  if(id && !UUID.test(req.params.id)) throw new ErrorValidacion("El UUID no es válido.");
  const body=req.body===undefined?{}:req.body;
  if(!objeto(body)||Object.keys(body).some(k=>!campos[tipo].includes(k))) throw new ErrorValidacion("La solicitud contiene propiedades inesperadas.");
  if(tipo==="registro") { validarRegistro(body); }
  if(tipo==="login") {
   texto(body.correo,"correo",150,true);texto(body.password,"password",1024,true);
   if(!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(body.correo.trim())) throw new ErrorValidacion("El correo electrónico no es válido.");
  }
  if(tipo==="perfil") for(const k of campos.perfil) texto(body[k],k,2000);
  if(tipo==="producto") {texto(body.nombre,"nombre",120,req.method==="POST");texto(body.categoria,"categoria",80);texto(body.ingredientes,"ingredientes",2000);texto(body.valoresNutricionales,"valoresNutricionales",2000);
   if(body.ingredientes?.split(',').some(x=>x.trim().length>100)) throw new ErrorValidacion("Un ingrediente supera el tamaño permitido.");}
  if(tipo==="consulta") texto(body.texto,"texto",500,true);
  if(tipo==="consentimiento"){
   const claves=Object.keys(body);
   if(!claves.length) throw new ErrorValidacion("Indica al menos un consentimiento.");
   if(claves.some(k=>typeof body[k]!=="boolean")) throw new ErrorValidacion("Los consentimientos deben ser verdadero o falso.");
  }
  // FASE 9B-2: reemplazo por grupo. Grupo omitido = sin cambios; [] = borrar ese grupo. Solo códigos del catálogo
  // HABILITADOS, sin duplicados, como máximo el tamaño del catálogo. Nunca se acepta un id de usuario del navegador.
  if(tipo==="alimentacion"){
   const claves=Object.keys(body);
   if(!claves.length) throw new ErrorValidacion("Indica al menos un grupo: preferencias, restricciones o alergenos.");
   for(const g of claves){
    const lista=body[g];
    if(!Array.isArray(lista)||lista.length>Object.keys(CATALOGO[g]).length||lista.some(c=>typeof c!=="string"||c.length>40))
     throw new ErrorValidacion(`El grupo ${g} debe ser una lista de códigos.`);
    if(new Set(lista).size!==lista.length) throw new ErrorValidacion(`El grupo ${g} contiene códigos repetidos.`);
    if(lista.some(c=>!habilitado(g,c))) throw new ErrorValidacion(`El grupo ${g} contiene un código no disponible.`);
   }
  }
  next();
 }catch(e){next(e);}};
}
module.exports={validarSolicitud,UUID};
