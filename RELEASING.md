# 发布 WDX Git

本文给维护者用。发布分两步：**先发 npm，再让 DSH 安装/更新**。

## 一次性准备

1. 注册 npm 账号并开启 2FA。
2. 登录 npm 官方源（不是 npmmirror，镜像不能发布）：

   ```bash
   npm login --registry=https://registry.npmjs.org/
   npm whoami --registry=https://registry.npmjs.org/
   ```

3. 确认包名可用：

   ```bash
   npm view dsh-wdx-git version --registry=https://registry.npmjs.org/
   ```

   返回 404 才表示可用；如果被占用，把 `package.json` 的 `name` 改成
   `@wdxtub/dsh-wdx-git`，并把本文命令里的包名一起替换。

## 首次发布

先把工作区提交干净（`npm version` 需要干净的工作区）：

```bash
git add .
git commit -m "feat: initial WDX Git release"
npm test
npm pack --dry-run

# 可选但推荐：把 tarball 装进 DSH 走一遍真实安装
npm pack
# 插件页 → 添加插件 → 输入 tarball 的绝对路径 → 安装 → 立即启用

npm run release
git tag -a v0.1.0 -m "v0.1.0"
git push origin main --tags
```

`npm run release` 会做完整流程：检查工作区 / 版本、跑测试、必要时打开浏览器登录，
发布时再打开 2FA 认证页并等待你在浏览器完成验证，最后等 registry 同步。
不想发布时先跑 `npm run release -- --check` 只做预检。

`publishConfig` 已指向 npm 官方源，脚本也显式带 `--registry`，不受本机镜像配置影响。
先发 npm 再打 tag 也可以；tag 只是标记发布对应的代码。

发布后验证：

```bash
npm view dsh-wdx-git version --registry=https://registry.npmjs.org/
```

## 后续版本

语义化版本：

- **patch**：修复 bug、文案、兼容性小修；
- **minor**：新功能，0.x 阶段也用它；
- **major**：破坏性变更。

```bash
git status                       # 必须干净
# 先更新 CHANGELOG.md，并提交它
npm version patch -m "chore: release v%s"
npm run release -- --check       # 可选：先预检
npm run release                  # 浏览器 2FA → 发布 → 等 registry
git push --follow-tags
```

`npm version` 会更新 `package.json`、创建 release commit 和 `vX.Y.Z` tag。
`npm run release` 不自动 commit / tag / push；发布后如需补 tag，再执行
`git tag -a vX.Y.Z -m "vX.Y.Z"`。
在 GitHub 上基于该 tag 建 Release，把 `CHANGELOG.md` 对应段落贴进去即可。
如果 `npm version` 因工作区不干净失败，先提交 CHANGELOG 等改动再重试。

预发布版本：

```bash
npm version 0.2.0-rc.1
npm publish --tag next --access public --registry=https://registry.npmjs.org/
```

验证稳定后再把 `latest` 指过去：

```bash
npm dist-tag add dsh-wdx-git@0.2.0-rc.1 latest --registry=https://registry.npmjs.org/
```

## DSH 里安装新版本

**方式一：插件页**

1. 打开 DSH 侧栏 **插件**；
2. **添加插件** → 输入 `dsh-wdx-git`（或 `dsh-wdx-git@0.1.0`）；
3. 安装源选 npm 官方源；
4. 安装完成后点 **立即启用**。

**方式二：Agent / tool**

```text
plugin_manager: action=install_bundle, target=dsh-wdx-git
```

从 npm 安装的第三方插件会保存精确版本；后续更新在插件详情的「版本」区块检查并更新。
如果当前 DSH 不提供版本区块，就卸载后安装新的精确版本。

**如果你之前用本地目录 `link:` 安装过开发版，或用 tarball 试装过**，插件页会把它视为
已安装，直接安装 npm 包会报 `already-installed`。先在插件页移除 WDX Git，再按上面的
步骤安装 npm 包；本地开发版可以之后用路径重新装回。

发布失败或发现严重问题时，npm 版本号不能复用：

```bash
npm deprecate dsh-wdx-git@0.1.0 "请在 0.1.1 修复后使用" --registry=https://registry.npmjs.org/
```

发布满 72 小时后通常不能再 unpublish，只能发新版本并 deprecate 旧版本。

## 注意

- npm 发布只保证能被「添加插件」按包名安装；**不会自动进入官方“发现”目录**。
  想进入官方目录，需要走 DSH 官方的插件收录/审核流程。
- `engines.dsh` 声明当前包兼容的 DSH 版本；DSH 会在安装前检查，不满足会直接拒绝。
- 第一次发布后，npm 版本号不可复用；有问题的版本只能 deprecate，不能覆盖。
