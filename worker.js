
/*
 POINT DO AÇAÍ
 Cloudflare Worker + Supabase + Sunize V2
 Painel administrativo protegido
 Pagamentos reais desligados por padrão
*/

const catalog = {
  'Açaí Tradicional': 1090,
  'Açaí Especial': 1790,
  'Açaí Família': 2590,
  'Combo Casal': 2090,
  'Copo Tropical': 790,
  'Milk-shake de Açaí': 1290
};

const extras = {
  'Leite em pó': 0,
  'Morango': 0,
  'Banana': 0,
  'Nutella': 0,
  'Granola': 0,
  'Leite condensado': 0
};

const SUNIZE_URL = 'https://api.sunize.com.br/v2/transactions';
const DELIVERY_FEE_CENTS = 0;

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function json(value, status = 200) {
  return Response.json(value, {
    status,
    headers: {
      'Cache-Control': 'no-store',
      'X-Content-Type-Options': 'nosniff'
    }
  });
}

function checkCpf(value) {
  const cpf = String(value || '').replace(/\D/g, '');

  if (cpf.length !== 11 || /^(\d)\1{10}$/.test(cpf)) {
    return null;
  }

  for (let i = 9; i <= 10; i++) {
    let sum = 0;

    for (let j = 0; j < i; j++) {
      sum += Number(cpf[j]) * (i + 1 - j);
    }

    const digit = ((sum * 10) % 11) % 10;

    if (digit !== Number(cpf[i])) return null;
  }

  return cpf;
}

function validate(body) {
  const c = body?.customer;
  const entries = body?.items;

  if (
    !c ||
    typeof c.name !== 'string' ||
    c.name.trim().length < 2 ||
    c.name.length > 100 ||
    typeof c.phone !== 'string' ||
    !/^\+?[\d\s()-]{10,20}$/.test(c.phone) ||
    c.delivery !== 'Entrega' ||
    c.payment !== 'Pix'
  ) {
    throw Error('Revise os dados do cliente e escolha Pix.');
  }

  const phone = c.phone.replace(/\D/g, '');

  const national =
    phone.startsWith('55') &&
    (phone.length === 12 || phone.length === 13)
      ? phone.slice(2)
      : phone;

  if (!/^\d{10,11}$/.test(national)) {
    throw Error('WhatsApp inválido (inclua DDD).');
  }

  if (
    typeof c.email !== 'string' ||
    c.email.length > 254 ||
    !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(c.email)
  ) {
    throw Error('Informe um e-mail válido.');
  }

  const cpf = checkCpf(c.cpf);

  if (!cpf) throw Error('Informe um CPF válido.');

  if (
    typeof c.address !== 'string' ||
    c.address.trim().length < 8 ||
    c.address.length > 300
  ) {
    throw Error('Informe o endereço completo.');
  }

  if (
    !Array.isArray(entries) ||
    entries.length < 1 ||
    entries.length > 40
  ) {
    throw Error('Carrinho inválido.');
  }

  let total = 0;

  const items = entries.map(item => {
    if (
      !item ||
      !Object.hasOwn(catalog, item.name) ||
      !Number.isInteger(item.qty) ||
      item.qty < 1 ||
      item.qty > 30 ||
      !Array.isArray(item.extras) ||
      item.extras.length > 6 ||
      new Set(item.extras).size !== item.extras.length ||
      item.extras.some(e => !Object.hasOwn(extras, e))
    ) {
      throw Error('Produto ou adicional inválido.');
    }

    const price =
      catalog[item.name] +
      item.extras.reduce((a, e) => a + extras[e], 0);

    total += price * item.qty;

    return {
      name: item.name,
      extras: item.extras,
      qty: item.qty,
      unit_price_cents: price
    };
  });

  if (total <= 0 || total > 2000000) {
    throw Error('Valor do pedido inválido.');
  }

  const order = {
    id: crypto.randomUUID(),
    customer_name: c.name.trim(),
    customer_phone: c.phone.trim(),
    delivery_type: 'Entrega',
    delivery_address: c.address.trim(),
    items,
    total_cents: total + DELIVERY_FEE_CENTS,
    payment_method: 'Pix',
    status: 'pending_payment'
  };

  return {
    order,
    customer: {
      name: order.customer_name,
      email: c.email.trim(),
      phone: `+55${national}`,
      document_type: 'CPF',
      document: cpf
    }
  };
}

