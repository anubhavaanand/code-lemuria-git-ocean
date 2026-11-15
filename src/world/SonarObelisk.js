/**
 * Git Ocean — Sonar Obelisk
 *
 * The landmark of every capital cluster. A silicon wafer obelisk: a real
 * semiconductor slice, mirror-polished and stacked — the one piece of land
 * technology that is literally cut from sand, standing on the seafloor as
 * the community's marker.
 *
 *   height      ← total repositories in the cluster
 *   width       ← total contributions
 *   glow        ← recent activity
 *   colour      ← dominant language
 *   base        ← metro entrance (Phase 2)
 *   sonar rings ← activity pulses, emitted on a slow cycle
 *   wafer bands ← wafer refinement stages (raw ore at the base, polished up top)
 */

import * as THREE from "three";
import { COLORS, SEAFLOOR_Y } from "./constants";
import { languageStyleColor } from "./constants";
import { stationPosition } from "./worldData";

export class SonarObelisk {
  /**
   * @param {object} cluster  from worldData.CAPITAL_CLUSTERS
   * @param {object} opts
   */
  constructor(cluster, opts = {}) {
    this.cluster = cluster;
    this.quality = opts.quality || "high";
    this.isMobile = opts.isMobile || false;

    this.group = new THREE.Group();
    this.group.name = `obelisk:${cluster.id}`;

    this.time = 0;
    this.sonarRings = [];
    this.sonarTimer = 0;

    this.build();
  }

  build() {
    const c = this.cluster;

    // Height from total repos, width from contributions — log-scaled so a
    // mega-cluster reads as tall without dwarfing everything.
    const height = THREE.MathUtils.clamp(Math.log10((c.repos || 100) + 10) * 22, 18, 62);
    const width = THREE.MathUtils.clamp(Math.log10((c.contributions || 1000) + 10) * 3.4, 3, 12);

    this.height = height;
    this.width = width;

    const langColor = languageStyleColor(c.dominantLanguage);
    this.langColor = new THREE.Color(langColor);

    this.buildBase(width);
    this.buildShaft(height, width);
    this.buildWaferBands(height, width);
    this.buildGlow(height, width);
    this.buildBeacon(height, width);
  }

  // -------------------------------------------------------------------------
  // Base — the metro entrance. A pressure-vessel collar of raw silicon.
  // -------------------------------------------------------------------------
  buildBase(width) {
    const geo = new THREE.CylinderGeometry(width * 1.5, width * 1.8, width * 0.9, 24, 1, false);
    const mat = new THREE.MeshStandardMaterial({
      color: COLORS.waferRaw,
      roughness: 0.92,
      metalness: 0.18,
      flatShading: true,
    });

    this.base = new THREE.Mesh(geo, mat);
    this.base.position.y = width * 0.45;
    this.base.receiveShadow = true;
    this.group.add(this.base);

    // Tube mouth — the metro boarding point. Dark opening facing the viewer.
    const mouthGeo = new THREE.TorusGeometry(width * 0.95, width * 0.16, 8, 20);
    const mouthMat = new THREE.MeshStandardMaterial({
      color: COLORS.waferEdge,
      roughness: 0.6,
      metalness: 0.5,
    });
    this.mouth = new THREE.Mesh(mouthGeo, mouthMat);
    this.mouth.position.set(0, width * 0.42, width * 1.62);
    this.mouth.rotation.x = Math.PI * 0.5;
    this.group.add(this.mouth);

    // Pressure collar rings — a real pressure vessel has bolted flanges
    const ringCount = this.isMobile ? 2 : 3;
    for (let i = 0; i < ringCount; i++) {
      const rGeo = new THREE.TorusGeometry(
        width * (1.5 - i * 0.1),
        width * 0.055,
        5,
        20
      );
      const rMat = new THREE.MeshStandardMaterial({
        color: COLORS.waferEdge,
        roughness: 0.5,
        metalness: 0.6,
      });
      const ring = new THREE.Mesh(rGeo, rMat);
      ring.rotation.x = Math.PI / 2;
      ring.position.y = width * (0.22 + i * 0.28);
      this.group.add(ring);
    }
  }

