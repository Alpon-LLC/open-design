interface Server {
  id: string;
  enabled: boolean;
  transport: string;
  command?: string;
  args?: string[];
  env?: Record<string, string>;
  label?: string;
  [key: string]: unknown;
}

/**
 * Retire only the verified tokenless built-in Framelink launch shape.
 * This is an operator migration, not a connectivity probe: callers must first
 * verify that OpenDesign's own native Figma connector can read real node data.
 * Custom commands/arguments may load their own credentials and are left alone.
 * No credential is copied and no other connection or authority is changed.
 */
export function retireUnconfiguredFigmaContext(
  config: { servers: Server[]; [key: string]: unknown },
  inherited: Record<string, string | undefined>,
): { servers: Server[]; [key: string]: unknown } {
  return {
    ...config,
    servers: config.servers.map(server => {
      if (server.id !== 'figma-context' || !server.enabled || server.transport !== 'stdio'
        || server.command !== 'npx'
        || JSON.stringify(server.args) !== JSON.stringify(['-y', 'figma-developer-mcp', '--stdio'])) return server;
      const env = { ...inherited, ...server.env };
      if (env.FIGMA_API_KEY?.trim() || env.FIGMA_OAUTH_TOKEN?.trim()) return server;
      return {
        ...server,
        enabled: false,
        label: 'Figma Context — missing token; use Add context → Connectors → Figma',
      };
    }),
  };
}
