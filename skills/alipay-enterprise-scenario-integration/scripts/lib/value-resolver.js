"use strict";

function decodeString(raw, quote) {
  if (quote === "\"") {
    try {
      return JSON.parse(`"${raw}"`);
    } catch (_) {
      // Keep the original text when the source contains language-specific escapes.
    }
  }
  return raw.replace(new RegExp(`\\\\${quote}`, "g"), quote).replace(/\\\\/g, "\\");
}

function extractStringConstants(text) {
  const constants = new Map();
  const assignment = /(?:^|[^A-Za-z0-9_$])\$?([A-Za-z_$][A-Za-z0-9_$]*)\s*(?::=|=>|=|:)\s*(["'])((?:\\.|(?!\2)[\s\S])*?)\2/gm;
  for (const match of text.matchAll(assignment)) {
    constants.set(match[1], decodeString(match[3], match[2]));
  }
  const aliases = [];
  const aliasAssignment = /(?:^|[^A-Za-z0-9_$])\$?([A-Za-z_$][A-Za-z0-9_$]*)\s*(?::=|=>|=|:)\s*([A-Za-z_$][A-Za-z0-9_$]*(?:(?:\s*\.|::\s*)[A-Za-z_$][A-Za-z0-9_$]*)*)\b/gm;
  for (const match of text.matchAll(aliasAssignment)) {
    aliases.push([match[1], match[2].replace(/\s+/g, "")]);
  }
  let changed = true;
  while (changed) {
    changed = false;
    for (const [name, ref] of aliases) {
      if (constants.has(name)) continue;
      const simpleName = ref.split(/\.|::/).pop();
      const value = constants.get(ref) || constants.get(simpleName);
      if (value !== undefined) {
        constants.set(name, value);
        changed = true;
      }
    }
  }
  return constants;
}

function resolveStringArg(arg, constants = new Map()) {
  const trimmed = String(arg || "").trim();
  const literal = trimmed.match(/^(["'])((?:\\.|(?!\1)[\s\S])*?)\1$/);
  if (literal) return decodeString(literal[2], literal[1]);

  const normalized = trimmed.replace(/\s+/g, "").replace(/^\$/, "");
  if (constants.has(normalized)) return constants.get(normalized);
  const simpleName = normalized.split(/\.|::/).pop();
  return constants.get(simpleName) || null;
}

function valueExpressionPattern() {
  return `((?:["'](?:\\\\.|[^"'\\\\])+["'])|(?:\\$?[A-Za-z_][A-Za-z0-9_]*(?:(?:\\s*\\.|::\\s*)[A-Za-z_][A-Za-z0-9_]*)*))`;
}

function valueTokens(text, literal) {
  const tokens = new Set([literal]);
  for (const [name, value] of extractStringConstants(text)) {
    if (value === literal || value.includes(literal)) tokens.add(name);
  }
  return Array.from(tokens);
}

module.exports = {
  extractStringConstants,
  resolveStringArg,
  valueExpressionPattern,
  valueTokens,
};
