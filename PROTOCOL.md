# WDX Git — Host ↔ Client 协议

本文件是 Host 半区（`index.js` + `src/*`）与客户端半区（`lib/client.js`）的契约。
改协议时先改这里，再同步改两侧。

## 1. 包与接入点

```
dsh-wdx-git/
  package.json          # dsh.bundle.patch + dsh.client；name = dsh-wdx-git
  cordis.patch.yml      # insert: id: wdx-git, name: dsh-wdx-git
  index.js              # export name/inject/apply，注册 POST /api/wdx-git
  src/git.js            # cleanGitEnv、GitError、纯解析器
  src/sync.js           # 同步引擎
  src/operations.js     # RPC ops
  src/ai.js             # 提交信息 / 模型目录 / 冲突 AI
  lib/client.js         # 浏览器 bundle（单文件 classic script）
```

Host 注入：

```js
export const name = 'wdx-git'
export const inject = ['connection', 'subprocess']
export function apply(ctx) { /* ctx.connection.fetch.register(...) */ }
```

可选服务全部用 `ctx.get(...)` 读取，不写入 `inject`：`llm`、`sessions`、
`agentDefaultModel`。缺失时 AI 降级，不影响 Git。

Client 注入：

```js
exports.inject = ['slots', 'locale', 'sessions', 'sidebarRight', 'sidebarRightTabs']
```

## 2. HTTP RPC

请求：

```
POST /api/wdx-git
content-type: application/json
{ "op": "<name>", "cwd": "<absolute path>", "...": "其他参数" }
```

响应始终是 JSON：

```json
{ "ok": true, "data": { ... } }
{ "ok": false, "error": { "code": "invalid-params", "message": "人类可读信息", "data": {} } }
```

- 参数校验失败（含未知 op、非法 JSON）→ HTTP 400。
- git 业务失败（冲突、非仓库、网络失败等）→ HTTP 200 + `ok:false`，UI 按 body 判定。
- `error.data` 仅在少数结构化错误出现（如 `commit` 的 `{unmerged:[...]}`）。

错误码：

| code | 含义 |
| --- | --- |
| `invalid-params` | 参数非法 / 未知 op / 路径越界 |
| `not-a-repo` | cwd 不是 Git 仓库 |
| `cwd-unavailable` | cwd 不存在或 git 可执行文件不可访问 |
| `git-failed` | git 非 0 退出 |
| `timeout` | 操作超时或被取消 |
| `ai-unavailable` | 模型缺失 / 模型输出不可用 / 输出被截断 |
| `conflict` | 还有未解决冲突，拒绝提交 |
| `nothing-to-commit` | 自动暂存后没有可提交内容 |
| `no-remote` | 仓库没有配置 remote（sync / push） |
| `dirty` | 关闭自动 stash 时工作区脏，无法安全合并 |
| `detached` | 游离 HEAD，无法同步 |
| `internal` | 未预期异常 |

超时（由 `operations.handle` 统一包一层 AbortController）：

- 只读：30s
- 写操作：60s
- fetch：240s
- sync/pull/push：420s
- AI：150s

## 3. 数据结构

### 3.1 `snapshot` — 面板全量状态

参数：`{ cwd }`

```json
{
  "repo": {
    "isRepo": true,
    "root": "/abs/repo",
    "name": "repo",
    "branch": "main",
    "detached": false,
    "initial": false,
    "head": "1a2b3c4",
    "upstream": "origin/main",
    "upstreamGone": false,
    "ahead": 1,
    "behind": 2,
    "remoteUrl": "git@github.com:foo/bar.git",
    "hasRemote": true,
    "remoteName": "origin"
  },
  "branches": [{
    "name": "main", "kind": "local", "current": true,
    "upstream": "origin/main", "ahead": 1, "behind": 2, "gone": false,
    "commit": "1a2b3c4", "subject": "feat: x", "date": "2 hours ago"
  }],
  "remotes": [{ "name": "origin", "url": "..." }],
  "status": {
    "clean": false,
    "staged":     [{ "path": "src/a.js", "status": "M", "x": "M", "y": ".", "oldPath": null }],
    "unstaged":   [{ "path": "src/b.js", "status": "M", "x": "M", "y": "M", "oldPath": null }],
    "untracked":  [{ "path": "new.txt", "status": "?", "x": "?", "y": "?", "oldPath": null }],
    "conflicted": [{ "path": "both.js", "status": "UU", "x": "U", "y": "U", "oldPath": null }]
  },
  "stashes": [{ "index": 0, "message": "WIP on main: ..." }],
  "operation": {
    "merge": false, "rebase": false, "cherryPick": false, "revert": false,
    "conflicted": 0, "inProgress": false
  },
  "user": { "name": "wdxtub", "email": "..." },
  "commitPrompt": ""
}
```

