import { DIALOG_TOOL_DEFINITIONS, type DialogToolInput, type DialogToolName } from '../lib/dialog-tools.ts';

export function createWebMcpTools(
  invoke: (name: DialogToolName, input: DialogToolInput) => Promise<unknown>,
  onChanged: () => void,
): WebMCP.Tool[] {
  return DIALOG_TOOL_DEFINITIONS.map((definition) => ({
    ...definition,
    execute: async (input) => {
      const result = await invoke(definition.name, input ?? {});
      if (!definition.annotations?.readOnlyHint) onChanged();
      return result;
    },
  })) as WebMCP.Tool[];
}
