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
  listeners: Set<() => void>;
  pending?: Promise<void>;
  loadedAt: number;
  snapshot: number;
};
export class ApiClient {
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
    const response = await fetch(
      `${this.baseUrl}/v1/${name.replace(":", "/")}`,
      {
        method: "POST",
        headers: {
          Authorization: `Bearer ${this.token}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ args: convexToJson(args as Value) }),
        signal: this.controller.signal,
      },
    );
    const fail = (payload: any): never => {
      throw payload.data !== undefined
        ? new ConvexError(jsonToConvex(payload.data))
        : new Error(payload.message ?? "API request failed");
    };
    if (!response.ok) fail(await response.json());
    return jsonToConvex((await response.json()).value);
  }
  async load(entry: QueryEntry, force = false) {
    if (entry.pending) return entry.pending;
    if (!force && Date.now() - entry.loadedAt < 30_000) return;
    entry.pending = this.call(entry.name, entry.args)
      .then((data) => {
        entry.data = data;
        entry.error = undefined;
        entry.loadedAt = Date.now();
        this.notify(entry);
      })
      .catch((error) => {
        if (!this.controller.signal.aborted) {
          entry.error = error;
          this.notify(entry);
        }
      })
      .finally(() => {
        entry.pending = undefined;
      });
    return entry.pending;
  }
  async invalidate() {
    await Promise.all(
      [...this.queries.values()]
        .filter((e) => e.listeners.size)
        .map((e) => this.load(e, true)),
    );
  }
  async poll() {
    const watched = [...this.queries.values()].filter((e) => {
      if (!e.listeners.size) return false;
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
