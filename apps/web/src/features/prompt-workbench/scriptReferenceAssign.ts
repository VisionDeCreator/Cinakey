/**
 * Rewrite or insert a REFERENCES line for `@image_N` so it points at `entityLabel`.
 * Preserves an existing "Use it for …" / trailing clause when present.
 */
export function assignScriptReferenceImage(
  promptText: string,
  imageN: number,
  entityLabel: string,
): string {
  const label = entityLabel.trim() || "asset";
  const lineRe = new RegExp(
    `^(@image_${imageN}\\s*=\\s*)(.+?)(\\.(?:\\s*.*)?)?$`,
    "im",
  );
  const match = promptText.match(lineRe);
  if (match) {
    const trailing = match[3]?.trim()
      ? match[3]!.startsWith(".")
        ? match[3]
        : `. ${match[3]}`
      : ". Use it for its exact appearance.";
    return promptText.replace(
      lineRe,
      `@image_${imageN} = ${label}${trailing.startsWith(".") ? trailing : `. ${trailing}`}`,
    );
  }

  // Insert under REFERENCES heading when present
  const refsHeader = /(^|\n)(REFERENCES)\s*\n/i.exec(promptText);
  if (refsHeader) {
    const insertAt = refsHeader.index + refsHeader[0].length;
    const newLine = `@image_${imageN} = ${label}. Use it for its exact appearance.\n`;
    return (
      promptText.slice(0, insertAt) + newLine + promptText.slice(insertAt)
    );
  }

  // Prepend a REFERENCES section
  return `REFERENCES\n@image_${imageN} = ${label}. Use it for its exact appearance.\n\n${promptText}`;
}

/** Image numbers mentioned as `@image_N` in the prompt (sorted unique). */
export function listScriptImageNs(promptText: string): number[] {
  const found = new Set<number>();
  for (const m of promptText.matchAll(/@image_(\d+)/gi)) {
    found.add(Number(m[1]));
  }
  return [...found].sort((a, b) => a - b);
}
