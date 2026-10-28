import { t, useLocale } from "@cinakey/ui/i18n";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { useCallback, useMemo, useRef, useState, type ReactNode } from "react";
import {
  ConfirmContext,
  type ConfirmFn,
  type ConfirmOptions,
} from "./use-confirm";

type Pending = ConfirmOptions & {
  resolve: (value: boolean) => void;
};

/**
 * App-wide confirm modal. Use `useConfirm()` for a promise-based API
 * that replaces `window.confirm`.
 */
export function ConfirmProvider({ children }: { children: ReactNode }) {
  useLocale();
  const [pending, setPending] = useState<Pending | null>(null);
  const pendingRef = useRef<Pending | null>(null);

  const confirm = useCallback<ConfirmFn>((options) => {
    return new Promise<boolean>((resolve) => {
      const next: Pending = { ...options, resolve };
      pendingRef.current = next;
      setPending(next);
    });
  }, []);

  const settle = useCallback((value: boolean) => {
    const cur = pendingRef.current;
    pendingRef.current = null;
    setPending(null);
    cur?.resolve(value);
  }, []);

  const value = useMemo(() => confirm, [confirm]);

  return (
    <ConfirmContext.Provider value={value}>
      {children}
      <AlertDialog
        open={pending !== null}
        onOpenChange={(open) => {
          if (!open) settle(false);
        }}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>
              {pending?.title ?? t("Confirm")}
            </AlertDialogTitle>
            <AlertDialogDescription>
              {pending?.description}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel onClick={() => settle(false)}>
              {pending?.cancelLabel ?? t("Cancel")}
            </AlertDialogCancel>
            <AlertDialogAction
              className={
                pending?.destructive
                  ? "bg-red-600 text-zinc-50 hover:bg-red-500"
                  : undefined
              }
              onClick={() => settle(true)}
            >
              {pending?.confirmLabel ?? t("OK")}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </ConfirmContext.Provider>
  );
}
