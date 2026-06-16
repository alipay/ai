#!/usr/bin/env node

const fs = require("fs");
const path = require("path");
const os = require("os");
const { spawnSync } = require("child_process");

let EXIT_CODES;
let classifySpawnResult;
let runGuarded;
let valueTokens;
let validateIntegrationContract;
let javaProjectGates;
try {
  ({ EXIT_CODES, classifySpawnResult, runGuarded } = require("./lib/validator-runtime"));
  ({ valueTokens } = require("./lib/value-resolver"));
  ({ validateIntegrationContract } = require("./lib/integration-contract"));
  javaProjectGates = require("./lib/java-project-gates");
} catch (err) {
  console.error(`[alipay-enterprise-scenario-integration] BROKEN failed to load validator support: ${err && err.stack ? err.stack : err}`);
  process.exit(2);
}

const skillDir = path.resolve(__dirname, "..");
const skillsRoot = path.resolve(skillDir, "..");
const targetDir = path.resolve(process.argv[2] || ".");

/**
 * 企业码单场景方案主聚合校验器。
 *
 * 职责分层：
 * - 三个子 validator 分别检查员企、费控、账单本域代码。
 * - 本脚本只补充方案级约束：scenario.json、场景制度组合、共享消息入口、SDK/构建一致性。
 * - 不在主脚本重复维护子域字段白名单，避免同一规则出现两份实现。
 *
 * 执行顺序：子域校验 -> 已确认场景校验 -> 按技术栈执行聚合工程门禁。
 */

// 子 Skill 自带本域校验能力；主脚本只负责调用和汇总。
const childScripts = [
  "alipay-enterprise-ec/scripts/validate_codegen.js",
  "alipay-enterprise-expense-control/scripts/validate_codegen.js",
  "alipay-enterprise-bill/scripts/validate_codegen.js",
];
const merchantRestrictionFactors = new Set([
  "MEAL_MERCHANT",
  "MERCHANT",
  "COMPOSITE_MERCHANT",
  "SHOP_GROUP",
  "SHOP",
  "RECEIPT_IDENTITY_WHITE_LIST",
]);
const quotaLimitFactors = new Set(["QUOTA_DAY", "QUOTA_WEEK", "QUOTA_MONTH", "QUOTA_SEASON", "QUOTA_YEAR", "QUOTA_TOTAL"]);

runGuarded("alipay-enterprise-scenario-integration", main);

function main() {
  if (!fs.existsSync(targetDir)) {
    console.error(`[alipay-enterprise-scenario-integration] ERROR target directory not found: ${targetDir}`);
    process.exit(EXIT_CODES.FAIL);
  }

  let failed = false;
  let broken = false;
  const javaProject = isJavaProject(targetDir);
  const nodeProject = isNodeProject(targetDir);

  // 先运行子域校验。Node.js 测试由主脚本统一执行一次，避免三个子脚本重复 npm test。
  if (nodeProject && !javaProject) {
    console.warn("[alipay-enterprise-scenario-integration] WARN Node.js project detected; running child validators and aggregate Node.js gates");
  } else if (!javaProject) {
    console.warn("[alipay-enterprise-scenario-integration] WARN non-Java/Node project detected; running available cross-language child validators and skipping Java/Maven SDK class checks");
  }

  const childEnv = Object.assign({}, process.env, { ALIPAY_VALIDATE_AGGREGATE: "1" });
  if (nodeProject) childEnv.ALIPAY_VALIDATE_SKIP_NODE_TEST = "1";
  for (const relScript of childScripts) {
    const outcome = runChildValidator(relScript, childEnv);
    if (outcome.state === "FAIL") failed = true;
    if (outcome.state === "BROKEN") {
      broken = true;
      console.error(`[alipay-enterprise-scenario-integration] BROKEN ${relScript}: ${outcome.reason}`);
    }
  }

  const aggregateErrors = [];
  validateIntegrationContract(targetDir, ["ec", "expense-control", "bill"], aggregateErrors);
  checkSelectedScenario(aggregateErrors);

  const pom = findFile(targetDir, "pom.xml");
  const gradle = findFile(targetDir, "build.gradle");
  if (javaProject && !pom && !gradle) {
    console.warn("[alipay-enterprise-scenario-integration] WARN no pom.xml/build.gradle found; compile validation must be reported as unavailable");
  }
  if (javaProject) {
    checkBuildConsistency(pom, aggregateErrors);
    checkMavenCompile(pom, aggregateErrors);
    checkSdkJarClasses(pom, aggregateErrors);
    checkSpringValueConsistency(aggregateErrors);
    checkMessageRouterCompleteness(aggregateErrors);
    checkMessageRouterFailurePropagation(aggregateErrors);
    checkMessageRouterUnknownHandling(aggregateErrors);
    checkAlipayMsgClientSecurityConfig(aggregateErrors);
    checkMessageClientStartupFailure(aggregateErrors);
    const javaFiles = walk(targetDir).filter((file) => file.endsWith(".java"));
    javaProjectGates.checkJavaTransportContracts(javaFiles, aggregateErrors, rel);
    javaProjectGates.checkJavaProductionStateStores(javaFiles, aggregateErrors, rel);
    javaProjectGates.checkJavaStateTransitionPersistence(javaFiles, aggregateErrors, rel);
    javaProjectGates.checkSpringProfileWiring(targetDir, javaFiles, aggregateErrors, rel);
    javaProjectGates.checkJavaTestEvidence(targetDir, javaFiles, aggregateErrors);
    javaProjectGates.runMavenTests(pom, aggregateErrors);
  }
  if (nodeProject) {
    checkNodeProject(aggregateErrors);
  }
  if (!javaProject && !nodeProject) {
    checkNonJavaProject(aggregateErrors);
  }

  if (aggregateErrors.length) {
    for (const e of aggregateErrors) console.error(`[alipay-enterprise-scenario-integration] ERROR ${e}`);
    failed = true;
  }

  if (broken) {
    console.error("[alipay-enterprise-scenario-integration] BROKEN one or more domain validators did not execute reliably; do not declare generation complete");
    process.exit(EXIT_CODES.BROKEN);
  }
  if (failed) process.exit(EXIT_CODES.FAIL);
  console.log("[alipay-enterprise-scenario-integration] OK");
}

function runChildValidator(relScript, env) {
  const script = path.join(skillsRoot, relScript);
  if (!fs.existsSync(script)) {
    return { state: "BROKEN", reason: "validator script is missing" };
  }

  const syntax = spawnSync(process.execPath, ["--check", script], {
    encoding: "utf8",
    maxBuffer: 1024 * 1024,
  });
  const syntaxOutcome = classifySpawnResult(syntax);
  if (syntaxOutcome.state !== "OK") {
    const output = lastLines(`${syntax.stdout || ""}\n${syntax.stderr || ""}`);
    return {
      state: "BROKEN",
      reason: `validator syntax check failed${output ? `:\n${output}` : `: ${syntaxOutcome.reason || "unknown error"}`}`,
    };
  }

  const result = spawnSync(process.execPath, [script, targetDir], {
    stdio: "inherit",
    env,
  });
  return classifySpawnResult(result);
}

function readAll(dir) {
  return walk(dir).filter((f) => /\.(java|php|py|js|ts|go|cs|rb|md|xml|json|ya?ml)$/i.test(f))
    .map((f) => fs.readFileSync(f, "utf8")).join("\n");
}

function readImplementationAndConfigFiles(dir) {
  return walk(dir).filter((f) => /\.(java|php|py|js|ts|go|cs|rb|xml|json|ya?ml|properties)$/i.test(f));
}

