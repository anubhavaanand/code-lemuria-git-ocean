/**
 * Git Ocean — Ocean environment
 *
 * Builds the layered 2.5D backdrop. Every layer sits at a real depth so fog
 * and parallax do the work of a 3D world without the cost.
 *
 * Layer stack (back to front), all at LAYERS[*] depth:
 *   caustics → godRays → farRidge → marineSnow → kelpForestFar
 *   → obelisk → ambientFar → whaleFar → kelpForestMid
 *   → creatures → seafloor → whaleNear → kelpForestNear
 *   → creaturesNear → ambientNear
 */

import * as THREE from "three";
import { COLORS, LAYERS } from "./constants";
import {
  causticsVertex,
  causticsFragment,
  godRaysVertex,
  godRaysFragment,
  waterSurfaceVertex,
  waterSurfaceFragment,
  marineSnowVertex,
  marineSnowFragment,
  ridgeVertex,
  ridgeFragment,
} from "./shaders";

/**
 * The whole environment: sky/water gradient, caustic floor, god rays,
 * surface seen from below, marine snow, and the distant ridge.
 */
export class OceanEnvironment {
  constructor(scene, opts = {}) {
    this.scene = scene;
    this.quality = opts.quality || "high";
    this.isMobile = opts.isMobile || false;
    this.group = new THREE.Group();
    this.group.name = "ocean-environment";
    scene.add(this.group);

    this.clock = 0;
    this.disposables = [];

    this.buildGradient();
    this.buildCaustics();
    this.buildGodRays();
    this.buildWaterSurface();
    this.buildMarineSnow();
    this.buildFarRidge();
    this.buildHorizon();
  }

  // -------------------------------------------------------------------------
  // Water column gradient — a full-screen backdrop plane far behind everything.
  // Deep blue at the bottom, lighter toward the surface. This is what gives the
  // scene its depth cue even where there's no geometry.
  // -------------------------------------------------------------------------
  buildGradient() {
    const geo = new THREE.PlaneGeometry(1, 1);
    const mat = new THREE.ShaderMaterial({
      // MUST stay opaque. A transparent full-screen quad lands in three.js's
      // transparent pass, which runs AFTER all opaque geometry and ignores
      // depth when depthTest is off — so it painted straight over the
      // seafloor, towers and rocks and the whole world went black below the
      // surface band. Opaque + renderOrder -1000 draws it first, then
      // everything else paints on top of it.
      transparent: false,
      depthWrite: false,
      depthTest: false,
      uniforms: {
        uColorTop: { value: new THREE.Color(COLORS.shallow) },
        uColorMid: { value: new THREE.Color(COLORS.deep) },
        uColorBottom: { value: new THREE.Color(COLORS.abyss) },
        uTime: { value: 0 },
      },
      vertexShader: /* glsl */ `
        varying vec2 vUv;
        void main() {
          vUv = uv;
          gl_Position = vec4(position.xy * 2.0, 0.9999, 1.0);
        }
      `,
      fragmentShader: /* glsl */ `
        precision highp float;
        uniform vec3 uColorTop;
        uniform vec3 uColorMid;
        uniform vec3 uColorBottom;
        uniform float uTime;
        varying vec2 vUv;

        float hash(vec2 p) {
          return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453);
        }

        void main() {
          float d = vUv.y; // 0 at bottom, 1 at top

          // Three-stop vertical gradient
          vec3 col = mix(uColorBottom, uColorMid, smoothstep(0.0, 0.55, d));
          col = mix(col, uColorTop, smoothstep(0.45, 1.0, d));

          // Subtle vertical banding, like light attenuating in layers
          col += sin(d * 42.0 + uTime * 0.05) * 0.004;

          // Dither to kill 8-bit banding in the large flat areas
          float n = hash(gl_FragCoord.xy) - 0.5;
          col += n * 0.012;

          gl_FragColor = vec4(col, 1.0);
        }
      `,
    });

    this.gradient = new THREE.Mesh(geo, mat);
    this.gradient.frustumCulled = false;
    this.gradient.renderOrder = -1000;
    this.group.add(this.gradient);
    this.disposables.push(geo, mat);
  }

