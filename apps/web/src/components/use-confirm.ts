import { createContext, useContext } from "react";
export type ConfirmOptions = {
  title?: string;
  description: string;
  confirmLabel?: string;
  cancelLabel?: string;
  /** Destructive styling for the confirm button. */
  destructive?: boolean;
};

export type ConfirmFn = (options: ConfirmOptions) => Promise<boolean>;

export const ConfirmContext = createContext<ConfirmFn | null>(null);

export function useConfirm(): ConfirmFn {
  const ctx = useContext(ConfirmContext);
  if (!ctx) {
    throw new Error("useConfirm must be used within ConfirmProvider");
  }
  return ctx;
}
