/**
 * ReferenceDrawer — shared teacher drawer for binding demonstrations to a
 * question or knowledge point (ticket T-J, spec §8 五步流 ①检索→②预览→③引用→④排序→⑤移除).
 *
 * Loop: facet + keyword search (T-E /api/library) → preview (lazy player) →
 * set primary (unique, replace-requires-confirm) / add supplementary (≤8) →
 * reorder (primary pinned first) → remove (confirm: unbind only, never delete
 * the library work). Fixed-version semantics: the card shows the bound version
 * number; a "new version" badge prompts a manual upgrade (never automatic).
 */
import { useCallback, useEffect, useMemo, useState } from 'react'
import { StudentPlayer } from '../player/StudentPlayer'
import type { PlayerPayload } from '../../../server/demonstration/playerRoutes'

export interface ReferenceEntry {
  id: string
  demoVersionId: string
  demoId: string
  role: 'primary' | 'supplementary'
  ord: number
}

export interface LibraryCard {
  id: string
  title: string
  description: string
  authorName: string
  license: string
  subject: string
  grade: string
  format: string
  space: string
  behavior: string
  versionSeq: number
  latestVersionId: string
  health: string
  citationCount: number
  sourceBadge: string | null
}

export interface ReferenceDrawerProps {
  /** Parent target — exactly one. */
  questionId?: string
  kpId?: string
  /** Injected API (tests); defaults to fetch. */
  api?: {
    list: (q: string) => Promise<LibraryCard[]>
    getReferences: () => Promise<ReferenceEntry[]>
    setReferences: (entries: { demoVersionId: string; role: 'primary' | 'supplementary' }[]) => Promise<void>
    removeReference: (id: string) => Promise<void>
    upgradeReference: (id: string, newVersionId: string) => Promise<void>
    loadPlayer: (demoId: string, versionId: string) => Promise<{ document: unknown; mediaManifest: PlayerPayload['mediaManifest'] }>
  }
}

