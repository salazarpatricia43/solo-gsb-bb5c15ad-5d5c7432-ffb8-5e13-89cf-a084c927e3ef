# JSON 契约工坊（JSON Contract Studio）

把零散的 JSON 样本整理成接口契约：粘贴多份 JSON，系统递归归纳出 **JSON Schema 2020-12**，
自动处理字段缺失、`null`、异构数组与类型冲突，并在树形视图中标注每条规则对应的样本路径；
支持一键复制 Schema、校验新样本并按 **JSON Pointer** 展示错误；
用**样本贡献度**分析逐条评估样本对契约的影响（关键/冗余，附受影响的规则 Pointer）；
还可按一个 **JSON Pointer 判别字段**生成**事件变体契约**（按判别值分组、各组分别归纳为
带 `const` 的 `oneOf` 分支）；
还可把归纳结果设为基线，对比新旧两版 Schema 的**契约演进**（破坏性/兼容判定），
为每条破坏性变更加载**反例样本**（递归构造最小 JSON 并用 Ajv 双侧校验），
用**样本影响扫描**把历史样本集按基线/当前 Schema 逐条校验并归类（两版均通过、仅基线通过、
仅当前通过、两版均失败），
并通过**发布门禁**结合基线/目标 SemVer 给出允许或阻止发布的结论与可复制报告。

技术栈：Node.js · Express · React（Vite）· Ajv（draft 2020-12）

## 快速开始（Docker，单条命令）

```bash
docker compose up --build
```

启动后访问：**http://localhost:8080**

> 依赖安装、前端构建、后端运行全部包含在该命令内，无需任何本地环境（除 Docker）。
> 不使用 Compose 时亦可：`docker build -t json-contract-studio . && docker run -p 8080:8080 json-contract-studio`

停止：`docker compose down`。

## 功能与归纳规则

| 场景 | 归纳结果 |
| --- | --- |
| 字段在部分样本中缺失 | 该字段不进入 `required`（即可选） |
| 字段出现 `null` | `type` 变为联合类型，如 `["null", "string"]` |
| 整数与浮点混排 | 放宽为 `"number"` |
| 异构数组（如 `["a", 1, null]`） | 所有元素折叠为单个 `items`，类型取并集 |
| 对象与标量冲突 | `type` 并集，如 `["string", "object"]`，`properties` 仅约束对象实例 |
| 全为空数组 | 不生成 `items` 约束（任何元素均可） |

- **树形视图**：每个节点显示类型徽章、必填/可选/可空/多类型标记；点击「n 处样本」展开
  贡献该规则的样本路径（`#/<样本序号>/<路径>`，RFC 6901 转义）。
- **复制 Schema**：一键复制完整 Schema JSON 到剪贴板。
- **校验新样本**：基于 Ajv（`allErrors`），错误按 JSON Pointer（如 `/tags/0`）展示，
  并附带关键字、信息与对应规则路径。
- **样本贡献度**：在「① 样本输入」区一键做留一法分析——逐条移除样本并重新归纳 Schema，
  与完整样本集的归纳结果按规范化后的规则对比，判定每条样本为**关键**（移除后规则变化）
  或**冗余**（移除后规则完全一致），并列出受影响的 JSON Pointer；结果区展示关键/冗余数量，
  可按类型筛选、展开受影响规则，并一键定位到原始样本。单次最多 50 条。
- **契约演进对比**：把当前归纳结果设为基线，修改样本后归纳新版 Schema，比较器递归处理
  对象属性、`required`、类型联合与数组 `items`，在结果区按 JSON Pointer 分组展示变更清单；
  每条变更给出旧/新规则与判定原因，可一键筛选破坏性项。
- **破坏性反例生成**：每条**破坏性**变更可展开「生成反例」。后端依据新旧 Schema、当前视角与
  变更 JSON Pointer 递归构造**最小 JSON**——请求体视角须「旧版通过、新版拒绝」，响应体视角须
  「新版通过、旧版拒绝」；沿途的必填兄弟字段自动填入可通过校验的占位值。覆盖新增/取消必填、
  类型收窄/放宽、数组 `items` 新增/移除。构造后用 Ajv 同时校验两侧，仅在方向确实成立时返回
  样本与双侧错误；若变更被 `enum` 等其他约束抵消而无法构造，则返回明确的不可构造原因。
  展开后可查看格式化样本、双侧校验结论与 Ajv 错误（Pointer/关键字/规则路径/参数），并一键复制样本。
