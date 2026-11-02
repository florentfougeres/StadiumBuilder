import React, { useEffect, useRef, useState } from 'react';
import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { TransformControls } from 'three/addons/controls/TransformControls.js';
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js';
import { registerViewportCaptureHandler } from '../export/exportPng';
import { buildStadiumSceneGraph, disposeObject3D } from '../stadium/buildStadiumScene';
import { calculateStandMetrics, getTrackRadialOffset } from '../stadium/capacity';
import { CameraPresetMode, LightingMode, StadiumDocument } from '../stadium/schema';
import { computeStandSightlines } from '../stadium/sightlines';
import { useStadiumStore } from '../state/useStadiumStore';

const _targetPos = new THREE.Vector3();
const _targetLook = new THREE.Vector3();

function createAtmosphericSkyTexture(mode: LightingMode): THREE.CanvasTexture {
  const canvas = document.createElement('canvas');
  canvas.width = 1024;
  canvas.height = 512;
  const ctx = canvas.getContext('2d')!;

  const grad = ctx.createLinearGradient(0, 0, 0, 512);
  if (mode === 'day') {
    grad.addColorStop(0.0, '#1e3a8a');
    grad.addColorStop(0.22, '#0369a1');
    grad.addColorStop(0.42, '#7dd3fc');
    grad.addColorStop(0.495, '#f8fafc');
    // Ground & pitch bounce hemisphere for realistic outdoor architectural IBL
    grad.addColorStop(0.515, '#94a3b8');
    grad.addColorStop(0.68, '#334155');
    grad.addColorStop(1.0, '#0f172a');
  } else if (mode === 'dusk') {
    grad.addColorStop(0.0, '#090d16');
    grad.addColorStop(0.24, '#1e1b4b');
    grad.addColorStop(0.41, '#831843');
    grad.addColorStop(0.485, '#f97316');
    grad.addColorStop(0.508, '#fef08a');
    grad.addColorStop(0.535, '#27272a');
    grad.addColorStop(1.0, '#090d16');
  } else {
    grad.addColorStop(0.0, '#020617');
    grad.addColorStop(0.35, '#0b1329');
    grad.addColorStop(0.485, '#1e3a8a');
    grad.addColorStop(0.515, '#172554');
    grad.addColorStop(0.56, '#0f172a');
    grad.addColorStop(1.0, '#020617');
  }
  ctx.fillStyle = grad;
  ctx.fillRect(0, 0, 1024, 512);

  // Layered horizon clouds & sun corona (day / dusk) for crisp glazing & steel speculars
  if (mode !== 'night') {
    for (let c = 0; c < 28; c++) {
      const cx = (c * 157 + 46) % 1024;
      const cy = 128 + ((c * 73) % 108);
      const rx = 85 + ((c * 59) % 140);
      const ry = 10 + ((c * 23) % 18);
      const cGrad = ctx.createRadialGradient(cx, cy, 4, cx, cy, rx);
      cGrad.addColorStop(
        0,
        mode === 'day' ? 'rgba(255, 255, 255, 0.30)' : 'rgba(254, 215, 170, 0.24)'
      );
      cGrad.addColorStop(1, 'rgba(255, 255, 255, 0)');
      ctx.save();
      ctx.translate(cx, cy);
      ctx.scale(1, ry / rx);
      ctx.fillStyle = cGrad;
      ctx.beginPath();
      ctx.arc(0, 0, rx, 0, Math.PI * 2);
      ctx.fill();
      ctx.restore();
    }

    const sunX = 284;
    const sunY = mode === 'day' ? 152 : 242;
    const sunGrad = ctx.createRadialGradient(sunX, sunY, 5, sunX, sunY, 175);
    sunGrad.addColorStop(
      0,
      mode === 'day' ? 'rgba(255, 254, 245, 0.98)' : 'rgba(254, 215, 170, 0.94)'
    );
    sunGrad.addColorStop(
      0.24,
      mode === 'day' ? 'rgba(254, 249, 195, 0.46)' : 'rgba(251, 146, 60, 0.44)'
    );
    sunGrad.addColorStop(1, 'rgba(255, 255, 255, 0)');
    ctx.fillStyle = sunGrad;
    ctx.fillRect(0, 0, 1024, 512);
  } else {
    // Night stadium floodlight sky-glow crown for realistic nocturnal specular reflections
    for (const gx of [256, 768]) {
      const nGrad = ctx.createRadialGradient(gx, 236, 8, gx, 236, 195);
      nGrad.addColorStop(0, 'rgba(224, 242, 254, 0.36)');
      nGrad.addColorStop(1, 'rgba(15, 23, 42, 0)');
      ctx.fillStyle = nGrad;
      ctx.fillRect(0, 0, 1024, 512);
    }
  }

  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.mapping = THREE.EquirectangularReflectionMapping;
  tex.needsUpdate = true;
  return tex;
}

