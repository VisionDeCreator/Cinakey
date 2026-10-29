import { writeFileSync } from "node:fs";
import type { ConvexHttpClient } from "convex/browser";
import { makeFunctionReference } from "convex/server";
import { safeErrorMessage } from "../providers/errors";
/** Process heartbeat is independent of task leases and keeps running during long jobs. */
export function startWorkerMonitor(
  client: ConvexHttpClient,
  instanceId: string,
) {
  const startedAt = Date.now();
  let activeTasks = 0,
    lastPollAt: number | undefined,
    stopping = false;
  let pending: Promise<void> | undefined;
  const pulse = () => {
    if (pending) return pending;
    let deadline: ReturnType<typeof setTimeout> | undefined;
    const request = client.mutation(
      makeFunctionReference<"mutation">("adminOperations:heartbeat"),
      {
        instanceId,
        version: (process.env.RELEASE_VERSION || "development").slice(0, 100),
        startedAt,
        lastPollAt,
        activeTasks,
        stopping,
      },
    );
    pending = Promise.race([
      request,
      new Promise<never>((_, reject) => {
        deadline = setTimeout(() => {
          reject(new Error("Worker heartbeat timed out"));
        }, 5000);
      }),
    ])
      .then(
        () => {
          // Optional container liveness marker: only update after Convex accepts a heartbeat.
          if (process.env.WORKER_HEALTH_FILE) {
            try {
              writeFileSync(
                process.env.WORKER_HEALTH_FILE,
                JSON.stringify({
                  at: Date.now(),
                  lastPollAt,
                  activeTasks,
                  stopping,
                }),
                { mode: 0o600 },
              );
            } catch {
              console.error("[worker] could not write local health marker");
            }
          }
        },
        (error) =>
          console.error(
            "[worker] monitoring heartbeat failed",
            safeErrorMessage(error),
          ),
      )
      .finally(() => {
        clearTimeout(deadline);
        pending = undefined;
      });
    return pending;
  };
  void pulse();
  const timer = setInterval(() => {
    void pulse();
  }, 20_000);
  return {
    setWorkload(count: number) {
      activeTasks = count;
      void pulse();
    },
    polled() {
      lastPollAt = Date.now();
      void pulse();
    },
    async close() {
      clearInterval(timer);
      stopping = true;
      activeTasks = 0;
      await pending;
      await pulse();
    },
  };
}
