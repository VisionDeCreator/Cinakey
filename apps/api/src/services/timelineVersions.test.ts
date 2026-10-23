import { expect, it, vi } from "vitest";
import { createEmptyTimeline } from "@cinakey/shared";
import type { ServiceOperation } from "../runtime/context";
import { save } from "./timelineVersions";

it("retains a snapshot when a commit acknowledgement is lost", async () => {
  const remove = vi.fn();
  const ctx = {
    auth: { getUserIdentity: async () => ({ subject: "user|session" }) },
    runQuery: vi.fn().mockResolvedValue(true),
    runMutation: vi
      .fn()
      .mockRejectedValue(new Error("Connection lost after commit")),
    storage: {
      store: vi.fn().mockResolvedValue("snapshot-file"),
      delete: remove,
    },
  };
  await expect(
    (save as unknown as ServiceOperation).handler(ctx as never, {
      projectId: "project" as never,
      parentId: null,
      document: createEmptyTimeline({
        id: "project",
        aspectRatio: "16:9",
        fps: 24,
      }),
      requestId: "retry-safe",
    }),
  ).rejects.toThrow("Connection lost");
  expect(remove).not.toHaveBeenCalled();
});
