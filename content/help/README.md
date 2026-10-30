# Repository help articles

This folder contains product help articles shipped with the application. The content
importer deploys them into the development or production knowledge base. Staff can
also create and edit articles in Admin → Support → Knowledge base.

## Deploy content

From the repository root, preview the development deployment:

```sh
bun run help:deploy --environment development
```

Apply it after reviewing the preview:

```sh
bun run help:deploy --environment development --apply
```

The default credentials file is the root `.env`. Only `CONVEX_URL` and
`CONVEX_DEPLOY_KEY` are read; the importer does not load provider credentials. Use an
explicit file for production:

```sh
bun run help:deploy --environment production --env-file deployments/convex/.env
bun run help:deploy --environment production --env-file deployments/convex/.env --apply
```

A development target requires a `dev:` key; production requires `prod:`. The selected
HTTPS Convex URL must match the deployment encoded in the key. No credentials are
printed. Self-hosted and preview deployment keys are not supported by this tool.
The latest backend schema/functions must be deployed first.

`bun run deploy:convex` automatically imports this folder after successfully deploying
production Convex functions. It validates the local articles before changing runtime
flags. If the content import encounters conflicts, the release command fails with an
explicit message that functions are already deployed. Resolve the content issue and
rerun `help:deploy`; a second backend deployment is unnecessary.

For content-only changes, `help:deploy` updates the knowledge base without rebuilding
web or admin. It preserves article IDs, updates published retrieval chunks in the same
transaction, and leaves unchanged imports untouched. The whole content batch is atomic:
unresolved conflicts or changes made after preview abort all its article writes.

## Article layout

Store one Markdown file per article, grouped by language. English articles live in
`en/`; translations belong in `fr/`, `es/`, `ko/`, `ja/`, or `zh/`. English source
articles can also support chatbot answers in other languages.

Each file starts with the following metadata format, followed by its article body:

```markdown
---
key: getting-started
language: en
title: Getting started with your creative workspace
category: Getting started
published: true
---

Your customer-facing article text goes here.
```

The stable `key` and `language` identify a repository article independently of its
file name or database ID. Reuse the key for translations of the same article.
Keys use lowercase letters, numbers, dots and hyphens. Metadata supports plain,
single-quoted, or JSON-style double-quoted strings and a literal true/false publication
flag. Nested YAML, aliases, unknown/duplicate metadata fields, duplicate identities,
symlinks and mismatched language directories are rejected. The body is stored as
plain Markdown text using the existing article display; raw HTML is not executed.

The importer validates all files before contacting Convex. A release accepts up to
100 articles and 512 KiB of serialized content; each body is at most 30,000 characters.
The maintainer README is excluded from import. Keep internal runbooks, credentials
and test fixtures outside this folder.

## Manual articles and conflicts

Manually created articles are preserved. Repository articles are matched only by
key and language, never by title. Existing manual articles with a matching title are
not silently adopted. Admin displays each article's origin and repository provenance.

Repository articles remain editable in Admin. Their last accepted content is stored
as a baseline. If someone changes an imported article in Admin, deployment reports a
conflict instead of overwriting it—even when the repository file has not changed.
Move the desired edit into the file, or choose explicitly for that article:

```sh
# Restore the repository version after reviewing the conflict.
bun run help:deploy --environment development --resolve getting-started:en=repository --apply

# Keep the database version as an approved local override.
bun run help:deploy --environment development --resolve getting-started:en=database --apply
```

Repeat `--resolve` for multiple articles. A database override is accepted for the
current repository content hash. Later deployments of the same source are no-ops;
a new repository change or another Admin edit requires review again. Preview and
apply check both content revisions and synchronization generations to detect
concurrent authoring or content deployment.

Removing a file does not delete or unpublish its database article. To retire an
article, keep its file with `published: false` and deploy that explicit change. Its
identity is preserved while retrieval chunks are removed. Draft content and import
baselines are not exposed through customer help queries.

## Provenance and container use

Each changed article records its key, source language, SHA-256 content hash, source
revision, import time and accepted baseline. Changes produce operator audit entries.
The source revision defaults to the Git commit, with `-dirty` when this folder has
uncommitted changes. Pass `--revision <release-label>` to supply a release identity;
without Git, the tool can use `RELEASE_VERSION` from its process environment.

API and worker images include this content and the importer. For an installed root
Compose stack, an explicit content deployment can run inside the API container:

```sh
docker compose exec -T api bun run help:deploy --environment production --env-file .env --revision release-2026-10-30
docker compose exec -T api bun run help:deploy --environment production --env-file .env --revision release-2026-10-30 --apply
```

Use a release label matching the actual image. Container images exclude `.git`, so
provide `--revision` or `RELEASE_VERSION`. No import runs implicitly on API/worker
startup. Changing an image alone does not deploy database content; the production
backend release command or an explicit content deployment performs that step.

## Starter content

- `en/getting-started.md`: product workflow and workspace layout.
- `en/using-references.md`: script references and stable media aliases.
- `en/adding-footage.md`: previewing and adding generated footage to the timeline.
- `en/contacting-support.md`: chatbot help, human replies, attachments and languages.

These articles are grounded in the product README, workspace model and support
runbook. Review their wording and release applicability before production deployment.

## Verification

See the [development acceptance record](../../docs/evidence/help-content/acceptance.json)
for imported content, no-op redeployments, conflict resolution, publication changes,
browser screenshots and explicit coverage limits. Production was not changed during
this verification.
