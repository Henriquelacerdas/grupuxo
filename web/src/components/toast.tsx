"use client";

import { createContext, useCallback, useContext, useEffect, useRef, useState, type ReactNode } from "react";

interface Toast { readonly id: number; readonly message: string; readonly tone: "info" | "error" }
const Context = createContext<((message: string, tone?: Toast["tone"]) => void) | null>(null);

/** Avisos curtos (o `toastHost` do app): uma região `aria-live`, some sozinho em 4 s. */
export function ToastProvider({ children }: { children: ReactNode }) {
  const [toasts, setToasts] = useState<readonly Toast[]>([]);
  const next = useRef(0);
  const show = useCallback((message: string, tone: Toast["tone"] = "info") => {
    next.current += 1;
    const id = next.current;
    setToasts((current) => [...current.slice(-2), { id, message, tone }]);
  }, []);
  return (
    <Context.Provider value={show}>
      {children}
      <div aria-live="polite" role="status" className="pointer-events-none fixed inset-x-0 bottom-[calc(env(safe-area-inset-bottom)+88px)] z-[60] flex flex-col items-center gap-2 px-4 lg:bottom-8">
        {toasts.map((toast) => <ToastView key={toast.id} toast={toast} onDone={() => setToasts((c) => c.filter((t) => t.id !== toast.id))} />)}
      </div>
    </Context.Provider>
  );
}

function ToastView({ toast, onDone }: { toast: Toast; onDone: () => void }) {
  useEffect(() => {
    const timer = window.setTimeout(onDone, 4_000);
    return () => window.clearTimeout(timer);
  }, [onDone]);
  return (
    <div className={`animate-sheet pointer-events-auto max-w-md rounded-full px-5 py-3 text-[15px] font-medium shadow-lg ${toast.tone === "error" ? "bg-danger text-white" : "bg-label text-grouped"}`}>
      {toast.message}
    </div>
  );
}

export function useToast(): (message: string, tone?: Toast["tone"]) => void {
  const show = useContext(Context);
  if (show === null) throw new Error("ToastProvider ausente");
  return show;
}
