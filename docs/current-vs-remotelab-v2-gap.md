# 当前版本 vs `remotelab-v2` 功能差距

更新时间：2026-04-22

## 结论

这两份代码目前已经不是“同一产品的前后版本”，而是**两个主线方向**：

- 当前仓库（`/home/ally/huiyuanclaw/remotelab`）更像 **orchestrator-first / 多 agent 调度台**
- `remotelab-v2`（`/home/ally/huiyuanclaw/remotelab-v2`）更像 **session-first / 面向普通用户的 AI workbench**

所以“功能差距”不能只理解为谁多几个按钮，而是：

1. 当前版在 **任务依赖、MCP 调度、team template、channel 集成** 上更强
2. `remotelab-v2` 在 **产品化主线、App/share/visitor、文件交付、run 模型、前端状态边界、测试覆盖** 上明显更完整

## 一句话判断

如果目标是继续做“惠远自己的 orchestrator 系统”，当前版并不落后，甚至在编排上更激进。  
如果目标是收敛到一个更可发布、更产品化、更适合普通用户上手的 RemoteLab，当前版相对 `remotelab-v2` 的差距主要集中在下面 8 类能力。

## 8 类核心差距

### 1. 产品主线不同

当前版 README 把产品定义为“从手机控制 AI coding agents 的 orchestrator”，重点是多 session、任务依赖、workflow、MCP、team templates。[README.md](./README.md) 第 3-22 行。

`remotelab-v2` 则把产品定义为“帮助普通人把重复数字工作交给 AI 的 cross-surface workbench”，重点是任务澄清、结果交付、App 化复用、visitor surface。[../remotelab-v2/README.md](/home/ally/huiyuanclaw/remotelab-v2/README.md:5) 第 5-15 行，[../remotelab-v2/README.md](/home/ally/huiyuanclaw/remotelab-v2/README.md:50) 第 50-63 行。

实际含义：

- 当前版默认用户是“会调度 agent 的操作者”
- v2 默认用户是“有重复工作但不想学 prompt 的普通使用者”

### 2. 当前版缺少 App / Visitor / Share 主线

`remotelab-v2` 把产品语法收敛成 `Session`、`Run`、`App`、`Share snapshot`。[../remotelab-v2/README.md](/home/ally/huiyuanclaw/remotelab-v2/README.md:88) 第 88-103 行。

代码层面也有完整实现入口：

- `chat/apps.mjs`
- `chat/shares.mjs`
- `router-public-routes.mjs`
- `router-control-routes.mjs`

见 [../remotelab-v2/chat/router.mjs](/home/ally/huiyuanclaw/remotelab-v2/chat/router.mjs:61) 和 [../remotelab-v2/chat/router.mjs](/home/ally/huiyuanclaw/remotelab-v2/chat/router.mjs:73)。

当前版没有对应的 App/visitor/share 模块，更多还是 owner 自己管理 session 和任务。  
这意味着当前版相对 v2 缺少：

- 面向新用户的 Welcome App
- App-based 入口和复用包装
- visitor share link / public route
- immutable share snapshot

### 3. 当前版缺少更成熟的 Session/Run 模型

当前版虽然有持久 session，但公开叙述与代码结构仍主要围绕 session + task orchestration。[README.md](./README.md) 第 53-74 行。

`remotelab-v2` 明确把 `Run` 作为 session 下的执行对象，并在架构文档中把 `session + run orchestration`、`runner-sidecar`、`runner-supervisor` 定义成主干。[../remotelab-v2/docs/project-architecture.md](/home/ally/huiyuanclaw/remotelab-v2/docs/project-architecture.md:102) 第 102-147 行，[../remotelab-v2/docs/project-architecture.md](/home/ally/huiyuanclaw/remotelab-v2/docs/project-architecture.md:174) 第 174-203 行。

当前版缺口主要是：

- 运行态抽象不如 v2 清晰
- restart recovery / detached runner 语义不如 v2 明确
- session control state、timeline/display event 体系不存在

### 4. 当前版缺少文件交付和“结果可达性”主线

`remotelab-v2` 明确强调“结果不能只留在宿主机路径里，必须通过用户可达 surface 交付”。[../remotelab-v2/README.md](/home/ally/huiyuanclaw/remotelab-v2/README.md:109) 第 109-114 行。

对应代码中有：

- `chat/file-assets.mjs`
- 大文件上传/引用逻辑
- 结果文件直链和本地文件发布逻辑

见 [../remotelab-v2/chat/router.mjs](/home/ally/huiyuanclaw/remotelab-v2/chat/router.mjs:76) 第 76-85 行，以及 [../remotelab-v2/chat/router.mjs](/home/ally/huiyuanclaw/remotelab-v2/chat/router.mjs:154) 第 154-176 行。

当前版虽然支持图片粘贴、report 提交、部分附件消息，但整体仍偏“agent 在做事”，而不是“用户顺利拿到结果”。  
这是当前版相对 v2 的一个明显产品化缺口。

### 5. 当前版前端仍较单体，v2 已拆出稳定状态边界

当前版前端基本还是：

- `templates/chat.html`
- `static/chat.js`
- 少量静态资源

见 [package.json](./package.json) 第 37-56 行，以及当前仓库 `static/` / `templates/` 结构。

`remotelab-v2` 已拆成大量前端状态模块，例如：

- `static/chat/session-store.js`
- `static/chat/session-state-model.js`
- `static/chat/session-http.js`
- `static/chat/sidebar-ui.js`
- `static/chat/realtime.js`

