import type { ReactNode } from "react";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";

export function DetailDrawer({
  open,
  onOpenChange,
  eyebrow,
  title,
  description,
  children,
  footer,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  eyebrow: string;
  title: ReactNode;
  description?: ReactNode;
  children: ReactNode;
  footer?: ReactNode;
}) {
  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent className="gap-0 overflow-hidden border-zinc-800 bg-[var(--color-studio-panel)] sm:max-w-lg sm:rounded-l-2xl">
        <SheetHeader className="shrink-0 space-y-2 p-6 pr-12">
          <p className="text-[10px] tracking-[.18em] text-zinc-400">
            {eyebrow}
          </p>
          <SheetTitle className="break-words text-xl">{title}</SheetTitle>
          {description && <SheetDescription>{description}</SheetDescription>}
        </SheetHeader>
        <div className="min-h-0 flex-1 space-y-6 overflow-y-auto p-6">
          {children}
        </div>
        {footer && (
          <div className="flex shrink-0 flex-wrap items-center justify-between gap-3 border-t border-zinc-800 bg-[var(--color-studio-panel)] p-4 sm:px-6">
            {footer}
          </div>
        )}
      </SheetContent>
    </Sheet>
  );
}
