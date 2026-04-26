# Harness Engineering Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Apply Jihoon's personal harness to NanoClaw v2.0.13 (host + container) without touching source code, so future upstream updates re-apply via a single idempotent script.

**Architecture:** Host edits land in project-tracked `.claude/settings.json` (Stage 1). Container customizations live in two surfaces: per-group runtime data (`groups/dm-with-jihoon/CLAUDE.local.md`, `data/v2-sessions/<id>/.claude-shared/settings.json`, `groups/dm-with-jihoon/container.json`) which are gitignored, and shared skill directories (`container/skills/{tdd-workflow,security-review}/`) which are tracked. A new `scripts/personalize.ts` re-applies the runtime-data and skill stages idempotently after a fresh checkout.

**Tech Stack:** Node 25 + pnpm 10.33.0, TypeScript 5, Vitest, better-sqlite3, Apple Container, Claude Code harness (`.claude/settings.json` hooks/permissions/env).

---

## File Structure

**Created (committed):**
- `scripts/personalize.ts` — replay script
- `scripts/personalize/CLAUDE.local.md` — template for Stage 2
- `scripts/personalize/hooks.json` — template for Stage 3a
- `scripts/personalize.test.ts` — vitest tests for the replay script
- `container/skills/tdd-workflow/SKILL.md` — copied from `~/.claude/skills/tdd-workflow/SKILL.md`
- `container/skills/security-review/SKILL.md` — copied from `~/.claude/skills/security-review/SKILL.md`

**Modified (committed):**
- `.claude/settings.json` — Stage 1 (project-local Claude Code settings)

**Modified (runtime, gitignored — not committed):**
- `groups/dm-with-jihoon/CLAUDE.local.md` — Stage 2 (created from template)
- `data/v2-sessions/ag-1777189827151-4u7joj/.claude-shared/settings.json` — Stage 3a (hooks merged in)
- `groups/dm-with-jihoon/container.json` — Stage 3b (`packages.npm` field updated)

The agent-group ID `ag-1777189827151-4u7joj` is the current install's value (verifiable with `sqlite3 data/v2.db "SELECT id FROM agent_groups WHERE folder='dm-with-jihoon'"`). Steps that need it use a shell substitution that re-reads the DB so the plan stays correct if the ID changes (re-init).

---

## Task 1 — Stage 1: Host harness (`.claude/settings.json`)

**Files:**
- Modify: `.claude/settings.json`

- [ ] **Step 1.1: Read current file**

```bash
cat /Volumes/Dock/nanoclaw/.claude/settings.json
```

Expected output: `{ "sandbox": { "enabled": false } }` (one-line minimal file).

- [ ] **Step 1.2: Write the new settings.json**

Overwrite `/Volumes/Dock/nanoclaw/.claude/settings.json` with the following content (replaces the file in full — `sandbox.enabled: false` is preserved):

