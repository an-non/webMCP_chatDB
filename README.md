# webMCP_chatDB / Dialog Index

ChatGPT Sites 上で動作する、会話・メモ・ファイルを保存/検索する Dialog Index 実装です。

このリポジトリは **Dialog Index の実装正本** として扱います。今後は、複数の ZIP / TXT / MD をばらばらに渡すのではなく、原則として **この GitHub リポジトリ + 対象 commit SHA** を受け渡し単位にします。

## 現在の状態

- Production URL: `https://dialog-index-mcp.mars-inc-7675.chatgpt.site`
- Existing Sites Project ID: `appgprj_6a977c8675a08191b54f3849ee9f1653`
- Production v4 を基準に監査・修正した **v5 correction candidate** がこのリポジトリの HEAD
- D1 binding: `DB`
- R2 binding: `FILES`
- WebMCP: 11 tools
- Remote MCP endpoint: `/mcp`
- DB schema / migration / 既存データの変更: なし

> Production へ v5 を反映するまでは、live production と repo HEAD は同一ではありません。deploy 後にこの節を更新してください。

## 何ができるか

### Web UI

- Tank UI
- ASCII sea / 左右 shoal
- 5テーマ切替
- Records / Indexes / Detail / Activity
- D1 server-side search
- R2 file upload / download
- 実件数・health 表示

### WebMCP / Site Tools

ChatGPT Desktop の built-in browser で Site を開くと、top-level document が `document.modelContext.registerTool()` を使って 11 tools を登録します。

```text
ChatGPT Desktop built-in browser
  -> Dialog Index Site
  -> WebMCP / Site Tools (11)
  -> same-origin /api/*
  -> shared dialog-service
  -> D1 DB / R2 FILES
```

### Remote MCP

`/mcp` に Streamable HTTP/JSON-RPC の Remote MCP 入口があります。

```text
trusted MCP client
  -> HTTPS /mcp
  -> configured static Bearer
  -> REMOTE_MCP_WORKSPACE_ID
  -> shared dialog-service
  -> D1 DB / R2 FILES
```

現在の static Bearer は trusted external client / probe 用です。**ChatGPT の ordinary chat から Custom MCP App として直接利用するための OAuth 2.1 実装完了を意味しません。**

## WebMCP 11 tools

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

## v4 から今回修正した点

- iframe の並列 API 呼出し前に `/api/session` を確立
- UI検索を「最新100件のローカル絞込み」から D1 server-side search へ変更
- `/api/overview` を使って records / indexes の実総数を表示
- 6件を超える index へ UI から到達可能に修正
- R2 file record の download UI を追加
- 固定 demo record / fake count / fake health を除去
- loading / empty / unavailable 状態を明示
- Web UI/WebMCP workspace と Remote MCP workspace の一致状態を `/api/health` で確認可能にした
- 未文書化 `oai-authenticated-user-id` header による Remote MCP 認証 bypass を削除
- static / UI session order / MCP validation と production probe を追加

詳細: `CHANGELOG_V5_CANDIDATE.md`

## Workspace — 最重要

Web UI / WebMCP と Remote MCP は、設定を合わせないと **同じ D1 を使っていても別の論理 workspace** を見ることがあります。

```text
Web UI + WebMCP
  -> HttpOnly cookie: dialog_index_workspace

Remote MCP
  -> REMOTE_MCP_WORKSPACE_ID
```

同一データを扱う条件:

1. intended browser profile で `POST /api/session`
2. 返った `workspaceId` を `REMOTE_MCP_WORKSPACE_ID` に設定
3. 同じ browser session で `/api/health` を確認
4. `remoteMcp.authentication.workspaceMatchesSession === true` を要求

## DB / R2

### D1

Binding: `DB`

主要テーブル:

- `workspaces`
- `records`
- `index_aliases`
- `audit_events`

`audit_events.actor` には入口が残ります。

- `web-ui`
- `webmcp`
- `remote-mcp`

