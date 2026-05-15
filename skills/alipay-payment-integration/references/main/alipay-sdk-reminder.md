# Alipay-SDK Reminder

以下各项为接入支付宝 SDK 的相关规则，**严禁在未阅读全部内容的情况下编写任何 SDK 相关代码**。每条规则均来自真实集成踩坑，请逐条阅读并确认后再继续，编写代码遵守规则。

---

## SDK 引入方式

SDK 的引入方式取决于对应语言的包管理方式和实际导出方式，**绝不能凭猜测选择**，必须通过查阅 SDK 文档或类型定义确定。

**各语言 SDK 引入方式参考：**

| 语言 | 包管理 | 引入方式 | 备注 |
|------|--------|---------|------|
| Java | Maven | `import com.alipay.api.*;` | 通过 Maven 依赖引入，包结构固定 |
| .NET | NuGet | `using Aop.Api;` 等 | 通过 NuGet 安装 `AlipaySDKNet.Standard`，命名空间固定 |
| PHP | Composer | `require_once '../aop/AopClient.php';` 等 | 通过 GitHub 仓库或 Composer 引入，类文件路径以实际目录为准 |
| Python | pip | `from alipay.aop.api.AlipayClientConfig import AlipayClientConfig`<br>`from alipay.aop.api.DefaultAlipayClient import DefaultAlipayClient` | 通过 pip 安装 `alipay-sdk-python`，模块路径以实际版本为准 |
| Node.js | npm | 需查阅类型定义确认 | 导入方式可能随版本变化，**必须验证**，详见下方「Node.js 导入格式判断」 |

### Node.js 导入格式判断

`alipay-sdk`（Node.js）的导入方式取决于包的实际导出方式，**绝不能凭猜测选择**。

**判断流程：**

1. **查看 package.json**：确认模块类型（ESM/CJS）和入口路径
   ```bash
   cat node_modules/alipay-sdk/package.json
   ```
   重点看 `type`、`exports`、`main`、`types` 字段。

2. **查看类型定义文件**：确认导出方式
   ```bash
   cat node_modules/alipay-sdk/dist/types/index.d.ts
   ```
   注意：类型定义文件路径以 package.json 中 `types` 字段为准。

3. **选择导入语法**：
   - 命名导出（`export class AlipaySdk`）→ `import { AlipaySdk } from 'alipay-sdk'`
   - 默认导出（`export default`）→ `import AlipaySdk from 'alipay-sdk'`
   - 混合导出 → `import AlipaySdk, { AlipaySdkConfig } from 'alipay-sdk'`

**优先级**：类型定义（.d.ts）> 官方文档 > 源码

**注意：**
- package.json 的 `exports` 字段是入口路径配置，不是导出方式
- 包的导出方式可能随版本更新而改变，务必验证

---

## 页面跳转类 API 方法选择

`alipay.trade.page.pay` 是页面跳转类 API，**严禁使用 `exec()` 方法**，必须使用页面跳转方法。各语言 SDK 的方法名不同，请按下表选择：

| 语言 | 页面跳转方法 | SDK 执行方法 | 页面跳转类 API 举例 |
|------|-------------|-------------|-------------------|
| Java | `alipayClient.pageExecute(request, "POST")` | `alipayClient.execute(request)` | `alipay.trade.page.pay`、`alipay.trade.wap.pay`、`alipay.user.agreement.page.sign` |
| .NET | `alipayClient.PageExecute(request, null, "POST")` | `alipayClient.Execute(request)` | 同上 |
| PHP | `$alipayClient->pageExecute($request, "POST")` | `$alipayClient->execute($request)` | 同上 |
| Node.js | `alipaySdk.pageExecute('alipay.trade.page.pay', 'POST', {...})` | `alipaySdk.exec('alipay.trade.query', {...})` | 同上 |
| Python | `alipay_client.page_execute(request)` | `alipay_client.execute(request)` | 同上 |

**此外，App 支付（`alipay.trade.app.pay`）和线上资金授权冻结（`alipay.fund.auth.order.app.freeze`）属于客户端 SDK 调用类 API，需使用 `sdkExecute`/`sdkExec` 方法：**

| 语言 | 客户端 SDK 方法 |
|------|---------------|
| Java | `alipayClient.sdkExecute(request)` |
| .NET | `alipayClient.SdkExecute(request)` |
| PHP | `$alipayClient->sdkExecute($request)` |
| Node.js | `alipaySdk.sdkExecute('alipay.trade.app.pay', {...})` |

