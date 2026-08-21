"use strict";

const assert = require("assert");
const fs = require("fs");
const os = require("os");
const path = require("path");

function run(gates) {
  testTransportContract(gates);
  testSdkReflectionBypass(gates);
  testProductionState(gates);
  testStateTransitionPersistence(gates);
  testProfileWiring(gates);
  testProfiledCoreComponents(gates);
  testConcreteDemoDependency(gates);
  testFailClosedDefaultBackoff(gates);
  testBeanMethodBypass(gates);
  testAlipayMsgClientContracts(gates);
  testTestEvidence(gates);
}

function testSdkReflectionBypass(gates) {
  const dir = temp("sdk-reflection");
  const service = writeJava(dir, "EnterpriseTitleService.java", [
    "import com.alipay.api.response.AlipayEbppInvoiceEnterpriseexctrlEmployertitleQueryResponse;",
    "class EnterpriseTitleService {",
    "  void parse(AlipayEbppInvoiceEnterpriseexctrlEmployertitleQueryResponse response) {",
    "    try { parseBody(response.getBody()); }",
    "    catch (Exception e) { log.warn(\"parse failed {}\", e.getClass().getSimpleName()); }",
    "  }",
    "}",
  ]);
  const loggingErrors = [];
  gates.checkSdkReflectionBypass([service], loggingErrors, path.basename);
  assert.deepStrictEqual(loggingErrors, []);

  fs.writeFileSync(service, [
    "import com.alipay.api.response.AlipayEbppInvoiceEnterpriseexctrlEmployertitleQueryResponse;",
    "class EnterpriseTitleService {",
    "  Object readMissingField(AlipayEbppInvoiceEnterpriseexctrlEmployertitleQueryResponse response) throws Exception {",
    "    return response.getClass().getDeclaredMethod(\"getTitleCode\").invoke(response);",
    "  }",
    "}",
  ].join("\n"));
  const bypassErrors = [];
  gates.checkSdkReflectionBypass([service], bypassErrors, path.basename);
  assert.ok(bypassErrors.some((error) => /must not use reflection\/BeanUtils/.test(error)), bypassErrors.join("\n"));
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

  const config = writeJava(dir, "StoreConfig.java", [
    "class StoreConfig {",
    "  @Bean",
    "  @Profile(\"demo\")",
    "  AgreementStore agreementStore() { return new AgreementStore(); }",
    "}",
  ]);
  fs.writeFileSync(repository, [
    "class AgreementStore {",
    "  private final Map<String, Agreement> values = new ConcurrentHashMap<>();",
    "}",
  ].join("\n"));
  const profiledBeanErrors = [];
  gates.checkJavaProductionStateStores([repository, config], profiledBeanErrors, path.basename);
  assert.deepStrictEqual(profiledBeanErrors, []);
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

function testProfiledCoreComponents(gates) {
  const dir = temp("profiled-core");
  const handler = writeJava(dir, "EmployeeChangeNotifyHandler.java", [
    "@Profile(\"demo\")",
    "@Component",
    "class EmployeeChangeNotifyHandler {",
    "  public boolean handle(String payload) { return true; }",
    "}",
  ]);
  const errors = [];
  gates.checkJavaProfiledCoreComponents([handler], errors, path.basename);
  assert.ok(errors.some((error) => /core runtime component/.test(error)), errors.join("\n"));

  fs.writeFileSync(handler, [
    "@org.springframework.context.annotation.Profile(\"demo\")",
    "@Component",
    "class EmployeeChangeNotifyHandler {",
    "  public boolean handle(String payload) { return true; }",
    "}",
  ].join("\n"));
  const fqnErrors = [];
  gates.checkJavaProfiledCoreComponents([handler], fqnErrors, path.basename);
  assert.ok(fqnErrors.some((error) => /core runtime component/.test(error)), fqnErrors.join("\n"));

  const demoStore = writeJava(dir, "DemoEmployeeNotifyStore.java", [
    "@Profile(\"demo\")",
    "@Component",
    "class DemoEmployeeNotifyStore {",
    "  private final Map<String, String> values = new ConcurrentHashMap<>();",
    "}",
  ]);
  const validErrors = [];
  gates.checkJavaProfiledCoreComponents([demoStore], validErrors, path.basename);
  assert.deepStrictEqual(validErrors, []);
}

function testAlipayMsgClientContracts(gates) {
  const dir = temp("alipay-msg-client");
  const initializer = writeJava(dir, "AlipayMsgClientInitializer.java", [
    "class AlipayMsgClientInitializer {",
    "  private MessageRouter messageRouter;",
    "  public void run() throws Exception {",
    "    AlipayMsgClient msgClient = AlipayMsgClient.getInstance(appId);",
    "    msgClient.setSecurityConfig(signType, privateKey, publicKey);",
    "    msgClient.setMessageHandler(new MsgHandler() {",
    "      public void onMessage(String msgApi, String msgContent, String eventType) {",
    "        boolean result = messageRouter.dispatch(msgApi, msgContent);",
    "        if (!result) {",
    "          log.warn(\"dispatch failed\");",
    "        }",
    "      }",
    "    });",
    "    msgClient.connect();",
    "  }",
    "}",
  ]);
  const errors = [];
  gates.checkJavaAlipayMsgClientContracts([initializer], errors, path.basename);
  assert.ok(errors.some((error) => /without any setConnector/.test(error)), errors.join("\n"));
  assert.ok(errors.some((error) => /second callback argument/.test(error)), errors.join("\n"));
  assert.ok(errors.some((error) => /failure ACK/.test(error)), errors.join("\n"));

  fs.writeFileSync(initializer, [
    "class AlipayMsgClientInitializer {",
    "  private MessageRouter messageRouter;",
    "  public void run() throws Exception {",
    "    AlipayMsgClient msgClient = AlipayMsgClient.getInstance(appId);",
    "    msgClient.setConnector(connectorUrl, true);",
    "    msgClient.setSecurityConfig(signType, privateKey, publicKey);",
    "    msgClient.setMessageHandler(new MsgHandler() {",
    "      public void onMessage(String msgApi, String msgId, String bizContent) {",
    "        if (!messageRouter.dispatch(msgApi, bizContent)) {",
    "          throw new IllegalStateException(\"dispatch failed\");",
    "        }",
    "      }",
    "    });",
    "    msgClient.connect();",
    "  }",
    "}",
  ].join("\n"));
  const validErrors = [];
  gates.checkJavaAlipayMsgClientContracts([initializer], validErrors, path.basename);
  assert.deepStrictEqual(validErrors, []);

  const fakeHealth = writeJava(dir, "RetryingMsgClient.java", [
    "class RetryingMsgClient {",
    "  private AlipayMsgClient client;",
    "  void connect() {",
    "    try { client.connect(); } catch (Exception e) {",
    "      health.markDown();",
    "      retryScheduler.schedule(this::connect);",
    "    }",
    "  }",
    "}",
    "class MessageConnectionHealth { void markDown() {} }",
  ]);
  const fakeHealthErrors = [];
  const unrelatedThrow = writeJava(
    dir,
    "UnrelatedService.java",
    [
      "class UnrelatedService {",
      "  void call() { try { work(); } catch (Exception e) { throw new IllegalStateException(e); } }",
      "  void work() {}",
      "}",
    ],
  );
  gates.checkJavaAlipayMsgClientContracts([fakeHealth, unrelatedThrow], fakeHealthErrors, path.basename);
  assert.ok(fakeHealthErrors.some((error) => /no real readiness integration/.test(error)), fakeHealthErrors.join("\n"));

  fs.writeFileSync(fakeHealth, [
    "class RetryingMsgClient {",
    "  private AlipayMsgClient client;",
    "  void connect() {",
    "    try { client.connect(); } catch (Exception e) {",
    "      AvailabilityChangeEvent.publish(context, ReadinessState.REFUSING_TRAFFIC);",
    "      retryScheduler.schedule(this::connect);",
    "    }",
    "  }",
    "}",
  ].join("\n"));
  const readinessErrors = [];
  gates.checkJavaAlipayMsgClientContracts([fakeHealth], readinessErrors, path.basename);
  assert.ok(!readinessErrors.some((error) => /no real readiness integration/.test(error)), readinessErrors.join("\n"));
}

function testConcreteDemoDependency(gates) {
  const dir = temp("concrete-demo");
  const store = writeJava(dir, "AgreementStore.java", [
    "@Profile(\"demo\")",
    "@Component",
    "class AgreementStore {}",
  ]);
  const service = writeJava(dir, "WithholdingService.java", [
    "@Service",
    "class WithholdingService {",
    "  private final AgreementStore agreementStore;",
    "  public WithholdingService(AgreementStore agreementStore) {",
    "    this.agreementStore = agreementStore;",
    "  }",
    "}",
  ]);
  const errors = [];
  gates.checkJavaConcreteDemoDependency([store, service], errors, path.basename);
  assert.ok(errors.some((error) => /depends on demo\/test concrete type AgreementStore/.test(error)), errors.join("\n"));

  const port = writeJava(dir, "AgreementStorePort.java", "interface AgreementStorePort {}");
  fs.writeFileSync(store, [
    "@Profile(\"demo\")",
    "@Component",
    "class DemoAgreementStore implements AgreementStorePort {}",
  ].join("\n"));
  fs.writeFileSync(service, [
    "@Service",
    "class WithholdingService {",
    "  private final AgreementStorePort agreementStore;",
    "  public WithholdingService(AgreementStorePort agreementStore) {",
    "    this.agreementStore = agreementStore;",
    "  }",
    "}",
  ].join("\n"));
  const validErrors = [];
  gates.checkJavaConcreteDemoDependency([port, store, service], validErrors, path.basename);
  assert.deepStrictEqual(validErrors, []);
}

function testFailClosedDefaultBackoff(gates) {
  const dir = temp("fail-closed-backoff");
  const port = writeJava(dir, "AgreementStorePort.java", "interface AgreementStorePort {}");
  const demo = writeJava(dir, "AgreementStore.java", [
    "@Profile(\"demo\")",
    "@Component",
    "class AgreementStore implements AgreementStorePort {}",
  ]);
  const failClosed = writeJava(dir, "FailClosedAgreementStorePort.java", [
    "@Component",
    "class FailClosedAgreementStorePort implements AgreementStorePort {",
    "  public Object find() {",
    "    throw new IllegalStateException(\"AgreementStorePort is not configured for production\");",
    "  }",
    "}",
  ]);
  const errors = [];
  gates.checkJavaFailClosedDefaultBackoff([port, demo, failClosed], errors, path.basename);
  assert.ok(errors.some((error) => /fail-closed default/.test(error)), errors.join("\n"));

  const noDemoErrors = [];
  gates.checkJavaFailClosedDefaultBackoff([port, failClosed], noDemoErrors, path.basename);
  assert.ok(noDemoErrors.some((error) => /fail-closed default/.test(error)), noDemoErrors.join("\n"));

  fs.writeFileSync(failClosed, [
    "class FailClosedAgreementStorePort implements AgreementStorePort {",
    "  public Object find() {",
    "    throw new IllegalStateException(\"AgreementStorePort is not configured for production\");",
    "  }",
    "}",
  ].join("\n"));
  const config = writeJava(dir, "AgreementStoreConfiguration.java", [
    "@Configuration",
    "class AgreementStoreConfiguration {",
    "  @Bean",
    "  @ConditionalOnMissingBean(AgreementStorePort.class)",
    "  AgreementStorePort agreementStorePort() { return new FailClosedAgreementStorePort(); }",
    "}",
  ]);
  const validErrors = [];
  gates.checkJavaFailClosedDefaultBackoff([port, demo, failClosed, config], validErrors, path.basename);
  assert.deepStrictEqual(validErrors, []);
}

function testBeanMethodBypass(gates) {
  const dir = temp("bean-bypass");
  const config = writeJava(dir, "BillAutoConfiguration.java", [
    "@Configuration",
    "class BillAutoConfiguration {",
    "  @Bean",
    "  @ConditionalOnBean(BillBusinessPort.class)",
    "  BillConsumeChangeHandler billConsumeChangeHandler() { return new BillConsumeChangeHandler(); }",
    "  @PostConstruct",
    "  public void register() {",
    "    router.registerHandler(\"alipay.commerce.ec.consume.change.notify\", billConsumeChangeHandler());",
    "  }",
    "}",
  ]);
  const errors = [];
  gates.checkSpringBeanMethodBypass([config], errors, path.basename);
  assert.ok(errors.some((error) => /directly calls @Bean method/.test(error)), errors.join("\n"));

  fs.writeFileSync(config, [
    "@Configuration",
    "class BillAutoConfiguration {",
    "  private final ObjectProvider<BillConsumeChangeHandler> handlers;",
    "  BillAutoConfiguration(ObjectProvider<BillConsumeChangeHandler> handlers) { this.handlers = handlers; }",
    "  @Bean",
    "  @ConditionalOnBean(BillBusinessPort.class)",
    "  BillConsumeChangeHandler billConsumeChangeHandler() { return new BillConsumeChangeHandler(); }",
    "  @PostConstruct",
    "  public void register() {",
    "    handlers.ifAvailable(handler -> router.registerHandler(\"alipay.commerce.ec.consume.change.notify\", handler));",
    "  }",
    "}",
  ].join("\n"));
  const validErrors = [];
  gates.checkSpringBeanMethodBypass([config], validErrors, path.basename);
  assert.deepStrictEqual(validErrors, []);
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

  const handler = writeJava(path.join(dir, "src", "main", "java"), "InvoiceNotifyHandler.java", [
    "class InvoiceNotifyHandler {}",
  ]);
  const test = writeJava(path.join(dir, "src", "test", "java"), "ApplicationTest.java", [
    "@SpringBootTest(classes = ApplicationTest.CoreApplication.class)",
    "class ApplicationTest {",
    "  @SpringBootApplication(scanBasePackages = {\"example.config\"})",
    "  static class CoreApplication {}",
    "}",
  ]);
  const restrictedErrors = [];
  gates.checkJavaTestEvidence(dir, [app, handler, test], restrictedErrors);
  assert.ok(restrictedErrors.some((error) => /do not load the real/.test(error)), restrictedErrors.join("\n"));

  fs.writeFileSync(test, [
    "@SpringBootTest(classes = Application.class)",
    "class ApplicationTest {}",
  ].join("\n"));
  const missingRouteErrors = [];
  gates.checkJavaTestEvidence(dir, [app, handler, test], missingRouteErrors);
  assert.ok(missingRouteErrors.some((error) => /does not prove any business notification handler/.test(error)), missingRouteErrors.join("\n"));

  fs.writeFileSync(test, [
    "@SpringBootTest(classes = Application.class)",
    "class ApplicationTest {",
    "  void contextLoads() { assertTrue(router.routes().isEmpty()); }",
    "}",
  ].join("\n"));
  const emptyRouteErrors = [];
  gates.checkJavaTestEvidence(dir, [app, handler, test], emptyRouteErrors);
  assert.ok(emptyRouteErrors.some((error) => /does not prove any business notification handler/.test(error)), emptyRouteErrors.join("\n"));

  fs.writeFileSync(test, [
    "@SpringBootTest(classes = Application.class)",
    "class ApplicationTest {",
    "  @Autowired InvoiceNotifyHandler invoiceNotifyHandler;",
    "}",
  ].join("\n"));
  const validErrors = [];
  gates.checkJavaTestEvidence(dir, [app, handler, test], validErrors);
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
