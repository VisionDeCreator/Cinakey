# Series and shared production resources

A workspace owns billing, permissions and media files. A project is one production:
standalone when `seriesId` is absent, or an episode when it belongs to a Series.
Episode scripts, shots, staging, jobs, timelines and exports use the same production
services and stable project URLs as standalone projects.

## Domain model

- `series`: workspace ownership, description, numbered settings versions, output
  defaults, style notes/rules and archive status.
- `projects`: optional series membership, episode number/order, adopted settings
  version, and an optional explicitly adopted active style entity.
- `mediaFiles`: one workspace-owned physical file identity, indexed by storage ID.
  Normal uploads, generated outputs and series uploads register files here.
- `assets`: typed media metadata referencing a physical file. A project upload can
  have a project owner; a series upload has a workspace owner. Series and episodes
  use the same asset IDs and stored bytes. Storage ID/format fields remain
  denormalized for existing playback and provider readers; no file is cloned.
- `libraryResources` / `resourceVersions`: stable library identities and immutable
  versions describing media, characters, creatures, locations, props or style.
  Each version pins its asset IDs and optional full entity sheet snapshot.
- `resourceAssetUses`: indexed version-to-asset dependencies for retention/deletion.
- `projectResources`: explicit, idempotent adoption of a particular resource version.
- `projectAssetLinks`: indexed project membership for shared asset IDs; there are
  no duplicate per-episode asset rows or file uploads.

Resources can be promoted from a standalone project or episode in the same
workspace, or uploaded directly to the series library. Importing an entity creates
an episode-local entity snapshot with pinned image references and, where present,
its complete sheet JSON. Adopting a new version creates another explicit snapshot;
it never rewrites scripts, replaces selected references, swaps timeline clips or
regenerates existing videos. Adopting a style explicitly selects its local style
entity for future reference/prompt work. New media versions become additional
available files; edits keep their original asset IDs.

## Access and safety

Series ownership follows workspace ownership (with the existing staff override).
Workspace access alone does not attach media to a production: generation inputs,
entity sheets, staging references, project style images and timeline saves validate
project ownership or explicit shared-asset membership. Import requires membership
in the resource's Series and matching workspace ownership. Asset URLs remain
workspace-authorized and are requested only for previews or adopted project media.

Series settings are copied when an episode is created. Attaching a standalone
project changes membership only. Applying updated defaults adopts style notes and
rules explicitly; existing episode output dimensions and frame rate are retained.
Episode numbers are positive and unique within a Series, independently of display
order. Detaching an episode preserves adopted bindings and media so it remains a
working standalone project. Copies created through the existing project duplicate
operation remain independent standalone project shells.

Archive is the supported library/series removal action. It preserves existing
versions, project links, historical edits and file access, while preventing new
adoption or new episodes until restored. Ordinary deletion and rejected-take
retention protect library dependencies, including assets not yet used by an
individual episode. Full account deletion explicitly purges the library graph,
episode links, project data and workspace-owned files. There is no automatic
unreferenced-version garbage collector or permanent Series deletion interface.

## Interface and services

`/series` lists active/archived Series and creates a Series. `/series/:seriesId`
provides episodes, a paginated shared library, and defaults/settings. Episodes can
be created, attached, reordered, archived/restored or made standalone. The project
header provides an episode switcher, shared-library browser, and explicit adoption
of changed style/rules. Standalone projects remain available at `/projects`.

Library cards offer on-demand file previews, immutable version history, adoption
of current or previous versions, revision publication and archival. Full sheets can
be promoted by choosing an existing project entity. Publishing a revision checks
its expected current version to reject stale writes. Upload completion and resource
adoption are replay-safe. Library metadata is paginated; browsing does not download
all Series files or query progress for every episode.

Product operations use the existing authenticated Bun/Elysia HTTP facade. Convex
performs indexed reads and atomic persistence transactions; Series operations have
no provider calls or worker generation side effects. Credits, spend caps and job
ownership remain project/episode scoped. Series-wide spend caps and season-level
organization are not part of this release.

## Deployment and validation

Deploy Convex schema/functions and the updated API manifest with the matching web
application. This implementation uses additive fields/tables; no development-data
reset or live migration was run. Regenerate Convex type bindings normally during
local development; matching declarations are included for offline typechecking.

Tests run against an in-memory Convex database and local Blob fixtures, with
rejected-by-default networking and mocked providers. They cover standalone/default
behavior, shared file identity, version pinning, entity-sheet reuse, active style,
archival, detachment, project/media access, timeline saves, generation admission,
retention, numbering/reordering, paginated metadata, upload replay, likeness consent,
account purge, and basic UI creation/adoption flows. No paid calls are needed.
