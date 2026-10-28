import { t, useLocale } from "@cinakey/ui/i18n";
import type { Id } from "@cinakey/backend";
import { useState } from "react";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { useWorkspace } from "./workspace-context";
import { cn } from "@/lib/utils";

export function WorkspaceSelector({ className }: { className?: string }) {
  useLocale();
  const { workspaceId, workspaces, switchWorkspace } = useWorkspace();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  return (
    <div className={cn("min-w-0", className)}>
      <Select
        value={workspaceId}
        disabled={busy || !workspaces.length}
        onValueChange={(value) => {
          setBusy(true);
          setError("");
          void switchWorkspace(value as Id<"workspaces">)
            .catch(() => setError("Could not switch workspace. Try again."))
            .finally(() => setBusy(false));
        }}
      >
        <SelectTrigger
          aria-label={t("Active workspace")}
          className="h-11 w-full rounded-2xl border-zinc-800 bg-[var(--color-studio-panel)] px-3 text-sm [&>span]:truncate"
        >
          <SelectValue placeholder={t("Choose workspace")} />
        </SelectTrigger>
        <SelectContent className="max-w-[calc(100vw-2rem)] rounded-2xl border-zinc-800 bg-[var(--color-studio-panel)] p-1.5">
          {workspaces.map(({ workspace }) => (
            <SelectItem
              key={workspace._id}
              value={workspace._id}
              className="rounded-xl py-2.5 pr-8 focus:bg-zinc-800 data-[state=checked]:text-[var(--color-studio-accent)]"
            >
              <span className="block truncate">{workspace.name}</span>
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
      {error && (
        <p role="alert" className="mt-1 text-xs text-red-400">
          {t(error ?? "")}
        </p>
      )}
    </div>
  );
}
