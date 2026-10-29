/** Branding is not a document format version. Preserve compatible imported namespaces. */
export function documentSchemaMatches(
  value: unknown,
  canonical: string,
): boolean {
  if (typeof value !== "string") return false;
  const match =
    /^[a-z][a-z0-9_-]*\.(blockout|timeline|sheet)\/(\d+\.\d+)$/.exec(value);
  return Boolean(match && canonical === `dirrio.${match[1]}/${match[2]}`);
}

/** Normalize only supported format/version pairs; callers still validate the full payload. */
export function normalizeDocumentNamespace(value: unknown): unknown {
  if (!value || typeof value !== "object" || Array.isArray(value)) return value;
  const doc = value as Record<string, unknown>;
  for (const schema of [
    "dirrio.blockout/1.0",
    "dirrio.blockout/2.0",
    "dirrio.timeline/1.0",
    "dirrio.sheet/1.0",
  ]) {
    if (documentSchemaMatches(doc.schema, schema)) return { ...doc, schema };
  }
  return value;
}
