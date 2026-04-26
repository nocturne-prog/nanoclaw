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

  it('adds prettier and typescript to container.json packages.npm (idempotent)', () => {
    personalize({ projectRoot: env.projectRoot, homeDir: env.homeDir, folder: 'dm-with-jihoon' });
    personalize({ projectRoot: env.projectRoot, homeDir: env.homeDir, folder: 'dm-with-jihoon' });

    const cfg = JSON.parse(
      fs.readFileSync(path.join(env.projectRoot, 'groups/dm-with-jihoon/container.json'), 'utf-8'),
    );
    expect(cfg.packages.npm).toEqual(expect.arrayContaining(['prettier@3', 'typescript@5']));
    expect(cfg.packages.npm.filter((p: string) => p === 'prettier@3').length).toBe(1);
  });

  it('copies tdd-workflow and security-review skills from home to container/skills', () => {
    personalize({ projectRoot: env.projectRoot, homeDir: env.homeDir, folder: 'dm-with-jihoon' });

    const tddDst = path.join(env.projectRoot, 'container/skills/tdd-workflow/SKILL.md');
    const secDst = path.join(env.projectRoot, 'container/skills/security-review/SKILL.md');
    expect(fs.existsSync(tddDst)).toBe(true);
    expect(fs.existsSync(secDst)).toBe(true);
    expect(fs.readFileSync(tddDst, 'utf-8')).toContain('tdd-workflow source');
  });

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
});
