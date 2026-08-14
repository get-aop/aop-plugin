/**
 * AOP Software Delivery Client Plugin for DeepSeek Harness Web UI.
 * Registers the AOP Delivery Settings Card into `settings.plugin.item`.
 *
 * @module @get-aop/aop-plugin/client
 */

import type { Context } from '@deepseek-ai/cordis'
import { AopDeliveryCard } from './AopDeliveryCard'
import { AopCardController } from './aop-card-controller'
import type { RoleModelSettings } from './types'

export * from './types'
export { AopDeliveryCard } from './AopDeliveryCard'
export { AopCardController, DEFAULT_ROLE_MODELS, AOP_SETTINGS_NAMESPACE } from './aop-card-controller'

export const name = 'aop-delivery-client'
export const inject = ['slots']

/**
 * Mount the AOP client plugin into the browser Cordis context.
 * Registers the settings card into `settings.plugin.item`.
 */
export function apply(ctx: Context, config?: RoleModelSettings): void {
  const controller = new AopCardController(config)

  const registerCard = () => {
    ctx.slots?.register?.({
      name: 'settings.plugin.item',
      id: 'aop-delivery',
      order: 50,
      inject: () => controller.inject(),
    }, AopDeliveryCard)
  }

  if (typeof ctx.slots?.inject === 'function') {
    ctx.slots.inject('settings.plugin.item', registerCard)
  } else {
    registerCard()
  }
}
