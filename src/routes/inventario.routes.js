const express=require('express');
const {autenticarUsuario,requerirPermiso}=require('../security/auth');
const {Permiso}=require('../domain/roles');
const {objeto}=require('../security/catalogoValidacion');
module.exports=sistema=>{
 const r=express.Router(),s=sistema.inventario;
 const manejar=fn=>async(req,res,next)=>{try{await fn(req,res);}catch(e){next(e);}};
 r.use(autenticarUsuario(sistema.repositorios.usuarios),requerirPermiso(Permiso.GESTIONAR_INVENTARIO));
 r.get('/',manejar(async(req,res)=>res.json(await s.listar(req.usuario.id,req.query))));
 r.get('/movimientos',manejar(async(req,res)=>res.json(await s.historial(req.usuario.id,req.query))));
 r.post('/movimientos',manejar(async(req,res)=>{objeto(req.query,[]);res.status(201).json({movimiento:await s.registrar(req.usuario.id,req.body)});}));
 return r;
};
