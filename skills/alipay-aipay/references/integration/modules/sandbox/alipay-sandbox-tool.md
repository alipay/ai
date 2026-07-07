# Alipay Sandbox Tool

提供沙箱能力：**创建快速沙箱**。

## 1. 环境检测

> ⚠️ **前置要求**：在调用沙箱工具前，必须先按 `../../../normal/alipay-cli-env.md` 完成 alipay-cli 检测与安装

```bash
which alipay-cli 2>/dev/null && alipay-cli version
```

> 📎 详细检测、安装、验证流程及环境检测结果不透出规范见 `../../../normal/alipay-cli-env.md`

## 2. 创建快速沙箱

**重要：输出时必须完整展示所有字段，不允许省略 privateKey、publicKey 等长字段。如果输出被截断，需按 `sandbox-setup-guide.md` 的表格格式重新输出完整字段。**

`createAnonymousSandbox` 的 MCP 请求体只有业务入参 `request.appType`。`PLATFORM`、`PRODUCT` 是 alipay-cli 上下文环境变量，禁止写入 `--data` 的 JSON。

```bash
PLATFORM="<PLATFORM>" \
PRODUCT="<PRODUCT>" \
alipay-cli mcp call alipay-anonymous-sandbox.createAnonymousSandbox \
  --data '{"request":{"appType":"<APP_TYPE>"}}' \
  --json
```

**参数推断：**

| 用户关键词 | appType |
|------|------|
| 网页应用、移动应用、按量付费 | PUBLICAPP |

**上下文变量：**

| 变量 | 来源 | 取值规则 |
|------|------|----------|
| `PLATFORM` | AI 编程工具识别结果 | 参考通用脚本 `../../../normal/scripts/detect_dev_tool.sh` 识别当前工具后使用其输出值；缺失时使用 `unknown`。例如 Codex 环境检测结果为 `codex` |
| `PRODUCT` | 当前 Skill 产品名称 | `按量付费` / `网站支付` / `APP支付`。用户说“手机网站支付”“H5支付”“PC网页支付”时，按本 Skill 术语归一为 `网站支付` |

> `PRODUCT` 不是 `createAnonymousSandbox` 的 MCP 请求体字段，仅作为 alipay-cli 上下文变量传入。Skill 内按产品决策结果归一为上表中的产品名。

**Codex 环境示例：**

```bash
PLATFORM=codex \
PRODUCT="网站支付" \
alipay-cli mcp call alipay-anonymous-sandbox.createAnonymousSandbox \
  --data '{"request":{"appType":"PUBLICAPP"}}' \
  --json
```

**结果解析：**

1. 取 `result.content[0].text`，去转义还原 JSON
2. `success === true` → 输出简短成功提示，将 `data` 字段**完整原样**按 [沙箱环境初始化](sandbox-setup-guide.md) 中的沙箱信息输出格式以表格展示，保持原始字段值不变，不做任何脱敏、省略或重排
3. `success !== true` → 按错误处理流程

## 3. 错误处理

CLI 输出不暴露 HTTP 状态码，统一按响应体中的 `success` 字段判断：

| 条件 | 策略 |
|------|------|
| `success === false` 且 `msg` 含"证书密钥"等临时错误 | 静默等待 2 秒后自动重试 1 次，仍失败则展示 `errorCode`、`msg`/`resultMsg`、`traceId` |
| `success === false` 且 `msg` 含"版本过旧"或 CLI 退出码非 0 | 不重试，友好提示"服务不可用，可能是 CLI 版本过旧"，询问用户是否升级 CLI |
| CLI 执行超时或网络错误 | 最多重试 2 次 |

所有失败均提取 traceId 展示给用户。

## 4. 注意事项

- 执行前向用户展示即将运行的命令
- 参数不确定时先向用户确认
  
## 返回示例

### 成功示例

```json
{
  "appIds": [
    {
      "alipayPublicKey": "MIIBIjANBgkqhkiG9w0BAQEFAAOCAQ8A...",
      "appId": "9021000162691374",
      "appPrivateKey": "MIIEvQIBADANBgkqhkiG9w0BAQEFAASC...",
      "appPrivatePkcsKey": "MIIEpAIBAAKCAQEA...",
      "appPublicKey": "MIIBIjANBgkqhkiG9w0BAQEFAAOCAQ8A...",
      "pid": "2088721100529696",
      "type": null,
      "uid": null
    }
  ],
  "isClaimed": false,
  "sandboxAccounts": {
    "partner": {
      "accountDesc": "商家账号",
      "acctrans": "1000000.00",
      "email": "xxxxx@sandbox.com",
      "merchantId": "221187076",
      "userId": "2088721100529696"
    },
    "user": {
      "accountDesc": "买家账号",
      "acctrans": "1000000.00",
      "email": "xxxxx@sandbox.com",
      "userName": "xxxxx",
      "userId": "2088722100508485",
      "logonPassword": "111111",
      "payPassword": "111111",
      "certNo": "195109197300184083",
      "certType": "IDENTITY_CARD"
    }
  },
  "sandboxId": "al1458801837b7495b",
  "sandboxName": "匿名沙箱-al1458801837b7495b"
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