非仓库：

```json
{ "repo": { "isRepo": false, "error": "<git stderr>" },
  "branches": [], "remotes": [], "stashes": [], "status": null,
  "operation": null, "user": null, "commitPrompt": "" }
```

状态来源是 `git status --porcelain=v2 -z --branch --untracked-files=all`。
一个文件可能同时出现在 `staged` 和 `unstaged`（部分暂存）。未跟踪恒为 `?`。
`conflicted` 来自 `u` 记录，`status` 是 XY 组合（如 `UU`、`AU`）。

### 3.2 `graph` — 提交历史

参数：`{ cwd, limit?: number, all?: boolean }`（limit 20..300，默认 120；all 默认 true）

```json
{
  "all": true,
  "commits": [{
    "full": "<40位>", "short": "1a2b3c4",
    "author": "Wen", "date": "2 hours ago",
    "refs": ["HEAD -> main", "origin/main"],
    "subject": "feat: x",
    "lane": 0,
    "color": 0,
    "fromAbove": true,
    "width": 2,
    "trails": [{ "from": 1, "to": 1, "color": 1 }],
    "joins": [
      { "from": 0, "to": 1, "color": 0, "kind": "parent" },
      { "from": 2, "to": 0, "color": 1, "kind": "converge" },
      { "from": 0, "to": 3, "color": 2, "kind": "branch" }
    ]
  }]
}
```

车道几何由 Host 计算，Client 只画 SVG：

- `trails`：本行内直行的竖线（from = to）。
- `joins.kind`：
  - `parent`：从节点 lane 的下半行弯到目标 lane 的行底；
  - `branch`：merge 的额外父提交，新开车道；
  - `converge`：同一提交在多个车道出现时，从上方弯进节点。
- `fromAbove`：节点 lane 从上一行延续下来，Client 先画半截竖线再画圆点。
- `color`：`0..7`，对应 Client 的 `--wx-lane-0..7`。
- `width`：本行需要绘制的 lane 数；Client 最多画 12 列。

空仓库返回 `{ commits: [], all }`，不算错误。

### 3.3 `commitInfo`

参数：`{ cwd, hash }`

```json
{
  "full": "<40位>", "short": "1a2b3c4",
  "author": "Wen", "email": "...",
  "timestamp": 1700000000000, "relative": "2 hours ago",
  "refs": ["HEAD -> main"],
  "parents": ["<40位>"],
  "subject": "feat: x",
  "body": "why...\n\nwhat..."
}
```

### 3.4 `diff`

参数：`{ cwd, mode: "worktree"|"staged"|"commit"|"untracked", path?: string, hash?: string }`

返回的 `mode` 可能是 `conflict`：当 `worktree` 的 path 是未解决冲突文件时，Host 自动切换成冲突视图。

- `worktree` / `staged`：path 省略时返回整份 diff（多文件）。
- `commit`：需要 hash，可带 path。
- `untracked`：需要 path，使用 `git diff --no-index -- /dev/null <path>`。

