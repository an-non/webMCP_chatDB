# Dialog Workspace — Current State / Reconciliation Note

Date: 2026-09-17

This repository is intended to be the implementation source of truth for Dialog Index / Dialog Workspace. However, `main` is currently behind the live/working V19.x line. Do not treat `main` as an exact production snapshot until reconciliation is completed.

## GitHub state observed

- Repository: `an-non/webMCP_chatDB`
- Default branch: `main`
- `main` HEAD: `180d7ac0099e81c1761429aeab0a48f0aa90689b`
- HEAD date: 2026-09-05
- `package.json` on `main`: `0.3.0`
- Branches observed before reconciliation: `main` only
- Existing README already declares this repository to be the implementation source of truth.

## Production / live state known from the V19.x work

Existing Sites project remains unchanged:

- Site: `https://dialog-index-mcp.mars-inc-7675.chatgpt.site`
- Sites project ID: `appgprj_6a977c8675a08191b54f3849ee9f1653`
- D1 binding: `DB`
- R2 binding: `FILES`
- Current workspace used in live validation: `ws:6b73f7e638df163676cc057f2dc75b80`

The server candidate deployed through Work is V19.2 Stabilization RC1. Its package snapshot reports version `0.11.0`.

Live checks already completed against the deployed environment:

- manual plaintext Save: PASS
- independent `record.get`: PASS
- independent Search: PASS
- D1 physical locator / `read_from_store`: PASS
- ChatGPT AI-selected automatic save through Browser Bridge: PASS
- independent Get/hash verification for that automatic save: PASS

The deployed server must therefore be treated as newer than GitHub `main`.

## Browser Bridge state

The Browser Bridge is a local Chromium/Edge extension. It is NOT deployed as part of the Sites runtime.

Responsibilities are separated as follows:

```text
Git repository root
  -> Sites / Workspace server source
  -> deployed by Work to the existing Sites project

bridge/
  -> Dialog Workspace Bridge extension source
  -> loaded locally by Edge/Chromium
  -> never deployed to Sites as server runtime
```

The latest reconciliation candidate is:

- extension version: `0.4.3`
- version name: `V19.2 Stabilization RC1.1 - external AI scan fix`
- status: candidate, NOT yet accepted as live-stable for Claude

Known external-AI evidence:

- Claude conversation can emit a valid DWCMD: PASS
- RC1 / first Claude hotfix Bridge enqueue on live Claude: FAIL (`No AI-selected command has run for this origin.`)
- RC1.1 adds explicit historical/manual `Scan now` reinspection and broader Claude DOM adapters
- RC1.1 local fixture test: PASS
- RC1.1 live Claude -> Bridge -> Workspace -> D1: NOT TESTED yet

Do not report RC1.1 as production-stable until that single live E2E succeeds.

## Source-of-truth policy from this point

1. GitHub is the canonical source, but only after the current production source has been reconciled back into Git.
2. Do not deploy from stale `main` until reconciliation is complete.
3. Keep the Sites application at repository root. Do not move it under `server/` merely for tidiness; that would change the existing build/deploy boundary without benefit.
4. Add and maintain the local extension under `bridge/`.
5. Work should deploy only the repository-root Sites application. `bridge/` is a build/release artifact for the local browser extension, not a Sites deployment target.
6. Every production deployment should record the exact Git commit SHA used.
7. ZIP/patch files may be used for transfer/recovery, but must not become a second source of truth.
8. D1/R2 bindings, existing Workspace data, OAuth secrets and pairing credentials must never be recreated merely to reconcile source control.

## Reconciliation plan

This branch (`reconcile/v19.2-rc1`) exists to restore the Git/source relationship safely.

Before merging to `main`:

