# Video provider contract

Cinakey uses the Ark task API. The default deployment is Beijing Ark and the
model is `doubao-seedance-2-5-260628`. Override `SEEDANCE_MODEL` and
`SEEDANCE_API_BASE_URL` in the ignored root `.env` when configuring a compatible
account/region. No provider keys are committed.

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

Contract tests inject an in-memory transport. Local MP4 fixtures verify container
metadata parsing; no paid smoke test or account entitlement check was performed.
A documented endpoint does not establish that a particular account has access.
