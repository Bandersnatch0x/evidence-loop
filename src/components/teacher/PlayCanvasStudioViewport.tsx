import { useCallback, useEffect, useRef, useState } from 'react'
import type * as PlayCanvas from 'playcanvas'
import type { Application, ContainerResource, Entity } from 'playcanvas'
import type { Geometry3DPrimitive, ObjectNode, SceneDocument } from '../../../server/demonstration/sceneDocumentSchema'
import { getRenderable3DNodes } from './viewportModel'

interface PlayCanvasStudioViewportProps {
  document: SceneDocument
  selectedNodeId: string | null
}

type PlayCanvasModule = typeof PlayCanvas

const VIEWPORT_HEIGHT = 420
const RAD_TO_DEG = 180 / Math.PI

function walkNodes(nodes: readonly ObjectNode[], visit: (node: ObjectNode) => void): void {
  for (const node of nodes) {
    visit(node)
    walkNodes(node.children, visit)
  }
}

function applyTransform(entity: Entity, node: ObjectNode): void {
  const { position, rotation, scale } = node.transform
  entity.setLocalPosition(position[0], position[1], position[2])
  entity.setLocalEulerAngles(rotation[0] * RAD_TO_DEG, rotation[1] * RAD_TO_DEG, rotation[2] * RAD_TO_DEG)
  entity.setLocalScale(scale[0], scale[1], scale[2])
  entity.enabled = node.visible
}

function buildPrimitiveEntity(
  pc: PlayCanvasModule,
  app: Application,
  geometry: Exclude<Geometry3DPrimitive, { kind: 'gltf' }>,
  selected: boolean
): Entity {
  const material = new pc.StandardMaterial()
  material.diffuse = selected ? new pc.Color(0.98, 0.66, 0.12) : new pc.Color(0.22, 0.62, 0.86)
  material.metalness = 0.05
  material.gloss = 0.55
  material.update()

  let meshGeo: InstanceType<typeof pc.Mesh> | null = null
  switch (geometry.kind) {
    case 'box': {
      const s = geometry.size
      meshGeo = pc.Mesh.fromGeometry(app.graphicsDevice, new pc.BoxGeometry({ halfExtents: new pc.Vec3(s[0] / 2, s[1] / 2, s[2] / 2) }))
      break
    }
    case 'sphere':
      meshGeo = pc.Mesh.fromGeometry(app.graphicsDevice, new pc.SphereGeometry({ radius: geometry.radius }))
      break
    case 'cylinder':
      meshGeo = pc.Mesh.fromGeometry(app.graphicsDevice, new pc.CylinderGeometry({ height: geometry.height, radius: geometry.radius }))
      break
    case 'cone':
      meshGeo = pc.Mesh.fromGeometry(
        app.graphicsDevice,
        new pc.ConeGeometry({ height: geometry.height, baseRadius: geometry.radius, peakRadius: 0 })
      )
      break
    case 'plane': {
      const s = geometry.size
      meshGeo = pc.Mesh.fromGeometry(app.graphicsDevice, new pc.PlaneGeometry({ halfExtents: new pc.Vec2(s[0] / 2, s[1] / 2) }))
      break
    }
    case 'torus':
      meshGeo = pc.Mesh.fromGeometry(
        app.graphicsDevice,
        new pc.TorusGeometry({ ringRadius: geometry.radius, tubeRadius: geometry.tube, segments: geometry.tubularSegments, sides: geometry.radialSegments })
      )
      break
    case 'ring': {
      const ringRadius = (geometry.innerRadius + geometry.outerRadius) / 2
      const tubeRadius = Math.max(0.001, (geometry.outerRadius - geometry.innerRadius) / 2)
      meshGeo = pc.Mesh.fromGeometry(app.graphicsDevice, new pc.TorusGeometry({ ringRadius, tubeRadius, segments: geometry.thetaSegments, sides: 8 }))
      break
    }
  }
  if (!meshGeo) throw new Error(`unsupported primitive kind ${geometry.kind}`)

  const meshEntity = new pc.Entity(`${geometry.id}-mesh`)
  meshEntity.addComponent('render', { meshInstances: [new pc.MeshInstance(meshGeo, material)] })
  return meshEntity
}

