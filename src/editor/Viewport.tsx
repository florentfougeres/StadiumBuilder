import React, { useEffect, useRef, useState } from 'react';
import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { TransformControls } from 'three/addons/controls/TransformControls.js';
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js';
import { registerGlbCameraHandler } from '../export/exportGlb';
import { registerPathTraceHandler, registerViewportCaptureHandler } from '../export/exportPng';
import { createRenderPipeline, createSkyEnvironments, getSunDirection } from './renderPipeline';
import { buildStadiumSceneGraph, disposeObject3D } from '../stadium/buildStadiumScene';
import { generatePlacedObjectGroup, setSelectionHighlight } from '../stadium/generateLights';
import { calculateStandMetrics, getTrackRadialOffset } from '../stadium/capacity';
import {
  CameraPresetMode,
  LightingMode,
  resolveFloodlightRig,
  resolveRetractable,
  StadiumDocument,
} from '../stadium/schema';
import { computeStandSightlines } from '../stadium/sightlines';
import { useStadiumStore } from '../state/useStadiumStore';
import { CircleHelp, House } from 'lucide-react';
import { IconButton } from './ui';

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

const NAV_HELP_POINTER: [string, string][] = [
  ['Glisser', 'tourner autour du point visé'],
  ['Alt + glisser', 'regarder autour, sans bouger'],
  ['Clic droit / Maj + glisser', 'faire glisser la vue'],
  ['Molette, pincement', 'avancer vers le curseur'],
  ['Deux doigts', 'se déplacer au-dessus du sol'],
  ['Double-clic', 'centrer sur un point'],
];
const NAV_HELP_KEYS: [string, string][] = [
  ['Z Q S D, flèches', 'avancer, gauche, reculer, droite'],
  ['E / A', 'monter / descendre (aussi Page ↑ / ↓)'],
  ['Maj', 'aller plus vite'],
];

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
      // Standing eye height, so the 3D seat backs of the rows ahead stay below the view.
      const eyeY = pt ? pt.eyeHeightY + 0.75 : 14;
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
  const altitudeRef = useRef<HTMLSpanElement | null>(null);
  const compassRef = useRef<HTMLDivElement | null>(null);
  const [webglLost, setWebglLost] = useState(false);
  /** Set when the last document could not be built; the previous stadium stays on screen. */
  const [buildFailed, setBuildFailed] = useState(false);
  const [helpOpen, setHelpOpen] = useState(false);
  const setCameraMode = useStadiumStore((s) => s.setCameraMode);

  const doc = useStadiumStore((s) => s.doc);
  const selectedObjectId = useStadiumStore((s) => s.selectedObjectId);
  const cameraMode = useStadiumStore((s) => s.cameraMode);
  const cameraTriggerNonce = useStadiumStore((s) => s.cameraTriggerNonce);
  const transformMode = useStadiumStore((s) => s.transformMode);

  const selectObject = useStadiumStore((s) => s.selectObject);
  const placingType = useStadiumStore((s) => s.placingType);
  const roofMotion = useStadiumStore((s) => s.roofMotion);
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
    skyEnv: ReturnType<typeof createSkyEnvironments> | null;
    pipeline: ReturnType<typeof createRenderPipeline> | null;
    gridHelper: THREE.GridHelper;
    stadiumRoot: THREE.Group | null;
    placedMap: Map<string, THREE.Group>;
    requestRender: () => void;
    /** Flags the next frames as motion frames (cheaper pipeline, full quality once settled). */
    markMotion: () => void;
    /** Preview of the equipment being placed, following the cursor on the ground. */
    ghost: THREE.Group | null;
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

    // No canvas MSAA: the post-processing pipeline renders into its own 4x multisampled target and
    // only blits a full-screen quad to the canvas, so a multisampled canvas would be pure overhead.
    const renderer = new THREE.WebGLRenderer({
      antialias: false,
      powerPreference: 'high-performance',
    });
    renderer.outputColorSpace = THREE.SRGBColorSpace;
    renderer.toneMapping = THREE.ACESFilmicToneMapping;
    renderer.toneMappingExposure = 1.06;
    // Partial bowl roofs are clipped per stand sector (see clipRoofToSides).
    renderer.localClippingEnabled = true;
    // Above 1.5 the 4x MSAA target already resolves edges; the extra pixels mostly cost GPU heat.
    renderer.setPixelRatio(isSoftwareGl ? 1 : Math.min(window.devicePixelRatio, 1.5));
    renderer.setSize(width, height);
    renderer.shadowMap.enabled = !isSoftwareGl;
    renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    // The sun's shadow camera is fixed and the stadium only changes on rebuilds or gizmo drags, so
    // the shadow map is redrawn then (shadowMap.needsUpdate) instead of on every orbit frame.
    renderer.shadowMap.autoUpdate = false;

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
    const skyEnv = isSoftwareGl ? null : createSkyEnvironments(renderer, skyTextures.night);
    const envTextures: Record<LightingMode, THREE.Texture> = skyEnv
      ? skyEnv.environments
      : {
          day: pmrem.fromScene(fallbackRoom, 0.04).texture,
          dusk: pmrem.fromScene(fallbackRoom, 0.04).texture,
          night: pmrem.fromScene(fallbackRoom, 0.04).texture,
        };
    fallbackRoom.dispose();
    pmrem.dispose();
    scene.environment = envTextures.dusk;
    if (skyEnv) scene.add(skyEnv.sky);

    const camera = new THREE.PerspectiveCamera(44, width / height, 0.5, 1800);
    camera.position.set(145, 96, 152);

    // Architectural + Broadcast Match Lighting Rig
    const hemiLight = new THREE.HemisphereLight(0xdbeafe, 0x1e293b, 0.85);
    scene.add(hemiLight);

    const keyLight = new THREE.DirectionalLight(0xfffbeb, 2.45);
    keyLight.position.set(115, 152, 92);
    keyLight.castShadow = !isSoftwareGl;
    keyLight.shadow.mapSize.set(4096, 4096);
    // Covers the bowl and its forecourt; 4096 texels over 380 m keeps roof ribs crisp.
    keyLight.shadow.camera.left = -190;
    keyLight.shadow.camera.right = 190;
    keyLight.shadow.camera.top = 190;
    keyLight.shadow.camera.bottom = -190;
    keyLight.shadow.camera.near = 20;
    keyLight.shadow.camera.far = 620;
    keyLight.shadow.radius = 1.75;
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

    const pipeline = isSoftwareGl
      ? null
      : createRenderPipeline(renderer, scene, camera, width, height);

    const orbit = new OrbitControls(camera, renderer.domElement);
    orbit.enableDamping = !isSoftwareGl;
    orbit.dampingFactor = 0.07;
    orbit.maxPolarAngle = Math.PI * 0.492;
    orbit.minDistance = 1;
    orbit.maxDistance = 540;
    orbit.target.set(0, 6, 0);
    // The wheel is handled below: it flies toward the surface under the cursor instead of the orbit
    // target, so it never stalls at the target and the pivot follows what is being looked at.
    orbit.enableZoom = false;

    // Keyboard flight, by physical key (`KeyboardEvent.code`) so it is the same on AZERTY and QWERTY:
    // arrows or ZQSD / WASD glide across the ground, E / A (E / Q on QWERTY) and Page Up / Down change
    // altitude, Shift speeds up. S belongs to the scale tool while an object is selected.
    const flightKeys = new Set<string>();
    const FLIGHT_MOVES: Record<string, 'forward' | 'back' | 'left' | 'right' | 'up' | 'down'> = {
      ArrowUp: 'forward',
      KeyW: 'forward',
      ArrowDown: 'back',
      KeyS: 'back',
      ArrowLeft: 'left',
      KeyA: 'left',
      ArrowRight: 'right',
      KeyD: 'right',
      PageUp: 'up',
      KeyE: 'up',
      PageDown: 'down',
      KeyQ: 'down',
    };
    const flightHas = (move: string) => {
      for (const code of flightKeys) if (FLIGHT_MOVES[code] === move) return true;
      return false;
    };
    let flightFast = false;
    const _flightForward = new THREE.Vector3();
    const _flightRight = new THREE.Vector3();
    const _flightStep = new THREE.Vector3();

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
    // While a path-traced still renders, the tracer owns the canvas.
    let pathTracing = false;
    // Camera motion renders cheap frames; one full-quality frame follows once motion settles.
    const SETTLE_MS = 150;
    let lastMotion = -Infinity;
    let settleTimer = 0;
    function markMotion() {
      lastMotion = performance.now();
    }

    // Adaptive resolution: when camera motion stays below ~30 fps (integrated GPUs, 4K panels),
    // drop the pixel ratio a step. It only steps down, so the view never oscillates.
    const MIN_PIXEL_RATIO = 0.75;
    const motionFrameTimes: number[] = [];
    function trackMotionFrame(dt: number) {
      motionFrameTimes.push(dt);
      if (motionFrameTimes.length < 12) return;
      const sorted = [...motionFrameTimes].sort((a, b) => a - b);
      motionFrameTimes.length = 0;
      const current = renderer.getPixelRatio();
      if (sorted[6] < 34 || current <= MIN_PIXEL_RATIO) return;
      const next = Math.max(MIN_PIXEL_RATIO, current >= 1.25 ? 1 : current - 0.25);
      const { clientWidth: w, clientHeight: h } = container!;
      renderer.setPixelRatio(next);
      renderer.setSize(w, h);
      pipeline?.setPixelRatio(next, w, h);
    }

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

    /** Altitude and compass read straight from the camera each frame, written to the DOM without React. */
    const _hudDir = new THREE.Vector3();
    let hudAltitude = '';
    let hudHeading = NaN;
    function updateHud() {
      const altitude = `${Math.max(0, Math.round(camera.position.y))} m`;
      if (altitude !== hudAltitude && altitudeRef.current) altitudeRef.current.textContent = hudAltitude = altitude;
      camera.getWorldDirection(_hudDir);
      // North is −z (the north stand side); the dial turns so N points where north is on screen.
      const heading = Math.round(THREE.MathUtils.radToDeg(Math.atan2(_hudDir.x, -_hudDir.z)));
      if (heading !== hudHeading && compassRef.current) {
        hudHeading = heading;
        compassRef.current.style.transform = `rotate(${-heading}deg)`;
      }
    }

    function requestRender() {
      if (pathTracing) return;
      if (renderBusy) {
        renderDirty = true;
        return;
      }
      renderBusy = true;
      frameId = requestAnimationFrame((now) => {
        renderDirty = false;
        // Consecutive motion frames measure real throughput; a gap after idle does not.
        if (now - lastMotion < SETTLE_MS && now - lastTime < 250) trackMotionFrame(now - lastTime);
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

        if (flightKeys.size > 0) {
          camera.getWorldDirection(_flightForward);
          _flightForward.y = 0;
          if (_flightForward.lengthSq() < 1e-6) _flightForward.set(0, 0, -1);
          _flightForward.normalize();
          _flightRight.crossVectors(_flightForward, camera.up).normalize();
          // Speed follows the view distance: slow near a stand, fast from high up.
          const speed = Math.max(8, camera.position.distanceTo(orbit.target) * 0.7) * (flightFast ? 3 : 1) * dt;
          _flightStep.set(0, 0, 0);
          if (flightHas('forward')) _flightStep.add(_flightForward);
          if (flightHas('back')) _flightStep.sub(_flightForward);
          if (flightHas('right')) _flightStep.add(_flightRight);
          if (flightHas('left')) _flightStep.sub(_flightRight);
          if (flightHas('up')) _flightStep.y += 1;
          if (flightHas('down')) _flightStep.y -= 1;
          if (_flightStep.lengthSq() > 0) {
            _flightStep.normalize().multiplyScalar(speed);
            // Never below the ground: the target stays at or above grass level.
            if (orbit.target.y + _flightStep.y < 0) _flightStep.y = -orbit.target.y;
            camera.position.add(_flightStep);
            orbit.target.add(_flightStep);
            transitionActive = false;
          }
          needsMoreFrames = true;
        }

        if (orbit.enableDamping && orbit.update()) {
          needsMoreFrames = true;
        } else if (!orbit.enableDamping) {
          orbit.update();
        }

        if (transitionActive || needsMoreFrames) markMotion();
        updateHud();
        const interactive = performance.now() - lastMotion < SETTLE_MS;
        if (pipeline) pipeline.render(interactive);
        else renderer.render(scene, camera);
        if (interactive && pipeline) {
          window.clearTimeout(settleTimer);
          settleTimer = window.setTimeout(requestRender, SETTLE_MS);
        }

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
      markMotion();
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
      if (isDraggingGizmo) {
        renderer.shadowMap.needsUpdate = true;
        markMotion();
      }
      requestRender();
    });

    // Click selection, click-to-place and drag-on-ground for placed objects
    const raycaster = new THREE.Raycaster();
    const pointerDownPos = new THREE.Vector2();
    const ndc = new THREE.Vector2();
    const dragPlane = new THREE.Plane(new THREE.Vector3(0, 1, 0), 0);
    const planeHit = new THREE.Vector3();
    const dragOffset = new THREE.Vector3();
    let surfaceDrag: { id: string; group: THREE.Group; moved: boolean } | null = null;

    const setRay = (e: MouseEvent) => {
      const rect = renderer.domElement.getBoundingClientRect();
      ndc.x = ((e.clientX - rect.left) / rect.width) * 2 - 1;
      ndc.y = -((e.clientY - rect.top) / rect.height) * 2 + 1;
      raycaster.setFromCamera(ndc, camera);
    };
    /** Point under the cursor on the horizontal plane at `y`, or null when looking above it. */
    const groundAt = (e: MouseEvent, y: number): THREE.Vector3 | null => {
      setRay(e);
      dragPlane.constant = -y;
      return raycaster.ray.intersectPlane(dragPlane, planeHit);
    };
    /** Nearest hit actually drawn: hidden ancestors, invisible materials and helpers don't stop the ray. */
    const isDrawn = (o: THREE.Object3D): boolean => {
      for (let cur: THREE.Object3D | null = o; cur; cur = cur.parent) if (!cur.visible) return false;
      const mats = (o as THREE.Mesh).material;
      if (!mats) return false;
      return (Array.isArray(mats) ? mats : [mats]).some((m) => m.visible && m.opacity > 0.02);
    };
    const pickSurface = (e: MouseEvent): THREE.Vector3 | null => {
      const currentEngine = engineRef.current;
      if (!currentEngine) return null;
      setRay(e);
      const targets: THREE.Object3D[] = [...currentEngine.placedMap.values()];
      if (currentEngine.stadiumRoot) targets.push(currentEngine.stadiumRoot);
      return raycaster.intersectObjects(targets, true).find((h) => isDrawn(h.object))?.point ?? null;
    };
    const pickPlaced = (e: PointerEvent): string | null => {
      const currentEngine = engineRef.current;
      if (!currentEngine) return null;
      setRay(e);
      const hits = raycaster.intersectObjects(Array.from(currentEngine.placedMap.values()), true);
      let cur: THREE.Object3D | null = hits[0]?.object ?? null;
      while (cur && !cur.userData?.placedObjectId) cur = cur.parent;
      return (cur?.userData?.placedObjectId as string | undefined) ?? null;
    };
    /** Halo screens hang centred and mounted screens follow their stand: they are not dragged. */
    const isDraggable = (id: string): boolean => {
      const o = useStadiumStore.getState().doc.objects.find((x) => x.id === id);
      return Boolean(o) && o!.type !== 'halo_screen' && !(o!.type === 'screen' && (o!.mount ?? 'free') !== 'free');
    };

    const onPointerDown = (e: PointerEvent) => {
      pointerDownPos.set(e.clientX, e.clientY);
      if (isDraggingGizmo || e.button !== 0 || useStadiumStore.getState().placingType) return;
      const selected = useStadiumStore.getState().selectedObjectId;
      const currentEngine = engineRef.current;
      if (!selected || !currentEngine || pickPlaced(e) !== selected || !isDraggable(selected)) return;
      const group = currentEngine.placedMap.get(selected);
      const hit = group && groundAt(e, group.position.y);
      if (!group || !hit) return;
      dragOffset.copy(group.position).sub(hit);
      surfaceDrag = { id: selected, group, moved: false };
      orbit.enabled = false;
      renderer.domElement.setPointerCapture(e.pointerId);
    };

    const onPointerMove = (e: PointerEvent) => {
      const currentEngine = engineRef.current;
      if (!currentEngine) return;
      if (surfaceDrag) {
        const hit = groundAt(e, surfaceDrag.group.position.y);
        if (!hit) return;
        if (!surfaceDrag.moved) {
          if (Math.hypot(e.clientX - pointerDownPos.x, e.clientY - pointerDownPos.y) < 4) return;
          surfaceDrag.moved = true;
          callbacksRef.current.recordSnapshotBeforeGizmoDrag();
        }
        surfaceDrag.group.position.x = hit.x + dragOffset.x;
        surfaceDrag.group.position.z = hit.z + dragOffset.z;
        renderer.shadowMap.needsUpdate = true;
        markMotion();
        requestRender();
        return;
      }
      const ghost = currentEngine.ghost;
      if (ghost) {
        const hit = groundAt(e, 0);
        ghost.visible = Boolean(hit);
        if (hit) ghost.position.set(hit.x, ghost.position.y, hit.z);
        requestRender();
      }
    };

    const onPointerUp = (e: PointerEvent) => {
      if (surfaceDrag) {
        const { id, group, moved } = surfaceDrag;
        surfaceDrag = null;
        orbit.enabled = true;
        if (renderer.domElement.hasPointerCapture(e.pointerId)) {
          renderer.domElement.releasePointerCapture(e.pointerId);
        }
        if (moved) {
          callbacksRef.current.updateObjectTransform(
            id,
            {
              position: [
                Number(group.position.x.toFixed(2)),
                Number(group.position.y.toFixed(2)),
                Number(group.position.z.toFixed(2)),
              ],
            },
            false
          );
          return;
        }
      }
      if (isDraggingGizmo) return;
      if (Math.hypot(e.clientX - pointerDownPos.x, e.clientY - pointerDownPos.y) > 5) {
        return; // Orbit drag, not a selection click
      }

      const placing = useStadiumStore.getState().placingType;
      if (placing) {
        const hit = groundAt(e, 0);
        if (hit) {
          useStadiumStore
            .getState()
            .addObject(placing, [Number(hit.x.toFixed(1)), Number(hit.z.toFixed(1))]);
        }
        return;
      }

      callbacksRef.current.selectObject(pickPlaced(e));
    };

    /** Double-click: the clicked point becomes the centre of rotation, and the view closes in on it. */
    const _focusOffset = new THREE.Vector3();
    const onDoubleClick = (e: MouseEvent) => {
      const currentEngine = engineRef.current;
      if (!currentEngine?.stadiumRoot || useStadiumStore.getState().placingType) return;
      const point = pickSurface(e) ?? groundAt(e, 0);
      if (!point) return;
      _focusOffset.copy(camera.position).sub(orbit.target);
      const distance = Math.min(_focusOffset.length(), 70);
      _focusOffset.setLength(distance);
      startCameraTransition(point.clone().add(_focusOffset), point.clone(), camera.fov);
    };

    /**
     * Wheel / pinch: fly along the cursor ray toward the surface under it. The step is a share of the
     * distance to that surface, so zooming keeps working right up to a seat row, and the orbit pivot is
     * moved to that surface's depth so rotating afterwards turns around what was zoomed on.
     */
    /**
     * Two-finger trackpad scroll pans across the ground (pinch, sent as ctrl+wheel, still zooms).
     * A mouse wheel sends no sideways delta and its legacy `wheelDeltaY` is not 3× `deltaY`; once a
     * gesture reads as a trackpad it stays one, so its slow tail never turns into zoom steps.
     */
    let trackpadUntil = 0;
    const isTrackpadScroll = (e: WheelEvent, now: number): boolean => {
      if (e.ctrlKey || e.deltaMode !== 0) return false;
      const legacy = (e as WheelEvent & { wheelDeltaY?: number }).wheelDeltaY;
      const trackpad = now < trackpadUntil || e.deltaX !== 0 || (legacy !== undefined && legacy !== 0 && legacy === -3 * e.deltaY);
      if (trackpad) trackpadUntil = now + 250;
      return trackpad;
    };
    const _panForward = new THREE.Vector3();
    const _panRight = new THREE.Vector3();
    const panAcrossGround = (dx: number, dy: number) => {
      camera.getWorldDirection(_panForward);
      _panForward.y = 0;
      if (_panForward.lengthSq() < 1e-6) _panForward.set(0, 0, -1);
      _panForward.normalize();
      _panRight.crossVectors(_panForward, camera.up).normalize();
      // Content follows the fingers: fingers up push the ground away, so the drone moves forward.
      const gain = Math.max(10, camera.position.distanceTo(orbit.target)) * 0.0022;
      _panForward.multiplyScalar(dy * gain).addScaledVector(_panRight, dx * gain);
      camera.position.add(_panForward);
      orbit.target.add(_panForward);
      transitionActive = false;
      markMotion();
      requestRender();
    };

    /**
     * Alt + drag turns the head in place: the camera stays put and the view direction yaws / pitches,
     * the orbit pivot moving along it at the same distance. Runs in the capture phase so the orbit
     * controls never see the gesture.
     */
    let lookDrag: { x: number; y: number } | null = null;
    const _lookOffset = new THREE.Vector3();
    const _lookSpherical = new THREE.Spherical();
    const onLookPointerDown = (e: PointerEvent) => {
      if (!e.altKey || e.button !== 0 || isDraggingGizmo || useStadiumStore.getState().placingType) return;
      e.stopImmediatePropagation();
      pointerDownPos.set(e.clientX, e.clientY);
      lookDrag = { x: e.clientX, y: e.clientY };
      transitionActive = false;
      renderer.domElement.setPointerCapture(e.pointerId);
    };
    const onLookPointerMove = (e: PointerEvent) => {
      if (!lookDrag) return;
      e.stopImmediatePropagation();
      const dx = e.clientX - lookDrag.x;
      const dy = e.clientY - lookDrag.y;
      lookDrag.x = e.clientX;
      lookDrag.y = e.clientY;
      _lookOffset.copy(orbit.target).sub(camera.position);
      _lookSpherical.setFromVector3(_lookOffset);
      _lookSpherical.theta -= dx * 0.004;
      _lookSpherical.phi = THREE.MathUtils.clamp(_lookSpherical.phi + dy * 0.004, 0.05, Math.PI - 0.05);
      _lookOffset.setFromSpherical(_lookSpherical);
      orbit.target.copy(camera.position).add(_lookOffset);
      camera.lookAt(orbit.target);
      markMotion();
      requestRender();
    };
    const onLookPointerUp = (e: PointerEvent) => {
      if (!lookDrag) return;
      lookDrag = null;
      if (renderer.domElement.hasPointerCapture(e.pointerId)) renderer.domElement.releasePointerCapture(e.pointerId);
    };

    const _zoomPoint = new THREE.Vector3();
    const _zoomOffset = new THREE.Vector3();
    const _zoomForward = new THREE.Vector3();
    const zoomAnchor = { x: -1e9, y: -1e9, time: 0 };
    const ZOOM_MIN_DISTANCE = 1.5;
    const onWheel = (e: WheelEvent) => {
      e.preventDefault();
      const currentEngine = engineRef.current;
      if (!currentEngine || !orbit.enabled || surfaceDrag) return;
      const now = performance.now();
      if (isTrackpadScroll(e, now)) {
        panAcrossGround(e.deltaX, e.deltaY);
        return;
      }
      // One raycast per gesture: the anchor is kept while the cursor stays put.
      if (Math.hypot(e.clientX - zoomAnchor.x, e.clientY - zoomAnchor.y) > 4 || now - zoomAnchor.time > 300) {
        const hit = pickSurface(e);
        const ground = hit ? null : groundAt(e, 0);
        if (hit) _zoomPoint.copy(hit);
        else if (ground && ground.distanceTo(camera.position) < orbit.maxDistance) _zoomPoint.copy(ground);
        else _zoomPoint.copy(raycaster.ray.at(camera.position.distanceTo(orbit.target), _zoomOffset));
        zoomAnchor.x = e.clientX;
        zoomAnchor.y = e.clientY;
      }
      zoomAnchor.time = now;

      const pixels = e.deltaMode === 1 ? e.deltaY * 16 : e.deltaMode === 2 ? e.deltaY * 400 : e.deltaY;
      // Trackpad pinch arrives as ctrl+wheel with small deltas: give it more gain.
      const factor = Math.exp(-pixels * (e.ctrlKey ? 0.01 : 0.0018));
      _zoomOffset.copy(camera.position).sub(_zoomPoint);
      const distance = _zoomOffset.length();
      const next = THREE.MathUtils.clamp(distance / factor, ZOOM_MIN_DISTANCE, orbit.maxDistance);
      if (Math.abs(next - distance) < 1e-3) return;
      // Moving along the line to the anchor keeps the anchor under the cursor.
      camera.position.copy(_zoomPoint).add(_zoomOffset.setLength(next));
      if (camera.position.y < 0.5) camera.position.y = 0.5;
      camera.getWorldDirection(_zoomForward);
      const depth = Math.max(orbit.minDistance, _zoomOffset.copy(_zoomPoint).sub(camera.position).dot(_zoomForward));
      orbit.target.copy(camera.position).addScaledVector(_zoomForward, depth);
      transitionActive = false;
      markMotion();
      requestRender();
    };

    const isTyping = (el: Element | null) =>
      el instanceof HTMLElement &&
      (el.tagName === 'INPUT' || el.tagName === 'TEXTAREA' || el.tagName === 'SELECT' || el.isContentEditable);
    const onFlightKeyDown = (e: KeyboardEvent) => {
      if (!FLIGHT_MOVES[e.code] || e.metaKey || e.ctrlKey || e.altKey || isTyping(document.activeElement)) return;
      if (e.code === 'KeyS' && useStadiumStore.getState().selectedObjectId) return;
      e.preventDefault();
      flightFast = e.shiftKey;
      if (!flightKeys.has(e.code)) {
        flightKeys.add(e.code);
        markMotion();
        requestRender();
      }
    };
    const onFlightKeyUp = (e: KeyboardEvent) => {
      flightFast = e.shiftKey;
      flightKeys.delete(e.code);
    };
    const stopFlight = () => flightKeys.clear();

    renderer.domElement.addEventListener('pointerdown', onLookPointerDown, { capture: true });
    renderer.domElement.addEventListener('pointermove', onLookPointerMove, { capture: true });
    renderer.domElement.addEventListener('pointerup', onLookPointerUp, { capture: true });
    renderer.domElement.addEventListener('pointercancel', onLookPointerUp, { capture: true });
    renderer.domElement.addEventListener('pointerdown', onPointerDown);
    renderer.domElement.addEventListener('pointermove', onPointerMove);
    renderer.domElement.addEventListener('pointerup', onPointerUp);
    renderer.domElement.addEventListener('dblclick', onDoubleClick);
    renderer.domElement.addEventListener('wheel', onWheel, { passive: false });
    window.addEventListener('keydown', onFlightKeyDown);
    window.addEventListener('keyup', onFlightKeyUp);
    window.addEventListener('blur', stopFlight);

    // WebGL Context Loss Safety
    const handleContextLost = (e: Event) => {
      e.preventDefault();
      setWebglLost(true);
    };
    const handleContextRestored = () => {
      setWebglLost(false);
      renderer.shadowMap.needsUpdate = true;
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
        pipeline?.setSize(w, h);
        requestRender();
      }
    });
    resizeObserver.observe(container);

    // Register synchronous PNG screenshot capture handler
    registerGlbCameraHandler(() => camera);
    registerViewportCaptureHandler(() => {
      transformHelper.visible = false;
      if (pipeline) pipeline.render();
      else renderer.render(scene, camera);
      const dataUrl = renderer.domElement.toDataURL('image/png');
      transformHelper.visible = Boolean(transform.object);
      requestRender();
      return dataUrl;
    });

    registerPathTraceHandler(
      isSoftwareGl
        ? null
        : async (onProgress) => {
            const engine = engineRef.current;
            if (!engine?.stadiumRoot || pathTracing) return null;
            pathTracing = true;
            transformHelper.visible = false;
            const mode = useStadiumStore.getState().doc.lighting;
            try {
              // Loaded on demand: the tracer and its BVH builder are only needed for this export.
              const { renderPathTracedPng } = await import('./pathTracedCapture');
              return await renderPathTracedPng({
                renderer,
                camera,
                stadium: engine.stadiumRoot,
                lights: [keyLight, rimLight, arenaBowlLight],
                hemisphereIntensity: hemiLight.intensity,
                sky: skyEnv && mode !== 'night' ? skyEnv.sky : null,
                background: skyTextures.night,
                environmentIntensity: scene.environmentIntensity,
                samples: 48,
                onProgress,
              });
            } finally {
              pathTracing = false;
              transformHelper.visible = Boolean(transform.object);
              requestRender();
            }
          }
    );

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
      skyEnv,
      pipeline,
      gridHelper,
      stadiumRoot: null,
      placedMap: new Map(),
      requestRender,
      markMotion,
      ghost: null,
      startCameraTransition,
      maxAnisotropy: renderer.capabilities.getMaxAnisotropy(),
    };

    if (!isSoftwareGl) {
      renderer.compile(scene, camera);
    }
    requestRender();

    return () => {
      registerViewportCaptureHandler(null);
      registerPathTraceHandler(null);
      registerGlbCameraHandler(null);
      resizeObserver.disconnect();
      cancelAnimationFrame(frameId);
      clearTimeout(frameId);
      clearTimeout(settleTimer);
      renderer.domElement.removeEventListener('pointerdown', onLookPointerDown, { capture: true });
      renderer.domElement.removeEventListener('pointermove', onLookPointerMove, { capture: true });
      renderer.domElement.removeEventListener('pointerup', onLookPointerUp, { capture: true });
      renderer.domElement.removeEventListener('pointercancel', onLookPointerUp, { capture: true });
      renderer.domElement.removeEventListener('pointerdown', onPointerDown);
      renderer.domElement.removeEventListener('pointermove', onPointerMove);
      renderer.domElement.removeEventListener('pointerup', onPointerUp);
      renderer.domElement.removeEventListener('dblclick', onDoubleClick);
      renderer.domElement.removeEventListener('wheel', onWheel);
      window.removeEventListener('keydown', onFlightKeyDown);
      window.removeEventListener('keyup', onFlightKeyUp);
      window.removeEventListener('blur', stopFlight);
      renderer.domElement.removeEventListener('webglcontextlost', handleContextLost);
      renderer.domElement.removeEventListener('webglcontextrestored', handleContextRestored);
      transform.detach();
      transform.dispose();
      orbit.dispose();
      skyTextures.day.dispose();
      skyTextures.dusk.dispose();
      skyTextures.night.dispose();
      if (skyEnv) skyEnv.dispose();
      else {
        envTextures.day.dispose();
        envTextures.dusk.dispose();
        envTextures.night.dispose();
      }
      pipeline?.dispose();
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
  // Rebuild: at most once per frame, from the latest document. A slider drag sends many changes per
  // frame and each build takes a tenth of a second or more; building only the last one keeps the
  // drag responsive. The old stadium stays on screen until the new one replaces it.
  useEffect(() => {
    const frame = requestAnimationFrame(() => rebuildStadium());
    return () => cancelAnimationFrame(frame);
  }, [doc, cameraMode]);

  const rebuildStadium = () => {
    const engine = engineRef.current;
    if (!engine) return;

    // Update sky dome, outdoor PBR environment reflections, atmospheric haze, and stadium match floodlights
    const applyAtmosphere = (mode: LightingMode) => {
      // The physical sky mesh draws day and dusk; the painted texture stays for night.
      engine.scene.background = engine.skyEnv && mode !== 'night' ? null : engine.skyTextures[mode];
      engine.scene.environment = engine.envTextures[mode];
      engine.skyEnv?.applySky(mode);
      engine.pipeline?.setMode(mode);
      engine.keyLight.position.copy(getSunDirection(mode)).multiplyScalar(260);
      engine.gridHelper.visible = cameraMode === 'plan2d' || cameraMode === 'cross_section';
      engine.gridHelper.material.opacity = 0.14;
      engine.gridHelper.material.transparent = true;

      const rigMode = resolveFloodlightRig(doc);
      const rigIntensityFactor =
        rigMode === 'none' ? 0.24 : rigMode === 'both' ? 1.22 : 1.0;

      if (mode === 'day') {
        engine.scene.environmentIntensity = 1.1;
        // Light aerial haze matching the sky's horizon colour.
        engine.scene.fog = new THREE.FogExp2(0xc9d8e8, 0.00045);
        engine.keyLight.color.setHex(0xfffbeb);
        engine.keyLight.intensity = 2.55;
        engine.hemiLight.color.setHex(0xe0f2fe);
        engine.hemiLight.groundColor.setHex(0x334155);
        // The sky environment already fills the shadows; extra fill lights flatten the volumes.
        engine.hemiLight.intensity = 0.5;
        engine.rimLight.intensity = 0.12;
        engine.arenaBowlLight.intensity = 0.22;
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
        engine.arenaBowlLight.intensity = 1.45 * rigIntensityFactor;
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
        engine.arenaBowlLight.intensity = 2.35 * rigIntensityFactor;
      }
    };

    applyAtmosphere(doc.lighting);

    // Built before the old stadium is removed: a generator that throws on some combination of
    // settings leaves the last valid stadium on screen instead of an empty scene or a crash.
    let built: ReturnType<typeof buildStadiumSceneGraph>;
    try {
      built = buildStadiumSceneGraph(doc, {
        crossSectionClip: cameraMode === 'cross_section',
        maxAnisotropy: engine.maxAnisotropy,
        mergeStatic: true,
        distanceLod: true,
      });
    } catch (error) {
      console.error('Stadium build failed; keeping the previous stadium.', error);
      setBuildFailed(true);
      engine.requestRender();
      return;
    }
    setBuildFailed(false);
    const { rootGroup, placedObjectMap } = built;

    engine.transform.detach();
    if (engine.stadiumRoot) {
      engine.scene.remove(engine.stadiumRoot);
      disposeObject3D(engine.stadiumRoot);
    }
    engine.scene.add(rootGroup);
    engine.stadiumRoot = rootGroup;
    engine.placedMap = placedObjectMap;

    engine.renderer.shadowMap.needsUpdate = true;
    applySelection();
  };

  // Selection: frames the chosen object and hands it to the gizmo. Also run after every rebuild,
  // so picking another object never rebuilds the stadium.
  const applySelection = () => {
    const engine = engineRef.current;
    if (!engine) return;
    const selectedObjectId = useStadiumStore.getState().selectedObjectId;
    engine.transform.detach();
    for (const group of engine.placedMap.values()) setSelectionHighlight(group, false);
    const target = selectedObjectId ? engine.placedMap.get(selectedObjectId) : undefined;
    if (target) {
      setSelectionHighlight(target, true);
      engine.transform.attach(target);
      // Effect 3 owns mode changes; reading the store here keeps them from re-running this one.
      engine.transform.setMode(useStadiumStore.getState().transformMode);
    }
    engine.requestRender();
  };
  useEffect(applySelection, [selectedObjectId]);

  // Placement preview: the chosen equipment follows the cursor until a click drops it.
  useEffect(() => {
    const engine = engineRef.current;
    if (!engine) return;
    if (engine.ghost) {
      engine.scene.remove(engine.ghost);
      disposeObject3D(engine.ghost);
      engine.ghost = null;
    }
    engine.renderer.domElement.style.cursor = placingType ? 'crosshair' : '';
    if (placingType) {
      const ghost = generatePlacedObjectGroup(
        {
          id: 'placement-ghost',
          type: placingType,
          name: '',
          position: [0, 0, 0],
          rotation: [0, 0, 0],
          scale: [1, 1, 1],
        },
        doc.lighting,
        doc.materials,
        engine.maxAnisotropy
      );
      ghost.visible = false;
      ghost.traverse((o) => {
        const mesh = o as THREE.Mesh;
        if (!mesh.isMesh) return;
        // A see-through copy reads as "not placed yet"; it never casts shadows or catches clicks.
        const seeThrough = (m: THREE.Material) => {
          const c = m.clone();
          c.transparent = true;
          c.opacity = 0.55;
          c.depthWrite = false;
          return c;
        };
        mesh.material = Array.isArray(mesh.material)
          ? mesh.material.map(seeThrough)
          : seeThrough(mesh.material);
        mesh.castShadow = false;
        mesh.raycast = () => {};
      });
      engine.scene.add(ghost);
      engine.ghost = ghost;
    }
    engine.requestRender();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [placingType]);

  // Open / close animation of a movable roof: only its panels are rebuilt, frame by frame.
  useEffect(() => {
    const engine = engineRef.current;
    if (!engine || !roofMotion) return;
    let panels: THREE.Object3D | null = null;
    engine.stadiumRoot?.traverse((o) => {
      if (!panels && typeof o.userData.rebuildAt === 'function') panels = o;
    });
    const finish = () => useStadiumStore.getState().finishRoofMotion();
    if (!panels) {
      finish();
      return;
    }
    const from = resolveRetractable(useStadiumStore.getState().doc.roof).openRatio;
    const duration = 400 + 1100 * Math.abs(roofMotion.to - from);
    const start = performance.now();
    let raf = 0;
    const step = (now: number) => {
      const t = Math.min(1, (now - start) / duration);
      const eased = t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2;
      const current = panels!;
      const next = (current.userData.rebuildAt as (r: number) => THREE.Object3D)(
        from + (roofMotion.to - from) * eased
      );
      current.parent?.add(next);
      current.removeFromParent();
      // Materials are shared between frames; only the per-frame geometry is freed.
      current.traverse((o) => (o as THREE.Mesh).geometry?.dispose());
      panels = next;
      // Shadows are redrawn once the roof stops (the final rebuild); moving frames render cheap.
      engine.markMotion();
      engine.requestRender();
      if (t < 1) raf = requestAnimationFrame(step);
      else finish();
    };
    raf = requestAnimationFrame(step);
    return () => cancelAnimationFrame(raf);
  }, [roofMotion]);

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
    <div className="relative w-full h-full select-none overflow-hidden bg-canvas">
      <div ref={mountRef} className="w-full h-full" />
      <div className="absolute right-3 top-3 z-10 flex flex-col items-end gap-2">
        <div className="flex items-center gap-1 rounded-md bg-panel/95 border border-line p-1">
          <div
            role="img"
            aria-label="Boussole : N indique le nord (côté tribune nord)"
            title="Boussole : N indique le nord (côté tribune nord)"
            className="relative w-7 h-7 rounded-full border border-line"
          >
            <div ref={compassRef} className="absolute inset-0">
              <span className="absolute left-1/2 top-0 -translate-x-1/2 text-[9px] leading-none font-semibold text-accent-ink">N</span>
              <span className="absolute left-1/2 top-[9px] -translate-x-1/2 w-0 h-0 border-x-[3px] border-x-transparent border-b-[7px] border-b-accent" />
              <span className="absolute left-1/2 bottom-[5px] -translate-x-1/2 w-0 h-0 border-x-[3px] border-x-transparent border-t-[7px] border-t-line-strong" />
            </div>
          </div>
          <div className="px-1.5 text-right" title="Altitude de la caméra au-dessus de la pelouse">
            <div className="text-2xs text-ink-faint leading-tight">Altitude</div>
            <span ref={altitudeRef} className="block text-xs font-medium tabular-nums text-ink leading-tight">
              –
            </span>
          </div>
          <IconButton label="Revenir à la vue initiale" onClick={() => setCameraMode(useStadiumStore.getState().cameraMode)}>
            <House className="w-4 h-4" />
          </IconButton>
          <IconButton
            label="Commandes de navigation"
            active={helpOpen}
            aria-expanded={helpOpen}
            onClick={() => setHelpOpen((open) => !open)}
          >
            <CircleHelp className="w-4 h-4" />
          </IconButton>
        </div>
        {helpOpen && (
          <div className="w-72 rounded-md bg-panel/95 border border-line p-3 text-xs text-ink">
            <p className="text-2xs font-medium uppercase tracking-wide text-ink-faint mb-2">Souris et trackpad</p>
            <dl className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-1">
              {NAV_HELP_POINTER.map(([keys, action]) => (
                <React.Fragment key={keys}>
                  <dt className="font-medium whitespace-nowrap">{keys}</dt>
                  <dd className="text-ink-muted">{action}</dd>
                </React.Fragment>
              ))}
            </dl>
            <p className="text-2xs font-medium uppercase tracking-wide text-ink-faint mt-3 mb-2">Clavier</p>
            <dl className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-1">
              {NAV_HELP_KEYS.map(([keys, action]) => (
                <React.Fragment key={keys}>
                  <dt className="font-medium whitespace-nowrap">{keys}</dt>
                  <dd className="text-ink-muted">{action}</dd>
                </React.Fragment>
              ))}
            </dl>
            <p className="mt-3 text-2xs text-ink-faint">
              Touches selon la position sur le clavier : ZQSD en AZERTY, WASD en QWERTY. Quand un objet est
              sélectionné, S sert à l'outil Échelle.
            </p>
          </div>
        )}
      </div>
      {buildFailed && (
        <div
          role="alert"
          className="absolute left-1/2 bottom-4 -translate-x-1/2 z-20 max-w-md rounded-md border border-line bg-panel/95 px-3 py-2 text-xs text-ink shadow-lg"
        >
          Ce réglage n'a pas pu être construit : la dernière version valide reste affichée.
          Annulez (Ctrl+Z) ou modifiez la valeur.
        </div>
      )}
      {webglLost && (
        <div className="absolute inset-0 flex items-center justify-center bg-canvas/95 text-ink p-6 text-center z-30">
          <div className="max-w-md space-y-2">
            <p className="text-base font-semibold">Contexte WebGL suspendu</p>
            <p className="text-xs text-ink-muted">
              Restauration automatique du moteur 3D StadiumForge en cours…
            </p>
          </div>
        </div>
      )}
    </div>
  );
};
