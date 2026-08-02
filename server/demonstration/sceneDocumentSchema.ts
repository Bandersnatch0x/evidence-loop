/**
 * sceneDocumentSchema — zod trust boundary for the SceneDocument
 * (spec §4, decision ticket 10).
 *
 * The SceneDocument is the SINGLE source of truth: editor writes, version
 * snapshot freezes (T02), player reads (T07), AI drafts (T09), import/export
 * normalize to this one document. Pure data, deterministic, zero-script.
 *
 * This module mirrors the ADR-0015 visualizationSchema pattern: a zod schema
 * is the only gate to store/render. Hard failures reject; soft advisories are
 * returned alongside. Sections land incrementally per T-C slices.
 *
 * Capability negotiation, N-2 forward migration, glTF/SVG whitelist import,
 * export snapshotting and security guards live in sibling modules
 * (capabilities.ts / sceneMigrations.ts / sceneImport.ts / sceneExport.ts /
 * sceneSecurity.ts) — all consuming `SceneDocument` typed here.
 */
import { z } from 'zod'

/** Current scene format major.minor. Bumped on breaking structural changes. */
export const SCENE_FORMAT_VERSION = '1.0' as const
/** N-2 policy: a version older than the floor is refused (downgrade to static). */
export const MIN_SUPPORTED_VERSION = '1.0' as const

/** Semantic-ish compare 'x.y' strings: returns -1/0/1. */
export function compareVersions(a: string, b: string): number {
  const [amaj = 0, amin = 0] = a.split('.').map((n) => Number(n))
  const [bmaj = 0, bmin = 0] = b.split('.').map((n) => Number(n))
  if (amaj !== bmaj) return amaj < bmaj ? -1 : 1
  if (amin !== bmin) return amin < bmin ? -1 : 1
  return 0
}

export function isVersionSupported(version: string): boolean {
  return compareVersions(version, MIN_SUPPORTED_VERSION) >= 0
}

/** Finite [x,y,z] tuple — the universal coordinate primitive. */
export const vec3Schema = z.tuple([
  z.number().finite(),
  z.number().finite(),
  z.number().finite()
])
export type Vec3 = z.infer<typeof vec3Schema>