function dbUrl(env, suffix) {
  if (
    !env.SUPABASE_URL ||
    !env.SUPABASE_SERVICE_ROLE_KEY ||
    !/^https:\/\/[a-z0-9-]+\.supabase\.co\/?$/.test(env.SUPABASE_URL)
  ) {
    throw Error('Banco não configurado.');
  }

  return (
    env.SUPABASE_URL.replace(/\/$/, '') +
    '/rest/v1/' +
    suffix
  );
}

async function dbCall(env, suffix, opts = {}) {
  const r = await fetch(dbUrl(env, suffix), {
    method: opts.method || 'GET',
    headers: {
      apikey: env.SUPABASE_SERVICE_ROLE_KEY,
      Authorization: `Bearer ${env.SUPABASE_SERVICE_ROLE_KEY}`,
      'Content-Type': 'application/json',
      Prefer: opts.prefer || 'return=representation'
    },
    body: opts.body ? JSON.stringify(opts.body) : undefined
  });

  if (!r.ok) {
    console.error('Supabase status:', r.status);
    throw Error('Erro ao acessar banco.');
  }

  return opts.prefer === 'return=minimal'
    ? null
    : r.json();
}

function sunizeHeaders(env) {
  if (!env.SUNIZE_API_KEY || !env.SUNIZE_API_SECRET) {
    throw Error('Sunize não configurada.');
  }

  return {
    'x-api-key': env.SUNIZE_API_KEY,
    'x-api-secret': env.SUNIZE_API_SECRET,
    'Content-Type': 'application/json'
  };
}

async function sunizeGet(env, id) {
  if (
    typeof id !== 'string' ||
    !/^[\w-]{1,120}$/.test(id)
  ) {
    throw Error('ID inválido.');
  }

  const response = await fetch(
    `${SUNIZE_URL}/${encodeURIComponent(id)}`,
    { headers: sunizeHeaders(env) }
  );

  if (!response.ok) {
    console.error('Consulta Sunize status:', response.status);
    throw Error('Falha na consulta da Sunize.');
  }

  return response.json();
}

/* =====================================
   CHECKOUT
===================================== */

