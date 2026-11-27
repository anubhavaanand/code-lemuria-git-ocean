/**
 * Git Ocean — GLSL shaders
 *
 * All effects are physically motivated, per the project's scientific accuracy rule:
 *  - Caustics: refraction of surface light through moving water — real optical phenomenon
 *  - God rays: light scattered by suspended particulates in the water column
 *  - Water surface: sum of directional waves with Fresnel reflectance
 *  - Marine snow: constant fall of organic detritus, real deep-sea food source
 */

// ---------------------------------------------------------------------------
// Shared noise helpers (Ashima / Stefan Gustavson simplex noise, 2D)
// ---------------------------------------------------------------------------

const SIMPLEX_2D = /* glsl */ `
vec3 permute289(vec3 x) { return mod(((x * 34.0) + 1.0) * x, 289.0); }
float snoise(vec2 v) {
  const vec4 C = vec4(0.211324865405187, 0.366025403784439, -0.577350269189626, 0.024390243902439);
  vec2 i  = floor(v + dot(v, C.yy));
  vec2 x0 = v - i + dot(i, C.xx);
  vec2 i1 = (x0.x > x0.y) ? vec2(1.0, 0.0) : vec2(0.0, 1.0);
  vec4 x12 = x0.xyxy + C.xxzz;
  x12.xy -= i1;
  i = mod(i, 289.0);
  vec3 p = permute289(permute289(i.y + vec3(0.0, i1.y, 1.0)) + i.x + vec3(0.0, i1.x, 1.0));
  vec3 m = max(0.5 - vec3(dot(x0, x0), dot(x12.xy, x12.xy), dot(x12.zw, x12.zw)), 0.0);
  m = m * m; m = m * m;
  vec3 x = 2.0 * fract(p * C.www) - 1.0;
  vec3 h = abs(x) - 0.5;
  vec3 ox = floor(x + 0.5);
  vec3 a0 = x - ox;
  m *= 1.79284291400159 - 0.85373472095314 * (a0 * a0 + h * h);
  vec3 g;
  g.x = a0.x * x0.x + h.x * x0.y;
  g.yz = a0.yz * x12.xz + h.yz * x12.yw;
  return 130.0 * dot(m, g);
}
`;

// ---------------------------------------------------------------------------
// Caustics — projected onto the seafloor far behind the towers.
// Two octaves of animated simplex noise, thresholded into thin bright filaments.
// ---------------------------------------------------------------------------

export const causticsVertex = /* glsl */ `
varying vec2 vUv;
varying vec3 vWorldPos;
void main() {
  vUv = uv;
  vec4 world = modelMatrix * vec4(position, 1.0);
  vWorldPos = world.xyz;
  gl_Position = projectionMatrix * viewMatrix * world;
}
`;

export const causticsFragment = /* glsl */ `
precision highp float;
uniform float uTime;
uniform vec3  uColorDeep;
uniform vec3  uColorCaustic;
uniform float uIntensity;
uniform float uScale;
uniform float uOpacity;
varying vec2 vUv;
varying vec3 vWorldPos;

${SIMPLEX_2D}

// One layer of caustic filaments
float causticLayer(vec2 p, float t) {
  float n = 0.0;
  n += snoise(p * 1.0 + vec2(t * 0.19, t * 0.13));
  n += snoise(p * 2.03 - vec2(t * 0.11, t * 0.23)) * 0.5;
  n += snoise(p * 4.07 + vec2(t * 0.31, -t * 0.17)) * 0.25;
  // Caustics are the bright ridges between wave nodes — sharpen them
  float ridges = 1.0 - abs(n);
  return pow(ridges, 7.0);
}

void main() {
  vec2 p = vWorldPos.xz * uScale;
  float t = uTime;

  float c = 0.0;
  c += causticLayer(p, t);
  c += causticLayer(p * 1.7 + vec2(4.3, 1.7), t * 1.31) * 0.6;
  c += causticLayer(p * 0.6 - vec2(9.1, 3.3), t * 0.77) * 0.4;

  // Fade caustics out with distance from camera so the far field goes quiet
  float distFade = 1.0 - smoothstep(180.0, 460.0, length(vWorldPos.xz - cameraPosition.xz));

  vec3 col = mix(uColorDeep, uColorCaustic, clamp(c, 0.0, 1.0));
  float alpha = clamp(c * uIntensity, 0.0, 1.0) * uOpacity * distFade;

  gl_FragColor = vec4(col, alpha);
}
`;

