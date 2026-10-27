const catalog = {
  "Açaí Tradicional": 1490,
  "Açaí Especial": 2190,
  "Açaí Família": 3990,
  "Combo Casal": 3990,
  "Copo Tropical": 1990,
  "Milk-shake de Açaí": 1790
};

const extras = {
  "Leite em pó": 300,
  "Morango": 400,
  "Banana": 200,
  "Nutella": 600,
  "Granola": 200,
  "Leite condensado": 300
};

const SUNIZE_URL = "https://api.sunize.com.br/v2/transactions";

function json(value, status = 200) {
  return Response.json(value, {
    status,
    headers: { "Cache-Control": "no-store" }
  });
}

function checkCpf(value) {
  const cpf = String(value || "").replace(/\D/g, "");

  if (cpf.length !== 11 || /^(\d)\1{10}$/.test(cpf)) {
    return null;
  }

  for (let i = 9; i <= 10; i++) {
    let sum = 0;

    for (let j = 0; j < i; j++) {
      sum += Number(cpf[j]) * (i + 1 - j);
    }

    const digit = (sum * 10) % 11 % 10;

    if (digit !== Number(cpf[i])) {
      return null;
    }
  }

  return cpf;
}

function validate(body) {
  const c = body?.customer;
  const entries = body?.items;

  if (
    !c ||
    typeof c.name !== "string" ||
    c.name.trim().length < 2 ||
    c.name.length > 100 ||
    typeof c.phone !== "string" ||
    !/^\+?[\d\s()-]{10,20}$/.test(c.phone) ||
    !["Entrega", "Retirada"].includes(c.delivery) ||
    c.payment !== "Pix"
  ) {
    throw Error("Revise os dados do cliente e escolha Pix.");
  }

  const phone = c.phone.replace(/\D/g, "");

  const national =
    phone.startsWith("55") &&
    (phone.length === 12 || phone.length === 13)
      ? phone.slice(2)
      : phone;

  if (!/^\d{10,11}$/.test(national)) {
    throw Error("WhatsApp inválido (inclua DDD).");
  }

  if (
    typeof c.email !== "string" ||
    c.email.length > 254 ||
    !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(c.email)
  ) {
    throw Error("Informe um e-mail válido.");
  }

  const cpf = checkCpf(c.cpf);

  if (!cpf) {
    throw Error("Informe um CPF válido.");
  }

  if (
    c.delivery === "Entrega" &&
    (
      typeof c.address !== "string" ||
      c.address.trim().length < 8 ||
      c.address.length > 300
    )
  ) {
    throw Error("Informe o endereço completo.");
  }

  if (
    !Array.isArray(entries) ||
    !entries.length ||
    entries.length > 40
  ) {
    throw Error("Carrinho inválido.");
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
      throw Error("Produto ou adicional inválido.");
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
    throw Error("Valor do pedido inválido.");
  }

  const order = {
    id: crypto.randomUUID(),
    customer_name: c.name.trim(),
    customer_phone: c.phone.trim(),
    delivery_type: c.delivery,
    delivery_address:
      c.delivery === "Entrega" ? c.address.trim() : null,
    items,
    total_cents: total,
    payment_method: "Pix",
    status: "pending_payment"
  };

  return {
    order,
    customer: {
      name: order.customer_name,
      email: c.email.trim(),
      phone: `+55${national}`,
      document_type: "CPF",
      document: cpf
    }
  };
}

function dbHeaders(env, prefer = "return=representation") {
  return {
    apikey: env.SUPABASE_SERVICE_ROLE_KEY,
    Authorization: `Bearer ${env.SUPABASE_SERVICE_ROLE_KEY}`,
    "Content-Type": "application/json",
    Prefer: prefer
  };
}

function dbUrl(env, suffix) {
  if (
    !env.SUPABASE_URL ||
    !env.SUPABASE_SERVICE_ROLE_KEY ||
    !/^https:\/\/[a-z0-9-]+\.supabase\.co\/?$/.test(
      env.SUPABASE_URL
    )
  ) {
    throw Error("Banco não configurado.");
  }

  return (
    `${env.SUPABASE_URL.replace(/\/$/, "")}` +
    `/rest/v1/${suffix}`
  );
}

