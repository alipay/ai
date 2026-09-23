# 按量付费沙箱测试

> ⚠️ **仅当产品为「按量付费」时执行本文档定义的联调**。网站支付不执行本文档，但仍必须按 `sandbox-setup-guide.md` 第 5.5 节完成网站支付沙箱付款提示；APP 支付按集成主流程跳过步骤 6。

本文档定义按量付费 402 协议的沙箱端到端服务端联调流程。测试脚本位于 `../scripts/local_402_sandbox_pay.py`。

> 本文档位于 `references/integration/modules/sandbox/`，文中的 `../scripts/...` 路径相对本目录；从技能包根目录执行时对应 `references/integration/modules/scripts/...`。

---

## 前提条件

在执行此步骤前，必须满足：

1. **已完成步骤 5 代码生成**：按量付费集成代码已生成并整合进用户项目
2. **用户本地服务已启动**：服务端已运行在可访问的地址上（如 `http://localhost:5000/demo/a2m/resource`）
3. **已知沙箱买家 2088 账号**：从步骤 3 沙箱配置中获取实际 `userId`（例如 `<SANDBOX_BUYER_USER_ID>`）
4. **Python 3 可用**：测试脚本依赖 Python 3 运行
5. **已使用沙箱服务 ID**：用户服务的沙箱运行配置中 `serviceId` 固定为 `api_mock_service_id`，不要向用户索要正式 `serviceId`

---

## 测试前预检

执行沙箱测试脚本前，先用固定 `precheck` 解码服务返回的 `Payment-Needed` 并确认关键字段存在。`SERVICE_URL` 使用用户实际服务地址。所有平台统一执行当前 Skill 的受控入口；禁止临时编写 Python、curl 管道或近似解析器：

```bash
# GET
node "<SKILL_DIR>/references/normal/scripts/runtime.mjs" a2m precheck --url "$SERVICE_URL" --method GET --agent-platform "<AGENT_PLATFORM>" --session-id "<SESSION_ID>"

# POST
node "<SKILL_DIR>/references/normal/scripts/runtime.mjs" a2m precheck --url "$SERVICE_URL" --method POST --body "@$POST_BODY_FILE" --agent-platform "<AGENT_PLATFORM>" --session-id "<SESSION_ID>"
```

POST body 必须来自已确认目标项目中的实际文件。`seller_signature` 由代码示例中的 `generateSellerSignature` / `generate_seller_signature` 生成，签名入参中的 `service_id` 与 `method.service_id` 都必须使用 `api_mock_service_id`；禁止使用空值、其他占位符或要求用户提供正式 `serviceId`。预检输出只打印校验结论和字段名，不打印字段值。

`precheck` 只请求本地服务并校验 HTTP 402/字段，不调用沙箱收银。Windows 也使用相同的 Node 单行入口，由启动器选择可用的 Python 3：

```powershell
node "<SKILL_DIR>/references/normal/scripts/runtime.mjs" a2m precheck --url "$SERVICE_URL" --method GET --agent-platform "<AGENT_PLATFORM>" --session-id "<SESSION_ID>"
node "<SKILL_DIR>/references/normal/scripts/runtime.mjs" a2m precheck --url "$SERVICE_URL" --method POST --body "@$POST_BODY_FILE" --agent-platform "<AGENT_PLATFORM>" --session-id "<SESSION_ID>"
```

---

## 测试脚本路径

```bash
node "<SKILL_DIR>/references/normal/scripts/runtime.mjs" a2m --agent-platform "<AGENT_PLATFORM>" --session-id "<SESSION_ID>"
```

Windows 使用 `node "<SKILL_DIR>/references/normal/scripts/runtime.mjs" a2m --agent-platform "<AGENT_PLATFORM>" --session-id "<SESSION_ID>"`；启动器只允许该内置脚本，并按系统选择可用的 Python 3 命令。

脚本只提供 `run` 子命令，并要求使用 `--auto-complete` 在同一次命令内获取 Payment-Needed、调用沙箱收银和携带 Payment-Proof 重试原始服务。不存在跨轮 `complete` 或恢复命令。

---

## 完成条件

- [INT.A2M.SERVICE_READY] 已确认用户本地按量付费服务已启动可访问
- [INT.A2M.PRECHECK_PASSED] 已完成 Payment-Needed 预检，确认 HTTP 402 和关键字段存在
- [INT.A2M.AUTO_COMPLETE_RUN] 已执行沙箱支付测试脚本 `run --auto-complete`，成功获取 Payment-Needed、生成付款链接并连续执行服务端联调
- [INT.A2M.DELIVERY_EVIDENCE] 已携带 Payment-Proof 重试原服务并取得 HTTP 200、非空可归属资源、无明确业务失败和有效 Payment-Validation 证据
- [INT.A2M.TEST_PASSED] 已确认 402 沙箱服务端联调流程通过

