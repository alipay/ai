# Alipay Sandbox Tool

提供沙箱能力：**创建快速沙箱**。

本文件记录 `sandbox_config.sh` 内部使用的冻结 MCP 命令、响应结构和维护规则。运行时 Agent 不直接执行本文件的原始 MCP 命令；只执行 integration flow 登记的 `sandbox_config.sh ensure|reverify|verify|summary`，命中登记终态后立即转移，不追加临时 jq 或其他诊断。

## 1. 环境检测

> ⚠️ **前置要求**：在调用沙箱工具前，必须先按 `../../../normal/alipay-cli-env.md` 完成 alipay-cli 检测与安装

```bash
which alipay-cli 2>/dev/null && alipay-cli version
```

> 📎 详细检测、安装、验证流程及环境检测结果不透出规范见 `../../../normal/alipay-cli-env.md`

## 2. 创建快速沙箱

**重要：工具返回的 `data` 只是候选沙箱配置；必须先按 `sandbox-setup-guide.md` 完成字段完整性校验，校验通过后再写入正式本地配置文件。创建阶段不对客输出字段核对表、独立校验结论或沙箱环境摘要表；代码开发完成并通过配置后置校验后，才按该指南输出一张沙箱环境摘要表。该结果不代表沙箱支付测试通过。privateKey、publicKey 等密钥字段不得展开。**

`createAnonymousSandbox` 的 MCP 请求体只有业务入参 `request.appType`，当前固定为 `PUBLICAPP`。`PLATFORM` 是 alipay-cli 上下文环境变量，禁止写入 `--data` 的 JSON。匿名沙箱创建不依赖本轮最终选择的支付产品，因此不得为了创建沙箱先编造或强行确认 `PRODUCT`。

```bash
PLATFORM="<PLATFORM>" \
alipay-cli mcp call alipay-anonymous-sandbox.createAnonymousSandbox \
  --data '{"request":{"appType":"PUBLICAPP"}}' \
  --json
```

**固定参数：**

| 字段 | 固定值 | 说明 |
|------|------|------|
| `request.appType` | `PUBLICAPP` | 不随用户最终选择的按量付费、网站支付或 APP 支付变化 |

**上下文变量：**

| 变量 | 来源 | 取值规则 |
|------|------|----------|
| `PLATFORM` | AI 编程工具识别结果 | 参考通用脚本 `../../../normal/scripts/detect_dev_tool.sh` 识别当前工具后使用其输出值；缺失时使用 `unknown`。例如 Codex 环境检测结果为 `codex` |
| `PRODUCT` | 不再传入 | 该 MCP 方法当前不需要产品上下文；不得把产品名写入 `--data` 或 CLI 环境变量 |

**Codex 环境示例：**

```bash
PLATFORM=codex \
alipay-cli mcp call alipay-anonymous-sandbox.createAnonymousSandbox \
  --data '{"request":{"appType":"PUBLICAPP"}}' \
  --json
```

**结果解析：**

1. 取 `result.content[0].text`，去转义还原 JSON
2. `success === true` → 提取 `data` 字段作为候选沙箱配置，先按 [沙箱环境初始化](sandbox-setup-guide.md) 的必含字段清单做完整性校验
3. 字段完整性校验通过 → 将 `data` 字段完整写入正式本地配置文件；创建阶段只输出受控机器标记和实际配置路径，不输出沙箱环境摘要表、字段核对表、独立校验结论或“沙箱测试通过”等表述
4. 代码开发完成并通过配置后置校验后 → 按 `sandbox-setup-guide.md` 使用 `sandbox_config.sh summary` 复核并只输出一张沙箱环境摘要表，保持本地文件中的原始字段值不变，不在对话中复述密钥等长字段
5. `success !== true` 或 `data` 字段缺失/字段不完整 → 不得写入正式 `.alipay-sandbox.json`；按错误处理完成既定重试，耗尽后返回待配置终态并继续代码实现

## 3. 错误处理

CLI 输出不暴露 HTTP 状态码，统一按响应体中的 `success` 字段判断：

