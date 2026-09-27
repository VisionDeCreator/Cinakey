/**
 * Parse LLM tool-call argument JSON, repairing common model quirks.
 */

export function parseToolArguments(
  raw: string,
): { ok: true; value: Record<string, unknown> } | { ok: false; error: string } {
  const trimmed = raw.trim();
  if (trimmed.length === 0) {
    return { ok: false, error: "Empty tool arguments" };
  }

  const candidates = [trimmed];

  // Strip markdown fences.
  const fence = trimmed.match(/^```(?:json)?\s*([\s\S]*?)```$/i);
  if (fence?.[1]) candidates.push(fence[1].trim());

  // Extract outermost object if prose wraps it.
  const firstBrace = trimmed.indexOf("{");
  const lastBrace = trimmed.lastIndexOf("}");
  if (firstBrace >= 0 && lastBrace > firstBrace) {
    candidates.push(trimmed.slice(firstBrace, lastBrace + 1));
  }

  // Truncated JSON: try closing open braces/brackets.
  if (!trimmed.endsWith("}")) {
    candidates.push(repairTruncatedJson(trimmed));
  }

  for (const candidate of candidates) {
    try {
      const value = JSON.parse(candidate) as unknown;
      if (value !== null && typeof value === "object" && !Array.isArray(value)) {
        const obj = value as Record<string, unknown>;
        // document sometimes arrives as a stringified JSON blob.
        if (typeof obj.document === "string") {
          const inner = tryParseObject(obj.document);
          if (inner) obj.document = inner;
        }
        if (typeof obj.script === "string") {
          const inner = tryParseObject(obj.script);
          if (inner) obj.script = inner;
        }
        return { ok: true, value: obj };
      }
    } catch {
      // try next candidate
    }
  }

  return {
    ok: false,
    error: `Could not parse tool arguments (${trimmed.length} chars)`,
  };
}

function tryParseObject(raw: string): Record<string, unknown> | null {
  try {
    const value = JSON.parse(raw) as unknown;
    if (value !== null && typeof value === "object" && !Array.isArray(value)) {
      return value as Record<string, unknown>;
    }
  } catch {
    return null;
  }
  return null;
}

function repairTruncatedJson(input: string): string {
  let s = input.trim();
  // Drop trailing incomplete string fragment after last complete key/value if obvious.
  if ((s.match(/"/g) ?? []).length % 2 === 1) {
    s += '"';
  }
  const opens: string[] = [];
  let inString = false;
  let escape = false;
  for (const ch of s) {
    if (inString) {
      if (escape) {
        escape = false;
      } else if (ch === "\\") {
        escape = true;
      } else if (ch === '"') {
        inString = false;
      }
      continue;
    }
    if (ch === '"') {
      inString = true;
      continue;
    }
    if (ch === "{" || ch === "[") opens.push(ch);
    if (ch === "}" || ch === "]") opens.pop();
  }
  // Remove trailing commas before closing.
  s = s.replace(/,\s*$/, "");
  while (opens.length > 0) {
    const open = opens.pop();
    s += open === "{" ? "}" : "]";
  }
  return s;
}