---

## 测试流程

### 第一步：确定服务与测试参数

先从已确认的目标项目、已有运行上下文和已校验沙箱配置中确定：
1. 按量付费集成代码已部署到本地服务
2. 服务已启动并可通过 URL 访问
3. 服务实现了 402 协议（无 Payment-Proof 时返回 HTTP 402 + Payment-Needed 头）

**确定测试参数**：
- `SERVICE_URL`：本地服务请求地址（含 GET 参数，如 `http://localhost:5000/demo/a2m/resource?gift=demo`）
- `HTTP_METHOD`：`GET` 或 `POST`
- `BUYER_2088`：沙箱买家 2088 账号（实际 `userId`，例如 `<SANDBOX_BUYER_USER_ID>`）

> ⚠️ 只有缺少无法从当前上下文取得的真实值时，才询问用户对应信息。不要编造买家账号，也不得将补齐参数变成“是否执行测试”的确认。参数和服务就绪后，向用户输出测试说明并直接进入第二步。

### 第二步：执行沙箱支付测试脚本

**⚠️ 脚本的收银接口地址和付款链接前缀已硬编码在脚本中（`PAY_ENDPOINT`、`PAY_URL_PREFIX`），执行时无需额外指定。**

先按统一 runtime 的 `integration-message a2m-execution-guard` 当前会话 receipt 契约校验项目快照、服务 URL、HTTP 方法和可选 POST body。项目快照按代码和配置的实际内容计算，仅文件时间戳变化或同内容重写不产生新的执行机会；实际内容变化时才允许生成新的 `RUN` receipt。只有 `decision=RUN` 才使用 `../../../normal/json/customer-messages.json` 的 `a2m.test.start` 渲染固定联调说明并立即运行脚本；`REUSE_PASSED|BLOCK_UNCHANGED|UNKNOWN_PREVIOUS_EXECUTION` 均不得重复发起完整联调。服务地址和 HTTP 方法只用于实际命令，不在开始消息中展示。

```bash
node "<SKILL_DIR>/references/normal/scripts/runtime.mjs" integration-message a2m-test-start --agent-platform "<AGENT_PLATFORM>" --session-id "<SESSION_ID>"
```

不得在模块或 Agent 回复中维护第二份近似开始话术。

GET 请求：

```bash
node "<SKILL_DIR>/references/normal/scripts/runtime.mjs" a2m run --url "$SERVICE_URL" --method GET --buyer-id "$BUYER_2088" --auto-complete --require-payment-validation --agent-platform "<AGENT_PLATFORM>" --session-id "<SESSION_ID>"
```

POST 请求：

```bash
node "<SKILL_DIR>/references/normal/scripts/runtime.mjs" a2m run --url "$SERVICE_URL" --method POST --body "$BODY" --buyer-id "$BUYER_2088" --auto-complete --require-payment-validation --agent-platform "<AGENT_PLATFORM>" --session-id "<SESSION_ID>"
```

Windows 从本文件所在目录按实际 HTTP 方法执行对应单行命令：

```powershell
node "<SKILL_DIR>/references/normal/scripts/runtime.mjs" a2m run --url "$SERVICE_URL" --method GET --buyer-id "$BUYER_2088" --auto-complete --require-payment-validation --agent-platform "<AGENT_PLATFORM>" --session-id "<SESSION_ID>"
node "<SKILL_DIR>/references/normal/scripts/runtime.mjs" a2m run --url "$SERVICE_URL" --method POST --body "@$POST_BODY_FILE" --buyer-id "$BUYER_2088" --auto-complete --require-payment-validation --agent-platform "<AGENT_PLATFORM>" --session-id "<SESSION_ID>"
```

**脚本执行步骤**：
1. 请求 `$SERVICE_URL`，提取 `Payment-Needed` 响应头
2. Base64 解码账单 JSON
3. 将下划线字段转换为驼峰字段（适配沙箱收银接口）
4. 补充 `method.buyerUniqueIdKey = "buyerExternalId"`
5. 补充 `protocol.buyerUniqueId = <买家 2088>`
6. 补充 `signature` 字段
7. POST 到沙箱收银接口 `http://aicashier.dl.alipaydev.com/openclawpay/agent/v1/pay`
8. 生成浏览器付款链接
9. 使用同一过程产物构建 Payment-Proof 并重试原始服务
10. 仅在 HTTP 200、非空且可归属的资源、无明确业务失败，并且当前示例要求的 `Payment-Validation` 校验通过时输出服务端联调成功
11. 命令结束前清理敏感过程产物；失败后重新执行完整联调，不保存跨轮恢复状态

