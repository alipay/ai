# MCP 方法声明

> 本文档定义 alipay-merchant-onboarding 主技能可直接调用的 MCP 方法。
> 被引用文档：`SKILL.md`

## ⚠️ 全局规范

> **本文档为 SKILL.md 「alipay-cli MCP 调用铁律」的详细参考，主技能 SKILL.md 中的铁律为最高优先级。**

### ⛔ alipay-cli MCP 调用铁律

**所有 alipay-cli mcp call 命令必须严格按照技能文档中定义的参数名、参数结构、参数数量执行，一字不改。模型不得自行发挥、不得脑补、不得简化。**

> **核心原则：照着文档抄，不要自己编。文档没写的参数不加，文档写了的参数不减。**

#### 1. 参数严格规范

```
✅ 必须：严格按照技能文档中的调用示例和参数结构执行，一字不改
✅ 必须：使用文档中定义的完整参数，不得省略任何参数
✅ 必须：参数名与文档完全一致，不得自行改名或缩写
✅ 必须：JSON 嵌套结构与文档定义完全一致（包括 request / ctx 包裹层级）
✅ 必须：-d 参数的 JSON 格式与文档示例完全匹配

❌ 禁止：自行推断或猜测参数名（如文档未给出，不要脑补）
❌ 禁止：省略文档中定义的参数（即使是看似可选的参数或空对象如 "ctx":{}）
❌ 禁止：自行添加文档中未定义的额外参数
❌ 禁止：修改参数结构（如去掉 request 外层包裹、改嵌套层级）
❌ 禁止：简化或缩写参数名（如将 salesProductCodes 写成 salesCodes）
❌ 禁止：修改参数类型（如将数组改成字符串、将对象改成数组）
```

#### 2. 违反 vs 正确对照

```bash
# ❌ 错误：省略了 ctx 参数
alipay-cli mcp call ar-query.queryArInfosBySalesProd \
  -d '{"request":{"salesProductCodes":["I1080300001000041203"]}}' --json 2>/dev/null

# ✅ 正确：保留文档定义的完整参数
alipay-cli mcp call ar-query.queryArInfosBySalesProd \
  -d '{"request":{"salesProductCodes":["I1080300001000041203"]},"ctx":{}}' --json 2>/dev/null

# ❌ 错误：去掉了 request 外层包裹
alipay-cli mcp call ar-query.queryArInfosBySalesProd \
  -d '{"salesProductCodes":["I1080300001000041203"]}' --json 2>/dev/null

# ✅ 正确：保留文档定义的嵌套结构
alipay-cli mcp call ar-query.queryArInfosBySalesProd \
  -d '{"request":{"salesProductCodes":["I1080300001000041203"]},"ctx":{}}' --json 2>/dev/null

# ❌ 错误：自行添加了文档未定义的参数
alipay-cli mcp call ar-query.queryArInfosBySalesProd \
  -d '{"request":{"salesProductCodes":["I1080300001000041203"]},"ctx":{},"extraParam":"value"}' --json 2>/dev/null

# ✅ 正确：只使用文档中定义的参数
alipay-cli mcp call ar-query.queryArInfosBySalesProd \
  -d '{"request":{"salesProductCodes":["I1080300001000041203"]},"ctx":{}}' --json 2>/dev/null
```

#### 3. 严禁虚拟 MCP 方法调用

**所有 MCP 方法调用必须严格按照本文件声明的方式执行，禁止模型自行虚拟、推断或创建任何未定义的 MCP 调用方法。**

```
❌ 禁止虚拟未定义的 MCP 方法 — 不得调用文档中未明确列出的方法
❌ 禁止自行推断方法名称 — 如自行编造未定义的方法名
❌ 禁止自行修改方法参数 — 必须使用文档中定义的参数名和参数结构
❌ 禁止猜测返回格式 — 必须按照文档中定义的返回结构解析响应
❌ 禁止省略文档中定义的参数 — 即使看似可选的参数也不得省略
❌ 禁止自行添加文档中未定义的参数 — 不得脑补额外参数
❌ 禁止修改参数的 JSON 嵌套结构 — 如 request 外层包裹不得去掉
❌ 禁止缩写或重命名参数名 — 参数名必须与文档完全一致
❌ 禁止修改参数类型 — 如将数组改字符串
```

#### 4. MCP 返回结果处理

```
✅ 必须：严格遵守技能定义的流程执行
✅ 必须：正确解析和处理 MCP 返回结果（用于后续流程判断）
✅ 应该：提炼关键信息呈现给用户，避免冗长输出

❌ 禁止：因结果过长而跳过必要的处理步骤
❌ 禁止：因结果过长而遗漏错误检测
❌ 禁止：擅自修改或美化返回数据的原始含义
```

