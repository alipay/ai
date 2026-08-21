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
const solutionSkillsRoot = path.resolve(skillDir, "..");
const repoRoot = path.resolve(skillDir, "..", "..");
const domainSkillsRoot = path.join(repoRoot, "domain-skills");
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
const invoiceScript = "alipay-enterprise-invoice/scripts/validate_codegen.js";
const thirdPartyWithholdingScript = "alipay-third-party-withholding/scripts/validate_codegen.js";
const ALIPAY_SDK_VERSION_PATTERN = /^[0-9]+\.[0-9]+\.[0-9]+\.ALL$/;
const RULE_FACTOR_VALIDATIONS = new Set([
  "DOCUMENTED_ENUM",
  "DOCUMENTED_RANGE",
  "DOCUMENTED_SCHEMA",
  "BUSINESS_IDENTIFIER",
  "DOCUMENTED_CONSTRAINTS",
  "EXACT_MATCH",
]);
const RULE_FACTOR_VALUE_SOURCES = new Set(["SCENARIO_FIXED", "ENTERPRISE_INPUT"]);
const SCENARIO_FIXED_RULE_VALUES = new Map([
  ["TICKET/TICKET:MERCHANT", { "2088011519249952": ["-1"] }],
]);

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
  const selectedChildScripts = [...childScripts];
  const invoiceSelected = shouldRunInvoiceValidator();
  const thirdPartyWithholdingSelected = shouldRunThirdPartyWithholdingValidator();
  if (invoiceSelected) selectedChildScripts.push(invoiceScript);
  if (thirdPartyWithholdingSelected) selectedChildScripts.push(thirdPartyWithholdingScript);
  for (const relScript of selectedChildScripts) {
    const outcome = runChildValidator(relScript, childEnv);
    if (outcome.state === "FAIL") failed = true;
    if (outcome.state === "BROKEN") {
      broken = true;
      console.error(`[alipay-enterprise-scenario-integration] BROKEN ${relScript}: ${outcome.reason}`);
    }
  }

  const aggregateErrors = [];
  const contractDomains = ["ec", "expense-control", "bill"];
  if (invoiceSelected) contractDomains.push("invoice");
  if (thirdPartyWithholdingSelected) contractDomains.push("third-party-withholding");
  validateIntegrationContract(targetDir, contractDomains, aggregateErrors);
  checkSelectedScenario(aggregateErrors);

  const pom = findFile(targetDir, "pom.xml");
  const gradle = findFile(targetDir, "build.gradle");
  if (javaProject && !pom && !gradle) {
    console.warn("[alipay-enterprise-scenario-integration] WARN no pom.xml/build.gradle found; compile validation must be reported as unavailable");
  }
  if (javaProject) {
    const javaFiles = walk(targetDir).filter((file) => file.endsWith(".java"));
    checkBuildConsistency(pom, aggregateErrors);
    checkMavenCompile(pom, aggregateErrors);
    checkSdkJarClasses(pom, aggregateErrors);
    javaProjectGates.checkSdkReflectionBypass(javaFiles, aggregateErrors, rel);
    checkSpringValueConsistency(aggregateErrors);
    checkProductionCredentialDefaults(aggregateErrors);
    checkManagementControllerTenantBinding(aggregateErrors);
    checkAlternativeQueryRoutes(aggregateErrors);
    checkSpringContextMessageIsolation(aggregateErrors);
    checkMessageLifecycleContracts(aggregateErrors);
    checkMessageRouterCompleteness(aggregateErrors);
    checkMessageRouterFailurePropagation(aggregateErrors);
    checkMessageRouterUnknownHandling(aggregateErrors);
    checkAlipayMsgClientSecurityConfig(aggregateErrors);
    checkMessageClientStartupFailure(aggregateErrors);
    javaProjectGates.checkJavaAlipayMsgClientContracts(javaFiles, aggregateErrors, rel);
    javaProjectGates.checkJavaTransportContracts(javaFiles, aggregateErrors, rel);
    javaProjectGates.checkJavaProductionStateStores(javaFiles, aggregateErrors, rel);
    javaProjectGates.checkJavaStateTransitionPersistence(javaFiles, aggregateErrors, rel);
    javaProjectGates.checkSpringProfileWiring(targetDir, javaFiles, aggregateErrors, rel);
    javaProjectGates.checkJavaProfiledCoreComponents(javaFiles, aggregateErrors, rel);
    javaProjectGates.checkJavaConcreteDemoDependency(javaFiles, aggregateErrors, rel);
    javaProjectGates.checkJavaFailClosedDefaultBackoff(javaFiles, aggregateErrors, rel);
    javaProjectGates.checkSpringBeanMethodBypass(javaFiles, aggregateErrors, rel);
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
  const script = resolveSkillRelativePath(relScript);
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

function resolveSkillRelativePath(relPath) {
  const parts = relPath.split("/");
  const domain = parts.shift();
  return path.join(resolveDomainSkillDir(domain), ...parts);
}

function resolveDomainSkillDir(domain) {
  const structured = path.join(domainSkillsRoot, domain);
  if (fs.existsSync(structured) && fs.statSync(structured).isDirectory()) return structured;
  return path.join(solutionSkillsRoot, domain);
}

function readAll(dir) {
  return walk(dir).filter((f) => /\.(java|php|py|js|ts|go|cs|rb|md|xml|json|ya?ml)$/i.test(f))
    .map((f) => fs.readFileSync(f, "utf8")).join("\n");
}

function shouldRunThirdPartyWithholdingValidator() {
  const scenarioFile = path.join(targetDir, ".alipay-skill", "scenario.json");
  if (fs.existsSync(scenarioFile)) {
    try {
      const scenario = JSON.parse(fs.readFileSync(scenarioFile, "utf8"));
      if (scenario && scenario.thirdPartyWithholding && scenario.thirdPartyWithholding.enabled === true) return true;
    } catch (_) {
      // readScenarioFile reports malformed scenario.json later; do not hide that by failing here.
    }
  }
  const text = readImplementationAndConfigFiles(targetDir)
    .map((file) => stripSourceComments(fs.readFileSync(file, "utf8"), file))
    .join("\n");
  return /dut\.agent\.third|dut\.agent\.query\.third|alipay\.dut\.customer\.agreement|submit_param|DUT_AGENT_THIRD_P|mr_dut_third/i.test(text);
}

function shouldRunInvoiceValidator() {
  const scenarioFile = path.join(targetDir, ".alipay-skill", "scenario.json");
  if (fs.existsSync(scenarioFile)) {
    try {
      const scenario = JSON.parse(fs.readFileSync(scenarioFile, "utf8"));
      if (scenario && scenario.invoiceIntegration && scenario.invoiceIntegration.enabled === true) return true;
    } catch (_) {
      // readScenarioFile reports malformed scenario.json later; do not hide that by failing here.
    }
  }
  return hasInvoiceImplementationTraces();
}

function hasInvoiceImplementationTraces() {
  const text = readImplementationAndConfigFiles(targetDir)
    .map((file) => stripSourceComments(fs.readFileSync(file, "utf8"), file))
    .join("\n");
  return /alipay\.ebpp\.invoice\.enterprise(?:exctrl\.employertitle|consume\.enterpriseopenrule|\.newinvoice\.notify|\.invoiceinfo\.(?:query|batchquery))/i.test(text);
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
    checkRuleFactorImplementation(factor, scenario.ruleFactorCapabilities[factor], scenarioText, allText, errors);
  }
  checkEnterpriseRuleFactorLifecycle(scenario, allText, errors);

  if (scenario.businessPriority && scenario.businessPriority.enabled) {
    checkBusinessPriorityScenario(scenario, scenarioText, allText, errors);
  }
  checkBillScenarioIdentifiers(scenario, files, allText, errors);
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
    if (scenario.schemaVersion !== 2) errors.push("scenario.json schemaVersion must be 2 for enterprise runtime rule-factor capabilities");
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
  const expenseSkill = resolveDomainSkillDir("alipay-enterprise-expense-control");
  const interfaceDocsModule = path.join(expenseSkill, "scripts", "lib", "interface-docs.js");
  const files = {
    interfaceIndex: path.join(expenseSkill, "references", "interface-docs.json"),
    interfaceDocsModule,
  };
  for (const [name, file] of Object.entries(files)) {
    if (!fs.existsSync(file)) {
      errors.push(`cannot validate scenario because expense-control ${name} is missing: ${file}`);
      return null;
    }
  }
  const { createInterfaceDocs } = require(interfaceDocsModule);
  const interfaceDocs = createInterfaceDocs(expenseSkill);
  return {
    pairs: parseExpenseTypePairs(interfaceDocs.documentMarkdown("expense-types")),
    constraintText: interfaceDocs.documentMarkdown("expense-type-constraints"),
    factors: parseRuleFactors(interfaceDocs.documentMarkdown("rule-factors")),
    sceneTypes: parseSceneTypes(interfaceDocs.markdown("alipay.ebpp.invoice.institution.create")),
  };
}