**脚本输出**：
- Payment-Needed 获取结果（终端不输出原始值）
- 脱敏后的账单 JSON
- 脱敏后的收银接口请求体
- 收银接口返回
- **浏览器付款链接**（格式：`https://render.alipay.com/p/yuyan/180020010001290755/pay.html?schema=...`）
- Payment-Proof 重试后的服务响应与测试结论；`Payment-Validation` 原始值不在终端输出

**错误处理**：
- 沙箱化 Agent 环境执行本脚本时，首次执行即申请可联网权限；如果已因网络受限失败，复用同一条命令申请可联网权限重试
- 如果未找到 `Payment-Needed` 响应头，确认服务端是否实现了 402 协议
- 如果收银接口返回 `PARAM_INVALID: protocol.sellerSignature不能为空`，回到预检步骤检查 `protocol.seller_signature` 是否为空、缺失或仍是占位符
- 如果 `pay_before` 相关参数报错，检查是否使用 ISO 8601 带时区格式
- 如果收银接口返回 `PAY_SUBMIT_FAILED`、`系统繁忙` 等已识别临时错误，脚本只在同一次命令内按既有预算自动重试；仍失败时清理本轮敏感产物并停止。Agent 不得通过重复执行 `run --auto-complete`、追加 `--pay-retries`/`--pay-retry-delay` 或手工复用上轮 Payment-Needed 扩大远程写动作；只有联网权限恢复后重试同一未发出命令，或代码、配置、URL、方法、POST body 实际变化并由 guard 产生新 `RUN` receipt 时才能重新发起完整联调。

### 第三步：连续验证 Payment-Proof 重试

标准流程只使用第二步命令中的 `--auto-complete`。脚本生成付款链接后，在同一次进程内继续构建 Payment-Proof、重试原始服务并输出结果；进程中断后重新执行完整联调。

**脚本执行步骤**：
1. 读取过程产物目录中的 `state.json`
2. 使用前面沙箱收银接口下单返回的 `trade_no` 构建 `Payment-Proof` 请求头（含 `payment_proof`、`trade_no`、`client_session`）
3. 携带 `Payment-Proof` 请求头重试原始服务地址
4. 校验最终服务响应并打印脱敏结论；不打印 `Payment-Validation` 原始值
5. 成功后安全清理敏感过程产物

**Payment-Proof 处理约束**：
- `trade_no` 必须使用前面沙箱收银接口返回并写入 `state.json` 的交易号；不得改用商户侧 `out_trade_no` 或重新生成。
- `payment_proof`、`client_session` 和最终请求头由脚本按沙箱联调约定自动处理；Agent 不得手工拼接、改写或向用户展开其原始值和内部处理规则。
- 进程中断后只能在确认上次命令未取得可用过程产物时重新执行完整 `run --auto-complete` 联调，不复用旧过程产物；明确业务失败、服务实现失败或脚本已输出失败结论时，禁止立即重复执行同一联调命令刷远程动作，必须先处理失败原因。

Payment-Proof 参考结构：

```json
{
  "protocol": {
    "payment_proof": "<脚本生成并保存到受限权限过程产物，禁止对客展示>",
    "trade_no": "<沙箱收银接口实际返回的交易号>"
  },
  "method": {
    "client_session": "<脚本生成并保存到受限权限过程产物，禁止对客展示>"
  }
}
```

**验证要点**：
- 服务必须返回 HTTP 200；任意其他状态（包括 204）均失败
- JSON 响应体必须同时包含非空 `resource_id` / `resourceId` 和非空 `content`；非 JSON 资源必须有可验证的 `Payment-Validation` 证明归属
- 响应中不得存在当前五语言示例已经定义的明确验付、资源或履约失败，如 `VERIFY_FAILED`、`RESOURCE_ID_MISMATCH`、`FULFILLMENT_CONFIRM_FAILED`
- 当前五语言示例实现了 `Payment-Validation`，标准命令必须传 `--require-payment-validation`；响应头必须能解码为 JSON，且包含 `validated=true`、非空 `trade_no` / `tradeNo` 和 `resource_id` / `resourceId`，资源 ID 必须与响应体一致
- 只有以上证据同时成立，脚本退出码才为 0，才能输出“沙箱服务端联调通过”

**常见失败与排查**：
- `ORDER_NOT_FOUND`：`alipay.aipay.agent.payment.verify` 成功只代表支付宝凭证有效，不代表商户本地订单已匹配成功。检查服务端是否在返回 `Payment-Needed` 前持久化了 `out_trade_no`、`resource_id`、金额和订单状态；验证成功后应优先用验付返回的 `outTradeNo` 查询订单。沙箱响应字段可能为空字符串，排查时先判断字段是否非空；如果本地服务重启导致内存订单丢失，已付款旧链接不能继续用于重启后的服务。
- `RESOURCE_ID_MISMATCH`：检查验付返回的 `resourceId` 是否非空且与本地订单保存的资源一致。沙箱字段为空时不要把空字符串当作有效资源字段参与强校验；生产环境必须把资源字段缺失作为异常处理。
- `FULFILLMENT_CONFIRM_FAILED` 或 HTTP 5xx：资源生成后调用 `alipay.aipay.agent.fulfillment.confirm` 失败时，不要返回成功交付；应保留服务结果并允许同一笔 `Payment-Proof` 重试履约确认。

