/**
 * AOP Software Delivery Workflow Plugin for DeepSeek Harness / Cordis.
 * Automated multi-agent workflow: Plan -> Implementation -> Review -> Browser QA loops.
 *
 * @module @get-aop/dsh-plugin
 */

import type { Context } from '@deepseek-ai/cordis'
import type { Agent } from '@deepseek-ai/dsh-agent'
import z from '@deepseek-ai/schemastery'
import type { ContentBlock } from '@deepseek-ai/dsh-llm'
import type { JsonValue, Session } from '@deepseek-ai/dsh-session'
import { defineTool } from '@deepseek-ai/dsh-tools'
import type { ToolCallView, ToolPresentationMode, ToolResultView } from '@deepseek-ai/dsh-tools'
import type { WorkflowChildValidationInfo, WorkflowResult, WorkflowRun } from '@deepseek-ai/dsh-workflow'
import type {} from '@deepseek-ai/dsh-subagent'
import type {} from '@deepseek-ai/dsh-system-prompt'
import { AOP_DELIVERY_WORKFLOW_SCRIPT } from './script'
import type {
  Config as ConfigInterface,
  DeliveryCallArgs,
  DeliveryCycles,
  DeliveryFinding,
  DeliveryTerminalFailure,
  DeliveryTerminalResult,
  RoleConfig,
  RoleName,
  ToolAccess,
  ToolGrant,
} from './types'

export interface Config extends ConfigInterface {}
export type {
  DeliveryCallArgs,
  DeliveryCycles,
  DeliveryFinding,
  DeliveryTerminalFailure,
  DeliveryTerminalResult,
  RoleConfig,
  RoleName,
  ToolAccess,
  ToolGrant,
}
export { AOP_DELIVERY_WORKFLOW_SCRIPT } from './script'
export const name = 'aop-delivery-workflow'
export const inject = ['tools', 'workflowEngine', 'subagents', 'systemPrompt', 'sessions', 'commands']

const toolGrantSchema = z.object({
  name: z.string().required(),
  access: z.union(['read', 'write'] as const).required(),
  browserEvidence: z.boolean(),
  browserNavigation: z.boolean(),
})

const roleConfigSchema = z.object({
  provider: z.string(),
  model: z.string(),
  toolPresentation: z.union(['native', 'code', 'both'] as const),
  tools: z.array(toolGrantSchema).required(),
})

/** Schemastery configuration for the AOP delivery workflow plugin. */
export const Config = z.object({
  subagentProvider: z.string().default('spawn'),
  maxCycles: z.number().step(1).min(1).max(Number.MAX_SAFE_INTEGER).default(8),
  maxFindings: z.number().step(1).min(1).max(Number.MAX_SAFE_INTEGER).default(64),
  maxArtifactChars: z.number().step(1).min(1).max(Number.MAX_SAFE_INTEGER).default(32_768),
  maxResultChars: z.number().step(1).min(1).max(Number.MAX_SAFE_INTEGER).default(262_144),
  roles: z.object({
    plan: roleConfigSchema.required(),
    implementation: roleConfigSchema.required(),
    review: roleConfigSchema.required(),
    qa: roleConfigSchema.required(),
  }).required(),
})

interface ResolvedRoleConfig {
  readonly provider?: string
  readonly model?: string
  readonly toolPresentation?: ToolPresentationMode
  readonly tools: readonly ToolGrant[]
  readonly toolAccess: Readonly<Record<string, ToolAccess>>
}

interface ResolvedConfig {
  readonly subagentProvider: string
  readonly maxCycles: number
  readonly maxFindings: number
  readonly maxArtifactChars: number
  readonly maxResultChars: number
  readonly roles: Readonly<Record<RoleName, ResolvedRoleConfig>>
}

