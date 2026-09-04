export {};

declare global {
  namespace WebMCP {
    interface Tool {
      name: string;
      title?: string;
      description: string;
      inputSchema: Record<string, unknown>;
      annotations?: Record<string, unknown>;
      execute: (input: Record<string, unknown>) => unknown | Promise<unknown>;
    }
    interface ModelContext {
      registerTool(tool: Tool, options?: { signal?: AbortSignal }): Promise<void> | void;
    }
  }
  interface Document {
    modelContext?: WebMCP.ModelContext;
  }
}