### 第四步：测试结论与可选付款体验

测试结束后使用 `a2m.test.result`：只有脚本退出码和本模块要求的组合证据都成立时选择 `PASSED`；其他情况选择 `FAILED` 并传入实际证据与确定恢复动作。不得把用户付款体验、沙箱配置落盘或任意 2xx 响应替代通过证据。

输出测试结论后，使用 `a2m.payment.experience/FULL` 展示付款链接和已经通过快速沙箱字段校验的实际买家账号。缺少任一账号字段时，当前沙箱配置必须已经在前置校验进入待配置状态，不得执行本联调或输出付款体验，也不得编造缺失凭据。随后执行 `node "<SKILL_DIR>/references/normal/scripts/runtime.mjs" integration-message sandbox-android-client --agent-platform "<AGENT_PLATFORM>" --session-id "<SESSION_ID>"` 统一输出 Android-only 官方下载与失败兜底。两条消息都不增加阻塞点，也不反向改变服务端联调结论。

最后必须提醒用户：

> 当前 `serviceId=api_mock_service_id` 仅用于沙箱联调。正式上线前，必须替换为支付宝服务市场注册或复用服务后实际返回的真实 `serviceId`。

脚本使用权限不宽于 `0700/0600` 的临时目录传递敏感中间值，并在命令退出前清理。该目录不用于用户进度或后续恢复，Agent 不向用户索要、展示或复用其中的 Payment-Proof。

**沙箱支付宝下载红线（Agent 内部约束，不要作为用户提示逐字输出）：**
- 默认只提供上方沙箱支付宝安装直链，复制到网页浏览器打开，并使用支付宝客户端扫码下载。
- 严禁声称 iOS 也有沙箱版支付宝或可在 iOS 完成沙箱支付宝安装。
- 严禁引导用户去应用市场、应用商店、搜索引擎或任何第三方站点搜索/下载“沙箱支付宝”。
- 严禁提供 `https://sandbox.alipay.com`、其他自编 URL、二维码、安装包名称或下载方式。
- 如果用户明确反馈上述直链、页面二维码无法打开或无法下载，只能引导用户前往支付宝开放平台沙箱工具页 `https://open.alipay.com/develop/sandbox/tool`，按页面指引安装沙箱版支付宝；不得自行补充其他替代渠道。

---

## 注意事项

1. **沙箱收银接口**：脚本默认使用 `http://aicashier.dl.alipaydev.com/openclawpay/agent/v1/pay`，此地址已硬编码在脚本中
2. **付款链接**：前缀为 `https://render.alipay.com/p/yuyan/180020010001290755/pay.html?schema=`，通过 URL 编码的 `payScheme` 拼接
3. **过程产物**：只在当前命令的系统临时专用目录中短时存在，目录/文件权限为 `0700/0600`；命令成功、失败或异常退出都执行清理，不提供自定义目录和跨轮恢复
4. **买家签名**：默认占位值 `-`，无需修改
5. **沙箱化 Agent 网络权限**：脚本内 `fetch_payment_needed` 使用 curl，且收银测试会访问沙箱接口；沙箱化 Agent 环境首次执行即申请可联网权限
6. **沙箱支付宝安装包**：沙箱支付宝当前仅支持安卓系统；默认引导用户复制 `https://mdn.alipayobjects.com/sandboxsys/afts/img/_itHRrdOD9oAAAAAAAAAAAAADgSLAQBr/original` 到网页浏览器打开，并使用支付宝客户端扫码下载。若用户明确反馈该直链、页面二维码无法打开或无法下载，只能引导用户前往支付宝开放平台沙箱工具页 `https://open.alipay.com/develop/sandbox/tool`，按页面指引安装沙箱版支付宝。严禁引导用户使用 iOS 沙箱支付宝、应用市场搜索、`https://sandbox.alipay.com` 或其他自编下载 URL。

---

## 脚本内部流程概要

```
用户服务 (无 Payment-Proof)
    ↓ HTTP 402 + Payment-Needed (base64 JSON)
脚本提取并解码
    ↓ snake_case → camelCase + 补充买家ID
沙箱收银接口
    ↓ payScheme
浏览器付款链接（保留为可选体验入口）
    ↓
脚本连续构建 Payment-Proof
    ↓ base64(protocol + method)
重试用户服务
    ↓ HTTP 200 + 非空可归属资源 + 无明确失败
校验 Payment-Validation（当前五语言示例要求）
    ↓ 成功后清理敏感过程产物
验证通过 ✅
```
