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
import type * as adapters_seedance25 from "../adapters/seedance25.js";
import type * as assets from "../assets.js";
import type * as auth from "../auth.js";
import type * as blockouts from "../blockouts.js";
import type * as credits from "../credits.js";
import type * as generation from "../generation.js";
import type * as http from "../http.js";
import type * as lib_access from "../lib/access.js";
import type * as lib_assetSearch from "../lib/assetSearch.js";
import type * as lib_env from "../lib/env.js";
import type * as lib_versioning from "../lib/versioning.js";
import type * as lib_workspaces from "../lib/workspaces.js";
import type * as migrations from "../migrations.js";
import type * as notifications from "../notifications.js";
import type * as projects from "../projects.js";
import type * as scriptVersions from "../scriptVersions.js";
import type * as seed from "../seed.js";
import type * as storage from "../storage.js";
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
  "adapters/seedance25": typeof adapters_seedance25;
  assets: typeof assets;
  auth: typeof auth;
  blockouts: typeof blockouts;
  credits: typeof credits;
  generation: typeof generation;
  http: typeof http;
  "lib/access": typeof lib_access;
  "lib/assetSearch": typeof lib_assetSearch;
  "lib/env": typeof lib_env;
  "lib/versioning": typeof lib_versioning;
  "lib/workspaces": typeof lib_workspaces;
  migrations: typeof migrations;
  notifications: typeof notifications;
  projects: typeof projects;
  scriptVersions: typeof scriptVersions;
  seed: typeof seed;
  storage: typeof storage;
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
