/**
 * A2M 智能收产品接入示例 - Node.js 版本
 * 
 * 本文件演示完整的智能收产品接入流程：
 * 1. 返回 402 Payment-Needed Header
 * 2. 验证 Payment-Proof 支付凭证
 * 3. 发送履约回执确认
 * 4. 返回资源内容
 * 
 * 依赖安装：
 * npm install express alipay-sdk crypto-js
 */

const express = require('express');
const { AlipaySdk } = require('alipay-sdk');
const crypto = require('crypto');

const app = express();
const PORT = 3000;

// ==================== 配置信息（实际使用时请从配置中心读取）====================
const CONFIG = {
  // 支付宝配置
  alipay: {
    appId: '2026000123456789',
    privateKey: 'MIIEvQIBADANBgkq...', // 请填写您的应用私钥（PKCS#1 格式）
    alipayPublicKey: 'MIIBIjANBgkq...', // 请填写您的支付宝公钥
    gateway: 'https://openapi.alipay.com/gateway.do',
    sellerId: '2088123456789012', // 商户 ID（2088 格式）
    serviceId: 'service_ai_content_001', // 商户服务 ID
    merchantPrivateKey: 'MIIEvQIBADANBgkq...' // 请填写您的应用私钥（用于商家签名）
  },
  // 资源服务配置
  resource: {
    path: '/demo/a2m/resource',
    goodsName: 'AI 生成内容服务'
  }
};

// 初始化支付宝 SDK
const alipaySdk = new AlipaySdk({
  appId: CONFIG.alipay.appId,
  privateKey: CONFIG.alipay.privateKey,
  alipayPublicKey: CONFIG.alipay.alipayPublicKey,
  gateway: CONFIG.alipay.gateway,
});

// ==================== 工具方法 ====================

/**
 * 格式化支付宝时间戳：yyyy-MM-dd HH:mm:ss
 */
