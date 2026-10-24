const {randomUUID}=require("node:crypto");
const {cifrar}=require("../../src/security/crypto");
function fuente(){
 const u=randomUUID(),p=randomUUID(),q=randomUUID(),i=randomUUID();
 const fecha="2026-08-01T10:00:00.000Z";
 return {versionEsquema:2,
  usuarios:[{id:u,nombre:"Cliente sintético",correo:"fixture@example.test",rol:"CLIENTE",
   passwordHash:require("bcryptjs").hashSync("Clave12345",4),createdAt:fecha,
   perfilSalud:{id:randomUUID(),condicionesMedicas:cifrar("Declaración ficticia"),alergias:cifrar("Alergia ficticia"),objetivoNutricional:cifrar("Objetivo ficticio"),versionCifrado:2}}],
  productos:[{id:p,nombre:"Producto ficticio",categoria:"Categoría ficticia",ingredientes:"Avena, Agua",valoresNutricionales:"Información ficticia"}],
  consultas:[{id:q,clienteId:u,texto:cifrar("Pregunta ficticia"),fecha,estado:"ERROR",versionCifrado:2}],
  interacciones:[{id:i,consultaId:q,clienteId:u,consulta:cifrar("Pregunta ficticia"),respuestaIA:null,fecha,revisada:false,versionCifrado:2}],
  auditoria:[{id:randomUUID(),usuarioId:u,accion:"consulta_ia_error",recursoAccedido:`consultas/${q}`,fecha}],
 };
}
module.exports={fuente};