const ROLE_NAMES: readonly RoleName[] = ['plan', 'implementation', 'review', 'qa']
const RESULT_OVERHEAD_CHARS = 1_024
const TOOL_ERROR_PREFIX = 'Error: '
const PERSONAS: Readonly<Record<RoleName, string>> = {
  plan: 'You are the delivery planner. Inspect the repository and produce a decision-complete plan. Never modify files.',
  implementation: 'You are the sole implementation role. Modify the shared workspace, address every supplied finding, and verify the changed behavior.',
  review: 'You are an adversarial code reviewer. Read the objective, accepted plan, implementation report, actual code, and call sites. Never modify files; pass only with zero findings.',
  qa: 'You are an independent browser QA engineer. Use the provided browser tools against the QA target URL (given or discovered from the workspace and plan), verify observable acceptance criteria, and never modify source files.',
}

const WORKFLOW_META = {
  name: 'aop-delivery-workflow',
  description: 'Plan, implement, review, and browser-test one delivery objective with evaluator feedback loops.',
  phases: [
    { title: 'Plan' },
    { title: 'Implementation' },
    { title: 'Review' },
    { title: 'QA' },
  ],
}

const DESCRIPTION = 'Run an AOP software delivery workflow for one implementation objective. A planner creates an accepted plan, the implementation role changes the shared workspace, an independent reviewer returns every finding to implementation until review passes, and browser QA returns product defects through implementation and review before completion.'

const OUTPUT_PROPERTIES = {
  runId: { type: 'string', required: true },
  agentsStarted: { type: 'integer', required: true },
  result: { type: 'json', required: true },
} as const

function normalizedText(value: string, propertyName: string): string {
  if (value.length === 0 || value !== value.trim()) throw new TypeError(`${propertyName} must be a non-empty normalized string`)
  return value
}

function positiveInteger(value: number, propertyName: string): number {
  if (!Number.isSafeInteger(value) || value < 1) throw new TypeError(`${propertyName} must be a positive safe integer`)
  return value
}

function resolveRole(role: RoleName, config: RoleConfig): ResolvedRoleConfig {
  const provider = config.provider === undefined ? undefined : normalizedText(config.provider, `${role}.provider`)
  const model = config.model === undefined ? undefined : normalizedText(config.model, `${role}.model`)
  const toolPresentation = config.toolPresentation
  if (toolPresentation !== undefined && !['native', 'code', 'both'].includes(toolPresentation)) {
    throw new TypeError(`${role}.toolPresentation must be native, code, or both`)
  }
  if (role !== 'implementation' && toolPresentation !== undefined && toolPresentation !== 'native') {
    throw new TypeError(`${role}.toolPresentation must be native for evaluator roles`)
  }
  const tools = config.tools.map((tool, index): ToolGrant => {
    const toolName = normalizedText(tool.name, `${role}.tools[${index}].name`)
    const access: unknown = tool.access
    const browserEvidence: unknown = tool.browserEvidence
    const browserNavigation: unknown = tool.browserNavigation
    if (access !== 'read' && access !== 'write') throw new TypeError(`${role}.tools[${index}].access must be read or write`)
    if (browserEvidence !== undefined && typeof browserEvidence !== 'boolean') {
      throw new TypeError(`${role}.tools[${index}].browserEvidence must be a boolean`)
    }
    if (browserNavigation !== undefined && typeof browserNavigation !== 'boolean') {
      throw new TypeError(`${role}.tools[${index}].browserNavigation must be a boolean`)
    }
    if (role !== 'implementation' && access === 'write') throw new TypeError(`${role}.tools cannot grant write access`)
    if (role !== 'qa' && (browserEvidence === true || browserNavigation === true)) {
      throw new TypeError(`${role}.tools cannot grant browser evidence`)
    }
    if (browserNavigation === true && browserEvidence === true) {
      throw new TypeError(`${role}.tools[${index}] cannot be both browserNavigation and browserEvidence`)
    }
    return {
      name: toolName,
      access,
      ...browserEvidence === true ? { browserEvidence: true } : {},
      ...browserNavigation === true ? { browserNavigation: true } : {},
    }
  })
  if (new Set(tools.map(tool => tool.name)).size !== tools.length) throw new TypeError(`${role}.tools must not contain duplicates`)
  if ((role === 'plan' || role === 'review') && tools.length === 0) {
    throw new TypeError(`${role}.tools must include at least one read grant`)
  }
  if (role === 'implementation' && !tools.some(tool => tool.access === 'write')) {
    throw new TypeError('implementation.tools must include at least one write grant')
  }
  if (role === 'qa' && !tools.some(tool => tool.browserEvidence === true)) {
    throw new TypeError('qa.tools must include at least one browserEvidence grant')
  }
  if (role === 'qa' && tools.filter(tool => tool.browserNavigation === true).length !== 1) {
    throw new TypeError('qa.tools must include exactly one browserNavigation grant')
  }
  const presentation = role === 'implementation' ? toolPresentation : 'native'
  return {
    ...(provider === undefined ? {} : { provider }),
    ...(model === undefined ? {} : { model }),
    ...(presentation === undefined ? {} : { toolPresentation: presentation }),
    tools,
    toolAccess: Object.fromEntries(tools.map(tool => [tool.name, tool.access])),
  }
}