```json
{
  "mode": "worktree",
  "path": "src/a.js",
  "conflict": false,
  "oursExists": true,
  "theirsExists": true,
  "additions": 3,
  "deletions": 1,
  "binary": false,
  "truncated": false,
  "files": [{
    "path": "src/a.js", "oldPath": "", "status": "M",
    "binary": false, "additions": 3, "deletions": 1,
    "hunks": [{
      "header": "@@ -1,5 +1,7 @@",
      "lines": [
        { "kind": "ctx", "text": "const a = 1", "old": 1, "new": 1 },
        { "kind": "del", "text": "const b = 2", "old": 2,
          "inline": [{ "text": "const b = ", "changed": false }, { "text": "2", "changed": true }] },
        { "kind": "add", "text": "const c = 3", "new": 2,
          "inline": [{ "text": "const c = ", "changed": false }, { "text": "3", "changed": true }] },
        { "kind": "meta", "text": "\\ No newline at end of file" }
      ]
    }]
  }]
}
```

- `inline` 片段拼接后精确等于原 `text`。
- 只有同 hunk 内相邻的连续删除块与新增块按下标配对时才附加；超过 420 token 或任一侧为空时退化为整行。
- 二进制：`binary: true`，通常没有 hunks。
- `raw` 上限 400 000 字符，超出 `truncated: true`（Client 不依赖 raw）。
- 文件状态：`A` 新增、`D` 删除、`R` 重命名、`M` 修改。

### 3.5 `sync` / `pull` / `push`

参数：

```json
{ "cwd": "/abs/repo", "mode": "sync|pull|push", "remote": "origin", "branch": "main", "autoStash": true }
```

- `sync` 是默认；`pull` 只到合并为止；`push` 只推送（被拒时内部 fetch+合并+重试一次）。
- `remote` / `branch` 可省略；省略时优先 `origin`，否则第一个远端。
- `autoStash` 默认 true。

返回：

```json
{
  "mode": "sync",
  "branch": "main",
  "remote": "origin",
  "upstream": "origin/main",
  "ahead": 0,
  "behind": 0,
  "hasUpstream": true,
  "merged": "fast-forward|merge|null",
  "pushed": true,
  "stashed": false,
  "conflict": false,
  "conflictFiles": [],
  "stashRestoreConflict": false,
  "steps": [{ "id": "fetch", "detail": "" }, { "id": "merge", "detail": "已创建合并提交" }],
  "output": "<拼接后的 git 输出>"
}
```

冲突时 `conflict: true`，`conflictFiles` 是未解决路径，`pushed: false`。合并已在进行中，
不会自动 abort；客户端展示冲突并由用户解决后提交。

`steps[].id`：`fetch` / `upstream` / `stash` / `merge` / `stash-restore` / `push-retry` / `push`。

### 3.6 写操作

| op | 参数 | 行为 |
| --- | --- | --- |
| `stage` | `{ cwd, paths?: string[], all?: true }` | `git add -A` / `git add -- paths` |
| `unstage` | `{ cwd, paths?, all? }` | `git reset -q` / `git restore --staged -- paths`；unborn 仓库用 `git rm --cached` |
| `discard` | `{ cwd, paths, mode: "worktree"\|"untracked"\|"all" }` | `restore --worktree` / `clean -f -d` / `restore --staged --worktree` |
| `switchBranch` | `{ cwd, name }` | `git switch`；远程 ref 自动建同名跟踪分支 |
| `createBranch` | `{ cwd, name, from? }` | `git check-ref-format` + `git switch -c` |
| `deleteBranch` | `{ cwd, name }` | `git branch -d`；不能删当前分支 |
| `commit` | `{ cwd, message, autoStage?: boolean, paths?: string[], exclude?: string[] }` | 检查冲突 → 暂存选中路径（或 `add -A`）→ 取消选中排除项 → `git commit -m` |
| `fetch` | `{ cwd, remote? }` | `git fetch --all --prune` / `git fetch <remote> --prune` |
| `stashPush` | `{ cwd, message?, includeUntracked? }` | 默认 `-u` |
| `stashPop` / `stashDrop` | `{ cwd, index? }` | `stash pop/drop stash@{n}` |
| `setCommitPrompt` | `{ cwd, prompt }` | `git config --local wdx.git.commitPrompt`；空串 unset |
| `abortOperation` | `{ cwd }` | merge/rebase/cherry-pick/revert --abort |
| `continueOperation` | `{ cwd }` | 对应 `--continue`；merge 用 `commit --no-edit` |
| `markResolved` | `{ cwd, path }` | 手工解决后：校验无冲突标记再 `git add` |