```json
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

- [ ] **Step 1.3: Validate JSON**

```bash
jq . /Volumes/Dock/nanoclaw/.claude/settings.json > /dev/null && echo OK
```

Expected: `OK` (no parse error).

- [ ] **Step 1.4: Commit**

```bash
cd /Volumes/Dock/nanoclaw
git add .claude/settings.json
git commit -m "feat: 호스트 하네스 추가 (allowlist + NanoClaw 가드 hooks)"
```

Expected: commit succeeds; `git status` shows clean tree.

- [ ] **Step 1.5: Verify allowlist (manual)**

In a future Claude Code session in this repo, run a `Bash(git status)` tool call. It should NOT prompt for permission (already allowlisted).

- [ ] **Step 1.6: Verify dist guard (manual)**

In a future Claude Code session in this repo, attempt an `Edit` on a path under `dist/`. The PreToolUse hook should print the `[NanoClaw] dist/ is build output …` message and reject the call (exit 1).

These manual checks happen during normal use; do not block the plan on them.

---

## Task 2 — Personalize templates (`scripts/personalize/`)

These templates are the canonical sources for Stages 2 and 3a. Stage 5's `personalize.ts` reads them; Tasks 3 and 4 also copy from them.

**Files:**
- Create: `scripts/personalize/CLAUDE.local.md`
- Create: `scripts/personalize/hooks.json`

- [ ] **Step 2.1: Create the templates directory**

```bash
mkdir -p /Volumes/Dock/nanoclaw/scripts/personalize
```

- [ ] **Step 2.2: Write `scripts/personalize/CLAUDE.local.md`**

Create `/Volumes/Dock/nanoclaw/scripts/personalize/CLAUDE.local.md` with this content:

````markdown
# 작업 원칙 (Jihoon)

## 정체성
- 사용자: Jihoon (sjh880126@gmail.com), GitHub `nocturne-prog`
- 채널: 텔레그램 DM `@nano_nuts_bot`
- 환경: Apple Container 기반 NanoClaw v2, 네이티브 크레덴셜 프록시

## 언어
- 응답은 항상 한국어
- 커밋 메시지는 한국어 (예: `feat: 사용자 인증 기능 추가`)
- 코드 주석과 변수명은 영어

## 기본 기술 스택 (별도 지정 없을 때)
- TypeScript 5 (strict mode), `any` 타입 금지
- React 19, Next.js 16 (App Router)
- Zustand, Tailwind CSS v4
- 패키지 매니저: npm (단, NanoClaw 자체 작업은 pnpm 10.33.0)
- 경로 별칭: `@/*` → `./src/*`

## 코딩 원칙

### 불변성 (필수)
객체 직접 변경 금지. 항상 새 객체 생성:
```typescript
// 금지
function updateUser(user, name) { user.name = name; return user }
// 올바름
function updateUser(user, name) { return { ...user, name } }
```

### 파일 구성
- 작은 파일 다수 > 큰 파일 소수
- 일반적으로 200-400줄, 최대 800줄
- 도메인별 구성 (타입별 X)

### 오류 처리
- 모든 비동기 작업에 `try/catch`
- `console.error`로 로그 + 사용자 친화 메시지로 재던지기

### 입력 검증
- 외부 입력은 `zod` 스키마로 검증
- 내부 함수 인자는 TypeScript 타입에 위임

## 테스트 (TDD 필수)

워크플로우: **RED → GREEN → IMPROVE**
1. 테스트 먼저 작성 (실패 확인)
2. 최소 구현 (테스트 통과)
3. 리팩토링 + 커버리지 80%+ 확인

테스트 종류:
- 단위: 함수/유틸/컴포넌트
- 통합: API/DB
- E2E: Playwright (중요 사용자 흐름)

## Git 워크플로우

### 커밋 메시지
형식: `<type>: <설명>` (한국어)
- 타입: `feat`, `fix`, `refactor`, `docs`, `test`, `chore`, `perf`, `ci`
- 메시지 끝에 어트리뷰션 추가하지 말 것 (전역 비활성화됨)

### PR 생성
- 커밋 히스토리 전체 분석 (최신만 X)
- 포괄적 요약 + 테스트 계획 TODO

### 기능 구현 순서
1. 복잡한 작업은 먼저 계획 (planner 사고방식)
2. TDD로 구현 (RED → GREEN → IMPROVE)
3. 코드 리뷰 통과 (CRITICAL/HIGH 해결 필수)
4. 커밋 + 푸시

## 보안 체크리스트 (커밋 전)
- [ ] 시크릿 하드코딩 없음 (API 키, 토큰, 패스워드)
- [ ] 사용자 입력 검증 (zod)
- [ ] SQL 인젝션 방지 (파라미터화)
- [ ] XSS 방지 (HTML sanitize)
- [ ] 인증/인가 확인
- [ ] 오류 메시지가 민감 데이터 노출 안 함

시크릿은 항상 `.env` + `process.env`. 하드코딩 시 즉시 중단·로테이션.

## 코드 품질 체크리스트
- [ ] 명확한 이름
- [ ] 함수 50줄 이하
- [ ] 파일 800줄 이하
- [ ] 중첩 4레벨 이하
- [ ] 적절한 에러 처리
- [ ] `console.log` 제거
- [ ] 하드코딩 값 없음
- [ ] 객체 변경 없음 (불변 패턴)

## 서브 에이전트 활용

복잡한 작업이면 `superpowers:brainstorming` 스킬 먼저 발동해서 디자인 합의 후 구현.

작업 종류별 서브 에이전트 (사용 가능 시):
- 복잡한 기능/리팩토링 → 계획 단계 사용
- 새 기능/버그 수정 → TDD 가이드 (`tdd-workflow` 스킬)
- 인증/시크릿/API → 보안 리뷰 (`security-review` 스킬)
- 코드 작성 후 → 코드 리뷰 패스
- 빌드 실패 → 빌드 에러 해결

## NanoClaw 자체 작업 시 주의사항

- 패키지 매니저: `pnpm` (npm 아님)
- 컨테이너 런타임: Apple Container (Docker 아님). `docker` 명령 금지.
- 자격증명: 네이티브 프록시 (`src/credential-proxy.ts`) 사용. OneCLI 아님.
- 빌드 파이프라인: `pnpm run build` → `tsc` → `dist/`. `dist/` 직접 편집 금지.
- 마이그레이션: `src/db/migrations/` 추가 시 서비스 재시작 필요
- 컨테이너 변경: `./container/build.sh` 재빌드 후 재시작

## 파일 시스템 메모 작성

- 새 사실/선호/맥락은 적절한 파일에 저장 (이 메모 또는 별도 `<topic>.md`)
- 모든 파일은 이 `CLAUDE.local.md`에서 짧게 참조
- 주제별 파일 ~500줄 넘으면 폴더 + index로 분할
````

- [ ] **Step 2.3: Write `scripts/personalize/hooks.json`**

Create `/Volumes/Dock/nanoclaw/scripts/personalize/hooks.json` with this content (note: this is the full hooks block — Stage 5 merges it into the runtime `.claude-shared/settings.json` while preserving any `env` keys):

```json
{
  "PreToolUse": [
    {
      "matcher": "tool == \"Write\" && tool_input.file_path matches \"^(?!.*\\\\.claude/).*\\\\.(md|txt)$\"",
      "hooks": [{
        "type": "command",
        "command": "input=$(cat); fp=$(echo \"$input\" | jq -r '.tool_input.file_path // \"\"'); case \"$fp\" in *README.md|*CHANGELOG.md|*CLAUDE*.md|*/docs/*) echo \"$input\";; *) echo '[Hook] Avoid creating standalone .md files unless requested. Use existing files or memory.' >&2; exit 1;; esac"
      }]
    }
  ],
  "PostToolUse": [
    {
      "matcher": "(tool == \"Edit\" || tool == \"Write\") && tool_input.file_path matches \".*\\\\.(ts|tsx|js|jsx)$\"",
      "hooks": [{
        "type": "command",
        "command": "input=$(cat); fp=$(echo \"$input\" | jq -r '.tool_input.file_path // \"\"'); if [ -f \"$fp\" ]; then npx --yes prettier@3 --write \"$fp\" 2>/dev/null && echo \"[prettier] $fp\" >&2; fi"
      }]
    },
    {
      "matcher": "(tool == \"Edit\" || tool == \"Write\") && tool_input.file_path matches \".*\\\\.(ts|tsx)$\"",
      "hooks": [{
        "type": "command",
        "command": "input=$(cat); fp=$(echo \"$input\" | jq -r '.tool_input.file_path // \"\"'); dir=$(dirname \"$fp\"); cd \"$dir\" 2>/dev/null && npx --yes -p typescript@5 tsc --noEmit \"$fp\" 2>&1 | head -5 >&2 || true"
      }]
    },
    {
      "matcher": "(tool == \"Edit\" || tool == \"Write\") && tool_input.file_path matches \".*\\\\.(ts|tsx|js|jsx)$\"",
      "hooks": [{
        "type": "command",
        "command": "input=$(cat); fp=$(echo \"$input\" | jq -r '.tool_input.file_path // \"\"'); if [ -f \"$fp\" ] && grep -nE 'console\\\\.log\\\\(' \"$fp\" >/dev/null 2>&1; then echo \"[Warning] console.log found in $fp:\" >&2; grep -nE 'console\\\\.log\\\\(' \"$fp\" | head -3 >&2; fi"
      }]
    }
  ],
  "Stop": [
    {
      "matcher": "true",
      "hooks": [{
        "type": "command",
        "command": "if [ -d /workspace/agent ]; then found=$(grep -rEl --include='*.ts' --include='*.tsx' --include='*.js' --include='*.jsx' 'console\\\\.log\\\\(' /workspace/agent 2>/dev/null | head -3); [ -n \"$found\" ] && echo \"[Stop hook] Files with console.log: $found\" >&2 || true; fi"
      }]
    }
  ]
}
```

- [ ] **Step 2.4: Validate JSON**

```bash
jq . /Volumes/Dock/nanoclaw/scripts/personalize/hooks.json > /dev/null && echo OK
```

Expected: `OK`.

- [ ] **Step 2.5: Commit templates**

```bash
cd /Volumes/Dock/nanoclaw
git add scripts/personalize/CLAUDE.local.md scripts/personalize/hooks.json
git commit -m "feat: 하네스 템플릿 추가 (CLAUDE.local.md, hooks.json)"
```

---

## Task 3 — Stage 2: Apply CLAUDE.local.md to running agent

**Files:**
- Create: `groups/dm-with-jihoon/CLAUDE.local.md` (gitignored — runtime data)

- [ ] **Step 3.1: Verify the agent group folder exists**

```bash
ls /Volumes/Dock/nanoclaw/groups/dm-with-jihoon
```

Expected: lists at least `CLAUDE.md`, `container.json` (created by `/init-first-agent`).

- [ ] **Step 3.2: Copy template into runtime location**

```bash
cp /Volumes/Dock/nanoclaw/scripts/personalize/CLAUDE.local.md /Volumes/Dock/nanoclaw/groups/dm-with-jihoon/CLAUDE.local.md
```

- [ ] **Step 3.3: Verify copy**

```bash
head -5 /Volumes/Dock/nanoclaw/groups/dm-with-jihoon/CLAUDE.local.md
```

Expected:
```
# 작업 원칙 (Jihoon)

## 정체성
- 사용자: Jihoon (sjh880126@gmail.com), GitHub `nocturne-prog`
- 채널: 텔레그램 DM `@nano_nuts_bot`
```

- [ ] **Step 3.4: Restart NanoClaw to pick up the new fragment**

```bash
launchctl kickstart -k gui/$(id -u)/com.nanoclaw
```

Wait ~5 seconds for the service to come back up.

- [ ] **Step 3.5: Verify service health**

```bash
launchctl list | grep nanoclaw
tail -10 /Users/cashew/.local/share/nanoclaw/nanoclaw.log
```

Expected: status `0`, log shows `NanoClaw running` near the end.

- [ ] **Step 3.6: Manual verification via Telegram**

Send `@nuts 짧은 함수 하나 짜서 보여줘` from the user's Telegram chat. Expect:
1. Korean response (language rule applied).
2. Code uses `const`/spread for any state updates (immutability rule applied).
3. No `any` type if the snippet is TypeScript.

If the response is in English or mutates state, the import didn't take — re-check that `CLAUDE.local.md` lives at `groups/dm-with-jihoon/CLAUDE.local.md` and that v2's CLAUDE.md composer ran (look for `Migrated groups to CLAUDE.local.md model` in the log on startup).

- [ ] **Step 3.7: No commit**

`groups/dm-with-jihoon/CLAUDE.local.md` is gitignored by v2 (per-group runtime data). Don't try to add it.

---

## Task 4 — Stage 3a: Apply container hooks to running session

**Files:**
- Modify: `data/v2-sessions/$AG/.claude-shared/settings.json` (gitignored), where `$AG` is the agent-group id.

- [ ] **Step 4.1: Look up agent group id**

```bash
AG=$(sqlite3 /Volumes/Dock/nanoclaw/data/v2.db "SELECT id FROM agent_groups WHERE folder='dm-with-jihoon'")
echo "$AG"
```

Expected: a string like `ag-1777189827151-4u7joj`. Keep this in your shell for the next steps.

- [ ] **Step 4.2: Read current settings.json**

```bash
SHARED=/Volumes/Dock/nanoclaw/data/v2-sessions/$AG/.claude-shared/settings.json
cat "$SHARED"
```

Expected: contains an `env` block with `CLAUDE_CODE_EXPERIMENTAL_AGENT_TEAMS`, `CLAUDE_CODE_ADDITIONAL_DIRECTORIES_CLAUDE_MD`, `CLAUDE_CODE_DISABLE_AUTO_MEMORY`, no `hooks` block.

- [ ] **Step 4.3: Merge hooks block**

```bash
SHARED=/Volumes/Dock/nanoclaw/data/v2-sessions/$AG/.claude-shared/settings.json
jq -s '.[0] * {hooks: .[1]}' "$SHARED" /Volumes/Dock/nanoclaw/scripts/personalize/hooks.json > /tmp/merged-settings.json
mv /tmp/merged-settings.json "$SHARED"
```

`jq -s '.[0] * .[1]'` is a shallow merge — preserves `env` from `$SHARED` and adds `hooks` from the template.

- [ ] **Step 4.4: Verify merge**

```bash
SHARED=/Volumes/Dock/nanoclaw/data/v2-sessions/$AG/.claude-shared/settings.json
jq '{env: .env, hooks_keys: (.hooks | keys)}' "$SHARED"
```

Expected:
```json
{
  "env": { "CLAUDE_CODE_EXPERIMENTAL_AGENT_TEAMS": "1", ... },
  "hooks_keys": ["PostToolUse", "PreToolUse", "Stop"]
}
```

- [ ] **Step 4.5: Force a fresh container spawn so the agent reloads `.claude-shared/settings.json`**

The current container holds the old settings in-memory. Stop it; the host will spawn a new one when the next message arrives.

```bash
container list 2>&1 | grep dm-with-jihoon | awk '{print $1}' | xargs -I{} container stop {} 2>&1
```

Expected: prints the container name (or no output if no live container). The host re-spawns lazily.

- [ ] **Step 4.6: Trigger a container spawn via Telegram**

Send `@nuts 핑` from Telegram. Wait for a reply (Korean acknowledgment). This spawns a new container that loads the new hooks.

- [ ] **Step 4.7: Verify hooks fire (manual)**

Send via Telegram: `@nuts /workspace/agent/scratch.ts 파일에 함수 하나 추가하고 끝에 console.log 하나 넣어줘`.

Then on the host:
```bash
container list 2>&1 | grep dm-with-jihoon | awk '{print $1}' | head -1 | xargs -I{} container logs {} 2>&1 | tail -30
```

Expected to see in the log:
- `[prettier] /workspace/agent/scratch.ts` (auto-format hook)
- `[Warning] console.log found in /workspace/agent/scratch.ts:` followed by the line

If neither line appears, the hooks didn't load — re-check the merged JSON.

- [ ] **Step 4.8: No commit**

Runtime file, gitignored.

---

## Task 5 — Stage 3b: Add prettier/typescript to per-group container image

**Files:**
- Modify: `groups/dm-with-jihoon/container.json` (gitignored)

- [ ] **Step 5.1: Read current container.json**

```bash
cat /Volumes/Dock/nanoclaw/groups/dm-with-jihoon/container.json
```

Expected: a JSON object with at least `mcpServers`, `packages`, `additionalMounts`, `skills`, possibly other fields. The `packages` field looks like `{ "apt": [], "npm": [] }`.

- [ ] **Step 5.2: Update `packages.npm` via jq**

```bash
CFG=/Volumes/Dock/nanoclaw/groups/dm-with-jihoon/container.json
jq '.packages.npm = (.packages.npm + ["prettier@3", "typescript@5"] | unique)' "$CFG" > /tmp/cfg.json
mv /tmp/cfg.json "$CFG"
```

`unique` deduplicates so re-running this step is idempotent.

- [ ] **Step 5.3: Verify**

```bash
jq '.packages.npm' /Volumes/Dock/nanoclaw/groups/dm-with-jihoon/container.json
```

Expected: an array containing both `"prettier@3"` and `"typescript@5"`.

- [ ] **Step 5.4: Trigger image rebuild via a fresh Telegram message**

`buildAgentGroupImage()` runs lazily on the next spawn that detects a packages diff. Force it:

```bash
container list 2>&1 | grep dm-with-jihoon | awk '{print $1}' | xargs -I{} container stop {} 2>&1
```

Then send `@nuts 다시 핑` via Telegram and wait ~30–60 seconds for the per-group image to build (first time only).

- [ ] **Step 5.5: Verify prettier is available inside the container**

```bash
CID=$(container list 2>&1 | grep dm-with-jihoon | awk '{print $1}' | head -1)
container exec "$CID" which prettier tsc 2>&1
```

Expected: paths like `/usr/local/bin/prettier` and `/usr/local/bin/tsc`. If not present, check the host log (`tail /Users/cashew/.local/share/nanoclaw/nanoclaw.log`) for build errors.

- [ ] **Step 5.6: No commit**

Runtime file, gitignored.

---

## Task 6 — Stage 4: Container skills (`tdd-workflow`, `security-review`)

**Files:**
- Create: `container/skills/tdd-workflow/SKILL.md`
- Create: `container/skills/security-review/SKILL.md`

- [ ] **Step 6.1: Confirm source files exist on the host**

```bash
ls ~/.claude/skills/tdd-workflow/SKILL.md ~/.claude/skills/security-review/SKILL.md
```

Expected: both files listed.

- [ ] **Step 6.2: Copy the two skills**

```bash
cd /Volumes/Dock/nanoclaw
mkdir -p container/skills/tdd-workflow container/skills/security-review
cp ~/.claude/skills/tdd-workflow/SKILL.md container/skills/tdd-workflow/SKILL.md
cp ~/.claude/skills/security-review/SKILL.md container/skills/security-review/SKILL.md
```

- [ ] **Step 6.3: Verify**

```bash
ls -la container/skills/tdd-workflow/ container/skills/security-review/
head -3 container/skills/tdd-workflow/SKILL.md
head -3 container/skills/security-review/SKILL.md
```

Expected: each directory contains `SKILL.md`; first line is `---` (YAML front matter).

- [ ] **Step 6.4: Force a fresh spawn so `syncSkillSymlinks` picks up the new skills**

```bash
container list 2>&1 | grep dm-with-jihoon | awk '{print $1}' | xargs -I{} container stop {} 2>&1
```

Send `@nuts 핑` again, wait for response.

- [ ] **Step 6.5: Verify symlinks**

```bash
AG=$(sqlite3 /Volumes/Dock/nanoclaw/data/v2.db "SELECT id FROM agent_groups WHERE folder='dm-with-jihoon'")
ls -la /Volumes/Dock/nanoclaw/data/v2-sessions/$AG/.claude-shared/skills/ | grep -E "tdd-workflow|security-review"
```

Expected: two lines showing symlinks `tdd-workflow -> /app/skills/tdd-workflow` and `security-review -> /app/skills/security-review`.

- [ ] **Step 6.6: Verify the skills are visible inside the container**

```bash
CID=$(container list 2>&1 | grep dm-with-jihoon | awk '{print $1}' | head -1)
container exec "$CID" ls /home/node/.claude/skills/ 2>&1
```

Expected: list includes `tdd-workflow` and `security-review` along with the other skills.

- [ ] **Step 6.7: Commit**

```bash
cd /Volumes/Dock/nanoclaw
git add container/skills/tdd-workflow container/skills/security-review
git commit -m "feat: 컨테이너 코어 스킬 추가 (tdd-workflow, security-review)"
```

---

## Task 7 — Stage 5: `scripts/personalize.ts` with TDD

The personalize script is the only piece with non-trivial logic. Build it test-first.

**Files:**
- Create: `scripts/personalize.ts`
- Create: `scripts/personalize.test.ts`
- Create test fixture (temp dirs created in tests using `os.tmpdir()` — no checked-in fixture data)

### 7A — Test scaffolding

- [ ] **Step 7A.1: Write the test file with the first failing test**

Create `/Volumes/Dock/nanoclaw/scripts/personalize.test.ts` with this content:

```typescript
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'fs';
import os from 'os';
import path from 'path';
import Database from 'better-sqlite3';

import { personalize, resetHarness } from './personalize.js';

interface TestEnv {
  projectRoot: string;
  homeDir: string;
  agentGroupId: string;
}

function setupTestEnv(): TestEnv {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'nanoclaw-personalize-'));
  const home = path.join(root, 'home');
  const project = path.join(root, 'project');

  // Mock host home with the two skills personalize copies from
  fs.mkdirSync(path.join(home, '.claude/skills/tdd-workflow'), { recursive: true });
  fs.mkdirSync(path.join(home, '.claude/skills/security-review'), { recursive: true });
  fs.writeFileSync(path.join(home, '.claude/skills/tdd-workflow/SKILL.md'), '# tdd-workflow source\n');
  fs.writeFileSync(path.join(home, '.claude/skills/security-review/SKILL.md'), '# security-review source\n');

  // Mock project layout
  fs.mkdirSync(path.join(project, 'scripts/personalize'), { recursive: true });
  fs.mkdirSync(path.join(project, 'groups/dm-with-jihoon'), { recursive: true });
  fs.mkdirSync(path.join(project, 'container/skills'), { recursive: true });
  fs.mkdirSync(path.join(project, 'data'), { recursive: true });

  // Templates
  fs.writeFileSync(
    path.join(project, 'scripts/personalize/CLAUDE.local.md'),
    '# 작업 원칙 (Jihoon)\n# template body\n',
  );
  fs.writeFileSync(
    path.join(project, 'scripts/personalize/hooks.json'),
    JSON.stringify({ PreToolUse: [], PostToolUse: [], Stop: [] }),
  );

  // container.json starting state
  fs.writeFileSync(
    path.join(project, 'groups/dm-with-jihoon/container.json'),
    JSON.stringify({ mcpServers: {}, packages: { apt: [], npm: [] }, additionalMounts: [], skills: 'all' }, null, 2),
  );

  // Mock v2 DB with one agent group row
  const dbPath = path.join(project, 'data/v2.db');
  const db = new Database(dbPath);
  db.exec(`
    CREATE TABLE agent_groups (id TEXT PRIMARY KEY, folder TEXT NOT NULL, name TEXT, created_at TEXT);
  `);
  const agId = 'ag-test-1';
  db.prepare('INSERT INTO agent_groups (id, folder, name, created_at) VALUES (?, ?, ?, ?)').run(
    agId,
    'dm-with-jihoon',
    'nuts',
    '2026-04-26T00:00:00Z',
  );
  db.close();

  // Pre-create the .claude-shared dir with an env-only settings.json
  const sharedDir = path.join(project, 'data/v2-sessions', agId, '.claude-shared');
  fs.mkdirSync(sharedDir, { recursive: true });
  fs.writeFileSync(
    path.join(sharedDir, 'settings.json'),
    JSON.stringify({ env: { CLAUDE_CODE_DISABLE_AUTO_MEMORY: '0' } }, null, 2),
  );

  return { projectRoot: project, homeDir: home, agentGroupId: agId };
}

function cleanup(env: TestEnv): void {
  fs.rmSync(path.dirname(env.projectRoot), { recursive: true, force: true });
}

describe('personalize', () => {
  let env: TestEnv;

  beforeEach(() => {
    env = setupTestEnv();
  });

  afterEach(() => {
    cleanup(env);
  });

  it('writes CLAUDE.local.md from template into the agent group folder', () => {
    personalize({ projectRoot: env.projectRoot, homeDir: env.homeDir, folder: 'dm-with-jihoon' });

    const out = fs.readFileSync(
      path.join(env.projectRoot, 'groups/dm-with-jihoon/CLAUDE.local.md'),
      'utf-8',
    );
    expect(out).toContain('작업 원칙 (Jihoon)');
  });
});
```

- [ ] **Step 7A.2: Run the test — expect failure**

```bash
cd /Volumes/Dock/nanoclaw
pnpm exec vitest run scripts/personalize.test.ts 2>&1 | tail -10
```

Expected: FAIL with "Cannot find module './personalize.js'" or similar.

### 7B — Minimal implementation: CLAUDE.local.md copy

- [ ] **Step 7B.1: Create `scripts/personalize.ts` with just enough to pass test 1**

Create `/Volumes/Dock/nanoclaw/scripts/personalize.ts`:

```typescript
/**
 * Personalize a fresh NanoClaw install with Jihoon's harness.
 * Idempotent — safe to re-run after upstream updates.
 *
 * Usage:
 *   pnpm exec tsx scripts/personalize.ts [--folder <name>] [--force] [--reset]
 */
