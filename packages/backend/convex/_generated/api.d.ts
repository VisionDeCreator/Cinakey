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
import type * as adapters_index from "../adapters/index.js";
import type * as adminAccess from "../adminAccess.js";
import type * as adminAnalytics from "../adminAnalytics.js";
import type * as adminBilling from "../adminBilling.js";
import type * as adminJobs from "../adminJobs.js";
import type * as adminMedia from "../adminMedia.js";
import type * as adminOperations from "../adminOperations.js";
import type * as adminProviders from "../adminProviders.js";
import type * as adminSupport from "../adminSupport.js";
import type * as apiIdentity from "../apiIdentity.js";
import type * as assets from "../assets.js";
import type * as auth from "../auth.js";
import type * as authOtp from "../authOtp.js";
import type * as billing from "../billing.js";
import type * as bucketCleanup from "../bucketCleanup.js";
import type * as crons from "../crons.js";
import type * as earlyAccess from "../earlyAccess.js";
import type * as egress from "../egress.js";
import type * as email from "../email.js";
import type * as entities from "../entities.js";
import type * as exportSharing from "../exportSharing.js";
import type * as exports from "../exports.js";
import type * as generation from "../generation.js";
import type * as genjutsu from "../genjutsu.js";
import type * as helpContent from "../helpContent.js";
import type * as http from "../http.js";
import type * as lib_access from "../lib/access.js";
import type * as lib_adminAnalytics from "../lib/adminAnalytics.js";
import type * as lib_analytics from "../lib/analytics.js";
import type * as lib_assetSearch from "../lib/assetSearch.js";
import type * as lib_audit from "../lib/audit.js";
import type * as lib_authEmail from "../lib/authEmail.js";
import type * as lib_budgets from "../lib/budgets.js";
import type * as lib_env from "../lib/env.js";
import type * as lib_funding from "../lib/funding.js";
import type * as lib_generationSettings from "../lib/generationSettings.js";
import type * as lib_helpArticles from "../lib/helpArticles.js";
import type * as lib_jobEvents from "../lib/jobEvents.js";
import type * as lib_ledger from "../lib/ledger.js";
import type * as lib_limits from "../lib/limits.js";
import type * as lib_mediaControls from "../lib/mediaControls.js";
import type * as lib_mediaProtection from "../lib/mediaProtection.js";
import type * as lib_parseToolArguments from "../lib/parseToolArguments.js";
import type * as lib_paymentAccess from "../lib/paymentAccess.js";
import type * as lib_promptRender from "../lib/promptRender.js";
import type * as lib_promptSheetDeps from "../lib/promptSheetDeps.js";
import type * as lib_providerControls from "../lib/providerControls.js";
import type * as lib_rateLimit from "../lib/rateLimit.js";
import type * as lib_reconciliation from "../lib/reconciliation.js";
import type * as lib_registrationPolicy from "../lib/registrationPolicy.js";
import type * as lib_restrictions from "../lib/restrictions.js";
import type * as lib_versioning from "../lib/versioning.js";
import type * as lib_workspaces from "../lib/workspaces.js";
import type * as moderation from "../moderation.js";
import type * as notifications from "../notifications.js";
import type * as onboarding from "../onboarding.js";
import type * as payments from "../payments.js";
import type * as projects from "../projects.js";
import type * as promptSheets from "../promptSheets.js";
import type * as publishedExports from "../publishedExports.js";
import type * as references from "../references.js";
import type * as resources from "../resources.js";
import type * as series from "../series.js";
import type * as staff from "../staff.js";
import type * as staging from "../staging.js";
import type * as storage from "../storage.js";
import type * as storageIO from "../storageIO.js";
import type * as support from "../support.js";
import type * as tasks from "../tasks.js";
import type * as teamOnboarding from "../teamOnboarding.js";
import type * as teams from "../teams.js";
import type * as textJobs from "../textJobs.js";
import type * as timelineLeases from "../timelineLeases.js";
import type * as timelineVersions from "../timelineVersions.js";
import type * as users from "../users.js";
import type * as workspace from "../workspace.js";

import type {
  ApiFromModules,
  FilterApi,
  FunctionReference,
} from "convex/server";

declare const fullApi: ApiFromModules<{
  "adapters/cost": typeof adapters_cost;
  "adapters/index": typeof adapters_index;
  adminAccess: typeof adminAccess;
  adminAnalytics: typeof adminAnalytics;
  adminBilling: typeof adminBilling;
  adminJobs: typeof adminJobs;
  adminMedia: typeof adminMedia;
  adminOperations: typeof adminOperations;
  adminProviders: typeof adminProviders;
  adminSupport: typeof adminSupport;
  apiIdentity: typeof apiIdentity;
  assets: typeof assets;
  auth: typeof auth;
  authOtp: typeof authOtp;
  billing: typeof billing;
  bucketCleanup: typeof bucketCleanup;
  crons: typeof crons;
  earlyAccess: typeof earlyAccess;
  egress: typeof egress;
  email: typeof email;
  entities: typeof entities;
  exportSharing: typeof exportSharing;
  exports: typeof exports;
  generation: typeof generation;
  genjutsu: typeof genjutsu;
  helpContent: typeof helpContent;
  http: typeof http;
  "lib/access": typeof lib_access;
  "lib/adminAnalytics": typeof lib_adminAnalytics;
  "lib/analytics": typeof lib_analytics;
  "lib/assetSearch": typeof lib_assetSearch;
  "lib/audit": typeof lib_audit;
  "lib/authEmail": typeof lib_authEmail;
  "lib/budgets": typeof lib_budgets;
  "lib/env": typeof lib_env;
  "lib/funding": typeof lib_funding;
  "lib/generationSettings": typeof lib_generationSettings;
  "lib/helpArticles": typeof lib_helpArticles;
  "lib/jobEvents": typeof lib_jobEvents;
  "lib/ledger": typeof lib_ledger;
  "lib/limits": typeof lib_limits;
  "lib/mediaControls": typeof lib_mediaControls;
  "lib/mediaProtection": typeof lib_mediaProtection;
  "lib/parseToolArguments": typeof lib_parseToolArguments;
  "lib/paymentAccess": typeof lib_paymentAccess;
  "lib/promptRender": typeof lib_promptRender;
  "lib/promptSheetDeps": typeof lib_promptSheetDeps;
  "lib/providerControls": typeof lib_providerControls;
  "lib/rateLimit": typeof lib_rateLimit;
  "lib/reconciliation": typeof lib_reconciliation;
  "lib/registrationPolicy": typeof lib_registrationPolicy;
  "lib/restrictions": typeof lib_restrictions;
  "lib/versioning": typeof lib_versioning;
  "lib/workspaces": typeof lib_workspaces;
  moderation: typeof moderation;
  notifications: typeof notifications;
  onboarding: typeof onboarding;
  payments: typeof payments;
  projects: typeof projects;
  promptSheets: typeof promptSheets;
  publishedExports: typeof publishedExports;
  references: typeof references;
  resources: typeof resources;
  series: typeof series;
  staff: typeof staff;
  staging: typeof staging;
  storage: typeof storage;
  storageIO: typeof storageIO;
  support: typeof support;
  tasks: typeof tasks;
  teamOnboarding: typeof teamOnboarding;
  teams: typeof teams;
  textJobs: typeof textJobs;
  timelineLeases: typeof timelineLeases;
  timelineVersions: typeof timelineVersions;
  users: typeof users;
  workspace: typeof workspace;
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
