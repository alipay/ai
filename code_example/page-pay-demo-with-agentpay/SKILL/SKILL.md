---
name: fortune-prediction-payment
description: 今日星座运势商品下单与支付宝支付接管 Skill。用于用户明确要购买、下单或支付今日星座运势商品时，先确认用户给出的星座属于白羊座、金牛座、双子座、巨蟹座、狮子座、处女座、天秤座、天蝎座、射手座、摩羯座、水瓶座、双鱼座之一，再校验 `npm` 可用和 `alipay-bot` CLI 已安装，未安装时执行 `npx -y @alipay/agent-payment@latest install`，再调用本 Skill 的 `references/create-cashier-url.js` 脚本并传入 `--endpoint` 与 `--zodiac`，由脚本请求本地标准电脑网站支付接口 `POST /pay` 并解析支付宝收银台链接，再调用 `alipay-bot trigger-payment-signal` 生成 `paymentLink`，交给支付宝支付处理技能完成支付。支付成功后必须调用 `references/get-fortune-result.js`，用本次 `out_trade_no` 从项目结果接口取回 `zodiac_sign` 和 `fortune`，只交付该接口返回的内容，不要自行生成运势。
---

# 今日星座运势商品支付

## 触发条件

仅当用户明确表达购买、下单或支付今日星座运势商品时使用本 Skill。

如果用户只是咨询今日运势、星座、塔罗、八字、抽签等内容，且没有购买或支付意图，不要调用下单接口。

用户必须明确给出以下星座之一：白羊座、金牛座、双子座、巨蟹座、狮子座、处女座、天秤座、天蝎座、射手座、摩羯座、水瓶座、双鱼座。如果用户没有给出星座，或给出的值不在列表中，先要求用户从该列表中选择一个星座，不要下单。

## Prerequisite

在调用 `alipay-bot trigger-payment-signal` 前必须完成：

1. 执行 `npm --version`，确认 `npm` 命令可用；如果不可用，停止流程并说明缺少 `npm`。
2. 执行 `which alipay-bot`，确认 `alipay-bot` CLI 已安装。
3. 如果 `which alipay-bot` 找到可执行文件，跳过安装。
4. 如果未找到 `alipay-bot`，执行：

```bash
npx -y @alipay/agent-payment@latest install
```

## 参数说明

调用下单脚本时必须传入以下参数：

| 参数 | 是否必填 | 说明 |
|------|----------|------|
| `--endpoint` | 是 | 本地电脑网站支付接口地址，默认使用 `http://localhost:3000/pay` |
| `--zodiac` | 是 | 用户选择的星座，必须使用下方可选值之一 |

`--zodiac` 可选值如下，传参时必须逐字使用这些中文值：

```text
白羊座
金牛座
双子座
巨蟹座
狮子座
处女座
天秤座
天蝎座
射手座
摩羯座
水瓶座
双鱼座
```

如果用户只说“白羊”“金牛”等简称，可先规范为对应的完整值（如“白羊座”“金牛座”）再传入 `--zodiac`。如果无法判断用户选择的是哪一个星座，必须先追问，不要下单。

## 下单脚本

使用本 Skill 自带脚本生成支付宝收银台链接。脚本会请求 `--endpoint` 指定的标准电脑网站支付接口`POST /pay`，并提交 `--zodiac` 指定的星座（底层代码实现是`alipaySdk.pageExec(
      'alipay.trade.page.pay',..)`），读取返回的 HTML 表单，并输出包含 `cashier_url` 的 JSON。

在本 Skill 目录执行：

```bash
node references/create-cashier-url.js \
  --endpoint http://localhost:3000/pay \
  --zodiac 白羊座
```

如果当前工作目录不是本 Skill 目录，使用 `SKILL.md` 所在目录下的脚本绝对路径。

脚本返回 JSON。必须从返回 JSON 中读取 `cashier_url` 字段，作为支付宝收银台链接；同时保存 `out_trade_no` 和 `result_endpoint`，用于支付成功后获取本项目生成的运势内容。

示例返回结构类似：

```json
{
  "out_trade_no": "20260628xxxxxx",
  "zodiac_sign": "白羊座",
  "result_endpoint": "http://localhost:3000/fortune-result",
  "cashier_url": "https://openapi.alipay.com/gateway.do?method=alipay.trade.page.pay&..."
}
```

其中 `cashier_url` 的完整原始值就是后续传给 `alipay-bot trigger-payment-signal` 的 `<alipay_cashier_url>`。

`out_trade_no` 只用于商户侧订单追踪，不代表支付成功，不要传给支付宝支付处理技能。

## 支付后取结果脚本

支付成功后，必须调用本 Skill 自带脚本获取项目后端生成的今日星座运势：

