import { readFileSync } from "node:fs";
try {
  const state = JSON.parse(
    readFileSync(
      process.env.WORKER_HEALTH_FILE ?? "/tmp/dirrio-worker-health.json",
      "utf8",
    ),
  );
  const now = Date.now();
  if (
    state.stopping ||
    !Number.isFinite(state.at) ||
    now - state.at > 90_000 ||
    !(
      state.activeTasks > 0 ||
      (Number.isFinite(state.lastPollAt) && now - state.lastPollAt < 180_000)
    )
  )
    process.exit(1);
} catch {
  process.exit(1);
}
