# Dialog Index Architecture — Production v4 Correction Candidate

## Deployment boundary

```text
Existing ChatGPT Sites project
  appgprj_6a977c8675a08191b54f3849ee9f1653

  top-level React page
    -> useWebMcp.ts registers 11 tools
    -> iframe hosts Tank UI

  same-origin routes
    -> /api/session
    -> /api/overview
    -> /api/records
    -> /api/record
    -> /api/indexes
    -> /api/activity
    -> /api/upload
    -> /api/file
    -> /api/health

  Remote MCP
    -> /mcp

  shared dialog-service
    -> D1 binding DB
    -> R2 binding FILES
    -> optional configured external AI
```

No new Site, D1, R2, migration, or record seed is part of this correction.

## Why the Tank UI remains in an iframe

The supplied HTML is the visual source of truth. Keeping it as a same-origin iframe preserves its ASCII sea, shoal engine, five themes, and runtime Tune controls without reinterpreting the design in React.

WebMCP registration remains in the top-level document, not only inside embedded content. The parent sends registration state to the iframe and receives refresh requests through same-origin `postMessage` events.

## Session-before-data invariant

The iframe previously issued several API requests concurrently before its workspace cookie was guaranteed to exist. Each cookie-less request could resolve a different generated workspace.

The corrected invariant is:

```text
POST /api/session
  -> receive HttpOnly dialog_index_workspace cookie
  -> only then request records/indexes/activity/health/overview in parallel
```

The same promise gates file upload.

## Search and totals

The browser no longer downloads the latest 100 records and treats that subset as the searchable database.

```text
query/index changes
  -> GET /api/records?q=...&index=...&limit=100
  -> D1 search through dialog-service
```

Authoritative totals come from `/api/overview`, not `records.length`.

## Workspace alignment

```text
Web UI + WebMCP
  -> HttpOnly cookie workspace A

Remote MCP
  -> REMOTE_MCP_WORKSPACE_ID workspace B
```

`/api/health` returns `workspaceMatchesSession` so A and B cannot appear as one connected system when they are different.

## Remote MCP authentication boundary

Remote MCP accepts only the configured static Bearer token in this candidate. The previous undocumented `oai-authenticated-user-id` shortcut was removed because a caller-controlled header must not become an authorization bypass.

Static Bearer supports trusted external MCP clients. A ChatGPT Custom MCP App with private data/write actions requires a separate OAuth 2.1 resource-server design and is not silently emulated by this endpoint.

## Data and audit

- Stable identity: `record.id`.
- Suggested index: non-authoritative logical hint.
- File object: stable R2 key under workspace and record ID.
- Audit source: `web-ui`, `webmcp`, or `remote-mcp`.
- Deletion: soft delete.
