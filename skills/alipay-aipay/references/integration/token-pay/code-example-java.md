# Java 官方 SDK 实现示例

Java 和 Spring Boot 项目默认使用支付宝官方 Java SDK。SDK 负责公共参数、RSA2 签名、HTTP 调用和响应反序列化；业务代码只构造 `biz_content`，不要重复实现网关客户端或签名工具。

## 实现原则

- 应用内复用一个 `DefaultAlipayClient`，不要为每次请求重复创建客户端。
- SDK 已提供请求/响应类型的接口直接使用对应类型；当前 SDK 尚未生成类型的新接口，使用实现 `AlipayRequest` 的薄适配器。
- 普通公钥模式使用 `execute`；证书模式使用 `certificateExecute`。
- 密钥、证书路径和 AppID 从密钥管理系统或环境变量注入，不写入代码仓库。
- 只有用户明确要求“不使用 SDK”时，才参考 [non-sdk-integration.md](non-sdk-integration.md) 自行实现 HTTP 和签名。

## Maven 依赖

以下版本已发布到 Maven Central。生产项目应固定到团队验证过的版本，并通过依赖升级流程定期更新，不要使用动态版本。

```xml
<properties>
    <alipay-sdk.version>4.40.272.ALL</alipay-sdk.version>
    <jackson.version>2.17.3</jackson.version>
</properties>

<dependencies>
    <dependency>
        <groupId>com.alipay.sdk</groupId>
        <artifactId>alipay-sdk-java</artifactId>
        <version>${alipay-sdk.version}</version>
    </dependency>
    <dependency>
        <groupId>com.fasterxml.jackson.core</groupId>
        <artifactId>jackson-databind</artifactId>
        <version>${jackson.version}</version>
    </dependency>
</dependencies>
```

Jackson 仅用于安全构造 `biz_content`，网关调用和签名仍全部由支付宝 SDK 完成。

## 初始化并复用客户端

普通公钥模式可将客户端注册为 Spring 单例 Bean：

```java
import com.alipay.api.AlipayClient;
import com.alipay.api.DefaultAlipayClient;
import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Configuration;

@Configuration
public class AlipaySdkConfiguration {

    @Bean
    public AlipayClient alipayClient(AlipayProperties properties) {
        return new DefaultAlipayClient(
                properties.gatewayUrl(),
                properties.appId(),
                properties.privateKey(),
                "json",
                "UTF-8",
                properties.alipayPublicKey(),
                "RSA2"
        );
    }
}
```

`AlipayProperties.gatewayUrl()` 与凭据从同一环境的服务端配置注入。实际执行联调用[订阅沙箱](sandbox/sandbox-integration.md)的网关和凭据，本地模拟替换客户端；[生产配置](production-environment.md)只用于上线准备。不要把真实私钥放入 `application.yml` 或提交到 Git。

## 沙箱客户端的配置来源

沙箱工程先由[公共模块](../sandbox/sandbox-setup-guide.md)完成 ensure。沙箱初始化调用下面的工厂，`projectRoot` 由工程启动配置提供固定绝对路径；生产仍沿用上面的环境配置。只调整凭据读取来源，SDK 和业务接口不变。缺失时失败，不回退到 YAML/.env 中另一套凭据。

```java
import com.alipay.api.AlipayClient;
import com.alipay.api.DefaultAlipayClient;
import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import java.io.IOException;
import java.nio.file.Files;
import java.nio.file.Path;

public final class SandboxClientFactory {
    public static AlipayClient create(Path projectRoot) throws IOException {
        if (!projectRoot.isAbsolute()) throw new IOException("Sandbox project root must be absolute");
        Path file = projectRoot.resolve(".alipay-sandbox.json");
        if (!Files.isRegularFile(file) || Files.isSymbolicLink(file)) {
            throw new IOException("Sandbox config is missing or unsafe");
        }
        JsonNode data = new ObjectMapper().readTree(file.toFile());
        JsonNode app = data.path("appIds").path(0);
        String appId = required(app, "appId");
        String privateKey = required(app, "appPrivateKey");
        String alipayPublicKey = required(app, "alipayPublicKey");
        return new DefaultAlipayClient("https://openapi-sandbox.dl.alipaydev.com/gateway.do",
                appId, privateKey, "json", "UTF-8", alipayPublicKey, "RSA2");
    }

    private static String required(JsonNode object, String name) throws IOException {
        JsonNode value = object.path(name);
        if (!value.isTextual() || value.asText().trim().isEmpty()) {
            throw new IOException("Sandbox config missing field: " + name);
        }
        return value.asText();
    }
}
```

## 新接口 SDK 适配器

截至 `alipay-sdk-java:4.40.272.ALL`，Maven Central 发布包尚未包含商品、价格、客户和订阅新接口的专用请求类。下面的适配器实现 SDK 的 `AlipayRequest` 契约，只声明接口名、`biz_content` 和响应字段；签名、HTTP 和证书处理仍由 `DefaultAlipayClient` 完成。

