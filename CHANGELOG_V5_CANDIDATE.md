# Explicit Change Log — v4 to Correction Candidate

## Changed files

### `public/dialog-index-integration.js`

- Added a single cached `/api/session` handshake before all data calls and uploads.
- Replaced client-only filtering of the latest 100 rows with server calls to `/api/records?q=...&index=...&limit=100`.
- Added 280 ms search debounce and stale-request generation guards.
- Added `/api/overview` loading for authoritative record/index totals.
- Added exact suggested-index selection, clear-filter behavior, and compact show-more/show-fewer behavior.
- Added file download rendering through `/api/file?id={recordId}`.
- Added explicit loading, empty, unavailable, partial-error, and live runtime status.
- Added workspace alignment display.
- Routed upload through the same session gate and existing `/api/upload` route.
- Preserved same-origin parent/iframe refresh and WebMCP-status messaging.

### `public/dialog_index_tank_verified.html`

- Kept the supplied Tank structure, ASCII sea, shoal, five themes, Tune controls, and dropdown.
- Removed fixed demo record/index/detail/activity values.
- Replaced fixed counts and health labels with neutral loading/checking placeholders.
- Added small styles for index controls, file download link, and runtime status.

### `app/api/health/route.ts`

- Resolves the current browser workspace.
- Returns the session workspace ID/persistence mode.
- Reports `remoteMcp.authentication.workspaceMatchesSession`.
- Renames the current auth scheme description to `static-bearer`.
- Uses the common `reply()` response path so the workspace cookie is preserved if needed.

### `lib/server/remote-mcp.ts`

- Removed acceptance of `oai-authenticated-user-id` as an authentication bypass.
- Retained constant-time verification of the configured static Bearer token.
- Retained fail-closed 503/401 behavior, origin allowlist, and JSON-RPC tool handling.

### `scripts/validate-mcp.ts`

- Replaced the old header-bypass success assertion with spoofed-header rejection.
- Added `WWW-Authenticate` assertion.
- Added disallowed-origin rejection.
- Preserved initialize, tools/list, tools/call, and WebMCP mutation-refresh assertions.

### `scripts/validate-static.mjs`

- Added checks for session-first integration, server-side search, exact index filter, overview totals, file download, workspace diagnostics, demo-value removal, and absence of the undocumented auth bypass.

### `scripts/validate-ui-session-order.mjs`

- New dependency-free VM test proving `/api/session` is requested before records/indexes/activity/health/overview.

### `scripts/probe-production.mjs`

- New production probe for browser-session APIs, D1/R2 health, WebMCP tool count, unauthenticated fail-closed Remote MCP, optional authenticated initialize/tools/list/read call, workspace alignment, and optional temporary write/search/soft-delete round trip.
- Does not print or export the Bearer token.

### `package.json`

Added scripts:

- `npm run validate`
- `npm run validate:ui`
- `npm run probe:production`

No dependency version was added or changed.

### `.env.example`

- Clarified static Bearer scope and secret handling.
- Documented browser/Remote workspace alignment.
- Explicitly states that ChatGPT Custom App OAuth 2.1 is not implemented by static Bearer mode.

### Documentation

Replaced stale pre-production/new-Site instructions in:

- `README.md`
- `SPEC.md`
- `ARCHITECTURE.md`
- `DEPLOY_AND_E2E.md`
- `VALIDATION_REPORT.md`

## Unchanged files and boundaries

- `.openai/hosting.json` project ID and bindings.
- `db/*` and `drizzle/*`.
- `lib/server/dialog-service.ts` and D1/R2 semantics.
- `lib/dialog-tools.ts` tool names and schemas.
- `app/useWebMcp.ts` and `app/webmcp-adapter.ts`.
- All record data and R2 objects.
- WebMCP tool count remains 11.
- Remote MCP endpoint remains `/mcp`.
- SEISEKI and all unrelated assets remain untouched.

## Deliberately not implemented

- OAuth 2.1 authorization server/resource-server integration for a ChatGPT Custom MCP App.
- A new MCP tool that returns file bytes.
- Database migration or multi-user identity mapping.