async function checkout(request, env) {
  if (request.method !== 'POST') {
    return json({ error: 'Método não permitido.' }, 405);
  }

  if (
    !request.headers.get('content-type')
      ?.includes('application/json')
  ) {
    return json({ error: 'Envie JSON.' }, 415);
  }

  let data;

  try {
    const raw = await request.text();

    if (raw.length > 16000) {
      return json({ error: 'Pedido muito grande.' }, 413);
    }

    const input = JSON.parse(raw);

    if (
      typeof input?.checkout_request_id !== 'string' ||
      !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(
        input.checkout_request_id
      )
    ) {
      return json({
        error: 'Atualize a página: identificador do pedido ausente ou inválido.'
      }, 400);
    }

    data = validate(input);

    data.order.checkout_request_id =
      input.checkout_request_id.toLowerCase();

  } catch (e) {
    return json({
      error: e.message || 'Pedido inválido.'
    }, 400);
  }

  const { order, customer } = data;

  const filter =
    'orders?checkout_request_id=eq.' +
    encodeURIComponent(order.checkout_request_id) +
    '&select=id,customer_name,customer_phone,delivery_type,delivery_address,items,total_cents,payment_method,status';

  const sameOrder = existing => {
    if (
      !existing ||
      existing.customer_name !== order.customer_name ||
      existing.customer_phone !== order.customer_phone ||
      existing.delivery_type !== order.delivery_type ||
      (existing.delivery_address ?? null) !== order.delivery_address ||
      existing.total_cents !== order.total_cents ||
      existing.payment_method !== 'Pix' ||
      !Array.isArray(existing.items) ||
      existing.items.length !== order.items.length
    ) {
      return false;
    }

    return existing.items.every((a, i) => {
      const b = order.items[i];

      return (
        a.name === b.name &&
        a.qty === b.qty &&
        a.unit_price_cents === b.unit_price_cents &&
        Array.isArray(a.extras) &&
        a.extras.length === b.extras.length &&
        a.extras.every((v, j) => v === b.extras[j])
      );
    });
  };

  async function existingReceipt() {
    const rows = await dbCall(env, filter);

    if (!Array.isArray(rows)) {
      throw Error('Resposta inesperada do banco.');
    }

    if (!rows.length) return null;

    const old = rows[0];

    if (!sameOrder(old, order)) {
      return json({
        error: 'Esta tentativa já pertence a um pedido diferente. Confira o pedido anterior.'
      }, 409);
    }

    if (
      env.SUNIZE_PAYMENTS_ENABLED === 'true' ||
      old.status !== 'pending_payment'
    ) {
      return json({
        orderId: old.id,
        error: 'Pedido já existente. Consulte o status antes de tentar novamente.'
      }, 409);
    }

    return json({
      orderId: old.id,
      status: 'pending_payment',
      message: 'Pedido de teste já registrado. Nenhum novo pedido foi criado.'
    });
  }

  try {
    const previous = await existingReceipt();

    if (previous) return previous;

  } catch (e) {
    console.error('Falha ao procurar pedido:', e.message);

    return json({
      error: 'Não foi possível confirmar a tentativa anterior.'
    }, 503);
  }

  try {
    await dbCall(env, 'orders', {
      method: 'POST',
      body: order,
      prefer: 'return=minimal'
    });

  } catch (e) {
    try {
      const previous = await existingReceipt();
      if (previous) return previous;
    } catch (readError) {
      console.error('Falha ao recuperar pedido:', readError.message);
    }

    return json({
      error: 'Não foi possível confirmar o registro. Verifique o pedido antes de tentar novamente.'
    }, 503);
  }

  // Pagamentos reais ficam desligados por padrão.
  if (env.SUNIZE_PAYMENTS_ENABLED !== 'true') {
    return json({
      orderId: order.id,
      status: 'pending_payment',
      message: 'Pedido registrado para teste. Pix ainda desativado: não realize pagamento.'
    }, 201);
  }

  try {
    const updated = await dbCall(
      env,
      `orders?id=eq.${encodeURIComponent(order.id)}&status=eq.pending_payment`,
      {
        method: 'PATCH',
        body: { status: 'creating_payment' }
      }
    );

    if (!Array.isArray(updated) || updated.length !== 1) {
      throw Error('Estado de pedido inválido.');
    }

    const payload = {
      external_id: order.id,
      amount: order.total_cents / 100,
      payment_method: 'PIX',

      items: order.items.map((it, n) => ({
        id: String(n + 1),
        title: it.name,
        description: it.extras.length
          ? it.extras.join(', ')
          : 'Sem adicionais',
        price: it.unit_price_cents / 100,
        quantity: it.qty,
        is_physical: true
      })),

      ip: request.headers.get('CF-Connecting-IP') || undefined,
      customer
    };

    const response = await fetch(SUNIZE_URL, {
      method: 'POST',
      headers: sunizeHeaders(env),
      body: JSON.stringify(payload)
    });

    if (!response.ok) {
      console.error('Criar Sunize status:', response.status);
      throw Error('Sunize recusou criar cobrança.');
    }

    const payment = await response.json();

    if (
      !payment?.id ||
      !payment?.pix?.payload ||
      payment.external_id !== order.id ||
      payment.payment_method !== 'PIX' ||
      Math.round(Number(payment.amount) * 100) !== order.total_cents
    ) {
      throw Error('Resposta de cobrança inesperada.');
    }

    const saved = await dbCall(
      env,
      `orders?id=eq.${encodeURIComponent(order.id)}&status=eq.creating_payment`,
      {
        method: 'PATCH',
        body: {
          status: 'awaiting_payment',
          provider_payment_id: payment.id
        }
      }
    );

    if (!Array.isArray(saved)) {
      throw Error('Resposta inesperada do banco.');
    }

    if (saved.length === 0) {
      const current = await dbCall(
        env,
        `orders?id=eq.${encodeURIComponent(order.id)}` +
        '&select=status,provider_payment_id'
      );

      if (
        !Array.isArray(current) ||
        current.length !== 1 ||
        current[0].provider_payment_id !== payment.id ||
        !['paid', 'awaiting_payment'].includes(current[0].status)
      ) {
        throw Error('Vínculo da cobrança não confirmado.');
      }

    } else if (
      saved.length !== 1 ||
      saved[0].provider_payment_id !== payment.id ||
      saved[0].status !== 'awaiting_payment'
    ) {
      throw Error('Vínculo da cobrança inconsistente.');
    }

    return json({
      orderId: order.id,
      status: 'awaiting_payment',
      pixPayload: payment.pix.payload,
      amount: order.total_cents / 100
    }, 201);

  } catch (error) {
    console.error('Pagamento não finalizado:', error.message);

    return json({
      orderId: order.id,
      status: 'creating_payment',
      error: 'Não foi possível disponibilizar o Pix. Verifique o pedido antes de tentar novamente.'
    }, 503);
  }
}

