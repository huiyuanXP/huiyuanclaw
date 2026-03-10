# GitHub Auto Triage

这个方案当前解决两件事：`GitHub 仓库出现新 issue / PR / 跟进评论时，先稳定接住，并自动回一条带“初步判断 + 排查建议 / 产品方向判断”的回复`。

这样主流程就能跑通：

- GitHub 有新内容
- 本机定时轮询抓到它
- 生成本地 intake snapshot，方便后续分析
- 如果维护者还没回复过，就自动回一条带初步判断的评论

目前刻意不做：

- 实时通知到手机
- 依赖外部模型 API 才能工作
- 自动打 label / 自动 merge / 自动 review code diff

先把 intake + context-aware first reply 主链路跑稳，再视情况叠加更重的模型推理。

## 为什么先用轮询，不先上 webhook

GitHub CLI 本身没有一个常驻的“监听 issue / PR 事件”能力。最简单稳定的做法是：

- 用 `gh api` 轮询仓库的 `issues` 列表（这里天然包含 PR）
- 按 `updated_at` 抓最近有变化的条目
- 用本地 state file 记住上次轮询时间

这比直接改服务端接 webhook 更轻，适合先验证主流程。

## 新增脚本

脚本路径：`scripts/github-auto-triage.mjs`

能力：

- 轮询 issue + PR
- 为每个最近更新的条目生成本地 snapshot
- 判断“外部新内容是否晚于维护者最近一次回复”
- 默认 `dry-run` 输出拟发送评论
- 回复内容会结合线程文本和仓库里的现有设计/文档上下文
- 加 `--post` 后，真正发评论到 GitHub

## 默认产物

- State 文件：`~/.config/remotelab/github-triage/<owner>__<repo>.json`
- Snapshot 目录：`~/.config/remotelab/github-triage/inbox/<owner>__<repo>/`

每个 snapshot 都会保存：

- 标题、正文、评论、PR review
- 最近一次外部活动
- 最近一次维护者活动
- 当前是否需要回复
- 当前拟发送的自动回复草稿
- 命中的相关仓库上下文

## 先 dry-run

在仓库根目录执行：

```bash
node scripts/github-auto-triage.mjs --repo Ninglo/remotelab --bootstrap-hours 72
```

这一步不会真的发评论，只会：

- 打印拟发送的自动回复
- 写入本地 state
- 生成 intake snapshot

## 真正自动回复

确认 dry-run 没问题后：

```bash
node scripts/github-auto-triage.mjs --repo Ninglo/remotelab --post
```

## 手动测试维护者线程

默认定时任务不会自动回复维护者自己账号发起的 issue / PR。

如果你要手动验证整条评论发布链路，可以显式带上测试开关：

```bash
node scripts/github-auto-triage.mjs --repo Ninglo/remotelab --only 4 --reply-to-maintainers --post
```

这条命令只会处理指定线程，而且不会推进正常轮询游标。

## 安全预览任意线程的回复草稿

如果你想先看某个已有线程“按现在规则会怎么回”，但又不想真的发评论，可以用：

```bash
node scripts/github-auto-triage.mjs --repo Ninglo/remotelab --only 2 --force-draft
```

限制也故意做得很保守：

- 必须搭配 `--only`
- 不能和 `--post` 一起用
- 不会推进正常轮询游标


## 建议的上线方式

macOS 上最合适的是 `launchd` 每 1 分钟跑一次。当前更推荐走一个 wrapper 脚本，顺手做防重入。

示例命令：

```bash
/Users/jiujianian/.remotelab/scripts/run-github-auto-triage.sh
```

这个 wrapper 做了两件事：

- 固定好 `node` / `gh` / `PATH`，避免 `launchd` 环境过干净
- 做防重入锁，避免 1 分钟轮询时上一次还没结束又被拉起

示例 `LaunchAgent` 内容：

```xml
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
  <dict>
    <key>Label</key>
    <string>com.remotelab.github-triage</string>

    <key>ProgramArguments</key>
    <array>
      <string>/Users/jiujianian/.remotelab/scripts/run-github-auto-triage.sh</string>
    </array>

    <key>RunAtLoad</key>
    <true/>

    <key>StartInterval</key>
    <integer>60</integer>

    <key>StandardOutPath</key>
    <string>/Users/jiujianian/.remotelab/logs/github-auto-triage.log</string>

    <key>StandardErrorPath</key>
    <string>/Users/jiujianian/.remotelab/logs/github-auto-triage.log</string>
  </dict>
</plist>
```

把它保存到：`~/Library/LaunchAgents/com.remotelab.github-triage.plist`

然后加载：

```bash
launchctl load ~/Library/LaunchAgents/com.remotelab.github-triage.plist
launchctl start com.remotelab.github-triage
```

## 当前回复策略

现在的自动回复仍然偏保守，但已经不是纯“收到”了：

- 会先给一个初步判断
- 会给出第一轮排查建议，或者产品方向 / 设计取舍判断
- 会结合仓库里命中的设计记录、README、CLAUDE、notes/docs 等上下文
- 中英文自动选一个更像当前线程的语言
- 不依赖外部模型 API，因此定时任务成本和稳定性都更可控

这版的目标不是“替你一次性答完”，而是先把：

- 接收
- 入队
- 留痕
- 初步判断
- 自动回复

跑通。

补充说明：默认只会对“外部贡献者 / 提问者”的新线程或新跟进自动回复。

- 如果 issue / PR 是维护者自己账号发的，系统仍然会收到、写入 state、生成 snapshot
- 但不会自动回一条评论，避免机器人对自己说话

## 下一步怎么演进

主流程验证通过后，下一层很自然：

- 只在复杂线程上再加模型增强，让回复从“初步判断”升级成“更完整的分析草稿”
- 先保存草稿，再决定是否自动发出
- 再往后才考虑通知、标签、优先级、真正 webhook 化

也就是说，当前这版已经是一个可工作的“低成本、可持续运行”的底座。
