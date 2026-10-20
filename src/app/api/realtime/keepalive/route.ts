import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { isValidBearer } from "@/lib/cronAuth";

/**
 * Daily Realtime keepalive. Supabase stores broadcasts in daily partitions of realtime.messages and private-channel
 * authorization needs today's partition, but partitions are only created when a client joins a channel (or by Supabase's
 * janitor, for recently connected projects). We have no rights on the realtime schema, so after a few days with no
 * browser open the partitions lapse and the live updates (migration 0056) stop. Joining a PUBLIC channel with the anon key
 * recreates the window. Scheduled by pg_cron at 06:00 UTC (scripts/realtime-keepalive-cron.sql). No data is sent or read.
 * Same bearer as every cron route (an unset CRON_SECRET never means "allow"), exempt from the session gate in
 * src/lib/auth/sessionExemptRoutes.ts. Node 22 has a global WebSocket, so supabase-js needs no transport.
 */
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 30;

const JOIN_TIMEOUT_MS = 10_000;

export async function GET(request: Request) {
  if (!isValidBearer(request.headers.get("authorization"), process.env.CRON_SECRET)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  if (!url || !anonKey) {
    return NextResponse.json({ ok: false, status: "NOT_CONFIGURED", ms: 0 }, { status: 500 });
  }

  const started = Date.now();
  const supabase = createClient(url, anonKey, { auth: { persistSession: false, autoRefreshToken: false } });
  const channel = supabase.channel("keepalive");
  let status: string;
  try {
    status = await new Promise<string>((resolve) => {
      const timer = setTimeout(() => resolve("TIMED_OUT"), JOIN_TIMEOUT_MS);
      channel.subscribe((s) => {
        if (s === "SUBSCRIBED" || s === "CHANNEL_ERROR" || s === "TIMED_OUT" || s === "CLOSED") {
          clearTimeout(timer);
          resolve(s);
        }
      });
    });
  } finally {
    await supabase.removeChannel(channel).catch(() => undefined);
    await supabase.realtime.disconnect();
  }
  const ok = status === "SUBSCRIBED";
  return NextResponse.json({ ok, status, ms: Date.now() - started }, { status: ok ? 200 : 502 });
}
