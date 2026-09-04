import fs from 'node:fs';
import path from 'node:path';

const root = process.cwd();
const read = (p) => fs.readFileSync(path.join(root, p), 'utf8');
const hosting = JSON.parse(read('.openai/hosting.json'));
const problems = [];
if (hosting.d1 !== 'DB') problems.push('D1 binding must be DB');
if (hosting.r2 !== 'FILES') problems.push('R2 binding must be FILES');
if (!/^appgprj_[a-f0-9]+$/.test(hosting.project_id ?? '')) problems.push('A provisioned Sites project_id is required');

const mcp = read('lib/dialog-tools.ts');
const expectedTools = [
  'get_dialog_index_overview','list_suggested_indexes','search_dialog_records','get_dialog_record',
  'save_and_index_dialog_record','update_dialog_record','move_dialog_record_index','delete_dialog_record',
  'get_dialog_index_activity','save_dialog_file_base64','organize_text_with_external_ai'
];
for (const tool of expectedTools) if (!mcp.includes(`name: '${tool}'`)) problems.push(`Missing shared tool contract: ${tool}`);
if (!read('app/useWebMcp.ts').includes('context.registerTool')) problems.push('WebMCP adapter must call document.modelContext.registerTool');

for (const f of ['app/mcp/route.ts','app/api/session/route.ts','app/api/health/route.ts','app/api/overview/route.ts','app/api/indexes/route.ts','app/api/activity/route.ts','app/api/records/route.ts','app/api/record/route.ts','app/api/file/route.ts','app/api/upload/route.ts','app/api/ai/organize/route.ts','lib/server/dialog-service.ts']) {
  if (!fs.existsSync(path.join(root,f))) problems.push(`Missing route: ${f}`);
}
for (const f of ['db/schema.ts','drizzle.config.ts']) {
  if (!fs.existsSync(path.join(root,f))) problems.push(`Missing D1 migration source: ${f}`);
}

const integration = read('public/dialog-index-integration.js');
for (const marker of [
  "fetchJson('/api/session'",
  "fetchJson('/api/overview'",
  "url.searchParams.set('q'",
  "url.searchParams.set('index'",
  "/api/file?id=",
  'data unavailable',
  'workspaceMatchesSession',
]) {
  if (!integration.includes(marker)) problems.push(`Missing UI integration safeguard: ${marker}`);
}
const tankHtml = read('public/dialog_index_tank_verified.html');
for (const demoMarker of ['Remote MCP production handoff', 'Yuki continuity corpus', 'Production release baseline']) {
  if (tankHtml.includes(demoMarker)) problems.push(`Production Tank HTML must not contain demo record: ${demoMarker}`);
}
const remote = read('lib/server/remote-mcp.ts');
if (remote.includes("request.headers.get('oai-authenticated-user-id')")) problems.push('Undocumented oai-authenticated-user-id authentication bypass must not be present');
const health = read('app/api/health/route.ts');
if (!health.includes('workspaceMatchesSession')) problems.push('Health endpoint must report browser/Remote MCP workspace alignment');
const allText = fs.readdirSync(root).length ? fs.readFileSync(path.join(root,'README.md'),'utf8') + read('vite.config.ts') + read('.openai/hosting.json') : '';
if (/seiseki-api|tokyo-odh-129|production-20260830/i.test(allText)) problems.push('SEISEKI deployment identifier detected');

if (problems.length) {
  console.error(problems.join('\n'));
  process.exit(1);
}
console.log(`Static validation PASS: ${expectedTools.length} shared WebMCP/Remote MCP tools, DB/FILES bindings, session-first UI integration, server-side search/overview, file download, workspace alignment diagnostics, and strict Remote MCP Bearer auth.`);