1. Compare the current Work/Sites source against the V19.2 Stabilization RC1 server snapshot.
2. Import the exact current server source into the repository root.
3. Preserve `.openai/hosting.json`, project ID, D1/R2 bindings, schema and existing data.
4. Add the current Browser Bridge under `bridge/`.
5. Run `npm ci`, validation, typecheck and build against the reconciled repository.
6. Re-run the already proven live Save -> independent Get -> Search path after deployment only if server code actually changes.
7. Run one Claude external-AI Bridge E2E for RC1.1; do not repeat identical save requests if diagnostics are sufficient.
8. Merge to `main` only after the root source is demonstrably the same source that is safe to deploy.

## Current artifact fingerprints

These fingerprints identify the local reconciliation inputs used to establish this note. They are references, not Git source replacements.

- V19.2 Stabilization RC1 package SHA-256: `57a2ba0c38dd4b1409fe391a8c838382f3f2598d453669409d39cbf8ef5c5dd5`
- RC1.1 Bridge package SHA-256: `ae45d033712b69e746fa6304459ee8f0d8f91ec038f2601850a09978352a7376`

## Important distinction

The current issue is not that Git was never intended to be used. Git was already declared as the source of truth; the problem is that later V19.x work bypassed that source-of-truth loop by moving through Work/ZIP patches without committing the resulting production state back to Git.

The goal of this reconciliation is therefore not a new architecture. It is to restore the architecture that was already intended: Git -> validated Work deployment -> Sites, with the browser extension versioned alongside the server but deployed separately.

## Reconstructed server-source lineage — verified 2026-09-18

The retained V19.x artifacts were rechecked and the server candidate was reconstructed deterministically:

1. `dialog-index-v19-universal-plaintext-full.zip`
   - SHA-256: `776446c3062096cbf2481255a30187c1166846f75a40f4d004a97a781c0d8234`
   - package version: `0.11.0`
2. Apply the two-file V19.2 payload fix from `dialog-index-v19.2-payload-fix-patch.zip`
   - SHA-256: `56d39378d66f31a6a5e38b5149a08aad9e8843716b4e5780f1b3aa514b3cf5f0`
3. Run RC1 `apply.mjs --check` against that root.
   - PASS: `READY_FOR_REVIEW`
   - `dbTouched: false`
4. Run RC1 `apply.mjs --apply`.
   - PASS: `APPLIED_NOT_DEPLOYED`
   - 15 writes; `scripts/validate-natural-command.ts` was already at the accepted candidate hash.
   - `dbTouched: false`

The resulting reconstructed server root was recursively compared with RC1 `test-kit/server`. Every compared source file was byte-identical; the only tree difference was `.env.example`, which exists in the reconstructed V19 root and is intentionally absent from the packaged test-kit server.

Reconstructed-root fingerprint excluding temporary `.dw-backups/`:
- files: `159`
- bytes: `997073`
- sorted SHA-256 manifest aggregate: `d417fbad43607e9c3c26699ed1c00657c0e1972c8f7ce0309316838cbb26c333`

Important: this proves one reproducible V19 -> V19.2 -> RC1 server candidate. It does not yet prove the current editable Work/Sites source is byte-identical to it.

RC1 must not be force-applied to the current Git root: the RC1 guard expects the V19/V19.2 `0.11.0` package hash, while the reconciliation branch still inherits the stale `0.3.0` server root from `main`.

Validation status:
- RC1 package SHA/checksums: PASS
- reconstructed V19.2 -> RC1 preflight/apply: PASS
- source comparison with RC1 test-kit server: PASS, except the noted `.env.example` presence
- `node --check scripts/workspace-command.mjs`: PASS
- `node --check apply.mjs`: PASS
- dependency-backed `npm ci`: NOT TESTED to completion; local offline cache lacks `youch-core@0.3.3` (`ENOTCACHED`)
- full typecheck/build/validate on reconstructed root: NOT TESTED in this runtime
- current editable Work/Sites source byte comparison: NOT TESTED because that source is not currently exposed to this runtime

Next gate: compare the current Work/Sites source with the reconstructed-root fingerprint before replacing the stale Git root or merging to `main`.
