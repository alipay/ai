# 非 SDK 方式接入指南

仅明确采用服务商第三方应用且该子能力支持代调用时，商户独立授权的 app_auth_token 为参与签名的网关公共参数，不写入业务对象；详见[服务商接入](service-provider-mode.md)。B2B 走[自有应用协议](b2b/non-sdk-openapi-integration.md)，不使用此规则替代。

适用于 Golang、Rust、C++ 等无官方 SDK 语言，或追求轻量级、零依赖、完全掌控底层逻辑的接入场景。

## 密钥管理与角色映射

支付宝采用非对称加密机制，请求签名与响应验签使用不同的密钥对。

### 密钥对照表

| 密钥名称 | 归属方 | 用途 | 代码中使用 | 控制台配置 |
|----------|--------|------|------------|------------|
| 调用应用私钥 | 商家 | 发起请求时生成签名 | 加载到内存用于 `Sign()` | 无需上传，本地保密 |
| 调用应用公钥 | 商家 | 供支付宝验证请求签名 | 代码中不使用 | 开发设置 > 接口加签方式 > 上传 |
| 支付宝公钥 | 支付宝 | 供商家验签支付宝返回数据 | 加载到内存用于 `Verify()` | 开发设置 > 接口加签方式 > 查看 |
| 支付宝私钥 | 支付宝 | 支付宝对响应/通知签名 | 商家不可见 | 支付宝内部持有 |

### 核心口诀

- **发请求**：用调用应用私钥签名 → 支付宝用调用应用公钥验签
- **收通知/响应**：用支付宝公钥验签 → 支付宝用支付宝私钥签名

> ⚠️ 代码初始化时，`AlipayPublicKey` 必须填支付宝公钥，填错将导致 100% 验签失败。

## 接口请求与签名构建

### 签名算法步骤（RSA2）

1. **过滤参数**：剔除值为空的参数和 `sign`；主动请求的 `sign_type` 必须保留并参与签名
2. **排序拼接**：按 key 的 ASCII 码升序排序，拼接为 `key1=value1&key2=value2` 格式
3. **计算签名**：使用 SHA256WithRSA 算法对待签名字符串进行签名
4. **Base64 编码**：将签名结果编码得到最终 `sign` 值

### 请求报文组装规范

**重要**：支付宝 API 对参数位置有严格要求，放错位置会导致签名验证失败和响应乱码。

#### 参数位置规范

| 参数类型 | 参数名称 | 必须位置 | 说明 |
|---------|---------|---------|------|
| 公共参数 | `app_id` | **URL Query** | 应用ID |
| 公共参数 | `method` | **URL Query** | 接口名称 |
| 公共参数 | `format` | **URL Query** | 响应格式 |
| 公共参数 | `charset` | **URL Query** | 字符集（UTF-8） |
| 公共参数 | `sign_type` | **URL Query** | 签名类型（RSA2） |
| 公共参数 | `timestamp` | **URL Query** | 时间戳 |
| 公共参数 | `version` | **URL Query** | 版本号（1.0） |
| 公共参数 | `sign` | **URL Query** | 签名值 |
| 业务参数 | `biz_content` | **POST Body** | 业务参数JSON字符串 |

> ⚠️ **关键注意**：`charset` 参数必须放在 URL Query 中，不能放在 POST Body 中。否则支付宝服务端无法正确识别请求编码，导致：
> 1. 签名验证失败（sub_code: `isv.invalid-signature`）
> 2. 响应内容乱码（服务端按默认编码返回）

#### 正确的请求格式

```
POST /gateway.do?app_id=YOUR_APP_ID&method=alipay.trade.product.create&format=JSON&charset=UTF-8&sign_type=RSA2&timestamp=YYYY-MM-DD+HH%3Amm%3Ass&version=1.0&sign=GENERATED_SIGNATURE HTTP/1.1
Host: openapi.alipay.com
Content-Type: application/x-www-form-urlencoded

biz_content=%7B%22name%22%3A%22AI%E4%BC%9A%E5%91%98%E4%B8%93%E4%B8%9A%E7%89%88%22%2C%22metadata%22%3A%22%7B%5C%22default%5C%22%3A%5C%22default%5C%22%7D%22%7D
```

#### 签名计算规则

签名需要计算**所有参数**（公共参数 + biz_content），但发送时参数位置不同：

