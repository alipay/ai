"use strict";

const fs = require("fs");
const path = require("path");
const { spawnSync } = require("child_process");

/**
 * Shared Java project gates for contracts that compilation cannot prove:
 * transport payload semantics, production storage, Spring profile wiring,
 * and executable test evidence.
 */

function checkJavaTransportContracts(javaFiles, errors, relative = (file) => file, ownedFiles = javaFiles) {
  const sources = javaFiles.map((file) => ({ file, text: fs.readFileSync(file, "utf8") }));
  const owned = new Set(ownedFiles);
  const classes = new Map();
  for (const source of sources) {
    const className = firstClassName(source.text);
    if (className) classes.set(className, source);
  }

  for (const source of sources) {
    if (!/\bimplements\s+MsgHandler\b/.test(source.text)) continue;
    const method = findMethod(source.text, "onMessage");
    if (!method || method.params.length < 3) continue;
    const payloadName = method.params[2];
    const receiverTypes = fieldTypes(source.text);

    for (const call of method.body.matchAll(/\b([A-Za-z_$][\w$]*)\s*\.\s*([A-Za-z_$][\w$]*)\s*\(([^;]*)\)/g)) {
      if (!new RegExp(`\\b${escapeRegExp(payloadName)}\\b`).test(call[3])) continue;
      const target = classes.get(receiverTypes.get(call[1]));
      if (!target) continue;
      if (!owned.has(target.file)) continue;
      const targetMethod = findMethod(target.text, call[2]);
      if (!targetMethod || !usesHttpEnvelopeSemantics(targetMethod.body)) continue;

      errors.push(
        `${relative(target.file)}: ${targetMethod.name}(...) receives the business payload from MsgHandler.onMessage but treats it as an HTTP notification envelope or verifies it again; WebSocket callbacks must parse business JSON directly, while HTTP common parameters and signature verification stay in the HTTP ingress path`,
      );
    }
  }
}