function detectSoftwareGl(): boolean {
  try {
    const probe = document.createElement('canvas').getContext('webgl2');
    if (!probe) return true;
    const ext = probe.getExtension('WEBGL_debug_renderer_info');
    const param = ext ? ext.UNMASKED_RENDERER_WEBGL : probe.RENDERER;
    const gpu = String(probe.getParameter(param));
    probe.getExtension('WEBGL_lose_context')?.loseContext();
    return /SwiftShader|llvmpipe|softpipe|Software|Basic Render/i.test(gpu);
  } catch {
    return false;
  }
}

function computePresetCameraPose(
  mode: CameraPresetMode,
  doc: StadiumDocument
): { position: THREE.Vector3; target: THREE.Vector3; fov: number } {
  const track = getTrackRadialOffset(doc);
  const southMetrics = calculateStandMetrics(doc, 'south');
  const northMetrics = calculateStandMetrics(doc, 'north');

  switch (mode) {
    case 'drone':
      return {
        position: new THREE.Vector3(145, 96, 152),
        target: new THREE.Vector3(0, 6, 0),
        fov: 44,
      };
    case 'touchline':
      return {
        position: new THREE.Vector3(-8, 2.1, doc.pitch.width / 2 + 2.8),
        target: new THREE.Vector3(18, 3.2, -12),
        fov: 54,
      };
    case 'spectator': {
      // Exact spectator sightline eye height across 1..5 tiers
      const stand = doc.stands.north.enabled ? doc.stands.north : doc.stands.south;
      const signZ = doc.stands.north.enabled ? -1 : 1;
      const sight = computeStandSightlines(stand, track.sideOffset);
      const sampleIdx = Math.min(
        sight.points.length - 1,
        Math.max(0, Math.floor(sight.points.length * 0.58))
      );
      const pt = sight.points[sampleIdx];
      const distZ = pt ? doc.pitch.width / 2 + pt.distanceX : doc.pitch.width / 2 + 22;
      const eyeY = pt ? pt.eyeHeightY + 0.15 : 14;
      return {
        position: new THREE.Vector3(-12, eyeY, signZ * distZ),
        target: new THREE.Vector3(4, 1.0, 0),
        fov: 58,
      };
    }
    case 'plan2d':
      return {
        position: new THREE.Vector3(0, 310, 0.2),
        target: new THREE.Vector3(0, 0, 0),
        fov: 36,
      };
    case 'cross_section': {
      const standSpan = Math.max(northMetrics.totalDepth, southMetrics.totalDepth, 24);
      return {
        position: new THREE.Vector3(0, 26, doc.pitch.width / 2 + standSpan + 62),
        target: new THREE.Vector3(0, 11, -18),
        fov: 40,
      };
    }
  }
}

