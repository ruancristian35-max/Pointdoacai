import {respond} from './_shared.js';
// Adaptador reservado: nunca envie dados brutos de cartão para esta rota.
export default async function handler(req,res){
 if(req.method!=='POST')return respond(res,405,{error:'Método não permitido'});
 return respond(res,501,{code:'PROVIDER_NOT_CONFIGURED',error:'Pagamento desabilitado. Informe o gateway e sua documentação de tokenização e Pix para habilitar a cobrança segura.'});
}