**Node.js 对比示例：**
```javascript
// ✅ 正确 - 页面跳转类 API 使用 pageExecute()
const htmlForm = alipaySdk.pageExecute('alipay.trade.page.pay', 'POST', {
  bizContent: { out_trade_no: '123', total_amount: '10.00', ... }
});
// 返回：<form action="...">...</form> HTML 字符串

// ❌ 错误 - 对页面跳转类 API 使用 exec()
const result = await alipaySdk.exec('alipay.trade.page.pay', {
  bizContent: { out_trade_no: '123', total_amount: '10.00', ... }
});
// 返回：JSON 对象，无法用于页面跳转，这是最常见的集成错误！
```

| 方法类型 | 用途 | 返回值 | 示例 |
| --- | --- | --- | --- |
| 页面跳转方法（`pageExecute()` 等） | 页面跳转类 API（如：支付） | HTML 表单字符串 | 电脑 / 手机网站支付 |
| `exec()` | 服务端 API（查询 / 退款） | 结构化数据（JSON 等） | 交易查询、退款 |

**对支付接口调用 exec() 将不会得到可用的支付表单，是最常见的集成错误之一。**

### 前端支付表单处理

页面跳转类 API 返回的是包含自动提交脚本的 HTML `<form>` 字符串，前端**必须将此 HTML 渲染到页面并自动提交表单**，禁止直接用 URL 跳转。

**❌ 错误写法（以浏览器端 JavaScript 为例）**：
```javascript
// paymentHtml 是 HTML 表单字符串，不是 URL
if (data.paymentHtml) {
  window.location.href = data.paymentHtml; // 页面只显示 ?method=alipay.trade.page.pay... 参数，无法跳转
}
```

**✅ 正确写法**：
```javascript
if (data.paymentHtml) {
  const container = document.createElement('div');
  container.innerHTML = data.paymentHtml;
  container.style.position = 'fixed';
  container.style.top = '0';
  container.style.left = '0';
  container.style.width = '100%';
  container.style.height = '100%';
  container.style.zIndex = '9999';
  container.style.background = 'white';
  document.body.appendChild(container);
  const form = container.querySelector('form');
  if (form) form.submit();
}
```

---

## 私钥格式

**沙箱返回两个私钥字段，必须按语言选对：**

| 字段 | 格式 | 使用场景 |
|------|------|---------|
| `appPrivateKey` | PKCS#8 格式 | ✅ JAVA 语言必须使用 |
| `appPrivatePkcsKey` | PKCS#1 格式 | ✅ 非 JAVA 语言（Python、Node.js、PHP、.NET 等）必须使用 |

**严禁以下误判行为：**

| 误判行为 | 为什么错 | 正确做法 |
|---------|---------|---------|
| 看到 `ERR_OSSL_UNSUPPORTED` 就推断私钥格式有问题 | 该错误通常是 SDK 配置参数错误（如私钥字段选错、字符编码问题），**不是**私钥格式本身有问题 | 先确认使用了正确的私钥字段（JAVA 用 `appPrivateKey`，非 JAVA 用 `appPrivatePkcsKey`），再检查其他配置参数 |
| 手动添加 PEM 头尾（`-----BEGIN RSA PRIVATE KEY-----` / `-----END RSA PRIVATE KEY-----`） | SDK 内部自动处理 PEM 格式，手动添加头尾会导致格式错误 | 直接使用沙箱返回的原始值，不做任何格式处理 |
| 手动添加 PEM 头尾（`-----BEGIN PRIVATE KEY-----` / `-----END PRIVATE KEY-----`） | 同上，PKCS#8 头尾也不应手动添加 | 直接使用沙箱返回的原始值，不做任何格式处理 |
| 将 `appPrivatePkcsKey` 转换为 PKCS#8 格式 | 禁止任何格式转换，SDK 直接支持 PKCS#1 | 非 JAVA 语言使用原始 `appPrivatePkcsKey` 值，不做转换 |
| 将 PKCS#8 转换为 PKCS#1 格式 | 同上，禁止反向转换 | JAVA 语言使用原始 `appPrivateKey` 值，不做转换 |
| 对私钥内容做 Base64 解码/重新编码 | 无需任何编码处理 | 直接使用沙箱返回的原始字符串 |
| 因为字段名含 "Pkcs" 就认为是 PKCS#8 格式 | `appPrivatePkcsKey` 是 **PKCS#1** 格式，"Pkcs" 仅表示这是 PKCS 系列标准之一，不代表 PKCS#8 | 非 JAVA 语言使用 `appPrivatePkcsKey`（PKCS#1），JAVA 语言使用 `appPrivateKey`（PKCS#8） |

