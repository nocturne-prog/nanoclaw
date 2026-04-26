---
name: superpowers
description: Apply structured thinking to complex requests. Brainstorming (explore, question, design, approve, implement) for features and changes. Systematic debugging (investigate, analyze, hypothesize, fix) for bugs and errors. Skip for simple queries or status checks.
---

# Superpowers: Structured Thinking for Complex Tasks

When you receive a complex request, do NOT jump straight into code. Pick the
right workflow based on the request type, then follow it strictly.

## Workflow Selection

```
Request received
  ↓
Complex? (2+ files, ambiguous requirements, error/failure, explicit design ask)
  ├─ No → respond directly, skip this skill
  └─ Yes → what type?
       ├─ build / change / design → BRAINSTORMING
       └─ bug / error / broken → SYSTEMATIC DEBUGGING
```

---

## A. Brainstorming Workflow

**HARD GATE: Do NOT write or execute any code until the user approves your design.**

### Step 1 — Explore context

Read relevant files before anything else. Understand the current state:
- What exists already?
- What patterns does the codebase use?
- What dependencies are involved?

### Step 2 — Clarifying questions

Ask **one question at a time**. Prefer multiple choice when possible.

Focus on: purpose, constraints, success criteria, edge cases.

Skip this step only if the request is completely unambiguous.

### Step 3 — Propose approaches

Present 2-3 approaches with trade-offs. Lead with your recommendation and
explain why. Keep it concise — a few sentences per approach, not paragraphs.

### Step 4 — Design summary & approval

Summarize the chosen design:
- What will be created/modified
- How components interact
- Key decisions made

Then ask: "이 설계로 진행할까요?" — wait for approval.

### Step 5 — Implement

Only after approval. Follow the agreed design. If you discover something
unexpected during implementation, pause and inform the user before deviating.

### Lightweight mode

When the request is clear AND small-scope (single file, obvious change):
- Step 1 (context) — always do this
- Steps 2-3 — can skip
- Step 4 (approval) — always ask before modifying
- Step 5 — implement

---

## B. Systematic Debugging Workflow

**IRON LAW: Never fix without finding the root cause first.**

### Phase 1 — Investigation (NO fixes allowed)

1. Read the error message / log carefully — every word matters
2. Read the code at the error location and surrounding context
3. Check: is this reproducible? Under what conditions?
4. Trace the data flow — where does the bad value originate?

Do NOT touch any code in this phase.

### Phase 2 — Pattern Analysis (NO fixes allowed)

1. Find working similar code in the codebase
2. List specific differences between working vs broken
3. Check: dependencies, config, environment, timing

Do NOT touch any code in this phase.

### Phase 3 — Hypothesis & Verification

State your hypothesis explicitly:

> "I think [X] is the root cause, because [Y evidence from Phase 1-2]."

Then test with **ONE minimal change only**.

- If it works → Phase 4
- If it fails → new hypothesis (never retry the same fix)

### Phase 4 — Fix

1. Fix the root cause only — not symptoms
2. Verify the fix works
3. Check that nothing else broke

**After 3 failed attempts** → stop. Ask the user for additional context.
Do not keep guessing.

### Red Flags

If you catch yourself thinking any of these, return to Phase 1:

- "일단 바꿔보고 되나 보자" (let me just try changing this)
- "여러 군데 한 번에 수정하자" (fix multiple things at once)
- "완전히 이해 못했지만 될 수도" (don't fully understand but might work)
- "빠른 수정 먼저, 조사는 나중에" (quick fix first, investigate later)