```bash
node references/get-fortune-result.js \
  --endpoint http://localhost:3000/fortune-result \
  --out-trade-no "<out_trade_no>"
```

实际执行时：

- `--endpoint` 优先使用下单脚本返回的 `result_endpoint`。
- `--out-trade-no` 必须使用下单脚本返回的本次 `out_trade_no`。
- 只有支付宝支付处理技能明确返回成功后，才能调用该脚本。
- 只允许交付该脚本返回 JSON 中的 `zodiac_sign` 和 `fortune`，不要自行生成、改写或补充其它运势内容。

示例返回结构类似：

```json
{
  "paid": true,
  "out_trade_no": "20260628xxxxxx",
  "trade_status": "TRADE_SUCCESS",
  "zodiac_sign": "白羊座",
  "fortune": "今天行动力很旺，适合主动推进计划，你迈出的第一步会带来不错的回响。"
}
```

## 支付流程

1. 完成“Prerequisite”，确认 `npm` 可用且 `alipay-bot` CLI 已安装。
2. 调用 `references/create-cashier-url.js` 脚本，传入 `--endpoint` 和 `--zodiac`；`--zodiac` 必须使用用户明确选择的星座。
3. 从脚本返回 JSON 中读取非空 `cashier_url`，并保存本次 `out_trade_no`、`zodiac_sign` 和 `result_endpoint`。
4. 校验 `cashier_url` 必须指向支付宝开放平台网关：域名为 `openapi.alipay.com`，路径为 `/gateway.do`；否则停止。
5. 调用 `alipay-bot trigger-payment-signal`。

```bash
alipay-bot trigger-payment-signal \
  --payment-link "<cashier_url>" \
  --merchant-info "<星座>今日运势预测" \
  --amount "0.01"
```

6. 从 `trigger-payment-signal` 返回 JSON 中读取非空 `paymentLink`。
7. 立即加载支付宝支付处理技能，并把完整原始 `paymentLink` 传给该技能。
8. 支付宝支付处理技能返回成功前，不要交付运势预测结果，也不要声明支付成功。
9. 支付成功后，调用 `references/get-fortune-result.js`，传入下单脚本返回的 `result_endpoint` 和 `out_trade_no`。
10. 从结果脚本返回 JSON 中读取 `zodiac_sign` 和 `fortune`，并把这两个字段原样交付给用户。

## 支付接管规则

- 每次购买都必须重新调用脚本，并从本次返回 JSON 中读取新的 `cashier_url`。
- 每次购买都必须传入用户本次选择的合法星座，不要替用户编造或改写星座。
- 支付成功后的内容必须来自 `references/get-fortune-result.js` 的返回结果。
- 不要自行生成、扩写、润色、替换或重新随机今日星座运势内容。
- 不要在支付成功前调用结果脚本，也不要在支付成功前交付 `fortune`。
- 不要把示例响应中的 `cashier_url` 写死到流程中；该链接包含时间戳和签名，可能已过期。
- 不要自行改写脚本输出的 `cashier_url`；只做前缀校验。
- 只把 `trigger-payment-signal` 返回 JSON 中的 `paymentLink` 传给支付宝支付处理技能。
- 必须逐字符完整保留 `paymentLink` 原始值。
- 不要打开、展示、改写、重新编码、压缩、截断或转换 `paymentLink`。
- 不要把脚本返回的 `cashier_url` 直接交给支付宝支付处理技能。
- 如果没有拿到非空 `paymentLink`，视为失败并停止流程。

## 失败处理

- `npm` 不可用：停止流程，说明本机缺少 `npm`。
- `alipay-bot` 未安装且执行 `npx -y @alipay/agent-payment@latest install` 失败：停止流程，说明支付宝支付接管 CLI 安装失败。
- 用户未给出合法星座：先要求用户从 12 星座中选择一个，不要下单。
- 脚本执行失败：停止流程，说明今日星座运势商品下单失败。
- 脚本没有返回合法 JSON：停止流程，说明订单返回格式错误。
- 脚本返回 JSON 中没有非空 `cashier_url`：停止流程，说明订单未返回支付宝收银台链接。
- 下单脚本没有返回非空 `out_trade_no` 或 `result_endpoint`：停止流程，说明订单返回缺少取结果信息。
- `cashier_url` 前缀不符合要求：停止流程，说明返回的不是支付宝收银台链接。
- `trigger-payment-signal` 未返回非空 `paymentLink`：停止流程，说明支付接管信息生成失败。
- 支付宝支付处理技能未成功完成支付：不要交付今日星座运势结果，按该技能返回结果说明当前支付状态。
- 结果脚本执行失败：停止流程，说明支付已处理但未能从项目接口获取今日星座运势，不要自行生成替代内容。
