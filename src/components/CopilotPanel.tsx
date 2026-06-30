"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import ReactMarkdown from "react-markdown";

interface AuthStatus {
  configured: boolean;
  authenticated: boolean;
  account?: string;
}

interface DeviceCode {
  userCode: string;
  verificationUri: string;
  message: string;
}

/**
 * Panel lateral que pregunta a M365 Copilot en paralelo a DY.
 * - Gestiona el login device-code (botón Connect → código + enlace → polling).
 * - Cuando cambia `question`, lanza la pregunta y muestra la respuesta.
 */
export default function CopilotPanel({ question }: { question: string | null }) {
  const [status, setStatus] = useState<AuthStatus | null>(null);
  const [device, setDevice] = useState<DeviceCode | null>(null);
  const [connecting, setConnecting] = useState(false);
  const [answer, setAnswer] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const lastAsked = useRef<string | null>(null);

  const refreshStatus = useCallback(async () => {
    try {
      const res = await fetch("/api/copilot/auth");
      setStatus(await res.json());
    } catch {
      setStatus({ configured: false, authenticated: false });
    }
  }, []);

  useEffect(() => {
    refreshStatus();
  }, [refreshStatus]);

  // Polling mientras hay un device-code pendiente.
  useEffect(() => {
    if (!device) return;
    const t = setInterval(async () => {
      await refreshStatus();
    }, 3000);
    return () => clearInterval(t);
  }, [device, refreshStatus]);

  // En cuanto se autentica, limpiamos el device code.
  useEffect(() => {
    if (status?.authenticated && device) {
      setDevice(null);
      setConnecting(false);
    }
  }, [status?.authenticated, device]);

  async function connect() {
    setConnecting(true);
    setError(null);
    try {
      const res = await fetch("/api/copilot/auth", { method: "POST" });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "Error");
      setDevice(data);
    } catch (err) {
      setError((err as Error).message);
      setConnecting(false);
    }
  }

  const ask = useCallback(async (q: string) => {
    setLoading(true);
    setAnswer("");
    setError(null);
    try {
      const res = await fetch("/api/copilot", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ question: q }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "Error");
      setAnswer(data.answer);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (
      question &&
      question !== lastAsked.current &&
      status?.authenticated
    ) {
      lastAsked.current = question;
      ask(question);
    }
  }, [question, status?.authenticated, ask]);

  if (!status?.configured) {
    return (
      <aside className="flex w-96 shrink-0 flex-col border-l border-gray-200 bg-white">
        <div className="border-b border-gray-200 px-4 py-3">
          <h3 className="text-sm font-semibold text-brand-dark">M365 Copilot</h3>
        </div>
        <p className="p-4 text-xs text-gray-400">
          Not configured. Add AZURE_TENANT_ID and AZURE_CLIENT_ID to .env.local to
          compare answers with Microsoft 365 Copilot.
        </p>
      </aside>
    );
  }

  return (
    <aside className="flex w-96 shrink-0 flex-col border-l border-gray-200 bg-white">
      <div className="flex items-center justify-between border-b border-gray-200 px-4 py-3">
        <h3 className="text-sm font-semibold text-brand-dark">M365 Copilot</h3>
        {status.authenticated ? (
          <span className="truncate text-[11px] text-green-600" title={status.account}>
            ● {status.account}
          </span>
        ) : (
          <button
            onClick={connect}
            disabled={connecting}
            className="rounded-lg bg-brand px-2 py-1 text-xs font-medium text-white hover:bg-brand-dark disabled:opacity-50"
          >
            Connect Copilot
          </button>
        )}
      </div>

      <div className="flex-1 overflow-y-auto p-4">
        {error && (
          <div className="mb-3 rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-xs text-red-700">
            {error}
          </div>
        )}

        {device && !status.authenticated && (
          <div className="mb-3 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-800">
            <p className="mb-1 font-medium">Sign in to continue:</p>
            <p>
              1. Open{" "}
              <a
                href={device.verificationUri}
                target="_blank"
                rel="noreferrer"
                className="underline"
              >
                {device.verificationUri}
              </a>
            </p>
            <p>
              2. Enter code:{" "}
              <span className="select-all font-mono font-bold">
                {device.userCode}
              </span>
            </p>
            <p className="mt-1 text-amber-600">Waiting for sign-in…</p>
          </div>
        )}

        {!status.authenticated && !device && (
          <p className="text-xs text-gray-400">
            Connect to ask Microsoft 365 Copilot the same question in parallel.
          </p>
        )}

        {status.authenticated && !answer && !loading && (
          <p className="text-xs text-gray-400">
            Copilot’s answer will appear here when you send a question.
          </p>
        )}

        {loading && (
          <p className="text-xs text-gray-400">Copilot is thinking…</p>
        )}

        {answer && (
          <div className="prose prose-sm max-w-none text-sm text-gray-800">
            <ReactMarkdown>{answer}</ReactMarkdown>
          </div>
        )}
      </div>
    </aside>
  );
}
