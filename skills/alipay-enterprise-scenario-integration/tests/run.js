#!/usr/bin/env node
"use strict";

const assert = require("assert");
const crypto = require("crypto");
const fs = require("fs");
const os = require("os");
const path = require("path");
const { spawnSync } = require("child_process");

const skillDir = path.resolve(__dirname, "..");
const scriptsDir = path.join(skillDir, "scripts");
const validator = path.join(scriptsDir, "validate_codegen.js");
const runtime = require(path.join(scriptsDir, "lib", "validator-runtime.js"));
const runtimePath = path.join(scriptsDir, "lib", "validator-runtime.js");
const resolver = require(path.join(scriptsDir, "lib", "value-resolver.js"));
const javaProjectGates = require(path.join(scriptsDir, "lib", "java-project-gates.js"));

testRuntime();
testMissingSupportIsBroken();
testValueResolver();
require("./java-project-gates.test").run(javaProjectGates);
testFixtures();
testScenarioDecisionGates();
testBillSceneIdentification();
testIfElseRouterGates();
testMessageClientStartupFailurePolicy();
testIntegrationContract();
testSubskillInstaller();
testSubskillBootstrapOrdering();
testSubskillsInSync();
testSyncRejectsUnknownArgs();
testSyncBuildIsAtomicOnFailure();
testSyncBuildIsTransactional();
testSyncCorruptZipLeavesNoResidue();
testSyncCommitRollbackOnReplaceFailure();
console.log("[alipay-enterprise-scenario-integration tests] OK");

function testSubskillInstaller() {
  const skillsRoot = fs.mkdtempSync(path.join(os.tmpdir(), "alipay-subskill-install-"));
  const installer = path.join(skillDir, "tools", "install_subskills.js");
  const first = runNode([installer, "--skills-root", skillsRoot]);
  assert.strictEqual(first.status, 0, output(first));
  for (const domain of ["alipay-enterprise-ec", "alipay-enterprise-expense-control", "alipay-enterprise-bill"]) {
    assert.ok(fs.existsSync(path.join(skillsRoot, domain, "SKILL.md")), `${domain} must be installed beside the solution skill`);
    assert.ok(fs.existsSync(path.join(skillsRoot, domain, "scripts", "validate_codegen.js")), `${domain} validator must be installed`);
  }
  const check = runNode([installer, "--check", "--skills-root", skillsRoot]);
  assert.strictEqual(check.status, 0, output(check));
  const second = runNode([installer, "--skills-root", skillsRoot]);
  assert.strictEqual(second.status, 0, output(second));
  assert.match(output(second), /already installed/);
}

function testSubskillBootstrapOrdering() {
  const skillText = fs.readFileSync(path.join(skillDir, "SKILL.md"), "utf8");
  const installIndex = skillText.indexOf("node alipay-enterprise-scenario-integration/tools/install_subskills.js");
  const sceneGateIndex = skillText.indexOf("## 场景闸门");
  const executionIndex = skillText.indexOf("## 执行阶段");
  assert.ok(installIndex >= 0, "SKILL.md must declare the subskill installer");
  assert.ok(installIndex < sceneGateIndex, "subskills must be installed before scenario decisions");
  assert.ok(/方案设计和代码生成都依赖该安装步骤/.test(skillText),
    "the dependency gate must apply to both plan design and code generation");
  assert.ok(skillText.slice(executionIndex).includes("1. 依赖准备"),
    "execution stages must begin with dependency preparation");

  const decisionRules = fs.readFileSync(
    path.join(skillDir, "references", "scenario-decision-rules.md"), "utf8");
  assert.match(decisionRules, /开始场景决策前必须已通过 `tools\/install_subskills\.js`/);
}

function testRuntime() {
  assert.deepStrictEqual(runtime.classifySpawnResult({ status: 0 }), { state: "OK", code: 0 });
  assert.deepStrictEqual(runtime.classifySpawnResult({ status: 1 }), { state: "FAIL", code: 1 });
  assert.strictEqual(runtime.classifySpawnResult({ status: 2 }).state, "BROKEN");
  assert.strictEqual(runtime.classifySpawnResult({ status: null }).state, "BROKEN");
  assert.strictEqual(runtime.classifySpawnResult({ status: 9 }).state, "BROKEN");
  assert.strictEqual(runtime.classifySpawnResult({ error: new Error("spawn failed"), status: null }).state, "BROKEN");
  assert.strictEqual(runtime.classifySpawnResult({ signal: "SIGTERM", status: null }).state, "BROKEN");

  const broken = runNode(["-e", `require(${JSON.stringify(runtimePath)}).runGuarded("test", () => { throw new Error("boom"); })`]);
  assert.strictEqual(broken.status, 2, output(broken));
}

