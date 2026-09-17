# Work instruction — reconcile current Dialog Workspace into Git

Target repository: `an-non/webMCP_chatDB`

Target reconciliation branch: `reconcile/v19.2-rc1`

Do **not** use the current `main` branch as deployment input. It is an older 2026-09-05 snapshot (`180d7ac`, package `0.3.0`) and is behind the V19.x source that has already been deployed and live-tested.

## Goal

Restore the intended source-control loop without changing the current architecture:

```text
Git commit
  -> Work validation
  -> existing ChatGPT Sites project

Git bridge/ source
  -> validation/package
  -> local Edge/Chromium extension update
```

Git should become the single implementation source of truth again. ZIP and patch packages are migration evidence only.

## Existing production assets — preserve

- Site: `https://dialog-index-mcp.mars-inc-7675.chatgpt.site`
- Sites project ID: `appgprj_6a977c8675a08191b54f3849ee9f1653`
- D1 binding: `DB`
- R2 binding: `FILES`
- validated workspace: `ws:6b73f7e638df163676cc057f2dc75b80`

Do not recreate or replace:

- Sites project
- D1/R2 bindings
- D1 schema/data
- R2 objects
- OAuth secrets
- Browser pairing credentials

## Phase 1 — inspect before writing

1. Fetch/inspect the **actual current source associated with the deployed Sites project / current Work project**.
2. Compare it with:
   - Git `main` (`180d7ac`), and
   - the V19.2 Stabilization RC1 source used for the current deployment.
3. Report the differences before applying any destructive replacement.
4. Treat current production behavior as evidence, not as proof that every local candidate file is deployed byte-for-byte.

Known live PASS evidence for current server path:

- plaintext Save
- independent `record.get`
- Search
- D1 `read_from_store`
- ChatGPT AI-selected automatic save through Browser Bridge
- independent Get/hash verification

## Phase 2 — restore server source to Git

After the comparison is understood:

1. Place the exact accepted current Sites application source at the repository root.
2. Preserve the current root build/deploy layout. **Do not move the Sites app under `server/`.**
3. Preserve `.openai/hosting.json` values and existing binding names.
4. Do not remove legacy-compatible endpoints merely to simplify layout.
5. Run:

```bash
npm ci
npm run validate
npm run typecheck
npm run build
```

Report each as PASS / FAIL / NOT TESTED with actual output evidence.

## Phase 3 — version the Browser Bridge separately inside the same repository

Create/maintain:

```text
bridge/
```

for the local Chromium/Edge extension source.

Important deployment boundary:

- repository root application -> Sites deployment
- `bridge/` -> local browser extension package
- `bridge/` is **not** a Sites runtime directory and must not be treated as server code

Latest candidate known at reconciliation time:

- extension version `0.4.3`
- version name `V19.2 Stabilization RC1.1 - external AI scan fix`
- live Claude E2E status: NOT TESTED

Do not label this Bridge candidate stable until live Claude -> Bridge enqueue -> Workspace -> D1 -> independent Get succeeds.

## Phase 4 — CI / release discipline

After reconciliation:

1. CI must validate the root Sites application.
2. Add separate Bridge syntax/regression validation without mixing it into Sites deployment.
3. Every production deployment report must include the exact Git commit SHA.
4. Work should deploy from a named Git commit/branch, not from an untracked ZIP snapshot.
5. Generated ZIPs are release artifacts; the committed source remains authoritative.

## Merge gate

Do not merge reconciliation into `main` until all of these are true:

- current production server source is represented in Git
- build/typecheck/validation results are known
- no D1/R2/schema/secret recreation is required
- deployment boundary between root server and `bridge/` is explicit
- exact candidate commit is documented

If any source conflict or uncertainty remains, stop and report the conflicting paths/diffs rather than forcing a replacement.
