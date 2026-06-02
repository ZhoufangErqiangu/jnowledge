import type Koa from 'koa'
import type Router from '@koa/router'
import type { Container } from '../container.js'
import type { AppState } from '../http/state.js'
import { createAuthController } from './auth.controller.js'
import { createCollectionController } from './collection.controller.js'
import { createDocumentController } from './document.controller.js'
import { createChatController } from './chat.controller.js'
import { createAgentController } from './agent.controller.js'

/**
 * ★显式注册（硬约束）：禁止动态 require / fs 扫描。
 * 新增 controller = import 一行 + 数组加一项。依赖图静态可见、类型安全、加载顺序确定。
 */
const CONTROLLER_FACTORIES: ((c: Container) => Router<AppState>)[] = [
  createAuthController,
  createCollectionController,
  createDocumentController,
  createChatController,
  createAgentController,
]

export function registerControllers(app: Koa<AppState>, c: Container): void {
  for (const factory of CONTROLLER_FACTORIES) {
    const router = factory(c)
    app.use(router.routes())
    app.use(router.allowedMethods())
  }
}
