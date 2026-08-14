declare module '@deepseek-ai/cordis' {
  export interface Context {
    tools: any
    workflowEngine: any
    subagents: any
    systemPrompt: any
    sessions: any
    slots?: {
      register?: (options: any, component: any) => void
      inject?: (name: string, fn: any) => void
    }
  }
}

declare module '@deepseek-ai/schemastery' {
  export interface Schema<S = any, T = S> {
    default(value: T): Schema<S, T>
    required(): Schema<S, T>
    step(value: number): Schema<S, T>
    min(value: number): Schema<S, T>
    max(value: number): Schema<S, T>
  }
  export type z<T = any> = Schema<T>
  const z: {
    <T = any>(schema: any): Schema<T>
    object: (dict: Record<string, any>) => Schema
    string: () => Schema<string>
    number: () => Schema<number>
    boolean: () => Schema<boolean>
    array: (inner: any) => Schema<any[]>
    union: (choices: readonly any[]) => Schema
  }
  export default z
}

declare module '@deepseek-ai/dsh-agent' {
  export interface Agent {
    id: string
    session: any
    ctx: any
    options: any
  }
}

declare module '@deepseek-ai/dsh-llm' {
  export interface ContentBlock {
    type: string
    [key: string]: any
  }
}

declare module '@deepseek-ai/dsh-session' {
  export type JsonValue = string | number | boolean | null | JsonValue[] | { [key: string]: JsonValue }
  export interface Session {
    id: string
    events: any[]
    firstLiveSeq: number
    header: any
  }
}

declare module '@deepseek-ai/dsh-tools' {
  export type ToolPresentationMode = 'native' | 'code' | 'both'
  export interface ToolCallView {
    card: string
    title?: string
    rawInput?: string
  }
  export interface ToolResultView {
    card: string
  }
  export function defineTool(options: any): any
}

declare module '@deepseek-ai/dsh-workflow' {
  export interface WorkflowRun {
    id: string
    meta: any
    result: Promise<WorkflowResult>
    cancel(reason?: string): void
    dispose(): Promise<void>
  }
  export interface WorkflowResult {
    stopReason: string
    value?: any
    error?: string
    agentsStarted: number
  }
  export interface WorkflowChildValidationInfo {
    seq: number
    label: string
    phase?: string
    childId: string
    localAgent?: any
    sessionStartSeq?: number
  }
}

declare module '@deepseek-ai/dsh-subagent' {}
declare module '@deepseek-ai/dsh-system-prompt' {}
