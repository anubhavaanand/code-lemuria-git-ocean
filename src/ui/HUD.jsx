/**
 * Git Ocean — UI chrome
 *
 * The HUD is deliberately thin: the ocean is the interface. Everything here
 * is a lens over the scene, never a modal wall.
 *
 *   Top-left     — identity + depth readout
 *   Bottom       — zoom level rail (the 5 levels of meaning)
 *   Right        — selected repo card, all data points
 *   Bottom-left  — legend toggle (what each shape means)
 */

import React, { useEffect, useMemo, useState } from "react";
import { CODEX, codexEntry } from "../world/codex";

/* ------------------------------------------------------------------ */
/* Small pieces                                                        */
/* ------------------------------------------------------------------ */

function Stat({ label, value, hint }) {
  return (
    <div className="go-stat" title={hint}>
      <span className="go-stat-value">{value}</span>
      <span className="go-stat-label">{label}</span>
    </div>
  );
}

function Bar({ value, max, color }) {
  const pct = Math.max(2, Math.min(100, (value / (max || 1)) * 100));
  return (
    <div className="go-bar">
      <div className="go-bar-fill" style={{ width: pct + "%", background: color }} />
    </div>
  );
}

const fmt = (n) => {
  if (n == null) return "—";
  if (n >= 1e9) return (n / 1e9).toFixed(1) + "B";
  if (n >= 1e6) return (n / 1e6).toFixed(1) + "M";
  if (n >= 1e3) return (n / 1e3).toFixed(1) + "K";
  return String(n);
};

/**
 * `stats.languages` is the ranked [{language, count, style}] list from
 * countLanguages(), not a number. Rendering it directly is what produced the
 * "[object Object],[object Object]" run across the header.
 */
function LanguageTally({ languages, limit = 3 }) {
  if (!Array.isArray(languages) || !languages.length) {
    return (
      <div className="go-tally-item">
        <span className="go-tally-label">0 languages</span>
      </div>
    );
  }

  const top = languages.slice(0, limit);
  const rest = languages.length - top.length;

  return (
    <div
      className="go-tally-item"
      title={languages.map((l) => `${l.language} ${l.count}`).join(" · ")}
    >
      <span className="go-lang-row">
        {top.map((l) => (
          <span className="go-lang-chip" key={l.language}>
            <span
              className="go-lang-dot"
              style={{ background: l.style?.color || "#8b9bb0" }}
            />
            {l.language}
          </span>
        ))}
        {rest > 0 && <span className="go-lang-more">+{rest}</span>}
      </span>
      <span className="go-tally-label">{languages.length} languages</span>
    </div>
  );
}

const STATUS_DOT = {
  success: "var(--go-ok)",
  failure: "var(--go-bad)",
  running: "var(--go-run)",
  none: "var(--go-dim)",
};

/* ------------------------------------------------------------------ */
/* Zoom rail                                                           */
/* ------------------------------------------------------------------ */

