// Point do Acai - Cloudflare Worker + Supabase + Sunize API v2
// Pagamentos reais DESATIVADOS por padrao: SUNIZE_PAYMENTS_ENABLED === 'true'

const catalog = {
  'Açaí Tradicional': 1090,
  'Açaí Especial': 1790,
  'Açaí Família': 2590,
  'Combo Casal': 2090,
  'Copo Tropical': 790,
  'Milk-shake de Açaí': 1290
};
const extras = {
  'Leite em pó': 0, 'Morango': 0, 'Banana': 0, 'Nutella': 0,
  'Granola': 0, 'Leite condensado': 0
};
const SUNIZE_URL = 'https://api.sunize.com.br/v2/transactions';
// Frete zerado enquanto a promoção de entrega grátis estiver vigente.
// Não cobrar taxa sem atualizar previamente as informações exibidas na loja.
const DELIVERY_FEE_CENTS = 0;
function json(value, status = 200) {
  return Response.json(value, {status, headers: {'Cache-Control': 'no-store'}});
}
function checkCpf(value) {
  const cpf = String(value || '').replace(/\D/g, '');
  if (cpf.length !== 11 || /^(\d)\1{10}$/.test(cpf)) return null;
  for (let i = 9; i <= 10; i++) {
    let sum = 0;
    for (let j = 0; j < i; j++) sum += Number(cpf[j]) * (i + 1 - j);
    const digit = (sum * 10) % 11 % 10;
    if (digit !== Number(cpf[i])) return null;
  }
  return cpf;
}
function validate(body) {
  const c = body?.customer, entries = body?.items;
  if (!c || typeof c.name !== 'string' || c.name.trim().length < 2 || c.name.length > 100 ||
      typeof c.phone !== 'string' || !/^\+?[\d\s()-]{10,20}$/.test(c.phone) ||
      c.delivery !== 'Entrega' || c.payment !== 'Pix')
    throw Error('Revise os dados do cliente e escolha Pix.');
  const phone = c.phone.replace(/\D/g, '');
  const national = phone.startsWith('55') && (phone.length === 12 || phone.length === 13) ? phone.slice(2) : phone;
  if (!/^\d{10,11}$/.test(national)) throw Error('WhatsApp inválido (inclua DDD).');
  if (typeof c.email !== 'string' || c.email.length > 254 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(c.email))
    throw Error('Informe um e-mail válido.');
  const cpf = checkCpf(c.cpf);
  if (!cpf) throw Error('Informe um CPF válido.');
  if (typeof c.address !== 'string' || c.address.trim().length < 8 || c.address.length > 300)
    throw Error('Informe o endereço completo.');
  if (!Array.isArray(entries) || !entries.length || entries.length > 40)
    throw Error('Carrinho inválido.');
  let total = 0;
  const items = entries.map(item => {
    if (!item || !Object.hasOwn(catalog, item.name) || !Number.isInteger(item.qty) ||
        item.qty < 1 || item.qty > 30 || !Array.isArray(item.extras) || item.extras.length > 6 ||
        new Set(item.extras).size !== item.extras.length ||
        item.extras.some(e => !Object.hasOwn(extras, e))) throw Error('Produto ou adicional inválido.');
    const price = catalog[item.name] + item.extras.reduce((a, e) => a + extras[e], 0);
    total += price * item.qty;
    return {name: item.name, extras: item.extras, qty: item.qty, unit_price_cents: price};
  });
  if (total <= 0 || total > 2000000) throw Error('Valor do pedido inválido.');
  const order = {
    id: crypto.randomUUID(), customer_name: c.name.trim(), customer_phone: c.phone.trim(),
    delivery_type: 'Entrega', delivery_address: c.address.trim(),
    items, total_cents: total + DELIVERY_FEE_CENTS, payment_method: 'Pix', status: 'pending_payment'
  };
  return {order, customer: {name: order.customer_name, email: c.email.trim(),
    phone: `+55${national}`, document_type: 'CPF', document: cpf}};
}
function dbHeaders(env, prefer = 'return=representation') {
  return {apikey: env.SUPABASE_SERVICE_ROLE_KEY,
    Authorization: `Bearer ${env.SUPABASE_SERVICE_ROLE_KEY}`,
    'Content-Type': 'application/json', Prefer: prefer};
}
function dbUrl(env, suffix) {
  if (!env.SUPABASE_URL || !env.SUPABASE_SERVICE_ROLE_KEY ||
      !/^https:\/\/[a-z0-9-]+\.supabase\.co\/?$/.test(env.SUPABASE_URL))
    throw Error('Banco não configurado.');
  return `${env.SUPABASE_URL.replace(/\/$/, '')}/rest/v1/${suffix}`;
}
async function dbCall(env, suffix, opts = {}) {
  const r = await fetch(dbUrl(env, suffix), {
    method: opts.method || 'GET', headers: dbHeaders(env, opts.prefer),
    body: opts.body ? JSON.stringify(opts.body) : undefined
  });
  if (!r.ok) { console.error('Supabase status:', r.status); throw Error('Erro ao acessar banco.'); }
  return opts.prefer === 'return=minimal' ? null : r.json();
}
function sunizeHeaders(env) {
  if (!env.SUNIZE_API_KEY || !env.SUNIZE_API_SECRET) throw Error('Sunize não configurada.');
  return {'x-api-key': env.SUNIZE_API_KEY, 'x-api-secret': env.SUNIZE_API_SECRET,
    'Content-Type': 'application/json'};
}
async function sunizeGet(env, id) {
  if (typeof id !== 'string' || !/^[\w-]{1,120}$/.test(id)) throw Error('ID inválido');
  const r = await fetch(`${SUNIZE_URL}/${encodeURIComponent(id)}`, {headers: sunizeHeaders(env)});
  if (!r.ok) { console.error('Consulta Sunize status:', r.status); throw Error('Falha na consulta da Sunize.'); }
  return r.json();
}
async function checkout(request, env) {
  if (request.method !== 'POST') return json({error: 'Método não permitido.'}, 405);
  if (!request.headers.get('content-type')?.includes('application/json'))
    return json({error: 'Envie JSON.'}, 415);
  let data;
  try {
    const raw = await request.text();
    if (raw.length > 16000) return json({error: 'Pedido muito grande.'}, 413);
    const input = JSON.parse(raw);
    if (typeof input?.checkout_request_id !== 'string' ||
        !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(input.checkout_request_id)) {
      return json({error: 'Atualize a página: identificador do pedido ausente ou inválido.'}, 400);
    }
    data = validate(input);
    data.order.checkout_request_id = input.checkout_request_id.toLowerCase();
  } catch (e) { return json({error: e.message || 'Pedido inválido.'}, 400); }
  const {order, customer} = data;

  // O banco tem indice UNIQUE em checkout_request_id. Toda repeticao deve
  // reutilizar o pedido existente, nunca criar uma segunda cobranca.
  const filter = 'orders?checkout_request_id=eq.' + encodeURIComponent(order.checkout_request_id) +
    '&select=id,customer_name,customer_phone,delivery_type,delivery_address,items,total_cents,payment_method,status';

  const sameOrder = existing => {
    if (!existing || existing.customer_name !== order.customer_name ||
        existing.customer_phone !== order.customer_phone ||
        existing.delivery_type !== order.delivery_type ||
        (existing.delivery_address ?? null) !== order.delivery_address ||
        existing.total_cents !== order.total_cents ||
        existing.payment_method !== 'Pix' ||
        !Array.isArray(existing.items) || existing.items.length !== order.items.length) return false;
    return existing.items.every((a, i) => {
      const b = order.items[i];
      return a.name === b.name && a.qty === b.qty &&
        a.unit_price_cents === b.unit_price_cents &&
        Array.isArray(a.extras) && a.extras.length === b.extras.length &&
        a.extras.every((v, j) => v === b.extras[j]);
    });
  };

  async function existingReceipt() {
    const rows = await dbCall(env, filter);
    if (!Array.isArray(rows)) throw Error('Resposta inesperada do banco.');
    if (!rows.length) return null;
    const old = rows[0];
    if (!sameOrder(old, order)) {
      return json({error: 'Esta tentativa ja pertence a um pedido diferente. Confira o pedido anterior antes de iniciar outro.'}, 409);
    }
    // Quando as cobrancas estao habilitadas, nao devolver uma resposta de
    // teste para pedido que pode estar em processamento no gateway.
    if (env.SUNIZE_PAYMENTS_ENABLED === 'true' || old.status !== 'pending_payment') {
      return json({orderId: old.id, error: 'Pedido ja existente. Consulte o status do pedido antes de tentar novamente.'}, 409);
    }
    return json({orderId: old.id, status: 'pending_payment',
      message: 'Pedido de teste ja registrado. Nenhum novo pedido foi criado e o Pix continua desativado.'}, 200);
  }

  try {
    const previous = await existingReceipt();
    if (previous) return previous;
  } catch (e) {
    console.error('Falha ao procurar pedido existente:', e.message);
    return json({error: 'Nao foi possivel confirmar a tentativa anterior. Nenhum novo pedido foi criado.'}, 503);
  }

  try {
    await dbCall(env, 'orders', {method: 'POST', body: order, prefer: 'return=minimal'});
  } catch (e) {
    // Em concorrencia, outra solicitacao pode ter inserido o mesmo ID.
    // Leia a linha vencedora em vez de fazer uma segunda insercao.
    try {
      const previous = await existingReceipt();
      if (previous) return previous;
    } catch (readError) {
      console.error('Falha ao recuperar pedido:', readError.message);
    }
    return json({error: 'Nao foi possivel confirmar o registro. Verifique o pedido antes de tentar novamente.'}, 503);
  }

  // Protecao de lancamento: nao chamar a Sunize enquanto o fluxo completo nao estiver testado.
  if (env.SUNIZE_PAYMENTS_ENABLED !== 'true') {
    return json({orderId: order.id, status: 'pending_payment',
      message: 'Pedido registrado para teste. Pix ainda desativado: não realize pagamento.'}, 201);
  }
  try {
    // Impedir criação de nova cobrança se falhar a passagem do pedido para creating_payment.
    const updated = await dbCall(env,
      `orders?id=eq.${encodeURIComponent(order.id)}&status=eq.pending_payment`,
      {method: 'PATCH', body: {status: 'creating_payment'}});
    if (!Array.isArray(updated) || updated.length !== 1) throw Error('Estado de pedido inválido.');
    const payload = {
      external_id: order.id, amount: order.total_cents / 100, payment_method: 'PIX',
      items: order.items.map((it, n) => ({id: String(n + 1), title: it.name,
        description: it.extras.length ? it.extras.join(', ') : 'Sem adicionais',
        price: it.unit_price_cents / 100, quantity: it.qty, is_physical: true})),
      ip: request.headers.get('CF-Connecting-IP') || undefined,
      customer
    };
    const r = await fetch(SUNIZE_URL, {method: 'POST', headers: sunizeHeaders(env), body: JSON.stringify(payload)});
    if (!r.ok) {console.error('Criar Sunize status:', r.status); throw Error('Sunize recusou criar cobrança.');}
    const payment = await r.json();
    if (!payment?.id || !payment?.pix?.payload || payment.external_id !== order.id ||
        payment.payment_method !== 'PIX' ||
        Math.round(Number(payment.amount) * 100) !== order.total_cents)
      throw Error('Resposta de cobrança inesperada.');
    await dbCall(env, `orders?id=eq.${encodeURIComponent(order.id)}&status=eq.creating_payment`,
      {method: 'PATCH', body: {status: 'awaiting_payment', provider_payment_id: payment.id}, prefer: 'return=minimal'});
    return json({orderId: order.id, status: 'awaiting_payment',
      pixPayload: payment.pix.payload, amount: order.total_cents / 100}, 201);
  } catch (err) {
    console.error('Pagamento não finalizado:', err.message);
    // Nao repetir automaticamente: talvez a Sunize tenha criado a cobranca.
    return json({orderId: order.id, status: 'creating_payment',
      error: 'Não foi possível disponibilizar o Pix. Não tente pagar ou criar outro pedido até verificar o status.'}, 503);
  }
}
function safeEqual(a, b) {
  if (typeof a !== 'string' || typeof b !== 'string') return false;
  const aa = new TextEncoder().encode(a), bb = new TextEncoder().encode(b);
  let diff = aa.length ^ bb.length;
  for (let i = 0; i < Math.max(aa.length, bb.length); i++) diff |= (aa[i] || 0) ^ (bb[i] || 0);
  return diff === 0;
}
async function webhook(request, env) {
  if (request.method !== 'POST') return json({error: 'Método não permitido'}, 405);
  if (!env.SUNIZE_API_SECRET || !safeEqual(request.headers.get('x-api-secret'), env.SUNIZE_API_SECRET)) {
    return json({error: 'Não autorizado'}, 401);
  }
  let hook;
  try {
    const raw = await request.text();
    if (raw.length > 16000) return json({error: 'Evento muito grande'}, 413);
    hook = JSON.parse(raw);
  } catch { return json({error: 'Evento inválido'}, 400); }
  if (typeof hook?.id !== 'string' || typeof hook?.external_id !== 'string') {
    return json({error: 'Evento incompleto'}, 400);
  }
  try {
    const rows = await dbCall(env,
      `orders?id=eq.${encodeURIComponent(hook.external_id)}` +
      `&provider_payment_id=eq.${encodeURIComponent(hook.id)}` +
      '&select=id,total_cents,status');
    if (!Array.isArray(rows) || rows.length !== 1) {
      return json({error: 'Transação não associada'}, 404);
    }
    const order = rows[0];
    const verified = await sunizeGet(env, hook.id);
    if (verified.id !== hook.id || verified.external_id !== order.id ||
        verified.payment_method !== 'PIX' ||
        Math.round(Number(verified.amount) * 100) !== order.total_cents) {
      return json({error: 'Dados divergentes'}, 409);
    }
    const transitions = {
      AUTHORIZED: {target: 'paid', from: ['awaiting_payment']},
      FAILED: {target: 'failed', from: ['awaiting_payment', 'creating_payment']},
      REFUNDED: {target: 'refunded', from: ['paid', 'in_dispute', 'awaiting_payment']},
      CHARGEBACK: {target: 'chargeback', from: ['paid', 'in_dispute', 'awaiting_payment']},
      IN_DISPUTE: {target: 'in_dispute', from: ['paid']}
    };
    if (verified.status === 'PENDING') return json({ok: true, status: 'pending'});
    const transition = transitions[verified.status];
    if (!transition) return json({error: 'Status desconhecido'}, 422);
    if (order.status === transition.target) return json({ok: true, duplicate: true});
    if (!transition.from.includes(order.status)) {
      return json({error: 'Revisão de status necessária'}, 409);
    }
    const updated = await dbCall(env,
      `orders?id=eq.${encodeURIComponent(order.id)}` +
      `&status=eq.${encodeURIComponent(order.status)}`,
      {method: 'PATCH', body: {status: transition.target}});
    if (!Array.isArray(updated) || updated.length !== 1) {
      return json({error: 'Estado mudou; tente novamente'}, 409);
    }
    return json({ok: true, status: transition.target});
  } catch (error) {
    console.error('Webhook falhou:', error.message);
    return json({error: 'Falha na verificação'}, 503);
  }
}
export default {
  async fetch(request, env) {
    const path = new URL(request.url).pathname;
    if (path === '/api/teste') return json({sucesso: true, mensagem: 'API Point do Açaí funcionando!'});
    if (path === '/api/checkout') return checkout(request, env);
    if (path === '/api/webhook-sunize') return webhook(request, env);
    if (path.startsWith('/api/')) return json({error: 'API não configurada.'}, 404);
    return env.ASSETS.fetch(request);
  }
};
