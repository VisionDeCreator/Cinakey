import { createApp } from "./app";
const port = Number(process.env.PORT ?? 3001);
const app = createApp().listen(port);
console.log(`Dirrio API listening on :${port}`);

let stopping = false;
async function shutdown() {
  if (stopping) return;
  stopping = true;
  // Stop accepting connections and drain requests before Compose's 150s deadline.
  const deadline = setTimeout(() => process.exit(1), 140_000);
  deadline.unref();
  try {
    await app.stop(false);
  } finally {
    clearTimeout(deadline);
  }
}
process.once("SIGTERM", () => void shutdown());
process.once("SIGINT", () => void shutdown());
