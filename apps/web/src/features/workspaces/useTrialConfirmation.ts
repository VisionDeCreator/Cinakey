import { useContext } from "react";
import { t } from "@dirrio/ui/i18n";
import { ConfirmContext } from "@/components/use-confirm";
import { useWorkspace } from "./workspace-context";

export function useTrialConfirmation() {
  const { canStartTrial } = useWorkspace();
  const confirm = useContext(ConfirmContext);
  return async () => {
    if (!canStartTrial) return true;
    if (!confirm) return false;
    return confirm({
      title: t("Start seven-day workspace trial?"),
      description: t(
        "Creating this production starts your seven-day trial with one creator seat. AI generation is paid separately. No subscription is charged automatically.",
      ),
      confirmLabel: t("Start trial and create"),
    });
  };
}
