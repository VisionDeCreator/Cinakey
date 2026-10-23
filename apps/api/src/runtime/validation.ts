/** Validate service arguments with the same Convex validators used by persistence. */
export function validateValue(
  schema: any,
  value: unknown,
  path = "args",
): void {
  if (value === undefined) {
    if (schema.optional) return;
    throw new Error(`Invalid ${path}`);
  }
  switch (schema.type) {
    case "any":
      return;
    case "null":
      if (value === null) return;
      break;
    case "string":
    case "id":
      if (
        typeof value === "string" &&
        (schema.type !== "id" || value.length > 0)
      )
        return;
      break;
    case "number":
      if (typeof value === "number" && Number.isFinite(value)) return;
      break;
    case "bigint":
      if (typeof value === "bigint") return;
      break;
    case "boolean":
      if (typeof value === "boolean") return;
      break;
    case "literal":
      if (value === schema.value) return;
      break;
    case "bytes":
      if (value instanceof ArrayBuffer) return;
      break;
    case "array":
      if (Array.isArray(value)) {
        value.forEach((item, i) =>
          validateValue(schema.value, item, `${path}[${i}]`),
        );
        return;
      }
      break;
    case "union":
      for (const member of schema.value) {
        try {
          validateValue(member, value, path);
          return;
        } catch {}
      }
      break;
    case "record":
      if (value && typeof value === "object" && !Array.isArray(value)) {
        for (const [k, item] of Object.entries(value)) {
          validateValue(schema.keys, k, path);
          validateValue(schema.values, item, `${path}.${k}`);
        }
        return;
      }
      break;
    case "object":
      if (value && typeof value === "object" && !Array.isArray(value)) {
        const record = value as Record<string, unknown>;
        for (const key of Object.keys(record))
          if (!Object.prototype.hasOwnProperty.call(schema.value, key))
            throw new Error(`Unexpected ${path}.${key}`);
        for (const [key, field] of Object.entries(schema.value) as [
          string,
          any,
        ][])
          validateValue(
            { ...field.fieldType, optional: field.optional },
            record[key],
            `${path}.${key}`,
          );
        return;
      }
      break;
    default:
      throw new Error(`Unsupported validator ${schema.type}`);
  }
  throw new Error(`Invalid ${path}`);
}
export function validateArgs(validators: Record<string, any>, value: unknown) {
  const fields = Object.fromEntries(
    Object.entries(validators).map(([key, validator]) => [
      key,
      {
        fieldType: validator.json,
        optional: validator.isOptional === "optional",
      },
    ]),
  );
  validateValue({ type: "object", value: fields }, value);
}