function formatAlipayTimestamp(date = new Date()) {
  const pad = (n) => n.toString().padStart(2, '0');
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())} ${pad(date.getHours())}:${pad(date.getMinutes())}:${pad(date.getSeconds())}`;
}

/**
 * 生成商家签名（seller_signature）
 * @param {Object} params - 待签名参数
 * @param {String} privateKey - 商户私钥
 * @returns {String} Base64 编码的签名
 */
function generateSellerSignature(params, privateKey) {
  // 1. 按 key 字典序排序
  const keys = Object.keys(params).sort();
  
  // 2. 拼接签名内容
  const signContent = keys
    .filter(key => params[key] !== null && params[key] !== '')
    .map((key, index) => {
      const value = params[key];
      return `${key}=${value}`;
    })
    .join('&');
  
  // 3. RSA2 签名
  const sign = crypto
    .createSign('RSA-SHA256')
    .update(signContent, 'utf8')
    .sign(privateKey, 'base64');
  
  return sign;
}

/**
 * 格式化日期为 ISO 8601 带时区偏移量格式（如 2026-05-15T12:08:36+08:00）
 * @param {Date} date - 日期对象
 * @returns {String} ISO 8601 带时区偏移量字符串
 */
function formatISO8601WithTimezone(date) {
  const pad = (n) => n.toString().padStart(2, '0');
  const year = date.getFullYear();
  const month = pad(date.getMonth() + 1);
  const day = pad(date.getDate());
  const hours = pad(date.getHours());
  const minutes = pad(date.getMinutes());
  const seconds = pad(date.getSeconds());
  const offset = -date.getTimezoneOffset();
  const offsetHours = pad(Math.floor(Math.abs(offset) / 60));
  const offsetMinutes = pad(Math.abs(offset) % 60);
  const offsetSign = offset >= 0 ? '+' : '-';
  return `${year}-${month}-${day}T${hours}:${minutes}:${seconds}${offsetSign}${offsetHours}:${offsetMinutes}`;
}

/**
 * Base64URL 编码
 */
function base64UrlEncode(str) {
  return Buffer.from(str, 'utf8')
    .toString('base64')
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=/g, '');
}

/**
 * Base64URL 解码
 */
function base64UrlDecode(str) {
  // 补充 padding
  let padding = '=';
  while (str.length % 4) {
    str += padding;
  }
  str = str.replace(/-/g, '+').replace(/_/g, '/');
  return Buffer.from(str, 'base64').toString('utf8');
}

// ==================== 智能收产品接入示例接口 ====================

/**
 * 智能收产品统一接口
 * 
 * 完整流程演示：
 * 1. 不带 Payment-Proof Header：返回 HTTP 402 + Payment-Needed Header
 * 2. 带 Payment-Proof Header：验证支付 → 自动履约 → 返回资源
 * 
 * @route GET /demo/a2m/resource
 * @param {String} Payment-Proof - 支付凭证（从 Header 获取，可选）
 * @returns {Object} 未支付时返回 402，已支付时返回资源内容
 */
app.get(CONFIG.resource.path, async (req, res) => {
  const paymentProof = req.headers['payment-proof'];
  
  // 场景 1：用户未支付，返回 402 + Payment-Needed Header
  if (!paymentProof || paymentProof.trim() === '') {
    return createPaymentRequiredResponse(req, res);
  }
  
  // 场景 2：用户已支付，验证 Payment-Proof 并返回资源
  return verifyPaymentAndDeliverResource(req, res, paymentProof);
});

/**
 * 创建 402 支付请求响应
 */
async function createPaymentRequiredResponse(req, res) {
  try {
    // 1. 构造订单信息
    const outTradeNo = `ORDER_${Date.now()}`;
    const amount = '0.01'; // 单位：元
    const currency = 'CNY';
    const resourceId = CONFIG.resource.path;
    const goodsName = CONFIG.resource.goodsName;
    
    // 2. 计算支付截止时间（30 分钟后），使用带时区偏移量的 ISO 8601 格式
    const payBefore = new Date(Date.now() + 30 * 60 * 1000);
    const payBeforeStr = formatISO8601WithTimezone(payBefore);
    
    // 3. 生成商家签名
    const sellerSignature = generateSellerSignature({
      amount,
      currency,
      goods_name: goodsName,
      out_trade_no: outTradeNo,
      pay_before: payBeforeStr,
      resource_id: resourceId,
      seller_id: CONFIG.alipay.sellerId,
      service_id: CONFIG.alipay.serviceId
    }, CONFIG.alipay.merchantPrivateKey);
    
    // 4. 构造 Payment-Needed Header 内容
    const paymentNeeded = {
      protocol: {
        out_trade_no: outTradeNo,
        amount,
        currency,
        resource_id: resourceId,
        pay_before: payBeforeStr,
        seller_signature: sellerSignature,
        seller_sign_type: 'RSA2',
        seller_unique_id: CONFIG.alipay.sellerId
      },
      method: {
        seller_name: '测试商户',
        seller_id: CONFIG.alipay.sellerId,
        seller_app_id: CONFIG.alipay.appId,
        goods_name: goodsName,
        seller_unique_id_key: 'seller_id',
        service_id: CONFIG.alipay.serviceId
      }
    };
    
    // 5. Base64URL 编码
    const paymentNeededEncoded = base64UrlEncode(JSON.stringify(paymentNeeded));
    
    // 6. 构造 402 响应
    res.set('Payment-Needed', paymentNeededEncoded);
    res.status(402).json({
      code: 'Payment-Needed',
      message: '需要支付',
      out_trade_no: outTradeNo,
      amount,
      currency,
      goods_name: goodsName
    });
    
    console.log(`创建支付订单成功：outTradeNo=${outTradeNo}, amount=${amount}`);
    
  } catch (error) {
    console.error('创建订单失败:', error.message);
    res.status(500).json({
      code: 'CREATE_ORDER_ERROR',
      message: '创建订单失败：' + error.message
    });
  }
}

/**
 * 验证支付凭证并交付资源
 */
async function verifyPaymentAndDeliverResource(req, res, paymentProof) {
  try {
    // 1. 从 Payment-Proof 中解析订单信息
    let paymentProofValue, tradeNo, clientSession;
    
    try {
      const decodedProof = base64UrlDecode(paymentProof);
      const proofJson = JSON.parse(decodedProof);
      
      // 从 protocol 层获取 payment_proof 和 trade_no
      if (proofJson.protocol) {
        paymentProofValue = proofJson.protocol.payment_proof;
        tradeNo = proofJson.protocol.trade_no;
      }
      
      // 从 method 层获取 client_session
      if (proofJson.method) {
        clientSession = proofJson.method.client_session;
      }
      
      // 校验必要字段
      if (!paymentProofValue || paymentProofValue.trim() === '') {
        return res.status(400).json({
          code: 'INVALID_PAYMENT_PROOF_FORMAT',
          message: 'Payment-Proof 格式错误：缺少 payment_proof'
        });
      }
      
      if (!tradeNo || tradeNo.trim() === '') {
        return res.status(400).json({
          code: 'INVALID_PAYMENT_PROOF_FORMAT',
          message: 'Payment-Proof 格式错误：缺少 trade_no'
        });
      }
      
    } catch (error) {
      console.error('Payment-Proof 解析失败:', error.message);
      return res.status(400).json({
        code: 'INVALID_PAYMENT_PROOF_FORMAT',
        message: 'Payment-Proof 格式错误：' + error.message
      });
    }
    
    // 2. 调用支付宝 API 验证支付凭证
    const verifyResponse = await alipaySdk.exec('alipay.aipay.agent.payment.verify', {
      bizContent: {
        payment_proof: paymentProofValue,
        trade_no: tradeNo,
        client_session: clientSession
      }
    });
    
    // 3. 验证失败，返回错误
    // 注意：SDK 返回的响应可能是扁平结构（code/trade_no 在顶层），
    // 也可能嵌套在 alipay_aipay_agent_payment_verify_response 键下，需兼容两种情况
    const responseData = verifyResponse.alipay_aipay_agent_payment_verify_response || verifyResponse;
    if (responseData.code !== '10000') {
      console.error('支付凭证验证失败:', responseData.sub_msg);
      return res.status(400).json({
        code: responseData.sub_code,
        message: responseData.sub_msg
      });
    }
    
    // 4. 验证成功，获取订单信息
    const {
      trade_no: verifyTradeNo,
      out_trade_no: verifyOutTradeNo,
      resource_id: resourceId,
      active
    } = responseData;
    
    console.log(`支付凭证验证成功：tradeNo=${verifyTradeNo}, outTradeNo=${verifyOutTradeNo}`);
    
    // 5. 校验凭证有效性（active=true 表示凭证有效）
    if (active !== true) {
      console.error(`支付凭证无效或已过期：outTradeNo=${verifyOutTradeNo}`);
      return res.status(400).json({
        code: 'INVALID_PAYMENT_PROOF',
        message: '支付凭证无效或已过期'
      });
    }
    
    // 6. 【TODO】查询订单是否存在（以数据库为准）
    // const order = await orderRepository.findByOutTradeNo(verifyOutTradeNo);
    // if (!order) {
    //   return res.status(404).json({
    //     code: 'ORDER_NOT_FOUND',
    //     message: '订单不存在'
    //   });
    // }
    
    // 7. 【TODO】资源防串校验
    // if (resourceId !== order.resourceId) {
    //   return res.status(403).json({
    //     code: 'RESOURCE_ID_MISMATCH',
    //     message: '资源 ID 不匹配，可能存在资源串改风险'
    //   });
    // }
    
    // 8. 【TODO】履约防重放校验（数据库幂等控制）
    // if (order.fulfillStatus === 'FULFILLED') {
    //   return res.status(200).json({
    //     code: 'ALREADY_FULFILLED',
    //     message: '订单已履约，不重复提供',
    //     already_fulfilled: true
    //   });
    // }
    
    // 9. 执行业务逻辑，生成资源内容
    const serviceResult = generateServiceResource(resourceId);
    
    // 10. 【TODO】履约记录落库（用于审计/售后/对账）
    // await fulfillmentRecordRepository.save({ ... });
    
    // 11. 【TODO】更新订单状态
    // await orderRepository.update(verifyOutTradeNo, { 
    //   orderStatus: 'PAID',
    //   fulfillStatus: 'FULFILLED',
    //   tradeNo: verifyTradeNo
    // });
    
    console.log(`履约成功：outTradeNo=${verifyOutTradeNo}, tradeNo=${verifyTradeNo}`);
    
    // 12. 发送履约确认到支付宝
    await sendFulfillmentConfirm(verifyTradeNo);
    
    // 13. 构造 Payment-Validation Header
    const paymentValidation = {
      trade_no: verifyTradeNo,
      out_trade_no: verifyOutTradeNo,
      validated: true,
      resource_id: resourceId
    };
    
    const paymentValidationEncoded = base64UrlEncode(JSON.stringify(paymentValidation));
    res.set('Payment-Validation', paymentValidationEncoded);
    
    // 14. 返回资源内容
    res.json({
      resource_id: resourceId,
      content: serviceResult,
      trade_no: verifyTradeNo,
      out_trade_no: verifyOutTradeNo,
      already_fulfilled: false
    });
    
  } catch (error) {
    console.error('支付凭证验证异常:', error.message);
    res.status(500).json({
      code: 'VERIFY_FAILED',
      message: '支付凭证验证失败：' + error.message
    });
  }
}

/**
 * 生成服务资源内容
 */
function generateServiceResource(resourceId) {
  return JSON.stringify({
    status: 'success',
    service_type: 'AI_CONTENT_GENERATION',
    resource_id: resourceId,
    content: '这是 AI 生成的内容示例，可根据实际业务替换为任意数字服务内容',
    generated_at: formatISO8601WithTimezone(new Date())
  });
}

/**
 * 发送履约确认
 */
async function sendFulfillmentConfirm(tradeNo) {
  try {
    console.log(`开始发送履约确认：tradeNo=${tradeNo}`);
    
    const response = await alipaySdk.exec('alipay.aipay.agent.fulfillment.confirm', {
      bizContent: {
        trade_no: tradeNo
      }
    });
    
    // 注意：SDK 返回的响应可能是扁平结构，也可能嵌套在响应键下，需兼容两种情况
    const responseData = response.alipay_aipay_agent_fulfillment_confirm_response || response;
    if (responseData.code === '10000') {
      console.log(`履约确认成功：tradeNo=${tradeNo}`);
    } else {
      console.error(`履约确认失败：tradeNo=${tradeNo}, errorCode=${responseData.sub_code}, errorMsg=${responseData.sub_msg}`);
    }
    
  } catch (error) {
    console.error(`履约确认异常：tradeNo=${tradeNo}, error=${error.message}`);
  }
}

// ==================== 启动服务 ====================

if (require.main === module) {
  app.listen(PORT, () => {
    console.log(`A2M 智能收服务已启动：http://localhost:${PORT}${CONFIG.resource.path}`);
    console.log('测试步骤：');
    console.log('1. 无 Payment-Proof Header: curl http://localhost:3000/demo/a2m/resource');
    console.log('2. 有 Payment-Proof Header: curl -H "Payment-Proof: <value>" http://localhost:3000/demo/a2m/resource');
  });
}

module.exports = app;
