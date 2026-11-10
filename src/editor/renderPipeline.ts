import * as THREE from 'three';
import { Sky } from 'three/addons/objects/Sky.js';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { GTAOPass } from 'three/addons/postprocessing/GTAOPass.js';
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';
import { LightingMode } from '../stadium/schema';

/** Sun elevation and azimuth (degrees) for each lighting mode; night keeps a low moon. */
const SUN: Record<LightingMode, { elevation: number; azimuth: number }> = {
  day: { elevation: 42, azimuth: 205 },
  dusk: { elevation: 3.5, azimuth: 250 },
  night: { elevation: 22, azimuth: 140 },
};

const SKY_EXPOSURE: Record<LightingMode, number> = { day: 0.1, dusk: 0.2, night: 1 };

/** Direction towards the sun (or moon) for a lighting mode, for the key light and its shadows. */
export function getSunDirection(mode: LightingMode): THREE.Vector3 {
  const { elevation, azimuth } = SUN[mode];
  return new THREE.Vector3().setFromSphericalCoords(
    1,
    THREE.MathUtils.degToRad(90 - elevation),
    THREE.MathUtils.degToRad(azimuth)
  );
}

/**
 * Physically based sky (Preetham scattering with clouds) for day and dusk, baked once into a
 * PMREM environment so glass, steel and membranes reflect the same sky that is drawn behind them.
 * Night keeps the painted sky passed in, since the scattering model has no night sky.
 */
export function createSkyEnvironments(
  renderer: THREE.WebGLRenderer,
  nightSky: THREE.Texture
): {
  sky: Sky;
  environments: Record<LightingMode, THREE.Texture>;
  applySky: (mode: LightingMode) => void;
  dispose: () => void;
} {
  const sky = new Sky();
  sky.name = 'PhysicalSky';
  sky.scale.setScalar(1500);
  sky.frustumCulled = false;
  const u = sky.material.uniforms;
  // The scattering model outputs raw radiance tuned for ~0.5 exposure; bring it to the scale of
  // the scene's lights (exposure 1.06) so the sky and its reflections are not blown out.
  u.skyExposure = { value: 1 };
  sky.material.fragmentShader = sky.material.fragmentShader
    .replace('uniform float showSunDisc;', 'uniform float showSunDisc;\nuniform float skyExposure;')
    .replace(
      'gl_FragColor = vec4( texColor, 1.0 );',
      'gl_FragColor = vec4( texColor * skyExposure, 1.0 );'
    );
  sky.material.needsUpdate = true;

  const configure = (mode: LightingMode) => {
    const dusk = mode === 'dusk';
    u.turbidity.value = dusk ? 6.5 : 2.2;
    u.rayleigh.value = dusk ? 2.4 : 2.1;
    u.mieCoefficient.value = dusk ? 0.009 : 0.004;
    u.mieDirectionalG.value = dusk ? 0.86 : 0.78;
    u.sunPosition.value.copy(getSunDirection(mode));
    u.skyExposure.value = SKY_EXPOSURE[mode];
    if ('cloudCoverage' in u) {
      u.cloudCoverage.value = dusk ? 0.32 : 0.28;
      u.cloudDensity.value = 0.42;
      u.cloudScale.value = 0.00022;
      u.cloudSpeed.value = 0;
    }
  };

  const pmrem = new THREE.PMREMGenerator(renderer);
  const bakeScene = new THREE.Scene();
  bakeScene.add(sky);
  const bake = (mode: LightingMode) => {
    configure(mode);
    // The sun is a separate shadow-casting light; leaving its disc out of the environment avoids
    // a second, unshadowed sun in every reflection.
    u.showSunDisc.value = 0;
    const texture = pmrem.fromScene(bakeScene, 0, 0.5, 2000).texture;
    u.showSunDisc.value = 1;
    return texture;
  };
  const environments: Record<LightingMode, THREE.Texture> = {
    day: bake('day'),
    dusk: bake('dusk'),
    night: pmrem.fromEquirectangular(nightSky).texture,
  };
  bakeScene.remove(sky);
  pmrem.dispose();

  return {
    sky,
    environments,
    applySky: (mode) => {
      sky.visible = mode !== 'night';
      if (sky.visible) configure(mode);
    },
    dispose: () => {
      sky.geometry.dispose();
      sky.material.dispose();
      Object.values(environments).forEach((t) => t.dispose());
    },
  };
}

/**
 * Post-processing chain: ground-truth ambient occlusion for contact shadows under roofs, tiers
 * and facade fins, a restrained bloom on floodlights at dusk and night, then tone mapping.
 */
export function createRenderPipeline(
  renderer: THREE.WebGLRenderer,
  scene: THREE.Scene,
  camera: THREE.PerspectiveCamera,
  width: number,
  height: number
): {
  /** `interactive` skips ambient occlusion, which re-renders the whole scene for its normals. */
  render: (interactive?: boolean) => void;
  setSize: (width: number, height: number) => void;
  /** Call after renderer.setPixelRatio, so the offscreen targets follow. */
  setPixelRatio: (pixelRatio: number, width: number, height: number) => void;
  setMode: (mode: LightingMode) => void;
  /**
   * Planes cutting the scene (Coupe mode). Ambient occlusion draws the scene with its own normal
   * material, which would otherwise shade the cut-away half back in as a grey veil.
   */
  setClippingPlanes: (planes: THREE.Plane[] | null) => void;
  dispose: () => void;
} {
  let pixelRatio = renderer.getPixelRatio();
  const target = new THREE.WebGLRenderTarget(width * pixelRatio, height * pixelRatio, {
    type: THREE.HalfFloatType,
    samples: 4,
  });
  const composer = new EffectComposer(renderer, target);
  composer.setPixelRatio(pixelRatio);
  composer.setSize(width, height);

  composer.addPass(new RenderPass(scene, camera));

  const gtao = new GTAOPass(scene, camera, width * pixelRatio, height * pixelRatio);
  gtao.output = GTAOPass.OUTPUT.Default;
  gtao.blendIntensity = 0.9;
  // Radius in metres: wide enough to darken the gap under a canopy, not so wide it greys the pitch.
  gtao.updateGtaoMaterial({ radius: 2.2, distanceExponent: 1.4, thickness: 3, scale: 1, samples: 16 });
  gtao.updatePdMaterial({ lumaPhi: 10, depthPhi: 2, normalPhi: 3, radius: 6, rings: 2, samples: 16 });
  composer.addPass(gtao);

  const bloom = new UnrealBloomPass(new THREE.Vector2(width, height), 0.32, 0.55, 0.9);
  composer.addPass(bloom);

  composer.addPass(new OutputPass());

  const setSize = (w: number, h: number) => {
    composer.setSize(w, h);
    gtao.setSize(w * pixelRatio, h * pixelRatio);
    bloom.setSize(w * pixelRatio, h * pixelRatio);
  };

  return {
    render: (interactive = false) => {
      gtao.enabled = !interactive;
      composer.render();
    },
    setSize,
    setPixelRatio: (pr, w, h) => {
      pixelRatio = pr;
      composer.setPixelRatio(pr);
      setSize(w, h);
    },
    setMode: (mode) => {
      bloom.enabled = mode !== 'day';
      bloom.strength = mode === 'night' ? 0.42 : 0.26;
    },
    setClippingPlanes: (planes) => {
      gtao.normalMaterial.clippingPlanes = planes;
    },
    dispose: () => {
      gtao.dispose();
      bloom.dispose();
      composer.dispose();
      target.dispose();
    },
  };
}
