/**
 * Client-side settings and UI types for AOP Software Delivery Plugin.
 * @module @get-aop/dsh-plugin/client/types
 */

export interface RoleModelSettings {
  planModel?: string
  implementationModel?: string
  reviewModel?: string
  qaModel?: string
  maxCycles?: number
}

export interface CardFieldState {
  text: string
  overridden: boolean
  invalid: boolean
}

export interface CardShell {
  available: boolean
  writable: boolean
  dirty: boolean
  invalid: boolean
  saving: boolean
  failed: boolean
}

export interface AopCardState extends CardShell {
  planModel: CardFieldState
  implementationModel: CardFieldState
  reviewModel: CardFieldState
  qaModel: CardFieldState
  maxCycles: CardFieldState
}

export interface CardActions {
  edit: (field: keyof RoleModelSettings, text: string) => void
  resetField: (field: keyof RoleModelSettings) => void
  save: () => void
  discard: () => void
}

export interface AopCardFace extends CardActions {
  hooks: {
    aopCard: {
      getSnapshot: () => AopCardState
      subscribe: (listener: () => void) => () => void
    }
  }
}
