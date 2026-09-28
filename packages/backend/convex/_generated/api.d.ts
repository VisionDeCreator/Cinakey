/* eslint-disable */
/**
 * Generated `api` utility.
 *
 * THIS CODE IS AUTOMATICALLY GENERATED.
 *
 * To regenerate, run `npx convex dev`.
 * @module
 */

import type * as adapters_cost from "../adapters/cost.js";
import type * as adapters_deepseek from "../adapters/deepseek.js";
import type * as adapters_gptImage2 from "../adapters/gptImage2.js";
import type * as adapters_index from "../adapters/index.js";
import type * as adapters_mock from "../adapters/mock.js";
import type * as adapters_mockVideo from "../adapters/mockVideo.js";
import type * as adapters_seedance25 from "../adapters/seedance25.js";
import type * as assets from "../assets.js";
import type * as auth from "../auth.js";
import type * as blockouts from "../blockouts.js";
import type * as copilot from "../copilot.js";
import type * as credits from "../credits.js";
import type * as crons from "../crons.js";
import type * as egress from "../egress.js";
import type * as email from "../email.js";
import type * as entities from "../entities.js";
import type * as exports from "../exports.js";
import type * as generation from "../generation.js";
import type * as http from "../http.js";
import type * as lib_access from "../lib/access.js";
import type * as lib_analytics from "../lib/analytics.js";
import type * as lib_assetSearch from "../lib/assetSearch.js";
import type * as lib_audit from "../lib/audit.js";
import type * as lib_copilotPrompts from "../lib/copilotPrompts.js";
import type * as lib_env from "../lib/env.js";
import type * as lib_limits from "../lib/limits.js";
import type * as lib_normalizeScriptProposal from "../lib/normalizeScriptProposal.js";
import type * as lib_parseToolArguments from "../lib/parseToolArguments.js";
import type * as lib_promptRender from "../lib/promptRender.js";
import type * as lib_promptSheetDeps from "../lib/promptSheetDeps.js";
import type * as lib_rateLimit from "../lib/rateLimit.js";
import type * as lib_scriptMaterialize from "../lib/scriptMaterialize.js";
import type * as lib_versioning from "../lib/versioning.js";
import type * as lib_workspaces from "../lib/workspaces.js";
import type * as migrations from "../migrations.js";
import type * as moderation from "../moderation.js";
import type * as notifications from "../notifications.js";
import type * as onboarding from "../onboarding.js";
import type * as projects from "../projects.js";
import type * as promptSheets from "../promptSheets.js";
import type * as proposals from "../proposals.js";
import type * as scenes from "../scenes.js";
import type * as scriptVersions from "../scriptVersions.js";
import type * as seed from "../seed.js";
import type * as sequences from "../sequences.js";
import type * as shotGeneration from "../shotGeneration.js";
import type * as shots from "../shots.js";
import type * as staff from "../staff.js";
import type * as storage from "../storage.js";
import type * as takes from "../takes.js";
import type * as timelineVersions from "../timelineVersions.js";
import type * as users from "../users.js";

import type {
  ApiFromModules,
  FilterApi,
  FunctionReference,
} from "convex/server";

declare const fullApi: ApiFromModules<{
  "adapters/cost": typeof adapters_cost;
  "adapters/deepseek": typeof adapters_deepseek;
  "adapters/gptImage2": typeof adapters_gptImage2;
  "adapters/index": typeof adapters_index;
  "adapters/mock": typeof adapters_mock;
  "adapters/mockVideo": typeof adapters_mockVideo;
  "adapters/seedance25": typeof adapters_seedance25;
  assets: typeof assets;
  auth: typeof auth;
  blockouts: typeof blockouts;
  copilot: typeof copilot;
  credits: typeof credits;
  crons: typeof crons;
  egress: typeof egress;
  email: typeof email;
  entities: typeof entities;
  exports: typeof exports;
  generation: typeof generation;
  http: typeof http;
  "lib/access": typeof lib_access;
  "lib/analytics": typeof lib_analytics;
  "lib/assetSearch": typeof lib_assetSearch;
  "lib/audit": typeof lib_audit;
  "lib/copilotPrompts": typeof lib_copilotPrompts;
  "lib/env": typeof lib_env;
  "lib/limits": typeof lib_limits;
  "lib/normalizeScriptProposal": typeof lib_normalizeScriptProposal;
  "lib/parseToolArguments": typeof lib_parseToolArguments;
  "lib/promptRender": typeof lib_promptRender;
  "lib/promptSheetDeps": typeof lib_promptSheetDeps;
  "lib/rateLimit": typeof lib_rateLimit;
  "lib/scriptMaterialize": typeof lib_scriptMaterialize;
  "lib/versioning": typeof lib_versioning;
  "lib/workspaces": typeof lib_workspaces;
  migrations: typeof migrations;
  moderation: typeof moderation;
  notifications: typeof notifications;
  onboarding: typeof onboarding;
  projects: typeof projects;
  promptSheets: typeof promptSheets;
  proposals: typeof proposals;
  scenes: typeof scenes;
  scriptVersions: typeof scriptVersions;
  seed: typeof seed;
  sequences: typeof sequences;
  shotGeneration: typeof shotGeneration;
  shots: typeof shots;
  staff: typeof staff;
  storage: typeof storage;
  takes: typeof takes;
  timelineVersions: typeof timelineVersions;
  users: typeof users;
}>;

/**
 * A utility for referencing Convex functions in your app's public API.
 *
 * Usage:
 * ```js
 * const myFunctionReference = api.myModule.myFunction;
 * ```
 */
export declare const api: FilterApi<
  typeof fullApi,
  FunctionReference<any, "public">
>;

/**
 * A utility for referencing Convex functions in your app's internal API.
 *
 * Usage:
 * ```js
 * const myFunctionReference = internal.myModule.myFunction;
 * ```
 */
export declare const internal: FilterApi<
  typeof fullApi,
  FunctionReference<any, "internal">
>;

export declare const components: {};
