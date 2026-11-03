import * as THREE from 'three';
import { FullScreenQuad } from 'three/addons/postprocessing/Pass.js';
import { WebGLPathTracer } from 'three-gpu-pathtracer';

const EQUIRECT_WIDTH = 1024;

/**
 * Bakes what the viewport shows as its sky (the physical sky mesh, or the painted night texture)
 * into an equirectangular float DataTexture, the environment format the path tracer samples for
 * importance-sampled sky lighting.
 */
function bakeEquirectEnvironment(
  renderer: THREE.WebGLRenderer,
  sky: THREE.Object3D | null,
  background: THREE.Texture | null
): THREE.DataTexture {
  const bakeScene = new THREE.Scene();
  if (sky) {
    const skyClone = sky.clone();
    skyClone.visible = true;
    bakeScene.add(skyClone);
  } else {
    bakeScene.background = background;
  }

  const cubeTarget = new THREE.WebGLCubeRenderTarget(512, { type: THREE.HalfFloatType });
  const cubeCamera = new THREE.CubeCamera(0.5, 2000, cubeTarget);
  cubeCamera.update(renderer, bakeScene);

  const width = EQUIRECT_WIDTH;
  const height = EQUIRECT_WIDTH / 2;
  const equirectTarget = new THREE.WebGLRenderTarget(width, height, { type: THREE.FloatType });
  const quad = new FullScreenQuad(
    new THREE.ShaderMaterial({
      uniforms: { cube: { value: cubeTarget.texture } },
      vertexShader:
        'varying vec2 vUv; void main() { vUv = uv; gl_Position = vec4(position.xy, 0.0, 1.0); }',
      fragmentShader: `
        uniform samplerCube cube;
        varying vec2 vUv;
        #define PI 3.141592653589793
        void main() {
          // Same parameterisation as three's equirectangular mapping.
          float phi = (vUv.x - 0.5) * 2.0 * PI;
          float theta = (vUv.y - 0.5) * PI;
          vec3 dir = vec3(cos(theta) * sin(phi), sin(theta), -cos(theta) * cos(phi));
          gl_FragColor = vec4(textureCube(cube, dir).rgb, 1.0);
        }`,
    })
  );
  const previousTarget = renderer.getRenderTarget();
  renderer.setRenderTarget(equirectTarget);
  quad.render(renderer);
  const pixels = new Float32Array(width * height * 4);
  renderer.readRenderTargetPixels(equirectTarget, 0, 0, width, height, pixels);
  renderer.setRenderTarget(previousTarget);

  (quad.material as THREE.Material).dispose();
  quad.dispose();
  cubeTarget.dispose();
  equirectTarget.dispose();

  const texture = new THREE.DataTexture(pixels, width, height, THREE.RGBAFormat, THREE.FloatType);
  texture.mapping = THREE.EquirectangularReflectionMapping;
  texture.colorSpace = THREE.LinearSRGBColorSpace;
  texture.flipY = false;
  texture.needsUpdate = true;
  return texture;
}

/**
 * Above this many expanded triangles an instanced mesh (seats, crowd, rails) is traced as one box
 * per instance: tens of thousands of detailed seats otherwise add millions of triangles, which
 * stalls the BVH build for tens of seconds and overflows the tracer's buffers (a black render).
 */
const INSTANCE_DETAIL_TRIANGLE_BUDGET = 150_000;

function triangleCount(geo: THREE.BufferGeometry): number {
  return (geo.index ? geo.index.count : geo.attributes.position.count) / 3;
}

/** Box over the geometry's bounds, standing in for a detailed instance at photo distance. */
function boundingBoxProxy(geo: THREE.BufferGeometry): THREE.BufferGeometry {
  if (!geo.boundingBox) geo.computeBoundingBox();
  const box = geo.boundingBox!;
  const size = box.getSize(new THREE.Vector3());
  const centre = box.getCenter(new THREE.Vector3());
  const proxy = new THREE.BoxGeometry(
    Math.max(size.x, 0.01),
    Math.max(size.y, 0.01),
    Math.max(size.z, 0.01)
  ).toNonIndexed();
  proxy.translate(centre.x, centre.y, centre.z);
  return proxy;
}

