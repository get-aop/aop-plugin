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
  const roleDefaults = () => ({
    plan: { model: 'deepseek-v4-pro', provider: 'opencode-go', tools: [{ name: 'read', access: 'read' }] },
    implementation: { model: 'deepseek-v4-flash', provider: 'opencode-go', tools: [{ name: 'write', access: 'write' }] },
    review: { model: 'k3', provider: 'kimi-coding', tools: [{ name: 'read', access: 'read' }] },
    qa: {
      model: 'deepseek-v4-flash',
      provider: 'opencode-go',
      tools: [
        { name: 'browser_navigate', access: 'read', browserNavigation: true },
        { name: 'browser_snapshot', access: 'read', browserEvidence: true },
      ],
    },
  })

  async function mountHostAop(options: {
    catalog?: Record<string, string[]>
    llm?: any
    roles?: any
    config?: Record<string, unknown>
    childSession?: any
    onEvent?: (name: string, callback: any) => any
    run?: (request: any) => any
  } = {}) {
    const catalog = options.catalog ?? {
      'opencode-go': ['deepseek-v4-pro', 'deepseek-v4-flash'],
      'kimi-coding': ['k3'],
    }
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
      llm: options.llm ?? {
        listModels: async (provider: string) => (catalog[provider] ?? []).map((id: string) => ({ id })),
        resolveModelInfo: async (provider: string, model: string) => {
          const list = catalog[provider]
          if (list === undefined) throw Object.assign(new Error('no adapter'), { code: 'NO_ADAPTER' })
          if (!list.includes(model)) throw Object.assign(new Error(`unknown model "${model}"`), { code: 'UNKNOWN_MODEL' })
          return { provider, id: model }
        },
      },
      on: options.onEvent ?? (() => () => {}),
      sessions: {
        get: (id: string) => (options.childSession !== undefined && id === options.childSession.id ? options.childSession : undefined),
      },
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
          if (options.run !== undefined) return options.run(request)
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
    applyHost(ctx, { ...options.config, roles: options.roles ?? roleDefaults() })
    return { registered, yields, startedRuns }
  }
  it('registers both commands, yields their disposers, and rejects empty objectives', async () => {
    const { registered, yields } = await mountHostAop()
    const commands = registered.filter((def: any) => def.name === 'aop' || def.name === 'aopy')
    expect(commands).toHaveLength(2)
    expect(commands[0]).toMatchObject({ name: 'aop', recordInput: false })
    expect(commands[1]).toMatchObject({ name: 'aopy', recordInput: false })
    expect(yields).toHaveLength(2)
    expect((yields[0] as any).name).toBe('regDisposer')
    const result = await commands[0].handler({ rawInput: '   ', commandId: 'cmd-1', agent: {}, signal: new AbortController().signal })
    expect(result).toEqual({ kind: 'error', text: 'Usage: /aop <objective>' })
    const yoloResult = await commands[1].handler({ rawInput: '   ', commandId: 'cmd-2', agent: {}, signal: new AbortController().signal })
    expect(yoloResult).toEqual({ kind: 'error', text: 'Usage: /aopy <objective>' })
  })

  it('routes the /aopy objective with yolo mode to the agent as a followup', async () => {
    const followups: any[] = []
    const { registered } = await mountHostAop()
    const command = registered.find((def: any) => def.name === 'aopy')
    const result = await command.handler({
      rawInput: '  ship the todo app ',
      commandId: 'cmd-43',
      agent: { followup: (message: any) => { followups.push(message) } },
      signal: new AbortController().signal,
    })
    expect(followups).toHaveLength(1)
    expect(followups[0].content[0].text).toContain('aop_delivery')
    expect(followups[0].content[0].text).toContain("pass 'yolo' as the mode argument")
    expect(followups[0].content[0].text).toContain('ship the todo app')
    expect(followups[0].source).toMatchObject({ kind: 'plugin', plugin: 'aop' })
    expect(result.kind).toBe('success')
    expect((result as any).text).toContain('AOP YOLO delivery requested')
  })

  it('fails preflight with a clear error when a role model is not configured', async () => {
    const { registered, startedRuns } = await mountHostAop({
      catalog: {
        'opencode-go': ['deepseek-v4-pro', 'deepseek-v4-flash'],
        'kimi-coding': [],
      },
    })
    const tool = registered.find((def: any) => def.name === 'aop_delivery')
    await expect(tool.execute(
      { objective: 'Deliver something.' },
      { agent: {}, signal: new AbortController().signal },
    )).rejects.toThrow('Role "review" route kimi-coding/k3 is not served by this deployment: UNKNOWN_MODEL')
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

  it('passes ship mode, ship arg, and an extra child ceiling in yolo mode', async () => {
    const { registered, startedRuns } = await mountHostAop({
      run: () => ({
        id: 'run-1',
        result: Promise.resolve({
          stopReason: 'completed',
          agentsStarted: 5,
          value: {
            status: 'completed',
            cycles: { implementation: 1, review: 1, qa: 1 },
            plan: {},
            implementation: {},
            review: { status: 'pass' },
            qa: { status: 'pass' },
            ship: { status: 'shipped', summary: 'Merged.', prUrl: 'https://github.com/o/r/pull/7', merged: true, ci: '8/8 green', blocker: '' },
          },
        }),
        cancel: () => {},
        dispose: () => Promise.resolve(),
      }),
    })
    const tool = registered.find((def: any) => def.name === 'aop_delivery')
    const result = await tool.execute(
      { objective: 'Deliver something.', mode: 'yolo' },
      { agent: {}, signal: new AbortController().signal },
    )
    expect(startedRuns).toHaveLength(1)
    expect(startedRuns[0].args.ship).toBe(true)
    expect(startedRuns[0].maxTotalAgents).toBe(1 + 3 * 8 + 1)
    expect((result.result as any).ship.status).toBe('shipped')
  })

  it('rejects a yolo completion without a shipped artifact', async () => {
    const { registered } = await mountHostAop()
    const tool = registered.find((def: any) => def.name === 'aop_delivery')
    await expect(tool.execute(
      { objective: 'Deliver something.', mode: 'yolo' },
      { agent: {}, signal: new AbortController().signal },
    )).rejects.toThrow('invalid completed result')
  })

  it('accepts a ship-stage failure terminal', async () => {
    const { registered } = await mountHostAop({
      run: () => ({
        id: 'run-1',
        result: Promise.resolve({
          stopReason: 'completed',
          agentsStarted: 5,
          value: {
            status: 'blocked',
            stage: 'ship',
            message: 'no git remote configured',
            cycles: { implementation: 1, review: 1, qa: 1 },
            pendingFindings: [],
          },
        }),
        cancel: () => {},
        dispose: () => Promise.resolve(),
      }),
    })
    const tool = registered.find((def: any) => def.name === 'aop_delivery')
    await expect(tool.execute(
      { objective: 'Deliver something.', mode: 'yolo' },
      { agent: {}, signal: new AbortController().signal },
    )).rejects.toThrow('blocked at ship: no git remote configured')
  })

  it('rejects an unknown mode', async () => {
    const { registered, startedRuns } = await mountHostAop()
    const tool = registered.find((def: any) => def.name === 'aop_delivery')
    await expect(tool.execute(
      { objective: 'Deliver something.', mode: 'bogus' },
      { agent: {}, signal: new AbortController().signal },
    )).rejects.toThrow('mode must be standard or yolo')
    expect(startedRuns).toHaveLength(0)
  })

  it('rejects a role model without provider at load time', async () => {
    const roles = roleDefaults()
    roles.implementation = { model: 'deepseek-v4-flash', tools: [{ name: 'write', access: 'write' }] }
    await expect(mountHostAop({ roles })).rejects.toThrow('implementation.model requires implementation.provider')
  })

  it('accepts pass-through models unlisted in the advisory catalog', async () => {
    const { registered, startedRuns } = await mountHostAop({
      llm: {
        listModels: async () => [],
        resolveModelInfo: async (provider: string, model: string) => ({ provider, id: model }),
      },
    })
    const tool = registered.find((def: any) => def.name === 'aop_delivery')
    const result = await tool.execute(
      { objective: 'Deliver something.' },
      { agent: {}, signal: new AbortController().signal },
    )
    expect(startedRuns).toHaveLength(1)
    expect(result.runId).toBe('run-1')
  })

  it('lists available models when a route fails exact-model resolution', async () => {
    const { registered, startedRuns } = await mountHostAop({
      catalog: {
        'opencode-go': ['deepseek-v4-pro', 'deepseek-v4-flash'],
        'kimi-coding': ['other-kimi-model'],
      },
    })
    const tool = registered.find((def: any) => def.name === 'aop_delivery')
    await expect(tool.execute(
      { objective: 'Deliver something.' },
      { agent: {}, signal: new AbortController().signal },
    )).rejects.toThrow('(available: other-kimi-model)')
    expect(startedRuns).toHaveLength(0)
  })

  // Real timers on purpose: the wall-clock timeout firing is the behavior
  // under test, and the test awaits the promise it rejects — no sleeps.
  it('cancels the run when it exceeds runTimeoutMs', async () => {
    const cancels: string[] = []
    const { registered } = await mountHostAop({
      config: { runTimeoutMs: 5, phaseTimeoutMs: 60_000 },
      run: () => {
        const { promise, resolve } = Promise.withResolvers<any>()
        return {
          id: 'run-1',
          result: promise,
          cancel: (reason: string) => {
            cancels.push(reason)
            resolve({ stopReason: 'cancelled', error: reason, agentsStarted: 0, value: undefined })
          },
          dispose: () => Promise.resolve(),
        }
      },
    })
    const tool = registered.find((def: any) => def.name === 'aop_delivery')
    await expect(tool.execute(
      { objective: 'Deliver something.' },
      { agent: {}, signal: new AbortController().signal },
    )).rejects.toThrow('workflow exceeded runTimeoutMs')
    expect(cancels).toEqual(['workflow exceeded runTimeoutMs'])
  })

  it('cancels the run when a phase exceeds phaseTimeoutMs and ignores other runs', async () => {
    const cancels: string[] = []
    let phaseListener: ((info: any, title: string) => void) | undefined
    const { registered } = await mountHostAop({
      config: { runTimeoutMs: 60_000, phaseTimeoutMs: 5 },
      onEvent: (_name: string, callback: any) => {
        phaseListener = callback
        return () => { phaseListener = undefined }
      },
      run: () => {
        const { promise, resolve } = Promise.withResolvers<any>()
        return {
          id: 'run-1',
          result: promise,
          cancel: (reason: string) => {
            cancels.push(reason)
            resolve({ stopReason: 'cancelled', error: reason, agentsStarted: 0, value: undefined })
          },
          dispose: () => Promise.resolve(),
        }
      },
    })
    const tool = registered.find((def: any) => def.name === 'aop_delivery')
    const pending = tool.execute(
      { objective: 'Deliver something.' },
      { agent: {}, signal: new AbortController().signal },
    )
    while (phaseListener === undefined) await Promise.resolve()
    phaseListener({ id: 'other-run', meta: {} }, 'Stray phase')
    phaseListener({ id: 'run-1', meta: {} }, 'Review')
    await expect(pending).rejects.toThrow('phase "Review" exceeded phaseTimeoutMs')
    expect(cancels).toEqual(['phase "Review" exceeded phaseTimeoutMs'])
  })

  // Real timers: the wall-clock timeout firing (or NOT firing during
  // implementation) is the behavior under test.
  it('does not arm the phase timer during the implementation phase', async () => {
    const cancels: string[] = []
    let phaseListener: ((info: any, title: string) => void) | undefined
    const { registered } = await mountHostAop({
      config: { runTimeoutMs: 60_000, phaseTimeoutMs: 10 },
      onEvent: (_name: string, callback: any) => {
        phaseListener = callback
        return () => { phaseListener = undefined }
      },
      run: () => {
        const { promise, resolve } = Promise.withResolvers<any>()
        return {
          id: 'run-1',
          result: promise,
          cancel: (reason: string) => {
            cancels.push(reason)
            resolve({ stopReason: 'cancelled', error: reason, agentsStarted: 0, value: undefined })
          },
          dispose: () => Promise.resolve(),
        }
      },
    })
    const tool = registered.find((def: any) => def.name === 'aop_delivery')
    const pending = tool.execute(
      { objective: 'Deliver something.' },
      { agent: {}, signal: new AbortController().signal },
    )
    while (phaseListener === undefined) await Promise.resolve()
    phaseListener({ id: 'run-1', meta: {} }, 'Plan')
    phaseListener({ id: 'run-1', meta: {} }, 'Implementation')
    await new Promise(resolve => setTimeout(resolve, 40))
    expect(cancels).toEqual([])
    phaseListener({ id: 'run-1', meta: {} }, 'Review')
    await expect(pending).rejects.toThrow('phase "Review" exceeded phaseTimeoutMs')
    expect(cancels).toEqual(['phase "Review" exceeded phaseTimeoutMs'])
  })

  it('throws the real child error from validateChildResult', async () => {
    const session = {
      id: 'child-1',
      firstLiveSeq: 7,
      header: { origin: 'subagent', parentSession: 'parent-1', seedLength: undefined },
      events: [{ type: 'turn/end', data: { reason: { kind: 'error', error: { message: 'review crashed hard' } } } }],
    }
    const { registered, startedRuns } = await mountHostAop({ childSession: session })
    const tool = registered.find((def: any) => def.name === 'aop_delivery')
    await tool.execute(
      { objective: 'Deliver something.' },
      { agent: { session: { header: { id: 'parent-1' } } }, signal: new AbortController().signal },
    )
    const validator = startedRuns[0].validateChildResult
    const info = {
      seq: 1,
      label: 'Review',
      phase: 'Review',
      childId: 'child-1',
      localAgent: { id: 'child-1', session },
      sessionStartSeq: 7,
    }
    expect(() => validator(info, { stopReason: 'error' })).toThrow('Phase "Review" child failed (error): review crashed hard')
  })

  it('checks provider-only routes for registration', async () => {
    const roles = roleDefaults()
    roles.review = { provider: 'ghost-route', tools: [{ name: 'read', access: 'read' }] }
    const { registered, startedRuns } = await mountHostAop({
      roles,
      llm: {
        listModels: async (provider: string) => {
          if (provider === 'ghost-route') throw Object.assign(new Error('no adapter'), { code: 'NO_ADAPTER' })
          return [{ id: 'any-model' }]
        },
        resolveModelInfo: async (provider: string, model: string) => ({ provider, id: model }),
      },
    })
    const tool = registered.find((def: any) => def.name === 'aop_delivery')
    await expect(tool.execute(
      { objective: 'Deliver something.' },
      { agent: {}, signal: new AbortController().signal },
    )).rejects.toThrow('Role "review" provider "ghost-route" failed its registration check: no adapter')
    expect(startedRuns).toHaveLength(0)
  })


  it('ignores stale child errors when the final turn ended differently', async () => {
    const session = {
      id: 'child-1',
      firstLiveSeq: 7,
      header: { origin: 'subagent', parentSession: 'parent-1', seedLength: undefined },
      events: [
        { type: 'turn/end', data: { reason: { kind: 'error', error: { message: 'old crash' } } } },
        { type: 'turn/end', data: { reason: { kind: 'aborted', reason: { kind: 'legacy' } } } },
      ],
    }
    const { registered, startedRuns } = await mountHostAop({ childSession: session })
    const tool = registered.find((def: any) => def.name === 'aop_delivery')
    await tool.execute(
      { objective: 'Deliver something.' },
      { agent: { session: { header: { id: 'parent-1' } } }, signal: new AbortController().signal },
    )
    const validator = startedRuns[0].validateChildResult
    const info = {
      seq: 1,
      label: 'Review',
      phase: 'Review',
      childId: 'child-1',
      localAgent: { id: 'child-1', session },
      sessionStartSeq: 7,
    }
    expect(() => validator(info, { stopReason: 'aborted' })).not.toThrow()
  })
})
