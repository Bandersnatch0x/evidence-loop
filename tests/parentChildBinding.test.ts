/**
 * ParentChildBindingStore — 家长-子女绑定（迁移 0021，决赛加码）。
 * 绑定落库、幂等增删查；替代此前写死在路由里的常量。
 */
import { describe, expect, it, beforeEach } from 'vitest'
import Database from 'better-sqlite3'
import { applyProductMigrations } from '../server/db/migrate'
import {
  ParentChildBindingStore,
  seedDemoParentBinding
} from '../server/parent'

function makeStore(): ParentChildBindingStore {
  const db = new Database(':memory:')
  applyProductMigrations(db)
  return new ParentChildBindingStore({
    database: db,
    now: () => new Date('2026-08-14T08:00:00.000Z')
  })
}

describe('ParentChildBindingStore', () => {
  let store: ParentChildBindingStore
  let tick = 0
  beforeEach(() => {
    tick = 0
    const db = new Database(':memory:')
    applyProductMigrations(db)
    store = new ParentChildBindingStore({
      database: db,
      now: () => new Date(Date.UTC(2026, 7, 14, 8, 0, tick++))
    })
  })

  it('bind 幂等：重复绑定不产生重复行', () => {
    store.bind('parent-a', 'child-1')
    store.bind('parent-a', 'child-1')
    expect(store.listChildren('parent-a')).toEqual(['child-1'])
  })

  it('listChildren 按绑定时间稳定排序', () => {
    store.bind('parent-a', 'child-2')
    store.bind('parent-a', 'child-1')
    expect(store.listChildren('parent-a')).toEqual(['child-2', 'child-1'])
  })

  it('isBound / unbind', () => {
    expect(store.isBound('parent-a', 'child-1')).toBe(false)
    store.bind('parent-a', 'child-1')
    expect(store.isBound('parent-a', 'child-1')).toBe(true)
    expect(store.unbind('parent-a', 'child-1')).toBe(true)
    expect(store.isBound('parent-a', 'child-1')).toBe(false)
    expect(store.unbind('parent-a', 'child-1')).toBe(false)
  })

  it('listParents 反查（审计/其他视图用）', () => {
    store.bind('parent-a', 'child-1')
    store.bind('parent-b', 'child-1')
    expect(store.listParents('child-1')).toEqual(['parent-a', 'parent-b'])
  })
})

describe('seedDemoParentBinding', () => {
  it('幂等种子：demo 家长绑定演示学员', () => {
    const store = makeStore()
    expect(seedDemoParentBinding(store)).toBe(true)
    expect(store.isBound('parent-demo', 'learner-demo')).toBe(true)
    // 第二次调用不重复写
    expect(seedDemoParentBinding(store)).toBe(false)
    expect(store.listChildren('parent-demo')).toEqual(['learner-demo'])
  })
})

// ---------------------------------------------------------------------------
// HTTP 面：GET /api/parent/children（只读，家长角色专属）
// ---------------------------------------------------------------------------

import { createServer } from 'node:http'
import type { AddressInfo } from 'node:net'
import type { SessionUser } from '../server/auth/SessionProvider'
import { handleParentApi } from '../server/parent'

function startParentServer(
  bindings: ParentChildBindingStore,
  user: SessionUser
): Promise<{ url: string; close: () => Promise<void> }> {
  const server = createServer((request, response) => {
    const requestUrl = new URL(request.url ?? '/', 'http://127.0.0.1')
    const handled = handleParentApi(request, response, requestUrl, {
      user,
      bindings
    })
    if (!handled) {
      response.writeHead(404).end('not mine')
    }
  })
  return new Promise((resolveServer) => {
    server.listen(0, '127.0.0.1', () => {
      const { port } = server.address() as AddressInfo
      resolveServer({
        url: `http://127.0.0.1:${String(port)}`,
        close: () =>
          new Promise<void>((done) => {
            server.close(() => done())
          })
      })
    })
  })
}

describe('GET /api/parent/children', () => {
  it('家长返回绑定子女列表；未绑定家长返回空列表', async () => {
    const store = makeStore()
    store.bind('parent-demo', 'learner-demo')
    const server = await startParentServer(store, {
      userId: 'parent-demo',
      role: 'parent',
      displayName: '演示家长'
    })
    const ok = await fetch(`${server.url}/api/parent/children`)
    expect(ok.status).toBe(200)
    const body = (await ok.json()) as { children: string[] }
    expect(body.children).toEqual(['learner-demo'])

    const empty = await startParentServer(store, {
      userId: 'parent-unbound',
      role: 'parent',
      displayName: '未绑定家长'
    })
    const emptyBody = await fetch(`${empty.url}/api/parent/children`)
    expect((await emptyBody.json()) as { children: string[] }).toEqual({
      children: []
    })
    await server.close()
    await empty.close()
  })

  it('非家长角色 → 403', async () => {
    const store = makeStore()
    const server = await startParentServer(store, {
      userId: TEACHER_ID,
      role: 'teacher',
      displayName: 'T'
    })
    const response = await fetch(`${server.url}/api/parent/children`)
    expect(response.status).toBe(403)
    await server.close()
  })
})

const TEACHER_ID = 'teacher-x'