function stripSourceComments(text, file) {
  if (/\.(?:json|ya?ml|properties|xml)$/i.test(file)) return text;
  if (/\.(?:py|rb)$/i.test(file)) return text.replace(/^\s*#.*$/gm, "");
  return text
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/^\s*\/\/.*$/gm, "")
    .replace(/^\s*#.*$/gm, "");
}

function checkSelectedScenario(errors) {
  const scenario = readScenarioFile(errors);
  if (!scenario) return;

  const facts = readScenarioFacts(errors);
  if (!facts) return;
  validateScenarioDecision(scenario, facts, errors);

  const files = readImplementationAndConfigFiles(targetDir).filter((f) => !isTestOrGeneratedDocFile(f));

  // allText 用于解析散落在独立 Constants 文件中的真实值；scenarioText 只保留
  // 制度创建/修改上下文，防止 README、通用枚举或场景文件本身造成假通过。
  const allText = files.map((f) => stripSourceComments(fs.readFileSync(f, "utf8"), f)).join("\n");
  const scenarioText = files
    .map((file) => ({ file, text: stripSourceComments(fs.readFileSync(file, "utf8"), file) }))
    .filter((entry) => hasInstitutionScenarioContext(entry.text))
    .map((entry) => entry.text)
    .join("\n");

  if (!scenarioText.trim()) {
    errors.push("missing fee-control institution create/modify implementation for the confirmed scenario; enum declarations or scenario.json alone do not count");
    return;
  }

  if (!hasFieldValue(scenarioText, allText, ["expense_type", "expenseType", "ExpenseType"], ["setExpenseType"], scenario.expenseType)) {
    errors.push(`missing confirmed expense_type=${scenario.expenseType} in institution create/modify code`);
  }
  if (!hasFieldValue(scenarioText, allText, ["expense_type_sub_category", "expenseTypeSubCategory", "ExpenseTypeSubCategory"], ["setExpenseTypeSubCategory"], scenario.expenseTypeSubCategory)) {
    errors.push(`missing confirmed expense_type_sub_category=${scenario.expenseTypeSubCategory} in institution create/modify code`);
  }
  if (!hasFieldValue(scenarioText, allText, ["scene_type", "sceneType", "SceneType"], ["setSceneType"], scenario.sceneType)) {
    errors.push(`missing confirmed scene_type=${scenario.sceneType} in institution create/modify code`);
  }

  for (const factor of scenario.requiredRuleFactors) {
    if (!hasFieldValue(scenarioText, allText, ["rule_factor", "ruleFactor", "RuleFactor"], ["setRuleFactor"], factor)) {
      errors.push(`missing required rule_factor=${factor} in institution create/modify code`);
      continue;
    }
    const values = scalarScenarioValues(scenario.ruleFactorValues[factor]);
    if (values.length && !values.some((value) => hasFactorValueBinding(scenarioText, allText, factor, value))) {
      errors.push(`required rule_factor=${factor} is not bound to its confirmed scenario.json value in institution create/modify code`);
    }
  }

  if (scenario.businessPriority && scenario.businessPriority.enabled) {
    checkBusinessPriorityScenario(scenario, scenarioText, allText, errors);
  }
  checkInternalFundingSourceImplementation(scenario, scenarioText, allText, errors);
  checkBillScenarioIdentifiers(scenario, files, allText, errors);
}

function checkInternalFundingSourceImplementation(scenario, scenarioText, allText, errors) {
  if (!isInternalExpenseControlScenario(scenario) || !scenario.internalFundingSource) return;
  const source = scenario.internalFundingSource;
  if (source.type === "ISSUE_RULE") {
    if (!/issue_rule_info_list|issueRuleInfoList|IssueRuleInfo|setIssueRuleInfoList/.test(scenarioText)) {
      errors.push("internalFundingSource.type=ISSUE_RULE requires issue_rule_info_list in institution create/modify code");
    }
    return;
  }
  if (source.type === "MANUAL_ISSUE") {
    if (!/alipay\.ebpp\.invoice\.expensecontrol\.quota\.create|AlipayEbppInvoiceExpensecontrolQuotaCreate/.test(allText)) {
      errors.push("internalFundingSource.type=MANUAL_ISSUE requires implemented manual issue quota.create interface");
    }
    return;
  }
  if (source.type === "QUOTA_LIMIT") {
    const factors = Array.isArray(source.quotaLimitFactors) ? source.quotaLimitFactors : [];
    for (const factor of factors) {
      if (!hasFieldValue(scenarioText, allText, ["rule_factor", "ruleFactor", "RuleFactor"], ["setRuleFactor"], factor)) {
        errors.push(`internalFundingSource.type=QUOTA_LIMIT requires quota limit rule_factor=${factor} in institution create/modify code`);
      }
      const values = scalarScenarioValues(scenario.ruleFactorValues[factor]);
      if (values.length && !values.some((value) => hasFactorValueBinding(scenarioText, allText, factor, value))) {
        errors.push(`quota limit rule_factor=${factor} is not bound to its confirmed internalFundingSource value in institution create/modify code`);
      }
    }
  }
}

function readScenarioFile(errors) {
  const file = path.join(targetDir, ".alipay-skill", "scenario.json");
  if (!fs.existsSync(file)) {
    errors.push("missing .alipay-skill/scenario.json; code generation must confirm exactly one business scenario before domain generation");
    return null;
  }
  try {
    const scenario = JSON.parse(fs.readFileSync(file, "utf8"));
    if (!scenario || Array.isArray(scenario) || typeof scenario !== "object") {
      errors.push(".alipay-skill/scenario.json must contain one scenario object");
      return null;
    }
    if (scenario.schemaVersion !== 1) errors.push("scenario.json schemaVersion must be 1");
    if (scenario.status !== "CONFIRMED") errors.push("scenario.json status must be CONFIRMED");
    if (JSON.stringify(scenario).includes("NEEDS_USER_CONFIRM")) {
      errors.push("scenario.json contains NEEDS_USER_CONFIRM; resolve all blocking business values before code generation");
    }
    return scenario;
  } catch (err) {
    errors.push(`scenario.json is not valid JSON: ${err.message}`);
    return null;
  }
}

function readScenarioFacts(errors) {
  const expenseSkill = path.join(skillsRoot, "alipay-enterprise-expense-control");
  const files = {
    enumDoc: path.join(expenseSkill, "references", "common", "expense-type-enum.md"),
    constraints: path.join(expenseSkill, "references", "common", "expense-type-constraints.md"),
    factors: path.join(expenseSkill, "references", "common", "rule-factors.md"),
    institution: path.join(expenseSkill, "references", "common", "institution-create.md"),
  };
  for (const [name, file] of Object.entries(files)) {
    if (!fs.existsSync(file)) {
      errors.push(`cannot validate scenario because expense-control ${name} is missing: ${file}`);
      return null;
    }
  }
  return {
    pairs: parseExpenseTypePairs(fs.readFileSync(files.enumDoc, "utf8")),
    constraintText: fs.readFileSync(files.constraints, "utf8"),
    factors: parseRuleFactors(fs.readFileSync(files.factors, "utf8")),
    sceneTypes: parseSceneTypes(fs.readFileSync(files.institution, "utf8")),
  };
}

function validateScenarioDecision(scenario, facts, errors) {
  for (const key of ["expenseType", "expenseTypeSubCategory", "sceneType"]) {
    if (typeof scenario[key] !== "string" || !scenario[key].trim()) errors.push(`scenario.json ${key} must be a confirmed non-empty string`);
  }
  const pair = `${scenario.expenseType}/${scenario.expenseTypeSubCategory}`;
  if (!facts.pairs.has(pair)) errors.push(`scenario.json contains unsupported expense type/subcategory pair: ${pair}`);
  if (!facts.sceneTypes.has(scenario.sceneType)) errors.push(`scenario.json sceneType=${scenario.sceneType} is not defined by institution-create.md`);

  if (!Array.isArray(scenario.requiredRuleFactors) || scenario.requiredRuleFactors.length === 0) {
    errors.push("scenario.json requiredRuleFactors must contain the selected mandatory factor(s)");
    scenario.requiredRuleFactors = [];
  }
  const values = scenario.ruleFactorValues;
  if (!values || Array.isArray(values) || typeof values !== "object") {
    errors.push("scenario.json ruleFactorValues must be an object keyed by rule factor");
    scenario.ruleFactorValues = {};
  }
  for (const factor of scenario.requiredRuleFactors) {
    if (!facts.factors.has(factor)) errors.push(`scenario.json requiredRuleFactors contains undocumented factor: ${factor}`);
    if (!hasConfirmedScenarioValue(scenario.ruleFactorValues[factor])) {
      errors.push(`scenario.json ruleFactorValues.${factor} must contain a confirmed non-empty business value`);
    }
  }

  const constraintRule = parseScenarioConstraint(facts.constraintText, scenario.expenseType, scenario.expenseTypeSubCategory, scenario.constraintVariant, facts.factors);
  if (!constraintRule) {
    errors.push(`expense-type-constraints.md has no rule row for ${pair}`);
  } else {
    if (constraintRule.needsVariant && !constraintRule.selected) {
      errors.push(`${pair} has multiple merchant-scope constraint branches; scenario.json constraintVariant must be SPECIFIED_MERCHANT or BROAD_MERCHANT`);
    }
    for (const factor of scenario.requiredRuleFactors) {
      if (constraintRule.allowed.size && !constraintRule.allowed.has(factor)) {
        errors.push(`scenario.json marks ${factor} as required, but the selected ${pair} constraint row does not define it`);
      }
    }
    for (const factor of constraintRule.allOf) {
      if (!scenario.requiredRuleFactors.includes(factor)) errors.push(`${pair} requiredRuleFactors must include ${factor}`);
    }
    for (const group of constraintRule.anyOf) {
      if (!group.some((factor) => scenario.requiredRuleFactors.includes(factor))) {
        errors.push(`${pair} requiredRuleFactors must include at least one of: ${group.join(", ")}`);
      }
    }
  }

  if (isTaotianPlatformScenario(scenario)
      && scenario.businessPriority && scenario.businessPriority.enabled) {
    errors.push("ALI_PLATFORM_TYPE=TAOTIAN/1688 scenarios do not support business priority; set businessPriority.enabled=false and do not generate the business-priority rule combination");
  }

  if (!scenario.billIdentifiers || Array.isArray(scenario.billIdentifiers)
      || typeof scenario.billIdentifiers !== "object"
      || Object.keys(scenario.billIdentifiers).length === 0) {
    errors.push("scenario.json billIdentifiers must contain at least one documented bill-side scene identifier");
  } else {
    for (const [key, value] of Object.entries(scenario.billIdentifiers)) {
      if (!hasConfirmedScenarioValue(value)) errors.push(`scenario.json billIdentifiers.${key} must be a confirmed non-empty value`);
    }
  }

  if (scenario.businessPriority && scenario.businessPriority.enabled) {
    if (constraintRule && constraintRule.selected && constraintRule.businessPriorityFactors.length === 0) {
      errors.push(`${pair} does not define any effective merchant restriction factor in expense-type-constraints.md; businessPriority.enabled must be false`);
    }
    if (!hasConfirmedScenarioValue(scenario.ruleFactorValues.ALARM_CLOCK_TIME)) {
      errors.push("businessPriority.enabled requires ruleFactorValues.ALARM_CLOCK_TIME");
    }
    const selected = scenario.businessPriority.merchantRestrictionFactors;
    if (Array.isArray(selected)) {
      for (const factor of selected) {
        if (!merchantRestrictionFactors.has(factor)) {
          errors.push(`businessPriority merchantRestrictionFactors contains unsupported factor: ${factor}`);
        } else if (constraintRule && constraintRule.selected && !constraintRule.businessPriorityFactors.includes(factor)) {
          errors.push(`${factor} is not an effective merchant restriction factor for ${pair} according to the selected expense-type-constraints.md row`);
        }
        if (!hasConfirmedScenarioValue(scenario.ruleFactorValues[factor])) {
          errors.push(`businessPriority.enabled requires ruleFactorValues.${factor}`);
        }
      }
    }
  }
  validateInternalFundingSourceDecision(scenario, errors);
}

function validateInternalFundingSourceDecision(scenario, errors) {
  if (!isInternalExpenseControlScenario(scenario)) return;
  const source = scenario.internalFundingSource;
  if (!source || Array.isArray(source) || typeof source !== "object") {
    errors.push("internal expense-control scenario.json must confirm internalFundingSource: ISSUE_RULE, QUOTA_LIMIT, or MANUAL_ISSUE");
    return;
  }
  if (!["ISSUE_RULE", "QUOTA_LIMIT", "MANUAL_ISSUE"].includes(source.type)) {
    errors.push("internalFundingSource.type must be ISSUE_RULE, QUOTA_LIMIT, or MANUAL_ISSUE");
    return;
  }
  if (source.type !== "QUOTA_LIMIT") return;
  const factors = Array.isArray(source.quotaLimitFactors) ? source.quotaLimitFactors : [];
  if (factors.length === 0) {
    errors.push("internalFundingSource.type=QUOTA_LIMIT requires quotaLimitFactors");
  }
  for (const factor of factors) {
    if (!quotaLimitFactors.has(factor)) {
      errors.push(`internalFundingSource quotaLimitFactors contains non-limit factor: ${factor}`);
    } else if (!hasConfirmedScenarioValue(scenario.ruleFactorValues[factor])) {
      errors.push(`internalFundingSource QUOTA_LIMIT requires ruleFactorValues.${factor}`);
    }
  }
}

function isInternalExpenseControlScenario(scenario) {
  const mode = String(scenario.expenseControlMode || scenario.feeControlMode || "").toLowerCase();
  if (["internal", "0", "inside"].includes(mode)) return true;
  const values = scalarScenarioValues(scenario.consultMode || scenario.consult_mode || (scenario.ruleFactorValues && scenario.ruleFactorValues.consult_mode));
  return values.includes("0");
}

function isTaotianPlatformScenario(scenario) {
  if (!scenario || !scenario.ruleFactorValues) return false;
  const values = scalarScenarioValues(scenario.ruleFactorValues.ALI_PLATFORM_TYPE);
  return values.some((value) => value === "TAOTIAN" || value === "1688");
}

function parseExpenseTypePairs(text) {
  const pairs = new Set();
  let currentType = "";
  for (const line of text.split(/\r?\n/)) {
    if (!line.trim().startsWith("|") || /^\s*\|\s*-/.test(line)) continue;
    const cells = splitMarkdownRow(line);
    if (cells.length < 4 || /ExpenseType/.test(cells[0])) continue;
    const type = firstEnumToken(cells[0]) || currentType;
    const subtype = firstEnumToken(cells[2]);
    if (type) currentType = type;
    if (type && subtype) pairs.add(`${type}/${subtype}`);
  }
  return pairs;
}

function parseRuleFactors(text) {
  const factors = new Set();
  for (const line of text.split(/\r?\n/)) {
    if (!line.trim().startsWith("|") || /^\s*\|\s*-/.test(line)) continue;
    const token = firstEnumToken(splitMarkdownRow(line)[0] || "");
    if (token && token !== "code") factors.add(token);
  }
  return factors;
}

function parseSceneTypes(text) {
  const values = new Set();
  for (const match of text.matchAll(/(?:加班|补贴福利|差旅|招待|通用)\s*:\s*([A-Z_]+)/g)) values.add(match[1]);
  return values;
}

function splitMarkdownRow(line) {
  return line.trim().replace(/^\|/, "").replace(/\|$/, "").split("|").map((cell) => cell.trim());
}

function firstEnumToken(text) {
  const match = String(text).match(/\b[A-Z][A-Z0-9_]+\b/);
  return match ? match[0] : "";
}

function parseScenarioConstraint(text, expenseType, subtype, variant, knownFactors) {
  const lines = text.split(/\r?\n/);
  const index = lines.findIndex((line) => new RegExp(`\\b${escapeRegExp(expenseType)}\\b`).test(line)
    && new RegExp(`\\b${escapeRegExp(subtype)}\\b`).test(line));
  if (index < 0) return null;
  const primary = splitMarkdownRow(lines[index]);
  const continuation = lines[index + 1] && lines[index + 1].trim().startsWith("|")
    ? splitMarkdownRow(lines[index + 1])
    : [];
  const hasMerchantVariants = primary.length >= 5
    && continuation.length >= 5
    && primary[1].includes("指定门店")
    && continuation[0] === ""
    && continuation[1].includes("广泛商户");

  let row = primary;
  let selected = true;
  if (hasMerchantVariants) {
    if (variant === "SPECIFIED_MERCHANT") row = primary;
    else if (variant === "BROAD_MERCHANT") row = continuation;
    else selected = false;
  }
  const mandatory = row[hasMerchantVariants ? 2 : 1] || "";
  const rowText = row.join("\n");
  const tokens = Array.from(new Set(Array.from(mandatory.matchAll(/\b[A-Z][A-Z0-9_]+\b/g))
    .map((match) => match[0])
    .filter((token) => knownFactors.has(token))));
  const rowTokens = Array.from(new Set(Array.from(rowText.matchAll(/\b[A-Z][A-Z0-9_]+\b/g))
    .map((match) => match[0])
    .filter((token) => knownFactors.has(token))));
  const allOf = [];
  const anyOf = [];
  if (/至少使用其中一个|至少有一个/.test(mandatory)) {
    if (tokens.length) anyOf.push(tokens);
  } else if (/二选一/.test(mandatory)) {
    const splitAt = mandatory.search(/以下两个|二选一/);
    const before = splitAt >= 0 ? mandatory.slice(0, splitAt) : "";
    const beforeTokens = tokens.filter((token) => new RegExp(`\\b${escapeRegExp(token)}\\b`).test(before));
    const afterTokens = tokens.filter((token) => !beforeTokens.includes(token));
    allOf.push(...beforeTokens);
    if (afterTokens.length) anyOf.push(afterTokens);
  } else {
    allOf.push(...tokens);
  }
  return {
    needsVariant: hasMerchantVariants,
    selected,
    allowed: new Set(tokens),
    businessPriorityFactors: rowTokens.filter((token) => merchantRestrictionFactors.has(token)),
    allOf,
    anyOf,
  };
}

function hasConfirmedScenarioValue(value) {
  if (value === null || value === undefined) return false;
  if (typeof value === "string") return value.trim() !== "" && value !== "NEEDS_USER_CONFIRM";
  if (Array.isArray(value)) return value.length > 0 && value.every(hasConfirmedScenarioValue);
  if (typeof value === "object") return Object.keys(value).length > 0 && Object.values(value).some(hasConfirmedScenarioValue);
  return true;
}

function scalarScenarioValues(value) {
  if (value === null || value === undefined) return [];
  if (Array.isArray(value)) return value.flatMap(scalarScenarioValues);
  if (typeof value === "object") return Object.entries(value).flatMap(([key, nested]) => [key, ...scalarScenarioValues(nested)]);
  return [String(value)];
}

function hasFactorValueBinding(scopeText, allText, factor, value) {
  for (const factorToken of valueTokens(allText, factor)) {
    for (const valueToken of valueTokens(allText, value)) {
      if (hasNearbyTokenUsage(scopeText, factorToken, factor, valueToken, value, 1200)) return true;
    }
  }
  return false;
}

function checkBusinessPriorityScenario(scenario, scopeText, allText, errors) {
  if (!hasFieldValue(scopeText, allText, ["rule_factor", "ruleFactor", "RuleFactor"], ["setRuleFactor"], "ALARM_CLOCK_TIME")) {
    errors.push("businessPriority.enabled requires ALARM_CLOCK_TIME in institution create/modify code");
  } else {
    const timeValues = scalarScenarioValues(scenario.ruleFactorValues.ALARM_CLOCK_TIME);
    if (timeValues.length && !timeValues.some((value) => hasFactorValueBinding(scopeText, allText, "ALARM_CLOCK_TIME", value))) {
      errors.push("ALARM_CLOCK_TIME is not bound to its confirmed businessPriority value in institution create/modify code");
    }
  }
  const allowed = new Set(["MEAL_MERCHANT", "MERCHANT", "COMPOSITE_MERCHANT", "SHOP_GROUP", "SHOP", "RECEIPT_IDENTITY_WHITE_LIST"]);
  const selected = scenario.businessPriority.merchantRestrictionFactors;
  if (!Array.isArray(selected) || !selected.some((factor) => allowed.has(factor))) {
    errors.push("businessPriority.enabled requires at least one documented merchantRestrictionFactor");
    return;
  }
  const implemented = selected.filter((factor) => allowed.has(factor)
    && hasFieldValue(scopeText, allText, ["rule_factor", "ruleFactor", "RuleFactor"], ["setRuleFactor"], factor));
  if (implemented.length === 0) errors.push("businessPriority.enabled merchant restriction factor is not implemented in institution create/modify code");
  for (const factor of implemented) {
    const values = scalarScenarioValues(scenario.ruleFactorValues[factor]);
    if (values.length && !values.some((value) => hasFactorValueBinding(scopeText, allText, factor, value))) {
      errors.push(`${factor} is not bound to its confirmed businessPriority value in institution create/modify code`);
    }
  }

  if (implemented.includes("COMPOSITE_MERCHANT")) {
    const compositeValues = scenario.ruleFactorValues.COMPOSITE_MERCHANT;
    const validComposite = compositeValues && ["receiptIdentityWhiteList", "shopIdList", "shopGroupIdList"]
      .some((key) => Array.isArray(compositeValues[key]) && compositeValues[key].length > 0);
    if (!validComposite) {
      errors.push("COMPOSITE_MERCHANT counts for business priority only when receiptIdentityWhiteList, shopIdList, or shopGroupIdList is non-empty");
    }
  }
}

function checkBillScenarioIdentifiers(scenario, files, allText, errors) {
  if (!scenario.billIdentifiers || typeof scenario.billIdentifiers !== "object") return;
  const billText = files
    .filter((file) => {
      const relPath = rel(file).split(path.sep).join("/");
      if (/(^|\/)bill\//i.test(relPath) || /bill|consume|ecorder/i.test(path.basename(file))) return true;
      const text = fs.readFileSync(file, "utf8");
      return /alipay\.commerce\.ec\.consume|alipay\.ebpp\.invoice\.ecorder|order_content|expense_type_sub_category/i.test(text);
    })
    .map((file) => stripSourceComments(fs.readFileSync(file, "utf8"), file))
    .join("\n");
  if (!billText) {
    errors.push("scenario.json declares billIdentifiers but no bill implementation was found");
    return;
  }
  const fieldMap = {
    expenseType: [["expense_type", "expenseType", "ExpenseType"], ["setExpenseType"]],
    expenseTypeSubCategory: [["expense_type_sub_category", "expenseTypeSubCategory", "ExpenseTypeSubCategory"], ["setExpenseTypeSubCategory"]],
    sceneCode: [["scene_code", "sceneCode", "SceneCode"], ["setSceneCode"]],
    orderType: [["order_type", "orderType", "OrderType"], ["setOrderType"]],
  };
  for (const [key, value] of Object.entries(scenario.billIdentifiers)) {
    if (!fieldMap[key] || !hasConfirmedScenarioValue(value)) continue;
    const [fields, setters] = fieldMap[key];
    if (!hasFieldValue(billText, allText, fields, setters, String(value))) {
      errors.push(`bill implementation does not use confirmed billIdentifiers.${key}=${value}`);
    }
  }

  // 场景识别条件完整性：expenseType 与 expenseTypeSubCategory 都是账单通知报文字段
  // （consume.change.notify 的 biz_content 中均存在）。当 scenario 同时声明二者时，
  // 账单通知 handler 的识别逻辑必须同时核对这两个字段，否则同费用类型下的兄弟子类
  // （例如票务大类下的其它子类）会被误判为目标场景。
  // 凭证类（voucherType 等非通知报文字段）需查询账单详情后才能核对，不纳入本检查。
  //
  // 逐文件判断，且只看“做相等判定的识别语句”，避免被其它文件里的 getter 定义、
  // 枚举常量或字段声明稀释（合并全部 bill 文本会把 ConsumeChangeNotify 的
  // getExpenseTypeSubCategory() getter 也算进来，造成漏报）。
  const declaresType = hasConfirmedScenarioValue(scenario.billIdentifiers.expenseType);
  const declaresSub = hasConfirmedScenarioValue(scenario.billIdentifiers.expenseTypeSubCategory);
  if (declaresType && declaresSub) {
    for (const file of files) {
      const relPath = rel(file).split(path.sep).join("/");
      if (isTestOrGeneratedDocFile(file)) continue;
      if (!/(^|\/)bill\//i.test(relPath) && !/bill|consume/i.test(path.basename(file))) continue;
      const text = stripSourceComments(fs.readFileSync(file, "utf8"), file);
      // 仅当该文件确实对 expense_type 做相等判定（即用它做场景识别）时才检查。
      // 覆盖 Java（getExpenseType()）与非 Java（expense_type == "X" / "X" == expense_type）写法。
      const identifiesByExpenseType =
        /\.equals\s*\(\s*[A-Za-z0-9_.]*getExpenseType\s*\(\s*\)\s*\)/.test(text)
        || /getExpenseType\s*\(\s*\)\s*\.\s*equals\s*\(/.test(text)
        || /getExpenseType\s*\(\s*\)\s*==/.test(text)
        || /\bexpense_type\b\s*==\s*["'][^"']+["']/.test(text)
        || /["'][^"']+["']\s*==\s*\bexpense_type\b/.test(text);
      if (!identifiesByExpenseType) continue;
      const checksSubCategory = /getExpenseTypeSubCategory\s*\(\s*\)|expense_type_sub_category\b|expenseTypeSubCategory\b/.test(text);
      if (!checksSubCategory) {
        errors.push(`${relPath}: bill scene identification checks expense_type only, but scenario.json declares both expenseType and expenseTypeSubCategory; also check expense_type_sub_category so sibling subtypes are not misclassified`);
      }
    }
  }
}

function isTestOrGeneratedDocFile(file) {
  const relPath = rel(file).split(path.sep).join("/");
  if (/(^|\/)(?:test|tests|__tests__|docs?)\//i.test(relPath)) return true;
  if (/\.(?:test|spec)\.(?:js|cjs|mjs|ts|java|py|go|cs)$/i.test(path.basename(file))) return true;
  return false;
}

function hasInstitutionScenarioContext(text) {
  return /alipay\.ebpp\.invoice\.institution\.(?:create|modify)|AlipayEbppInvoiceInstitution(?:Create|Modify)|institution\.(?:create|modify)|institution_create|institution_modify|standard_info_list|standardInfoList|StandardInfo|setStandardInfoList|setExpenseType|setExpenseTypeSubCategory|setSceneType|setRuleFactor/i.test(text);
}

function hasFieldValue(scopeText, allText, fieldNames, setterNames, value) {
  // 先从全工程找到“字面量 -> 常量名”的关系，再回到制度上下文确认字段确实使用了该值。
  // 因此内联字符串、Constants.VALUE 和非 Java 对象字段写法都可以被识别。
  const tokens = valueTokens(allText, value);
  for (const token of tokens) {
    const tokenPattern = tokenUsagePattern(token, value);
    for (const setter of setterNames) {
      if (new RegExp(`\\b${escapeRegExp(setter)}\\s*\\(\\s*${tokenPattern}`).test(scopeText)) return true;
    }
    for (const field of fieldNames) {
      const fieldPattern = `(?:["']${escapeRegExp(field)}["']|\\b${escapeRegExp(field)}\\b)`;
      if (new RegExp(`${fieldPattern}\\s*(?:=>|:|=)\\s*${tokenPattern}`).test(scopeText)) return true;
    }
  }
  return false;
}

function tokenUsagePattern(token, literal) {
  if (token === literal) return `\\\\*["']${escapeRegExp(literal)}\\\\*["']`;
  return `(?:(?:\\b[A-Za-z_][A-Za-z0-9_]*\\s*(?:\\.|::)\\s*)?\\b${escapeRegExp(token)}\\b)`;
}

function hasNearbyTokenUsage(text, leftToken, leftLiteral, rightToken, rightLiteral, maxDistance) {
  const left = tokenUsagePattern(leftToken, leftLiteral);
  const right = tokenUsagePattern(rightToken, rightLiteral);
  return new RegExp(`${left}[\\s\\S]{0,${maxDistance}}${right}`).test(text)
    || new RegExp(`${right}[\\s\\S]{0,${maxDistance}}${left}`).test(text);
}

function escapeRegExp(value) {
  return String(value).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function findFile(dir, name) {
  return walk(dir).find((f) => path.basename(f) === name);
}

function isJavaProject(dir) {
  const files = walk(dir);
  return files.some((f) => f.endsWith(".java") || path.basename(f) === "pom.xml" || path.basename(f) === "build.gradle");
}

function isNodeProject(dir) {
  const files = walk(dir);
  return files.some((f) => path.basename(f) === "package.json")
    && files.some((f) => /\.(?:js|cjs|mjs|ts)$/i.test(f));
}

// -----------------------------------------------------------------------------
// 非 Java/Node 工程：运行当前环境可用的 Python、Go、.NET 构建检查。
// -----------------------------------------------------------------------------

function checkNonJavaProject(errors) {
  const files = walk(targetDir);
  const pyFiles = files.filter((f) => f.endsWith(".py"));
  const goMod = files.find((f) => path.basename(f) === "go.mod");
  const csproj = files.find((f) => /\.csproj$/i.test(f));

  if (pyFiles.length) checkPythonSyntax(pyFiles, errors);
  if (goMod) checkGoTests(goMod, errors);
  if (csproj) checkDotnetBuild(csproj, errors);
}

function checkPythonSyntax(pyFiles, errors) {
  if (!commandExists("python3")) {
    console.warn("[alipay-enterprise-scenario-integration] WARN python3 not found; skipped Python syntax validation");
    return;
  }
  const script = [
    "import ast, pathlib, sys",
    "for name in sys.argv[1:]:",
    "    path = pathlib.Path(name)",
    "    ast.parse(path.read_text(encoding='utf-8'), filename=str(path))",
  ].join("\n");
  const result = spawnSync("python3", ["-c", script, ...pyFiles], {
    cwd: targetDir,
    encoding: "utf8",
    env: Object.assign({}, process.env, { PYTHONDONTWRITEBYTECODE: "1" }),
    maxBuffer: 1024 * 1024,
  });
  if (result.status !== 0) errors.push(`Python syntax validation failed:\n${lastLines(result.stderr || result.stdout)}`);
}

function checkGoTests(goMod, errors) {
  if (!commandExists("go")) {
    console.warn("[alipay-enterprise-scenario-integration] WARN go command not found; skipped go test");
    return;
  }
  const result = spawnSync("go", ["test", "./..."], {
    cwd: path.dirname(goMod),
    encoding: "utf8",
    env: Object.assign({}, process.env, { GOCACHE: path.join(os.tmpdir(), "alipay-skill-go-cache") }),
    maxBuffer: 1024 * 1024 * 4,
  });
  if (result.status !== 0) errors.push(`go test ./... failed:\n${lastLines(`${result.stdout || ""}\n${result.stderr || ""}`, 40)}`);
}

function checkDotnetBuild(csproj, errors) {
  if (!commandExists("dotnet")) {
    console.warn("[alipay-enterprise-scenario-integration] WARN dotnet command not found; skipped dotnet build");
    return;
  }
  const result = spawnSync("dotnet", ["build", "--nologo"], {
    cwd: path.dirname(csproj),
    encoding: "utf8",
    maxBuffer: 1024 * 1024 * 8,
  });
  if (result.status !== 0) errors.push(`dotnet build failed:\n${lastLines(`${result.stdout || ""}\n${result.stderr || ""}`, 40)}`);
}

function commandExists(command) {
  const result = spawnSync(command, ["--version"], { encoding: "utf8", maxBuffer: 1024 * 32 });
  return result.status === 0;
}

// -----------------------------------------------------------------------------
// Node.js 聚合门禁：SDK、模块加载、语法和测试。
// -----------------------------------------------------------------------------

function checkNodeProject(errors) {
  const packageFile = findFile(targetDir, "package.json");
  if (!packageFile) return;

  let pkg = {};
  try {
    pkg = JSON.parse(fs.readFileSync(packageFile, "utf8"));
  } catch (err) {
    errors.push(`package.json is not valid JSON: ${err.message}`);
    return;
  }

  const jsFiles = walk(targetDir).filter((f) => /\.(?:js|cjs|mjs)$/i.test(f));
  const sourceText = jsFiles.map((f) => fs.readFileSync(f, "utf8")).join("\n");
  const sourceCode = stripJsComments(sourceText);

  checkNodeAlipaySdkUsage(pkg, packageFile, sourceCode, errors);
  checkNodeSyntax(jsFiles, errors);
  checkNodeModuleLoading(jsFiles, errors);
  checkNodeTests(pkg, path.dirname(packageFile), errors);
}

function checkNodeAlipaySdkUsage(pkg, packageFile, text, errors) {
  if (!/alipay-sdk/.test(text)) return;

  const deps = Object.assign({}, pkg.dependencies || {}, pkg.devDependencies || {});
  if (!deps["alipay-sdk"]) {
    errors.push("Node.js code uses alipay-sdk but package.json does not declare an alipay-sdk dependency");
  }

  if (/require\s*\(\s*["']alipay-sdk["']\s*\)\s*\.default\b/.test(text)) {
    errors.push("Node.js CommonJS code imports alipay-sdk via .default; current alipay-sdk exports { AlipaySdk }. Use `const { AlipaySdk } = require(\"alipay-sdk\")` and verify the installed SDK export");
  }

  const projectRoot = path.dirname(packageFile);
  try {
    const sdkPath = require.resolve("alipay-sdk", { paths: [projectRoot] });
    const sdk = require(sdkPath);
    if (typeof sdk.AlipaySdk !== "function") {
      errors.push("installed alipay-sdk does not export AlipaySdk as a constructor; inspect the real SDK export before generating client code");
    }
  } catch (err) {
    if (fs.existsSync(path.join(projectRoot, "node_modules"))) {
      errors.push(`failed to load installed alipay-sdk from generated Node.js project: ${err.message}`);
    } else {
      console.warn("[alipay-enterprise-scenario-integration] WARN node_modules not found; skipped installed alipay-sdk export check");
    }
  }
}

function checkNodeSyntax(jsFiles, errors) {
  for (const file of jsFiles) {
    const result = spawnSync(process.execPath, ["--check", file], {
      cwd: targetDir,
      encoding: "utf8",
      maxBuffer: 1024 * 1024,
    });
    if (result.status !== 0) {
      errors.push(`node --check failed for ${rel(file)}:\n${lastLines(result.stderr || result.stdout)}`);
    }
  }
}

function checkNodeModuleLoading(jsFiles, errors) {
  for (const file of jsFiles) {
    if (!isGeneratedSourceFile(file)) continue;
    if (path.basename(file) === "index.js" && /app\.listen\s*\(/.test(fs.readFileSync(file, "utf8"))) continue;

    const result = spawnSync(process.execPath, ["-e", "require(process.argv[1])", file], {
      cwd: targetDir,
      encoding: "utf8",
      maxBuffer: 1024 * 1024,
    });
    if (result.status !== 0) {
      errors.push(`Node.js module load failed for ${rel(file)}:\n${lastLines(result.stderr || result.stdout)}`);
    }
  }
}

function checkNodeTests(pkg, cwd, errors) {
  if (!pkg.scripts || !pkg.scripts.test) {
    console.warn("[alipay-enterprise-scenario-integration] WARN package.json has no test script; skipped npm test");
    return;
  }

  const result = spawnSync("npm", ["test"], {
    cwd,
    encoding: "utf8",
    maxBuffer: 1024 * 1024 * 4,
  });
  if (result.status !== 0) {
    errors.push(`npm test failed for generated Node.js project:\n${lastLines(`${result.stdout || ""}\n${result.stderr || ""}`, 40)}`);
  }
}

function isGeneratedSourceFile(file) {
  const relPath = rel(file).split(path.sep).join("/");
  return /^(src|lib|app)\//.test(relPath);
}

function lastLines(text, count = 20) {
  return String(text || "").trim().split(/\r?\n/).slice(-count).join("\n");
}

function stripJsComments(text) {
  return text
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/^\s*\/\/.*$/gm, "");
}

// -----------------------------------------------------------------------------
// Java/Maven 聚合门禁：官方消息入口、配置、路由、SDK 版本与编译结果。
// -----------------------------------------------------------------------------

function checkBuildConsistency(pom, errors) {
  const allText = readAll(targetDir);
  checkForbiddenJavaWebSocket(allText, errors);
  checkWebSocketSkeleton(allText, errors);
  checkSingleOfficialMessageClient(errors);

  if (!pom) return;
  const pomText = fs.readFileSync(pom, "utf8");
  const sdkVersion = extractPomSdkVersion(pomText);
  if (!sdkVersion) {
    errors.push("pom.xml must declare com.alipay.sdk:alipay-sdk-java with an explicit version, alipay-sdk.version property, or alipay.sdk.version property");
    return;
  }
  checkSdkVersionSource(sdkVersion, errors);

  const readmes = walk(targetDir).filter((f) => /^readme\.md$/i.test(path.basename(f)));
  for (const readme of readmes) {
    const text = fs.readFileSync(readme, "utf8");
    for (const m of text.matchAll(/alipay-sdk-java\s*[:：]\s*([0-9][0-9A-Za-z._-]*\.ALL)/g)) {
      if (m[1] !== sdkVersion) {
        errors.push(`${rel(readme)}: README SDK version ${m[1]} differs from pom.xml ${sdkVersion}; update README, do not downgrade pom.xml`);
      }
    }
  }
}

function checkForbiddenJavaWebSocket(text, errors) {
  const uncommented = stripJavaComments(text);
  const forbidden = [
    [/Java-WebSocket|org[._]java[_-]?websocket/i, "Java-WebSocket/org.java_websocket"],
    [/javax\.websocket/i, "javax.websocket"],
    [/jakarta\.websocket/i, "jakarta.websocket"],
    [/@ServerEndpoint\b/i, "@ServerEndpoint"],
    [/implements\s+WebSocketConfigurer\b/i, "Spring WebSocketConfigurer"],
    [/extends\s+TextWebSocketHandler\b/i, "Spring TextWebSocketHandler"],
  ];

  for (const [pattern, label] of forbidden) {
    if (pattern.test(uncommented)) {
      errors.push(`do not add ${label} when Java message access uses official AlipayMsgClient + MsgHandler; remove custom WebSocket server/protocol code`);
    }
  }
}

function checkWebSocketSkeleton(text, errors) {
  const uncommented = stripJavaComments(text);
  if (/implements\s+WebSocketConfigurer|@EnableWebSocket/.test(uncommented) && !/registry\s*\.addHandler\s*\(/.test(uncommented)) {
    errors.push("empty Spring WebSocketConfig/WebSocketConfigurer detected; use executable AlipayMsgClient + MsgHandler or remove the unused Spring WebSocket skeleton");
  }

  if (/WebSocket|AlipayMsgClient|MsgHandler/.test(text) && /AlipayMsgClient|MsgHandler/.test(text)) {
    const hasExecutableClient = /AlipayMsgClient\s+[A-Za-z0-9_]+|AlipayMsgClient\.getInstance\s*\(/.test(uncommented)
      && /setMessageHandler\s*\(/.test(uncommented)
      && /\.connect\s*\(/.test(uncommented);
    if (!hasExecutableClient) {
      errors.push("Java WebSocket code mentions AlipayMsgClient/MsgHandler but does not contain executable getInstance + setMessageHandler + connect logic; do not leave official SDK access as comments/logs");
    }
  }
}

function checkSingleOfficialMessageClient(errors) {
  const javaFiles = walk(targetDir).filter((f) => f.endsWith(".java"));
  const handlerFiles = [];
  const clientFiles = [];
  const connectFiles = [];

  for (const file of javaFiles) {
    const text = stripJavaComments(fs.readFileSync(file, "utf8"));
    if (/AlipayMsgClient\.getInstance\s*\(/.test(text)) clientFiles.push(file);
    if (/\.setMessageHandler\s*\(/.test(text)) handlerFiles.push(file);
    if (/AlipayMsgClient[\s\S]{0,400}\.connect\s*\(/.test(text) || /\.connect\s*\(\s*\)/.test(text) && /AlipayMsgClient/.test(text)) {
      connectFiles.push(file);
    }
  }

  if (handlerFiles.length > 1 || clientFiles.length > 1) {
    const files = Array.from(new Set([...clientFiles, ...handlerFiles])).map(rel).join(", ");
    errors.push(`Java WebSocket must have exactly one official AlipayMsgClient owner per appId. Multiple getInstance/setMessageHandler sites detected: ${files}. Generate one shared MsgHandler router and make domain code expose handler methods only`);
  }

  if (connectFiles.length > 1) {
    errors.push(`Java WebSocket must connect from one shared AlipayMsgClient owner only; multiple connect sites detected: ${connectFiles.map(rel).join(", ")}`);
  }
}

function checkMessageClientStartupFailure(errors) {
  for (const file of walk(targetDir).filter((f) => f.endsWith(".java"))) {
    const text = stripJavaComments(fs.readFileSync(file, "utf8"));
    if (!/AlipayMsgClient/.test(text) || !/\.connect\s*\(/.test(text)) continue;
    for (const method of javaMethods(text)) {
      if (!/\.connect\s*\(/.test(method.body)) continue;
      const catches = catchBodies(method.body);
      if (catches.length && catches.some((body) => !hasSafeConnectFailurePolicy(body))) {
        errors.push(`AlipayMsgClient owner ${rel(file)}: ${method.name}(...) catches initial connect failure without fail-fast or both retry and health/readiness signaling; do not leave the application running while message intake is unavailable`);
      }
    }
  }
}

function javaMethods(text) {
  const methods = [];
  const pattern = /^\s*(?:(?:public|private|protected)\s+)?(?:static\s+)?[A-Za-z0-9_<>, ?\[\]]+\s+([A-Za-z0-9_]+)\s*\([^)]*\)\s*(?:throws\s+[^{]+)?\{/gm;
  for (const match of text.matchAll(pattern)) {
    const open = match.index + match[0].length - 1;
    const close = findMatchingDelimiter(text, open, "{", "}");
    if (close > open) methods.push({ name: match[1], body: text.slice(open, close + 1) });
  }
  return methods;
}

function catchBodies(body) {
  const result = [];
  for (const match of body.matchAll(/\bcatch\s*\([^)]*\)\s*\{/g)) {
    const open = match.index + match[0].length - 1;
    const close = findMatchingDelimiter(body, open, "{", "}");
    if (close > open) result.push(body.slice(open + 1, close));
  }
  return result;
}

function hasSafeConnectFailurePolicy(body) {
  const failsFast = /\bthrow\b|System\s*\.\s*exit\s*\(|SpringApplication\s*\.\s*exit\s*\(|Runtime\s*\.\s*getRuntime\s*\(\s*\)\s*\.\s*halt\s*\(/.test(body);
  const retries = /\b(?:retry|reconnect|backoff|reschedule|schedule|connectAsync)\b|\.connect\s*\(/i.test(body);
  const signalsHealth = /\b(?:health|readiness|availability|liveness)\b|REFUSING_TRAFFIC|\bDOWN\b|setConnected\s*\(\s*false\s*\)|mark[A-Za-z0-9_]*(?:Unavailable|Down)/i.test(body);
  return failsFast || retries && signalsHealth;
}

function checkSpringValueConsistency(errors) {
  const javaFiles = walk(targetDir).filter((f) => f.endsWith(".java"));
  const alipayKeys = new Set();

  for (const file of javaFiles) {
    const text = fs.readFileSync(file, "utf8");
    for (const m of text.matchAll(/@Value\s*\(\s*"\$\{(alipay\.[^:}"]+)/g)) {
      alipayKeys.add(m[1]);
    }
  }

  if (alipayKeys.size === 0) return;

  // Normalize a key to lowercase-no-separator form for comparison
  const normalize = (k) => k.toLowerCase().replace(/[-_]/g, "");

  // Group keys by normalized form to detect camelCase vs kebab-case conflicts
  const groups = new Map();
  for (const key of alipayKeys) {
    const norm = normalize(key);
    if (!groups.has(norm)) groups.set(norm, []);
    groups.get(norm).push(key);
  }

  for (const [, variants] of groups) {
    const unique = Array.from(new Set(variants));
    if (unique.length > 1) {
      errors.push(`Spring @Value configuration key inconsistency: ${unique.join(" vs ")} — @Value $\{} does not support relaxed binding; all @Value keys must use the same format (kebab-case recommended)`);
    }
  }

}

function checkMessageRouterCompleteness(errors) {
  for (const router of messageRouters()) {
    const switchBranches = switchRouterBranches(router.method.body);
    if (switchBranches.length) {
      // 空 case 可以合法贯穿到后续 handler；含 break/return/throw 的 case
      // 不可能贯穿，不能借用后一个 case 的调用来通过校验。
      for (let i = 0; i < switchBranches.length; i++) {
        const current = switchBranches[i];
        if (hasHandlerCall(current.meaningful)) continue;

        let fallthroughHasHandler = false;
        if (current.meaningful.length === 0 && !current.terminates) {
          for (let j = i + 1; j < switchBranches.length; j++) {
            const next = switchBranches[j];
            if (hasHandlerCall(next.meaningful)) {
              fallthroughHasHandler = true;
              break;
            }
            if (next.meaningful.length > 0) break;
          }
        }

        if (!fallthroughHasHandler) {
          errors.push(`message router ${rel(router.file)}: ${current.name} has no actual handler method call; every declared msg_method case must dispatch to a real handler, not just comment/log/break`);
        }
      }
      continue;
    }

    for (const branch of ifElseRouterBranches(router.method.body, router.method.msgParam)) {
      if (!hasHandlerCall(meaningfulRouterCaseBody(branch.body))) {
        errors.push(`message router ${rel(router.file)}: if (${branch.condition.trim()}) has no actual handler method call; every msgApi dispatch branch must call a real handler, not just comment/log/return`);
      }
    }
  }
}

function checkMessageRouterFailurePropagation(errors) {
  for (const router of messageRouters()) {
    const switchBranches = switchRouterBranches(router.method.body);
    const branches = switchBranches.length
      ? switchBranches.map((branch) => ({ body: branch.body }))
      : ifElseRouterBranches(router.method.body, router.method.msgParam);

    for (const branch of branches) {
      for (const call of handlerDispatchCalls(branch.body)) {
        if (!handlerFailureIsPropagated(branch.body, call)) {
          errors.push(`message router ${rel(router.file)} ignores ${call.owner}.${call.method}(...) result; handler fail/false must be converted to an exception or explicit fail path so platform retry is not swallowed`);
        }
      }
    }
  }
}

function checkMessageRouterUnknownHandling(errors) {
  for (const router of messageRouters()) {
    const hasSwitch = /switch\s*\(/.test(router.method.body);
    const fallbackBody = hasSwitch
      ? firstSwitchDefaultBody(router.method.body)
      : ifElseRouterFallback(router.method.body, router.method.msgParam);
    // Preserve the existing switch behavior: a switch without default was not
    // treated as an error by this gate. The new if/else path must have a
    // terminal else or a method-tail failure path.
    if (hasSwitch && !fallbackBody) continue;

    const fallbackCode = stripStringLiterals(fallbackBody || "");
    const hasExplicitUnknownHandler = /\b(?:handleUnknown|unknownHandler|onUnknown|unknown[A-Za-z0-9_]*Handler)\s*\(/i.test(fallbackCode);
    const hasFailPath = /\bthrow\s+new\b|\bFAIL\b|\bfail\s*\(|\breturn\s+false\b/.test(fallbackCode);
    if (!hasExplicitUnknownHandler && !hasFailPath) {
      errors.push(`message router ${rel(router.file)} defaults unknown msgApi/msg_method to success; throw, return fail, or delegate to an explicit unknown handler with documented acknowledgement policy`);
    }
  }
}

function messageRouters() {
  const routers = [];
  for (const file of walk(targetDir).filter((f) => f.endsWith(".java"))) {
    const text = stripJavaComments(fs.readFileSync(file, "utf8"));
    if (!/implements\s+MsgHandler\b/.test(text)) continue;
    const method = extractOnMessageMethod(text);
    if (method) routers.push({ file, text, method });
  }
  return routers;
}

function extractOnMessageMethod(text) {
  const signature = /\bvoid\s+onMessage\s*\(([^)]*)\)\s*(?:throws\s+[^{]+)?\{/g;
  const match = signature.exec(text);
  if (!match) return null;
  const open = match.index + match[0].length - 1;
  const close = findMatchingDelimiter(text, open, "{", "}");
  if (close < 0) return null;
  const firstParam = match[1].split(",")[0] || "";
  const pieces = firstParam.trim().split(/\s+/);
  const msgParam = pieces[pieces.length - 1].replace(/\[\]$/, "") || "msgApi";
  return {
    body: text.slice(open + 1, close),
    msgParam,
  };
}

function switchRouterBranches(methodBody) {
  const casePattern = /case\s+([^:\n]+)\s*:([\s\S]*?)(?=case\s|default\s*:|$)/g;
  return Array.from(methodBody.matchAll(casePattern)).map((match) => ({
    name: match[1].trim(),
    body: match[2],
    meaningful: meaningfulRouterCaseBody(match[2]),
    // Strip string literals first so words such as "return" in log messages
    // are not mistaken for control flow.
    terminates: /\b(?:break|return|throw)\b/.test(stripStringLiterals(match[2])),
  }));
}

function ifElseRouterBranches(methodBody, msgParam) {
  return topLevelIfBranches(methodBody).filter((branch) => isRouterDispatchCondition(branch.condition, msgParam));
}

function topLevelIfBranches(methodBody) {
  const branches = [];
  let depth = 0;
  let quote = null;
  let escaped = false;
  let lineComment = false;
  let blockComment = false;

  for (let i = 0; i < methodBody.length; i++) {
    const ch = methodBody[i];
    const next = methodBody[i + 1];
    if (lineComment) {
      if (ch === "\n") lineComment = false;
      continue;
    }
    if (blockComment) {
      if (ch === "*" && next === "/") {
        blockComment = false;
        i++;
      }
      continue;
    }
    if (quote) {
      if (escaped) escaped = false;
      else if (ch === "\\") escaped = true;
      else if (ch === quote) quote = null;
      continue;
    }
    if (ch === "/" && next === "/") {
      lineComment = true;
      i++;
      continue;
    }
    if (ch === "/" && next === "*") {
      blockComment = true;
      i++;
      continue;
    }
    if (ch === "\"" || ch === "'" || ch === "`") {
      quote = ch;
      continue;
    }
    if (ch === "{") {
      depth++;
      continue;
    }
    if (ch === "}") {
      depth--;
      continue;
    }
    if (depth !== 0 || methodBody.slice(i, i + 2) !== "if") continue;
    if (i > 0 && /[A-Za-z0-9_$]/.test(methodBody[i - 1])) continue;
    if (/[A-Za-z0-9_$]/.test(methodBody[i + 2] || "")) continue;

    const conditionOpen = skipWhitespace(methodBody, i + 2);
    if (methodBody[conditionOpen] !== "(") continue;
    const conditionClose = findMatchingDelimiter(methodBody, conditionOpen, "(", ")");
    if (conditionClose < 0) continue;
    const bodyOpen = skipWhitespace(methodBody, conditionClose + 1);
    if (methodBody[bodyOpen] !== "{") continue;
    const bodyClose = findMatchingDelimiter(methodBody, bodyOpen, "{", "}");
    if (bodyClose < 0) continue;

    branches.push({
      start: i,
      end: bodyClose + 1,
      condition: methodBody.slice(conditionOpen + 1, conditionClose),
      body: methodBody.slice(bodyOpen + 1, bodyClose),
    });
    i = bodyClose;
  }
  return branches;
}

function isRouterDispatchCondition(condition, msgParam) {
  const code = stripStringLiterals(condition);
  const param = escapeRegExp(msgParam);
  if (!new RegExp(`\\b${param}\\b`).test(code)) return false;

  const guardOnly = new RegExp(
    `^\\s*(?:!\\s*)?(?:Objects\\s*\\.\\s*(?:isNull|nonNull)\\s*\\(\\s*${param}\\s*\\)|`
      + `${param}\\s*(?:==|!=)\\s*null|null\\s*(?:==|!=)\\s*${param}|`
      + `${param}\\s*\\.\\s*(?:isEmpty|isBlank)\\s*\\(\\s*\\))\\s*$`,
  );
  if (guardOnly.test(code)) return false;

  return new RegExp(`\\.(?:supports|canHandle|matches|accepts)\\s*\\([^)]*\\b${param}\\b`, "i").test(code)
    || new RegExp(`\\.equals\\s*\\(\\s*${param}\\s*\\)`).test(code)
    || new RegExp(`\\b${param}\\b\\s*\\.\\s*equals\\s*\\(`).test(code)
    || new RegExp(`\\b${param}\\b\\s*(?:==|!=)\\s*(?!null\\b)[A-Za-z0-9_."']+`).test(condition)
    || new RegExp(`[A-Za-z0-9_."']+\\s*(?:==|!=)\\s*\\b${param}\\b`).test(condition)
    || new RegExp(`\\b[A-Za-z0-9_]*(?:Handler|handler)\\s*\\.\\s*[A-Za-z0-9_]+\\s*\\([^)]*\\b${param}\\b`).test(code);
}

function handlerDispatchCalls(body) {
  const calls = [];
  const pattern = /\b([A-Za-z_$][A-Za-z0-9_$]*(?:Handler|handler))\s*\.\s*([A-Za-z_$][A-Za-z0-9_$]*)\s*\(/g;
  for (const match of body.matchAll(pattern)) {
    if (/^(?:supports|canHandle|matches|accepts|supportedMsgMethod)$/i.test(match[2])) continue;
    const open = match.index + match[0].length - 1;
    const close = findMatchingDelimiter(body, open, "(", ")");
    if (close < 0) continue;
    calls.push({
      owner: match[1],
      method: match[2],
      start: match.index,
      end: close + 1,
    });
  }
  return calls;
}

function handlerFailureIsPropagated(body, call) {
  // Slice first, then remove string contents. stripStringLiterals shortens
  // literals, so applying original call offsets to the stripped full body
  // would inspect the wrong region.
  const before = stripStringLiterals(body.slice(Math.max(0, call.start - 180), call.start));
  const rawAfter = body.slice(call.end, Math.min(body.length, call.end + 700));
  const after = stripStringLiterals(rawAfter);
  const failAction = /\bthrow\s+new\b|\breturn\s+false\b|\bfail\s*\(|\bFAIL\b/;

  // Direct condition: if (!handler.handle(...)) { throw/fail/... }
  const statementPrefix = before.slice(Math.max(before.lastIndexOf(";"), before.lastIndexOf("{")) + 1);
  if (/\bif\s*\([^)]*$/.test(statementPrefix) && failAction.test(after)) return true;

  // Assigned result: boolean ok = handler.handle(...); if (!ok) { throw/fail/... }
  const assignment = before.match(/(?:boolean|Boolean|String|var)?\s*([A-Za-z_$][A-Za-z0-9_$]*)\s*=\s*$/);
  if (assignment) {
    const resultName = escapeRegExp(assignment[1]);
    const failureTest = new RegExp(
      `\\bif\\s*\\([^)]*(?:!\\s*${resultName}\\b|${resultName}\\s*==\\s*false|false\\s*==\\s*${resultName})`,
      "i",
    );
    const stringFailureTest = new RegExp(
      `(?:${resultName}\\s*\\.\\s*equals(?:IgnoreCase)?\\s*\\(\\s*["']fail["']\\s*\\)|`
        + `["']fail["']\\s*\\.\\s*equals(?:IgnoreCase)?\\s*\\(\\s*${resultName}\\s*\\))`,
      "i",
    );
    if ((failureTest.test(after) || stringFailureTest.test(rawAfter)) && failAction.test(after)) return true;
  }

  // A handler that is immediately followed by an explicit failure path also
  // preserves retry semantics, even when the result is not stored.
  return failAction.test(after.slice(0, 320));
}

function ifElseRouterFallback(methodBody, msgParam) {
  const branches = ifElseRouterBranches(methodBody, msgParam);
  if (!branches.length) return "";
  const last = branches[branches.length - 1];
  let cursor = skipWhitespace(methodBody, last.end);

  if (methodBody.slice(cursor, cursor + 4) === "else") {
    cursor = skipWhitespace(methodBody, cursor + 4);
    if (methodBody[cursor] === "{") {
      const close = findMatchingDelimiter(methodBody, cursor, "{", "}");
      if (close > cursor) return methodBody.slice(cursor + 1, close);
    }
  }
  return methodBody.slice(last.end);
}

function skipWhitespace(text, index) {
  let i = index;
  while (i < text.length && /\s/.test(text[i])) i++;
  return i;
}

function findMatchingDelimiter(text, open, opening, closing) {
  let depth = 0;
  let quote = null;
  let escaped = false;
  let lineComment = false;
  let blockComment = false;
  for (let i = open; i < text.length; i++) {
    const ch = text[i];
    const next = text[i + 1];
    if (lineComment) {
      if (ch === "\n") lineComment = false;
      continue;
    }
    if (blockComment) {
      if (ch === "*" && next === "/") {
        blockComment = false;
        i++;
      }
      continue;
    }
    if (quote) {
      if (escaped) escaped = false;
      else if (ch === "\\") escaped = true;
      else if (ch === quote) quote = null;
      continue;
    }
    if (ch === "/" && next === "/") {
      lineComment = true;
      i++;
      continue;
    }
    if (ch === "/" && next === "*") {
      blockComment = true;
      i++;
      continue;
    }
    if (ch === "\"" || ch === "'" || ch === "`") {
      quote = ch;
      continue;
    }
    if (ch === opening) depth++;
    else if (ch === closing) {
      depth--;
      if (depth === 0) return i;
    }
  }
  return -1;
}

function firstSwitchDefaultBody(text) {
  const match = text.match(/default\s*:/);
  if (!match) return "";
  const start = match.index + match[0].length;
  const tail = text.slice(start, start + 700);
  const nextCase = tail.search(/\bcase\s+/);
  const switchEnd = tail.search(/\n\s*}\s*(?:\n|$)/);
  const ends = [nextCase, switchEnd].filter((i) => i >= 0);
  const end = ends.length ? Math.min(...ends) : tail.length;
  return tail.slice(0, end);
}

function checkAlipayMsgClientSecurityConfig(errors) {
  const javaFiles = walk(targetDir).filter((f) => f.endsWith(".java"));
  for (const file of javaFiles) {
    const text = stripJavaComments(fs.readFileSync(file, "utf8"));
    if (!/AlipayMsgClient\.getInstance\s*\(/.test(text)) continue;

    const configCall = text.match(/\.setSecurityConfig\s*\(\s*([^,\n]+?)\s*,/);
    if (!configCall) {
      errors.push(`AlipayMsgClient owner ${rel(file)} must call setSecurityConfig(signType, privateKey, alipayPublicKey) before connect`);
      continue;
    }

    const firstArg = configCall[1];
    if (/appId/i.test(firstArg)) {
      errors.push(`AlipayMsgClient owner ${rel(file)} passes appId to setSecurityConfig; first argument must be signType such as RSA2`);
    }
  }
}

function stripStringLiterals(text) {
  // Remove the contents of "...", '...' and `...` so keywords inside string
  // literals are not parsed as code. Approximate (no full escape tracking),
  // sufficient for keyword detection.
  return text
    .replace(/"(?:\\.|[^"\\])*"/g, '""')
    .replace(/'(?:\\.|[^'\\])*'/g, "''")
    .replace(/`(?:\\.|[^`\\])*`/g, "``");
}

function meaningfulRouterCaseBody(caseBody) {
  return caseBody
    .replace(/break\s*;/g, "")
    .replace(/logger\.\w+\s*\([^)]*\)\s*;/g, "")
    .replace(/log\.\w+\s*\([^)]*\)\s*;/g, "")
    .replace(/System\.out\.\w+\s*\([^)]*\)\s*;/g, "")
    .trim();
}

function hasHandlerCall(text) {
  return /\b[A-Za-z0-9_]*(?:Handler|handler)\s*\.\s*[A-Za-z0-9_]+\s*\(/.test(text)
    || /\bhandle[A-Z][A-Za-z0-9_]*\s*\(/.test(text);
}

function stripJavaComments(text) {
  return text.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");
}

function checkSdkVersionSource(sdkVersion, errors) {
  // 新旧工程都以 Central Portal 当前页面为版本事实来源。
  // 查询失败时直接报错，不回退到脚本内置默认版本。
  const latest = fetchLatestAlipaySdkVersion();
  if (!latest) {
    errors.push("unable to verify latest alipay-sdk-java version from Central Portal; run `curl -sL \"https://central.sonatype.com/artifact/com.alipay.sdk/alipay-sdk-java\"` with approval or provide the Central Portal current version before generating Java/Maven code");
    return;
  }
  if (sdkVersion !== latest) {
    errors.push(`pom.xml uses alipay-sdk-java ${sdkVersion}, but Central Portal current version is ${latest}; upgrade new and existing Java/Maven projects to the current version and keep README/docs in sync`);
  }
}

function fetchLatestAlipaySdkVersion() {
  const url = "https://central.sonatype.com/artifact/com.alipay.sdk/alipay-sdk-java";
  const result = spawnSync("curl", ["-fsSL", url], {
    encoding: "utf8",
    maxBuffer: 1024 * 1024 * 2,
  });
  if (result.status !== 0 || !result.stdout) return null;
  const pkg = result.stdout.match(/pkg:maven\/com\.alipay\.sdk\/alipay-sdk-java@([0-9][0-9A-Za-z._-]*\.ALL)/);
  if (pkg) return pkg[1];
  const dep = result.stdout.match(/<artifactId>\s*alipay-sdk-java\s*<\/artifactId>[\s\S]*?<version>\s*([0-9][0-9A-Za-z._-]*\.ALL)\s*<\/version>/);
  return dep ? dep[1] : null;
}

function checkMavenCompile(pom, errors) {
  if (!pom || process.env.ALIPAY_VALIDATE_SKIP_COMPILE === "1") return;
  const result = spawnSync("mvn", ["-q", "-DskipTests", "compile"], {
    cwd: path.dirname(pom),
    encoding: "utf8",
    maxBuffer: 1024 * 1024 * 8,
  });
  if (result.status !== 0) {
    const output = `${result.stdout || ""}\n${result.stderr || ""}`.trim().split(/\r?\n/).slice(-25).join("\n");
    errors.push(`mvn -q -DskipTests compile failed; keep official SDK code and fix dependency/types from docs instead of creating stubs:\n${output}`);
  }
}

function checkSdkJarClasses(pom, errors) {
  if (!pom) return;
  const pomText = fs.readFileSync(pom, "utf8");
  const sdkVersion = extractPomSdkVersion(pomText);
  if (!sdkVersion) return;

  const jarPath = path.join(os.homedir(), ".m2", "repository", "com", "alipay", "sdk", "alipay-sdk-java", sdkVersion, `alipay-sdk-java-${sdkVersion}.jar`);
  if (!fs.existsSync(jarPath)) {
    errors.push(`alipay-sdk-java jar not found in local Maven repository: ${jarPath}; run Maven dependency resolution, do not create SDK stubs`);
    return;
  }

  const result = spawnSync("jar", ["tf", jarPath], { encoding: "utf8", maxBuffer: 1024 * 1024 * 16 });
  if (result.status !== 0) {
    errors.push(`failed to inspect SDK jar ${jarPath}: ${(result.stderr || result.stdout || "").trim()}`);
    return;
  }

  const entries = new Set(result.stdout.split(/\r?\n/));
  const imported = new Set();
  for (const file of walk(targetDir).filter((f) => f.endsWith(".java"))) {
    const text = fs.readFileSync(file, "utf8");
    for (const m of text.matchAll(/^\s*import\s+(com\.alipay\.api\.(?:request|response|domain|msg)\.[A-Za-z0-9_]+)\s*;/gm)) {
      imported.add(m[1]);
    }
  }

  for (const className of imported) {
    const entry = `${className.replace(/\./g, "/")}.class`;
    if (!entries.has(entry)) {
      errors.push(`SDK class imported by generated code is not present in alipay-sdk-java ${sdkVersion}: ${className}; change SDK version or generated code, do not create local stubs`);
    }
  }
}

function extractPomSdkVersion(pomText) {
  const properties = extractPomProperties(pomText);
  const dep = pomText.match(/<groupId>\s*com\.alipay\.sdk\s*<\/groupId>[\s\S]*?<artifactId>\s*alipay-sdk-java\s*<\/artifactId>[\s\S]*?<version>\s*([^<\s]+)\s*<\/version>/);
  if (!dep) return properties.get("alipay-sdk.version") || properties.get("alipay.sdk.version") || null;
  const version = dep[1];
  const propertyRef = version.match(/^\$\{([^}]+)\}$/);
  if (propertyRef) return properties.get(propertyRef[1]) || null;
  return version;
}

function extractPomProperties(pomText) {
  const properties = new Map();
  const block = pomText.match(/<properties>([\s\S]*?)<\/properties>/);
  if (!block) return properties;
  for (const m of block[1].matchAll(/<([A-Za-z0-9_.-]+)>\s*([^<\s]+)\s*<\/\1>/g)) {
    properties.set(m[1], m[2]);
  }
  return properties;
}

function rel(file) {
  return path.relative(targetDir, file);
}

function walk(dir) {
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory() && shouldSkipDir(entry.name)) return [];
    return entry.isDirectory() ? walk(full) : [full];
  });
}

function shouldSkipDir(name) {
  return new Set([".git", ".idea", ".codefuse", "node_modules", "target", "dist", "build", "coverage"]).has(name);
}
