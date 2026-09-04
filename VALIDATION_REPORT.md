# Validation Report — Production v4 Correction Candidate

Date: 2026-09-04

## Source basis

- Input: `dialog-index-mcp-production-v4-full-source.zip`
- Existing production project: `appgprj_6a977c8675a08191b54f3849ee9f1653`
- Reported production v4 commit: `fb4104402f8b1430c3d1d21db30fa16272dd837f`
- D1/R2 bindings preserved: `DB` / `FILES`
- Migration changes: none
- Data seeds or rewrites: none

## Implemented corrections

- Session established before iframe API concurrency.
- Server-side record search and exact index filter.
- Overview-backed totals.
- Expandable access to indexes beyond the first six.
- File download link through the existing file route.
- Removal of production demo rows/fake counts/fake health values.
- Explicit loading, empty, unavailable, and partial-error rendering.
- Browser/Remote MCP workspace-alignment diagnostics.
- Removal of undocumented identity-header auth bypass.
- Repeatable validation and production probe scripts.

## Executed in this environment

### PASS — static integration validation

```text
npm run validate:static
Static validation PASS: 11 shared WebMCP/Remote MCP tools, DB/FILES bindings,
session-first UI integration, server-side search/overview, file download,
workspace alignment diagnostics, and strict Remote MCP Bearer auth.
```

### PASS — UI session-order logic

```text
npm run validate:ui
UI session-order validation PASS: 6 requests, session established before all data reads.
```

This test evaluates the production integration script in a controlled VM with mocked API responses and asserts that `/api/session` is the first data request.

### PASS — WebMCP/Remote MCP regression

```text
npm run validate:mcp
MCP regression PASS: 11 WebMCP adapters; Remote MCP static-Bearer fail-closed auth,
spoofed-header rejection, origin enforcement, initialize, tools/list, and tools/call.
```

### PASS — syntax checks

- `public/dialog-index-integration.js`: `node --check` PASS.
- `scripts/probe-production.mjs`: `node --check` PASS.
- Modified TypeScript files transpile without syntax diagnostics using TypeScript transpileModule:
  - `app/api/health/route.ts`
  - `lib/server/remote-mcp.ts`
  - `scripts/validate-mcp.ts`

## Not independently completed here

- `npm ci` did not complete in the container before the package transport timed out.
- Therefore full dependency-backed `npm run typecheck` and `npm run build` were not re-run here.
- The user reported those gates as passing on production v4; this report does not relabel that report as an independent v5 pass.
- The production hostname could not be resolved from this container/web fetch path.
- The Browser Connector returned `Browser not connected`, so the live Tank UI and Site Tools indicator could not be inspected from this session.
- No production deployment was performed from this environment.
- No authenticated production Remote MCP call was performed because the secret was not available and must not be pasted into chat.

## Remaining live gates

1. Install dependencies, typecheck, and build this candidate.
2. Deploy it to the existing project without storage/migration changes.
3. Run `npm run probe:production` against the live URL.
4. Open the live Site in the ChatGPT desktop built-in browser and verify all 11 Site Tools.
5. Run one save/search/get/delete WebMCP round trip.
6. Run the authenticated Remote MCP probe from a trusted local secret environment.
7. Require workspace alignment when both entry points must share records.
8. Treat ordinary ChatGPT Custom App connectivity as pending until OAuth 2.1 is implemented and Scan Tools succeeds.

## Official specification checks

Reviewed 2026-09-04:

- OpenAI Sites documentation confirms D1 for durable structured records, R2 for file contents, and separate save/deploy stages.
- OpenAI Site Tools documentation confirms automatic WebMCP discovery only in the ChatGPT desktop built-in browser while the page is open; embedded-only tools are not supported.
- OpenAI MCP build guidance requires Streamable HTTP inspection, tool/auth testing, and then ChatGPT developer-mode testing.
- OpenAI MCP authentication guidance expects OAuth 2.1 for authenticated MCP servers and full resource-server token verification.
