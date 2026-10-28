import { vi } from "vitest";
import { setProviderTransportForTests } from "../src/providers/transport";
/** Wire response fixture for tests that exercise real analysis parsing/accounting. */
export function installAnalysisFixture() {
  vi.stubEnv("DEEPSEEK_API_KEY", "test-key");
  setProviderTransportForTests(
    async () =>
      new Response(
        JSON.stringify({
          created: Math.floor(Date.now() / 1000),
          choices: [
            {
              message: {
                content: JSON.stringify({
                  subjects: "A person",
                  action: "Walking",
                  camera: "Fixed",
                  setting: "A street",
                  uncertainties: [],
                }),
              },
            },
          ],
          usage: {
            prompt_tokens: 1,
            completion_tokens: 1,
            prompt_cache_hit_tokens: 0,
            total_tokens: 2,
          },
        }),
        { headers: { "Content-Type": "application/json" } },
      ),
  );
}
