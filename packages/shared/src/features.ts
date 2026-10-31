/** Release switch shared by the web app, API, and Convex backend.
 * Re-enable Remix here and deploy all three services together.
 * This only gates new work; existing job processing must remain available.
 */
export const FEATURES = { remix: false };

export function assertRemixEnabled() {
  if (!FEATURES.remix) throw new Error("Remix is temporarily unavailable.");
}

export function assertGenerationModelEnabled(model: string) {
  if (model === "sume-remix-lite") assertRemixEnabled();
}
