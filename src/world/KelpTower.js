/**
 * Git Ocean — Kelp tower
 *
 * One tower = one repository. Every measurement on the tower is real data:
 *
 *   height        ← total commit history  (the older and more worked-on, the taller)
 *   girth         ← lifetime contributors (more hands, thicker holdfast and stipe)
 *   sway          ← commit frequency      (active repos move; abandoned ones are rigid)
 *   blade density ← open + closed issues (work in flight)
 *   holdfast ring ← repo age             (one growth ring per year of history)
 *   frond glow    ← stars                (social reach, visible from across the city)
 *   stipe rings   ← releases             (growth spurts mark each cut)
 *   canopy polyps ← contributors         (the people living at the top of the tree)
 *   mantle        ← dominant language     (tinted by the repo's primary language)
 *
 * Structural note: giant kelp grows straight up to the surface from a holdfast
 * and bends as a cantilever in the current. The bend is why the height reads
 * as a living thing rather than a bar chart.
 */

import * as THREE from "three";
import { COLORS, towerHeight, towerGirth, languageStyleColor } from "./constants";
import { kelpVertex, kelpFragment } from "./shaders";

// A growth ring per year of history, capped so an ancient repo stays sane
function ringCount(ageDays) {
  return THREE.MathUtils.clamp(Math.floor((ageDays || 0) / 365), 0, 9);
}

export class KelpTower {
  constructor(repo, opts = {}) {
    this.repo = repo;
    this.quality = opts.quality || "high";
    this.isMobile = opts.isMobile || false;

    this.height = towerHeight(repo);
    this.girth = towerGirth(repo);
    this.sway = THREE.MathUtils.clamp((repo.commitFrequency || 0) / 30, 0.02, 1);
    this.rings = ringCount(repo.ageDays);
    this.languageColor = languageStyleColor(repo.language);

    this.group = new THREE.Group();
    this.group.name = `tower:${repo.owner}/${repo.name}`;

    this.time = Math.random() * 100;

    this.build();
  }

  build() {
    this.buildHoldfast();
    this.buildStipe();
    this.buildBlades();
    this.buildCanopyPolyps();
    this.buildRingBands();
    this.buildStarGlow();
    this.buildActivityLights();
  }

  // -------------------------------------------------------------------------
  // Holdfast — the root structure gripping the seafloor
  // -------------------------------------------------------------------------
  buildHoldfast() {
    const geo = new THREE.SphereGeometry(1, 10, 6, 0, Math.PI * 2, 0, Math.PI / 2);
    const mat = new THREE.MeshStandardMaterial({
      color: COLORS.holdfast,
      roughness: 0.95,
      metalness: 0.05,
      flatShading: true,
    });

    this.holdfast = new THREE.Mesh(geo, mat);
    // Girth maps to how many people have touched the repo
    this.holdfast.scale.set(this.girth * 1.5, this.girth * 0.55, this.girth * 1.5);
    this.group.add(this.holdfast);

    // Root tendrils spreading across the sediment — more contributors, more spread
    const tendrilCount = THREE.MathUtils.clamp(
      Math.floor((this.repo.contributors || 1) * 1.4),
      2,
      this.isMobile ? 5 : 12
    );

    const tGeo = new THREE.CylinderGeometry(0.02, 0.09, 1, 5);
    const tMat = new THREE.MeshStandardMaterial({
      color: COLORS.holdfast,
      roughness: 0.95,
    });
    const tendrils = new THREE.InstancedMesh(tGeo, tMat, tendrilCount);
    const m = new THREE.Matrix4();
    const q = new THREE.Quaternion();
    const s = new THREE.Vector3();
    const p = new THREE.Vector3();

    for (let i = 0; i < tendrilCount; i++) {
      const a = (i / tendrilCount) * Math.PI * 2 + Math.random() * 0.6;
      const len = this.girth * (1.1 + Math.random() * 1.9);
      p.set(Math.cos(a) * len * 0.55, len * 0.1, Math.sin(a) * len * 0.55);
      q.setFromEuler(new THREE.Euler(Math.PI / 2.4, a, 0));
      s.set(1, len, 1);
      m.compose(p, q, s);
      tendrils.setMatrixAt(i, m);
    }
    tendrils.instanceMatrix.needsUpdate = true;
    this.group.add(tendrils);
  }

