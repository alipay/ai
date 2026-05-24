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
package com.alipay.aipayweb.demo;

import com.alibaba.fastjson.JSONObject;
import com.alipay.api.AlipayApiException;
import com.alipay.api.AlipayClient;
import com.alipay.api.AlipayConfig;
import com.alipay.api.DefaultAlipayClient;
import com.alipay.api.domain.AlipayAipayAgentFulfillmentConfirmModel;
import com.alipay.api.domain.AlipayAipayAgentPaymentVerifyModel;
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
import java.time.ZoneId;
import java.time.ZonedDateTime;
import java.time.format.DateTimeFormatter;
import java.util.*;

/**
 * A2M智能收产品接入示例 Controller
 * 
 * 本Controller为开发者示例代码，演示完整的智能收产品接入流程：
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
 * 注意：本文档为示例代码，仅用于演示接入流程，开发者需根据实际业务场景进行调整
 * 
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

    public A2MPaymentDemoController() {
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
        alipayConfig.setServerUrl("https://openapi.alipay.com/gateway.do");
        alipayConfig.setAppId("2026000123456789");
        alipayConfig.setPrivateKey("MIIEvQIBADANBgkq..."); // 请填写您的应用私钥
        alipayConfig.setFormat("json");
        alipayConfig.setAlipayPublicKey("MIIBIjANBgkq..."); // 请填写您的支付宝公钥
        alipayConfig.setCharset("UTF-8");
        alipayConfig.setSignType("RSA2");
        return alipayConfig;
    }

    // ==================== 智能收产品接入示例接口 ====================
    
    /**
     * 智能收产品统一接口
     * 
     * 完整流程演示：
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
            String outTradeNo = "ORDER_" + System.currentTimeMillis(); //用户可自定义外部订单号的生成逻辑
            String amount = "0.01"; // 单位：元
            String currency = "CNY"; //固定用CNY
            String resourceId = "/demo/a2m/resource"; //用户可自定义资源id的生成逻辑，用于资源防串
            String goodsName = "AI 生成内容服务"; //用户可自行定义商品名称
            
            // 2. 计算支付截止时间（30分钟后），用户可自行设置
            ZonedDateTime payBefore = ZonedDateTime.now(ZoneId.of("Asia/Shanghai")).plusMinutes(30);
            String payBeforeStr = payBefore.format(DateTimeFormatter.ISO_OFFSET_DATE_TIME);
            
            // 示例逻辑：
            // OrderEntity order = new OrderEntity();
            // order.setOutTradeNo(outTradeNo);
            // order.setAmount(new BigDecimal(amount)));
            // order.setCurrency(currency);
            // order.setResourceId(resourceId);
            // order.setGoodsName(goodsName);
            // order.setPayBefore(payBeforeStr);
            // order.setOrderStatus("INIT");
            // order.setFulfillStatus("UNFULFILLED");
            // order.setCreatedAt(LocalDateTime.now());
            // order.setUpdatedAt(LocalDateTime.now());
            // order.setClientIp(getClientIp()); // 从request获取客户端IP
            // orderRepository.save(order);
            
            // 4. 生成商家签名（需要使用商户私钥）
            // 注意：实际使用时请从配置中读取商户ID和服务ID
            String sellerId = "2088123456789012"; // 商户ID（2088格式）
            String serviceId = "service_ai_content_001"; // 商户服务ID
            
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
            String privateKey = "MIIEvQIBADANBgkq..."; // 请填写您的应用私钥
            String sellerSignature = generateSellerSignature(signParams, privateKey);
            
            // 5. 构造 Payment-Needed Header 内容（分层结构）
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
            method.put("seller_app_id", "2026000123456789"); // 请填写您的 AppId
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
// 1. 从 Payment-Proof 中解析订单信息
            // Payment-Proof 是 Base64URL 编码的 JSON，需要先解码
            // Payment-Proof 结构：{"protocol":{"payment_proof":"xxx","trade_no":"xxx"},"method":{"client_session":"xxx"}}
            String paymentProofValue = null;
            String tradeNo = null;
            String clientSession = null; // 新增：买家客户端会话标识
            try {
                String decodedProof = new String(Base64.getUrlDecoder().decode(paymentProof), StandardCharsets.UTF_8);
                JSONObject proofJson = JSONObject.parseObject(decodedProof);
                
                // 从 protocol 层获取 payment_proof 和 trade_no
                JSONObject protocol = proofJson.getJSONObject("protocol");
                if (protocol != null) {
                    paymentProofValue = protocol.getString("payment_proof");
                    tradeNo = protocol.getString("trade_no");
                }
                
                // 从 method 层获取 client_session（本次新增）
                JSONObject method = proofJson.getJSONObject("method");
                if (method != null) {
                    clientSession = method.getString("client_session");
                }
                
                // 校验必要字段
                if (paymentProofValue == null || paymentProofValue.trim().isEmpty()) {
                    System.err.println("Payment-Proof 中缺少 payment_proof 字段");
                    JSONObject errorResponse = new JSONObject();
                    errorResponse.put("code", "INVALID_PAYMENT_PROOF_FORMAT");
                    errorResponse.put("message", "Payment-Proof 格式错误：缺少 payment_proof");
                    return ResponseEntity.status(HttpStatus.BAD_REQUEST).body(errorResponse);
                }
                
                if (tradeNo == null || tradeNo.trim().isEmpty()) {
                    System.err.println("Payment-Proof 中缺少 trade_no 字段");
                    JSONObject errorResponse = new JSONObject();
                    errorResponse.put("code", "INVALID_PAYMENT_PROOF_FORMAT");
                    errorResponse.put("message", "Payment-Proof 格式错误：缺少 trade_no");
                    return ResponseEntity.status(HttpStatus.BAD_REQUEST).body(errorResponse);
                }
            } catch (Exception e) {
                System.err.println("Payment-Proof 解析失败：" + e.getMessage());
                JSONObject errorResponse = new JSONObject();
                errorResponse.put("code", "INVALID_PAYMENT_PROOF_FORMAT");
                errorResponse.put("message", "Payment-Proof 格式错误：" + e.getMessage());
                return ResponseEntity.status(HttpStatus.BAD_REQUEST).body(errorResponse);
            }
            
            // 2. 调用支付宝 API 验证支付凭证
            // 参考：alipay.aipay.agent.payment.verify（A2A 商户支付凭证验证接口）
            AlipayAipayAgentPaymentVerifyRequest verifyRequest = new AlipayAipayAgentPaymentVerifyRequest();
            AlipayAipayAgentPaymentVerifyModel model = new AlipayAipayAgentPaymentVerifyModel();
            
            // 设置支付凭证和支付宝订单号（均来自用户的 Payment-Proof）
            model.setPaymentProof(paymentProofValue);
            model.setTradeNo(tradeNo);
            model.setClientSession(clientSession);
            
            verifyRequest.setBizModel(model);
            
            AlipayAipayAgentPaymentVerifyResponse verifyResponse = alipayClient.execute(verifyRequest);
            
            // 3. 验证失败，返回错误
            if (!verifyResponse.isSuccess()) {
                System.err.println("支付凭证验证失败: " + verifyResponse.getSubMsg());
                JSONObject errorResponse = new JSONObject();
                errorResponse.put("code", verifyResponse.getSubCode());
                errorResponse.put("message", verifyResponse.getSubMsg());
                return ResponseEntity.status(HttpStatus.BAD_REQUEST).body(errorResponse);
            }
            
            // 4. 验证成功，获取订单信息
            // 注意：验证响应中的订单信息可能与凭证中的信息一致，但仍需从响应中获取以确保安全性
            String verifyTradeNo = verifyResponse.getTradeNo();          // 支付宝订单号
            String verifyOutTradeNo = verifyResponse.getOutTradeNo();   // 商户订单号
            String resourceId = verifyResponse.getResourceId();   // 资源ID
            Boolean active = verifyResponse.getActive();          // 凭证有效标识
            
            System.out.println("支付凭证验证成功: tradeNo=" + verifyTradeNo + ", outTradeNo=" + verifyOutTradeNo);
            
            // 5. 校验凭证有效性（active=true表示凭证有效）
            if (active == null || !active) {
                System.err.println("支付凭证无效或已过期: outTradeNo=" + verifyOutTradeNo);
                JSONObject errorResponse = new JSONObject();
                errorResponse.put("code", "INVALID_PAYMENT_PROOF");
                errorResponse.put("message", "支付凭证无效或已过期");
                return ResponseEntity.status(HttpStatus.BAD_REQUEST).body(errorResponse);
            }
            
            // 6. 查询订单是否存在（以数据库为准）
            // 示例逻辑：
            // OrderEntity order = orderRepository.findByOutTradeNo(outTradeNo).orElse(null);
            // if (order == null) {
            //     System.err.println("订单不存在: outTradeNo=" + outTradeNo);
            //     JSONObject errorResponse = new JSONObject();
            //     errorResponse.put("code", "ORDER_NOT_FOUND");
            //     errorResponse.put("message", "订单不存在");
            //     return ResponseEntity.status(HttpStatus.NOT_FOUND).body(errorResponse);
            // }
            
            // 7. 资源防串校验
            // 商户需要验证resourceId是否与商户系统中该outTradeNo对应的资源一致
            // 防止恶意用户通过篡改resourceId获取其他资源
            // 示例逻辑：
            // if (!resourceId.equals(order.getResourceId())) {
            //     System.err.println("资源ID不匹配，可能存在资源串改风险: orderResourceId=" + order.getResourceId() + 
            //         ", requestResourceId=" + resourceId);
            //     JSONObject errorResponse = new JSONObject();
            //     errorResponse.put("code", "RESOURCE_ID_MISMATCH");
            //     errorResponse.put("message", "资源ID不匹配，可能存在资源串改风险");
            //     return ResponseEntity.status(HttpStatus.FORBIDDEN).body(errorResponse);
            // }
            
            // 8. 履约防重放校验（数据库幂等控制）
            // 商户需要根据outTradeNo查询自己的业务订单，检查是否已经履约
            // 防止重复履约和重复交付资源
            // 示例逻辑：
            // if ("FULFILLED".equals(order.getFulfillStatus())) {
            //     System.out.println("订单已履约，返回历史履约结果: outTradeNo=" + verifyOutTradeNo);
            //     
            //     // 查询历史履约记录
            //     FulfillmentRecordEntity record = fulfillmentRecordRepository
            //         .findTopByOrderNoOrderByCreatedAtDesc(verifyOutTradeNo).orElse(null);
            //     
            //     JSONObject response = new JSONObject();
            //     response.put("code", "ALREADY_FULFILLED");
            //     response.put("message", "订单已履约，不重复提供");
            //     response.put("already_fulfilled", true);
            //     if (record != null) {
            //         response.put("resource_content", record.getServiceResult());
            //         response.put("fulfilled_at", record.getCreatedAt().toString());
            //     }
            //     return ResponseEntity.ok(response);
            // }
            
            // 9. 更新订单状态为已支付
            // 示例逻辑：
            // order.setOrderStatus("PAID");
            // order.setTradeNo(verifyTradeNo); // 保存支付宝订单号
            // order.setPaidAt(LocalDateTime.now());
            // order.setUpdatedAt(LocalDateTime.now());
            // orderRepository.save(order);
            
            // 10. 执行业务逻辑，生成资源内容
            String serviceResult = generateServiceResource(resourceId);
            
            // 11. 履约记录落库（用于审计/售后/对账）
            // 示例逻辑：
            // FulfillmentRecordEntity record = new FulfillmentRecordEntity();
            // record.setOutTradeNo(verifyOutTradeNo);
            // record.setTradeNo(verifyTradeNo);
            // record.setServiceResult(serviceResult);
            // record.setServiceType("AI_CONTENT_GENERATION");
            // record.setCreatedAt(LocalDateTime.now());
            // fulfillmentRecordRepository.save(record);
            
            // 12. 更新订单履约状态
            // 示例逻辑：
            // order.setFulfillStatus("FULFILLED");
            // order.setFulfilledAt(LocalDateTime.now());
            // order.setUpdatedAt(LocalDateTime.now());
            // orderRepository.save(order);
            
            System.out.println("履约成功: outTradeNo=" + verifyOutTradeNo + ", tradeNo=" + verifyTradeNo);
            
            // 13. 发送履约确认到支付宝
            sendFulfillmentConfirm(verifyTradeNo);
            
            // payload 只包含最核心的验证信息
            JSONObject payload = new JSONObject();
            payload.put("trade_no", verifyTradeNo);              // 支付宝订单号
            payload.put("out_trade_no", verifyOutTradeNo);       // 商户订单号
            payload.put("validated", true);                // 验证通过标识
            payload.put("resource_id", resourceId);        // 资源ID（校验用）

            // Base64URL编码
            String paymentValidationEncoded = Base64.getUrlEncoder()
                .withoutPadding()
                .encodeToString(payload.toJSONString().getBytes(StandardCharsets.UTF_8));

            // 14. 返回资源内容
            JSONObject resourceContent = new JSONObject();
            resourceContent.put("resource_id", resourceId);
            resourceContent.put("content", serviceResult);
            resourceContent.put("trade_no", verifyTradeNo);
            resourceContent.put("out_trade_no", verifyOutTradeNo);
            resourceContent.put("already_fulfilled", false);
            
            // 设置 Payment-Validation Header
            HttpHeaders headers = new HttpHeaders();
            headers.set("Payment-Validation", paymentValidationEncoded);
            
            return ResponseEntity.ok()
                .headers(headers)
                .body(resourceContent);
            
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
     */
    private void sendFulfillmentConfirm(String tradeNo) {
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
            } else {
                System.err.println("履约确认失败: tradeNo=" + tradeNo + ", errorCode=" + response.getSubCode() + ", errorMsg=" + response.getSubMsg());
            }
            
        } catch (AlipayApiException e) {
            System.err.println("履约确认异常: tradeNo=" + tradeNo + ", error=" + e.getErrMsg());
        }
    }

    // ==================== 工具方法 ====================
    
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