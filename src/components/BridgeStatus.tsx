"use client";

import { useEffect, useState } from "react";
import { useBridgeHealth } from "@/lib/useBridgeHealth";

const TONES = {
  success: "bg-green-50 text-green-700",
  warning: "bg-amber-50 text-amber-700",
  error: "bg-red-50 text-red-700",
  info: "bg-blue-50 text-blue-700",
};

export function BridgeBadge() {
  const { summary } = useBridgeHealth();
  return (
    <span role="status" className={`rounded-full px-2 py-1 text-[11px] font-medium ${TONES[summary.tone]}`}>
      {summary.label}
    </span>
  );
}

export default function BridgeStatus({ busy, testing, onTest, onStop }: {
  busy: boolean;
  testing: boolean;
  onTest: () => Promise<void>;
  onStop: () => void;
}) {
  const { state, now, summary } = useBridgeHealth();
  const [required, setRequired] = useState<boolean | null>(null);
  useEffect(() => {
    const hosted = !["localhost", "127.0.0.1"].includes(window.location.hostname);
    setRequired(hosted);
  }, []);

  const stamp = (time: number | null) => time === null ? "Not yet" : new Date(time).toLocaleString();
  if (required === null) return <p className="mt-4 text-sm text-gray-500">Checking connection route...</p>;
  if (!required) return (
    <section className="mt-3 space-y-2 rounded-xl border border-gray-200 bg-white p-4">
      <h2 className="font-semibold">Direct connection (localhost)</h2>
      <p className="text-sm text-gray-600">
        This app calls Knowledge Assistant from the local server. The corporate bridge is not used;
        extension detection would not verify this route. Batch results and errors are available in Logs.
      </p>
    </section>
  );

  const active = ["discovering", "requesting", "processing"].includes(state.phase);
  return (
    <section className="mt-3 space-y-4 rounded-xl border border-gray-200 bg-white p-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex flex-wrap items-center gap-3">
          <h2 className="font-semibold">Corporate bridge</h2>
          <span role="status" className={`rounded-full px-2 py-1 text-xs font-medium ${TONES[summary.tone]}`}>
            {summary.label}
          </span>
        </div>
        <div className="flex gap-2">
          <button type="button" disabled={busy || active} onClick={onTest}
            className="rounded-lg bg-brand px-3 py-2 text-xs font-medium text-white hover:bg-brand-dark disabled:opacity-40">
            {testing ? "Checking..." : "Check KA + app"}
          </button>
          {testing && (
            <button type="button" onClick={onStop} className="rounded-lg border border-gray-300 px-3 py-2 text-xs">
              Cancel check
            </button>
          )}
        </div>
      </div>
      <p className="text-xs text-gray-500">
        Extension detected is only a PING, not proof of VPN or KA access. Green means the last KA request
        and app processing succeeded; it expires after 60 seconds. No automatic KA requests are sent.
        Extension detection refreshes every 5 seconds while this view is visible and idle.
        Each manual check makes one minimal KA request.
      </p>
      <dl className="grid gap-4 text-sm sm:grid-cols-2">
        <div><dt className="text-xs text-gray-500">Extension (PING only, not KA)</dt>
          <dd role="status" className={state.extension === "detected" ? "text-blue-700" : ""}>
            {state.extension === "detected" ? "Extension OK" : state.extension === "missing" ? "Extension not detected" : "Checking extension..."} - {stamp(state.extensionCheckedAt)}
          </dd>
        </div>
        <div><dt className="text-xs text-gray-500">KA response in latest request</dt><dd>{stamp(state.kaRespondedAt)}</dd></div>
        <div><dt className="text-xs text-gray-500">Last successful KA + app request</dt><dd>{stamp(state.lastSuccessAt)}</dd></div>
        <div><dt className="text-xs text-gray-500">{active ? "Current request elapsed" : "Last successful request duration"}</dt>
          <dd>{active && state.startedAt !== null ? `${Math.max(0, (now - state.startedAt) / 1000).toFixed(0)}s` :
            state.lastDurationMs !== null ? `${(state.lastDurationMs / 1000).toFixed(1)}s` : "Not yet"}</dd></div>
        <div><dt className="text-xs text-gray-500">Selected extension</dt><dd className="break-all">{state.identity?.extensionId || "Not identified"}</dd></div>
        <div><dt className="text-xs text-gray-500">Version / transport</dt><dd>{state.identity?.extensionVersion || "Unknown"} / {state.identity?.transport || "Unknown"}</dd></div>
      </dl>
      {state.identity && state.identity.transport !== "port" && (
        <p className="rounded-lg bg-amber-50 p-3 text-xs text-amber-700">
          Legacy callback transport detected. Update/reload the extension and this tab to use the dedicated port.
        </p>
      )}
      {state.error && (
        <div role="alert" className="space-y-2 rounded-lg bg-red-50 p-3 text-sm text-red-700">
          <p className="font-medium">{state.errorStage === "answer" ? "Answer quality issue, not a bridge disconnection" :
            state.errorStage === "app" ? "KA replied, but the app could not process the result" : "Extension / KA connection failure"}</p>
          <p className="break-words">{state.error}</p>
          <p className="text-xs">{state.errorStage === "extension" ?
            "Reload the extension and this tab. In incognito, enable Allow in Incognito." :
            state.errorStage === "ka" ? "Check your VPN and the extension. A responding PING does not confirm KA access." :
            state.errorStage === "app" ? "Check app authentication and the error in Logs before retrying." :
            "Use the row's Needs Review and Redo controls to improve the answer."}</p>
        </div>
      )}
      <p className="text-xs text-gray-500">Status is shared with chat for this tab only. A successful request does not guarantee future connectivity or answer accuracy.</p>
    </section>
  );
}
