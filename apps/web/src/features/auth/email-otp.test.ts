import { afterEach, expect, it, vi } from "vitest";
import {
  persistChallenge,
  requestEmailCode,
  restoreChallenge,
} from "./email-otp";
afterEach(() => {
  vi.unstubAllGlobals();
  sessionStorage.clear();
});
it("does not restore malformed or expired challenges and tolerates unavailable storage", () => {
  for (const value of [
    "broken",
    "null",
    JSON.stringify({
      email: "user@test.com",
      challenge: "a".repeat(64),
      expiresAt: Date.now() - 1,
      resendAt: 1,
    }),
  ]) {
    sessionStorage.setItem("cinakey.email-login.v1", value);
    expect(restoreChallenge()).toBeNull();
  }
  vi.stubGlobal("sessionStorage", {
    setItem: () => {
      throw new Error();
    },
    getItem: () => {
      throw new Error();
    },
    removeItem: () => {
      throw new Error();
    },
  });
  expect(() => persistChallenge(null)).not.toThrow();
  expect(restoreChallenge()).toBeNull();
});
it("requests a code without an auth token and sanitizes errors/retry intervals", async () => {
  const fetch = vi
    .fn()
    .mockResolvedValue(
      Response.json(
        { message: "SMTP_PASSWORD=secret", retryAfterSeconds: 99_999 },
        { status: 429 },
      ),
    );
  vi.stubGlobal("fetch", fetch);
  await expect(
    requestEmailCode("user@test.com", new AbortController().signal),
  ).rejects.toMatchObject({
    message: "Please wait before requesting another code.",
    retryAfterSeconds: 3600,
  });
  expect(fetch).toHaveBeenCalledWith(
    expect.stringContaining("/auth/email/request"),
    expect.objectContaining({
      body: JSON.stringify({ email: "user@test.com" }),
      cache: "no-store",
      headers: { "content-type": "application/json" },
    }),
  );
});
