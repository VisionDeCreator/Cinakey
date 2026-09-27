import { CopilotPanel } from "@/features/copilot/CopilotPanel";
import { PipelinePanel } from "@/features/copilot/PipelinePanel";
import { PromptSheetReview } from "@/features/copilot/PromptSheetReview";
import { useCopilotContext } from "@/features/copilot/CopilotContext";
import { useEffect, useState } from "react";
import { useParams } from "react-router-dom";

export function CopilotPage() {
  const { projectId } = useParams();
  const { setContext } = useCopilotContext();
  const [reviewId, setReviewId] = useState<string | null>(null);

  useEffect(() => {
    if (projectId) {
      setContext({ view: "copilot", projectId, selectionIds: [] });
    }
  }, [projectId, setContext]);

  if (!projectId) return null;

  return (
    <div className="flex min-h-0 flex-1">
      <div className="flex min-w-0 flex-1 flex-col border-r border-zinc-800">
        <div className="border-b border-zinc-800 px-4 py-3">
          <h2 className="text-lg font-semibold tracking-tight">Copilot</h2>
          <p className="text-sm text-zinc-500">
            Develop the story, then draft asset sheets, script prompts, and
            blockouts — every write is a proposal you accept.
          </p>
        </div>
        <div className="min-h-0 flex-1">
          <CopilotPanel projectId={projectId} />
        </div>
      </div>
      <div className="hidden w-[22rem] shrink-0 flex-col md:flex lg:w-[26rem]">
        <PipelinePanel
          projectId={projectId}
          onOpenSheet={(id) => setReviewId(id)}
        />
      </div>
      {reviewId ? (
        <PromptSheetReview
          promptSheetId={reviewId}
          onClose={() => setReviewId(null)}
        />
      ) : null}
    </div>
  );
}
