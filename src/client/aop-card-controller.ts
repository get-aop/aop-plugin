/**
 * Form controller for the AOP Software Delivery settings card.
 * Manages drafts, field overrides, validation, and save/discard operations.
 *
 * @module @get-aop/aop-plugin/client/controller
 */

import type {
  AopCardFace,
  AopCardState,
  CardFieldState,
  RoleModelSettings,
} from './types'

export const AOP_SETTINGS_NAMESPACE = 'aop-delivery'

export const DEFAULT_ROLE_MODELS: Required<RoleModelSettings> = {
  planModel: 'sol-xhigh',
  implementationModel: 'deepseek-v4-flash-max',
  reviewModel: 'fable-5-max',
  qaModel: 'sol-medium',
  maxCycles: 8,
}

export class AopCardController {
  private readonly listeners = new Set<() => void>()
  private cachedSnapshot: AopCardState | undefined
  private drafts: Partial<Record<keyof RoleModelSettings, string>> = {}
  private dirty = false
  private saving = false
  private failed = false
  private available = true
  private writable = true
  private baseValues: RoleModelSettings
  constructor(base?: RoleModelSettings) {
    this.baseValues = {
      ...DEFAULT_ROLE_MODELS,
      ...base,
    }
  }

  private notify(): void {
    this.cachedSnapshot = undefined
    for (const listener of this.listeners) {
      try {
        listener()
      } catch {
        // Observers must not break controller state
      }
    }
  }

  subscribe(listener: () => void): () => void {
    this.listeners.add(listener)
    return () => {
      this.listeners.delete(listener)
    }
  }

  getSnapshot(): AopCardState {
    if (this.cachedSnapshot !== undefined) return this.cachedSnapshot
    const planModelState = this.computeFieldState('planModel')
    const implementationModelState = this.computeFieldState('implementationModel')
    const reviewModelState = this.computeFieldState('reviewModel')
    const qaModelState = this.computeFieldState('qaModel')
    const maxCyclesState = this.computeNumericFieldState('maxCycles')

    const invalid = planModelState.invalid
      || implementationModelState.invalid
      || reviewModelState.invalid
      || qaModelState.invalid
      || maxCyclesState.invalid

    this.cachedSnapshot = {
      available: this.available,
      writable: this.writable,
      dirty: this.dirty,
      invalid,
      saving: this.saving,
      failed: this.failed,
      planModel: planModelState,
      implementationModel: implementationModelState,
      reviewModel: reviewModelState,
      qaModel: qaModelState,
      maxCycles: maxCyclesState,
    }
    return this.cachedSnapshot
  }

  private computeFieldState(field: 'planModel' | 'implementationModel' | 'reviewModel' | 'qaModel'): CardFieldState {
    const draft = this.drafts[field]
    const overridden = draft !== undefined
    const text = draft ?? this.baseValues[field] ?? DEFAULT_ROLE_MODELS[field]
    const trimmed = text.trim()
    const invalid = trimmed.length === 0
    return { text, overridden, invalid }
  }

  private computeNumericFieldState(field: 'maxCycles'): CardFieldState {
    const draft = this.drafts[field]
    const overridden = draft !== undefined
    const text = draft ?? String(this.baseValues[field] ?? DEFAULT_ROLE_MODELS[field])
    const trimmed = text.trim()
    const num = Number(trimmed)
    const invalid = !Number.isSafeInteger(num) || num < 1 || num > 100
    return { text, overridden, invalid }
  }

  edit(field: keyof RoleModelSettings, text: string): void {
    this.drafts[field] = text
    this.dirty = true
    this.failed = false
    this.notify()
  }

  resetField(field: keyof RoleModelSettings): void {
    delete this.drafts[field]
    this.dirty = Object.keys(this.drafts).length > 0
    this.failed = false
    this.notify()
  }

  discard(): void {
    this.drafts = {}
    this.dirty = false
    this.failed = false
    this.notify()
  }

  save(): void {
    const snapshot = this.getSnapshot()
    if (snapshot.invalid || !this.dirty || this.saving) return
    this.saving = true
    this.notify()

    try {
      // Apply drafts to base values
      for (const [key, value] of Object.entries(this.drafts)) {
        if (value !== undefined) {
          if (key === 'maxCycles') {
            this.baseValues.maxCycles = Number(value.trim())
          } else {
            this.baseValues[key as 'planModel' | 'implementationModel' | 'reviewModel' | 'qaModel'] = value.trim()
          }
        }
      }
      this.drafts = {}
      this.dirty = false
      this.failed = false
    } catch {
      this.failed = true
    } finally {
      this.saving = false
      this.notify()
    }
  }

  inject(): AopCardFace {
    return {
      edit: (field, text) => { this.edit(field, text) },
      resetField: (field) => { this.resetField(field) },
      save: () => { this.save() },
      discard: () => { this.discard() },
      hooks: {
        aopCard: {
          getSnapshot: () => this.getSnapshot(),
          subscribe: listener => this.subscribe(listener),
        },
      },
    }
  }
}