export function ReferenceDrawer({ questionId, kpId, api }: ReferenceDrawerProps) {
  const parentType = questionId ? 'question' : 'kp'
  const parentId = (questionId ?? kpId) ?? ''

  const [query, setQuery] = useState('')
  const [results, setResults] = useState<LibraryCard[]>([])
  const [entries, setEntries] = useState<ReferenceEntry[]>([])
  const [preview, setPreview] = useState<{ demoId: string; versionId: string; document: unknown; mediaManifest: PlayerPayload['mediaManifest'] } | null>(null)
  const [confirmReplace, setConfirmReplace] = useState<string | null>(null)
  const [confirmRemove, setConfirmRemove] = useState<string | null>(null)
  const [confirmUpgrade, setConfirmUpgrade] = useState<string | null>(null)
  const [notice, setNotice] = useState('')

  const realApi = useMemo(() => {
    if (api) return api
    return {
      list: async (q: string) => {
        const res = await fetch(`/api/library?q=${encodeURIComponent(q)}`)
        if (!res.ok) return []
        const data = (await res.json()) as { items: LibraryCard[] }
        return data.items ?? []
      },
      getReferences: async () => {
        const res = await fetch(`/api/references?${parentType}=${encodeURIComponent(parentId)}`)
        if (!res.ok) return []
        const data = (await res.json()) as { references: ReferenceEntry[] }
        return data.references ?? []
      },
      setReferences: async (list) => {
        await fetch(`/api/references?${parentType}=${encodeURIComponent(parentId)}`, {
          method: 'PUT',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ entries: list })
        })
      },
      removeReference: async (id) => {
        await fetch(`/api/references/${id}`, { method: 'DELETE' })
      },
      upgradeReference: async (id, newVersionId) => {
        await fetch(`/api/references/${id}/upgrade`, {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ newVersionId })
        })
      },
      loadPlayer: async (demoId, versionId) => {
        const res = await fetch(`/api/demonstrations/${demoId}/versions/${versionId}/player`)
        if (!res.ok) return { document: null, mediaManifest: [] as PlayerPayload['mediaManifest'] }
        return (await res.json()) as { document: unknown; mediaManifest: PlayerPayload['mediaManifest'] }
      }
    }
  }, [api, parentId, parentType])

  const refresh = useCallback(async () => {
    const [list, cards] = await Promise.all([realApi.getReferences(), realApi.list('')])
    setEntries(list)
    setResults(cards)
  }, [realApi])

  useEffect(() => {
    void refresh()
  }, [refresh])

  const search = useCallback(async () => {
    const items = await realApi.list(query)
    setResults(items)
  }, [query, realApi])

  const primary = entries.find((e) => e.role === 'primary')
  const supplementary = entries.filter((e) => e.role === 'supplementary')
  const canAddSupplementary = supplementary.length < 8

  const bindPrimary = async (card: LibraryCard): Promise<void> => {
    if (primary) {
      // Replace requires confirmation (spec §8 ② 主槽唯一替换二次确认).
      setConfirmReplace(card.id)
      return
    }
    await realApi.setReferences([
      { demoVersionId: card.latestVersionId, role: 'primary' },
      ...supplementary.map((e) => ({ demoVersionId: e.demoVersionId, role: 'supplementary' as const }))
    ])
    setNotice(`已设为主演示：${card.title}`)
    await refresh()
  }

  const confirmReplaceNow = async (card: LibraryCard): Promise<void> => {
    await realApi.setReferences([
      { demoVersionId: card.latestVersionId, role: 'primary' },
      ...supplementary.map((e) => ({ demoVersionId: e.demoVersionId, role: 'supplementary' as const }))
    ])
    setConfirmReplace(null)
    setNotice(`已替换主演示：${card.title}`)
    await refresh()
  }

  const addSupplementary = async (card: LibraryCard): Promise<void> => {
    if (!canAddSupplementary) {
      setNotice('补充演示已达上限（8 个）')
      return
    }
    await realApi.setReferences([
      ...(primary ? [{ demoVersionId: primary.demoVersionId, role: 'primary' as const }] : []),
      ...supplementary.map((e) => ({ demoVersionId: e.demoVersionId, role: 'supplementary' as const })),
      { demoVersionId: card.latestVersionId, role: 'supplementary' as const }
    ])
    setNotice(`已加入补充演示：${card.title}`)
    await refresh()
  }

  const move = async (index: number, delta: number): Promise<void> => {
    const next = [...supplementary]
    const target = index + delta
    if (target < 0 || target >= next.length) return
    const [item] = next.splice(index, 1)
    next.splice(target, 0, item!)
    await realApi.setReferences([
      ...(primary ? [{ demoVersionId: primary.demoVersionId, role: 'primary' as const }] : []),
      ...next.map((e) => ({ demoVersionId: e.demoVersionId, role: 'supplementary' as const }))
    ])
    await refresh()
  }

  const remove = async (entry: ReferenceEntry): Promise<void> => {
    if (confirmRemove !== entry.id) {
      setConfirmRemove(entry.id)
      return
    }
    await realApi.removeReference(entry.id)
    setConfirmRemove(null)
    setNotice('已解除引用（公共库作品未删除）')
    await refresh()
  }

  const upgrade = async (entry: ReferenceEntry, card: LibraryCard): Promise<void> => {
    if (confirmUpgrade !== entry.id) {
      setConfirmUpgrade(entry.id)
      return
    }
    await realApi.upgradeReference(entry.id, card.latestVersionId)
    setConfirmUpgrade(null)
    setNotice(`已升级到 v${card.versionSeq}`)
    await refresh()
  }

  const previewCard = async (card: LibraryCard): Promise<void> => {
    const data = await realApi.loadPlayer(card.id, card.latestVersionId)
    setPreview({ demoId: card.id, versionId: card.latestVersionId, document: data.document, mediaManifest: data.mediaManifest })
  }

  return (
    <div className="ref-drawer">
      <div className="ref-search">
        <input
          type="search"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="检索公共库演示…"
          aria-label="检索"
        />
        <button type="button" className="secondary-button" onClick={() => void search()}>检索</button>
      </div>

      <div className="ref-results">
        {results.map((card) => (
          <div key={card.id} className="ref-card" data-health={card.health}>
            <div className="ref-card-head">
              <strong>{card.title}</strong>
              <span className="ref-version">v{card.versionSeq}</span>
              {card.health !== 'healthy' && <span className="ref-unavailable">源不可用</span>}
            </div>
            <p className="ref-card-desc">{card.description}</p>
            <div className="ref-card-meta">
              <span>{card.authorName}</span> · <span>{card.license}</span> ·{' '}
              <span>{card.subject}/{card.grade}</span> · 被引用 {card.citationCount}
            </div>
            <div className="ref-card-actions">
              <button type="button" className="ghost-button" onClick={() => void previewCard(card)}>预览</button>
              <button type="button" className="secondary-button" onClick={() => void bindPrimary(card)}>设为主演示</button>
              <button type="button" className="ghost-button" onClick={() => void addSupplementary(card)} disabled={!canAddSupplementary}>
                加入补充
              </button>
            </div>
            {confirmReplace === card.id && (
              <div className="ref-confirm">
                <span>替换当前主演示？</span>
                <button type="button" className="secondary-button" onClick={() => void confirmReplaceNow(card)}>确认替换</button>
                <button type="button" className="ghost-button" onClick={() => setConfirmReplace(null)}>取消</button>
              </div>
            )}
          </div>
        ))}
      </div>

      {preview && (
        <div className="ref-preview">
          <div className="ref-preview-head">
            <span>预览（懒加载）</span>
            <button type="button" className="ghost-button" onClick={() => setPreview(null)}>✕</button>
          </div>
          <StudentPlayer
            payload={{
              demonstrationId: preview.demoId,
              versionId: preview.versionId,
              status: 'approved',
              document: preview.document,
              renderLevel: 'full',
              reasons: [],
              mediaManifest: preview.mediaManifest ?? [],
              coverRef: null,
              subtitleRef: null,
              budget: { ok: true, issues: [], nodes: 0, triangles: 0, durationSeconds: 0, mediaRefs: 0 },
              externalVideos: []
            }}
          />
        </div>
      )}

      {notice && <p className="ref-notice" role="status">{notice}</p>}

      <div className="ref-bound">
        <div className="ref-bound-title">已引用（主演示固定首位）</div>
        {entries.length === 0 && <div className="ref-empty">尚未引用任何演示</div>}
        {entries.map((entry, i) => {
          const isPrimary = entry.role === 'primary'
          const card = results.find((r) => r.id === entry.demoId)
          return (
            <div key={entry.id} className={`ref-bound-row ${isPrimary ? 'primary' : ''}`}>
              <span className="ref-role">{isPrimary ? '主' : `补充${i}`}</span>
              <span className="ref-version-fixed">v{card?.versionSeq ?? '?'}</span>
              <span className="ref-title">{card?.title ?? entry.demoVersionId.slice(0, 8)}</span>
              {card && card.health !== 'healthy' && <span className="ref-unavailable">源不可用（继续播放）</span>}
              {card && entry.demoVersionId !== card.latestVersionId && (
                <button type="button" className="secondary-button" onClick={() => void upgrade(entry, card)}>
                  {confirmUpgrade === entry.id ? `确认升级到 v${card.versionSeq}` : `升级到 v${card.versionSeq}`}
                </button>
              )}
              {!isPrimary && (
                <button type="button" className="ghost-button" aria-label="上移" onClick={() => void move(i - 1, -1)} disabled={i === 0}>▲</button>
              )}
              {!isPrimary && (
                <button type="button" className="ghost-button" aria-label="下移" onClick={() => void move(i - 1, 1)} disabled={i === supplementary.length}>▼</button>
              )}
              <button type="button" className="ghost-button" onClick={() => void remove(entry)}>
                {confirmRemove === entry.id ? '确认移除' : '移除'}
              </button>
            </div>
          )
        })}
      </div>
    </div>
  )
}
