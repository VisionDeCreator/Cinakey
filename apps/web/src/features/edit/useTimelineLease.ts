import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
} from "react";
import { api } from "@cinakey/backend";
import { useMutation } from "@/lib/api/hooks";

/** Each mounted editor has its own session, including separate tabs. */
export function useTimelineLease(
  projectId: string | undefined,
  enabled = true,
) {
  const claim = useMutation(api.timelineLeases.claim);
  const renew = useMutation(api.timelineLeases.renew);
  const release = useMutation(api.timelineLeases.release);
  const [state, setState] = useState<{
    sessionId?: string;
    projectId?: string;
    fence?: number;
    expiresAt: number;
    editor?: string;
    canTakeover?: boolean;
    error?: string;
  }>({ expiresAt: 0 });
  const [now, setNow] = useState(() => Date.now());
  const [retry, setRetry] = useState(0);
  const [takeover, setTakeover] = useState(false);
  const current = useRef(state);
  const enabledNow = useRef(enabled);
  const transition = useRef<Promise<unknown>>(Promise.resolve());
  useLayoutEffect(() => {
    current.current = state;
    enabledNow.current = enabled;
  }, [state, enabled]);
  useEffect(() => {
    if (!projectId || !enabled) return;
    const sessionId = crypto.randomUUID();
    let disposed = false;
    let leaving = false;
    let fence: number | undefined;
    let busy = false;
    const args = { projectId: projectId as never, sessionId };
    const previous = transition.current;
    // StrictMode replays setup/cleanup; retries can also race an in-flight claim.
    // Finish the previous fenced release before claiming a new browser session.
    transition.current = previous
      .catch(() => {})
      .then(async () => {
        if (disposed || leaving) return;
        const result = await claim({ ...args, takeover });
        if (result.held) {
          fence = result.fence;
          if (disposed || leaving) {
            await release({ ...args, fence }).catch(() => {});
            return;
          }
          setState({
            fence,
            sessionId,
            projectId,
            expiresAt: result.expiresAt,
            canTakeover: result.canTakeover,
          });
        } else if (!disposed && !leaving) {
          setState({
            expiresAt: 0,
            editor: result.editor,
            canTakeover: result.canTakeover,
          });
        }
      })
      .catch(() => {
        if (!disposed && !leaving)
          setState({
            expiresAt: 0,
            error: "Could not acquire editing access. Retry when connected.",
          });
      });
    const onPageHide = () => {
      leaving = true;
      current.current = { expiresAt: 0 };
      setState({
        expiresAt: 0,
        error:
          "Editing paused when this page closed. Request editing access to resume.",
      });
      if (fence !== undefined) void release({ ...args, fence }).catch(() => {});
    };
    window.addEventListener("pagehide", onPageHide);
    const clock = window.setInterval(() => setNow(Date.now()), 1000);
    const heartbeat = window.setInterval(() => {
      if (disposed || leaving || fence === undefined || busy) return;
      busy = true;
      void renew({ ...args, fence })
        .then((result) => {
          if (!disposed && !leaving)
            setState((s) => ({ ...s, expiresAt: result.expiresAt }));
        })
        .catch(() => {
          fence = undefined;
          if (!disposed && !leaving)
            setState({
              expiresAt: 0,
              error: "Editing access was lost. Your local draft is preserved.",
            });
        })
        .finally(() => {
          busy = false;
        });
    }, 20_000);
    return () => {
      disposed = true;
      current.current = { expiresAt: 0 };
      window.removeEventListener("pagehide", onPageHide);
      window.clearInterval(clock);
      window.clearInterval(heartbeat);
      if (fence !== undefined)
        transition.current = release({ ...args, fence }).catch(() => {});
    };
  }, [projectId, claim, renew, release, retry, takeover, enabled]);
  const request = useCallback((force = false) => {
    setState({ expiresAt: 0 });
    setTakeover(force);
    setRetry((n) => n + 1);
  }, []);
  const canEdit =
    enabled &&
    state.projectId === projectId &&
    state.fence !== undefined &&
    state.expiresAt > now;
  const canEditNow = useCallback(
    () =>
      enabledNow.current &&
      current.current.fence !== undefined &&
      current.current.expiresAt > Date.now(),
    [],
  );
  return {
    ...state,
    canEdit,
    canEditNow,
    sessionId: state.sessionId ?? "",
    request,
  };
}