// ---------------------------------------------------------------------------
// God rays — vertical light shafts descending from the surface.
// Rendered as a screen-aligned plane in front of the far ridge.
// ---------------------------------------------------------------------------

export const godRaysVertex = /* glsl */ `
varying vec2 vUv;
void main() {
  vUv = uv;
  gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
}
`;

export const godRaysFragment = /* glsl */ `
precision highp float;
uniform float uTime;
uniform vec3  uColor;
uniform float uIntensity;
uniform float uSurfaceY;
uniform float uFloorY;
varying vec2 vUv;

${SIMPLEX_2D}

void main() {
  vec2 uv = vUv;

  // Rays are vertical bands, strongest near the surface, fading into depth
  float depth = 1.0 - uv.y; // 0 at top, 1 at bottom

  float rays = 0.0;
  float x = uv.x * 9.0;
  rays += snoise(vec2(x, uTime * 0.045)) * 0.55;
  rays += snoise(vec2(x * 2.13 + 11.0, uTime * 0.072)) * 0.30;
  rays += snoise(vec2(x * 4.31 - 5.0, uTime * 0.031)) * 0.15;

  // Sharpen into shafts
  rays = pow(max(rays, 0.0), 2.6);

  // Fade with depth, and soften the edges of the frame
  float depthFade = exp(-depth * 2.4);
  float edgeFade = smoothstep(0.0, 0.16, uv.x) * (1.0 - smoothstep(0.84, 1.0, uv.x));

  float alpha = rays * depthFade * edgeFade * uIntensity;
  gl_FragColor = vec4(uColor, alpha);
}
`;

// ---------------------------------------------------------------------------
// Water surface — seen from below. Sum of directional waves + Fresnel.
// ---------------------------------------------------------------------------

export const waterSurfaceVertex = /* glsl */ `
uniform float uTime;
varying vec2 vUv;
varying vec3  vWorldPos;
varying float vWave;

float waveHeight(vec2 p, float t) {
  float h = 0.0;
  h += sin(p.x * 0.34 + t * 0.80) * 0.55;
  h += sin(p.y * 0.27 - t * 0.62) * 0.45;
  h += sin((p.x + p.y) * 0.19 + t * 1.10) * 0.30;
  h += sin((p.x - p.y) * 0.51 - t * 1.45) * 0.16;
  return h;
}

void main() {
  vUv = uv;
  vec3 pos = position;
  vec4 world = modelMatrix * vec4(pos, 1.0);
  float h = waveHeight(world.xz, uTime);
  world.y += h;
  vWave = h;
  vWorldPos = world.xyz;
  gl_Position = projectionMatrix * viewMatrix * world;
}
`;

export const waterSurfaceFragment = /* glsl */ `
precision highp float;
uniform float uTime;
uniform vec3  uColorShallow;
uniform vec3  uColorDeep;
uniform vec3  uColorSpec;
uniform float uOpacity;
varying vec2 vUv;
varying vec3  vWorldPos;
varying float vWave;

${SIMPLEX_2D}

void main() {
  // Animated ripple normals from noise derivatives
  float e = 0.35;
  float n  = snoise(vWorldPos.xz * 0.25 + vec2(uTime * 0.20, uTime * 0.13));
  float nx = snoise(vWorldPos.xz * 0.25 + vec2(e, 0.0) + vec2(uTime * 0.20, uTime * 0.13));
  float nz = snoise(vWorldPos.xz * 0.25 + vec2(0.0, e) + vec2(uTime * 0.20, uTime * 0.13));

  vec3 normal = normalize(vec3((n - nx) * 2.2, 1.0, (n - nz) * 2.2));

  // Fresnel: looking up through water, grazing angles reflect more
  vec3 viewDir = normalize(cameraPosition - vWorldPos);
  float fres = pow(1.0 - clamp(dot(viewDir, normal), 0.0, 1.0), 2.4);

  vec3 col = mix(uColorDeep, uColorShallow, clamp(vWave * 0.4 + 0.5, 0.0, 1.0));
  col = mix(col, uColorSpec, fres * 0.75);

  // Bright shimmer where the surface catches the light
  float shimmer = pow(max(0.0, n * 0.5 + 0.5), 4.0);
  col += uColorSpec * shimmer * 0.35;

  gl_FragColor = vec4(col, uOpacity + fres * 0.22);
}
`;

