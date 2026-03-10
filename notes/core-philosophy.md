# RemoteLab Core Philosophy & Design Principles

> 确立于 2026-03-05，基于多轮产品讨论的核心共识。
> 本文档是所有后续迭代的根基，不轻易改动。

---

## 一、产品定位（修正）

RemoteLab 是一个让用户通过手机远程指挥 AI agent 使用整台电脑的工具。

**不是**：
- 终端模拟器
- IDE 的手机端
- 聊天机器人

**是**：
- 一个连接人和 AI worker 的对话界面
- AI worker 拥有整台电脑的完整使用权限
- 人只需下达意图，AI 自行决定如何执行

---

## 二、核心设计原则

### 原则 1：Agent = 拥有完整电脑使用权限的人

Agent 不是被限制在某个文件夹里的工具。它默认在 home 目录启动，拥有整台机器的访问权限。我们通过 prompt 和 skills 告诉它哪些能力更适合当前场景，但不硬性限制它的行动范围。

**推论**：
- 不再有"选择工作目录"的概念
- 不再有文件夹级别的隔离
- Agent 自行决定在哪里创建文件、如何组织工作

### 原则 2：Skills = 晶体智力

Skills 是对模型能力的额外补充，是"晶体智力"（crystallized intelligence）。它不拘泥于形态：

- **可执行型**：脚本、CLI 工具、API 调用
- **知识型**：领域知识、SOP 文档、最佳实践

两种子类型统一在 "skill" 这个抽象下。Skills 放在根路径下（如 `~/.remotelab/skills/`），在会话中引导模型自行发现和加载所需 skills。

**推论**：
- 不在会话级别的文件夹内放 claude.md 等指令文件
- 所有 skill 集中管理，模型按需加载
- Skill 的创建、修改、删除本身也可以通过对话完成

### 原则 3：Workspace 隔离靠 Metadata，不靠文件系统

多会话之间的隔离不通过文件夹边界实现。而是：

1. 每个会话有唯一标识符（session metadata）
2. 模型拿到这个标识符后，自行决定如何组织工作区
3. 就像一个人同时接多个同事的任务 —— 他不会搞混，因为他知道每个任务是谁给的、目的是什么

**具体机制**：
- 提供明确的规则约束模型创建工作目录的命名模式（如 `~/.remotelab/workspaces/{session-id}/`）
- 但这个目录纯粹是容器，不包含指令内容
- 模型对冲突的管理完全自治 —— 像人一样自然地隔离不同任务

### 原则 4：前端极简，工作流由模型控制

前端只有两个核心模块：

1. **会话管理**：创建、切换、归档会话
2. **Chat UI**：消息输入、消息展示

所有复杂的工作流编排（选择工具、切换上下文、调用能力）都由模型在对话中完成。如果需要 UI 扩展，通过 markdown/XML 扩展语法让模型动态生成，而非硬编码在前端逻辑中。

**推论**：
- 不做复杂的前端功能面板
- 不做工具选择 UI（模型自己决定用什么工具）
- 前端的 UI 改造可以通过模型输出的结构化内容动态实现

### 原则 5：人怎么工作，就让 Agent 怎么工作

这是最根本的设计哲学。不要为 AI 设计新的工作范式，而是让它模拟人的工作方式：

- 人不需要被告知"你只能在这个文件夹里操作" → Agent 也不需要
- 人接到任务会自己建文件夹整理 → Agent 也会
- 人有多个任务会自己区分优先级 → Agent 也会
- 人有不懂的领域会查资料学习 → Agent 通过 skills 补充

### 原则 6：默认一个共享大脑，不把“团队”当作底层抽象

“多 Agent 团队”更像是方便人类理解协作的界面隐喻，不应该轻易上升为 RemoteLab 的底层架构。给同一个底层模型起多个 bot 名字，很多时候只是把人类组织结构生搬硬套到模型上。

更合理的默认心智是：

- 对话里的 AI 是项目负责人 / 主 Agent
- 它共享同一个“脑子”，只是在不同任务里按需激活不同经验
- 它可以自己决定是亲自执行、调用工具，还是再开 sub agent session
- “团队”如果存在，也更适合作为执行策略或 UI 呈现，而不是身份层的硬编码

**推论**：
- 不预设 A/B/C 多身份 bot 编排作为默认入口
- 不把“分工配置”当成用户必须理解的产品概念
- 优先把记忆激活、delegation 和执行可见性做扎实

---

## 三、身份与访问控制

### 双角色模型

RemoteLab 采用 Owner / Visitor 双角色模型：

| 角色 | 认证方式 | 权限 |
|------|----------|------|
| **Owner** | 主 Token 或用户名密码登录 | 完整权限：管理会话、管理 App、所有功能 |
| **Visitor** | App 分享链接（scoped share token） | 仅可使用被分享的 App，自动创建专属会话 |

**核心原则**：这不是多用户系统。只有一个 Owner。Visitor 是 App 的使用者，权限严格限定在被分享的 App 范围内。

### 实现机制

- 认证会话（auth session）增加 `role` 字段：`"owner"` 或 `"visitor"`
- Owner 登录沿用现有 Token/密码机制，`role` 自动设为 `"owner"`
- Visitor 通过 `/app/{shareToken}` 入口认证，`role` 设为 `"visitor"`，同时绑定 `appId`
- 前端根据 `role` 决定 UI 展示：Owner 看到完整界面，Visitor 只看到 Chat UI