function ZoomRail({ levels, activeId, onPick }) {
  return (
    <div className="go-zoomrail" role="tablist" aria-label="Zoom level">
      {levels.map((l, i) => {
        const active = l.id === activeId;
        return (
          <button
            key={l.id}
            role="tab"
            aria-selected={active}
            className={"go-zoom-step" + (active ? " is-active" : "")}
            onClick={() => onPick(i)}
            title={l.blurb}
          >
            <span className="go-zoom-dot" />
            <span className="go-zoom-label">{l.label}</span>
            <span className="go-zoom-key">{i + 1}</span>
          </button>
        );
      })}
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Repo card                                                           */
/* ------------------------------------------------------------------ */

const WHALE_LABEL = {
  blue: "Blue Whale",
  humpback: "Humpback Whale",
  bowhead: "Bowhead Whale",
  sperm: "Sperm Whale",
  orca: "Orca",
};

function RepoCard({ repo, onClose, onFocus }) {
  // A creature clicked in the world opens the creatures tab, because the codex
  // entry only exists there. The overview is the right landing state for a
  // tower clicked generally; an animal clicked specifically should answer the
  // question the click asked.
  const [tab, setTab] = useState(
    repo && repo.__creature ? "creatures" : "overview"
  );
  // Which creature the user has opened, so the codex can show one entry rather
  // than eighteen. `null` means "show the whole catalogue".
  //
  // Seeded from `repo.__creature` when the card opens: clicking a coral polyp in
  // the world should land on that polyp's entry, not on the catalogue and not on
  // the overview. The card is keyed by repo in App.jsx, so a new selection
  // remounts and this re-seeds rather than carrying the previous tower's choice.
  const [entry, setEntry] = useState(repo && repo.__creature ? repo.__creature : null);
  if (!repo) return null;

  const sp = repo.whaleSpecies || {};
  const langColor = useMemo(() => {
    // Mirror LANGUAGE_COLORS without importing the 3D module into the HUD
    const map = {
      JavaScript: "#f1e05a",
      TypeScript: "#3178c6",
      Python: "#3572a5",
      Rust: "#dea584",
      Go: "#00add8",
      Java: "#b07219",
      "C++": "#f34b7d",
      C: "#555555",
      Ruby: "#701516",
      "C#": "#178600",
      Kotlin: "#a97bff",
      Swift: "#f05138",
      PHP: "#4f5d95",
    };
    return map[repo.language] || "#8b9bb0";
  }, [repo.language]);

  const maxStars = 5000;

  return (
    <div className="go-card" role="dialog" aria-label={repo.name}>
      <header className="go-card-head">
        <div>
          <div className="go-card-owner">{repo.owner}</div>
          <h2 className="go-card-title">{repo.name}</h2>
        </div>
        <button className="go-icon-btn" onClick={onClose} aria-label="Close">
          ✕
        </button>
      </header>

      {repo.description && <p className="go-card-desc">{repo.description}</p>}

      <div className="go-card-meta">
        <span className="go-chip">
          <i className="go-swatch" style={{ background: langColor }} />
          {repo.language}
        </span>
        {repo.isArchived && <span className="go-chip is-warn">archived</span>}
        {repo.isFork && <span className="go-chip">fork</span>}
        {repo.isPrivate && <span className="go-chip">private</span>}
        <span className="go-chip">
          <i
            className="go-dot"
            style={{ background: STATUS_DOT[repo.ciStatus] || STATUS_DOT.none }}
          />
          CI {repo.ciStatus}
        </span>
      </div>

      <nav className="go-tabs" role="tablist">
        {["overview", "creatures", "raw"].map((t) => (
          <button
            key={t}
            role="tab"
            aria-selected={tab === t}
            className={"go-tab" + (tab === t ? " is-active" : "")}
            onClick={() => setTab(t)}
          >
            {t}
          </button>
        ))}
      </nav>

      {tab === "overview" && (
        <>
          <div className="go-stats">
            <Stat label="stars" value={fmt(repo.stars)} hint="Admirers — orbital cloud density" />
            <Stat label="forks" value={fmt(repo.forks)} hint="Offspring — and whale fluke span" />
            <Stat label="watchers" value={fmt(repo.watchers)} hint="Remoras riding the whale" />
            <Stat label="contributors" value={fmt(repo.contributors)} hint="Builders — and tower girth" />
            <Stat label="commits" value={fmt(repo.totalCommits)} hint="Tower height" />
            <Stat label="commits/wk" value={fmt(repo.commitFrequency)} hint="Tower sway and whale beat rate" />
            <Stat label="open issues" value={fmt(repo.openIssues)} hint="Barnacles on the whale" />
            <Stat label="closed issues" value={fmt(repo.closedIssues)} hint="Ventral pleats" />
            <Stat label="open PRs" value={fmt(repo.openPRs)} hint="Flipper span" />
            <Stat label="merged PRs" value={fmt(repo.mergedPRs)} hint="Resolutions orbit" />
            <Stat label="releases" value={fmt(repo.releases)} hint="Exhalation plume" />
            <Stat label="age" value={fmt(repo.ageDays) + "d"} hint="Scar density and age rings" />
          </div>

          <div className="go-bars">
            <div className="go-bar-row">
              <span>reach</span>
              <Bar value={repo.stars} max={maxStars} color={langColor} />
              <b>{fmt(repo.stars)}</b>
            </div>
            <div className="go-bar-row">
              <span>work in flight</span>
              <Bar
                value={repo.openIssues + repo.openPRs}
                max={40}
                color="var(--go-bad)"
              />
              <b>{fmt(repo.openIssues + repo.openPRs)}</b>
            </div>
            <div className="go-bar-row">
              <span>resolved</span>
              <Bar
                value={repo.closedIssues + repo.mergedPRs}
                max={2000}
                color="var(--go-ok)"
              />
              <b>{fmt(repo.closedIssues + repo.mergedPRs)}</b>
            </div>
          </div>

          {sp.id && (
            <div className="go-species">
              <div className="go-species-title">
                Species: {WHALE_LABEL[sp.id] || sp.id}
              </div>
              <div className="go-species-latin">{sp.scientific}</div>
              <div className="go-species-traits">
                {(sp.traits || []).join(" · ")}
              </div>
            </div>
          )}
        </>
      )}

      {tab === "creatures" && (
        <div className="go-mapping">
          <p className="go-hint">
            Every creature is a mapped data point. Nothing is decorative.
          </p>
          {/*
            The catalogue below is the design: what each of the eighteen
            creatures means and which field drives it. The chips above say what
            this particular tower actually built. Both are needed and neither
            substitutes for the other — the design explains the mapping, the
            chips answer "so what am I looking at right now".
          */}

          {/* What actually built for this repo, straight from the colony's own
              registry. The list below is the full mapping — the catalogue — but
              a user looking at one tower needs to know which of these are in
              front of them, and until now nothing said. */}
          {(repo.__fauna || []).length > 0 && (
            <div className="go-present">
              <span className="go-present-label">
                On this tower ({repo.__fauna.length})
              </span>
              <div className="go-present-list">
                {repo.__fauna.map((f) => {
                  const c = codexEntry(f.name);
                  // The chip carries the common name now, not the key: "brain
                  // coral" is the thing a reader can picture, "brainCoral" is a
                  // field in a JSON file. The key stays available as the title
                  // so a developer can still trace it to the registry.
                  return (
                    <button
                      type="button"
                      className={
                        "go-present-chip" +
                        (entry === f.name ? " is-open" : "")
                      }
                      key={f.name}
                      title={`${c.field} — ${c.meaning}`}
                      aria-pressed={entry === f.name}
                      onClick={() =>
                        setEntry((cur) => (cur === f.name ? null : f.name))
                      }
                    >
                      {c.label}
                      {f.count > 1 && <em>×{f.count}</em>}
                    </button>
                  );
                })}
              </div>

              {/* One creature opened: the mapping, the field, and the reason the
                  ocean would make this creature for this data. The "why" is the
                  part that makes the design law checkable by a reader rather
                  than asserted by the author. */}
              {entry && (
                <div className="go-codex" role="note">
                  <div className="go-codex-head">
                    <strong>{codexEntry(entry).label}</strong>
                    <span className="go-codex-trophic">
                      {codexEntry(entry).trophic}
                    </span>
                  </div>
                  <div className="go-codex-field">
                    {codexEntry(entry).field}
                    {(() => {
                      const rec = (repo.__fauna || []).find(
                        (f) => f.name === entry
                      );
                      return rec && rec.count > 1 ? ` ×${rec.count}` : "";
                    })()}
                  </div>
                  <p className="go-codex-meaning">{codexEntry(entry).meaning}</p>
                  <p className="go-codex-biology">
                    {codexEntry(entry).biology}
                  </p>
                </div>
              )}
            </div>
          )}

          <ul>
            <li><b>Whale body length</b> — codebase size ({fmt(repo.codebaseSize)} KB)</li>
            <li><b>Dorsal colour</b> — dominant language ({repo.language})</li>
            <li><b>Flipper span</b> — open PRs ({repo.openPRs})</li>
            <li><b>Fluke span</b> — fork count ({fmt(repo.forks)})</li>
            <li><b>Barnacles</b> — open issues ({repo.openIssues})</li>
            <li><b>Remoras</b> — watchers ({fmt(repo.watchers)})</li>
            <li><b>Ventral pleats</b> — closed issues ({fmt(repo.closedIssues)})</li>
            <li><b>Exhalation</b> — releases ({repo.releases})</li>
            <li><b>Scars</b> — repo age ({fmt(repo.ageDays)} days)</li>
            <li><b>Tower height</b> — commit history ({fmt(repo.totalCommits)})</li>
            <li><b>Tower girth</b> — contributors ({repo.contributors})</li>
            <li><b>Blade density</b> — open issues + PRs</li>
            <li><b>Canopy glow</b> — stars ({fmt(repo.stars)})</li>
            <li><b>Age rings</b> — one per year of history</li>
            <li><b>Builders orbit</b> — contributors × 3</li>
            <li><b>Admirers orbit</b> — √stars × 2.1</li>
            <li><b>Offspring orbit</b> — forks × 1.4</li>
            <li><b>Problems orbit</b> — open issues × 1.2 + open PRs × 1.8</li>
            <li><b>Resolutions orbit</b> — closed issues / 5 + merged PRs × 1.1</li>
          </ul>
        </div>
      )}

      {tab === "raw" && (
        <pre className="go-raw">{JSON.stringify(repo, null, 2)}</pre>
      )}

      <footer className="go-card-foot">
        <button className="go-btn" onClick={() => onFocus(repo.id)}>
          Fly to repo
        </button>
        <a
          className="go-btn is-ghost"
          href={`https://github.com/${repo.owner}/${repo.name}`}
          target="_blank"
          rel="noreferrer noopener"
        >
          Open on GitHub ↗
        </a>
      </footer>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Legend                                                              */
/* ------------------------------------------------------------------ */

const LEGEND = [
  ["Kelp tower", "one repository", "linear-gradient(180deg,#63b85e,#1a3d24)"],
  ["Whale", "one repository", "linear-gradient(180deg,#3d6b8f,#1d3557)"],
  ["Builders", "contributors", "#35e0ff"],
  ["Admirers", "stars", "#ffd479"],
  ["Offspring", "forks", "#6ad0ff"],
  ["Problems", "open issues + PRs", "#ff5a5a"],
  ["Resolutions", "closed issues + merged PRs", "#4dffb0"],
  ["Obelisk", "capital cluster landmark", "#66d9ff"],
  ["Marine snow", "marine snow", "#bfe6ff"],
];

function Legend({ open, onClose }) {
  if (!open) return null;
  return (
    <div className="go-legend" role="dialog" aria-label="Legend">
      <header>
        <h3>Legend</h3>
        <button className="go-icon-btn" onClick={onClose} aria-label="Close">
          ✕
        </button>
      </header>
      <ul>
        {LEGEND.map(([name, meaning, color]) => (
          <li key={name}>
            <i className="go-legend-swatch" style={{ background: color }} />
            <span className="go-legend-name">{name}</span>
            <span className="go-legend-meaning">{meaning}</span>
          </li>
        ))}
      </ul>
      <p className="go-hint">
        Scientific accuracy rule: every shape must be explainable by marine
        biology or engineering. If it can't be, it doesn't ship.
      </p>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Explore readout                                                     */
/* ------------------------------------------------------------------ */

/**
 * What this colony built, while you are looking at it.
 *
 * The repo card only exists once a tower is selected, and at the whale zoom the
 * card covers most of the animal you flew in to see. This is the same
 * information in a single line, at the edge: how many creatures are on this
 * tower and what they are, so the world can be read without opening anything.
 *
 * Reads `world.selectedFauna` directly rather than going through React state:
 * the selection already flows into the card, and duplicating it here would mean
 * two copies of the same fact that can disagree.
 */
function ExploreReadout({ world }) {
  const [fauna, setFauna] = useState(null);

  useEffect(() => {
    if (!world) return;
    const sync = () => setFauna(world.selectedFauna ? [...world.selectedFauna] : null);
    sync();
    const id = setInterval(sync, 400);
    return () => clearInterval(id);
  }, [world]);

  if (!fauna || fauna.length === 0) return null;

  const total = fauna.reduce((s, f) => s + (f.count || 1), 0);
  return (
    <div className="go-readout" role="status" aria-live="polite">
      <span className="go-readout-label">This colony</span>
      <span className="go-readout-body">
        {fauna.length} creature types · {total} animals
      </span>
      <span className="go-readout-list">
        {fauna
          .slice()
          .sort((a, b) => (b.count || 1) - (a.count || 1))
          .slice(0, 4)
          .map((f) => {
            const c = codexEntry(f.name);
            return (
              <span className="go-readout-chip" key={f.name} title={c.meaning}>
                {c.label}
                {f.count > 1 && <em>×{f.count}</em>}
              </span>
            );
          })}
        {fauna.length > 4 && (
          <span className="go-readout-chip is-more">+{fauna.length - 4}</span>
        )}
      </span>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Root HUD                                                            */
/* ------------------------------------------------------------------ */

/**
 * CC BY attribution.
 *
 * The imported whale sculpts are licensed CC BY 4.0, which requires credit to be
 * visible while the work is displayed — not buried in a README. The world
 * collects the credits as each sculpt finishes loading, so this renders exactly
 * the assets actually on screen and nothing else.
 */
function CreditLine({ world }) {
  const [credits, setCredits] = useState([]);

  useEffect(() => {
    if (!world) return;
    const sync = () => setCredits([...(world.pendingCredits || [])]);
    sync();
    const id = setInterval(sync, 1500);
    return () => clearInterval(id);
  }, [world]);

  const unique = useMemo(
    () => Array.from(new Set(credits.filter(Boolean))),
    [credits]
  );
  if (unique.length === 0) return null;

  return (
    <div className="go-credits">
      <span className="go-credits-label">Sculpt</span>
      {unique.map((c) => (
        <span className="go-credits-item" key={c}>
          {c}
        </span>
      ))}
    </div>
  );
}

export default function HUD({
  world,
  levels,
  activeLevelId,
  onLevelChange,
  selectedRepo,
  onClearSelection,
  onFlyTo,
}) {
  const [legendOpen, setLegendOpen] = useState(false);
  // The creature under the pointer, polled from the world's marker. The world
  // owns the raycast; the HUD owns the DOM, so the name travels across as a
  // string rather than the scene writing a label itself.
  const [hoverCreature, setHoverCreature] = useState(null);

  useEffect(() => {
    if (!world) return;
    const sync = () =>
      setHoverCreature(world.marker ? world.marker.hoverCreature || null : null);
    const id = setInterval(sync, 120);
    return () => clearInterval(id);
  }, [world]);
  const [identity, setIdentity] = useState(null);
  const [stats, setStats] = useState(null);

  useEffect(() => {
    if (!world) return;
    setIdentity(world.data.you);
    setStats(world.data.stats);
  }, [world]);

  useEffect(() => {
    const onKey = (e) => {
      if (e.key === "Escape") {
        setLegendOpen(false);
        onClearSelection && onClearSelection();
      }
      if (e.key === "l" || e.key === "L") setLegendOpen((v) => !v);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClearSelection]);

  return (
    <div className="go-hud">
      <header className="go-topbar">
        <div className="go-brand">
          <span className="go-brand-mark" aria-hidden="true">
            ◈
          </span>
          <span className="go-brand-text">
            Git<span>Ocean</span>
          </span>
        </div>

        {identity && (
          <div className="go-identity">
            <strong>{identity.name || identity.username}</strong>
            <span className="go-identity-sub">
              {identity.location} · {identity.district} district
            </span>
          </div>
        )}

        <div className="go-topright">
          {stats && (
            <div className="go-tally">
              <span className="go-tally-item">
                <b>{fmt(stats.totalRepos)}</b>
                <span className="go-tally-label">repos</span>
              </span>
              <span className="go-tally-item">
                <b>{fmt(stats.totalStars)}</b>
                <span className="go-tally-label">stars</span>
              </span>
              <LanguageTally languages={stats.languages} />
            </div>
          )}
          <button
            className={"go-btn is-ghost" + (legendOpen ? " is-on" : "")}
            onClick={() => setLegendOpen((v) => !v)}
            title="Legend (L)"
          >
            Legend
          </button>
        </div>
      </header>

      <div className="go-leftstack">
        {identity && (
          <div className="go-depthpanel">
            <div className="go-depth-label">Depth</div>
            <div className="go-depth-value">
              {Math.round(identity.depth)} m
            </div>
            <div className="go-depth-zone">
              {identity.depth > -200
                ? "Epipelagic"
                : identity.depth > -1000
                ? "Mesopelagic"
                : identity.depth > -4000
                ? "Bathypelagic"
                : "Abyssopelagic"}
            </div>
            <div className="go-depth-bar">
              <div
                className="go-depth-fill"
                style={{
                  height: Math.min(100, (Math.abs(identity.depth) / 6000) * 100) + "%",
                }}
              />
            </div>
            <div className="go-depth-scale">
              <span>0</span>
              <span>11 000 m</span>
            </div>
          </div>
        )}
      </div>

      {selectedRepo && (
        // Keyed by id so switching towers remounts the card. The codex entry is
        // local state seeded from the click; without a remount, a second tower
        // would open with the first tower's creature still expanded.
        <RepoCard
          key={selectedRepo.id}
          repo={selectedRepo}
          onClose={onClearSelection}
          onFocus={onFlyTo}
        />
      )}

      {/* Name what the pointer is over. Without this the ring only says
          "clickable tower"; a user still has to click to learn that the thing
          under the cursor is a brain coral rather than scenery. */}
      {hoverCreature && (
        <div className="go-tooltip" role="status" aria-live="polite">
          {hoverCreature in CODEX ? CODEX[hoverCreature].label : hoverCreature}
          <em>{CODEX[hoverCreature] ? CODEX[hoverCreature].field : ""}</em>
        </div>
      )}

      <ZoomRail
        levels={levels}
        activeId={activeLevelId}
        onPick={(i) => onLevelChange(i)}
      />

      {/* Exploration readout. Names what is actually on screen instead of only
          what the district holds — a user at the whale zoom looking at one
          animal has no way to know what else the colony built without going
          back out and reading the card. */}
      <ExploreReadout world={world} />

      <Legend open={legendOpen} onClose={() => setLegendOpen(false)} />

      <CreditLine world={world} />

      {!selectedRepo && (
        <div className="go-hintbar">
          Drag to look · Scroll to descend · Click a tower to read its data ·{" "}
          <kbd>1</kbd>–<kbd>5</kbd> jump levels · <kbd>L</kbd> legend
        </div>
      )}
    </div>
  );
}