function validateScenarioDecision(scenario, facts, errors) {
  for (const key of ["expenseType", "expenseTypeSubCategory", "sceneType"]) {
    if (typeof scenario[key] !== "string" || !scenario[key].trim()) errors.push(`scenario.json ${key} must be a confirmed non-empty string`);
  }
  const pair = `${scenario.expenseType}/${scenario.expenseTypeSubCategory}`;
  if (!facts.pairs.has(pair)) errors.push(`scenario.json contains unsupported expense type/subcategory pair: ${pair}`);
  if (!facts.sceneTypes.has(scenario.sceneType)) errors.push(`scenario.json sceneType=${scenario.sceneType} is not defined by the institution.create official Markdown`);

  if (!Array.isArray(scenario.requiredRuleFactors) || scenario.requiredRuleFactors.length === 0) {
    errors.push("scenario.json requiredRuleFactors must contain the selected mandatory factor(s)");
    scenario.requiredRuleFactors = [];
  }
  if (Object.prototype.hasOwnProperty.call(scenario, "ruleFactorValues")) {
    errors.push("scenario.json must not contain ruleFactorValues; declare each value and its ownership under ruleFactorCapabilities");
  }
  const capabilities = scenario.ruleFactorCapabilities;
  if (!capabilities || Array.isArray(capabilities) || typeof capabilities !== "object") {
    errors.push("scenario.json ruleFactorCapabilities must be an object keyed by required rule factor");
    scenario.ruleFactorCapabilities = {};
  }
  for (const factor of scenario.requiredRuleFactors) {
    if (!facts.factors.has(factor)) errors.push(`scenario.json requiredRuleFactors contains undocumented factor: ${factor}`);
    validateRuleFactorCapability(factor, scenario.ruleFactorCapabilities[factor], errors);
  }

  const constraintRule = parseScenarioConstraint(facts.constraintText, scenario.expenseType, scenario.expenseTypeSubCategory, scenario.constraintVariant, facts.factors);
  if (!constraintRule) {
    errors.push(`official expense-type constraint Markdown has no rule row for ${pair}`);
  } else {
    if (constraintRule.needsVariant && !constraintRule.selected) {
      errors.push(`${pair} has multiple merchant-scope constraint branches; scenario.json constraintVariant must be SPECIFIED_MERCHANT or BROAD_MERCHANT`);
    }
    for (const factor of scenario.requiredRuleFactors) {
      if (constraintRule.allowed.size && !constraintRule.allowed.has(factor)) {
        errors.push(`scenario.json marks ${factor} as required, but the selected ${pair} constraint row does not define it`);
      }
      validateScenarioFixedEvidence(scenario, factor, scenario.ruleFactorCapabilities[factor], constraintRule, errors);
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
    const selected = Array.isArray(scenario.businessPriority.merchantRestrictionFactors)
      ? scenario.businessPriority.merchantRestrictionFactors
      : [];
    if (selected.length === 0) {
      errors.push("businessPriority.enabled requires confirmed merchantRestrictionFactors; detailed factor validity is checked by the expense-control validator");
    }
    validateRuleFactorCapability("ALARM_CLOCK_TIME", scenario.ruleFactorCapabilities.ALARM_CLOCK_TIME, errors);
    if (constraintRule) validateScenarioFixedEvidence("ALARM_CLOCK_TIME", scenario.ruleFactorCapabilities.ALARM_CLOCK_TIME, constraintRule, errors);
    for (const factor of selected) {
      validateRuleFactorCapability(factor, scenario.ruleFactorCapabilities[factor], errors);
      if (constraintRule) validateScenarioFixedEvidence(factor, scenario.ruleFactorCapabilities[factor], constraintRule, errors);
    }
  }
  validateThirdPartyWithholdingScenario(scenario, errors);
  validateInvoiceScenario(scenario, errors);
  validateScenarioFundingSourcePresence(scenario, errors);
}

function validateInvoiceScenario(scenario, errors) {
  const pair = `${scenario.expenseType}/${scenario.expenseTypeSubCategory}`;
  const invoice = scenario.invoiceIntegration;
  const isMetro = pair === "METRO/METRO";

  if (isMetro && (!invoice || Array.isArray(invoice) || typeof invoice !== "object"
      || typeof invoice.enabled !== "boolean")) {
    errors.push("metro scenario.json must record the provider invoice choice as invoiceIntegration.enabled=true or false");
    return;
  }
  if (!invoice) {
    if (hasInvoiceImplementationTraces()) {
      errors.push("invoice implementation exists but scenario.json does not enable invoiceIntegration");
    }
    return;
  }
  if (Array.isArray(invoice) || typeof invoice !== "object" || typeof invoice.enabled !== "boolean") {
    errors.push("scenario.json invoiceIntegration.enabled must be true or false");
    return;
  }
  if (!isMetro) {
    errors.push("non-metro scenario.json must omit invoiceIntegration; this solution Skill only offers invoice integration for METRO/METRO");
    return;
  }

  const selected = scenario.modules && Array.isArray(scenario.modules.invoice)
    ? scenario.modules.invoice
    : [];
  const required = ["enterprise-title", "open-rule", "invoice-message", "single-invoice-query"];
  if (invoice.enabled) {
    for (const module of required) {
      if (!selected.includes(module)) {
        errors.push(`invoiceIntegration.enabled requires scenario.json modules.invoice to include ${module}`);
      }
    }
  } else {
    if (selected.length) errors.push("invoiceIntegration.enabled=false must not select modules.invoice");
    if (hasInvoiceImplementationTraces()) {
      errors.push("invoice implementation exists while scenario.json invoiceIntegration.enabled=false");
    }
  }
}

function validateThirdPartyWithholdingScenario(scenario, errors) {
  const withholding = scenario.thirdPartyWithholding;
  if (!withholding) return;
  if (withholding.enabled !== true) return;
  if (`${scenario.expenseType}/${scenario.expenseTypeSubCategory}` !== "TICKET/TICKET") {
    errors.push("thirdPartyWithholding.enabled is only supported for train-ticket TICKET/TICKET scenarios");
  }
  if (withholding.gateway !== "MAPI") errors.push("thirdPartyWithholding.gateway must be MAPI");
  if (withholding.scenario !== "TRAIN_TICKET") errors.push("thirdPartyWithholding.scenario must be TRAIN_TICKET");
  if (Array.isArray(withholding.modules) && withholding.modules.length) {
    errors.push("thirdPartyWithholding must not select partial modules; enabling it means full agreement + withholding chain");
  }
}

function validateScenarioFundingSourcePresence(scenario, errors) {
  if (!isInternalExpenseControlScenario(scenario)) return;
  const source = scenario.internalFundingSource;
  if (!source || Array.isArray(source) || typeof source !== "object") {
    errors.push("internal expense-control scenario.json must confirm internalFundingSource; detailed funding-source validity is checked by the expense-control validator");
    return;
  }
  if (typeof source.type !== "string" || !source.type.trim() || source.type === "NEEDS_USER_CONFIRM") {
    errors.push("internalFundingSource.type must be confirmed before domain generation");
  }
}

function isInternalExpenseControlScenario(scenario) {
  const mode = String(scenario.expenseControlMode || scenario.feeControlMode || "").toLowerCase();
  if (["internal", "0", "inside"].includes(mode)) return true;
  const values = scalarScenarioValues(scenario.consultMode || scenario.consult_mode);
  return values.includes("0");
}

function validateRuleFactorCapability(factor, capability, errors) {
  if (!capability || Array.isArray(capability) || typeof capability !== "object") {
    errors.push(`scenario.json ruleFactorCapabilities.${factor} must declare the rule value source and validation`);
    return;
  }
  if (!RULE_FACTOR_VALUE_SOURCES.has(capability.valueSource)) {
    errors.push(`scenario.json ruleFactorCapabilities.${factor}.valueSource must be SCENARIO_FIXED or ENTERPRISE_INPUT`);
    return;
  }
  if (!RULE_FACTOR_VALIDATIONS.has(capability.validation)) {
    errors.push(`scenario.json ruleFactorCapabilities.${factor}.validation must reference a documented enum, range, schema, identifier, constraint, or exact match`);
  }
  if (capability.valueSource === "SCENARIO_FIXED") {
    if (!hasConfirmedScenarioValue(capability.value)) {
      errors.push(`scenario.json ruleFactorCapabilities.${factor}.value is required for SCENARIO_FIXED`);
    }
    if (capability.validation !== "EXACT_MATCH") {
      errors.push(`scenario.json ruleFactorCapabilities.${factor}.validation must be EXACT_MATCH for SCENARIO_FIXED`);
    }
  } else if (Object.prototype.hasOwnProperty.call(capability, "value")) {
    errors.push(`scenario.json ruleFactorCapabilities.${factor}.value is only allowed for SCENARIO_FIXED`);
  }
}

function validateScenarioFixedEvidence(scenario, factor, capability, constraintRule, errors) {
  if (!capability || capability.valueSource !== "SCENARIO_FIXED" || !hasConfirmedScenarioValue(capability.value)) return;
  const expected = normalizeDocumentEvidence(JSON.stringify(capability.value));
  const knownValue = SCENARIO_FIXED_RULE_VALUES.get(`${scenario.expenseType}/${scenario.expenseTypeSubCategory}:${factor}`);
  if (knownValue && expected === normalizeDocumentEvidence(JSON.stringify(knownValue))) return;
  const documented = normalizeDocumentEvidence(constraintRule.rowText || "");
  if (!expected || !documented.includes(expected)) {
    errors.push(`scenario.json ruleFactorCapabilities.${factor}.value is not an exact fixed value documented for the selected scenario`);
  }
}

function normalizeDocumentEvidence(value) {
  return String(value).replace(/[\\`\s]/g, "");
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
  if (!values.size) throw new Error("institution.create official Markdown has no scene_type enum values");
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
    allOf,
    anyOf,
    rowText,
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

function checkRuleFactorImplementation(factor, capability, scopeText, allText, errors) {
  if (capability && capability.valueSource === "SCENARIO_FIXED") {
    checkFixedRuleFactorMapping(factor, capability.value, scopeText, allText, errors);
    return;
  }
  checkEnterpriseRuleFactorMapping(factor, scopeText, allText, errors);
}

function checkFixedRuleFactorMapping(factor, value, scopeText, allText, errors) {
  const values = scalarScenarioValues(value);
  if (!values.length || !values.every((item) => hasFactorValueBinding(scopeText, allText, factor, item))) {
    errors.push(`SCENARIO_FIXED rule_factor=${factor} must bind its documented exact value in institution create/modify code`);
  }
  if (hasDynamicFixedRuleValueWrite(scopeText, allText, values)) {
    errors.push(`SCENARIO_FIXED rule_factor=${factor} exposes a dynamic rule_value write path; every create/modify/controller path must force the documented exact value and reject enterprise override`);
  }
}

function hasDynamicFixedRuleValueWrite(scopeText, allText, values) {
  for (const match of scopeText.matchAll(/\.setRuleValue\s*\(\s*([A-Za-z_$][\w$]*)\s*\)/g)) {
    const argument = match[1];
    const resolvedAsFixed = values.some((value) => valueTokens(allText, value).includes(argument));
    if (!resolvedAsFixed) return true;
  }
  for (const match of scopeText.matchAll(/["']rule_value["']\s*:\s*([A-Za-z_$][\w$]*)/g)) {
    const argument = match[1];
    const resolvedAsFixed = values.some((value) => valueTokens(allText, value).includes(argument));
    if (!resolvedAsFixed) return true;
  }
  return false;
}

function hasFactorValueBinding(scopeText, allText, factor, value) {
  for (const factorToken of valueTokens(allText, factor)) {
    for (const valueToken of valueTokens(allText, value)) {
      if (hasNearbyTokenUsage(scopeText, factorToken, factor, valueToken, value, 1200)) return true;
    }
  }
  return false;
}

function checkEnterpriseRuleFactorMapping(factor, scopeText, allText, errors) {
  const factorTokens = valueTokens(allText, factor);
  const dynamicValue = /(?:["']rule_value["']|\bruleValue\b|\.setRuleValue)\s*(?::|=|\()\s*(?!["'\[{]|-?\d+(?:\.\d+)?\b)([A-Za-z_$][\w$]*)(?:\s*(?:\.|\[|\())?/;
  const hardcodedValue = /(?:["']rule_value["']|\bruleValue\b|\.setRuleValue)\s*(?::|=|\()\s*(?:["']|\[(?:\s*["']|\s*\d)|\{\s*["']|\d)/;
  let mapped = false;
  let hardcoded = false;
  for (const token of factorTokens) {
    const usage = tokenUsagePattern(token, factor);
    for (const match of scopeText.matchAll(new RegExp(usage, "g"))) {
      const window = scopeText.slice(Math.max(0, match.index - 500), match.index + match[0].length + 1200);
      const dynamicMatch = dynamicValue.exec(window);
      if (dynamicMatch) {
        const valueToken = dynamicMatch[1];
        const constantLiteral = /^[A-Z][A-Z0-9_]*$/.test(valueToken)
          && new RegExp(`\\b${escapeRegExp(valueToken)}\\b\\s*=\\s*(?:["'\\[{]|-?\\d)`).test(allText);
        if (constantLiteral) hardcoded = true;
        else mapped = true;
      }
      if (hardcodedValue.test(window)) hardcoded = true;
    }
  }
  if (!mapped) {
    errors.push(`required rule_factor=${factor} must map validated enterprise runtime configuration to rule_value`);
  }
  if (hardcoded && !mapped) {
    errors.push(`required rule_factor=${factor} must not use an undocumented provider-level hardcoded rule_value`);
  }
}

function checkEnterpriseRuleFactorLifecycle(scenario, allText, errors) {
  const factors = Array.from(new Set([
    ...scenario.requiredRuleFactors,
    ...((scenario.businessPriority && scenario.businessPriority.enabled)
      ? ["ALARM_CLOCK_TIME", ...(scenario.businessPriority.merchantRestrictionFactors || [])]
      : []),
  ])).filter((factor) => {
    const capability = scenario.ruleFactorCapabilities && scenario.ruleFactorCapabilities[factor];
    return capability && capability.valueSource === "ENTERPRISE_INPUT";
  });
  if (factors.length && !/(?:enterprise|tenant|company|corp)[_A-Za-z0-9]*(?:id|no)|(?:enterprise|tenant|company|corp)\s*(?:Id|No)/i.test(allText)) {
    errors.push("rule-factor configuration must be scoped and persisted by enterprise/tenant identifier");
  }
  if (factors.length && !/(?:save|persist|upsert|insert|update|repository|dao|store)[A-Za-z0-9_]*(?:rule|factor|config)|(?:rule|factor|config)[A-Za-z0-9_]*(?:save|persist|upsert|repository|dao|store)/i.test(allText)) {
    errors.push("rule-factor configuration must provide enterprise-scoped persistence instead of provider-level constants");
  }
  for (const factor of factors) {
    const factorPattern = escapeRegExp(factor);
    const validatorPattern = "(?:validate|validator|check|allowed|constraint|schema|enum|range|format)";
    const nearValidation = new RegExp(`(?:${factorPattern})[\\s\\S]{0,1600}${validatorPattern}|${validatorPattern}[\\s\\S]{0,1600}(?:${factorPattern})`, "i").test(allText);
    if (!nearValidation) {
      errors.push(`rule_factor=${factor} must validate enterprise input against its documented constraints before the Alipay call`);
    }
  }
}

function checkBusinessPriorityScenario(scenario, scopeText, allText, errors) {
  const selected = Array.isArray(scenario.businessPriority.merchantRestrictionFactors)
    ? scenario.businessPriority.merchantRestrictionFactors
    : [];
  const implemented = selected.filter((factor) =>
    hasFieldValue(scopeText, allText, ["rule_factor", "ruleFactor", "RuleFactor"], ["setRuleFactor"], factor));
  for (const factor of selected) {
    if (!implemented.includes(factor)) {
      errors.push(`businessPriority factor ${factor} is not implemented in institution create/modify code`);
      continue;
    }
    checkRuleFactorImplementation(factor, scenario.ruleFactorCapabilities[factor], scopeText, allText, errors);
  }
  if (hasFieldValue(scopeText, allText, ["rule_factor", "ruleFactor", "RuleFactor"], ["setRuleFactor"], "ALARM_CLOCK_TIME")) {
    checkRuleFactorImplementation("ALARM_CLOCK_TIME", scenario.ruleFactorCapabilities.ALARM_CLOCK_TIME, scopeText, allText, errors);
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
    sceneCode: [["scene_code", "sceneCode", "SceneCode", "expenseSceneCode", "ExpenseSceneCode"], ["setSceneCode", "setExpenseSceneCode"]],
    orderType: [["order_type", "orderType", "OrderType"], ["setOrderType"]],
  };
  for (const [key, value] of Object.entries(scenario.billIdentifiers)) {
    if (!fieldMap[key] || !hasConfirmedScenarioValue(value)) continue;
    const [fields, setters] = fieldMap[key];
    if (!hasFieldValue(billText, allText, fields, setters, String(value))) {
      errors.push(`bill implementation does not use confirmed billIdentifiers.${key}=${value}`);
    } else if ((key === "sceneCode" || key === "orderType")
        && !hasOperationalBillIdentifierUse(files, fields, String(value), allText)) {
      errors.push(`bill implementation only logs or declares billIdentifiers.${key}=${value}; confirmed bill identifiers must affect routing, filtering, failure, or business handling`);
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

function hasOperationalBillIdentifierUse(files, fields, value, allText) {
  for (const file of files) {
    if (isTestOrGeneratedDocFile(file)) continue;
    const text = stripSourceComments(fs.readFileSync(file, "utf8"), file);
    for (const token of valueTokens(allText, value)) {
      const tokenPattern = tokenUsagePattern(token, value);
      for (const field of fields) {
        if (hasOperationalIdentifierLine(text, field, token)) return true;
        const getter = field === field.toUpperCase()
          ? escapeRegExp(field)
          : `(?:${escapeRegExp(field)}|get${escapeRegExp(field[0].toUpperCase() + field.slice(1))}\\s*\\(\\))`;
        if (hasOperationalIdentifierPredicate(text, getter, tokenPattern)) return true;
        const conditionPattern = new RegExp(`if\\s*\\((?=[^)]*(?:${getter}))(?=[^)]*${tokenPattern})[^)]*\\)\\s*\\{([\\s\\S]{0,500}?)\\}`, "g");
        for (const match of text.matchAll(conditionPattern)) {
          if (isOperationalIdentifierBranch(match[1])) return true;
        }
        const pythonConditionPattern = new RegExp(`if\\s+(?=[^:\\n]*(?:${getter}))(?=[^:\\n]*${tokenPattern})[^:\\n]*:\\s*\\n([\\s\\S]{0,300})`, "g");
        for (const match of text.matchAll(pythonConditionPattern)) {
          if (isOperationalIdentifierBranch(match[1])) return true;
        }
      }
    }
  }
  return false;
}

function hasOperationalIdentifierPredicate(text, getterPattern, tokenPattern) {
  // A matcher can be expressed as a compact return/if statement whose
  // parameter is not a bean getter (e.g. ORDER_TYPE_METRO.equals(orderType)).
  // Recognize that form before relying on the method-body shape parser.
  const directPredicate = new RegExp(
    `(?:(?:${getterPattern})[\\s\\S]{0,180}${tokenPattern}|${tokenPattern}[\\s\\S]{0,180}(?:${getterPattern}))`
      + `[\\s\\S]{0,180}(?:return|if\\s*\\(|&&|\\|\\||throw\\s+new)`, "s");
  if (directPredicate.test(text)) return true;

  const methodPattern = /(?:public|protected|private)?\s*(?:boolean|Boolean|bool|def)?\s*([A-Za-z_$][\w$]*)\s*\([^)]*\)\s*\{([\s\S]{0,900}?)\n\s*\}/g;
  for (const match of text.matchAll(methodPattern)) {
    const methodName = match[1];
    const body = match[2];
    if (!/^(?:matches?|supports?|filters?|routes?|identif(?:y|ies)|is|should|accepts?)/i.test(methodName)) continue;
    // Identifiers may be method parameters (for example orderType), not only
    // bean getters.  The caller supplies both spellings in getterPattern.
    const comparesIdentifier = new RegExp(`(?=.*(?:${getterPattern}))(?=.*${tokenPattern})(?:return|&&|\\|\\||==|equals\\s*\\()`, "s").test(body);
    if (comparesIdentifier) return true;
  }
  const pythonMethodPattern = /def\s+([A-Za-z_$][\w$]*)\s*\([^)]*\)\s*:\s*\n([\s\S]{0,500}?)(?=\n\S|\n\s*def\s+|\s*$)/g;
  for (const match of text.matchAll(pythonMethodPattern)) {
    const methodName = match[1];
    const body = match[2];
    if (!/^(?:matches?|supports?|filters?|routes?|identif(?:y|ies)|is|should|accepts?)/i.test(methodName)) continue;
    const comparesIdentifier = new RegExp(`(?=.*(?:${getterPattern}))(?=.*${tokenPattern})(?:return|and|or|==)`, "s").test(body);
    if (comparesIdentifier) return true;
  }
  return false;
}

function hasOperationalIdentifierLine(text, field, token) {
  const lines = text.split(/\r?\n/);
  const fieldNeedles = Array.from(new Set([
    field,
    field.replace(/_([a-z])/g, (_, ch) => ch.toUpperCase()),
    `get${field.replace(/(?:^|_)([a-z])/g, (_, ch) => ch.toUpperCase())}`,
  ])).filter(Boolean);
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    if (!/\bif\b/.test(line)) continue;
    if (!fieldNeedles.some((needle) => line.includes(needle))) continue;
    if (!line.includes(token)) continue;
    const inlineBody = line.includes("{") ? line.slice(line.indexOf("{") + 1) : "";
    const body = [inlineBody, ...lines.slice(i + 1, i + 8)].join("\n");
    if (isOperationalIdentifierBranch(body)) return true;
  }
  return false;
}

function isOperationalIdentifierBranch(body) {
  const withoutLogs = body
    .replace(/\b(?:log|logger)\.\w+\s*\([^;]*\)\s*;/g, "")
    .replace(/\bSystem\.out\.println\s*\([^;]*\)\s*;/g, "");
  return /\breturn\s*(?:;|(?:true|True|false|False|fail|null|None)\b)|throw\s+new\b|\braise\b|\bcontinue\s*;|\bbreak\s*;|\bmarkFailed\s*\(|\bprocessNotification\s*\(|\bhandle\s*\(/.test(withoutLogs);
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
  if (hasScenarioValueComparison(scopeText, allText, fieldNames, value)) return true;
  return false;
}

function hasScenarioValueComparison(scopeText, allText, fieldNames, value) {
  const fieldRefs = fieldNames
    .map((field) => String(field))
    .filter(Boolean)
    .flatMap((field) => field === field.toUpperCase()
      ? [`\\b${escapeRegExp(field)}\\b`]
      : [
        `(?:\\b[A-Za-z_$][A-Za-z0-9_$]*\\.)?\\b${escapeRegExp(field)}\\b`,
        `(?:\\b[A-Za-z_$][A-Za-z0-9_$]*\\.)?\\b${escapeRegExp(getterNameForField(field))}\\s*\\(\\)`,
      ])
    .join("|");
  if (!fieldRefs) return false;
  const fieldPattern = `(?:${fieldRefs})`;
  for (const token of valueTokens(allText, value)) {
    const tokenPattern = tokenUsagePattern(token, value);
    if (new RegExp(`${tokenPattern}\\s*\\.\\s*equals\\s*\\(\\s*${fieldPattern}\\s*\\)`).test(scopeText)) return true;
    if (new RegExp(`${fieldPattern}\\s*\\.\\s*equals\\s*\\(\\s*${tokenPattern}\\s*\\)`).test(scopeText)) return true;
    if (new RegExp(`${fieldPattern}\\s*(?:==|===)\\s*${tokenPattern}|${tokenPattern}\\s*(?:==|===)\\s*${fieldPattern}`).test(scopeText)) return true;
  }
  return false;
}

function getterNameForField(field) {
  const camel = String(field).replace(/_([a-z])/g, (_, ch) => ch.toUpperCase());
  return `get${camel[0].toUpperCase()}${camel.slice(1)}`;
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
  if (!ALIPAY_SDK_VERSION_PATTERN.test(sdkVersion)) {
    errors.push(`pom.xml uses invalid alipay-sdk-java version ${sdkVersion}; SDK preflight must extract a version matching x.y.z.ALL from pkg:maven/com.alipay.sdk/alipay-sdk-java@<version> or the Maven dependency snippet, not an arbitrary page asset version`);
    return;
  }
  checkSdkVersionSource(sdkVersion, errors);
  checkForbiddenSdkVersionEvidence(errors);

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

function checkForbiddenSdkVersionEvidence(errors) {
  const files = walk(targetDir).filter((file) => {
    const base = path.basename(file).toLowerCase();
    return /(?:readme|report|summary|sdk|codegen|generation).*\.md$/.test(base)
      || base === "pom.xml"
      || base === "build.gradle"
      || base === "build.gradle.kts";
  });
  const forbidden = /search\.maven\.org|solrsearch|latestVersion|maven-metadata\.xml|repo1\.maven\.org|repo\.maven\.apache\.org/i;
  const central = /central\.sonatype\.com\/artifact\/com\.alipay\.sdk\/alipay-sdk-java|pkg:maven\/com\.alipay\.sdk\/alipay-sdk-java@|<artifactId>\s*alipay-sdk-java\s*<\/artifactId>[\s\S]{0,400}<version>\s*[0-9]+\.[0-9]+\.[0-9]+\.ALL\s*<\/version>/i;
  for (const file of files) {
    const text = fs.readFileSync(file, "utf8");
    if (!/alipay-sdk-java|com\.alipay\.sdk/i.test(text)) continue;
    if (forbidden.test(text)) {
      errors.push(`${rel(file)} records search.maven.org, maven-metadata.xml, latestVersion, or Maven repository metadata as an SDK version source; Java/Maven SDK preflight must use Central Portal only and must not describe non-Central results as the Central Portal current version`);
    }
    if (/\bCentral Portal\b|Central Portal 当前版本|当前版本/i.test(text)) {
      const nearby = text.match(/(?:Central Portal|当前版本)[\s\S]{0,1200}/i);
      if (nearby && /alipay-sdk-java|com\.alipay\.sdk/i.test(nearby[0]) && !central.test(nearby[0])) {
        errors.push(`${rel(file)} mentions a Central Portal SDK version without the required Central Portal evidence snippet; include pkg:maven/com.alipay.sdk/alipay-sdk-java@<version> or the Maven dependency snippet, not a substituted Maven index result`);
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
  const javaFiles = javaFilesExcludingTests();
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
  for (const file of javaFilesExcludingTests()) {
    const text = stripJavaComments(fs.readFileSync(file, "utf8"));
    if (!/AlipayMsgClient/.test(text) || !/\.connect\s*\(/.test(text)) continue;
    for (const method of javaMethods(text)) {
      if (!/\.connect\s*\(/.test(method.body)) continue;
      const catches = directCatchBodiesForTryContaining(method.body, /\.connect\s*\(/);
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

function directCatchBodiesForTryContaining(body, callPattern) {
  const result = [];
  for (const match of body.matchAll(/\btry\b/g)) {
    let cursor = match.index + match[0].length;
    while (/\s/.test(body[cursor] || "")) cursor += 1;
    if (body[cursor] === "(") {
      const resourcesClose = findMatchingDelimiter(body, cursor, "(", ")");
      if (resourcesClose < 0) continue;
      cursor = resourcesClose + 1;
      while (/\s/.test(body[cursor] || "")) cursor += 1;
    }
    if (body[cursor] !== "{") continue;
    const tryClose = findMatchingDelimiter(body, cursor, "{", "}");
    if (tryClose < 0 || !callPattern.test(body.slice(cursor + 1, tryClose))) continue;

    cursor = tryClose + 1;
    while (cursor < body.length) {
      while (/\s/.test(body[cursor] || "")) cursor += 1;
      const catchMatch = body.slice(cursor).match(/^catch\s*\([^)]*\)\s*\{/);
      if (!catchMatch) break;
      const catchOpen = cursor + catchMatch[0].length - 1;
      const catchClose = findMatchingDelimiter(body, catchOpen, "{", "}");
      if (catchClose < 0) break;
      result.push(body.slice(catchOpen + 1, catchClose));
      cursor = catchClose + 1;
    }
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

  const configText = walk(targetDir)
    .filter((file) => /(?:application[^/\\]*\.(?:ya?ml|properties)|\.env)$/i.test(file))
    .map((file) => fs.readFileSync(file, "utf8"))
    .join("\n");
  if (/(?:connector\s*:\s*[^\n]*|alipay\.msg(?:[-.]connector)?\s*=\s*[^\n]*)openapi\.alipay\.com/i.test(configText)) {
    errors.push("AlipayMsgClient connector uses openapi.alipay.com; the official production WebSocket host is openchannel.alipay.com, while openapi.alipay.com is the OpenAPI gateway");
  }

}

function checkProductionCredentialDefaults(errors) {
  const credentialKey = /(?:app[-_.]?id|private[-_.]?key|alipay[-_.]?public[-_.]?key)/i;
  const placeholder = /(?:placeholder|replace(?:[-_ ]?with)?|writable|dummy|example|sample|change[-_ ]?me|your[-_]|todo|xxx)/i;
  for (const file of walk(targetDir).filter((item) => isProductionApplicationConfig(item))) {
    const text = fs.readFileSync(file, "utf8");
    for (const line of text.split(/\r?\n/)) {
      if (!credentialKey.test(line)) continue;
      const envDefault = line.match(/\$\{[^}:]+:([^}]*)\}/);
      const directValue = line.match(/^[^#\n:=]+\s*[:=]\s*([^#\n]+)$/);
      const value = (envDefault ? envDefault[1] : directValue ? directValue[1] : "").trim().replace(/^['"]|['"]$/g, "");
      if (value && placeholder.test(value)) {
        errors.push(`${rel(file)}: production Alipay credential has a startup-capable placeholder default (${value}); remove the default and keep dummy credentials in test-only configuration so missing credentials fail before client creation`);
      }
    }
  }
}

function isProductionApplicationConfig(file) {
  const normalized = file.split(path.sep).join("/");
  if (!/(?:^|\/)src\/main\/resources\//.test(normalized) && path.dirname(file) !== targetDir) return false;
  const name = path.basename(file);
  if (!/^application(?:-[^.]+)?\.(?:ya?ml|properties)$/i.test(name) && name !== ".env") return false;
  return !/^application-(?:test|local|demo)\./i.test(name);
}

function checkManagementControllerTenantBinding(errors) {
  const files = productionJavaFiles();
  for (const file of files) {
    const text = stripJavaComments(fs.readFileSync(file, "utf8"));
    if (!/@RestController\b/.test(text)) continue;
    if (!/(?:Institution|Expense|制度|费控)/i.test(`${path.basename(file)}\n${text}`)) continue;
    if (!/\benterpriseId\b|\btenantId\b|企业/.test(text)) continue;
    const bindsAuthenticatedTenant = /\b(?:authorize|assert|verify|check|require|validate|ensure)[A-Za-z0-9_]*(?:Tenant|Enterprise|Access)[A-Za-z0-9_]*\s*\(/.test(text)
      || /@(?:PreAuthorize|Secured|RolesAllowed)\s*\([^)]*(?:enterprise|tenant)/i.test(text)
      || /@[A-Za-z_$][\w$]*(?:Tenant|Enterprise)(?:Bound|Authorized|Scoped|Access)\b/.test(text);
    if (!bindsAuthenticatedTenant) {
      errors.push(`${rel(file)}: production institution/expense Controller accepts enterprise identity without binding it to an authenticated principal or tenant context; derive the enterprise from trusted identity and authorize any requested enterpriseId, or keep the Controller in a demo-only profile`);
    }
  }
}

function checkAlternativeQueryRoutes(errors) {
  for (const file of productionJavaFiles()) {
    const text = stripJavaComments(fs.readFileSync(file, "utf8"));
    if (!/@RestController\b/.test(text) || !/outerSourceId|outer_source_id/.test(text)) continue;
    for (const match of text.matchAll(/@GetMapping\s*\(\s*["']([^"']*\{([A-Za-z_$][\w$]*)\}[^"']*)["']\s*\)/g)) {
      const nextMapping = text.slice(match.index + match[0].length).search(/\n\s*@(?:Get|Post|Put|Patch|Delete|Request)Mapping\b/);
      const methodRegion = text.slice(match.index, nextMapping < 0 ? undefined : match.index + match[0].length + nextMapping);
      if (!/outerSourceId|outer_source_id/.test(methodRegion)) continue;
      errors.push(`${rel(file)}: query claims outerSourceId as an alternative key but mapping ${match[1]} still requires path variable ${match[2]}; expose a route where institutionId and outerSourceId are both reachable alternatives, such as optional query parameters`);
    }
  }
}

function checkSpringContextMessageIsolation(errors) {
  const mainFiles = productionJavaFiles();
  const hasMessageRunner = mainFiles.some((file) => {
    const text = stripJavaComments(fs.readFileSync(file, "utf8"));
    return /AlipayMsgClient\b/.test(text)
      && /\.connect\s*\(/.test(text);
  });
  if (!hasMessageRunner) return;

  const testProfileConfigs = new Map();
  const defaultTestConfig = walk(targetDir)
    .filter((item) => /(?:^|[\\/])src[\\/]test[\\/]resources[\\/]application\.(?:ya?ml|properties)$/i.test(item))
    .map((item) => fs.readFileSync(item, "utf8"))
    .join("\n");
  const disablesByDefaultTestConfig = configDisablesAlipayMessage(defaultTestConfig);
  for (const file of walk(targetDir).filter((item) => /(?:^|[\\/])src[\\/]test[\\/]resources[\\/]application-([^.]+)\.(?:ya?ml|properties)$/i.test(item))) {
    const profile = path.basename(file).match(/^application-([^.]+)\./i)[1];
    testProfileConfigs.set(profile, fs.readFileSync(file, "utf8"));
  }
  for (const file of walk(targetDir).filter((item) => /(?:^|[\\/])src[\\/]test[\\/]java[\\/].*\.java$/.test(item))) {
    const text = stripJavaComments(fs.readFileSync(file, "utf8"));
    if (!/@SpringBootTest\b/.test(text)) continue;
    const disablesInline = /alipay\.msg\.enabled\s*=\s*false/.test(text);
    const mocksConnection = /@MockBean[\s\S]{0,160}\b(?:AlipayMsgClient|AlipayMsgConnectionRunner)\b/.test(text);
    const activeProfiles = Array.from(text.matchAll(/@ActiveProfiles\s*\(\s*(?:profiles\s*=\s*)?(?:\{\s*)?["']([^"']+)["']/g)).map((match) => match[1]);
    const disablesByProfile = activeProfiles.some((profile) => configDisablesAlipayMessage(testProfileConfigs.get(profile) || ""));
    if (!disablesInline && !mocksConnection && !disablesByDefaultTestConfig && !disablesByProfile) {
      errors.push(`${rel(file)}: @SpringBootTest loads a default-enabled AlipayMsgClient connection runner without disabling or mocking it; keep context tests offline with alipay.msg.enabled=false (or a test profile/mock) so dummy credentials never start network retry threads`);
    }
  }
}

function checkMessageLifecycleContracts(errors) {
  const sources = productionJavaFiles().map((file) => ({
    file,
    text: stripJavaComments(fs.readFileSync(file, "utf8")),
  }));
  const projectText = sources.map((source) => source.text).join("\n");
  const hasOfficialWebSocket = /AlipayMsgClient\b/.test(projectText)
    && /\bMsgHandler\b/.test(projectText)
    && /\.setMessageHandler\s*\(/.test(projectText);
  if (!hasOfficialWebSocket) return;

  const productionConfig = walk(targetDir)
    .filter((file) => isProductionApplicationConfig(file))
    .map((file) => fs.readFileSync(file, "utf8"))
    .join("\n");
  if (configDisablesAlipayMessage(productionConfig)
      || /alipay\.msg\.enabled\s*[=:]\s*\$\{[^}:]+:false\}/i.test(productionConfig)
      || /enabled\s*:\s*\$\{[^}:]+:false\}/i.test(productionConfig)) {
    errors.push("selected WebSocket notification channel is disabled by default in production configuration; required EC/bill push handlers would be silently inactive. Enable it by default or require an explicit startup value, while test-only configuration may set alipay.msg.enabled=false");
  }

  const clientOwners = sources.filter((source) => /AlipayMsgClient\.getInstance\s*\(|@Bean[\s\S]{0,240}\bAlipayMsgClient\b/.test(source.text));
  const hasEnabledConditional = sources.some((source) => hasMessageEnabledConditional(source.text));
  if (hasEnabledConditional) {
    for (const owner of clientOwners) {
      if (!hasMessageEnabledConditional(owner.text)) {
        errors.push(`${rel(owner.file)}: alipay.msg.enabled controls the connection runner but not the AlipayMsgClient owner; apply the same condition to client creation so disabled/test contexts do not create or destroy an unconnected SDK singleton`);
      }
    }
  }

  const retrySources = sources.filter((source) => /\.connect\s*\(/.test(source.text)
    && /(?:retry|reconnect|backoff|schedule)/i.test(source.text));
  if (retrySources.length) {
    const failsFast = retrySources.some((source) => /catch\s*\([^)]*\)\s*\{[^}]*\bthrow\b/s.test(source.text));
    const hasStateHealthIndicator = /\b(?:HealthIndicator|ReactiveHealthIndicator)\b/.test(projectText)
      && /\bhealth\s*\([^)]*\)\s*\{[\s\S]{0,800}(?:isConnected|getStatus|connected)/.test(projectText);
    const hasLiveConnectionHealth = hasLiveAlipayMessageHealth(sources);
    const readinessGroupIncludesHealth = /management\.endpoint\.health\.group\.readiness\.include\s*[=:][^\n]*(?:alipay|message|msg)/i.test(productionConfig)
      || /readiness\s*:\s*\n(?:[ \t]+[^\n]*\n)*?[ \t]+include\s*:\s*[^\n]*(?:alipay|message|msg)/i.test(productionConfig);
    if (!failsFast && (!hasStateHealthIndicator || !readinessGroupIncludesHealth)) {
      errors.push("AlipayMsgClient starts with background retry but readiness relies only on availability events or a plain state bean; Spring Boot startup may overwrite REFUSING_TRAFFIC. Add a connection-state HealthIndicator/ReactiveHealthIndicator to the readiness group, or make the initial connection fail fast");
    }
    if (!failsFast && hasStateHealthIndicator && !hasLiveConnectionHealth) {
      errors.push("AlipayMsgClient readiness health is updated only around the initial connect attempt and can remain UP after a later disconnect; derive health from AlipayMsgClient.isConnected() or continuously synchronize the actual SDK connection state");
    }
    if (!failsFast && readinessGroupIncludesHealth && !readinessGroupIncludesReadinessState(productionConfig)) {
      errors.push("Spring Boot readiness group includes the Alipay message indicator but omits readinessState; include both readinessState and the message indicator so custom health does not replace the framework readiness signal");
    }
  }

  for (const source of retrySources) {
    if (!/Executors\.new|ScheduledExecutorService|ExecutorService/.test(source.text)) continue;
    const hasShutdownLifecycle = /@PreDestroy\b|\b(?:DisposableBean|SmartLifecycle)\b|@Bean\s*\([^)]*destroyMethod/.test(source.text)
      && /\.shutdown(?:Now)?\s*\(/.test(source.text);
    if (!hasShutdownLifecycle) {
      errors.push(`${rel(source.file)}: message reconnect executor has no explicit shutdown lifecycle; add @PreDestroy/DisposableBean/SmartLifecycle and cancel or shutdown the scheduler so reload and application shutdown cannot leave retry tasks running`);
    }
  }
}

function hasLiveAlipayMessageHealth(sources) {
  const healthSources = sources.filter((source) => /\b(?:HealthIndicator|ReactiveHealthIndicator)\b/.test(source.text)
    && /\bhealth\s*\(/.test(source.text));
  const directSdkHealth = healthSources.some((source) => {
    const method = source.text.match(/\bhealth\s*\([^)]*\)\s*\{([\s\S]{0,1000})\}/);
    return method && callsSdkIsConnected(source.text, method[1]);
  });
  if (directSdkHealth) return true;

  const sdkBackedState = sources.some((source) => {
    const method = source.text.match(/\b(?:boolean|Boolean)\s+isConnected\s*\([^)]*\)\s*\{([\s\S]{0,500})\}/);
    return method && callsSdkIsConnected(source.text, method[1]);
  });
  if (sdkBackedState && healthSources.some((source) => /\.isConnected\s*\(\s*\)/.test(source.text))) return true;

  return sources.some((source) => callsSdkIsConnected(source.text, source.text)
    && /schedule(?:AtFixedRate|WithFixedDelay)\s*\(/.test(source.text)
    && /(?:mark|set)[A-Za-z0-9_$]*(?:Connected|Connection|Health|Status)\s*\(/.test(source.text));
}

function callsSdkIsConnected(declarations, body) {
  const clientNames = Array.from(declarations.matchAll(/\bAlipayMsgClient\s+([A-Za-z_$][\w$]*)/g), (match) => match[1]);
  return clientNames.some((name) => new RegExp(`\\b${name}\\s*\\.\\s*isConnected\\s*\\(\\s*\\)`).test(body));
}

function readinessGroupIncludesReadinessState(config) {
  return /management\.endpoint\.health\.group\.readiness\.include\s*[=:][^\n]*\breadinessState\b/i.test(config)
    || /readiness\s*:\s*\n(?:[ \t]+[^\n]*\n)*?[ \t]+include\s*:\s*[^\n]*\breadinessState\b/i.test(config);
}

function hasMessageEnabledConditional(text) {
  return /@ConditionalOnProperty\s*\([\s\S]{0,320}?(?:prefix\s*=\s*["']alipay\.msg["'][\s\S]{0,160}?name\s*=\s*["']enabled["']|name\s*=\s*["']alipay\.msg\.enabled["'])/.test(text);
}

function configDisablesAlipayMessage(text) {
  if (/(?:^|\n)\s*alipay\.msg\.enabled\s*[=:]\s*false\b/.test(text)) return true;
  return /(?:^|\n)\s*alipay\s*:\s*\n(?:[ \t]+[^\n]*\n)*?[ \t]+msg\s*:\s*\n(?:[ \t]+[^\n]*\n)*?[ \t]+enabled\s*:\s*false\b/.test(text);
}

function productionJavaFiles() {
  return walk(targetDir).filter((file) => /(?:^|[\\/])src[\\/]main[\\/]java[\\/].*\.java$/.test(file));
}

function javaFilesExcludingTests() {
  return walk(targetDir).filter((file) => file.endsWith(".java")
    && !/(?:^|[\\/])src[\\/]test[\\/]java[\\/]/.test(file));
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
    errors.push("unable to verify latest alipay-sdk-java version from Central Portal; extract only pkg:maven/com.alipay.sdk/alipay-sdk-java@<version> or the Maven dependency snippet, and require x.y.z.ALL format. Run `curl -sL \"https://central.sonatype.com/artifact/com.alipay.sdk/alipay-sdk-java\"` with approval or provide the Central Portal current version before generating Java/Maven code");
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