  // -------------------------------------------------------------------------
  // Caustics — the moving light net on the seafloor, far behind the towers.
  // -------------------------------------------------------------------------
  buildCaustics() {
    const width = 1800;
    const depth = 1100;
    const geo = new THREE.PlaneGeometry(width, depth, 1, 1);
    const mat = new THREE.ShaderMaterial({
      transparent: true,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
      uniforms: {
        uTime: { value: 0 },
        uColorDeep: { value: new THREE.Color(COLORS.mid) },
        uColorCaustic: { value: new THREE.Color(COLORS.biolumCyan) },
        uIntensity: { value: 0.85 },
        uScale: { value: 0.021 },
        uOpacity: { value: 0.55 },
      },
      vertexShader: causticsVertex,
      fragmentShader: causticsFragment,
    });

    this.caustics = new THREE.Mesh(geo, mat);
    this.caustics.rotation.x = -Math.PI / 2;
    // Lies flat on the sediment, stretched back into the fog
    this.caustics.position.set(0, 0.6, LAYERS.caustics);
    this.caustics.renderOrder = -900;
    this.group.add(this.caustics);
    this.disposables.push(geo, mat);
  }

  // -------------------------------------------------------------------------
  // God rays — light shafts from the surface, in front of the far ridge.
  // -------------------------------------------------------------------------
  buildGodRays() {
    const geo = new THREE.PlaneGeometry(2400, 1400);
    const mat = new THREE.ShaderMaterial({
      transparent: true,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
      side: THREE.DoubleSide,
      uniforms: {
        uTime: { value: 0 },
        uColor: { value: new THREE.Color(COLORS.biolumCyan) },
        uIntensity: { value: 0.5 },
        uSurfaceY: { value: 420 },
        uFloorY: { value: 0 },
      },
      vertexShader: godRaysVertex,
      fragmentShader: godRaysFragment,
    });

    this.godRays = new THREE.Mesh(geo, mat);
    // Centred between the surface and the floor, sitting well behind the towers
    this.godRays.position.set(0, 150, LAYERS.godRays);
    this.godRays.renderOrder = -880;
    this.group.add(this.godRays);
    this.disposables.push(geo, mat);
  }

  // -------------------------------------------------------------------------
  // Water surface — seen from below, at the very top of the frame.
  // -------------------------------------------------------------------------
  buildWaterSurface() {
    const geo = new THREE.PlaneGeometry(3000, 1600, 90, 48);
    const mat = new THREE.ShaderMaterial({
      transparent: true,
      side: THREE.DoubleSide,
      depthWrite: false,
      uniforms: {
        uTime: { value: 0 },
        uColorShallow: { value: new THREE.Color(COLORS.surfaceGlow) },
        uColorDeep: { value: new THREE.Color(COLORS.mid) },
        uColorSpec: { value: new THREE.Color(0xbfefff) },
        uOpacity: { value: 0.5 },
      },
      vertexShader: waterSurfaceVertex,
      fragmentShader: waterSurfaceFragment,
    });

    this.waterSurface = new THREE.Mesh(geo, mat);
    this.waterSurface.rotation.x = Math.PI / 2;
    // The surface is ~400 units above the seafloor at this scale. Placing it
    // at 620 is what pushed it off the top of the frame at every zoom.
    this.waterSurface.position.set(0, 420, -600);
    this.waterSurface.renderOrder = -820;
    this.group.add(this.waterSurface);
    this.disposables.push(geo, mat);
  }