function testMissingSupportIsBroken() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "alipay-train-broken-"));
  const isolatedValidator = path.join(dir, "validate_codegen.js");
  fs.copyFileSync(validator, isolatedValidator);
  const result = runNode([isolatedValidator, path.join(__dirname, "fixtures", "valid")]);
  assert.strictEqual(result.status, 2, output(result));
  assert.match(output(result), /BROKEN failed to load validator support/);
}

function testValueResolver() {
  const text = [
    "const EXPENSE_TYPE_METRO = \"METRO\";",
    "const RULE_VALUE_CARD_TYPE = \"[\\\"S0110000\\\"]\";",
  ].join("\n");
  const tokens = resolver.valueTokens(text, "S0110000");
  assert.deepStrictEqual(tokens, ["S0110000", "RULE_VALUE_CARD_TYPE"]);
}

function testFixtures() {
  assertExit(path.join(__dirname, "fixtures", "valid"), 0);
  assertExit(path.join(__dirname, "fixtures", "invalid"), 1);
}

function testScenarioDecisionGates() {
  const metro = fs.mkdtempSync(path.join(os.tmpdir(), "alipay-scenario-metro-"));
  copyDir(path.join(__dirname, "fixtures", "valid"), metro);
  fs.writeFileSync(path.join(metro, "expense_service.py"), [
    "EXPENSE_TYPE = \"METRO\"",
    "SUB_CATEGORY = \"METRO\"",
    "SCENE_TYPE = \"TRAVEL\"",
    "CARD_FACTOR = \"CARD_TYPE\"",
    "CARD_VALUE = \"S0110000\"",
    "QUOTA_FACTOR = \"QUOTA_TOTAL\"",
    "def create_metro_institution():",
    "    return {",
    "        \"method\": \"alipay.ebpp.invoice.institution.create\",",
    "        \"consult_mode\": \"0\",",
    "        \"standard_info_list\": [{",
    "            \"expense_type\": EXPENSE_TYPE,",
    "            \"expense_type_sub_category\": SUB_CATEGORY,",
    "            \"scene_type\": SCENE_TYPE,",
    "            \"standard_condition_info_list\": [",
    "                {\"rule_factor\": CARD_FACTOR, \"rule_value\": [CARD_VALUE]},",
    "                {\"rule_factor\": QUOTA_FACTOR, \"rule_value\": \"1000\"},",
    "            ],",
    "        }],",
    "    }",
  ].join("\n"));
  fs.writeFileSync(path.join(metro, "bill_service.py"), [
    "DETAIL_METHOD = \"alipay.commerce.ec.consume.detail.query\"",
    "BATCH_METHOD = \"alipay.commerce.ec.consume.detail.batchquery\"",
    "NOTIFY_METHOD = \"alipay.commerce.ec.consume.change.notify\"",
    "def handle_bill_notification(pay_no):",
    "    return {",
    "        \"method\": NOTIFY_METHOD,",
    "        \"pay_no\": pay_no,",
    "        \"expense_type\": \"METRO\",",
    "        \"expense_type_sub_category\": \"METRO\",",
    "    }",
  ].join("\n"));
  writeScenario(metro, {
    schemaVersion: 1,
    status: "CONFIRMED",
    businessScene: "差旅地铁",
    expenseType: "METRO",
    expenseTypeSubCategory: "METRO",
    sceneType: "TRAVEL",
    requiredRuleFactors: ["CARD_TYPE"],
    ruleFactorValues: { CARD_TYPE: ["S0110000"], QUOTA_TOTAL: ["1000"] },
    expenseControlMode: "internal",
    internalFundingSource: { type: "QUOTA_LIMIT", quotaLimitFactors: ["QUOTA_TOTAL"] },
    businessPriority: { enabled: false, merchantRestrictionFactors: [] },
    billIdentifiers: { expenseType: "METRO", expenseTypeSubCategory: "METRO" },
  });
  assertExit(metro, 0);

  const missingValue = JSON.parse(fs.readFileSync(path.join(metro, ".alipay-skill", "scenario.json"), "utf8"));
  missingValue.ruleFactorValues.CARD_TYPE = [];
  writeScenario(metro, missingValue);
  const missingValueResult = runNode([validator, metro]);
  assert.strictEqual(missingValueResult.status, 1, output(missingValueResult));
  assert.match(output(missingValueResult), /ruleFactorValues\.CARD_TYPE must contain a confirmed non-empty business value/);

  missingValue.ruleFactorValues.CARD_TYPE = ["S0110000"];
  missingValue.businessPriority = { enabled: true, merchantRestrictionFactors: ["MERCHANT"] };
  missingValue.ruleFactorValues.ALARM_CLOCK_TIME = { all: true };
  missingValue.ruleFactorValues.MERCHANT = ["merchant"];
  writeScenario(metro, missingValue);
  const priorityResult = runNode([validator, metro]);
  assert.strictEqual(priorityResult.status, 1, output(priorityResult));
  assert.match(output(priorityResult), /does not define any effective merchant restriction factor/);
  assert.match(output(priorityResult), /MERCHANT is not an effective merchant restriction factor/);

  const missingFunding = JSON.parse(fs.readFileSync(path.join(metro, ".alipay-skill", "scenario.json"), "utf8"));
  delete missingFunding.internalFundingSource;
  writeScenario(metro, missingFunding);
  const missingFundingResult = runNode([validator, metro]);
  assert.strictEqual(missingFundingResult.status, 1, output(missingFundingResult));
  assert.match(output(missingFundingResult), /must confirm internalFundingSource/);

  const nonLimitFunding = JSON.parse(fs.readFileSync(path.join(metro, ".alipay-skill", "scenario.json"), "utf8"));
  nonLimitFunding.internalFundingSource = { type: "QUOTA_LIMIT", quotaLimitFactors: ["QUOTA_ONCE"] };
  nonLimitFunding.ruleFactorValues.QUOTA_ONCE = ["100"];
  writeScenario(metro, nonLimitFunding);
  const nonLimitFundingResult = runNode([validator, metro]);
  assert.strictEqual(nonLimitFundingResult.status, 1, output(nonLimitFundingResult));
  assert.match(output(nonLimitFundingResult), /non-limit factor: QUOTA_ONCE/);

  const taotian = JSON.parse(fs.readFileSync(path.join(metro, ".alipay-skill", "scenario.json"), "utf8"));
  taotian.expenseType = "DEFAULT";
  taotian.expenseTypeSubCategory = "DEFAULT";
  taotian.sceneType = "DEFAULT";
  taotian.requiredRuleFactors = ["ALI_PLATFORM_TYPE"];
  taotian.ruleFactorValues = {
    ALI_PLATFORM_TYPE: ["TAOTIAN", "1688"],
    ALARM_CLOCK_TIME: { all: true },
    MERCHANT: ["merchant"],
  };
  taotian.businessPriority = { enabled: true, merchantRestrictionFactors: ["MERCHANT"] };
  taotian.billIdentifiers = { expenseType: "DEFAULT", expenseTypeSubCategory: "DEFAULT" };
  writeScenario(metro, taotian);
  const taotianResult = runNode([validator, metro]);
  assert.strictEqual(taotianResult.status, 1, output(taotianResult));
  assert.match(output(taotianResult), /do not support business priority/);
}