- **样本影响扫描**：在演进页粘贴一个 JSON 数组作为历史样本集，后端用 Ajv 把每条样本分别按
  **基线**与**当前** Schema 校验，归类为「两版均通过 / 仅基线通过 / 仅当前通过 / 两版均失败」；
  结果区按类展示数量与样本索引（`#0`、`#1`…），展开单条可查看两侧错误的 JSON Pointer、关键字与信息。
  单次最多 200 条，超限或输入非数组时前后端都会给出明确错误。
- **发布门禁**：在演进页填写基线版本（当前 SemVer）与目标版本（新版 SemVer），门禁复用当前
  `/api/diff` 差异汇总即时给出「允许/阻止发布」结论，展示实际升级类型、触发结论的变更数量与
  原因，并可复制包含版本、视角、汇总与结论的 JSON 报告；切换视角或修改版本号都会即时重算。
- **事件变体契约**：在「⑤ 事件变体」页填写一个 **JSON Pointer（RFC 6901）**作为判别字段，
  系统读取每条样本该位置的**字符串、数字或布尔值**并按值分组，每组分别复用现有归纳引擎生成一个
  分支，最终包成 `oneOf`。每个分支都把判别字段约束为对应的 `const`（判别字段必然进入该分支
  `required`），其余字段**只有在该组每条样本中都存在时才进入 `required`**。结果区展示分组数量、
  参与/剔除样本数、每个分支的判别值（含类型）、样本序号与分支 Schema（树形或完整 JSON），
  可一键复制完整结果，或「到校验页验证」直接在「③ 校验新样本」中用该 oneOf 契约校验新样本。
  详见下文「事件变体契约：规则与剔除原因」。

## 事件变体契约：操作说明

1. 在左侧粘贴样本后（无需先做普通归纳），切到「**⑤ 事件变体**」标签页。
2. 在「判别字段」框填写 JSON Pointer（默认 `/type`；支持 `/meta/event`、`/tags/0`，
   键名含 `/` 或 `~` 时按 RFC 6901 转义为 `~1`/`~0`；留空表示对根样本本身分组）。
3. 点击「生成事件变体契约」：查看分组数量、参与/剔除样本数；剔除样本按序号列出具体原因。
4. 展开分支卡片查看该组 Schema（判别字段为 `const`，共同字段才 `required`），或切到
   「完整 JSON」查看并一键复制完整 oneOf 结果。
5. 点击「到校验页验证」跳转「③ 校验新样本」，粘贴新样本即可按该 oneOf 契约校验。
6. 修改左侧任何样本后，上次变体结果自动失效，需重新生成。

## 契约演进：操作说明

1. 粘贴样本并点击「归纳 Schema」，在「② 契约 Schema」页点「设为基线」（或到「④ 契约演进」页设置）。
2. 修改左侧样本，再次点击「归纳 Schema」，结果区自动切到「④ 契约演进」并展示与基线的差异。
3. 选择视角、按需勾选「仅显示破坏性变更」；可随时「将当前结果设为基线」或「清除基线」。
4. 在每条**破坏性**变更下点击「生成反例」：展开后查看最小反例样本（可一键复制）与旧/新两版
   Ajv 校验结果；无法构造时会展示具体原因（如该节点的唯一区分取值被 `enum` 等约束禁止）。
5. 在「样本影响扫描」卡片粘贴历史样本的 JSON 数组并点击「开始扫描」：结果按四类分组展示
   数量与样本索引，点击单条样本可展开基线/当前两侧的 Ajv 校验详情（Pointer、关键字、信息）。
6. 在「发布门禁」卡片填写基线版本与目标版本（SemVer），即时得到放行结论，需要时可复制门禁报告。

基线仅保存在当前浏览器会话（`sessionStorage`）：刷新页面仍在，关闭标签页即失效，不会上传到服务器持久化。
门禁填写的两个版本号同样仅保存在当前浏览器会话。

判定规则（其余变更标为「兼容」或「提示」）：

| 视角 | 破坏性变更 | 示例 |
| --- | --- | --- |
| 请求体（客户端 → 服务端） | 新版新增必填字段；收窄可接受类型 | 可选变必填、`["null","string"]` → `"string"` |
| 响应体（服务端 → 客户端） | 新版删除必填输出；放宽输出类型 | 必填字段被移除、`"integer"` → `"number"` |

## 样本贡献度：判定规则

