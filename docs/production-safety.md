# Production safety and video workflow

## Saves and recovery

The editor initializes once per project session. Query invalidation never reloads
an open edit. Autosaves are serialized and only acknowledge the snapshot sent;
edits made while a save is in flight remain dirty and queue the next save.

The API validates timeline documents, indexes original/proxy asset dependencies,
and commits with an expected parent version and request ID. Stale writers get a
conflict. Network retries replay the same save request. Failures pause saving;
Retry retries that snapshot. Keep local as new version is an explicit append on
top of the latest saved tip, preserving the other version in history.

Dirty drafts are backed up to browser localStorage and offered for recovery on
reopening. Navigation to a new project isolates the save session. Failed initial
loads show Retry instead of opening a writable empty timeline. Browser storage
availability is not guaranteed, so an unload warning also protects dirty edits.

## Saved media

Manual asset deletion, master deletion and rejected-take retention protect media
used by any saved timeline version, including proxies. Referenced takes are kept.
Existing timelines without a media dependency index conservatively pin their
project's media. No historical records or files are removed by this change.
Shared storage aliases are retained. Images used as entity/style references must
be unassigned before deletion. Account deletion remains an explicit full purge.

A separate validated backfill can index legacy timelines later; until then, some
unused media in old projects cannot be deleted. This trades storage savings for
preserving edit history.

## Spending and provider requests

USD reservation, cap checking, request replay detection, job creation and task
dispatch occur in one Convex transaction. The former public spending bypass is
removed. Reusing a generation request ID with different settings fails. The web
client keeps request IDs across unknown network/server outcomes. Failed local
input validation and cap rejections do not submit provider requests or retain
input-file uploads on definite structured transaction rejections. Files with unknown
commit outcomes are retained for safe replay rather than risking a committed
snapshot or generation input. Shot generation flags are set only for newly reserved jobs.

Provider requests use the documented supported subset described in
[Provider contract](provider-contract.md). A saved synchronous result can still
recover without resubmission; ambiguous paid submissions remain parked for review.

## Preview, assembly and export

Preview requests are coalesced and stale decoded frames discarded. Titles are
painted after the current video frame. HTML media seeks are awaited and bounded.
Audio decoding completes before starting the playback clock. Playback at other
than normal speed uses silent trick-play. Media reads are deduplicated, cached
blobs are reused for container parsing, and cache retention is bounded.

Choosing another master or individual take changes the next assembly, not an
existing edit. Existing clips are replaced explicitly in the inspector, preserving
source offsets where possible and respecting playback speed. Source-in controls
allow correction of planned shot cuts. Generated media duration and dimensions
are parsed from the downloaded file; out-of-range planned trims are bounded.

Export checks original media and trim bounds before starting, reports decoding
failures, honors cancellation, and releases resources on every exit. Portrait and
square export records use their actual output dimensions. The current 1080p and
five-minute limits remain. Video offers individual-shot regeneration, take
selection, basic simultaneous comparison playback, and a direct Open in Edit link.

## Verification

Tests use rejected-by-default networking, injected provider transports, delayed
save promises and local media fixtures. They cover save races/recovery/conflicts,
legacy media protection, retention, concurrent cap reservations, generation replay,
provider payloads, stale preview frames, media read deduplication, export preflight,
and metadata parsing. No paid services are called during validation.

Editor media analysis now runs locally in the browser. Visible timeline clips and
media-bin cards request one shared analysis per source asset per editor session:
16 source-time filmstrip frames, a 2,048-bin absolute-amplitude audio envelope,
and automatic silent H.264 playback proxies for video larger than 960 pixels on
its longest edge. Proxies fit within 640 pixels, use 24 fps and one-second keyframe
intervals, and retain the full source time range. Thumbnails and waveforms reflect
clip trims and speed. Existing take proxies take precedence. Originals remain the
source for audio and export, and saved timeline documents are unchanged.

Analysis reuses playback blobs when available, processes one source at a time,
and decodes audio incrementally. Downloads are bounded to 128 MiB, sources to
five minutes, retained derivatives to 128 MiB, and analysis entries to 256 per
session. Images use their existing URLs without conversion. Failed downloads or
unsupported browser codecs leave the original media available. Leaving the editor
aborts processing and releases decoders and object URLs. Derivatives are temporary:
reopening the editor recreates them as needed; nothing is uploaded or added to
Convex storage, and no provider endpoint is involved.

Tests cover source-time sampling, opposite-phase stereo peaks, deduplication,
proxy conversion settings, existing-proxy precedence, resource limits, cancellation,
blob reuse and original-only export URL resolution. Media analysis tests use mocked
browser codecs and local byte fixtures with rejected-by-default networking. This
does not claim a complete live-account or cross-browser production acceptance test.

The current USD quote, indexed aggregate, audit and development-pricing behavior is
documented in [USD accounting](usd-accounting.md).