```java
import com.alipay.api.AlipayObject;
import com.alipay.api.AlipayRequest;
import com.alipay.api.AlipayResponse;
import com.alipay.api.internal.mapping.ApiField;

import java.util.HashMap;
import java.util.Map;

public final class SubscriptionApiRequest
        implements AlipayRequest<SubscriptionApiResponse> {

    private final String apiMethodName;
    private final String bizContent;
    private String apiVersion = "1.0";
    private String terminalType;
    private String terminalInfo;
    private String prodCode;
    private String notifyUrl;
    private String returnUrl;
    private boolean needEncrypt;
    private AlipayObject bizModel;

    public SubscriptionApiRequest(String apiMethodName, String bizContent) {
        this.apiMethodName = apiMethodName;
        this.bizContent = bizContent;
    }

    @Override
    public String getApiMethodName() {
        return apiMethodName;
    }

    @Override
    public Map<String, String> getTextParams() {
        Map<String, String> params = new HashMap<>();
        params.put("biz_content", bizContent);
        return params;
    }

    @Override
    public Class<SubscriptionApiResponse> getResponseClass() {
        return SubscriptionApiResponse.class;
    }

    @Override public String getApiVersion() { return apiVersion; }
    @Override public void setApiVersion(String value) { apiVersion = value; }
    @Override public String getTerminalType() { return terminalType; }
    @Override public void setTerminalType(String value) { terminalType = value; }
    @Override public String getTerminalInfo() { return terminalInfo; }
    @Override public void setTerminalInfo(String value) { terminalInfo = value; }
    @Override public String getProdCode() { return prodCode; }
    @Override public void setProdCode(String value) { prodCode = value; }
    @Override public String getNotifyUrl() { return notifyUrl; }
    @Override public void setNotifyUrl(String value) { notifyUrl = value; }
    @Override public String getReturnUrl() { return returnUrl; }
    @Override public void setReturnUrl(String value) { returnUrl = value; }
    @Override public boolean isNeedEncrypt() { return needEncrypt; }
    @Override public void setNeedEncrypt(boolean value) { needEncrypt = value; }
    @Override public AlipayObject getBizModel() { return bizModel; }
    @Override public void setBizModel(AlipayObject value) { bizModel = value; }
}

public final class SubscriptionApiResponse extends AlipayResponse {

    @ApiField("product_id")
    private String productId;

    @ApiField("price_id")
    private String priceId;

    @ApiField("customer_id")
    private String customerId;

    @ApiField("subscription_id")
    private String subscriptionId;

    @ApiField("pay_amount")
    private String payAmount;

    @ApiField("alipay_schema")
    private String alipaySchema;

    public void setProductId(String value) { productId = value; }
    public String getProductId() { return productId; }
    public void setPriceId(String value) { priceId = value; }
    public String getPriceId() { return priceId; }
    public void setCustomerId(String value) { customerId = value; }
    public String getCustomerId() { return customerId; }
    public void setSubscriptionId(String value) { subscriptionId = value; }
    public String getSubscriptionId() { return subscriptionId; }
    public void setPayAmount(String value) { payAmount = value; }
    public String getPayAmount() { return payAmount; }
    public void setAlipaySchema(String value) { alipaySchema = value; }
    public String getAlipaySchema() { return alipaySchema; }
}
```

实际项目中将两个 `public` 类分别放入 `SubscriptionApiRequest.java` 和 `SubscriptionApiResponse.java`。SDK 后续若发布了这些接口的专用类型，直接替换适配器，业务参数和客户端配置无需改变。

## 商品、价格、客户和订阅

下面的服务复用同一个 SDK 客户端。用户没有提供商品名称或元数据时，商品名默认为 `AI会员专业版`，商品和价格的 `metadata` 均默认为 JSON 字符串 `{"default":"default"}`。

