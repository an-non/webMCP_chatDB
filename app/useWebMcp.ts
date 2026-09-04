'use client';
import { useEffect, useState } from 'react';
import type { DialogToolInput, DialogToolName } from '@/lib/dialog-tools';
import { api } from './lib/api';
import { createWebMcpTools } from './webmcp-adapter';

export type WebMcpStatus = 'ready' | 'unavailable' | 'error';

export function useWebMcp(onChanged: () => void): WebMcpStatus {
  const [status, setStatus] = useState<WebMcpStatus>('unavailable');
  useEffect(() => {
    const context = document.modelContext;
    if (!window.isSecureContext || !context?.registerTool) return;
    const controller = new AbortController(); let active = true;
    const tools = createWebMcpTools((name, input) => invokeWebTool(name, input), onChanged);
    Promise.all(tools.map((tool) => Promise.resolve(context.registerTool(tool, { signal: controller.signal }))))
      .then(() => active && setStatus('ready'))
      .catch((error) => { if (!controller.signal.aborted) { console.warn('WebMCP registration failed', error); active && setStatus('error'); } });
    return () => { active = false; controller.abort(); };
  }, [onChanged]);
  return status;
}

async function invokeWebTool(name: DialogToolName, input: DialogToolInput): Promise<unknown> {
  switch (name) {
    case 'get_dialog_index_overview': return (await api('/api/overview', undefined, 'webmcp')).overview;
    case 'list_suggested_indexes': return (await api('/api/indexes', undefined, 'webmcp')).indexes;
    case 'search_dialog_records': {
      const url = new URL('/api/records', location.origin);
      if (input.query) url.searchParams.set('q', String(input.query));
      if (input.suggestedIndex) url.searchParams.set('index', String(input.suggestedIndex));
      if (input.limit) url.searchParams.set('limit', String(input.limit));
      return (await api(url.pathname + url.search, undefined, 'webmcp')).records;
    }
    case 'get_dialog_record': return (await api(`/api/record?id=${encodeURIComponent(String(input.id))}`, undefined, 'webmcp')).record;
    case 'save_and_index_dialog_record': return (await api('/api/records', { method: 'POST', body: JSON.stringify(input) }, 'webmcp')).record;
    case 'update_dialog_record': return (await api('/api/record', { method: 'PATCH', body: JSON.stringify({ id: input.id, patch: input.patch }) }, 'webmcp')).record;
    case 'move_dialog_record_index': return (await api('/api/record', { method: 'PATCH', body: JSON.stringify({ operation: 'move_dialog_record_index', id: input.id, patch: { suggestedIndex: input.suggestedIndex, indexConfidence: input.indexConfidence, needsReview: input.needsReview } }) }, 'webmcp')).record;
    case 'delete_dialog_record': return (await api('/api/record', { method: 'DELETE', body: JSON.stringify({ id: input.id }) }, 'webmcp')).result;
    case 'get_dialog_index_activity': return (await api('/api/activity', undefined, 'webmcp')).activity;
    case 'save_dialog_file_base64': return (await api('/api/file', { method: 'POST', body: JSON.stringify(input) }, 'webmcp')).record;
    case 'organize_text_with_external_ai': return (await api('/api/ai/organize', { method: 'POST', body: JSON.stringify(input) }, 'webmcp')).result;
  }
}