/* =====================================
   WEBHOOK SUNIZE
===================================== */

function safeEqual(a, b) {
  if (
    typeof a !== 'string' ||
    typeof b !== 'string'
  ) {
    return false;
  }

  const aa = new TextEncoder().encode(a);
  const bb = new TextEncoder().encode(b);

  let diff = aa.length ^ bb.length;

  for (let i = 0; i < Math.max(aa.length, bb.length); i++) {
    diff |= (aa[i] || 0) ^ (bb[i] || 0);
  }

  return diff === 0;
}

async function registrarEvento(env, hook, verified, order) {
  await dbCall(
    env,
    'payment_events?on_conflict=provider,provider_event_id',
    {
      method: 'POST',
      prefer: 'resolution=ignore-duplicates,return=minimal',
      body: {
        provider: 'sunize',
        provider_event_id: `${hook.id}:${verified.status}`,
        order_id: order.id,
        event_type: verified.status
      }
    }
  );
}

async function webhook(request, env) {
  if (request.method !== 'POST') {
    return json({ error: 'Método não permitido' }, 405);
  }

  if (
    !env.SUNIZE_API_SECRET ||
    !safeEqual(
      request.headers.get('x-api-secret'),
      env.SUNIZE_API_SECRET
    )
  ) {
    return json({ error: 'Não autorizado' }, 401);
  }

  let hook;

  try {
    const raw = await request.text();

    if (raw.length > 16000) {
      return json({ error: 'Evento muito grande' }, 413);
    }

    hook = JSON.parse(raw);

  } catch {
    return json({ error: 'Evento inválido' }, 400);
  }

  if (
    typeof hook?.id !== 'string' ||
    !/^[\w-]{1,120}$/.test(hook.id) ||
    typeof hook?.external_id !== 'string' ||
    !UUID_RE.test(hook.external_id)
  ) {
    return json({ error: 'Evento incompleto' }, 400);
  }

  try {
    const rows = await dbCall(
      env,
      `orders?id=eq.${encodeURIComponent(hook.external_id)}` +
      '&select=id,total_cents,status,provider_payment_id'
    );

    if (!Array.isArray(rows) || rows.length !== 1) {
      return json({ error: 'Pedido não encontrado' }, 404);
    }

    const order = rows[0];

    // Confirma diretamente com a Sunize.
    const verified = await sunizeGet(env, hook.id);

    if (
      verified.id !== hook.id ||
      verified.external_id !== order.id ||
      verified.payment_method !== 'PIX' ||
      !Number.isFinite(Number(verified.amount)) ||
      Math.round(Number(verified.amount) * 100) !== order.total_cents
    ) {
      return json({ error: 'Dados divergentes' }, 409);
    }

    if (
      order.provider_payment_id &&
      order.provider_payment_id !== hook.id
    ) {
      return json({
        error: 'Outra transação já vinculada'
      }, 409);
    }

    const missingLink = !order.provider_payment_id;

    if (
      missingLink &&
      order.status !== 'creating_payment'
    ) {
      return json({
        error: 'Associação pendente de revisão'
      }, 409);
    }

    const transitions = {
      AUTHORIZED: {
        target: 'paid',
        from: ['awaiting_payment', 'creating_payment']
      },
      FAILED: {
        target: 'failed',
        from: ['awaiting_payment', 'creating_payment']
      },
      REFUNDED: {
        target: 'refunded',
        from: ['paid', 'in_dispute', 'awaiting_payment']
      },
      CHARGEBACK: {
        target: 'chargeback',
        from: ['paid', 'in_dispute', 'awaiting_payment']
      },
      IN_DISPUTE: {
        target: 'in_dispute',
        from: ['paid']
      }
    };

    const transition =
      verified.status === 'PENDING'
        ? {
            target: 'awaiting_payment',
            from: ['creating_payment']
          }
        : transitions[verified.status];

    if (!transition) {
      return json({ error: 'Status desconhecido' }, 422);
    }

    // Se o estado já foi alterado, recupera o histórico.
    if (
      !missingLink &&
      order.status === transition.target
    ) {
      try {
        await registrarEvento(env, hook, verified, order);
      } catch (error) {
        console.error('Falha ao recuperar histórico:', error.message);

        return json({
          error: 'Histórico do pagamento ainda não registrado.'
        }, 503);
      }

      return json({
        ok: true,
        duplicate: true,
        status: order.status
      });
    }

    if (!transition.from.includes(order.status)) {
      return json({
        error: 'Revisão de status necessária'
      }, 409);
    }

    const filter =
      `orders?id=eq.${encodeURIComponent(order.id)}` +
      `&status=eq.${encodeURIComponent(order.status)}` +
      (
        missingLink
          ? '&provider_payment_id=is.null'
          : `&provider_payment_id=eq.${encodeURIComponent(hook.id)}`
      );

    const body = {
      status: transition.target
    };

    if (missingLink) {
      body.provider_payment_id = hook.id;
    }

    const updated = await dbCall(
      env,
      filter,
      {
        method: 'PATCH',
        body
      }
    );

    if (!Array.isArray(updated) || updated.length !== 1) {
      return json({
        error: 'Estado alterado; consulte o pedido'
      }, 409);
    }

    try {
      await registrarEvento(env, hook, verified, order);
    } catch (error) {
      console.error('Falha ao registrar evento:', error.message);

      return json({
        error: 'Pagamento verificado, mas o histórico não foi registrado. Revisão necessária.'
      }, 503);
    }

    return json({
      ok: true,
      status: transition.target,
      recovered: missingLink
    });

  } catch (error) {
    console.error('Webhook falhou:', error.message);

    return json({
      error: 'Falha na verificação'
    }, 503);
  }
}