```java
import com.alipay.api.AlipayApiException;
import com.alipay.api.AlipayClient;
import com.alipay.api.AlipayResponse;
import com.fasterxml.jackson.core.JsonProcessingException;
import com.fasterxml.jackson.databind.ObjectMapper;

import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;

public class SubscriptionService {

    private static final String DEFAULT_PRODUCT_NAME = "AI会员专业版";
    private static final String DEFAULT_METADATA = "{\"default\":\"default\"}";

    private final AlipayClient alipayClient;
    private final ObjectMapper objectMapper;

    public SubscriptionService(AlipayClient alipayClient, ObjectMapper objectMapper) {
        this.alipayClient = alipayClient;
        this.objectMapper = objectMapper;
    }

    public String createProduct(String name, String description, String metadata)
            throws AlipayApiException, JsonProcessingException {
        Map<String, Object> biz = new LinkedHashMap<>();
        biz.put("name", defaultIfBlank(name, DEFAULT_PRODUCT_NAME));
        if (description != null && !description.isBlank()) {
            biz.put("description", description);
        }
        biz.put("metadata", defaultIfBlank(metadata, DEFAULT_METADATA));

        SubscriptionApiResponse response = execute("alipay.trade.product.create", biz);
        requireSuccess(response);
        return response.getProductId();
    }

    public String createPrice(String productId, long unitAmount, String metadata)
            throws AlipayApiException, JsonProcessingException {
        Map<String, Object> recurring = Map.of(
                "interval", "MONTH",
                "interval_count", 1
        );
        Map<String, Object> biz = new LinkedHashMap<>();
        biz.put("product_id", productId);
        biz.put("unit_amount", unitAmount);
        biz.put("recurring", recurring);
        biz.put("metadata", defaultIfBlank(metadata, DEFAULT_METADATA));

        SubscriptionApiResponse response = execute("alipay.trade.price.create", biz);
        requireSuccess(response);
        return response.getPriceId();
    }

    public String createCustomer(String name, String email)
            throws AlipayApiException, JsonProcessingException {
        Map<String, Object> biz = Map.of(
                "name", name,
                "email", email
        );

        SubscriptionApiResponse response = execute("alipay.trade.customer.create", biz);
        requireSuccess(response);
        return response.getCustomerId();
    }

    public SubscriptionApiResponse createSubscription(
            String customerId, String priceId) throws AlipayApiException, JsonProcessingException {
        Map<String, Object> item = Map.of("price_id", priceId);
        Map<String, Object> biz = new LinkedHashMap<>();
        biz.put("customer_id", customerId);
        biz.put("items", List.of(item));
        biz.put("subscribe_title", "AI会员专业版-月度订阅");

        SubscriptionApiResponse response = execute("alipay.trade.subscription.create", biz);
        requireSuccess(response);
        return response;
    }

    private SubscriptionApiResponse execute(String method, Map<String, Object> biz)
            throws AlipayApiException, JsonProcessingException {
        SubscriptionApiRequest request = new SubscriptionApiRequest(
                method,
                objectMapper.writeValueAsString(biz)
        );
        return alipayClient.execute(request);
    }

    private static String defaultIfBlank(String value, String defaultValue) {
        return value == null || value.isBlank() ? defaultValue : value;
    }

    private static void requireSuccess(AlipayResponse response) {
        if (!response.isSuccess()) {
            throw new IllegalStateException(
                    response.getSubCode() + ": " + response.getSubMsg()
            );
        }
    }
}
```

调用时保存 `product_id`、`price_id`、`customer_id` 和 `subscription_id`，后续查询、修改、取消及退款必须继续使用同一应用和商户上下文。

## 证书模式

资金支出类接口等要求证书模式时，通过 `CertAlipayRequest` 初始化同一个 `DefaultAlipayClient`，并将请求提交方法改为 `certificateExecute`：

```java
import com.alipay.api.CertAlipayRequest;
import com.alipay.api.DefaultAlipayClient;

CertAlipayRequest config = new CertAlipayRequest();
config.setServerUrl(properties.gatewayUrl());
config.setAppId(properties.appId());
config.setPrivateKey(properties.privateKey());
config.setFormat("json");
config.setCharset("UTF-8");
config.setSignType("RSA2");
config.setCertPath(properties.appCertPath());
config.setAlipayPublicCertPath(properties.alipayPublicCertPath());
config.setRootCertPath(properties.alipayRootCertPath());

DefaultAlipayClient alipayClient = new DefaultAlipayClient(config);
SubscriptionApiResponse response =
        alipayClient.certificateExecute(subscriptionApiRequest);
```

证书文件路径由部署配置注入。不要把证书或私钥打进 JAR。

## 异步通知验签

通知参数必须按原始表单值验签。验签成功后再解析业务 JSON，并基于 `notify_id` 或业务主键幂等处理；处理成功返回纯文本 `success`。

```java
import com.alipay.api.AlipayApiException;
import com.alipay.api.internal.util.AlipaySignature;

import java.util.Map;

public boolean verifyNotification(
        Map<String, String> formParameters,
        String alipayPublicKey) throws AlipayApiException {
    return AlipaySignature.rsaCheckV1(
            formParameters,
            alipayPublicKey,
            "UTF-8",
            "RSA2"
    );
}
```

验签使用支付宝公钥，不是应用公钥；不要先修改、反序列化或重新编码参数再验签。

## 生产接入检查

- 对 SDK 异常、业务失败码、超时和未知结果分别处理；未知结果通过查询接口补偿，不直接重试创建。
- 商品、价格、客户、订阅和通知处理均实现业务幂等。
- 日志不得记录私钥、完整证书内容、用户敏感信息或未经脱敏的请求参数。
- Java SDK 版本固定在依赖管理中，上线前完成兼容性测试和依赖漏洞扫描。
