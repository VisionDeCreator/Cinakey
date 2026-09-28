import { CopilotPanel } from "@/features/copilot/CopilotPanel";
import { useCopilotContext } from "@/features/copilot/CopilotContext";
import { useEffect } from "react";
import { useParams } from "react-router-dom";

export function CopilotPage() {
  const { projectId } = useParams();
  const { setContext } = useCopilotContext();

  useEffect(() => {
    if (projectId) {
      setContext({ view: "copilot", projectId, selectionIds: [] });
    }
  }, [projectId, setContext]);

  if (!projectId) return null;

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="border-b border-zinc-800 px-4 py-3">
        <h2 className="text-lg font-semibold tracking-tight">Copilot</h2>
      </div>
      <div className="min-h-0 flex-1">
        <CopilotPanel projectId={projectId} />
      </div>
    </div>
  );
}
