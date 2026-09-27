import {
  createContext,
  useCallback,
  useContext,
  useMemo,
  useState,
  type ReactNode,
} from "react";

export type CopilotView =
  | "overview"
  | "script"
  | "look-dev"
  | "blockout"
  | "shots"
  | "edit"
  | "assets";

export type CopilotRole = "director" | "screenwriter" | "character_designer";
export type CopilotMode =
  | "brainstorm"
  | "critique"
  | "pacing"
  | "continuity";

export type CopilotPageContext = {
  view: CopilotView;
  projectId: string | null;
  selectionIds: string[];
};

type CopilotContextValue = {
  page: CopilotPageContext;
  setContext: (ctx: Partial<CopilotPageContext> & { view: CopilotView }) => void;
  roleOverride: CopilotRole | "auto";
  setRoleOverride: (role: CopilotRole | "auto") => void;
  mode: CopilotMode;
  setMode: (mode: CopilotMode) => void;
  resolvedRole: CopilotRole;
};

const CopilotContext = createContext<CopilotContextValue | null>(null);

export function roleFromView(view: CopilotView): CopilotRole {
  if (view === "script") return "screenwriter";
  if (view === "look-dev") return "character_designer";
  return "director";
}

export function CopilotProvider({ children }: { children: ReactNode }) {
  const [page, setPage] = useState<CopilotPageContext>({
    view: "overview",
    projectId: null,
    selectionIds: [],
  });
  const [roleOverride, setRoleOverride] = useState<CopilotRole | "auto">(
    "auto",
  );
  const [mode, setMode] = useState<CopilotMode>("brainstorm");

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

  const resolvedRole =
    roleOverride === "auto" ? roleFromView(page.view) : roleOverride;

  const value = useMemo(
    () => ({
      page,
      setContext,
      roleOverride,
      setRoleOverride,
      mode,
      setMode,
      resolvedRole,
    }),
    [page, setContext, roleOverride, mode, resolvedRole],
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
