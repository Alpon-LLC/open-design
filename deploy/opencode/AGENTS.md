# Alpon integration discovery

## Always check the real connection

- For a selected native connector, check that selected native connector first using `"$OD_NODE_BIN" "$OD_BIN" tools connectors list --format compact`, then execute its discovered permitted tools with `tools connectors execute`. For any MCP or integration request without a selected native connector, check Composio first. This is a generic rule for every named application, service, asset library, or external workflow, not a rule limited to particular providers.
- Before saying an MCP is unavailable or not connected, perform live discovery and inspect the returned connection status. Do not answer an availability question from memory or a previous assistant claim.
- Absence from the initial tool list is not evidence that a connection is missing: Composio discovers provider tools dynamically, and OpenCode V2 normally exposes MCP tools through Code Mode.
- Use the runtime's Code Mode tool-catalog search to find `COMPOSIO_SEARCH_TOOLS` under `composio`, then invoke the exact discovered tool path. Do not guess a path or stop because the provider has no individually named MCP server.
- Search with `queries: [{use_case: "<normalized English task naming the requested service>"}]` and `session: {generate_id: true}` for a new workflow; reuse the returned workflow session ID for subsequent calls. Put personal identifiers only in `known_fields`, not in `use_case`.
- Inspect `toolkit_connection_statuses`, available tool slugs, and returned errors. Report the actual returned connection status and whether access is through Composio or another server. If an expected tool is absent, retry discovery once with `search_strategy: "tool_search"`.
- A restricted or missing Composio toolkit is not proof that the service is disconnected everywhere. When needed, inspect a separately configured MCP or native connector using the available authenticated runtime tools; keep those connection types distinct.
- If discovery itself is unavailable, fails, or is restricted, report that precise limitation. Never invent a successful connection or declare an untested provider disconnected.

## Figma connection boundaries and recovery

- OpenDesign's native Figma connector and the global Composio MCP are separate discovery contexts. A global Composio search returning unrelated tools is not evidence that the native connector is unavailable. If Figma is selected, use the native connector procedure above; do not stop at the global search result.
- The retired `figma-context` entry is the separate Framelink stdio server. Its verified startup failure was: `Either FIGMA_API_KEY or FIGMA_OAUTH_TOKEN is required`. A selected mention is not a successful MCP handshake. This is missing server credentials, not a confirmed OAuth disconnection. Recovery: Add context → Connectors → Figma, using this OpenDesign instance's existing authorized connection. To use Framelink instead, the owner must configure its own token in Settings → External MCP servers and enable it; never copy credentials from another profile.
- For design/presentation inspection, use discovered node/file read tools and verify actual frame/slide child nodes and text, not metadata only. Respect file type limitations: a Figma Slides URL is not automatically supported by a Design-file tool. Report 401/403/404, unsupported file type, or missing registration truthfully; do not claim a successful slide read from a file title or connection status alone.

## Execute only the discovered, permitted tools

- Use `COMPOSIO_GET_TOOL_SCHEMAS` when needed and `COMPOSIO_MULTI_EXECUTE_TOOL` for the provider slugs actually returned by discovery. Follow their live schemas, not remembered argument names.
- Keep asset searches bounded and include real returned source links. Do not replace a requested provider with web search/browser automation while presenting it as that provider's result.
- The existing approved design integrations include Mobbin, Pexels, and IconScout. They use the same generic discovery procedure; these names are examples, not an exhaustive list of services to check.
- For Mobbin specifically, use discovered `MOBBIN_MCP_` tools such as screen, flow, or section search rather than an unrelated browser tool.
- Do not create or relink accounts, change toolkit/session allowlists, or bypass permission gates merely to answer an availability question. Preserve the runtime's profile isolation and existing approvals.
- Do not print, request in chat, copy between profiles, or fabricate credentials. Use the existing authenticated connector path and stop at any required owner authorization.
