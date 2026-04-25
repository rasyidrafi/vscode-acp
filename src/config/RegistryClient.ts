import { log, logError } from '../utils/Logger';

export interface RegistryAgent {
  id: string;
  name: string;
  version?: string;
  description?: string;
  repository?: string;
  website?: string;
  distribution?: {
    npx?: {
      package: string;
      args?: string[];
      env?: Record<string, string>;
    };
    binary?: Record<string, {
      cmd: string;
      args?: string[];
    }>;
  };
  command?: string;
  args?: string[];
  homepage?: string;
}

interface Registry {
  agents: RegistryAgent[];
}

export interface RegistryFetchResult {
  agents: RegistryAgent[];
  source: 'network' | 'cache' | 'none';
  status: 'fresh' | 'stale' | 'failure';
  errorMessage?: string;
}

const REGISTRY_URL = 'https://cdn.agentclientprotocol.com/registry/v1/latest/registry.json';

let cachedRegistry: Registry | null = null;
let cacheTime = 0;
const CACHE_TTL = 5 * 60 * 1000; // 5 minutes

/**
 * Fetches the ACP agent registry from the CDN.
 * Results are cached for 5 minutes.
 */
export async function fetchRegistry(): Promise<RegistryFetchResult> {
  const now = Date.now();
  if (cachedRegistry && (now - cacheTime) < CACHE_TTL) {
    return {
      agents: cachedRegistry.agents,
      source: 'cache',
      status: 'fresh',
    };
  }

  try {
    log('Fetching ACP agent registry...');
    const response = await fetch(REGISTRY_URL);
    if (!response.ok) {
      throw new Error(`HTTP ${response.status}: ${response.statusText}`);
    }
    const data = (await response.json()) as Registry;
    cachedRegistry = data;
    cacheTime = now;
    log(`Registry fetched: ${data.agents?.length || 0} agents`);
    return {
      agents: data.agents || [],
      source: 'network',
      status: 'fresh',
    };
  } catch (e) {
    logError('Failed to fetch registry', e);
    const errorMessage = e instanceof Error ? e.message : String(e);
    if (cachedRegistry) {
      return {
        agents: cachedRegistry.agents,
        source: 'cache',
        status: 'stale',
        errorMessage,
      };
    }

    return {
      agents: [],
      source: 'none',
      status: 'failure',
      errorMessage,
    };
  }
}

/**
 * Clear the registry cache.
 */
export function clearRegistryCache(): void {
  cachedRegistry = null;
  cacheTime = 0;
}

export function getRegistryHomepage(agent: RegistryAgent): string | undefined {
  return agent.website || agent.repository || agent.homepage;
}
