# 状态管理

> 本文档定义状态的管理规范。
> 被引用文档：`SKILL.md`

## ⛔ 状态字段铁律（最高优先级）

**内存状态只允许存在以下字段，禁止存储任何其他字段！**

> **核心原则：只存必要字段，其他数据走运行时变量。流程结束自动清理。**

### 允许的字段

```json
{
  "productName": "电脑网站支付|AI收",
  "salesCode": "I1080300001000041203|I1080300001000160457",
  "scope": "app:all,fast_instant_trade_pay:write|app:all,machine_pay:write,agmnt:write",
  "mccCode": "Axxxx_Bxxxx",
  "mccName": "一级类目 > 二级类目",
  "collect_information": {
    "pc_home_page_image": "fileKey（仅电脑网站支付）",
    "pc_shop_page_image": "fileKey（仅电脑网站支付）",
    "pc_payment_image": "fileKey（仅电脑网站支付）"
  }
}
```

### 字段说明

| 字段 | 类型 | 写入时机 | 来源 | 说明 |
|------|------|----------|------|------|
| `productName` | string | Step 2 方案规划确认后 | 用户选择 | "电脑网站支付" 或 "AI收" |
| `salesCode` | string | Step 2 方案规划确认后 | 产品映射 | 产品码，决定产品和 scope |
| `scope` | string | Step 2 方案规划确认后 | salesCode 映射 | OAuth 授权范围 |
| `mccCode` | string | Step 2 MCC选择后 | 用户选择 | 经营类目编码 |
| `mccName` | string | Step 2 MCC选择后 | 用户选择 | 经营类目名称 |
| `collect_information` | object | Step 4 截图上传后 | `alipay-cli file upload` 返回 | 仅电脑网站支付有值 |

### scope 映射

| salesCode | scope |
|-----------|-------|
| I1080300001000041203 | `app:all,fast_instant_trade_pay:write` |
| I1080300001000160457 | `app:all,machine_pay:write,agmnt:write` |

### 禁止存储的字段

```
❌ status              → 禁止（流程状态通过 MCP 真实查询）
❌ deviceCode / browserUrl / verificationCode → 禁止（临时变量，用完即弃）
❌ ar_sign_data        → 禁止（由签约模块内部管理）
❌ service_market_data → 禁止（运行时变量）
❌ appId / merchantPid / authToken / userId → 禁止（子模块返回）
❌ 任何其他字段        → 禁止
```

---

## 内存状态管理方式

**所有状态数据保存在对话上下文中，不使用文件持久化。**

### 状态初始化

```
在对话上下文中初始化状态变量：
- productName: ""
- salesCode: ""
- scope: ""
- mccCode: ""
- mccName: ""
- collect_information: {}
```

### 状态更新

```
在对话上下文中更新状态变量：
- productName = "电脑网站支付"
- salesCode = "I1080300001000041203"
- scope = "app:all,fast_instant_trade_pay:write"
- mccCode = "A0003_B0223"
- mccName = "零售批发 > 互联网综合电商平台"
- collect_information = {"pc_home_page_image": "key1", ...}
```

### 状态读取

```
在对话上下文中使用状态变量：
- 产品：${productName} (${salesCode})
- 授权范围：${scope}
- 经营类目：${mccCode}
```

---

## 任务管理规范（最高优先级）

**入驻流程必须使用 TaskCreate/TaskUpdate/TaskList 进行任务管理，确保流程可追踪、可断点续。**

### 任务创建

**⚠️ 重要：TaskCreate 必须按以下顺序依次调用，任务列表显示顺序取决于调用顺序！**

```
按顺序依次调用 TaskCreate：

第1步: TaskCreate({ subject: "环境检查" })
       ↓ 等待返回
第2步: TaskCreate({ subject: "方案规划" })
       ↓ 等待返回
第3步: TaskCreate({ subject: "登录授权" })
       ↓ 等待返回
第4步: TaskCreate({ subject: "资料采集" })
       ↓ 等待返回
第5步: TaskCreate({ subject: "入驻推进" })
       ↓ 等待返回
第6步: TaskCreate({ subject: "流程结束" })
```

**生成的任务列表将按此顺序显示：**
```
1. 环境检查
2. 方案规划
3. 登录授权
4. 资料采集
5. 入驻推进
6. 流程结束
```

**⚠️ 注意：**
- "状态查询"是"登录授权"后的子操作，不作为独立任务
- 禁止并行调用多个 TaskCreate（会导致顺序错乱）
- 必须：前一个 TaskCreate 返回后，再调用下一个 TaskCreate

### 任务状态流转

```
pending → in_progress → completed
```

---

## 非 state 数据的处理位置

| 数据 | 处理方式 | 说明 |
|------|----------|------|
| mccCode / mccName | 内存状态 | 方案规划时保存 |
| screenshot fileKey | collect_information | 截图上传后保存 |
| deviceCode / verificationCode | 运行时变量 | login 返回后用完即弃 |
| browserUrl | 运行时变量 | 授权链接用完即弃 |
| 服务注册入参 | 运行时变量 | 主技能直接调用服务市场 MCP |
| ar申请相关数据 | 运行时变量 | MCP 直接调用，无需本地存储 |

---

## 流程结束

**流程结束后，对话上下文自动清理，无需手动删除状态。**

步骤：
1. 输出入驻结果摘要
2. 使用 TaskUpdate 标记所有任务为 completed
3. 对话结束，状态自动清理