分析在 **http://localhost:8080** 页面的「① 样本输入 → 样本贡献度分析」区进行（点击
「分析样本贡献度」），也可直接调用 `POST /api/contribution`。后端先对完整样本集归纳
Schema，再**逐条移除一条样本**重新归纳，比较两份 Schema 的规则差异：

| 判定 | 含义 |
| --- | --- |
| 关键（`critical`） | 移除该样本后，至少一条规则发生变化（类型联合、必填集合、字段有无、数组 `items` 约束） |
| 冗余（`redundant`） | 移除该样本后，归纳出的规则与完整样本集完全一致 |

- **规范化比较，无伪差异**：比较前会把 Schema 规范化——`properties` 键排序、`required`
  数组排序、`type` 统一为有序联合。因此样本的**数组元素顺序**与**对象键顺序**不会产生
  伪差异；受影响的规则按 Schema JSON Pointer 列出（根节点显示为 `(root)`），同一节点的
  多处变化只计一次。
- **结果展示**：汇总关键/冗余数量，可按「全部 / 仅关键 / 仅冗余」筛选；展开单条样本可查看
  受影响的规则 Pointer 列表，点击「定位样本」滚动并高亮对应的原始样本编辑器。
- **失效**：任何样本内容修改都会使上一次分析结果立即失效（结果区清空并提示重新分析）。
- **限制**：单次最多分析 **50** 条样本；超限时前端在提交前拦截提示，接口也返回 `400`
  及明确错误信息。样本存在无效 JSON 时分析按钮不可用。

## 反例构造：规则与判定方向

反例针对单条破坏性变更，目标是「只被这一处差异绊倒」的最小文档：

| 变更类型 | 构造动作 |
| --- | --- |
| 新增必填 / 新增必填字段（请求视角） | 父对象省略该字段，其余必填兄弟字段填占位值 |
| 取消必填 / 删除必填字段（响应视角） | 新版文档省略该字段（旧版必填校验据此失败） |
| 类型收窄（请求）/ 放宽（响应） | 在目标节点取一个「一侧接受、另一侧拒绝」的类型占位值 |
| 数组 `items` 新增约束（请求）/ 移除约束（响应） | 数组放恰好一个具有区分类型的元素 |

- 必填兄弟字段的占位值取满足**接受侧**约束的最小值（优先同时满足另一侧）：
  标量为 `null`/`false`/`0`/`0.5`/`""`，对象递归补齐必填键，数组从空开始。
- 构造完成后用 Ajv 对同一份文档校验两侧；只有方向成立
  （请求：旧✓新✗；响应：新✓旧✗）才返回 `sample` 与 `oldResult/newResult`，
  否则返回 `{ "constructible": false, "reason" }`，说明是接受侧未通过还是两侧都接受。

## 样本影响扫描：归类规则

扫描在 **http://localhost:8080** 页面的「④ 契约演进 → 样本影响扫描」卡片进行（需先设置基线并归纳出
当前 Schema），也可直接调用 `POST /api/scan`。每条历史样本都会用 Ajv 分别对基线与当前 Schema
校验一次，然后归入恰好一类：

| 分类 | 含义 | 关注点 |
| --- | --- | --- |
| 两版均通过（`both`） | 基线 ✓ 且当前 ✓ | 演进对这些样本无影响 |
| 仅基线通过（`baselineOnly`） | 基线 ✓ 但当前 ✗ | **升级后将被拒绝的历史流量，需重点核对** |
| 仅当前通过（`currentOnly`） | 基线 ✗ 但当前 ✓ | 此前不合规、当前 Schema 起被接受 |
| 两版均失败（`neither`） | 基线 ✗ 且当前 ✗ | 本就不符合基线契约 |

- 输入必须是一个 JSON 数组（每个元素为一条历史样本）；单次最多 **200** 条。
  输入非数组或超限时，接口返回 `400` 及明确错误信息，前端也会在提交前拦截并提示。
- 结果按类分组展示数量与样本索引（`#` 前缀为样本在数组中的下标）；展开单条样本可查看
  基线/当前两侧的校验结论，失败侧列出全部 Ajv 错误（JSON Pointer、关键字、信息、规则路径）。
- 重新归纳或更换基线后，旧扫描结果会自动失效清空，需重新扫描。

## 发布门禁：判定规则

门禁完全在浏览器内基于当前 `/api/diff` 结果计算，不发起额外请求：