/** One mesh per instanced mesh, with every instance's transform (and colour) baked in. */
function expandInstancedMesh(
  inst: THREE.InstancedMesh,
  ownedMaterials: THREE.Material[]
): THREE.Mesh {
  const detailed = triangleCount(inst.geometry) * inst.count <= INSTANCE_DETAIL_TRIANGLE_BUDGET;
  const source = !detailed
    ? boundingBoxProxy(inst.geometry)
    : inst.geometry.index
    ? inst.geometry.toNonIndexed()
    : inst.geometry;
  const pos = source.attributes.position;
  const nor = source.attributes.normal;
  const uv = source.attributes.uv;
  // Per-vertex shading baked into the source (e.g. the crowd's darker trousers)
  const shade = detailed ? source.attributes.color : undefined;
  const vertsPer = pos.count;
  const n = inst.count;
  const positions = new Float32Array(n * vertsPer * 3);
  const normals = new Float32Array(n * vertsPer * 3);
  const uvs = uv ? new Float32Array(n * vertsPer * 2) : null;
  const colors = inst.instanceColor ? new Float32Array(n * vertsPer * 4) : null;

  const m = new THREE.Matrix4();
  const nm = new THREE.Matrix3();
  const v = new THREE.Vector3();
  const c = new THREE.Color();
  for (let i = 0; i < n; i++) {
    inst.getMatrixAt(i, m);
    nm.getNormalMatrix(m);
    if (colors) inst.getColorAt(i, c);
    for (let k = 0; k < vertsPer; k++) {
      const o = i * vertsPer + k;
      v.fromBufferAttribute(pos, k).applyMatrix4(m);
      positions[o * 3] = v.x;
      positions[o * 3 + 1] = v.y;
      positions[o * 3 + 2] = v.z;
      if (nor) {
        v.fromBufferAttribute(nor, k).applyMatrix3(nm).normalize();
        normals[o * 3] = v.x;
        normals[o * 3 + 1] = v.y;
        normals[o * 3 + 2] = v.z;
      }
      if (uvs && uv) {
        uvs[o * 2] = uv.getX(k);
        uvs[o * 2 + 1] = uv.getY(k);
      }
      if (colors) {
        const s = shade ? shade.getX(k) : 1;
        colors[o * 4] = c.r * s;
        colors[o * 4 + 1] = c.g * s;
        colors[o * 4 + 2] = c.b * s;
        colors[o * 4 + 3] = 1;
      }
    }
  }

  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(positions, 3));
  geo.setAttribute('normal', new THREE.BufferAttribute(normals, 3));
  if (uvs) geo.setAttribute('uv', new THREE.BufferAttribute(uvs, 2));
  let material = inst.material as THREE.Material;
  if (colors) {
    geo.setAttribute('color', new THREE.BufferAttribute(colors, 4));
    material = material.clone();
    material.vertexColors = true;
    ownedMaterials.push(material);
  }
  if (source !== inst.geometry) source.dispose();
  return new THREE.Mesh(geo, material);
}

/**
 * Gives an RGB vertex colour attribute an alpha channel. The tracer merges every mesh into one
 * geometry, and when colour sizes differ its merge copies the wrong way, leaving the RGB meshes
 * (houses, crowd, banners) white in the still.
 */
function widenColorToRgba(geo: THREE.BufferGeometry): void {
  const color = geo.getAttribute('color');
  if (!color || color.itemSize !== 3) return;
  const rgba = new Float32Array(color.count * 4);
  for (let i = 0; i < color.count; i++) {
    rgba[i * 4] = color.getX(i);
    rgba[i * 4 + 1] = color.getY(i);
    rgba[i * 4 + 2] = color.getZ(i);
    rgba[i * 4 + 3] = 1;
  }
  geo.setAttribute('color', new THREE.BufferAttribute(rgba, 4));
}

/**
 * Static copy of the stadium for the path tracer: every visible mesh frozen at its world
 * transform with its own geometry, instanced meshes expanded (the tracer ignores instance
 * matrices), and anything the tracer cannot shade (shader materials) left out.
 */
