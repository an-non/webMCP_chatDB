# Dialog Workspace Bridge - V19.2 Stabilization RC1.2a

Candidate only. Upgrade the server first; this extension blocks keyed auto saves when the server lacks idempotency/read-verification capabilities.

After the Work build/live gate, overwrite the SAME installed extension folder with all files in this folder. Reload extension and chat page. Do not load a second unpacked directory. Pair once for the Bridge; the server token is valid only for the explicitly supported AI page origins. Existing per-origin credentials remain readable for migration. 401/403 diagnostics are shown without exposing token material. Verify workspace before auto mode.

Panel controls:
- Copy AI setup: once per new AI chat, explicitly paste the copied instruction. The extension does not inject it.
- AI-selected auto mode: authorizes new completed assistant suffixes only. Scan now replays visible assistant history newest-first and enqueues only the newest unprocessed sidecar. Automatic scanning still handles only newly completed replies.
- Show last auto result / Show outbox: per-origin states and independent Get proof.
- Retry job: preserves the existing key and record ID; does not create a new write after a verification-only failure.
- Manual save/update, import JSON: separate Get check. Never paste the field name `payload.content` in place of its actual value.

The model can initiate operations through the suffix; the extension verifies them. The model receives no hidden result turn. Copy result only when the chat needs to reason from that result. Native MCP/CLI hosts can return the result directly without this UI limitation.

A visible suffix is intentional. No READY, composer writes, automatic submit, response hiding or feedback injection. Format the suffix as plain text, outside code/quotes. Formatting that would alter its body is rejected visibly.

Supported candidate DOM adapters: ChatGPT, Claude and Gemini. Verified in local DOM fixtures, NOT the user's live pages. A selector mismatch leaves an explicit adapter status and does not interfere with chat. Minimum Chrome manifest version: 120. No claim that desktop extensions run on mobile; use `/workspace-console.html` there.

Storage: one shared bearer token (with per-origin v1 migration fallback) and up to 64 queue jobs / 6MB, private to extension trusted contexts. Queue records contain the command body and read results needed for retry/verification; they are local data, not hidden model memory. Completed history is bounded. Do not export storage wholesale or paste tokens into chat. Auto execution is restricted to save/search/get; destructive operations remain explicit management actions.

## RC1.2a hotfix

Pairing no longer requires an open supported AI tab. A pairing code can be exchanged directly from the Side Panel; a supported ChatGPT/Claude/Gemini tab is only required for status verification, scanning, and Workspace operations.
