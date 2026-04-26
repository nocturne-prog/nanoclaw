/**
 * Container runtime abstraction for NanoClaw.
 * All runtime-specific logic lives here so swapping runtimes means changing one file.
 *
 * This install uses Apple Container (macOS-native VM-based container runtime).
 */
import { execSync } from 'child_process';
import os from 'os';

import { INSTALL_SLUG } from './config.js';
import { log } from './log.js';

/** The container runtime binary name. */
export const CONTAINER_RUNTIME_BIN = 'container';

/**
 * IP address containers use to reach the host machine.
 * Apple Container VMs use a bridge network (192.168.64.x); the host is at the gateway.
 * Detected from the bridge interface, falling back to 192.168.64.1.
 */
export const CONTAINER_HOST_GATEWAY = detectHostGateway();

function detectHostGateway(): string {
  const ifaces = os.networkInterfaces();
  for (const [name, addrs] of Object.entries(ifaces)) {
    if (!name.startsWith('bridge') || !addrs) continue;
    for (const addr of addrs) {
      if (addr.family === 'IPv4' && !addr.internal) {
        return addr.address;
      }
    }
  }
  return '192.168.64.1';
}

/** CLI args needed for the container to resolve the host gateway. */
export function hostGatewayArgs(): string[] {
  // Apple Container has no host.docker.internal; containers use CONTAINER_HOST_GATEWAY.
  return [];
}

/** Returns CLI args for a readonly bind mount.
 *  Apple Container's --mount type=bind only accepts directories; -v syntax
 *  works for both files and directories, so we always use -v with :ro.
 */
export function readonlyMountArgs(hostPath: string, containerPath: string): string[] {
  return ['-v', `${hostPath}:${containerPath}:ro`];
}

/** Stop a container by name. */
export function stopContainer(name: string): void {
  if (!/^[a-zA-Z0-9][a-zA-Z0-9_.-]*$/.test(name)) {
    throw new Error(`Invalid container name: ${name}`);
  }
  execSync(`${CONTAINER_RUNTIME_BIN} stop ${name}`, { stdio: 'pipe' });
}

/** Ensure the container runtime is running, starting it if needed. */
export function ensureContainerRuntimeRunning(): void {
  try {
    execSync(`${CONTAINER_RUNTIME_BIN} system status`, {
      stdio: 'pipe',
      timeout: 10000,
    });
    log.debug('Container runtime already running');
  } catch {
    log.info('Starting container runtime...');
    try {
      execSync(`${CONTAINER_RUNTIME_BIN} system start`, {
        stdio: 'pipe',
        timeout: 30000,
      });
      log.info('Container runtime started');
    } catch (err) {
      log.error('Failed to start container runtime', { err });
      console.error('\n╔════════════════════════════════════════════════════════════════╗');
      console.error('║  FATAL: Container runtime failed to start                      ║');
      console.error('║                                                                ║');
      console.error('║  Agents cannot run without a container runtime. To fix:        ║');
      console.error('║  1. Ensure Apple Container is installed                        ║');
      console.error('║  2. Run: container system start                                ║');
      console.error('║  3. Restart NanoClaw                                           ║');
      console.error('╚════════════════════════════════════════════════════════════════╝\n');
      throw new Error('Container runtime is required but failed to start', {
        cause: err,
      });
    }
  }
}

interface AppleContainerListEntry {
  status: string;
  configuration?: {
    id?: string;
    labels?: Record<string, string>;
  };
}

/**
 * Kill orphaned NanoClaw containers from THIS install's previous runs.
 *
 * Scoped by label `nanoclaw-install=<slug>` so a crash-looping peer install
 * cannot reap our containers, and we cannot reap theirs. The label is
 * stamped onto every container at spawn time — see container-runner.ts.
 */
export function cleanupOrphans(): void {
  try {
    const output = execSync(`${CONTAINER_RUNTIME_BIN} ls --format json`, {
      stdio: ['pipe', 'pipe', 'pipe'],
      encoding: 'utf-8',
    });
    const containers: AppleContainerListEntry[] = JSON.parse(output || '[]');
    const orphans = containers
      .filter(
        (c) =>
          c.status === 'running' &&
          c.configuration?.labels?.['nanoclaw-install'] === INSTALL_SLUG &&
          c.configuration?.id,
      )
      .map((c) => c.configuration!.id!);
    for (const name of orphans) {
      try {
        stopContainer(name);
      } catch {
        /* already stopped */
      }
    }
    if (orphans.length > 0) {
      log.info('Stopped orphaned containers', { count: orphans.length, names: orphans });
    }
  } catch (err) {
    log.warn('Failed to clean up orphaned containers', { err });
  }
}