| 条件 | 策略 |
|------|------|
| `success === false` 且 `msg` 含"证书密钥"等当前已识别临时错误 | 固定 runner 静默等待 2 秒后自动重试 1 次；仍失败则进入待配置终态 |
| `success === false` 且 `msg` 含"版本过旧"，或 CLI 退出码非 0 且不是已识别网络错误 | 不重试，保留实际失败类别和可执行恢复动作 |
| CLI 执行超时或已识别网络/服务错误 | 同一参数最多自动重试 2 次，每次间隔 3 秒 |
| 候选 `data` 或已有配置缺少必含字段 | 同一流程动作最多自动重试 2 次，每次间隔 3 秒；仍失败则进入 `CREATE_PENDING|VERIFY_PENDING` |

`ensure|reverify` 的重试耗尽后由 `sandbox_config.sh` 内部固定渲染 `sandbox.configuration.pending/CREATE|VERIFY`，并返回对应 `FLOW:SANDBOX_CONFIG_PENDING_*`；Agent 不得二次渲染、直接转述原始响应、临场拼装错误话术或自行增加重试确认。`SANDBOX_ERROR`、`errorCode` 和实际返回的 `traceId` 只属于严格 `create|verify` 子动作的受控诊断，待配置终态不对客展开原因。待配置不得产生沙箱 PASS 条件，只允许继续不依赖沙箱字段的代码实现。

## 4. 注意事项

- 本文件的原始命令只用于维护 `sandbox_config.sh` 的冻结契约，不对客展示，也不作为运行时二次调用入口。
- `request.appType` 与 CLI 上下文均由脚本固定。参数或返回结构无法按当前契约确认时停止并交由维护者核对，不向用户增加参数确认，不临场改写命令。
  
## 返回结构示例

### 成功结构示例

> 下例仅用于说明字段结构；真实执行时创建阶段不输出字段摘要或账号密码。只有代码开发完成且配置后置校验通过后，才按 `sandbox-setup-guide.md` 输出受控沙箱摘要；完整私钥、公钥等密钥字段只写入本地配置文件。

```json
{
  "appIds": [
    {
      "alipayPublicKey": "<ALIPAY_PUBLIC_KEY_BASE64>",
      "appId": "<SANDBOX_APP_ID>",
      "appPrivateKey": "<APP_PRIVATE_KEY_PKCS8_BASE64>",
      "appPrivatePkcsKey": "<APP_PRIVATE_KEY_PKCS1_BASE64>",
      "appPublicKey": "<APP_PUBLIC_KEY_BASE64>",
      "pid": "<SANDBOX_SELLER_USER_ID>",
      "type": null,
      "uid": null
    }
  ],
  "isClaimed": false,
  "sandboxAccounts": {
    "partner": {
      "accountDesc": "商家账号",
      "acctrans": "<SANDBOX_SELLER_BALANCE>",
      "email": "<SANDBOX_SELLER_EMAIL>",
      "merchantId": "<SANDBOX_MERCHANT_ID>",
      "userId": "<SANDBOX_SELLER_USER_ID>"
    },
    "user": {
      "accountDesc": "买家账号",
      "acctrans": "<SANDBOX_BUYER_BALANCE>",
      "email": "<SANDBOX_BUYER_EMAIL>",
      "userName": "<SANDBOX_BUYER_NAME>",
      "userId": "<SANDBOX_BUYER_USER_ID>",
      "logonPassword": "<SANDBOX_BUYER_LOGIN_PASSWORD>",
      "payPassword": "<SANDBOX_BUYER_PAY_PASSWORD>",
      "certNo": "<SANDBOX_BUYER_CERT_NO>",
      "certType": "IDENTITY_CARD"
    }
  },
  "sandboxId": "<SANDBOX_ID>",
  "sandboxName": "<SANDBOX_NAME>"
}
```

### 错误示例

```json
{
  "data": null,
  "errorCode": null,
  "msg": "查询沙箱证书密钥信息失败",
  "resultCode": null,
  "resultMsg": null,
  "success": false,
  "traceId": "218f563417783158778985995e4b5d"
}
```