import fs from 'fs';
import os from 'os';
import path from 'path';
import Database from 'better-sqlite3';

interface PersonalizeOptions {
  projectRoot?: string;
  homeDir?: string;
  folder?: string;
  force?: boolean;
}

const DEFAULT_FOLDER = 'dm-with-jihoon';
const SKILL_NAMES = ['tdd-workflow', 'security-review'] as const;
const DEP_PACKAGES = ['prettier@3', 'typescript@5'] as const;

export function personalize(opts: PersonalizeOptions = {}): void {
  const projectRoot = opts.projectRoot ?? process.cwd();
  const homeDir = opts.homeDir ?? os.homedir();
  const folder = opts.folder ?? DEFAULT_FOLDER;

  applyClaudeLocalMd(projectRoot, folder, opts.force === true);
}

export function resetHarness(opts: PersonalizeOptions = {}): void {
  const projectRoot = opts.projectRoot ?? process.cwd();
  const folder = opts.folder ?? DEFAULT_FOLDER;
  const target = path.join(projectRoot, 'groups', folder, 'CLAUDE.local.md');
  if (fs.existsSync(target)) fs.unlinkSync(target);
}

function applyClaudeLocalMd(projectRoot: string, folder: string, force: boolean): void {
  const tmpl = path.join(projectRoot, 'scripts/personalize/CLAUDE.local.md');
  const dst = path.join(projectRoot, 'groups', folder, 'CLAUDE.local.md');
  const tmplBody = fs.readFileSync(tmpl, 'utf-8');

  if (fs.existsSync(dst) && !force) {
    const existing = fs.readFileSync(dst, 'utf-8');
    if (existing !== tmplBody) {
      console.warn(`[personalize] ${dst} differs from template — keeping existing (use --force to overwrite)`);
      return;
    }
  }

  fs.mkdirSync(path.dirname(dst), { recursive: true });
  fs.writeFileSync(dst, tmplBody);
  console.log(`[personalize] wrote ${dst}`);
}
```

- [ ] **Step 7B.2: Run the test — expect pass**

```bash
cd /Volumes/Dock/nanoclaw
pnpm exec vitest run scripts/personalize.test.ts 2>&1 | tail -10
```

Expected: 1 test passing.

### 7C — Hooks merge

- [ ] **Step 7C.1: Add the next failing test**

Append this `it` block to the existing `describe('personalize', …)` in `scripts/personalize.test.ts` (just before the closing `});`):

```typescript
  it('merges hooks into .claude-shared/settings.json while preserving env', () => {
    personalize({ projectRoot: env.projectRoot, homeDir: env.homeDir, folder: 'dm-with-jihoon' });

    const settingsPath = path.join(
      env.projectRoot,
      'data/v2-sessions',
      env.agentGroupId,
      '.claude-shared/settings.json',
    );
    const settings = JSON.parse(fs.readFileSync(settingsPath, 'utf-8'));

    expect(settings.env.CLAUDE_CODE_DISABLE_AUTO_MEMORY).toBe('0');
    expect(settings.hooks).toBeDefined();
    expect(settings.hooks.PreToolUse).toBeDefined();
    expect(settings.hooks.PostToolUse).toBeDefined();
    expect(settings.hooks.Stop).toBeDefined();
  });
