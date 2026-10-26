# Point do Açaí — Etapa 3: preparação para gateway próprio

## Estado atual
O checkout e o registro de pedidos da etapa 2 continuam disponíveis. **Não existe cobrança real habilitada**. As rotas `/api/iniciar-pagamento` e `/api/webhook-pagamento` retornam erro intencionalmente até escolhermos o gateway. Isso impede confirmar pagamento falso.

## Fluxo a implementar após identificar o provedor
1. Criar pedido no servidor com valores recalculados a partir do catálogo confiável.
2. Iniciar cobrança usando chave privada SOMENTE no servidor; registrar o identificador da cobrança e seu status `awaiting_payment`.
3. Pix: retornar QR code/copia-e-cola da cobrança real para exibição na própria loja.
4. Cartão: usar SDK oficial de campos hospedados/tokenização; navegador envia ao backend somente token de pagamento, nunca PAN, CVV ou dados sensíveis.
5. Webhook: verificar assinatura/autenticidade conforme documentação do gateway, validar valor, moeda, cobrança e pedido consultando a API do gateway, registrar evento único, atualizar pedido de forma idempotente. Nunca marcar como pago a partir do retorno do navegador.
6. Consultar status do pedido com proteção contra acesso não autorizado; o endpoint público atual expõe apenas ID, status, valor e data, mas deve ganhar token de consulta não adivinhável ou autenticação antes da produção.

## Publicação Vercel
1. Extraia o ZIP e envie os arquivos para o repositório GitHub conectado à Vercel.
2. No Supabase, rode `supabase/schema.sql` se ainda não rodou; depois `supabase/etapa3.sql`.
3. Na Vercel > Project > Settings > Environment Variables configure `SUPABASE_URL` e `SUPABASE_SERVICE_ROLE_KEY` somente para funções de servidor. Nunca use prefixo `VITE_` para segredos.
4. Faça Redeploy; confira logs das funções e teste `/api/checkout` com pedido de demonstração.
5. Não ative cobrança antes de configurar o provedor e validar webhook com ambiente sandbox.

## Preciso de você
Nome do provedor, link da documentação oficial, se sua conta oferece Pix e cartão com checkout integrado e, se existir, SDK/tokenização e documentação de assinatura de webhook. **Não compartilhe chave secreta, token ou senha aqui.**

## Segurança
Definir autenticação e autorização para painel administrativo antes de publicá-lo. Considerar antifraude, rate limit, LGPD, política de reembolso, cálculo de entrega, HTTPS, gestão de segredos, teste sandbox e reconciliação financeira.