| 契约差异（当前视角） | 放行条件 |
| --- | --- |
| 存在破坏性变更 | 仅**主版本**提升可放行（如 `1.2.3` → `2.0.0`，含 `2.0.0-alpha.1`） |
| 仅有兼容/提示级变更 | 至少**次版本**提升（如 `1.2.3` → `1.3.0`） |
| 无契约变化 | **补丁级**发布即可（含同数值版本的预发布递进，如 `1.2.3-alpha` → `1.2.3`） |
| 目标版本 ≤ 基线版本 | 降级或同版本**一律阻止** |

版本解析遵循 SemVer 2.0.0：支持可选 `v` 前缀（`v1.2.3`）与预发布标识（`1.0.0-alpha.1`），
比较时先比主/次/补丁数值，再按预发布优先级（预发布 < 正式版，数字标识符按数值、字母标识符按
ASCII 比较）；构建元数据（`+build`）可解析但不参与比较。结论区展示实际升级类型、门禁要求、
触发结论的变更数量与原因；「复制门禁报告」生成包含版本、视角、差异汇总与结论的 JSON。

## 事件变体契约：规则与剔除原因

入口：**http://localhost:8080** 页面顶部右侧的「**⑤ 事件变体**」标签页（与样本输入同页），
也可直接调用 `POST /api/variants`。在判别字段输入框填入 JSON Pointer（RFC 6901，如 `/type`、
`/meta/event`、`/tags/0`；留空表示样本根本身就是判别值），点击「生成事件变体契约」。

处理流程与规则：

| 步骤 | 规则 |
| --- | --- |
| 读取判别值 | 按 Pointer 逐级取值；对象按键名、数组按**非负整数下标**（`0` 或不以 `0` 开头的多位数；`-` 不指向现有元素） |
| 分组 | 判别值仅支持**字符串 / 数字 / 布尔值**，按 JSON 相等性分组（`1` 与 `1.0` 同组）；分支按首次出现顺序排列 |
| 分支归纳 | 每个分组独立调用现有归纳引擎，故字段缺失、`null` 联合、异构数组、类型冲突等规则与 `/api/infer` 完全一致 |
| 判别字段约束 | 在判别字段对应的子 Schema 上写入 `const: <该组判别值>`；判别字段在该组必然存在，因此同时位于该分支 `required` |
| 其余必填字段 | **仅该组所有样本共同存在的字段**进入分支 `required`；某字段只在部分样本出现则为该分支可选 |
| 产出 | `{ "$schema": ..., "oneOf": [<分支1>, <分支2>, ...] }`，生成后用 Ajv 编译自检 |
| 拒绝产出 | 有效分组**少于 2 个**时返回 `400`（仍会带上已形成的分组与剔除明细，便于排查） |

不参与生成的样本会**按样本序号（从 1 开始展示）逐条列出原因**：

| 情形 | 原因示例 |
| --- | --- |
| 判别字段缺失（路径上缺键） | `判别字段缺失：(root) 处对象没有键 "type"。` |
| 数组下标越界 | `判别字段缺失：数组下标 0 越界（/tags 处数组长度为 0）。` |
| 路径段不是合法数组下标 | `路径段 "01" 不是合法数组下标（须为 0 或不以 0 开头的非负整数…）。` |
| 取值为 `null` / 对象 / 数组 | `判别值为 null（对象/数组）：判别字段只支持字符串、数字或布尔值。` |
| 路径中途遇到标量/null 无法继续 | `路径 /meta 处是数字，无法继续按 "event" 取值。` |
| Pointer 转义非法 | `JSON Pointer 转义非法：段 "a~2b" 中的 ~ 后只能是 0 或 1。`（此时全部样本剔除，接口 400） |

- **Pointer 转义**：严格遵循 RFC 6901，键名中的 `~` 写作 `~0`、`/` 写作 `~1`；`~2`、结尾的
  `~` 等均为非法。Pointer 必须为空（根节点）或以 `/` 开头。
- **结果界面**：顶部汇总「分组 N」「参与样本 M/总数」；剔除样本以红色列表逐条展示序号与原因；
  每个分支卡片展示 `const = <判别值>`、判别值类型、样本条数与样本序号（`#1, #2`…），展开后为
  该分支 Schema 的树形视图（样本路径标注已回填为**原始样本序号**）；可切换「完整 JSON」查看
  oneOf 全貌并一键复制。
- **校验新样本**：点「到校验页验证」即携带 oneOf 契约跳到「③ 校验新样本」，页内可在
  「事件变体 oneOf 契约 / 普通归纳 Schema」之间切换；未知判别值会报 `const` + `oneOf` 错误。
