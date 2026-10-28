import { makeFunctionReference } from "convex/server";
import { safeErrorMessage, SubmissionUncertainError } from "./providers/errors";
import { registry } from "./registry";
import { adminClient, createContext } from "./runtime/context";
import { withProviderSignal } from "./runtime/provider-scope";
const ref = (name: string) => makeFunctionReference<any>(name);

function workerFunctionsMissing(error: unknown): boolean {
  return (
    error instanceof Error &&
    /Could not find (?:public |internal )?function for ['"]tasks:/.test(
      error.message,
    )
  );
}

export async function runWorker(signal: AbortSignal) {
  const client = adminClient();
  const owner = crypto.randomUUID();
  let idleMs = 1_000,
    lastReconciliation = 0,
    waitingForDeployment = false;
  const sleep = (ms: number) =>
    new Promise<void>((resolve) => {
      if (signal.aborted) {
        resolve();
        return;
      }
      const done = () => {
        clearTimeout(timer);
        signal.removeEventListener("abort", done);
        resolve();
      };
      const timer = setTimeout(done, ms);
      signal.addEventListener("abort", done, { once: true });
    });
  while (!signal.aborted) {
    try {
      if (Date.now() - lastReconciliation > 300_000) {
        for (const status of ["queued", "submitted", "running"]) {
          let cursor: string | null = null;
          for (;;) {
            const page: { isDone: boolean; cursor: string } =
              await client.mutation(ref("tasks:reconcileGeneration"), {
                status,
                cursor,
              });
            if (page.isDone) break;
            cursor = page.cursor;
          }
        }
        await client.mutation(ref("publishedExports:cleanup"), {});
        await client.mutation(ref("payments:expireAllowances"), {});
        await client.mutation(ref("authOtp:cleanup"), {});
        await client.mutation(ref("storageIO:cleanupR2Uploads"), {});
        lastReconciliation = Date.now();
        if (waitingForDeployment) {
          console.info("[worker] Convex worker functions are ready; resuming.");
          waitingForDeployment = false;
        }
      }
      const tasks = (await client.mutation(ref("tasks:claim"), {
        owner,
        limit: 4,
      })) as any[];
      await Promise.all(
        tasks.map(async (task) => {
          const heartbeat = setInterval(() => {
            void client
              .mutation(ref("tasks:heartbeat"), { id: task._id, owner })
              .catch((error) =>
                console.error(
                  "[worker] lease heartbeat failed",
                  safeErrorMessage(error),
                ),
              );
          }, 30_000);
          try {
            const ctx = createContext(registry, task.identity ?? null, true);
            if (registry.has(task.operation))
              await withProviderSignal(signal, () =>
                ctx.runAction(ref(task.operation), task.args),
              );
            else await ctx.runMutation(ref(task.operation), task.args);
            await client.mutation(ref("tasks:complete"), {
              id: task._id,
              owner,
            });
          } catch (error) {
            await client.mutation(ref("tasks:retry"), {
              id: task._id,
              owner,
              error: safeErrorMessage(error),
              permanent: error instanceof SubmissionUncertainError,
            });
          } finally {
            clearInterval(heartbeat);
          }
        }),
      );
      idleMs = tasks.length ? 1_000 : Math.min(idleMs * 2, 30_000);
    } catch (error) {
      if (workerFunctionsMissing(error)) {
        if (!waitingForDeployment)
          console.warn(
            "[worker] Waiting for Convex worker functions. Fix backend typecheck errors and keep dev:convex running; verify CONVEX_URL targets that deployment.",
          );
        waitingForDeployment = true;
      } else {
        console.error("[worker] tick failed", safeErrorMessage(error));
      }
      idleMs = Math.min(idleMs * 2, 30_000);
    }
    await sleep(idleMs);
  }
}
