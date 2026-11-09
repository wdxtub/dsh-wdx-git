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
- 当前 DSH 兼容声明：`engines.dsh: ">=0.2.0"`；确认 `npm test` 通过后再发布。

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

## 发布：使用浏览器 2FA（本仓库的固定方式）

**不要**直接非交互运行 `npm publish`：stdin 不是 TTY 时会抛 `EOTP`，而且错误里的
auth URL 会被打码，无法继续。

用 PTY + expect 启动发布。脚本会打印认证 URL，停一下等 npm 打开浏览器；按回车后
浏览器打开 npm 认证页，用户完成 2FA/Passkey，npm 自动取到 OTP 并完成发布。

仓库自带脚本 `scripts/publish-npm.exp`，直接运行：

```bash
expect scripts/publish-npm.exp > /tmp/npm-publish-pty.log 2>&1 &
tail -f /tmp/npm-publish-pty.log
```

脚本用 `exp_continue` 持续读到 EOF，再按 npm 退出码和是否看到 `+ dsh-wdx-git`
判定成功，不会在 npm 退出瞬间误报 `spawn id ... not open`。

关键点：

- 必须给 PTY；`expect` 的 `spawn` 提供它。不要用 `printf '\n' | script ...`，
  输入可能在提示出现前就 EOF，npm 会卡在 “Press ENTER”。
- 脚本只匹配 `Press ENTER` / `+ dsh-wdx-git` / `Published` / `npm error`；
  不要匹配泛化的 `error`，测试输出里有测试名带 “error”，会误杀发布。
- 看到 `AUTH_BROWSER_OPENED` 后，等用户在浏览器完成认证。不要重复启动另一个发布。
- 如果浏览器没打开，从日志里取出 `https://www.npmjs.com/auth/cli/...` 让用户手动打开。
- 发布成功后日志里会有类似 `+ dsh-wdx-git` 的 npm 回执和 `PUBLISH_DONE`。
- 新包第一次会出现 `0.0.0-stage` 占位；等约 60 秒，`dist-tags.latest` 才会指向正式版本。

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
