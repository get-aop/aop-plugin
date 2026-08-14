/**
 * Types and interfaces for the AOP Software Delivery workflow plugin.
 * @module @get-aop/dsh-plugin/types
 */

export type RoleName = 'plan' | 'implementation' | 'review' | 'qa'
export type ToolAccess = 'read' | 'write'
export type ToolPresentationMode = 'native' | 'code' | 'both'

/** One role-scoped tool grant and its required tool-owned workspace access. */
export interface ToolGrant {
  /** Registered tool name. */
  name: string
  /** Workspace access that must match the registered tool's declaration. */
  access: ToolAccess
  /** Whether a successful post-navigation call supplies browser QA evidence. */
  browserEvidence?: boolean
  /** Whether this tool navigates the browser to the QA target (given or discovered). */
  browserNavigation?: boolean
}

/** One delivery role's route and visible tool set. */
export interface RoleConfig {
  /** Optional provider override for this role. */
  provider?: string
  /** Optional model override for this role (e.g. sol-xhigh, deepseek-v4-flash-max, fable-5-max, sol-medium). */
  model?: string
  /** Optional model-facing presentation mode for this role's tools. */
  toolPresentation?: ToolPresentationMode
  /** Non-empty, explicitly classified tool grants visible to this role. */
  tools: ToolGrant[]
}

/** Deployment configuration for the AOP delivery workflow plugin. */
export interface Config {
  /** Fresh subagent provider used for every role (default `spawn`). */
  subagentProvider?: string
  /** Default and deployment ceiling for implementation passes (default `8`). */
  maxCycles?: number
  /** Maximum findings in one review or QA artifact (default `64`). */
  maxFindings?: number
  /** Maximum serialized characters in one role artifact (default `32768`). */
  maxArtifactChars?: number
  /** Maximum serialized characters in the complete model-visible result (default `262144`). */
  maxResultChars?: number
  /** Per-role route and tool restrictions. */
  roles: Record<RoleName, RoleConfig>
}

/** Parameters passed when calling the `aop_delivery` / `delivery_workflow` tool. */
export interface DeliveryCallArgs {
  /** The complete implementation objective or ticket. */
  objective: string
  /** Optional absolute HTTP(S) URL for browser QA; when omitted QA discovers the target from the plan and workspace. */
  qaUrl?: string
  /** Optional concrete browser behavior and outcomes QA must verify; when omitted QA derives them from the plan's acceptance criteria. */
  qaInstructions?: string
  /** Optional implementation-pass cap bounded by deployment policy. */
  maxCycles?: number
}

/** Cycle counts executed during the delivery workflow. */
export interface DeliveryCycles {
  implementation: number
  review: number
  qa: number
}

/** Structured finding reported by Review or QA. */
export interface DeliveryFinding {
  id: string
  severity: 'critical' | 'high' | 'medium' | 'low'
  summary: string
  evidence: string
  location: string
  remediation: string
}

/** Terminal failure outcome. */
export interface DeliveryTerminalFailure {
  status: 'blocked' | 'cycle-limit' | 'stage-failed'
  stage: RoleName
  message: string
  cycles: DeliveryCycles
  pendingFindings: DeliveryFinding[]
}

/** Terminal success outcome. */
export interface DeliveryCompletedResult {
  status: 'completed'
  cycles: DeliveryCycles
  plan: unknown
  implementation: unknown
  review: unknown
  qa: unknown
}

/** The terminal result union. */
export type DeliveryTerminalResult = DeliveryTerminalFailure | DeliveryCompletedResult
