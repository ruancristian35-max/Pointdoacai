
export default {
  async fetch(request, env) {
    const url = new URL(request.url);

    if (url.pathname === "/api/teste") {
      return Response.json({
        sucesso: true,
        mensagem: "API Point do Açaí funcionando!"
      });
    }

    if (url.pathname.startsWith("/api/")) {
      return Response.json(
        { error: "API ainda não configurada" },
        { status: 404 }
      );
    }

    return env.ASSETS.fetch(request);
  }
};
