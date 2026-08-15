/**
 * Unit and component tests for AOP Delivery Card Controller and Client Plugin.
 */

import { describe, expect, it, mock } from 'bun:test'
import {
  AopCardController,
  DEFAULT_ROLE_MODELS,
  apply as applyClient,
} from '../src/client/index'

// The host entry imports harness packages that are not installable in this
// standalone repo; stub their runtime surface before the dynamic import below.
// Dynamic import is required: bun applies mock.module only to imports that
// happen after registration, so the host entry cannot be statically imported.
const zStub = new Proxy(function () {}, {
  get: (_target, prop) => (prop === 'then' ? undefined : () => zStub),
  apply: () => zStub,
})
mock.module('@deepseek-ai/schemastery', () => ({ default: zStub }))
mock.module('@deepseek-ai/dsh-tools', () => ({ defineTool: (options: any) => options }))
mock.module('@deepseek-ai/dsh-llm', () => ({ createUserMessage: (input: any) => input, boundContextSummary: (input: string) => input }))

describe('AopCardController', () => {
  it('initializes with default role models and valid snapshot', () => {
    const controller = new AopCardController()
    const state = controller.getSnapshot()

    expect(state.available).toBe(true)
    expect(state.writable).toBe(true)
    expect(state.dirty).toBe(false)
    expect(state.invalid).toBe(false)
    expect(state.saving).toBe(false)

    expect(state.planModel.text).toBe('sol-xhigh')
    expect(state.planModel.overridden).toBe(false)
    expect(state.planModel.invalid).toBe(false)

    expect(state.implementationModel.text).toBe('deepseek-v4-flash-max')
    expect(state.reviewModel.text).toBe('fable-5-max')
    expect(state.qaModel.text).toBe('sol-medium')
    expect(state.maxCycles.text).toBe('8')
  })

  it('guarantees referential stability of snapshot when unmutated', () => {
    const controller = new AopCardController()
    const s1 = controller.getSnapshot()
    const s2 = controller.getSnapshot()
    expect(s1).toBe(s2)

    controller.edit('planModel', 'new-plan')
    const s3 = controller.getSnapshot()
    expect(s3).not.toBe(s1)
    expect(controller.getSnapshot()).toBe(s3)
  })

  it('stages edits and tracks dirty state', () => {
    const controller = new AopCardController()
    let notifications = 0
    controller.subscribe(() => { notifications += 1 })

    controller.edit('planModel', 'custom-planner')
    expect(notifications).toBe(1)

    const state = controller.getSnapshot()
    expect(state.dirty).toBe(true)
    expect(state.planModel.text).toBe('custom-planner')
    expect(state.planModel.overridden).toBe(true)
    expect(state.planModel.invalid).toBe(false)
  })

  it('validates empty model identifiers as invalid', () => {
    const controller = new AopCardController()
    controller.edit('reviewModel', '   ')

    const state = controller.getSnapshot()
    expect(state.dirty).toBe(true)
    expect(state.reviewModel.invalid).toBe(true)
    expect(state.invalid).toBe(true)
  })

  it('validates numeric bounds for maxCycles', () => {
    const controller = new AopCardController()

    controller.edit('maxCycles', '0')
    expect(controller.getSnapshot().maxCycles.invalid).toBe(true)
    expect(controller.getSnapshot().invalid).toBe(true)

    controller.edit('maxCycles', '101')
    expect(controller.getSnapshot().maxCycles.invalid).toBe(true)

    controller.edit('maxCycles', 'abc')
    expect(controller.getSnapshot().maxCycles.invalid).toBe(true)

    controller.edit('maxCycles', '12')
    expect(controller.getSnapshot().maxCycles.invalid).toBe(false)
    expect(controller.getSnapshot().invalid).toBe(false)
  })

  it('resets a single field override', () => {
    const controller = new AopCardController()
    controller.edit('qaModel', 'custom-qa')
    controller.edit('maxCycles', '10')

    expect(controller.getSnapshot().qaModel.overridden).toBe(true)
    expect(controller.getSnapshot().maxCycles.overridden).toBe(true)

    controller.resetField('qaModel')
    const state = controller.getSnapshot()
    expect(state.qaModel.overridden).toBe(false)
    expect(state.qaModel.text).toBe(DEFAULT_ROLE_MODELS.qaModel)
    expect(state.maxCycles.overridden).toBe(true)
    expect(state.dirty).toBe(true)
  })

  it('discards all staged edits', () => {
    const controller = new AopCardController()
    controller.edit('planModel', 'p1')
    controller.edit('reviewModel', 'r1')

    expect(controller.getSnapshot().dirty).toBe(true)
    controller.discard()

    const state = controller.getSnapshot()
    expect(state.dirty).toBe(false)
    expect(state.planModel.text).toBe(DEFAULT_ROLE_MODELS.planModel)
    expect(state.planModel.overridden).toBe(false)
  })

  it('saves valid staged edits into base values', () => {
    const controller = new AopCardController()
    controller.edit('planModel', 'claude-3-7-sonnet')
    controller.edit('maxCycles', '5')

    controller.save()

    const state = controller.getSnapshot()
    expect(state.dirty).toBe(false)
    expect(state.planModel.text).toBe('claude-3-7-sonnet')
    expect(state.planModel.overridden).toBe(false)
    expect(state.maxCycles.text).toBe('5')
  })

  it('injects valid hooks and action interface', () => {
    const controller = new AopCardController()
    const face = controller.inject()

    expect(typeof face.edit).toBe('function')
    expect(typeof face.resetField).toBe('function')
    expect(typeof face.save).toBe('function')
    expect(typeof face.discard).toBe('function')
    expect(typeof face.hooks.aopCard.getSnapshot).toBe('function')
    expect(typeof face.hooks.aopCard.subscribe).toBe('function')
  })

  it('registers into cordis slots with inject lifecycle', () => {
    const registered: unknown[] = []
    const injected: unknown[] = []
    const fakeCtx = {
      slots: {
        inject: (slotName: string, callback: () => void) => {
          injected.push(slotName)
          callback()
        },
        register: (options: unknown, component: unknown) => {
          registered.push({ options, component })
        },
      },
    }

    applyClient(fakeCtx as any)
    expect(injected).toEqual(['settings.plugin.item'])
    expect(registered).toHaveLength(1)
    expect((registered[0] as any).options).toMatchObject({
      name: 'settings.plugin.item',
      id: 'aop-delivery',
      order: 50,
    })
  })
})

