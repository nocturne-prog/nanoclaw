# Container Superpowers Skill Design

## Goal

NanoClaw container agent (Telegram etc.) that applies structured thinking patterns from the superpowers plugin — brainstorming before building, systematic debugging before fixing.

## Scope

- **In scope**: Brainstorming workflow, Systematic debugging workflow, workflow selection logic
- **Out of scope**: Writing-plans (too heavy for chat), Visual Companion (no web server), git worktrees

## Architecture

Single skill at `container/skills/superpowers/SKILL.md`. The agent loads it on-demand via `description` matching when requests involve implementation, changes, or problem-solving. Simple queries bypass the skill entirely.

## Workflow Selection

```
Request received
  ↓
Complex request? (implementation/change/problem-solving)
  ├─ No → Skip skill, respond directly
  └─ Yes → What type?
       ├─ New feature / change / design → Brainstorming workflow
       └─ Bug / error / problem → Systematic debugging workflow
```

**"Complex" criteria**:
- Expected to modify 2+ files
- Ambiguous requirements with multiple interpretations
- Failure/error situation
- User explicitly asks for design or root cause

**Lightweight exception**: Single-file clear modification → context check + implement (skip questions/approaches). Hard Gate and Phase 1 always apply.

## Brainstorming Workflow (5 steps)

Adapted from superpowers brainstorming (9 steps → 5 steps).

**Removed**: Visual Companion, spec file save, writing-plans handoff.
**Preserved**: Core discipline of think-before-code.

1. **Explore context** — Read relevant files/code before anything
2. **Clarifying questions** — One at a time, prefer multiple choice
3. **Propose 2-3 approaches** — With trade-offs and recommendation
4. **Present design summary & get approval** — Text-based, wait for user confirmation
5. **Implement** — Only after approval

**Hard Gate**: No code writing/execution without user approval.

**Lightweight mode**: When request is clear and small-scope, steps 2-3 can be condensed, but step 1 (context) and Hard Gate always apply.

## Systematic Debugging Workflow (4 phases)

Adapted from superpowers systematic-debugging. Core process preserved as-is.

**Iron Law**: Never fix without finding root cause first.

### Phase 1: Investigation (no fixes allowed)
- Read error messages/logs carefully
- Read related code (Read, Grep)
- Check reproducibility
- Trace data flow — where does the bad value originate?

### Phase 2: Pattern Analysis (no fixes allowed)
- Find working similar code in codebase
- List differences between working vs broken
- Check dependencies/config/environment

### Phase 3: Hypothesis & Verification
- State explicitly: "I think X is the cause, because Y"
- Test with ONE minimal change only
- On failure: new hypothesis (never retry same fix)

### Phase 4: Fix
- Fix root cause only (not symptoms)
- Verify after fix
- After 3+ failures → ask user for additional context

### Red Flags (return to Phase 1 if you think these)
- "Let me just change this and see"
- "Fix multiple things at once"
- "Don't fully understand but it might work"

## Container Environment Constraints

| Feature | Available | Notes |
|---------|-----------|-------|
| Bash, Read, Write, Edit, Glob, Grep | Yes | Core tools |
| WebSearch, WebFetch | Yes | Research |
| Task, TodoWrite | Yes | Progress tracking |
| Skill tool | Yes | Can reference other container skills |
| TeamCreate, SendMessage | Yes | Multi-agent orchestration |
| mcp__nanoclaw__send_message | Yes | Send interim messages to user |
| Git | No | Container has no git |
| Visual Companion | No | No web server |
| Plan Mode | No | Text-based alternative |
| Worktree | No | Single workspace |

## File Location

```
container/skills/superpowers/SKILL.md
```

Loaded by container agent when description matches complex requests.
