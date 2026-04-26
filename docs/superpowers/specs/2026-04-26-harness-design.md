# NanoClaw Harness Engineering — Design (Jihoon)

- **Date:** 2026-04-26
- **Author:** Jihoon (with Claude Code, brainstorming session)
- **Scope:** Personalize the harness around NanoClaw v2.0.13 (host + container) without making future upstream updates harder.
- **Decision summary:**
  - Mirror Jihoon's global Claude Code rules into the container agent (option 1).
  - Non-interactive hooks only inside the container (option B).
  - Add 4 core skills to the shared container skills directory (option X).
  - Project-local host harness: minimal permissions allowlist + a few NanoClaw-specific guard hooks (option Q).
  - Sequential rollout: host → container CLAUDE.local.md → container hooks → container skills (approach 2).

## Goals

1. Container agent (`@nuts` over Telegram) behaves consistently with Jihoon's global development conventions: Korean responses, immutability, TDD, conventional commits in Korean, security checklist, etc.
2. Reduce friction in the host development environment with a permissions allowlist plus a small set of NanoClaw-specific guards (block `dist/` edits, warn on raw v2.db writes, remind to rebuild/restart at the right moments).
3. **Make the next NanoClaw upstream update painless.** This iteration's pain came from source-code customizations (`src/credential-proxy.ts`, `src/container-runtime.ts`, etc.). Harness work must add **zero source-code edits**, so the only update friction in future is rebuilding container images and re-running an idempotent `personalize.ts` script.

## Non-Goals

- Bridging container hooks to interactive Telegram prompts (option C, rejected — too high implementation cost for the marginal value).
- Editing `container/Dockerfile` for prettier / typescript installation (handled via `container.json` `packages.npm`, which v2 already supports through `buildAgentGroupImage()`).
- Migrating the v1 message history into v2 schema (already decided: fresh start; backups exist at `/Volumes/Dock/nanoclaw-backup-20260426-163153`).

## Update-Friendly Architecture

Harness changes touch only the following surfaces. Source code (`src/**`) and Dockerfile remain unmodified by this design.

| Stage | File | Git-tracked? | Upstream conflict risk |
|------|------|--------------|------------------------|
| 1. Host hooks | `/.claude/settings.json` | yes | low (small file, upstream rarely changes it) |
| 2. Container behavior rules | `groups/dm-with-jihoon/CLAUDE.local.md` | no (gitignored) | **none** (runtime data) |
| 3a. Container hooks | `data/v2-sessions/<id>/.claude-shared/settings.json` | no (gitignored) | **none** (runtime data) |
| 3b. Container deps (prettier, tsc) | `groups/dm-with-jihoon/container.json` `packages.npm` | no (gitignored) | **none** (config, not source) |
| 4. Container skills | `container/skills/{tdd-workflow,security-review,browse,qa}/` | yes (new directories) | low (new dir names; upstream is unlikely to ship the same names) |

Total source-code edits: **0**. Total Dockerfile edits: **0**.

A separate `scripts/personalize.ts` (also new) re-applies stages 2, 3a, 3b, 4 idempotently after a `git reset --hard upstream/<future>`.

```
┌──────────────────────── Host (this dev shell) ─────────────────────────┐
│ /Volumes/Dock/nanoclaw/                                                │
│ ├── .claude/                                                           │
│ │   └── settings.json    [Stage 1: allowlist + NanoClaw guards]        │
│ ├── scripts/personalize.ts   [Stage 5: replay script]                  │
│ ├── docs/superpowers/specs/2026-04-26-harness-design.md  (this doc)    │
│ └── container/skills/                                                  │
│     ├── tdd-workflow/  ← Stage 4 (new, copied from ~/.claude/skills)   │
│     ├── security-review/                                               │
│     ├── browse/                                                        │
│     └── qa/                                                            │
└────────────────────────────────────────────────────────────────────────┘
                                │
                  spawned at runtime by container-runner.ts
                                │
┌─────────────────── Container (`@nuts` agent) ──────────────────────────┐
│ /workspace/agent (= host groups/dm-with-jihoon, RW bind)               │
│ ├── CLAUDE.local.md   [Stage 2: behavior rules — auto-imported]        │
│ └── container.json    [Stage 3b: packages.npm = prettier, typescript]  │
│ /home/node/.claude (= host data/v2-sessions/<id>/.claude-shared, RW)   │
│ ├── settings.json     [Stage 3a: hooks merged in, env preserved]       │
│ └── skills/                                                            │
│     ├── tdd-workflow → /app/skills/tdd-workflow                        │
│     ├── security-review → /app/skills/security-review                  │
│     ├── browse → /app/skills/browse                                    │
│     └── qa → /app/skills/qa                                            │
│ /app/skills (= host container/skills, RO bind, runtime mount)          │
└────────────────────────────────────────────────────────────────────────┘
```