function writeScenario(dir, scenario) {
  const meta = path.join(dir, ".alipay-skill");
  fs.mkdirSync(meta, { recursive: true });
  fs.writeFileSync(path.join(meta, "scenario.json"), JSON.stringify(scenario, null, 2));
}

// 账单场景识别完整性：scenario.billIdentifiers 同时声明 expenseType 与
// expenseTypeSubCategory 时，凡用 expense_type 做相等判定识别的账单文件，
// 必须同时核对 expense_type_sub_category，否则同大类的兄弟子类会被误判。
function testBillSceneIdentification() {
  // invalid：只用 expense_type == "HOTEL" 识别，缺子类核对 -> 必须报错。
  const invalidDir = fs.mkdtempSync(path.join(os.tmpdir(), "alipay-scenario-bill-scene-"));
  copyDir(path.join(__dirname, "fixtures", "valid"), invalidDir);
  fs.writeFileSync(path.join(invalidDir, "bill_scene.py"), [
    "def is_hotel(notify):",
    "    expense_type = notify.get(\"expense_type\")",
    "    return expense_type == \"HOTEL\"",
  ].join("\n"));
  const invalid = runNode([validator, invalidDir]);
  assert.strictEqual(invalid.status, 1, output(invalid));
  assert.match(output(invalid), /also check expense_type_sub_category so sibling subtypes are not misclassified/);

  // valid：同时核对 expense_type 与 expense_type_sub_category -> 不报。
  const validDir = fs.mkdtempSync(path.join(os.tmpdir(), "alipay-scenario-bill-scene-"));
  copyDir(path.join(__dirname, "fixtures", "valid"), validDir);
  fs.writeFileSync(path.join(validDir, "bill_scene.py"), [
    "def is_hotel(notify):",
    "    expense_type = notify.get(\"expense_type\")",
    "    expense_type_sub_category = notify.get(\"expense_type_sub_category\")",
    "    return expense_type == \"HOTEL\" and expense_type_sub_category == \"HOTEL\"",
  ].join("\n"));
  const valid = runNode([validator, validDir]);
  assert.doesNotMatch(output(valid), /also check expense_type_sub_category so sibling subtypes are not misclassified/);
}

