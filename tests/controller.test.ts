/**
 * Unit and component tests for AOP Delivery Card Controller and Client Plugin.
 */

import { describe, expect, it } from 'bun:test'
import {
  AopCardController,
  DEFAULT_ROLE_MODELS,
  apply as applyClient,
} from '../src/client/index'

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