## Stage 1 — Host harness (`/.claude/settings.json`)

Project-local Claude Code settings. Sandbox stays disabled (existing). Adds an allowlist for ~25 frequent NanoClaw commands plus four guard hooks.

```jsonc
{
  "sandbox": { "enabled": false },
  "permissions": {
    "allow": [
      "Bash(pnpm install*)",
      "Bash(pnpm run build*)",
      "Bash(pnpm exec vitest*)",
      "Bash(pnpm exec tsc*)",
      "Bash(container list*)",
      "Bash(container ls*)",
      "Bash(container logs*)",
      "Bash(container stop*)",
      "Bash(container exec*)",
      "Bash(launchctl list*)",
      "Bash(launchctl kickstart*)",
      "Bash(launchctl load*)",
      "Bash(launchctl unload*)",
      "Bash(tail -*)",
      "Bash(sqlite3 *:*)",
      "Bash(git status*)",
      "Bash(git log*)",
      "Bash(git diff*)",
      "Bash(git show*)",
      "Bash(./container/build.sh*)",
      "Bash(jq *)",
      "Bash(grep *)",
      "Bash(rg *)",
      "Bash(find *)",
      "Bash(ls *)"
    ]
  },
  "hooks": {
    "PreToolUse": [
      {
        "matcher": "tool == \"Edit\" && tool_input.file_path matches \"dist/.*\"",
        "hooks": [{
          "type": "command",
          "command": "echo '[NanoClaw] dist/ is build output — edit src/ instead, then run pnpm run build' >&2; exit 1"
        }]
      },
      {
        "matcher": "tool == \"Bash\" && tool_input.command matches \"sqlite3.*data/v2\\\\.db.*(INSERT|UPDATE|DELETE|DROP|ALTER)\"",
        "hooks": [{
          "type": "command",
          "command": "echo '[NanoClaw] Direct write to v2.db detected — prefer running through host code or a migration. Continue?' >&2"
        }]
      }
    ],
    "PostToolUse": [
      {
        "matcher": "tool == \"Bash\" && tool_input.command matches \"^pnpm install\"",
        "hooks": [{
          "type": "command",
          "command": "echo '[NanoClaw] Reminder: run `pnpm run build` after install' >&2"
        }]
      },
      {
        "matcher": "tool == \"Edit\" && tool_input.file_path matches \"container/.*\"",
        "hooks": [{
          "type": "command",
          "command": "echo '[NanoClaw] container/ changed — rebuild image with `./container/build.sh`' >&2"
        }]
      },
      {
        "matcher": "tool == \"Write\" && tool_input.file_path matches \"src/db/migrations/.*\"",
        "hooks": [{
          "type": "command",
          "command": "echo '[NanoClaw] New migration — restart service to apply: launchctl kickstart -k gui/$(id -u)/com.nanoclaw' >&2"
        }]
      }
    ]
  }
}
```

## Stage 2 — Container behavior rules (`groups/dm-with-jihoon/CLAUDE.local.md`)

A condensed mirror of `~/.claude/CLAUDE.md` + `~/.claude/rules/*.md`, tuned for the container context (Telegram DM, not host CLI). The v2 CLAUDE.md composer auto-imports `CLAUDE.local.md`.

Sections (~150 lines total):

1. Identity (Jihoon, Telegram channel, Apple Container + native proxy environment)
2. Language: Korean responses; Korean conventional commits; English code identifiers/comments
3. Default tech stack (TypeScript 5 strict, no `any`; React 19 + Next.js 16 App Router; Zustand; Tailwind v4; npm — except NanoClaw itself which uses pnpm 10.33.0; `@/*` alias)
4. Coding principles: immutability (always new objects), file-size targets (200–400 typical, 800 max), error handling (`try/catch` + user-friendly rethrow), zod for external input
5. Testing: TDD RED → GREEN → IMPROVE workflow, 80%+ coverage, unit/integration/E2E
6. Git: Korean conventional commit format, no attribution footer (globally disabled), comprehensive PR summaries, feature workflow (plan → TDD → review → commit)
7. Security checklist (no hardcoded secrets, input validation, SQLi/XSS prevention, auth/authz checks, sensitive-data leak guard)
8. Code quality checklist (clear names, function ≤50 lines, file ≤800 lines, nesting ≤4, error handling, no `console.log`, no hardcoded values, no mutation)
9. Sub-agent guidance: invoke `superpowers:brainstorming` for complex work; use planning / TDD / code-review / security-review / build-fix sub-agents when applicable
10. NanoClaw-specific gotchas: pnpm not npm, Apple Container not Docker (no `docker` commands), native credential proxy (not OneCLI), no editing `dist/`, migration triggers a service restart, container changes need rebuild
11. Filesystem memory practices: store new facts in this file or topic files, reference all topic files from this `CLAUDE.local.md`, split files >500 lines

