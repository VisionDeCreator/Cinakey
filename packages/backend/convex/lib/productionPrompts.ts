export function scriptSummaryFromDocument(doc: {
  scenes: Array<{
    heading: string;
    estimatedDurationSec?: number;
    beats: Array<{
      action?: string;
      lines: Array<{ characterName: string; dialogue: string }>;
    }>;
  }>;
  totalEstimatedDurationSec?: number;
  format: string;
}): string {
  const lines: string[] = [
    `Format: ${doc.format}. Estimated total: ${doc.totalEstimatedDurationSec ?? "?"}s.`,
  ];
  doc.scenes.forEach((scene, i) => {
    lines.push(
      `Scene ${i + 1}: ${scene.heading} (~${scene.estimatedDurationSec ?? "?"}s)`,
    );
    for (const beat of scene.beats) {
      if (beat.action) lines.push(`  Action: ${beat.action.slice(0, 200)}`);
      for (const line of beat.lines) {
        lines.push(`  ${line.characterName}: ${line.dialogue.slice(0, 160)}`);
      }
    }
  });
  const text = lines.join("\n");
  return text.length > 6000 ? `${text.slice(0, 6000)}\n…` : text;
}