function resolveConfig(config: Config): ResolvedConfig {
  const subagentProvider = normalizedText(config.subagentProvider ?? 'spawn', 'subagentProvider')
  const maxCycles = positiveInteger(config.maxCycles ?? 8, 'maxCycles')
  const maxFindings = positiveInteger(config.maxFindings ?? 64, 'maxFindings')
  const maxArtifactChars = positiveInteger(config.maxArtifactChars ?? 32_768, 'maxArtifactChars')
  const maxResultChars = positiveInteger(config.maxResultChars ?? 262_144, 'maxResultChars')
  const minimumResultChars = maxArtifactChars * ROLE_NAMES.length + RESULT_OVERHEAD_CHARS
  if (!Number.isSafeInteger(minimumResultChars) || maxResultChars < minimumResultChars) {
    throw new TypeError(`maxResultChars must be at least ${minimumResultChars} for maxArtifactChars ${maxArtifactChars}`)
  }
  const roles = Object.fromEntries(
    ROLE_NAMES.map(role => [role, resolveRole(role, config.roles[role])]),
  ) as Record<RoleName, ResolvedRoleConfig>
  return { subagentProvider, maxCycles, maxFindings, maxArtifactChars, maxResultChars, roles }
}

function validateProvider(ctx: Context, providerName: string, roles: ResolvedConfig['roles']): void {
  const provider = ctx.subagents.getProvider(providerName)
  if (provider === undefined) throw new Error(`Delivery subagent provider "${providerName}" is not registered`)
  if (!provider.sessionBacked) throw new Error(`Delivery subagent provider "${providerName}" is not session-backed; delivery roles require authoritative child sessions`)
  if (provider.inheritsParentContext) throw new Error(`Delivery subagent provider "${providerName}" inherits parent context; delivery roles require fresh children`)
  const capabilities = ['outputSchema', 'persona', 'toolFilter', 'toolAccess'] as const
  for (const capability of capabilities) {
    if (!provider.capabilities[capability]) throw new Error(`Delivery subagent provider "${providerName}" does not support ${capability}`)
  }
  if (ROLE_NAMES.some(role => roles[role].toolPresentation !== undefined)
    && !provider.capabilities.toolPresentation) {
    throw new Error(`Delivery subagent provider "${providerName}" does not support toolPresentation`)
  }
}

function validateRoleTools(ctx: Context, parent: NonNullable<Parameters<typeof ctx.tools.schemas>[0]>, roles: ResolvedConfig['roles']): void {
  for (const role of ROLE_NAMES) {
    for (const tool of roles[role].tools) {
      if (tool.name === 'aop_delivery' || tool.name === 'delivery_workflow') {
        throw new Error(`${role}.tools cannot include ${tool.name}`)
      }
      const definition = ctx.tools.get(tool.name, parent)
      if (definition === undefined) throw new Error(`${role}.tools names unavailable tool "${tool.name}"`)
      if (definition.workspaceAccess === undefined) {
        throw new Error(`${role}.tools names tool "${tool.name}" without a workspaceAccess classification`)
      }
      if (definition.workspaceAccess !== tool.access) {
        throw new Error(`${role}.tools classifies "${tool.name}" as ${tool.access}, but the tool declares ${definition.workspaceAccess}`)
      }
    }
  }
}