describe('/aop slash command', () => {
  async function mountHostAop(modelCatalog: Record<string, string[]> = {
    'opencode-go': ['deepseek-v4-pro', 'deepseek-v4-flash'],
    'kimi-coding': ['kimi-k3'],
  }) {
    const registered: any[] = []
    const yields: unknown[] = []
    const regDisposer = () => {}
    const startedRuns: any[] = []
    const ctx = {
      systemPrompt: { section: () => {} },
      tools: {
        register: (def: any) => { registered.push(def) },
        get: (name: string) => ({ workspaceAccess: name === 'write' || name === 'edit' ? 'write' : 'read' }),
      },
      commands: {
        register: (def: any) => { registered.push(def); return regDisposer },
      },
      llm: {
        listModels: async (provider: string) => (modelCatalog[provider] ?? []).map((id: string) => ({ id })),
      },
      on: () => () => {},
      subagents: {
        getProvider: () => ({
          sessionBacked: true,
          inheritsParentContext: false,
          capabilities: { outputSchema: true, persona: true, toolFilter: true, toolAccess: true, toolPresentation: true },
        }),
      },
      workflowEngine: {
        start: (request: any) => {
          startedRuns.push(request)
          return {
            id: 'run-1',
            result: Promise.resolve({
              stopReason: 'completed',
              agentsStarted: 4,
              value: {
                status: 'completed',
                cycles: { implementation: 1, review: 1, qa: 1 },
                plan: {},
                implementation: {},
                review: { status: 'pass' },
                qa: { status: 'pass' },
              },
            }),
            cancel: () => {},
            dispose: () => Promise.resolve(),
          }
        },
      },
      effect: (fn: any) => {
        const iterator = fn()
        let step = iterator.next()
        while (!step.done) {
          yields.push(step.value)
          step = iterator.next()
        }
      },
    }
    const { apply: applyHost } = await import('../src/index')
    applyHost(ctx, {
      roles: {
        plan: { model: 'deepseek-v4-pro', provider: 'opencode-go', tools: [{ name: 'read', access: 'read' }] },
        implementation: { model: 'deepseek-v4-flash', provider: 'opencode-go', tools: [{ name: 'write', access: 'write' }] },
        review: { model: 'kimi-k3', provider: 'kimi-coding', tools: [{ name: 'read', access: 'read' }] },
        qa: {
          model: 'deepseek-v4-flash',
          provider: 'opencode-go',
          tools: [
            { name: 'browser_navigate', access: 'read', browserNavigation: true },
            { name: 'browser_snapshot', access: 'read', browserEvidence: true },
          ],
        },
      },
    })
    return { registered, yields, startedRuns }
  }
  it('registers the command, yields its disposer, and rejects empty objectives', async () => {
    const { registered, yields } = await mountHostAop()
    const command = registered.find((def: any) => def.name === 'aop')
    expect(command).toBeDefined()
    expect(command).toMatchObject({ recordInput: false })
    expect(yields).toHaveLength(1)
    expect((yields[0] as any).name).toBe('regDisposer')
    const result = await command.handler({ rawInput: '   ', commandId: 'cmd-1', agent: {}, signal: new AbortController().signal })
    expect(result).toEqual({ kind: 'error', text: 'Usage: /aop <objective>' })
  })

  it('routes the objective to the agent as a followup and acks immediately', async () => {
    const followups: any[] = []
    const { registered } = await mountHostAop()
    const command = registered.find((def: any) => def.name === 'aop')
    const result = await command.handler({
      rawInput: '  build a todo app ',
      commandId: 'cmd-42',
      agent: { followup: (message: any) => { followups.push(message) } },
      signal: new AbortController().signal,
    })
    expect(followups).toHaveLength(1)
    expect(followups[0].content[0].text).toContain('aop_delivery')
    expect(followups[0].content[0].text).toContain('verbatim')
    expect(followups[0].content[0].text).toContain('build a todo app')
    expect(followups[0].source).toMatchObject({ kind: 'plugin', plugin: 'aop' })
    expect(result.kind).toBe('success')
    expect((result as any).text).toContain('AOP delivery requested')
  })

  it('fails preflight with a clear error when a role model is not configured', async () => {
    const { registered, startedRuns } = await mountHostAop({
      'opencode-go': ['deepseek-v4-pro', 'deepseek-v4-flash'],
      'kimi-coding': [],
    })
    const tool = registered.find((def: any) => def.name === 'aop_delivery')
    await expect(tool.execute(
      { objective: 'Deliver something.' },
      { agent: {}, signal: new AbortController().signal },
    )).rejects.toThrow('Role "review" route is misconfigured: provider "kimi-coding" has no model "kimi-k3"')
    expect(startedRuns).toHaveLength(0)
  })

  it('starts the workflow when every role model resolves', async () => {
    const { registered, startedRuns } = await mountHostAop()
    const tool = registered.find((def: any) => def.name === 'aop_delivery')
    const result = await tool.execute(
      { objective: 'Deliver something.' },
      { agent: {}, signal: new AbortController().signal },
    )
    expect(startedRuns).toHaveLength(1)
    expect(startedRuns[0].meta.name).toBe('aop-delivery-workflow')
    expect(result.runId).toBe('run-1')
  })
})
