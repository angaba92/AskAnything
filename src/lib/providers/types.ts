/**
 * CAPA DE ADAPTADOR DE PROVEEDORES.
 *
 * Desacopla las rutas/UI de la implementación concreta de cada backend. Todos
 * los proveedores stateless devuelven la MISMA forma (`ProviderAnswer`), de modo
 * que añadir o sustituir un proveedor en el futuro es trivial (registro en
 * ./index.ts).
 *
 * Proveedores:
 *   - "ka"    → DY Knowledge Assistant (NUEVO, por defecto).
 *   - "mcp"   → get_dy_knowledge (backup — "DO NOT USE").
 *   - "agent" → Experience OS Agents (backup, con hilo — "DO NOT USE").
 *              El agente es stateful (hilos/secciones + persistencia) y su lógica
 *              vive en las rutas; no se enruta por `generateStateless`.
 */

import type { McpSource } from "../mcpClient";

/** Identificador de proveedor. "ka" es el nuevo por defecto. */
export type ProviderId = "ka" | "mcp" | "agent";

/** Proveedor por defecto de toda la aplicación tras la migración. */
export const DEFAULT_PROVIDER: ProviderId = "ka";

/** Respuesta normalizada e independiente del proveedor. */
export interface ProviderAnswer {
  /** Texto de la respuesta, ya en texto plano listo para mostrar/exportar. */
  answer: string;
  /** URLs de las fuentes citadas (columna "sources" del batch). */
  sourcesText: string;
  /** Fuentes estructuradas (título/uri/razón). */
  sources: McpSource[];
  /** Etiqueta del "experto"/origen (columna "expert" del batch). */
  expert: string;
  /** Id de hilo si el proveedor es threaded ("" para los stateless). */
  threadId: string;
  /** El batch debe revisar esta respuesta antes de enviarla al cliente. */
  reviewRequired?: boolean;
  /** Motivo breve y accionable para la columna editable de revisión. */
  reviewReason?: string;
}

/** Opciones comunes de generación para proveedores stateless. */
export interface GenerateOpts {
  question: string;
  mode?: string;
  structured?: boolean;
  context?: string;
  /** Solicita una autoevaluación separada de confianza para el flujo bulk. */
  confidenceReview?: boolean;
  /** Instrucciones cargadas por el usuario; sustituyen las integradas en Custom. */
  customPrompt?: string;
}
