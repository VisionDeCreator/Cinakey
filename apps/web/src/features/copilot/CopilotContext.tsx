import {
  createContext,
  useCallback,
  useContext,
  useMemo,
  useState,
  type ReactNode,
} from "react";

export type CopilotView =
  | "copilot"
  | "assets"
  | "script"
  | "blockout"
  | "video"
  | "edit";

export type CopilotPageContext = {
  view: CopilotView;
  projectId: string | null;
  selectionIds: string[];
};

type CopilotContextValue = {
  page: CopilotPageContext;
  setContext: (ctx: Partial<CopilotPageContext> & { view: CopilotView }) => void;
};

const CopilotContext = createContext<CopilotContextValue | null>(null);

export function CopilotProvider({ children }: { children: ReactNode }) {
  const [page, setPage] = useState<CopilotPageContext>({
    view: "copilot",
    projectId: null,
    selectionIds: [],
  });

  const setContext = useCallback(
    (ctx: Partial<CopilotPageContext> & { view: CopilotView }) => {
      setPage((prev) => ({
        view: ctx.view,
        projectId:
          ctx.projectId !== undefined ? ctx.projectId : prev.projectId,
        selectionIds:
          ctx.selectionIds !== undefined
            ? ctx.selectionIds
            : prev.selectionIds,
      }));
    },
    [],
  );

  const value = useMemo(
    () => ({
      page,
      setContext,
    }),
    [page, setContext],
  );

  return (
    <CopilotContext.Provider value={value}>{children}</CopilotContext.Provider>
  );
}

export function useCopilotContext(): CopilotContextValue {
  const ctx = useContext(CopilotContext);
  if (!ctx) {
    throw new Error("useCopilotContext must be used within CopilotProvider");
  }
  return ctx;
}
