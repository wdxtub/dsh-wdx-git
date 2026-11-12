# WDX Git

WDX Git adds a Git panel to the DeepSeek Harness right sidebar. Open it from the
branch icon in the session header, or from **+ → Start → WDX Git** in the right
sidebar. Commit, sync, history, branches, and conflict work stay next to the
session instead of moving to a terminal.

## Sync with one button

The toolbar shows the repository, the current branch, and one sync button. The
button label follows the repository state:

| State | Button |
| --- | --- |
| Nothing to pull or push | Fetch origin |
| Behind the remote | Pull origin |
| Ahead of the remote | Push origin |
| Both sides have new commits | Sync |
| Branch has no upstream | Publish branch |

When the branch is behind or ahead, the button shows count badges with directional
arrows: ↓ for remote commits to pull, ↑ for local commits to push.

A click runs fetch, sets the upstream when needed, fast-forwards or merges, then
pushes when there is something to push. Working-tree changes are stashed before a
merge and restored afterwards. A rejected push is retried once after fetch and
merge. A conflict stops the operation. WDX Git never force-pushes, rebases
automatically, or rewrites existing history.

## All repositories

The **Git** entry in the left sidebar opens the global repository page. It lists
every workspace in the current DSH automatically, grouped by parent folder
(GitHub Desktop style), with the branch, ahead/behind counts, and change count.
The selected repository opens the same commit page on the right: check files,
write a message, sync, and browse history without starting a session in that
project.

![All repositories](images/global.png)

The overview refreshes every 30 seconds, and the toolbar button refreshes it on
demand. A manual refresh spins for at least 650ms, turns into a green check,
and reports how many repositories changed (or that everything is current) in
the rail status line; changed rows highlight for 1.5s. With no session, AI
commit messages use the default model. Workspaces
that are not Git repositories are still listed and marked "Not a Git repository".

## Commit tab

The panel opens on the Commit tab. Summary and description are separate fields,
and every change is checked by default. Uncheck a file to keep it in the working
tree: only the checked paths are staged and committed.

![Commit tab](images/commit.png)

## AI commit messages

One request writes both subject and body: a specific Conventional Commit subject, then
a body at the density of a pull request summary — one sentence of motivation followed
by 2-4 concrete changes, plus test coverage when the diff touches tests. Replies with a
broken format (truncated output, a half sentence subject, or a non-trivial change whose
body is missing, too short or only one sentence) are retried with the reason, up to
three times; after that a commit-ready fallback message is kept. The default model is
the one used by the current session; a different model and reasoning effort can be
configured in settings. The request contains the diff, file list, recent commit titles
and the selected untracked text files for this commit; unchecked files do not appear in
the message.

## Changes, diff, history, and branches

The Changes tab lists modified, added, and deleted files and opens a word-level
diff for the selected file. History shows commit parents, author, time, and
message, with the commit lanes drawn as an SVG graph. Branches lists local and
remote branches and switches or creates branches. Stash saves and restores work
in progress.

![Word-level diff](images/diff.png)

![Commit history](images/history.png)

## Conflicts

When a fetch, merge, rebase, cherry-pick, or revert stops on a conflict, the
Conflicts tab shows ours and theirs. Take one side, ask AI for a merge suggestion
(preview only; nothing is written until you confirm), or use "Resolve all with AI":
the plugin merges and stages each file in turn, splitting large files into conflict
regions, and a failed file does not stop the rest. Settings also has "Resolve conflicts
with AI after sync" (off by default): when enabled, a conflict produced by sync or pull
is processed immediately without asking. You can also edit a file and mark it resolved,
or continue/abort a merge, rebase, cherry-pick, or revert from the panel.

![Conflict resolution](images/conflict.png)

## Local data

Git runs on your machine with your existing credentials, inside the repository
open in the session. The plugin does not store tokens, does not send telemetry,
and does not read your DSH account or GitHub avatar. On macOS it reads the system
HTTP/HTTPS proxy so a DSH started from Finder can still fetch and push; other
platforms use `HTTPS_PROXY`, `HTTP_PROXY`, `ALL_PROXY`, or git's own
`http.proxy`.

## Deliberate limits

- No force push, automatic rebase, or history rewriting.
- No commit signing.
- Staging is per file, not per hunk or line.
- With multiple remotes, `origin` is preferred.
- Nothing is committed in the background.

## Install

In DSH open **Plugins → Add plugin**, enter `dsh-wdx-git`, choose the npm
registry, then enable it. To install from a checkout, run
`dsh plugin --profile <name> add ./dsh-wdx-git`.