### R2

Binding: `FILES`

object key:

```text
objects/{workspaceId}/{recordId}/{filename}
```

## ローカル確認

Node.js 22.13+ を使用します。

```bash
npm install
npm run validate
npm run typecheck
npm run build
```

`npm run validate` は以下を実行します。

```text
validate:static
validate:ui
validate:mcp
```

Production read-only probe:

```bash
DIALOG_INDEX_BASE_URL=https://dialog-index-mcp.mars-inc-7675.chatgpt.site \
  npm run probe:production
```

Remote MCP authenticated probe を行う場合、Bearer token は shell の環境変数/secret として渡し、ソース・UI・ログ・チャットへ書かないでください。

## Production へ反映する場合

**既存 Project のみ更新します。新規 Site / D1 / R2 は作りません。**

変更禁止境界:

- `.openai/hosting.json` の Project ID / binding
- `db/*`
- `drizzle/*`
- 既存 migration / schema / records / R2 objects
- `lib/server/dialog-service.ts` の既存保存意味論
- `lib/dialog-tools.ts` の11 tool名・schema
- `app/useWebMcp.ts`
- `app/webmcp-adapter.ts`
- Remote MCP endpoint `/mcp`
- SEISEKI / 他 Site / 他 Cloudflare 資産

手順は `SITES_DEPLOY_INSTRUCTION.txt` と `DEPLOY_AND_E2E.md` を参照してください。

## DBまでの疎通完了条件

「validation が PASS」だけでは完了扱いにしません。最終的には production で以下を確認します。

```text
WebMCP
  -> marker A を save
  -> D1 records
  -> audit_events(actor=webmcp)

Remote MCP
  -> marker B を save
  -> D1 records
  -> audit_events(actor=remote-mcp)

WebMCP から marker B を search
Remote MCP から marker A を search
workspaceMatchesSession === true
```

これが通れば、WebMCP / Remote MCP が **同一 workspace / 同一 D1 まで疎通済み** と判断できます。

---

# ファイル受け渡しルール

ここを今後の標準にします。

## 1. 通常の開発・Sites実装依頼

**渡すものは1つだけ:**

```text
https://github.com/an-non/webMCP_chatDB
```

加えて対象 commit SHA を指定します。ZIPや個別ファイルを重ねて渡しません。

指示:

```text
このrepo/commitを正本として既存Dialog Index Sites Projectへ反映する。
新しいSite/D1/R2は作らず、READMEとSITES_DEPLOY_INSTRUCTION.txtの境界を守る。
```

## 2. production v4 に「今回の差分だけ」適用する場合

**渡すもの:**

```text
patches/production-v4-to-v5-candidate.patch
```

だけを実装差分として指定します。

説明は:

```text
CHANGELOG_V5_CANDIDATE.md
```

を参照させます。

`patch` に含まれないファイルを変更させません。

## 3. ファイルで渡さざるを得ない場合

「フルソース」と「差分」を同時に渡さないことを原則にします。

- フル置換/新しい作業環境: repo HEAD のソース一式
- 既存v4への最小修正: patch 1本のみ

どちらを使うかを必ず冒頭で明示します。

## Repository layout

```text
app/                      UI / API / WebMCP registration
lib/                      shared tool contract / server service / Remote MCP
db/                       D1 schema
drizzle/                  existing migration
public/                    Tank UI + integration runtime
scripts/                   validation / production probe
.openai/hosting.json       existing Sites project + DB/R2 bindings
patches/                   production baseline向け明示差分
README.md                  正本・利用方法・受け渡しルール
SITES_DEPLOY_INSTRUCTION.txt
DEPLOY_AND_E2E.md
CHANGELOG_V5_CANDIDATE.md
```

## Security

- `.env` / token / credential を commit しない
- Bearer token を README、issue、log、chat に貼らない
- workspace ID を tool input から任意指定させない
- Remote MCP は認証なしで data operation を許可しない