  // -------------------------------------------------------------------------
  // Marine snow — the constant fall of organic detritus. Real deep-sea food
  // source, and the single strongest depth cue in the scene.
  // -------------------------------------------------------------------------
  buildMarineSnow() {
    const isMobile = this.isMobile;
    const count = isMobile ? 700 : this.quality === "low" ? 1100 : 2400;
    const columnHeight = 560;
    const spreadX = 900;
    const spreadZ = 1400;

    const positions = new Float32Array(count * 3);
    const scales = new Float32Array(count);
    const phases = new Float32Array(count);
    const drifts = new Float32Array(count);

    for (let i = 0; i < count; i++) {
      positions[i * 3] = (Math.random() - 0.5) * spreadX;
      // Wrapped by the shader inside [0, columnHeight]
      positions[i * 3 + 1] = Math.random() * columnHeight;
      positions[i * 3 + 2] =
        LAYERS.marineSnow + (Math.random() - 0.5) * spreadZ;

      // A few large flakes, many tiny ones — real distribution
      const r = Math.random();
      scales[i] = r > 0.965 ? 1.8 + Math.random() * 1.6 : 0.35 + r * 0.85;
      phases[i] = Math.random() * Math.PI * 2;
      drifts[i] = 2 + Math.random() * 9;
    }

    const geo = new THREE.BufferGeometry();
    geo.setAttribute("position", new THREE.BufferAttribute(positions, 3));
    geo.setAttribute("aScale", new THREE.BufferAttribute(scales, 1));
    geo.setAttribute("aPhase", new THREE.BufferAttribute(phases, 1));
    geo.setAttribute("aDrift", new THREE.BufferAttribute(drifts, 1));
    geo.boundingSphere = new THREE.Sphere(new THREE.Vector3(0, 0, 0), 4000);

    const mat = new THREE.ShaderMaterial({
      transparent: true,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
      uniforms: {
        uTime: { value: 0 },
        uColor: { value: new THREE.Color(0xa8d8e8) },
        uPixelRatio: { value: Math.min(window.devicePixelRatio || 1, 2) },
        uSize: { value: 2.4 },
        uFallSpeed: { value: 6.0 },
        uColumnHeight: { value: 620 },
        uFloorY: { value: 0 },
      },
      vertexShader: marineSnowVertex,
      fragmentShader: marineSnowFragment,
    });

    this.snow = new THREE.Points(geo, mat);
    this.snow.frustumCulled = false;
    this.snow.renderOrder = -700;
    // The shader wraps particles over uColumnHeight starting from the seafloor
    this.snow.position.y = 0;
    this.group.add(this.snow);
    this.disposables.push(geo, mat);
  }

  // -------------------------------------------------------------------------
  // Far ridge — the distant landmass silhouette, dissolved into the fog.
  // Real geography inverted: mountain ranges become underwater ridges.
  // -------------------------------------------------------------------------
  buildFarRidge() {
    const geo = new THREE.PlaneGeometry(2600, 620);
    const mat = new THREE.ShaderMaterial({
      transparent: true,
      depthWrite: false,
      uniforms: {
        uColorTop: { value: new THREE.Color(COLORS.sediment) },
        uColorBottom: { value: new THREE.Color(COLORS.abyss) },
        uOpacity: { value: 0.82 },
      },
      vertexShader: ridgeVertex,
      fragmentShader: ridgeFragment,
    });

    this.farRidge = new THREE.Mesh(geo, mat);
    // Ridges are vertical silhouettes standing on the sediment
    this.farRidge.position.set(0, 200, LAYERS.farRidge);
    this.farRidge.renderOrder = -860;
    this.group.add(this.farRidge);
    this.disposables.push(geo, mat);

    // A second, nearer ridge for parallax depth
    const geo2 = new THREE.PlaneGeometry(2200, 460);
    const mat2 = mat.clone();
    mat2.uniforms = THREE.UniformsUtils.clone(mat.uniforms);
    mat2.uniforms.uColorTop.value = new THREE.Color(0x101820);
    mat2.uniforms.uOpacity.value = 0.9;

    this.midRidge = new THREE.Mesh(geo2, mat2);
    this.midRidge.position.set(160, 150, LAYERS.farRidge + 220);
    this.midRidge.renderOrder = -850;
    this.group.add(this.midRidge);
    this.disposables.push(geo2, mat2);
  }

