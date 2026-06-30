"use client";

import ReactMarkdown from "react-markdown";
import type { ChatMessage } from "@/lib/types";

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
        {isHuman ? (
          <p className="whitespace-pre-wrap">{m.text}</p>
        ) : (
          <div className="markdown">
            <ReactMarkdown
              components={{
                a: ({ href, children }) => (
                  <a
                    href={href}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="text-brand underline underline-offset-2 hover:text-brand-dark"
                  >
                    {children}
                  </a>
                ),
              }}
            >
              {m.text}
            </ReactMarkdown>
          </div>
        )}
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