function buildTraceableScene(root: THREE.Object3D): {
  group: THREE.Group;
  owned: THREE.Mesh[];
  ownedMaterials: THREE.Material[];
} {
  const group = new THREE.Group();
  const owned: THREE.Mesh[] = [];
  const ownedMaterials: THREE.Material[] = [];
  root.updateMatrixWorld(true);
  root.traverseVisible((obj) => {
    const mesh = obj as THREE.Mesh;
    if (!mesh.isMesh) return;
    const mats = Array.isArray(mesh.material) ? mesh.material : [mesh.material];
    if (mats.some((mt) => (mt as THREE.ShaderMaterial).isShaderMaterial)) return;
    // Shader-placed instancing (the grass blade field): copied raw it is a single blade standing
    // at the world origin, on the centre spot.
    if ((mesh.geometry as THREE.InstancedBufferGeometry).isInstancedBufferGeometry) return;
    // The tracer writes a per-vertex material index into the geometry it is given, so each copy
    // needs its own geometry: shared ones would get the last mesh's material, and the viewport's
    // geometries would be modified.
    const copy = (mesh as THREE.InstancedMesh).isInstancedMesh
      ? expandInstancedMesh(mesh as THREE.InstancedMesh, ownedMaterials)
      : new THREE.Mesh(mesh.geometry.clone(), mesh.material);
    // three ignores geometry groups under a single material, but the tracer reads their material
    // index: a box's faces (indices 0-5) would take the next five materials of the scene.
    if (!Array.isArray(copy.material)) copy.geometry.clearGroups();
    widenColorToRgba(copy.geometry);
    owned.push(copy);
    copy.matrixAutoUpdate = false;
    copy.matrix.copy(mesh.matrixWorld);
    copy.matrixWorld.copy(mesh.matrixWorld);
    group.add(copy);
  });
  return { group, owned, ownedMaterials };
}

/**
 * Environment intensity that lights like one unit of the viewport's hemisphere fill, measured so a
 * day still matches the viewport's mean brightness.
 */
const HEMISPHERE_TO_ENVIRONMENT = 6;

export interface PathTraceRequest {
  renderer: THREE.WebGLRenderer;
  camera: THREE.PerspectiveCamera;
  stadium: THREE.Object3D;
  /** The viewport's directional lights (sun first, then fills); all are traced. */
  lights: THREE.DirectionalLight[];
  /** Hemisphere fill the viewport adds; the tracer has none, so it is folded into the sky light. */
  hemisphereIntensity: number;
  /** The viewport's physical sky mesh, or null to use `background` (night). */
  sky: THREE.Object3D | null;
  background: THREE.Texture | null;
  environmentIntensity: number;
  samples: number;
  onProgress?: (fraction: number) => void;
}

/**
 * Renders the current view with a progressive GPU path tracer (global illumination, soft sun
 * shadows, true reflections) and returns it as a PNG data URL. Runs over many frames so the page
 * stays responsive; the caller pauses its own rendering meanwhile.
 */
export async function renderPathTracedPng(req: PathTraceRequest): Promise<string> {
  const { renderer, camera, stadium, lights, samples, onProgress } = req;
  const environment = bakeEquirectEnvironment(renderer, req.sky, req.background);

  const scene = new THREE.Scene();
  scene.environment = environment;
  scene.background = environment;
  // The viewport's hemisphere fill lights every surface from the whole sky, which is what the
  // environment does in the tracer; without it the still came out at half the viewport's brightness.
  scene.environmentIntensity = req.environmentIntensity + req.hemisphereIntensity * HEMISPHERE_TO_ENVIRONMENT;
  scene.backgroundIntensity = 1;

  for (const light of lights) {
    const copy = light.clone();
    copy.target = new THREE.Object3D();
    copy.target.position.copy(light.target.position);
    scene.add(copy, copy.target);
  }

  const { group, owned, ownedMaterials } = buildTraceableScene(stadium);
  scene.add(group);

  const tracer = new WebGLPathTracer(renderer);
  tracer.bounces = 6;
  tracer.filterGlossyFactor = 0.5;
  tracer.renderDelay = 0;
  tracer.fadeDuration = 0;
  tracer.minSamples = 1;
  tracer.dynamicLowRes = false;
  tracer.renderToCanvas = true;
  // Quarter-frame passes: a whole 1080p frame per pass trips the GPU watchdog on large stadiums,
  // which loses the WebGL context and used to save a black image.
  tracer.tiles.set(2, 2);

  try {
    // Building the BVH blocks for a moment; let the progress label paint first.
    onProgress?.(0.02);
    await new Promise((resolve) => requestAnimationFrame(resolve));
    tracer.setScene(scene, camera);
    onProgress?.(0.15);
    const gl = renderer.getContext();
    while (tracer.samples < samples) {
      tracer.renderSample();
      if (gl.isContextLost()) throw new Error('GPU context lost during path tracing');
      onProgress?.(0.15 + 0.85 * Math.min(1, tracer.samples / samples));
      await new Promise((resolve) => requestAnimationFrame(resolve));
    }
    // Read the canvas right after the last sample is drawn, before anything redraws it.
    tracer.renderSample();
    if (gl.isContextLost()) throw new Error('GPU context lost during path tracing');
    return renderer.domElement.toDataURL('image/png');
  } finally {
    tracer.dispose();
    environment.dispose();
    owned.forEach((mesh) => mesh.geometry.dispose());
    ownedMaterials.forEach((material) => material.dispose());
  }
}
