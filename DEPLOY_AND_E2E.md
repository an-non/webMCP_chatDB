# Dialog Index — Deploy and Connectivity Runbook

## A. Pre-deploy source validation

```bash
npm install
npm run validate
npm run typecheck
npm run build
```

`npm run validate` must pass:

- binding/project/static contract checks;
- session-first UI request-order check;
- eleven WebMCP adapters;
- Remote MCP fail-closed auth, spoofed-header rejection, origin enforcement, initialize, tools/list, and tools/call.

## B. Deploy without changing storage

Deploy this source as a new version of the **existing** Sites project:

- Project: `appgprj_6a977c8675a08191b54f3849ee9f1653`
- D1: existing `DB`
- R2: existing `FILES`

Do not provision new storage, edit Drizzle migrations, seed records, or touch SEISEKI/other Sites.

Every Sites deployment URL is production. Save a version first if review is needed; deploy only after source/build review.

## C. Production HTTP/API check

Run the read-only probe:

```bash
DIALOG_INDEX_BASE_URL=https://dialog-index-mcp.mars-inc-7675.chatgpt.site \
DIALOG_INDEX_PROBE_OUTPUT=production-probe.json \
  npm run probe:production
```

Required results:

- `/api/session`: 200, workspace ID, cookie received;
- `/api/health`: D1 and R2 healthy;
- WebMCP tool count: 11;
- overview/records/indexes/activity: readable;
- unauthenticated `/mcp`: 401 when configured, or 503 when intentionally disabled.

Optional API mutation round trip:

```bash
DIALOG_INDEX_WRITE_PROBE=1 \
DIALOG_INDEX_BASE_URL=https://dialog-index-mcp.mars-inc-7675.chatgpt.site \
  npm run probe:production
```

This creates one clearly named temporary record, searches it, and soft-deletes it. Audit rows remain by design.

## D. Visual UI check

Open production and confirm:

- fixed demo titles never appear;
- real record/index totals come from overview;
- a query that is not in the latest visible rows still returns through server search;
- indexes after the first six are reachable with `show more`;
- a file record shows a download link;
- access panel shows WebMCP, Remote MCP, D1, R2, and workspace alignment;
- API failure displays unavailable/error rather than demo data.

## E. WebMCP Site Tools check

Use the ChatGPT desktop app’s built-in browser, not a normal external browser.

1. Open the production Site and keep the page open.
2. Confirm the address-bar Site Tools indicator appears.
3. Open the tool list and confirm all eleven names.
4. Ask ChatGPT to call `get_dialog_index_overview`.
5. Ask ChatGPT to save a uniquely named test note with `save_and_index_dialog_record`.
6. Search the same marker with `search_dialog_records`.
7. Read it by stable ID with `get_dialog_record`.
8. Soft-delete it only after confirming the ID.
9. Confirm records/activity refresh in the Tank UI.

This is the actual WebMCP E2E. API tests alone do not prove ChatGPT discovered Site Tools.

## F. Remote MCP check

Run from a trusted environment without echoing the token:

```bash
REMOTE_MCP_BEARER_TOKEN='<secret from local secret manager>' \
DIALOG_INDEX_BASE_URL=https://dialog-index-mcp.mars-inc-7675.chatgpt.site \
DIALOG_INDEX_PROBE_OUTPUT=remote-probe.json \
  npm run probe:production
```

Required results:

- unauthenticated request rejected;
- authenticated `initialize` succeeds;
- `tools/list` returns 11 tools;
- read-only `get_dialog_index_overview` succeeds;
- health reports `workspaceMatchesSession: true` when WebMCP and Remote MCP are intended to share data.

Also inspect the production endpoint with MCP Inspector using Streamable HTTP and representative valid/invalid inputs.

## G. ChatGPT ordinary-chat Custom App gate

Do not claim this gate from static Bearer tests.

For private data or write actions, implement OAuth 2.1 using an established identity provider, including protected-resource metadata, authorization-server discovery, PKCE-compatible flow, access-token signature/issuer/audience/expiry/scope verification, and the appropriate authentication challenge. Then create/scan the app in ChatGPT developer mode and test it in a normal chat.

## H. Rollback

If UI or connectivity fails:

1. redeploy production v4 commit `fb4104402f8b1430c3d1d21db30fa16272dd837f`;
2. leave D1/R2 and environment secrets unchanged;
3. retain probe output and Worker logs;
4. do not run a migration or data reset as a rollback step.
