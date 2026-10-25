import { expect, it } from "vitest";
import {
  audioUrlForClip,
  videoCacheKeyForClip,
  videoUrlForClip,
} from "./mediaUrls";
it("switches raw assets to local proxies without polluting original/audio/export caches", () => {
  const source = { type: "asset", assetId: "a" };
  const original = { a: { url: "original" } };
  const proxied = { a: { url: "original", proxyUrl: "blob:proxy" } };
  expect(videoCacheKeyForClip(source, original)).toBe("a");
  expect(videoCacheKeyForClip(source, proxied)).not.toBe("a");
  expect(videoUrlForClip(source, proxied, true)).toBe("blob:proxy");
  expect(videoUrlForClip(source, proxied, false)).toBe("original");
  expect(audioUrlForClip(source, proxied)).toBe("original");
});
it("preserves saved asset proxies and uses the original when the proxy is missing", () => {
  const source = { type: "asset", assetId: "a", proxyAssetId: "p" };
  const urls = {
    a: { url: "original", proxyUrl: "blob:local" },
    p: { url: "existing" },
  };
  expect(videoUrlForClip(source, urls, true)).toBe("existing");
  expect(videoUrlForClip(source, { a: { url: "original" } }, true)).toBe(
    "original",
  );
  expect(videoUrlForClip(source, urls, false)).toBe("original");
});
