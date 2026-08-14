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
  async function mountHostAop(executeStub: (args: any) => Promise<any>) {
    const registered: any[] = []
    const yields: unknown[] = []
    const ctx = {
      systemPrompt: { section: () => {} },
      tools: {
        register: () => {},
        execute: executeStub,
      },
      commands: {
        register: (def: any) => { registered.push(def); return () => {} },
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
        plan: { model: 'p', tools: [{ name: 'read', access: 'read' }] },
        implementation: { model: 'i', tools: [{ name: 'write', access: 'write' }] },
        review: { model: 'r', tools: [{ name: 'read', access: 'read' }] },
        qa: {
          model: 'q',
          tools: [
            { name: 'browser_navigate', access: 'read', browserNavigation: true },
            { name: 'browser_snapshot', access: 'read', browserEvidence: true },
          ],
        },
      },
    })
    return { registered, yields }
  }
  it('registers the command and rejects empty objectives', async () => {
    const { registered, yields } = await mountHostAop(async () => { throw new Error('must not run') })
    expect(registered).toHaveLength(1)
    expect(registered[0]).toMatchObject({ name: 'aop' })
    expect(yields).toHaveLength(2)
    expect(typeof yields[0]).toBe('function')
    expect(typeof yields[1]).toBe('function')
    const result = await registered[0].handler({ rawInput: '   ', commandId: 'cmd-1', agent: {}, signal: new AbortController().signal })
    expect(result).toEqual({ kind: 'error', text: 'Usage: /aop <objective>' })
  })

  it('executes aop_delivery with the command id and maps success', async () => {
    const seen: any[] = []
    const { registered } = await mountHostAop(async (input) => {
      seen.push(input)
      return {
        isError: false,
        content: [{ type: 'text', text: 'done' }],
        value: { runId: 'run-1', result: { cycles: { implementation: 2, review: 2, qa: 1 } } },
      }
    })
    const result = await registered[0].handler({ rawInput: '  build a todo app ', commandId: 'cmd-42', agent: { id: 'a1' }, signal: new AbortController().signal })
    expect(seen).toHaveLength(1)
    expect(seen[0]).toMatchObject({ name: 'aop_delivery', arguments: { objective: 'build a todo app' }, callId: 'cmd-42' })
    expect(result).toEqual({ kind: 'success', text: 'AOP delivery completed after 2 implementation pass(es) (2 review, 1 QA).' })
  })

  it('maps tool errors to non-empty command errors', async () => {
    const { registered } = await mountHostAop(async () => ({ isError: true, error: { message: '  ' } }))
    const result = await registered[0].handler({ rawInput: 'x', commandId: 'cmd-3', agent: {}, signal: new AbortController().signal })
    expect(result).toEqual({ kind: 'error', text: 'AOP delivery failed' })
  })
})
