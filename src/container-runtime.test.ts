import { describe, it, expect, vi, beforeEach } from 'vitest';

// Mock log
vi.mock('./log.js', () => ({
  log: {
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    fatal: vi.fn(),
  },
}));

// Mock child_process — store the mock fn so tests can configure it
const mockExecSync = vi.fn();
vi.mock('child_process', () => ({
  execSync: (...args: unknown[]) => mockExecSync(...args),
}));

import {
  CONTAINER_RUNTIME_BIN,
  readonlyMountArgs,
  stopContainer,
  ensureContainerRuntimeRunning,
  cleanupOrphans,
} from './container-runtime.js';
import { INSTALL_SLUG } from './config.js';
import { log } from './log.js';

beforeEach(() => {
  vi.clearAllMocks();
});

// --- Pure functions ---

describe('readonlyMountArgs', () => {
  it('returns -v syntax with :ro suffix (works for files + dirs on Apple Container)', () => {
    const args = readonlyMountArgs('/host/path', '/container/path');
    expect(args).toEqual(['-v', '/host/path:/container/path:ro']);
  });
});

describe('stopContainer', () => {
  it('calls container stop for valid container names', () => {
    stopContainer('nanoclaw-test-123');
    expect(mockExecSync).toHaveBeenCalledWith(`${CONTAINER_RUNTIME_BIN} stop nanoclaw-test-123`, {
      stdio: 'pipe',
    });
  });

  it('rejects names with shell metacharacters', () => {
    expect(() => stopContainer('foo; rm -rf /')).toThrow('Invalid container name');
    expect(() => stopContainer('foo$(whoami)')).toThrow('Invalid container name');
    expect(() => stopContainer('foo`id`')).toThrow('Invalid container name');
    expect(mockExecSync).not.toHaveBeenCalled();
  });
});

// --- ensureContainerRuntimeRunning ---

describe('ensureContainerRuntimeRunning', () => {
  it('does nothing when runtime is already running', () => {
    mockExecSync.mockReturnValueOnce('');

    ensureContainerRuntimeRunning();

    expect(mockExecSync).toHaveBeenCalledTimes(1);
    expect(mockExecSync).toHaveBeenCalledWith(`${CONTAINER_RUNTIME_BIN} system status`, {
      stdio: 'pipe',
      timeout: 10000,
    });
    expect(log.debug).toHaveBeenCalledWith('Container runtime already running');
  });

  it('attempts to start runtime when status fails', () => {
    mockExecSync.mockImplementationOnce(() => {
      throw new Error('not running');
    });
    mockExecSync.mockReturnValueOnce('');

    ensureContainerRuntimeRunning();

    expect(mockExecSync).toHaveBeenCalledTimes(2);
    expect(mockExecSync).toHaveBeenNthCalledWith(2, `${CONTAINER_RUNTIME_BIN} system start`, {
      stdio: 'pipe',
      timeout: 30000,
    });
    expect(log.info).toHaveBeenCalledWith('Container runtime started');
  });

  it('throws when both status and start fail', () => {
    mockExecSync.mockImplementation(() => {
      throw new Error('runtime unreachable');
    });

    expect(() => ensureContainerRuntimeRunning()).toThrow(
      'Container runtime is required but failed to start',
    );
    expect(log.error).toHaveBeenCalled();
  });
});

// --- cleanupOrphans ---

describe('cleanupOrphans', () => {
  function makeJson(entries: Array<{ id: string; status: string; slug?: string }>): string {
    return JSON.stringify(
      entries.map((e) => ({
        status: e.status,
        configuration: {
          id: e.id,
          labels: { 'nanoclaw-install': e.slug ?? INSTALL_SLUG },
        },
      })),
    );
  }

  it('queries running containers via container ls --format json', () => {
    mockExecSync.mockReturnValueOnce('[]');

    cleanupOrphans();

    expect(mockExecSync).toHaveBeenCalledWith(
      `${CONTAINER_RUNTIME_BIN} ls --format json`,
      expect.any(Object),
    );
  });

  it('stops orphaned nanoclaw containers matching this install', () => {
    mockExecSync.mockReturnValueOnce(
      makeJson([
        { id: 'nanoclaw-group1-111', status: 'running' },
        { id: 'nanoclaw-group2-222', status: 'running' },
      ]),
    );
    mockExecSync.mockReturnValue('');

    cleanupOrphans();

    expect(mockExecSync).toHaveBeenCalledTimes(3);
    expect(mockExecSync).toHaveBeenNthCalledWith(2, `${CONTAINER_RUNTIME_BIN} stop nanoclaw-group1-111`, {
      stdio: 'pipe',
    });
    expect(mockExecSync).toHaveBeenNthCalledWith(3, `${CONTAINER_RUNTIME_BIN} stop nanoclaw-group2-222`, {
      stdio: 'pipe',
    });
    expect(log.info).toHaveBeenCalledWith('Stopped orphaned containers', {
      count: 2,
      names: ['nanoclaw-group1-111', 'nanoclaw-group2-222'],
    });
  });

  it('skips containers from other installs', () => {
    mockExecSync.mockReturnValueOnce(
      makeJson([
        { id: 'nanoclaw-mine-1', status: 'running' },
        { id: 'nanoclaw-other-2', status: 'running', slug: 'other-install' },
      ]),
    );
    mockExecSync.mockReturnValue('');

    cleanupOrphans();

    // ls + 1 stop only
    expect(mockExecSync).toHaveBeenCalledTimes(2);
    expect(mockExecSync).toHaveBeenNthCalledWith(2, `${CONTAINER_RUNTIME_BIN} stop nanoclaw-mine-1`, {
      stdio: 'pipe',
    });
  });

  it('skips stopped containers', () => {
    mockExecSync.mockReturnValueOnce(
      makeJson([
        { id: 'nanoclaw-stopped', status: 'stopped' },
        { id: 'nanoclaw-running', status: 'running' },
      ]),
    );
    mockExecSync.mockReturnValue('');

    cleanupOrphans();

    expect(mockExecSync).toHaveBeenCalledTimes(2);
    expect(mockExecSync).toHaveBeenNthCalledWith(2, `${CONTAINER_RUNTIME_BIN} stop nanoclaw-running`, {
      stdio: 'pipe',
    });
  });

  it('does nothing when no orphans exist', () => {
    mockExecSync.mockReturnValueOnce('[]');

    cleanupOrphans();

    expect(mockExecSync).toHaveBeenCalledTimes(1);
    expect(log.info).not.toHaveBeenCalled();
  });

  it('warns and continues when ls fails', () => {
    mockExecSync.mockImplementationOnce(() => {
      throw new Error('container not available');
    });

    cleanupOrphans(); // should not throw

    expect(log.warn).toHaveBeenCalledWith(
      'Failed to clean up orphaned containers',
      expect.objectContaining({ err: expect.any(Error) }),
    );
  });

  it('continues stopping remaining containers when one stop fails', () => {
    mockExecSync.mockReturnValueOnce(
      makeJson([
        { id: 'nanoclaw-a-1', status: 'running' },
        { id: 'nanoclaw-b-2', status: 'running' },
      ]),
    );
    mockExecSync.mockImplementationOnce(() => {
      throw new Error('already stopped');
    });
    mockExecSync.mockReturnValueOnce('');

    cleanupOrphans(); // should not throw

    expect(mockExecSync).toHaveBeenCalledTimes(3);
    expect(log.info).toHaveBeenCalledWith('Stopped orphaned containers', {
      count: 2,
      names: ['nanoclaw-a-1', 'nanoclaw-b-2'],
    });
  });
});