The canonical body lives at `scripts/personalize/CLAUDE.local.md` once Stage 5 is implemented; the implementation plan writes the file there first, then either `personalize.ts` copies it or the implementer copies it directly during Stage 2.

## Stage 3 — Container hooks + dependencies

### 3a. `data/v2-sessions/<id>/.claude-shared/settings.json`

Existing `env` block is preserved. A `hooks` block is merged in:

- **PreToolUse** — block creating new freestanding `.md`/`.txt` files outside an allowlist (README, CHANGELOG, CLAUDE*, anything under `docs/`).
- **PostToolUse on .ts/.tsx/.js/.jsx edit** — run `npx --yes prettier@3 --write` on the file (auto-format).
- **PostToolUse on .ts/.tsx edit** — run `npx --yes -p typescript@5 tsc --noEmit` on the file (type check, output truncated to 5 lines).
- **PostToolUse on .ts/.tsx/.js/.jsx edit** — grep for `console.log(` and warn (≤3 lines).
- **Stop hook** — recursive grep for `console.log(` under `/workspace/agent`, list up to 3 files.

The canonical hooks JSON lives at `scripts/personalize/hooks.json` once Stage 5 is implemented; the merge logic preserves the existing `env` block.

### 3b. `groups/dm-with-jihoon/container.json` `packages.npm`

```json
{
  "packages": {
    "apt": [],
    "npm": ["prettier@3", "typescript@5"]
  }
}
```

`buildAgentGroupImage()` (in `src/container-runner.ts`) detects this and produces a per-group image layered on the base. First spawn after a packages change does the rebuild; subsequent spawns reuse the image. The hooks above use `npx --yes` as a fallback so they degrade gracefully if the per-group image hasn't been rebuilt yet.

## Stage 4 — Container skills

Copy 4 directories from `~/.claude/skills/` into `container/skills/`:

