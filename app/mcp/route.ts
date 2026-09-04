import { handleRemoteMcp, getRemoteMcpConfig } from '@/lib/server/remote-mcp';
import { invokeDialogTool } from '@/lib/server/dialog-service';

export const dynamic = 'force-dynamic';

function handle(request: Request) {
  const config = getRemoteMcpConfig();
  return handleRemoteMcp(request, config, (name, input) => invokeDialogTool({ workspaceId: config.workspaceId!, source: 'remote-mcp' }, name, input));
}

export const GET = handle;
export const POST = handle;
export const DELETE = handle;