  // -------------------------------------------------------------------------
  // Stipe — the main stem, custom vertex shader for cantilever sway
  // -------------------------------------------------------------------------
  buildStipe() {
    // Tapered tube: wide at the holdfast, thin at the canopy
    const radialSegs = this.quality === "low" ? 5 : 7;
    const heightSegs = this.quality === "low" ? 16 : 30;

    const geo = new THREE.CylinderGeometry(
      this.girth * 0.16,
      this.girth * 0.34,
      this.height,
      radialSegs,
      heightSegs,
      true
    );

    // Re-origin so y=0 is the holdfast (the shader assumes this)
    geo.translate(0, this.height / 2, 0);

    this.stipeUniforms = {
      uTime: { value: 0 },
      uSwayAmount: { value: 0.28 + this.sway * 1.5 },
      uSwaySpeed: { value: 0.28 + this.sway * 0.75 },
      uHeight: { value: this.height },
      uPhase: { value: Math.random() * Math.PI * 2 },
      uColorBase: { value: new THREE.Color(COLORS.kelpStipeDark) },
      uColorTip: { value: new THREE.Color(COLORS.kelpBlade) },
      uColorGlow: { value: new THREE.Color(this.languageColor) },
      uGlowStrength: { value: 0.12 + this.sway * 0.2 },
      uOpacity: { value: 0.94 },
    };

    const mat = new THREE.ShaderMaterial({
      uniforms: this.stipeUniforms,
      vertexShader: kelpVertex,
      fragmentShader: kelpFragment,
      transparent: true,
      side: THREE.DoubleSide,
    });

    this.stipe = new THREE.Mesh(geo, mat);
    this.group.add(this.stipe);
  }

  // -------------------------------------------------------------------------
  // Blades — the photosynthetic canopy.
  // Blade count = work in flight (open issues + open PRs), a direct mapping
  // from the issues list to visible foliage.
  // -------------------------------------------------------------------------
  buildBlades() {
    const workInFlight = (this.repo.openIssues || 0) + (this.repo.openPRs || 0);
    const bladeCount = THREE.MathUtils.clamp(
      Math.floor(2 + workInFlight * 0.55),
      2,
      this.isMobile ? 12 : 26
    );

    this.bladeCount = bladeCount;
    this.blades = [];

    // A blade is a small plane with a bend, instanced for cheapness
    const geo = new THREE.PlaneGeometry(1, 1, 1, 4);
    geo.translate(0, 0.5, 0);

    const mat = new THREE.MeshStandardMaterial({
      color: COLORS.kelpBlade,
      roughness: 0.7,
      metalness: 0.05,
      side: THREE.DoubleSide,
      transparent: true,
      opacity: 0.88,
    });

    const mesh = new THREE.InstancedMesh(geo, mat, bladeCount);
    const m = new THREE.Matrix4();
    const q = new THREE.Quaternion();
    const s = new THREE.Vector3();
    const p = new THREE.Vector3();

    for (let i = 0; i < bladeCount; i++) {
      // Distribute along the upper 60% of the stipe — real kelp blades cluster
      // toward the canopy where light reaches
      const t = 0.4 + Math.random() * 0.6;
      const y = this.height * t;
      const a = Math.random() * Math.PI * 2;
      const len = this.girth * (1.4 + Math.random() * 2.6) * (0.5 + t * 0.8);

      p.set(0, y, 0);
      q.setFromEuler(new THREE.Euler(0, a, Math.PI * 0.34 + Math.random() * 0.4));
      s.set(len * 0.5, len, 1);

      m.compose(p, q, s);
      mesh.setMatrixAt(i, m);

      this.blades.push({ t, a, len, phase: Math.random() * Math.PI * 2 });
    }

    mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    mesh.instanceMatrix.needsUpdate = true;
    this.bladeMesh = mesh;
    this._bm = new THREE.Matrix4();
    this._bq = new THREE.Quaternion();
    this._bs = new THREE.Vector3();
    this._bp = new THREE.Vector3();
    this._be = new THREE.Euler();

    this.group.add(mesh);
  }