```

- [ ] **Step 7C.2: Run — expect failure**

```bash
pnpm exec vitest run scripts/personalize.test.ts 2>&1 | tail -10
```

Expected: 1 pass, 1 fail (`settings.hooks` is `undefined`).

- [ ] **Step 7C.3: Implement hooks merge**

In `scripts/personalize.ts`, add the helper at the bottom:

```typescript
function applyHooks(projectRoot: string, agentGroupId: string): void {
  const tmpl = path.join(projectRoot, 'scripts/personalize/hooks.json');
  const dst = path.join(
    projectRoot,
    'data/v2-sessions',
    agentGroupId,
    '.claude-shared/settings.json',
  );

  if (!fs.existsSync(dst)) {
    console.warn(`[personalize] ${dst} not found — skipping hooks merge (run /init-first-agent first?)`);
    return;
  }

  const hooks = JSON.parse(fs.readFileSync(tmpl, 'utf-8'));
  const settings = JSON.parse(fs.readFileSync(dst, 'utf-8'));
  settings.hooks = hooks;
  fs.writeFileSync(dst, JSON.stringify(settings, null, 2) + '\n');
  console.log(`[personalize] merged hooks into ${dst}`);
}

function findAgentGroupId(projectRoot: string, folder: string): string | null {
  const dbPath = path.join(projectRoot, 'data/v2.db');
  if (!fs.existsSync(dbPath)) return null;
  const db = new Database(dbPath, { readonly: true });
  try {
    const row = db.prepare('SELECT id FROM agent_groups WHERE folder = ?').get(folder) as
      | { id: string }
      | undefined;
    return row?.id ?? null;
  } finally {
    db.close();
  }
}
```

Then update `personalize()` to call `applyHooks` after `applyClaudeLocalMd`:

```typescript
export function personalize(opts: PersonalizeOptions = {}): void {
  const projectRoot = opts.projectRoot ?? process.cwd();
  const homeDir = opts.homeDir ?? os.homedir();
  const folder = opts.folder ?? DEFAULT_FOLDER;

  applyClaudeLocalMd(projectRoot, folder, opts.force === true);

  const agId = findAgentGroupId(projectRoot, folder);
  if (agId) {
    applyHooks(projectRoot, agId);
  } else {
    console.warn(`[personalize] no agent group with folder=${folder} — run /init-first-agent first to enable hooks`);
  }
}
```

- [ ] **Step 7C.4: Run — expect pass**

```bash
pnpm exec vitest run scripts/personalize.test.ts 2>&1 | tail -10
```

Expected: 2 passing.

### 7D — packages.npm update

- [ ] **Step 7D.1: Add the next failing test**

Append to the same `describe`:

```typescript
  it('adds prettier and typescript to container.json packages.npm (idempotent)', () => {
    personalize({ projectRoot: env.projectRoot, homeDir: env.homeDir, folder: 'dm-with-jihoon' });
    personalize({ projectRoot: env.projectRoot, homeDir: env.homeDir, folder: 'dm-with-jihoon' });

    const cfg = JSON.parse(
      fs.readFileSync(path.join(env.projectRoot, 'groups/dm-with-jihoon/container.json'), 'utf-8'),
    );
    expect(cfg.packages.npm).toEqual(expect.arrayContaining(['prettier@3', 'typescript@5']));
    expect(cfg.packages.npm.filter((p: string) => p === 'prettier@3').length).toBe(1);
  });