export const Viewport: React.FC = () => {
  const mountRef = useRef<HTMLDivElement | null>(null);
  const [webglLost, setWebglLost] = useState(false);

  const doc = useStadiumStore((s) => s.doc);
  const selectedObjectId = useStadiumStore((s) => s.selectedObjectId);
  const cameraMode = useStadiumStore((s) => s.cameraMode);
  const cameraTriggerNonce = useStadiumStore((s) => s.cameraTriggerNonce);
  const transformMode = useStadiumStore((s) => s.transformMode);

  const selectObject = useStadiumStore((s) => s.selectObject);
  const updateObjectTransform = useStadiumStore((s) => s.updateObjectTransform);
  const recordSnapshotBeforeGizmoDrag = useStadiumStore(
    (s) => s.recordSnapshotBeforeGizmoDrag
  );

  // Store mutable refs so Three.js event listeners never go stale or recreate WebGLRenderer
  const callbacksRef = useRef({
    selectObject,
    updateObjectTransform,
    recordSnapshotBeforeGizmoDrag,
  });
  callbacksRef.current = {
    selectObject,
    updateObjectTransform,
    recordSnapshotBeforeGizmoDrag,
  };

  const engineRef = useRef<{
    renderer: THREE.WebGLRenderer;
    scene: THREE.Scene;
    camera: THREE.PerspectiveCamera;
    orbit: OrbitControls;
    transform: TransformControls;
    keyLight: THREE.DirectionalLight;
    hemiLight: THREE.HemisphereLight;
    rimLight: THREE.DirectionalLight;
    arenaBowlLight: THREE.DirectionalLight;
    skyTextures: Record<LightingMode, THREE.CanvasTexture>;
    envTextures: Record<LightingMode, THREE.Texture>;
    gridHelper: THREE.GridHelper;
    stadiumRoot: THREE.Group | null;
    placedMap: Map<string, THREE.Group>;
    requestRender: () => void;
    startCameraTransition: (pos: THREE.Vector3, look: THREE.Vector3, fov: number) => void;
    maxAnisotropy: number;
  } | null>(null);

  // 1. Initialize WebGLRenderer, Lights, Environment, OrbitControls, TransformControls ONCE
  useEffect(() => {
    const container = mountRef.current;
    if (!container) return;

    const isSoftwareGl = detectSoftwareGl();
    const width = container.clientWidth || window.innerWidth;
    const height = container.clientHeight || window.innerHeight;

    const renderer = new THREE.WebGLRenderer({
      antialias: !isSoftwareGl,
      powerPreference: 'high-performance',
    });
    renderer.outputColorSpace = THREE.SRGBColorSpace;
    renderer.toneMapping = THREE.ACESFilmicToneMapping;
    renderer.toneMappingExposure = 1.06;
    renderer.setPixelRatio(isSoftwareGl ? 1 : Math.min(window.devicePixelRatio, 2));
    renderer.setSize(width, height);
    renderer.shadowMap.enabled = !isSoftwareGl;
    renderer.shadowMap.type = THREE.PCFSoftShadowMap;

    container.appendChild(renderer.domElement);

    const skyTextures: Record<LightingMode, THREE.CanvasTexture> = {
      day: createAtmosphericSkyTexture('day'),
      dusk: createAtmosphericSkyTexture('dusk'),
      night: createAtmosphericSkyTexture('night'),
    };

    const scene = new THREE.Scene();
    scene.background = skyTextures.dusk;
    scene.fog = new THREE.FogExp2(0x0f172a, 0.00085);

    // Outdoor sky-matched PMREM environment maps for photorealistic glazing, steel, zinc & wet turf
    const pmrem = new THREE.PMREMGenerator(renderer);
    pmrem.compileEquirectangularShader();
    const fallbackRoom = new RoomEnvironment();
    const envTextures: Record<LightingMode, THREE.Texture> = isSoftwareGl
      ? {
          day: pmrem.fromScene(fallbackRoom, 0.04).texture,
          dusk: pmrem.fromScene(fallbackRoom, 0.04).texture,
          night: pmrem.fromScene(fallbackRoom, 0.04).texture,
        }
      : {
          day: pmrem.fromEquirectangular(skyTextures.day).texture,
          dusk: pmrem.fromEquirectangular(skyTextures.dusk).texture,
          night: pmrem.fromEquirectangular(skyTextures.night).texture,
        };
    fallbackRoom.dispose();
    pmrem.dispose();
    scene.environment = envTextures.dusk;

    const camera = new THREE.PerspectiveCamera(44, width / height, 0.5, 1800);
    camera.position.set(145, 96, 152);

    // Architectural + Broadcast Match Lighting Rig
    const hemiLight = new THREE.HemisphereLight(0xdbeafe, 0x1e293b, 0.85);
    scene.add(hemiLight);

    const keyLight = new THREE.DirectionalLight(0xfffbeb, 2.45);
    keyLight.position.set(115, 152, 92);
    keyLight.castShadow = !isSoftwareGl;
    keyLight.shadow.mapSize.set(2048, 2048);
    keyLight.shadow.camera.left = -142;
    keyLight.shadow.camera.right = 142;
    keyLight.shadow.camera.top = 142;
    keyLight.shadow.camera.bottom = -142;
    keyLight.shadow.camera.near = 14;
    keyLight.shadow.camera.far = 410;
    keyLight.shadow.radius = 2.2;
    keyLight.shadow.bias = -0.00025;
    keyLight.shadow.normalBias = 0.015;
    scene.add(keyLight);

    const rimLight = new THREE.DirectionalLight(0x93c5fd, 0.75);
    rimLight.position.set(-125, 85, -115);
    scene.add(rimLight);

    // Dedicated stadium match floodlight fill illuminating the pitch & lower bowl at dusk/night
    const arenaBowlLight = new THREE.DirectionalLight(0xf8fafc, 1.4);
    arenaBowlLight.position.set(10, 130, 15);
    scene.add(arenaBowlLight);

    // Ultra-subtle CAD grid shown ONLY in Plan 2D / Coupe 3D modes
    const gridHelper = new THREE.GridHelper(480, 48, 0x334155, 0x1e293b);
    gridHelper.position.y = 0.01;
    gridHelper.visible = false;
    scene.add(gridHelper);

    const orbit = new OrbitControls(camera, renderer.domElement);
    orbit.enableDamping = !isSoftwareGl;
    orbit.dampingFactor = 0.07;
    orbit.maxPolarAngle = Math.PI * 0.492;
    orbit.minDistance = 8;
    orbit.maxDistance = 540;
    orbit.target.set(0, 6, 0);

    const transform = new TransformControls(camera, renderer.domElement);
    transform.setSize(0.85);
    const transformHelper = transform.getHelper();
    scene.add(transformHelper);

    // Camera transition state
    let transitionActive = false;
    let targetFov = 44;
    let lastTime = performance.now();

    // Coalesced On-Demand Rendering + Software WebGL Fence Pacing
    let frameId = 0;
    let renderBusy = false;
    let renderDirty = false;

    function afterDraw(cb: () => void) {
      const gl = renderer.getContext() as WebGL2RenderingContext;
      if (gl && typeof gl.fenceSync === 'function') {
        const sync = gl.fenceSync(gl.SYNC_GPU_COMMANDS_COMPLETE, 0);
        gl.flush();
        const poll = () => {
          const state = sync && gl.getSyncParameter(sync, gl.SYNC_STATUS);
          if (state === gl.UNSIGNALED) {
            frameId = window.setTimeout(poll, 5);
          } else {
            if (sync) gl.deleteSync(sync);
            frameId = window.setTimeout(cb, 80);
          }
        };
        frameId = window.setTimeout(poll, 5);
      } else {
        frameId = window.setTimeout(cb, 80);
      }
    }

    function requestRender() {
      if (renderBusy) {
        renderDirty = true;
        return;
      }
      renderBusy = true;
      frameId = requestAnimationFrame((now) => {
        renderDirty = false;
        const dt = Math.min(0.08, Math.max(0.001, (now - lastTime) / 1000));
        lastTime = now;

        let needsMoreFrames = false;

        if (transitionActive) {
          const alpha = 1 - Math.exp(-7.5 * dt);
          camera.position.lerp(_targetPos, alpha);
          orbit.target.lerp(_targetLook, alpha);
          camera.fov = THREE.MathUtils.lerp(camera.fov, targetFov, alpha);
          camera.updateProjectionMatrix();

          if (
            camera.position.distanceTo(_targetPos) < 0.25 &&
            orbit.target.distanceTo(_targetLook) < 0.2 &&
            Math.abs(camera.fov - targetFov) < 0.15
          ) {
            camera.position.copy(_targetPos);
            orbit.target.copy(_targetLook);
            camera.fov = targetFov;
            camera.updateProjectionMatrix();
            transitionActive = false;
          } else {
            needsMoreFrames = true;
          }
        }

        if (orbit.enableDamping && orbit.update()) {
          needsMoreFrames = true;
        } else if (!orbit.enableDamping) {
          orbit.update();
        }

        renderer.render(scene, camera);

        const done = () => {
          renderBusy = false;
          if (renderDirty || needsMoreFrames) {
            requestRender();
          }
        };

        if (isSoftwareGl) afterDraw(done);
        else done();
      });
    }

    function startCameraTransition(pos: THREE.Vector3, look: THREE.Vector3, fov: number) {
      _targetPos.copy(pos);
      _targetLook.copy(look);
      targetFov = fov;
      transitionActive = true;
      lastTime = performance.now();
      requestRender();
    }

    orbit.addEventListener('start', () => {
      transitionActive = false;
    });
    orbit.addEventListener('change', () => {
      requestRender();
    });

    // TransformControls interaction & sync back to Zustand document
    let isDraggingGizmo = false;
    transform.addEventListener('dragging-changed', (event) => {
      const dragging = Boolean(event.value);
      isDraggingGizmo = dragging;
      orbit.enabled = !dragging;
      if (dragging) {
        callbacksRef.current.recordSnapshotBeforeGizmoDrag();
      } else if (transform.object) {
        const obj3d = transform.object;
        const id = obj3d.userData?.placedObjectId as string | undefined;
        if (id) {
          // Keep grounded objects >= 0 on Y
          const clampedY = Math.max(0, Number(obj3d.position.y.toFixed(2)));
          obj3d.position.y = clampedY;
          callbacksRef.current.updateObjectTransform(
            id,
            {
              position: [
                Number(obj3d.position.x.toFixed(2)),
                clampedY,
                Number(obj3d.position.z.toFixed(2)),
              ],
              rotation: [
                Number(obj3d.rotation.x.toFixed(3)),
                Number(obj3d.rotation.y.toFixed(3)),
                Number(obj3d.rotation.z.toFixed(3)),
              ],
              scale: [
                Math.max(0.2, Number(obj3d.scale.x.toFixed(2))),
                Math.max(0.2, Number(obj3d.scale.y.toFixed(2))),
                Math.max(0.2, Number(obj3d.scale.z.toFixed(2))),
              ],
            },
            false
          );
        }
      }
      requestRender();
    });

    transform.addEventListener('change', () => {
      requestRender();
    });

    // Raycasting click selection for placed objects
    const raycaster = new THREE.Raycaster();
    const pointerDownPos = new THREE.Vector2();
    const ndc = new THREE.Vector2();

    const onPointerDown = (e: PointerEvent) => {
      pointerDownPos.set(e.clientX, e.clientY);
    };

    const onPointerUp = (e: PointerEvent) => {
      if (isDraggingGizmo) return;
      if (Math.hypot(e.clientX - pointerDownPos.x, e.clientY - pointerDownPos.y) > 5) {
        return; // Orbit drag, not a selection click
      }

      const rect = renderer.domElement.getBoundingClientRect();
      ndc.x = ((e.clientX - rect.left) / rect.width) * 2 - 1;
      ndc.y = -((e.clientY - rect.top) / rect.height) * 2 + 1;

      raycaster.setFromCamera(ndc, camera);
      const currentEngine = engineRef.current;
      if (!currentEngine) return;

      const candidateGroups = Array.from(currentEngine.placedMap.values());
      const hits = raycaster.intersectObjects(candidateGroups, true);
      if (hits.length > 0) {
        let cur: THREE.Object3D | null = hits[0].object;
        while (cur && !cur.userData?.placedObjectId) {
          cur = cur.parent;
        }
        if (cur?.userData?.placedObjectId) {
          callbacksRef.current.selectObject(cur.userData.placedObjectId as string);
          return;
        }
      }
      callbacksRef.current.selectObject(null);
    };

    renderer.domElement.addEventListener('pointerdown', onPointerDown);
    renderer.domElement.addEventListener('pointerup', onPointerUp);

    // WebGL Context Loss Safety
    const handleContextLost = (e: Event) => {
      e.preventDefault();
      setWebglLost(true);
    };
    const handleContextRestored = () => {
      setWebglLost(false);
      requestRender();
    };
    renderer.domElement.addEventListener('webglcontextlost', handleContextLost);
    renderer.domElement.addEventListener('webglcontextrestored', handleContextRestored);

    // Responsive ResizeObserver
    const resizeObserver = new ResizeObserver((entries) => {
      for (const entry of entries) {
        const w = Math.max(1, entry.contentRect.width);
        const h = Math.max(1, entry.contentRect.height);
        camera.aspect = w / h;
        camera.updateProjectionMatrix();
        renderer.setSize(w, h);
        requestRender();
      }
    });
    resizeObserver.observe(container);

    // Register synchronous PNG screenshot capture handler
    registerViewportCaptureHandler(() => {
      transformHelper.visible = false;
      renderer.render(scene, camera);
      const dataUrl = renderer.domElement.toDataURL('image/png');
      transformHelper.visible = Boolean(transform.object);
      requestRender();
      return dataUrl;
    });

    engineRef.current = {
      renderer,
      scene,
      camera,
      orbit,
      transform,
      keyLight,
      hemiLight,
      rimLight,
      arenaBowlLight,
      skyTextures,
      envTextures,
      gridHelper,
      stadiumRoot: null,
      placedMap: new Map(),
      requestRender,
      startCameraTransition,
      maxAnisotropy: renderer.capabilities.getMaxAnisotropy(),
    };

    if (!isSoftwareGl) {
      renderer.compile(scene, camera);
    }
    requestRender();

    return () => {
      registerViewportCaptureHandler(null);
      resizeObserver.disconnect();
      cancelAnimationFrame(frameId);
      clearTimeout(frameId);
      renderer.domElement.removeEventListener('pointerdown', onPointerDown);
      renderer.domElement.removeEventListener('pointerup', onPointerUp);
      renderer.domElement.removeEventListener('webglcontextlost', handleContextLost);
      renderer.domElement.removeEventListener('webglcontextrestored', handleContextRestored);
      transform.detach();
      transform.dispose();
      orbit.dispose();
      skyTextures.day.dispose();
      skyTextures.dusk.dispose();
      skyTextures.night.dispose();
      envTextures.day.dispose();
      envTextures.dusk.dispose();
      envTextures.night.dispose();
      if (engineRef.current?.stadiumRoot) {
        disposeObject3D(engineRef.current.stadiumRoot);
      }
      renderer.dispose();
      if (renderer.domElement.parentNode === container) {
        container.removeChild(renderer.domElement);
      }
      engineRef.current = null;
    };
  }, []);

  // 2. Rebuild procedural stadium geometry cleanly whenever StadiumDocument, selection, or cross-section mode changes
  useEffect(() => {
    const engine = engineRef.current;
    if (!engine) return;

    engine.transform.detach();

    if (engine.stadiumRoot) {
      engine.scene.remove(engine.stadiumRoot);
      disposeObject3D(engine.stadiumRoot);
      engine.stadiumRoot = null;
    }

    // Update sky dome, outdoor PBR environment reflections, atmospheric haze, and stadium match floodlights
    const applyAtmosphere = (mode: LightingMode) => {
      engine.scene.background = engine.skyTextures[mode];
      engine.scene.environment = engine.envTextures[mode];
      engine.gridHelper.visible = cameraMode === 'plan2d' || cameraMode === 'cross_section';
      engine.gridHelper.material.opacity = 0.14;
      engine.gridHelper.material.transparent = true;

      if (mode === 'day') {
        engine.scene.environmentIntensity = 1.05;
        engine.scene.fog = new THREE.FogExp2(0xcbd5e1, 0.00068);
        engine.keyLight.color.setHex(0xfffbeb);
        engine.keyLight.intensity = 2.45;
        engine.hemiLight.color.setHex(0xe0f2fe);
        engine.hemiLight.groundColor.setHex(0x334155);
        engine.hemiLight.intensity = 0.92;
        engine.rimLight.intensity = 0.55;
        engine.arenaBowlLight.intensity = 0.28;
      } else if (mode === 'dusk') {
        engine.scene.environmentIntensity = 0.92;
        engine.scene.fog = new THREE.FogExp2(0x1e1b4b, 0.00088);
        engine.keyLight.color.setHex(0xfdba74);
        engine.keyLight.intensity = 1.78;
        engine.hemiLight.color.setHex(0x818cf8);
        engine.hemiLight.groundColor.setHex(0x0f172a);
        engine.hemiLight.intensity = 0.62;
        engine.rimLight.intensity = 0.85;
        engine.arenaBowlLight.color.setHex(0xf8fafc);
        engine.arenaBowlLight.intensity = 1.45;
      } else {
        engine.scene.environmentIntensity = 0.85;
        engine.scene.fog = new THREE.FogExp2(0x090f1d, 0.00095);
        engine.keyLight.color.setHex(0xcbd5e1);
        engine.keyLight.intensity = 0.92;
        engine.hemiLight.color.setHex(0x38bdf8);
        engine.hemiLight.groundColor.setHex(0x020617);
        engine.hemiLight.intensity = 0.45;
        engine.rimLight.intensity = 0.95;
        engine.arenaBowlLight.color.setHex(0xf8fafc);
        engine.arenaBowlLight.intensity = 2.35;
      }
    };

    applyAtmosphere(doc.lighting);

    const { rootGroup, placedObjectMap } = buildStadiumSceneGraph(doc, {
      selectedObjectId,
      crossSectionClip: cameraMode === 'cross_section',
      maxAnisotropy: engine.maxAnisotropy,
    });

    engine.scene.add(rootGroup);
    engine.stadiumRoot = rootGroup;
    engine.placedMap = placedObjectMap;

    if (selectedObjectId && placedObjectMap.has(selectedObjectId)) {
      const targetGroup = placedObjectMap.get(selectedObjectId)!;
      engine.transform.attach(targetGroup);
      engine.transform.setMode(transformMode);
    }

    engine.requestRender();
  }, [doc, selectedObjectId, cameraMode, transformMode]);

  // 3. Update TransformControls mode immediately when user toggles G / R / S
  useEffect(() => {
    const engine = engineRef.current;
    if (!engine) return;
    engine.transform.setMode(transformMode);
    engine.requestRender();
  }, [transformMode]);

  // 4. Smoothly damp camera when user selects a CameraPresetMode
  useEffect(() => {
    const engine = engineRef.current;
    if (!engine) return;
    const pose = computePresetCameraPose(cameraMode, doc);
    engine.startCameraTransition(pose.position, pose.target, pose.fov);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [cameraMode, cameraTriggerNonce]);

  return (
    <div className="relative w-full h-full select-none overflow-hidden bg-slate-950">
      <div ref={mountRef} className="w-full h-full" />
      {webglLost && (
        <div className="absolute inset-0 flex items-center justify-center bg-slate-950/95 text-slate-200 p-6 text-center z-30">
          <div className="max-w-md space-y-2">
            <p className="text-base font-semibold">Contexte WebGL suspendu</p>
            <p className="text-xs text-slate-400">
              Restauration automatique du moteur 3D StadiumForge en cours…
            </p>
          </div>
        </div>
      )}
    </div>
  );
};