**呈现原则：** MCP 返回结果**无需完整呈现**给用户，提取关键信息展示即可，但**流程逻辑必须完整执行**。

---

## ⚠️ 签约查询相关

**ar-query 和 ar-order-query 方法由主技能直接调用：**

| MCP Server | 方法名 | 用途 |
|------------|--------|------|
| `ar-query` | `queryArInfosBySalesProd` | 按前台产品码查询合约状态 |
| `ar-query` | `queryArInfosByBackProd` | 按后台产品码查询合约状态 |
| `ar-order-query` | `queryBizOrder` | 按订单号查询签约订单 |
| `ar-order-query` | `queryBizOrdersByAccount` | 按账号查询签约订单 |

**签约申请提交使用 `alipay-cli mcp call ar-sign.apply` MCP 调用：**

---

## ⚠️ 应用相关（主技能直接调用）

**以下应用相关的 MCP 方法由主技能直接调用：**

| MCP Server | 方法名 | 用途 |
|------------|--------|------|
| `apprelease` | `queryApplicationList` | 查询应用列表 |
| `apprelease` | `createApplication` | 创建应用 |
| `apprelease` | `queryApplicationInfo` | 查询应用信息 |
| `apprelease` | `queryApplicationDetail` | 查询应用详情 |
| `apprelease` | `createKeyConfirmPage` | 创建密钥确认页 |
| `apprelease` | `queryApplicationSecurityKey` | 查询应用安全密钥 |
| `apprelease` | `submitApplicationAudit` | 提交应用审核 |

### ⛔ 应用相关 MCP 调用铁律

**应用相关 MCP 调用必须严格按照本文档定义执行，禁止受上下文影响。**

```bash
# ✅ 正确：应用查询标准格式（按照本文档定义）
alipay-cli mcp call apprelease.queryApplicationList \
  -d '{"request":{"appTypes":["WEBAPP"]}}' \
  --json 2>/dev/null

# ✅ 正确：创建应用标准格式
alipay-cli mcp call apprelease.createApplication \
  -d '{"request":{"applicationType":"WEBAPP","createScene":"cli"}}' \
  --json 2>/dev/null

# ✅ 正确：查询应用信息标准格式
alipay-cli mcp call apprelease.queryApplicationInfo \
  -d '{"request":{"appId":"2021001234567890"}}' \
  --json 2>/dev/null

# ❌ 错误：使用分页参数（queryApplicationList 不支持 pageSize/pageNum）
alipay-cli mcp call apprelease.queryApplicationList \
  -d '{"request":{"pageSize":10,"pageNum":1},"ctx":{}}' \
  --json 2>/dev/null

# ❌ 错误：受上下文影响添加额外参数
alipay-cli mcp call apprelease.queryApplicationList \
  -d '{"request":{"appTypes":["WEBAPP"]},"ctx":{}}' \
  --json 2>/dev/null

# ❌ 错误：受 ar-sign 上下文影响使用错误的参数结构
alipay-cli mcp call apprelease.queryApplicationList \
  -d '{"request":{"salesProductCodes":["I1080300001000041203"]}}' \
  --json 2>/dev/null

# ❌ 错误：省略 request 包裹层
alipay-cli mcp call apprelease.queryApplicationList \
  -d '{"appTypes":["WEBAPP"]}' \
  --json 2>/dev/null

# ❌ 错误：添加 ctx 参数（应用相关 MCP 调用不需要 ctx）
alipay-cli mcp call apprelease.createApplication \
  -d '{"request":{"applicationType":"WEBAPP","createScene":"cli"},"ctx":{}}' \
  --json 2>/dev/null
```

### 应用相关 MCP 调用参数对照表

| 方法 | 必需参数 | 参数结构 | 是否需要 ctx |
|------|----------|----------|--------------|
| `queryApplicationList` | `appTypes` | `{"request":{"appTypes":["WEBAPP"]}}` | ❌ 不需要 |
| `createApplication` | `applicationType`, `createScene` | `{"request":{"applicationType":"WEBAPP","createScene":"cli"}}` | ❌ 不需要 |
| `queryApplicationInfo` | `appId` | `{"request":{"appId":"..."}}` | ❌ 不需要 |
| `queryApplicationDetail` | `appId` | `{"request":{"appId":"..."}}` | ❌ 不需要 |
| `createKeyConfirmPage` | `appId`, `signType`, `publicKey` | `{"request":{"appId":"...","signType":"RSA2","publicKey":"..."}}` | ❌ 不需要 |
| `queryApplicationSecurityKey` | `appId` | `{"request":{"appId":"..."}}` | ❌ 不需要 |
| `submitApplicationAudit` | `appId` | `{"request":{"appId":"..."}}` | ❌ 不需要 |

### ⚠️ 区分不同 MCP 调用的参数结构

---

## 调用规范