export function PlayCanvasStudioViewport({ document, selectedNodeId }: PlayCanvasStudioViewportProps) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null)
  const appRef = useRef<Application | null>(null)
  const pcRef = useRef<PlayCanvasModule | null>(null)
  const cameraRef = useRef<Entity | null>(null)
  const contentRootRef = useRef<Entity | null>(null)
  const sceneRevisionRef = useRef(0)
  const orbitRef = useRef({ yaw: 35, pitch: 20, distance: 8 })
  const dragRef = useRef<{ x: number; y: number } | null>(null)
  const [state, setState] = useState<'loading' | 'ready' | 'unavailable' | 'error'>('loading')
  const [message, setMessage] = useState('正在启动 PlayCanvas…')

  const updateCamera = useCallback(() => {
    const camera = cameraRef.current
    if (!camera) return
    const { yaw, pitch, distance } = orbitRef.current
    const yawRad = yaw / RAD_TO_DEG
    const pitchRad = pitch / RAD_TO_DEG
    const horizontal = distance * Math.cos(pitchRad)
    camera.setPosition(
      horizontal * Math.sin(yawRad),
      distance * Math.sin(pitchRad),
      horizontal * Math.cos(yawRad)
    )
    camera.lookAt(0, 0, 0)
  }, [])

  useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas) return
    if (typeof WebGL2RenderingContext === 'undefined') {
      setState('unavailable')
      setMessage('当前浏览器未提供 WebGL2，3D 视口已停用')
      return
    }
    const probe = window.document.createElement('canvas')
    const context = probe.getContext('webgl2')
    if (!context) {
      setState('unavailable')
      setMessage('当前浏览器未提供 WebGL2，3D 视口已停用')
      return
    }

    let disposed = false
    let resizeObserver: ResizeObserver | null = null
    void import('playcanvas')
      .then((pc) => {
        if (disposed) return
        pcRef.current = pc
        const app = new pc.Application(canvas, {
          // antialias:false avoids multisampled framebuffer blit, which fails
          // under SwiftShader/headless WebGL and yields a black frame.
          graphicsDeviceOptions: { antialias: false, alpha: false, depth: true, stencil: false }
        })
        appRef.current = app
        // Stable test surface: E2E asserts the scene graph built from the
        // SceneDocument and that the render loop advances (headless SwiftShader
        // renders black, so pixel assertions are unreliable across engines).
        ;(window as unknown as Record<string, unknown>).__pcApp = app
        app.scene.ambientLight = new pc.Color(0.28, 0.3, 0.34)

        const resize = (): void => {
          const width = Math.max(320, canvas.parentElement?.clientWidth ?? canvas.clientWidth ?? 640)
          const dpr = Math.min(2, window.devicePixelRatio || 1)
          app.setCanvasFillMode(pc.FILLMODE_NONE, width, VIEWPORT_HEIGHT)
          app.setCanvasResolution(pc.RESOLUTION_FIXED, Math.round(width * dpr), Math.round(VIEWPORT_HEIGHT * dpr))
          app.updateCanvasSize()
        }
        resize()

        const camera = new pc.Entity('studio-camera')
        camera.addComponent('camera', { clearColor: new pc.Color(0.055, 0.065, 0.08), farClip: 1000 })
        app.root.addChild(camera)
        cameraRef.current = camera
        updateCamera()

        const keyLight = new pc.Entity('studio-key-light')
        keyLight.addComponent('light', { type: 'directional', intensity: 1.4, castShadows: true })
        keyLight.setEulerAngles(42, 28, 0)
        app.root.addChild(keyLight)

        const fillLight = new pc.Entity('studio-fill-light')
        fillLight.addComponent('light', { type: 'omni', intensity: 0.7, range: 20 })
        fillLight.setPosition(-4, 3, 4)
        app.root.addChild(fillLight)

        const contentRoot = new pc.Entity('studio-scene-content')
        app.root.addChild(contentRoot)
        contentRootRef.current = contentRoot
        app.start()

        if (typeof ResizeObserver !== 'undefined') {
          resizeObserver = new ResizeObserver(resize)
          if (canvas.parentElement) resizeObserver.observe(canvas.parentElement)
        }
        setState('ready')
        setMessage('')
      })
      .catch((error: unknown) => {
        if (disposed) return
        setState('error')
        setMessage(error instanceof Error ? error.message : 'PlayCanvas 启动失败')
      })

    return () => {
      disposed = true
      resizeObserver?.disconnect()
      sceneRevisionRef.current += 1
      appRef.current?.destroy()
      appRef.current = null
      pcRef.current = null
      cameraRef.current = null
      contentRootRef.current = null
    }
  }, [updateCamera])

  useEffect(() => {
    if (state !== 'ready') return
    const app = appRef.current
    const pc = pcRef.current
    const oldRoot = contentRootRef.current
    if (!app || !pc || !oldRoot) return

    const revision = sceneRevisionRef.current + 1
    sceneRevisionRef.current = revision
    oldRoot.destroy()
    const contentRoot = new pc.Entity('studio-scene-content')
    app.root.addChild(contentRoot)
    contentRootRef.current = contentRoot

    const geometries = new Map((document.geometry3D ?? []).map((geometry) => [geometry.id, geometry]))
    const entities = new Map<string, Entity>()
    let built = 0
    walkNodes(document.objectTree ?? [], (node) => {
      const entity = new pc.Entity(node.name ?? node.id)
      applyTransform(entity, node)
      entities.set(node.id, entity)
      const parent = node.parentId ? entities.get(node.parentId) : undefined
      ;(parent ?? contentRoot).addChild(entity)

      const geometry = node.meshRef ? geometries.get(node.meshRef) : undefined
      if (!geometry) return
      if (geometry.kind !== 'gltf') {
        entity.addChild(buildPrimitiveEntity(pc, app, geometry, node.id === selectedNodeId))
        built += 1
        return
      }
      const assetUrl = `/api/media/blobs/${geometry.assetHash}`
      app.assets.loadFromUrl(assetUrl, 'container', (error, asset) => {
        if (sceneRevisionRef.current !== revision) return
        if (error || !asset?.resource) {
          setMessage(`glTF 加载失败：${node.name ?? node.id}`)
          return
        }
        const resource = asset.resource as ContainerResource
        const model = resource.instantiateRenderEntity({ castShadows: true })
        entity.addChild(model)
      })
    })
    // Stable test surface — E2E validates that the SceneDocument was mapped
    // into renderable entities (see __pcApp above).
    ;(window as unknown as Record<string, unknown>).__pcDebug = { built, state: 'ready', entities: entities.size, revision }
  }, [document, selectedNodeId, state])

  const resetCamera = (): void => {
    orbitRef.current = { yaw: 35, pitch: 20, distance: 8 }
    updateCamera()
  }

  const renderableCount = getRenderable3DNodes(document).length

  return (
    <div
      aria-label="PlayCanvas 3D 创作视口"
      style={{ position: 'relative', width: '100%', height: VIEWPORT_HEIGHT, overflow: 'hidden', background: '#0e1116' }}
    >
      <canvas
        ref={canvasRef}
        aria-label="PlayCanvas 场景画布"
        style={{ display: 'block', width: '100%', height: VIEWPORT_HEIGHT, touchAction: 'none' }}
        onPointerDown={(event) => {
          dragRef.current = { x: event.clientX, y: event.clientY }
          event.currentTarget.setPointerCapture(event.pointerId)
        }}
        onPointerMove={(event) => {
          if (!dragRef.current) return
          orbitRef.current.yaw -= (event.clientX - dragRef.current.x) * 0.35
          orbitRef.current.pitch = Math.max(-80, Math.min(80, orbitRef.current.pitch + (event.clientY - dragRef.current.y) * 0.35))
          dragRef.current = { x: event.clientX, y: event.clientY }
          updateCamera()
        }}
        onPointerUp={() => { dragRef.current = null }}
        onPointerCancel={() => { dragRef.current = null }}
        onWheel={(event) => {
          event.preventDefault()
          orbitRef.current.distance = Math.max(1.5, Math.min(50, orbitRef.current.distance * Math.exp(event.deltaY * 0.001)))
          updateCamera()
        }}
      />
      <div style={{ position: 'absolute', top: 8, right: 8, display: 'flex', gap: 6 }}>
        <button type="button" className="studio-btn" onClick={resetCamera} title="重置 3D 相机">
          重置视角
        </button>
      </div>
      {state !== 'ready' || renderableCount === 0 || message ? (
        <div
          role={state === 'error' ? 'alert' : 'status'}
          style={{ position: 'absolute', left: 12, bottom: 12, color: '#e7edf5', background: 'rgba(14,17,22,0.82)', padding: '6px 8px' }}
        >
          {message || (renderableCount === 0 ? '场景暂无 3D 对象' : '')}
        </div>
      ) : null}
    </div>
  )
}

export default PlayCanvasStudioViewport
