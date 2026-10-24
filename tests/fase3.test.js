const {test}=require("node:test");
const assert=require("node:assert/strict");const fs=require("node:fs");const os=require("node:os");const path=require("node:path");
process.env.JWT_SECRET="fase3-prueba-sintetica";process.env.ENCRYPTION_KEY="ab".repeat(32);process.env.CORS_ORIGINS="https://permitido.example";
const jwt=require("jsonwebtoken");const {crearStore}=require("../src/data/store");const {crearSistema}=require("../src/services/sistema");const {crearApp}=require("../src/app");
const {Administrador,Empleado}=require("../src/domain/modelos");const {generarToken}=require("../src/security/auth");
async function entorno(t,limites){
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),"nv-fase3-"));const store=crearStore(path.join(dir,"db.json"));const sistema=crearSistema({store});
 const server=crearApp(sistema,{limites}).listen(0,"127.0.0.1");await new Promise(r=>server.once("listening",r));
 t.after(async()=>{await new Promise(r=>server.close(r));assert.equal(path.dirname(path.resolve(dir)),path.resolve(os.tmpdir()));assert.ok(path.basename(dir).startsWith("nv-fase3-"));fs.rmSync(dir,{recursive:true,force:true});});
 const api=async(method,ruta,body,token,headers={})=>{const r=await fetch(`http://127.0.0.1:${server.address().port}/api${ruta}`,{method,headers:{"Content-Type":"application/json",...(token?{Authorization:`Bearer ${token}`}:{ }),...headers},...(body!==undefined?{body:JSON.stringify(body)}:{})});return {status:r.status,headers:r.headers,data:r.status===204?null:await r.json()};};
 const cliente=await sistema.registrar({nombre:"Sintético",correo:"cliente@example.test",password:"Clave12345"});
 return {store,sistema,api,cliente,token:generarToken(cliente)};
}
test("FASE3 login: éxito identificado; fallos anónimos sin credenciales",async t=>{
 const {api,store,cliente}=await entorno(t);
 const ok=await api("POST","/auth/login",{correo:cliente.correo,password:"Clave12345"});assert.equal(ok.status,200);
 assert.ok(!JSON.stringify(ok.data.usuario).match(/password|hash/i));
 for(const correo of [cliente.correo,"ausente@example.test"]){const r=await api("POST","/auth/login",{correo,password:"Incorrecta"});assert.equal(r.status,401);assert.equal(r.data.error,"Correo o contraseña incorrectos.");}
 const eventos=store.listar("auditoria");assert.ok(eventos.some(e=>e.accion==="LOGIN_EXITOSO"&&e.usuarioId===cliente.id));assert.equal(eventos.filter(e=>e.accion==="LOGIN_FALLIDO"&&e.usuarioId===null).length,2);
 assert.ok(!JSON.stringify(eventos).includes("Incorrecta"));assert.ok(!JSON.stringify(eventos).includes(ok.data.token));
});
test("FASE3 JWT: falta, inválido, expirado, algoritmo, sujeto y expiración obligatoria",async t=>{
 const {api,cliente,token}=await entorno(t);assert.equal((await api("GET","/perfil",undefined,token)).status,200);
 const firmar=(payload,options)=>jwt.sign(payload,process.env.JWT_SECRET,options);
 const invalidos=[undefined,"invalido",firmar({sub:cliente.id},{expiresIn:-1}),firmar({sub:cliente.id},{algorithm:"HS384",expiresIn:30}),firmar({sub:"no-uuid"},{expiresIn:30}),firmar({sub:cliente.id})];
 for(const valor of invalidos)assert.equal((await api("GET","/perfil",undefined,valor)).status,401);
 assert.equal((await api("GET","/perfil",undefined,token,{Authorization:`Bearer ${token} extra`})).status,401);
});
test("FASE3 RBAC: cliente y empleado denegados, administrador autorizado, rol persistido manda",async t=>{
 const {api,sistema,cliente,token,store}=await entorno(t);
 const empleado=new Empleado({nombre:"Empleado",correo:"empleado@example.test"});const admin=new Administrador({nombre:"Admin",correo:"admin@example.test"});await sistema.repositorios.usuarios.guardar(empleado);await sistema.repositorios.usuarios.guardar(admin);
 for(const u of [cliente,empleado])assert.equal((await api("GET","/consultas/admin",undefined,generarToken(u))).status,403);
 assert.equal((await api("GET","/consultas/admin",undefined,generarToken(admin))).status,200);
 assert.equal((await api("GET","/perfil",undefined,generarToken(empleado))).status,403);
 const falso=jwt.sign({sub:cliente.id,rol:"ADMINISTRADOR"},process.env.JWT_SECRET,{expiresIn:30});assert.equal((await api("GET","/consultas/admin",undefined,falso)).status,403);
 store.actualizar("usuarios",admin.id,{rol:"EMPLEADO"});assert.equal((await api("GET","/consultas/admin",undefined,generarToken(admin))).status,403);
 assert.ok(store.listar("auditoria").some(e=>e.accion==="ACCESO_DENEGADO"&&e.usuarioId===cliente.id));
});
test("FASE3 autorización: UUID ajenos en body/query no cambian propietario",async t=>{
 const {api,sistema,cliente,token}=await entorno(t);const otro=await sistema.registrar({nombre:"Otro",correo:"otro@example.test",password:"Clave12345"});
 await sistema.perfil.actualizar(otro.id,{alergias:"Exclusivo"});
 for(const ruta of [`/perfil?usuarioId=${otro.id}`,`/consultas?clienteId=${otro.id}`])assert.equal((await api("GET",ruta,undefined,token)).status,400);
 assert.equal((await api("PUT","/perfil",{usuarioId:otro.id,alergias:"Intrusión"},token)).status,400);
 assert.equal((await api("GET",`/perfil/${otro.id}`,undefined,token)).status,404);
 assert.equal((await api("GET",`/consultas/${otro.id}`,undefined,token)).status,404);
 assert.equal((await sistema.perfil.obtener(otro.id)).alergias,"Exclusivo");
 assert.equal((await api("GET","/perfil",undefined,token)).data.perfilSalud,null);
});
test("FASE3 validación: UUID, correo, tipos, escalamiento, contraseña y conflicto",async t=>{
 const {api,sistema,cliente}=await entorno(t);const admin=new Administrador({nombre:"Admin",correo:"admin@example.test"});await sistema.repositorios.usuarios.guardar(admin);
 assert.equal((await api("DELETE","/productos/no-uuid",undefined,generarToken(admin))).status,400);
 for(const body of [{correo:"incorrecto",password:"Clave12345"},{correo:cliente.correo,password:[]},{correo:cliente.correo,password:"Clave12345",rol:"ADMINISTRADOR"}])assert.equal((await api("POST","/auth/login",body)).status,400);
 for(const extras of [{rol:"ADMINISTRADOR"},{password:"é".repeat(37)},{nombre:"x".repeat(81)}])assert.equal((await api("POST","/auth/register",{nombre:"Nuevo",correo:"nuevo@example.test",password:"Clave12345",...extras})).status,400);
 assert.equal((await api("POST","/auth/register",{nombre:"Repetido",correo:cliente.correo,password:"Clave12345"})).status,409);
});
test("FASE3 logout: token revocado persistido; otra sesión permanece válida",async t=>{
 const {api,sistema,cliente,token,store}=await entorno(t);const otro=generarToken(cliente);assert.notEqual(token,otro);
 assert.equal((await api("POST","/auth/logout",{},token)).status,204);assert.equal((await api("GET","/perfil",undefined,token)).status,401);assert.equal((await api("GET","/perfil",undefined,otro)).status,200);
 const evento=store.listar("auditoria").find(e=>e.accion==="LOGOUT");assert.match(evento.recursoAccedido,/^sesion\/[a-f0-9]{64}$/);assert.ok(!JSON.stringify(evento).includes(token));
 const recargado=crearSistema({store});assert.equal(await recargado.repositorios.auditoria.sesionRevocada(evento.recursoAccedido),true);
});
test("FASE3 usuario inactivo: login y JWT existente rechazados",async t=>{
 const {api,store,cliente,token}=await entorno(t);store.actualizar("usuarios",cliente.id,{estado:false});
 assert.equal((await api("GET","/perfil",undefined,token)).status,401);assert.equal((await api("POST","/auth/login",{correo:cliente.correo,password:"Clave12345"})).status,401);
});
test("FASE3 headers Helmet, CORS permitido y origen ajeno sin permiso",async t=>{
 const {api}=await entorno(t);const r=await api("GET","/salud",undefined,undefined,{Origin:"https://permitido.example"});
 assert.equal(r.headers.get("x-content-type-options"),"nosniff");assert.match(r.headers.get("content-security-policy"),/script-src 'self'/);assert.match(r.headers.get("content-security-policy"),/script-src-attr 'none'/);assert.equal(r.headers.get("x-powered-by"),null);
 assert.equal(r.headers.get("access-control-allow-origin"),"https://permitido.example");assert.equal((await api("GET","/salud",undefined,undefined,{Origin:"https://ajeno.example"})).headers.get("access-control-allow-origin"),null);
});
test("FASE3 límites: login, registro e IA devuelven 429 controlado",async t=>{
 const {api,token}=await entorno(t,{login:2,registro:2,ia:2});
 for(const [ruta,body,tok] of [["/auth/login",{correo:"ausente@example.test",password:"Incorrecta"}],["/auth/register",{nombre:"N"}],["/consultas",{texto:""},token]]){
  await api("POST",ruta,body,tok);await api("POST",ruta,body,tok);const r=await api("POST",ruta,body,tok);assert.equal(r.status,429);assert.equal(r.data.codigo,"LIMITE_SOLICITUDES");assert.ok(r.headers.get("retry-after"));
 }
});
test("FASE3 errores: dependencias no exponen SQL, secretos ni stack",async t=>{
 const {api,sistema,token}=await entorno(t);sistema.repositorios.productos.listar=async()=>{throw new Error("SELECT password_hash /ruta/privada JWT_SECRET=secreto");};const r=await api("GET","/productos",undefined,token);assert.equal(r.status,500);assert.ok(!JSON.stringify(r.data).match(/SELECT|password_hash|JWT_SECRET|stack|privada/));
});
test("FASE3 UML: referencias UC definidas, sin conexiones duplicadas y sin onclick inline",()=>{
 const uml=fs.readFileSync(path.join(__dirname,"../docs/uml/2. Casos_Uso_NutriVida_AI.txt"),"utf8");const definidos=new Set([...uml.matchAll(/as (UC\d+)/g)].map(m=>m[1]));for(const [id] of uml.matchAll(/\bUC\d+\b/g))assert.ok(definidos.has(id),id);
 const flechas=uml.split(/\r?\n/).filter(l=>l.includes('-->'));assert.equal(new Set(flechas).size,flechas.length);
 assert.ok(!/onclick=/.test(fs.readFileSync(path.join(__dirname,"../public/app.js"),"utf8")));
});