function checkJavaStateTransitionPersistence(javaFiles, errors, relative = (file) => file) {
  for (const file of javaFiles) {
    const text = fs.readFileSync(file, "utf8");
    if (!/notify|notification|change|event/i.test(`${path.basename(file)}\n${text}`)) continue;
    for (const method of extractMethods(text)) {
      const deletesState = /\b[A-Za-z_$][\w$]*\s*\.\s*(?:delete|remove)[A-Za-z0-9_$]*\s*\(/.test(method.body);
      if (!deletesState) continue;
      const mutated = new Set(Array.from(
        method.body.matchAll(/\b([A-Za-z_$][\w$]*)\s*\.\s*set[A-Z][A-Za-z0-9_$]*\s*\(/g),
        (match) => match[1],
      ));
      if (mutated.size === 0) continue;
      const unpersisted = Array.from(mutated).filter((name) =>
        !new RegExp(`\\b(?:save|insert|update|upsert|persist|store|archive|publish|emit)\\s*\\(\\s*${escapeRegExp(name)}\\b`).test(method.body)
        && !new RegExp(`\\b[A-Za-z_$][\\w$]*\\s*\\.\\s*(?:save|insert|update|upsert|persist|store|archive|publish|emit)\\s*\\(\\s*${escapeRegExp(name)}\\b`).test(method.body));
      if (unpersisted.length === 0) continue;
      errors.push(
        `${relative(file)}: ${method.name}(...) mutates business-state object(s) ${unpersisted.join(", ")} and then deletes/removes the active record without persisting, archiving, or publishing the transition; do not report the transition as completed unless its intended side effect is durable`,
      );
    }
  }
}

function checkJavaProductionStateStores(javaFiles, errors, relative = (file) => file) {
  for (const file of javaFiles) {
    const text = fs.readFileSync(file, "utf8");
    if (isDemoOrTestSource(file, text)) continue;
    const className = firstClassName(text) || path.basename(file, ".java");
    if (!/(?:Repository|Store|Dao|Persistence|Directory)$/i.test(className)) continue;
    if (!hasMutableInMemoryCollection(text)) continue;
    errors.push(
      `${relative(file)}: production ${className} stores business state in a process-local Map/Set; expose a persistence port with a durable implementation, or restrict this implementation to an explicit demo/test profile`,
    );
  }
}

function checkSpringProfileWiring(projectRoot, javaFiles, errors, relative = (file) => file) {
  const sources = javaFiles.map((file) => ({ file, text: fs.readFileSync(file, "utf8") }));
  const interfaces = new Set();
  const implementations = new Map();
  const beanTypes = new Set();
  const injectedTypes = new Set();

  for (const source of sources) {
    for (const match of source.text.matchAll(/\binterface\s+([A-Za-z_$][\w$]*)\b/g)) interfaces.add(match[1]);
    for (const match of source.text.matchAll(/@Bean\b[\s\S]{0,300}?\b([A-Za-z_$][\w$]*)\s+[A-Za-z_$][\w$]*\s*\(/g)) {
      beanTypes.add(match[1]);
    }
    for (const match of source.text.matchAll(/\b(?:public|protected)?\s*[A-Za-z_$][\w$]*\s*\(([^)]*)\)\s*\{/g)) {
      for (const param of splitParams(match[1])) {
        const type = firstTypeName(param);
        if (type) injectedTypes.add(type);
      }
    }

    const classMatch = source.text.match(/\bclass\s+([A-Za-z_$][\w$]*)[^{]*\bimplements\s+([^{]+)/);
    if (!classMatch) continue;
    const profiles = profileNames(source.text);
    for (const type of classMatch[2].split(",").map((value) => firstTypeName(value)).filter(Boolean)) {
      if (!implementations.has(type)) implementations.set(type, []);
      implementations.get(type).push({ file: source.file, profiles });
    }
  }

  const activeProfiles = configuredActiveProfiles(projectRoot);
  for (const type of injectedTypes) {
    if (!interfaces.has(type) || beanTypes.has(type)) continue;
    const candidates = implementations.get(type) || [];
    if (candidates.length === 0 || candidates.some((item) => item.profiles.length === 0)) continue;
    if (candidates.some((item) => item.profiles.some((profile) => activeProfiles.has(profile)))) continue;
    errors.push(
      `${relative(candidates[0].file)}: injected interface ${type} has only profile-scoped implementations (${unique(candidates.flatMap((item) => item.profiles)).join(", ")}) and none is active by default; provide an unprofiled/fail-closed implementation, activate the intended profile explicitly, or add production wiring`,
    );
  }
}

function checkJavaTestEvidence(projectRoot, javaFiles, errors) {
  const tests = javaFiles.filter((file) => /(^|[/\\])src[/\\]test[/\\]/.test(file));
  if (tests.length === 0) {
    errors.push("Java project contains no executable test sources under src/test; a successful `mvn test` with zero tests is not generation evidence");
    return;
  }

  const production = javaFiles.filter((file) => !tests.includes(file));
  const criticalClasses = production
    .map((file) => ({ file, text: fs.readFileSync(file, "utf8") }))
    .filter((source) => /\bimplements\s+MsgHandler\b|(?:Notify|Message)[A-Za-z0-9_]*Handler\b/.test(source.text))
    .map((source) => firstClassName(source.text))
    .filter(Boolean);
  const testText = tests.map((file) => fs.readFileSync(file, "utf8")).join("\n");
  if (criticalClasses.length && !criticalClasses.some((name) => new RegExp(`\\b${escapeRegExp(name)}\\b`).test(testText))) {
    errors.push("Java tests do not exercise any generated message router/notification handler; add positive, retry/failure, unknown-message, and idempotency behavior coverage");
  }

  const isSpringBoot = production.some((file) => /@SpringBootApplication\b/.test(fs.readFileSync(file, "utf8")));
  if (isSpringBoot && projectMode(projectRoot) !== "existing"
      && !/@SpringBootTest\b|ApplicationContextRunner\b|SpringApplicationBuilder\b/.test(testText)) {
    errors.push("greenfield Spring Boot project has no application-context wiring test; add @SpringBootTest, ApplicationContextRunner, or equivalent startup wiring coverage");
  }
}

function runMavenTests(pom, errors) {
  if (!pom || process.env.ALIPAY_VALIDATE_SKIP_TESTS === "1") return;
  const result = spawnSync("mvn", ["-q", "test"], {
    cwd: path.dirname(pom),
    encoding: "utf8",
    maxBuffer: 1024 * 1024 * 8,
  });
  if (result.status !== 0) {
    const output = `${result.stdout || ""}\n${result.stderr || ""}`.trim().split(/\r?\n/).slice(-25).join("\n");
    errors.push(`mvn -q test failed; generated behavior and Spring wiring must pass before delivery:\n${output}`);
  }
}

function usesHttpEnvelopeSemantics(body) {
  if (/\b(?:parseEnvelope|verifyNotify|verifySign|rsaCheckV1|rsaCertCheckV1)\s*\(/i.test(body)) return true;
  const tokens = [
    /["']biz_content["']/,
    /["']sign_type["']/,
    /["']notify_id["']/,
    /["']charset["']/,
    /\.getSign\s*\(/,
    /\.getSignType\s*\(/,
    /\.getCharset\s*\(/,
  ];
  return tokens.filter((pattern) => pattern.test(body)).length >= 2;
}

function firstClassName(text) {
  const match = text.match(/\b(?:class|record|enum)\s+([A-Za-z_$][\w$]*)\b/);
  return match ? match[1] : "";
}

function fieldTypes(text) {
  const result = new Map();
  for (const match of text.matchAll(/\b([A-Z][A-Za-z0-9_$.<>]*)\s+([a-z_$][\w$]*)\s*(?:[;=,)])/g)) {
    result.set(match[2], match[1].replace(/<.*$/, "").split(".").pop());
  }
  return result;
}

function findMethod(text, name) {
  const pattern = new RegExp(`\\b${escapeRegExp(name)}\\s*\\(([^)]*)\\)\\s*(?:throws\\s+[^\\{]+)?\\{`, "g");
  const match = pattern.exec(text);
  if (!match) return null;
  const open = match.index + match[0].length - 1;
  const close = findMatchingBrace(text, open);
  if (close < 0) return null;
  return {
    name,
    params: splitParams(match[1]).map(paramName).filter(Boolean),
    body: text.slice(open + 1, close),
  };
}

function extractMethods(text) {
  const methods = [];
  const pattern = /\b(?:public|private|protected)\s+(?:static\s+)?[A-Za-z0-9_<>, ?.[\]]+\s+([A-Za-z_$][\w$]*)\s*\(([^)]*)\)\s*(?:throws\s+[^{]+)?\{/g;
  for (const match of text.matchAll(pattern)) {
    const open = match.index + match[0].length - 1;
    const close = findMatchingBrace(text, open);
    if (close > open) methods.push({ name: match[1], body: text.slice(open + 1, close) });
  }
  return methods;
}

function findMatchingBrace(text, open) {
  let depth = 0;
  let quote = "";
  let escaped = false;
  for (let index = open; index < text.length; index += 1) {
    const char = text[index];
    if (quote) {
      if (escaped) escaped = false;
      else if (char === "\\") escaped = true;
      else if (char === quote) quote = "";
      continue;
    }
    if (char === "\"" || char === "'") {
      quote = char;
      continue;
    }
    if (char === "{") depth += 1;
    else if (char === "}" && --depth === 0) return index;
  }
  return -1;
}

function splitParams(text) {
  return String(text).split(",").map((value) => value.trim()).filter(Boolean);
}

function paramName(param) {
  const match = param.match(/([A-Za-z_$][\w$]*)\s*$/);
  return match ? match[1] : "";
}

function firstTypeName(text) {
  const cleaned = String(text).replace(/@\w+(?:\([^)]*\))?\s*/g, "").trim();
  const match = cleaned.match(/\b([A-Z][A-Za-z0-9_$]*)\b/);
  return match ? match[1] : "";
}

function profileNames(text) {
  const classIndex = text.search(/\bclass\b/);
  const beforeClass = text.slice(0, classIndex < 0 ? text.length : classIndex);
  const match = beforeClass.match(/@Profile\s*\(([^)]*)\)/);
  return match ? Array.from(match[1].matchAll(/["']([^"']+)["']/g), (item) => item[1]) : [];
}

function configuredActiveProfiles(root) {
  const result = new Set();
  for (const file of walk(root).filter((item) => /application(?:-[^/\\]+)?\.(?:yml|yaml|properties)$/.test(item))) {
    const text = fs.readFileSync(file, "utf8");
    for (const match of text.matchAll(/(?:spring\.profiles\.active|active)\s*[:=]\s*([A-Za-z0-9_,.-]+)/g)) {
      for (const value of match[1].split(",")) result.add(value.trim());
    }
  }
  return result;
}

function projectMode(root) {
  if (process.env.ALIPAY_PROJECT_MODE) return process.env.ALIPAY_PROJECT_MODE;
  const file = path.join(root, ".alipay-skill", "integration-contract.json");
  try {
    return JSON.parse(fs.readFileSync(file, "utf8")).projectMode || "greenfield";
  } catch (_) {
    return "greenfield";
  }
}

function hasMutableInMemoryCollection(text) {
  return /(?:^|[;\n])\s*(?:(?:private|protected|public|static|final|volatile)\s+)+(?:Map|ConcurrentMap|ConcurrentHashMap|Set|HashSet)\s*<[^;\n=]+>\s+[A-Za-z_$][\w$]*\s*=\s*new\s+(?:ConcurrentHashMap|HashMap|ConcurrentSkipListMap|HashSet|LinkedHashSet)\b/m.test(text);
}

function isDemoOrTestSource(file, text) {
  return /(^|[/\\])(?:test|tests|demo|demos|examples)([/\\]|$)/i.test(file)
    || isExplicitDemoOrTestProfileOnly(profileNames(text));
}

function isExplicitDemoOrTestProfileOnly(profiles) {
  if (!profiles.length) return false;
  return profiles.every((profile) => /(^|[-_.])(?:test|demo)([-_.]|$)/i.test(profile));
}

function unique(values) {
  return Array.from(new Set(values));
}

function walk(dir) {
  const result = [];
  if (!fs.existsSync(dir)) return result;
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if ([".git", "target", "node_modules", "dist", "build"].includes(entry.name)) continue;
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) result.push(...walk(full));
    else result.push(full);
  }
  return result;
}

function escapeRegExp(value) {
  return String(value).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

module.exports = {
  checkJavaProductionStateStores,
  checkJavaStateTransitionPersistence,
  checkJavaTestEvidence,
  checkJavaTransportContracts,
  checkSpringProfileWiring,
  runMavenTests,
};
