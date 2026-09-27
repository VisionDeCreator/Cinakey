/**
 * Read Convex environment variables without a bare `process` identifier
 * (keeps apps that import `@cinakey/backend` api types happy without @types/node).
 */
export function convexEnv(name: string): string | undefined {
  const g = globalThis as {
    process?: { env?: Record<string, string | undefined> };
  };
  return g.process?.env?.[name];
}