/* =====================================
   CONSULTA DE PAGAMENTO
===================================== */

async function consultarStatusPedido(request, env) {
  if (request.method !== 'GET') {
    return json({ error: 'Método não permitido' }, 405);
  }

  const id = new URL(request.url).searchParams.get('id');

  if (!id || !UUID_RE.test(id)) {
    return json({ error: 'Pedido inválido' }, 400);
  }

  try {
    const rows = await dbCall(
      env,
      `orders?id=eq.${encodeURIComponent(id)}&select=status`
    );

    if (!Array.isArray(rows) || rows.length !== 1) {
      return json({ error: 'Pedido não encontrado' }, 404);
    }

    return json({
      status: rows[0].status
    });

  } catch (error) {
    console.error('Consulta de status falhou:', error.message);

    return json({
      error: 'Não foi possível consultar o pedido'
    }, 503);
  }
}

/* =====================================
   AUTENTICAÇÃO ADMINISTRATIVA
===================================== */

function supabaseAuthBase(env) {
  dbUrl(env, 'orders');

  if (!env.SUPABASE_PUBLISHABLE_KEY) {
    throw Error('Chave pública Supabase não configurada.');
  }

  return env.SUPABASE_URL.replace(/\/$/, '') + '/auth/v1';
}

async function verificarAdministrador(request, env) {
  const header = request.headers.get('Authorization') || '';
  const match = /^Bearer ([A-Za-z0-9_.-]+)$/.exec(header);

  if (!match || match[1].length > 8192) {
    return null;
  }

  const response = await fetch(
    supabaseAuthBase(env) + '/user',
    {
      headers: {
        apikey: env.SUPABASE_PUBLISHABLE_KEY,
        Authorization: `Bearer ${match[1]}`
      }
    }
  );

  if (!response.ok) return null;

  const user = await response.json();

  if (!user?.id || !UUID_RE.test(user.id)) {
    return null;
  }

  // A chave privada permanece exclusivamente no Worker.
  const admins = await dbCall(
    env,
    `admin_users?user_id=eq.${encodeURIComponent(user.id)}&select=user_id&limit=1`
  );

  return Array.isArray(admins) && admins.length === 1
    ? user
    : null;
}

