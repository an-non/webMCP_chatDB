(() => {
  'use strict';
  const definitions = {
    'chatgpt.com': { site: 'chatgpt', assistants: '[data-message-author-role="assistant"]', users: '[data-message-author-role="user"]', busy: '[data-testid="stop-button"],button[aria-label="Stop generating"],button[aria-label="\u751f\u6210\u3092\u505c\u6b62\u3059\u308b"]' },
    'claude.ai': { site: 'claude', assistants: '.font-claude-response-body', assistantFallbacks: ['.font-claude-response', '[data-testid="assistant-message"] .standard-markdown', '[data-testid="assistant-message"] .progressive-markdown', '[data-testid="assistant-message"]', '[data-testid="ai-message"]', '[data-testid="message-assistant"]', '.font-claude-message', '.assistant-message'], users: '[data-testid="user-message"], [data-testid="human-message"], [data-testid="message-human"], .font-user-message', busy: '[data-is-streaming="true"],button[aria-label="Stop response"],button[aria-label="Stop generating"]' },
    'gemini.google.com': { site: 'gemini', assistants: 'model-response', users: 'user-query', busy: 'button[aria-label="Stop response"],button[aria-label="Stop generating"], .stop-button' },
  };
  definitions['chat.openai.com'] = definitions['chatgpt.com'];
  function adapter(host) { return definitions[host] || null; }
  function visible(element) {
    return !element.closest('[aria-hidden="true"], [hidden]') && !!element.getClientRects().length;
  }
  function outermost(doc, selector) {
    const all = [...doc.querySelectorAll(selector)].filter(visible);
    return all.filter(node => !all.some(other => other !== node && other.contains(node)));
  }
  function nodes(doc, config) {
    if (!config) return [];
    const primary = outermost(doc, config.assistants);
    if (primary.length || !Array.isArray(config.assistantFallbacks)) return primary;
    for (const selector of config.assistantFallbacks) {
      const fallback = outermost(doc, selector);
      if (fallback.length) return fallback;
    }
    return [];
  }
  function text(node, keepFormatted = false) {
    // Exclude quoted user/tool text and code examples from executable transport.
    const copy = node.cloneNode(true);
    copy.querySelectorAll('button, [role="button"], svg').forEach(n => n.remove());
    if (!keepFormatted) copy.querySelectorAll('pre, code, blockquote, [data-dialog-untrusted]').forEach(n => n.remove());
    const walk = element => {
      if (element.nodeType === 3) return element.textContent || '';
      if (element.nodeType !== 1) return '';
      if (element.tagName === 'BR') return '\n';
      const value = [...element.childNodes].map(walk).join('');
      return /^(P|DIV|LI|SECTION|ARTICLE)$/.test(element.tagName) ? `${value}\n` : value;
    };
    return walk(copy).trimEnd();
  }
  function busy(doc, config) { return !!config && [...doc.querySelectorAll(config.busy)].some(visible); }
  function messageId(node) { return node.getAttribute('data-message-id') || node.closest('[data-message-id]')?.getAttribute('data-message-id') || ''; }
  globalThis.DWAdapters = { adapter, nodes, text, busy, messageId };
})();
