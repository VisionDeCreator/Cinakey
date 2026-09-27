import { authTables } from "@convex-dev/auth/server";
import { defineSchema, defineTable } from "convex/server";
import { v } from "convex/values";

const lineage = v.object({
  prompt: v.optional(v.string()),
  model: v.optional(v.string()),
  modelVersion: v.optional(v.string()),
  seed: v.optional(v.number()),
  parentAssetIds: v.optional(v.array(v.id("assets"))),
  referenceAssetIds: v.optional(v.array(v.id("assets"))),
});

const schema = defineSchema(
  {
  ...authTables,

  // Extend Convex Auth users with staff flag and personal workspace link.
  users: defineTable({
    name: v.optional(v.string()),
    image: v.optional(v.string()),
    email: v.optional(v.string()),
    emailVerificationTime: v.optional(v.number()),
    phone: v.optional(v.string()),
    phoneVerificationTime: v.optional(v.number()),
    isAnonymous: v.optional(v.boolean()),
    isStaff: v.optional(v.boolean()),
    personalWorkspaceId: v.optional(v.id("workspaces")),
  })
    .index("email", ["email"])
    .index("phone", ["phone"]),

  workspaces: defineTable({
    name: v.string(),
    ownerUserId: v.id("users"),
    createdAt: v.number(),
    updatedAt: v.number(),
  }).index("by_owner", ["ownerUserId"]),

  projects: defineTable({
    workspaceId: v.id("workspaces"),
    title: v.string(),
    brief: v.optional(
      v.object({
        logline: v.string(),
        audience: v.optional(v.string()),
        tone: v.optional(v.string()),
      }),
    ),
    aspectRatio: v.string(),
    fps: v.number(),
    targetLengthSec: v.optional(v.number()),
    styleNotes: v.optional(v.string()),
    rules: v.array(v.string()),
    thumbnailAssetId: v.optional(v.id("assets")),
    archivedAt: v.optional(v.number()),
    createdAt: v.number(),
    updatedAt: v.number(),
  }).index("by_workspace", ["workspaceId"]),

  scriptVersions: defineTable({
    projectId: v.id("projects"),
    parentId: v.optional(v.id("scriptVersions")),
    format: v.union(v.literal("screenplay"), v.literal("av")),
    label: v.optional(v.string()),
    contentFileId: v.id("_storage"),
    createdBy: v.id("users"),
    createdAt: v.number(),
  })
    .index("by_project", ["projectId"])
    .index("by_parent", ["parentId"]),

  scenes: defineTable({
    projectId: v.id("projects"),
    /** Stable id from cinakey.script/1.0 scene.id — keeps Convex _id stable across versions. */
    elementId: v.string(),
    order: v.number(),
    heading: v.string(),
    synopsis: v.optional(v.string()),
    createdAt: v.number(),
    updatedAt: v.number(),
  })
    .index("by_project", ["projectId"])
    .index("by_project_order", ["projectId", "order"])
    .index("by_project_element", ["projectId", "elementId"]),

  shots: defineTable({
    projectId: v.id("projects"),
    sceneId: v.id("scenes"),
    order: v.number(),
    shotType: v.string(),
    lensMm: v.optional(v.number()),
    cameraMove: v.optional(v.string()),
    durationSec: v.number(),
    characterIds: v.array(v.id("entities")),
    locationId: v.optional(v.id("entities")),
    /** Stable dialogue line uuid from cinakey.script/1.0. */
    dialogueLineId: v.optional(v.string()),
    /** Denormalized snapshot of linked dialogue text. */
    dialogue: v.optional(v.string()),
    status: v.union(
      v.literal("planned"),
      v.literal("blocked_out"),
      v.literal("generating"),
      v.literal("selected"),
    ),
    /** True when linked script dialogue line changed or was removed. */
    outdated: v.boolean(),
    keyframeAssetId: v.optional(v.id("assets")),
    selectedTakeId: v.optional(v.id("takes")),
    blockoutFileId: v.optional(v.id("_storage")),
    notes: v.optional(v.string()),
    createdAt: v.number(),
    updatedAt: v.number(),
  })
    .index("by_project", ["projectId"])
    .index("by_scene", ["sceneId"])
    .index("by_scene_order", ["sceneId", "order"]),

  entities: defineTable({
    projectId: v.id("projects"),
    kind: v.union(
      v.literal("character"),
      v.literal("location"),
      v.literal("prop"),
      v.literal("style"),
    ),
    name: v.string(),
    description: v.optional(v.string()),
    lockedReferenceAssetIds: v.array(v.id("assets")),
    sheetFileId: v.optional(v.id("_storage")),
    createdAt: v.number(),
    updatedAt: v.number(),
  })
    .index("by_project", ["projectId"])
    .index("by_project_kind", ["projectId", "kind"]),

  assets: defineTable({
    projectId: v.id("projects"),
    sceneId: v.optional(v.id("scenes")),
    shotId: v.optional(v.id("shots")),
    entityId: v.optional(v.id("entities")),
    jobId: v.optional(v.id("generationJobs")),
    type: v.union(
      v.literal("video"),
      v.literal("image"),
      v.literal("audio"),
      v.literal("music"),
      v.literal("logo"),
      v.literal("json"),
      v.literal("other"),
    ),
    name: v.string(),
    /** Denormalized name + tags for search index. */
    searchText: v.string(),
    storageId: v.id("_storage"),
    format: v.string(),
    sizeBytes: v.number(),
    durationSec: v.optional(v.number()),
    width: v.optional(v.number()),
    height: v.optional(v.number()),
    tags: v.array(v.string()),
    lineage: v.optional(lineage),
    /** Required true when upload contains a real person's face. */
    likenessConsent: v.optional(v.boolean()),
    starred: v.boolean(),
    createdBy: v.id("users"),
    createdAt: v.number(),
    updatedAt: v.number(),
  })
    .index("by_project", ["projectId"])
    .index("by_project_type", ["projectId", "type"])
    .index("by_shot", ["shotId"])
    .index("by_entity", ["entityId"])
    .index("by_job", ["jobId"])
    .index("by_storage", ["storageId"])
    .searchIndex("search_name_tags", {
      searchField: "searchText",
      filterFields: ["projectId", "type", "starred"],
    }),

  generationJobs: defineTable({
    projectId: v.id("projects"),
    shotId: v.optional(v.id("shots")),
    entityId: v.optional(v.id("entities")),
    model: v.string(),
    modelVersion: v.string(),
    /** Adapter operation, e.g. text-to-image, image-to-video. */
    kind: v.string(),
    prompt: v.string(),
    seed: v.optional(v.number()),
    inputsFileId: v.optional(v.id("_storage")),
    estimatedCostCredits: v.number(),
    actualCostCredits: v.optional(v.number()),
    status: v.union(
      v.literal("queued"),
      v.literal("submitted"),
      v.literal("running"),
      v.literal("succeeded"),
      v.literal("failed"),
      v.literal("refunded"),
    ),
    providerJobId: v.optional(v.string()),
    outputAssetIds: v.array(v.id("assets")),
    errorMessage: v.optional(v.string()),
    /** Provider submit attempts (max 3 including first). */
    attempts: v.number(),
    createdBy: v.id("users"),
    createdAt: v.number(),
    updatedAt: v.number(),
  })
    .index("by_project", ["projectId"])
    .index("by_status", ["status"])
    .index("by_provider_job", ["providerJobId"])
    .index("by_entity", ["entityId"])
    .index("by_shot", ["shotId"]),

  takes: defineTable({
    projectId: v.id("projects"),
    shotId: v.id("shots"),
    assetId: v.id("assets"),
    jobId: v.id("generationJobs"),
    rating: v.optional(v.number()),
    selected: v.boolean(),
    createdAt: v.number(),
  })
    .index("by_shot", ["shotId"])
    .index("by_job", ["jobId"]),

  timelineVersions: defineTable({
    projectId: v.id("projects"),
    parentId: v.optional(v.id("timelineVersions")),
    label: v.optional(v.string()),
    timelineFileId: v.id("_storage"),
    createdBy: v.id("users"),
    createdAt: v.number(),
  })
    .index("by_project", ["projectId"])
    .index("by_parent", ["parentId"]),

  notes: defineTable({
    projectId: v.id("projects"),
    shotId: v.optional(v.id("shots")),
    takeId: v.optional(v.id("takes")),
    body: v.string(),
    authorId: v.id("users"),
    resolved: v.boolean(),
    createdAt: v.number(),
    updatedAt: v.number(),
  })
    .index("by_project", ["projectId"])
    .index("by_shot", ["shotId"]),

  creditLedger: defineTable({
    workspaceId: v.id("workspaces"),
    userId: v.id("users"),
    projectId: v.optional(v.id("projects")),
    jobId: v.optional(v.id("generationJobs")),
    delta: v.number(),
    reason: v.union(
      v.literal("grant"),
      v.literal("reserve"),
      v.literal("settle"),
      v.literal("refund"),
    ),
    balanceAfter: v.number(),
    createdAt: v.number(),
  })
    .index("by_workspace", ["workspaceId"])
    .index("by_workspace_time", ["workspaceId", "createdAt"]),

  notifications: defineTable({
    userId: v.id("users"),
    projectId: v.optional(v.id("projects")),
    kind: v.union(v.literal("job_succeeded"), v.literal("job_failed")),
    title: v.string(),
    body: v.optional(v.string()),
    href: v.optional(v.string()),
    read: v.boolean(),
    createdAt: v.number(),
  })
    .index("by_user", ["userId"])
    .index("by_user_unread", ["userId", "read"]),

  /** Linear copilot thread per project (one thread in MVP). */
  copilotMessages: defineTable({
    projectId: v.id("projects"),
    role: v.union(
      v.literal("user"),
      v.literal("assistant"),
      v.literal("system"),
      v.literal("tool"),
    ),
    content: v.string(),
    roleUsed: v.optional(
      v.union(
        v.literal("director"),
        v.literal("screenwriter"),
        v.literal("character_designer"),
      ),
    ),
    mode: v.optional(
      v.union(
        v.literal("brainstorm"),
        v.literal("critique"),
        v.literal("pacing"),
        v.literal("continuity"),
      ),
    ),
    toolCalls: v.optional(v.any()),
    proposalIds: v.optional(v.array(v.id("proposals"))),
    jobId: v.optional(v.id("generationJobs")),
    streaming: v.optional(v.boolean()),
    createdAt: v.number(),
    updatedAt: v.optional(v.number()),
  }).index("by_project", ["projectId"]),

  /** Copilot tool results awaiting user Accept / Edit / Reject. */
  proposals: defineTable({
    projectId: v.id("projects"),
    messageId: v.id("copilotMessages"),
    kind: v.union(
      v.literal("script_edit"),
      v.literal("entities"),
      v.literal("rules"),
      v.literal("character_details"),
      v.literal("image_prompt"),
      v.literal("shot_list"),
    ),
    status: v.union(
      v.literal("pending"),
      v.literal("accepted"),
      v.literal("rejected"),
      v.literal("edited"),
    ),
    /** Inline payload when small; otherwise use payloadFileId. */
    payload: v.optional(v.any()),
    payloadFileId: v.optional(v.id("_storage")),
    diffSummary: v.optional(v.string()),
    estimatedCostCredits: v.optional(v.number()),
    createdAt: v.number(),
    resolvedAt: v.optional(v.number()),
  })
    .index("by_project", ["projectId"])
    .index("by_message", ["messageId"])
    .index("by_project_status", ["projectId", "status"]),
  },
  { schemaValidation: true },
);

export default schema;
