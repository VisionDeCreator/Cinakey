const fs = require("node:fs");
const path = require("node:path");
const { createRequire } = require("node:module");
const ts = createRequire(path.resolve("apps/web/package.json"))("typescript");
const directory = "packages/ui/src/locales";
const codes = ["en", "fr", "es", "ko", "ja", "zh"];
const catalogs = Object.fromEntries(
  codes.map((code) => [
    code,
    JSON.parse(fs.readFileSync(`${directory}/${code}.json`, "utf8")),
  ]),
);
const keys = Object.keys(catalogs.en).sort();
const placeholders = (text) => (text.match(/\{\w+\}/g) || []).sort().join(",");
const errors = [];
const technical = new Set([
  "Dirrio",
  "MP4",
  "JSON",
  "USD",
  "FPS",
  "MB",
  "H.264 + AAC",
  "Seedance 2.5",
  "DELETE",
  "name@example.com",
]);
for (const code of codes) {
  const catalog = catalogs[code];
  if (JSON.stringify(Object.keys(catalog).sort()) !== JSON.stringify(keys))
    errors.push(`${code}: catalog keys differ from English`);
  for (const key of keys) {
    if (typeof catalog[key] !== "string" || !catalog[key].trim())
      errors.push(`${code}: missing translation for ${key}`);
    else if (placeholders(catalog[key]) !== placeholders(key))
      errors.push(`${code}: placeholder mismatch for ${key}`);
  }
}
function scan(directory) {
  for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
    const file = path.join(directory, entry.name);
    if (entry.isDirectory()) {
      scan(file);
      continue;
    }
    if (!/\.tsx?$/.test(file) || /\.test\.|\/test\//.test(file)) continue;
    const ast = ts.createSourceFile(
      file,
      fs.readFileSync(file, "utf8"),
      ts.ScriptTarget.Latest,
      true,
    );
    function check(value, node) {
      if (!Object.prototype.hasOwnProperty.call(catalogs.en, value))
        errors.push(
          `${file}:${ast.getLineAndCharacterOfPosition(node.getStart(ast)).line + 1}: unknown translation key ${JSON.stringify(value)}`,
        );
    }
    // Literal alternatives must be covered even when t() selects them at runtime.
    function checkMessageExpression(node) {
      if (ts.isStringLiteral(node)) check(node.text, node);
      else if (ts.isConditionalExpression(node)) {
        checkMessageExpression(node.whenTrue);
        checkMessageExpression(node.whenFalse);
      } else if (ts.isParenthesizedExpression(node)) {
        checkMessageExpression(node.expression);
      }
    }
    function visit(node) {
      if (
        file.startsWith("apps/admin/src/") &&
        ts.isPropertyAssignment(node) &&
        ["label", "description", "title", "text"].includes(
          node.name.getText(ast),
        ) &&
        ts.isStringLiteral(node.initializer)
      )
        check(node.initializer.text, node.initializer);
      if (
        ts.isCallExpression(node) &&
        ["t", "tn"].includes(node.expression.getText(ast))
      ) {
        for (const argument of node.arguments.slice(
          0,
          node.expression.getText(ast) === "tn" ? 2 : 1,
        ))
          checkMessageExpression(argument);
      }
      if (
        (ts.isJsxSelfClosingElement(node) || ts.isJsxOpeningElement(node)) &&
        node.tagName.getText(ast) === "I18nText"
      ) {
        for (const attribute of node.attributes.properties)
          if (
            ts.isJsxAttribute(attribute) &&
            attribute.name.getText(ast) === "text" &&
            attribute.initializer &&
            ts.isStringLiteral(attribute.initializer)
          )
            check(attribute.initializer.text, attribute);
      }
      if (
        ts.isJsxAttribute(node) &&
        node.name.getText(ast) === "label" &&
        node.initializer &&
        ts.isStringLiteral(node.initializer)
      )
        check(node.initializer.text, node.initializer);
      if (
        ts.isJsxAttribute(node) &&
        ["title", "placeholder", "aria-label", "alt"].includes(
          node.name.getText(ast),
        ) &&
        node.initializer &&
        ts.isStringLiteral(node.initializer)
      ) {
        const text = node.initializer.text;
        if (/[A-Za-z]{2}/.test(text) && !technical.has(text))
          errors.push(
            `${file}:${ast.getLineAndCharacterOfPosition(node.getStart(ast)).line + 1}: untranslated ${node.name.getText(ast)} ${JSON.stringify(text)}`,
          );
      }
      if (ts.isJsxText(node)) {
        const text = node.text.replace(/\s+/g, " ").trim();
        if (/[A-Za-z]{2}/.test(text) && !technical.has(text))
          errors.push(
            `${file}:${ast.getLineAndCharacterOfPosition(node.getStart(ast)).line + 1}: untranslated JSX text ${JSON.stringify(text)}`,
          );
      }
      ts.forEachChild(node, visit);
    }
    visit(ast);
  }
}
for (const directory of ["apps/web/src", "apps/admin/src", "packages/ui/src"])
  scan(directory);
// Display catalogs and navigation use dynamic lookups: validate their source values too.
for (const [file, declarations] of [
  [
    "packages/shared/src/admin-analytics.ts",
    ["ANALYTICS_METRICS", "ANALYTICS_DIMENSIONS"],
  ],
  ["packages/shared/src/admin-permissions.ts", ["ADMIN_ROLE_LABELS"]],
  ["apps/admin/src/App.tsx", ["sections"]],
  ["apps/admin/src/Billing.tsx", ["balanceLabels"]],
]) {
  const ast = ts.createSourceFile(
    file,
    fs.readFileSync(file, "utf8"),
    ts.ScriptTarget.Latest,
    true,
  );
  function message(value) {
    const key = value.replace(" (USD micros)", " (USD)");
    if (!Object.hasOwn(catalogs.en, key))
      errors.push(
        `${file}: unknown dynamic translation key ${JSON.stringify(key)}`,
      );
  }
  function visit(node) {
    if (
      ts.isVariableDeclaration(node) &&
      declarations.includes(node.name.getText(ast)) &&
      node.initializer
    ) {
      let value = node.initializer;
      if (ts.isAsExpression(value)) value = value.expression;
      if (ts.isObjectLiteralExpression(value))
        for (const property of value.properties) {
          if (
            ts.isPropertyAssignment(property) &&
            ts.isStringLiteral(property.initializer)
          )
            message(property.initializer.text);
        }
      if (ts.isArrayLiteralExpression(value))
        for (const item of value.elements) {
          if (ts.isStringLiteral(item)) message(item.text);
          if (
            ts.isArrayLiteralExpression(item) &&
            ts.isStringLiteral(item.elements[1])
          )
            message(item.elements[1].text);
        }
    }
    ts.forEachChild(node, visit);
  }
  visit(ast);
}
if (errors.length) {
  console.error(errors.join("\n"));
  process.exitCode = 1;
} else
  console.log(
    `Validated ${keys.length} interface messages across ${codes.length} languages, including interpolation placeholders and source references.`,
  );
