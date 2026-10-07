import type { Instrumentation } from "next";

export async function register() {}

/** Todo erro não tratado do servidor (páginas, ações e rotas) passa aqui e vai para o monitoramento. */
export const onRequestError: Instrumentation.onRequestError = async (err, request, context) => {
  const e = err as Error & { digest?: string };
  // redirect() e notFound() do Next não são erros
  if (e?.digest && String(e.digest).startsWith("NEXT_")) return;
  // a condição precisa estar inline para o Next tirar o banco do pacote do edge
  if (process.env.NEXT_RUNTIME === "nodejs") {
    const { reportError } = await import("./server/services/monitoring");
    await reportError({ message: e?.message || String(err), stack: e?.stack, path: request.path, kind: `${context.routeType} ${request.method}` });
  }
};