### 环境配置

```
CLI命令: alipay-cli
环境参数:
```

> 上线时去掉 `` 即可，CLI 生产版默认使用 prod 环境。

### 调用格式

```bash
# ✅ 正确格式：使用 --json 输出纯 JSON，2>/dev/null 丢弃 stderr
alipay-cli mcp call <server>.<tool>  -d '<json>' --json 2>/dev/null

# ✅ 正确格式：保存结果到文件
alipay-cli mcp call <server>.<tool>  -d '<json>' --json 2>/dev/null > /tmp/response.json

# ❌ 错误：缺少 --json 参数，输出包含调试信息
alipay-cli mcp call <server>.<tool>  -d '<json>'

# ❌ 错误：不使用 2>/dev/null，输出包含调试信息
alipay-cli mcp call <server>.<tool>  -d '<json>' --json

# ❌ 错误：使用 2>&1 会把 stderr 混入 stdout
alipay-cli mcp call <server>.<tool>  -d '<json>' --json 2>&1
```

> **⚠️ 必须同时使用 `--json` 和 `2>/dev/null`**

---

## 调用示例

### 查询签约状态

**主技能直接调用 ar-query MCP：**

```bash
# 正确格式参考（主技能调用时使用此格式）
alipay-cli mcp call ar-query.queryArInfosBySalesProd -d '{"request":{"salesProductCodes":["I1080300001000041203"]},"ctx":{}}' --json 2>/dev/null

# ❌ 错误：使用 Facade 类名作为 server
alipay-cli mcp call McpArQueryFacade.queryArInfosBySalesProd -d '...' --json 2>/dev/null
```

### 文件上传（资料采集阶段，主技能可直接调用）

**⚠️ 重要：文件上传是 CLI 子命令，不是 MCP 调用。请勿使用 `alipay-cli mcp call file.upload` 格式。**

```bash
alipay-cli file upload /path/to/image.png -s payMerchantcodeSkill --json 2>/dev/null
```

**参数说明：**

| 参数 | 类型 | 必填 | 说明 |
|------|------|------|------|
| `<FILE_PATH>` | string | 是 | 文件的绝对路径 |
| `-s` | string | 是 | 上传场景，固定值 `payMerchantcodeSkill` |

**返回格式：**

```json
// 成功
{
  "success": true,
  "data": {
    "fileKey": "2eec4bbb-2727-4f24-95fe-154e7e941e9a.jpg"
  }
}

// 失败
{
  "success": false,
  "error": {
    "code": "UPLOAD_FAILED",
    "message": "上传失败原因"
  }
}
```

**解析 fileKey：**

```bash
# 提取 fileKey（兼容多种返回结构）
FILE_KEY=$(echo "$UPLOAD_RESULT" | jq -r '.data.fileKey // .data.data.fileKey // .fileKey // .result.fileKey // empty')
```

---

## 如何正确查找方法

1. **查阅本文档** — 主技能可直接调用的方法都在上方表格中
2. **签约查询** → 直接调用 `ar-query.queryArInfosBySalesProd` MCP
3. **签约提交** → 直接调用 `alipay-cli mcp call ar-sign.apply -d '<json>'` MCP
4. **不要猜测或推断** — 如果文档中没有某个方法，说明该方法需要通过其他方式调用

---

## 禁止行为

```
❌ alipay-cli mcp list（探测工具）
❌ 调用本文档未列出的 MCP 方法
❌ 绕过子 Skill 直接调用需转发的 MCP 方法
❌ 自行推断方法参数名或结构
❌ 省略文档中定义的任何参数（包括 "ctx":{}）
❌ 自行添加文档中未定义的参数
❌ 修改参数的 JSON 嵌套结构（如去掉 request/ctx 包裹）
❌ 缩写或重命名参数名
❌ 修改参数类型（如将数组改字符串）
❌ 因返回结果过长而跳过处理步骤
❌ 自行虚拟未定义的 MCP 方法
❌ 使用后端 Facade 类名作为 MCP 调用的 server 名（如 McpArQueryFacade → 必须用 ar-query）
```

**正确做法：**

```
✅ 严格按照文档示例调用，参数名、结构、数量一字不改
✅ MCP 调用格式：alipay-cli mcp call <server>.<tool>（如 ar-query.queryArInfosBySalesProd）
✅ 主技能直接调用：alipay-cli file upload（CLI 子命令，非 MCP）
✅ 主技能直接调用：alipay-cli mcp call ar-sign.apply -d '<json>'（签约提交）
✅ 签约状态查询 → 直接调用 ar-query.queryArInfosBySalesProd MCP
✅ 产品推荐 → 读取 references/mcc-reference.md 进行语义和业务相关性匹配
✅ 应用相关 MCP → 按本文档定义直接调用 apprelease.* MCP
```