/** A media element's currentTime assignment is asynchronous; never paint its previous frame. */
export function seekMediaFrame(
  video: HTMLVideoElement,
  time: number,
): Promise<void> {
  if (Math.abs(video.currentTime - time) < 0.01 && video.readyState >= 2)
    return Promise.resolve();
  return new Promise((resolve, reject) => {
    const cleanup = () => {
      clearTimeout(timer);
      video.removeEventListener("seeked", done);
      video.removeEventListener("error", fail);
    };
    const done = () => {
      cleanup();
      resolve();
    };
    const fail = () => {
      cleanup();
      reject(new Error("Video seek could not complete"));
    };
    const timer = setTimeout(fail, 15_000);
    video.addEventListener("seeked", done, { once: true });
    video.addEventListener("error", fail, { once: true });
    try {
      video.currentTime = time;
    } catch {
      fail();
    }
  });
}
