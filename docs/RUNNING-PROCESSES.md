# 실행 중인 프로세스 — 종료 금지 목록

이 문서는 NanoClaw가 살아있을 때 동시에 떠 있는 프로세스/컨테이너/포트 인벤토리입니다.
**여기 적힌 것을 함부로 `kill`, `container stop`, `launchctl unload` 하지 마세요.** 사용자 텔레그램 봇이 죽고 진행 중인 에이전트 세션이 끊깁니다.

이 문서는 프로젝트 루트 `CLAUDE.md`에서 참조됩니다 — 모든 Claude Code 세션이 자동으로 이 컨텍스트를 받습니다.

---

## 항상 살아있어야 하는 것들

### 1. launchd 서비스 `com.nanoclaw`

- **확인:** `launchctl list | grep nanoclaw` → `<PID> 0 com.nanoclaw`
- **무엇:** NanoClaw 호스트 오케스트레이터 (`node dist/index.js`)
- **금지:** `launchctl unload ~/Library/LaunchAgents/com.nanoclaw.plist` (사용자가 명시적으로 정지 요청한 경우 외)
- **재시작 (안전):** `launchctl kickstart -k gui/$(id -u)/com.nanoclaw` — 빌드/마이그레이션 적용 후 사용

### 2. 메인 Node 프로세스 (PID는 매번 바뀜)

- **확인:** `ps -ef | grep "node dist/index.js" | grep -v grep`
- **무엇:** Telegram 폴링 + DB 게시판 라우터 + 컨테이너 spawn 매니저
- **LISTEN 포트 2개 (둘 다 PID = 위 메인 프로세스):**
  - `:3000` — Telegram 웹훅 서버
  - `:3001` — 크레덴셜 프록시 (`ANTHROPIC_BASE_URL=http://192.168.64.1:3001`)
- **금지:** `kill <PID>`, `kill -9 <PID>`. launchd가 `KeepAlive`로 즉시 재시작하지만 진행 중 세션이 끊김.
- **재시작:** 위 #1의 `kickstart` 사용.

### 3. Apple Container 시스템 + `buildkit` 컨테이너

- **확인:** `container system status` → `running`. `container list` → `buildkit running 192.168.64.x/24`.
- **무엇:** Apple Container 자체 빌더. 그룹별 이미지 빌드(`buildAgentGroupImage`) 시 사용.
- **금지:** `container system stop`, `container stop buildkit`, `container delete buildkit`.
- **추가 정보:** `bridge100` 인터페이스(`192.168.64.1`)는 Apple Container 시스템이 떠있을 때만 존재. 인터페이스가 사라지면 크레덴셜 프록시도 unreachable.

---

## 일시적으로 살아있다가 사라지는 것들 (정상 동작)

### 4. 에이전트 컨테이너 `nanoclaw-v2-<folder>-<timestamp>`

- **확인:** `container list | grep nanoclaw-v2-`
- **무엇:** 텔레그램 메시지 도착 시 lazy-spawn되는 에이전트 세션. Bun + agent-runner. 30분 idle 후 자동 종료.
- **언제 stop OK:** 새 설정(예: hooks, packages, skills)을 다음 spawn에 반영하려고 강제 재시작할 때 — `container stop <name>` 안전. 호스트가 lazy하게 다음 메시지에 다시 spawn함.
- **언제 stop 금지:** 현재 활성 텔레그램 대화 중일 때(사용자가 답을 기다리는 중). 의심되면 사용자에게 먼저 물어보세요.

### 5. `container-runtime-linux` 호스트 측 프로세스

- **확인:** `ps -ef | grep container-runtime-linux | grep -v grep`
- **무엇:** Apple Container의 호스트 측 supervisor (각 컨테이너마다 하나). 컨테이너 stopped 후에도 잠시 잔여하다 사라짐.
- **금지:** 직접 kill. `container stop` / `container delete`로 컨테이너를 정리하면 자연 정리됨.

---

## 안전하게 만질 수 있는 것

- **stopped 컨테이너 정리:** `container delete <id>` — 디스크 회수.
- **사용 안 하는 옛 이미지 삭제:** `container image delete <name:tag>` — 단, `nanoclaw-agent-v2-<install-slug>:latest` (현재 v2 베이스)와 `node:22-slim` (Dockerfile FROM)은 절대 삭제 금지.
- **로그 회전:** `/Users/cashew/.local/share/nanoclaw/nanoclaw.{log,error.log}` — 큰 경우 `truncate` 가능 (서비스 영향 없음).
- **그룹별 런타임 데이터 (`groups/<folder>/CLAUDE.local.md`, `data/v2-sessions/<id>/.claude-shared/settings.json`, `groups/<folder>/container.json`):** 사용자가 명시적으로 요청하면 수정 OK. 단, `personalize.ts`로 재적용 가능한지 확인.

---

## 흐름 요약

```
[Telegram 메시지 도착]
    ↓ (long polling)
PID <node>:3000 webhook → router → DB 큐
    ↓
buildkit (필요 시 그룹 이미지 빌드)
    ↓ (lazy spawn)
nanoclaw-v2-<folder>-<timestamp> 컨테이너 (Bun + agent-runner)
    ↓ (HTTPS)
컨테이너 → host:3001 (크레덴셜 프록시)
    ↓
프록시 → api.anthropic.com (.env의 OAuth/API 키 주입)
    ↓
응답 → outbound DB → PID <node> → Telegram
```

이 흐름의 어느 단계든 끊으면 사용자 채팅이 깨집니다.

---

## 빠른 헬스 체크

```bash
launchctl list | grep nanoclaw                   # 호스트 서비스
container system status                          # Apple Container 시스템
container list 2>&1 | grep -E "buildkit|nanoclaw" # 살아있는 컨테이너
lsof -nP -iTCP:3000 -sTCP:LISTEN                 # 웹훅 포트
lsof -nP -iTCP:3001 -sTCP:LISTEN                 # 크레덴셜 프록시 포트
tail -5 /Users/cashew/.local/share/nanoclaw/nanoclaw.log
```

각 줄이 정상 출력이면 NanoClaw 살아있음. 하나라도 비어있으면 진단 필요.

---

## 관련 메모

- 재부팅 후 vmnet 인터페이스 부재 이슈는 `~/.local/bin/nanoclaw-launcher.sh`의 더미 컨테이너 부트스트랩으로 해결됨.
- 하네스 재적용은 `pnpm exec tsx scripts/personalize.ts` (자세한 건 `docs/superpowers/specs/2026-04-26-harness-design.md`).
