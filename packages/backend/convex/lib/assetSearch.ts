/** Build denormalized search text from asset name and tags. */
export function buildSearchText(name: string, tags: string[]): string {
  return [name, ...tags].join(" ").trim().toLowerCase();
}
