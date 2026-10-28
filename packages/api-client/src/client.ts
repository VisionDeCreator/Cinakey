/* eslint-disable @typescript-eslint/no-explicit-any -- HTTP facade retains the independently typed operation contracts at its callers. */
import {
  ConvexError,
  convexToJson,
  jsonToConvex,
  type Value,
} from "convex/values";
export type QueryEntry = {
  name: string;
  args: Record<string, unknown>;
  data: any;
  error?: Error;
  transientError?: boolean;
  listeners: Set<() => void>;
  pending?: Promise<void>;
  loadedAt: number;
  snapshot: number;
};
class ApiUnavailableError extends Error {}
export class ApiClient {
  private generationRequests = new Map<string, string>();
  disposalTimer?: ReturnType<typeof setTimeout>;
  readonly queries = new Map<string, QueryEntry>();
  readonly controller = new AbortController();
  constructor(
    readonly baseUrl: string,
    readonly token: string | null,
  ) {}
  close() {
    this.controller.abort();
    this.queries.clear();
  }
  entry(name: string, args: Record<string, unknown>) {
    const key = name + JSON.stringify(convexToJson(args as Value));
    if (!this.queries.has(key))
      this.queries.set(key, {
        name,
        args,
        data: undefined,
        listeners: new Set(),
        loadedAt: 0,
        snapshot: 0,
      });
    return this.queries.get(key)!;
  }
  notify(entry: QueryEntry) {
    entry.snapshot++;
    for (const listener of entry.listeners) listener();
  }
  async call(name: string, args: Record<string, unknown>): Promise<any> {
    if (!this.token) throw new Error("Authentication required");
    const isGeneration =
      /^(generation:startGeneration|workspace:generate)$/.test(name);
    const key = name + JSON.stringify(args);
    if (isGeneration && !args.requestId) {
      if (!this.generationRequests.has(key))
        this.generationRequests.set(key, crypto.randomUUID());
      args = { ...args, requestId: this.generationRequests.get(key) };
    }
    const releasingLease = name === "timelineLeases:release";
    const response = await fetch(
      `${this.baseUrl}/v1/${name.replace(":", "/")}`,
      {
        method: "POST",
        headers: {
          Authorization: `Bearer ${this.token}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ args: convexToJson(args as Value) }),
        keepalive: releasingLease,
        signal: releasingLease ? undefined : this.controller.signal,
      },
    );
    const fail = (payload: any): never => {
      if (payload.data !== undefined) {
        const error = new ConvexError(jsonToConvex(payload.data));
        const detail =
          typeof error.data === "object" &&
          error.data !== null &&
          "message" in error.data &&
          typeof error.data.message === "string"
            ? error.data.message
            : undefined;
        error.message = detail ?? payload.message ?? "API request failed";
        throw error;
      }
      throw new Error(payload.message ?? "API request failed");
    };
    if ([502, 503, 504].includes(response.status))
      throw new ApiUnavailableError("Reconnecting to the workspace…");
    const payload = await response.json();
    if (isGeneration && response.status < 500)
      this.generationRequests.delete(key);
    if (!response.ok) fail(payload);
    return jsonToConvex(payload.value);
  }
  async load(entry: QueryEntry, force = false) {
    if (entry.pending) return entry.pending;
    if (!force && Date.now() - entry.loadedAt < 30_000) return;
    entry.pending = this.call(entry.name, entry.args)
      .then((data) => {
        const changed =
          entry.error !== undefined ||
          JSON.stringify(entry.data) !== JSON.stringify(data);
        if (changed) entry.data = data;
        entry.error = undefined;
        entry.transientError = false;
        entry.loadedAt = Date.now();
        if (changed) this.notify(entry);
      })
      .catch((error) => {
        if (!this.controller.signal.aborted) {
          if (
            error instanceof TypeError ||
            error instanceof ApiUnavailableError
          ) {
            entry.transientError = true;
          } else entry.error = error;
          this.notify(entry);
        }
      })
      .finally(() => {
        entry.pending = undefined;
      });
    return entry.pending;
  }
  async invalidate(names?: readonly string[]) {
    await Promise.all(
      [...this.queries.values()]
        .filter((e) => e.listeners.size && (!names || names.includes(e.name)))
        .map(async (e) => {
          // A read started before a write may return the old snapshot. Wait for
          // it, then issue a new read after the mutation has committed.
          if (e.pending) await e.pending;
          await this.load(e, true);
        }),
    );
  }
  async poll() {
    const watched = [...this.queries.values()].filter((e) => {
      if (!e.listeners.size) return false;
      if (e.transientError) return true;
      if (
        /^(billing:(?:budgets|getBalance|listLedger)$|workspace:spend$|teams:|projects:(?:get|listMine)$|series:(?:list|forProject)$)/.test(
          e.name,
        )
      )
        return Date.now() - e.loadedAt >= 10_000;
      if (e.name === "workspace:videos")
        return (
          e.data?.jobs?.some((job: { status: string }) =>
            ["queued", "submitted", "running"].includes(job.status),
          ) || Date.now() - e.loadedAt >= 30_000
        );
      if (/^staff:/.test(e.name)) return Date.now() - e.loadedAt >= 30_000;
      if (/listActiveJobsForProject/.test(e.name))
        return e.data?.length > 0 || Date.now() - e.loadedAt >= 30_000;
      if (/getJob$/.test(e.name))
        return ["queued", "submitted", "running"].includes(e.data?.status);
      return /notifications:/.test(e.name) && Date.now() - e.loadedAt >= 60_000;
    });
    let changed = false;
    for (const entry of watched) {
      const before = JSON.stringify(entry.data);
      await this.load(entry, true);
      if (before !== JSON.stringify(entry.data)) changed = true;
    }
    if (changed) await this.invalidate();
  }
}
