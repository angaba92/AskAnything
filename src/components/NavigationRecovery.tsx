"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";

/**
 * Revalidates the active App Router segment after browser history or BFCache
 * restoration. router.refresh() merges server content without discarding client
 * state held by BatchProvider, so an in-flight batch remains intact.
 */
export default function NavigationRecovery() {
  const router = useRouter();

  useEffect(() => {
    let frame: number | null = null;
    const refresh = () => {
      if (frame !== null) return;
      frame = window.requestAnimationFrame(() => {
        frame = null;
        router.refresh();
      });
    };
    const restore = (event: PageTransitionEvent) => {
      if (event.persisted) refresh();
    };

    window.addEventListener("popstate", refresh);
    window.addEventListener("pageshow", restore);
    return () => {
      window.removeEventListener("popstate", refresh);
      window.removeEventListener("pageshow", restore);
      if (frame !== null) window.cancelAnimationFrame(frame);
    };
  }, [router]);

  return null;
}
