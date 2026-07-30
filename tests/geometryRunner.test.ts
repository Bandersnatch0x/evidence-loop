// @vitest-environment node

import { describe, expect, it } from 'vitest'
import type { ExecutableAssignment } from '../server/data/assignments'
import { GeometryRunner } from '../server/runner/GeometryRunner'

// Unit cube vertices (side 2, centered at origin), keys A..H.
const CUBE_VERTICES = {
  A: [-1, -1, -1] as const,
  B: [1, -1, -1] as const,
  C: [1, 1, -1] as const,
  D: [-1, 1, -1] as const,
  E: [-1, -1, 1] as const,
  F: [1, -1, 1] as const,
  G: [1, 1, 1] as const,
  H: [-1, 1, 1] as const
}

function makeGeometryAssignment(sectionVertexIds: string[]): ExecutableAssignment {
  return {
    id: 'cube-section',
    title: '正方体截面',
    module: '数学 · 立体几何',
    language: 'math',
    questionType: 'geometry',
    estimatedMinutes: 8,
    status: 'ready',
    objective: '判断正方体截面形状',
    scenario: '单元测试',
    requirements: ['提交顶点编号'],
    constraints: ['逗号分隔'],
    functionSignature: 'vertices',
    rubric: [
      { id: 'correctness', label: '正确性', description: '形状判断', maxScore: 100 },
      { id: 'render', label: '渲染', description: '审计', maxScore: 0 }
    ],
    demoVariants: [],
    criteria: [
      {
        id: 'shape-vertices',
        kind: 'answer_match',
        label: '顶点数',
        dimensionId: 'correctness',
        visibility: 'public',
        weight: 50,
        expected: '4',
        conceptId: 'kp.math.geometry.solid',
        passedMessage: '顶点数合理',
        failedMessage: '顶点数不合理'
      },
      {
        id: 'shape-convex',
        kind: 'answer_match',
        label: '凸性',
        dimensionId: 'correctness',
        visibility: 'public',
        weight: 50,
        expected: '凸',
        conceptId: 'kp.math.geometry.solid',
        passedMessage: '凸多边形',
        failedMessage: '非凸'
      },
      {
        id: 'render-artifact',
        kind: 'render_artifact',
        label: '渲染取证',
        dimensionId: 'render',
        visibility: 'public',
        weight: 0,
        conceptId: 'kp.math.geometry.solid',
        passedMessage: '已记录',
        failedMessage: '未记录'
      }
    ],
    runner: {
      kind: 'geometry',
      vertices: CUBE_VERTICES,
      sectionVertexIds
    }
  }
}

describe('GeometryRunner · shape recognition', () => {
  const runner = new GeometryRunner()

  it('passes a quadrilateral section (4 coplanar vertices, convex)', async () => {
    // A,B,C,D = bottom face (z=-1), a square — planar + convex.
    const assignment = makeGeometryAssignment(['A', 'B', 'C', 'D'])
    const result = await runner.run({ assignment, submission: 'A,B,C,D' })
    expect(result.status).toBe('completed')
    const v = result.evidence.find((e) => e.id === 'shape-vertices')
    const c = result.evidence.find((e) => e.id === 'shape-convex')
    expect(v?.state).toBe('passed')
    expect(v?.actual).toBe('4')
    expect(c?.state).toBe('passed')
  })

  it('passes a triangular section (3 vertices always planar + convex)', async () => {
    const assignment = makeGeometryAssignment(['A', 'B', 'C'])
    const result = await runner.run({ assignment, submission: 'A,B,C' })
    const v = result.evidence.find((e) => e.id === 'shape-vertices')
    expect(v?.state).toBe('passed')
    expect(v?.actual).toBe('3')
    expect(result.evidence.find((e) => e.id === 'shape-convex')?.state).toBe('passed')
  })

  it('fails shape-vertices when count exceeds 6', async () => {
    const assignment = makeGeometryAssignment(['A'])
    const result = await runner.run({
      assignment,
      submission: 'A,B,C,D,E,F,G'
    })
    expect(result.evidence.find((e) => e.id === 'shape-vertices')?.state).toBe('failed')
  })

  it('blocks on invalid vertex ids', async () => {
    const assignment = makeGeometryAssignment(['A'])
    const result = await runner.run({
      assignment,
      submission: 'A,X,Y'
    })
    expect(result.evidence.find((e) => e.id === 'shape-vertices')?.state).toBe('blocked')
    expect(result.evidence.find((e) => e.id === 'render-artifact')?.state).toBe('blocked')
  })

  it('always emits render-artifact with passed state and JSON params', async () => {
    const assignment = makeGeometryAssignment(['A', 'B', 'C', 'D'])
    const result = await runner.run({ assignment, submission: 'A,B,C,D' })
    const r = result.evidence.find((e) => e.id === 'render-artifact')
    expect(r?.state).toBe('passed')
    const parsed = JSON.parse(r?.actual ?? '{}') as {
      projection?: string
      vertexIds?: string[]
      sampleCount?: number
    }
    expect(parsed.projection).toBe('isometric')
    expect(parsed.vertexIds).toEqual(['A', 'B', 'C', 'D'])
    expect(parsed.sampleCount).toBe(200)
  })

  it('deduplicates repeated vertex ids', async () => {
    const assignment = makeGeometryAssignment(['A', 'B', 'C'])
    const result = await runner.run({ assignment, submission: 'A,A,B,B,C' })
    expect(result.evidence.find((e) => e.id === 'shape-vertices')?.actual).toBe('3')
  })
})
