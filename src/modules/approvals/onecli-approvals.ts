/**
 * OneCLI approval handler — no-op stub.
 *
 * This install uses the native credential proxy (src/credential-proxy.ts),
 * which reads secrets directly from .env. There is no gateway sitting between
 * the container and the upstream API, so there are no approval requests to
 * forward. These exports exist only to satisfy import sites in
 * approvals/index.ts and response-handler.ts.
 */
import type { ChannelDeliveryAdapter } from '../../delivery.js';

export const ONECLI_ACTION = 'onecli_credential';

export function startOneCLIApprovalHandler(_adapter: ChannelDeliveryAdapter): void {
  // No-op: native proxy has no approval flow.
}

export function stopOneCLIApprovalHandler(): void {
  // No-op.
}

export function resolveOneCLIApproval(_approvalId: string, _decision: string): boolean {
  // No-op: returns false to indicate the approval was not handled here.
  return false;
}