function testIfElseRouterGates() {
  const validSwitch = runRouterFixture([
    "switch (msgApi) {",
    "  case \"ec.alias\":",
    "  case \"ec\":",
    "    boolean ecOk = ecNotifyHandler.onNotify(msgApi, msgId, bizContent);",
    "    if (!ecOk) {",
    "      throw new MsgProcessingException(\"ec failed\");",
    "    }",
    "    break;",
    "  case \"bill\":",
    "    if (!billMsgHandler.handle(bizContent)) {",
    "      throw new MsgProcessingException(\"bill failed\");",
    "    }",
    "    break;",
    "  default:",
    "    throw new MsgProcessingException(\"unknown msgApi\");",
    "}",
  ]);
  assert.doesNotMatch(output(validSwitch), /has no actual handler method call/);
  assert.doesNotMatch(output(validSwitch), /ignores .*Handler\./);
  assert.doesNotMatch(output(validSwitch), /defaults unknown msgApi/);

  const valid = runRouterFixture([
    "if (msgApi == null) {",
    "  throw new MsgProcessingException(\"missing msgApi\");",
    "}",
    "if (ecNotifyHandler.supports(msgApi)) {",
    "  if (!ecNotifyHandler.onNotify(msgApi, msgId, bizContent)) {",
    "    throw new MsgProcessingException(\"ec failed\");",
    "  }",
    "  return;",
    "}",
    "if (billMsgHandler.supportedMsgMethod().equals(msgApi)) {",
    "  boolean ok = billMsgHandler.handle(bizContent);",
    "  if (!ok) {",
    "    throw new MsgProcessingException(\"bill failed\");",
    "  }",
    "  return;",
    "}",
    "if (stringHandler.supports(msgApi)) {",
    "  String result = stringHandler.handle(bizContent);",
    "  if (\"fail\".equals(result)) {",
    "    throw new MsgProcessingException(\"string handler failed\");",
    "  }",
    "  return;",
    "}",
    "throw new MsgProcessingException(\"unknown msgApi\");",
  ]);
  assert.doesNotMatch(output(valid), /has no actual handler method call/);
  assert.doesNotMatch(output(valid), /ignores .*Handler\./);
  assert.doesNotMatch(output(valid), /defaults unknown msgApi/);

  const swallowedFailure = runRouterFixture([
    "if (ecNotifyHandler.supports(msgApi)) {",
    "  ecNotifyHandler.onNotify(msgApi, msgId, bizContent);",
    "  return;",
    "}",
    "throw new MsgProcessingException(\"unknown msgApi\");",
  ]);
  assert.match(output(swallowedFailure), /ignores ecNotifyHandler\.onNotify/);

  const missingFallback = runRouterFixture([
    "if (ecNotifyHandler.supports(msgApi)) {",
    "  if (!ecNotifyHandler.onNotify(msgApi, msgId, bizContent)) {",
    "    throw new MsgProcessingException(\"ec failed\");",
    "  }",
    "  return;",
    "}",
  ]);
  assert.match(output(missingFallback), /defaults unknown msgApi\/msg_method to success/);

  const emptyDispatch = runRouterFixture([
    "if (ecNotifyHandler.supports(msgApi)) {",
    "  System.out.println(\"matched\");",
    "  return;",
    "}",
    "throw new MsgProcessingException(\"unknown msgApi\");",
  ]);
  assert.match(output(emptyDispatch), /has no actual handler method call/);
}