**核心原则：沙箱返回的私钥值直接使用，禁止任何格式处理（添加头尾、格式转换、编码处理、换行符调整）。JAVA 语言使用 `appPrivateKey`（PKCS#8），非 JAVA 语言使用 `appPrivatePkcsKey`（PKCS#1）。**

### 连环误判链

遇到 `ERR_OSSL_UNSUPPORTED` 时，agent 容易陷入以下**越错越远**的连环推理，**每一步都是错的**，必须识别并阻断：

```
❌ 连环误判链（严禁陷入）：

第 1 步（误判起点）：看到 ERR_OSSL_UNSUPPORTED → 推断"私钥格式有问题"
    ↓
第 2 步（错误修复）：认为"PKCS#1 私钥应该以 -----BEGIN RSA PRIVATE KEY----- 开头"
    → 手动添加 PEM 头尾 → 错误仍在
    ↓
第 3 步（错误归因）：认为"Node.js 18+ 用了 OpenSSL 3.0，旧格式不被支持"
    ↓
第 4 步（越错越远）：认为"应该用 PKCS#8 格式，以 -----BEGIN PRIVATE KEY----- 开头"
    → 将私钥转换为 PKCS#8 格式 → 错误更严重（注：JAVA 语言应直接使用沙箱返回的 `appPrivateKey` 字段，而非手动转换格式）
```

**正确做法**：看到 `ERR_OSSL_UNSUPPORTED`，**立即停止所有格式操作**，按下方「验签失败排查原则」中的正确排查顺序逐项检查。

---

## 验签失败排查原则

遇到 `invalid-signature`（验签出错）时，**严禁凭猜测归因到私钥格式或环境兼容性**，必须按以下顺序逐项排查：

### 正确排查顺序

**原则：先验证实际请求内容，再怀疑密钥配置。**

1. **检查请求参数完整性**（最常见原因）
   - 支付宝验签时校验所有请求参数是否匹配。如果 `return_url`、`notify_url` 等参数在配置中定义但未传入支付请求，或传入但未参与签名，将导致验签失败。
   - **排查方法**：打印或检查实际发送给支付宝的请求参数，确认 `return_url`、`notify_url` 等参数是否正确包含在请求中。
   ```bash
   # 检查实际请求中是否包含 return_url
   # 在服务端日志中打印请求参数，确认 return_url 存在
   ```

2. **检查私钥来源**
   - 确认使用的是沙箱返回的正确私钥字段：JAVA 使用 `appPrivateKey`，非 JAVA 使用 `appPrivatePkcsKey`，而非自行生成或其他来源。

3. **检查 signType 是否一致**
   - 请求中的 `sign_type` 必须为 `RSA2`，与配置保持一致。

4. **检查私钥格式完整性**
   - 私钥内容无多余空格、换行符。

5. **检查网关地址**
   - 沙箱环境必须使用沙箱网关 `https://openapi-sandbox.dl.alipaydev.com/gateway.do`，生产环境使用 `https://openapi.alipay.com/gateway.do`。

> **核心教训**：验签失败 ≠ 私钥问题。应先通过日志/输出验证实际请求行为（参数是否完整传入），而非基于技术传言做假设。

---

## 时间戳格式化

支付宝要求时间戳格式为 `yyyy-MM-dd HH:mm:ss`（空格分隔，非 ISO 格式）。

### Java
```java
import java.text.SimpleDateFormat;
// ✅ 正确
new SimpleDateFormat("yyyy-MM-dd HH:mm:ss").format(new Date());
// ❌ 错误：Instant.now().toString() → "2026-04-29T14:30:00.000Z"
```

### .NET (C#)
```csharp
// ✅ 正确
DateTime.Now.ToString("yyyy-MM-dd HH:mm:ss");
// ❌ 错误：DateTime.Now.ToString("o") → "2026-04-29T14:30:00.0000000+08:00"
```

### PHP
```php
// ✅ 正确
date("Y-m-d H:i:s");
// ❌ 错误：date("c") → "2026-04-29T14:30:00+08:00"
```

### Node.js
```javascript
function formatAlipayTimestamp(date) {
  const pad = (n) => n.toString().padStart(2, '0');
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())} ${pad(date.getHours())}:${pad(date.getMinutes())}:${pad(date.getSeconds())}`;
}

// ❌ 错误：new Date().toISOString() → "2026-04-29T14:30:00.000Z"
```

### Python
```python
from datetime import datetime

def format_alipay_timestamp(dt: datetime) -> str:
    return dt.strftime("%Y-%m-%d %H:%M:%S")

# ❌ 错误：datetime.isoformat() → "2026-04-29T14:30:00"
```