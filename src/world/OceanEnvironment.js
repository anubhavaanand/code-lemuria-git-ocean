/**
 * Git Ocean — Ocean environment (deep-ocean, one floor)
 *
 * Builds the deep-ocean backdrop for a single seafloor world: water-column
 * gradient, surface light shafts (god rays), caustics on the sediment,
 * marine snow, and the distant ridgeline. Everything sits in one true 3D
 * volume above SEAFLOOR_Y, not in stacked 2.5D bands.
 *
 * Layer stack (back to front), all positioned in 3D space above the seafloor:
 *   gradient → farRidge → godRays → caustics → marineSnow → waterSurface
 */

import * as THREE from "three";
import { COLORS, LAYERS, SEAFLOOR_Y } from "./constants";
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
 * The whole deep-ocean environment: water gradient, god rays from the surface,
 * caustic floor light, marine snow, water surface seen from below, and the
 * distant ridgeline.
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
    this.buildFarRidge();
    this.buildGodRays();
    this.buildCaustics();
    this.buildMarineSnow();
    this.buildWaterSurface();
  }

  // -------------------------------------------------------------------------
  // Water column gradient — a full-screen backdrop plane behind everything.
  // Deep abyss at the bottom, lighter toward the surface. This gives the
  // scene its depth cue even where there's no geometry.
  // -------------------------------------------------------------------------
  buildGradient() {
    const geo = new THREE.PlaneGeometry(1, 1);
    const mat = new THREE.ShaderMaterial({
      // Opaque so it paints first and everything else draws on top.
      transparent: false,
      depthWrite: false,
      depthTest: false,
      uniforms: {
        uColorTop: { value: new THREE.Color(COLORS.surfaceGlow) },
        uColorMid: { value: new THREE.Color(COLORS.mid) },
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
          float d = vUv.y; // 0 at bottom (abyss), 1 at top (surface)

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
  // Far ridge — distant ridgeline silhouette at the back of the basin.
  // -------------------------------------------------------------------------
  buildFarRidge() {
    const geo = new THREE.PlaneGeometry(2600, 520);
    const mat = new THREE.ShaderMaterial({
      transparent: true,
      depthWrite: false,
      uniforms: {
        uColorTop: { value: new THREE.Color(COLORS.sediment) },
        uColorBottom: { value: new THREE.Color(COLORS.abyss) },
        uOpacity: { value: 0.75 },
      },
      vertexShader: ridgeVertex,
      fragmentShader: ridgeFragment,
    });

    this.farRidge = new THREE.Mesh(geo, mat);
    this.farRidge.position.set(0, 180, LAYERS.farRidge);
    this.farRidge.renderOrder = -880;
    this.group.add(this.farRidge);
    this.disposables.push(geo, mat);

    // Second, nearer ridge for parallax depth
    const geo2 = new THREE.PlaneGeometry(2200, 400);
    const mat2 = mat.clone();
    mat2.uniforms = THREE.UniformsUtils.clone(mat.uniforms);
    mat2.uniforms.uColorTop.value = new THREE.Color(0x0a121c);
    mat2.uniforms.uOpacity.value = 0.85;

    this.midRidge = new THREE.Mesh(geo2, mat2);
    this.midRidge.position.set(180, 140, LAYERS.farRidge + 260);
    this.midRidge.renderOrder = -870;
    this.group.add(this.midRidge);
    this.disposables.push(geo2, mat2);
  }

  // -------------------------------------------------------------------------
  // God rays — light shafts from the surface, filtering down through the
  // water column. Positioned far back so they read as distant surface light.
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
        uFloorY: { value: SEAFLOOR_Y },
      },
      vertexShader: godRaysVertex,
      fragmentShader: godRaysFragment,
    });

    this.godRays = new THREE.Mesh(geo, mat);
    this.godRays.position.set(0, 180, LAYERS.godRays);
    this.godRays.renderOrder = -860;
    this.group.add(this.godRays);
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
    this.caustics.position.set(0, SEAFLOOR_Y + 0.6, LAYERS.caustics);
    this.caustics.renderOrder = -840;
    this.group.add(this.caustics);
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
      positions[i * 3 + 1] = Math.random() * columnHeight;
      positions[i * 3 + 2] =
        LAYERS.marineSnow + (Math.random() - 0.5) * spreadZ;

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
        uFloorY: { value: SEAFLOOR_Y },
      },
      vertexShader: marineSnowVertex,
      fragmentShader: marineSnowFragment,
    });

    this.snow = new THREE.Points(geo, mat);
    this.snow.frustumCulled = false;
    this.snow.renderOrder = -700;
    this.snow.position.y = SEAFLOOR_Y;
    this.group.add(this.snow);
    this.disposables.push(geo, mat);
  }

  // -------------------------------------------------------------------------
  // Water surface — seen from below, at the top of the water column.
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
    this.waterSurface.position.set(0, 420, -600);
    this.waterSurface.renderOrder = -820;
    this.group.add(this.waterSurface);
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

    const disposed = new Set();
    const free = (res) => {
      if (!res || disposed.has(res)) return;
      disposed.add(res);
      res.dispose();
    };

    this.group.traverse((o) => {
      if (o.geometry) free(o.geometry);
      if (o.material) {
        if (Array.isArray(o.material)) {
          for (const m of o.material) free(m);
        } else {
          free(o.material);
        }
      }
    });

    for (const d of this.disposables) free(d);
  }
}

/**
 * Build the depth fog for a given zoom level.
 * Thicker fog at depth = you can't see as far, which is physically true
 * and also hides the edge of the world.
 *
 * The fog colour matters more than the density. COLORS.deep keeps distance
 * reading as "water" while letting the near floor keep its own colour.
 */
export function createFog(depth) {
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