function runRouterFixture(methodLines, connectLines = ["client.connect();"]) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "alipay-train-router-"));
  fs.writeFileSync(path.join(dir, "AlipayMsgRouter.java"), [
    "class AlipayMsgRouter implements MsgHandler {",
    "  private EcNotifyHandler ecNotifyHandler;",
    "  private BillMsgHandler billMsgHandler;",
    "  private StringHandler stringHandler;",
    "  public void onMessage(String msgApi, String msgId, String bizContent) {",
    ...methodLines.map((line) => `    ${line}`),
    "  }",
    "}",
  ].join("\n"));
  fs.writeFileSync(path.join(dir, "AlipayMsgClientBootstrap.java"), [
    "class AlipayMsgClientBootstrap {",
    "  void start(AlipayMsgRouter router) {",
    "    AlipayMsgClient client = AlipayMsgClient.getInstance(\"app\");",
    "    client.setSecurityConfig(\"RSA2\", \"private\", \"public\");",
    "    client.setMessageHandler(router);",
    ...connectLines.map((line) => `    ${line}`),
    "  }",
    "}",
  ].join("\n"));
  return runNode([validator, dir], { ALIPAY_VALIDATE_SKIP_COMPILE: "1" });
}

function testMessageClientStartupFailurePolicy() {
  const swallowed = runRouterFixture([
    "if (ecNotifyHandler.supports(msgApi)) {",
    "  if (!ecNotifyHandler.onNotify(msgApi, msgId, bizContent)) throw new RuntimeException();",
    "  return;",
    "}",
    "throw new RuntimeException(\"unknown\");",
  ], [
    "try { client.connect(); } catch (Exception e) { logger.error(\"connect failed\", e); }",
  ]);
  assert.match(output(swallowed), /catches initial connect failure without fail-fast/);

  const failFast = runRouterFixture([
    "if (ecNotifyHandler.supports(msgApi)) {",
    "  if (!ecNotifyHandler.onNotify(msgApi, msgId, bizContent)) throw new RuntimeException();",
    "  return;",
    "}",
    "throw new RuntimeException(\"unknown\");",
  ], [
    "try { client.connect(); } catch (Exception e) { throw new IllegalStateException(\"connect failed\", e); }",
  ]);
  assert.doesNotMatch(output(failFast), /catches initial connect failure without fail-fast/);

  const retryAndHealth = runRouterFixture([
    "if (ecNotifyHandler.supports(msgApi)) {",
    "  if (!ecNotifyHandler.onNotify(msgApi, msgId, bizContent)) throw new RuntimeException();",
    "  return;",
    "}",
    "throw new RuntimeException(\"unknown\");",
  ], [
    "try { client.connect(); } catch (Exception e) {",
    "  readiness.markUnavailable();",
    "  retryScheduler.schedule(this::start);",
    "}",
  ]);
  assert.doesNotMatch(output(retryAndHealth), /catches initial connect failure without fail-fast/);
}

function testIntegrationContract() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "alipay-train-contract-"));
  copyDir(path.join(__dirname, "fixtures", "valid"), dir);
  const meta = path.join(dir, ".alipay-skill");
  fs.mkdirSync(meta, { recursive: true });
  const contract = {
    schemaVersion: 1,
    projectMode: "existing",
    domains: {
      ec: { status: "CONFIRMED", joinPoints: [], changes: [{ path: "ec_directory.py", action: "reuse" }] },
      "expense-control": { status: "CONFIRMED", joinPoints: [], changes: [{ path: "expense_service.py", action: "reuse" }] },
      bill: { status: "CONFIRMED", joinPoints: [], changes: [{ path: "bill_service.py", action: "reuse" }] },
    },
    gaps: [],
  };
  fs.writeFileSync(path.join(meta, "integration-contract.json"), JSON.stringify(contract, null, 2));
  assertExit(dir, 0, { ALIPAY_PROJECT_MODE: "existing" });
  contract.projectMode = "greenfield";
  fs.writeFileSync(path.join(meta, "integration-contract.json"), JSON.stringify(contract, null, 2));
  assertExit(dir, 1, { ALIPAY_PROJECT_MODE: "existing" });
  contract.projectMode = "existing";
  delete contract.domains.bill;
  fs.writeFileSync(path.join(meta, "integration-contract.json"), JSON.stringify(contract, null, 2));
  assertExit(dir, 1, { ALIPAY_PROJECT_MODE: "existing" });
}

