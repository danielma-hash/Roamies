import type { Socket } from 'node:net';
export interface BrowserEgressOptions {
  readonly resolve: (host: string) => Promise<readonly string[]>;
  readonly deniedAddresses: readonly string[];
  readonly deniedSubnets?: readonly string[];
  readonly maxBytes?: number;
  readonly idleMs?: number;
  readonly dial?: (checkedAddress: string) => Socket;
}
