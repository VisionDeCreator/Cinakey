import { expect, it } from "vitest";
import { addPeaks, proxyDimensions, sourceTime } from "./analysis";
it("retains peaks from opposite-phase stereo and positions streamed audio in source time", () => {
  const peaks = Array<number>(4).fill(0);
  addPeaks(
    peaks,
    [new Float32Array([0.8, 0]), new Float32Array([-0.8, 0.5])],
    2,
    1,
    2,
  );
  expect(peaks.slice(0, 2)).toEqual([0, 0]);
  expect(peaks[2]).toBeCloseTo(0.8);
  expect(peaks[3]).toBe(0.5);
});
it("maps trimmed, speed-adjusted clips without changing source timing", () => {
  expect(sourceTime(3, 2, 4)).toBe(11);
  expect(sourceTime(3, 0.5, 4)).toBe(5);
});
it("fits landscape, portrait and odd-sized proxies within an even 640px box", () => {
  expect(proxyDimensions(1920, 1080)).toEqual({ width: 640, height: 360 });
  expect(proxyDimensions(1080, 1920)).toEqual({ width: 360, height: 640 });
  expect(proxyDimensions(301, 101)).toEqual({ width: 300, height: 100 });
});
