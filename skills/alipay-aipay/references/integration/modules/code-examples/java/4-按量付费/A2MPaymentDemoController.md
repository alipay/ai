# AI 按量付费完整接入示例 - Java

以下代码展示严格验付和幂等履约的完整控制流。生成项目代码时，请按当前项目结构拆分并绑定真实持久化实现。

```java
/*
 * Copyright (C) 2015-2026 Ant Group
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 *     http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 */
/*
 * 本示例展示 A2M 核心协议、严格验付和幂等履约流程。
 * 必须通过 OrderRepository 绑定项目真实持久化实现；端口未绑定时明确失败，
 * 不使用内存订单、固定资源或验付字段缺失兜底。
 */
package com.alipay.aipayweb.demo;

import com.alibaba.fastjson.JSONObject;
import com.alipay.api.AlipayApiException;
import com.alipay.api.AlipayClient;
import com.alipay.api.AlipayConfig;
import com.alipay.api.DefaultAlipayClient;
import com.alipay.api.domain.AlipayAipayAgentFulfillmentConfirmModel;
import com.alipay.api.internal.util.AlipaySignature;
import com.alipay.api.request.AlipayAipayAgentFulfillmentConfirmRequest;
import com.alipay.api.request.AlipayAipayAgentPaymentVerifyRequest;
import com.alipay.api.response.AlipayAipayAgentFulfillmentConfirmResponse;
import com.alipay.api.response.AlipayAipayAgentPaymentVerifyResponse;
import org.springframework.http.HttpHeaders;
import org.springframework.http.HttpStatus;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.RequestHeader;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;

import java.nio.charset.StandardCharsets;
import java.math.BigDecimal;
import java.time.ZoneId;
import java.time.ZonedDateTime;
import java.time.format.DateTimeFormatter;
import java.util.*;
import java.util.function.Supplier;

/**
 * A2M智能收产品接入示例 Controller
 * 
 * 本Controller为开发者示例代码，演示 A2M 核心协议调用流程：
 * 1. 返回 402 Payment-Needed Header
 * 2. 验证 Payment-Proof 支付凭证
 * 3. 发送履约回执确认
 * 4. 返回资源内容
 *
 * GET /demo/a2m/resource
 *   ├─ 场景1: 无 Payment-Proof Header
 *   │   └─ 返回 402 + Payment-Needed Header
 *   │
 *   └─ 场景2: 有 Payment-Proof Header
 *       ├─ 调用支付宝API验证凭证
 *       ├─ 从响应获取: tradeNo, outTradeNo, resourceId, active
 *       ├─ 校验 active=true (凭证有效性)
 *       ├─ 资源防串校验
 *       ├─ 履约防重放校验
 *       ├─ 发送履约确认
 *       ├─ 返回资源内容
 *
     * OrderRepository 的项目实现必须依赖数据库事务和唯一约束，禁止替换为进程内 Map。
 */
@RestController
@RequestMapping("/demo/a2m")
public class A2MPaymentDemoController {

    // ==================== 配置信息（实际使用时请从配置中心读取）====================
    // 以下配置仅为示例，实际开发时请替换为真实配置或从配置中心读取
    
    /**
     * 支付宝SDK客户端
     */
    private final AlipayClient alipayClient;
    private static final String RESOURCE_PATH = "/demo/a2m/resource";
    private static final String SANDBOX_GATEWAY = "https://openapi-sandbox.dl.alipaydev.com/gateway.do";
    private static final String GATEWAY = System.getenv().getOrDefault("ALIPAY_GATEWAY", SANDBOX_GATEWAY);
    private static final String SERVICE_ID = System.getenv().getOrDefault("ALIPAY_SERVICE_ID", "api_mock_service_id");
    private final OrderRepository orderRepository;

    public A2MPaymentDemoController(OrderRepository orderRepository) {
        this.orderRepository = Objects.requireNonNull(orderRepository, "必须绑定项目真实 OrderRepository");
        // 使用AlipayConfig初始化支付宝客户端（推荐方式）
        try {
            this.alipayClient = new DefaultAlipayClient(getAlipayConfig());
        } catch (AlipayApiException e) {
            throw new RuntimeException("初始化支付宝客户端失败", e);
        }
    }
    
    /**
     * 获取支付宝配置
     * 
     * @return AlipayConfig
     */
    private static AlipayConfig getAlipayConfig() {
        AlipayConfig alipayConfig = new AlipayConfig();
        // 默认用于本 Skill 的快速沙箱联调；生产部署时显式设置 ALIPAY_GATEWAY=https://openapi.alipay.com/gateway.do
        alipayConfig.setServerUrl(GATEWAY);
        alipayConfig.setAppId("<APP_ID>");
        alipayConfig.setPrivateKey("<APP_PRIVATE_KEY>"); // 请填写您的应用私钥
        alipayConfig.setFormat("json");
        alipayConfig.setAlipayPublicKey("<ALIPAY_PUBLIC_KEY>"); // 请填写您的支付宝公钥
        alipayConfig.setCharset("UTF-8");
        alipayConfig.setSignType("RSA2");
        return alipayConfig;
    }

    /**
     * 项目持久化端口。prepareFulfillment 必须在同一事务内校验订单并且只生成一次资源，
     * 返回已持久化的 PENDING_CONFIRM 或 FULFILLED 结果。
     * OrderSnapshot 将支付状态映射为 PENDING_PAYMENT/PAID，
     * 将履约状态映射为 UNFULFILLED/PENDING_CONFIRM/FULFILLED。
     */
    public interface OrderRepository {
        void createPending(OrderSnapshot order);
        OrderSnapshot findByOutTradeNo(String outTradeNo);
        FulfillmentPreparation prepareFulfillment(FulfillmentRequest request);
        void markFulfilled(String outTradeNo, String tradeNo);
    }

    public static final class OrderSnapshot {
        public final String outTradeNo;
        public final String amount;
        public final String currency;
        public final String resourceId;
        public final String goodsName;
        public final String payBefore;
        public final String orderStatus;
        public final String fulfillStatus;

        public OrderSnapshot(String outTradeNo, String amount, String currency, String resourceId,
                             String goodsName, String payBefore, String orderStatus, String fulfillStatus) {
            this.outTradeNo = outTradeNo;
            this.amount = amount;
            this.currency = currency;
            this.resourceId = resourceId;
            this.goodsName = goodsName;
            this.payBefore = payBefore;
            this.orderStatus = orderStatus;
            this.fulfillStatus = fulfillStatus;
        }
    }

    public static final class FulfillmentRequest {
        public final String outTradeNo;
        public final String tradeNo;
        public final String expectedAmount;
        public final String expectedResourceId;
        public final Supplier<String> createResource;

        public FulfillmentRequest(String outTradeNo, String tradeNo, String expectedAmount,
                                  String expectedResourceId, Supplier<String> createResource) {
            this.outTradeNo = outTradeNo;
            this.tradeNo = tradeNo;
            this.expectedAmount = expectedAmount;
            this.expectedResourceId = expectedResourceId;
            this.createResource = createResource;
        }
    }

    public static final class FulfillmentPreparation {
        public final String state;
        public final String serviceResult;

        public FulfillmentPreparation(String state, String serviceResult) {
            this.state = state;
            this.serviceResult = serviceResult;
        }
    }

    // ==================== 智能收产品接入示例接口 ====================
    
    /**
     * 智能收产品统一接口
     * 
     * 核心协议流程演示：
     * 1. 不带 Payment-Proof Header：返回 HTTP 402 + Payment-Needed Header
     * 2. 带 Payment-Proof Header：验证支付 → 自动履约 → 返回资源
     * 
     * @param paymentProof 支付凭证（从Header获取，可选）
     * @return 未支付时返回402，已支付时返回资源内容
     */
    @GetMapping("/resource")
    public ResponseEntity<?> getResource(
            @RequestHeader(value = "Payment-Proof", required = false) String paymentProof) {
        
        // 场景1：用户未支付，返回402 + Payment-Needed Header
        if (paymentProof == null || paymentProof.trim().isEmpty()) {
            return createPaymentRequiredResponse();
        }
        
        // 场景2：用户已支付，验证Payment-Proof并返回资源
        return verifyPaymentAndDeliverResource(paymentProof);
    }
    
    /**
     * 创建402支付请求响应
     *
     * @return 402响应 + Payment-Needed Header
     */
    private ResponseEntity<?> createPaymentRequiredResponse() {
        try {
            // 1. 构造订单信息
            String outTradeNo = "ORDER_" + System.currentTimeMillis() + "_"
                + UUID.randomUUID().toString().replace("-", "").substring(0, 12);
            String amount = "0.01"; // 单位：元
            String currency = "CNY"; //固定用CNY
            String resourceId = RESOURCE_PATH; //用户可自定义资源id的生成逻辑，用于资源防串
            String goodsName = "AI 生成内容服务"; //用户可自行定义商品名称
            
            // 2. 计算支付截止时间（30分钟后），用户可自行设置
            ZonedDateTime payBefore = ZonedDateTime.now(ZoneId.of("Asia/Shanghai")).plusMinutes(30);
            String payBeforeStr = payBefore.format(DateTimeFormatter.ISO_OFFSET_DATE_TIME);
            
            // 3. 生成商家签名（需要使用商户私钥）
            // 注意：实际使用时请从配置中读取商户ID和服务ID
            String sellerId = "<SELLER_ID_2088>"; // 商户ID（2088格式）
            String serviceId = SERVICE_ID;
            
            Map<String, String> signParams = new HashMap<>();
            signParams.put("amount", amount);
            signParams.put("currency", currency);
            signParams.put("goods_name", goodsName);
            signParams.put("out_trade_no", outTradeNo);
            signParams.put("pay_before", payBeforeStr);
            signParams.put("resource_id", resourceId);
            signParams.put("seller_id", sellerId);
            signParams.put("service_id", serviceId);
            
            // 注意：实际使用时需要从配置中读取商户私钥进行签名
            String privateKey = "<APP_PRIVATE_KEY>"; // 请填写您的应用私钥
            String sellerSignature = generateSellerSignature(signParams, privateKey);

            // 4. 必须在返回 402 前持久化；项目实现负责事务与 outTradeNo 唯一约束。
            orderRepository.createPending(new OrderSnapshot(
                outTradeNo, normalizeAmount(amount), currency, resourceId, goodsName, payBeforeStr,
                "PENDING_PAYMENT", "UNFULFILLED"));
            
            // 5. 持久化成功后构造 Payment-Needed Header 内容（分层结构）
            JSONObject paymentNeeded = new JSONObject();
            
            // protocol 层
            JSONObject protocol = new JSONObject();
            protocol.put("out_trade_no", outTradeNo);
            protocol.put("amount", amount);
            protocol.put("currency", currency);
            protocol.put("resource_id", resourceId);
            protocol.put("pay_before", payBeforeStr);
            protocol.put("seller_signature", sellerSignature);
            protocol.put("seller_sign_type", "RSA2");
            protocol.put("seller_unique_id", sellerId);
            
            // method 层
            JSONObject method = new JSONObject();
            method.put("seller_name", "测试商户");
            method.put("seller_id", sellerId);
            method.put("seller_app_id", "<APP_ID>"); // 请填写您的 AppId
            method.put("goods_name", goodsName);
            method.put("seller_unique_id_key", "seller_id"); // 固定用卖家 id
            method.put("service_id", serviceId);
            
            paymentNeeded.put("protocol", protocol);
            paymentNeeded.put("method", method);
            // 6. Base64URL编码
            String paymentNeededEncoded = Base64.getUrlEncoder()
                .withoutPadding()
                .encodeToString(paymentNeeded.toJSONString().getBytes(StandardCharsets.UTF_8));
            
            // 7. 构造402响应
            HttpHeaders headers = new HttpHeaders();
            headers.set("Payment-Needed", paymentNeededEncoded);
            
            JSONObject responseBody = new JSONObject();
            responseBody.put("code", "Payment-Needed");
            responseBody.put("message", "需要支付");
            responseBody.put("out_trade_no", outTradeNo);
            responseBody.put("amount", amount);
            responseBody.put("currency", currency);
            responseBody.put("goods_name", goodsName);

            // 记录日志
            System.out.println("创建支付订单成功: outTradeNo=" + outTradeNo + ", amount=" + amount);
            
            return ResponseEntity.status(HttpStatus.PAYMENT_REQUIRED)
                .headers(headers)
                .body(responseBody);
                
        } catch (AlipayApiException e) {
            System.err.println("签名失败: " + e.getMessage());
            JSONObject errorResponse = new JSONObject();
            errorResponse.put("code", "SIGN_ERROR");
            errorResponse.put("message", "签名失败: " + e.getMessage());
            return ResponseEntity.status(HttpStatus.INTERNAL_SERVER_ERROR).body(errorResponse);
        } catch (Exception e) {
            System.err.println("创建订单失败: " + e.getMessage());
            JSONObject errorResponse = new JSONObject();
            errorResponse.put("code", "CREATE_ORDER_ERROR");
            errorResponse.put("message", "创建订单失败: " + e.getMessage());
            return ResponseEntity.status(HttpStatus.INTERNAL_SERVER_ERROR).body(errorResponse);
        }
    }
    
    /**
     * 验证支付凭证并交付资源
     *
     * @param paymentProof 支付凭证
     * @return 资源内容或错误信息
     */
    private ResponseEntity<?> verifyPaymentAndDeliverResource(String paymentProof) {
        try {
            // 1. Payment-Proof 是 Base64URL 编码的 JSON。
            String paymentProofValue = null;
            String tradeNo = null;
            String clientSession = null;
            try {
                String decodedProof = new String(Base64.getUrlDecoder().decode(paymentProof), StandardCharsets.UTF_8);
                JSONObject proofJson = JSONObject.parseObject(decodedProof);
                JSONObject protocol = proofJson.getJSONObject("protocol");
                if (protocol != null) {
                    paymentProofValue = protocol.getString("payment_proof");
                    tradeNo = protocol.getString("trade_no");
                }
                JSONObject method = proofJson.getJSONObject("method");
                if (method != null) {
                    clientSession = method.getString("client_session");
                }
                if (!hasText(paymentProofValue) || !hasText(tradeNo)) {
                    return createPaymentRequiredResponse();
                }
            } catch (Exception e) {
                System.err.println("Payment-Proof 解析失败：" + e.getMessage());
                return createPaymentRequiredResponse();
            }

            // 2. 调用支付宝 API 验证支付凭证
            AlipayAipayAgentPaymentVerifyRequest verifyRequest = new AlipayAipayAgentPaymentVerifyRequest();
            // 当前已验证 Java SDK 的 Model 未暴露可选 client_session setter，
            // 使用请求自身的结构化 bizContent 能力，避免调用不存在的方法。
            JSONObject verifyBizContent = new JSONObject();
            verifyBizContent.put("payment_proof", paymentProofValue);
            verifyBizContent.put("trade_no", tradeNo);
            if (hasText(clientSession)) {
                verifyBizContent.put("client_session", clientSession);
            }
            verifyRequest.setBizContent(verifyBizContent.toJSONString());
            AlipayAipayAgentPaymentVerifyResponse verifyResponse = alipayClient.execute(verifyRequest);

            if (!verifyResponse.isSuccess()) {
                System.err.println("支付凭证验证失败: " + verifyResponse.getSubMsg());
                return createPaymentRequiredResponse();
            }

            String returnedTradeNo = emptyIfNull(verifyResponse.getTradeNo());
            String verifyOutTradeNo = emptyIfNull(verifyResponse.getOutTradeNo());
            String returnedAmount = emptyIfNull(verifyResponse.getAmount());
            String returnedResourceId = emptyIfNull(verifyResponse.getResourceId());
            Boolean active = verifyResponse.getActive();
            OrderSnapshot order = hasText(verifyOutTradeNo)
                ? orderRepository.findByOutTradeNo(verifyOutTradeNo)
                : null;
            boolean sandboxMode = isExactSandboxMode();
            String verifyTradeNo = hasText(returnedTradeNo) ? returnedTradeNo : (sandboxMode ? tradeNo : "");
            String verifyAmount = hasText(returnedAmount) ? returnedAmount : (sandboxMode && order != null ? order.amount : "");
            String resourceIdVerified = hasText(returnedResourceId)
                ? returnedResourceId
                : (sandboxMode && order != null ? order.resourceId : "");

            if (!Boolean.TRUE.equals(active)
                    || !hasText(verifyTradeNo)
                    || !verifyTradeNo.equals(tradeNo)
                    || !hasText(verifyOutTradeNo)
                    || !hasText(resourceIdVerified)) {
                return createPaymentRequiredResponse();
            }

            boolean amountMatches = order != null && amountsEqual(order.amount, verifyAmount);
            boolean resourceMatches = order != null
                && RESOURCE_PATH.equals(order.resourceId)
                && order.resourceId.equals(resourceIdVerified);
            boolean fulfillmentInProgress = order != null
                && Arrays.asList("PENDING_CONFIRM", "FULFILLED").contains(order.fulfillStatus);
            boolean orderUsable = order != null
                && "CNY".equals(order.currency)
                && Arrays.asList("PENDING_PAYMENT", "PAID").contains(order.orderStatus)
                && Arrays.asList("UNFULFILLED", "PENDING_CONFIRM", "FULFILLED").contains(order.fulfillStatus)
                && (fulfillmentInProgress || isFuture(order.payBefore));
            if (!amountMatches || !resourceMatches || !orderUsable) {
                return createPaymentRequiredResponse();
            }

            FulfillmentPreparation fulfillment = orderRepository.prepareFulfillment(new FulfillmentRequest(
                verifyOutTradeNo,
                verifyTradeNo,
                normalizeAmount(verifyAmount),
                resourceIdVerified,
                () -> generateServiceResource(resourceIdVerified)));
            if (fulfillment == null
                    || !("PENDING_CONFIRM".equals(fulfillment.state) || "FULFILLED".equals(fulfillment.state))
                    || !hasText(fulfillment.serviceResult)) {
                throw new IllegalStateException("OrderRepository.prepareFulfillment 未返回已持久化的履约结果");
            }

            if ("FULFILLED".equals(fulfillment.state)) {
                return sendSuccessfulResource(
                    verifyTradeNo, verifyOutTradeNo, resourceIdVerified, fulfillment.serviceResult, true);
            }

            System.out.println("资源已生成，准备发送履约确认: outTradeNo=" + verifyOutTradeNo
                + ", tradeNo=" + verifyTradeNo);
            boolean fulfillmentConfirmed = sendFulfillmentConfirm(verifyTradeNo);
            if (!fulfillmentConfirmed) {
                JSONObject errorResponse = new JSONObject();
                errorResponse.put("code", "FULFILLMENT_CONFIRM_FAILED");
                errorResponse.put("message", "资源已生成但履约确认失败，请稍后使用同一 Payment-Proof 重试");
                return ResponseEntity.status(HttpStatus.BAD_GATEWAY).body(errorResponse);
            }

            orderRepository.markFulfilled(verifyOutTradeNo, verifyTradeNo);
            return sendSuccessfulResource(
                verifyTradeNo, verifyOutTradeNo, resourceIdVerified, fulfillment.serviceResult, false);
        } catch (AlipayApiException e) {
            System.err.println("支付凭证验证异常: " + e.getErrMsg());
            JSONObject errorResponse = new JSONObject();
            errorResponse.put("code", "VERIFY_FAILED");
            errorResponse.put("message", "支付凭证验证失败: " + e.getErrMsg());
            return ResponseEntity.status(HttpStatus.INTERNAL_SERVER_ERROR).body(errorResponse);
        } catch (Exception e) {
            System.err.println("履约处理异常: " + e.getMessage());
            JSONObject errorResponse = new JSONObject();
            errorResponse.put("code", "FULFILLMENT_ERROR");
            errorResponse.put("message", "履约处理失败: " + e.getMessage());
            return ResponseEntity.status(HttpStatus.INTERNAL_SERVER_ERROR).body(errorResponse);
        }
    }

    private ResponseEntity<?> sendSuccessfulResource(String tradeNo, String outTradeNo,
                                                       String resourceId, String serviceResult,
                                                       boolean alreadyFulfilled) {
        JSONObject payload = new JSONObject();
        payload.put("trade_no", tradeNo);
        payload.put("out_trade_no", outTradeNo);
        payload.put("validated", true);
        payload.put("resource_id", resourceId);
        String paymentValidationEncoded = Base64.getUrlEncoder()
            .withoutPadding()
            .encodeToString(payload.toJSONString().getBytes(StandardCharsets.UTF_8));

        JSONObject resourceContent = new JSONObject();
        resourceContent.put("resource_id", resourceId);
        resourceContent.put("content", serviceResult);
        resourceContent.put("trade_no", tradeNo);
        resourceContent.put("out_trade_no", outTradeNo);
        resourceContent.put("already_fulfilled", alreadyFulfilled);
        resourceContent.put("fulfillment_confirmed", true);

        HttpHeaders headers = new HttpHeaders();
        headers.set("Payment-Validation", paymentValidationEncoded);
        return ResponseEntity.ok().headers(headers).body(resourceContent);
    }
    
    /**
     * 生成服务资源内容
     * 
     * 这里演示生成AI内容。实际项目中可替换为任意数字服务内容，例如：
     * - 报告摘要
     * - 数据下载链接
     * - AI 生成结果
     * - 第三方接口调用额度发放结果
     * 
     * @param resourceId 资源ID
     * @return 服务资源内容
     */
    private String generateServiceResource(String resourceId) {
        // 示例：生成AI内容
        JSONObject result = new JSONObject();
        result.put("status", "success");
        result.put("service_type", "AI_CONTENT_GENERATION");
        result.put("resource_id", resourceId);
        result.put("content", "这是AI生成的内容示例，可根据实际业务替换为任意数字服务内容");
        result.put("generated_at", ZonedDateTime.now(ZoneId.of("Asia/Shanghai")).toString());
        return result.toJSONString();
    }

    // ==================== 3. 发送履约确认 ====================
    
    /**
     * 发送履约确认
     * 
     * 商家向用户交付资源后，调用此接口向支付宝发送履约回执
     *
     * @param tradeNo 支付宝订单号
     * @return 履约确认是否成功
     */
    private boolean sendFulfillmentConfirm(String tradeNo) {
        if (tradeNo == null || tradeNo.trim().isEmpty()) {
            System.err.println("履约确认失败: tradeNo 为空");
            return false;
        }

        try {
            System.out.println("开始发送履约确认: tradeNo=" + tradeNo);
            
            AlipayAipayAgentFulfillmentConfirmRequest request = new AlipayAipayAgentFulfillmentConfirmRequest();
            AlipayAipayAgentFulfillmentConfirmModel model = new AlipayAipayAgentFulfillmentConfirmModel();
            
            // 设置交易号
            model.setTradeNo(tradeNo);
            
            request.setBizModel(model);
            
            AlipayAipayAgentFulfillmentConfirmResponse response = alipayClient.execute(request);
            
            if (response.isSuccess()) {
                System.out.println("履约确认成功: tradeNo=" + tradeNo);
                return true;
            } else {
                System.err.println("履约确认失败: tradeNo=" + tradeNo + ", errorCode=" + response.getSubCode() + ", errorMsg=" + response.getSubMsg());
                return false;
            }
            
        } catch (AlipayApiException e) {
            System.err.println("履约确认异常: tradeNo=" + tradeNo + ", error=" + e.getErrMsg());
            return false;
        }
    }

    // ==================== 工具方法 ====================

    private static boolean hasText(String value) {
        return value != null && !value.trim().isEmpty();
    }

    private static String emptyIfNull(String value) {
        return value == null ? "" : value.trim();
    }

    private static String normalizeAmount(String value) {
        BigDecimal amount = parseAmount(value);
        if (amount == null) {
            throw new IllegalArgumentException("金额格式非法");
        }
        return amount.setScale(2).toPlainString();
    }

    private static boolean amountsEqual(String left, String right) {
        BigDecimal leftAmount = parseAmount(left);
        BigDecimal rightAmount = parseAmount(right);
        return leftAmount != null && rightAmount != null && leftAmount.compareTo(rightAmount) == 0;
    }

    private static BigDecimal parseAmount(String value) {
        if (!hasText(value) || !value.trim().matches("\\d+(?:\\.\\d{1,2})?")) {
            return null;
        }
        try {
            BigDecimal amount = new BigDecimal(value.trim());
            return amount.signum() >= 0 ? amount : null;
        } catch (NumberFormatException e) {
            return null;
        }
    }

    private static boolean isFuture(String value) {
        try {
            return hasText(value) && ZonedDateTime.parse(value).isAfter(ZonedDateTime.now());
        } catch (Exception e) {
            return false;
        }
    }

    private static boolean isExactSandboxMode() {
        return SANDBOX_GATEWAY.equals(GATEWAY) && "api_mock_service_id".equals(SERVICE_ID);
    }
    
    /**
     * 生成商家签名（seller_signature）
     * 
     * 参考文档：第5章节"私钥加签"
     * 
     * @param params 待签名参数
     * @param privateKey 商户私钥
     * @return Base64编码的签名
     * @throws AlipayApiException 签名异常
     */
    private String generateSellerSignature(Map<String, String> params, String privateKey) throws AlipayApiException {
        // 1. 按key字典序排序
        List<String> keys = new ArrayList<>(params.keySet());
        Collections.sort(keys);
        
        // 2. 拼接签名内容
        StringBuilder signContent = new StringBuilder();
        for (int i = 0; i < keys.size(); i++) {
            String key = keys.get(i);
            String value = params.get(key);
            if (value != null && !value.trim().isEmpty()) {
                signContent.append(key).append("=").append(value);
                if (i < keys.size() - 1) {
                    signContent.append("&");
                }
            }
        }
        
        // 3. RSA2签名
        return AlipaySignature.rsaSign(signContent.toString(), privateKey, "UTF-8", "RSA2");
    }
}
```
