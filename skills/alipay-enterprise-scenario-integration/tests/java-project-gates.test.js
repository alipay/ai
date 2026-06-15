"use strict";

const assert = require("assert");
const fs = require("fs");
const os = require("os");
const path = require("path");

function run(gates) {
  testTransportContract(gates);
  testProductionState(gates);
  testStateTransitionPersistence(gates);
  testProfileWiring(gates);
  testTestEvidence(gates);
}

function testStateTransitionPersistence(gates) {
  const dir = temp("transition");
  const handler = writeJava(dir, "EmployeeChangeHandler.java", [
    "class EmployeeChangeHandler {",
    "  public void handleLeave(Employee current) {",
    "    Employee leaving = current.copy();",
    "    leaving.setStatus(\"LEAVE\");",
    "    repository.delete(current.getId());",
    "  }",
    "}",
  ]);
  const errors = [];
  gates.checkJavaStateTransitionPersistence([handler], errors, path.basename);
  assert.ok(errors.some((error) => /without persisting, archiving, or publishing/.test(error)), errors.join("\n"));

  fs.writeFileSync(handler, [
    "class EmployeeChangeHandler {",
    "  public void handleLeave(Employee current) {",
    "    Employee leaving = current.copy();",
    "    leaving.setStatus(\"LEAVE\");",
    "    repository.archive(leaving);",
    "    repository.delete(current.getId());",
    "  }",
    "}",
  ].join("\n"));
  const validErrors = [];
  gates.checkJavaStateTransitionPersistence([handler], validErrors, path.basename);
  assert.deepStrictEqual(validErrors, []);
}

function testTransportContract(gates) {
  const dir = temp("transport");
  const router = writeJava(dir, "MsgRouter.java", [
    "class MsgRouter implements MsgHandler {",
    "  private final EnterpriseHandler enterpriseHandler;",
    "  public void onMessage(String msgApi, String msgId, String bizContent) {",
    "    enterpriseHandler.handle(bizContent);",
    "  }",
    "}",
  ]);
  const invalidHandler = writeJava(dir, "EnterpriseHandler.java", [
    "class EnterpriseHandler {",
    "  public boolean handle(String payload) {",
    "    Envelope envelope = parser.parseEnvelope(payload);",
    "    return verifier.verifySign(envelope.getSign());",
    "  }",
    "}",
  ]);
  const errors = [];
  gates.checkJavaTransportContracts([router, invalidHandler], errors, path.basename);
  assert.ok(errors.some((error) => /HTTP notification envelope/.test(error)), errors.join("\n"));

  fs.writeFileSync(invalidHandler, [
    "class EnterpriseHandler {",
    "  public boolean handle(String payload) {",
    "    EnterpriseChange change = parser.parseBusinessJson(payload);",
    "    return service.apply(change);",
    "  }",
    "}",
  ].join("\n"));
  const validErrors = [];
  gates.checkJavaTransportContracts([router, invalidHandler], validErrors, path.basename);
  assert.deepStrictEqual(validErrors, []);
}

function testProductionState(gates) {
  const dir = temp("state");
  const repository = writeJava(dir, "EnterpriseRepository.java", [
    "class EnterpriseRepository {",
    "  private final Map<String, Enterprise> values = new ConcurrentHashMap<>();",
    "}",
  ]);
  const errors = [];
  gates.checkJavaProductionStateStores([repository], errors, path.basename);
  assert.ok(errors.some((error) => /process-local Map\/Set/.test(error)), errors.join("\n"));

  fs.writeFileSync(repository, [
    "@Profile(\"demo\")",
    "class EnterpriseRepository {",
    "  private final Map<String, Enterprise> values = new ConcurrentHashMap<>();",
    "}",
  ].join("\n"));
  const demoErrors = [];
  gates.checkJavaProductionStateStores([repository], demoErrors, path.basename);
  assert.deepStrictEqual(demoErrors, []);
}

function testProfileWiring(gates) {
  const dir = temp("profile");
  const port = writeJava(dir, "NotifyStore.java", "interface NotifyStore {}");
  const implementation = writeJava(dir, "DemoNotifyStore.java", [
    "@Profile(\"demo\")",
    "@Component",
    "class DemoNotifyStore implements NotifyStore {}",
  ]);
  const consumer = writeJava(dir, "NotifyHandler.java", [
    "class NotifyHandler {",
    "  public NotifyHandler(NotifyStore store) {}",
    "}",
  ]);
  const errors = [];
  gates.checkSpringProfileWiring(dir, [port, implementation, consumer], errors, path.basename);
  assert.ok(errors.some((error) => /only profile-scoped implementations/.test(error)), errors.join("\n"));

  fs.mkdirSync(path.join(dir, "src", "main", "resources"), { recursive: true });
  fs.writeFileSync(path.join(dir, "src", "main", "resources", "application.properties"), "spring.profiles.active=demo\n");
  const activeErrors = [];
  gates.checkSpringProfileWiring(dir, [port, implementation, consumer], activeErrors, path.basename);
  assert.deepStrictEqual(activeErrors, []);
}

function testTestEvidence(gates) {
  const dir = temp("tests");
  const app = writeJava(path.join(dir, "src", "main", "java"), "Application.java", [
    "@SpringBootApplication",
    "class Application {}",
  ]);
  const errors = [];
  gates.checkJavaTestEvidence(dir, [app], errors);
  assert.ok(errors.some((error) => /no executable test sources/.test(error)), errors.join("\n"));

  const test = writeJava(path.join(dir, "src", "test", "java"), "ApplicationTest.java", [
    "@SpringBootTest",
    "class ApplicationTest {}",
  ]);
  const validErrors = [];
  gates.checkJavaTestEvidence(dir, [app, test], validErrors);
  assert.deepStrictEqual(validErrors, []);
}

function temp(name) {
  return fs.mkdtempSync(path.join(os.tmpdir(), `alipay-java-gates-${name}-`));
}

function writeJava(dir, name, lines) {
  fs.mkdirSync(dir, { recursive: true });
  const file = path.join(dir, name);
  fs.writeFileSync(file, Array.isArray(lines) ? lines.join("\n") : lines);
  return file;
}

module.exports = { run };
