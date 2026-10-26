
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

function json(data, status = 200) {
  return Response.json(data, {
    status,
    headers: {
      "Cache-Control": "no-store"
    }
  });
}

function validarPedido(body) {
  const customer = body?.customer;
  const items = body?.items;

  if (
    !customer ||
    typeof customer.name !== "string" ||
    customer.name.trim().length < 2 ||
    customer.name.length > 100 ||
    typeof customer.phone !== "string" ||
    !/^\+?[\d\s()-]{10,20}$/.test(customer.phone) ||
    !["Entrega", "Retirada"].includes(customer.delivery) ||
    customer.payment !== "Pix"
  ) {
    throw new Error(
      "Revise os dados do cliente e escolha Pix."
    );
  }

  if (
    customer.delivery === "Entrega" &&
    (
      typeof customer.address !== "string" ||
      customer.address.trim().length < 8 ||
      customer.address.length > 300
    )
  ) {
    throw new Error("Informe o endereço completo.");
  }

  if (
    !Array.isArray(items) ||
    items.length < 1 ||
    items.length > 40
  ) {
    throw new Error("Carrinho inválido.");
  }

  let total = 0;

  const itensValidados = items.map(item => {
    if (
      !item ||
      !Object.hasOwn(catalog, item.name) ||
      !Number.isInteger(item.qty) ||
      item.qty < 1 ||
      item.qty > 30 ||
      !Array.isArray(item.extras) ||
      item.extras.length > 6 ||
      new Set(item.extras).size !== item.extras.length ||
      item.extras.some(
        e => !Object.hasOwn(extras, e)
      )
    ) {
      throw new Error(
        "Produto ou adicional inválido."
      );
    }

    const unit =
      catalog[item.name] +
      item.extras.reduce(
        (sum, e) => sum + extras[e],
        0
      );

    total += unit * item.qty;

    return {
      name: item.name,
      extras: item.extras,
      qty: item.qty,
      unit_price_cents: unit
    };
  });

  if (total <= 0 || total > 2000000) {
    throw new Error("Valor do pedido inválido.");
  }

  return {
    id: crypto.randomUUID(),
    customer_name: customer.name.trim(),
    customer_phone: customer.phone.trim(),
    delivery_type: customer.delivery,
    delivery_address:
      customer.delivery === "Entrega"
        ? customer.address.trim()
        : null,
    items: itensValidados,
    total_cents: total,
    payment_method: "Pix",
    status: "pending_payment"
  };
}

async function checkout(request, env) {
  if (request.method !== "POST") {
    return json(
      { error: "Método não permitido." },
      405
    );
  }

  if (
    !request.headers
      .get("content-type")
      ?.includes("application/json")
  ) {
    return json(
      { error: "Envie um pedido JSON." },
      415
    );
  }

  let body;

  try {
    const raw = await request.text();

    if (raw.length > 16000) {
      return json(
        { error: "Pedido muito grande." },
        413
      );
    }

    body = JSON.parse(raw);
  } catch {
    return json(
      { error: "Dados JSON inválidos." },
      400
    );
  }

  let order;

  try {
    order = validarPedido(body);
  } catch (error) {
    return json(
      { error: error.message },
      400
    );
  }

  if (
    !env.SUPABASE_URL ||
    !env.SUPABASE_SERVICE_ROLE_KEY
  ) {
    return json(
      { error: "Banco não configurado." },
      503
    );
  }

  try {
    const base =
      env.SUPABASE_URL.replace(/\/+$/, "");

    const response = await fetch(
      `${base}/rest/v1/orders`,
      {
        method: "POST",
        headers: {
          apikey:
            env.SUPABASE_SERVICE_ROLE_KEY,
          Authorization:
            `Bearer ${env.SUPABASE_SERVICE_ROLE_KEY}`,
          "Content-Type": "application/json",
          Prefer: "return=minimal"
        },
        body: JSON.stringify(order)
      }
    );

    if (!response.ok) {
      console.error(
        "Erro Supabase:",
        response.status
      );

      return json(
        {
          error:
            "Não foi possível registrar o pedido."
        },
        503
      );
    }

    return json(
      {
        orderId: order.id,
        status: "pending_payment",
        message:
          "Pedido registrado para teste. O Pix ainda não está habilitado. Não realize nenhum pagamento."
      },
      201
    );

  } catch (error) {
    console.error(
      "Falha na conexão com o banco:",
      error.name
    );

    return json(
      {
        error:
          "Falha temporária no servidor."
      },
      503
    );
  }
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);

    if (url.pathname === "/api/teste") {
      return json({
        sucesso: true,
        mensagem:
          "API Point do Açaí funcionando!"
      });
    }

    if (url.pathname === "/api/checkout") {
      return checkout(request, env);
    }

    if (url.pathname.startsWith("/api/")) {
      return json(
        { error: "API não configurada." },
        404
      );
    }

    return env.ASSETS.fetch(request);
  }
};
