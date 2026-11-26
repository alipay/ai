# Go 语言实现示例

本文档提供一个完整的 Go 语言实现示例，基于 Gin 框架构建订阅服务后端。

## 项目结构

```
backend/
├── cmd/
│   └── server/main.go          # 程序入口
├── internal/
│   ├── config/config.go        # 配置管理
│   ├── handler/
│   │   ├── customer.go         # 客户接口
│   │   ├── product.go          # 商品接口
│   │   ├── subscription.go     # 订阅接口
│   │   └── webhook.go          # 异步通知处理
│   ├── model/
│   │   ├── customer.go         # 客户模型
│   │   ├── product.go          # 商品模型
│   │   └── subscription.go     # 订阅模型
│   ├── repository/db.go        # 数据库操作
│   └── service/
│       ├── alipay.go           # 支付宝客户端
│       └── sign.go             # 签名/验签
├── pkg/response/response.go    # 统一响应
└── config.yaml                 # 配置文件
```

## 沙箱凭据读取

沙箱工程先按[公共配置指南](../sandbox/sandbox-setup-guide.md)执行 ensure，再从明确的项目根读取同一份 JSON。下面返回原始字段：`AppID`、`AlipayPublicKey` 对应原客户端字段，`AppPrivatePkcsKey` 对应本示例所用 PKCS#1 私钥，`MerchantID` 供调用登记使用。沿用原有密钥输入处理和签名逻辑，不新增包装流程，不修改 JSON 中的原值；生产来源保持原配置。

```go
package config

import (
    "encoding/json"
    "errors"
    "os"
    "path/filepath"
)

type SandboxApp struct {
    AppID             string `json:"appId"`
    AppPrivateKey     string `json:"appPrivateKey"`
    AppPrivatePkcsKey string `json:"appPrivatePkcsKey"`
    AlipayPublicKey    string `json:"alipayPublicKey"`
}

type SandboxCredentials struct {
    App        SandboxApp
    MerchantID string
}

func LoadSandbox(projectRoot string) (SandboxCredentials, error) {
    var result SandboxCredentials
    if !filepath.IsAbs(projectRoot) {
        return result, errors.New("sandbox project root must be absolute")
    }
    file := filepath.Join(projectRoot, ".alipay-sandbox.json")
    stat, err := os.Lstat(file)
    if err != nil || !stat.Mode().IsRegular() {
        return result, errors.New("sandbox config is missing or unsafe")
    }
    raw, err := os.ReadFile(file)
    if err != nil { return result, errors.New("sandbox config cannot be read") }
    var data struct {
        Apps []SandboxApp `json:"appIds"`
        Accounts struct {
            Partner struct { UserID string `json:"userId"` } `json:"partner"`
        } `json:"sandboxAccounts"`
    }
    if json.Unmarshal(raw, &data) != nil || len(data.Apps) == 0 {
        return result, errors.New("invalid sandbox config")
    }
    app, pid := data.Apps[0], data.Accounts.Partner.UserID
    if app.AppID == "" || app.AppPrivatePkcsKey == "" || app.AlipayPublicKey == "" || pid == "" {
        return result, errors.New("incomplete sandbox credentials")
    }
    return SandboxCredentials{App: app, MerchantID: pid}, nil
}
```

现有服务端配置中的 `GatewayURL` 固定使用 `https://openapi-sandbox.dl.alipaydev.com/gateway.do`；`NotifyURL`、`ReturnURL` 等仍来自业务配置。不得在配置缺失时回退到另一套环境变量密钥。

## 核心代码

### 1. 配置结构

```go
type AlipayConfig struct {
    AppID           string `mapstructure:"app_id"`
    PrivateKey      string `mapstructure:"private_key"`
    AlipayPublicKey string `mapstructure:"alipay_public_key"`
    GatewayURL      string `mapstructure:"gateway_url"`
    NotifyURL       string `mapstructure:"notify_url"`
    ReturnURL       string `mapstructure:"return_url"`
    MockMode        bool   `mapstructure:"mock_mode"` // Mock模式，开发调试用
}
```

### 2. 支付宝客户端

```go
type AlipayClient struct {
    AppID           string
    PrivateKey      string
    AlipayPublicKey string
    GatewayURL      string
    NotifyURL       string
    ReturnURL       string
    HTTPClient      *http.Client
    MockMode        bool
}

// Execute 通用请求方法
// 重要：公共参数必须放在 URL Query 中，biz_content 放在 POST Body 中
func (c *AlipayClient) Execute(method string, bizContent interface{}) ([]byte, error) {
    if c.MockMode {
        return nil, errors.New("mock mode: supply a local response fixture; no network request sent")
    }
    // 1. 公共请求参数（放在URL查询字符串中）
    publicParams := map[string]string{
        "app_id":    c.AppID,
        "method":    method,      // 如：alipay.trade.product.create
        "format":    "JSON",
        "charset":   "UTF-8",     // 必须在URL中！
        "sign_type": "RSA2",
        "timestamp": time.Now().Format("2006-01-02 15:04:05"),
        "version":   "1.0",
    }

    // 2. 完整参数（用于签名计算，包含 biz_content）
    allParams := make(map[string]string)
    for k, v := range publicParams {
        allParams[k] = v
    }

    // 序列化业务参数
    var bizContentStr string
    if bizContent != nil {
        bizBytes, _ := json.Marshal(bizContent)
        bizContentStr = string(bizBytes)
        allParams["biz_content"] = bizContentStr
    }

    // 3. 生成签名（签名需包含所有参数，包括 biz_content）
    sign, _ := GenerateSign(allParams, c.PrivateKey)
    publicParams["sign"] = sign

    // 4. 构建URL查询字符串（公共参数）
    queryValues := url.Values{}
    for k, v := range publicParams {
        queryValues.Set(k, v)
    }
    requestURL := c.GatewayURL + "?" + queryValues.Encode()

    // 5. 构建POST body（仅包含 biz_content）
    postData := url.Values{}
    if bizContentStr != "" {
        postData.Set("biz_content", bizContentStr)
    }

    // 6. 发送请求
    resp, _ := c.HTTPClient.PostForm(requestURL, postData)
    // ... 解析响应
}
```