- **失效与限制**：任何样本修改都会让上一次变体结果立即失效（提示重新生成）；单次最多 **200**
  条样本，超限前后端都会拦截。

## 本地开发

```bash
npm run setup        # 安装 server 与 client 依赖
npm run dev:server   # 后端 http://localhost:8080（--watch 热重载）
npm run dev:client   # 前端 http://localhost:5173（/api 代理到 8080）
```

生产模式本地运行：`npm run build && npm start`，访问 http://localhost:8080。

## 测试

```bash
npm test             # node:test，覆盖归纳引擎、契约比较器、反例生成器、样本影响扫描、样本贡献度、事件变体契约、HTTP API 与发布门禁（125 项）
```

## API

| 方法 | 路径 | 请求体 | 响应 |
| --- | --- | --- | --- |
| GET | `/api/health` | — | `{ "status": "ok" }` |
| POST | `/api/infer` | `{ "samples": [<any>, ...] }` | `{ schema, paths, sampleCount }` |
| POST | `/api/validate` | `{ "schema": {...}, "sample": <any> }` | `{ valid, errors: [{ path, pointer, schemaPath, keyword, message, params }] }` |
| POST | `/api/diff` | `{ "oldSchema": {...}, "newSchema": {...}, "perspective": "request" \| "response" }` | `{ perspective, changes: [{ pointer, kind, field?, severity, oldRule, newRule, reason }], summary: { breaking, compatible, info } }` |
| POST | `/api/counterexample` | `{ oldSchema, newSchema, perspective, kind, pointer }` | `{ constructible, sample?, oldResult: { valid, errors }, newResult: { valid, errors }, reason? }` |
| POST | `/api/scan` | `{ oldSchema, newSchema, samples: [<any>, ...] }`（≤ 200 条） | `{ total, summary: { both, baselineOnly, currentOnly, neither }, samples: [{ index, category, baseline: { valid, errors }, current: { valid, errors } }] }` |
| POST | `/api/contribution` | `{ samples: [<any>, ...] }`（1–50 条） | `{ total, summary: { critical, redundant }, samples: [{ index, verdict, affectedPointers }] }` |
| POST | `/api/variants` | `{ samples: [<any>, ...], pointer: "/type" }`（≤ 200 条） | `200 { rejected:false, pointer, total, usedCount, excludedCount, groupCount, excluded:[{index,reason}], groups:[{value,sampleCount,indexes,schema,paths}], schema:{oneOf} }`；有效分组少于 2 个 / Pointer 非法时 `400`（响应体仍含 `groups`、`excluded` 等明细） |

示例：

```bash
curl -X POST http://localhost:8080/api/infer \
  -H 'Content-Type: application/json' \
  -d '{"samples":[{"id":1,"phone":null},{"id":2,"phone":"123"}]}'
```

为破坏性变更生成反例（请求体视角：样本须通过旧版、被新版拒绝）：

```bash
curl -X POST http://localhost:8080/api/counterexample \
  -H 'Content-Type: application/json' \
  -d '{"oldSchema":{"type":"object","properties":{"phone":{"type":["null","string"]}},"required":["phone"]},"newSchema":{"type":"object","properties":{"phone":{"type":"string"}},"required":["phone"]},"perspective":"request","kind":"type","pointer":"/properties/phone"}'
# -> { "constructible": true, "sample": { "phone": null },
#      "oldResult": { "valid": true, "errors": [] },
#      "newResult": { "valid": false, "errors": [...] } }
```

扫描历史样本集（逐条按基线与当前 Schema 双侧校验并归类）：

```bash
curl -X POST http://localhost:8080/api/scan \
  -H 'Content-Type: application/json' \
  -d '{"oldSchema":{"type":["string","null"]},"newSchema":{"type":["string","integer"]},"samples":["s",null,5,false]}'
# -> { "total": 4,
#      "summary": { "both": 1, "baselineOnly": 1, "currentOnly": 1, "neither": 1 },
#      "samples": [
#        { "index": 0, "category": "both", "baseline": {...}, "current": {...} },
#        { "index": 1, "category": "baselineOnly", ... }, ... ] }
```

留一法分析样本贡献度（逐条移除样本重新归纳，判定关键/冗余）：