async function loginAdministrador(request, env) {
  if (request.method !== 'POST') {
    return json({ error: 'Método não permitido' }, 405);
  }

  try {
    const raw = await request.text();

    if (raw.length > 3000) {
      return json({ error: 'Dados muito grandes' }, 413);
    }

    const input = JSON.parse(raw);

    if (
      typeof input?.email !== 'string' ||
      typeof input?.password !== 'string' ||
      input.email.length > 254 ||
      input.password.length < 1 ||
      input.password.length > 1024
    ) {
      return json({ error: 'Informe e-mail e senha' }, 400);
    }

    const response = await fetch(
      supabaseAuthBase(env) + '/token?grant_type=password',
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          apikey: env.SUPABASE_PUBLISHABLE_KEY
        },
        body: JSON.stringify({
          email: input.email.trim(),
          password: input.password
        })
      }
    );

    if (!response.ok) {
      return json({
        error: 'Credenciais inválidas ou acesso não autorizado'
      }, 401);
    }

    const data = await response.json();

    if (
      !data?.access_token ||
      typeof data.access_token !== 'string'
    ) {
      return json({ error: 'Resposta de login inválida' }, 502);
    }

    const authenticatedRequest = new Request(request.url, {
      headers: {
        Authorization: `Bearer ${data.access_token}`
      }
    });

    const admin = await verificarAdministrador(
      authenticatedRequest,
      env
    );

    if (!admin) {
      return json({ error: 'Acesso não autorizado' }, 403);
    }

    return json({
      access_token: data.access_token,
      expires_in: data.expires_in || 3600
    });

  } catch (error) {
    console.error('Falha no login administrativo:', error.message);

    return json({
      error: 'Não foi possível entrar agora'
    }, 503);
  }
}

/* =====================================
   LISTAGEM DE PEDIDOS
===================================== */

async function listarPedidosAdmin(request, env) {
  if (request.method !== 'GET') {
    return json({ error: 'Método não permitido' }, 405);
  }

  try {
    const admin = await verificarAdministrador(request, env);

    if (!admin) {
      return json({ error: 'Acesso não autorizado' }, 401);
    }

    const pedidos = await dbCall(
      env,
      
'orders?select=id,created_at,customer_name,customer_phone,delivery_address,items,total_cents,payment_method,status,fulfillment_status&order=created_at.desc&limit=100'
    );

    if (!Array.isArray(pedidos)) {
      throw Error('Resposta inválida de pedidos');
    }

    return json({ orders: pedidos });

  } catch (error) {
    console.error('Erro ao listar pedidos:', error.message);

    return json({
      error: 'Não foi possível listar pedidos'
    }, 503);
  }
}

/* =====================================
   PREPARO E ENTREGA
===================================== */

async function atualizarEntregaAdmin(request, env) {
  if (request.method !== 'PATCH') {
    return json({ error: 'Método não permitido' }, 405);
  }

  try {
    const admin = await verificarAdministrador(request, env);

    if (!admin) {
      return json({ error: 'Acesso não autorizado' }, 401);
    }

    const raw = await request.text();

    if (raw.length > 1500) {
      return json({ error: 'Requisição muito grande' }, 413);
    }

    const input = JSON.parse(raw);

    const validStatuses = [
      'not_started',
      'preparing',
      'out_for_delivery',
      'delivered',
      'cancelled'
    ];

    if (
      !UUID_RE.test(input?.id || '') ||
      !validStatuses.includes(input?.fulfillment_status)
    ) {
      return json({ error: 'Dados inválidos' }, 400);
    }

    // Não permite preparar ou entregar pedido não pago.
    const paymentCondition =
      ['not_started', 'cancelled'].includes(input.fulfillment_status)
        ? ''
        : '&status=eq.paid';

    const changed = await dbCall(
      env,
      `orders?id=eq.${encodeURIComponent(input.id)}${paymentCondition}&select=id,fulfillment_status`,
      {
        method: 'PATCH',
        body: {
          fulfillment_status: input.fulfillment_status
        }
      }
    );

    if (!Array.isArray(changed) || changed.length !== 1) {
      return json({
        error: 'Pedido não encontrado ou pagamento não confirmado'
      }, 409);
    }

    return json({
      ok: true,
      fulfillment_status: changed[0].fulfillment_status
    });

  } catch (error) {
    console.error('Erro ao atualizar preparo:', error.message);

    return json({
      error: 'Não foi possível atualizar o pedido'
    }, 503);
  }
}

/* =====================================
   PÁGINA DO PAINEL
===================================== */