> ⚠️ **关键注意**：`charset` 参数必须放在 URL Query 中，否则会导致签名验证失败和响应乱码。

### 3. RSA2 签名实现

```go
// GenerateSign 生成 RSA2 签名
// 注意：此函数不会修改传入的 params map
func GenerateSign(params map[string]string, privateKeyPEM string) (string, error) {
    // 复制参数，避免修改原 map（重要！）
    signParams := make(map[string]string, len(params))
    for k, v := range params {
        if k != "sign" && v != "" {
            signParams[k] = v
        }
    }

    signString := buildSignString(signParams)  // ASCII 升序拼接

    privateKey, _ := parsePrivateKey(privateKeyPEM)
    hashed := sha256.Sum256([]byte(signString))
    signature, _ := rsa.SignPKCS1v15(rand.Reader, privateKey, crypto.SHA256, hashed[:])

    return base64.StdEncoding.EncodeToString(signature), nil
}

// buildSignString 构建待签名字符串
func buildSignString(params map[string]string) string {
    keys := make([]string, 0, len(params))
    for k := range params {
        if params[k] != "" {
            keys = append(keys, k)
        }
    }
    sort.Strings(keys)

    var parts []string
    for _, k := range keys {
        parts = append(parts, fmt.Sprintf("%s=%s", k, params[k]))
    }
    return strings.Join(parts, "&")
}
```

### 4. 异步通知处理

```go
func (h *WebhookHandler) AlipayNotify(c *gin.Context) {
    // 解析表单参数
    c.Request.ParseForm()
    params := ParseNotifyParams(c.Request.Form)

    // 验证签名
    if !h.alipayClient.VerifyCallback(params) {
        c.String(http.StatusBadRequest, "fail")
        return
    }

    // 幂等处理：检查 notify_id 是否已处理
    // TODO: 使用 Redis 或数据库记录

    // 根据变更类型处理（alipay.trade.subscription.changed 通知的 change_type）
    switch params["change_type"] {
    case "active":
        // 订阅已生效，更新订阅状态为 ACTIVE
    case "period_extend":
        // 续费成功，更新周期时间
    case "cancel":
        // 订阅已取消，更新状态为 CANCELED
    }

    // 必须返回 "success"（无换行空格）
    c.String(http.StatusOK, "success")
}
```

### 5. 数据模型

```go
type Subscription struct {
    ID                 string    `gorm:"primaryKey"`
    CustomerID         string    `gorm:"index"`
    SubscriptionID     string    `gorm:"uniqueIndex"` // 支付宝订阅ID
    ProductID          string
    Status             string    // INCOMPLETE/INCOMPLETE_EXPIRED/ACTIVE/TRIALING/PAST_DUE/CANCELED/UNPAID/PAUSED
    CancelAtPeriodEnd  bool      // true=周期结束后失效，false=继续续费
    CurrentPeriodStart time.Time
    CurrentPeriodEnd   time.Time
    CreatedAt          time.Time
    UpdatedAt          time.Time
}
```

## API 方法名对照

> ⚠️ 注意：API 方法名使用 `alipay.trade.*` 而非 `alipay.merchant.*`

| 功能 | 正确方法名 |
|-----|-----------|
| 创建商品 | `alipay.trade.product.create` |
| 查询商品 | `alipay.trade.product.query` |
| 创建价格 | `alipay.trade.price.create` |
| 创建客户 | `alipay.trade.customer.create` |
| 创建订阅 | `alipay.trade.subscription.create` |
| 查询订阅 | `alipay.trade.subscription.query` |
| 修改订阅 | `alipay.trade.subscription.modify` |

## 配置示例

以下是原有业务配置形状；沙箱运行时由上面的加载器提供 app_id/private_key/alipay_public_key，不再把凭据另存到 YAML。

```yaml
# config.yaml
server:
  port: 8080
  mode: release

database:
  path: ./data.db

alipay:
  app_id: "YOUR_APP_ID"
  private_key: "YOUR_APP_PRIVATE_KEY"
  alipay_public_key: "YOUR_ALIPAY_PUBLIC_KEY"
  gateway_url: "https://openapi-sandbox.dl.alipaydev.com/gateway.do"
  notify_url: "https://your-domain.com/api/alipay/notify"
  return_url: "https://your-domain.com/subscription/success"
  mock_mode: true  # 本地调试阻止出网；需要模拟结果时由测试提供响应样例
```

示例的 `Execute` 在模拟模式下直接返回错误（需导入 Go 标准库 `errors`），不会发出请求。需要链路联调时，显式切到[沙箱](sandbox/sandbox-integration.md)并注入同一沙箱的凭据；生产工程的配置另见[生产配置](production-environment.md)。

## 运行服务

```bash
go run cmd/server/main.go -config config.yaml
```

## 注意事项

1. **Mock 模式**：开发调试时开启 `mock_mode: true`，跳过真实 API 调用
2. **密钥格式**：私钥需要 PEM 格式，包含 `-----BEGIN RSA PRIVATE KEY-----` 头部
3. **幂等处理**：异步通知必须根据 `notify_id` 实现幂等，防止重复处理
4. **响应格式**：异步通知必须返回 HTTP 200 + `"success"`（无换行空格）
