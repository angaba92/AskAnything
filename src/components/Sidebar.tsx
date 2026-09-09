"use client";

import Link from "next/link";
import {
  STATUSES,
  STATUS_LABEL,
  STATUS_COLOR,
  type ThreadListItem,
} from "@/lib/types";

export default function Sidebar({
  threads,
  activeId,
  onSelect,
  onNew,
  filter,
  onFilter,
}: {
  threads: ThreadListItem[];
  activeId: string | null;
  onSelect: (id: string) => void;
  onNew: () => void;
  filter: string;
  onFilter: (s: string) => void;
}) {
  const visible =
    filter === "All" ? threads : threads.filter((t) => t.status === filter);

  return (
    <aside className="flex h-full w-80 flex-col border-r border-gray-200 bg-white">
      <div className="border-b border-gray-200 p-4">
        <div className="flex items-center justify-between">
          <h1 className="text-lg font-semibold text-brand-dark">AskAnything</h1>
          <button
            onClick={onNew}
            className="rounded-lg bg-brand px-3 py-1.5 text-sm font-medium text-white hover:bg-brand-dark"
          >
            + New
          </button>
        </div>
        <Link
          href="/batch"
          className="mt-2 inline-block text-xs font-medium text-brand hover:underline"
        >
          ⬚ Bulk import (Excel / CSV)
        </Link>
        <Link
          href="/kb"
          className="mt-1 flex items-center gap-1.5 text-xs font-medium text-brand hover:underline"
        >
          ⬚ Knowledge base (RFP)
          <span className="rounded-full bg-amber-100 px-1.5 py-0.5 text-[9px] font-semibold uppercase tracking-wide text-amber-700">
            testing
          </span>
        </Link>
        <div className="mt-3 flex flex-wrap gap-1">
          {["All", ...STATUSES].map((s) => (
            <button
              key={s}
              onClick={() => onFilter(s)}
              className={`rounded-full px-2.5 py-1 text-xs ${
                filter === s
                  ? "bg-brand text-white"
                  : "bg-gray-100 text-gray-600 hover:bg-gray-200"
              }`}
            >
              {s === "All" ? "All" : STATUS_LABEL[s as keyof typeof STATUS_LABEL]}
            </button>
          ))}
        </div>
      </div>

      <div className="flex-1 overflow-y-auto">
        {visible.length === 0 && (
          <p className="p-4 text-sm text-gray-400">No conversations yet.</p>
        )}
        {visible.map((t) => (
          <button
            key={t.id}
            onClick={() => onSelect(t.id)}
            className={`block w-full border-b border-gray-100 p-3 text-left hover:bg-gray-50 ${
              activeId === t.id ? "bg-gray-50" : ""
            }`}
          >
            <div className="flex items-center justify-between gap-2">
              <span className="truncate text-sm font-medium">{t.title}</span>
              <span
                className={`shrink-0 rounded-full px-2 py-0.5 text-[10px] ${
                  STATUS_COLOR[t.status]
                }`}
              >
                {STATUS_LABEL[t.status]}
              </span>
            </div>
            {t.owner && (
              <p className="mt-0.5 truncate text-[10px] font-medium text-brand">
                👤 {t.owner}
              </p>
            )}
            <p className="mt-1 truncate text-xs text-gray-400">
              {t.lastMessage}
            </p>
          </button>
        ))}
      </div>
    </aside>
  );
}
