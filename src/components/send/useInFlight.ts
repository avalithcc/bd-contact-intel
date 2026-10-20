import { useEffect, useRef, useState } from "react";
import { createInFlight, type InFlightKind } from "@/lib/sendSchedule/inFlight";

/**
 * The in-flight state of one send control: which call it started (`kind`), a `run` that ignores repeated calls, and the
 * browser's leave-page confirmation while the call lasts. If the component unmounts first (a dialog that closes on success,
 * a sidebar navigation) the server call still finishes and nothing is set on the unmounted component.
 */
export function useInFlight() {
  const [kind, setKind] = useState<InFlightKind | null>(null);
  const mounted = useRef(true);
  const guard = useRef<ReturnType<typeof createInFlight> | null>(null);
  if (!guard.current) {
    guard.current = createInFlight((k) => {
      if (mounted.current) setKind(k);
    });
  }
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);
  useEffect(() => {
    if (!kind) return;
    const onBeforeUnload = (e: BeforeUnloadEvent) => {
      e.preventDefault();
      e.returnValue = "";
    };
    window.addEventListener("beforeunload", onBeforeUnload);
    return () => window.removeEventListener("beforeunload", onBeforeUnload);
  }, [kind]);
  const run = <T,>(k: InFlightKind, work: () => Promise<T> | T) => guard.current!.run(k, work);
  return { kind, run };
}