  // -------------------------------------------------------------------------
  // Horizon haze — a soft band that seals the seam between the floor and the
  // open water, so nothing reads as a hard edge.
  // -------------------------------------------------------------------------
  buildHorizon() {
    const geo = new THREE.PlaneGeometry(3000, 420);
    const mat = new THREE.ShaderMaterial({
      transparent: true,
      depthWrite: false,
      uniforms: {
        uColor: { value: new THREE.Color(COLORS.deep) },
        uOpacity: { value: 0.95 },
      },
      vertexShader: /* glsl */ `
        varying vec2 vUv;
        void main() {
          vUv = uv;
          gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
        }
      `,
      fragmentShader: /* glsl */ `
        precision highp float;
        uniform vec3 uColor;
        uniform float uOpacity;
        varying vec2 vUv;
        void main() {
          // Solid at the bottom, feathering out at the top
          float a = smoothstep(0.0, 0.85, vUv.y);
          gl_FragColor = vec4(uColor, (1.0 - a) * uOpacity);
        }
      `,
    });

    this.horizon = new THREE.Mesh(geo, mat);
    // Sits low, right on the sediment, sealing the floor/wall seam
    this.horizon.position.set(0, 90, LAYERS.farRidge - 40);
    this.horizon.renderOrder = -890;
    this.group.add(this.horizon);
    this.disposables.push(geo, mat);
  }

  // -------------------------------------------------------------------------
  // Per-frame update
  // -------------------------------------------------------------------------
  update(delta, elapsed) {
    this.clock = elapsed;

    if (this.gradient) {
      this.gradient.material.uniforms.uTime.value = elapsed;
    }
    if (this.caustics) {
      this.caustics.material.uniforms.uTime.value = elapsed;
    }
    if (this.godRays) {
      this.godRays.material.uniforms.uTime.value = elapsed;
      // Slow breathing of the light shafts
      this.godRays.material.uniforms.uIntensity.value =
        0.42 + Math.sin(elapsed * 0.21) * 0.1 + Math.sin(elapsed * 0.07) * 0.06;
    }
    if (this.waterSurface) {
      this.waterSurface.material.uniforms.uTime.value = elapsed;
    }
    if (this.snow) {
      this.snow.material.uniforms.uTime.value = elapsed;
    }
  }

  setFogDensity(density) {
    if (this.scene && this.scene.fog) {
      this.scene.fog.density = density;
    }
  }

  dispose() {
    this.scene.remove(this.group);
    this.group.traverse((o) => {
      if (o.geometry) o.geometry.dispose();
      if (o.material) {
        if (Array.isArray(o.material)) o.material.forEach((m) => m.dispose());
        else o.material.dispose();
      }
    });
    this.disposables.forEach((d) => d.dispose && d.dispose());
  }
}

/**
 * Build the depth fog for a given zoom level.
 * Thicker fog at depth = you can't see as far, which is physically true
 * and also hides the edge of the world.
 *
 * The fog colour matters more than the density. Using COLORS.mid here washed
 * the whole seafloor to a flat mid-blue once the gradient started rendering:
 * everything past ~200 units converged on the fog colour and the sediment
 * texture disappeared. COLORS.deep keeps distance reading as "water" while
 * letting the near floor keep its own colour.
 */
export function createFog(depth) {
  // Fog density scales with depth — deeper water scatters more light
  const t = Math.min(1, Math.abs(depth) / 4000);
  const density = 0.0006 + t * 0.0018;
  return new THREE.FogExp2(COLORS.deep, density);
}

/** Background colour for a given depth — darker as you go down. */
export function depthBackground(depth) {
  const t = Math.min(1, Math.abs(depth) / 5000);
  const col = new THREE.Color(COLORS.deep);
  col.lerp(new THREE.Color(COLORS.abyss), t);
  return col;
}