---

## 四、App 概念

### App = 会话模板（非会话本身）

App 是一个轻量元数据记录，定义了如何创建会话：

```json
{
  "id": "app_xxxx",
  "name": "Commit Helper",
  "systemPrompt": "You are a commit message writing assistant...",
  "skills": ["git-conventions"],
  "tool": "claude",
  "shareToken": "share_xxxx",
  "createdAt": "2026-03-06T..."
}
```

**App 不是 Session**。App 是模板/工厂，每次使用（无论 Owner 还是 Visitor）都创建一个新的独立 Session。Session 通过可选的 `appId` 字段关联回 App。

这保持了 Session 抽象的统一性 —— 所有交互（Owner 自己的对话、App 测试、Visitor 使用）最终都产生普通 Session。

### App 的创建与管理：Agent 驱动

第一期不做专门的管理 UI。App 的创建、列表、分享链接生成全部通过对话完成：

1. Owner 在任意会话中说 "帮我创建一个 App"
2. Agent 引导 Owner 描述需求，确定 system prompt 和 skills
3. Agent 调用 App CRUD API 完成创建
4. Agent 返回分享链接

**理由**：App 管理是低频操作，对话驱动足够。如果未来场景变得高频且数据展示复杂，再考虑专门 UI。

### App 的使用（Visitor 流程）

1. Visitor 点击分享链接 `/app/{shareToken}`
2. 服务端验证 shareToken，找到对应 App
3. 为 Visitor 创建一个新 Session（注入 App 的 systemPrompt）
4. 认证 Visitor（种 Cookie，role=visitor，绑定 appId）
5. 重定向到 Chat UI（visitor mode：隐藏侧边栏，只展示对话）

### Visitor Session 存储

Visitor 创建的 Session 存储在同一个 `chat-sessions.json` 中，但带有额外字段：

```json
{
  "id": "sess_xxxx",
  "appId": "app_xxxx",
  "visitorId": "visitor_xxxx",
  "tool": "claude",
  "name": "Commit Helper",
  "created": "2026-03-06T..."
}
```

Owner 的会话列表默认不展示 Visitor Session。但数据完整保留，供后续分析使用。

### App 分享

分享链接格式：`https://{domain}/app/{shareToken}`

每个 App 有唯一的 `shareToken`（256-bit hex）。同一个 App 的所有 Visitor 共享同一个 shareToken，但每人获得独立 Session —— 就像同一个服务，每个客户有自己的会话。

---

## 五、品牌与命名

- 产品名：**RemoteLab**
- 所有路径、配置、域名优先使用 `remotelab` 相关命名
- 避免使用 `claude` 作为路径/配置名（侵权风险 + 影响用户心智）
- ~~已完成：`~/.config/claude-web/` 已迁移为 `~/.config/remotelab/`~~

---

## 六、技术架构演进方向

### 当前状态（v1）
```
手机浏览器 → Cloudflare Tunnel → chat-server.mjs (7690)
                                       │
                                  spawn claude -p / codex
                                       │
                                  解析输出 → WebSocket → 前端
```

### 目标状态（v2）
```
手机浏览器 → Cloudflare Tunnel → remotelab-server
                                       │
                                  Agent（home 目录启动）
                                       │
                                  Skills（根路径加载）
                                       │
                                  自主执行 → 流式回传
```

### 关键变化
1. **去掉 folder 参数**：Agent 默认 home 目录
2. **引入 Skills 系统**：替代 tools + folder-based 配置
3. **Session metadata 增强**：包含用户标识符，让模型自行隔离工作
4. **前端精简**：只保留会话管理 + Chat UI

---

## 七、实施优先级

### P0 - 当前迭代（Identity + App v1）
- [x] 身份系统：Owner/Visitor 双角色
- [x] App 数据模型与 CRUD API
- [x] Share token 认证流程
- [x] Visitor 前端模式（chat-only view）
- [ ] App 管理 Skill（agent 驱动创建/分享）

### P1 - 核心体验
- [ ] 去掉 folder 依赖，Agent 默认 home 目录启动
- [ ] Skills 基础框架（文件存储 + 加载机制）
- [ ] Session metadata 增强

### P2 - 长期演进
- [ ] 自主执行（Autonomous Execution）：Session 后台持续运行、事件触发、主动推消息
- [ ] RemoteLab 服务作为 model-callable server
- [x] 路径迁移：`claude-web` → `remotelab`

---

## 八、不变的约束

1. **单 Owner** —— 不做多用户鉴权体系。Visitor 是受限访客，不是独立用户
2. **无外部框架** —— Node.js 内置模块 + ws
3. **三服务架构** —— 生产 + 测试 + 终端应急
4. **终端服务冻结** —— 不做改动
5. **每次改动立即 commit** —— 不用 amend
6. **Vanilla JS 前端** —— 无构建工具，无框架
7. **Agent 驱动优先** —— 新功能优先通过对话/Skill 实现，只在高频+复杂展示场景才做专门 UI

---

*本文档随项目演进持续更新，但核心原则（第二节）不轻易变动。*
