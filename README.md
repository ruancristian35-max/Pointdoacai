# Point do Açaí — etapa 2

Loja React/Vite, catálogo ilustrativo, promoções, adicionais, carrinho, registro de pedidos no Supabase e endpoint para consultar status. **Ainda não cobra pagamentos:** a API foi definida apenas como "Outra API", sem nome, documentação e credenciais. Não é seguro inventar endpoints de cobrança ou receber cartão no próprio servidor.

## Publicar na Vercel
1. No Supabase, abra **SQL Editor** e execute `supabase/schema.sql`.
2. No Supabase, copie a **Project URL** e a chave **service_role** (somente para backend). Nunca compartilhe ou coloque em código público.
3. No GitHub, envie o conteúdo da pasta `point-do-acai` (incluindo `api`, `supabase`, `src.jsx`, `index.html` e `package.json`).
4. Na Vercel: **Add New → Project → Import** seu repositório; Framework Preset **Vite**, Build Command `npm run build`, Output Directory `dist`.
5. Em **Settings → Environment Variables**, crie `SUPABASE_URL` e `SUPABASE_SERVICE_ROLE_KEY` para Production. Não use prefixo `VITE_` para segredos.
6. Clique **Redeploy** (ou publique um novo commit). Faça um pedido teste e verifique a tabela `public.orders` no **Table Editor**.
7. Teste `https://SEU-DOMINIO.vercel.app/api/pedido?id=UUID_DO_PEDIDO` para conferir o status.

## Segurança e próximos passos
- O servidor recalcula preços e ignora valores enviados pelo navegador. Os preços e produtos são **demonstrativos**: altere `src.jsx` e `api/_shared.js` para refletir os preços reais, idealmente migrando o catálogo para o banco.
- A tabela usa RLS sem policies públicas. O backend usa `service_role` e não deve revelar chaves nem retornar dados pessoais no endpoint público de status.
- `api/pedido` permite consultar status por UUID; antes de operar com dados reais, considere autenticação do cliente ou token de consulta separado, e rate limiting.
- Falta implementar a cobrança via provedor específico (Pix QR Code e cartão tokenizado com SDK oficial), idempotência, webhook autenticado, verificação server-to-server e atualização para `paid` **somente após confirmação verificada**.
- Não recolha nem armazene números de cartão, CVV ou tokens privados no seu banco. Para checkout na sua marca use campos seguros hospedados pelo provedor.
- Ainda faltam painel administrativo autenticado, taxa de entrega, frete, estoque, políticas e testes de produção.

Para iniciar localmente: `npm install` e `npm run dev`. API `/api/*` deve ser testada na Vercel ou com `vercel dev`.

## Etapa 3 — gateway a definir
Consulte `ETAPA3-PAGAMENTOS.md`. Foram adicionadas rotas seguras por padrão (inativas até escolher gateway) e migração `supabase/etapa3.sql` para deduplicar notificações. **Não há pagamentos reais habilitados.**