```

- [ ] **Step 7D.2: Run — expect failure**

```bash
pnpm exec vitest run scripts/personalize.test.ts 2>&1 | tail -10
```

Expected: 2 pass, 1 fail.

- [ ] **Step 7D.3: Implement packages.npm update**

In `scripts/personalize.ts`, add:

```typescript
function applyContainerPackages(projectRoot: string, folder: string): void {
  const cfgPath = path.join(projectRoot, 'groups', folder, 'container.json');
  if (!fs.existsSync(cfgPath)) {
    console.warn(`[personalize] ${cfgPath} not found — skipping packages update`);
    return;
  }

  const cfg = JSON.parse(fs.readFileSync(cfgPath, 'utf-8'));
  cfg.packages = cfg.packages ?? { apt: [], npm: [] };
  cfg.packages.npm = Array.from(new Set([...(cfg.packages.npm ?? []), ...DEP_PACKAGES]));
  fs.writeFileSync(cfgPath, JSON.stringify(cfg, null, 2) + '\n');
  console.log(`[personalize] updated ${cfgPath} packages.npm`);
}
```

Then call it from `personalize()` after the agent-group lookup branch (it doesn't depend on the agent group id):

```typescript
export function personalize(opts: PersonalizeOptions = {}): void {
  const projectRoot = opts.projectRoot ?? process.cwd();
  const homeDir = opts.homeDir ?? os.homedir();
  const folder = opts.folder ?? DEFAULT_FOLDER;

  applyClaudeLocalMd(projectRoot, folder, opts.force === true);
  applyContainerPackages(projectRoot, folder);

  const agId = findAgentGroupId(projectRoot, folder);
  if (agId) {
    applyHooks(projectRoot, agId);
  } else {
    console.warn(`[personalize] no agent group with folder=${folder} — run /init-first-agent first to enable hooks`);
  }
}
```

- [ ] **Step 7D.4: Run — expect pass**

```bash
pnpm exec vitest run scripts/personalize.test.ts 2>&1 | tail -10
```

Expected: 3 passing.

### 7E — Skill copy

- [ ] **Step 7E.1: Add the next failing test**

Append:

```typescript
  it('copies tdd-workflow and security-review skills from home to container/skills', () => {
    personalize({ projectRoot: env.projectRoot, homeDir: env.homeDir, folder: 'dm-with-jihoon' });

    const tddDst = path.join(env.projectRoot, 'container/skills/tdd-workflow/SKILL.md');
    const secDst = path.join(env.projectRoot, 'container/skills/security-review/SKILL.md');
    expect(fs.existsSync(tddDst)).toBe(true);
    expect(fs.existsSync(secDst)).toBe(true);
    expect(fs.readFileSync(tddDst, 'utf-8')).toContain('tdd-workflow source');
  });
