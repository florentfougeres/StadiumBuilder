import * as THREE from 'three';

type TexturedMaterial = THREE.MeshStandardMaterial & { userData: { roofTileM?: number; roofSkylight?: boolean } };
const MAP_KEYS = ['map', 'normalMap', 'roughnessMap', 'emissiveMap', 'alphaMap', 'bumpMap'] as const;

/**
 * Metres of surface per unit of `u` and of `v` on a mesh, averaged over its triangles by area
 * (in the roof's frame, instances included through the first instance's transform).
 */
function metresPerUv(mesh: THREE.Mesh, toRoot: THREE.Matrix4): { u: number; v: number } | null {
  const geo = mesh.geometry;
  const pos = geo.getAttribute('position');
  const uv = geo.getAttribute('uv');
  if (!pos || !uv) return null;
  const m = new THREE.Matrix4().multiplyMatrices(toRoot, mesh.matrixWorld);
  if ((mesh as THREE.InstancedMesh).isInstancedMesh && (mesh as THREE.InstancedMesh).count > 0) {
    const inst = new THREE.Matrix4();
    (mesh as THREE.InstancedMesh).getMatrixAt(0, inst);
    m.multiply(inst);
  }
  const index = geo.getIndex();
  const triCount = (index ? index.count : pos.count) / 3;
  const stride = Math.max(1, Math.floor(triCount / 3000));
  const p = [new THREE.Vector3(), new THREE.Vector3(), new THREE.Vector3()];
  const e1 = new THREE.Vector3();
  const e2 = new THREE.Vector3();
  const dPdu = new THREE.Vector3();
  const dPdv = new THREE.Vector3();
  let sumU = 0;
  let sumV = 0;
  let sumA = 0;
  for (let t = 0; t < triCount; t += stride) {
    const ids = [0, 1, 2].map((k) => (index ? index.getX(t * 3 + k) : t * 3 + k));
    ids.forEach((id, k) => p[k].fromBufferAttribute(pos, id).applyMatrix4(m));
    const du1 = uv.getX(ids[1]) - uv.getX(ids[0]);
    const dv1 = uv.getY(ids[1]) - uv.getY(ids[0]);
    const du2 = uv.getX(ids[2]) - uv.getX(ids[0]);
    const dv2 = uv.getY(ids[2]) - uv.getY(ids[0]);
    const det = du1 * dv2 - du2 * dv1;
    if (Math.abs(det) < 1e-12) continue;
    e1.subVectors(p[1], p[0]);
    e2.subVectors(p[2], p[0]);
    const area = e1.clone().cross(e2).length() / 2;
    if (area < 1e-6) continue;
    dPdu.copy(e1).multiplyScalar(dv2).addScaledVector(e2, -dv1).divideScalar(det);
    dPdv.copy(e2).multiplyScalar(du1).addScaledVector(e1, -du2).divideScalar(det);
    sumU += dPdu.length() * area;
    sumV += dPdv.length() * area;
    sumA += area;
  }
  return sumA > 0 ? { u: sumU / sumA, v: sumV / sumA } : null;
}

/** The material with its own copies of its textures, repeated `ru` x `rv` times per UV unit. */
function withRepeat(mat: TexturedMaterial, ru: number, rv: number): TexturedMaterial {
  const out = mat.clone() as TexturedMaterial;
  for (const key of MAP_KEYS) {
    const tex = out[key] as THREE.Texture | null | undefined;
    if (!tex) continue;
    const copy = tex.clone();
    copy.repeat.set(ru, rv);
    copy.needsUpdate = true;
    out[key] = copy as never;
  }
  return out;
}

/**
 * Sets the texture repeat of every roof cladding in `root` so one texture tile covers its real size
 * (`ROOF_TILE_M`), whatever the extent of each surface's UVs: every roof style lays its UVs out its
 * own way (0..1 across a canopy, per panel, per sector), so this is measured on the built geometry.
 * Surfaces of one material at the same scale keep sharing one material.
 */
export function calibrateRoofTextures(root: THREE.Object3D): void {
  root.updateMatrixWorld(true);
  const toRoot = root.matrixWorld.clone().invert();
  const variants = new Map<THREE.Material, Map<string, TexturedMaterial>>();
  root.traverse((obj) => {
    const mesh = obj as THREE.Mesh;
    if (!mesh.isMesh || Array.isArray(mesh.material)) return;
    const mat = mesh.material as TexturedMaterial;
    const tileM = mat.userData?.roofTileM;
    if (!tileM || mat.userData.roofSkylight || !mat.map) return;
    const scale = metresPerUv(mesh, toRoot);
    if (!scale) return;
    const clampRepeat = (r: number) => Math.min(400, Math.max(0.05, r));
    const ru = clampRepeat(scale.u / tileM);
    const rv = clampRepeat(scale.v / tileM);
    // Quantised so surfaces at nearly the same scale share a material (and its textures).
    const key = `${ru.toPrecision(2)}x${rv.toPrecision(2)}`;
    let byScale = variants.get(mat);
    if (!byScale) variants.set(mat, (byScale = new Map()));
    let variant = byScale.get(key);
    if (!variant) byScale.set(key, (variant = withRepeat(mat, Number(ru.toPrecision(2)), Number(rv.toPrecision(2)))));
    mesh.material = variant;
  });
}
