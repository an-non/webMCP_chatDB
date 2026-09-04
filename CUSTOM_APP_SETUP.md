# ChatGPT Custom App setup

This repository now contains the Remote MCP-side pieces needed for an OAuth 2.1 authorization-code + PKCE flow suitable for ChatGPT Custom App linking.

## Production endpoint

`https://dialog-index-mcp.mars-inc-7675.chatgpt.site/mcp`

## OAuth endpoints

- `/.well-known/oauth-protected-resource`
- `/.well-known/oauth-authorization-server`
- `/oauth/register`
- `/oauth/authorize`
- `/oauth/token`
- `/mcp`

The authorization server supports:

- Dynamic Client Registration (DCR)
- Authorization Code
- PKCE `S256`
- `resource` binding to the exact `/mcp` endpoint
- access tokens
- refresh tokens
- per-tool `securitySchemes`
- `WWW-Authenticate` discovery challenge
- one-time authorization-code redemption recorded in the existing D1 `audit_events` table

## Required Sites environment values

Keep the existing `REMOTE_MCP_WORKSPACE_ID`.

Add:

```text
REMOTE_MCP_OAUTH_APPROVAL_CODE=<private random value>
REMOTE_MCP_OAUTH_SUBJECT=dialog-index-owner
```

Recommended:

```text
REMOTE_MCP_OAUTH_SIGNING_SECRET=<independent long random value>
```

If `REMOTE_MCP_OAUTH_SIGNING_SECRET` is omitted, the current implementation falls back to the existing `REMOTE_MCP_BEARER_TOKEN` as the signing secret so the migration can be performed with one new secret. A separate signing secret is still preferable.

Optional, when the Site is configured to expose authenticated ChatGPT user headers:

```text
REMOTE_MCP_OAUTH_ALLOWED_EMAILS=user@example.com
```

A matching signed-in Site user can then approve without entering the approval code.

Never commit the real values. Never paste them into ChatGPT messages, README files, logs, screenshots, or source.

## Workspace requirement

The ordinary-chat MCP connection and WebMCP/Site Tools must use the same logical workspace.

1. Open the production Site in the intended browser profile.
2. Ensure `/api/session` has established the `dialog_index_workspace` cookie.
3. Configure `REMOTE_MCP_WORKSPACE_ID` to that same workspace ID.
4. Check `/api/health`.
5. Require `remoteMcp.authentication.workspaceMatchesSession === true`.

No D1 schema or migration change is required.

## Deploy

Deploy this repository HEAD to the **existing** Sites project only.

Do not create a new Site, D1 database, R2 bucket, migration, or workspace.

Existing bindings remain:

```text
D1: DB
R2: FILES
```

## Connect in ChatGPT

After the deployment succeeds:

1. Open ChatGPT developer/custom-app management.
2. Create a Custom App using the MCP endpoint:
   `https://dialog-index-mcp.mars-inc-7675.chatgpt.site/mcp`
3. Let ChatGPT discover the protected-resource and authorization-server metadata.
4. Use DCR when prompted for client registration.
5. Run **Scan Tools**.
6. The OAuth consent page will open when authorization is required.
7. Enter the private approval code locally on that page, or approve as an allowed signed-in Site user.
8. Confirm that all 11 Dialog Index tools are discovered.
9. Enable/select the app in a normal ChatGPT conversation.

## DB-level E2E completion condition

Do not treat `build PASS` or `Scan Tools PASS` alone as completion.

Final production proof:

```text
ordinary ChatGPT via Remote MCP
  -> save marker A
  -> D1 records
  -> audit_events(actor=remote-mcp)

ChatGPT Desktop Site Tools / WebMCP
  -> search marker A
  -> same record returned

WebMCP
  -> save marker B
  -> D1 records
  -> audit_events(actor=webmcp)

ordinary ChatGPT via Remote MCP
  -> search marker B
  -> same record returned

/api/health
  -> workspaceMatchesSession === true
```

When all of the above pass, Remote MCP and WebMCP are proven to operate against the same D1 workspace.

## Compatibility fallback

`REMOTE_MCP_BEARER_TOKEN` remains supported for trusted external MCP clients and probes. It is not exposed to ChatGPT and is not a substitute for the OAuth linking flow.

## Security notes

- OAuth access tokens are HMAC signed, short lived, issuer/audience/expiry checked, and bound to the configured workspace.
- Authorization codes use PKCE S256 and expire after three minutes.
- Authorization-code redemption is one-time: the nonce is atomically recorded in the existing `audit_events` table without adding a migration.
- Write tools require `dialog.write`; read-only tools require `dialog.read`.
- The manual approval-code path exists for this single-owner deployment. For a multi-user/public service, replace it with an established identity provider before publication.