`commit`：

- 有未解决冲突 → `code: "conflict"`，`data.unmerged` 带路径。
- `paths` 省略时保持旧的自动暂存行为（`autoStage !== false` 则 `add -A`）；
  提供 `paths` 时只 `git add -A -- paths`，再对 `exclude` 执行 `restore --staged`
  （unborn 仓库用 `rm --cached`）。这对应 UI 里「默认全选、可取消勾选」的改动。
- 暂存区为空 → `code: "nothing-to-commit"`。
- 返回 `{ hash, subject, branch, output }`。

`discard` 不可恢复，Client 必须二次确认。冲突文件不提供 discard。

### 3.7 冲突

`conflictInfo`：`{ cwd, path }`

```json
{
  "path": "README.md",
  "branch": "main",
  "incoming": "origin/feat/sync",
  "hasBase": true,
  "oursExists": true,
  "theirsExists": true,
  "ours": "...", "theirs": "...", "base": "..."
}
```

三份内容各自最多 400k 字符。数据来自索引 stage（`git ls-files -u -z` + `git cat-file -p`），
不从磁盘读文件。

`aiResolve`：`{ cwd, path, hint?, sessionId?, selection?, effort?, apply?: boolean }`

预览（默认 `apply` 缺省或 false）返回：

```json
{
  "path": "README.md",
  "suggested": "merged file content",
  "delete": false,
  "deterministic": false,
  "model": "magpie/baidu-qianfan/deepseek-v4.1-flash",
  "route": "whole",
  "hasBase": true,
  "oursExists": true,
  "theirsExists": true,
  "warning": ""
}
```

- 删除/改名冲突若存活侧相对 base 未改，直接返回 `{ delete: true, deterministic: true }`，不调模型。
- 模型返回 `<<<DELETE_FILE>>>` 表示删除。
- 输出必须非空、不含行首冲突标记；`max-tokens` 截断直接 `ai-unavailable`。
- **不写盘**。
- `route` 为 `whole`（整文件）、`hunks`（大文件按冲突块）或 `deterministic`。

`apply: true` 时跳过预览：Host 直接写盘并 `git add`（删除冲突用 `git rm`），
返回 `{ path, resolved, deleted, deterministic, model, route, unmerged, warning }`，
没有 `suggested`。客户端「AI 解决全部」逐个文件调用，单文件失败不中断其余文件，
最后汇总成功数与失败原因。

大文件策略：三份内容合计 >240000 字符，或工作区合并结果 >12000 字符时，不再把
整文件送给模型。Host 读取工作区里的冲突标记，按冲突块逐个请求（每块带前后各
20 行上下文），全部块成功后再拼回完整文件写入。单块三份合计 >24000 字符、冲突块
超过 40 个或标记无法解析时，该文件拒绝自动解决并返回明确原因；不会写入半成品。

`applyResolution`：`{ cwd, path, content?, delete? }`

- 写入前重新确认该 path 仍处于冲突状态；路径必须仓库内相对路径。
- `delete: true` 用 `git rm -f --ignore-unmatch`，否则写文件后 `git add`。
- 返回 `{ path, resolved, deleted, unmerged }`。

`takeSide`：`{ cwd, path, side: "ours"|"theirs" }`。该侧没有文件时语义是删除。

`markResolved`：`{ cwd, path }`。用于用户在外编辑器里手工解决冲突之后：
先确认文件仍在冲突状态，再读取工作区文件并拒绝残留冲突标记，最后 `git add`。
文件不存在时按删除标记已解决。返回 `{ path, resolved, deleted, unmerged }`。

## 4. AI

