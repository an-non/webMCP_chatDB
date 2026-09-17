/* Durable queue, dependency-injected for behavioral tests. No host DOM access. */
(() => {
  'use strict';
  const { hash, parseCommand, normalize, byteLength } = DWProtocol;
  const STORAGE_KEY = 'dialogWorkspaceOutboxV1';
  const TERMINAL = new Set(['verified', 'completed', 'verification_failed', 'blocked', 'exhausted']);
  function createOutbox(deps) {
    let serial = Promise.resolve();
    const exclusive = fn => { const p = serial.then(fn, fn); serial = p.catch(() => {}); return p; };
    const read = async () => (await deps.storage.get(STORAGE_KEY))[STORAGE_KEY] || {};
    async function write(jobs) {
      if (byteLength(JSON.stringify(jobs)) > 6000000) throw new Error('outbox_capacity_export_or_clear_completed');
      await deps.storage.set({ [STORAGE_KEY]: jobs });
    }
    async function enqueue(input) {
      return exclusive(async () => {
        const parsed = parseCommand(input.command);
        const id = await hash(`${input.origin}\0${input.pageUrl}\0${input.actionId || input.messageId || input.command}`);
        const jobs = await read();
        const previous = jobs[id];
        const commandHash = await hash(input.command);
        if (previous) {
          if (previous.commandHash !== commandHash) throw new Error('action_id_reused_for_different_command');
          return publicJob(previous);
        }
        // Keep a bounded audit history; never evict pending work.
        const terminal = Object.values(jobs).filter(j => TERMINAL.has(j.state)).sort((a, b) => a.createdAt - b.createdAt);
        while (Object.keys(jobs).length >= 64 && terminal.length) delete jobs[terminal.shift().id];
        if (Object.keys(jobs).length >= 64) throw new Error('outbox_full');
        jobs[id] = { id, commandHash, command: input.command, kind: parsed.kind,
          expectedHash: parsed.kind === 'save' ? await hash(parsed.body) : null,
          pageUrl: input.pageUrl, pageTitle: input.pageTitle || '', origin: input.origin,
          idempotencyKey: `bridge:${id}`, state: 'queued', attempts: 0, verifyAttempts: 0,
          createdAt: Date.now(), updatedAt: Date.now(), nextAt: 0, workspaceId: null };
        await write(jobs); // Persist BEFORE network; not marked successful here.
        return publicJob(jobs[id]);
      });
    }
    async function drain() {
      return exclusive(async () => {
        const jobs = await read();
        for (const job of Object.values(jobs).sort((a,b) => a.createdAt - b.createdAt)) {
          if (TERMINAL.has(job.state) || job.nextAt > Date.now()) continue;
          try {
            if (!job.recordId) job.attempts += 1;
            else job.verifyAttempts += 1;
            const status = await deps.status(job.origin);
            if (!status.paired) { job.state = 'blocked'; job.error = status.reason || 'auth_required'; continue; }
            if (job.workspaceId && status.workspaceId !== job.workspaceId) throw permanent('workspace_changed');
            job.workspaceId = status.workspaceId;
            if (job.kind === 'save' && !status.features?.idempotentSave) throw permanent('server_upgrade_required_for_safe_retry');
            if (!job.recordId) {
              job.state = 'sending'; job.updatedAt = Date.now();
              await write(jobs);
              const result = await deps.command(job.origin, {
                text: job.command,
                ...(job.kind === 'save' ? { idempotencyKey: job.idempotencyKey } : {}),
                metadata: { source: DWProtocol.RELEASE, assistantSelected: true,
                  pageUrl: job.pageUrl, pageTitle: job.pageTitle },
              });
              if (result?.ok !== true || result.status !== 'executed') throw permanent(`not_executed:${result?.status || result?.code || 'malformed_response'}`);
              job.executionId = result.commandExecutionId;
              if (job.kind !== 'save') {
                job.state = 'completed'; job.result = result; job.error = null; continue;
              }
              job.recordId = result.data?.recordId || result.references?.[0]?.recordId;
              if (!job.recordId) throw permanent('save_response_has_no_record_id');
              if (result.parsed?.kind !== 'save' || await hash(normalize(result.parsed?.inlineContent ?? '')) !== job.expectedHash) throw permanent('parsed_payload_mismatch');
              // Never classify save echo as proof. Keep the next phase durable.
              job.state = 'verifying'; await write(jobs);
            }
            job.state = 'verifying'; await write(jobs);
            const fetched = await deps.get(job.origin, job.recordId);
            const row = fetched?.data;
            if (fetched?.ok !== true || !row) throw Object.assign(new Error('get_failed'), { retryable: true });
            const actualHash = await hash(normalize(row.content ?? ''));
            job.verification = { expectedHash: job.expectedHash, actualHash,
              getExecutionId: fetched.executionId, payloadStatus: row.payloadStatus,
              workspaceMatches: row.workspaceId === job.workspaceId,
              recordMatches: row.recordId === job.recordId, checkedAt: new Date().toISOString() };
            job.state = actualHash === job.expectedHash && row.workspaceId === job.workspaceId && row.recordId === job.recordId && row.payloadStatus === 'read_from_store'
              ? 'verified' : 'verification_failed';
            job.error = job.state === 'verified' ? null : 'independent_read_mismatch';
          } catch (error) {
            job.error = error.message || String(error);
            const attempts = job.recordId ? job.verifyAttempts : job.attempts;
            if (error.retryable === false) job.state = 'blocked';
            else if (attempts >= 5) job.state = 'exhausted';
            else { job.state = 'retry_wait'; job.nextAt = Date.now() + Math.min(60000, 2000 * 2 ** Math.max(0, attempts - 1)); }
          } finally {
            job.updatedAt = Date.now();
            await write(jobs);
            await deps.notify?.(publicJob(job));
          }
        }
        const next = Object.values(jobs).filter(j => !TERMINAL.has(j.state));
        if (next.length) await deps.schedule?.(Math.min(...next.map(j => Math.max(Date.now() + 1000, j.nextAt || 0))));
        return Object.values(jobs).map(publicJob);
      });
    }
    async function list(origin, pageUrl) {
      return Object.values(await read()).filter(j => j.origin === origin && (!pageUrl || j.pageUrl === pageUrl)).map(publicJob);
    }
    async function retry(id, origin) {
      return exclusive(async () => {
        const jobs = await read(); const job = jobs[id];
        if (!job || job.origin !== origin) throw permanent('job_not_found');
        if (job.state === 'verified' || job.state === 'completed') return publicJob(job);
        // Always preserve the original id/key and body; a retry cannot be a new write.
        job.state = job.recordId ? 'verifying' : 'queued'; job.attempts = 0; job.verifyAttempts = 0; job.nextAt = 0;
        await write(jobs); return publicJob(job);
      });
    }
    return { enqueue, drain, list, retry };
  }
  function permanent(message) { return Object.assign(new Error(message), { retryable: false }); }
  function publicJob(job) {
    const { command, ...publicValue } = job;
    return { ...publicValue, commandPreview: command?.slice(0, 180), ok: ['verified','completed'].includes(job.state) };
  }
  globalThis.DWOutbox = { createOutbox, STORAGE_KEY };
})();
