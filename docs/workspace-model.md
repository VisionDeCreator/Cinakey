# Project-owned workspace model

Cinakey stores plain-text script versions (`workspaceScripts`), independent staging documents (`workspaceStaging`), assets, generation jobs, and saved timeline versions. Scenes, sequences, shots, and takes have been removed from the database schema and application operations. Local camera cuts and animation timing remain inside staging JSON; they are not production records.

Scripts accept arbitrary text or an empty document. Project aliases bind repeated `@name`, `@image_1`, and `@video_1` mentions to stable asset IDs. Renaming an asset does not break an existing binding. Generation freezes the script version, resolved image/video references, settings, and staging selection in its input snapshot. Regeneration, extend, and upscale create ordinary assets and preserve earlier outputs.

AI staging uses the script text and an explicit duration. Manual 3D staging works without a script. Recompiling a stored plan makes no provider request. Saving creates a new file version with an optimistic conflict check; history restores retain the associated plan and script provenance. Rendering previsualization and video editing run in the browser.

## Development cutover

The development deployment was migrated before deleting the old records. All old script versions were copied into plain-text history, ordered script parts were combined, conflicting local reference aliases were given unique names, and staging documents were copied with their file histories. Proxy and rating metadata moved onto assets. Saved timeline files were rewritten to reference assets directly while preserving trim windows, speed, clip positions, audio, titles, proxies, and timeline version IDs. Media and generation job IDs were retained.

The one-shot migration and cleanup endpoints were removed after the cutover. No archived production tables or take-source compatibility reader are required. New projects initialize an empty script directly. Saved timeline and staging history protect their referenced media from deletion.

## Internal company workspaces

Platform administrators (the server-controlled `users.isStaff` permission used by Staff tools) can create a company-funded workspace under Admin → Workspaces. Choose an existing owner account, a name, a monthly USD budget, and an audit reason. Owners select the new workspace from the workspace menu and invite the team normally. Members do not need staff privileges. Ordinary workspace owners/admins cannot enable company funding.

Internal billing is a workspace policy, independent of owner/admin/creator/reviewer permissions and project assignments. It grants subscription access and free creator seats only within that workspace. Customer and personal workspaces retain their normal billing rules. Payment checkout, seat purchases, and portal operations are blocked server-side for internal workspaces. Existing workspaces can be enabled through the staff mutation only before any reservation or payment/checkout history; use a dedicated new workspace for an existing paying team.

Every job still uses its normal price quote, reservation, settlement, and refund. Reservations receive an exact company funding grant for any balance shortfall, recorded separately from purchased credit and reused after releases. The ledger pins company funding on the reservation so settlement attribution does not depend on a later policy lookup. No artificial unlimited balance or zero-priced rate card is needed. The amount payable by the internal workspace is zero.

Internal spending totals track recorded provider cost and standard customer price separately. Workspace monthly, series, and project caps reserve the normal maximum price while work runs, then count actual provider cost at settlement. Unknown provider costs use the settled standard price as a conservative budget estimate; incomplete production metering retains the reservation for reconciliation. Captured supplier costs remain company spending even if the customer-price reservation is fully refunded. Unexpected provider overruns may exceed a cap after execution; subsequent work is blocked. Monthly attribution follows the reservation's UTC month. The accounting audit/rebuild reconstructs these totals from immutable ledger entries.

Billing displays company funding, free seats, zero payable, provider costs, standard prices, and budget controls. Internal usage does not create a subscription, purchased funding, or revenue. Provider charges still accrue to the company's provider accounts. Enabling this feature does not change provider configuration or turn on live generation.
