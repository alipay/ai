# 支付宝电脑网站支付 Demo - 运势预测 (Node.js)

这是一个用于验证支付宝电脑网站支付能力的 Node.js Demo。项目以“今日星座运势预测”作为固定商品，用户先选择 12 星座之一，再支付查看随机抽取的今日运势句；同时提供面向 Agent 智能体的收款接管 Skill。

## 功能概览

| 场景 | 路由 / 文件 | 支付宝能力 | 说明 |
|------|-------------|------------|------|
| 商品页 | `GET /` | - | 选择 12 星座之一，点击后发起支付 |
| 发起支付 | `POST /pay` | `alipay.trade.page.pay` | 校验 `zodiac_sign` 后返回支付宝电脑网站支付 HTML 表单并跳转收银台 |
| 同步返回 | `GET /return` | `alipay.trade.query` | 支付后前台跳回，验签后主动查询交易状态 |
| 异步通知 | `POST /notify` | `notify_url` | 服务端通知入口，需验签并做幂等处理 |
| 交易查询 | `POST /query` | `alipay.trade.query` | 主动查询订单支付状态 |
| 退款 | `POST /refund` | `alipay.trade.refund` | 对已支付订单发起退款 |
| 退款查询 | `POST /refund-query` | `alipay.trade.fastpay.refund.query` | 根据退款请求号查询退款状态 |
| 关闭交易 | `POST /close` | `alipay.trade.close` | 关闭未支付订单 |
| Agent 收款 | `SKILL/` | 电脑网站支付 + `alipay-bot` | 由智能体生成收银台链接并触发支付接管 |

## 快速开始

### 1. 安装依赖

```bash
npm install
```

### 2. 配置支付宝参数

修改 `config.js`：

```js
module.exports = {
  appId: '你的支付宝应用 AppId',
  appPrivateKey: '你的应用私钥',
  alipayPublicKey: '支付宝公钥',
  gateway: 'https://openapi.alipay.com/gateway.do',
  returnUrl: 'http://localhost:3000/return',
  notifyUrl: 'http://localhost:3000/notify',
};
```


本地调试时，`returnUrl` 可以使用 `localhost`；`notifyUrl` 需要支付宝服务器可访问，生产环境请使用公网 HTTPS 地址。

### 3. 启动服务

```bash
npm start
```

启动后访问：

```text
http://localhost:3000
```

选择星座后点击“立即预测”，会创建一笔 `0.01` 元的“今日运势预测”订单，并跳转到支付宝收银台。

## Web 支付流程

1. 用户访问 `GET /`，进入今日星座运势商品页。
2. 用户选择一个星座，页面提交 `POST /pay`，字段为 `zodiac_sign`。
3. 服务端生成商户订单号 `out_trade_no`，调用 `alipaySdk.pageExec('alipay.trade.page.pay', ...)`。
4. 支付宝 SDK 返回自动提交的 HTML 表单，浏览器跳转支付宝收银台。
5. 用户完成支付后跳转 `GET /return`。
6. `/return` 先验签，再调用 `alipay.trade.query` 确认交易状态。
7. 只有 `TRADE_SUCCESS` 或 `TRADE_FINISHED` 才视为支付成功，并展示本次下单时随机抽取的今日运势句。

注意：前台同步返回只能作为用户体验入口，不能直接作为支付成功依据。

## Agent 收款流程

`SKILL/` 目录提供给 Agent 智能体使用的支付 Skill。用户在智能体中明确表达购买、下单或支付今日星座运势商品时，Skill 会：

1. 确认用户给出的星座属于白名单。
2. 检查 `npm` 是否可用。
3. 检查并按需安装 `alipay-bot`。
4. 执行 `SKILL/references/create-cashier-url.js`，请求本地 `POST /pay`。
5. 从返回的支付宝 HTML 表单中解析 `cashier_url`。
6. 调用 `alipay-bot trigger-payment-signal` 生成 `paymentLink`。
7. 将 `paymentLink` 交给支付宝支付处理技能继续完成支付。

本地生成收银台链接可直接运行：

```bash
node SKILL/references/create-cashier-url.js \
  --endpoint http://localhost:3000/pay \
  --zodiac 白羊座
```

返回示例：

```json
{
  "cashier_url": "https://openapi.alipay.com/gateway.do?method=alipay.trade.page.pay&...",
  "zodiac_sign": "白羊座",
  "out_trade_no": "202607031234560001"
}
```

`cashier_url` 只用于后续触发 Agent 支付接管，不代表支付成功。

## 接口说明

### `POST /pay`

创建固定商品订单。请求必须提交 `zodiac_sign`，且值只能是以下之一：

```text
白羊座、金牛座、双子座、巨蟹座、狮子座、处女座、天秤座、天蝎座、射手座、摩羯座、水瓶座、双鱼座
```

订单规则：

- 商品名称：`<星座>今日运势预测`
- 支付金额：`0.01`
- 不接受外部传入 `subject` 或 `total_amount`
- 下单时随机抽取一条今日运势句，并与订单号临时关联

返回支付宝电脑网站支付 HTML 表单。

### `GET /return`

处理支付宝同步跳转：

- 使用 `checkNotifySign` 验签。
- 根据 `out_trade_no` 调用 `alipay.trade.query`。
- 支付成功后展示本次订单关联的今日星座运势结果。

### `POST /notify`

处理支付宝服务端异步通知：

- 必须先验签。
- 必须校验 `app_id`、`out_trade_no`、`total_amount` 等关键字段。
- 业务处理成功后返回字符串 `success`。
- 生产环境必须补充订单落库和幂等处理。

### 交易管理接口

这些接口主要用于调试和验证：

| 路由 | 入参 | 说明 |
|------|------|------|
| `POST /query` | `out_trade_no` | 查询交易状态 |
| `POST /refund` | `out_trade_no`, `refund_amount` | 发起退款 |
| `POST /refund-query` | `out_trade_no`, `out_request_no` | 查询退款状态 |
| `POST /close` | `out_trade_no` | 关闭未支付交易 |

## 项目结构

```text
page-pay-demo-with-agentpay/
├── app.js
├── config.js
├── package.json
├── package-lock.json
├── README.md
└── SKILL/
    ├── SKILL.md
    └── references/
        └── create-cashier-url.js
```

| 文件 | 说明 |
|------|------|
| `app.js` | Express 服务、页面渲染、支付/查询/退款/关闭等路由 |
| `config.js` | 支付宝应用配置、密钥、网关、回调地址 |
| `SKILL/SKILL.md` | Agent 支付接管流程说明 |
| `SKILL/references/create-cashier-url.js` | 请求 `/pay` 并解析支付宝收银台链接的脚本 |

## 安全与上线提醒

- 私钥不能提交到公共仓库，不能写入前端页面，不能打印到日志。
- 生产环境应使用公网 HTTPS 的 `returnUrl` 和 `notifyUrl`。
- 支付成功必须以异步通知或主动查询结果为准，不能只信任 `return_url`。
- 收到异步通知后必须先验签，再校验 `app_id`、订单号、金额和卖家信息。
- 生产环境必须对订单、退款和通知做持久化与幂等处理。
- 未确认支付结果前，不要交付商品，也不要引导用户重复付款。