// ---------------------------------------------------------------------------
// Marine snow — GPU-instanced points drifting down through the water column.
// ---------------------------------------------------------------------------

export const marineSnowVertex = /* glsl */ `
uniform float uTime;
uniform float uPixelRatio;
uniform float uSize;
uniform float uFallSpeed;
uniform float uColumnHeight;
attribute float aScale;
attribute float aPhase;
attribute float aDrift;
varying float vTwinkle;

void main() {
  vec3 p = position;

  // Fall slowly, wrap around the top of the column
  float fall = mod(p.y - uTime * uFallSpeed * aScale, uColumnHeight);
  p.y = fall;

  // Gentle lateral drift, like real detritus in a current
  p.x += sin(uTime * 0.21 + aPhase) * aDrift;
  p.z += cos(uTime * 0.17 + aPhase * 1.7) * aDrift * 0.6;

  vec4 mv = modelViewMatrix * vec4(p, 1.0);
  gl_Position = projectionMatrix * mv;

  // Perspective-correct point size
  gl_PointSize = uSize * aScale * uPixelRatio * (240.0 / -mv.z);

  // Twinkle as particles catch the light
  vTwinkle = 0.45 + 0.55 * sin(uTime * 1.1 + aPhase * 6.28);
}
`;

export const marineSnowFragment = /* glsl */ `
precision highp float;
uniform vec3  uColor;
uniform float uOpacity;
varying float vTwinkle;

void main() {
  // Round soft particle, brightest at the centre
  vec2 c = gl_PointCoord - 0.5;
  float d = length(c);
  if (d > 0.5) discard;
  float alpha = smoothstep(0.5, 0.02, d) * vTwinkle * uOpacity;
  gl_FragColor = vec4(uColor, alpha);
}
`;

// ---------------------------------------------------------------------------
// Kelp sway — vertex shader. Real kelp bends with the current; the stipe
// flexes more toward the blade, and the whole plant sways as one body.
// ---------------------------------------------------------------------------

export const kelpVertex = /* glsl */ `
uniform float uTime;
uniform float uSwayAmount;
uniform float uSwaySpeed;
uniform float uHeight;
uniform float uPhase;
varying vec2 vUv;
varying float vFlex;

void main() {
  vUv = uv;
  vec3 p = position;

  // Normalised height along the stipe: 0 at the holdfast, 1 at the canopy
  float h = clamp(p.y / max(uHeight, 0.001), 0.0, 1.0);
  vFlex = h;

  // Cantilever bending: deflection grows with the square of height
  float bend = h * h;
  float s = sin(uTime * uSwaySpeed + uPhase);
  float s2 = sin(uTime * uSwaySpeed * 0.53 + uPhase * 1.7);

  p.x += s * uSwayAmount * bend;
  p.z += s2 * uSwayAmount * bend * 0.65;

  // Slight vertical shortening as the plant bends over (arc-length conservation)
  p.y -= bend * uSwayAmount * 0.12;

  gl_Position = projectionMatrix * modelViewMatrix * vec4(p, 1.0);
}
`;

export const kelpFragment = /* glsl */ `
precision highp float;
uniform vec3  uColorBase;
uniform vec3  uColorTip;
uniform vec3  uColorGlow;
uniform float uGlowStrength;
uniform float uOpacity;
varying vec2 vUv;
varying float vFlex;

void main() {
  // Base is darker and browner; the canopy is lit and green
  vec3 col = mix(uColorBase, uColorTip, pow(vFlex, 0.75));

  // Photosynthetic glow at the canopy, where light reaches
  col += uColorGlow * pow(vFlex, 3.0) * uGlowStrength;

  // Slight translucency at the very top of the blade
  float alpha = uOpacity * mix(0.82, 1.0, vFlex);

  gl_FragColor = vec4(col, alpha);
}
`;