/** Finite [r,g,b] color in 0..1 (PBR convention) OR 8-bit hex string. */
export const colorSchema = z
  .tuple([
    z.number().min(0).max(1).finite(),
    z.number().min(0).max(1).finite(),
    z.number().min(0).max(1).finite()
  ])
  .or(z.string().regex(/^#[0-9a-fA-F]{6}$/))
export type Color = z.infer<typeof colorSchema>

/** Web-safe font whitelist (spec §4.8) — shared by textSchema + fontsAndFormulas. */
export const WEB_SAFE_FONTS = [
  'serif',
  'sans-serif',
  'monospace',
  'Arial',
  'Helvetica',
  'Times New Roman',
  'Courier New',
  'Georgia',
  'Verdana',
  'Noto Sans',
  'Noto Serif',
  'Noto Sans Math',
  'KaTeX_Main'
] as const

/**
 * documentMeta — top-level identity & coordinate convention.
 * sceneFormatVersion governs the N-2 migration policy.
 */
export const documentMetaSchema = z.object({
  sceneFormatVersion: z.string().regex(/^\d+\.\d+$/),
  type: z.enum(['demonstration', 'reference', 'exercise']).default('demonstration'),
  /** Coordinate unit the author intended (meters by spec §4.2). */
  unit: z.enum(['meters', 'centimeters', 'normalized']).default('meters'),
  /** Generator: who/what produced this doc ('teacher' | 'ai:assistant' | 'import:gltf' …). */
  generator: z.string().max(80).default('teacher'),
  createdAt: z.string().datetime().optional(),
  updatedAt: z.string().datetime().optional()
})
export type DocumentMeta = z.infer<typeof documentMetaSchema>

/**
 * runtimeVersion — what the document needs at play time. capabilities[] is the
 * negotiation input the player/editor resolves against device probes.
 */
const CAPABILITY_FLAGS = [
  'webgl2',
  'webgl1',
  'webgpu',
  'video',
  'webvtt',
  'audio',
  'physics-deterministic',
  'model3d-skinning',
  'model3d-morph-targets',
  'particles'
] as const

export const runtimeVersionSchema = z.object({
  sceneFormatVersion: z.string().regex(/^\d+\.\d+$/),
  /** Declared capability needs — resolved by negotiateCapabilities(). */
  capabilities: z.array(z.enum(CAPABILITY_FLAGS)).default([])
})
export type RuntimeVersion = z.infer<typeof runtimeVersionSchema>

/**
 * viewerConfig — default camera / lights / background / budget hints.
 * Player may override per device tier but starts from here.
 */
export const viewerConfigSchema = z.object({
  camera: z
    .object({
      position: vec3Schema.default([3, 2, 5]),
      target: vec3Schema.default([0, 0, 0]),
      fov: z.number().min(10).max(170).finite().default(50)
    })
    .default({}),
  background: colorSchema.default('#1a1a2e'),
  /** Soft budget hints (hard caps live in sceneSecurity). */
  maxNodes: z.number().int().positive().max(10_000).default(500),
  maxTriangles: z.number().int().positive().max(2_000_000).default(100_000)
})
export type ViewerConfig = z.infer<typeof viewerConfigSchema>

/** Transform: position + euler rotation (radians) + scale, all finite. */
export const transformSchema: z.ZodType<Transform, z.ZodTypeDef, Partial<Transform> | undefined> = z
  .object({
    position: vec3Schema.default([0, 0, 0]),
    rotation: vec3Schema.default([0, 0, 0]),
    scale: vec3Schema.default([1, 1, 1])
  })
  .default({})
export interface Transform {
  position: Vec3
  rotation: Vec3
  scale: Vec3
}

/**
 * objectTree node — hierarchical scene graph. References parent by id; roots
 * have no parent. visible defaults true. meshRef/children resolved by
 * superRefine against the tree (ids unique, parent links valid, no cycles).
 */
export const objectNodeSchema: z.ZodType<ObjectNode, z.ZodTypeDef, unknown> = z.lazy(() =>
  z.object({
    id: z.string().min(1).max(120),
    parentId: z.string().min(1).max(120).optional(),
    name: z.string().max(120).optional(),
    transform: transformSchema,
    visible: z.boolean().default(true),
    /** Optional geometry binding: either a 2D/3D geometry id or a glTF primitive. */
    meshRef: z.string().min(1).max(120).optional(),
    children: z.array(z.lazy(() => objectNodeSchema)).max(500).default([])
  })
)
export interface ObjectNode {
  id: string
  parentId?: string
  name?: string
  transform: Transform
  visible: boolean
  meshRef?: string
  children: ObjectNode[]
}

/**
 * materials — base PBR + 2D fill/stroke. kind discriminates (discriminatedUnion
 * works here: all are plain ZodObject without superRefine effects).
 */
const pbrMaterialSchema = z.object({
  kind: z.literal('pbr'),
  baseColorFactor: colorSchema.default([1, 1, 1]),
  metallicFactor: z.number().min(0).max(1).finite().default(0),
  roughnessFactor: z.number().min(0).max(1).finite().default(1),
  alphaMode: z.enum(['OPAQUE', 'MASK', 'BLEND']).default('OPAQUE'),
  alphaCutoff: z.number().min(0).max(1).finite().default(0.5),
  /** MediaAsset blob hash for base color texture (whitelisted by sceneSecurity). */
  baseColorTexture: z.string().regex(/^[0-9a-f]{64}$/).optional()
})

const fill2dMaterialSchema = z.object({
  kind: z.literal('fill2d'),
  fill: colorSchema.default([0, 0, 0]),
  fillOpacity: z.number().min(0).max(1).finite().default(1)
})

const stroke2dMaterialSchema = z.object({
  kind: z.literal('stroke2d'),
  stroke: colorSchema.default([0, 0, 0]),
  strokeWidth: z.number().min(0).max(100).finite().default(1),
  strokeOpacity: z.number().min(0).max(1).finite().default(1)
})

export const materialSchema = z.discriminatedUnion('kind', [
  pbrMaterialSchema,
  fill2dMaterialSchema,
  stroke2dMaterialSchema
])
export type Material = z.infer<typeof materialSchema>

/**
 * geometry2D — SVG subset primitives (spec §4.2): rect/circle/ellipse/path/
 * line/polyline/polygon/text. Each carries an id so objectTree can meshRef it.
 * Path 'd' is a constrained subset (M/L/C/Z only — no JS expression, no fonts).
 */
const rectSchema = z.object({
  id: z.string().min(1).max(120),
  shape: z.literal('rect'),
  x: z.number().finite(),
  y: z.number().finite(),
  width: z.number().min(0).finite(),
  height: z.number().min(0).finite(),
  rx: z.number().min(0).finite().optional(),
  ry: z.number().min(0).finite().optional()
})
const circleSchema = z.object({
  id: z.string().min(1).max(120),
  shape: z.literal('circle'),
  cx: z.number().finite(),
  cy: z.number().finite(),
  r: z.number().min(0).finite()
})
const ellipseSchema = z.object({
  id: z.string().min(1).max(120),
  shape: z.literal('ellipse'),
  cx: z.number().finite(),
  cy: z.number().finite(),
  rx: z.number().min(0).finite(),
  ry: z.number().min(0).finite()
})
const lineSchema = z.object({
  id: z.string().min(1).max(120),
  shape: z.literal('line'),
  x1: z.number().finite(),
  y1: z.number().finite(),
  x2: z.number().finite(),
  y2: z.number().finite()
})
const polylineSchema = z.object({
  id: z.string().min(1).max(120),
  shape: z.literal('polyline'),
  points: z.array(z.tuple([z.number().finite(), z.number().finite()])).min(2).max(2000)
})
const polygonSchema = z.object({
  id: z.string().min(1).max(120),
  shape: z.literal('polygon'),
  points: z.array(z.tuple([z.number().finite(), z.number().finite()])).min(3).max(2000)
})
/** Path: M/L/C/Z subset only — whitelist the whole string (no eval surface, no Q/A/S/H/V/T). */
const PATH_D_RE = /^[MLCZmlcz][\d\s.,+-]*(?:[MLCZmlcz][\d\s.,+-]*)*$/
const pathSchema = z.object({
  id: z.string().min(1).max(120),
  shape: z.literal('path'),
  d: z.string().min(1).max(5000).regex(PATH_D_RE)
})
const textSchema = z.object({
  id: z.string().min(1).max(120),
  shape: z.literal('text'),
  x: z.number().finite(),
  y: z.number().finite(),
  text: z.string().max(500),
  fontFamily: z.enum(WEB_SAFE_FONTS).optional(),
  fontSize: z.number().min(1).max(500).finite().optional()
})

export const geometry2DPrimitiveSchema = z.discriminatedUnion('shape', [
  rectSchema,
  circleSchema,
  ellipseSchema,
  lineSchema,
  polylineSchema,
  polygonSchema,
  pathSchema,
  textSchema
])
export type Geometry2DPrimitive = z.infer<typeof geometry2DPrimitiveSchema>

/**
 * geometry3D — glTF 2.0 asset reference (by MediaAsset blob hash) + inline
 * primitives (spec §4.2: box/sphere/cylinder/cone/plane/torus/ring).
 * gltfAsset hash is a 64-char SHA-256 (T-B CAS) — surface validated here,
 * deep-validated by T-B parseGlb on upload.
 */
const gltfRefSchema = z.object({
  id: z.string().min(1).max(120),
  kind: z.literal('gltf'),
  assetHash: z.string().regex(/^[0-9a-f]{64}$/),
  /** Optional primitive index when referencing a single mesh within the GLB. */
  primitiveIndex: z.number().int().min(0).max(1024).optional()
})
const boxSchema = z.object({
  id: z.string().min(1).max(120),
  kind: z.literal('box'),
  size: vec3Schema.default([1, 1, 1])
})
const sphereSchema = z.object({
  id: z.string().min(1).max(120),
  kind: z.literal('sphere'),
  radius: z.number().min(0).finite().default(1),
  segments: z.number().int().min(3).max(128).default(24)
})
const cylinderSchema = z.object({
  id: z.string().min(1).max(120),
  kind: z.literal('cylinder'),
  radius: z.number().min(0).finite().default(1),
  height: z.number().min(0).finite().default(1),
  radialSegments: z.number().int().min(3).max(128).default(24)
})
const coneSchema = z.object({
  id: z.string().min(1).max(120),
  kind: z.literal('cone'),
  radius: z.number().min(0).finite().default(1),
  height: z.number().min(0).finite().default(1),
  radialSegments: z.number().int().min(3).max(128).default(24)
})
const planeSchema = z.object({
  id: z.string().min(1).max(120),
  kind: z.literal('plane'),
  size: vec3Schema.default([1, 1, 0])
})
const torusSchema = z.object({
  id: z.string().min(1).max(120),
  kind: z.literal('torus'),
  radius: z.number().min(0).finite().default(1),
  tube: z.number().min(0).finite().default(0.3),
  radialSegments: z.number().int().min(3).max(128).default(24),
  tubularSegments: z.number().int().min(3).max(256).default(64)
})
const ringSchema = z.object({
  id: z.string().min(1).max(120),
  kind: z.literal('ring'),
  innerRadius: z.number().min(0).finite().default(0.5),
  outerRadius: z.number().min(0).finite().default(1),
  thetaSegments: z.number().int().min(3).max(128).default(24)
})

export const geometry3DPrimitiveSchema = z.discriminatedUnion('kind', [
  gltfRefSchema,
  boxSchema,
  sphereSchema,
  cylinderSchema,
  coneSchema,
  planeSchema,
  torusSchema,
  ringSchema
])
export type Geometry3DPrimitive = z.infer<typeof geometry3DPrimitiveSchema>

/**
 * skeletons — bones/joints, skin references, morph targets (§4.2).
 * Each bone declares a parentId for hierarchy; transform is relative to
 * parent. Morph targets reference geometry ids.
 */
export const boneSchema = z.object({
  id: z.string().min(1).max(120),
  parentId: z.string().min(1).max(120).optional(),
  name: z.string().max(120).optional(),
  transform: transformSchema.default({})
})
export const skeletonSchema = z.object({
  id: z.string().min(1).max(120),
  bones: z.array(boneSchema).max(256).default([]),
  /** glTF skin reference — the skinned mesh geometry id. */
  skinRef: z.string().min(1).max(120).optional()
})
export type Skeleton = z.infer<typeof skeletonSchema>

/** Morph targets: declare which geometry id and the target positions. */
export const morphTargetSchema = z.object({
  geometryId: z.string().min(1).max(120),
  name: z.string().max(120).optional(),
  /** Relative weight (0..1) — the player interpolates. */
  weight: z.number().min(0).max(1).finite().default(0)
})

/**
 * particles — parametric, deterministic seed (spec §4.2).
 * The player must produce the same result for the same seed every time.
 */
export const particleEmitterSchema = z.object({
  id: z.string().min(1).max(120),
  kind: z.enum(['point', 'box', 'sphere']).default('point'),
  count: z.number().int().min(1).max(10_000).default(100),
  /** Deterministic seed — same seed → same result on every render. */
  seed: z.number().int().min(0).max(2 ** 32 - 1).default(0),
  lifespan: z.number().min(0).finite().default(2),
  speed: z.number().min(0).finite().default(1),
  size: z.number().min(0).finite().default(0.1),
  color: colorSchema.default([1, 1, 1]),
  /** Degradable to static: true means the player may render a static placeholder. */
  degradable: z.boolean().default(true)
})
export type ParticleEmitter = z.infer<typeof particleEmitterSchema>

/**
 * timeline — deterministic tweens/keyframes + video chapters (§4.2/§6.1).
 * A single timeline of sequential or parallel tracks.
 */
// Keyframe: either a property path + value at a time, or a node visibility toggle.
const keyframeValueSchema = z.union([
  z.number().finite(),
  z.tuple([z.number().finite(), z.number().finite(), z.number().finite()]),
  z.boolean()
])

export const keyframeSchema = z.object({
  time: z.number().min(0).finite(),
  /** Property path, e.g. "transform.position.x" or "visible" (node-relative). */
  property: z.string().max(120),
  value: keyframeValueSchema,
  easing: z.enum(['linear', 'ease-in', 'ease-out', 'ease-in-out', 'step']).default('linear')
})
export type Keyframe = z.infer<typeof keyframeSchema>

/**
 * An animation track targets a node id and holds keyframes.
 * The player interpolates between keyframes deterministically.
 */
export const animationTrackSchema = z.object({
  nodeId: z.string().min(1).max(120),
  keyframes: z.array(keyframeSchema).min(1).max(500)
})
export type AnimationTrack = z.infer<typeof animationTrackSchema>

/**
 * Video chapter — a reference to an ExternalVideoRef (mediaRefs) or a
 * timeline segment with a chapter title.
 */
export const videoChapterSchema = z.object({
  title: z.string().max(200),
  /** MediaRef id or ExternalVideoRef id. */
  mediaRefId: z.string().min(1).max(120).optional(),
  /** Start/end time in seconds for a segment within the timeline. */
  startTime: z.number().min(0).finite().default(0),
  endTime: z.number().min(0).finite().optional()
})
export type VideoChapter = z.infer<typeof videoChapterSchema>

export const timelineSchema = z.object({
  /** Tracks run in parallel; each track is a sequence of keyframes on one node. */
  tracks: z.array(animationTrackSchema).max(50).default([]),
  /** Ordered chapters (video-mixed or pure-playback). */
  chapters: z.array(videoChapterSchema).max(200).default([]),
  /** Total duration hint (seconds) — player may use for scrub bar. */
  duration: z.number().min(0).finite().optional()
})
export type Timeline = z.infer<typeof timelineSchema>

/**
 * interactions — spec §6.2 four-type whitelist. Declarative, no script.
 * Each interaction targets a node id and a trigger type.
 */
const orbitInteractionSchema = z.object({
  type: z.literal('orbit'),
  nodeId: z.string().min(1).max(120),
  /** Default: enabled on desktop/tablet auto. */
  enabled: z.boolean().default(true)
})

const viewSwitchInteractionSchema = z.object({
  type: z.literal('view-switch'),
  nodeId: z.string().min(1).max(120),
  /** Preset viewpoints the user can cycle through. */
  viewpoints: z
    .array(
      z.object({
        label: z.string().max(80),
        position: vec3Schema,
        target: vec3Schema
      })
    )
    .min(1)
    .max(20)
})

const stepVisibilityInteractionSchema = z.object({
  type: z.literal('step-visibility'),
  nodeId: z.string().min(1).max(120),
  /** Ordered steps: each step lists node ids that should become visible. */
  steps: z.array(
    z.object({
      label: z.string().max(80).optional(),
      show: z.array(z.string().min(1).max(120)).min(1),
      hide: z.array(z.string().min(1).max(120)).optional()
    })
  ).min(1).max(100)
})

const pickHighlightInteractionSchema = z.object({
  type: z.literal('pick-highlight'),
  nodeId: z.string().min(1).max(120),
  highlightColor: colorSchema.default('#ffff00'),
  /** Optional label shown when picked. */
  label: z.string().max(200).optional()
})

export const interactionSchema = z.discriminatedUnion('type', [
  orbitInteractionSchema,
  viewSwitchInteractionSchema,
  stepVisibilityInteractionSchema,
  pickHighlightInteractionSchema
])
export type Interaction = z.infer<typeof interactionSchema>

/**
 * mediaRefs — media asset references (spec §4.2).
 * Each entry binds a MediaAsset blob hash to a usage role within the scene.
 */
export const mediaRefSchema = z.object({
  id: z.string().min(1).max(120),
  /** MediaAsset DB id (spec §4.2: "MediaAsset id + blob hash + 用途"). */
  assetId: z.string().min(1).max(120).optional(),
  /** 64-char SHA-256 blob hash (T-B CAS). */
  blobHash: z.string().regex(/^[0-9a-f]{64}$/),
  /** Purpose: 'texture', 'audio', 'video', 'subtitle', 'thumbnail', 'glb'. */
  purpose: z.enum(['texture', 'audio', 'video', 'subtitle', 'thumbnail', 'glb']),
  /** Optional label for the player to display. */
  label: z.string().max(200).optional()
})
export type MediaRef = z.infer<typeof mediaRefSchema>

/**
 * fontsAndFormulas — web-safe fonts + LaTeX subset (§4.2).
 * Font whitelist: fonts that the player can render. LaTeX strings are
 * rendered server-side on publish (not in player).
 */
export const fontsAndFormulasSchema = z.object({
  /** Font family names (must be web-safe whitelist). */
  fonts: z.array(z.enum(WEB_SAFE_FONTS)).max(10).default([]),
  /** LaTeX expressions (rendered server-side to SVG on publish). */
  formulas: z.array(
    z.object({
      id: z.string().min(1).max(120),
      tex: z.string().min(1).max(2000),
      /** Display size (pt). */
      fontSize: z.number().min(6).max(72).finite().default(16)
    })
  ).max(100).default([])
})
export type FontsAndFormulas = z.infer<typeof fontsAndFormulasSchema>

/**
 * editorMetadata — view state, ignored by player (§4.2).
 * Free-form object; no constraints beyond being a JSON object.
 */
export const editorMetadataSchema = z.record(z.unknown()).default({})
export type EditorMetadata = z.infer<typeof editorMetadataSchema>

/**
 * Top-level SceneDocument. Sections land per T-C slice plan:
 *  S1: documentMeta + runtimeVersion + viewerConfig (this file, now)
 *  S2: objectTree + materials + geometry2D + geometry3D
 *  S3: timeline + interactions + particles + skeletons + mediaRefs +
 *      fontsAndFormulas + editorMetadata
 *
 * Optional until their slice so partial docs (e.g. an AI draft with only meta)
 * still parse. parse() rejects unknown sections (zod default strip — but we
 * `.strict()` on each section object to forbid silent drift).
 */
export const sceneDocumentSchema = z
  .object({
  documentMeta: documentMetaSchema,
  runtimeVersion: runtimeVersionSchema.default({ sceneFormatVersion: SCENE_FORMAT_VERSION }),
  viewerConfig: viewerConfigSchema.default({}),
  // S2/S3 sections arrive incrementally; until then absent = optional.
  objectTree: z
    .array(objectNodeSchema)
    .max(500)
    .superRefine((nodes, ctx) => {
      // Collect ALL nodes recursively (top-level + nested children) — the
      // tree is validated as a whole, not per-level.
      const ids = new Map<string, ObjectNode>()
      const walkChildren = (list: readonly ObjectNode[]): void => {
        for (const n of list) {
          if (ids.has(n.id)) {
            ctx.addIssue({ code: z.ZodIssueCode.custom, message: `duplicate node id: ${n.id}` })
          }
          ids.set(n.id, n)
          walkChildren(n.children)
        }
      }
      walkChildren(nodes)
      // Parent links must exist AND be acyclic (cycle → infinite player tree walk).
      const referenced = new Map<string, ObjectNode>()
      const noteParent = (list: readonly ObjectNode[]): void => {
        for (const n of list) {
          if (n.parentId) referenced.set(n.parentId, n)
          noteParent(n.children)
        }
      }
      noteParent(nodes)
      for (const [parentId, child] of referenced) {
        if (!ids.has(parentId)) {
          ctx.addIssue({
            code: z.ZodIssueCode.custom,
            message: `node ${child.id} references unknown parent ${parentId}`
          })
          continue
        }
        // Ancestry walk from parent up — if we reach the child itself, it's a cycle.
        let cursor: ObjectNode | undefined = ids.get(parentId)
        const seen = new Set<string>()
        while (cursor && cursor.parentId) {
          if (cursor.id === child.id || seen.has(cursor.id)) {
            ctx.addIssue({
              code: z.ZodIssueCode.custom,
              message: `cycle detected involving node ${child.id}`
            })
            break
          }
          seen.add(cursor.id)
          cursor = ids.get(cursor.parentId)
        }
      }
    })
    .optional(),
  geometry2D: z.array(geometry2DPrimitiveSchema).max(2000).optional(),
  geometry3D: z.array(geometry3DPrimitiveSchema).max(1000).optional(),
  materials: z.array(materialSchema).max(500).optional(),
  skeletons: z.array(skeletonSchema).max(50).optional(),
  particles: z.array(particleEmitterSchema).max(50).optional(),
  timeline: timelineSchema.optional(),
  interactions: z.array(interactionSchema).max(100).optional(),
  mediaRefs: z.array(mediaRefSchema).max(200).optional(),
  fontsAndFormulas: fontsAndFormulasSchema.optional(),
  editorMetadata: editorMetadataSchema.optional()
})
  .strict()
export type SceneDocument = z.infer<typeof sceneDocumentSchema>

/**
 * Parse + validate unknown input as a SceneDocument. Throws ZodError on bad
 * input — the trust gate every store/render path must route through (§4.4).
 * Also enforces the version floor: a doc older than N-2 or newer than the
 * player is refused here so callers cannot bypass sceneMigrations.
 */
export function parseSceneDocument(raw: unknown): SceneDocument {
  const doc = sceneDocumentSchema.parse(raw)
  const version = doc.documentMeta.sceneFormatVersion
  if (!isVersionSupported(version)) {
    throw new Error(
      `sceneFormatVersion ${version} is older than N-2 floor ${MIN_SUPPORTED_VERSION}; refusing (downgrade to static)`
    )
  }
  if (compareVersions(version, SCENE_FORMAT_VERSION) > 0) {
    throw new Error(
      `sceneFormatVersion ${version} is newer than player ${SCENE_FORMAT_VERSION}; refusing`
    )
  }
  return doc
}

/**
 * Safe parse variant for read-time tolerance (§4.4): illegal snapshots are
 * silently dropped or downgraded to a static alternative + advisory, never
 * crash the player. Callers branch on .success.
 */
export function safeParseSceneDocument(raw: unknown):
  | { success: true; document: SceneDocument }
  | { success: false; error: string; issues: string[] } {
  const result = sceneDocumentSchema.safeParse(raw)
  if (result.success) return { success: true, document: result.data }
  return {
    success: false,
    error: 'scene document failed validation',
    issues: result.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`)
  }
}