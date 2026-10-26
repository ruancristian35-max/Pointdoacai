import {respond} from './_shared.js';
// Não confirme pagamentos com base apenas no corpo recebido. Implementar verificação
// criptográfica/assinatura do gateway e consulta autenticada à cobrança antes do update.
export default async function handler(req,res){
 if(req.method!=='POST')return respond(res,405,{error:'Método não permitido'});
 return respond(res,503,{code:'WEBHOOK_NOT_CONFIGURED',error:'Webhook inativo até configurar assinatura e verificação do provedor.'});
}