async function dbCall(env, suffix, opts = {}) {
  const r = await fetch(dbUrl(env, suffix), {
    method: opts.method || "GET",
    headers: dbHeaders(env, opts.prefer),
    body: opts.body
      ? JSON.stringify(opts.body)
      : undefined
  });

  if (!r.ok) {
    console.error("Supabase status:", r.status);
    throw Error("Erro ao acessar banco.");
  }

  return opts.prefer === "return=minimal"
    ? null
    : r.json();
}

function sunizeHeaders(env) {
  if (!env.SUNIZE_API_KEY || !env.SUNIZE_API_SECRET) {
    throw Error("Sunize não configurada.");
  }

  return {
    "x-api-key": env.SUNIZE_API_KEY,
    "x-api-secret": env.SUNIZE_API_SECRET,
    "Content-Type": "application/json"
  };
}

async function sunizeGet(env, id) {
  if (
    typeof id !== "string" ||
    !/^[\w-]{1,120}$/.test(id)
  ) {
    throw Error("ID inválido");
  }

  const r = await fetch(
    `${SUNIZE_URL}/${encodeURIComponent(id)}`,
    { headers: sunizeHeaders(env) }
  );

  if (!r.ok) {
    console.error("Consulta Sunize status:", r.status);
    throw Error("Falha na consulta da Sunize.");
  }

  return r.json();
}

async function checkout(request, env) {
  if (request.method !== "POST") {
    return json({ error: "Método não permitido." }, 405);
  }

  if (
    !request.headers
      .get("content-type")
      ?.includes("application/json")
  ) {
    return json({ error: "Envie JSON." }, 415);
  }

  let data;

  try {
    const raw = await request.text();

    if (raw.length > 16000) {
      return json({ error: "Pedido muito grande." }, 413);
    }

    data = validate(JSON.parse(raw));
  } catch (e) {
    return json(
      { error: e.message || "Pedido inválido." },
      400
    );
  }

  const { order, customer } = data;

  try {
    await dbCall(env, "orders", {
      method: "POST",
      body: order,
      prefer: "return=minimal"
    });
  } catch {
    return json(
      { error: "Não foi possível registrar o pedido no banco." },
      503
    );
  }

  // Pagamentos reais desativados por padrão.
  if (env.SUNIZE_PAYMENTS_ENABLED !== "true") {
    return json({
      orderId: order.id,
      status: "pending_payment",
      message:
        "Pedido registrado para teste. Pix ainda desativado: não realize pagamento."
    }, 201);
  }

  try {
    const updated = await dbCall(
      env,
      `orders?id=eq.${encodeURIComponent(order.id)}` +
      "&status=eq.pending_payment",
      {
        method: "PATCH",
        body: { status: "creating_payment" }
      }
    );

    if (
      !Array.isArray(updated) ||
      updated.length !== 1
    ) {
      throw Error("Estado de pedido inválido.");
    }

    const payload = {
      external_id: order.id,
      amount: order.total_cents / 100,
      payment_method: "PIX",
      items: order.items.map((it, n) => ({
        id: String(n + 1),
        title: it.name,
        description: it.extras.length
          ? it.extras.join(", ")
          : "Sem adicionais",
        price: it.unit_price_cents / 100,
        quantity: it.qty,
        is_physical: true
      })),
      ip:
        request.headers.get("CF-Connecting-IP") ||
        undefined,
      customer
    };

    const r = await fetch(SUNIZE_URL, {
      method: "POST",
      headers: sunizeHeaders(env),
      body: JSON.stringify(payload)
    });

    if (!r.ok) {
      console.error("Criar Sunize status:", r.status);
      throw Error("Sunize recusou criar cobrança.");
    }

    const payment = await r.json();

    if (
      !payment?.id ||
      !payment?.pix?.payload ||
      payment.external_id !== order.id ||
      payment.payment_method !== "PIX" ||
      Math.round(Number(payment.amount) * 100) !==
        order.total_cents
    ) {
      throw Error("Resposta de cobrança inesperada.");
    }

    await dbCall(
      env,
      `orders?id=eq.${encodeURIComponent(order.id)}` +
      "&status=eq.creating_payment",
      {
        method: "PATCH",
        body: {
          status: "awaiting_payment",
          provider_payment_id: payment.id
        },
        prefer: "return=minimal"
      }
    );

    return json({
      orderId: order.id,
      status: "awaiting_payment",
      pixPayload: payment.pix.payload,
      amount: order.total_cents / 100
    }, 201);

  } catch (err) {
    console.error(
      "Pagamento não finalizado:",
      err.message
    );

    return json({
      orderId: order.id,
      status: "creating_payment",
      error:
        "Não foi possível disponibilizar o Pix. Não tente pagar ou criar outro pedido até verificar o status."
    }, 503);
  }
}

