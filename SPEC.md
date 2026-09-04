# Dialog Index WebMCP + Remote MCP Site — Current Specification

## Purpose

Dialog Index gives one person a durable, searchable store for conversation extracts, notes, structured records, and files while keeping ChatGPT as the preferred conversational interface.

The authoritative identity is a stable record ID. A suggested index is a browsing hint, not a physical folder or primary key.

## Existing production context

- Host: existing ChatGPT Site `dialog-index-mcp`.
- Project ID: `appgprj_6a977c8675a08191b54f3849ee9f1653`.
- Structured storage: existing Sites D1 binding `DB`.
- File storage: existing Sites R2 binding `FILES`.
- Existing migrations and data must be preserved.
- This correction must not create or modify SEISEKI or any other Site/Cloudflare asset.

## Required user-visible behavior

### Data browser

- Show authoritative record and index totals from `/api/overview`.
- Show recent or searched records from `/api/records`.
- Search on the server with `q` and optionally filter by exact `index`.
- Select a record and show its stable ID, title, index, type/source, tags, body, update time, review state, and file download when applicable.
- Show all indexes through a compact expand/collapse control rather than making indexes after the first six unreachable.
- Show recent audit activity.
- Upload files to R2 through the existing 25 MiB UI route.
- Never present fixed demo records or fake health values as production data.

### Status

- Show WebMCP registration state and tool count.
- Show Remote MCP configuration state.
- Show D1 and R2 health independently.
- Show whether the current browser workspace matches the configured Remote MCP workspace.
- Show explicit loading, empty, partial-error, and unavailable states.

## Workspace model

Browser UI and WebMCP:

- `/api/session` establishes one HttpOnly cookie workspace.
- The iframe must await this session before issuing concurrent records/indexes/activity/health/overview requests.

Remote MCP:

- `REMOTE_MCP_WORKSPACE_ID` is applied server-side.
- Workspace ID is never accepted from a tool argument.
- `/api/health` compares this configured workspace with the current browser session and returns a boolean alignment result.

A healthy connection with `workspaceMatchesSession: false` is not an end-to-end success because the two entry points see different data.

## Tool architecture

- Read-only: overview, index list, record search, record get, activity.
- Mutations: save record, update record, move suggested index, save small file, soft delete.
- Optional open-world read-only enrichment: organize text with configured external AI.
- All eleven operations are owned by one WebMCP-independent server service.
- WebMCP and Remote MCP keep the same names, schemas, and annotations.

## WebMCP entry point

- The top-level Site document registers tools with `document.modelContext.registerTool()`.
- The Tank iframe is presentation and same-origin API integration; it is not the only place registering tools.
- ChatGPT desktop Site Tools discover the tools only while the page is open and the account/model/page support them.

## Remote MCP entry point

- Stable HTTPS endpoint: `/mcp`.
- Stateless JSON-RPC support: `initialize`, `ping`, `tools/list`, `tools/call`.
- Static Bearer mode is fail-closed and intended for trusted external MCP clients.
- Caller-controlled identity headers do not bypass authentication.
- An authenticated ChatGPT Custom MCP App is a separate completion gate and requires OAuth 2.1 discovery and token verification; static Bearer alone is not represented as that completion.

## Storage

- D1 tables: `workspaces`, `records`, `index_aliases`, `audit_events`.
- R2 key pattern: `objects/{workspaceId}/{recordId}/{filename}`.
- Moving a suggested index does not move the R2 object and does not change the stable record ID.
- File download uses the existing `/api/file?id={recordId}` route and returns an attachment with private no-store and nosniff headers.

## Completion gates for this correction

1. Static, UI session-order, and MCP regression validations pass.
2. Typecheck and production build pass in an environment with dependencies installed.
3. Existing Sites project is deployed without migration or data reset.
4. Production UI shows real records/indexes and no demo values.
5. D1/R2 health is green.
6. WebMCP shows ready and 11 Site Tools are visible in the ChatGPT desktop built-in browser.
7. One Site Tool save/search/get/delete test passes.
8. Remote MCP unauthenticated request is rejected.
9. Authenticated `initialize`, `tools/list`, and a read-only `tools/call` pass from a trusted client.
10. Browser/Remote workspace alignment is true when shared data is required.

## Deliberately deferred

- OAuth 2.1 provider integration for a ChatGPT Custom MCP App.
- Adding a twelfth MCP file-byte retrieval tool.
- Multi-user identity mapping.
- Schema changes and migration work.
- Full performance tuning of the decorative Canvas engine.
