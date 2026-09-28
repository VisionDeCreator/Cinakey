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
    /** When false, skip outbound email for jobs/exports. Default true when unset. */
    notificationEmailEnabled: v.optional(v.boolean()),
    onboardingDismissedAt: v.optional(v.number()),
  })
    .index("email", ["email"])
    .index("phone", ["phone"]),

  workspaces: defineTable({
    name: v.string(),
    ownerUserId: v.id("users"),
    /** Set when the one-time starter credit grant has been applied. */
    starterCreditsGrantedAt: v.optional(v.number()),
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
    /** Optional per-project credit spend cap; blocks new jobs when reached. */
    spendCapCredits: v.optional(v.number()),
    /** Guided trailer template project. */
    isStarter: v.optional(v.boolean()),
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
    /** Seedance generation unit (optional until a script prompt is accepted). */
    sequenceId: v.optional(v.id("sequences")),
    order: v.number(),
    shotType: v.string(),
    lensMm: v.optional(v.number()),
    cameraMove: v.optional(v.string()),
    durationSec: v.number(),
    /** Contiguous timing within the sequence (seconds from sequence start). */
    startSec: v.optional(v.number()),
    endSec: v.optional(v.number()),
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
    /** Accepted propose_shot_prompt override used by single-shot generation. */
    generationPromptOverride: v.optional(v.string()),
    /** Status before entering `generating`, restored on job failure. */
    statusBeforeGenerating: v.optional(
      v.union(
        v.literal("planned"),
        v.literal("blocked_out"),
        v.literal("generating"),
        v.literal("selected"),
      ),
    ),
    createdAt: v.number(),
    updatedAt: v.number(),
  })
    .index("by_project", ["projectId"])
    .index("by_scene", ["sceneId"])
    .index("by_scene_order", ["sceneId", "order"])
    .index("by_sequence", ["sequenceId"]),

  /** Seedance generation unit: consecutive shots ≤ maxDuration / max refs. */
  sequences: defineTable({
    projectId: v.id("projects"),
    order: v.number(),
    title: v.string(),
    durationSec: v.number(),
    scriptPromptId: v.optional(v.id("promptSheets")),
    shotIds: v.array(v.id("shots")),
    createdAt: v.number(),
    updatedAt: v.number(),
  })
    .index("by_project", ["projectId"])
    .index("by_project_order", ["projectId", "order"]),

  /**
   * Structured prompt sheets (asset / script / blockout). Large structured
   * JSON lives in storage; tip row points at current version via parent chain.
   */
  promptSheets: defineTable({
    projectId: v.id("projects"),
    type: v.union(
      v.literal("character"),
      v.literal("creature"),
      v.literal("environment"),
      v.literal("product"),
      v.literal("script"),
      v.literal("blockout"),
    ),
    entityId: v.optional(v.id("entities")),
    sequenceId: v.optional(v.id("sequences")),
    structuredFileId: v.id("_storage"),
    /** Inline when small; otherwise use renderedFileId. */
    renderedText: v.optional(v.string()),
    renderedFileId: v.optional(v.id("_storage")),
    templateVersion: v.string(),
    status: v.union(
      v.literal("draft"),
      v.literal("approved"),
      v.literal("generating"),
      v.literal("done"),
      v.literal("out_of_date"),
    ),
    isCustom: v.boolean(),
    parentId: v.optional(v.id("promptSheets")),
    version: v.number(),
    /** Script: @image_N → entity mapping. */
    referenceMap: v.optional(
      v.array(
        v.object({
          imageN: v.number(),
          entityId: v.id("entities"),
        }),
      ),
    ),
    sourceAssetSheetIds: v.optional(v.array(v.id("promptSheets"))),
    sourceScriptPromptId: v.optional(v.id("promptSheets")),
    /** Tip pointer: only the current version row is listed in pipeline. */
    isTip: v.boolean(),
    createdAt: v.number(),
    updatedAt: v.number(),
  })
    .index("by_project", ["projectId"])
    .index("by_project_type", ["projectId", "type"])
    .index("by_entity", ["entityId"])
    .index("by_sequence", ["sequenceId"])
    .index("by_parent", ["parentId"])
    .index("by_project_tip", ["projectId", "isTip"]),

  entities: defineTable({
    projectId: v.id("projects"),
    kind: v.union(
      v.literal("character"),
      v.literal("creature"),
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
    sequenceId: v.optional(v.id("sequences")),
    entityId: v.optional(v.id("entities")),
    promptSheetId: v.optional(v.id("promptSheets")),
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
    /** Set when job reaches a terminal status (succeeded/failed/refunded). */
    completedAt: v.optional(v.number()),
  })
    .index("by_project", ["projectId"])
    .index("by_status", ["status"])
    .index("by_provider_job", ["providerJobId"])
    .index("by_entity", ["entityId"])
    .index("by_shot", ["shotId"])
    .index("by_sequence", ["sequenceId"])
    .index("by_prompt_sheet", ["promptSheetId"])
    .index("by_model", ["model"]),

  takes: defineTable({
    projectId: v.id("projects"),
    shotId: v.id("shots"),
    assetId: v.id("assets"),
    /** Optional for starter-template sample takes (no generation job). */
    jobId: v.optional(v.id("generationJobs")),
    /** Trim window into a sequence master asset (seconds). */
    trimStartSec: v.optional(v.number()),
    trimEndSec: v.optional(v.number()),
    /** Lightweight playback proxy (browser-encoded). */
    proxyAssetId: v.optional(v.id("assets")),
    /** Lineage for upscale/extend. */
    parentTakeId: v.optional(v.id("takes")),
    rating: v.optional(v.number()),
    selected: v.boolean(),
    createdAt: v.number(),
  })
    .index("by_shot", ["shotId"])
    .index("by_job", ["jobId"])
    .index("by_parent", ["parentTakeId"])
    .index("by_project_created", ["projectId", "createdAt"])
    .index("by_created", ["createdAt"]),

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
    kind: v.union(
      v.literal("job_succeeded"),
      v.literal("job_failed"),
      v.literal("export_succeeded"),
      v.literal("export_failed"),
    ),
    title: v.string(),
    body: v.optional(v.string()),
    href: v.optional(v.string()),
    read: v.boolean(),
    createdAt: v.number(),
  })
    .index("by_user", ["userId"])
    .index("by_user_unread", ["userId", "read"]),

  /** Append-only staff action log. */
  auditLog: defineTable({
    actorUserId: v.id("users"),
    action: v.string(),
    targetType: v.optional(v.string()),
    targetId: v.optional(v.string()),
    reason: v.optional(v.string()),
    meta: v.optional(v.string()),
    createdAt: v.number(),
  }).index("by_time", ["createdAt"]),

  moderationFlags: defineTable({
    projectId: v.optional(v.id("projects")),
    jobId: v.optional(v.id("generationJobs")),
    assetId: v.optional(v.id("assets")),
    userId: v.id("users"),
    stage: v.union(v.literal("prompt"), v.literal("output")),
    verdict: v.union(v.literal("flagged"), v.literal("blocked")),
    ruleId: v.string(),
    snippet: v.optional(v.string()),
    status: v.union(
      v.literal("open"),
      v.literal("resolved"),
      v.literal("dismissed"),
    ),
    resolvedBy: v.optional(v.id("users")),
    resolvedAt: v.optional(v.number()),
    createdAt: v.number(),
  })
    .index("by_status", ["status", "createdAt"])
    .index("by_job", ["jobId"]),

  egressEvents: defineTable({
    userId: v.id("users"),
    workspaceId: v.id("workspaces"),
    projectId: v.optional(v.id("projects")),
    bytes: v.number(),
    kind: v.union(
      v.literal("storage_write"),
      v.literal("playback"),
      v.literal("download"),
      v.literal("export"),
    ),
    createdAt: v.number(),
  })
    .index("by_user_time", ["userId", "createdAt"])
    .index("by_project_time", ["projectId", "createdAt"])
    .index("by_workspace_time", ["workspaceId", "createdAt"]),

  analyticsEvents: defineTable({
    userId: v.optional(v.id("users")),
    workspaceId: v.optional(v.id("workspaces")),
    projectId: v.optional(v.id("projects")),
    name: v.string(),
    value: v.optional(v.number()),
    createdAt: v.number(),
  }).index("by_name_time", ["name", "createdAt"]),

  exports: defineTable({
    projectId: v.id("projects"),
    userId: v.id("users"),
    durationSec: v.number(),
    width: v.number(),
    height: v.number(),
    status: v.union(v.literal("succeeded"), v.literal("failed")),
    errorMessage: v.optional(v.string()),
    createdAt: v.number(),
  })
    .index("by_project", ["projectId"])
    .index("by_user_time", ["userId", "createdAt"]),

  rateLimitBuckets: defineTable({
    key: v.string(),
    windowStart: v.number(),
    count: v.number(),
  }).index("by_key", ["key"]),

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
      v.literal("story_treatment"),
      v.literal("asset_list"),
      v.literal("asset_sheet"),
      v.literal("style_block"),
      v.literal("script_prompt"),
      v.literal("blockout_sheet"),
      v.literal("shot_prompt"),
      v.literal("continuity"),
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
