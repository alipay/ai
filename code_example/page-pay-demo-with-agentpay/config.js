/**
 * 支付宝电脑网站支付 Demo 配置
 *
 * ⚠️ 注意：请勿将真实密钥提交至公共代码仓库
 * 🔒 请按当前应用环境配置网关、回调地址和密钥
 */

module.exports = {
  // 应用 ID
  appId: '',

  // 应用私钥（PKCS#1 格式，Node.js 使用 appPrivateKey）
  // 🔒 禁止将私钥上传至 GitHub、GitLab 等公共代码仓库
  // 🔒 禁止在日志中打印私钥信息
  appPrivateKey: '',

  // 支付宝公钥
  alipayPublicKey:'',

  // 正式网关
  gateway: 'https://openapi.alipay.com/gateway.do',

  // 签名类型
  signType: 'RSA2',

  // 请求超时（毫秒）
  timeout: 15000,

  // 支付成功后同步跳转地址（return_url）
  // ⚠️ return_url 必须传入支付请求，否则可能导致验签失败
  returnUrl: 'http://localhost:3000/return',

  // 异步通知地址（notify_url）
  // ⚠️ notify_url 需要支付宝服务器可访问
  notifyUrl: 'http://localhost:3000/notify',
};