function testSubskillsInSync() {
  // subskills/*.zip 必须与同级子 Skill 源目录保持一致;漂移即视为交付不一致。
  const syncScript = path.join(skillDir, "tools", "sync_subskills.js");
  const result = runNode([syncScript, "--check"]);
  assert.strictEqual(
    result.status,
    0,
    `subskills 与源目录漂移,提交前请运行 \`node tools/sync_subskills.js\` 重打:\n${output(result)}`,
  );
}

// 拼错或未知参数必须 BROKEN(exit 2),不得静默退化成 build 重写 ZIP。
function testSyncRejectsUnknownArgs() {
  const sandbox = makeSyncSandbox();
  for (const badArg of ["--chec", "--dry-run", "build", "-c"]) {
    const result = runNode([sandbox.syncScript, badArg]);
    assert.strictEqual(result.status, 2, `arg ${badArg} should be BROKEN(2):\n${output(result)}`);
    assert.match(output(result), /未知参数/, `arg ${badArg} should report unknown arg`);
  }
}

// 打包失败时必须保留旧 ZIP、不留残留 tmp(原子替换)。
function testSyncBuildIsAtomicOnFailure() {
  const sandbox = makeSyncSandbox();

  // 先正常打一个可用 zip 作为 baseline。
  const ok = runNode([sandbox.syncScript]);
  assert.strictEqual(ok.status, 0, `baseline build should succeed:\n${output(ok)}`);
  const zipPath = path.join(sandbox.subskillsDir, "alipay-enterprise-ec.zip");
  assert.ok(fs.existsSync(zipPath), "baseline zip should exist");
  const oldHash = sha256File(zipPath);

  // 注入一个必失败的假 zip,并改动源文件触发重打。
  const fakeBin = path.join(sandbox.root, "fakebin");
  fs.mkdirSync(fakeBin, { recursive: true });
  const fakeZip = path.join(fakeBin, "zip");
  fs.writeFileSync(fakeZip, "#!/bin/bash\nexit 1\n");
  fs.chmodSync(fakeZip, 0o755);
  fs.appendFileSync(path.join(sandbox.srcDir, "SKILL.md"), "\nchanged\n");

  const failed = runNode([sandbox.syncScript], { PATH: `${fakeBin}:${process.env.PATH}` });
  assert.strictEqual(failed.status, 2, `failed build should be BROKEN(2):\n${output(failed)}`);

  // 旧 zip 必须原样保留。
  assert.ok(fs.existsSync(zipPath), "old zip must survive a failed build");
  assert.strictEqual(sha256File(zipPath), oldHash, "old zip content must be unchanged after failed build");

  // 不得有残留 tmp 文件。
  const leftovers = fs.readdirSync(sandbox.subskillsDir).filter((n) => n.includes(".tmp-"));
  assert.deepStrictEqual(leftovers, [], `no tmp leftovers expected, found: ${leftovers.join(", ")}`);
}

