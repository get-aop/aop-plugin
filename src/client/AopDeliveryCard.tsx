/**
 * AOP Software Delivery Settings Card Component for DeepSeek Harness Web UI.
 * Provides interactive model and parameter selection for all workflow phases.
 *
 * @module @get-aop/dsh-plugin/client/AopDeliveryCard
 */

import { useSyncExternalStore, useState } from 'react'
import type { AopCardFace, AopCardState, CardFieldState, RoleModelSettings } from './types'
import css from './AopDeliveryCard.module.css'

export interface AopDeliveryCardProps {
  useAopCard?: <T>(selector: (state: AopCardState) => T) => T
  hooks?: AopCardFace['hooks']
  edit?: (field: keyof RoleModelSettings, text: string) => void
  resetField?: (field: keyof RoleModelSettings) => void
  save?: () => void
  discard?: () => void
}

const COMMON_MODELS = [
  { value: 'sol-xhigh', label: 'sol-xhigh (Deep Reasoning Architecture)' },
  { value: 'deepseek-v4-flash-max', label: 'deepseek-v4-flash-max (High Speed Implementation)' },
  { value: 'fable-5-max', label: 'fable-5-max (Adversarial Code Review)' },
  { value: 'sol-medium', label: 'sol-medium (Balanced Browser QA)' },
  { value: 'deepseek-chat', label: 'deepseek-chat (General Purpose)' },
  { value: 'deepseek-reasoner', label: 'deepseek-reasoner (R1 Reasoning)' },
]

interface RoleFieldProps {
  id: string
  roleName: string
  label: string
  hint: string
  state: CardFieldState
  disabled: boolean
  onEdit: (text: string) => void
  onReset: () => void
}

function RoleModelField(props: RoleFieldProps) {
  const isCustom = !COMMON_MODELS.some(m => m.value === props.state.text)
  const [customMode, setCustomMode] = useState(isCustom)

  return (
    <div className={css.field}>
      <div className={css.fieldHead}>
        <label className={css.label} htmlFor={props.id}>
          <span className={css.roleBadge}>{props.roleName}</span>
          {props.label}
        </label>
        {props.state.overridden && (
          <span className={css.badges}>
            <span className={css.badge}>Customized</span>
            <button
              type="button"
              className={css.reset}
              disabled={props.disabled}
              onClick={() => {
                setCustomMode(false)
                props.onReset()
              }}
            >
              Reset
            </button>
          </span>
        )}
      </div>

      {!customMode ? (
        <select
          id={props.id}
          className={props.state.invalid ? css.selectInvalid : css.select}
          value={props.state.text}
          disabled={props.disabled}
          onChange={(e) => {
            if (e.target.value === '__custom__') {
              setCustomMode(true)
            } else {
              props.onEdit(e.target.value)
            }
          }}
        >
          {COMMON_MODELS.map(model => (
            <option key={model.value} value={model.value}>
              {model.label}
            </option>
          ))}
          <option value="__custom__">Custom Model Identifier...</option>
        </select>
      ) : (
        <input
          id={props.id}
          type="text"
          className={props.state.invalid ? css.inputInvalid : css.input}
          value={props.state.text}
          placeholder="e.g. provider/model-name"
          disabled={props.disabled}
          onChange={e => props.onEdit(e.target.value)}
        />
      )}

      <span className={props.state.invalid ? css.invalidHint : css.hint}>
        {props.state.invalid ? 'Model identifier cannot be empty' : props.hint}
      </span>
    </div>
  )
}