// ---------------------------------------------------------------------------
// Whale skin — procedural counter-shading. Real cetaceans are dark above and
// pale below; this avoids any texture asset while reading as a real animal.
// ---------------------------------------------------------------------------

export const whaleSkinVertex = /* glsl */ `
varying vec3 vNormalW;
varying vec3 vPosL;
varying vec3 vWorld;
varying vec2 vUv;
void main() {
  vUv = uv;
  vPosL = position;
  vNormalW = normalize(mat3(modelMatrix) * normal);
  vec4 world = modelMatrix * vec4(position, 1.0);
  vWorld = world.xyz;
  gl_Position = projectionMatrix * viewMatrix * world;
}
`;

export const whaleSkinFragment = /* glsl */ `
precision highp float;
uniform vec3  uColorDorsal;
uniform vec3  uColorLateral;
uniform vec3  uColorVentral;
uniform vec3  uColorScar;
uniform float uScarAmount;
uniform float uTime;
uniform vec3  uSpecColor;
uniform float uSpecStrength;
uniform float uSubsurface;
uniform vec3  uSubsurfaceColor;
varying vec3 vNormalW;
varying vec3 vPosL;
varying vec3 vWorld;
varying vec2 vUv;

${SIMPLEX_2D}

void main() {
  // Counter-shading driven by the world-space normal's vertical component
  float upness = clamp(vNormalW.y * 0.5 + 0.5, 0.0, 1.0);
  vec3 col = mix(uColorVentral, uColorLateral, smoothstep(0.25, 0.55, upness));
  col = mix(col, uColorDorsal, smoothstep(0.55, 0.92, upness));

  // Mottled skin texture — real whale skin is never a flat colour
  float mottle = snoise(vPosL.xz * 3.4 + vPosL.y * 2.1) * 0.5 + 0.5;
  col *= 0.92 + mottle * 0.16;

  // Scars and rake marks, concentrated on the dorsal surface
  float scarNoise = snoise(vPosL.xy * 9.0) * 0.5 + 0.5;
  float scar = smoothstep(0.80, 0.94, scarNoise) * uScarAmount * upness;
  col = mix(col, uColorScar, scar * 0.55);

  // ---- Form shading -------------------------------------------------------
  //
  // This material is deliberately NOT a lit material: it is a ShaderMaterial so
  // that every repo's skin colour can be authored directly. But an unlit shader
  // outputs a constant colour per pixel, and a constant colour on a curved body
  // reads as a flat silhouette — which is exactly what the first visual QA pass
  // reported: "blocky low-poly blob, no body, no head". So the shading is done
  // here, with a fixed three-light rig that mimics the scene's own (sun above,
  // cold bounce below, soft front fill). Nothing needs a light in the scene.
  vec3 n = normalize(vNormalW);

  // Key light from above and slightly ahead, matching the scene sun.
  vec3 keyDir = normalize(vec3(-0.34, 0.90, 0.28));
  float key = max(dot(n, keyDir), 0.0);

  // Cold bounce from the water below — this is what keeps the belly from
  // going to pure black and is what real underwater footage actually looks like.
  vec3 bounceDir = normalize(vec3(0.25, -0.92, -0.30));
  float bounce = max(dot(n, bounceDir), 0.0);

  // Wrap term: water scatters light, so the terminator is soft, not hard.
  float wrap = clamp((dot(n, keyDir) + 0.45) / 1.45, 0.0, 1.0);
  float lightAmount = 0.30 + wrap * 0.62 + bounce * 0.24;

  col *= lightAmount;
  col += uColorLateral * bounce * 0.10;

  // Rim: a thin bright edge where the body turns away from the viewer. This is
  // the single strongest readability cue — it separates the animal from the
  // water column at any size, and it is a real optical effect (forward
  // scattering through the thin edge of a body).
  vec3 viewDir = normalize(cameraPosition - vWorld.xyz);
  float rim = 1.0 - max(dot(n, viewDir), 0.0);
  rim = pow(rim, 3.2);
  col += uColorVentral * rim * 0.42;

  // ---- Wet specular highlight ---------------------------------------------
  // Real whale skin is oily and wet: a tight specular lobe where the key light
  // glances off the surface. This single highlight sells "wet animal" more than
  // any other effect.
  vec3 reflectDir = reflect(-keyDir, n);
  float spec = pow(max(dot(viewDir, reflectDir), 0.0), 32.0);
  col += uSpecColor * spec * uSpecStrength;

  // ---- Subsurface scattering approximation ---------------------------------
  // Light penetrates thin skin and glows from within, strongest where the body
  // is thin (flukes, fluke notch, around the eye) and where the normal points
  // toward the light. This reads as living tissue, not plastic.
  float ss = pow(max(dot(n, keyDir), 0.0), 2.0);
  ss = ss * (1.0 - upness * 0.5); // stronger on the side/belly, not the dark back
  col += uSubsurfaceColor * ss * uSubsurface;

  gl_FragColor = vec4(col, 1.0);
}
`;

