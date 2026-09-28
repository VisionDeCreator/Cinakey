import { api } from "@cinakey/backend";
import { useMutation, useQuery } from "convex/react";
import { Check, Circle } from "lucide-react";
import { Link } from "react-router-dom";
import { Button } from "@/components/ui/button";

export function OnboardingChecklist({
  projectId,
}: {
  projectId: string;
}) {
  const checklist = useQuery(api.onboarding.getChecklist, {
    projectId: projectId as never,
  });
  const dismiss = useMutation(api.onboarding.dismissOnboarding);
  const me = useQuery(api.users.viewer);

  if (checklist === undefined || checklist === null) return null;
  if (!checklist.isStarter) return null;
  if (me?.onboardingDismissedAt !== undefined) return null;

  const doneCount = checklist.steps.filter((s) => s.done).length;
  const allDone = doneCount === checklist.steps.length;

  return (
    <section className="border border-zinc-800 bg-zinc-900/40 p-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 className="text-sm font-semibold text-zinc-100">
            Starter checklist
          </h2>
          <p className="mt-1 text-xs text-zinc-500">
            Walk the pipeline once — {doneCount}/{checklist.steps.length} done.
          </p>
        </div>
        <Button
          type="button"
          variant="ghost"
          size="sm"
          className="text-zinc-500"
          onClick={() => void dismiss({})}
        >
          Dismiss
        </Button>
      </div>
      <ol className="mt-4 space-y-2">
        {checklist.steps.map((step) => (
          <li key={step.id}>
            <Link
              to={`/projects/${projectId}/${step.href}`}
              className="flex items-center gap-2 text-sm text-zinc-300 hover:text-zinc-100"
            >
              {step.done ? (
                <Check className="size-4 text-emerald-400" aria-hidden />
              ) : (
                <Circle className="size-4 text-zinc-600" aria-hidden />
              )}
              <span className={step.done ? "line-through text-zinc-500" : ""}>
                {step.label}
              </span>
            </Link>
          </li>
        ))}
      </ol>
      {allDone ? (
        <p className="mt-3 text-xs text-emerald-400/90">
          You finished the starter path. Export again anytime from Edit.
        </p>
      ) : null}
    </section>
  );
}