// 三包整体事务:某个域打包失败时,必须 all-or-nothing —— 已成功的域也不能被替换。
function testSyncBuildIsTransactional() {
  const domains = ["alipay-enterprise-ec", "alipay-enterprise-expense-control", "alipay-enterprise-bill"];
  const sandbox = makeSyncSandbox(domains);

  // 先正常打三个 zip 作为 baseline,记录各自 hash。
  const ok = runNode([sandbox.syncScript]);
  assert.strictEqual(ok.status, 0, `baseline build should succeed:\n${output(ok)}`);
  const zipPath = (d) => path.join(sandbox.subskillsDir, `${d}.zip`);
  const oldHashes = Object.fromEntries(domains.map((d) => [d, sha256File(zipPath(d))]));

  // 注入一个"第 2 次调用必失败"的假 zip:domain 按顺序处理,第 2 个域打包时失败。
  const fakeBin = path.join(sandbox.root, "fakebin");
  fs.mkdirSync(fakeBin, { recursive: true });
  const counter = path.join(sandbox.root, "zip-call-count");
  const fakeZip = path.join(fakeBin, "zip");
  fs.writeFileSync(
    fakeZip,
    [
      "#!/bin/bash",
      `n=$(cat "${counter}" 2>/dev/null || echo 0)`,
      "n=$((n+1))",
      `echo "$n" > "${counter}"`,
      'if [ "$n" -eq 2 ]; then exit 1; fi', // 第 2 个域打包失败
      'exec /usr/bin/zip "$@"',
    ].join("\n"),
  );
  fs.chmodSync(fakeZip, 0o755);

  // 改动所有源,触发重打;期望:因第 2 个域失败,三个 zip 全部保持旧版。
  for (const d of domains) fs.appendFileSync(path.join(sandbox.srcDirs[d], "SKILL.md"), "\nchanged\n");

  const failed = runNode([sandbox.syncScript], { PATH: `${fakeBin}:${process.env.PATH}` });
  assert.strictEqual(failed.status, 2, `transactional build failure should be BROKEN(2):\n${output(failed)}`);

  // 三个 zip 必须都还是旧版(包括第 1 个已成功打包的域)。
  for (const d of domains) {
    assert.ok(fs.existsSync(zipPath(d)), `${d}.zip must survive`);
    assert.strictEqual(
      sha256File(zipPath(d)),
      oldHashes[d],
      `${d}.zip must be unchanged after a transactional failure (no partial replace)`,
    );
  }

  // 无残留 tmp。
  const leftovers = fs.readdirSync(sandbox.subskillsDir).filter((n) => n.includes(".tmp-"));
  assert.deepStrictEqual(leftovers, [], `no tmp leftovers expected, found: ${leftovers.join(", ")}`);
}

// 损坏 ZIP:zip 命令返回成功,但产物是损坏文件,阶段1 读取/解包时失败,
// 必须无 .zip.tmp-* 残留(对应"生成损坏 ZIP 时残留临时文件"问题)。
function testSyncCorruptZipLeavesNoResidue() {
  const sandbox = makeSyncSandbox(["alipay-enterprise-ec"]);

  // 假 zip:返回 0,但写出的目标是非法 zip 内容。
  const fakeBin = path.join(sandbox.root, "fakebin");
  fs.mkdirSync(fakeBin, { recursive: true });
  const fakeZip = path.join(fakeBin, "zip");
  fs.writeFileSync(
    fakeZip,
    [
      "#!/bin/bash",
      // sync.js 以 `zip -X -q -@ <tmpPath>` 调用,最后一个参数是目标文件。
      'target="${!#}"',
      'printf "NOT A ZIP" > "$target"',
      "exit 0",
    ].join("\n"),
  );
  fs.chmodSync(fakeZip, 0o755);

  const result = runNode([sandbox.syncScript], { PATH: `${fakeBin}:${process.env.PATH}` });
  assert.strictEqual(result.status, 2, `corrupt zip should be BROKEN(2):\n${output(result)}`);

  const leftovers = fs.readdirSync(sandbox.subskillsDir).filter((n) => n.includes(".tmp-") || n.includes(".bak-"));
  assert.deepStrictEqual(leftovers, [], `corrupt zip must leave no residue, found: ${leftovers.join(", ")}`);
}

