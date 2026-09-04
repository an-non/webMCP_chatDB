import { env } from 'cloudflare:workers';

let ready: Promise<void> | null = null;

export async function ensureSchema(): Promise<void> {
  if (!ready) {
    ready = (async () => {
      if (!env.DB) throw new Error('D1 binding DB is unavailable');
      await env.DB.prepare('SELECT id FROM workspaces LIMIT 1').first();
    })();
  }
  await ready;
}
