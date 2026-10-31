import { FEATURES } from "@dirrio/shared";
import {
  beforeEach as beforeFeatureTest,
  afterEach as afterFeatureTest,
} from "vitest";
// Exercise the preserved implementation with the release switch enabled.
beforeFeatureTest(() => {
  FEATURES.remix = true;
});
afterFeatureTest(() => {
  FEATURES.remix = false;
});
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { api, internal } from "../../../apps/api/src/operations";
import {
  fundTestWorkspace,
  authIdentity,
  createTestUser,
  makeTest,
} from "../test/helpers";
import { TRIAL_DURATION_MS } from "./lib/paymentAccess";

beforeEach(() => {
  vi.stubEnv("WORKSPACE_TRIAL_ENABLED", "true");
  vi.stubEnv("SUBSCRIPTION_PAYWALL_ENABLED", "true");
  vi.stubEnv("POLAR_ENVIRONMENT", "sandbox");
});
afterEach(() => {
  vi.unstubAllEnvs();
  vi.useRealTimers();
});
async function fixture() {
  const t = makeTest();
  const userId = await createTestUser(t, "trial@test.com");
  const owner = t.withIdentity(authIdentity(userId));
  const workspaceId = await owner.mutation(
    api.users.ensurePersonalWorkspace,
    {},
  );
  const create = () =>
    owner.mutation(api.projects.create, { workspaceId, title: "Trial film" });
  const entitlements = () =>
    owner.query(api.payments.entitlements, { workspaceId });
  const purchase = async () => {
    const { intent } = await owner.mutation(internal.payments.prepareCheckout, {
      workspaceId,
      environment: "sandbox",
      requestId: crypto.randomUUID(),
      kind: "topup",
      productId: "topup-10",
      seats: 1,
      amountCents: 1000,
    });
    const order = {
      workspaceId,
      environment: "sandbox" as const,
      customerId: "customer-trial",
      orderId: "trial-topup",
      kind: "topup" as const,
      netCents: 1000,
      refundedCents: 0,
      paid: true,
      createdAt: Date.now(),
      billingReason: "purchase",
      intentId: intent._id,
      topupUsdMicros: 10_000_000,
    };
    await t.mutation(internal.payments.applyOrder, order);
    await t.mutation(internal.payments.applyOrder, order);
    return intent;
  };
  return { t, userId, owner, workspaceId, create, entitlements, purchase };
}
it("starts once on production creation, not signup, and expires at exactly 168 hours", async () => {
  vi.useFakeTimers();
  const f = await fixture();
  expect(await f.entitlements()).toMatchObject({
    canWrite: false,
    canStartTrial: true,
  });
  const projectId = await f.create();
  const started = Date.now();
  expect(await f.entitlements()).toMatchObject({
    canWrite: true,
    validUntil: started + TRIAL_DURATION_MS,
  });
  vi.setSystemTime(started + 60_000);
  await f.create();
  expect((await f.entitlements()).validUntil).toBe(started + TRIAL_DURATION_MS);
  vi.setSystemTime(started + TRIAL_DURATION_MS);
  expect(await f.entitlements()).toMatchObject({
    canWrite: false,
    code: "TRIAL_EXPIRED",
    canStartTrial: false,
    canGenerate: false,
  });
  await expect(
    f.owner.mutation(api.projects.update, { projectId, title: "Denied" }),
  ).rejects.toThrow();
  await expect(f.create()).rejects.toThrow();
  expect(await f.owner.query(api.projects.get, { projectId })).toBeTruthy();
});
it("funds trial top-ups once with no subscription or included allowance, and keeps residual generation usable", async () => {
  vi.useFakeTimers();
  const f = await fixture();
  const projectId = await f.create();
  await f.purchase();
  const summary = await f.owner.query(api.payments.summary, {
    workspaceId: f.workspaceId,
  });
  expect(summary).toMatchObject({
    purchasedAvailable: 10_000_000,
    includedAvailable: 0,
    canPurchaseUsage: true,
  });
  expect(summary.state?.subscriptionId).toBeUndefined();
  expect((await f.entitlements()).canWrite).toBe(true);
  vi.setSystemTime(Date.now() + TRIAL_DURATION_MS);
  expect(await f.entitlements()).toMatchObject({
    canWrite: false,
    canGenerate: true,
  });
  await expect(f.purchase()).rejects.toThrow();
  const quote = await f.owner.mutation(api.generation.quote, {
    projectId,
    adapterId: "seedance-2.5",
    kind: "text-to-video",
    durationSec: 5,
    resolution: "720p",
  });
  expect(quote.maximumUsdMicros).toBe(1_392_000);
  const jobId = await f.t.mutation(internal.generation.createQueuedJob, {
    projectId,
    workspaceId: f.workspaceId,
    model: "seedance-2.5",
    modelVersion: "fixture",
    kind: "text-to-video",
    prompt: "Saved input",
    estimatedCostUsdMicros: quote.maximumUsdMicros,
    createdBy: f.userId,
    quoteId: quote.quoteId,
    durationSec: 5,
    resolution: "720p",
  });
  const hold = await f.t.run((ctx) =>
    ctx.db
      .query("usageLedger")
      .withIndex("by_job", (q) => q.eq("jobId", jobId))
      .collect(),
  );
  expect(hold[0]?.fundingAllocations?.reduce((n, a) => n + a.amount, 0)).toBe(
    1_392_000,
  );
  await expect(
    f.owner.action(api.storage.storeJson, { projectId, value: {} }),
  ).rejects.toThrow();
});
it("does not consume eligibility on failed creation and supports series and Genjutsu entry points", async () => {
  const f = await fixture();
  await expect(
    f.owner.mutation(api.series.create, {
      workspaceId: f.workspaceId,
      title: "Invalid",
      fps: 99,
    }),
  ).rejects.toThrow();
  expect((await f.entitlements()).canStartTrial).toBe(true);
  await f.owner.mutation(api.series.create, {
    workspaceId: f.workspaceId,
    title: "Series",
  });
  expect((await f.entitlements()).canWrite).toBe(true);
  const otherId = await createTestUser(f.t, "genjutsu-trial@test.com");
  const other = f.t.withIdentity(authIdentity(otherId));
  await other.mutation(api.genjutsu.create, { title: "Transformation" });
  const user = await f.t.run((ctx) => ctx.db.get(otherId));
  expect(user?.trialWorkspaceId).toBeTruthy();
});
it("does not reset eligibility across workspaces or disable promised trials when enrollment closes", async () => {
  const f = await fixture();
  await f.create();
  vi.stubEnv("WORKSPACE_TRIAL_ENABLED", "false");
  expect((await f.entitlements()).canWrite).toBe(true);
  const secondId = await f.t.run((ctx) =>
    ctx.db.insert("workspaces", {
      name: "Second",
      ownerUserId: f.userId,
      createdAt: Date.now(),
      updatedAt: Date.now(),
    }),
  );
  vi.stubEnv("WORKSPACE_TRIAL_ENABLED", "true");
  expect(
    await f.owner.query(api.payments.entitlements, { workspaceId: secondId }),
  ).toMatchObject({ canStartTrial: false, canWrite: false });
});
it("denies unverified users, environment mismatches and suspended workspaces", async () => {
  const f = await fixture();
  await f.t.run((ctx) =>
    ctx.db.patch(f.userId, { emailVerificationTime: undefined }),
  );
  await expect(f.create()).rejects.toThrow();
  await f.t.run((ctx) =>
    ctx.db.patch(f.userId, { emailVerificationTime: Date.now() }),
  );
  await f.create();
  vi.stubEnv("POLAR_ENVIRONMENT", "production");
  expect((await f.entitlements()).canWrite).toBe(false);
  vi.stubEnv("POLAR_ENVIRONMENT", "sandbox");
  await f.t.run((ctx) =>
    ctx.db.patch(f.workspaceId, { productionPausedAt: Date.now() }),
  );
  expect(await f.entitlements()).toMatchObject({
    canWrite: false,
    canGenerate: false,
  });
});
it("blocks creator expansion during trial and permits explicit paid conversion with one monthly allowance", async () => {
  const f = await fixture();
  await f.create();
  await f.purchase();
  const memberId = await createTestUser(f.t, "extra-creator@test.com");
  await f.t.run((ctx) =>
    ctx.db.insert("workspaceMembers", {
      workspaceId: f.workspaceId,
      userId: memberId,
      role: "creator",
      createdAt: Date.now(),
    }),
  );
  expect((await f.entitlements()).canWrite).toBe(false);
  const now = Date.now();
  await f.t.mutation(internal.payments.applySubscription, {
    workspaceId: f.workspaceId,
    environment: "sandbox",
    customerId: "customer-trial",
    subscriptionId: "trial-converted",
    status: "active",
    seats: 2,
    periodStart: now,
    periodEnd: now + 30 * 86400_000,
    cancelAtPeriodEnd: false,
    providerUpdatedAt: now,
  });
  expect((await f.entitlements()).canWrite).toBe(false);
  const order = {
    workspaceId: f.workspaceId,
    environment: "sandbox" as const,
    customerId: "customer-trial",
    subscriptionId: "trial-converted",
    orderId: "paid-conversion",
    kind: "subscription" as const,
    netCents: 3900,
    refundedCents: 0,
    paid: true,
    createdAt: now,
    billingReason: "subscription_create",
    seats: 2,
    periodStart: now,
    periodEnd: now + 30 * 86400_000,
  };
  await f.t.mutation(internal.payments.applyOrder, order);
  await f.t.mutation(internal.payments.applyOrder, order);
  expect((await f.entitlements()).canWrite).toBe(true);
  expect(
    await f.owner.query(api.payments.summary, { workspaceId: f.workspaceId }),
  ).toMatchObject({
    includedAvailable: 5_000_000,
    purchasedAvailable: 10_000_000,
  });
});
it("accepts payment for an already authorized trial checkout after trial expiry", async () => {
  vi.useFakeTimers();
  const f = await fixture();
  await f.create();
  const { intent } = await f.owner.mutation(internal.payments.prepareCheckout, {
    workspaceId: f.workspaceId,
    environment: "sandbox",
    requestId: crypto.randomUUID(),
    kind: "topup",
    productId: "topup-10",
    seats: 1,
    amountCents: 1000,
  });
  vi.setSystemTime(Date.now() + TRIAL_DURATION_MS);
  await f.t.mutation(internal.payments.applyOrder, {
    workspaceId: f.workspaceId,
    environment: "sandbox",
    customerId: "late-customer",
    orderId: "late-order",
    kind: "topup",
    netCents: 1000,
    refundedCents: 0,
    paid: true,
    createdAt: Date.now(),
    billingReason: "purchase",
    intentId: intent._id,
    topupUsdMicros: 10_000_000,
  });
  expect(await f.entitlements()).toMatchObject({
    canWrite: false,
    canGenerate: true,
  });
});
it("submits a fully purchased queued job after expiry, but refunds a job funded by a trial-time grant", async () => {
  vi.useFakeTimers();
  const f = await fixture();
  const projectId = await f.create();
  await f.purchase();
  const createJob = (estimatedCostUsdMicros: number) =>
    f.t.mutation(internal.generation.createQueuedJob, {
      projectId,
      workspaceId: f.workspaceId,
      model: "seedance-2.5",
      modelVersion: "fixture",
      kind: "text-to-video",
      prompt: "Existing inputs",
      estimatedCostUsdMicros,
      createdBy: f.userId,
    });
  const purchasedJob = await createJob(10_000_000);
  await fundTestWorkspace(f.t, f.userId, 1000, "trial-time-test-grant");
  const grantJob = await createJob(1000);
  vi.setSystemTime(Date.now() + TRIAL_DURATION_MS);
  expect((await f.entitlements()).canGenerate).toBe(false);
  expect(
    await f.t.mutation(internal.generation.beginSubmission, {
      jobId: purchasedJob,
      attempt: 1,
    }),
  ).toBe("submit");
  expect(
    await f.t.mutation(internal.generation.beginSubmission, {
      jobId: grantJob,
      attempt: 1,
    }),
  ).toBe("terminal");
  expect(await f.t.run((ctx) => ctx.db.get(grantJob))).toMatchObject({
    status: "refunded",
  });
});
it("allows the complete credit-funded workflow after expiry while keeping production tools locked", async () => {
  vi.useFakeTimers();
  const f = await fixture();
  const existingId = await f.create();
  await f.purchase();
  vi.setSystemTime(Date.now() + TRIAL_DURATION_MS);
  const projectId = await f.create();
  for (const id of [existingId, projectId]) {
    await f.owner.action(api.workspace.ensure, { projectId: id });
    const current = await f.owner.query(api.workspace.list, { projectId: id });
    await f.owner.mutation(api.workspace.saveScript, {
      projectId: id,
      expectedId: current.script?._id,
      text: "A new video idea",
    });
  }
  const imageFile = await f.t.run((ctx) =>
    ctx.storage.store(new Blob(["image"], { type: "image/png" })),
  );
  const imageId = await f.owner.mutation(api.storage.createAssetFromUpload, {
    projectId,
    storageId: imageFile,
    type: "image",
    name: "Reference",
  });
  const videoFile = await f.t.run((ctx) =>
    ctx.storage.store(new Blob(["video"], { type: "video/mp4" })),
  );
  await f.owner.mutation(api.storage.createAssetFromUpload, {
    projectId,
    storageId: videoFile,
    type: "video",
    name: "Video reference",
    durationSec: 5,
  });
  await f.owner.mutation(api.references.bind, {
    projectId,
    alias: "image_1",
    assetId: imageId,
  });
  const current = await f.owner.query(api.workspace.list, { projectId });
  await f.owner.mutation(api.workspace.saveScript, {
    projectId,
    expectedId: current.script?._id,
    text: "A scene inspired by @image_1",
  });
  await f.owner.mutation(api.projects.saveGenerationSettings, {
    projectId,
    segmentId: current.segments[0]!._id,
    durationSec: 5,
    resolution: "720p",
  });
  const generated = await f.owner.action(api.workspace.generate, {
    projectId,
    durationSec: 5,
    resolution: "720p",
  });
  expect(await f.t.run((ctx) => ctx.db.get(generated.jobId))).toMatchObject({
    projectId,
    inputAssetIds: [imageId],
    status: "queued",
  });
  expect((await f.entitlements()).canWrite).toBe(false);
  await expect(
    f.owner.mutation(api.series.create, {
      title: "Blocked series",
      workspaceId: f.workspaceId,
    }),
  ).rejects.toThrow();
  await expect(
    f.owner.mutation(api.timelineLeases.claim, {
      projectId,
      sessionId: "blocked-editor",
    }),
  ).rejects.toThrow();
  await expect(
    f.owner.mutation(api.projects.saveGenerationSettings, {
      projectId,
      useStaging: true,
    }),
  ).rejects.toThrow("staging");
  await expect(
    f.owner.mutation(api.teams.invite, {
      workspaceId: f.workspaceId,
      email: "reviewer@test.com",
      role: "reviewer",
    }),
  ).rejects.toThrow();
  await expect(
    f.owner.action(api.storage.storeJson, {
      projectId,
      value: { timeline: true },
    }),
  ).rejects.toThrow();
  await expect(f.purchase()).rejects.toThrow();
  const audioFile = await f.t.run((ctx) =>
    ctx.storage.store(new Blob(["audio"], { type: "audio/mpeg" })),
  );
  await expect(
    f.owner.mutation(api.storage.createAssetFromUpload, {
      projectId,
      storageId: audioFile,
      type: "audio",
      name: "Timeline audio",
    }),
  ).rejects.toThrow("reference uploads only");
});
it("rechecks image/video upload access and stops all preparation when purchased balance is fully reserved", async () => {
  vi.useFakeTimers();
  const f = await fixture();
  const projectId = await f.create();
  await f.purchase();
  await f.owner.action(api.workspace.ensure, { projectId });
  const current = await f.owner.query(api.workspace.list, { projectId });
  vi.setSystemTime(Date.now() + TRIAL_DURATION_MS);
  await f.owner.mutation(internal.storageIO.beginR2Upload, {
    projectId,
    token: "credit-upload",
    key: "staging/credit-upload",
  });
  await expect(
    f.t.mutation(internal.storageIO.prepareR2Upload, {
      token: "credit-upload",
      contentType: "application/json",
      size: 12,
    }),
  ).rejects.toThrow("reference uploads only");
  await f.t.mutation(internal.storageIO.prepareR2Upload, {
    token: "credit-upload",
    contentType: "image/png",
    size: 12,
  });
  await f.t.mutation(internal.storageIO.claimR2Upload, {
    token: "credit-upload",
  });
  await f.t.mutation(internal.generation.createQueuedJob, {
    projectId,
    workspaceId: f.workspaceId,
    model: "seedance-2.5",
    modelVersion: "fixture",
    kind: "text-to-video",
    prompt: "Spend remaining balance",
    estimatedCostUsdMicros: 10_000_000,
    createdBy: f.userId,
  });
  expect((await f.entitlements()).canGenerate).toBe(false);
  await expect(f.create()).rejects.toThrow();
  await expect(
    f.owner.mutation(api.workspace.saveScript, {
      projectId,
      expectedId: current.script?._id,
      text: "No balance",
    }),
  ).rejects.toThrow();
  await expect(
    f.owner.mutation(api.storage.createUploadUrl, { projectId }),
  ).rejects.toThrow();
  await expect(
    f.t.mutation(internal.storageIO.claimR2Upload, { token: "credit-upload" }),
  ).rejects.toThrow();
  await expect(
    f.t.mutation(internal.storageIO.completeR2Upload, {
      token: "credit-upload",
      bucket: "fixture-bucket",
      key: "staging/credit-upload",
      size: 12,
      contentType: "image/png",
    }),
  ).rejects.toThrow();
  expect(await f.owner.query(api.projects.get, { projectId })).toBeTruthy();
});
