"use client";

import { createContext, useCallback, useContext, useEffect, useRef, useState } from "react";
import { Toast, type ToastItem, type ToastVariant } from "./Toast";
import { createTimer, isExpired, pauseTimer, resumeTimer, type ToastTimerState } from "./toastTimer";

const DEFAULT_DURATION_MS = 5000;
const TICK_MS = 250;

interface ShowToastOptions {
  actionLabel?: string;
  onAction?: () => void;
}

interface ToastContextValue {
  showToast: (message: string, variant?: ToastVariant, options?: ShowToastOptions) => void;
}

const ToastContext = createContext<ToastContextValue | null>(null);

/** Read/trigger toasts from any client component under `ToastProvider`. */
export function useToast(): ToastContextValue {
  const ctx = useContext(ToastContext);
  if (!ctx) {
    throw new Error("useToast must be used within a ToastProvider");
  }
  return ctx;
}

/**
 * Toast region provider (tasks.md mockup-parity 2.3/2.4). Mounted once in
 * the app shell (`(app)/layout.tsx`) so any page can call `useToast()`
 * instead of rolling its own ad hoc toast/snackbar. Auto-dismisses after
 * `DEFAULT_DURATION_MS`, pausing the countdown while a toast has mouse or
 * keyboard focus (see `toastTimer.ts` for the pure pause/resume/expiry
 * logic this polls on a `TICK_MS` interval).
 */
export function ToastProvider({ children }: { children: React.ReactNode }) {
  const [toasts, setToasts] = useState<ToastItem[]>([]);
  const timers = useRef(new Map<string, ToastTimerState>());

  const dismiss = useCallback((id: string) => {
    timers.current.delete(id);
    setToasts((prev) => prev.filter((toast) => toast.id !== id));
  }, []);

  const showToast = useCallback<ToastContextValue["showToast"]>(
    (message, variant = "success", options) => {
      const id = `toast-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
      timers.current.set(id, createTimer(DEFAULT_DURATION_MS, Date.now()));
      setToasts((prev) => [...prev, { id, message, variant, ...options }]);
    },
    [],
  );

  const pause = useCallback((id: string) => {
    const state = timers.current.get(id);
    if (state) timers.current.set(id, pauseTimer(state, Date.now()));
  }, []);

  const resume = useCallback((id: string) => {
    const state = timers.current.get(id);
    if (state) timers.current.set(id, resumeTimer(state, Date.now()));
  }, []);

  useEffect(() => {
    if (toasts.length === 0) return;
    const interval = setInterval(() => {
      const now = Date.now();
      for (const toast of toasts) {
        const state = timers.current.get(toast.id);
        if (state && isExpired(state, now)) {
          dismiss(toast.id);
        }
      }
    }, TICK_MS);
    return () => clearInterval(interval);
  }, [toasts, dismiss]);

  return (
    <ToastContext.Provider value={{ showToast }}>
      {children}
      <div className="toast-region" aria-live="polite">
        {toasts.map((toast) => (
          <Toast key={toast.id} toast={toast} onDismiss={dismiss} onPause={pause} onResume={resume} />
        ))}
      </div>
    </ToastContext.Provider>
  );
}
