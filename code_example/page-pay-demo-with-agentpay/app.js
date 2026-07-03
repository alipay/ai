/**
 * 支付宝电脑网站支付 Demo
 *
 * 功能：
 * 1. 发起支付（alipay.trade.page.pay）- 跳转支付宝收银台
 * 2. 同步返回处理（return_url）
 * 3. 异步通知处理（notify_url）
 * 4. 交易查询（alipay.trade.query）
 * 5. 交易退款（alipay.trade.refund）
 * 6. 退款查询（alipay.trade.fastpay.refund.query）
 * 7. 交易关闭（alipay.trade.close）
 */

const express = require('express');
const { AlipaySdk } = require('alipay-sdk');
const config = require('./config');

const app = express();

// 解析 application/x-www-form-urlencoded（异步通知使用 POST 表单）
app.use(express.urlencoded({ extended: true }));
app.use(express.json());

// 初始化支付宝 SDK
const alipaySdk = new AlipaySdk({
  appId: config.appId,
  privateKey: config.appPrivateKey,       // Node.js 使用 PKCS#1 格式私钥
  alipayPublicKey: config.alipayPublicKey, // 支付宝公钥
  gateway: config.gateway,                // 支付宝网关
  signType: config.signType,              // RSA2
  timeout: config.timeout,                // 请求超时
});

// ==================== 工具函数 ====================

/**
 * 带重试的 SDK exec 调用
 * 网关偶发 504 超时，自动重试最多 3 次
 */
async function execWithRetry(method, params, options = {}, maxRetries = 3) {
  let lastError;
  for (let i = 0; i < maxRetries; i++) {
    try {
      const result = await alipaySdk.exec(method, params, options);
      return result;
    } catch (err) {
      lastError = err;
      // 仅对 504 网关超时或网络错误重试
      const isRetryable = err.message && (
        err.message.includes('504') ||
        err.message.includes('Gateway Time-out') ||
        err.message.includes('HttpClient Request error') ||
        err.message.includes('ECONNRESET') ||
        err.message.includes('ETIMEDOUT')
      );
      if (!isRetryable || i === maxRetries - 1) {
        throw err;
      }
      console.log(`[重试] ${method} 第 ${i + 1} 次请求失败（${err.message.substring(0, 50)}），${(i + 1) * 2} 秒后重试...`);
      await new Promise(resolve => setTimeout(resolve, (i + 1) * 2000));
    }
  }
  throw lastError;
}

/**
 * 生成商户订单号（时间戳 + 随机数）
 */
function generateOutTradeNo() {
  const now = new Date();
  const pad = (n) => n.toString().padStart(2, '0');
  const timestamp = `${now.getFullYear()}${pad(now.getMonth() + 1)}${pad(now.getDate())}${pad(now.getHours())}${pad(now.getMinutes())}${pad(now.getSeconds())}`;
  const random = Math.floor(Math.random() * 10000).toString().padStart(4, '0');
  return `${timestamp}${random}`;
}

/**
 * 格式化时间为支付宝要求的 yyyy-MM-dd HH:mm:ss 格式
 * ⚠️ 禁止使用 ISO 格式（如 toISOString()）
 */
