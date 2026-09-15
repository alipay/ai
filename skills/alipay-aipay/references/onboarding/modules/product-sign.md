# 产品签约业务语义

本模块说明签约状态、材料和写操作边界。运行时命令与分支以 `../flow.md` 为准；请求参数、错误检测和解析由 `scripts/query_sign_status.sh`、`scripts/sign_status_parser.sh` 与 `scripts/ar_sign_apply.sh` 实现。

## 当前主流程 MCP 能力

| MCP 方法 | 用途 |
| --- | --- |
| `ar-sign.apply` | 提交当前产品签约申请 |
| `ar-query.queryArInfosBySalesProd` | 查询当前 salesCode 的签约状态 |
| `ar-support.queryMcc` | 查询当前产品支持的 MCC 类目树 |
| `mccsearchservice.batchQueryMcc` | 查询命中且 `needSpecialQual=true` 的二级 MCC 特殊资质项 |

`queryMcc`、签约查询和签约提交使用 `{"request":{...},"ctx":{}}`；`batchQueryMcc` 使用 `{"request":{"mccCodes":[...]}}`。完整 payload 只在脚本中维护；Agent 不从本模块自行构造 MCP 调用。

`queryMcc` 成功树按同一 run、产品短时缓存，并逐项提供二级 MCC 编码、名称、描述和布尔型 `needSpecialQual`；任一必需字段缺失、为空或类型异常均失败关闭，不从其他字段回退。非精确编码时，Agent 应先理解用户原话，并在行业俗称或场景表达与目录用词可能不同时于首次调用一并提供有原话依据的行业概念或同义表达；本地词面结果为 `NONE`、候选冲突或低置信时，runner 可发出一次目录复核 marker，携带同一次 `queryMcc` 返回的当前产品 MCC 名称、描述和稳定引用；Agent 只返回该 marker 中的目录引用，runner 映射并校验为当前动态目录中的候选，不接受自由提交 MCC code。稳定引用由完整动态目录生成，并随候选裁剪和资格详情合并原样携带；最终方案 runner 不得按缩减后的候选数组重新编号。目录复核不新增 MCP/网络调用，语义扩充仍按 flow 最多完成两次。候选确定后，仅把其中 `needSpecialQual=true` 的编码集中交给一次 `batchQueryMcc` 获取特殊资质项；没有此类候选时不调用。多候选的完整树事实和资格详情按 run、产品、原查询、规范化语义词和选择回执缓存，用户选择时携带同一语义词且有效命中则两种 MCC 方法都不重调。缓存默认 1800 秒、无有效 run 不落盘；过期、损坏、符号链接、跨 run、语义词变化或事实哈希不一致时忽略并从完整当前产品目录重查，不修补缓存事实，不做产品级全量预取。

## 签约状态

`scripts/sign_status_parser.sh` 是授权内查询与独立签约查询的唯一解析实现。只有实际响应包含合法 `resultObj.arInfoList`，并唯一输出匹配的 `SIGN_STATUS`、`FLOW:*`、`AUTH_SIGN_QUERY_REUSABLE=true` 和 `AUTH_SIGN_REUSE_RECEIPT`，授权结果才优先通过回执复用；结构缺失、冲突或不可唯一解析时必须独立查询。兼容窗口内旧 `SIGN_STATUS + FLOW:*` 双参数仍可复用，`FLOW:` 前缀可带可不带，但 runner 必须重新校验产品、salesCode、状态和 flow 一致。

| 状态 | 业务处理 |
| --- | --- |
| `NOT_SIGNED` | 按当前产品收集并校验材料，完整后直接提交 |
| `SIGN_SUBMITTED` | 已提交等待生效，禁止重复签约 |
| `SIGNED_EFFECTIVE` | 已生效，禁止重复签约 |
| `OTHER_STATUS` | 展示实际状态并待核验，禁止提交 |
| `QUERY_FAILED` | 只阻断签约分支，不推断为空或未签约 |

合法复用组合固定为：`NOT_SIGNED + 当前产品未签约 FLOW`、`SIGNED_EFFECTIVE|SIGN_SUBMITTED + 当前产品已签约 FLOW`、`OTHER_STATUS + FLOW:OTHER_STATUS`。不得把 `OTHER_STATUS` 映射为已签约或未签约。

现有查询请求不含 MCC，已验证响应也没有权威 MCC 字段。授权链路只能表述为授权 URL 精确绑定目标 MCC；没有新证据时不得增加响应 MCC 比较或修改 MCP payload。

## 材料与提交

- AI 按量付费：无需截图。
- AI 网页应用收款：首页、商品页、支付页三张截图，支付页必须展示支付宝付款方式并等待用户付款，不得替换为支付成功页。
- AI 移动应用收款：APP 名称和首页、商品页、支付页三张截图；签约状态参数固定按脚本的 `OFFLINE`。
- 当前 MCC 返回 `needSpecialQual=true` 时，还需按本轮 `qualificationGroups` 选择一个资质组合。多个 group 是 OR 关系；同一 group 内多个 qualifications 是 AND 关系。`attaType` 为空或 null 的 qualification 只展示 `qualName` 作为文字条件，不上传、不进入 `specialLicense`；`attaType` 非空的 qualification 必须上传对应材料。

材料缺失或校验失败时使用 flow 登记的 `materials.category.collect`，不得提交。完整通过后直接执行签约脚本，不增加确认。截图只走 `upload_screenshots.sh`。特殊资质上传和签约都必须携带本轮 run 的 `MCC_CONTEXT_RECEIPT` 与用户所选组合序号；脚本按回执精确校验 `licenseType` 顺序，纯文字组合不上传并在签约校验中使用空数组。

特殊资质图片上传与首页/商品页/支付页截图上传一致，均调用 `alipay-cli file upload -s payMerchantcodeSkill --json` 并使用返回的图片引用值；三张页面截图固定串行上传，避免多个 CLI 进程并发读取认证态。`scripts/upload_special_license.sh` 按所选组合的材料顺序接收文件，从已校验回执派生内部 `licenseType`，再转换为 `[{licenseType,licensePic}]`；Agent 和用户不提供或看到类型码，`licensePic` 使用上传返回值，不要求 HTTPS URL。提交签约时，非空 `specialLicense` 作为 `businessProperty` 中与 `mccCode` 并列的字段传给 `ar-sign.apply`。

提交成功只表示申请已受理，不等于签约生效；服务和应用分支按各自前置条件继续，不依赖本次签约写成功。写操作仅明确 `NOT_SENT` 时可自动重试；`MAYBE_SENT` 必须先用现有签约查询核验，无法确认进入 `UNKNOWN`，禁止重复提交。

提交脚本必须输出动作级结果事实：`SIGN_APPLY_RESULT=SUCCESS` 表示提交已受理并继续；`SIGN_APPLY_RESULT=UNKNOWN` 表示响应不明且查询无法核验，签约分支进入未知待办；`SIGN_APPLY_RESULT=FAILED` 表示明确失败或明确未发送重试耗尽。三者不改变 MCP payload，也不能阻断服务和应用的独立前置分支。

签约结果只通过消息目录的 `signing.operation.result` 输出。不得展示未登记审核规则、费率承诺、可收款时间或原始响应；费率、额度和生效问题引导用户在支付宝商家平台查询。
