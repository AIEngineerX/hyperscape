import { System } from "../shared";
import type { ServerRuntime } from "./ServerRuntime";

type ServerStats = {
  maxMemory: number;
  currentMemory: number;
  maxCPU: number;
  currentCPU: number;
};

const EMPTY_STATS: ServerStats = {
  maxMemory: 0,
  currentMemory: 0,
  maxCPU: 0,
  currentCPU: 0,
};

/**
 * Monitoring facade for server status commands.
 *
 * Intentionally does not tick the world. It proxies runtime stats from the
 * primary `server` runtime instance to avoid accidentally creating a second
 * authoritative tick loop.
 */
export class ServerMonitor extends System {
  async getStats(): Promise<ServerStats> {
    const runtime = this.world.server as ServerRuntime | undefined;
    const stats = await runtime?.getStats?.();
    return stats ?? EMPTY_STATS;
  }
}