- `tdd-workflow/` — guides the TDD workflow when implementing features
- `security-review/` — security checklist for auth/secrets/API/payment work
- `browse/` — headless browser for QA + research
- `qa/` — systematic web app QA testing (depends on browse; setup-browser-cookies is intentionally not copied because host-OS cookie access doesn't apply inside a container — auth-page QA is therefore limited)

`container/skills/` is bind-mounted RO at `/app/skills` by `container-runner.ts:305-311`. v2 `syncSkillSymlinks()` then symlinks each into `.claude-shared/skills/` based on `container.json`'s `skills: 'all' | string[]` (default `'all'`). No Dockerfile edit, no image rebuild.

The four skills are copied verbatim from the host's `~/.claude/skills/<name>/`. Helper scripts inside those skill directories come along automatically.

## Stage 5 — `scripts/personalize.ts` (idempotent replay)

Single-run script that re-applies Stages 2, 3a, 3b, 4 to a fresh checkout. Stage 1 is git-tracked and survives via `git`.

CLI:
```
pnpm exec tsx scripts/personalize.ts [--folder <agent-group-folder>] [--reset]
```

Behavior:

1. Resolve agent group folder (default `dm-with-jihoon`). Discover the agent group ID by reading `data/v2.db` (`SELECT id FROM agent_groups WHERE folder = ?`). If the row doesn't exist yet (fresh install before `/init-first-agent`), skip Stages 3a (cannot locate `.claude-shared`) but still apply Stages 2, 3b, 4 — print a notice asking the user to run `/init-first-agent` first, then re-run the script.
2. Read the bundled `CLAUDE.local.md` template (kept in `scripts/personalize/CLAUDE.local.md`) and write it to `groups/<folder>/CLAUDE.local.md`. Default behavior when an existing file differs: skip with a warning (non-interactive safe). `--force` overwrites unconditionally.
3. Read `data/v2-sessions/<id>/.claude-shared/settings.json`. Merge in the `hooks` block from a bundled template (`scripts/personalize/hooks.json`). Preserve any existing `env` keys.
4. Read `groups/<folder>/container.json`. Ensure `packages.npm` contains `prettier@3` and `typescript@5` (deduplicated). Write back if changed.
5. For each of the 4 core skill names, copy `~/.claude/skills/<name>/` → `container/skills/<name>/` if the destination is missing.
6. Print a "next steps" block: `./container/build.sh && launchctl kickstart -k gui/$(id -u)/com.nanoclaw`.

`--reset` removes the harness from all five places (revert `CLAUDE.local.md`, drop the `hooks` block, drop the two npm packages, delete the four skill dirs). Useful for clean retries.

The script is plain `tsx` — no NanoClaw runtime imports, so it can run on any fresh checkout.

## Verification

Per-stage acceptance criteria:

- **Stage 1:** `Bash(git status)` doesn't prompt for permission. `Edit dist/index.js` is blocked by the PreToolUse exit-1 hook.
- **Stage 2:** After service restart, sending "지금 시간 알려줘" via Telegram returns Korean. Asking for a sample function returns immutable code (spread, no mutation).
- **Stage 3a:** Asking the agent to create a `.ts` file with `console.log` triggers `[prettier]` and `[Warning] console.log` lines in the container log. Asking for a freestanding random `.md` file is blocked.
- **Stage 3b:** First spawn after the packages.npm change builds a per-group image. `container exec <id> which prettier` finds it.
- **Stage 4:** `container exec <id> ls /home/node/.claude/skills/` lists the 4 new skill names. Asking for a TDD-style implementation invokes `tdd-workflow`.

## Rollback

Stages are independent. Per-stage rollback:

- Stage 1: `git checkout HEAD -- .claude/settings.json` (or `git revert <commit>`).
- Stage 2: delete `groups/dm-with-jihoon/CLAUDE.local.md`, or restore from backup.
- Stage 3a: delete the `hooks` field from `.claude-shared/settings.json`, keep `env`.
- Stage 3b: empty the `packages.npm` array; the next spawn falls back to the base image.
- Stage 4: `rm -rf container/skills/{tdd-workflow,security-review,browse,qa}`.
- Full reset: `pnpm exec tsx scripts/personalize.ts --reset`.

## Migration plan for the next upstream update

**Minor update (v2.0.x → v2.0.y):**
```
git fetch upstream && git merge upstream/main
pnpm install && pnpm run build
pnpm exec tsx scripts/personalize.ts
./container/build.sh
launchctl kickstart -k gui/$(id -u)/com.nanoclaw
```

**Major update (v2 → v3) — same fresh-start path as this iteration:**
```
git fetch upstream
# Backup
cp -r data store groups /Volumes/Dock/nanoclaw-backup-$(date +%F)
# Reset
git reset --hard upstream/main
pnpm install && pnpm run build
# Re-apply ecosystem skills (whatever v3 ships; equivalents of these for now):
#   /convert-to-apple-container
#   /use-native-credential-proxy
#   /add-telegram
#   /init-first-agent
# Then harness:
pnpm exec tsx scripts/personalize.ts
./container/build.sh
launchctl kickstart -k gui/$(id -u)/com.nanoclaw
```

The harness adds **zero source-code edits**, so the additional cost over a vanilla update is `personalize.ts` (a few seconds).

## Implementation order

```
1. Stage 1 (host settings.json)              → verify allowlist + dist guard → commit
2. Stage 2 (CLAUDE.local.md)                  → restart container, verify behavior → commit
3. Stage 3a (container hooks settings.json)   → trigger via Telegram, verify hook output → commit
4. Stage 3b (container.json packages.npm)     → spawn container, verify per-group image build
5. Stage 4 (4 skill directories)              → verify symlinks, ls /home/node/.claude/skills → commit
6. Stage 5 (scripts/personalize.ts)           → dry-run --reset on a scratch group → commit
7. This design doc                            → committed (c4ba0df)
```

Each stage committed separately; failure in one rolls back without touching the others.

## Open questions / future work

- The `browse` and `qa` skills assume Playwright is available inside the container. The `agent-browser` shared skill suggests it is, but to be confirmed during Stage 4 verification. If not, add `playwright` to `container.json` `packages.npm`.
- `CLAUDE.local.md` references "sub-agents" by behavior, not by name — Claude Code subagents inside the v2 container are governed by `CLAUDE_CODE_EXPERIMENTAL_AGENT_TEAMS=1`, distinct from the host-side `~/.claude/agents/` directory. If we later want named sub-agents, that's a separate follow-up.
- A second agent group on a different channel (WhatsApp, Slack) would need its own `personalize.ts --folder <name>` invocation. The script supports it; not exercised in v1 of this design.