  // -------------------------------------------------------------------------
  // Shaft — the wafer stack. Each band is a wafer: mirror-polished, thin,
  // slightly wider at the bottom where the ore is raw.
  // -------------------------------------------------------------------------
  buildShaft(height, width) {
    const bands = this.isMobile ? 9 : this.quality === "low" ? 13 : 18;
    this.bandCount = bands;
    this.bands = [];

    const usable = height - width * 0.9;
    const bandH = usable / bands;

    for (let i = 0; i < bands; i++) {
      const t = i / (bands - 1);

      // Wafer tapering: full width at the base, ~62% at the tip
      const r = width * (1.0 - t * 0.38);
      const geo = new THREE.CylinderGeometry(r, r * 1.03, bandH * 0.86, 20, 1, false);
      const mat = new THREE.MeshStandardMaterial({
        color: new THREE.Color().copy(COLORS.waferEdge).lerp(new THREE.Color(COLORS.waferMirror), t),
        roughness: 0.14 + t * 0.12,
        metalness: 0.72,
        emissive: this.langColor.clone().multiplyScalar(0.14 * t),
        emissiveIntensity: 0.6,
      });
      const band = new THREE.Mesh(geo, mat);
      band.position.y = width * 0.9 + bandH * i + bandH * 0.5;
      band.castShadow = true;
      band.receiveShadow = true;
      this.group.add(band);
      this.bands.push(band);
    }

    // Thin cut lines between wafers — the saw marks of the dicing process
    const lineGeo = new THREE.CylinderGeometry(width * 1.04, width * 1.04, bandH * 0.05, 20, 1, true);
    const lineMat = new THREE.MeshBasicMaterial({
      color: 0x0a1622,
      transparent: true,
      opacity: 0.55,
      side: THREE.DoubleSide,
    });
    this.dicing = new THREE.InstancedMesh(lineGeo, lineMat, bands);
    const m = new THREE.Matrix4();
    for (let i = 0; i < bands; i++) {
      const t = i / (bands - 1);
      const r = width * (1.0 - t * 0.38) * 1.01;
      m.compose(
        new THREE.Vector3(0, width * 0.9 + bandH * i + bandH * 0.5, 0),
        new THREE.Quaternion(),
        new THREE.Vector3(r / (width * 1.04), 1, r / (width * 1.04))
      );
      this.dicing.setMatrixAt(i, m);
    }
    this.dicing.instanceMatrix.needsUpdate = true;
    this.group.add(this.dicing);
  }

  // -------------------------------------------------------------------------
  // Wafer refinement — the raw→mirror gradient is the "silicon value chain"
  // made visible: the obelisk is literally built out of refinement stages.
  // -------------------------------------------------------------------------
  buildWaferBands(height, width) {
    const t = this.time;
    for (let i = 0; i < this.bands.length; i++) {
      const k = i / (this.bands.length - 1);
      const mat = this.bands[i].material;
      mat.emissiveIntensity = 0.4 + Math.sin(t * 0.8 + k * 4.0) * 0.18 + k * 0.5;
    }
  }

  // -------------------------------------------------------------------------
  // Glow — activity of the cluster. Recently active clusters glow harder.
  // -------------------------------------------------------------------------
  buildGlow(height, width) {
    const strength = THREE.MathUtils.clamp((this.cluster.glow || 0.5), 0, 1);

    const geo = new THREE.SphereGeometry(width * 2.2, 16, 12);
    const mat = new THREE.MeshBasicMaterial({
      color: this.langColor,
      transparent: true,
      opacity: 0.05 + strength * 0.09,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
    });

    this.glowMesh = new THREE.Mesh(geo, mat);
    this.glowMesh.position.y = height * 0.62;
    this.glowMesh.scale.set(1, 1.9, 1);
    this.group.add(this.glowMesh);
    this.glowStrength = strength;

    // An inner point light so the wafer edges catch a language-coloured rim
    const light = new THREE.PointLight(this.langColor, 2.2 + strength * 3, width * 26, 2);
    light.position.set(0, height * 0.62, 0);
    this.group.add(light);
    this.light = light;
  }

  // -------------------------------------------------------------------------
  // Beacon — a hard light at the tip, visible from the country zoom level.
  // -------------------------------------------------------------------------
  buildBeacon(height, width) {
    const geo = new THREE.SphereGeometry(width * 0.22, 10, 8);
    const mat = new THREE.MeshBasicMaterial({ color: 0xdff4ff });
    this.beacon = new THREE.Mesh(geo, mat);
    this.beacon.position.y = height + width * 0.3;
    this.group.add(this.beacon);

    const haloGeo = new THREE.SphereGeometry(width * 0.7, 12, 10);
    const haloMat = new THREE.MeshBasicMaterial({
      color: 0xbfe6ff,
      transparent: true,
      opacity: 0.14,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
    });
    this.halo = new THREE.Mesh(haloGeo, haloMat);
    this.halo.position.copy(this.beacon.position);
    this.group.add(this.halo);

    this.beaconBase = this.beacon.position.y;
    this.haloBaseScale = 1;
  }

  // -------------------------------------------------------------------------
  // Sonar rings — the actual sonar pulse. A real sonar array emits expanding
  // rings; here the ring rate follows cluster activity, so a busy hub "pings"
  // more often.
  // -------------------------------------------------------------------------
  spawnSonarRing() {
    const geo = new THREE.RingGeometry(0.86, 1.0, 64);
    const mat = new THREE.MeshBasicMaterial({
      color: this.langColor,
      transparent: true,
      opacity: 0.55,
      side: THREE.DoubleSide,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
    });

    const ring = new THREE.Mesh(geo, mat);
    ring.rotation.x = -Math.PI / 2;
    ring.position.y = this.width * 1.1;
    ring.userData.life = 0;
    ring.userData.maxLife = 2.6 + (this.cluster.glow || 0.5) * 1.4;
    this.group.add(ring);
    this.sonarRings.push(ring);

    // Cap concurrent rings — on low quality, fewer
    const maxRings = this.isMobile ? 3 : 6;
    while (this.sonarRings.length > maxRings) {
      const old = this.sonarRings.shift();
      this.group.remove(old);
      old.geometry.dispose();
      old.material.dispose();
    }
  }

