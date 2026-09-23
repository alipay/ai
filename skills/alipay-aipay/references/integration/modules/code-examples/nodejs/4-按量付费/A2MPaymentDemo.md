# AI 按量付费完整接入示例 - Node.js

以下代码展示严格验付和幂等履约的完整控制流。生成项目代码时，请按当前项目结构拆分并绑定真实持久化实现。

```javascript
/**
 * A2M 智能收产品接入示例 - Node.js 版本
 *
 * 本示例展示 A2M 核心协议、严格验付和幂等履约流程。
 * 必须通过 configureOrderRepository 绑定项目真实持久化实现；
 * 端口未绑定时明确失败，不使用内存订单、固定资源或验付字段缺失兜底。
 * 
 * 本文件演示 A2M 核心协议调用流程：
 * 1. 返回 402 Payment-Needed Header
 * 2. 验证 Payment-Proof 支付凭证
 * 3. 发送履约回执确认
 * 4. 返回资源内容
 * 
 * 依赖安装：
 * npm install express alipay-sdk
 */

const express = require('express');
const { AlipaySdk } = require('alipay-sdk');
const crypto = require('crypto');

const app = express();
const PORT = 3000;

// ==================== 配置信息（实际使用时请从受保护的配置读取）====================
const CONFIG = {
  // 支付宝配置
  alipay: {
    appId: '<APP_ID>', // 运行时映射沙箱 appId
    privateKey: '<APP_PRIVATE_KEY>', // 运行时映射 appPrivatePkcsKey（PKCS#1）
    alipayPublicKey: '<ALIPAY_PUBLIC_KEY>', // 运行时映射 alipayPublicKey
    // 默认用于本 Skill 的快速沙箱联调；生产部署时显式设置 ALIPAY_GATEWAY=https://openapi.alipay.com/gateway.do
    gateway: process.env.ALIPAY_GATEWAY || 'https://openapi-sandbox.dl.alipaydev.com/gateway.do',
    sellerId: '<SELLER_ID_2088>', // 商户 ID（2088 格式）
    serviceId: 'api_mock_service_id', // 仅用于沙箱联调；上线前替换为服务市场真实 serviceId
    merchantPrivateKey: '<APP_PRIVATE_KEY>' // 与 privateKey 使用同一运行时配置，用于商家签名
  },
  // 资源服务配置
  resource: {
    path: '/demo/a2m/resource',
    goodsName: 'AI 生成内容服务'
  }
};

let orderRepository = null;

// 真实实现必须以数据库事务和唯一约束实现以下端口；未绑定时明确失败。
function configureOrderRepository(repository) {
  const requiredMethods = ['createPending', 'findByOutTradeNo', 'prepareFulfillment', 'markFulfilled'];
  if (!repository || requiredMethods.some((name) => typeof repository[name] !== 'function')) {
    throw new Error(`orderRepository 必须实现 ${requiredMethods.join(', ')}`);
  }
  orderRepository = repository;
}

function requireOrderRepository() {
  if (!orderRepository) {
    throw new Error('尚未绑定项目真实 orderRepository，禁止回退到内存订单');
  }
  return orderRepository;
}

const alipaySdk = new AlipaySdk({
  appId: CONFIG.alipay.appId,
  privateKey: CONFIG.alipay.privateKey,
  alipayPublicKey: CONFIG.alipay.alipayPublicKey,
  gateway: CONFIG.alipay.gateway,
  timeout: 30000,
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
  
  // 3. 将裸 PKCS#1 Base64 临时解析为 DER 密钥对象，不修改原始配置。
  const sellerPrivateKey = crypto.createPrivateKey({
    key: Buffer.from(privateKey, 'base64'),
    format: 'der',
    type: 'pkcs1'
  });
  const sign = crypto
    .createSign('RSA-SHA256')
    .update(signContent, 'utf8')
    .sign(sellerPrivateKey, 'base64');
  
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

function normalizeAmount(value) {
  const match = /^(\d+)(?:\.(\d{1,2}))?$/.exec(String(value ?? '').trim());
  if (!match) return null;
  return `${BigInt(match[1]).toString()}.${(match[2] || '').padEnd(2, '0')}`;
}

function amountsEqual(left, right) {
  const leftAmount = normalizeAmount(left);
  const rightAmount = normalizeAmount(right);
  return leftAmount !== null && rightAmount !== null && leftAmount === rightAmount;
}

function isExactSandboxMode() {
  return CONFIG.alipay.gateway === 'https://openapi-sandbox.dl.alipaydev.com/gateway.do'
    && CONFIG.alipay.serviceId === 'api_mock_service_id';
}

/**
 * 智能收产品统一接口
 * 
 * 核心协议流程演示：
 * 1. 不带 Payment-Proof Header：返回 HTTP 402 + Payment-Needed Header
 * 2. 带 Payment-Proof Header：验证支付 → 自动履约 → 返回资源
 * 
 * @route GET /demo/a2m/resource
 * @param {String} Payment-Proof - 支付凭证（从 Header 获取，可选）
 * @returns {Object} 未支付时返回 402，已支付时返回资源内容
 */
app.get(CONFIG.resource.path, async (req, res) => {
  const paymentProof = req.headers['payment-proof'];
  
  if (!paymentProof || paymentProof.trim() === '') {
    return createPaymentRequiredResponse(req, res);
  }
  
  return verifyPaymentAndDeliverResource(req, res, paymentProof);
});

/**
 * 创建 402 支付请求响应
 */
async function createPaymentRequiredResponse(req, res) {
  try {
    const outTradeNo = `ORDER_${Date.now()}_${crypto.randomUUID().replace(/-/g, '').slice(0, 12)}`;
    const amount = '0.01'; // 单位：元
    const currency = 'CNY';
    const resourceId = CONFIG.resource.path;
    const goodsName = CONFIG.resource.goodsName;
    
    const payBefore = new Date(Date.now() + 30 * 60 * 1000);
    const payBeforeStr = formatISO8601WithTimezone(payBefore);
    
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
    
    const order = {
      outTradeNo,
      amount: normalizeAmount(amount),
      currency,
      resourceId,
      goodsName,
      payBefore: payBeforeStr,
      orderStatus: 'PENDING_PAYMENT',
      fulfillStatus: 'UNFULFILLED'
    };
    await requireOrderRepository().createPending(order);

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
    
    const paymentNeededEncoded = base64UrlEncode(JSON.stringify(paymentNeeded));
    
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
    let paymentProofValue, tradeNo, clientSession;
    
    try {
      const decodedProof = base64UrlDecode(paymentProof);
      const proofJson = JSON.parse(decodedProof);
      
      if (proofJson.protocol) {
        paymentProofValue = proofJson.protocol.payment_proof;
        tradeNo = proofJson.protocol.trade_no;
      }
      
      if (proofJson.method) {
        clientSession = proofJson.method.client_session;
      }
      
      if (!paymentProofValue || paymentProofValue.trim() === '') {
        return createPaymentRequiredResponse(req, res);
      }
      
      if (!tradeNo || tradeNo.trim() === '') {
        return createPaymentRequiredResponse(req, res);
      }
      
    } catch (error) {
      console.error('Payment-Proof 解析失败:', error.message);
      return createPaymentRequiredResponse(req, res);
    }
    
    const verifyBizContent = {
      payment_proof: paymentProofValue,
      trade_no: tradeNo
    };
    if (clientSession) {
      verifyBizContent.client_session = clientSession;
    }
    const verifyResponse = await alipaySdk.exec('alipay.aipay.agent.payment.verify', {
      bizContent: verifyBizContent
    });
    
    // SDK 可能返回嵌套响应，也可能直接返回业务字段。
    const nestedResponse = verifyResponse.alipay_aipay_agent_payment_verify_response;
    const responseData = nestedResponse || verifyResponse;

    if (responseData.code !== '10000' && responseData.code !== 10000) {
      const errorCode = responseData.sub_code || responseData.errorCode;
      const errorMessage = responseData.sub_msg || responseData.msg || '支付凭证验证失败';
      console.error('支付凭证验证失败:', errorMessage);
      return createPaymentRequiredResponse(req, res);
    }
    
    // 同时兼容 SDK 的 snake_case 与 camelCase 业务字段。
    const returnedTradeNo = responseData.trade_no || responseData.tradeNo || '';
    const verifyOutTradeNo = responseData.out_trade_no || responseData.outTradeNo || '';
    const returnedAmount = responseData.amount;
    const returnedResourceId = responseData.resource_id || responseData.resourceId || '';
    const active = responseData.active;

    const repository = requireOrderRepository();
    const order = verifyOutTradeNo ? await repository.findByOutTradeNo(verifyOutTradeNo) : null;
    const sandboxMode = isExactSandboxMode();
    const verifyTradeNo = returnedTradeNo || (sandboxMode ? tradeNo : '');
    const verifyAmount = returnedAmount || (sandboxMode && order ? order.amount : '');
    const resourceIdVerified = returnedResourceId || (sandboxMode && order ? order.resourceId : '');

    if (process.env.A2M_DEBUG === 'true') {
      console.log('验付响应字段:', {
        code: responseData.code,
        tradeNo: verifyTradeNo,
        outTradeNo: verifyOutTradeNo,
        resourceId: resourceIdVerified,
        active
      });
    }
    
    console.log(`支付凭证验证成功：tradeNo=${verifyTradeNo}, outTradeNo=${verifyOutTradeNo}`);
    
    if (active !== true || !verifyTradeNo || verifyTradeNo !== tradeNo || !verifyOutTradeNo || !resourceIdVerified) {
      console.error(`支付凭证无效或已过期：outTradeNo=${verifyOutTradeNo}`);
      return createPaymentRequiredResponse(req, res);
    }

    const amountMatches = order && amountsEqual(order.amount, verifyAmount);
    const resourceMatches = order && order.resourceId === resourceIdVerified && resourceIdVerified === CONFIG.resource.path;
    const fulfillmentInProgress = order && ['PENDING_CONFIRM', 'FULFILLED'].includes(order.fulfillStatus);
    const orderUsable = order
      && order.currency === 'CNY'
      && ['PENDING_PAYMENT', 'PAID'].includes(order.orderStatus)
      && ['UNFULFILLED', 'PENDING_CONFIRM', 'FULFILLED'].includes(order.fulfillStatus)
      && (fulfillmentInProgress || Date.parse(order.payBefore) > Date.now());
    if (!amountMatches || !resourceMatches || !orderUsable) {
      return createPaymentRequiredResponse(req, res);
    }

    const fulfillment = await repository.prepareFulfillment({
      outTradeNo: verifyOutTradeNo,
      tradeNo: verifyTradeNo,
      expectedAmount: normalizeAmount(verifyAmount),
      expectedResourceId: resourceIdVerified,
      createResource: () => generateServiceResource(resourceIdVerified)
    });
    if (!fulfillment || !['PENDING_CONFIRM', 'FULFILLED'].includes(fulfillment.state) || !fulfillment.serviceResult) {
      throw new Error('orderRepository.prepareFulfillment 未返回已持久化的履约结果');
    }
    const serviceResult = fulfillment.serviceResult;

    if (fulfillment.state === 'FULFILLED') {
      return sendSuccessfulResource(res, verifyTradeNo, verifyOutTradeNo, resourceIdVerified, serviceResult, true);
    }
    
    const fulfillmentTradeNo = verifyTradeNo;
    console.log(`资源已生成，准备发送履约确认：outTradeNo=${verifyOutTradeNo}, tradeNo=${fulfillmentTradeNo}`);

    const fulfillmentConfirmed = await sendFulfillmentConfirm(fulfillmentTradeNo);
    if (!fulfillmentConfirmed) {
      return res.status(502).json({
        code: 'FULFILLMENT_CONFIRM_FAILED',
        message: '资源已生成但履约确认失败，请稍后使用同一 Payment-Proof 重试'
      });
    }

    await repository.markFulfilled(verifyOutTradeNo, fulfillmentTradeNo);

    console.log(`履约确认成功：outTradeNo=${verifyOutTradeNo}, tradeNo=${fulfillmentTradeNo}`);
    
    return sendSuccessfulResource(res, fulfillmentTradeNo, verifyOutTradeNo, resourceIdVerified, serviceResult, false);
    
  } catch (error) {
    console.error('支付凭证验证异常:', error.message);
    res.status(500).json({
      code: 'VERIFY_FAILED',
      message: '支付凭证验证失败：' + error.message
    });
  }
}

function sendSuccessfulResource(res, tradeNo, outTradeNo, resourceId, serviceResult, alreadyFulfilled) {
  res.set('Payment-Validation', base64UrlEncode(JSON.stringify({
    trade_no: tradeNo,
    out_trade_no: outTradeNo,
    validated: true,
    resource_id: resourceId
  })));
  return res.json({
    resource_id: resourceId,
    content: serviceResult,
    trade_no: tradeNo,
    out_trade_no: outTradeNo,
    already_fulfilled: alreadyFulfilled,
    fulfillment_confirmed: true
  });
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
  if (!tradeNo) {
    console.error('履约确认失败：tradeNo 为空');
    return false;
  }

  try {
    console.log(`开始发送履约确认：tradeNo=${tradeNo}`);
    
    const response = await alipaySdk.exec('alipay.aipay.agent.fulfillment.confirm', {
      bizContent: {
        trade_no: tradeNo
      }
    });
    
    // 注意：SDK 返回的响应可能是扁平结构，也可能嵌套在响应键下，需兼容两种情况
    const responseData = response.alipay_aipay_agent_fulfillment_confirm_response || response;
    if (responseData.code === '10000' || responseData.code === 10000) {
      console.log(`履约确认成功：tradeNo=${tradeNo}`);
      return true;
    } else {
      const errorCode = responseData.sub_code || responseData.errorCode;
      const errorMessage = responseData.sub_msg || responseData.msg || '履约确认失败';
      console.error(`履约确认失败：tradeNo=${tradeNo}, errorCode=${errorCode}, errorMsg=${errorMessage}`);
      return false;
    }
    
  } catch (error) {
    console.error(`履约确认异常：tradeNo=${tradeNo}, error=${error.message}`);
    return false;
  }
}

if (require.main === module) {
  app.listen(PORT, () => {
    console.log(`A2M 按量付费服务已启动：http://localhost:${PORT}${CONFIG.resource.path}`);
    console.log('测试步骤：');
    console.log('1. 无 Payment-Proof Header: curl http://localhost:3000/demo/a2m/resource');
    console.log('2. 有 Payment-Proof Header: curl -H "Payment-Proof: <value>" http://localhost:3000/demo/a2m/resource');
  });
}

module.exports = { app, configureOrderRepository };
```