```bash
curl -X POST http://localhost:8080/api/contribution \
  -H 'Content-Type: application/json' \
  -d '{"samples":[{"id":1,"tag":"x"},{"id":2,"tag":"y"},{"id":3}]}'
# -> { "total": 3,
#      "summary": { "critical": 1, "redundant": 2 },
#      "samples": [
#        { "index": 0, "verdict": "redundant", "affectedPointers": [] },
#        { "index": 1, "verdict": "redundant", "affectedPointers": [] },
#        { "index": 2, "verdict": "critical",  "affectedPointers": ["/properties/tag"] } ] }
```

按判别字段生成事件变体 oneOf 契约（缺失/非法判别值的样本进入 `excluded`）：

```bash
curl -X POST http://localhost:8080/api/variants \
  -H 'Content-Type: application/json' \
  -d '{"pointer":"/type","samples":[{"type":"user","id":1,"email":"a@x.com"},{"type":"user","id":2},{"type":"guest","id":3},{"id":4}]}'
# -> { "rejected": false, "total": 4, "usedCount": 3, "excludedCount": 1, "groupCount": 2,
#      "excluded": [ { "index": 3, "reason": "判别字段缺失：(root) 处对象没有键 \"type\"。" } ],
#      "groups": [
#        { "value": "user",  "sampleCount": 2, "indexes": [0, 1], "schema": { ... "const": "user"  } },
#        { "value": "guest", "sampleCount": 1, "indexes": [2],    "schema": { ... "const": "guest" } } ],
#      "schema": { "$schema": "https://json-schema.org/draft/2020-12/schema", "oneOf": [ ... ] } }
```

> 有效分组少于 2 个或 Pointer 非法时返回 `400`，响应体仍带 `rejected:true`、`error`、
> `groups`、`excluded` 等字段，便于界面展示每条样本被剔除的原因。

## 目录结构

```
├── Dockerfile              # 多阶段：构建前端 → 安装后端依赖 → 精简运行时（非 root）
├── docker-compose.yml      # 单服务，映射 8080
├── package.json            # 根编排脚本（setup/dev/build/start/test）
├── server/
│   ├── infer.js            # 递归归纳引擎（类型并集、required、items 折叠、路径映射）
│   ├── diff.js             # 契约演进比较器（递归对比属性/required/类型联合/items，按视角定级）
│   ├── counterexample.js   # 破坏性反例生成器（递归构造最小 JSON + Ajv 双侧校验）
│   ├── scan.js             # 样本影响扫描器（Ajv 双侧逐条校验 + 四分类，单次上限 200 条）
│   ├── contribution.js     # 样本贡献度分析（留一法重新归纳 + 规范化规则差异判定，单次上限 50 条）
│   ├── variant.js          # 事件变体契约（RFC 6901 判别字段分组 + 各组归纳注入 const + oneOf，单次上限 200 条）
│   ├── app.js              # Express（/api/infer、/api/validate、/api/diff、/api/counterexample、/api/scan、/api/contribution、/api/variants、静态托管）
│   ├── index.js            # 入口：监听 PORT（默认 8080）
│   └── test/               # node:test 单元与 API 测试
└── client/
    ├── test/               # 发布门禁（SemVer 解析/比较/判定）单元测试
    └── src/
        ├── App.jsx                 # 双栏布局、样本管理、归纳/校验/演进流程、基线（sessionStorage）
        ├── gate.js                 # 发布门禁：SemVer 2.0.0 解析/比较 + 放行判定（纯函数）
        ├── components/SchemaTree.jsx   # 树形视图 + 样本路径标注
        ├── components/ValidatePanel.jsx # 校验面板，JSON Pointer 错误列表
        ├── components/DiffPanel.jsx     # 契约演进面板：视角切换、破坏性筛选、按 Pointer 分组
        ├── components/CounterexamplePanel.jsx # 反例：样本格式化展示、双侧校验结果、复制按钮
        ├── components/SampleScanPanel.jsx  # 样本影响扫描：数组输入、四分类汇总、单条双侧错误展开
        ├── components/ContributionPanel.jsx # 样本贡献度：留一法分析入口、关键/冗余汇总筛选、定位原样本
        ├── components/VariantPanel.jsx  # 事件变体：Pointer 判别字段输入、剔除原因、oneOf 分支 Schema、复制/去校验
        ├── components/ReleaseGate.jsx   # 发布门禁卡片：版本输入、放行结论、报告复制
        └── components/SampleEditor.jsx  # 样本编辑器（实时 JSON 校验）
```

环境变量：`PORT`（默认 `8080`）。