  update(delta, elapsed) {
    this.time = elapsed != null ? elapsed : this.time + delta;

    // Wafer shimmer
    this.buildWaferBands(this.height, this.width);

    // Sonar ping interval — busier clusters ping faster
    const glow = this.cluster.glow || 0.5;
    const interval = 3.4 - glow * 2.1;
    this.sonarTimer += delta;
    if (this.sonarTimer >= interval) {
      this.sonarTimer = 0;
      this.spawnSonarRing();
    }

    // Expand and fade the rings
    for (let i = this.sonarRings.length - 1; i >= 0; i--) {
      const ring = this.sonarRings[i];
      ring.userData.life += delta;
      const k = ring.userData.life / ring.userData.maxLife;

      if (k >= 1) {
        this.group.remove(ring);
        ring.geometry.dispose();
        ring.material.dispose();
        this.sonarRings.splice(i, 1);
        continue;
      }

      // Sonar in water spreads fast then slows as pressure equalises
      const spread = 1 - Math.pow(1 - k, 2.4);
      const scale = this.width * 2 + spread * this.width * 34;
      ring.scale.setScalar(scale);
      ring.material.opacity = 0.55 * Math.pow(1 - k, 1.7);
    }

    // Beacon pulse — a slow breath, so the landmark is findable at distance
    const pulse = 0.5 + Math.sin(this.time * 1.15) * 0.5;
    if (this.beacon) {
      this.beacon.scale.setScalar(0.85 + pulse * 0.4);
      this.halo.scale.setScalar(1 + pulse * 0.55);
      this.halo.material.opacity = 0.07 + pulse * 0.14;
    }

    // Glow breathes with the same pulse
    if (this.glowMesh) {
      const b = 1 + Math.sin(this.time * 0.55) * 0.07;
      this.glowMesh.scale.set(b, 1.9 * b, b);
      this.glowMesh.material.opacity = (0.05 + this.glowStrength * 0.09) * (0.7 + pulse * 0.6);
    }

    // The light brightens as the beacon peaks — cheap, and it sells the scale
    if (this.light) {
      this.light.intensity = 2.0 + this.glowStrength * 2.5 + pulse * 1.6;
    }
  }

  dispose() {
    this.group.traverse((o) => {
      if (o.geometry) o.geometry.dispose();
      if (o.material) {
        if (Array.isArray(o.material)) o.material.forEach((m) => m.dispose());
        else o.material.dispose();
      }
    });
    for (const r of this.sonarRings) {
      r.geometry.dispose();
      r.material.dispose();
    }
  }
}

/**
 * A single obelisk is a landmark; the world zoom level needs the *lights* of
 * every capital, not the full geometry. This builds a cheap additive sprite
 * per cluster so the ocean floor reads as a map of hubs.
 *
 * The lights stand where the obelisks stand. They used to be placed on their
 * own arc at radius 1,600-2,080 while the obelisks sat in a 14 x 141 box — two
 * different maps of the same six cities, so the bright settlement you flew
 * toward at world zoom was not the obelisk you arrived at. Both now come from
 * stationPosition(), so the light is the landmark seen from far away.
 */
export function buildClusterLights(clusters, opts = {}) {
  const group = new THREE.Group();
  group.name = "cluster-lights";

  const max = opts.max || clusters.length;
  const at = opts.positionFor || stationPosition;

  for (let i = 0; i < Math.min(max, clusters.length); i++) {
    const c = clusters[i];
    const color = new THREE.Color(languageStyleColor(c.dominantLanguage));
    const spot = at(c, opts);

    // A vertical beacon shaft — the far-away signature of a capital
    const shaftH = THREE.MathUtils.clamp(Math.log10((c.repos || 100) + 10) * 8, 6, 22);
    const geo = new THREE.CylinderGeometry(0.35, 0.8, shaftH, 6, 1, true);
    const mat = new THREE.MeshBasicMaterial({
      color,
      transparent: true,
      opacity: 0.22,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
      side: THREE.DoubleSide,
    });

    const shaft = new THREE.Mesh(geo, mat);
    shaft.position.set(spot.x, SEAFLOOR_Y, spot.z);
    group.add(shaft);

    // A soft cap glow so it reads as a settlement, not a pole
    const capGeo = new THREE.SphereGeometry(3.4, 8, 6);
    const capMat = new THREE.MeshBasicMaterial({
      color,
      transparent: true,
      opacity: 0.32,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
    });
    const cap = new THREE.Mesh(capGeo, capMat);
    cap.position.copy(shaft.position);
    cap.position.y += shaftH * 0.5;
    group.add(cap);
  }

  return group;
}