function resolveMaxCycles(requested: number | undefined, ceiling: number): number {
  const value = positiveInteger(requested ?? ceiling, 'delivery maxCycles')
  if (value > ceiling) throw new TypeError(`Delivery maxCycles ${value} exceeds the deployment ceiling ${ceiling}`)
  return value
}

function validateQaUrl(value: string): string {
  const normalized = normalizedText(value, 'qaUrl')
  let url: URL
  try {
    url = new URL(normalized)
  } catch (error: unknown) {
    throw new TypeError(`qaUrl must be an absolute HTTP(S) URL: ${error instanceof Error ? error.message : String(error)}`)
  }
  if (url.protocol !== 'http:' && url.protocol !== 'https:') throw new TypeError('qaUrl must use http: or https:')
  return url.href
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function readCycles(value: unknown, maxCycles: number): DeliveryCycles {
  if (!isRecord(value) || Object.keys(value).sort().join(',') !== 'implementation,qa,review') throw new Error('Delivery workflow returned malformed cycle counts')
  const implementation = value['implementation']
  const review = value['review']
  const qa = value['qa']
  if (typeof implementation !== 'number' || !Number.isSafeInteger(implementation) || implementation < 0
    || typeof review !== 'number' || !Number.isSafeInteger(review) || review < 0
    || typeof qa !== 'number' || !Number.isSafeInteger(qa) || qa < 0
    || implementation > maxCycles || review > implementation || qa > review) throw new Error('Delivery workflow returned invalid cycle counts')
  return { implementation, review, qa }
}

function readTerminalResult(value: unknown, maxCycles: number): DeliveryTerminalResult {
  if (!isRecord(value) || typeof value['status'] !== 'string') throw new Error('Delivery workflow returned a malformed terminal result')
  const cycles = readCycles(value['cycles'], maxCycles)
  if (value['status'] === 'completed') {
    if (Object.keys(value).sort().join(',') !== 'cycles,implementation,plan,qa,review,status'
      || cycles.implementation < 1 || cycles.review !== cycles.implementation || cycles.qa < 1
      || !isRecord(value['review']) || value['review']['status'] !== 'pass'
      || !isRecord(value['qa']) || value['qa']['status'] !== 'pass') throw new Error('Delivery workflow returned an invalid completed result')
    return { status: 'completed', cycles, plan: value['plan'], implementation: value['implementation'], review: value['review'], qa: value['qa'] }
  }
  if (!['blocked', 'cycle-limit', 'stage-failed'].includes(value['status'])
    || Object.keys(value).sort().join(',') !== 'cycles,message,pendingFindings,stage,status'
    || !ROLE_NAMES.includes(value['stage'] as RoleName)
    || typeof value['message'] !== 'string' || value['message'].length === 0
    || !Array.isArray(value['pendingFindings'])) throw new Error('Delivery workflow returned an invalid failure result')
  return {
    status: value['status'] as DeliveryTerminalFailure['status'],
    stage: value['stage'] as RoleName,
    message: value['message'],
    cycles,
    pendingFindings: value['pendingFindings'] as DeliveryFinding[],
  }
}

function workflowError(result: WorkflowResult): string | undefined {
  switch (result.stopReason) {
    case 'completed': return undefined
    case 'cancelled': return `Delivery workflow was cancelled${result.error === undefined ? '' : ` (${result.error})`}`
    case 'error': return `Delivery workflow failed: ${result.error ?? 'unknown error'}`
    default: return `Delivery workflow ended abnormally (${String(result.stopReason)})`
  }
}

function renderSuccess(result: unknown): string {
  return `AOP delivery workflow completed.\nFinal evidence:\n${JSON.stringify(result)}`
}

function renderFailure(result: DeliveryTerminalFailure): string {
  return `AOP delivery workflow ${result.status} at ${result.stage}: ${result.message}\nPending findings:\n${JSON.stringify(result.pendingFindings)}`
}

function requireBoundedResult(text: string, maxChars: number): string {
  if (text.length > maxChars) throw new Error(`Delivery workflow result exceeds maxResultChars (${text.length} > ${maxChars})`)
  return text
}

function boundedError(error: unknown, maxChars: number): Error {
  let message: string
  try {
    message = error instanceof Error ? error.message : String(error)
  } catch {
    message = '<unprintable workflow error>'
  }
  const available = Math.max(0, maxChars - TOOL_ERROR_PREFIX.length)
  return new Error(message.length > available ? message.slice(0, available) : message)
}

function matchesTargetUrl(argumentsValue: unknown, targetUrl: string): boolean {
  let parsed: unknown = argumentsValue
  if (typeof argumentsValue === 'string') {
    try {
      parsed = JSON.parse(argumentsValue)
    } catch {
      return false
    }
  }
  if (!isRecord(parsed) || typeof parsed['url'] !== 'string') return false
  try {
    return new URL(parsed['url']).href === targetUrl
  } catch {
    return false
  }
}

interface QaEvidenceObservation {
  readonly attemptedTargetNavigation: boolean
  readonly failedTargetNavigation: boolean
  readonly successfulTargetNavigation: boolean
  readonly successfulEvidenceAfterNavigation: boolean
}

interface NavigationCall {
  readonly target: boolean
}

interface EvidenceCall {
  readonly targetNavigationAt: number | undefined
  invalidated: boolean
}

interface QaVerdict {
  readonly status: 'pass' | 'changes-required' | 'blocked'
  readonly discoveredUrl: string
}

function qaVerdictFromChildResult(result: unknown): QaVerdict | undefined {
  if (!isRecord(result) || result['stopReason'] !== 'completed') return undefined
  const structured = result['structured']
  if (!isRecord(structured)) return undefined
  const status = structured['status']
  if (status !== 'pass' && status !== 'changes-required' && status !== 'blocked') return undefined
  const discoveredUrl = typeof structured['discoveredUrl'] === 'string' ? structured['discoveredUrl'] : ''
  return { status, discoveredUrl }
}

function inspectQaEvidence(
  session: Session,
  navigationTool: string,
  evidenceTools: ReadonlySet<string>,
  targetUrl: string,
): QaEvidenceObservation {
  const navigationCalls = new Map<string, NavigationCall>()
  const evidenceCalls = new Map<string, EvidenceCall>()
  const state = {
    attemptedTargetNavigation: false,
    failedTargetNavigation: false,
    successfulTargetNavigation: false,
    successfulEvidenceAfterNavigation: false,
    successfulNavigationAt: undefined as number | undefined,
  }
  const recordNavigationStart = (callId: string, argumentsValue: unknown): void => {
    // Evidence is always pinned to one concrete target: the explicit qaUrl, or
    // the discoveredUrl the QA child declared. A navigation to anything else
    // cannot certify evidence about the deliverable.
    const target = matchesTargetUrl(argumentsValue, targetUrl)
    navigationCalls.set(callId, { target })
    if (target) state.attemptedTargetNavigation = true
    state.successfulTargetNavigation = false
    state.successfulNavigationAt = undefined
    state.successfulEvidenceAfterNavigation = false
    for (const evidence of evidenceCalls.values()) evidence.invalidated = true
  }
  const settleNavigation = (callId: string, isError: boolean, index: number): void => {
    const navigation = navigationCalls.get(callId)
    if (navigation === undefined) return
    navigationCalls.delete(callId)
    if (isError) {
      if (navigation.target) state.failedTargetNavigation = true
      return
    }
    if (navigation.target) {
      state.failedTargetNavigation = false
      state.successfulTargetNavigation = true
      state.successfulNavigationAt = index
    } else {
      state.successfulTargetNavigation = false
      state.successfulNavigationAt = undefined
    }
    state.successfulEvidenceAfterNavigation = false
  }
  const settleEvidence = (callId: string, isError: boolean, index: number): void => {
    const evidence = evidenceCalls.get(callId)
    if (evidence === undefined) return
    evidenceCalls.delete(callId)
    if (isError
      || evidence.invalidated
      || evidence.targetNavigationAt === undefined
      || !state.successfulTargetNavigation
      || state.successfulNavigationAt !== evidence.targetNavigationAt
      || navigationCalls.size !== 0
      || index <= evidence.targetNavigationAt) return
    state.successfulEvidenceAfterNavigation = true
  }
  const liveEvents = session.events.slice(session.firstLiveSeq)
  for (const [index, event] of liveEvents.entries()) {
    if (event.type === 'tool/call') {
      if (event.data.name === navigationTool) recordNavigationStart(event.data.callId, event.data.arguments)
      if (evidenceTools.has(event.data.name)) {
        evidenceCalls.set(event.data.callId, {
          targetNavigationAt: state.successfulTargetNavigation ? state.successfulNavigationAt : undefined,
          invalidated: navigationCalls.size !== 0,
        })
      }
    } else if (event.type === 'tool/result') {
      const callId = event.data.message.source.callId
      const isError = event.data.message.content[0].isError === true
      settleNavigation(callId, isError, index)
      settleEvidence(callId, isError, index)
    }
  }
  return state
}

function validateQaEvidence(
  session: Session,
  navigationTool: string,
  evidenceTools: ReadonlySet<string>,
  qaUrl: string | undefined,
  status: 'pass' | 'changes-required' | 'blocked',
  discoveredUrl: string,
): void {
  // Discovery mode: an honest "no deliverable target is discoverable" blocker
  // needs no navigation evidence — there is nothing to navigate to.
  if (qaUrl === undefined && status === 'blocked' && discoveredUrl === '') return
  let targetUrl: string
  if (qaUrl !== undefined) {
    targetUrl = qaUrl
    // With an explicit target the artifact must name the URL that was tested.
    if (discoveredUrl !== '') {
      let matches = false
      try {
        matches = new URL(discoveredUrl).href === qaUrl
      } catch {
        // fall through to the mismatch error
      }
      if (!matches) {
        throw new Error(`QA child "${session.id}" reported a discoveredUrl that does not match qaUrl`)
      }
    }
  } else {
    let parsed: URL
    try {
      parsed = new URL(discoveredUrl)
    } catch {
      throw new Error(`QA child "${session.id}" reported an invalid discoveredUrl`)
    }
    if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
      throw new Error(`QA child "${session.id}" reported an invalid discoveredUrl`)
    }
    targetUrl = parsed.href
  }
  const observation = inspectQaEvidence(session, navigationTool, evidenceTools, targetUrl)
  const targetLabel = targetUrl
  if (status === 'blocked') {
    if (observation.failedTargetNavigation) return
    if (observation.successfulTargetNavigation && observation.successfulEvidenceAfterNavigation) return
    if (!observation.attemptedTargetNavigation) {
      throw new Error(`QA child "${session.id}" did not attempt navigation to ${targetLabel} before reporting blocked`)
    }
    if (!observation.successfulTargetNavigation) {
      throw new Error(`QA child "${session.id}" reported blocked without a failed or successful navigation to ${targetLabel}`)
    }
    throw new Error(`QA child "${session.id}" reported blocked without browser evidence of the external prerequisite`)
  }
  if (!observation.successfulTargetNavigation) throw new Error(`QA child "${session.id}" did not navigate successfully to ${targetLabel}`)
  if (!observation.successfulEvidenceAfterNavigation) throw new Error(`QA child "${session.id}" did not complete browser evidence after navigating to ${targetLabel}`)
}

