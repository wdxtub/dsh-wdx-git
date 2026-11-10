# AGENTS.md — WDX Git 维护与发布

本文件给后续维护这个仓库的 agent 使用。目标是让发布可重复，并沿用已经验证过的
**npm 浏览器验证**路径，而不是等一次性验证码。

## 仓库与发布目标

- 仓库：`github.com/wdxtub/dsh-wdx-git`，主分支 `main`。
- npm 包：`dsh-wdx-git`（unscoped，public）。
- npm 账号：`wdxtub`，已开启 `auth-and-writes` 2FA。
- npm 官方源：`https://registry.npmjs.org/`。
- **不要用 npmmirror 发布**；它只是镜像，`npm login` / `npm publish` 都显式带
  `--registry=https://registry.npmjs.org/`。
- 当前 DSH 兼容声明：`engines.dsh: ">=0.2.0 <0.3.0"`；确认 `npm test` 通过后再发布。

## 发布前检查

1. 改 `CHANGELOG.md`，确认 `package.json` 版本号。
2. 跑测试：

   ```bash
   npm test
   npm pack --dry-run
   ```

3. 第一次发布或切换包名时确认名字可用：

   ```bash
   npm view dsh-wdx-git version --registry=https://registry.npmjs.org/
   ```

   404 才表示可用；返回 0.0.0-stage 是 npm 的 staging 占位，不是正式版本。

4. 工作区要干净（`git status`）。`npm version` 依赖这一点。

## 发布：`npm run release`（本仓库的固定方式）

发布走浏览器 2FA，不收集 OTP。整条流程固定在 `scripts/publish-npm.sh`：

```bash
npm run release -- --check   # 预检：工作区、版本、测试、打包、登录
npm run release              # 登录（如需要）→ 浏览器验证 → 发布 → 等 registry 同步
```

`npm run release` 会：

1. 要求工作区干净，并确认 `package.json` 版本尚未发布；
2. 跑 `npm test` 和 `npm pack --dry-run`；
3. `npm whoami` 失败时，用浏览器登录并等待用户完成验证；
4. 用 PTY 跑 `npm publish`；看到 `Press ENTER` 自动回车并打印认证 URL，
   等待用户在浏览器完成 2FA/Passkey，然后自动继续；
5. 认证类失败（401 / E401 / EOTP）自动重新登录并重试一次；
6. 轮询 registry 直到该版本和 `dist-tags.latest` 都能查到，再打印 tarball。

脚本不 commit、不 tag、不 push；这些仍由你确认后执行。

关键点：

- 不要直接非交互运行 `npm publish`：stdin 不是 TTY 时会抛 `EOTP`，auth URL 会被打码。
- 必须给 PTY；`expect` 的 `spawn` 提供它。`scripts/publish-npm.exp` 只匹配
  `Press ENTER` / `+ <包名>@<版本>` / `Published` / `npm error`，不会误杀测试输出。
- 看到 `AUTH_BROWSER_OPENED` / `LOGIN_BROWSER_OPENED` 后，等用户在浏览器完成认证；
  不要另起一个发布进程。
- 如果浏览器没自动打开，从脚本输出里取出 `https://www.npmjs.com/auth/cli/...`
  或 `https://www.npmjs.com/login?...` 让用户手动打开。
- 发布成功后脚本会等 registry 同步；新包第一次可能出现 `0.0.0-stage` 占位。
- `--check` 在版本已发布时会给出警告并继续检查，便于发布后复验环境。

> 2FA 验证码在用户自己的验证器 App 里（1Password / Google Authenticator / Authy 等），
> npm 不会发短信/邮件。不要向用户索要验证码；优先走浏览器认证。只有用户主动提供
> OTP 时才可以用 `npm publish --otp=...`。

## 发布后验证

```bash
npm view dsh-wdx-git dist-tags --json --registry=https://registry.npmjs.org/
npm view dsh-wdx-git@0.1.0 version dist.tarball --registry=https://registry.npmjs.org/
```

必要时下载 tarball 检查 `package.json`：

```bash
url=$(npm view dsh-wdx-git@0.1.0 dist.tarball --registry=https://registry.npmjs.org/)
curl -sL "$url" -o /tmp/dsh-wdx-git.tgz
tar -xOf /tmp/dsh-wdx-git.tgz package/package.json | node -e "let s='';process.stdin.on('data',d=>s+=d).on('end',()=>console.log(JSON.parse(s)))"
```

确认包含：

- `dsh.bundle.patch: "./cordis.patch.yml"`
- `dsh.client`
- `engines.dsh`
- `icon`
- README / assets / locale

## Release commit 与 tag

发布成功后：

```bash
git status
git add .
git commit -m "chore(release): vX.Y.Z"
git tag -a vX.Y.Z -m "vX.Y.Z"
```

- tag 必须指向包含该版本代码的 commit。
- 是否 `git push origin main --tags` 由用户明确决定；不要默认推送。
- 下一次版本用 `npm version patch -m "chore: release v%s"`（先提交 CHANGELOG），
  再按上面的浏览器验证流程发布。

## DSH 安装（仅在用户要求时）

发布不等于自动安装。用户要安装时：

1. 侧栏 **插件** → **添加插件** → `dsh-wdx-git`；
2. 安装源选 **npm 官方源**（镜像可能滞后）；
3. 安装后 **立即启用**。

如果 profile 已经用本地 `link:` 装过 WDX Git，直接安装会 `already-installed`：

```text
plugin_manager: action=remove_bundle, target=dsh-wdx-git
plugin_manager: action=install_bundle, target=dsh-wdx-git
```

不要在用户没要求时移除本地开发版；npm 发布本身不影响 `link:` 安装。

## 发布禁止项

- 不发布 npm 镜像源。
- 不在未跑测试时发布。
- 不把 `.npmrc`、token、OTP、`.DS_Store`、`*.tgz`、`node_modules` 提交进仓库。
- 不重复使用已经发布过的版本号；有问题的版本用 `npm deprecate`，必要时发新版本。
- 不默认 push 或改用户 profile；涉及远端和安装时，先得到用户明确同意。
