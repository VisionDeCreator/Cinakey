import type { FunctionReturnType, FunctionArgs } from "convex/server";
import type { api } from "@dirrio/backend";

export type SavedGenerationSettings = FunctionReturnType<
  typeof api.projects.generationSettings
>;
export type GenerationSettingsPatch = Omit<
  FunctionArgs<typeof api.projects.saveGenerationSettings>,
  "projectId" | "segmentId"
>;
type Save = (
  patch: GenerationSettingsPatch,
) => Promise<SavedGenerationSettings>;
type Snapshot = {
  patch: GenerationSettingsPatch;
  saving: boolean;
  error: string;
  saved: boolean;
};

/** Serial, field-level writes. A polling response cannot replace an unsaved edit. */
export class GenerationSettingsDraft {
  private snapshot: Snapshot = {
    patch: {},
    saving: false,
    error: "",
    saved: false,
  };
  private pending: GenerationSettingsPatch = {};
  private inFlight = new Set<string>();
  private acknowledgements = new Map<string, number>();
  private listeners = new Set<() => void>();
  private timer?: ReturnType<typeof setTimeout>;
  private running?: Promise<boolean>;
  constructor(private save: Save) {}
  subscribe = (listener: () => void) => {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  };
  getSnapshot = () => this.snapshot;
  private publish(next: Partial<Snapshot>) {
    this.snapshot = { ...this.snapshot, ...next };
    this.listeners.forEach((listener) => listener());
  }
  change = (patch: GenerationSettingsPatch, delay = 0) => {
    this.pending = { ...this.pending, ...patch };
    this.publish({
      patch: { ...this.snapshot.patch, ...patch },
      saved: false,
      error: "",
    });
    clearTimeout(this.timer);
    this.timer = setTimeout(() => {
      void this.flush();
    }, delay);
  };
  observe = (server: SavedGenerationSettings | undefined) => {
    if (!server) return;
    const patch = { ...this.snapshot.patch };
    let changed = false;
    for (const [key, revision] of this.acknowledgements) {
      if (
        server.revision >= revision &&
        !(key in this.pending) &&
        !this.inFlight.has(key)
      ) {
        delete patch[key as keyof GenerationSettingsPatch];
        this.acknowledgements.delete(key);
        changed = true;
      }
    }
    if (changed) this.publish({ patch });
  };
  flush = (): Promise<boolean> => {
    clearTimeout(this.timer);
    if (this.running) return this.running;
    if (this.snapshot.error) return Promise.resolve(false);
    if (!Object.keys(this.pending).length) return Promise.resolve(true);
    this.publish({ saving: true });
    this.running = this.drain().finally(() => {
      this.running = undefined;
      this.publish({ saving: false });
    });
    return this.running;
  };
  private async drain() {
    while (Object.keys(this.pending).length) {
      const batch = this.pending;
      this.pending = {};
      this.inFlight = new Set(Object.keys(batch));
      try {
        const saved = await this.save(batch);
        for (const key of Object.keys(batch))
          this.acknowledgements.set(key, saved.revision);
      } catch (error) {
        this.pending = { ...batch, ...this.pending };
        this.publish({
          error:
            error instanceof Error
              ? error.message
              : "Could not save generation settings.",
        });
        return false;
      } finally {
        this.inFlight.clear();
      }
    }
    this.publish({ saved: true });
    return true;
  }
  retry = () => {
    this.publish({ error: "" });
    return this.flush();
  };
  dispose = () => {
    clearTimeout(this.timer);
    void this.flush();
  };
}

/** Keep failed and in-flight drafts attached to their segment when navigating. */
export class GenerationSettingsDraftStore {
  private drafts = new Map<string, GenerationSettingsDraft>();
  constructor(
    private save: (
      segmentId: string,
      patch: GenerationSettingsPatch,
    ) => Promise<SavedGenerationSettings>,
  ) {}
  forSegment(segmentId: string) {
    let draft = this.drafts.get(segmentId);
    if (!draft) {
      draft = new GenerationSettingsDraft((patch) =>
        this.save(segmentId, patch),
      );
      this.drafts.set(segmentId, draft);
    }
    return draft;
  }
  dispose() {
    for (const draft of this.drafts.values()) draft.dispose();
  }
}
