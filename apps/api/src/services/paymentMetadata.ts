/** Read stable metadata identities from receipts created before or after a branding change. */
export function paymentMetadata(
  metadata: Record<string, unknown>,
  field: "intent" | "refund",
): string | undefined {
  const matches = Object.entries(metadata)
    .filter(
      ([key, value]) => key.endsWith(`_${field}`) && typeof value === "string",
    )
    .map(([, value]) => value as string);
  const unique = [...new Set(matches)];
  // Conflicting receipt identities must not silently bind to either intent.
  return unique.length === 1 ? unique[0] : undefined;
}
