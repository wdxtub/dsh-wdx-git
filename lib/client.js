// Browser bundle for dsh-wdx-git.
//
// A single classic script registered through the Host's module loader. It adds
// a session-scoped Git tab to the right sidebar and one entry icon to the
// session header. All data comes from POST /api/wdx-git; this file only renders.
window.__ModuleLoader__.load({
  id: 'dsh-wdx-git',
  factory: (require) => {
    var module = { exports: {} }
    var exports = module.exports
    Object.defineProperty(exports, Symbol.toStringTag, { value: 'Module' })

    var React = require('react')
    var h = React.createElement
    var useState = React.useState
    var useEffect = React.useEffect
    var useRef = React.useRef

    var NS = 'wdx-git'
    var RPC = '/api/wdx-git'
    var TAB_ID = 'wdx-git'
    var TAB_KIND = 'wdx-git'
    var POLL_MS = 8000
    var STORE_AI = 'wdx-git:ai'
    var STORE_PUSH = 'wdx-git:push-after-commit'
    var STORE_STASH = 'wdx-git:auto-stash'
    var STORE_AUTO_RESOLVE = 'wdx-git:auto-resolve-conflicts'
    var WIDE_PX = 720
    var IS_MAC = typeof navigator !== 'undefined' && /Mac|iPhone|iPad/.test(navigator.platform || '')

    // ---------------------------------------------------------------- locale

    var ZH = {
      'panel.title': 'WDX Git',
      'panel.open': '打开 Git 面板',
      'panel.guide': '一键同步、自动暂存提交、查看历史与分支、解决冲突，并可用 AI 写提交信息',
      'panel.description': 'GitHub Desktop 式的简化 Git 体验',

      'top.currentBranch': '当前分支',
      'top.branch': '切换分支',
      'top.newBranch': '新建分支',
      'top.refresh': '刷新',
      'top.fetch': 'Fetch origin',
      'top.fetchHint': 'Fetch 远端更新；需要时自动合并并推送',
      'top.pullHint': '拉取远端更新并合并到当前分支',
      'top.pushHint': '把本地提交推送到远端',
      'top.syncHint': '拉取远端更新并推送本地提交',
      'top.publishHint': '发布当前分支并建立 upstream',
      'top.sync': 'Sync',
      'top.pull': 'Pull origin',
      'top.push': 'Push origin',
      'top.publish': 'Publish branch',
      'top.syncing': '同步中…',
      'top.fetching': 'Fetch 中…',
      'top.lastFetched': '上次 fetch：{time}',
      'top.neverFetched': '尚未 fetch',
      'top.justNow': '刚刚',
      'top.secondsAgo': '{n} 秒前',
      'top.minutesAgo': '{n} 分钟前',
      'top.hoursAgo': '{n} 小时前',
      'top.daysAgo': '{n} 天前',
      'top.ahead': '↑{n}',
      'top.behind': '↓{n}',
      'top.aheadTitle': '本地有 {n} 个提交待推送',
      'top.behindTitle': '远端有 {n} 个提交待拉取',
      'top.detached': '游离 HEAD',
      'top.upstream': '上游 {ref}',

      'tabs.commit': '提交',
      'tabs.changes': '变更',
      'tabs.history': '历史',
      'tabs.branches': '分支',
      'tabs.diff': '差异',

      'changes.count': '{n} 个文件变更',
      'changes.filter': '筛选文件…',
      'changes.stageAll': '全部暂存',
      'changes.unstageAll': '全部取消暂存',
      'changes.staged': '已暂存',
      'changes.unstaged': '变更',
      'changes.untracked': '未跟踪',
      'changes.conflicts': '冲突',
      'changes.empty': '工作区干净',
      'changes.emptyHint': '没有未提交的改动。去「历史」看看提交，或继续写代码。',
      'changes.noMatch': '没有匹配的文件',
      'changes.select': '选中并提交',
      'changes.deselect': '取消选中',
      'changes.selectAll': '全选',
      'changes.stage': '暂存',
      'changes.unstage': '取消暂存',
      'changes.discard': '丢弃改动',
      'changes.discardUntracked': '删除文件',
      'changes.discardConfirm': '丢弃对 {path} 的改动？此操作不可恢复。',
      'changes.discardUntrackedConfirm': '删除未跟踪文件 {path}？此操作不可恢复。',
      'changes.discardStagedConfirm': '丢弃 {path} 的暂存与工作区改动？此操作不可恢复。',
      'changes.conflictBanner': '存在 {n} 个冲突文件，解决后再提交',
      'changes.autoStage': '提交时会自动暂存全部改动',

      'commit.title': '提交',
      'commit.summaryPlaceholder': 'Summary（必填）',
      'commit.descriptionPlaceholder': 'Description（可选）',
      'commit.commitTo': '提交到 {branch}',
      'commit.commitCountTo': '提交 {n} 个文件到 {branch}',
      'commit.committing': '提交中…',
      'commit.pushAfter': '提交后推送',
      'commit.ai': 'AI 生成',
      'commit.aiSection': 'AI 生成提交信息',
      'commit.avatar': '提交者',
      'commit.aiBusy': '生成中…',
      'commit.aiHint': '给 AI 的补充说明（可选）',
      'commit.settings': 'AI 与同步设置',
      'commit.generatedBy': '由 {model} 生成',
      'commit.fallback': '模型输出不可用，已使用降级文案',
      'commit.needSummary': '请先填写提交摘要',
      'commit.nothing': '没有可提交的改动',
      'commit.keyboard': '⌘↵ 提交',
      'commit.keyboardWin': 'Ctrl+↵ 提交',
      'commit.stagedCount': '将提交 {n} 个文件',
      'commit.conflictBlocked': '请先解决冲突',
      'commit.noSelection': '没有选中的改动',
      'commit.noChanges': '没有未提交的改动',
      'commit.selectedCount': '将提交 {selected} / {total} 个文件',
      'commit.defaultSelected': '改动默认全选，可在「变更」里取消',
      'commit.adjustSelection': '可在「变更」里调整选择',
      'commit.tip': '提交时会自动暂存选中的改动；在「变更」里可以取消勾选。',
      'commit.viewChanges': '查看变更',
      'commit.conflictHint': '{n} 个冲突文件待解决',
      'commit.noModel': '未选择模型',

      'ai.model': '模型',
      'ai.followSession': '跟随当前会话（{model}）',
      'ai.followSessionShort': '跟随会话',
      'ai.effort': '思考等级',
      'ai.effortAuto': '自动（低思考）',
      'ai.effortDefault': '模型默认',
      'ai.effortNone': '无思考',
      'ai.effortLow': '低',
      'ai.effortMedium': '中',
      'ai.effortHigh': '高',
      'ai.effortMax': '最高',
      'ai.hint': '默认用当前会话模型，并把思考等级压到 low / 无；也可以选更便宜的模型。',
      'ai.customPrompt': '自定义提交提示词',
      'ai.customPromptHint': '留空使用内置提示词。这里只改变写法，diff 与文件列表始终会发给模型。',
      'ai.refreshModels': '刷新模型',
      'ai.noModels': '没有可用的模型',
      'ai.unavailable': 'AI 服务不可用',
      'ai.configure': '配置 AI',

      'settings.title': 'AI 与同步设置',
      'settings.aiSection': 'AI 提交信息',
      'settings.syncSection': '同步',
      'settings.autoStash': '同步前自动 stash 本地改动',
      'settings.autoResolveConflicts': '冲突后自动用 AI 解决',
      'settings.autoResolveConflictsHint': '默认关闭。开启后，同步或拉取产生冲突时会立即逐个文件生成合并结果并暂存，不再询问；失败的冲突会留在「变更」页。',
      'settings.autoStashHint': '合并远端提交时不会因为工作区有改动而失败；如果恢复时冲突，改动会保留在 stash 里。',
      'settings.promptSection': '提交提示词（仅当前仓库）',
      'settings.save': '保存',
      'settings.cancel': '取消',
      'settings.resetPrompt': '恢复默认',
      'settings.saved': '设置已保存',
      'settings.modelsFailed': '部分模型不可用：{message}',
      'settings.noCatalog': '模型目录加载失败，可点「刷新模型」重试。',

      'history.allBranches': '所有分支',
      'history.filter': '筛选提交…',
      'history.empty': '暂无提交',
      'history.loading': '加载提交历史…',
      'history.commitCount': '{n} 个提交',
      'history.noMatch': '没有匹配的提交',
      'history.commitDiff': '提交 {hash}',
      'history.showingAll': '所有分支',
      'history.showingCurrent': '当前分支',
      'history.author': '作者',
      'history.parents': '父提交 {parents}',

      'branches.local': '本地分支',
      'branches.remote': '远程分支',
      'branches.current': '当前',
      'branches.switch': '切换',
      'branches.delete': '删除',
      'branches.deleteConfirm': '删除分支 {branch}？',
      'branches.empty': '没有分支',
      'branches.noMatch': '没有匹配的分支',
      'branches.search': '筛选分支…',
      'branches.new': '新建分支',
      'branches.newName': '新分支名',
      'branches.from': '起点（可选）',
      'branches.create': '创建',
      'branches.cancel': '取消',
      'branches.gone': 'upstream 已删除',
      'branches.ahead': '↑{n}',
      'branches.behind': '↓{n}',

      'stash.title': 'Stash',
      'stash.placeholder': 'stash 说明（可选）',
      'stash.save': '暂存改动',
      'stash.pop': '恢复',
      'stash.drop': '删除',
      'stash.empty': '没有 stash 记录',
      'stash.popConfirm': '恢复 stash@{n} 并从列表移除？',
      'stash.dropConfirm': '删除 stash@{n}？此操作不可恢复。',

      'operation.merge': '正在合并',
      'operation.rebase': '正在变基',
      'operation.cherryPick': '正在 cherry-pick',
      'operation.revert': '正在 revert',
      'operation.conflicts': '{n} 个冲突待解决',
      'operation.continue': '继续',
      'operation.abort': '中止',
      'operation.abortConfirm': '中止当前操作并恢复之前的状态？',

      'diff.empty': '点击变更文件或提交查看差异',
      'diff.loading': '加载差异…',
      'diff.binary': '二进制文件，无法显示文本差异',
      'diff.truncated': '差异过大，已截断',
      'diff.staged': '暂存区',
      'diff.worktree': '工作区',
      'diff.untracked': '新文件',
      'diff.conflict': '冲突 · 当前分支 ↔ 合入分支',
      'diff.conflictDeleted': '该文件在合并的一侧被删除',
      'diff.conflictSame': '两边内容一致',
      'diff.noText': '没有文本差异',
      'diff.resolve': '解决冲突',
      'diff.added': '新增',
      'diff.deleted': '删除',
      'diff.renamed': '重命名',
      'diff.modified': '修改',
      'diff.commitHeader': '提交 {hash}',
      'diff.commitMeta': '{author} · {date}',
      'diff.parents': '父提交 {parents}',
      'diff.lines': '{n} 行',

      'conflict.title': '解决冲突',
      'conflict.hint': '补充说明（可选），例如「版本号取上游」',
      'conflict.ai': 'AI 生成建议',
      'conflict.autoAll': 'AI 解决全部',
      'conflict.autoAllConfirm': '用 AI 逐个解决 {n} 个冲突，并直接写入、暂存文件？',
      'conflict.autoAllBusy': '正在解决 {done}/{total}…',
      'conflict.autoAllDone': '已解决 {done} 个冲突',
      'conflict.autoAllPartial': '已解决 {done}/{total} 个冲突，{failed} 个需要手动处理',
      'conflict.autoAllFailed': '自动解决失败，{n} 个冲突仍待处理',
      'conflict.autoAllRemaining': '以下 {n} 个冲突未自动解决',
      'conflict.regenerate': '重新生成',
      'conflict.preview': 'AI 建议 · 确认后才会写入文件',
      'conflict.empty': '生成建议，或直接取某一侧；生成过程不会改动文件。',
      'conflict.generating': '正在生成解决建议…',
      'conflict.takeOurs': '取当前分支',
      'conflict.takeTheirs': '取对方分支',
      'conflict.keepOurs': '保留当前分支版本',
      'conflict.keepTheirs': '保留合入版本',
      'conflict.deleteFile': '删除该文件',
      'conflict.deleteApply': '删除并标记已解决',
      'conflict.apply': '应用并标记已解决',
      'conflict.markResolved': '标记为已解决',
      'conflict.close': '关闭',
      'conflict.deletePreview': '建议删除该文件（存活侧相对共同祖先没有改动）· 确认后才会删除',
      'conflict.remaining': '还剩 {n} 个冲突文件',
      'conflict.deletedOurs': '该文件在当前分支被删除：可删除，或保留合入分支版本。',
      'conflict.deletedTheirs': '该文件在合入分支被删除：可删除，或保留当前分支版本。',
      'conflict.noBase': 'add/add 冲突，没有共同祖先',
      'conflict.model': '由 {model} 生成',
      'conflict.resolveAll': '全部冲突已解决，可以提交了',
      'conflict.discard': '取消',

      'status.ready': '就绪',
      'status.busy': '执行中：{label}',
      'status.loading': '加载中…',
      'status.staged': '已暂存',
      'status.unstaged': '已取消暂存',
      'status.stagedAll': '已暂存全部变更',
      'status.unstagedAll': '已取消暂存全部变更',
      'status.discarded': '已丢弃 {path}',
      'status.switched': '已切换到 {branch}',
      'status.created': '已创建分支 {branch}',
      'status.deleted': '已删除分支 {branch}',
      'status.committed': '已提交 {hash}',
      'status.synced': '同步完成',
      'status.pulled': '已合并远端提交',
      'status.pushed': '已推送',
      'status.fetched': 'Fetch 完成',
      'status.stashed': '已 stash 当前改动',
      'status.stashPopped': '已恢复 stash@{n}',
      'status.stashDropped': '已删除 stash@{n}',
      'status.promptSaved': '提示词已保存',
      'status.promptReset': '已恢复默认提示词',
      'status.resolveApplied': '已应用解决结果',
      'status.resolveDeleted': '已删除文件并标记解决',
      'status.tookOurs': '已取当前分支版本',
      'status.tookTheirs': '已取对方版本',
      'status.aborted': '已中止当前操作',
      'status.continued': '已继续当前操作',
      'status.aiGenerated': '已生成提交信息（{model}）',
      'status.aiFallback': '已生成降级文案',
      'status.conflict': '合并有冲突，请在「变更」里解决',
      'status.stashConflict': '恢复本地改动时有冲突，改动已保留在 stash',
      'status.conflictStashed': '本地改动已自动存入 stash，冲突解决后可从「分支」恢复',
      'status.autoStashRestored': '本地改动已自动 stash 并恢复',
      'status.noChanges': '没有可提交的改动',
      'status.fetchedAt': '刚刚 fetch',
      'status.retry': '重试',
      'status.dismiss': '关闭',
      'status.output': '最近一次操作输出',
      'status.upToDate': '已是最新',
      'status.syncConflictFile': '冲突：{path}',

      'error.transport': '无法连接 Git 服务',
      'error.badResponse': 'Git 服务返回了非 JSON 响应',
      'error.boundary': 'Git 面板渲染出错',
      'error.title': '出错了',

      'empty.noSession': '请先选择一个会话',
      'empty.noCwd': '当前会话没有工作目录',
      'empty.notRepo': '当前目录不是 Git 仓库',
      'empty.notRepoHint': '在会话目录里初始化一个仓库后再打开这个面板。',
      'empty.cwdUnavailable': '工作目录不存在或无法访问：{path}',
      'empty.loading': '加载中…',
      'empty.noDiff': '选择一个文件或提交',
      'empty.noDiffHint': '左侧列表里的文件、历史里的提交都可以点开看差异。',

      'busy.stage': '暂存',
      'busy.unstage': '取消暂存',
      'busy.commit': '提交',
      'busy.fetch': 'Fetch',
      'busy.sync': '同步',
      'busy.ai': '生成提交信息',
      'busy.switch': '切换分支',
      'busy.delete': '删除分支',
      'busy.stash': 'Stash',
      'busy.discard': '丢弃改动',
      'busy.resolve': '解决冲突',
      'busy.resolve-all': 'AI 解决全部冲突',
      'busy.save': '保存',
      'busy.create': '创建分支',
      'busy.continue': '继续操作',
      'busy.abort': '中止操作',

      'toast.dismiss': '关闭',
    }

    var EN = {
      'panel.title': 'WDX Git',
      'panel.open': 'Open Git panel',
      'panel.guide': 'One-click sync, auto-staged commits, history, branches, conflicts, and AI commit messages',
      'panel.description': 'A frictionless GitHub Desktop-style Git experience',

      'top.currentBranch': 'Current Branch',
      'top.branch': 'Switch branch',
      'top.newBranch': 'New branch',
      'top.refresh': 'Refresh',
      'top.fetch': 'Fetch origin',
      'top.fetchHint': 'Fetch remote updates; merge and push when needed',
      'top.pullHint': 'Pull remote updates and merge them',
      'top.pushHint': 'Push local commits to the remote',
      'top.syncHint': 'Pull remote updates and push local commits',
      'top.publishHint': 'Publish this branch and set its upstream',
      'top.sync': 'Sync',
      'top.pull': 'Pull origin',
      'top.push': 'Push origin',
      'top.publish': 'Publish branch',
      'top.syncing': 'Syncing…',
      'top.fetching': 'Fetching…',
      'top.lastFetched': 'Last fetched {time}',
      'top.neverFetched': 'Not fetched yet',
      'top.justNow': 'just now',
      'top.secondsAgo': '{n} seconds ago',
      'top.minutesAgo': '{n} minutes ago',
      'top.hoursAgo': '{n} hours ago',
      'top.daysAgo': '{n} days ago',
      'top.ahead': '↑{n}',
      'top.behind': '↓{n}',
      'top.aheadTitle': '{n} local commits to push',
      'top.behindTitle': '{n} new remote commits to pull',
      'top.detached': 'detached HEAD',
      'top.upstream': 'upstream {ref}',

      'tabs.commit': 'Commit',
      'tabs.changes': 'Changes',
      'tabs.history': 'History',
      'tabs.branches': 'Branches',
      'tabs.diff': 'Diff',

      'changes.count': '{n} changed files',
      'changes.filter': 'Filter files…',
      'changes.stageAll': 'Stage all',
      'changes.unstageAll': 'Unstage all',
      'changes.staged': 'Staged',
      'changes.unstaged': 'Changes',
      'changes.untracked': 'Untracked',
      'changes.conflicts': 'Conflicts',
      'changes.empty': 'Working tree clean',
      'changes.emptyHint': 'No uncommitted changes. Check History or keep coding.',
      'changes.noMatch': 'No matching files',
      'changes.select': 'Select for commit',
      'changes.deselect': 'Deselect',
      'changes.selectAll': 'Select all',
      'changes.stage': 'Stage',
      'changes.unstage': 'Unstage',
      'changes.discard': 'Discard changes',
      'changes.discardUntracked': 'Delete file',
      'changes.discardConfirm': 'Discard changes to {path}? This cannot be undone.',
      'changes.discardUntrackedConfirm': 'Delete untracked file {path}? This cannot be undone.',
      'changes.discardStagedConfirm': 'Discard staged and working-tree changes to {path}? This cannot be undone.',
      'changes.conflictBanner': '{n} conflicted file(s); resolve them before committing',
      'changes.autoStage': 'All changes are auto-staged when you commit',

      'commit.title': 'Commit',
      'commit.summaryPlaceholder': 'Summary (required)',
      'commit.descriptionPlaceholder': 'Description (optional)',
      'commit.commitTo': 'Commit to {branch}',
      'commit.commitCountTo': 'Commit {n} files to {branch}',
      'commit.committing': 'Committing…',
      'commit.pushAfter': 'Push after commit',
      'commit.ai': 'AI message',
      'commit.aiBusy': 'Generating…',
      'commit.aiHint': 'Optional hint for the AI',
      'commit.settings': 'AI & sync settings',
      'commit.generatedBy': 'Generated by {model}',
      'commit.fallback': 'Model output unusable; fallback message used',
      'commit.needSummary': 'Enter a commit summary first',
      'commit.nothing': 'Nothing to commit',
      'commit.keyboard': '⌘↵ commit',
      'commit.keyboardWin': 'Ctrl+↵ commit',
      'commit.stagedCount': '{n} file(s) will be committed',
      'commit.conflictBlocked': 'Resolve conflicts first',
      'commit.noSelection': 'No changes selected',
      'commit.noChanges': 'No uncommitted changes',
      'commit.selectedCount': 'Committing {selected} of {total} files',
      'commit.defaultSelected': 'All changes are selected by default',
      'commit.adjustSelection': 'Adjust the selection in Changes',
      'commit.tip': 'Selected changes are staged automatically when you commit. Uncheck files in Changes to exclude them.',
      'commit.viewChanges': 'View changes',
      'commit.conflictHint': '{n} conflicted file(s) to resolve',
      'commit.noModel': 'No model selected',

      'ai.model': 'Model',
      'ai.followSession': 'Follow this session ({model})',
      'ai.followSessionShort': 'Follow session',
      'ai.effort': 'Reasoning effort',
      'ai.effortAuto': 'Auto (low effort)',
      'ai.effortDefault': 'Model default',
      'ai.effortNone': 'No thinking',
      'ai.effortLow': 'Low',
      'ai.effortMedium': 'Medium',
      'ai.effortHigh': 'High',
      'ai.effortMax': 'Max',
      'ai.hint': 'Defaults to this session model with low/no reasoning. Pick a cheaper model for commit writing if you like.',
      'ai.customPrompt': 'Custom commit prompt',
      'ai.customPromptHint': 'Leave empty for the built-in prompt. This only changes how it writes; the diff and file list are always sent.',
      'ai.refreshModels': 'Refresh models',
      'ai.noModels': 'No models available',
      'ai.unavailable': 'AI unavailable',
      'ai.configure': 'Configure AI',

      'settings.title': 'AI & sync settings',
      'settings.aiSection': 'AI commit messages',
      'settings.syncSection': 'Sync',
      'settings.autoStash': 'Auto-stash local changes before sync',
      'settings.autoResolveConflicts': 'Resolve conflicts with AI after sync',
      'settings.autoResolveConflictsHint': 'Off by default. When enabled, conflicts produced by sync or pull are resolved and staged file by file without asking; failed conflicts stay in Changes.',
      'settings.autoStashHint': 'Prevents a dirty working tree from blocking a merge. If restoring the stash conflicts, your changes stay in the stash.',
      'settings.promptSection': 'Commit prompt (this repository only)',
      'settings.save': 'Save',
      'settings.cancel': 'Cancel',
      'settings.resetPrompt': 'Reset to default',
      'settings.saved': 'Settings saved',
      'settings.modelsFailed': 'Some models are unavailable: {message}',
      'settings.noCatalog': 'Could not load the model catalog. Try Refresh models.',

      'history.allBranches': 'All branches',
      'history.filter': 'Filter commits…',
      'history.empty': 'No commits yet',
      'history.loading': 'Loading history…',
      'history.commitCount': '{n} commits',
      'history.noMatch': 'No matching commits',
      'history.commitDiff': 'Commit {hash}',
      'history.showingAll': 'all branches',
      'history.showingCurrent': 'current branch',
      'history.author': 'Author',
      'history.parents': 'Parents {parents}',

      'branches.local': 'Local branches',
      'branches.remote': 'Remote branches',
      'branches.current': 'current',
      'branches.switch': 'Switch',
      'branches.delete': 'Delete',
      'branches.deleteConfirm': 'Delete branch {branch}?',
      'branches.empty': 'No branches',
      'branches.noMatch': 'No matching branches',
      'branches.search': 'Filter branches…',
      'branches.new': 'New branch',
      'branches.newName': 'new branch name',
      'branches.from': 'start point (optional)',
      'branches.create': 'Create',
      'branches.cancel': 'Cancel',
      'branches.gone': 'upstream gone',
      'branches.ahead': '↑{n}',
      'branches.behind': '↓{n}',

      'stash.title': 'Stash',
      'stash.placeholder': 'Stash message (optional)',
      'stash.save': 'Stash changes',
      'stash.pop': 'Restore',
      'stash.drop': 'Drop',
      'stash.empty': 'No stash entries',
      'stash.popConfirm': 'Restore stash@{n} and remove it from the list?',
      'stash.dropConfirm': 'Drop stash@{n}? This cannot be undone.',

      'operation.merge': 'Merge in progress',
      'operation.rebase': 'Rebase in progress',
      'operation.cherryPick': 'Cherry-pick in progress',
      'operation.revert': 'Revert in progress',
      'operation.conflicts': '{n} conflicted file(s)',
      'operation.continue': 'Continue',
      'operation.abort': 'Abort',
      'operation.abortConfirm': 'Abort the current operation and restore the previous state?',

      'diff.empty': 'Pick a changed file or a commit',
      'diff.loading': 'Loading diff…',
      'diff.binary': 'Binary file; no textual diff',
      'diff.truncated': 'Diff truncated',
      'diff.staged': 'Staged',
      'diff.worktree': 'Working tree',
      'diff.untracked': 'New file',
      'diff.conflict': 'Conflict · ours ↔ theirs',
      'diff.conflictDeleted': 'The file was deleted on one side of the merge',
      'diff.conflictSame': 'Both sides are identical',
      'diff.noText': 'No textual diff',
      'diff.resolve': 'Resolve conflict',
      'diff.added': 'added',
      'diff.deleted': 'deleted',
      'diff.renamed': 'renamed',
      'diff.modified': 'modified',
      'diff.commitHeader': 'Commit {hash}',
      'diff.commitMeta': '{author} · {date}',
      'diff.parents': 'Parents {parents}',
      'diff.lines': '{n} lines',

      'conflict.title': 'Resolve conflict',
      'conflict.hint': 'Optional hint, e.g. "take the upstream version"',
      'conflict.ai': 'Generate a resolution',
      'conflict.autoAll': 'Resolve all with AI',
      'conflict.autoAllConfirm': 'Resolve all {n} conflicts with AI, writing and staging each file?',
      'conflict.autoAllBusy': 'Resolving {done}/{total}…',
      'conflict.autoAllDone': 'Resolved {done} conflict(s)',
      'conflict.autoAllPartial': 'Resolved {done}/{total} conflicts; {failed} need manual work',
      'conflict.autoAllFailed': 'Automatic resolution failed; {n} conflict(s) remain',
      'conflict.autoAllRemaining': '{n} conflict(s) still need manual work',
      'conflict.regenerate': 'Regenerate',
      'conflict.preview': 'AI suggestion · nothing is written until you apply',
      'conflict.empty': 'Generate a suggestion, or take one side; generating never touches the file.',
      'conflict.generating': 'Generating a resolution…',
      'conflict.takeOurs': 'Take ours',
      'conflict.takeTheirs': 'Take theirs',
      'conflict.keepOurs': 'Keep the current branch version',
      'conflict.keepTheirs': 'Keep the incoming version',
      'conflict.deleteFile': 'Delete this file',
      'conflict.deleteApply': 'Delete and mark resolved',
      'conflict.apply': 'Apply and mark resolved',
      'conflict.markResolved': 'Mark resolved',
      'conflict.close': 'Close',
      'conflict.deletePreview': 'Suggestion: delete this file (the surviving side is unchanged from base) · nothing is deleted until you apply',
      'conflict.remaining': '{n} conflicted file(s) left',
      'conflict.deletedOurs': 'Deleted on the current branch: delete it, or keep the incoming version.',
      'conflict.deletedTheirs': 'Deleted on the incoming branch: delete it, or keep the current branch version.',
      'conflict.noBase': 'add/add conflict; no common ancestor',
      'conflict.model': 'Generated by {model}',
      'conflict.resolveAll': 'All conflicts resolved; ready to commit',
      'conflict.discard': 'Discard',

      'status.ready': 'Ready',
      'status.busy': 'Running: {label}',
      'status.loading': 'Loading…',
      'status.staged': 'Staged',
      'status.unstaged': 'Unstaged',
      'status.stagedAll': 'Staged all changes',
      'status.unstagedAll': 'Unstaged all changes',
      'status.discarded': 'Discarded {path}',
      'status.switched': 'Switched to {branch}',
      'status.created': 'Created branch {branch}',
      'status.deleted': 'Deleted branch {branch}',
      'status.committed': 'Committed {hash}',
      'status.synced': 'Sync complete',
      'status.pulled': 'Merged remote commits',
      'status.pushed': 'Pushed',
      'status.fetched': 'Fetch complete',
      'status.stashed': 'Stashed current changes',
      'status.stashPopped': 'Restored stash@{n}',
      'status.stashDropped': 'Dropped stash@{n}',
      'status.promptSaved': 'Prompt saved',
      'status.promptReset': 'Restored the default prompt',
      'status.resolveApplied': 'Resolution applied',
      'status.resolveDeleted': 'File deleted and marked resolved',
      'status.tookOurs': 'Took the current branch version',
      'status.tookTheirs': 'Took the incoming version',
      'status.aborted': 'Aborted the current operation',
      'status.continued': 'Continued the current operation',
      'status.aiGenerated': 'Commit message generated ({model})',
      'status.aiFallback': 'Fallback message generated',
      'status.conflict': 'Merge has conflicts; resolve them in Changes',
      'status.stashConflict': 'Restoring local changes conflicted; they remain in the stash',
      'status.conflictStashed': 'Local changes were auto-stashed; restore them from Branches after resolving conflicts',
      'status.autoStashRestored': 'Local changes auto-stashed and restored',
      'status.noChanges': 'Nothing to commit',
      'status.fetchedAt': 'Fetched just now',
      'status.retry': 'Retry',
      'status.dismiss': 'Dismiss',
      'status.output': 'Last operation output',
      'status.upToDate': 'Up to date',
      'status.syncConflictFile': 'Conflict: {path}',

      'error.transport': 'Cannot reach the Git service',
      'error.badResponse': 'The Git service returned a non-JSON response',
      'error.boundary': 'The Git panel crashed',
      'error.title': 'Something went wrong',

      'empty.noSession': 'Select a session first',
      'empty.noCwd': 'This session has no working directory',
      'empty.notRepo': 'This directory is not a Git repository',
      'empty.notRepoHint': 'Initialize a repository in the session folder, then reopen this panel.',
      'empty.cwdUnavailable': 'The session working directory is missing or inaccessible: {path}',
      'empty.loading': 'Loading…',
      'empty.noDiff': 'Select a file or a commit',
      'empty.noDiffHint': 'Files in the list and commits in History open their diffs here.',

      'busy.stage': 'stage',
      'busy.unstage': 'unstage',
      'busy.commit': 'commit',
      'busy.fetch': 'fetch',
      'busy.sync': 'sync',
      'busy.ai': 'generate message',
      'busy.switch': 'switch branch',
      'busy.delete': 'delete branch',
      'busy.stash': 'stash',
      'busy.discard': 'discard',
      'busy.resolve': 'resolve conflict',
      'busy.resolve-all': 'resolve all conflicts',
      'busy.save': 'save',
      'busy.create': 'create branch',
      'busy.continue': 'continue',
      'busy.abort': 'abort',

      'toast.dismiss': 'Dismiss',
    }

    // ---------------------------------------------------------------- styles

    var mono = 'ui-monospace, SFMono-Regular, Menlo, Consolas, "Liberation Mono", monospace'

    var CSS = `
      .wx-root {
        --wx-accent:var(--dsw-alias-state-business-primary);
        --wx-accent-fg:var(--dsw-alias-label-primary-foreground);
        --wx-ink:var(--dsw-alias-label-primary);
        --wx-dim:var(--dsw-alias-label-secondary);
        --wx-faint:var(--dsw-alias-label-tertiary, var(--dsw-alias-label-secondary));
        --wx-base:var(--dsw-alias-bg-base);
        --wx-layer:var(--dsw-alias-bg-layer-1);
        --wx-layer2:var(--dsw-alias-bg-layer-2);
        --wx-sel:var(--dsw-specific-selector, var(--dsw-alias-interactive-bg-active));
        --wx-hover:var(--dsw-alias-interactive-bg-hover);
        --wx-line:var(--dsw-alias-border-l1);
        --wx-line2:var(--dsw-alias-border-l2);
        --wx-elevated:var(--dsw-alias-button-elevated-fill);
        --wx-ok:var(--dsw-alias-state-success-primary);
        --wx-err:var(--dsw-alias-state-error-primary);
        --wx-warn:var(--dsw-alias-state-warn-primary);
        --wx-lane-0:var(--dsw-static-deepseek-450);
        --wx-lane-1:var(--dsw-static-violet-400);
        --wx-lane-2:var(--dsw-static-blue-500);
        --wx-lane-3:var(--dsw-static-green-500);
        --wx-lane-4:var(--dsw-static-amber-500);
        --wx-lane-5:var(--dsw-static-red-500);
        --wx-lane-6:var(--dsw-static-deepseek-600);
        --wx-lane-7:var(--dsw-static-blue-400);
        position:relative; display:flex; flex-direction:column; height:100%; min-height:0;
        container-type:inline-size; container-name:wx;
        background:var(--wx-base); color:var(--wx-ink);
        font-size:12px; line-height:1.5; animation:wx-fade .14s ease;
      }
      .wx-root *, .wx-root *::before, .wx-root *::after { box-sizing:border-box; }
      .wx-root button, .wx-root input, .wx-root textarea, .wx-root select { font:inherit; }
      .wx-mono { font-family:var(--wx-mono-font); }
      .wx-root { --wx-mono-font:ui-monospace, SFMono-Regular, Menlo, Consolas, "Liberation Mono", monospace; }
      .wx-spacer { flex:1 1 auto; min-width:0; }

      /* top area: repo line + two-cell toolbar (Current Branch | sync) */
      .wx-top { flex:none; display:flex; flex-direction:column; gap:7px; padding:11px 10px 2px; }
      .wx-top-meta { display:flex; align-items:center; gap:6px; min-width:0; padding:0 2px; }
      .wx-repo { min-width:0; flex:0 1 auto; overflow:hidden; text-overflow:ellipsis; white-space:nowrap;
        font-size:12px; font-weight:600; letter-spacing:-.01em; color:var(--wx-ink); }
      .wx-upstream { min-width:0; overflow:hidden; text-overflow:ellipsis; white-space:nowrap;
        font-size:10.5px; color:var(--wx-faint); }
      .wx-toolbar { display:flex; align-items:stretch; min-width:0; overflow:hidden;
        border:1px solid var(--wx-line); border-radius:9px; background:var(--wx-elevated); }
      .wx-cell { position:relative; display:flex; align-items:center; gap:8px; min-width:0; height:46px;
        padding:0 10px; border:none; background:transparent; color:var(--wx-ink); text-align:left;
        cursor:pointer; transition:background .12s; }
      .wx-cell:hover { background:var(--wx-hover); }
      .wx-cell:focus-visible { outline:2px solid var(--wx-accent); outline-offset:-2px; }
      .wx-branch-cell:focus-within { outline:2px solid var(--wx-accent); outline-offset:-2px; }
      .wx-cell + .wx-cell { border-left:1px solid var(--wx-line); }
      .wx-cell.is-disabled { opacity:.55; cursor:default; }
      .wx-cell.is-disabled:hover { background:transparent; }
      .wx-cell-icon { flex:none; color:var(--wx-faint); }
      .wx-cell-icon.spin { animation:wx-spin .9s linear infinite; transform-origin:center; }
      .wx-cell-text { display:flex; flex-direction:column; gap:1px; min-width:0; flex:1 1 auto; }
      .wx-cell-label { font-size:10.5px; line-height:1.25; color:var(--wx-dim);
        overflow:hidden; text-overflow:ellipsis; white-space:nowrap; }
      .wx-cell-title { font-size:12.5px; font-weight:600; line-height:1.3; color:var(--wx-ink);
        overflow:hidden; text-overflow:ellipsis; white-space:nowrap; }
      .wx-cell-sub { font-size:10.5px; line-height:1.25; color:var(--wx-dim);
        overflow:hidden; text-overflow:ellipsis; white-space:nowrap; }
      .wx-sync-counts { display:flex; align-items:center; gap:4px; flex:none; }
      .wx-sync-badge { display:inline-flex; align-items:center; justify-content:center; gap:3px;
        min-width:34px; height:20px; padding:0 7px; border-radius:999px; flex:none;
        background:color-mix(in srgb,var(--wx-ink) 12%,transparent); color:var(--wx-ink);
        font-size:10.5px; font-weight:600; line-height:1; font-variant-numeric:tabular-nums; }
      .wx-sync-badge svg { flex:none; opacity:.92; }
      .wx-branch-cell { flex:1 1 50%; min-width:0; padding-right:6px; }
      .wx-cell-chevron { flex:none; color:var(--wx-faint); }
      .wx-branch-native { position:absolute; inset:0; width:100%; height:100%; opacity:0;
        border:none; background:transparent; appearance:none; cursor:pointer; }
      .wx-branch-native:disabled { cursor:default; }
      .wx-sync-cell { flex:1 1 50%; min-width:118px; }

      /* tabs: neutral selected chip, not a colored tab bar */
      .wx-tabs { flex:none; display:flex; align-items:center; gap:2px; padding:6px 8px 7px; overflow-x:auto; scrollbar-width:none; }
      .wx-tabs::-webkit-scrollbar { display:none; }
      .wx-tab { display:inline-flex; align-items:center; gap:5px; height:27px; padding:0 9px; border:none; border-radius:7px;
        background:transparent; color:var(--wx-dim); font-size:12px; cursor:pointer; white-space:nowrap; transition:background .12s,color .12s; }
      .wx-tab:hover { background:var(--wx-hover); color:var(--wx-ink); }
      .wx-tab.active { background:var(--wx-sel); color:var(--wx-ink); font-weight:600; }
      .wx-tab:focus-visible { outline:2px solid var(--wx-accent); outline-offset:1px; }
      .wx-tab-count { min-width:15px; height:15px; padding:0 4px; border-radius:999px; background:var(--wx-layer2);
        color:var(--wx-dim); font-size:9.5px; font-weight:600; display:inline-flex; align-items:center; justify-content:center; }
      .wx-tab.active .wx-tab-count { background:color-mix(in srgb,var(--wx-ink) 9%,transparent); color:var(--wx-ink); }

      /* main single column, seamless surface */
      .wx-main { flex:1 1 0; min-height:0; display:flex; overflow:hidden; }
      .wx-pane { flex:1 1 0; min-height:0; width:100%; overflow-y:auto; overflow-x:hidden;
        scrollbar-width:thin; scrollbar-color:color-mix(in srgb,var(--wx-ink) 18%,transparent) transparent; }
      .wx-pane::-webkit-scrollbar { width:9px; height:9px; }
      .wx-pane::-webkit-scrollbar-thumb { background:color-mix(in srgb,var(--wx-ink) 16%,transparent); border-radius:99px; border:3px solid transparent; background-clip:content-box; }

      /* common buttons */
      .wx-btn { display:inline-flex; align-items:center; justify-content:center; gap:4px; height:26px; padding:0 9px;
        border:none; border-radius:7px; background:transparent; color:var(--wx-ink); font-size:11.5px; cursor:pointer;
        white-space:nowrap; transition:background .12s,color .12s,opacity .12s; }
      .wx-btn svg { width:13px; height:13px; flex:none; }
      .wx-btn-label { min-width:0; overflow:hidden; text-overflow:ellipsis; }
      .wx-btn:hover:not(:disabled) { background:var(--wx-hover); }
      .wx-btn:focus-visible { outline:2px solid var(--wx-accent); outline-offset:1px; }
      .wx-btn:disabled { opacity:.4; cursor:default; }
      .wx-btn.primary { background:var(--wx-accent); color:var(--wx-accent-fg); font-weight:600; }
      .wx-btn.primary:hover:not(:disabled) { background:var(--dsw-alias-button-info-hover, var(--wx-accent)); }
      .wx-btn.ghost { color:var(--wx-dim); }
      .wx-btn.ghost:hover:not(:disabled) { color:var(--wx-ink); background:var(--wx-hover); }
      .wx-btn.icon { width:26px; padding:0; }
      .wx-btn.sm { height:22px; font-size:10.5px; padding:0 7px; border-radius:6px; }
      .wx-btn.icon.sm { width:22px; }
      .wx-btn.danger:hover:not(:disabled) { color:var(--wx-err); background:color-mix(in srgb,var(--wx-err) 9%,transparent); }
      .wx-text-btn { border:none; background:transparent; padding:0; color:var(--wx-dim); font-size:11px; cursor:pointer; white-space:nowrap; }
      .wx-text-btn:hover { color:var(--wx-ink); text-decoration:underline; text-underline-offset:2px; }
      .wx-text-btn:focus-visible { outline:2px solid var(--wx-accent); outline-offset:2px; border-radius:3px; }

      /* list headers */
      .wx-list-head { position:sticky; top:0; z-index:3; display:flex; align-items:center; gap:7px; padding:7px 8px 6px;
        background:var(--wx-base); }
      .wx-list-title { font-size:11.5px; font-weight:600; color:var(--wx-ink); white-space:nowrap; }
      .wx-filter { flex:1 1 auto; min-width:50px; height:26px; padding:0 8px; border:none; border-radius:7px;
        background:var(--wx-layer2); color:var(--wx-ink); font-size:11.5px; }
      .wx-filter::placeholder { color:var(--wx-faint); }
      .wx-filter:focus-visible { outline:none; box-shadow:0 0 0 2px color-mix(in srgb,var(--wx-accent) 38%,transparent); }

      /* changes: one flat, default-selected list */
      .wx-file-list { padding:2px 5px 12px; }
      .wx-file { display:flex; align-items:center; gap:6px; min-height:30px; padding:3px 6px; border-radius:7px; cursor:pointer;
        transition:background .1s; }
      .wx-file:hover { background:var(--wx-hover); }
      .wx-file.active { background:var(--wx-sel); }
      .wx-check { width:15px; height:15px; border-radius:4px; border:1.5px solid var(--wx-line2); flex:none;
        display:grid; place-items:center; cursor:pointer; background:transparent; color:transparent; transition:background .1s,border-color .1s; }
      .wx-check:hover { border-color:var(--wx-dim); }
      .wx-check.checked { background:var(--wx-accent); border-color:var(--wx-accent); color:var(--wx-accent-fg); }
      .wx-check:focus-visible { outline:2px solid var(--wx-accent); outline-offset:1px; }
      .wx-check svg { width:10px; height:10px; }
      .wx-check.disabled { opacity:.35; cursor:default; }
      .wx-stat { width:14px; height:16px; flex:none; display:grid; place-items:center; background:transparent;
        font-family:var(--wx-mono-font); font-size:10px; font-weight:700; color:var(--wx-faint); }
      .wx-stat.m { color:var(--wx-warn); }
      .wx-stat.a { color:var(--wx-ok); }
      .wx-stat.d, .wx-stat.u { color:var(--wx-err); }
      .wx-stat.q { color:var(--wx-faint); }
      .wx-path { flex:1 1 auto; min-width:0; overflow:hidden; text-overflow:ellipsis; white-space:nowrap; font-size:12px; }
      .wx-path .wx-dir { color:var(--wx-faint); }
      .wx-file-actions { display:flex; align-items:center; gap:1px; opacity:0; flex:none; transition:opacity .1s; }
      .wx-file:hover .wx-file-actions, .wx-file:focus-within .wx-file-actions { opacity:1; }
      @media (hover:none) { .wx-file-actions { opacity:1; } }
      .wx-conflict-bar { display:flex; align-items:center; gap:6px; margin:6px 8px 2px; padding:6px 9px; border-radius:7px;
        font-size:11px; font-weight:500; color:var(--wx-err); background:color-mix(in srgb,var(--wx-err) 8%,transparent); }
      .wx-conflict-bar-text { flex:1 1 auto; min-width:0; overflow:hidden; text-overflow:ellipsis; white-space:nowrap; }
      .wx-conflict-report { margin:2px 8px; padding:6px 9px; border-radius:7px; font-size:10.5px; color:var(--wx-dim);
        background:var(--wx-layer2); }
      .wx-conflict-report-head { display:flex; align-items:center; gap:6px; color:var(--wx-warn); font-weight:600; }
      .wx-conflict-report-row { display:flex; gap:6px; padding-top:4px; min-width:0; }
      .wx-conflict-report-path { flex:none; max-width:46%; overflow:hidden; text-overflow:ellipsis; white-space:nowrap;
        color:var(--wx-ink); font-family:var(--wx-mono-font); }
      .wx-conflict-report-msg { flex:1 1 auto; min-width:0; overflow:hidden; text-overflow:ellipsis; white-space:nowrap; }
      .wx-notice { display:flex; flex-wrap:wrap; align-items:center; gap:7px; padding:7px 9px; border-radius:8px; font-size:11.5px; color:var(--wx-ink);
        background:color-mix(in srgb,var(--wx-warn) 9%,transparent); }
      .wx-notice svg { color:var(--wx-warn); flex:none; }

      /* empty / loading */
      .wx-empty { flex:1 1 auto; min-height:0; display:flex; flex-direction:column; align-items:center; justify-content:center;
        gap:6px; padding:30px 18px; text-align:center; color:var(--wx-dim); }
      .wx-empty-icon { width:34px; height:34px; border-radius:9px; display:grid; place-items:center; color:var(--wx-faint);
        background:var(--wx-layer2); }
      .wx-empty-title { color:var(--wx-ink); font-size:12.5px; font-weight:600; }
      .wx-empty-hint { font-size:11.5px; line-height:1.6; max-width:280px; color:var(--wx-dim); }
      .wx-spinner { width:14px; height:14px; border-radius:50%; border:2px solid var(--wx-line2);
        border-top-color:var(--wx-dim); animation:wx-spin .8s linear infinite; }
      .wx-loading-row { display:flex; align-items:center; gap:7px; padding:10px 11px; color:var(--wx-dim); font-size:11.5px; }

      /* commit tab */
      .wx-commit-pane { display:flex; flex-direction:column; gap:13px; padding:10px 10px 16px;
        width:100%; max-width:720px; margin:0 auto; }
      .wx-commit-head { display:flex; align-items:center; gap:8px; min-width:0; }
      .wx-avatar { position:relative; width:36px; height:36px; border-radius:50%; flex:none; display:grid; place-items:center;
        color:var(--wx-dim); font-weight:600; font-size:12px; background:var(--wx-layer2); overflow:hidden; }
      .wx-input { height:30px; padding:0 8px; border:none; border-radius:7px; background:var(--wx-layer2); color:var(--wx-ink); font-size:12px; }
      .wx-input::placeholder, .wx-textarea::placeholder { color:var(--wx-faint); }
      .wx-input:focus-visible, .wx-textarea:focus-visible { outline:none; box-shadow:0 0 0 2px color-mix(in srgb,var(--wx-accent) 36%,transparent); }
      .wx-textarea { padding:7px 8px; border:none; border-radius:7px; background:var(--wx-layer2); color:var(--wx-ink);
        font-size:12px; line-height:1.6; resize:none; min-height:70px; }
      .wx-summary-input { flex:1 1 auto; min-width:0; height:40px; padding:0 12px; border-radius:8px;
        background:var(--wx-layer2); border:1px solid var(--wx-line); font-size:13px; font-weight:500; }
      .wx-summary-input:focus-visible { outline:none; box-shadow:0 0 0 2px color-mix(in srgb,var(--wx-accent) 30%,transparent); border-color:var(--wx-accent); }
      .wx-description { min-height:140px; padding:10px 12px; border-radius:8px; background:var(--wx-layer2);
        border:1px solid var(--wx-line); font-size:13px; line-height:1.65; resize:none; }
      .wx-description:focus-visible { outline:none; box-shadow:0 0 0 2px color-mix(in srgb,var(--wx-accent) 30%,transparent); border-color:var(--wx-accent); }
      .wx-ai-card { display:flex; flex-direction:column; gap:7px; padding:9px; border-radius:10px;
        background:color-mix(in srgb,var(--wx-accent) 5%,var(--wx-layer));
        border:1px solid color-mix(in srgb,var(--wx-accent) 18%,var(--wx-line)); }
      .wx-ai-card-head { display:flex; align-items:center; gap:7px; min-width:0; }
      .wx-ai-label { display:inline-flex; align-items:center; gap:5px; flex:none; color:var(--wx-ink);
        font-size:11px; font-weight:600; white-space:nowrap; }
      .wx-ai-label svg { color:var(--wx-accent); }
      .wx-ai-card-row { display:flex; align-items:center; gap:6px; }
      .wx-hint-input { flex:1 1 90px; min-width:70px; height:28px; padding:0 9px; font-size:11px;
        border:1px solid var(--wx-line); }
      .wx-ai-btn { flex:none; height:28px; padding:0 10px; }
      .wx-ai-card .wx-ai-btn { font-weight:600; }
      .wx-ai-card .wx-ai-btn svg { color:var(--wx-accent-fg); }
      .wx-ai-meta { font-size:10.5px; color:var(--wx-faint); line-height:1.45; overflow:hidden; text-overflow:ellipsis; white-space:nowrap; }
      .wx-commit-tip-line { font-size:10.5px; line-height:1.55; color:var(--wx-faint); }
      .wx-ai-card .wx-ai-meta { padding-top:1px; }
      .wx-commit-meta { display:flex; align-items:center; gap:7px; flex-wrap:wrap; font-size:10.5px; color:var(--wx-faint); }
      .wx-hint-inline { font-size:10px; color:var(--wx-faint); }
      .wx-kbd { font-size:10px; color:var(--wx-faint); white-space:nowrap; }
      .wx-commit-btn { flex:none; width:100%; height:38px; border:none; border-radius:8px; cursor:pointer;
        display:inline-flex; align-items:center; justify-content:center; gap:5px; font-size:13px; font-weight:600;
        background:var(--wx-accent); color:var(--wx-accent-fg); transition:background .12s, opacity .12s; }
      .wx-commit-btn span { min-width:0; overflow:hidden; text-overflow:ellipsis; white-space:nowrap; }
      .wx-commit-btn:hover:not(:disabled) { background:var(--dsw-alias-button-info-hover, var(--wx-accent)); }
      .wx-commit-btn:disabled { opacity:.35; cursor:default; }
      .wx-commit-btn:focus-visible { outline:2px solid var(--wx-accent); outline-offset:2px; }
      .wx-commit-options { display:flex; align-items:center; gap:8px; flex-wrap:wrap; }
      .wx-check-label { display:inline-flex; align-items:center; gap:5px; font-size:10.5px; color:var(--wx-dim); cursor:pointer; white-space:nowrap; }
      .wx-check-label input { width:12px; height:12px; accent-color:var(--wx-accent); cursor:pointer; flex:none; }

      /* history */
      .wx-history-head { position:sticky; top:0; z-index:3; display:flex; align-items:center; gap:6px; padding:7px 8px 6px; background:var(--wx-base); }
      .wx-toggle { display:inline-flex; align-items:center; gap:4px; height:26px; padding:0 7px; border:none; border-radius:7px;
        background:transparent; color:var(--wx-dim); font-size:10.5px; cursor:pointer; white-space:nowrap; }
      .wx-toggle:hover { background:var(--wx-hover); color:var(--wx-ink); }
      .wx-toggle.on { background:var(--wx-layer2); color:var(--wx-ink); font-weight:600; }
      .wx-graph-list { padding:2px 4px 14px; }
      .wx-graph-row { display:flex; align-items:center; gap:6px; height:26px; padding:0 6px; border-radius:7px; cursor:pointer; }
      .wx-graph-row:hover { background:var(--wx-hover); }
      .wx-graph-row.active { background:var(--wx-sel); }
      .wx-graph-svg { flex:none; display:block; }
      .wx-graph-svg line, .wx-graph-svg path { stroke-width:1.7; stroke-linecap:round; fill:none; }
      .wx-graph-svg circle { stroke-width:1.4; }
      .wx-hash { flex:none; font-family:var(--wx-mono-font); font-size:9.5px; color:var(--wx-faint); }
      .wx-refs { display:flex; gap:4px; flex:none; max-width:40%; overflow:hidden; }
      .wx-ref { font-size:9.5px; color:var(--wx-dim); max-width:110px; overflow:hidden; text-overflow:ellipsis; white-space:nowrap; }
      .wx-ref.head { color:var(--wx-ink); font-weight:600; }
      .wx-subject { flex:1 1 auto; min-width:40px; overflow:hidden; text-overflow:ellipsis; white-space:nowrap; font-size:12px; }
      .wx-author { flex:none; max-width:112px; overflow:hidden; text-overflow:ellipsis; white-space:nowrap; font-size:10px; color:var(--wx-faint); }

      /* commit details */
      .wx-commit-card { padding:11px 10px 5px; }
      .wx-commit-subject { font-size:13.5px; font-weight:600; line-height:1.45; }
      .wx-commit-meta { margin-top:3px; font-size:10.5px; color:var(--wx-faint); display:flex; gap:6px; flex-wrap:wrap; }
      .wx-commit-body { margin-top:7px; padding:0 0 6px; font-size:11.5px; line-height:1.65; white-space:pre-wrap; word-break:break-word; color:var(--wx-dim); }

      /* diff */
      .wx-detail-head { position:sticky; top:0; z-index:4; display:flex; align-items:center; gap:5px; flex-wrap:wrap;
        padding:8px 9px; background:var(--wx-base); border-bottom:1px solid var(--wx-line); }
      .wx-detail-title { font-size:10px; font-weight:600; letter-spacing:.04em; text-transform:uppercase; color:var(--wx-faint); flex:none; }
      .wx-detail-path { flex:1 1 auto; min-width:0; overflow:hidden; text-overflow:ellipsis; white-space:nowrap;
        font-family:var(--wx-mono-font); font-size:11px; color:var(--wx-dim); }
      .wx-badge { display:inline-flex; align-items:center; gap:3px; height:18px; padding:0 6px; border-radius:5px;
        background:var(--wx-layer2); color:var(--wx-dim); font-size:10px; font-variant-numeric:tabular-nums; white-space:nowrap; flex:none; }
      .wx-badge.brand { color:var(--wx-ink); font-weight:600; }
      .wx-badge.ok { color:var(--wx-ok); background:color-mix(in srgb,var(--wx-ok) 9%,transparent); }
      .wx-badge.err { color:var(--wx-err); background:color-mix(in srgb,var(--wx-err) 9%,transparent); }
      .wx-badge.warn { color:var(--wx-warn); background:color-mix(in srgb,var(--wx-warn) 10%,transparent); }
      .wx-file-block { border-bottom:1px solid var(--wx-line); }
      .wx-file-head { display:flex; align-items:center; gap:6px; padding:7px 9px; flex-wrap:wrap; }
      .wx-file-status { width:15px; flex:none; font-family:var(--wx-mono-font); font-size:10px; font-weight:700; color:var(--wx-faint); }
      .wx-file-status.a { color:var(--wx-ok); }
      .wx-file-status.d { color:var(--wx-err); }
      .wx-file-status.r { color:var(--wx-warn); }
      .wx-file-old { color:var(--wx-faint); font-size:10.5px; font-family:var(--wx-mono-font); overflow:hidden; text-overflow:ellipsis; white-space:nowrap; max-width:45%; }
      .wx-hunk { margin:8px 9px 0; display:block; max-width:calc(100% - 18px); padding:1px 0;
        font-family:var(--wx-mono-font); font-size:10px; color:var(--wx-faint); white-space:pre-wrap; }
      .wx-hunk-lines { padding:2px 0 7px; overflow-x:auto; font-family:var(--wx-mono-font); font-size:11px; line-height:1.62; }
      .wx-line { display:flex; align-items:baseline; white-space:pre; min-width:max-content; }
      .wx-ln { width:34px; flex:none; text-align:right; padding-right:6px; color:var(--wx-faint);
        opacity:.65; user-select:none; font-variant-numeric:tabular-nums; }
      .wx-sign { width:13px; flex:none; text-align:center; font-weight:700; }
      .wx-lline.add { background:var(--dsw-alias-file-diff-added-bg); }
      .wx-lline.del { background:var(--dsw-alias-file-diff-deleted-bg); }
      .wx-lline.add .wx-ln { background:var(--dsw-alias-file-diff-added-gutter); }
      .wx-lline.del .wx-ln { background:var(--dsw-alias-file-diff-deleted-gutter); }
      .wx-lline.add .wx-sign { color:var(--dsw-alias-file-diff-added-marker); }
      .wx-lline.del .wx-sign { color:var(--dsw-alias-file-diff-deleted-marker); }
      .wx-text { flex:1 1 auto; min-width:0; padding-right:9px; }
      .wx-word { border-radius:2px; padding:0 1px; }
      .wx-word.add { background:color-mix(in srgb, var(--dsw-alias-file-diff-added-marker) 30%, transparent); }
      .wx-word.del { background:color-mix(in srgb, var(--dsw-alias-file-diff-deleted-marker) 30%, transparent); }
      .wx-meta-line { padding:1px 11px; color:var(--wx-faint); font-style:italic; font-size:10.5px; }
      .wx-binary { padding:18px 11px; color:var(--wx-dim); font-size:11.5px; }

      /* branches / stash */
      .wx-branch-group { padding:5px 7px 2px; }
      .wx-group-head { display:flex; align-items:center; gap:5px; padding:7px 3px 3px; font-size:10px; font-weight:600;
        letter-spacing:.04em; text-transform:uppercase; color:var(--wx-faint); }
      .wx-group-count { font-weight:500; letter-spacing:0; color:var(--wx-faint); }
      .wx-branch-row { display:flex; align-items:center; gap:6px; min-height:30px; padding:3px 6px; border-radius:7px; }
      .wx-branch-row:hover { background:var(--wx-hover); }
      .wx-branch-icon { color:var(--wx-faint); flex:none; }
      .wx-bname { flex:0 1 auto; min-width:0; overflow:hidden; text-overflow:ellipsis; white-space:nowrap; font-size:12px; }
      .wx-bmeta { flex:1 1 auto; min-width:0; overflow:hidden; text-overflow:ellipsis; white-space:nowrap; font-size:10px; color:var(--wx-faint); text-align:right; }
      .wx-branch-actions { display:flex; gap:2px; flex:none; opacity:0; }
      .wx-branch-row:hover .wx-branch-actions { opacity:1; }
      @media (hover:none) { .wx-branch-actions { opacity:1; } }
      .wx-branch-form { display:flex; flex-direction:column; gap:6px; padding:6px 8px 8px; }
      .wx-form-row { display:flex; gap:5px; align-items:center; }
      .wx-form-row .wx-input { flex:1 1 0; min-width:0; }
      .wx-branch-form .wx-input { flex:1 1 0; min-width:0; height:30px; }
      .wx-operation-bar { display:flex; align-items:center; gap:6px; flex-wrap:wrap; margin:5px 8px; padding:7px 9px;
        border-radius:8px; font-size:11px; color:var(--wx-ink); background:color-mix(in srgb,var(--wx-warn) 9%,transparent); }
      .wx-operation-bar svg { color:var(--wx-warn); flex:none; }

      /* quiet status: only rendered while busy or after an action */
      .wx-status { flex:none; display:flex; align-items:center; gap:6px; padding:5px 10px 6px; font-size:10.5px; color:var(--wx-dim); }
      .wx-status-dot { width:6px; height:6px; border-radius:50%; flex:none; background:var(--wx-dim); }
      .wx-status-dot.ok { background:var(--wx-ok); }
      .wx-status-dot.err { background:var(--wx-err); }
      .wx-status-dot.warn { background:var(--wx-warn); }
      .wx-status-dot.busy { background:var(--wx-accent); animation:wx-pulse 1.1s infinite; }
      .wx-status-msg { flex:1 1 auto; min-width:0; overflow:hidden; text-overflow:ellipsis; white-space:nowrap; }
      .wx-status-msg.err { color:var(--wx-err); }
      .wx-status-msg.warn { color:var(--wx-warn); }
      .wx-status-msg.ok { color:var(--wx-ok); }
      .wx-status-close { border:none; background:transparent; color:var(--wx-faint); cursor:pointer; padding:0 2px; flex:none; }
      .wx-status-close:hover { color:var(--wx-ink); }

      /* modal */
      .wx-mask { position:absolute; inset:0; z-index:80; display:flex; align-items:center; justify-content:center; padding:12px;
        background:color-mix(in srgb,var(--wx-base) 58%,transparent);
        -webkit-backdrop-filter:blur(3px); backdrop-filter:blur(3px); animation:wx-fade .14s ease; }
      .wx-modal { width:min(100%, 430px); max-height:calc(100% - 8px); overflow:auto; display:flex; flex-direction:column; gap:10px;
        padding:14px; border-radius:12px; background:var(--wx-layer); border:1px solid var(--wx-line2);
        box-shadow:0 18px 44px color-mix(in srgb,#000 22%,transparent); animation:wx-pop .16s ease; }
      .wx-modal.wide { width:min(100%, 560px); }
      .wx-modal-head { display:flex; align-items:center; gap:6px; }
      .wx-modal-title { font-size:13px; font-weight:600; flex:1 1 auto; min-width:0; }
      .wx-field { display:flex; flex-direction:column; gap:4px; }
      .wx-field-label { font-size:10px; font-weight:600; letter-spacing:.04em; text-transform:uppercase; color:var(--wx-faint); }
      .wx-modal .wx-select { width:100%; height:30px; padding:0 22px 0 8px; border:1px solid var(--wx-line); border-radius:7px;
        background-color:var(--wx-layer2); color:var(--wx-ink); font-size:11.5px; cursor:pointer; appearance:none;
        background-image:linear-gradient(45deg,transparent 50%,var(--wx-faint) 50%),linear-gradient(135deg,var(--wx-faint) 50%,transparent 50%);
        background-position:calc(100% - 12px) 12px, calc(100% - 8px) 12px; background-size:4px 4px,4px 4px; background-repeat:no-repeat; }
      .wx-modal .wx-input { height:30px; background:var(--wx-layer2); border:1px solid var(--wx-line); border-radius:7px; padding:0 8px; }
      .wx-modal .wx-textarea { background:var(--wx-layer2); border:1px solid var(--wx-line); border-radius:7px; padding:7px 8px; min-height:90px; }
      .wx-modal .wx-input:focus-visible, .wx-modal .wx-textarea:focus-visible { border-color:var(--wx-accent); box-shadow:0 0 0 2px color-mix(in srgb,var(--wx-accent) 30%,transparent); }
      .wx-modal-actions { display:flex; align-items:center; justify-content:flex-end; gap:6px; flex-wrap:wrap; }
      .wx-section-title { font-size:10px; font-weight:600; letter-spacing:.05em; text-transform:uppercase; color:var(--wx-faint); }
      .wx-hint { font-size:10.5px; color:var(--wx-faint); line-height:1.55; }
      .wx-switch { display:flex; align-items:flex-start; gap:7px; font-size:11.5px; color:var(--wx-ink); cursor:pointer; }
      .wx-switch input { width:13px; height:13px; accent-color:var(--wx-accent); margin-top:1px; flex:none; }
      .wx-conflict-path { font-family:var(--wx-mono-font); font-size:11.5px; font-weight:600; word-break:break-all; }
      .wx-conflict-note { font-size:11px; color:var(--wx-dim); line-height:1.55; }
      .wx-preview { border:none; border-radius:7px; background:var(--wx-layer2); max-height:42vh; overflow:auto; padding:5px 0; }
      .wx-preview-line { display:flex; gap:7px; font-family:var(--wx-mono-font); font-size:11px; line-height:1.6; white-space:pre-wrap; word-break:break-word; padding:0 8px; }
      .wx-preview-no { width:30px; text-align:right; color:var(--wx-faint); flex:none; user-select:none; }
      .wx-ai-busy { position:relative; overflow:hidden; }
      .wx-ai-busy::after { content:''; position:absolute; inset:0; background:linear-gradient(110deg,transparent 20%,color-mix(in srgb,var(--wx-ink) 10%,transparent) 50%,transparent 80%); transform:translateX(-100%); animation:wx-shimmer 1.2s linear infinite; }

      /* header entry button */
      .wx-header-btn { display:inline-flex; align-items:center; justify-content:center; width:26px; height:26px; padding:0;
        border:none; border-radius:8px; background:transparent; cursor:pointer; color:var(--dsw-alias-label-secondary);
        transition:background .14s, color .14s; }
      .wx-header-btn:hover { background:var(--dsw-alias-interactive-bg-hover); color:var(--dsw-alias-label-primary); }
      .wx-header-btn:focus-visible { outline:2px solid var(--dsw-alias-state-business-primary); outline-offset:1px; }
      .wx-header-btn svg { display:block; }

      @keyframes wx-fade { from { opacity:0; } to { opacity:1; } }
      @keyframes wx-pop { from { opacity:0; transform:translateY(3px); } to { opacity:1; transform:none; } }
      @keyframes wx-spin { to { transform:rotate(360deg); } }
      @keyframes wx-pulse { 50% { opacity:.35; } }
      @keyframes wx-shimmer { to { transform:translateX(100%); } }

      @container wx (max-width: 430px) {
        .wx-author { display:none; }
        .wx-cell { height:44px; padding:0 9px; gap:6px; }
        .wx-branch-cell { flex:1 1 42%; }
        .wx-sync-cell { flex:1 1 58%; min-width:118px; }
        .wx-sync-badge { min-width:30px; height:18px; padding:0 6px; font-size:10px; gap:2px; }
        .wx-repo { max-width:50%; }
      }
    `

    function tr(key, params) {
      if (!localeT) return key
      try {
        return localeT(key, params)
      } catch {
        return key
      }
    }

    var localeT = null

    // ---------------------------------------------------------------- icons

    var ICONS = {
      git: ['M7 4v9', 'M7 19m-2.6 0a2.6 2.6 0 1 0 5.2 0a2.6 2.6 0 1 0-5.2 0', 'M18 6m-2.6 0a2.6 2.6 0 1 0 5.2 0a2.6 2.6 0 1 0-5.2 0', 'M18 8.4v1.2A5.4 5.4 0 0 1 12.6 15H9.4'],
      sync: ['M20 7h-5V2', 'M4 17h5v5', 'M20 7a9 9 0 0 0-15-2', 'M4 17a9 9 0 0 0 15 2'],
      fetch: ['M23 4v6h-6', 'M20.49 15a9 9 0 1 1-2.12-9.36L23 10'],
      pull: ['M12 5v14', 'M6 13l6 6 6-6'],
      push: ['M12 19V5', 'M6 11l6-6 6 6'],
      refresh: ['M20 11a8 8 0 1 0-2.3 5.7', 'M20 4v7h-7'],
      plus: ['M12 5v14', 'M5 12h14'],
      minus: ['M5 12h14'],
      check: ['M5 12l4.5 4.5L19 7'],
      trash: ['M4 7h16', 'M9 7V4h6v3', 'M6 7l1 14h10l1-14', 'M10 11v6', 'M14 11v6'],
      gear: ['M12 15.2a3.2 3.2 0 1 0 0-6.4 3.2 3.2 0 0 0 0 6.4z', 'M19.4 15a1.7 1.7 0 0 0 .34 1.88l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.7 1.7 0 0 0-1.88-.34 1.7 1.7 0 0 0-1.03 1.56V21a2 2 0 1 1-4 0v-.11a1.7 1.7 0 0 0-1.11-1.56 1.7 1.7 0 0 0-1.88.34l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06A1.7 1.7 0 0 0 4.7 15a1.7 1.7 0 0 0-1.56-1.03H3a2 2 0 1 1 0-4h.11A1.7 1.7 0 0 0 4.7 8.86a1.7 1.7 0 0 0-.34-1.88l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06A1.7 1.7 0 0 0 9.07 4.5 1.7 1.7 0 0 0 10.1 2.94V3a2 2 0 1 1 4 0v.11a1.7 1.7 0 0 0 1.03 1.56 1.7 1.7 0 0 0 1.88-.34l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06a1.7 1.7 0 0 0-.34 1.88V9a1.7 1.7 0 0 0 1.56 1.03H21a2 2 0 1 1 0 4h-.11a1.7 1.7 0 0 0-1.49 1.03z'],
      sparkle: ['M12 3l1.8 4.9L18.7 9l-4.9 1.8L12 15.7l-1.8-4.9L5.3 9l4.9-1.8z', 'M18.6 15l.8 2.2 2.2.8-2.2.8-.8 2.2-.8-2.2-2.2-.8 2.2-.8z'],
      close: ['M6 6l12 12', 'M18 6L6 18'],
      branch: ['M7 4v9', 'M7 19m-2.6 0a2.6 2.6 0 1 0 5.2 0a2.6 2.6 0 1 0-5.2 0', 'M18 6m-2.6 0a2.6 2.6 0 1 0 5.2 0a2.6 2.6 0 1 0-5.2 0', 'M18 8.4v1.2A5.4 5.4 0 0 1 12.6 15H9.4'],
      history: ['M3 12a9 9 0 1 0 3-6.7', 'M3 4v5h5', 'M12 8v5l3 2'],
      file: ['M6 3h8l4 4v14H6z', 'M14 3v5h5'],
      stash: ['M4 5h16v4H4z', 'M6 9v10h12V9', 'M10 13h4'],
      warning: ['M12 3l9 17H3z', 'M12 9v5', 'M12 17h.01'],
      merge: ['M7 4v9', 'M7 19m-2.6 0a2.6 2.6 0 1 0 5.2 0a2.6 2.6 0 1 0-5.2 0', 'M18 6m-2.6 0a2.6 2.6 0 1 0 5.2 0a2.6 2.6 0 1 0-5.2 0', 'M18 8.4v1.2A5.4 5.4 0 0 1 12.6 15H8'],
      arrow: ['M5 12h14', 'M13 6l6 6-6 6'],
      chevron: ['M6 9l6 6 6-6'],
    }

    function Icon(props) {
      var paths = ICONS[props.name]
      if (!paths) return null
      var size = props.size || 13
      return h('svg', {
        width: size, height: size, viewBox: '0 0 24 24', fill: 'none',
        stroke: 'currentColor', strokeWidth: props.strokeWidth || 1.8,
        strokeLinecap: 'round', strokeLinejoin: 'round', 'aria-hidden': 'true', focusable: 'false',
        className: props.className,
      }, paths.map(function (d, index) { return h('path', { key: index, d: d }) }))
    }

    function GitMark(props) {
      var size = props.size || 17
      return h('svg', {
        width: size, height: size, viewBox: '0 0 24 24', fill: 'none',
        stroke: 'currentColor', strokeWidth: 1.8, strokeLinecap: 'round', strokeLinejoin: 'round',
        'aria-hidden': 'true', focusable: 'false',
      },
        h('path', { d: 'M7 4v9' }),
        h('circle', { cx: 7, cy: 19, r: 2.6 }),
        h('circle', { cx: 18, cy: 6, r: 2.6 }),
        h('path', { d: 'M18 8.4v1.2A5.4 5.4 0 0 1 12.6 15H9.4' }))
    }

    function BrandMark(props) {
      var size = props && props.size ? props.size : 18
      return h('svg', {
        width: size, height: size, viewBox: '0 0 16 16',
        'aria-hidden': 'true', focusable: 'false',
      },
        h('path', {
          d: 'M3 5.5H5L6.3 9L7.6 5.8H9.2L10.6 9L11.4 7.1L13.4 6.2L11 12.4H9L8.2 9.5L7.2 12.4H5.2Z',
          fill: 'currentColor',
        }),
        h('path', {
          d: 'M11.8 3.8L14 3.1L13.6 4.9L10.9 6.1Z',
          fill: 'currentColor',
        }))
    }

    function Spinner() {
      return h('span', { className: 'wx-spinner', role: 'status', 'aria-label': 'loading' })
    }

    function Btn(props) {
      var className = 'wx-btn'
      if (props.variant === 'primary') className += ' primary'
      else if (props.variant === 'ghost' || props.ghost) className += ' ghost'
      if (props.icon && !props.label) className += ' icon'
      if (props.small) className += ' sm'
      if (props.danger) className += ' danger'
      if (props.className) className += ' ' + props.className
      return h('button', {
        type: 'button',
        className: className,
        title: props.title || props.label || undefined,
        'aria-label': props.title || props.label || undefined,
        disabled: !!props.disabled,
        onClick: props.disabled ? undefined : props.onClick,
        onKeyDown: props.onKeyDown,
      },
        props.icon ? h(Icon, { name: props.icon, size: props.small ? 11 : 13 }) : null,
        props.label ? h('span', { className: 'wx-btn-label' }, props.label) : null)
    }

    // ---------------------------------------------------------------- helpers

    function persist(key, value) {
      try {
        var target = typeof window !== 'undefined' ? window.localStorage : null
        if (!target) return
        if (value === null || value === undefined) target.removeItem(key)
        else target.setItem(key, JSON.stringify(value))
      } catch {
        // ignore storage failures
      }
    }

    function restore(key, fallback) {
      try {
        var target = typeof window !== 'undefined' ? window.localStorage : null
        if (!target) return fallback
        var raw = target.getItem(key)
        if (raw === null) return fallback
        return JSON.parse(raw)
      } catch {
        return fallback
      }
    }

    function defaultAiConfig() {
      var saved = restore(STORE_AI, null)
      if (!saved || typeof saved !== 'object') return { provider: '', model: '', effort: 'auto' }
      return {
        provider: typeof saved.provider === 'string' ? saved.provider : '',
        model: typeof saved.model === 'string' ? saved.model : '',
        effort: typeof saved.effort === 'string' ? saved.effort : 'auto',
      }
    }

    function statusLetter(group, entry) {
      if (group === 'untracked') return '?'
      var code = String(entry.status || '?').slice(0, 1)
      return code || '?'
    }

    function changePaths(status) {
      if (!status) return []
      var seen = {}
      ;['staged', 'unstaged', 'untracked', 'conflicted'].forEach(function (group) {
        var entries = status[group] || []
        for (var index = 0; index < entries.length; index += 1) {
          if (entries[index] && entries[index].path) seen[entries[index].path] = true
        }
      })
      return Object.keys(seen)
    }

    function changeCount(status) {
      return changePaths(status).length
    }

    /** Collapse the four status groups into one row per repository path. */
    function collectChanges(status) {
      if (!status) return []
      var map = {}
      function add(entry, group) {
        if (!entry || !entry.path || entry.path === '') return
        var item = map[entry.path]
        if (!item) {
          item = {
            path: entry.path,
            oldPath: entry.oldPath || null,
            indexStatus: '.',
            worktreeStatus: '.',
            staged: false,
            unstaged: false,
            untracked: false,
            conflicted: false,
            conflictStatus: null,
          }
          map[entry.path] = item
        }
        if (entry.oldPath) item.oldPath = entry.oldPath
        if (group === 'conflicted') {
          item.conflicted = true
          item.conflictStatus = entry.status || 'UU'
        } else if (group === 'untracked') {
          item.untracked = true
        } else {
          if (group === 'staged') {
            item.staged = true
            item.indexStatus = entry.status || entry.x || '.'
          } else {
            item.unstaged = true
            item.worktreeStatus = entry.status || entry.y || '.'
          }
        }
      }
      ;['conflicted', 'staged', 'unstaged', 'untracked'].forEach(function (group) {
        var entries = status[group] || []
        for (var index = 0; index < entries.length; index += 1) add(entries[index], group)
      })
      var rows = Object.keys(map).map(function (path) { return map[path] })
      rows.forEach(function (item) {
        item.status = item.conflicted
          ? item.conflictStatus
          : item.untracked
            ? '?'
            : item.worktreeStatus !== '.' ? item.worktreeStatus : item.indexStatus
      })
      rows.sort(function (left, right) {
        if (left.conflicted !== right.conflicted) return left.conflicted ? -1 : 1
        return left.path.localeCompare(right.path)
      })
      return rows
    }

    function selectedEntriesOf(state) {
      if (!state.snapshot || !state.snapshot.status) return []
      var excluded = state.excluded || []
      return collectChanges(state.snapshot.status).filter(function (entry) {
        return !entry.conflicted && excluded.indexOf(entry.path) === -1
      })
    }

    function stagePathsOf(entries) {
      var set = {}
      entries.forEach(function (entry) {
        if (entry.path) set[entry.path] = true
        if (entry.oldPath) set[entry.oldPath] = true
      })
      return Object.keys(set)
    }

    function statusClass(group, entry) {
      if (group === 'conflicted') return 'wx-stat u'
      if (group === 'untracked') return 'wx-stat q'
      var code = String(entry.status || '?').slice(0, 1)
      if (code === 'A' || code === 'R' || code === 'C') return 'wx-stat a'
      if (code === 'D' || code === 'U') return 'wx-stat d'
      return 'wx-stat m'
    }

    function pathParts(path) {
      var value = String(path || '')
      var slash = value.lastIndexOf('/')
      if (slash < 0) return { dir: '', base: value }
      return { dir: value.slice(0, slash + 1), base: value.slice(slash + 1) }
    }

    function relativeLabel(timestamp) {
      if (!timestamp) return tr('top.neverFetched')
      var seconds = Math.max(0, Math.round((Date.now() - timestamp) / 1000))
      if (seconds < 45) return tr('top.justNow')
      var minutes = Math.round(seconds / 60)
      if (minutes < 60) return tr('top.minutesAgo', { n: minutes })
      var hours = Math.round(minutes / 60)
      if (hours < 24) return tr('top.hoursAgo', { n: hours })
      return tr('top.daysAgo', { n: Math.round(hours / 24) })
    }

    function makeError(message, code) {
      var error = new Error(message)
      error.code = code || 'internal'
      return error
    }

    // ---------------------------------------------------------------- RPC

    async function rpc(op, params) {
      var response
      try {
        response = await fetch(RPC, {
          method: 'POST',
          credentials: 'same-origin',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify(Object.assign({ op: op }, params || {})),
        })
      } catch (error) {
        throw makeError(tr('error.transport') + '：' + (error && error.message ? error.message : error), 'transport')
      }
      var body
      try {
        body = await response.json()
      } catch {
        throw makeError(tr('error.badResponse') + ' (HTTP ' + response.status + ')', 'bad-response')
      }
      if (!body || body.ok !== true) {
        var failure = body && body.error ? body.error : {}
        var shaped = makeError(failure.message || tr('error.title'), failure.code || 'internal')
        shaped.data = failure.data
        throw shaped
      }
      return body.data
    }

    // ---------------------------------------------------------------- store

    function createStore(initial) {
      var state = initial
      var listeners = []
      return {
        get: function () { return state },
        set: function (patch) {
          var next = typeof patch === 'function' ? patch(state) : patch
          var merged = Object.assign({}, state, next)
          if (merged === state) return
          state = merged
          for (var index = 0; index < listeners.length; index += 1) listeners[index]()
        },
        subscribe: function (listener) {
          listeners.push(listener)
          return function () {
            listeners = listeners.filter(function (item) { return item !== listener })
          }
        },
      }
    }

    function useStore(store) {
      var pair = useState(store.get())
      useEffect(function () {
        var unsubscribe = store.subscribe(function () { pair[1](store.get()) })
        pair[1](store.get())
        return unsubscribe
      }, [store])
      return pair[0]
    }

    function useSessionById(sessions, sessionId) {
      var pair = useState(null)
      useEffect(function () {
        if (!sessions || !sessionId) {
          pair[1](null)
          return undefined
        }
        var read = function () { pair[1](sessions.list.getSnapshot().byId[sessionId] || null) }
        read()
        return sessions.list.subscribe(read)
      }, [sessions, sessionId])
      return pair[0]
    }

    // ------------------------------------------------------------- controller

    function findModel(catalog, provider, model) {
      var groups = catalog && catalog.groups ? catalog.groups : []
      for (var index = 0; index < groups.length; index += 1) {
        if (groups[index].id !== provider) continue
        var models = groups[index].models || []
        for (var m = 0; m < models.length; m += 1) if (models[m].id === model) return models[m]
      }
      return null
    }

    function effortChoices(model) {
      var efforts = model && model.reasoning && model.reasoning.efforts ? model.reasoning.efforts : []
      return efforts
    }

    function effortLabel(id, name) {
      if (id === 'none' || id === 'off') return tr('ai.effortNone')
      if (id === 'low') return tr('ai.effortLow')
      if (id === 'medium') return tr('ai.effortMedium')
      if (id === 'high') return tr('ai.effortHigh')
      if (id === 'xhigh' || id === 'max') return tr('ai.effortMax')
      return name || id
    }

    function createController() {
      var initialAi = defaultAiConfig()
      var store = createStore({
        cwd: null,
        sessionId: null,
        snapshot: null,
        graph: null,
        graphAll: true,
        loading: false,
        graphLoading: false,
        error: null,
        errorCode: null,
        busy: null,
        toast: null,
        toastKind: 'ok',
        lastOutput: null,
        activeTab: 'commit',
        excluded: [],
        selected: null,
        diff: null,
        diffLoading: false,
        commitInfo: null,
        commitInfoLoading: false,
        filter: '',
        graphFilter: '',
        branchFilter: '',
        subject: '',
        body: '',
        aiHint: '',
        aiConfig: { provider: initialAi.provider, model: initialAi.model, effort: initialAi.effort },
        aiGenerating: false,
        modelCatalog: null,
        modelCatalogLoading: false,
        aiModel: null,
        aiFallback: false,
        aiWarning: '',
        pushAfter: restore(STORE_PUSH, false) === true,
        autoStash: restore(STORE_STASH, true) !== false,
        autoResolveConflicts: restore(STORE_AUTO_RESOLVE, false) === true,
        settingsOpen: false,
        stashMessage: '',
        newBranchOpen: false,
        newBranchName: '',
        newBranchFrom: '',
        conflict: null,
        conflictHint: '',
        aiResolveProgress: null,
        aiResolveFailures: [],
        lastFetchedAt: null,
      })
      var toastTimer = null
      var snapshotToken = 0
      var graphToken = 0
      var graphLoadedAt = 0
      var diffToken = 0
      var infoToken = 0

      function set(patch) { store.set(patch) }

      function toast(kind, text, output) {
        if (toastTimer) clearTimeout(toastTimer)
        set({
          toast: text,
          toastKind: kind,
          lastOutput: output === undefined ? store.get().lastOutput : (output || ''),
          error: null,
          errorCode: null,
        })
        toastTimer = setTimeout(function () {
          toastTimer = null
          set({ toast: null })
        }, kind === 'error' ? 13000 : 6500)
      }

      function clearToast() {
        if (toastTimer) clearTimeout(toastTimer)
        toastTimer = null
        set({ toast: null, error: null, errorCode: null })
      }

      async function loadSnapshot(cwd) {
        var token = ++snapshotToken
        set({ loading: store.get().snapshot === null, error: null, errorCode: null })
        try {
          var data = await rpc('snapshot', { cwd: cwd })
          if (token !== snapshotToken || cwd !== store.get().cwd) return
          var patch = { snapshot: data, loading: false }
          if (data && data.status) {
            var rows = collectChanges(data.status)
            var paths = rows.map(function (entry) { return entry.path })
            var kept = (store.get().excluded || []).filter(function (path) { return paths.indexOf(path) !== -1 })
            if (kept.length !== (store.get().excluded || []).length) patch.excluded = kept
            var selected = store.get().selected
            if (selected && selected.kind === 'file') {
              var current = null
              for (var index = 0; index < rows.length; index += 1) {
                if (rows[index].path === selected.path) { current = rows[index]; break }
              }
              var conflictGone = selected.group === 'conflicted' && (!current || !current.conflicted)
              if (!current || conflictGone) {
                patch.selected = null
                patch.diff = null
                patch.diffLoading = false
                patch.commitInfo = null
                if (store.get().activeTab === 'diff') patch.activeTab = 'changes'
              }
            }
          }
          set(patch)
        } catch (error) {
          if (token !== snapshotToken || cwd !== store.get().cwd) return
          set({ loading: false, error: error.message, errorCode: error.code || null })
        }
      }

      async function loadGraph(cwd) {
        if (!cwd) return
        var token = ++graphToken
        set({ graphLoading: true })
        try {
          var data = await rpc('graph', { cwd: cwd, all: store.get().graphAll, limit: 140 })
          if (token !== graphToken || cwd !== store.get().cwd) return
          graphLoadedAt = Date.now()
          set({ graph: data, graphLoading: false })
        } catch (error) {
          if (token !== graphToken || cwd !== store.get().cwd) return
          set({ graphLoading: false, graph: { commits: [] } })
        }
      }

      async function loadModels(force) {
        if (store.get().modelCatalogLoading) return
        var state = store.get()
        set({ modelCatalogLoading: true })
        try {
          var data = await rpc('models', {
            cwd: state.cwd || undefined,
            sessionId: state.sessionId || undefined,
            force: force === true,
          })
          var config = store.get().aiConfig
          var warning = ''
          if (config.provider && config.model && !findModel(data, config.provider, config.model)) {
            warning = tr('settings.modelsFailed', { message: config.provider + '/' + config.model })
            config = { provider: '', model: '', effort: 'auto' }
          }
          if (config.provider && config.model) {
            var model = findModel(data, config.provider, config.model)
            var efforts = effortChoices(model).map(function (effort) { return effort.id })
            if (config.effort !== 'auto' && config.effort !== 'default' && efforts.length > 0 && efforts.indexOf(config.effort) === -1) {
              config = { provider: config.provider, model: config.model, effort: 'auto' }
            }
          } else if (config.effort !== 'auto' && config.effort !== 'default') {
            var defaultEfforts = data && data.default && Array.isArray(data.default.efforts) ? data.default.efforts : []
            if (defaultEfforts.length > 0 && defaultEfforts.indexOf(config.effort) === -1) {
              config = { provider: '', model: '', effort: 'auto' }
            }
          }
          set({ modelCatalog: data, modelCatalogLoading: false, aiConfig: config, aiWarning: warning })
          persist(STORE_AI, config)
        } catch (error) {
          set({
            modelCatalogLoading: false,
            modelCatalog: { groups: [], failures: [], unavailable: true, default: null },
            aiWarning: error.message || tr('ai.unavailable'),
          })
        }
      }

      async function refresh() {
        var cwd = store.get().cwd
        if (!cwd) return
        await Promise.all([loadSnapshot(cwd), loadGraph(cwd)])
      }

      async function refreshSoft() {
        var state = store.get()
        if (!state.cwd || state.busy) return
        await loadSnapshot(state.cwd)
        // Keep history reasonably fresh without rebuilding the graph every poll.
        if (Date.now() - graphLoadedAt > 15000) await loadGraph(state.cwd)
      }

      function resetSessionState(cwd, sessionId) {
        set({
          cwd: cwd,
          sessionId: sessionId,
          snapshot: null,
          graph: null,
          loading: !!cwd,
          graphLoading: false,
          error: null,
          errorCode: null,
          activeTab: 'commit',
          excluded: [],
          selected: null,
          diff: null,
          diffLoading: false,
          commitInfo: null,
          commitInfoLoading: false,
          filter: '',
          graphFilter: '',
          branchFilter: '',
          subject: '',
          body: '',
          aiHint: '',
          aiModel: null,
          aiFallback: false,
          aiWarning: '',
          aiGenerating: false,
          busy: null,
          toast: null,
          lastOutput: null,
          settingsOpen: false,
          stashMessage: '',
          newBranchOpen: false,
          newBranchName: '',
          newBranchFrom: '',
          conflict: null,
          conflictHint: '',
          aiResolveProgress: null,
          aiResolveFailures: [],
          lastFetchedAt: null,
        })
      }

      function attach(cwd, sessionId) {
        var state = store.get()
        if (cwd === state.cwd && sessionId === state.sessionId) {
          if (cwd && !state.snapshot && !state.loading) void refresh()
          return
        }
        if (cwd !== state.cwd) {
          graphLoadedAt = 0
          resetSessionState(cwd, sessionId)
          if (cwd) {
            void refresh()
            void loadModels()
          }
          return
        }
        set({
          sessionId: sessionId,
          subject: '',
          body: '',
          aiModel: null,
          aiFallback: false,
          aiWarning: '',
        })
        if (sessionId) void loadModels()
      }

      async function loadDiff(target) {
        var cwd = store.get().cwd
        if (!cwd || !target) return
        var token = ++diffToken
        set({ diffLoading: true, error: null, errorCode: null })
        try {
          var params = { cwd: cwd }
          if (target.kind === 'commit') {
            params.mode = 'commit'
            params.hash = target.hash
          } else {
            params.mode = target.mode
            params.path = target.path
          }
          var data = await rpc('diff', params)
          var current = store.get().selected
          if (token !== diffToken || !current || current.kind !== target.kind
            || current.path !== target.path || current.hash !== target.hash) return
          set({ diff: data, diffLoading: false })
        } catch (error) {
          if (token !== diffToken) return
          set({ diffLoading: false, diff: null, error: error.message, errorCode: error.code || null })
        }
      }

      async function loadCommitInfo(hash) {
        var cwd = store.get().cwd
        if (!cwd || !hash) return
        var token = ++infoToken
        set({ commitInfoLoading: true, commitInfo: null })
        try {
          var data = await rpc('commitInfo', { cwd: cwd, hash: hash })
          var current = store.get().selected
          if (token !== infoToken || !current || current.hash !== hash) return
          set({ commitInfo: data, commitInfoLoading: false })
        } catch {
          if (token !== infoToken) return
          set({ commitInfoLoading: false })
        }
      }

      function setTab(tab) {
        set({ activeTab: tab })
      }

      function setFilter(value) { set({ filter: String(value || '') }) }
      function setGraphFilter(value) { set({ graphFilter: String(value || '') }) }
      function setBranchFilter(value) { set({ branchFilter: String(value || '') }) }

      function setGraphAll(value) {
        set({ graphAll: !!value })
        void loadGraph(store.get().cwd)
      }

      async function selectFile(group, entry) {
        var mode = group === 'staged' ? 'staged' : group === 'untracked' ? 'untracked' : 'worktree'
        var target = { kind: 'file', group: group, path: entry.path, oldPath: entry.oldPath || null, mode: mode }
        set({ selected: target, diff: null, commitInfo: null, diffLoading: true, activeTab: 'diff' })
        await loadDiff(target)
      }

      async function selectCommit(row) {
        if (!row || !row.full) return
        var target = { kind: 'commit', hash: row.full, short: row.short || row.full.slice(0, 7), path: '' }
        set({ selected: target, diff: null, commitInfo: null, diffLoading: true, activeTab: 'diff' })
        await Promise.all([loadDiff(target), loadCommitInfo(row.full)])
      }

      function toggleSelected(path) {
        var state = store.get()
        var excluded = (state.excluded || []).slice()
        var index = excluded.indexOf(path)
        if (index === -1) excluded.push(path)
        else excluded.splice(index, 1)
        set({ excluded: excluded })
      }

      function selectAllChanges() {
        set({ excluded: [] })
      }

      function clearSelection() {
        set({ selected: null, diff: null, commitInfo: null })
      }

      async function runBusy(label, operation) {
        if (store.get().busy) return null
        set({ busy: label, error: null, errorCode: null })
        try {
          var result = await operation()
          set({ busy: null })
          return result
        } catch (error) {
          set({ busy: null, error: error.message, errorCode: error.code || null })
          toast('error', error.message)
          return null
        }
      }

      async function discard(requestedMode, entry) {
        var cwd = store.get().cwd
        if (!cwd || !entry || !entry.path) return
        var mode = requestedMode === 'untracked' ? 'untracked' : requestedMode === 'all' ? 'all' : 'worktree'
        var key = mode === 'untracked'
          ? 'changes.discardUntrackedConfirm'
          : mode === 'all' ? 'changes.discardStagedConfirm' : 'changes.discardConfirm'
        if (typeof window !== 'undefined' && typeof window.confirm === 'function') {
          if (!window.confirm(tr(key, { path: entry.path }))) return
        }
        var result = await runBusy('discard', function () {
          return rpc('discard', { cwd: cwd, paths: [entry.path], mode: mode })
        })
        if (result !== null) {
          toast('ok', tr('status.discarded', { path: entry.path }), result.output)
          var selected = store.get().selected
          if (selected && selected.kind === 'file' && selected.path === entry.path) clearSelection()
          set({ excluded: (store.get().excluded || []).filter(function (path) { return path !== entry.path }) })
          await loadSnapshot(cwd)
        }
      }

      async function switchBranch(name) {
        var cwd = store.get().cwd
        if (!cwd || !name) return
        var result = await runBusy('switch', function () {
          return rpc('switchBranch', { cwd: cwd, name: name })
        })
        if (result === null) return
        set({ activeTab: 'commit', selected: null, diff: null, commitInfo: null })
        toast('ok', tr('status.switched', { branch: result.branch || name }), result.output)
        await refresh()
      }

      async function createBranch() {
        var state = store.get()
        var cwd = state.cwd
        var name = String(state.newBranchName || '').trim()
        if (!cwd || name === '') return
        var params = { cwd: cwd, name: name }
        if (String(state.newBranchFrom || '').trim() !== '') params.from = String(state.newBranchFrom).trim()
        var result = await runBusy('create', function () { return rpc('createBranch', params) })
        if (result === null) return
        set({ newBranchOpen: false, newBranchName: '', newBranchFrom: '', activeTab: 'commit' })
        toast('ok', tr('status.created', { branch: result.branch || name }), result.output)
        await refresh()
      }

      async function deleteBranch(name) {
        var cwd = store.get().cwd
        if (!cwd || !name) return
        if (typeof window !== 'undefined' && typeof window.confirm === 'function') {
          if (!window.confirm(tr('branches.deleteConfirm', { branch: name }))) return
        }
        var result = await runBusy('delete', function () {
          return rpc('deleteBranch', { cwd: cwd, name: name })
        })
        if (result !== null) {
          toast('ok', tr('status.deleted', { branch: name }), result.output)
          await refresh()
        }
      }

      function setNewBranch(open) { set({ newBranchOpen: !!open, newBranchName: '', newBranchFrom: '' }) }
      function setNewBranchName(value) { set({ newBranchName: String(value || '') }) }
      function setNewBranchFrom(value) { set({ newBranchFrom: String(value || '') }) }
      function setStashMessage(value) { set({ stashMessage: String(value || '') }) }

      async function stashSave() {
        var state = store.get()
        var cwd = state.cwd
        if (!cwd) return
        var params = { cwd: cwd, includeUntracked: true }
        var message = String(state.stashMessage || '').trim()
        if (message !== '') params.message = message
        var result = await runBusy('stash', function () { return rpc('stashPush', params) })
        if (result !== null) {
          set({ stashMessage: '' })
          toast('ok', tr('status.stashed'), result.output)
          await loadSnapshot(cwd)
        }
      }

      async function stashPop(index) {
        var cwd = store.get().cwd
        if (!cwd) return
        if (typeof window !== 'undefined' && typeof window.confirm === 'function') {
          if (!window.confirm(tr('stash.popConfirm', { n: index }))) return
        }
        var result = await runBusy('stash', function () { return rpc('stashPop', { cwd: cwd, index: index }) })
        if (result !== null) {
          toast('ok', tr('status.stashPopped', { n: index }), result.output)
          await loadSnapshot(cwd)
        }
      }

      async function stashDrop(index) {
        var cwd = store.get().cwd
        if (!cwd) return
        if (typeof window !== 'undefined' && typeof window.confirm === 'function') {
          if (!window.confirm(tr('stash.dropConfirm', { n: index }))) return
        }
        var result = await runBusy('stash', function () { return rpc('stashDrop', { cwd: cwd, index: index }) })
        if (result !== null) {
          toast('ok', tr('status.stashDropped', { n: index }), result.output)
          await loadSnapshot(cwd)
        }
      }

      function setSubject(value) { set({ subject: String(value || '') }) }
      function setBody(value) { set({ body: String(value || '') }) }
      function setAiHint(value) { set({ aiHint: String(value || '') }) }

      function setAiConfig(config) {
        var next = {
          provider: typeof config.provider === 'string' ? config.provider : '',
          model: typeof config.model === 'string' ? config.model : '',
          effort: typeof config.effort === 'string' ? config.effort : 'auto',
        }
        set({ aiConfig: next, aiWarning: '' })
        persist(STORE_AI, next)
      }

      function aiParams(state) {
        var params = {
          cwd: state.cwd,
          sessionId: state.sessionId || undefined,
          hint: String(state.aiHint || ''),
        }
        if (state.aiConfig.provider && state.aiConfig.model) {
          params.selection = { provider: state.aiConfig.provider, model: state.aiConfig.model }
          params.effort = state.aiConfig.effort || 'auto'
        } else {
          params.effort = 'auto'
        }
        if ((state.excluded || []).length > 0) {
          params.paths = selectedEntriesOf(state).map(function (entry) { return entry.path })
        }
        return params
      }

      async function generateMessage() {
        var state = store.get()
        var cwd = state.cwd
        if (!cwd || state.busy) return
        if (selectedEntriesOf(state).length === 0) {
          toast('error', tr('commit.noSelection'))
          return
        }
        set({ aiGenerating: true })
        var result = await runBusy('ai', function () { return rpc('aiCommit', aiParams(state)) })
        set({ aiGenerating: false })
        if (result === null) return
        set({
          subject: result.subject || '',
          body: result.body || '',
          aiModel: result.model || null,
          aiFallback: !!result.fallback,
          aiWarning: result.warning || '',
        })
        if (result.fallback) {
          toast('warn', result.warning || tr('status.aiFallback'))
        } else if (result.warning) {
          toast('warn', result.warning)
        } else {
          toast('ok', tr('status.aiGenerated', { model: result.model || '' }))
        }
      }

      async function commit() {
        var state = store.get()
        var cwd = state.cwd
        if (!cwd || state.busy) return
        var subject = String(state.subject || '').trim()
        if (subject === '') {
          toast('error', tr('commit.needSummary'))
          return
        }
        if (state.snapshot && state.snapshot.status && state.snapshot.status.conflicted.length > 0) {
          toast('error', tr('commit.conflictBlocked'))
          return
        }
        var selected = selectedEntriesOf(state)
        if (selected.length === 0) {
          toast('error', tr('commit.noSelection'))
          return
        }
        var message = subject
        var body = String(state.body || '').trim()
        if (body !== '') message = subject + '\n\n' + body
        var params = { cwd: cwd, message: message }
        if ((state.excluded || []).length === 0) params.autoStage = true
        else {
          params.paths = stagePathsOf(selected)
          var allRows = collectChanges(state.snapshot.status)
          params.exclude = stagePathsOf(allRows.filter(function (entry) {
            return (state.excluded || []).indexOf(entry.path) !== -1
          }))
        }
        var result = await runBusy('commit', function () { return rpc('commit', params) })
        if (result === null) return
        set({
          subject: '', body: '', aiModel: null, aiFallback: false, aiWarning: '', excluded: [],
          selected: null, diff: null, commitInfo: null,
        })
        toast('ok', tr('status.committed', { hash: result.hash || '' }), result.output)
        await refresh()
        if (store.get().pushAfter) await sync()
      }

      async function sync() {
        var state = store.get()
        var cwd = state.cwd
        if (!cwd || state.busy) return
        var result = await runBusy('sync', function () {
          return rpc('sync', { cwd: cwd, autoStash: state.autoStash })
        })
        if (result === null) return
        set({ lastFetchedAt: Date.now() })
        if (result.conflict) set({ activeTab: 'changes' })
        await refresh()
        if (result.conflict) {
          var text = tr('status.conflict')
          if (result.stashRestoreConflict) text += ' · ' + tr('status.stashConflict')
          else if (result.stashed) text += ' · ' + tr('status.conflictStashed')
          if (store.get().autoResolveConflicts) {
            await runResolveAll(true)
            return
          }
          toast('warn', text, result.output)
          return
        }
        var summary = result.pushed && result.merged
          ? tr('status.synced')
          : result.merged ? tr('status.pulled') : result.pushed ? tr('status.pushed') : tr('status.fetched')
        if (result.stashed) summary += ' · ' + tr('status.autoStashRestored')
        toast('ok', summary, result.output)
      }

      async function fetchRemote() {
        var cwd = store.get().cwd
        if (!cwd || store.get().busy) return
        var result = await runBusy('fetch', function () { return rpc('fetch', { cwd: cwd }) })
        if (result === null) return
        set({ lastFetchedAt: result.at || Date.now() })
        toast('ok', tr('status.fetched'), result.output)
        await refresh()
      }

      function openSettings() { set({ settingsOpen: true }) }
      function closeSettings() { set({ settingsOpen: false }) }

      function setAutoStash(value) {
        set({ autoStash: !!value })
        persist(STORE_STASH, !!value)
      }

      function setPushAfter(value) {
        set({ pushAfter: !!value })
        persist(STORE_PUSH, !!value)
      }

      function setAutoResolveConflicts(value) {
        set({ autoResolveConflicts: !!value })
        persist(STORE_AUTO_RESOLVE, !!value)
      }

      async function saveSettings(config, prompt, autoStash, autoResolve) {
        var state = store.get()
        var cwd = state.cwd
        setAiConfig(config)
        setAutoStash(autoStash)
        setAutoResolveConflicts(autoResolve)
        var previousPrompt = state.snapshot && state.snapshot.commitPrompt ? state.snapshot.commitPrompt : ''
        var nextPrompt = String(prompt || '')
        if (cwd && nextPrompt.trim() !== previousPrompt.trim()) {
          var result = await runBusy('save', function () {
            return rpc('setCommitPrompt', { cwd: cwd, prompt: nextPrompt })
          })
          if (result === null) return
          var snapshot = store.get().snapshot
          if (snapshot) set({ snapshot: Object.assign({}, snapshot, { commitPrompt: result.prompt }) })
          toast('ok', result.prompt === '' ? tr('status.promptReset') : tr('status.promptSaved'))
        } else {
          toast('ok', tr('settings.saved'))
        }
        set({ settingsOpen: false })
      }

      function setConflict(patch) {
        var current = store.get().conflict
        if (!current) return
        set({ conflict: Object.assign({}, current, patch) })
      }

      async function openConflict(entry) {
        var cwd = store.get().cwd
        var path = entry && entry.path ? entry.path : String(entry || '')
        if (!cwd || path === '') return
        set({
          conflict: {
            path: path,
            info: null,
            loading: true,
            suggested: null,
            delete: false,
            deterministic: false,
            model: null,
            warning: '',
          },
          conflictHint: '',
        })
        try {
          var info = await rpc('conflictInfo', { cwd: cwd, path: path })
          var current = store.get().conflict
          if (!current || current.path !== path) return
          set({ conflict: Object.assign({}, current, { info: info, loading: false }) })
        } catch (error) {
          set({ conflict: null })
          toast('error', error.message)
        }
      }

      function closeConflict() { set({ conflict: null, conflictHint: '' }) }
      function setConflictHint(value) { set({ conflictHint: String(value || '') }) }

      async function aiResolve() {
        var state = store.get()
        var conflict = state.conflict
        if (!state.cwd || !conflict || conflict.loading || state.busy) return
        setConflict({ loading: true })
        var params = {
          cwd: state.cwd,
          path: conflict.path,
          hint: String(state.conflictHint || ''),
          sessionId: state.sessionId || undefined,
          effort: 'auto',
        }
        if (state.aiConfig.provider && state.aiConfig.model) {
          params.selection = { provider: state.aiConfig.provider, model: state.aiConfig.model }
          params.effort = state.aiConfig.effort || 'auto'
        }
        var result = await runBusy('resolve', function () { return rpc('aiResolve', params) })
        if (result === null) {
          setConflict({ loading: false })
          return
        }
        setConflict({
          loading: false,
          suggested: result.suggested,
          delete: !!result.delete,
          deterministic: !!result.deterministic,
          model: result.model,
          warning: result.warning || '',
        })
      }

      async function applyConflict() {
        var state = store.get()
        var conflict = state.conflict
        if (!state.cwd || !conflict || conflict.loading || state.busy) return
        var params = { cwd: state.cwd, path: conflict.path }
        if (conflict.delete) params.delete = true
        else if (conflict.suggested) params.content = conflict.suggested
        else return
        var result = await runBusy('resolve', function () { return rpc('applyResolution', params) })
        if (result === null) return
        set({ conflict: null, conflictHint: '' })
        toast('ok', result.unmerged === 0 ? tr('conflict.resolveAll') : tr('status.resolveApplied'), result.output)
        await loadSnapshot(state.cwd)
        await loadGraph(state.cwd)
      }

      async function deleteConflict() {
        var state = store.get()
        var conflict = state.conflict
        if (!state.cwd || !conflict || state.busy) return
        var result = await runBusy('resolve', function () {
          return rpc('applyResolution', { cwd: state.cwd, path: conflict.path, delete: true })
        })
        if (result === null) return
        set({ conflict: null, conflictHint: '' })
        toast('ok', result.unmerged === 0 ? tr('conflict.resolveAll') : tr('status.resolveDeleted'), result.output)
        await loadSnapshot(state.cwd)
        await loadGraph(state.cwd)
      }

      async function markResolved() {
        var state = store.get()
        var conflict = state.conflict
        if (!state.cwd || !conflict || state.busy) return
        var result = await runBusy('resolve', function () {
          return rpc('markResolved', { cwd: state.cwd, path: conflict.path })
        })
        if (result === null) return
        set({ conflict: null, conflictHint: '' })
        toast('ok', result.unmerged === 0 ? tr('conflict.resolveAll') : tr('status.resolveApplied'), result.output)
        await loadSnapshot(state.cwd)
        await loadGraph(state.cwd)
      }

      async function takeSide(side) {
        var state = store.get()
        var conflict = state.conflict
        if (!state.cwd || !conflict || state.busy) return
        var result = await runBusy('resolve', function () {
          return rpc('takeSide', { cwd: state.cwd, path: conflict.path, side: side })
        })
        if (result === null) return
        set({ conflict: null, conflictHint: '' })
        toast('ok', result.unmerged === 0 ? tr('conflict.resolveAll') : (side === 'ours' ? tr('status.tookOurs') : tr('status.tookTheirs')), result.output)
        await loadSnapshot(state.cwd)
        await loadGraph(state.cwd)
      }

      async function runResolveAll(skipConfirm) {
        var state = store.get()
        var cwd = state.cwd
        var conflicted = state.snapshot && state.snapshot.status ? state.snapshot.status.conflicted : []
        if (!cwd || state.busy || !conflicted || conflicted.length === 0) return
        var paths = conflicted.map(function (entry) { return entry.path }).filter(Boolean)
        if (paths.length === 0) return
        if (skipConfirm !== true && typeof window !== 'undefined' && typeof window.confirm === 'function') {
          if (!window.confirm(tr('conflict.autoAllConfirm', { n: paths.length }))) return
        }
        set({
          busy: 'resolve-all',
          error: null,
          errorCode: null,
          conflict: null,
          conflictHint: '',
          aiResolveProgress: { done: 0, total: paths.length },
          aiResolveFailures: [],
        })
        var failures = []
        for (var index = 0; index < paths.length; index += 1) {
          set({ aiResolveProgress: { done: index, total: paths.length, path: paths[index] } })
          var params = {
            cwd: cwd,
            path: paths[index],
            apply: true,
            sessionId: state.sessionId || undefined,
            effort: 'auto',
          }
          if (state.aiConfig.provider && state.aiConfig.model) {
            params.selection = { provider: state.aiConfig.provider, model: state.aiConfig.model }
            params.effort = state.aiConfig.effort || 'auto'
          }
          try {
            await rpc('aiResolve', params)
          } catch (error) {
            failures.push({
              path: paths[index],
              message: error && error.message ? error.message : String(error),
            })
          }
          set({ aiResolveProgress: { done: index + 1, total: paths.length } })
        }
        set({ busy: null, aiResolveProgress: null, aiResolveFailures: failures })
        await loadSnapshot(cwd)
        await loadGraph(cwd)
        var doneCount = paths.length - failures.length
        var details = failures.map(function (failure) {
          return failure.path + '：' + failure.message
        }).join('\n')
        if (failures.length === 0) {
          toast('ok', tr('conflict.autoAllDone', { done: doneCount }))
        } else if (doneCount > 0) {
          toast('warn', tr('conflict.autoAllPartial', {
            done: doneCount, total: paths.length, failed: failures.length,
          }), details)
        } else {
          toast('error', tr('conflict.autoAllFailed', { n: failures.length }), details)
        }
      }

      function resolveAllConflicts() { return runResolveAll(false) }

      function clearResolveFailures() { set({ aiResolveFailures: [] }) }

      async function abortOperation() {
        var cwd = store.get().cwd
        if (!cwd || store.get().busy) return
        if (typeof window !== 'undefined' && typeof window.confirm === 'function') {
          if (!window.confirm(tr('operation.abortConfirm'))) return
        }
        var result = await runBusy('abort', function () { return rpc('abortOperation', { cwd: cwd }) })
        if (result !== null) {
          toast('ok', tr('status.aborted'), result.output)
          await refresh()
        }
      }

      async function continueOperation() {
        var cwd = store.get().cwd
        if (!cwd || store.get().busy) return
        var result = await runBusy('continue', function () { return rpc('continueOperation', { cwd: cwd }) })
        if (result !== null) {
          toast('ok', tr('status.continued'), result.output)
          await refresh()
        }
      }

      return {
        store: store,
        attach: attach,
        refresh: refresh,
        refreshSoft: refreshSoft,
        loadModels: loadModels,
        setTab: setTab,
        setFilter: setFilter,
        setGraphFilter: setGraphFilter,
        setBranchFilter: setBranchFilter,
        setGraphAll: setGraphAll,
        selectFile: selectFile,
        selectCommit: selectCommit,
        clearSelection: clearSelection,
        toggleSelected: toggleSelected,
        selectAllChanges: selectAllChanges,
        discard: discard,
        switchBranch: switchBranch,
        createBranch: createBranch,
        deleteBranch: deleteBranch,
        setNewBranch: setNewBranch,
        setNewBranchName: setNewBranchName,
        setNewBranchFrom: setNewBranchFrom,
        setStashMessage: setStashMessage,
        stashSave: stashSave,
        stashPop: stashPop,
        stashDrop: stashDrop,
        setSubject: setSubject,
        setBody: setBody,
        setAiHint: setAiHint,
        setAiConfig: setAiConfig,
        setAutoStash: setAutoStash,
        setPushAfter: setPushAfter,
        generateMessage: generateMessage,
        commit: commit,
        sync: sync,
        fetch: fetchRemote,
        openSettings: openSettings,
        closeSettings: closeSettings,
        saveSettings: saveSettings,
        openConflict: openConflict,
        closeConflict: closeConflict,
        setConflictHint: setConflictHint,
        aiResolve: aiResolve,
        applyConflict: applyConflict,
        deleteConflict: deleteConflict,
        takeSide: takeSide,
        markResolved: markResolved,
        resolveAllConflicts: resolveAllConflicts,
        clearResolveFailures: clearResolveFailures,
        abortOperation: abortOperation,
        continueOperation: continueOperation,
        clearToast: clearToast,
      }
    }


    // -------------------------------------------------------------- components

    function EmptyBody(props) {
      return h(React.Fragment, null,
        h('div', { className: 'wx-top' },
          h('div', { className: 'wx-top-meta' },
            h('span', { className: 'wx-repo' }, tr('panel.title')))),
        props.spinner
          ? h('div', { className: 'wx-empty' },
            h(Spinner),
            props.title ? h('div', { className: 'wx-empty-title' }, props.title) : null)
          : h('div', { className: 'wx-empty' },
            h('div', { className: 'wx-empty-icon' },
              h(Icon, { name: props.icon || 'git', size: props.iconSize || 22 })),
            props.title ? h('div', { className: 'wx-empty-title' }, props.title) : null,
            props.hint ? h('div', { className: 'wx-empty-hint' }, props.hint) : null))
    }

    function Avatar() {
      return h('span', { className: 'wx-avatar', title: tr('commit.avatar') },
        h(BrandMark, { size: 18 }))
    }

    function syncActionFor(repo) {
      if (!repo || repo.detached) return 'detached'
      if (repo.initial) return 'fetch'
      if (repo.upstreamGone) return 'publish'
      if (!repo.upstream && repo.hasRemote) return 'publish'
      var ahead = repo.ahead || 0
      var behind = repo.behind || 0
      if (ahead > 0 && behind > 0) return 'sync'
      if (ahead > 0) return 'push'
      if (behind > 0) return 'pull'
      return 'fetch'
    }

    var SYNC_ACTIONS = {
      fetch: { label: 'top.fetch', hint: 'top.fetchHint', icon: 'fetch' },
      pull: { label: 'top.pull', hint: 'top.pullHint', icon: 'pull' },
      push: { label: 'top.push', hint: 'top.pushHint', icon: 'push' },
      sync: { label: 'top.sync', hint: 'top.syncHint', icon: 'sync' },
      publish: { label: 'top.publish', hint: 'top.publishHint', icon: 'push' },
      detached: { label: 'top.detached', hint: 'top.detached', icon: 'fetch' },
    }

    function TopBar(props) {
      var state = props.state
      var actions = props.actions
      var repo = state.snapshot.repo
      var branches = state.snapshot.branches || []
      var locals = branches.filter(function (branch) { return branch.kind === 'local' })
      var remotes = branches.filter(function (branch) { return branch.kind === 'remote' })
      var busy = !!state.busy
      var detached = !!repo.detached
      var ahead = repo.ahead || 0
      var behind = repo.behind || 0
      var action = syncActionFor(repo)
      var actionInfo = SYNC_ACTIONS[action] || SYNC_ACTIONS.fetch
      var label = state.busy === 'sync' ? tr('top.syncing') : tr(actionInfo.label)
      var iconName = state.busy === 'sync' ? 'refresh' : actionInfo.icon
      var spinning = state.busy === 'sync' || state.busy === 'fetch'
      var buttonTitle = detached ? tr('top.detached') : tr(actionInfo.hint)
      var lastLabel = state.lastFetchedAt
        ? tr('top.lastFetched', { time: relativeLabel(state.lastFetchedAt) })
        : tr('top.neverFetched')
      var branchLabel = repo.branch || tr('top.detached')
      var syncCounts = []
      if (behind > 0) {
        var behindTitle = tr('top.behindTitle', { n: behind })
        syncCounts.push(h('span', {
          key: 'behind', className: 'wx-sync-badge', title: behindTitle, 'aria-label': behindTitle,
        }, h('span', null, String(behind)), h(Icon, { name: 'pull', size: 11, strokeWidth: 2.5 })))
      }
      if (ahead > 0) {
        var aheadTitle = tr('top.aheadTitle', { n: ahead })
        syncCounts.push(h('span', {
          key: 'ahead', className: 'wx-sync-badge', title: aheadTitle, 'aria-label': aheadTitle,
        }, h('span', null, String(ahead)), h(Icon, { name: 'push', size: 11, strokeWidth: 2.5 })))
      }
      return h('div', { className: 'wx-top' },
        h('div', { className: 'wx-top-meta' },
          h('span', { className: 'wx-repo', title: repo.root }, repo.name),
          h('span', { className: 'wx-spacer' }),
          repo.upstream ? h('span', { className: 'wx-upstream', title: repo.upstream }, repo.upstream) : null),
        h('div', { className: 'wx-toolbar' },
          h('div', {
            className: 'wx-cell wx-branch-cell' + (busy || detached ? ' is-disabled' : ''),
            title: tr('top.branch'),
          },
            h(Icon, { name: 'branch', size: 13, className: 'wx-cell-icon' }),
            h('span', { className: 'wx-cell-text', 'aria-hidden': 'true' },
              h('span', { className: 'wx-cell-label' }, tr('top.currentBranch')),
              h('span', { className: 'wx-cell-title' }, branchLabel)),
            h(Icon, { name: 'chevron', size: 12, className: 'wx-cell-chevron' }),
            h('select', {
              className: 'wx-branch-native',
              value: repo.branch || '',
              'aria-label': tr('top.branch'),
              disabled: busy || detached,
              onChange: function (event) {
                var value = event.target.value
                if (value && value !== repo.branch) actions.switchBranch(value)
              },
            },
              detached ? h('option', { value: '' }, tr('top.detached')) : null,
              locals.length > 0
                ? h('optgroup', { label: tr('branches.local') }, locals.map(function (branch) {
                  return h('option', { key: 'l:' + branch.name, value: branch.name }, branch.name)
                }))
                : null,
              remotes.length > 0
                ? h('optgroup', { label: tr('branches.remote') }, remotes.map(function (branch) {
                  return h('option', { key: 'r:' + branch.name, value: branch.name }, branch.name)
                }))
                : null)),
          h('button', {
            type: 'button',
            className: 'wx-cell wx-sync-cell',
            title: buttonTitle,
            disabled: busy || detached,
            onClick: actions.sync,
          },
            h(Icon, { name: iconName, size: 14, strokeWidth: iconName === 'pull' || iconName === 'push' ? 2.2 : 1.8, className: 'wx-cell-icon' + (spinning ? ' spin' : '') }),
            h('span', { className: 'wx-cell-text' },
              h('span', { className: 'wx-cell-title' }, label),
              h('span', { className: 'wx-cell-sub' }, lastLabel)),
            syncCounts.length > 0 ? h('span', { className: 'wx-sync-counts' }, syncCounts) : null)))
    }

    function Tabs(props) {
      var state = props.state
      var status = state.snapshot.status
      var count = status ? changeCount(status) : 0
      var tabs = [
        { id: 'commit', label: tr('tabs.commit'), count: 0 },
        { id: 'changes', label: tr('tabs.changes'), count: count },
        { id: 'history', label: tr('tabs.history'), count: 0 },
        { id: 'branches', label: tr('tabs.branches'), count: 0 },
        { id: 'diff', label: tr('tabs.diff'), count: state.selected ? 1 : 0 },
      ]
      return h('div', { className: 'wx-tabs' },
        tabs.map(function (tab) {
          return h('button', {
            key: tab.id,
            type: 'button',
            className: 'wx-tab' + (state.activeTab === tab.id ? ' active' : ''),
            onClick: function () { props.actions.setTab(tab.id) },
          },
            h('span', null, tab.label),
            tab.count > 0 ? h('span', { className: 'wx-tab-count' }, String(tab.count)) : null)
        }))
    }

    function Checkbox(props) {
      function toggle(event) {
        event.stopPropagation()
        if (!props.disabled) props.onChange(!props.checked)
      }
      return h('span', {
        className: 'wx-check' + (props.checked ? ' checked' : '') + (props.disabled ? ' disabled' : ''),
        role: 'checkbox',
        'aria-checked': props.checked ? 'true' : 'false',
        'aria-disabled': props.disabled ? 'true' : 'false',
        tabIndex: props.disabled ? undefined : 0,
        title: props.title,
        onClick: toggle,
        onKeyDown: function (event) {
          if (event.key === ' ' || event.key === 'Enter') {
            event.preventDefault()
            toggle(event)
          }
        },
      }, props.checked ? h(Icon, { name: 'check', size: 10, strokeWidth: 2.6 }) : null)
    }

    function changeStatusClass(entry) {
      if (entry.conflicted) return 'wx-stat u'
      if (entry.untracked) return 'wx-stat q'
      var code = String(entry.status || '?').slice(0, 1)
      if (code === 'A' || code === 'R' || code === 'C') return 'wx-stat a'
      if (code === 'D' || code === 'U') return 'wx-stat d'
      return 'wx-stat m'
    }

    function FileRow(props) {
      var entry = props.entry
      var selected = props.selected && props.selected.kind === 'file' && props.selected.path === entry.path
      var parts = pathParts(entry.path)
      var discardMode = entry.conflicted
        ? 'worktree'
        : entry.untracked && !entry.staged && !entry.unstaged
          ? 'untracked'
          : entry.unstaged && !entry.staged ? 'worktree' : 'all'
      var discardTitle = discardMode === 'untracked'
        ? tr('changes.discardUntracked')
        : tr('changes.discard')
      return h('div', {
        className: 'wx-file' + (selected ? ' active' : ''),
        title: entry.oldPath ? entry.oldPath + ' → ' + entry.path : entry.path,
        onClick: function () { props.onSelect(entry) },
      },
        entry.conflicted
          ? h('span', { className: 'wx-check disabled', title: tr('commit.conflictBlocked') })
          : h(Checkbox, {
            checked: !props.excluded,
            title: props.excluded ? tr('changes.select') : tr('changes.deselect'),
            onChange: function () { props.onToggle(entry) },
          }),
        h('span', { className: changeStatusClass(entry) }, entry.conflicted ? entry.conflictStatus : entry.status),
        h('span', { className: 'wx-path' },
          parts.dir ? h('span', { className: 'wx-dir' }, parts.dir) : null,
          parts.base),
        h('span', { className: 'wx-file-actions' },
          entry.conflicted
            ? h(Btn, { icon: 'sparkle', small: true, ghost: true, title: tr('diff.resolve'), onClick: function (event) { event.stopPropagation(); props.onResolve(entry) } })
            : h(Btn, {
              icon: 'trash',
              small: true,
              ghost: true,
              title: discardTitle,
              onClick: function (event) { event.stopPropagation(); props.onDiscard(discardMode, entry) },
            })))
    }

    function ChangesPane(props) {
      var state = props.state
      var actions = props.actions
      var status = state.snapshot.status
      var rows = collectChanges(status)
      var total = rows.length
      var filter = String(state.filter || '').trim().toLowerCase()
      var filtered = filter === ''
        ? rows
        : rows.filter(function (entry) { return String(entry.path || '').toLowerCase().indexOf(filter) !== -1 })
      var busy = !!state.busy
      var progress = state.aiResolveProgress
      var failures = state.aiResolveFailures || []
      var excludedCount = (state.excluded || []).length
      return h('div', { className: 'wx-pane wx-changes' },
        h('div', { className: 'wx-list-head' },
          h('span', { className: 'wx-list-title' }, tr('changes.count', { n: total })),
          h('input', {
            className: 'wx-filter',
            value: state.filter,
            placeholder: tr('changes.filter'),
            onChange: function (event) { actions.setFilter(event.target.value) },
          }),
          excludedCount > 0
            ? h('button', {
              type: 'button',
              className: 'wx-text-btn',
              onClick: actions.selectAllChanges,
            }, tr('changes.selectAll'))
            : null),
        h(OperationBar, {
          operation: state.snapshot.operation,
          busy: busy,
          onAbort: actions.abortOperation,
          onContinue: actions.continueOperation,
        }),
        status.conflicted.length > 0
          ? h('div', { className: 'wx-conflict-bar' },
            h('span', { className: 'wx-conflict-bar-text' },
              progress
                ? tr('conflict.autoAllBusy', {
                  done: Math.min(progress.done + 1, progress.total),
                  total: progress.total,
                })
                : tr('changes.conflictBanner', { n: status.conflicted.length })),
            h('span', { className: 'wx-spacer' }),
            h(Btn, {
              icon: 'sparkle',
              label: tr('conflict.autoAll'),
              small: true,
              variant: 'primary',
              disabled: busy || !!progress,
              onClick: actions.resolveAllConflicts,
            }))
          : null,
        failures.length > 0
          ? h('div', { className: 'wx-conflict-report' },
            h('div', { className: 'wx-conflict-report-head' },
              h('span', null, tr('conflict.autoAllRemaining', { n: failures.length })),
              h('span', { className: 'wx-spacer' }),
              h('button', {
                type: 'button',
                className: 'wx-status-close',
                title: tr('toast.dismiss'),
                onClick: actions.clearResolveFailures,
              }, h(Icon, { name: 'close', size: 11 }))),
            failures.map(function (failure) {
              return h('div', { className: 'wx-conflict-report-row', key: failure.path, title: failure.message },
                h('span', { className: 'wx-conflict-report-path' }, failure.path),
                h('span', { className: 'wx-conflict-report-msg' }, failure.message))
            }))
          : null,
        filtered.length > 0
          ? h('div', { className: 'wx-file-list' }, filtered.map(function (entry) {
            var mode = entry.conflicted
              ? 'worktree'
              : entry.untracked && !entry.staged
                ? 'untracked'
                : entry.staged && !entry.unstaged ? 'staged' : 'unstaged'
            var group = entry.conflicted ? 'conflicted' : (mode === 'staged' ? 'staged' : mode === 'untracked' ? 'untracked' : 'unstaged')
            return h(FileRow, {
              key: entry.path,
              entry: entry,
              selected: state.selected,
              excluded: (state.excluded || []).indexOf(entry.path) !== -1,
              onSelect: function (item) { actions.selectFile(group, item) },
              onToggle: function (item) { actions.toggleSelected(item.path) },
              onDiscard: function (discardMode, item) { actions.discard(discardMode, item) },
              onResolve: function (item) { actions.openConflict(item) },
            })
          }))
          : h(EmptyState, {
            icon: 'git',
            title: filter !== '' ? tr('changes.noMatch') : tr('changes.empty'),
            hint: filter !== '' ? null : tr('changes.emptyHint'),
          }))
    }

    function CommitmentMeta(props) {
      var state = props.state
      var catalog = state.modelCatalog
      var config = state.aiConfig
      if (state.aiWarning) return h('span', { className: 'wx-ai-meta', title: state.aiWarning }, state.aiWarning)
      if (state.aiModel) {
        return h('span', { className: 'wx-ai-meta', title: state.aiFallback ? tr('commit.fallback') : tr('commit.generatedBy', { model: state.aiModel }) },
          state.aiFallback
            ? tr('commit.fallback')
            : tr('commit.generatedBy', { model: state.aiModel }))
      }
      if (config.provider && config.model) {
        return h('span', { className: 'wx-ai-meta' }, config.provider + '/' + config.model)
      }
      var def = catalog && catalog.default ? catalog.default : null
      return h('span', { className: 'wx-ai-meta' },
        def && def.label
          ? tr('ai.followSession', { model: def.label })
          : tr('ai.hint'))
    }

    function CommitPane(props) {
      var state = props.state
      var actions = props.actions
      var status = state.snapshot.status
      var rows = collectChanges(status)
      var totalAll = rows.length
      var selected = selectedEntriesOf(state)
      var selectedCount = selected.length
      var conflicts = status.conflicted.length
      var busy = !!state.busy
      var progress = state.aiResolveProgress
      var branch = state.snapshot.repo.branch || 'HEAD'
      var canCommit = !busy && String(state.subject || '').trim() !== '' && selectedCount > 0 && conflicts === 0
      var aiDisabled = busy || selectedCount === 0 || conflicts > 0
      var bodyRef = useRef(null)
      function onCommitShortcut(event) {
        if (event.key === 'Enter' && (event.metaKey || event.ctrlKey)) {
          event.preventDefault()
          if (canCommit) actions.commit()
        }
      }
      function onSummaryKeyDown(event) {
        if (event.key === 'Enter' && !event.metaKey && !event.ctrlKey && !event.shiftKey) {
          event.preventDefault()
          if (bodyRef.current) bodyRef.current.focus()
          return
        }
        onCommitShortcut(event)
      }
      return h('div', { className: 'wx-commit-pane' },
        conflicts > 0
          ? h('div', { className: 'wx-notice' },
            h(Icon, { name: 'warning', size: 13 }),
            h('span', null, progress
              ? tr('conflict.autoAllBusy', {
                done: Math.min(progress.done + 1, progress.total),
                total: progress.total,
              })
              : tr('commit.conflictHint', { n: conflicts })),
            h('button', { type: 'button', className: 'wx-text-btn', onClick: function () { actions.setTab('changes') } }, tr('commit.viewChanges')),
            h('button', {
              type: 'button',
              className: 'wx-text-btn',
              disabled: busy || !!progress,
              onClick: actions.resolveAllConflicts,
            }, tr('conflict.autoAll')))
          : null,
        h('div', { className: 'wx-commit-head' },
          h(Avatar),
          h('input', {
            className: 'wx-input wx-summary-input',
            value: state.subject,
            placeholder: tr('commit.summaryPlaceholder'),
            onChange: function (event) { actions.setSubject(event.target.value) },
            onKeyDown: onSummaryKeyDown,
          })),
        h('textarea', {
          className: 'wx-textarea wx-description',
          rows: 6,
          value: state.body,
          placeholder: tr('commit.descriptionPlaceholder'),
          ref: bodyRef,
          onChange: function (event) { actions.setBody(event.target.value) },
          onKeyDown: onCommitShortcut,
        }),
        h('div', { className: 'wx-ai-card' },
          h('div', { className: 'wx-ai-card-head' },
            h('span', { className: 'wx-ai-label' },
              h(Icon, { name: 'sparkle', size: 12 }),
              h('span', null, tr('commit.aiSection'))),
            h('span', { className: 'wx-spacer' }),
            h(Btn, { icon: 'gear', small: true, ghost: true, title: tr('commit.settings'), onClick: actions.openSettings })),
          h('div', { className: 'wx-ai-card-row' },
            h('input', {
              className: 'wx-input wx-hint-input',
              value: state.aiHint,
              placeholder: tr('commit.aiHint'),
              onChange: function (event) { actions.setAiHint(event.target.value) },
              onKeyDown: function (event) { if (event.key === 'Enter') actions.generateMessage() },
            }),
            h(Btn, {
              icon: 'sparkle',
              label: state.aiGenerating || state.busy === 'ai' ? tr('commit.aiBusy') : tr('commit.ai'),
              small: true,
              variant: 'primary',
              className: 'wx-ai-btn' + (state.aiGenerating || state.busy === 'ai' ? ' wx-ai-busy' : ''),
              disabled: aiDisabled,
              onClick: actions.generateMessage,
            })),
          h(CommitmentMeta, { state: state })),
        h('button', {
          type: 'button',
          className: 'wx-commit-btn',
          title: IS_MAC ? tr('commit.keyboard') : tr('commit.keyboardWin'),
          disabled: !canCommit,
          onClick: actions.commit,
        },
          h(Icon, { name: 'check', size: 13 }),
          h('span', null, busy === 'commit'
            ? tr('commit.committing')
            : selectedCount > 0
              ? tr('commit.commitCountTo', { n: selectedCount, branch: branch })
              : tr('commit.commitTo', { branch: branch }))),
        h('div', { className: 'wx-commit-options' },
          h('label', { className: 'wx-check-label' },
            h('input', {
              type: 'checkbox',
              checked: state.pushAfter,
              onChange: function (event) { actions.setPushAfter(event.target.checked) },
            }),
            h('span', null, tr('commit.pushAfter'))),
          totalAll === 0
            ? h('span', { className: 'wx-hint-inline' }, tr('commit.noChanges'))
            : selectedCount === 0 ? h('span', { className: 'wx-hint-inline' }, tr('commit.noSelection')) : null),
        h('div', { className: 'wx-commit-tip-line' }, tr('commit.tip')))
    }

    function EmptyState(props) {
      return h('div', { className: 'wx-empty' },
        h('div', { className: 'wx-empty-icon' }, h(Icon, { name: props.icon || 'git', size: 22 })),
        props.title ? h('div', { className: 'wx-empty-title' }, props.title) : null,
        props.hint ? h('div', { className: 'wx-empty-hint' }, props.hint) : null)
    }

    function StatusLine(props) {
      var state = props.state
      if (!state.toast && !state.error && !state.busy) return null
      var message = ''
      var dot = 'wx-status-dot'
      var messageClass = 'wx-status-msg'
      var dismiss = null
      if (state.toast) {
        dot += state.toastKind === 'error' ? ' err' : state.toastKind === 'warn' ? ' warn' : ' ok'
        messageClass += state.toastKind === 'error' ? ' err' : state.toastKind === 'warn' ? ' warn' : ' ok'
        message = state.toast
        dismiss = props.onDismiss
      } else if (state.error) {
        dot += ' err'
        messageClass += ' err'
        message = state.error
        dismiss = props.onDismiss
      } else if (state.busy) {
        dot += ' busy'
        message = tr('status.busy', { label: busyLabel(state.busy) })
      }
      return h('div', { className: 'wx-status' },
        h('span', { className: dot }),
        h('span', { className: messageClass, title: message }, message),
        dismiss
          ? h('button', { type: 'button', className: 'wx-status-close', title: tr('toast.dismiss'), onClick: dismiss },
            h(Icon, { name: 'close', size: 11 }))
          : null)
    }

    function busyLabel(kind) {
      var key = 'busy.' + String(kind || '')
      var text = tr(key)
      return text === key ? String(kind || '') : text
    }

    function PanelBody(props) {
      var state = props.state
      var actions = props.actions
      var content
      if (state.activeTab === 'commit') {
        content = h('div', { className: 'wx-pane' }, h(CommitPane, { state: state, actions: actions }))
      } else if (state.activeTab === 'changes') {
        content = h(ChangesPane, { state: state, actions: actions })
      } else if (state.activeTab === 'history') {
        content = h(HistoryPane, { state: state, actions: actions })
      } else if (state.activeTab === 'branches') {
        content = h(BranchesPane, { state: state, actions: actions })
      } else {
        content = h('div', { className: 'wx-pane' }, h(DiffPane, { state: state, actions: actions }))
      }
      return h(React.Fragment, null,
        h(TopBar, { state: state, actions: actions }),
        h(Tabs, { state: state, actions: actions }),
        h('div', { className: 'wx-main' }, content),
        h(StatusLine, { state: state, onDismiss: actions.clearToast }),
        state.settingsOpen
          ? h(SettingsModal, { state: state, actions: actions })
          : null,
        state.conflict
          ? h(ConflictModal, { state: state, actions: actions })
          : null)
    }

    function GitPanel(props) {
      var controller = props.controller
      var summary = props.summary
      var sessionId = props.sessionId
      var cwd = summary && summary.cwd ? summary.cwd : null
      var state = useStore(controller.store)

      useEffect(function () {
        controller.attach(cwd, sessionId)
      }, [cwd, sessionId])

      useEffect(function () {
        if (!cwd) return undefined
        var timer = setInterval(function () {
          if (typeof document !== 'undefined' && document.hidden) return
          void controller.refreshSoft()
        }, POLL_MS)
        return function () { clearInterval(timer) }
      }, [cwd])

      useEffect(function () {
        if (typeof window === 'undefined') return undefined
        var onFocus = function () { void controller.refreshSoft() }
        var onVisible = function () { if (!document.hidden) void controller.refreshSoft() }
        window.addEventListener('focus', onFocus)
        document.addEventListener('visibilitychange', onVisible)
        return function () {
          window.removeEventListener('focus', onFocus)
          document.removeEventListener('visibilitychange', onVisible)
        }
      }, [])

      var body
      if (!summary) body = h(EmptyBody, { title: tr('empty.noSession'), hint: tr('panel.guide'), icon: 'git' })
      else if (!cwd) body = h(EmptyBody, { title: tr('empty.noCwd'), icon: 'git' })
      else if (state.error && state.errorCode === 'cwd-unavailable') {
        body = h(EmptyBody, { title: tr('empty.cwdUnavailable', { path: cwd }), icon: 'warning' })
      } else if (state.snapshot && state.snapshot.repo && state.snapshot.repo.isRepo === false) {
        body = h(EmptyBody, { title: tr('empty.notRepo'), hint: tr('empty.notRepoHint'), icon: 'git' })
      } else if (state.error && !state.snapshot) {
        body = h(EmptyBody, { title: tr('error.title'), hint: state.error, icon: 'warning' })
      } else if (!state.snapshot) {
        body = h(EmptyBody, { spinner: true, title: tr('empty.loading') })
      } else {
        body = h(PanelBody, { state: state, actions: controller })
      }
      return h('div', { className: 'wx-root' },
        h('style', { key: 'wx-css' }, CSS),
        body)
    }

    function laneVar(color) {
      var index = Number(color)
      if (!Number.isFinite(index) || index < 0 || index >= 8) return 'var(--wx-lane-0)'
      return 'var(--wx-lane-' + index + ')'
    }

    function GraphRow(props) {
      var row = props.row
      var state = props.state
      var cell = 9
      var height = 24
      var cols = Math.min(Math.max(1, props.cols || row.width || 1), 12)
      var width = cols * cell
      var parts = []
      var trails = row.trails || []
      var joins = row.joins || []
      for (var t = 0; t < trails.length; t += 1) {
        var trail = trails[t]
        if (trail.from >= cols) continue
        var x = (trail.from + 0.5) * cell
        parts.push(h('line', {
          key: 't' + t, x1: x, y1: 0, x2: x, y2: height,
          style: { stroke: laneVar(trail.color) },
        }))
      }
      for (var j = 0; j < joins.length; j += 1) {
        var join = joins[j]
        if (join.from >= cols && join.to >= cols) continue
        var fromX = (Math.min(join.from, cols - 1) + 0.5) * cell
        var toX = (Math.min(join.to, cols - 1) + 0.5) * cell
        var d
        if (join.kind === 'converge') {
          d = 'M' + fromX + ' 0 Q' + fromX + ' ' + (height / 2) + ' ' + toX + ' ' + (height / 2)
        } else {
          d = 'M' + fromX + ' ' + (height / 2) + ' Q' + fromX + ' ' + height + ' ' + toX + ' ' + height
        }
        parts.push(h('path', { key: 'j' + j, d: d, style: { stroke: laneVar(join.color) } }))
      }
      var nodeX = (Math.min(row.lane, cols - 1) + 0.5) * cell
      if (row.fromAbove) {
        parts.push(h('line', {
          key: 'node-up', x1: nodeX, y1: 0, x2: nodeX, y2: height / 2,
          style: { stroke: laneVar(row.color) },
        }))
      }
      parts.push(h('circle', {
        key: 'node', cx: nodeX, cy: height / 2, r: 3.3,
        style: { fill: laneVar(row.color), stroke: 'var(--wx-base)' },
      }))
      var selected = state.selected && state.selected.kind === 'commit' && state.selected.hash === row.full
      return h('div', {
        className: 'wx-graph-row' + (selected ? ' active' : ''),
        title: row.full,
        onClick: function () { props.onSelect(row) },
      },
        h('svg', {
          className: 'wx-graph-svg', width: width, height: height,
          viewBox: '0 0 ' + width + ' ' + height, 'aria-hidden': 'true',
        }, parts),
        h('span', { className: 'wx-hash' }, row.short || String(row.full || '').slice(0, 7)),
        (row.refs && row.refs.length > 0)
          ? h('span', { className: 'wx-refs' }, row.refs.map(function (ref, index) {
            var head = String(ref).indexOf('HEAD') === 0
            var style = head ? undefined : { color: laneVar(row.color) }
            return h('span', { key: 'r' + index, className: 'wx-ref' + (head ? ' head' : ''), style: style, title: ref }, ref)
          }))
          : null,
        h('span', { className: 'wx-subject' }, row.subject || ''),
        h('span', { className: 'wx-author' }, (row.author || '') + ' · ' + (row.date || '')))
    }

    function HistoryPane(props) {
      var state = props.state
      var actions = props.actions
      var graph = state.graph
      var commits = graph && graph.commits ? graph.commits : []
      var filter = String(state.graphFilter || '').trim().toLowerCase()
      var filtered = filter === '' ? commits : commits.filter(function (commit) {
        return String(commit.subject || '').toLowerCase().indexOf(filter) !== -1
          || String(commit.author || '').toLowerCase().indexOf(filter) !== -1
          || String(commit.short || '').toLowerCase().indexOf(filter) !== -1
      })
      var graphCols = 1
      for (var graphIndex = 0; graphIndex < commits.length; graphIndex += 1) {
        graphCols = Math.max(graphCols, commits[graphIndex].width || 1)
      }
      graphCols = Math.min(graphCols, 12)
      return h('div', { className: 'wx-pane' },
        h('div', { className: 'wx-history-head' },
          h('button', {
            type: 'button',
            className: 'wx-toggle' + (state.graphAll ? ' on' : ''),
            title: tr('history.allBranches'),
            onClick: function () { actions.setGraphAll(!state.graphAll) },
          }, h(Icon, { name: 'branch', size: 11 }), h('span', null, state.graphAll ? tr('history.showingAll') : tr('history.showingCurrent'))),
          h('input', {
            className: 'wx-filter',
            value: state.graphFilter,
            placeholder: tr('history.filter'),
            onChange: function (event) { actions.setGraphFilter(event.target.value) },
          }),
          h('span', { className: 'wx-badge' }, tr('history.commitCount', { n: filtered.length }))),
        state.graphLoading && commits.length === 0
          ? h('div', { className: 'wx-loading-row' }, h(Spinner), tr('history.loading'))
          : commits.length === 0
            ? h(EmptyState, { icon: 'history', title: tr('history.empty') })
            : filtered.length === 0
              ? h(EmptyState, { icon: 'history', title: tr('history.noMatch') })
              : h('div', { className: 'wx-graph-list' }, filtered.map(function (row, index) {
                return h(GraphRow, {
                  key: row.full + ':' + index,
                  row: row,
                  state: state,
                  cols: graphCols,
                  onSelect: function (item) { actions.selectCommit(item) },
                })
              })))
    }

    function BranchRow(props) {
      var branch = props.branch
      var busy = props.busy
      return h('div', { className: 'wx-branch-row' },
        h('span', { className: 'wx-branch-icon' }, h(Icon, { name: 'branch', size: 12 })),
        h('span', { className: 'wx-bname', title: branch.name }, branch.name),
        branch.current ? h('span', { className: 'wx-badge brand' }, tr('branches.current')) : null,
        branch.upstream ? h('span', { className: 'wx-badge' }, branch.upstream) : null,
        branch.ahead ? h('span', { className: 'wx-badge' }, tr('branches.ahead', { n: branch.ahead })) : null,
        branch.behind ? h('span', { className: 'wx-badge' }, tr('branches.behind', { n: branch.behind })) : null,
        branch.gone ? h('span', { className: 'wx-badge warn' }, tr('branches.gone')) : null,
        h('span', { className: 'wx-bmeta', title: branch.subject || '' }, branch.subject || ''),
        h('span', { className: 'wx-branch-actions' },
          !branch.current
            ? h(Btn, { label: tr('branches.switch'), small: true, disabled: busy, onClick: function () { props.onSwitch(branch.name) } })
            : null,
          !branch.current && branch.kind === 'local'
            ? h(Btn, { label: tr('branches.delete'), small: true, ghost: true, danger: true, disabled: busy, onClick: function () { props.onDelete(branch.name) } })
            : null))
    }

    function OperationBar(props) {
      var operation = props.operation
      if (!operation || !operation.inProgress) return null
      var label = operation.merge ? tr('operation.merge')
        : operation.rebase ? tr('operation.rebase')
          : operation.cherryPick ? tr('operation.cherryPick')
            : tr('operation.revert')
      return h('div', { className: 'wx-operation-bar' },
        h(Icon, { name: 'warning', size: 13 }),
        h('span', null, label),
        operation.conflicted > 0
          ? h('span', { className: 'wx-badge err' }, tr('operation.conflicts', { n: operation.conflicted }))
          : null,
        h('span', { className: 'wx-spacer' }),
        h(Btn, { label: tr('operation.abort'), small: true, ghost: true, disabled: props.busy, onClick: props.onAbort }),
        h(Btn, { label: tr('operation.continue'), small: true, disabled: props.busy || operation.conflicted > 0, onClick: props.onContinue }))
    }

    function StashSection(props) {
      var state = props.state
      var actions = props.actions
      var stashes = state.snapshot.stashes || []
      return h('div', { className: 'wx-branch-group' },
        h('div', { className: 'wx-group-head' },
          h('span', null, tr('stash.title')),
          h('span', { className: 'wx-group-count' }, String(stashes.length))),
        h('div', { className: 'wx-form-row', style: { paddingBottom: '5px' } },
          h('input', {
            className: 'wx-input',
            value: state.stashMessage,
            placeholder: tr('stash.placeholder'),
            onChange: function (event) { actions.setStashMessage(event.target.value) },
            onKeyDown: function (event) { if (event.key === 'Enter') actions.stashSave() },
          }),
          h(Btn, { label: tr('stash.save'), small: true, disabled: !!state.busy || state.snapshot.status.clean || state.snapshot.status.conflicted.length > 0, onClick: actions.stashSave })),
        stashes.length === 0
          ? h('div', { className: 'wx-hint', style: { padding: '2px 2px 8px' } }, tr('stash.empty'))
          : stashes.map(function (item) {
            return h('div', { key: item.index, className: 'wx-branch-row' },
              h('span', { className: 'wx-branch-icon' }, h(Icon, { name: 'stash', size: 12 })),
              h('span', { className: 'wx-badge' }, 'stash@{' + item.index + '}'),
              h('span', { className: 'wx-bmeta', title: item.message }, item.message || ''),
              h('span', { className: 'wx-branch-actions' },
                h(Btn, { label: tr('stash.pop'), small: true, disabled: !!state.busy, onClick: function () { actions.stashPop(item.index) } }),
                h(Btn, { label: tr('stash.drop'), small: true, ghost: true, danger: true, disabled: !!state.busy, onClick: function () { actions.stashDrop(item.index) } })))
          }))
    }

    function BranchesPane(props) {
      var state = props.state
      var actions = props.actions
      var branches = state.snapshot.branches || []
      var filter = String(state.branchFilter || '').trim().toLowerCase()
      function match(branch) {
        return filter === '' || String(branch.name || '').toLowerCase().indexOf(filter) !== -1
      }
      var locals = branches.filter(function (branch) { return branch.kind === 'local' && match(branch) })
      var remotes = branches.filter(function (branch) { return branch.kind === 'remote' && match(branch) })
      var busy = !!state.busy
      return h('div', { className: 'wx-pane wx-branches' },
        h('div', { className: 'wx-list-head' },
          h('span', { className: 'wx-list-title' }, tr('tabs.branches')),
          h('input', {
            className: 'wx-filter',
            value: state.branchFilter,
            placeholder: tr('branches.search'),
            onChange: function (event) { actions.setBranchFilter(event.target.value) },
          }),
          h(Btn, { icon: 'plus', small: true, ghost: true, title: tr('branches.new'), onClick: function () { actions.setNewBranch(true) } })),
        h(OperationBar, {
          operation: state.snapshot.operation,
          busy: busy,
          onAbort: actions.abortOperation,
          onContinue: actions.continueOperation,
        }),
        state.newBranchOpen
          ? h('div', { className: 'wx-branch-form' },
            h('div', { className: 'wx-form-row' },
              h('input', {
                className: 'wx-input',
                value: state.newBranchName,
                placeholder: tr('branches.newName'),
                autoFocus: true,
                onChange: function (event) { actions.setNewBranchName(event.target.value) },
                onKeyDown: function (event) {
                  if (event.key === 'Enter') actions.createBranch()
                  if (event.key === 'Escape') actions.setNewBranch(false)
                },
              }),
              h('input', {
                className: 'wx-input',
                value: state.newBranchFrom,
                placeholder: tr('branches.from'),
                onChange: function (event) { actions.setNewBranchFrom(event.target.value) },
                onKeyDown: function (event) {
                  if (event.key === 'Enter') actions.createBranch()
                  if (event.key === 'Escape') actions.setNewBranch(false)
                },
              })),
            h('div', { className: 'wx-form-row' },
              h(Btn, { label: tr('branches.create'), small: true, variant: 'primary', disabled: busy || !state.newBranchName.trim(), onClick: actions.createBranch }),
              h(Btn, { label: tr('branches.cancel'), small: true, ghost: true, onClick: function () { actions.setNewBranch(false) } })))
          : null,
        locals.length > 0
          ? h('div', { className: 'wx-branch-group' },
            h('div', { className: 'wx-group-head' }, h('span', null, tr('branches.local')), h('span', { className: 'wx-group-count' }, String(locals.length))),
            locals.map(function (branch) {
              return h(BranchRow, {
                key: 'l:' + branch.name, branch: branch, busy: busy,
                onSwitch: actions.switchBranch, onDelete: actions.deleteBranch,
              })
            }))
          : null,
        remotes.length > 0
          ? h('div', { className: 'wx-branch-group' },
            h('div', { className: 'wx-group-head' }, h('span', null, tr('branches.remote')), h('span', { className: 'wx-group-count' }, String(remotes.length))),
            remotes.map(function (branch) {
              return h(BranchRow, {
                key: 'r:' + branch.name, branch: branch, busy: busy,
                onSwitch: actions.switchBranch, onDelete: actions.deleteBranch,
              })
            }))
          : null,
        locals.length === 0 && remotes.length === 0
          ? h(EmptyState, { icon: 'branch', title: filter !== '' ? tr('branches.noMatch') : tr('branches.empty') })
          : null,
        h(StashSection, { state: state, actions: actions }))
    }
    function CommitCard(props) {
      var info = props.info
      var selected = props.selected
      if (!info) {
        if (props.loading) return h('div', { className: 'wx-loading-row' }, h(Spinner), tr('empty.loading'))
        return null
      }
      return h('div', { className: 'wx-commit-card' },
        h('div', { className: 'wx-commit-subject' }, info.subject || tr('history.commitDiff', { hash: info.short || '' })),
        h('div', { className: 'wx-commit-meta' },
          h('span', null, info.author || ''),
          info.relative ? h('span', null, '· ' + info.relative) : null,
          h('span', { className: 'wx-mono' }, '· ' + (info.short || selected.short || '')),
          info.parents && info.parents.length > 0
            ? h('span', null, '· ' + tr('diff.parents', { parents: info.parents.map(function (hash) { return hash.slice(0, 7) }).join(', ') }))
            : null),
        info.body ? h('div', { className: 'wx-commit-body' }, info.body) : null)
    }

    function inlineSpans(line) {
      if (!line.inline || line.inline.length === 0) return line.text
      return line.inline.map(function (part, index) {
        if (!part.changed) return part.text
        return h('span', { key: 'w' + index, className: 'wx-word ' + (line.kind === 'del' ? 'del' : 'add') }, part.text)
      })
    }

    function HunkView(props) {
      var hunk = props.hunk
      return h('div', null,
        h('div', { className: 'wx-hunk' }, hunk.header),
        h('div', { className: 'wx-hunk-lines' }, hunk.lines.map(function (line, index) {
          var kind = line.kind === 'add' ? 'add' : line.kind === 'del' ? 'del' : ''
          var sign = line.kind === 'add' ? '+' : line.kind === 'del' ? '-' : line.kind === 'meta' ? '\\' : ' '
          return h('div', { key: 'l' + index, className: 'wx-line wx-lline ' + kind },
            h('span', { className: 'wx-ln' }, line.old === undefined ? '' : String(line.old)),
            h('span', { className: 'wx-ln' }, line.new === undefined ? '' : String(line.new)),
            h('span', { className: 'wx-sign' }, sign),
            h('span', { className: 'wx-text' }, inlineSpans(line)))
        })))
    }

    function FileDiff(props) {
      var file = props.file
      var label = file.status === 'A' ? tr('diff.added')
        : file.status === 'D' ? tr('diff.deleted')
          : file.status === 'R' ? tr('diff.renamed')
            : tr('diff.modified')
      var statusClass = file.status === 'A' ? 'a' : file.status === 'D' ? 'd' : file.status === 'R' ? 'r' : ''
      return h('div', { className: 'wx-file-block' },
        props.compact ? null : h('div', { className: 'wx-file-head' },
          h('span', { className: 'wx-file-status ' + statusClass, title: label }, file.status || 'M'),
          h('span', { className: 'wx-mono wx-detail-path', title: file.path }, file.path || ''),
          file.oldPath && file.oldPath !== file.path
            ? h('span', { className: 'wx-file-old' }, '← ' + file.oldPath)
            : null,
          h('span', { className: 'wx-spacer' }),
          h('span', { className: 'wx-badge ok' }, '+' + (file.additions || 0)),
          h('span', { className: 'wx-badge err' }, '-' + (file.deletions || 0))),
        file.binary
          ? h('div', { className: 'wx-binary' }, tr('diff.binary'))
          : file.hunks && file.hunks.length > 0
            ? file.hunks.map(function (hunk, index) {
              return h(HunkView, { key: 'h' + index, hunk: hunk })
            })
            : h('div', { className: 'wx-binary' }, tr('diff.noText')))
    }

    function DiffPane(props) {
      var state = props.state
      var actions = props.actions
      var selected = state.selected
      var diff = state.diff
      if (!selected) {
        return h(React.Fragment, null,
          h('div', { className: 'wx-detail-head' }, h('span', { className: 'wx-detail-title' }, tr('tabs.diff'))),
          h(EmptyState, { icon: 'file', title: tr('empty.noDiff'), hint: tr('empty.noDiffHint') }))
      }
      if (state.diffLoading) {
        return h(React.Fragment, null,
          h('div', { className: 'wx-detail-head' }, h('span', { className: 'wx-detail-title' }, tr('tabs.diff'))),
          h('div', { className: 'wx-loading-row' }, h(Spinner), tr('diff.loading')))
      }
      if (!diff) {
        return h(React.Fragment, null,
          h('div', { className: 'wx-detail-head' }, h('span', { className: 'wx-detail-title' }, tr('tabs.diff'))),
          h(EmptyState, { icon: 'warning', title: tr('error.title'), hint: state.error || tr('diff.noText') }))
      }
      var title = diff.mode === 'commit'
        ? tr('diff.commitHeader', { hash: selected.short || String(selected.hash || '').slice(0, 7) })
        : diff.conflict ? tr('diff.conflict')
          : diff.mode === 'staged' ? tr('diff.staged')
            : diff.mode === 'untracked' ? tr('diff.untracked') : tr('diff.worktree')
      return h(React.Fragment, null,
        h('div', { className: 'wx-detail-head' },
          h('span', { className: 'wx-detail-title' }, title),
          diff.path ? h('span', { className: 'wx-detail-path', title: diff.path }, diff.path) : null,
          h('span', { className: 'wx-spacer' }),
          diff.truncated ? h('span', { className: 'wx-badge warn' }, tr('diff.truncated')) : null,
          h('span', { className: 'wx-badge ok' }, '+' + (diff.additions || 0)),
          h('span', { className: 'wx-badge err' }, '-' + (diff.deletions || 0)),
          diff.conflict
            ? h(Btn, { icon: 'sparkle', label: tr('diff.resolve'), small: true, variant: 'primary', onClick: function () { actions.openConflict({ path: diff.path }) } })
            : null),
        diff.mode === 'commit'
          ? h(CommitCard, {
            info: state.commitInfo,
            loading: state.commitInfoLoading,
            selected: selected,
          })
          : null,
        diff.conflict && (!diff.oursExists || !diff.theirsExists)
          ? h(EmptyState, { icon: 'warning', title: tr('diff.conflictDeleted'), hint: tr('diff.resolve') + ' →' })
          : diff.binary
            ? h('div', { className: 'wx-binary' }, tr('diff.binary'))
            : diff.files && diff.files.length > 0
              ? diff.files.map(function (file, index) {
                return h(FileDiff, { key: 'f' + index, file: file, compact: diff.mode !== 'commit' && diff.files.length === 1 })
              })
              : h(EmptyState, { icon: 'file', title: diff.conflict ? tr('diff.conflictSame') : tr('diff.noText') }))
    }

    function SettingsModal(props) {
      var state = props.state
      var actions = props.actions
      var catalog = state.modelCatalog
      var defaults = catalog && catalog.default ? catalog.default : null
      var [config, setConfig] = useState({
        provider: state.aiConfig.provider,
        model: state.aiConfig.model,
        effort: state.aiConfig.effort,
      })
      var [prompt, setPrompt] = useState(state.snapshot.commitPrompt || '')
      var [autoStash, setAutoStash] = useState(!!state.autoStash)
      var [autoResolve, setAutoResolve] = useState(!!state.autoResolveConflicts)
      var groups = catalog && catalog.groups ? catalog.groups : []
      var chosen = config.provider && config.model ? findModel(catalog, config.provider, config.model) : null
      var efforts = chosen
        ? effortChoices(chosen)
        : (defaults && defaults.efforts ? defaults.efforts.map(function (id) { return { id: id, name: id } }) : [])
      var value = config.provider && config.model ? JSON.stringify([config.provider, config.model]) : ''
      var followLabel = defaults && defaults.label
        ? tr('ai.followSession', { model: defaults.label })
        : tr('ai.followSessionShort')
      function onChangeModel(event) {
        var next = event.target.value
        if (next === '') {
          setConfig({ provider: '', model: '', effort: 'auto' })
          return
        }
        try {
          var pair = JSON.parse(next)
          setConfig({ provider: pair[0], model: pair[1], effort: 'auto' })
        } catch {
          setConfig({ provider: '', model: '', effort: 'auto' })
        }
      }
      function close() { actions.closeSettings() }
      return h('div', {
        className: 'wx-mask',
        onMouseDown: function (event) { if (event.target === event.currentTarget) close() },
      },
        h('div', { className: 'wx-modal', role: 'dialog', 'aria-modal': 'true', 'aria-label': tr('settings.title') },
          h('div', { className: 'wx-modal-head' },
            h('span', { className: 'wx-modal-title' }, tr('settings.title')),
            h('span', { className: 'wx-spacer' }),
            h(Btn, { icon: 'close', small: true, ghost: true, title: tr('settings.cancel'), onClick: close })),
          h('div', { className: 'wx-section-title' }, tr('settings.aiSection')),
          h('div', { className: 'wx-field' },
            h('label', { className: 'wx-field-label' }, tr('ai.model')),
            groups.length === 0
              ? h('div', { className: 'wx-hint' }, catalog && catalog.unavailable ? tr('ai.unavailable') : tr('ai.noModels'))
              : h('select', {
                className: 'wx-select',
                value: value,
                onChange: onChangeModel,
              },
                h('option', { value: '' }, followLabel),
                groups.map(function (group) {
                  return h('optgroup', { key: group.id, label: group.name },
                    group.models.map(function (model) {
                      return h('option', { key: group.id + '/' + model.id, value: JSON.stringify([group.id, model.id]) }, model.name || model.id)
                    }))
                }))),
          h('div', { className: 'wx-field' },
            h('label', { className: 'wx-field-label' }, tr('ai.effort')),
            h('select', {
              className: 'wx-select',
              value: config.effort || 'auto',
              onChange: function (event) { setConfig(Object.assign({}, config, { effort: event.target.value })) },
            },
              h('option', { value: 'auto' }, tr('ai.effortAuto')),
              h('option', { value: 'default' }, tr('ai.effortDefault')),
              efforts.map(function (effort) {
                return h('option', { key: effort.id, value: effort.id }, effortLabel(effort.id, effort.name))
              }))),
          h('div', { className: 'wx-hint' }, tr('ai.hint')),
          catalog && catalog.failures && catalog.failures.length > 0
            ? h('div', { className: 'wx-hint' }, tr('settings.modelsFailed', { message: catalog.failures[0].message || catalog.failures[0].name }))
            : null,
          h('div', { className: 'wx-section-title' }, tr('settings.promptSection')),
          h('textarea', {
            className: 'wx-textarea',
            rows: 4,
            value: prompt,
            placeholder: tr('ai.customPromptHint'),
            onChange: function (event) { setPrompt(event.target.value) },
          }),
          h('div', { className: 'wx-modal-actions' },
            h(Btn, { label: tr('settings.resetPrompt'), small: true, ghost: true, onClick: function () { setPrompt('') } }),
            h('span', { className: 'wx-spacer' }),
            h(Btn, {
              label: state.modelCatalogLoading ? tr('status.loading') : tr('ai.refreshModels'),
              small: true,
              ghost: true,
              disabled: !!state.busy || state.modelCatalogLoading,
              onClick: function () { actions.loadModels(true) },
            })),
          h('div', { className: 'wx-section-title' }, tr('settings.syncSection')),
          h('label', { className: 'wx-switch' },
            h('input', {
              type: 'checkbox',
              checked: autoStash,
              onChange: function (event) { setAutoStash(event.target.checked) },
            }),
            h('span', null, tr('settings.autoStash'))),
          h('div', { className: 'wx-hint' }, tr('settings.autoStashHint')),
          h('label', { className: 'wx-switch' },
            h('input', {
              type: 'checkbox',
              checked: autoResolve,
              onChange: function (event) { setAutoResolve(event.target.checked) },
            }),
            h('span', null, tr('settings.autoResolveConflicts'))),
          h('div', { className: 'wx-hint' }, tr('settings.autoResolveConflictsHint')),
          h('div', { className: 'wx-modal-actions' },
            h(Btn, { label: tr('settings.cancel'), ghost: true, small: true, onClick: close }),
            h(Btn, {
              label: tr('settings.save'),
              variant: 'primary',
              small: true,
              disabled: !!state.busy,
              onClick: function () { actions.saveSettings(config, prompt, autoStash, autoResolve) },
            }))))
    }

    function ConflictModal(props) {
      var state = props.state
      var actions = props.actions
      var conflict = state.conflict
      var info = conflict.info
      var loading = !!conflict.loading
      var busy = !!state.busy
      var suggested = conflict.suggested
      var deleting = !!conflict.delete
      var oursExists = !info || info.oursExists !== false
      var theirsExists = !info || info.theirsExists !== false
      var deletionConflict = !oursExists || !theirsExists
      var lines = suggested ? suggested.replace(/\n$/, '').split('\n') : []
      var visible = lines.slice(0, 600)
      var note
      if (!info) {
        note = loading ? tr('status.loading') : tr('conflict.empty')
      } else if (conflict.loading) {
        note = tr('conflict.generating')
      } else if (deleting) {
        note = tr('conflict.deletePreview') + (conflict.model ? ' · ' + tr('conflict.model', { model: conflict.model }) : '')
      } else if (suggested) {
        note = tr('conflict.preview') + (conflict.model ? ' · ' + tr('conflict.model', { model: conflict.model }) : '')
      } else if (deletionConflict) {
        note = oursExists ? tr('conflict.deletedTheirs') : tr('conflict.deletedOurs')
      } else {
        note = tr('conflict.empty')
      }
      return h('div', {
        className: 'wx-mask',
        onMouseDown: function (event) { if (event.target === event.currentTarget) actions.closeConflict() },
      },
        h('div', { className: 'wx-modal wide', role: 'dialog', 'aria-modal': 'true', 'aria-label': tr('conflict.title') },
          h('div', { className: 'wx-modal-head' },
            h('span', { className: 'wx-modal-title' }, tr('conflict.title')),
            h('span', { className: 'wx-spacer' }),
            h(Btn, { icon: 'close', small: true, ghost: true, title: tr('conflict.close'), onClick: actions.closeConflict })),
          h('div', { className: 'wx-conflict-path' }, conflict.path),
          info && info.branch
            ? h('div', { className: 'wx-hint' }, info.branch + '  ↔  ' + (info.incoming || '?'))
            : null,
          h('div', { className: 'wx-conflict-note' }, note),
          h('input', {
            className: 'wx-input',
            value: state.conflictHint,
            placeholder: tr('conflict.hint'),
            disabled: busy || loading,
            onChange: function (event) { actions.setConflictHint(event.target.value) },
            onKeyDown: function (event) { if (event.key === 'Enter') actions.aiResolve() },
          }),
          h('div', { className: 'wx-modal-actions' },
            h(Btn, {
              icon: 'sparkle',
              label: conflict.loading ? tr('conflict.generating') : (suggested || deleting ? tr('conflict.regenerate') : tr('conflict.ai')),
              small: true,
              variant: 'primary',
              disabled: busy || loading,
              onClick: actions.aiResolve,
            }),
            deletionConflict
              ? h(Btn, { label: tr('conflict.deleteFile'), small: true, danger: true, disabled: busy || loading, onClick: actions.deleteConflict })
              : null,
            info
              ? h(Btn, { label: tr('conflict.markResolved'), small: true, disabled: busy || loading, onClick: actions.markResolved })
              : null,
            oursExists
              ? h(Btn, { label: deletionConflict ? tr('conflict.keepOurs') : tr('conflict.takeOurs'), small: true, disabled: busy || loading, onClick: function () { actions.takeSide('ours') } })
              : null,
            theirsExists
              ? h(Btn, { label: deletionConflict ? tr('conflict.keepTheirs') : tr('conflict.takeTheirs'), small: true, disabled: busy || loading, onClick: function () { actions.takeSide('theirs') } })
              : null),
          (suggested || deleting) && info
            ? h('div', { className: 'wx-modal-actions' },
              h(Btn, {
                label: deleting ? tr('conflict.deleteApply') : tr('conflict.apply'),
                small: true,
                variant: 'primary',
                disabled: busy || loading,
                onClick: actions.applyConflict,
              }),
              h(Btn, { label: tr('conflict.discard'), small: true, ghost: true, disabled: busy, onClick: actions.closeConflict }))
            : null,
          conflict.warning ? h('div', { className: 'wx-hint' }, conflict.warning) : null,
          deleting
            ? h('div', { className: 'wx-preview' },
              h('div', { className: 'wx-preview-line' },
                h('span', { className: 'wx-preview-no' }, '−'),
                h('span', null, tr('conflict.deletePreview'))))
            : suggested
              ? h('div', { className: 'wx-preview' }, visible.map(function (line, index) {
                return h('div', { key: index, className: 'wx-preview-line' },
                  h('span', { className: 'wx-preview-no' }, String(index + 1)),
                  h('span', null, line === '' ? ' ' : line))
              }))
              : null,
          suggested && lines.length > visible.length
            ? h('div', { className: 'wx-hint' }, tr('diff.truncated'))
            : null))
    }

    var HEADER_CSS = `
      .wx-header-btn { display:inline-flex; align-items:center; justify-content:center; width:26px; height:26px; padding:0;
        border:none; border-radius:8px; background:transparent; cursor:pointer; color:var(--dsw-alias-label-secondary);
        transition:background .14s, color .14s; }
      .wx-header-btn:hover { background:var(--dsw-alias-interactive-bg-hover); color:var(--dsw-alias-label-primary); }
      .wx-header-btn:focus-visible { outline:2px solid var(--dsw-alias-state-business-primary); outline-offset:1px; }
      .wx-header-btn svg { display:block; }
    `


    // ------------------------------------------------------------------ apply

    function makeBoundary(fallbackText) {
      function Boundary(props) {
        React.Component.call(this, props)
        this.state = { error: null }
      }
      Boundary.prototype = Object.create(React.Component.prototype)
      Boundary.prototype.constructor = Boundary
      Boundary.getDerivedStateFromError = function (error) { return { error: error } }
      Boundary.prototype.componentDidCatch = function (error) {
        if (typeof console !== 'undefined') console.error('[wdx-git] panel crashed:', error)
      }
      Boundary.prototype.render = function () {
        if (this.state.error) {
          return h('div', { className: 'wx-root' },
            h('style', { key: 'wx-css' }, CSS),
            h(EmptyState, {
              icon: 'warning',
              title: fallbackText,
              hint: this.state.error && this.state.error.message ? this.state.error.message : String(this.state.error),
            }))
        }
        return this.props.children
      }
      return Boundary
    }

    function GuideIcon(props) {
      return h(GitMark, { size: props && props.size ? props.size : 16 })
    }

    exports.inject = ['slots', 'locale', 'sessions', 'sidebarRight', 'sidebarRightTabs']

    exports.apply = function (ctx) {
      var controller = createController()


      ctx.effect(function () {
        return ctx.locale.register(NS, { zh: ZH, en: EN })
      }, 'wdx-git: dictionaries')

      var t = ctx.locale.bind(NS)
      localeT = t
      var Boundary = makeBoundary(t('error.boundary'))

      ctx.effect(function () {
        return ctx.sidebarRightTabs.register({
          id: TAB_ID,
          kind: TAB_KIND,
          priority: 'extension',
          title: function () { return t('panel.title') },
          guide: [{
            order: 34,
            title: function () { return t('panel.title') },
            description: function () { return t('panel.guide') },
            icon: GuideIcon,
          }],
        })
      }, 'wdx-git: right sidebar tab type')

      function GitTabBody(props) {
        var summary = useSessionById(ctx.sessions, props.sessionId)
        return h(Boundary, null,
          h(GitPanel, {
            key: props.sessionId || 'none',
            controller: controller,
            sessionId: props.sessionId,
            summary: summary,
          }))
      }

      ctx.effect(function () {
        return ctx.slots.inject('sidebar.right.pane.tab', function () {
          return ctx.slots.register({
            name: 'sidebar.right.pane.tab',
            key: TAB_ID,
            locale: NS,
          }, GitTabBody)
        })
      }, 'wdx-git: right sidebar tab body')

      function HeaderGitButton() {
        return h(React.Fragment, null,
          h('style', { key: 'wx-header-css' }, HEADER_CSS),
          h('button', {
            type: 'button',
            className: 'wx-header-btn',
            title: t('panel.open'),
            'aria-label': t('panel.open'),
            onClick: function () { ctx.sidebarRight.openTab(TAB_KIND) },
          }, h(GitMark, { size: 16 })))
      }

      ctx.effect(function () {
        return ctx.slots.inject('conversation.session.header.utilities', function () {
          return ctx.slots.register({
            name: 'conversation.session.header.utilities',
            id: 'wdx-git',
            order: 11,
            label: function () { return t('panel.open') },
          }, HeaderGitButton)
        })
      }, 'wdx-git: session header button')
    }

    return module.exports
  },
})