```
签名参数范围 = 公共参数（app_id, method, format, charset, sign_type, timestamp, version）+ biz_content

发送位置：
- URL Query: 公共参数 + sign
- POST Body: biz_content
```


#### Content-Type

- **Content-Type**：`application/x-www-form-urlencoded`
- **公共参数**：`app_id`, `method`, `format`, `charset`, `sign_type`, `timestamp`, `version`
- **biz_content 处理**：序列化为 JSON 字符串，并进行 URL Encode

### 完整发送示例

```
POST https://openapi.alipay.com/gateway.do?app_id=YOUR_APP_ID&method=alipay.trade.product.create&format=JSON&charset=UTF-8&sign_type=RSA2&timestamp=YYYY-MM-DD%20HH%3Amm%3Ass&version=1.0&sign=GENERATED_SIGNATURE
Content-Type: application/x-www-form-urlencoded

biz_content=%7B%22name%22%3A%22AI%E4%BC%9A%E5%91%98%E4%B8%93%E4%B8%9A%E7%89%88%22%2C%22metadata%22%3A%22%7B%5C%22default%5C%22%3A%5C%22default%5C%22%7D%22%7D
```

## 响应解析与异步通知处理

### 响应格式兼容

| 格式类型 | Content-Type | 解析建议 |
|----------|--------------|----------|
| JSON 格式 | application/json | 直接反序列化，注意 `sign` 字段独立于业务数据 |
| Form 格式 | application/x-www-form-urlencoded | 使用 `url.ParseQuery` 解析，禁止框架自动绑定 |

### 异步通知验签核心规则

1. **读取原始 Body**：必须读取未解码的原始请求体
2. **过滤与排序**：剔除 `sign`、`sign_type` 及空值，按 ASCII 升序拼接
3. **值保持原样**：直接使用 URL Decode 后的原始值，严禁二次编码
4. **验签算法**：使用支付宝公钥 + SHA256WithRSA 验证
5. **biz_content 解析**：通知中的 `biz_content` 为 JSON 字符串，需单独解析

### 通知响应要求

- **业务成功**：返回 HTTP 状态码 200，响应体严格为 `success`（无空格/换行）
- **业务失败**：返回 HTTP 500 或其他非 200 状态码，支付宝按 `1m, 2m, 10m, 10m, 10m, 1h, 2h, 6h, 15h` 策略重试
- **幂等控制**：必须基于 `notify_id` 或业务单号实现幂等

## 沙箱配置来源

沙箱分支从[公共配置文件](../sandbox/sandbox-setup-guide.md)读取应用和密钥。以下 Go 示例的私钥字段对应 `appIds[0].appPrivatePkcsKey`（PKCS#1）；原有签名输入处理继续沿用，公共模块不添加头尾、不改写字段。

## Golang 实现参考

### 签名生成（用于主动请求）

```go
import (
    "crypto"
    "crypto/rand"
    "crypto/rsa"
    "crypto/sha256"
    "crypto/x509"
    "encoding/base64"
    "encoding/pem"
    "net/url"
    "sort"
    "strings"
)

// GenerateSign 生成 RSA2 签名
// 注意：此函数不会修改传入的 params map
func GenerateSign(params map[string]string, privateKeyPEM string) (string, error) {
    // 1. 复制参数，过滤 sign 和空值；sign_type 必须参与主动请求签名
    signParams := make(map[string]string, len(params))
    for k, v := range params {
        if k != "sign" && v != "" {
            signParams[k] = v
        }
    }

    // 2. 排序拼接
    keys := make([]string, 0, len(signParams))
    for k := range signParams {
        keys = append(keys, k)
    }
    sort.Strings(keys)

    var sb strings.Builder
    for i, k := range keys {
        if i > 0 {
            sb.WriteString("&")
        }
        sb.WriteString(k)
        sb.WriteString("=")
        sb.WriteString(signParams[k])
    }

    // 3. RSA2 签名
    privKey, err := parsePrivateKey(privateKeyPEM)
    if err != nil {
        return "", err
    }

    hash := sha256.Sum256([]byte(sb.String()))
    signBytes, err := rsa.SignPKCS1v15(rand.Reader, privKey, crypto.SHA256, hash[:])
    if err != nil {
        return "", err
    }

    return base64.StdEncoding.EncodeToString(signBytes), nil
}

func parsePrivateKey(pemStr string) (*rsa.PrivateKey, error) {
    block, _ := pem.Decode([]byte(pemStr))
    if block == nil {
        return nil, fmt.Errorf("invalid PEM format")
    }
    return x509.ParsePKCS1PrivateKey(block.Bytes)
}
```