export function AopDeliveryCard(props: AopDeliveryCardProps) {
  const [open, setOpen] = useState(true)

  const hook = props.hooks?.aopCard
  const directState = hook
    ? useSyncExternalStore(hook.subscribe, hook.getSnapshot, hook.getSnapshot)
    : undefined
  const state = props.useAopCard ? props.useAopCard(s => s) : directState

  if (!state || !state.available) return null

  const handleEdit = (field: keyof RoleModelSettings, text: string) => {
    props.edit?.(field, text)
  }

  const handleReset = (field: keyof RoleModelSettings) => {
    props.resetField?.(field)
  }

  return (
    <li className={`${css.card} ${open ? css.cardOpen : ''}`}>
      <button
        type="button"
        className={css.header}
        aria-expanded={open}
        onClick={() => setOpen(!open)}
      >
        <div className={css.headText}>
          <div className={css.name}>AOP Software Delivery Workflow</div>
          <div className={css.description}>
            Automated multi-agent delivery pipeline: Plan → Implementation → Review → Browser QA
          </div>
        </div>
        {state.dirty && <span className={css.pending}>Unsaved Edits</span>}
        <svg
          className={`${css.chevron} ${open ? css.chevronOpen : ''}`}
          viewBox="0 0 20 20"
          fill="currentColor"
        >
          <path
            fillRule="evenodd"
            d="M5.293 7.293a1 1 0 011.414 0L10 10.586l3.293-3.293a1 1 0 111.414 1.414l-4 4a1 1 0 01-1.414 0l-4-4a1 1 0 010-1.414z"
            clipRule="evenodd"
          />
        </svg>
      </button>

      {open && (
        <div className={css.body}>
          <div className={css.grid}>
            <RoleModelField
              id="aop-plan-model"
              roleName="Plan"
              label="Architect Model"
              hint="Creates comprehensive implementation plan and acceptance criteria."
              state={state.planModel}
              disabled={!state.writable || state.saving}
              onEdit={text => handleEdit('planModel', text)}
              onReset={() => handleReset('planModel')}
            />

            <RoleModelField
              id="aop-impl-model"
              roleName="Implementation"
              label="Coding Writer Model"
              hint="Sole author of code changes in the shared workspace."
              state={state.implementationModel}
              disabled={!state.writable || state.saving}
              onEdit={text => handleEdit('implementationModel', text)}
              onReset={() => handleReset('implementationModel')}
            />

            <RoleModelField
              id="aop-review-model"
              roleName="Review"
              label="Code Reviewer Model"
              hint="Adversarial code review; rejects defects with actionable findings."
              state={state.reviewModel}
              disabled={!state.writable || state.saving}
              onEdit={text => handleEdit('reviewModel', text)}
              onReset={() => handleReset('reviewModel')}
            />

            <RoleModelField
              id="aop-qa-model"
              roleName="QA"
              label="Browser QA Model"
              hint="Autonomous browser interactions and UI verification."
              state={state.qaModel}
              disabled={!state.writable || state.saving}
              onEdit={text => handleEdit('qaModel', text)}
              onReset={() => handleReset('qaModel')}
            />
          </div>

          <div className={css.field} style={{ maxWidth: '280px' }}>
            <div className={css.fieldHead}>
              <label className={css.label} htmlFor="aop-max-cycles">
                Max Retest Cycles
              </label>
              {state.maxCycles.overridden && (
                <button
                  type="button"
                  className={css.reset}
                  disabled={!state.writable || state.saving}
                  onClick={() => handleReset('maxCycles')}
                >
                  Reset
                </button>
              )}
            </div>
            <input
              id="aop-max-cycles"
              type="number"
              min={1}
              max={100}
              className={state.maxCycles.invalid ? css.inputInvalid : css.input}
              value={state.maxCycles.text}
              disabled={!state.writable || state.saving}
              onChange={e => handleEdit('maxCycles', e.target.value)}
            />
            <span className={state.maxCycles.invalid ? css.invalidHint : css.hint}>
              {state.maxCycles.invalid ? 'Enter an integer between 1 and 100' : 'Maximum evaluator retest cycles before stopping.'}
            </span>
          </div>

          <div className={css.footer}>
            <button
              type="button"
              className={css.discard}
              disabled={!state.dirty || state.saving}
              onClick={() => props.discard?.()}
            >
              Discard
            </button>
            <button
              type="button"
              className={css.save}
              disabled={!state.dirty || state.invalid || state.saving}
              onClick={() => props.save?.()}
            >
              {state.saving ? 'Saving...' : 'Save Changes'}
            </button>
          </div>
        </div>
      )}
    </li>
  )
}
