"use client";

import { usePathname, useRouter } from "next/navigation";
import { useEffect, useRef } from "react";
import { createClient } from "@/lib/supabase/client";
import { detectBusy, domProbe } from "@/lib/shell/busyDetection";
import { createLiveController, initialConnection, stepConnection, type ChannelStatus } from "@/lib/shell/liveController";
import { debounceMsFor, isRelevant, parseChange } from "@/lib/shell/liveRelevance";

/**
 * Mounted once in the authenticated shell. Listens on the private Realtime topic 'crm' (the database triggers of
 * drizzle/0056_crm_live_updates.sql broadcast ids only, never data) and re-fetches the current screen's server data when
 * a message concerns it (src/lib/shell/liveRelevance.ts), debounced and held back while the screen is mid-edit
 * (src/lib/shell/liveController.ts). There is no polling: an idle tab with no messages makes no request.
 *
 * Fails soft: without Supabase config, a session, or a channel the receive policy lets in, it does nothing and the app
 * works exactly as before minus live updates. Renders nothing.
 */
export function LiveUpdates() {
  const router = useRouter();
  const pathname = usePathname();
  const pathRef = useRef(pathname);
  const resetRef = useRef<(() => void) | null>(null);

  useEffect(() => {
    pathRef.current = pathname;
    resetRef.current?.();
  }, [pathname]);

  useEffect(() => {
    if (!process.env.NEXT_PUBLIC_SUPABASE_URL || !process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY) return;
    const supabase = createClient();
    const controller = createLiveController({
      now: () => Date.now(),
      setTimer: (fn, ms) => window.setTimeout(fn, ms),
      clearTimer: (handle) => window.clearTimeout(handle as number),
      refresh: () => router.refresh(),
      isBusy: () => detectBusy(domProbe(document)),
      isHidden: () => document.hidden,
      relevant: (change) => isRelevant(change, pathRef.current),
      debounceMs: () => debounceMsFor(pathRef.current),
    });
    resetRef.current = controller.reset;

    let stopped = false;
    let channel: ReturnType<typeof supabase.channel> | null = null;
    let connection = initialConnection;

    void (async () => {
      try {
        const { data } = await supabase.auth.getSession();
        if (stopped || !data.session) return;
        await supabase.realtime.setAuth(data.session.access_token);
        channel = supabase
          .channel("crm", { config: { private: true } })
          .on("broadcast", { event: "change" }, (message) => {
            const change = parseChange(message.payload);
            if (change) controller.onChange(change);
          })
          .subscribe((status) => {
            const known = toChannelStatus(status);
            if (stopped || !known) return;
            const step = stepConnection(connection, known);
            connection = step.next;
            if (step.catchUp) controller.catchUp();
            if (step.giveUp && channel) void supabase.removeChannel(channel);
          });
      } catch {
        // No live updates; the page keeps working.
      }
    })();

    const onIdle = () => controller.onIdle();
    document.addEventListener("visibilitychange", onIdle);
    document.addEventListener("focusout", onIdle);
    return () => {
      stopped = true;
      resetRef.current = null;
      document.removeEventListener("visibilitychange", onIdle);
      document.removeEventListener("focusout", onIdle);
      controller.dispose();
      if (channel) void supabase.removeChannel(channel);
    };
  }, [router]);

  return null;
}

function toChannelStatus(status: string): ChannelStatus | null {
  return status === "SUBSCRIBED" || status === "CHANNEL_ERROR" || status === "TIMED_OUT" || status === "CLOSED" ? status : null;
}