### 4.1 模型目录 `models`

参数：`{ cwd?, sessionId?, force? }`

`force: true` 跳过 60 秒目录缓存（设置页的「刷新模型」）。

```json
{
  "groups": [{
    "id": "magpie", "name": "Magpie",
    "models": [{
      "id": "baidu-qianfan/deepseek-v4.1-flash",
      "name": "deepseek-v4.1-flash · Baidu Qianfan",
      "reasoning": {
        "efforts": [{ "id": "low", "name": "Low" }, { "id": "none", "name": "Off" }],
        "defaultEffort": "high"
      }
    }]
  }],
  "failures": [{ "id": "...", "name": "...", "message": "..." }],
  "unavailable": false,
  "default": {
    "provider": "magpie",
    "model": "baidu-qianfan/deepseek-v4.1-flash",
    "reasoningEffort": "low",
    "label": "magpie/baidu-qianfan/deepseek-v4.1-flash",
    "modelName": "deepseek-v4.1-flash",
    "efforts": ["low", "high", "max"]
  },
  "sessionId": "session-1"
}
```

默认选择来源：

1. `sessionId` 对应 live session 的 `requestHeader().config`（当前会话实际使用的模型）；
2. 否则 `agentDefaultModel.currentSelection()`；
3. 都没有则 `default: null`。

`default.reasoningEffort` 是 UI 建议值：优先 `low`，其次 `none/off`，否则 null。
Host 目录缓存 60 秒。

### 4.2 `aiCommit`

参数：

```json
{
  "cwd": "/abs/repo",
  "sessionId": "session-1",
  "hint": "optional",
  "selection": { "provider": "volc-tp", "model": "glm-5.3-flash" },
  "effort": "auto|default|low|none|...",
  "paths": ["src/a.js", "src/b.js"]
}
```

- `selection` 省略时使用「会话模型 → 默认模型」。
- `paths` 省略时读全部改动；提供时只装配这些路径的 diff、文件列表和未跟踪内容，
  与「只提交选中文件」保持一致。
- 显式选择不可用时回退到会话模型，并在 `warning` 说明。
- `effort: "auto"` 由 Host 压到 low / none；`default` 表示不传 reasoningEffort。

返回：

```json
{
  "subject": "feat(sync): ...",
  "body": "why...",
  "message": "feat(sync): ...\n\nwhy...",
  "model": "magpie/...",
  "fallback": false,
  "truncated": false,
  "attempts": 1,
  "effort": "low",
  "warning": ""
}
```

数据装配：

- `git diff HEAD`（已暂存 + 未暂存）；
- `git status --porcelain=v2` 的文件列表（含 untracked）；
- `git diff HEAD --stat`；
- 最近 12 条提交 subject（语言/风格参考）；
- 最多 5 个未跟踪文本文件（每个 ≤6k，总量 ≤24k）；
- diff 截断 30k。
- 如果请求带 `paths`，上述 diff / stat / 文件列表 / 未跟踪内容都只取这些路径；UI 在
  用户取消勾选时自动传入，保证生成的提交信息只描述本次会提交的文件。

模型输出校验与重试：

- 一次请求同时产出标题和正文；正文按 PR 摘要的密度：一句动机 + 2–4 条具体改动，
  涉及测试时补一条覆盖范围。信息量介于旧的快速与详细之间。
- 每次输出都校验：被截断、标题为空/半句话/缺 Conventional 前缀/括号不闭合，
  或改动量较大（≥5 行、多文件、新文件内容 ≥200 字）却正文过短（<60 个非空白字符）
  或只有一句话（少于 2 个信息单元），都视为不合格。
- 不合格时携带「上一次为什么被拒」重新请求，最多重试 3 次（首次 + 3 次重试），
  每次重试把 `maxTokens` 提高 600，上限 3400。
- 重试仍不合格时：有可用标题就只保留标题并在 `warning` 说明；标题也不可用才落到
  确定性 fallback：`chore: 更新 N 个文件` / `chore: update N files`，`fallback: true`。
  `attempts` 是实际请求次数，UI 仍可继续提交。