// 阶段2 替换失败:第 2 个域 rename 时失败,必须回滚到全旧一致态,无残留。
// 通过 test-only 故障注入 SYNC_FI_FAIL_REPLACE_INDEX 让第 2 次替换抛错。
function testSyncCommitRollbackOnReplaceFailure() {
  const domains = ["alipay-enterprise-ec", "alipay-enterprise-expense-control", "alipay-enterprise-bill"];
  const sandbox = makeSyncSandbox(domains);

  // baseline:先打三个可用 zip,记录 hash。
  const ok = runNode([sandbox.syncScript]);
  assert.strictEqual(ok.status, 0, `baseline build should succeed:\n${output(ok)}`);
  const zipPath = (d) => path.join(sandbox.subskillsDir, `${d}.zip`);
  const oldHashes = Object.fromEntries(domains.map((d) => [d, sha256File(zipPath(d))]));

  // 改源触发重打。
  for (const d of domains) fs.appendFileSync(path.join(sandbox.srcDirs[d], "SKILL.md"), "\nchanged\n");

  // 注入:第 2 次替换失败。期望回滚 → 三个 zip 全部回到旧版。
  const failed = runNode([sandbox.syncScript], { SYNC_FI_FAIL_REPLACE_INDEX: "2" });
  assert.strictEqual(failed.status, 2, `replace failure should be BROKEN(2):\n${output(failed)}`);

  // 关键:第 1 个域(替换失败前已 rename 成功)必须被回滚回旧版,不能是新版。
  for (const d of domains) {
    assert.ok(fs.existsSync(zipPath(d)) && fs.statSync(zipPath(d)).isFile(), `${d}.zip must remain a file`);
    assert.strictEqual(
      sha256File(zipPath(d)),
      oldHashes[d],
      `${d}.zip must be rolled back to old version (no mixed/partial state)`,
    );
  }

  const leftovers = fs.readdirSync(sandbox.subskillsDir).filter((n) => n.includes(".tmp-") || n.includes(".bak-"));
  assert.deepStrictEqual(leftovers, [], `rollback must leave no tmp/bak residue, found: ${leftovers.join(", ")}`);
}

// 构造一个隔离的 skills 根:tt/tools/sync_subskills.js + scripts/lib,N 个 domain 源目录。
// 同步工具按自身位置解析路径,所以必须复刻这个相对布局。
function makeSyncSandbox(domains = ["alipay-enterprise-ec"]) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "alipay-train-sync-"));
  const skillRoot = path.join(root, "tt");
  const skillScripts = path.join(skillRoot, "scripts");
  const skillTools = path.join(skillRoot, "tools");
  const subskillsDir = path.join(root, "tt", "subskills");
  fs.mkdirSync(path.join(skillScripts, "lib"), { recursive: true });
  fs.mkdirSync(skillTools, { recursive: true });
  fs.mkdirSync(subskillsDir, { recursive: true });

  // 复制同步工具,但把 DOMAINS 收敛为指定列表,避免依赖真实子 skill。
  const original = fs.readFileSync(path.join(skillDir, "tools", "sync_subskills.js"), "utf8");
  const domainsLiteral = `const DOMAINS = [${domains.map((d) => `"${d}"`).join(", ")}];`;
  const patched = original.replace(/const DOMAINS = \[[\s\S]*?\];/, domainsLiteral);
  const syncScript = path.join(skillTools, "sync_subskills.js");
  fs.writeFileSync(syncScript, patched);
  fs.copyFileSync(
    path.join(scriptsDir, "lib", "validator-runtime.js"),
    path.join(skillScripts, "lib", "validator-runtime.js"),
  );

  // 每个域:源目录 + 必需文件。
  const srcDirs = {};
  for (const domain of domains) {
    const srcDir = path.join(root, domain);
    fs.mkdirSync(path.join(srcDir, "scripts"), { recursive: true });
    fs.writeFileSync(path.join(srcDir, "SKILL.md"), `${domain} skill\n`);
    fs.writeFileSync(path.join(srcDir, "scripts", "validate_codegen.js"), "// validator\n");
    srcDirs[domain] = srcDir;
  }

  // srcDir 保留单域兼容字段(旧测试用)。
  return { root, syncScript, subskillsDir, srcDirs, srcDir: srcDirs[domains[0]] };
}

function sha256File(file) {
  return crypto.createHash("sha256").update(fs.readFileSync(file)).digest("hex");
}

function assertExit(target, expected, extraEnv = {}) {
  const result = runNode([validator, target], extraEnv);
  assert.strictEqual(result.status, expected, output(result));
}

function runNode(args, extraEnv = {}) {
  return spawnSync(process.execPath, args, {
    encoding: "utf8",
    env: Object.assign({}, process.env, extraEnv),
    maxBuffer: 1024 * 1024 * 8,
  });
}

function output(result) {
  return `${result.stdout || ""}\n${result.stderr || ""}`.trim();
}

function copyDir(from, to) {
  for (const entry of fs.readdirSync(from, { withFileTypes: true })) {
    const source = path.join(from, entry.name);
    const target = path.join(to, entry.name);
    if (entry.isDirectory()) {
      fs.mkdirSync(target, { recursive: true });
      copyDir(source, target);
    } else {
      fs.copyFileSync(source, target);
    }
  }
}