function paginaAdmin() {
  const html = `<!doctype html>
<html lang="pt-BR">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>Admin | Point do Açaí</title>
<style>
*{box-sizing:border-box}
body{margin:0;background:#f7f3fa;color:#321344;font:16px system-ui,Arial}
header{background:#571b78;color:white;padding:20px 5vw}
h1{margin:0;font-size:24px}
main{max-width:1050px;margin:25px auto;padding:0 16px}
.box{background:white;border-radius:16px;padding:22px;box-shadow:0 5px 25px #45115814;margin:14px 0}
label{display:block;margin:12px 0 5px}
input,select{font:inherit;border:1px solid #d6c9de;border-radius:9px;padding:11px;width:100%}
button{background:#66228c;border:0;color:white;border-radius:10px;padding:11px 17px;font:inherit;cursor:pointer}
button:disabled{opacity:.5;cursor:not-allowed}
.outline{background:#eee5f3;color:#4e1d6a}
.toolbar{display:flex;justify-content:space-between;gap:10px;align-items:center;flex-wrap:wrap}
.muted{color:#725e7a;font-size:14px}
.error{color:#aa2040}
.success{color:#188052}
article{border-top:1px solid #eee0f2;padding:16px 0;overflow-wrap:anywhere}
article:first-of-type{border-top:0}
.cols{display:grid;grid-template-columns:repeat(auto-fit,minmax(230px,1fr));gap:10px}
.pill{display:inline-block;background:#f0e7f5;border-radius:50px;padding:5px 10px;font-size:13px}
ul{padding-left:22px}
#panel{display:none}
</style>
</head>
<body>
<header>
<h1>🍇 Point do Açaí · Administração</h1>
</header>
<main>
<section id="login" class="box">
<h2>Acesso administrativo</h2>
<p class="muted">Entre com o usuário cadastrado no Supabase.</p>
<form id="loginForm">
<label for="email">E-mail</label>
<input id="email" type="email" autocomplete="username" required>
<label for="password">Senha</label>
<input id="password" type="password" autocomplete="current-password" required>
<p><button type="submit">Entrar</button></p>
</form>
<p id="loginMsg" role="alert" class="error"></p>
</section>

<section id="panel">
<div class="box toolbar">
<h2>Pedidos</h2>
<div>
<button id="refresh" type="button">Atualizar</button>
<button id="logout" class="outline" type="button">Sair</button>
</div>
</div>
<p id="info" role="status"></p>
<div id="orders" class="box"></div>
</section>
</main>

<script>
'use strict';

let token = null;

const $ = id => document.getElementById(id);

const payment = {
  pending_payment: 'Aguardando Pix',
  creating_payment: 'Criando Pix',
  awaiting_payment: 'Pix pendente',
  paid: 'Pago',
  failed: 'Falhou',
  refunded: 'Estornado',
  chargeback: 'Contestação',
  in_dispute: 'Em disputa'
};

const delivery = {
  not_started: 'Não iniciado',
  preparing: 'Em preparo',
  out_for_delivery: 'Saiu para entrega',
  delivered: 'Entregue',
  cancelled: 'Cancelado'
};

const money = cents =>
  (Number(cents || 0) / 100).toLocaleString('pt-BR', {
    style: 'currency',
    currency: 'BRL'
  });

function elt(tag, text, className) {
  const element = document.createElement(tag);
  if (text != null) element.textContent = String(text);
  if (className) element.className = className;
  return element;
}

function line(parent, title, value) {
  const paragraph = elt('p');
  paragraph.append(
    elt('strong', title + ': '),
    document.createTextNode(String(value ?? '—'))
  );
  parent.append(paragraph);
}

async function api(url, options = {}) {
  const headers = {
    'Content-Type': 'application/json',
    ...(token ? { Authorization: 'Bearer ' + token } : {})
  };

  const response = await fetch(url, {
    ...options,
    headers,
    cache: 'no-store'
  });

  const data = await response.json();

  if (!response.ok) {
    throw Error(data.error || 'Falha na solicitação');
  }

  return data;
}

$('loginForm').addEventListener('submit', async event => {
  event.preventDefault();
  $('loginMsg').textContent = 'Verificando...';

  const button = event.target.querySelector('button');
  button.disabled = true;

  try {
    const data = await api('/api/admin/login', {
      method: 'POST',
      body: JSON.stringify({
        email: $('email').value,
        password: $('password').value
      })
    });

    token = data.access_token;

    $('password').value = '';
    $('login').style.display = 'none';
    $('panel').style.display = 'block';

    await load();

  } catch (error) {
    $('loginMsg').textContent = error.message;
  } finally {
    button.disabled = false;
  }
});

function logout() {
  token = null;
  $('orders').replaceChildren();
  $('panel').style.display = 'none';
  $('login').style.display = 'block';
  $('info').textContent = '';
}

$('logout').addEventListener('click', logout);
$('refresh').addEventListener('click', load);

async function load() {
  $('info').textContent = 'Carregando...';

  try {
    const result = await api('/api/admin/orders');
    const orders = result.orders;

    $('orders').replaceChildren();

    $('info').textContent =
      orders.length + ' pedido(s) · até 100 mais recentes';

    if (!orders.length) {
      $('orders').append(
        elt('p', 'Nenhum pedido encontrado.')
      );
      return;
    }

    for (const order of orders) {
      const card = elt('article');

      card.append(
        elt('h3', 'Pedido ' + String(order.id).slice(0, 8))
      );

      const badges = elt('div');

      badges.append(
        elt('span', payment[order.status] || order.status, 'pill'),
        ' ',
        elt(
          'span',
          delivery[order.fulfillment_status] || order.fulfillment_status,
          'pill'
        )
      );

      card.append(badges);

      const cols = elt('div', null, 'cols');
      const a = elt('div');
      const b = elt('div');

      line(a, 'Cliente', order.customer_name);
      line(a, 'WhatsApp', order.customer_phone);
      line(a, 'Endereço', order.delivery_address);

      line(b, 'Total', money(order.total_cents));
      line(b, 'Pagamento', order.payment_method);

      const list = elt('ul');

      for (
        const item of (
          Array.isArray(order.items) ? order.items : []
        )
      ) {
        const li = elt(
          'li',
          (item.qty || 1) +
          ' × ' +
          (item.name || 'Produto') +
          (
            Array.isArray(item.extras) && item.extras.length
              ? ' (' + item.extras.join(', ') + ')'
              : ''
          )
        );

        list.append(li);
      }

      b.append(elt('strong', 'Itens:'), list);
      cols.append(a, b);
      card.append(cols);

      const label = elt('label', 'Andamento do pedido');
      const select = elt('select');

      for (const [value, name] of Object.entries(delivery)) {
        const option = elt('option', name);
        option.value = value;
        select.append(option);
      }

      select.value =
        order.fulfillment_status || 'not_started';

      const save = elt('button', 'Salvar andamento');
      save.type = 'button';
      save.disabled = true;

      select.addEventListener('change', () => {
        save.disabled = false;
      });

      const status = elt('p', '', 'muted');

      save.addEventListener('click', async () => {
        save.disabled = true;
        status.textContent = 'Salvando...';

        try {
          await api('/api/admin/fulfillment', {
            method: 'PATCH',
            body: JSON.stringify({
              id: order.id,
              fulfillment_status: select.value
            })
          });

          status.textContent = 'Andamento atualizado.';
          status.className = 'success';

        } catch (error) {
          status.textContent = error.message;
          status.className = 'error';
          save.disabled = false;
        }
      });

      card.append(label, select);

      const actions = elt('p');
      actions.append(save);

      card.append(actions, status);
      $('orders').append(card);
    }

  } catch (error) {
    $('info').textContent = error.message;

    if (error.message === 'Acesso não autorizado') {
      logout();
    }
  }
}
</script>
</body>
</html>`;

  return new Response(html, {
    headers: {
      'Content-Type': 'text/html; charset=utf-8',
      'Cache-Control': 'no-store',
      'X-Content-Type-Options': 'nosniff',
      'Referrer-Policy': 'no-referrer',
      'X-Frame-Options': 'DENY',
      'Content-Security-Policy':
        "default-src 'none'; " +
        "script-src 'unsafe-inline'; " +
        "style-src 'unsafe-inline'; " +
        "connect-src 'self'; " +
        "base-uri 'none'; " +
        "form-action 'self'; " +
        "frame-ancestors 'none'"
    }
  });
}

/* =====================================
   ROTAS DO WORKER
===================================== */

export default {
  async fetch(request, env) {
    const path = new URL(request.url).pathname;

    if (path === '/admin' || path === '/admin/') {
      return paginaAdmin();
    }

    if (path === '/api/admin/login') {
      return loginAdministrador(request, env);
    }

    if (path === '/api/admin/orders') {
      return listarPedidosAdmin(request, env);
    }

    if (path === '/api/admin/fulfillment') {
      return atualizarEntregaAdmin(request, env);
    }

    if (path === '/api/teste') {
      return json({
        sucesso: true,
        mensagem: 'API Point do Açaí funcionando!'
      });
    }

    if (path === '/api/checkout') {
      return checkout(request, env);
    }

    if (path === '/api/status-pedido') {
      return consultarStatusPedido(request, env);
    }

    if (path === '/api/webhook-sunize') {
      return webhook(request, env);
    }

    if (path.startsWith('/api/')) {
      return json({
        error: 'API não configurada.'
      }, 404);
    }

    return env.ASSETS.fetch(request);
  }
};