自定义提示词：`git config --get wdx.git.commitPrompt`；非空时替换系统提示词，
数据装配逻辑不变。

## 5. Client

### 5.1 注册

```js
ctx.sidebarRightTabs.register({
  id: 'wdx-git', kind: 'wdx-git', priority: 'extension',
  title: () => t('panel.title'),
  guide: [{ order: 34, title: () => t('panel.title'), description: () => t('panel.guide'), icon: GuideIcon }],
})

ctx.slots.inject('sidebar.right.pane.tab', () =>
  ctx.slots.register({ name: 'sidebar.right.pane.tab', key: 'wdx-git', locale: 'wdx-git' }, GitTabBody))

ctx.slots.inject('conversation.session.header.utilities', () =>
  ctx.slots.register({ name: '...', id: 'wdx-git', order: 11, label: ... }, HeaderGitButton))
```

`GitTabBody` 的 props 带 `sessionId`；cwd 从
`ctx.sessions.list.getSnapshot().byId[sessionId].cwd` 取。

### 5.2 布局

- 所有宽度都使用单列 tab：`提交 | 变更 | 历史 | 分支 | 差异`，默认选中「提交」。
  提交页不再固定在底部；宽幅也不做左右分栏，避免破坏一体化视觉。
- 顶栏只有仓库名、分支下拉和一个同步主按钮；按钮按 snapshot 显示
  `Fetch origin` / `Pull origin` / `Push origin` / `Sync` / `Publish branch`，
  点击永远调用 `sync`，由 Host 决定 fetch / merge / push。上次 fetch、ahead/behind、
  upstream 以文本显示。
- 「变更」把所有状态收拢成一个平铺列表，默认全部勾选；取消勾选只影响本次提交，
  `commit` 会带 `paths` / `exclude`。列表不提供单独的 stage / unstage 按钮。
- 轮询：每 8s `snapshot`（`document.hidden` 时跳过）；window focus 和
  visibilitychange 时刷新；写操作后立即刷新。
- 所有样式都在组件内 `<style>`，class 前缀 `wx-`；颜色只用 DSH theme token，
  主色引用 `--dsw-alias-state-business-primary`，不硬编码品牌蓝。

### 5.3 本地持久化

| key | 内容 |
| --- | --- |
| `wdx-git:ai` | `{ provider, model, effort }` |
| `wdx-git:push-after-commit` | boolean |
| `wdx-git:auto-stash` | boolean |
| `wdx-git:auto-resolve-conflicts` | boolean，默认 `false`；开启后 sync / pull 产生冲突会直接调用 `aiResolve(apply)` 逐个解决，不再确认 |

仓库级自定义提示词在 git config，不进 localStorage。

## 6. 安全

- 所有 git 命令走 argv 数组，`ctx.subprocess.spawn`，不经过 shell。
- `cwd` 必须绝对路径；paths 必须仓库内相对路径且不含 `..`。
- refs 白名单 `[\p{L}\p{N}._/-]+`，拒绝前导 `-`；hash 必须 4-40 位十六进制。
- `applyResolution` 与 `aiResolve(apply)` 会写文件：写入前再次确认冲突状态 + 路径前缀检查 + 内容/冲突标记校验；大文件按块解析时，全部块成功后才一次性写盘。
- git 子进程环境清空继承的坏 `GIT_CONFIG_*`，并设置 `GIT_TERMINAL_PROMPT=0`、
  `GIT_PAGER=cat`、`LC_ALL=C`、`GIT_EDITOR=true`，避免交互输入和本地化解析差异。
- macOS 上如果父进程没有显式代理变量，Host 读取 `scutil --proxy`，把系统
  HTTP/HTTPS/SOCKS 代理映射为 `HTTPS_PROXY` / `HTTP_PROXY` / `ALL_PROXY` 和
  `NO_PROXY` 后传给 git；结果缓存 60s。显式环境变量始终优先。
- 不做 force push，不自动 rebase，不改写历史。