  // -------------------------------------------------------------------------
  // Canopy polyps — one light per contributor, clustered at the top.
  // The people actually working on the repo.
  // -------------------------------------------------------------------------
  buildCanopyPolyps() {
    const contributors = this.repo.contributors || 1;
    const count = THREE.MathUtils.clamp(contributors, 1, this.isMobile ? 8 : 24);

    const geo = new THREE.SphereGeometry(1, 6, 5);
    const mat = new THREE.MeshBasicMaterial({
      color: this.languageColor,
      transparent: true,
      opacity: 0.85,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
    });

    const mesh = new THREE.InstancedMesh(geo, mat, count);
    const m = new THREE.Matrix4();
    const q = new THREE.Quaternion();
    const s = new THREE.Vector3();
    const p = new THREE.Vector3();

    this.polyps = [];
    for (let i = 0; i < count; i++) {
      const a = Math.random() * Math.PI * 2;
      const r = this.girth * (0.3 + Math.random() * 0.9);
      const y = this.height * (0.82 + Math.random() * 0.18);
      const size = 0.06 + Math.random() * 0.08;
      p.set(Math.cos(a) * r, y, Math.sin(a) * r);
      s.setScalar(size);
      m.compose(p, q, s);
      mesh.setMatrixAt(i, m);
      this.polyps.push({ base: p.clone(), size, phase: Math.random() * Math.PI * 2 });
    }
    mesh.instanceMatrix.needsUpdate = true;
    this.polyps.mesh = mesh;
    this._pm = new THREE.Matrix4();
    this._ps = new THREE.Vector3();
    this.group.add(mesh);
  }

  // -------------------------------------------------------------------------
  // Growth rings — one band per year of history
  // -------------------------------------------------------------------------
  buildRingBands() {
    if (this.rings <= 0) return;

    const mat = new THREE.MeshBasicMaterial({
      color: COLORS.kelpBladeLit,
      transparent: true,
      opacity: 0.4,
    });

    for (let i = 0; i < this.rings; i++) {
      // Rings are evenly spaced up the lower 70% of the stipe
      const t = (i + 1) / (this.rings + 1);
      const y = this.height * t * 0.72;
      const r = this.girth * (0.34 - t * 0.12);

      const geo = new THREE.TorusGeometry(r, 0.018, 4, 12);
      const band = new THREE.Mesh(geo, mat);
      band.rotation.x = Math.PI / 2;
      band.position.y = y;
      this.group.add(band);
    }
  }

  // -------------------------------------------------------------------------
  // Star glow — social reach. Drawn as a soft additive halo near the canopy.
  // A repo with many stars is visible from across the city.
  // -------------------------------------------------------------------------
  buildStarGlow() {
    const stars = this.repo.stars || 0;
    if (stars <= 0) return;

    // Log scale: 100 stars and 100k stars must both read on the same screen
    const strength = THREE.MathUtils.clamp(Math.log10(stars + 1) / 5, 0, 1);
    this.starStrength = strength;

    const geo = new THREE.SphereGeometry(1, 12, 10);
    const mat = new THREE.MeshBasicMaterial({
      color: this.languageColor,
      transparent: true,
      opacity: 0.06 + strength * 0.12,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
    });

    this.starGlow = new THREE.Mesh(geo, mat);
    const r = this.girth * (2.4 + strength * 4.5);
    this.starGlow.scale.setScalar(r);
    this.starGlow.position.y = this.height * 0.86;
    this.group.add(this.starGlow);

    this.starGlowBase = 1;
  }