并且架构文档明确规定“HTTP 是 canonical state path，WS 只是 invalidation hint”。[../remotelab-v2/docs/project-architecture.md](/home/ally/huiyuanclaw/remotelab-v2/docs/project-architecture.md:60) 第 60-67 行，[../remotelab-v2/docs/project-architecture.md](/home/ally/huiyuanclaw/remotelab-v2/docs/project-architecture.md:205) 第 205-217 行。

这说明当前版相对 v2 的缺口不只是 UI 样式，而是：

- 前端状态模型不够显式
- 可维护性和后续演进能力更弱
- 缺少 session list/item/detail 的稳定 API shape 分层

### 6. 当前版没有 v2 级别的测试护城河

当前版 `package.json` 没有 `test` 脚本，也没有 `tests/` 目录。[package.json](./package.json) 第 57-71 行。

`remotelab-v2` 则有大量 smoke / merge-safety / integration 测试，并且覆盖范围包括：

- apps
- share snapshots
- runtime policy
- file assets
- session continuation / grouping / follow-up queue
- push / voice / feishu / email bridge

见 [../remotelab-v2/package.json](/home/ally/huiyuanclaw/remotelab-v2/package.json:57) 第 57-96 行，以及 [../remotelab-v2/tests](/home/ally/huiyuanclaw/remotelab-v2/tests/README.md) 目录。

这是当前版和 v2 最大的工程化差距之一。

### 7. 当前版缺少 v2 的外部入口生态

当前版额外有 `channels/telegram.mjs`、`channels/discord.mjs`、`channels/wechat.mjs`，但这更像“消息桥接”。[package.json](./package.json) 第 57-65 行。

`remotelab-v2` 形成了更完整的外部入口能力族：

- Feishu connector
- voice connector
- email worker / agent mail
- proactive observer
- tunnel diagnostics
- external solution providers

证据见 [../remotelab-v2/package.json](/home/ally/huiyuanclaw/remotelab-v2/package.json:60) 第 60-90 行，以及独有文件列表中的 `cloudflare/email-worker/*`、`scripts/voice-*`、`scripts/feishu-*`、`lib/agent-mail*`。

所以这里不是“有没有第三方入口”，而是：

- 当前版偏 agent-to-agent / owner operator
- v2 偏 cross-surface / user-facing external ingress

### 8. 当前版在 orchestrator 能力上反而领先

这点也要明确，不然结论会失真。

当前版并不是单纯“落后版”。在下面这些地方，它比 v2 更像惠远想要的系统：

- 任务依赖自动解锁与派发：[chat/task-manager.mjs](./chat/task-manager.mjs) 第 42-70 行
- `report_to` 汇报链恢复与冲突检测：[chat/router.mjs](./chat/router.mjs) 第 47-159 行
- 两层 MCP 架构：session MCP + task MCP：[README.md](./README.md) 第 98-126 行
- team templates 与 workflow scheduling：[README.md](./README.md) 第 76-171 行
- sub-agent worktree/branch 上下文注入：[chat/router.mjs](./chat/router.mjs) 第 197-218 行

这部分是当前版的“护城河”，不是应该被 v2 简单替代的东西。

## 实际功能差距表

| 能力 | 当前版 | `remotelab-v2` | 判断 |
|---|---|---|---|
| 多 session + 手机远程控制 | 有 | 有 | 基本持平 |
| 任务依赖 / auto-dispatch | 强 | 弱或非主线 | 当前版领先 |
| MCP 编排 / 子 agent 汇报 | 强 | 弱 | 当前版领先 |
| Team templates / workflow scheduling | 强 | 较弱 | 当前版领先 |
| App packaging | 基本无 | 强 | v2 领先 |
| visitor/public share flow | 基本无 | 强 | v2 领先 |
| immutable share snapshot | 基本无 | 有 | v2 领先 |
| file asset delivery | 弱 | 强 | v2 领先 |
| run 模型 / detached runner 架构 | 中 | 强 | v2 领先 |
| 前端状态分层 | 弱 | 强 | v2 领先 |
| 测试覆盖 | 很弱 | 很强 | v2 领先 |
| 外部入口生态 | 有 channel，但偏桥接 | 更系统化 | v2 领先 |

## 如果要“补差距”，优先级建议

不建议把 `remotelab-v2` 全量搬过来。更合理的是按下面顺序补。

### P0：必须补

1. 测试骨架
2. Session/Run 基础抽象
3. 文件交付能力
4. share snapshot 或至少只读分享

原因：这四项决定当前版能不能从“内部 orchestrator”走向“可稳定交付的产品”。

### P1：很值得补

1. Welcome App / 新用户引导面
2. App packaging 基础版
3. 前端 session state 分层
4. public / visitor route

原因：这四项决定当前版能不能承接普通用户，而不只是惠远自己调度 agent。

### P2：看方向再决定

1. Feishu / voice / email worker 全量生态
2. solution provider / observer 体系
3. v2 那套更完整的 prompt/memory/control-state 体系

原因：这些是更长线的产品扩展，不是当前最短板。

## 最终判断

从“实际功能差距”看，当前版不是 v2 的简化落后版，而是**把产品赌注压在 orchestration 上的分叉版本**。

真正的差距不是：

- 少几个脚本
- 少几个页面

而是：

- 当前版缺少 **面向普通用户的产品闭环**
- 缺少 **结果交付与分享机制**
- 缺少 **测试与前端状态边界**

但与此同时，当前版保留了 v2 没有重点强化的核心能力：

- 显式任务依赖
- 多 agent 协作与汇报
- MCP-first orchestration

所以最合理的策略不是“回退到 v2”，而是：

**以当前版为主干，选择性吸收 v2 的 App/share/file-assets/test/frontend-state 四大块。**
