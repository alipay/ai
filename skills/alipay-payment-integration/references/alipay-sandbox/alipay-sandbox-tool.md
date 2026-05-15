# Alipay Sandbox Tool

提供沙箱能力：**创建快速沙箱**，返回示例见 [EXAMPLES.md](./EXAMPLES.md)。

## 1. 环境检测

### 1.1 CLI 探测

```bash
which alipay 2>/dev/null && alipay version
```

### 1.2 安装（如未检测到）

```bash
curl -fsSL https://mdn.alipayobjects.com/nexuspaybase_saas/uri/file/as/alipaycli-install.sh | sh
```

安装脚本按以下优先级选择安装目录：
1. `/usr/local/bin`（若目录存在且当前用户可写，无需 sudo）
2. `/usr/local/bin`（若有 sudo 免密权限，需 sudo）
3. `~/.local/bin`（以上均不满足时的回退路径）

### 1.3 安装验证

```bash
alipay version
```

若提示 command not found，尝试 `source ~/.zshrc`（或 `~/.bashrc`）刷新 PATH，或直接使用绝对路径 `/usr/local/bin/alipay` 或 `~/.local/bin/alipay`。

## 2. 创建快速沙箱

**重要：输出时必须完整展示所有字段，不允许省略 privateKey、publicKey 等长字段。如果输出被截断，需重新输出完整内容。**

```bash
S1="<PRODUCT>" alipay sandbox create
```

**参数说明：**

| 变量 | 说明 |
|------|------|
| `PRODUCT` | 前序 Skill 中产品决策出的支付产品名称（如：手机网站支付、电脑网站支付） |

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

## 4. 注意事项

- 执行前向用户展示即将运行的命令
- 参数不确定时先向用户确认