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