```

- [ ] **Step 7E.2: Run — expect failure**

```bash
pnpm exec vitest run scripts/personalize.test.ts 2>&1 | tail -10
```

Expected: 3 pass, 1 fail.

- [ ] **Step 7E.3: Implement skill copy**

In `scripts/personalize.ts`, add:

```typescript
function applySkills(projectRoot: string, homeDir: string): void {
  for (const name of SKILL_NAMES) {
    const src = path.join(homeDir, '.claude/skills', name);
    const dst = path.join(projectRoot, 'container/skills', name);
    if (fs.existsSync(dst)) {
      console.log(`[personalize] skill ${name} already present — skipping`);
      continue;
    }
    if (!fs.existsSync(src)) {
      console.warn(`[personalize] skill source not found: ${src}`);
      continue;
    }
    fs.cpSync(src, dst, { recursive: true });
    console.log(`[personalize] copied skill ${name}`);
  }
}
```

Call it from `personalize()`:

```typescript
export function personalize(opts: PersonalizeOptions = {}): void {
  const projectRoot = opts.projectRoot ?? process.cwd();
  const homeDir = opts.homeDir ?? os.homedir();
  const folder = opts.folder ?? DEFAULT_FOLDER;

  applyClaudeLocalMd(projectRoot, folder, opts.force === true);
  applyContainerPackages(projectRoot, folder);
  applySkills(projectRoot, homeDir);

  const agId = findAgentGroupId(projectRoot, folder);
  if (agId) {
    applyHooks(projectRoot, agId);
  } else {
    console.warn(`[personalize] no agent group with folder=${folder} — run /init-first-agent first to enable hooks`);
  }
}
```

- [ ] **Step 7E.4: Run — expect pass**

```bash
pnpm exec vitest run scripts/personalize.test.ts 2>&1 | tail -10
```

Expected: 4 passing.

### 7F — Reset path

- [ ] **Step 7F.1: Add the failing test**

Append:

```typescript
  it('reset undoes CLAUDE.local.md, hooks, packages, and skills', () => {
    personalize({ projectRoot: env.projectRoot, homeDir: env.homeDir, folder: 'dm-with-jihoon' });
    resetHarness({ projectRoot: env.projectRoot, homeDir: env.homeDir, folder: 'dm-with-jihoon' });

    expect(
      fs.existsSync(path.join(env.projectRoot, 'groups/dm-with-jihoon/CLAUDE.local.md')),
    ).toBe(false);

    const settings = JSON.parse(
      fs.readFileSync(
        path.join(env.projectRoot, 'data/v2-sessions', env.agentGroupId, '.claude-shared/settings.json'),
        'utf-8',
      ),
    );
    expect(settings.hooks).toBeUndefined();
    expect(settings.env.CLAUDE_CODE_DISABLE_AUTO_MEMORY).toBe('0');

    const cfg = JSON.parse(
      fs.readFileSync(path.join(env.projectRoot, 'groups/dm-with-jihoon/container.json'), 'utf-8'),
    );
    expect(cfg.packages.npm).not.toContain('prettier@3');
    expect(cfg.packages.npm).not.toContain('typescript@5');

    expect(fs.existsSync(path.join(env.projectRoot, 'container/skills/tdd-workflow'))).toBe(false);
    expect(fs.existsSync(path.join(env.projectRoot, 'container/skills/security-review'))).toBe(false);
  });
