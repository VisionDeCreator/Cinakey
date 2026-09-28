import type { ScriptPromptData, ScriptShot } from "./schemas";

/** Credits above which the UI must show a confirmation dialog before running. */
export const COST_CONFIRM_THRESHOLD_CREDITS = 50;

/**
 * Slice a multi-shot sequence script prompt into a one-shot Seedance prompt
 * in the same template (REFERENCES, ART STYLE, entity blocks, one SHOTS line,
 * CONSISTENCY, TECHNICAL, AUDIO).
 */
export function assembleSingleShotPrompt(
  sequenceData: ScriptPromptData,
  shotSelector: number | { n: number } | ScriptShot,
): ScriptPromptData {
  const targetN =
    typeof shotSelector === "number"
      ? shotSelector
      : "n" in shotSelector
        ? shotSelector.n
        : undefined;

  const sourceShot =
    typeof shotSelector === "object" && "action" in shotSelector
      ? shotSelector
      : sequenceData.shots.find((s) => s.n === targetN);

  if (!sourceShot) {
    throw new Error(
      `Shot ${String(targetN ?? "?")} not found in script prompt`,
    );
  }

  const durationSec = Math.max(0.1, sourceShot.endSec - sourceShot.startSec);
  const windowStart = sourceShot.startSec;
  const windowEnd = sourceShot.endSec;

  const remappedShot: ScriptShot = {
    ...sourceShot,
    n: 1,
    startSec: 0,
    endSec: durationSec,
  };

  const audioCues = sequenceData.audioCues
    .filter((c) => c.atSec >= windowStart && c.atSec < windowEnd)
    .map((c) => ({
      ...c,
      atSec: Math.max(0, c.atSec - windowStart),
    }));

  return {
    ...sequenceData,
    multiShot: false,
    totalDurationSec: durationSec,
    shots: [remappedShot],
    audioCues,
  };
}
