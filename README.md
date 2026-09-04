# webMCP_chatDB / Dialog Index

ChatGPT Sites 上で動作する、会話・メモ・ファイルの保存・検索基盤です。

このリポジトリを **Dialog Index の実装正本** とします。今後の受け渡しは、原則として **このGitHubリポジトリ + commit SHA** だけに統一します。ZIP・patch・説明TXTを同時にばらばらに渡さない運用にします。

## Production

- Site: `https://dialog-index-mcp.mars-inc-7675.chatgpt.site`
- Existing Sites Project ID: `appgprj_6a977c8675a08191b54f3849ee9f1653`
- D1 binding: `DB`
- R2 binding: `FILES`
- WebMCP / Site Tools: 11 tools
- Remote MCP endpoint: `/mcp`

> repo HEAD は次回deploy候補です。productionへdeployするまでは、live SiteとHEADが完全一致するとは扱いません。

## 目的

同じDialog Indexデータを2経路から扱います。

```text
WebMCP / Site Tools
ChatGPT Desktop built-in browser
  -> Dialog Index Site
  -> document.modelContext.registerTool()
  -> 11 tools
  -> /api/*
  -> shared dialog-service
  -> D1 DB / R2 FILES

Remote MCP / ordinary ChatGPT
ChatGPT Custom App
  -> OAuth 2.1 + PKCE
  -> /mcp
  -> 11 tools
  -> shared dialog-service
  -> same D1 DB / R2 FILES
```

## 11 tools

1. `get_dialog_index_overview`
2. `list_suggested_indexes`
3. `search_dialog_records`
4. `get_dialog_record`
5. `save_and_index_dialog_record`
6. `update_dialog_record`
7. `move_dialog_record_index`
8. `delete_dialog_record`
9. `get_dialog_index_activity`
10. `save_dialog_file_base64`
11. `organize_text_with_external_ai`

## ChatGPT Custom App対応

repo HEAD には、ordinary ChatGPTからRemote MCPを接続するためのOAuth 2.1実装を追加済みです。

実装済み:

- protected resource metadata
- authorization server metadata
- Dynamic Client Registration (DCR)
- Authorization Code flow
- PKCE `S256`
- `resource` binding
- access token / refresh token
- per-tool `securitySchemes`
- OAuth scope enforcement
- `WWW-Authenticate` discovery challenge
- authorization codeのone-time redemption
- existing D1 `audit_events` を使ったreplay防止
- static Bearer互換経路の維持

Endpoints:

```text
/.well-known/oauth-protected-resource
/.well-known/oauth-authorization-server
/oauth/register
/oauth/authorize
/oauth/token
/mcp
```

詳細な設定手順: [`CUSTOM_APP_SETUP.md`](./CUSTOM_APP_SETUP.md)

## OAuth環境変数

既存のworkspace:

```text
REMOTE_MCP_WORKSPACE_ID=
```

ChatGPT Custom App用に追加:

```text
REMOTE_MCP_OAUTH_APPROVAL_CODE=
REMOTE_MCP_OAUTH_SUBJECT=dialog-index-owner
```

推奨:

```text
REMOTE_MCP_OAUTH_SIGNING_SECRET=
```

`REMOTE_MCP_OAUTH_SIGNING_SECRET` が未設定の場合は、移行互換のため既存 `REMOTE_MCP_BEARER_TOKEN` を署名secretとして利用できます。ただし、本番では別secretを推奨します。

任意:

```text
REMOTE_MCP_OAUTH_ALLOWED_EMAILS=
```

本物のsecretはGitHub・README・ログ・チャットへ書かないでください。

## Workspace — 最重要

Web UI / WebMCPとRemote MCPは、同じD1 bindingを使っていても `workspaceId` が違えば別データとして見えます。

```text
Web UI + WebMCP
  -> HttpOnly cookie: dialog_index_workspace

Remote MCP
  -> REMOTE_MCP_WORKSPACE_ID
```

同一データを扱う条件:

