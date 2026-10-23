# Video provider contract

Cinakey uses the Ark task API. The default deployment is Beijing Ark and the
model is `doubao-seedance-2-5-260628`. Override `SEEDANCE_MODEL` and
`SEEDANCE_API_BASE_URL` in the ignored root `.env` when configuring a compatible
account/region. BytePlus Southeast Asia accounts use
`SEEDANCE_API_BASE_URL=https://ark.ap-southeast.bytepluses.com/api/v3` with
`SEEDANCE_MODEL=dreamina-seedance-2-5-260628`. Set `USE_MOCK_ADAPTERS=false`
for intentional live runs; automated tests continue to block real transports.
The configuration accepts an API root or a full create-task URL and strips the
`/contents/generations/tasks` suffix before the adapter builds submission/poll URLs.
Bearer authorization uses the key from the ignored root `.env`; keys and model
entitlements must match the selected provider and region. No provider keys are committed.

The implementation follows the official [create-task reference](https://docs.volcengine.com/docs/ark/create-video-generation-task-api?lang=zh)
and [Seedance 2.5 guide](https://docs.volcengine.com/docs/ark/seedance-2-5?lang=en),
reviewed October 23, 2026. Image references use `reference_image`, video references
use `reference_video`, and first/last frames use their own roles. Frame and
reference modes are mutually exclusive. First-frame and extension tasks use
`adaptive` ratio. Extensions use `omni_reference_task_type: extend`, not an
invented operation field. Task IDs are read from `id`; results from
`content.video_url`. Expired tasks are terminal failures; unknown statuses require
review rather than indefinite polling.

Cinakey deliberately offers a conservative subset: 4–30 whole seconds, 720p or
1080p, up to 30 image references, optional seeds, and one reference video. The
unverified upscale and camera-preset controls are unavailable. Describe camera
movement in the prompt. Credits remain Cinakey's existing two credits per requested
second policy, not a claim about the provider's wholesale pricing. Extension
controls request a five-second generated segment and preserve the source file.

Automated contract tests inject an in-memory transport and continue to block paid
network access. Local MP4 fixtures verify container metadata parsing. A documented
endpoint does not establish that a particular account has access.

## Authorized live verification — October 24, 2026

One five-second, 720p text-to-video task was submitted through Cinakey's authenticated
HTTP generation operation using the BytePlus Southeast Asia endpoint and
`dreamina-seedance-2-5-260628`. The production worker service processed only that
verification job. The provider task `cgt-20261024071809-krx2h` succeeded; Cinakey
saved a 6,631,017-byte MP4 with a registered media-file identity. Reading the stored
file back independently confirmed 1280×720 and 5.056 seconds (container duration).
The job settled ten Cinakey credits; this is not a measurement of the provider's
currency-denominated invoice.

The output was added to the verification project's editor timeline, saved,
reloaded, and played visibly in the browser. Live playback exposed frame starvation
when each animation tick invalidated a pending decode. Clock ticks now coalesce
without invalidating in-flight frames; seeks/document changes still invalidate
stale work. The preview retains its current image until another frame is ready
and holds the final visible frame at playback end. A regression test covers slow
decode during continuous playback. No additional video generation was used for
these playback checks. This smoke test does not establish reference-image, audio
reference, extension, or every-account compatibility.
