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
  applyContainerPackages(projectRoot, folder);
  applySkills(projectRoot, homeDir);

  const agId = findAgentGroupId(projectRoot, folder);
  if (agId) {
    applyHooks(projectRoot, agId);
  } else {
    console.warn(`[personalize] no agent group with folder=${folder} — run /init-first-agent first to enable hooks`);
  }
}

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