```

- [ ] **Step 7F.2: Run — expect failure**

```bash
pnpm exec vitest run scripts/personalize.test.ts 2>&1 | tail -10
```

Expected: 4 pass, 1 fail (only CLAUDE.local.md is removed by the current `resetHarness`).

- [ ] **Step 7F.3: Implement full reset**

Replace the existing `resetHarness` in `scripts/personalize.ts` with:

```typescript
export function resetHarness(opts: PersonalizeOptions = {}): void {
  const projectRoot = opts.projectRoot ?? process.cwd();
  const folder = opts.folder ?? DEFAULT_FOLDER;

  // 1. CLAUDE.local.md
  const local = path.join(projectRoot, 'groups', folder, 'CLAUDE.local.md');
  if (fs.existsSync(local)) {
    fs.unlinkSync(local);
    console.log(`[personalize] removed ${local}`);
  }

  // 2. Hooks (preserve env)
  const agId = findAgentGroupId(projectRoot, folder);
  if (agId) {
    const settingsPath = path.join(
      projectRoot,
      'data/v2-sessions',
      agId,
      '.claude-shared/settings.json',
    );
    if (fs.existsSync(settingsPath)) {
      const settings = JSON.parse(fs.readFileSync(settingsPath, 'utf-8'));
      delete settings.hooks;
      fs.writeFileSync(settingsPath, JSON.stringify(settings, null, 2) + '\n');
      console.log(`[personalize] dropped hooks from ${settingsPath}`);
    }
  }

  // 3. Packages
  const cfgPath = path.join(projectRoot, 'groups', folder, 'container.json');
  if (fs.existsSync(cfgPath)) {
    const cfg = JSON.parse(fs.readFileSync(cfgPath, 'utf-8'));
    if (cfg.packages?.npm) {
      cfg.packages.npm = cfg.packages.npm.filter((p: string) => !DEP_PACKAGES.includes(p as typeof DEP_PACKAGES[number]));
      fs.writeFileSync(cfgPath, JSON.stringify(cfg, null, 2) + '\n');
      console.log(`[personalize] dropped harness packages from ${cfgPath}`);
    }
  }

  // 4. Skills
  for (const name of SKILL_NAMES) {
    const dst = path.join(projectRoot, 'container/skills', name);
    if (fs.existsSync(dst)) {
      fs.rmSync(dst, { recursive: true });
      console.log(`[personalize] removed skill ${name}`);
    }
  }
}
```

- [ ] **Step 7F.4: Run — expect pass**

```bash
pnpm exec vitest run scripts/personalize.test.ts 2>&1 | tail -10
```

Expected: 5 passing.

### 7G — CLI entrypoint

- [ ] **Step 7G.1: Add CLI handling at the bottom of `scripts/personalize.ts`**

```typescript
function parseArgs(argv: string[]): { folder?: string; force?: boolean; reset?: boolean } {
  const out: { folder?: string; force?: boolean; reset?: boolean } = {};
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--folder') out.folder = argv[++i];
    else if (a === '--force') out.force = true;
    else if (a === '--reset') out.reset = true;
  }
  return out;
}

