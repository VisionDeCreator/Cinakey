# Video production focus

Cinakey now focuses on Script → References (optional) → Staging (optional) →
Video → Edit → Export. Projects open on Video. The old `/copilot` route redirects
to Video; existing assets and look-dev links remain valid.

## Removed workflows

- Standalone and embedded conversational copilot, proposals and chat streaming.
- Image generation, image edits, identity-set generation and image-producing
  prompt-sheet approval. The generic generation API also rejects these operations
  before creating a job or reserving credits.
- OpenAI image provider implementation and registration. OpenAI is not required;
  an old `openai` entry in `ENABLED_PROVIDERS` is ignored for compatibility.

Seedance remains the video provider. DeepSeek remains for focused staging and
production metadata assistance. Shared text-job credit accounting lives in
`packages/backend/convex/textJobs.ts`, independent of the removed assistant.

## Images and existing projects

Uploads, previews, libraries, character/location/prop/style reference associations,
script reference mappings, video starting frames, timelines and exports remain.
Previously generated images remain usable as references. Clearing references
removes associations, not the underlying files. Reference notes and their version
history remain available without image-generation template requirements.

Legacy assistant/proposal tables and generation fields remain in the schema so
existing data is readable and account deletion still cleans up historical data.
No destructive data migration is required. Historical image jobs remain visible
in financial records. The staff provider report retains historical image metrics.

## Retired image jobs

The existing worker reconciliation discovers old jobs, including image jobs
without input files. Confirmed unsubmitted queued image jobs are refunded once.
Jobs with an accepted result checkpoint materialize that saved output and settle
normally through a recovery-only adapter with no network implementation.
Submitted, in-flight or ambiguous jobs without a checkpoint are marked uncertain
and parked for manual review; they are never resubmitted or automatically
refunded. Follow the submission-review procedure in backend-migration.md before
resolving their reserved credits. This preserves safeguards against double charges
and refunds. No OpenAI key is needed to recover a saved checkpoint.

## Rollout and verification

Deploy the retained Convex functions/schema, API, worker and web together through
the normal deployment process. Keep the legacy tables/fields until a separately
approved cleanup. Restart local development processes after updating.

Regression tests cover rejection before credit reservation, image reference
assignment/replacement/clearing, ordered video references and starting frames,
mocked video completion, retirement refunds, ambiguous-job parking, and saved
image recovery. All tests use mocked providers or saved fixtures and block
unmocked network access. No paid calls are needed for validation.

Broader playback, editor, rendering and export improvements remain separate work.
