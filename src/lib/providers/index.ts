/**
 * Registro de proveedores stateless + despacho normalizado.
 *
 * Las rutas llaman a `generateStateless(provider, opts)` y reciben siempre un
 * `ProviderAnswer`, sin acoplarse a la implementación concreta. Añadir un
 * proveedor nuevo = una entrada más aquí.
 *
 * El agente ("agent") NO se despacha aquí porque es stateful (hilos/secciones +
 * persistencia + reconciliación); su lógica permanece en las rutas como backup.
 */

import { answerViaMcp } from "../knowledge";
import { kaGenerate } from "./ka";
import { DEFAULT_PROVIDER, type GenerateOpts, type ProviderAnswer, type ProviderId } from "./types";

export { DEFAULT_PROVIDER };
export type { ProviderId, ProviderAnswer, GenerateOpts };

/** Normaliza el valor recibido del cliente a un ProviderId (por defecto "ka"). */
export function resolveProvider(backend?: string): ProviderId {
  if (backend === "agent" || backend === "mcp" || backend === "ka") return backend;
  return DEFAULT_PROVIDER;
}

/** ¿Es un proveedor stateless (KA/MCP) que se puede resolver aquí? */
export function isStateless(provider: ProviderId): boolean {
  return provider === "ka" || provider === "mcp";
}

/** Genera una respuesta con un proveedor stateless. */
export async function generateStateless(
  provider: ProviderId,
  opts: GenerateOpts
): Promise<ProviderAnswer> {
  if (provider === "ka") {
    return kaGenerate(opts);
  }
  if (provider === "mcp") {
    // Reutilizamos el helper MCP existente y lo adaptamos a ProviderAnswer.
    const { answer, sourcesText, sources } = await answerViaMcp(opts.question, {
      mode: opts.mode,
      structured: opts.structured,
      context: opts.context,
    });
    return { answer, sourcesText, sources, expert: "knowledge_base", threadId: "" };
  }
  throw new Error(`Provider "${provider}" is not stateless; handle it in the route.`);
}
