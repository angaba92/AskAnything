"use client";

import type { ChatMessage } from "@/lib/types";

/** Renderiza texto plano preservando saltos de línea y haciendo clicables las URLs. */
function renderPlain(text: string) {
  return text.split(/(https?:\/\/[^\s]+)/g).map((part, i) =>
    /^https?:\/\//.test(part) ? (
      <a
        key={i}
        href={part.replace(/[.,;:)]+$/, "")}
        target="_blank"
        rel="noopener noreferrer"
        className="text-brand underline underline-offset-2 hover:text-brand-dark"
      >
        {part}
      </a>
    ) : (
      <span key={i}>{part}</span>
    )
  );
}

export default function MessageBubble({ m }: { m: ChatMessage }) {
  const isHuman = m.role === "human";
  return (
    <div className={`flex ${isHuman ? "justify-end" : "justify-start"} mb-4`}>
      <div
        className={`max-w-[75%] rounded-2xl px-4 py-3 text-sm ${
          isHuman
            ? "bg-brand text-white"
            : "bg-white border border-gray-200 text-gray-800"
        }`}
      >
        <p className="whitespace-pre-wrap">
          {isHuman ? m.text : renderPlain(m.text)}
        </p>
        {!isHuman && m.meta?.agentMetadata?.expertSelected && (
          <div className="mt-2 flex flex-wrap gap-1 text-[11px] text-gray-400">
            <span className="rounded bg-gray-100 px-1.5 py-0.5">
              expert: {m.meta.agentMetadata.expertSelected}
            </span>
            {m.meta.agentMetadata.toolsUsed?.length ? (
              <span className="rounded bg-gray-100 px-1.5 py-0.5">
                tools: {Array.from(new Set(m.meta.agentMetadata.toolsUsed)).join(", ")}
              </span>
            ) : null}
          </div>
        )}
      </div>
    </div>
  );
}
