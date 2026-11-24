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
    // Low metalness, same reason as the shaft: a metallic material with no
    // environment map has nothing to reflect and renders black.
    const mat = new THREE.MeshStandardMaterial({
      color: COLORS.waferRaw,
      roughness: 0.85,
      metalness: 0.1,
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
      roughness: 0.7,
      metalness: 0.15,
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
        roughness: 0.55,
        metalness: 0.25,
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
      // Metalness is LOW, deliberately.
      //
      // These bands used to be metalness 0.72 / roughness 0.14 — a mirror — and
      // the scene has no environment map, so a mirror had nothing to reflect and
      // the whole obelisk rendered as a BLACK column. That is the object that
      // sat dead-centre in every zoom level as an unlit slab. Polished silicon
      // is a dielectric that reflects the water it stands in, so the read has to
      // come from the diffuse colour plus a pronounced emissive band, not from
      // specular: the wafer goes from grey raw silicon at the base to the
      // language colour alight at the top, which is also the refinement story
      // the obelisk is meant to tell.
      const mat = new THREE.MeshStandardMaterial({
        color: new THREE.Color().copy(COLORS.waferEdge).lerp(new THREE.Color(COLORS.waferMirror), t),
        roughness: 0.42 - t * 0.14,
        metalness: 0.12,
        // Self-lit so it reads in the dark at every zoom; brighter up the stack.
        emissive: this.langColor.clone().lerp(new THREE.Color(COLORS.waferGlow), 0.35),
        emissiveIntensity: 0.35 + t * 0.75,
      });
      const band = new THREE.Mesh(geo, mat);
      band.position.y = width * 0.9 + bandH * i + bandH * 0.5;
      band.castShadow = true;
      band.receiveShadow = true;
      this.group.add(band);
      this.bands.push(band);
    }

    // Thin cut lines between wafers — the saw marks of the dicing process.
    //
    // These are rings, not a shell. The geometry is a single-segment open
    // cylinder, so drawing them opaque at 0x0a1622 painted a near-black tube
    // slightly WIDER than the wafer stack — a dark sleeve that swallowed the
    // whole obelisk and read as a black column with the beacon floating above
    // it. It has to be an additive, low-opacity seam so the wafers show through
    // and the marks read as grooves rather than as a wall.
    const lineGeo = new THREE.CylinderGeometry(width * 1.04, width * 1.04, bandH * 0.05, 20, 1, true);
    const lineMat = new THREE.MeshBasicMaterial({
      color: COLORS.waferGlow,
      transparent: true,
      opacity: 0.18,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
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
    // The sphere is SMALL and mostly a core; the halo does the reading.
    //
    // A translucent additive sphere at 0.22 x width still filled a 40-pixel
    // disc at city zoom and read as a solid white ball stuck on the shaft. The
    // glow belongs to the halo, which spreads and fades; the core should be a
    // bright point at the centre of it.
    const geo = new THREE.SphereGeometry(width * 0.09, 10, 8);
    const mat = new THREE.MeshBasicMaterial({
      color: 0xdff4ff,
      transparent: true,
      opacity: 0.55,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
    });
    this.beacon = new THREE.Mesh(geo, mat);
    this.beacon.position.y = height + width * 0.3;
    this.group.add(this.beacon);

    const haloGeo = new THREE.SphereGeometry(width * 1.5, 14, 12);
    const haloMat = new THREE.MeshBasicMaterial({
      color: 0xbfe6ff,
      transparent: true,
      opacity: 0.075,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
    });
    this.halo = new THREE.Mesh(haloGeo, haloMat);
    this.halo.position.copy(this.beacon.position);
    this.group.add(this.halo);

    // A point light at the tip is what makes the beacon *cast* rather than
    // merely be lit — without it the top of the stack has no falloff and reads
    // as a decal.
    const tip = new THREE.PointLight(0xbfe6ff, 1.6, width * 16, 2);
    tip.position.copy(this.beacon.position);
    this.group.add(tip);
    this.tipLight = tip;

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
    // The rings are children of this group, so the traverse below already
    // reaches them. The old code also looped `this.sonarRings` afterwards and
    // disposed each ring a second time, which is a silent no-op rather than a
    // crash — and that is why it survived: nothing threw, nothing looked wrong,
    // and the only cost was a repeated dispose event on every live ring.
    //
    // The array is still cleared, because holding disposed objects after
    // teardown is what made that second pass look necessary in the first place.
    this.group.traverse((o) => {
      if (o.geometry) o.geometry.dispose();
      if (o.material) {
        if (Array.isArray(o.material)) o.material.forEach((m) => m.dispose());
        else o.material.dispose();
      }
    });
    this.sonarRings.length = 0;
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
    const glow = THREE.MathUtils.clamp(c.glow != null ? c.glow : 0.6, 0, 1);

    // A vertical beacon shaft — the far-away signature of a capital.
    //
    // Sized against the world camera, not against the obelisk. The world lens
    // sits ~1,500 units from the ring and the frame is ~1,600 units tall there,
    // so a shaft 6-22 units high and 0.35 units wide was a few pixels at best
    // and simply vanished — which is why "the whole basin as lights in the
    // dark", the world level's entire promise, rendered as empty water. These
    // are now tens of units across and scale with the cluster's activity, so a
    // busy hub is a tall bright column and a quiet one is a low ember.
    const shaftH = 60 + glow * 90;
    const geo = new THREE.CylinderGeometry(shaftH * 0.05, shaftH * 0.11, shaftH, 8, 1, true);
    const mat = new THREE.MeshBasicMaterial({
      color,
      transparent: true,
      opacity: 0.16 + glow * 0.16,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
      side: THREE.DoubleSide,
    });

    const shaft = new THREE.Mesh(geo, mat);
    shaft.position.set(spot.x, SEAFLOOR_Y + shaftH * 0.5, spot.z);
    group.add(shaft);

    // A pool of light on the floor, so the capital reads as a settlement rather
    // than a single pole: the glow the community casts on the sediment beneath
    // it. Additive and flat, so it costs one draw call and fogs correctly.
    const poolGeo = new THREE.CircleGeometry(38 + glow * 46, 24);
    const poolMat = new THREE.MeshBasicMaterial({
      color,
      transparent: true,
      opacity: 0.1 + glow * 0.13,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
    });
    const pool = new THREE.Mesh(poolGeo, poolMat);
    pool.rotation.x = -Math.PI / 2;
    pool.position.set(spot.x, SEAFLOOR_Y + 2, spot.z);
    group.add(pool);

    // A soft cap glow so it reads as a settlement, not a pole
    const capGeo = new THREE.SphereGeometry(shaftH * 0.16, 10, 8);
    const capMat = new THREE.MeshBasicMaterial({
      color,
      transparent: true,
      opacity: 0.3 + glow * 0.25,
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