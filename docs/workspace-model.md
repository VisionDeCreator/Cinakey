# Project-owned workspace model

Cinakey stores plain-text script versions (`workspaceScripts`), independent staging documents (`workspaceStaging`), assets, generation jobs, and saved timeline versions. Scenes, sequences, shots, and takes have been removed from the database schema and application operations. Local camera cuts and animation timing remain inside staging JSON; they are not production records.

Scripts accept arbitrary text or an empty document. Project aliases bind repeated `@name`, `@image_1`, and `@video_1` mentions to stable asset IDs. Renaming an asset does not break an existing binding. Generation freezes the script version, resolved image/video references, settings, and staging selection in its input snapshot. Regeneration, extend, and upscale create ordinary assets and preserve earlier outputs.

AI staging uses the script text and an explicit duration. Manual 3D staging works without a script. Recompiling a stored plan makes no provider request. Saving creates a new file version with an optimistic conflict check; history restores retain the associated plan and script provenance. Rendering previsualization and video editing run in the browser.

## Development cutover

The development deployment was migrated before deleting the old records. All old script versions were copied into plain-text history, ordered script parts were combined, conflicting local reference aliases were given unique names, and staging documents were copied with their file histories. Proxy and rating metadata moved onto assets. Saved timeline files were rewritten to reference assets directly while preserving trim windows, speed, clip positions, audio, titles, proxies, and timeline version IDs. Media and generation job IDs were retained.

The one-shot migration and cleanup endpoints were removed after the cutover. No archived production tables or take-source compatibility reader are required. New projects initialize an empty script directly. Saved timeline and staging history protect their referenced media from deletion.
