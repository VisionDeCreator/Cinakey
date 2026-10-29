import { useState } from "react";
import { api } from "@dirrio/backend";
import { useMutation } from "@dirrio/api-client";
import { I18nText, t, useLocale } from "@dirrio/ui/i18n";
import { Button } from "@dirrio/ui/button";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from "@dirrio/ui/dialog";
export function RegistrationControls({
  requireApproval,
  revision,
}: {
  requireApproval: boolean;
  revision: number;
}) {
  useLocale();
  const [next, setNext] = useState(requireApproval);
  const [reason, setReason] = useState("");
  const [confirming, setConfirming] = useState(false);
  const [busy, setBusy] = useState(false);
  const [failed, setFailed] = useState(false);
  const configure = useMutation(api.earlyAccess.configure);
  async function save() {
    setBusy(true);
    setFailed(false);
    try {
      await configure({
        requireApproval: next,
        revision,
        reason,
        requestId: crypto.randomUUID(),
      });
      setConfirming(false);
      setReason("");
    } catch {
      setFailed(true);
    } finally {
      setBusy(false);
    }
  }
  return (
    <section className="admin-card registration-controls space-y-4 p-5">
      <h2>
        <I18nText text="Registration access" />
      </h2>
      <p role="status">
        {requireApproval ? (
          <I18nText text="Approval is required for new accounts." />
        ) : (
          <I18nText text="Registration is open to anyone with a verified email." />
        )}
      </p>
      <label className="provider-pause-toggle">
        <input
          type="checkbox"
          role="switch"
          checked={next}
          disabled={busy}
          onChange={(e) => setNext(e.target.checked)}
        />
        <I18nText text="Require waitlist approval" />
      </label>
      <p>
        <I18nText text="Existing users keep access in both modes. Subscription requirements and account suspensions still apply." />
      </p>
      <label className="block">
        <I18nText text="Setting change reason (10–2000 characters)" />
        <textarea
          className="provider-reason mt-2"
          maxLength={2000}
          value={reason}
          onChange={(e) => setReason(e.target.value)}
          disabled={busy}
        />
      </label>
      <Button
        disabled={busy || next === requireApproval || reason.trim().length < 10}
        onClick={() => {
          setFailed(false);
          setConfirming(true);
        }}
      >
        <I18nText text="Review registration change" />
      </Button>
      <Dialog
        open={confirming}
        onOpenChange={(open) => {
          if (!busy) setConfirming(open);
        }}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>
              <I18nText text="Confirm registration change" />
            </DialogTitle>
            <DialogDescription>
              {next
                ? t(
                    "New applicants will need approval. Everyone already registered will keep access.",
                  )
                : t(
                    "Anyone with a verified email can register, including pending and rejected applicants. Existing accounts are unchanged.",
                  )}
            </DialogDescription>
          </DialogHeader>
          {failed && (
            <p role="alert">
              <I18nText text="Could not change registration access. Refresh and try again." />
            </p>
          )}
          <DialogFooter>
            <Button
              variant="outline"
              disabled={busy}
              onClick={() => setConfirming(false)}
            >
              <I18nText text="Cancel" />
            </Button>
            <Button disabled={busy} onClick={() => void save()}>
              <I18nText text="Save changes" />
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </section>
  );
}