function formatAlipayTimestamp(date) {
  const pad = (n) => n.toString().padStart(2, '0');
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())} ${pad(date.getHours())}:${pad(date.getMinutes())}:${pad(date.getSeconds())}`;
}

const ZODIAC_SIGNS = [
  '白羊座',
  '金牛座',
  '双子座',
  '巨蟹座',
  '狮子座',
  '处女座',
  '天秤座',
  '天蝎座',
  '射手座',
  '摩羯座',
  '水瓶座',
  '双鱼座',
];

const DAILY_FORTUNES = [
  '今天行动力很旺，适合主动推进计划，你迈出的第一步会带来不错的回响。',
  '今天稳定感很强，适合处理重要事项，踏实的选择会帮你积累好运。',
  '今天沟通运在线，一次轻松的交流可能带来新灵感或好机会。',
  '今天适合照顾自己，也适合靠近温暖的人，你会收获被理解的感觉。',
  '今天你的存在感很亮，适合展示能力，别人会更容易看见你的价值。',
  '今天适合整理、复盘和收尾，细节上的小优化会带来明显进展。',
  '今天人际与合作运不错，适合做选择、谈事情，也适合让生活更有美感。',
  '今天直觉很准，适合处理关键问题，你会更清楚自己真正想要什么。',
  '今天新鲜感会带来能量，适合学习、探索或尝试一个新方向。',
  '今天努力会有回报，适合推进目标，认真完成的小事会变成可靠成果。',
  '今天灵感活跃，适合提出新想法，你的独特视角可能带来意外认可。',
  '今天感受力和创造力都很柔软，适合表达心意，也适合做让自己放松的事。',
];

const fortuneOrders = new Map();

function readZodiacSign(req) {
  const value = (req.body && (req.body.zodiac_sign || req.body.zodiacSign)) || '';
  return String(value).trim();
}

function isAllowedZodiacSign(zodiacSign) {
  return ZODIAC_SIGNS.includes(zodiacSign);
}

function pickDailyFortune() {
  return DAILY_FORTUNES[Math.floor(Math.random() * DAILY_FORTUNES.length)];
}

function createFortuneOrder(zodiacSign) {
  return {
    zodiacSign,
    fortune: pickDailyFortune(),
  };
}

function readFortuneOrder(outTradeNo) {
  return fortuneOrders.get(outTradeNo) || {
    zodiacSign: '你的星座',
    fortune: pickDailyFortune(),
  };
}

async function queryTradeByOutTradeNo(outTradeNo) {
  return execWithRetry('alipay.trade.query', {
    bizContent: {
      out_trade_no: outTradeNo,
    },
  });
}

// ==================== 页面路由 ====================

/**
 * 首页 - 运势预测平台
 */
app.get('/', (req, res) => {
  res.send(`
    <!DOCTYPE html>
    <html lang="zh-CN">
    <head>
      <meta charset="UTF-8">
      <meta name="viewport" content="width=device-width, initial-scale=1.0">
      <title>🔮 天机阁 · 运势预测</title>
      <style>
        @import url('https://fonts.googleapis.com/css2?family=Noto+Serif+SC:wght@400;700;900&display=swap');
        * { margin: 0; padding: 0; box-sizing: border-box; }
        body {
          font-family: 'Noto Serif SC', serif;
          min-height: 100vh;
          background: linear-gradient(135deg, #1a0a2e 0%, #16213e 40%, #0f3460 100%);
          color: #e8d5b7;
          display: flex;
          align-items: center;
          justify-content: center;
          overflow: auto;
          padding: 28px 0;
        }

        /* 星空粒子背景 */
        .stars {
          position: fixed; top: 0; left: 0; width: 100%; height: 100%;
          pointer-events: none; z-index: 0;
        }
        .star {
          position: absolute; width: 2px; height: 2px; background: #fff;
          border-radius: 50%; animation: twinkle 3s infinite alternate;
        }
        @keyframes twinkle { 0% { opacity: 0.2; } 100% { opacity: 1; } }

        .container {
          position: relative; z-index: 1;
          max-width: 480px; width: 90%;
          text-align: center;
        }

        /* 主标题 */
        .title-area { margin-bottom: 40px; }
        .title-icon { font-size: 64px; display: block; margin-bottom: 16px; animation: float 3s ease-in-out infinite; }
        @keyframes float { 0%,100% { transform: translateY(0); } 50% { transform: translateY(-10px); } }
        .title { font-size: 36px; font-weight: 900; color: #f0c27f; text-shadow: 0 0 30px rgba(240,194,127,0.4); letter-spacing: 8px; }
        .subtitle { font-size: 14px; color: #a0896e; margin-top: 8px; letter-spacing: 3px; }

        /* 预测卡片 */
        .card {
          background: linear-gradient(145deg, rgba(240,194,127,0.1), rgba(255,255,255,0.05));
          border: 1px solid rgba(240,194,127,0.25);
          border-radius: 16px;
          padding: 36px 28px;
          backdrop-filter: blur(10px);
          box-shadow: 0 8px 32px rgba(0,0,0,0.3), inset 0 1px 0 rgba(240,194,127,0.1);
        }

        .card-desc {
          font-size: 15px; line-height: 1.8; color: #c9b896; margin-bottom: 28px;
        }

        .price-tag {
          display: inline-block;
          background: linear-gradient(135deg, #f0c27f, #d4a056);
          color: #1a0a2e;
          font-size: 28px;
          font-weight: 900;
          padding: 8px 28px;
          border-radius: 30px;
          margin-bottom: 28px;
          box-shadow: 0 4px 15px rgba(240,194,127,0.3);
        }
        .price-tag small { font-size: 14px; font-weight: 400; }

        .zodiac-field {
          margin: 0 0 18px;
          padding: 0;
          border: 0;
          text-align: left;
        }
        .zodiac-label {
          display: block;
          font-size: 13px;
          color: #f0c27f;
          margin-bottom: 10px;
          letter-spacing: 2px;
        }
        .zodiac-grid {
          display: grid;
          grid-template-columns: repeat(3, minmax(0, 1fr));
          gap: 8px;
        }
        .zodiac-option {
          position: relative;
          display: block;
        }
        .zodiac-option input {
          position: absolute;
          opacity: 0;
          pointer-events: none;
        }
        .zodiac-option span {
          display: flex;
          align-items: center;
          justify-content: center;
          min-height: 40px;
          border: 1px solid rgba(240,194,127,0.28);
          border-radius: 10px;
          background: rgba(26,10,46,0.58);
          color: #c9b896;
          font-size: 14px;
          cursor: pointer;
          transition: all 0.2s;
          user-select: none;
        }
        .zodiac-option input:checked + span {
          border-color: #f0c27f;
          background: linear-gradient(135deg, rgba(240,194,127,0.95), rgba(212,160,86,0.95));
          color: #1a0a2e;
          font-weight: 900;
          box-shadow: 0 4px 14px rgba(240,194,127,0.24);
        }
        .zodiac-option input:focus-visible + span {
          outline: 3px solid rgba(240,194,127,0.28);
          outline-offset: 2px;
        }

        .predict-btn {
          display: block;
          width: 100%;
          padding: 16px;
          background: linear-gradient(135deg, #f0c27f, #d4a056);
          color: #1a0a2e;
          border: none;
          border-radius: 12px;
          font-size: 20px;
          font-weight: 900;
          font-family: 'Noto Serif SC', serif;
          letter-spacing: 4px;
          cursor: pointer;
          transition: all 0.3s;
          box-shadow: 0 4px 15px rgba(240,194,127,0.3);
        }
        .predict-btn:hover { transform: translateY(-2px); box-shadow: 0 6px 25px rgba(240,194,127,0.5); }
        .predict-btn:active { transform: translateY(0); }

        .features {
          display: flex; justify-content: space-around; margin-top: 24px;
        }
        .feature { font-size: 12px; color: #a0896e; }
        .feature span { font-size: 20px; display: block; margin-bottom: 4px; }

        .footer {
          margin-top: 30px; font-size: 11px; color: #5a5072; letter-spacing: 1px;
        }
      </style>
    </head>
    <body>
      <div class="stars" id="stars"></div>
      <div class="container">
        <div class="title-area">
          <span class="title-icon">🔮</span>
          <div class="title">天 机 阁</div>
          <div class="subtitle">洞悉天机 · 预知未来 · 逢凶化吉</div>
        </div>

        <div class="card">
          <div class="card-desc">
            千年玄学智慧，融合紫微斗数与奇门遁甲<br>
            为您揭示命运玄机，指引前路方向
          </div>

          <div class="price-tag"><small>仅需</small> ¥0.01 <small>/次</small></div>

          <form action="/pay" method="POST" id="payForm">
            <fieldset class="zodiac-field">
              <legend class="zodiac-label">选择星座</legend>
              <div class="zodiac-grid">
                <label class="zodiac-option"><input type="radio" name="zodiac_sign" value="白羊座" required><span>白羊座</span></label>
                <label class="zodiac-option"><input type="radio" name="zodiac_sign" value="金牛座"><span>金牛座</span></label>
                <label class="zodiac-option"><input type="radio" name="zodiac_sign" value="双子座"><span>双子座</span></label>
                <label class="zodiac-option"><input type="radio" name="zodiac_sign" value="巨蟹座"><span>巨蟹座</span></label>
                <label class="zodiac-option"><input type="radio" name="zodiac_sign" value="狮子座"><span>狮子座</span></label>
                <label class="zodiac-option"><input type="radio" name="zodiac_sign" value="处女座"><span>处女座</span></label>
                <label class="zodiac-option"><input type="radio" name="zodiac_sign" value="天秤座"><span>天秤座</span></label>
                <label class="zodiac-option"><input type="radio" name="zodiac_sign" value="天蝎座"><span>天蝎座</span></label>
                <label class="zodiac-option"><input type="radio" name="zodiac_sign" value="射手座"><span>射手座</span></label>
                <label class="zodiac-option"><input type="radio" name="zodiac_sign" value="摩羯座"><span>摩羯座</span></label>
                <label class="zodiac-option"><input type="radio" name="zodiac_sign" value="水瓶座"><span>水瓶座</span></label>
                <label class="zodiac-option"><input type="radio" name="zodiac_sign" value="双鱼座"><span>双鱼座</span></label>
              </div>
            </fieldset>
            <button type="submit" class="predict-btn">🔮 立即预测</button>
          </form>

          <div class="features">
            <div class="feature"><span>♈</span>选择星座</div>
            <div class="feature"><span>📜</span>今日运势</div>
            <div class="feature"><span>✨</span>随机揭晓</div>
          </div>
        </div>

        <div class="footer">天机阁 · 仅供娱乐 · 结果仅供参考</div>
      </div>

      <script>
        // 生成星空粒子
        var starsEl = document.getElementById('stars');
        for (var i = 0; i < 60; i++) {
          var s = document.createElement('div');
          s.className = 'star';
          s.style.left = Math.random() * 100 + '%';
          s.style.top = Math.random() * 100 + '%';
          s.style.width = s.style.height = (Math.random() * 2 + 1) + 'px';
          s.style.animationDelay = (Math.random() * 3) + 's';
          s.style.animationDuration = (Math.random() * 3 + 2) + 's';
          starsEl.appendChild(s);
        }
      </script>
    </body>
    </html>
  `);
});

// ==================== 支付接口 ====================

const FORTUNE_PRODUCT_SUBJECT = '今日运势预测';
const FORTUNE_PRODUCT_AMOUNT = '0.01';

function hasUnsupportedPayParams(req) {
  const allowedBodyParams = new Set(['zodiac_sign', 'zodiacSign']);
  const bodyKeys = Object.keys(req.body || {});
  const queryKeys = Object.keys(req.query || {});

  return queryKeys.length > 0 || bodyKeys.some((key) => !allowedBodyParams.has(key));
}

/**
 * 发起电脑网站支付
 * 核心 API: alipay.trade.page.pay
 * ⚠️ 必须使用 pageExecute() 方法，不能使用 exec()
 */
app.post('/pay', async (req, res) => {
  let outTradeNo;
  try {
    if (hasUnsupportedPayParams(req)) {
      return res.status(400).send('支付发起失败: /pay 只支持在 POST body 中传入 zodiac_sign');
    }

    const zodiacSign = readZodiacSign(req);
    if (!isAllowedZodiacSign(zodiacSign)) {
      return res.status(400).send(`支付发起失败: zodiac_sign 只能是以下值之一：${ZODIAC_SIGNS.join('、')}`);
    }

    outTradeNo = generateOutTradeNo();
    const fortuneOrder = createFortuneOrder(zodiacSign);
    fortuneOrders.set(outTradeNo, fortuneOrder);
    const productSubject = `${zodiacSign}${FORTUNE_PRODUCT_SUBJECT}`;

    console.log(`[支付] 发起支付: out_trade_no=${outTradeNo}, zodiac_sign=${zodiacSign}, subject=${productSubject}, total_amount=${FORTUNE_PRODUCT_AMOUNT}`);

    // ⚠️ 电脑网站支付必须使用 pageExecute() 方法，返回 HTML 表单
    // ⚠️ 使用 exec() 将无法获取支付表单，是最常见的集成错误
    const result = alipaySdk.pageExec(
      'alipay.trade.page.pay',
      'POST',
      {
        notifyUrl: config.notifyUrl,  // 异步通知地址，必须传入
        returnUrl: config.returnUrl,  // 同步跳转地址，支付宝回调自带 out_trade_no 参数
        bizContent: {
          out_trade_no: outTradeNo,
          total_amount: FORTUNE_PRODUCT_AMOUNT,
          subject: productSubject,
          body: `${zodiacSign}今日运势`,
          product_code: 'FAST_INSTANT_TRADE_PAY', // 电脑网站支付固定值
        },
      }
    );

    // pageExecute 返回的是 HTML 表单字符串，自动提交直接跳转支付宝收银台
    res.send(result);
  } catch (error) {
    if (outTradeNo) {
      fortuneOrders.delete(outTradeNo);
    }
    console.error('[支付] 发起支付失败:', error);
    res.status(500).send(`支付发起失败: ${error.message}`);
  }
});

// ==================== 同步返回 ====================

/**
 * 支付成功后同步跳转（return_url）
 * ⚠️ 前台同步跳转结果不可信，必须以异步通知或查询接口结果为准
 * ⚠️ return_url 处理逻辑中必须主动调用查询接口确认支付结果
 */
app.get('/return', async (req, res) => {
  try {
    console.log('[同步返回] 收到 return_url 回调:', JSON.stringify(req.query));

    // 验签
    const signVerified = alipaySdk.checkNotifySign(req.query);
    if (!signVerified) {
      console.error('[同步返回] 验签失败');
      return res.send('验签失败，支付结果不可信！');
    }

    const outTradeNo = req.query.out_trade_no;
    const tradeNo = req.query.trade_no;

    console.log(`[同步返回] 验签通过: out_trade_no=${outTradeNo}, trade_no=${tradeNo}`);
    console.log('[同步返回] ⚠️ 同步返回结果不可信，正在调用查询接口确认支付结果...');

    // ⚠️ 必须主动调用查询接口确认支付结果，不能仅依赖同步返回
    const queryResult = await queryTradeByOutTradeNo(outTradeNo);

    console.log('[同步返回] 查询接口返回:', JSON.stringify(queryResult));

    if (queryResult.code === '10000') {
      const tradeStatus = queryResult.tradeStatus;
      if (tradeStatus === 'TRADE_SUCCESS' || tradeStatus === 'TRADE_FINISHED') {
        // ⚠️ 只有 TRADE_SUCCESS 或 TRADE_FINISHED 才表示支付成功
        // 运势预测：假装加载10秒后出结果
        const fortuneOrder = readFortuneOrder(outTradeNo);
        const resultPayload = JSON.stringify({
          icon: '✨',
          zodiacSign: fortuneOrder.zodiacSign,
          fortune: fortuneOrder.fortune,
        }).replace(/</g, '\\u003c');

        res.send(`
          <!DOCTYPE html>
          <html lang="zh-CN">
          <head>
            <meta charset="UTF-8">
            <meta name="viewport" content="width=device-width, initial-scale=1.0">
            <title>🔮 天机阁 · 运势推演中</title>
            <style>
              @import url('https://fonts.googleapis.com/css2?family=Noto+Serif+SC:wght@400;700;900&display=swap');
              * { margin: 0; padding: 0; box-sizing: border-box; }
              body {
                font-family: 'Noto Serif SC', serif;
                min-height: 100vh;
                background: linear-gradient(135deg, #1a0a2e 0%, #16213e 40%, #0f3460 100%);
                color: #e8d5b7;
                display: flex; align-items: center; justify-content: center;
              }
              .stars {
                position: fixed; top: 0; left: 0; width: 100%; height: 100%;
                pointer-events: none; z-index: 0;
              }
              .star {
                position: absolute; width: 2px; height: 2px; background: #fff;
                border-radius: 50%; animation: twinkle 3s infinite alternate;
              }
              @keyframes twinkle { 0% { opacity: 0.2; } 100% { opacity: 1; } }

              .container {
                position: relative; z-index: 1;
                max-width: 440px; width: 90%; text-align: center;
              }

              /* 加载阶段 */
              .loading-phase { transition: opacity 0.8s; }
              .loading-phase.hidden { opacity: 0; pointer-events: none; position: absolute; }

              .loading-icon { font-size: 56px; animation: floatSpin 2s ease-in-out infinite; }
              @keyframes floatSpin {
                0%,100% { transform: translateY(0) rotate(0deg); }
                50% { transform: translateY(-8px) rotate(10deg); }
              }

              .loading-title {
                font-size: 24px; font-weight: 900; color: #f0c27f;
                margin: 20px 0 8px; letter-spacing: 4px;
              }
              .loading-subtitle { font-size: 13px; color: #a0896e; margin-bottom: 30px; }

              /* 进度条 */
              .progress-wrap {
                background: rgba(255,255,255,0.08); border-radius: 20px;
                height: 24px; overflow: hidden; position: relative;
                border: 1px solid rgba(240,194,127,0.15);
              }
              .progress-bar {
                height: 100%; width: 0%; border-radius: 20px;
                background: linear-gradient(90deg, #d4a056, #f0c27f, #d4a056);
                background-size: 200% 100%;
                animation: shimmer 1.5s linear infinite;
                transition: width 0.3s ease;
              }
              @keyframes shimmer { 0% { background-position: 200% 0; } 100% { background-position: -200% 0; } }
              .progress-text {
                margin-top: 12px; font-size: 14px; color: #c9b896;
              }

              .loading-steps { margin-top: 28px; text-align: left; }
              .step {
                font-size: 13px; color: #5a5072; padding: 6px 0;
                transition: all 0.5s; display: flex; align-items: center; gap: 8px;
              }
              .step.active { color: #f0c27f; }
              .step.done { color: #7ec699; }
              .step-dot {
                width: 8px; height: 8px; border-radius: 50%;
                background: #5a5072; flex-shrink: 0; transition: all 0.5s;
              }
              .step.active .step-dot { background: #f0c27f; box-shadow: 0 0 8px rgba(240,194,127,0.6); }
              .step.done .step-dot { background: #7ec699; }

              /* 结果阶段 */
              .result-phase {
                opacity: 0; pointer-events: none;
                transition: opacity 1s;
              }
              .result-phase.show { opacity: 1; pointer-events: auto; }

              .result-card {
                background: linear-gradient(145deg, rgba(240,194,127,0.12), rgba(255,255,255,0.05));
                border: 1px solid rgba(240,194,127,0.3);
                border-radius: 16px; padding: 40px 28px;
                backdrop-filter: blur(10px);
                box-shadow: 0 8px 32px rgba(0,0,0,0.3), inset 0 1px 0 rgba(240,194,127,0.1);
              }

              .result-icon {
                font-size: 72px; display: block; margin-bottom: 12px;
                animation: resultPop 0.8s cubic-bezier(0.175, 0.885, 0.32, 1.275);
              }
              @keyframes resultPop {
                0% { transform: scale(0) rotate(-30deg); opacity: 0; }
                60% { transform: scale(1.2) rotate(5deg); }
                100% { transform: scale(1) rotate(0); opacity: 1; }
              }

              .result-label {
                font-size: 12px; color: #a0896e; letter-spacing: 3px; margin-bottom: 8px;
              }
              .result-fortune {
                font-size: 42px; font-weight: 900; color: #f0c27f;
                text-shadow: 0 0 30px rgba(240,194,127,0.5);
                letter-spacing: 6px; margin-bottom: 16px;
              }
              .result-poem {
                font-size: 16px; color: #c9b896; line-height: 1.9;
                border-top: 1px solid rgba(240,194,127,0.15);
                padding-top: 16px; margin-top: 8px;
              }

              .back-btn {
                display: inline-block; margin-top: 24px;
                padding: 12px 32px;
                background: transparent;
                border: 1px solid rgba(240,194,127,0.4);
                color: #f0c27f; border-radius: 30px;
                font-size: 14px; font-family: 'Noto Serif SC', serif;
                text-decoration: none; letter-spacing: 2px;
                transition: all 0.3s;
              }
              .back-btn:hover {
                background: rgba(240,194,127,0.1);
                border-color: #f0c27f;
              }

              /* 彩带粒子 */
              .confetti-container {
                position: fixed; top: 0; left: 0; width: 100%; height: 100%;
                pointer-events: none; z-index: 10; overflow: hidden;
              }
              .confetti {
                position: absolute; top: -10px; width: 10px; height: 10px;
                opacity: 0.8; animation: confettiFall linear forwards;
              }
              @keyframes confettiFall {
                0% { transform: translateY(0) rotate(0deg); opacity: 1; }
                100% { transform: translateY(100vh) rotate(720deg); opacity: 0; }
              }
            </style>
          </head>
          <body>
            <div class="stars" id="stars"></div>

            <div class="container">
              <!-- 加载阶段 -->
              <div class="loading-phase" id="loadingPhase">
                <div class="loading-icon">🔮</div>
                <div class="loading-title">运势推演中</div>
                <div class="loading-subtitle">正在读取今日星象，抽取专属提示…</div>

                <div class="progress-wrap">
                  <div class="progress-bar" id="progressBar"></div>
                </div>
                <div class="progress-text" id="progressText">0%</div>

                <div class="loading-steps">
                  <div class="step" id="step1"><span class="step-dot"></span>确认星座能量…</div>
                  <div class="step" id="step2"><span class="step-dot"></span>同步今日星象…</div>
                  <div class="step" id="step3"><span class="step-dot"></span>抽取运势提示…</div>
                  <div class="step" id="step4"><span class="step-dot"></span>整理行动建议…</div>
                  <div class="step" id="step5"><span class="step-dot"></span>今日运势已生成！</div>
                </div>
              </div>

              <!-- 结果阶段 -->
              <div class="result-phase" id="resultPhase">
                <div class="result-card">
                  <span class="result-icon" id="resultIcon"></span>
                  <div class="result-label">— 今日星座运势 —</div>
                  <div class="result-fortune" id="resultFortune"></div>
                  <div class="result-poem" id="resultPoem"></div>
                </div>
                <a href="/" class="back-btn">🔮 再测一次</a>
              </div>
            </div>

            <div class="confetti-container" id="confettiContainer"></div>

            <script>
              // 星空粒子
              var starsEl = document.getElementById('stars');
              for (var i = 0; i < 40; i++) {
                var s = document.createElement('div'); s.className = 'star';
                s.style.left = Math.random()*100+'%'; s.style.top = Math.random()*100+'%';
                s.style.width = s.style.height = (Math.random()*2+1)+'px';
                s.style.animationDelay = (Math.random()*3)+'s';
                s.style.animationDuration = (Math.random()*3+2)+'s';
                starsEl.appendChild(s);
              }

              // 今日运势结果由服务端在创建订单时随机抽取
              var chosen = ${resultPayload};

              // 10秒加载动画
              var totalMs = 10000;
              var startTime = Date.now();
              var steps = [
                { at: 0, id: 'step1' },
                { at: 2000, id: 'step2' },
                { at: 4500, id: 'step3' },
                { at: 7000, id: 'step4' },
                { at: 9000, id: 'step5' }
              ];
              var stepIdx = 0;

              function updateProgress() {
                var elapsed = Date.now() - startTime;
                var pct = Math.min(elapsed / totalMs, 1);

                document.getElementById('progressBar').style.width = (pct * 100) + '%';
                document.getElementById('progressText').textContent = Math.floor(pct * 100) + '%';

                // 激活步骤
                while (stepIdx < steps.length && elapsed >= steps[stepIdx].at) {
                  var el = document.getElementById(steps[stepIdx].id);
                  el.classList.remove('active');
                  if (stepIdx > 0) {
                    document.getElementById(steps[stepIdx - 1].id).classList.remove('active');
                    document.getElementById(steps[stepIdx - 1].id).classList.add('done');
                  }
                  el.classList.add('active');
                  stepIdx++;
                }

                if (pct < 1) {
                  requestAnimationFrame(updateProgress);
                } else {
                  // 标记最后一步完成
                  var lastStep = document.getElementById(steps[steps.length - 1].id);
                  lastStep.classList.remove('active');
                  lastStep.classList.add('done');

                  setTimeout(showResult, 300);
                }
              }
              requestAnimationFrame(updateProgress);

              function showResult() {
                document.getElementById('loadingPhase').classList.add('hidden');

                document.getElementById('resultIcon').textContent = chosen.icon;
                document.getElementById('resultFortune').textContent = chosen.zodiacSign;

                document.getElementById('resultPoem').textContent = chosen.fortune;

                setTimeout(function() {
                  document.getElementById('resultPhase').classList.add('show');
                  launchConfetti();
                }, 100);
              }

              function launchConfetti() {
                var container = document.getElementById('confettiContainer');
                var colors = ['#f0c27f','#d4a056','#7ec699','#e8d5b7','#ff6b6b','#ffd93d'];
                for (var i = 0; i < 50; i++) {
                  var c = document.createElement('div'); c.className = 'confetti';
                  c.style.left = Math.random()*100+'%';
                  c.style.background = colors[Math.floor(Math.random()*colors.length)];
                  c.style.width = (Math.random()*8+5)+'px';
                  c.style.height = (Math.random()*8+5)+'px';
                  c.style.borderRadius = Math.random() > 0.5 ? '50%' : '2px';
                  c.style.animationDuration = (Math.random()*2+2)+'s';
                  c.style.animationDelay = (Math.random()*1.5)+'s';
                  container.appendChild(c);
                }
              }
            </script>
          </body>
          </html>
        `);
      } else {
        res.send(`
          <!DOCTYPE html>
          <html><head><meta charset="UTF-8"><title>支付结果</title></head>
          <body style="font-family:sans-serif;padding:40px;text-align:center;">
            <h2 style="color:#faad14;">⏳ 交易状态: ${tradeStatus}</h2>
            <p>商户订单号: ${outTradeNo}</p>
            <p>支付宝交易号: ${tradeNo}</p>
            <p><a href="/">返回首页</a></p>
          </body></html>
        `);
      }
    } else {
      res.send(`
        <!DOCTYPE html>
        <html><head><meta charset="UTF-8"><title>支付结果</title></head>
        <body style="font-family:sans-serif;padding:40px;text-align:center;">
          <h2 style="color:#ff4d4f;">❌ 查询失败</h2>
          <p>错误码: ${queryResult.code}</p>
          <p>错误信息: ${queryResult.subMsg || queryResult.msg}</p>
          <p>商户订单号: ${outTradeNo}</p>
          <p><a href="/">返回首页</a></p>
        </body></html>
      `);
    }
  } catch (error) {
    console.error('[同步返回] 处理失败:', error);
    res.status(500).send(`同步返回处理失败: ${error.message}`);
  }
});

// ==================== Agent 支付结果 ====================

/**
 * Agent 支付完成后获取本项目生成的今日星座运势
 * ⚠️ 必须主动查询交易状态，只有支付成功才返回商品内容
 */
app.post('/fortune-result', async (req, res) => {
  try {
    const outTradeNo = String((req.body && req.body.out_trade_no) || '').trim();
    if (!outTradeNo) {
      return res.status(400).json({
        paid: false,
        message: '必须传入 out_trade_no',
      });
    }

    const fortuneOrder = fortuneOrders.get(outTradeNo);
    if (!fortuneOrder) {
      return res.status(404).json({
        paid: false,
        out_trade_no: outTradeNo,
        message: '未找到该订单对应的星座运势，请确认服务未重启且订单号来自本项目下单脚本',
      });
    }

    const queryResult = await queryTradeByOutTradeNo(outTradeNo);
    if (queryResult.code !== '10000') {
      return res.status(502).json({
        paid: false,
        out_trade_no: outTradeNo,
        message: queryResult.subMsg || queryResult.msg || '支付宝交易查询失败',
        alipay_result: queryResult,
      });
    }

    const tradeStatus = queryResult.tradeStatus;
    const paid = tradeStatus === 'TRADE_SUCCESS' || tradeStatus === 'TRADE_FINISHED';
    if (!paid) {
      return res.status(409).json({
        paid: false,
        out_trade_no: outTradeNo,
        trade_status: tradeStatus,
        message: '交易尚未支付成功',
      });
    }

    res.json({
      paid: true,
      out_trade_no: outTradeNo,
      trade_status: tradeStatus,
      zodiac_sign: fortuneOrder.zodiacSign,
      fortune: fortuneOrder.fortune,
    });
  } catch (error) {
    console.error('[Agent结果] 获取运势失败:', error);
    res.status(500).json({
      paid: false,
      message: `获取运势失败: ${error.message}`,
    });
  }
});

// ==================== 异步通知 ====================

/**
 * 异步通知处理（notify_url）
 * ⚠️ 收到异步通知后必须先验签
 * ⚠️ 必须校验 app_id、out_trade_no、total_amount
 * ⚠️ 处理成功后返回字符串 "success"
 * ⚠️ 只有 trade_status 为 TRADE_SUCCESS 或 TRADE_FINISHED 才表示支付成功
 * ⚠️ 必须进行幂等处理，过滤重复通知
 * 注意：notify_url 需要支付宝服务器可访问，请在联调和生产环境检查
 */
app.post('/notify', (req, res) => {
  try {
    console.log('[异步通知] 收到 notify_url 回调:', JSON.stringify(req.body));

    // 第一步：验签
    const signVerified = alipaySdk.checkNotifySign(req.body);
    if (!signVerified) {
      console.error('[异步通知] 验签失败');
      return res.send('failure');
    }

    // 第二步：校验关键业务字段
    const { app_id, out_trade_no, trade_no, trade_status, total_amount, seller_id } = req.body;

    // 校验 app_id 是否为本应用
    if (app_id !== config.appId) {
      console.error(`[异步通知] app_id 不匹配: 期望=${config.appId}, 实际=${app_id}`);
      return res.send('failure');
    }

    console.log(`[异步通知] 验签通过: out_trade_no=${out_trade_no}, trade_no=${trade_no}, trade_status=${trade_status}, total_amount=${total_amount}`);

    // 第三步：根据 trade_status 处理业务
    if (trade_status === 'TRADE_SUCCESS' || trade_status === 'TRADE_FINISHED') {
      // ⚠️ 只有 TRADE_SUCCESS 或 TRADE_FINISHED 才表示支付成功
      // TODO: 在此处添加业务逻辑（更新订单状态等）
      // ⚠️ 注意幂等处理，同一笔通知可能重复发送
      console.log(`[异步通知] ✅ 支付成功: out_trade_no=${out_trade_no}, total_amount=${total_amount}`);
    } else {
      console.log(`[异步通知] 交易状态: ${trade_status}`);
    }

    // 第四步：处理成功后返回 "success"（仅此7个字符）
    res.send('success');
  } catch (error) {
    console.error('[异步通知] 处理失败:', error);
    res.send('failure');
  }
});

// ==================== 交易查询 ====================

/**
 * 交易查询接口
 * API: alipay.trade.query
 * ⚠️ 当未收到异步通知时，必须调用此接口确认订单状态
 */
app.post('/query', async (req, res) => {
  try {
    const { out_trade_no } = req.body;

    console.log(`[查询] 查询交易: out_trade_no=${out_trade_no}`);

    const result = await execWithRetry('alipay.trade.query', {
      bizContent: {
        out_trade_no: out_trade_no,
      },
    });

    console.log('[查询] 查询结果:', JSON.stringify(result));

    if (result.code === '10000') {
      res.send(`
        <!DOCTYPE html>
        <html><head><meta charset="UTF-8"><title>查询结果</title></head>
        <body style="font-family:sans-serif;padding:40px;">
          <h2>🔍 交易查询结果</h2>
          <pre style="background:#f5f5f5;padding:16px;border-radius:4px;overflow:auto;">${JSON.stringify(result, null, 2)}</pre>
          <p><a href="/?out_trade_no=${out_trade_no}">返回首页</a></p>
        </body></html>
      `);
    } else {
      res.send(`
        <!DOCTYPE html>
        <html><head><meta charset="UTF-8"><title>查询结果</title></head>
        <body style="font-family:sans-serif;padding:40px;">
          <h2>❌ 查询失败</h2>
          <pre style="background:#fff2f0;padding:16px;border-radius:4px;overflow:auto;">${JSON.stringify(result, null, 2)}</pre>
          <p><a href="/?out_trade_no=${out_trade_no}">返回首页</a></p>
        </body></html>
      `);
    }
  } catch (error) {
    console.error('[查询] 查询失败:', error);
    res.status(500).send(`查询失败: ${error.message}`);
  }
});

// ==================== 退款 ====================

/**
 * 交易退款接口
 * API: alipay.trade.refund
 */
app.post('/refund', async (req, res) => {
  try {
    const { out_trade_no, refund_amount } = req.body;
    const out_request_no = `RF${generateOutTradeNo()}`; // 退款请求号，同一笔交易多次部分退款必须不同

    console.log(`[退款] 发起退款: out_trade_no=${out_trade_no}, refund_amount=${refund_amount}`);

    const result = await execWithRetry('alipay.trade.refund', {
      bizContent: {
        out_trade_no: out_trade_no,
        refund_amount: refund_amount,
        refund_reason: '测试退款',
        out_request_no: out_request_no,
      },
    });

    console.log('[退款] 退款结果:', JSON.stringify(result));

    if (result.code === '10000') {
      const fundChange = result.fundChange;
      res.send(`
        <!DOCTYPE html>
        <html><head><meta charset="UTF-8"><title>退款结果</title></head>
        <body style="font-family:sans-serif;padding:40px;">
          <h2>💰 退款结果</h2>
          <p>退款状态: ${fundChange === 'Y' ? '✅ 退款成功' : '⚠️ 未发生资金变化'}</p>
          <p>📝 退款请求号: <strong>${out_request_no}</strong>（查询退款状态时需要此编号）</p>
          <pre style="background:#f5f5f5;padding:16px;border-radius:4px;overflow:auto;">${JSON.stringify(result, null, 2)}</pre>
          <p><a href="/?out_trade_no=${out_trade_no}">返回首页</a></p>
        </body></html>
      `);
    } else {
      res.send(`
        <!DOCTYPE html>
        <html><head><meta charset="UTF-8"><title>退款结果</title></head>
        <body style="font-family:sans-serif;padding:40px;">
          <h2>❌ 退款失败</h2>
          <pre style="background:#fff2f0;padding:16px;border-radius:4px;overflow:auto;">${JSON.stringify(result, null, 2)}</pre>
          <p><a href="/?out_trade_no=${out_trade_no}">返回首页</a></p>
        </body></html>
      `);
    }
  } catch (error) {
    console.error('[退款] 退款失败:', error);
    res.status(500).send(`退款失败: ${error.message}`);
  }
});

// ==================== 退款查询 ====================

/**
 * 退款查询接口
 * API: alipay.trade.fastpay.refund.query
 * 查询退款状态，判断退款是否成功：refund_status=REFUND_SUCCESS 表示退款成功
 * 同一笔交易多次部分退款时，通过 out_request_no 区分不同退款请求
 */
app.post('/refund-query', async (req, res) => {
  try {
    const { out_trade_no, out_request_no } = req.body;

    console.log(`[退款查询] 查询退款: out_trade_no=${out_trade_no}, out_request_no=${out_request_no}`);

    const bizContent = {
      out_trade_no: out_trade_no,
      out_request_no: out_request_no, // 必填：退款请求号，同一笔交易多次部分退款时用于区分
    };

    const result = await execWithRetry('alipay.trade.fastpay.refund.query', {
      bizContent: bizContent,
    });

    console.log('[退款查询] 查询结果:', JSON.stringify(result));

    if (result.code === '10000') {
      const refundStatus = result.refundStatus;
      let statusText = '未知';
      if (refundStatus === 'REFUND_SUCCESS') {
        statusText = '✅ 退款成功';
      } else if (refundStatus === 'REFUND_PROCESSING') {
        statusText = '⏳ 退款处理中';
      } else if (!refundStatus && result.refundAmount) {
        // 兼容：部分版本不返回 refundStatus 但有 refundAmount 也表示退款成功
        statusText = '✅ 退款成功（有退款金额）';
      }
      res.send(`
        <!DOCTYPE html>
        <html><head><meta charset="UTF-8"><title>退款查询结果</title></head>
        <body style="font-family:sans-serif;padding:40px;">
          <h2>📋 退款查询结果</h2>
          <p>退款状态: ${statusText}</p>
          <pre style="background:#f5f5f5;padding:16px;border-radius:4px;overflow:auto;">${JSON.stringify(result, null, 2)}</pre>
          <p><a href="/?out_trade_no=${out_trade_no}">返回首页</a></p>
        </body></html>
      `);
    } else {
      res.send(`
        <!DOCTYPE html>
        <html><head><meta charset="UTF-8"><title>退款查询结果</title></head>
        <body style="font-family:sans-serif;padding:40px;">
          <h2>❌ 退款查询失败</h2>
          <pre style="background:#fff2f0;padding:16px;border-radius:4px;overflow:auto;">${JSON.stringify(result, null, 2)}</pre>
          <p><a href="/?out_trade_no=${out_trade_no}">返回首页</a></p>
        </body></html>
      `);
    }
  } catch (error) {
    console.error('[退款查询] 查询失败:', error);
    res.status(500).send(`退款查询失败: ${error.message}`);
  }
});

// ==================== 关闭交易 ====================

/**
 * 交易关闭接口
 * API: alipay.trade.close
 * 用于关闭未支付的订单
 */
app.post('/close', async (req, res) => {
  try {
    const { out_trade_no } = req.body;

    console.log(`[关闭] 关闭交易: out_trade_no=${out_trade_no}`);

    const result = await execWithRetry('alipay.trade.close', {
      bizContent: {
        out_trade_no: out_trade_no,
      },
    });

    console.log('[关闭] 关闭结果:', JSON.stringify(result));

    if (result.code === '10000') {
      res.send(`
        <!DOCTYPE html>
        <html><head><meta charset="UTF-8"><title>关闭结果</title></head>
        <body style="font-family:sans-serif;padding:40px;">
          <h2>🔒 交易关闭结果</h2>
          <p>✅ 交易已关闭</p>
          <pre style="background:#f5f5f5;padding:16px;border-radius:4px;overflow:auto;">${JSON.stringify(result, null, 2)}</pre>
          <p><a href="/?out_trade_no=${out_trade_no}">返回首页</a></p>
        </body></html>
      `);
    } else {
      res.send(`
        <!DOCTYPE html>
        <html><head><meta charset="UTF-8"><title>关闭结果</title></head>
        <body style="font-family:sans-serif;padding:40px;">
          <h2>❌ 关闭失败</h2>
          <pre style="background:#fff2f0;padding:16px;border-radius:4px;overflow:auto;">${JSON.stringify(result, null, 2)}</pre>
          <p><a href="/?out_trade_no=${out_trade_no}">返回首页</a></p>
        </body></html>
      `);
    }
  } catch (error) {
    console.error('[关闭] 关闭失败:', error);
    res.status(500).send(`关闭失败: ${error.message}`);
  }
});

// ==================== 启动服务 ====================

const PORT = 3000;
app.listen(PORT, () => {
  console.log(`
╔══════════════════════════════════════════════╗
║  🖥️  支付宝电脑网站支付 Demo 已启动          ║
║                                              ║
║  📡 访问地址: http://localhost:${PORT}          ║
║                                              ║
║  📋 功能列表:                                ║
║    💳 发起支付: POST /pay                     ║
║    🔍 交易查询: POST /query                   ║
║    💰 退款:     POST /refund                  ║
║    📋 退款查询: POST /refund-query            ║
║    🔒 关闭交易: POST /close                   ║
║    ✨ Agent结果: POST /fortune-result         ║
║    📩 异步通知: POST /notify                  ║
║    🔙 同步返回: GET  /return                  ║
║                                              ║
║  🔗 网关配置来自 config.js                    ║
╚══════════════════════════════════════════════╝
  `);
});