function sessionForChild(
  ctx: Context,
  parent: Agent,
  info: WorkflowChildValidationInfo,
): Session {
  const localAgent = info.localAgent
  if (localAgent === undefined || localAgent.id !== info.childId || localAgent.session.id !== info.childId) {
    throw new Error(`delivery child "${info.childId}" did not expose its exact session-backed agent`)
  }
  const session = ctx.sessions.get(info.childId)
  if (session === undefined || session !== localAgent.session) {
    throw new Error(`delivery child "${info.childId}" session is not the live session returned by the host`)
  }
  if (info.sessionStartSeq !== session.firstLiveSeq) {
    throw new Error(`delivery child "${info.childId}" reported an inconsistent live-session boundary`)
  }
  if (session.header.origin !== 'subagent'
    || session.header.parentSession !== parent.session.header.id
    || session.header.seedLength !== undefined) {
    throw new Error(`delivery child "${info.childId}" is not a fresh child of the delivery caller`)
  }
  return session
}

function presentCall(args: DeliveryCallArgs): ToolCallView {
  return { card: 'generic', title: 'aop delivery workflow', rawInput: args.objective }
}

function presentResult(_args: DeliveryCallArgs, _result: { content: ContentBlock[]; isError: boolean }): ToolResultView {
  return { card: 'generic' }
}