### 异步通知验签（Webhook）

```go
import (
    "encoding/json"
    "io"
    "net/http"
    "net/url"
)

// ParseAndVerifyWebhook 兼容解析 Form/JSON 并验签
func ParseAndVerifyWebhook(req *http.Request, alipayPubKey string) (map[string]string, error) {
    body, _ := io.ReadAll(req.Body)
    defer req.Body.Close()
    
    params, sign := parsePayload(body)
    if sign == "" {
        return nil, fmt.Errorf("missing sign")
    }
    
    signStr := buildSignString(params)
    if ok, err := VerifyRSA2Sign(signStr, sign, alipayPubKey); err != nil || !ok {
        return nil, fmt.Errorf("verify failed: %v", err)
    }
    
    return params, nil
}

// parsePayload 兼容 JSON 和 Form 格式
func parsePayload(body []byte) (map[string]string, string) {
    params := make(map[string]string)
    var sign string
    
    // 尝试 JSON 格式
    var jsonMap map[string][]string
    if err := json.Unmarshal(body, &jsonMap); err == nil {
        for k, v := range jsonMap {
            if len(v) == 0 {
                continue
            }
            if k == "sign" {
                sign = v[0]
            }
            if k != "sign" && k != "sign_type" {
                params[k] = v[0]
            }
        }
        if sign != "" {
            return params, sign
        }
    }
    
    // 降级 Form 格式
    values, _ := url.ParseQuery(string(body))
    for k, v := range values {
        if len(v) == 0 {
            continue
        }
        if k == "sign" {
            sign = v[0]
        }
        if k != "sign" && k != "sign_type" {
            params[k] = v[0]
        }
    }
    return params, sign
}

// buildSignString 构建待签名字符串
func buildSignString(params map[string]string) string {
    keys := make([]string, 0, len(params))
    for k := range params {
        if k != "" {
            keys = append(keys, k)
        }
    }
    sort.Strings(keys)
    
    var sb strings.Builder
    for i, k := range keys {
        if i > 0 {
            sb.WriteString("&")
        }
        sb.WriteString(k)
        sb.WriteString("=")
        sb.WriteString(params[k])
    }
    return sb.String()
}
```

## 检查清单

| 检查项 | 正确标准 | 常见错误 |
|--------|----------|----------|
| **参数位置** | 公共参数放 URL Query，biz_content 放 POST Body | 所有参数都放 Body（导致签名失败+乱码） |
| **charset 位置** | 必须在 URL Query 中 | 放在 POST Body 中 |
| 密钥配置 | 验签用支付宝公钥，签名用调用应用私钥 | 将调用应用公钥填入验签逻辑 |
| 报文解析 | 手动读原始 Body，按 key=value 拼接 | 依赖框架自动绑定导致二次编码 |
| 主动请求签名 | 过滤 `sign` 和空值，保留 `sign_type`，再按 ASCII 升序 | 错误排除 `sign_type` 或排序错误 |
| 通知响应 | 返回 HTTP 200 + "success" | 返回 JSON 或带换行/空格 |
| 幂等控制 | 基于 notify_id 或业务单号做唯一索引 | 直接覆盖导致重复通知资损 |
| 日志排查 | 记录请求号、字段名、长度和摘要哈希 | 记录完整报文、待签串或签名值造成泄露 |

## 非 SDK 实现的验证与上线准备

- 签名算法、参数排序、字符集和 URL 编码先使用不含真实凭据的本地测试向量做单元测试。
- 本 Skill 的在线联调用[订阅沙箱](sandbox/sandbox-integration.md)的应用、凭据、网关和资源；不向正式网关发送测试请求。
- 需要验证续费或期末取消时，使用订阅沙箱的测试时钟推进，不操作生产测试客户。
- 商家正式验收可能产生真实交易、扣款和通知，须另行审批账号、金额、退款和数据处置安排。生产工程配置可参照[生产配置](production-environment.md)。
- 日志只记录请求号、字段名、长度、脱敏标识和摘要哈希，不记录私钥、授权令牌、完整待签串或签名值。