// ---------------------------------------------------------------------------
// Bioluminescent creature — soft glowing body with a brighter core.
// ---------------------------------------------------------------------------

export const biolumVertex = /* glsl */ `
uniform float uTime;
uniform float uPhase;
varying vec3 vNormalV;
varying vec3 vViewDir;
varying float vPulse;
void main() {
  vNormalV = normalize(normalMatrix * normal);
  vec4 mv = modelViewMatrix * vec4(position, 1.0);
  vViewDir = normalize(-mv.xyz);
  vPulse = 0.65 + 0.35 * sin(uTime * 1.6 + uPhase);
  gl_Position = projectionMatrix * mv;
}
`;

export const biolumFragment = /* glsl */ `
precision highp float;
uniform vec3  uColor;
uniform vec3  uCoreColor;
uniform float uIntensity;
uniform float uOpacity;
varying vec3 vNormalV;
varying vec3 vViewDir;
varying float vPulse;

void main() {
  // Fresnel rim — thin bright edge, like a real bioluminescent photophore
  float fres = pow(1.0 - clamp(dot(vNormalV, vViewDir), 0.0, 1.0), 2.2);

  vec3 col = mix(uColor, uCoreColor, vPulse * 0.55);
  float alpha = (fres * 0.85 + 0.15) * uOpacity * uIntensity * vPulse;

  gl_FragColor = vec4(col * (0.7 + vPulse * 0.6), alpha);
}
`;

// ---------------------------------------------------------------------------
// Silhouette ridge — distant landmass dissolved into the fog.
// ---------------------------------------------------------------------------

export const ridgeVertex = /* glsl */ `
varying vec2 vUv;
varying vec3 vWorldPos;
void main() {
  vUv = uv;
  vec4 world = modelMatrix * vec4(position, 1.0);
  vWorldPos = world.xyz;
  gl_Position = projectionMatrix * viewMatrix * world;
}
`;

export const ridgeFragment = /* glsl */ `
precision highp float;
uniform vec3  uColorTop;
uniform vec3  uColorBottom;
uniform float uOpacity;
varying vec2 vUv;
varying vec3 vWorldPos;

${SIMPLEX_2D}

void main() {
  // Ridgeline profile from layered noise, sampled along X
  float ridge = 0.0;
  ridge += snoise(vec2(vWorldPos.x * 0.006, 0.0)) * 0.50;
  ridge += snoise(vec2(vWorldPos.x * 0.017, 12.0)) * 0.28;
  ridge += snoise(vec2(vWorldPos.x * 0.043, 31.0)) * 0.14;
  ridge += snoise(vec2(vWorldPos.x * 0.091, 57.0)) * 0.08;
  ridge = ridge * 0.5 + 0.5;

  // The mask: solid below the ridge line, dissolving above it
  float ridgeLine = 0.24 + ridge * 0.62;
  float mask = 1.0 - smoothstep(ridgeLine - 0.015, ridgeLine + 0.02, vUv.y);

  // Vertical gradient within the landmass
  vec3 col = mix(uColorBottom, uColorTop, smoothstep(0.0, ridgeLine, vUv.y));

  // Aerial perspective: the far ridge is barely there
  gl_FragColor = vec4(col, mask * uOpacity);
}
`;