function printNextSteps(): void {
  console.log('');
  console.log('Next steps:');
  console.log('  ./container/build.sh');
  console.log('  launchctl kickstart -k gui/$(id -u)/com.nanoclaw');
}

// Entrypoint — only runs when invoked directly, not on import.
const isMain = (() => {
  try {
    return import.meta.url === `file://${process.argv[1]}`;
  } catch {
    return false;
  }
})();

if (isMain) {
  const args = parseArgs(process.argv.slice(2));
  if (args.reset) {
    resetHarness({ folder: args.folder });
    console.log('[personalize] reset complete');
  } else {
    personalize({ folder: args.folder, force: args.force });
    printNextSteps();
  }
}
```

- [ ] **Step 7G.2: Smoke-test the CLI on a scratch copy of the live install**

The existing project has a real `dm-with-jihoon` group, so we can dry-test by checking idempotency.

```bash
cd /Volumes/Dock/nanoclaw
pnpm exec tsx scripts/personalize.ts --folder dm-with-jihoon
```

Expected output (some lines may say "already present" or "differs from template — keeping existing" if Tasks 3–6 already created the runtime files):
```
[personalize] wrote /Volumes/Dock/nanoclaw/groups/dm-with-jihoon/CLAUDE.local.md
[personalize] updated …/container.json packages.npm
[personalize] copied skill tdd-workflow
[personalize] copied skill security-review
[personalize] merged hooks into …/.claude-shared/settings.json

Next steps:
  ./container/build.sh
  launchctl kickstart -k gui/$(id -u)/com.nanoclaw
```

(After Tasks 3–6, all files already exist — expect "already present" / "differs from template" notices, no errors.)

Run again to confirm idempotency:
```bash
pnpm exec tsx scripts/personalize.ts --folder dm-with-jihoon
```

Expected: same output as the second-run case (no duplicates added, no errors).

- [ ] **Step 7G.3: Run all tests once more**

```bash
pnpm exec vitest run 2>&1 | tail -10
```

Expected: all tests pass (existing 241 + 5 new = 246 expected, allow for vitest reordering).

### 7H — Build + commit

- [ ] **Step 7H.1: Type check**

```bash
pnpm run build 2>&1 | tail -5
```

Expected: clean build, no errors.

- [ ] **Step 7H.2: Commit**

```bash
cd /Volumes/Dock/nanoclaw
git add scripts/personalize.ts scripts/personalize.test.ts
git commit -m "feat: 하네스 재적용 스크립트 (personalize.ts) + 테스트"
```

---

## Task 8 — Push and document run guide

- [ ] **Step 8.1: Push all commits**

```bash
cd /Volumes/Dock/nanoclaw
git log --oneline origin/main..HEAD
git push origin main
```

Expected: 5 commits to push (Tasks 1, 2, 6, 7H — Task 7 is one commit; verify count matches what was committed).

- [ ] **Step 8.2: Confirm running service still healthy**

```bash
launchctl list | grep nanoclaw
container list 2>&1 | head
tail -5 /Users/cashew/.local/share/nanoclaw/nanoclaw.log
```

Expected: launchctl status `0`, at least one running `nanoclaw-v2-dm-with-jihoon-*` container, log shows recent activity.

- [ ] **Step 8.3: End-to-end verification via Telegram**

Send `@nuts 보안 점검할 코드 있어 — auth.ts에서 sk-ant- 시작하는 토큰 하드코딩 발견됨. 어떻게 처리해?`. Expect:

1. Korean response (Stage 2 rule applied).
2. Mentions of immediate stop / rotation / move to .env (Stage 2 security checklist).
3. May reference `security-review` skill workflow (Stage 4 skill loaded).

Send `@nuts /workspace/agent/notes.md 만들어서 회의 메모 저장해줘`. Expect: blocked or politely refused with a hint to use a memory file (Stage 3a `.md` file blocker).

Send `@nuts /workspace/agent/scratch.ts에 console.log("test") 한 줄 추가해줘`. After response, run on host:
```bash
CID=$(container list 2>&1 | grep dm-with-jihoon | awk '{print $1}' | head -1)
container logs "$CID" 2>&1 | tail -10
```
Expect to see `[prettier]` and `[Warning] console.log` lines (Stage 3a hooks firing).

If any of these fail, jump to the corresponding task's verification step and re-check.

---

## Self-Review Notes

- Stages 2, 3a, 3b, 4 each have a Task that creates the live state AND a Stage 5 (Task 7) that automates re-applying it. Stage 1 is committed and survives via git.
- All `data/v2-sessions/<id>/.claude-shared/settings.json` paths use a shell-substituted `$AG` so the plan stays correct if the agent-group id changes.
- No placeholders, no TODO, no "similar to Task N" — every task has its own complete code/commands.
- Test types align: `applyHooks` reads `hooks.json` then writes `settings.hooks`; `resetHarness` deletes `settings.hooks` (matching the test).
- TDD discipline: each Task 7 sub-task adds a failing test, runs it to confirm failure, then implements minimum code to pass.

## Risks / Mitigations

- **`fs.cpSync` recursive with read-only files** — Task 6 uses simple `cp` for the SKILL.md-only skills; Task 7E uses `fs.cpSync({ recursive: true })` for symmetry. If a future skill carries node_modules with permission quirks, that copy may need a custom recursive walker. Out of scope for this plan since the two skills here are SKILL.md-only.
- **Service must be running for Tasks 4, 5, 6 verifications** — if it isn't, kickstart it (`launchctl kickstart -k gui/$(id -u)/com.nanoclaw`).
- **Per-group image build (Task 5) is slow on first run (~30–60s)** — patience required; pnpm output streams to the container log, not stdout.