  // -------------------------------------------------------------------------
  // Activity lights — the CI/CD status reads as tube worms at the base.
  // Green = passing, red = failing, gold = running.
  // -------------------------------------------------------------------------
  buildActivityLights() {
    const status = this.repo.ciStatus || "none";
    if (status === "none") return;

    const color =
      status === "success" ? COLORS.success :
      status === "failure" ? COLORS.failure :
      COLORS.running;

    const count = this.isMobile ? 3 : 6;
    const geo = new THREE.CylinderGeometry(0.05, 0.09, 1, 5);
    const mat = new THREE.MeshStandardMaterial({
      color,
      emissive: new THREE.Color(color),
      emissiveIntensity: 1.4,
      roughness: 0.6,
    });

    const mesh = new THREE.InstancedMesh(geo, mat, count);
    const m = new THREE.Matrix4();
    const q = new THREE.Quaternion();
    const s = new THREE.Vector3();
    const p = new THREE.Vector3();

    for (let i = 0; i < count; i++) {
      const a = (i / count) * Math.PI * 2 + 0.3;
      const r = this.girth * (1.4 + Math.random() * 0.7);
      const h = 0.5 + Math.random() * 0.8;
      p.set(Math.cos(a) * r, h * 0.5, Math.sin(a) * r);
      q.setFromEuler(new THREE.Euler((Math.random() - 0.5) * 0.4, a, (Math.random() - 0.5) * 0.4));
      s.set(1, h, 1);
      m.compose(p, q, s);
      mesh.setMatrixAt(i, m);
    }
    mesh.instanceMatrix.needsUpdate = true;
    this.group.add(mesh);
    this.tubeWorms = mesh;
  }

  // -------------------------------------------------------------------------
  // Update — sway, blade flutter, polyp pulse
  // -------------------------------------------------------------------------
  update(delta) {
    this.time += delta;

    if (this.stipeUniforms) {
      this.stipeUniforms.uTime.value = this.time;
    }

    // Blades flutter — but follow the stipe's bend at their height
    if (this.bladeMesh) {
      const sway = this.stipeUniforms.uSwayAmount.value;
      const speed = this.stipeUniforms.uSwaySpeed.value;
      const phase = this.stipeUniforms.uPhase.value;

      for (let i = 0; i < this.blades.length; i++) {
        const b = this.blades[i];
        // Cantilever bend matching the stipe vertex shader
        const bend = b.t * b.t;
        const s1 = Math.sin(this.time * speed + phase);
        const s2 = Math.sin(this.time * speed * 0.53 + phase * 1.7);

        const xOff = s1 * sway * bend;
        const zOff = s2 * sway * bend * 0.65;
        const flutter = Math.sin(this.time * 1.9 + b.phase) * 0.14;

        this._bp.set(xOff, this.height * b.t, zOff);
        this._be.set(0, b.a + flutter * 0.4, Math.PI * 0.34 + flutter);
        this._bq.setFromEuler(this._be);
        this._bs.set(b.len * 0.5, b.len, 1);
        this._bm.compose(this._bp, this._bq, this._bs);
        this.bladeMesh.setMatrixAt(i, this._bm);
      }
      this.bladeMesh.instanceMatrix.needsUpdate = true;
    }

    // Polyps pulse with the current
    if (this.polyps.mesh) {
      for (let i = 0; i < this.polyps.length; i++) {
        const p = this.polyps[i];
        const pulse = 0.85 + Math.sin(this.time * 1.3 + p.phase) * 0.15;
        this._ps.setScalar(p.size * pulse);
        this._pm.compose(p.base, new THREE.Quaternion(), this._ps);
        this.polyps.mesh.setMatrixAt(i, this._pm);
      }
      this.polyps.mesh.instanceMatrix.needsUpdate = true;
    }

    // Star halo breathes
    if (this.starGlow) {
      const breathe = 1 + Math.sin(this.time * 0.7) * 0.06;
      const base = this.girth * (2.4 + (this.starStrength || 0) * 4.5);
      this.starGlow.scale.setScalar(base * breathe);
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
  }
}