/** Register the AOP delivery workflow plugin. */
export function apply(ctx: Context, config: Config): void {
  const resolved = resolveConfig(config)
  ctx.systemPrompt.section({
    name: 'tool:aop-delivery',
    order: 117,
    text: 'Use aop_delivery only when the direct human asks for the complete plan, implementation, independent review, and browser-QA delivery process. The workflow owns evaluator feedback loops and returns only after the latest implementation passes review and browser QA, or returns an error with the blocker or unresolved findings.',
  })

  const toolDefinition = defineTool({
    name: 'aop_delivery',
    description: DESCRIPTION,
    parameters: {
      objective: { type: 'string', required: true, description: 'The complete implementation objective or ticket.' },
      qaUrl: { type: 'string', description: 'Optional absolute HTTP(S) URL that browser QA must exercise; when omitted QA discovers the deliverable target from the plan and workspace.' },
      qaInstructions: { type: 'string', description: 'Optional concrete browser behavior and outcomes QA must verify; when omitted QA derives them from the plan acceptance criteria.' },
      maxCycles: { type: 'number', description: 'Optional implementation-pass cap bounded by deployment policy.' },
    },
    output: {
      schema: { type: 'object', additionalProperties: false, properties: OUTPUT_PROPERTIES },
      render: (_args: unknown, value: any) => [{ type: 'text', text: renderSuccess(value.result) }],
    },
    async execute(args: any, exec: any) {
      const parent = exec.agent
      if (parent === undefined) throw new Error('AOP delivery workflow requires a calling agent (exec.agent was undefined)')
      const objective = normalizedText(args.objective, 'objective')
      const qaUrl = args.qaUrl === undefined ? undefined : validateQaUrl(args.qaUrl)
      const qaInstructions = args.qaInstructions === undefined ? undefined : normalizedText(args.qaInstructions, 'qaInstructions')
      const maxCycles = resolveMaxCycles(args.maxCycles, resolved.maxCycles)
      validateProvider(ctx, resolved.subagentProvider, resolved.roles)
      validateRoleTools(ctx, parent, resolved.roles)
      const qaNavigationTool = resolved.roles.qa.tools
        .find(tool => tool.browserNavigation === true)?.name
      if (qaNavigationTool === undefined) throw new Error('AOP delivery workflow has no QA navigation tool')
      const qaEvidenceTools = new Set(resolved.roles.qa.tools
        .filter(tool => tool.browserEvidence === true)
        .map(tool => tool.name))
      const maxTotalAgents = 1 + 3 * maxCycles
      if (!Number.isSafeInteger(maxTotalAgents)) throw new TypeError('AOP delivery workflow child ceiling exceeds the safe integer range')
      const validateChildResult = (info: WorkflowChildValidationInfo, result: unknown): void => {
        const session = sessionForChild(ctx, parent, info)
        if (info.phase !== 'QA') return
        const verdict = qaVerdictFromChildResult(result)
        if (verdict === undefined) return
        validateQaEvidence(session, qaNavigationTool, qaEvidenceTools, qaUrl, verdict.status, verdict.discoveredUrl)
      }
      const run: WorkflowRun = ctx.workflowEngine.start({
        script: AOP_DELIVERY_WORKFLOW_SCRIPT,
        meta: WORKFLOW_META,
        args: {
          objective,
          qaUrl,
          qaInstructions,
          maxCycles,
          maxFindings: resolved.maxFindings,
          maxArtifactChars: resolved.maxArtifactChars,
          roles: Object.fromEntries(ROLE_NAMES.map(role => [
            role,
            {
              ...resolved.roles[role],
              tools: resolved.roles[role].tools.map(tool => tool.name),
            },
          ])),
          personas: PERSONAS,
        },
        subagentProvider: resolved.subagentProvider,
        maxTotalAgents,
        parent,
        validateChildResult,
        signal: exec.signal,
      })
      const onAbort = (): void => { run.cancel('parent step aborted') }
      exec.signal.addEventListener('abort', onAbort, { once: true })
      if (exec.signal.aborted) run.cancel('parent step aborted')
      let runError: unknown
      try {
        const settled = await run.result
        const error = workflowError(settled)
        if (error !== undefined) throw new Error(error)
        const terminal = readTerminalResult(settled.value, maxCycles)
        if (terminal.status !== 'completed') {
          throw new Error(requireBoundedResult(renderFailure(terminal), resolved.maxResultChars))
        }
        requireBoundedResult(renderSuccess(terminal), resolved.maxResultChars)
        return { runId: run.id, agentsStarted: settled.agentsStarted, result: terminal as unknown as JsonValue }
      } catch (error: unknown) {
        runError = error
        throw boundedError(error, resolved.maxResultChars)
      } finally {
        exec.signal.removeEventListener('abort', onAbort)
        try {
          await run.dispose()
        } catch (disposeErr: unknown) {
          if (runError === undefined) {
            throw boundedError(disposeErr, resolved.maxResultChars)
          }
        }
      }
    },
    presentCall,
    presentResult,
  })

  ctx.tools.register(toolDefinition)

  const activeRuns = new Set<Promise<void>>()
  const registerAopCommand = () => ctx.commands.register({
    name: 'aop',
    description: 'Run AOP software delivery workflow (Plan -> Implementation -> Review -> Browser QA)',
    input: { hint: '<objective>' },
    handler: (invocation: any) => {
      const objective = invocation.rawInput.trim()
      if (objective.length === 0) {
        return Promise.resolve({ kind: 'error', text: 'Usage: /aop <objective>' })
      }
      const run = (async () => {
        const result = await ctx.tools.execute({
          signal: invocation.signal,
          callId: invocation.commandId,
          name: 'aop_delivery',
          arguments: { objective },
          agent: invocation.agent,
        })
        if (result.isError) {
          const message = String(result.error?.message ?? '').trim()
          return { kind: 'error', text: message.length > 0 ? message : 'AOP delivery failed' }
        }
        const cycles = result.value?.result?.cycles
        const summary = cycles !== undefined && typeof cycles.implementation === 'number'
          ? `AOP delivery completed after ${cycles.implementation} implementation pass(es) (${cycles.review} review, ${cycles.qa} QA).`
          : 'AOP delivery completed.'
        return { kind: 'success', text: summary }
      })()
      const retire = () => { activeRuns.delete(tracked) }
      const tracked = run.then(retire, retire)
      activeRuns.add(tracked)
      return run
    },
  })

  // Yield the drain disposer first, then the registration disposer, so the
  // effect's intra-effect teardown unregisters the command before draining
  // in-flight handlers (mirroring command-compact).
  ctx.effect(function* () {
    yield async () => { await Promise.allSettled([...activeRuns]) }
    yield registerAopCommand()
  }, 'aop command lifecycle')
}