function safeEqual(a, b) {
  if (
    typeof a !== "string" ||
    typeof b !== "string"
  ) {
    return false;
  }

  const aa = new TextEncoder().encode(a);
  const bb = new TextEncoder().encode(b);

  let diff = aa.length ^ bb.length;

  for (
    let i = 0;
    i < Math.max(aa.length, bb.length);
    i++
  ) {
    diff |= (aa[i] || 0) ^ (bb[i] || 0);
  }

  return diff === 0;
}


async function webhook(request, env) {
  if (request.method !== "POST") {
    return json({ error: "Método não permitido" }, 405);
  }

  if (
    !env.SUNIZE_API_SECRET ||
    !safeEqual(
      request.headers.get("x-api-secret"),
      env.SUNIZE_API_SECRET
    )
  ) {
    return json({ error: "Não autorizado" }, 401);
  }

  let hook;

  try {
    const raw = await request.text();
    if (raw.length > 16000) {
      return json({ error: "Evento muito grande" }, 413);
    }
    hook = JSON.parse(raw);
  } catch {
    return json({ error: "Evento inválido" }, 400);
  }

  if (
    typeof hook?.id !== "string" ||
    typeof hook?.external_id !== "string"
  ) {
    return json({ error: "Evento incompleto" }, 400);
  }

  try {
    const rows = await dbCall(
      env,
      `orders?id=eq.${encodeURIComponent(hook.external_id)}` +
      `&provider_payment_id=eq.${encodeURIComponent(hook.id)}` +
      "&select=id,total_cents,status"
    );

    if (!Array.isArray(rows) || rows.length !== 1) {
      return json({ error: "Transação não associada" }, 404);
    }

    const order = rows[0];

    // Confirma o estado diretamente na Sunize.
    const verified = await sunizeGet(env, hook.id);

    if (
      verified.id !== hook.id ||
      verified.external_id !== order.id ||
      verified.payment_method !== "PIX" ||
      Math.round(Number(verified.amount) * 100) !==
        order.total_cents
    ) {
      return json({ error: "Dados divergentes" }, 409);
    }

    const transitions = {
      AUTHORIZED: {
        target: "paid",
        from: ["awaiting_payment"]
      },
      FAILED: {
        target: "failed",
        from: ["awaiting_payment", "creating_payment"]
      },
      REFUNDED: {
        target: "refunded",
        from: ["paid", "in_dispute", "awaiting_payment"]
      },
      CHARGEBACK: {
        target: "chargeback",
        from: ["paid", "in_dispute", "awaiting_payment"]
      },
      IN_DISPUTE: {
        target: "in_dispute",
        from: ["paid"]
      }
    };

    if (verified.status === "PENDING") {
      return json({ ok: true, status: "pending" });
    }

    const transition = transitions[verified.status];

    if (!transition) {
      return json({ error: "Status desconhecido" }, 422);
    }

    if (order.status === transition.target) {
      return json({ ok: true, duplicate: true });
    }

    if (!transition.from.includes(order.status)) {
      // Solicita nova tentativa/reconciliação; não altera
      // o pedido diante de uma transição inesperada.
      return json({ error: "Revisão de status necessária" }, 409);
    }

    const updated = await dbCall(
      env,
      `orders?id=eq.${encodeURIComponent(order.id)}` +
      `&status=eq.${encodeURIComponent(order.status)}`,
      {
        method: "PATCH",
        body: { status: transition.target }
      }
    );

    if (!Array.isArray(updated) || updated.length !== 1) {
      return json({ error: "Estado mudou; tente novamente" }, 409);
    }

    return json({
      ok: true,
      status: transition.target
    });
  } catch (error) {
    console.error("Webhook falhou:", error.message);
    return json({ error: "Falha na verificação" }, 503);
  }
}

export default {
  async fetch(request, env) {
    const path = new URL(request.url).pathname;

    if (path === "/api/teste") {
      return json({
        sucesso: true,
        mensagem:
          "API Point do Açaí funcionando!"
      });
    }

    if (path === "/api/checkout") {
      return checkout(request, env);
    }

    if (path === "/api/webhook-sunize") {
      return webhook(request, env);
    }

    if (path.startsWith("/api/")) {
      return json(
        { error: "API não configurada." },
        404
      );
    }

    return env.ASSETS.fetch(request);
  }
};