1. production Siteで `/api/session` を確立
2. その `workspaceId` を `REMOTE_MCP_WORKSPACE_ID` に設定
3. `/api/health` を確認
4. `remoteMcp.authentication.workspaceMatchesSession === true`

## D1 / R2

D1主要テーブル:

```text
workspaces
records
index_aliases
audit_events
```

MCP/WebMCPの書込み経路は `audit_events.actor` で確認できます。

```text
web-ui
webmcp
remote-mcp
oauth
```

R2 object key:

```text
objects/{workspaceId}/{recordId}/{filename}
```

DB schema / migration / 既存records / R2 objectsは今回変更していません。

## UI

- Tank UI
- ASCII sea / side shoal
- 5 themes
- records / indexes / detail / activity
- D1 server-side search
- R2 upload / download
- real overview counts
- D1 / R2 / WebMCP / Remote MCP health

## v4以降の修正

- iframe初期API呼出し前に `/api/session` を確立
- UI検索を最新100件のローカル検索からD1検索へ変更
- `/api/overview` で正しい総件数を表示
- 6件を超えるindexへUIから到達可能に修正
- file download導線を追加
- demo値 / fake count / fake healthを除去
- workspace一致状態をhealthへ追加
- 未文書化headerによるRemote MCP auth bypassを削除
- OAuth 2.1 / PKCE / DCRをRemote MCPへ追加
- read/write scopesをtool単位で付与
- static validation / UI validation / MCP validation / CIを追加

## Local / CI validation

Node.js 22.13+:

```bash
npm install
npm run validate
npm run typecheck
npm run build
```

GitHub Actionsでもpush時に同じvalidation/typecheck/buildを実行します。

## Production deploy

**既存Sites Projectだけを更新します。**

変更しないもの:

- Project ID
- D1 `DB`
- R2 `FILES`
- existing D1 schema / migration
- existing records / R2 objects
- 11 tool names
- `/mcp` endpoint
- SEISEKI
- 他Sites / 他Cloudflare資産

production反映後にChatGPT Custom Appへ以下を登録します。

```text
https://dialog-index-mcp.mars-inc-7675.chatgpt.site/mcp
```

その後:

```text
Scan Tools
 -> OAuth authorize
 -> 11 tools discovered
 -> ordinary chatでsave/search
 -> D1 audit actor=remote-mcp
```

詳しくは [`CUSTOM_APP_SETUP.md`](./CUSTOM_APP_SETUP.md)。

## DBまでの最終疎通条件

```text
Remote MCPでmarker A保存
  -> D1 records
  -> audit_events(actor=remote-mcp)

WebMCPでmarker A検索
  -> same record

WebMCPでmarker B保存
  -> D1 records
  -> audit_events(actor=webmcp)

Remote MCPでmarker B検索
  -> same record

workspaceMatchesSession === true
```

これが通ったら、Remote MCPとWebMCPが同一workspace / 同一D1まで疎通済みと判定します。

## 受け渡しルール

今後は基本的にこれだけ渡します。

```text
Repository: https://github.com/an-non/webMCP_chatDB
Commit: <target commit SHA>
```

Sitesへの指示:

```text
このrepo/commitを実装正本として、既存Dialog Index Sites Projectへ反映する。
新規Site/D1/R2を作らない。
READMEとCUSTOM_APP_SETUP.mdの境界を守る。
```

既存productionへ差分だけ適用する必要がある場合に限り、明示したpatch 1本だけを渡します。フルソースとpatchを同時に渡しません。

## Security

- secret/tokenをcommitしない
- secret/tokenをチャットへ貼らない
- workspace IDをMCP tool inputから任意指定させない
- Remote MCP data operationは認証なしで許可しない
- OAuth access tokenはissuer/audience/expiry/scope/workspaceを検証
- authorization codeはPKCE S256 + short expiry + one-time redemption
- manual approval codeは単一owner運用向け。multi-user/public公開時はestablished IdPへ置換する
