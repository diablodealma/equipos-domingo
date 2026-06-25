import { useState, useEffect, useRef } from "react";
import { cloud } from "./firebase.js";

// ─── storage ──────────────────────────────────────────────────────────────────
// Persiste en localStorage cuando está disponible (deploy real) y cae a memoria
// si no lo está (previews / SSR), sin romper en ningún caso.
const _mem = {};
const LS = {
  players: () => { try { return JSON.parse(localStorage.getItem("f5_players") || "[]"); } catch { return _mem.players || []; } },
  matches:  () => { try { return JSON.parse(localStorage.getItem("f5_matches")  || "[]"); } catch { return _mem.matches  || []; } },
  savePlayers: p => { _mem.players = p; try { localStorage.setItem("f5_players", JSON.stringify(p)); } catch {} },
  saveMatches:  m => { _mem.matches  = m; try { localStorage.setItem("f5_matches",  JSON.stringify(m)); } catch {} },
};

// ─── constants ────────────────────────────────────────────────────────────────
const SKILLS = [
  { key: "atajando",   label: "Atajando",     icon: "🧤" },
  { key: "velocidad",  label: "Velocidad",    icon: "⚡" },
  { key: "fisico",     label: "Físico",       icon: "💪" },
  { key: "definicion", label: "Definición",   icon: "🎯" },
  { key: "defensa",    label: "Defensa",      icon: "🛡️" },
  { key: "gambeta",    label: "Gambeta",      icon: "🪄" },
];

const PALETTES = [
  { bg: "#ef4444", txt: "#fff",    name: "Rojo"     },
  { bg: "#3b82f6", txt: "#fff",    name: "Azul"     },
  { bg: "#f59e0b", txt: "#111",    name: "Amarillo" },
  { bg: "#10b981", txt: "#fff",    name: "Verde"    },
  { bg: "#a855f7", txt: "#fff",    name: "Violeta"  },
  { bg: "#f97316", txt: "#fff",    name: "Naranja"  },
  { bg: "#18181b", txt: "#ffffff", name: "Negro"    },
  { bg: "#ffffff", txt: "#18181b", name: "Blanco"   },
];

const EMPTY_FORM = { name: "", atajando: 5, velocidad: 5, fisico: 5, definicion: 5, defensa: 5, gambeta: 5, lesionado: false };

// ─── scoring ─────────────────────────────────────────────────────────────────
// Base score = promedio de habilidades
// + bonus/penalty según historial de partidos previos con ese jugador
function baseScore(p) {
  return (p.atajando + p.velocidad + p.fisico + p.definicion + p.defensa + p.gambeta) / 6;
}

// Ajuste histórico DIRECCIONAL.
// Solo miran los partidos "disparejos" CON un ganador claro (no empates).
// Si el jugador estaba en el equipo que ganó cómodo → estaba sobrevalorado → baja.
// Si estaba en el que perdió → estaba subvalorado → sube.
// Los partidos "parejos" no mueven nada: el balanceo ya era bueno.
// Retorna un factor entre 0.85 y 1.15.
function historyFactor(playerId, matches) {
  let nudge = 0;
  matches.forEach(m => {
    if (m.resultado !== "disparejo") return;
    if (m.ganador !== "team1" && m.ganador !== "team2") return; // necesita lado dominante
    const inT1 = (m.team1 || []).includes(playerId);
    const inT2 = (m.team2 || []).includes(playerId);
    if (!inT1 && !inT2) return;
    const team = inT1 ? "team1" : "team2";
    nudge += team === m.ganador ? -1 : 1;
  });
  const factor = 1 + nudge * 0.04;
  return Math.max(0.85, Math.min(1.15, factor));
}

function adjustedScore(p, matches) {
  return baseScore(p) * historyFactor(p.id, matches);
}

function teamAvgScore(team, matches) {
  if (!team.length) return 0;
  return team.reduce((s, p) => s + adjustedScore(p, matches), 0) / team.length;
}

function balanceTeams(players, matches) {
  // 1) Ranking por score, de mayor a menor
  const sorted = [...players].sort((a, b) => adjustedScore(b, matches) - adjustedScore(a, matches));

  // 2) Draft en serpiente: T1,T2 / T2,T1 / T1,T2 … (mantiene los equipos parejos en cantidad)
  const t1 = [], t2 = [];
  let i = 0, round = 0;
  while (i < sorted.length) {
    const order = round % 2 === 0 ? [t1, t2] : [t2, t1];
    for (const team of order) {
      if (i < sorted.length) team.push(sorted[i++]);
    }
    round++;
  }

  // 3) Ajuste fino: intercambios 1-a-1 que acerquen los promedios sin tocar las cantidades
  let improved = true;
  while (improved) {
    improved = false;
    let bestDiff = Math.abs(teamAvgScore(t1, matches) - teamAvgScore(t2, matches));
    let swap = null;
    for (let a = 0; a < t1.length; a++) {
      for (let b = 0; b < t2.length; b++) {
        const n1 = t1.map((p, k) => (k === a ? t2[b] : p));
        const n2 = t2.map((p, k) => (k === b ? t1[a] : p));
        const d = Math.abs(teamAvgScore(n1, matches) - teamAvgScore(n2, matches));
        if (d < bestDiff - 1e-9) { bestDiff = d; swap = [a, b]; }
      }
    }
    if (swap) {
      const [a, b] = swap;
      [t1[a], t2[b]] = [t2[b], t1[a]];
      improved = true;
    }
  }

  return [t1, t2];
}

function shuffle(arr) {
  const a = [...arr];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

function fmtDate(iso) {
  const d = new Date(iso);
  return d.toLocaleDateString("es-AR", { weekday: "short", day: "numeric", month: "short" });
}

// ─── sub-components ───────────────────────────────────────────────────────────
function Shirt({ pal, num, size = 44 }) {
  return (
    <svg width={size} height={size} viewBox="0 0 48 48" style={{ flexShrink: 0, filter: "drop-shadow(0 2px 5px #0008)" }}>
      <polygon points="0,12 12,5 18,15 24,10 30,15 36,5 48,12 42,22 36,20 36,46 12,46 12,20 6,22"
        fill={pal.bg} stroke={pal.txt + "33"} strokeWidth="1.2" />
      <text x="24" y="34" textAnchor="middle" fontSize="13" fontWeight="bold"
        fill={pal.txt} fontFamily="'Bebas Neue', cursive">{num}</text>
    </svg>
  );
}

function ScorePicker({ sk, value, onChange }) {
  const col = value >= 8 ? "#10b981" : value >= 5 ? "#3b82f6" : "#64748b";
  return (
    <div style={{ marginBottom: 14 }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 6 }}>
        <span style={{ fontSize: 12, color: "#94a3b8", display: "flex", alignItems: "center", gap: 5 }}>
          <span style={{ fontSize: 14 }}>{sk.icon}</span> {sk.label}
        </span>
        <span style={{ fontFamily: "'Bebas Neue',cursive", fontSize: 18, color: col, minWidth: 24, textAlign: "right" }}>{value}</span>
      </div>
      <div style={{ display: "flex", gap: 3 }}>
        {Array.from({ length: 10 }, (_, i) => i + 1).map(n => {
          const on = n <= value;
          const active = n === value;
          return (
            <button key={n} type="button" onClick={() => onChange(n)} style={{
              flex: 1, padding: "10px 0", borderRadius: 6, cursor: "pointer",
              border: active ? `1px solid ${col}` : "1px solid transparent",
              background: on ? col + (active ? "44" : "22") : "#0f2040",
              color: on ? col : "#3d5a73",
              fontFamily: "'Bebas Neue',cursive", fontSize: 15, lineHeight: 1,
              WebkitTapHighlightColor: "transparent",
            }}>{n}</button>
          );
        })}
      </div>
    </div>
  );
}

function SkillDots({ p }) {
  return (
    <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
      {SKILLS.map(s => {
        const col = p[s.key] >= 8 ? "#10b981" : p[s.key] >= 5 ? "#3b82f6" : "#475569";
        return (
          <div key={s.key} title={`${s.label}: ${p[s.key]}`} style={{ display: "flex", alignItems: "center", gap: 3 }}>
            <span style={{ fontSize: 11 }}>{s.icon}</span>
            <span style={{ fontSize: 11, color: col, fontWeight: 700 }}>{p[s.key]}</span>
          </div>
        );
      })}
    </div>
  );
}

// ─── App ─────────────────────────────────────────────────────────────────────
export default function App() {
  const [players, setPlayers] = useState(LS.players);
  const [matches,  setMatches]  = useState(LS.matches);
  const [tab, setTab] = useState("jugadores");
  const [form, setForm] = useState(EMPTY_FORM);
  const [editId, setEditId] = useState(null);
  const [selected, setSelected] = useState([]);
  const [teams, setTeams] = useState([[], []]);
  const [generated, setGenerated] = useState(false);
  const [palettes, setPalettes] = useState([PALETTES[0], PALETTES[1]]);
  const [toast, setToast] = useState("");
  // asistencias modal
  const [attModal, setAttModal] = useState(null); // matchId
  // partido pendiente de feedback
  const [pendingMatch, setPendingMatch] = useState(null);

  function persistPlayers(next) { setPlayers(next); LS.savePlayers(next); cloud.save({ players: next }); }
  function persistMatches(next)  { setMatches(next);  LS.saveMatches(next);  cloud.save({ matches: next }); }

  // ── sincronización en la nube (Firebase) ──
  const seededRef = useRef(false);
  useEffect(() => {
    if (!cloud.ready) return; // sin Firebase configurado → sólo este dispositivo
    const unsub = cloud.subscribe(data => {
      const cloudPlayers = (data && data.players) || [];
      const cloudMatches = (data && data.matches) || [];
      const cloudEmpty = cloudPlayers.length === 0 && cloudMatches.length === 0;
      const localPlayers = LS.players();
      const localMatches = LS.matches();
      const localHasData = localPlayers.length > 0 || localMatches.length > 0;

      // Primera vez: si la nube está vacía y este teléfono tiene data, la subimos (sin perder nada).
      if (cloudEmpty && localHasData && !seededRef.current) {
        seededRef.current = true;
        cloud.save({ players: localPlayers, matches: localMatches });
        return; // seguimos mostrando lo local hasta que el guardado vuelva
      }

      // De ahí en más, la nube manda: actualizamos pantalla y cache local.
      if (data) {
        setPlayers(cloudPlayers);
        setMatches(cloudMatches);
        LS.savePlayers(cloudPlayers);
        LS.saveMatches(cloudMatches);
      }
    });
    return unsub;
  }, []);
  function showToast(msg) { setToast(msg); setTimeout(() => setToast(""), 2400); }

  // ── jugadores ──
  function handleSave() {
    if (!form.name.trim()) { showToast("Poné el nombre"); return; }
    if (editId !== null) {
      persistPlayers(players.map(p => p.id === editId ? { ...p, ...form } : p));
      setEditId(null);
      showToast("✓ Jugador actualizado");
    } else {
      persistPlayers([...players, { ...form, id: Date.now(), name: form.name.trim() }]);
      showToast("✓ " + form.name.trim() + " agregado");
    }
    setForm(EMPTY_FORM);
  }
  function handleEdit(p) {
    setForm({ name: p.name, atajando: p.atajando, velocidad: p.velocidad, fisico: p.fisico, definicion: p.definicion, defensa: p.defensa, gambeta: p.gambeta, lesionado: !!p.lesionado });
    setEditId(p.id); window.scrollTo({ top: 0, behavior: "smooth" });
  }
  function handleDelete(id) {
    persistPlayers(players.filter(p => p.id !== id));
    setSelected(s => s.filter(i => i !== id));
    showToast("Jugador eliminado");
  }
  function toggleLesion(id) {
    persistPlayers(players.map(p => p.id === id ? { ...p, lesionado: !p.lesionado } : p));
  }
  function toggleSelect(id) {
    setSelected(s => s.includes(id) ? s.filter(i => i !== id) : [...s, id]);
  }
  function pool() {
    const base = selected.length ? players.filter(p => selected.includes(p.id)) : players;
    return base.filter(p => !p.lesionado); // los lesionados no entran al armado
  }

  // ── equipos ──
  function handleBalance() {
    const pl = pool();
    if (pl.length < 2) { showToast("Necesitás al menos 2 jugadores"); return; }
    setTeams(balanceTeams(pl, matches));
    setGenerated(true);
    setTab("equipos");
  }
  function handleRandom() {
    const pl = pool();
    if (pl.length < 2) { showToast("Necesitás al menos 2 jugadores"); return; }
    const sh = shuffle(pl);
    const half = Math.ceil(sh.length / 2);
    setTeams([sh.slice(0, half), sh.slice(half)]);
    setGenerated(true);
  }

  // Guarda el partido actual como entrada en historial (sin resultado aún)
  function saveMatchToHistory() {
    if (!generated || !teams[0].length) return;
    const match = {
      id: Date.now(),
      date: new Date().toISOString(),
      team1: teams[0].map(p => p.id),
      team2: teams[1].map(p => p.id),
      team1Names: teams[0].map(p => p.name),
      team2Names: teams[1].map(p => p.name),
      pal1: palettes[0].name,
      pal2: palettes[1].name,
      resultado: null,     // "parejo" | "disparejo"  → calidad del balanceo
      ganador: null,       // "team1" | "team2" | "empate"  → resultado del partido
      figura: null,        // playerId  → figura del encuentro (suma puntos extra)
      goleador: null,      // playerId  → goleador del partido (suma puntos extra)
      asistencias: {},     // { playerId: true/false }
    };
    persistMatches([match, ...matches]);
    setPendingMatch(match.id);
    showToast("✓ Partido guardado en historial");
  }

  // ── resultado partido ──
  function setResultado(matchId, valor) {
    persistMatches(matches.map(m => m.id === matchId ? { ...m, resultado: m.resultado === valor ? null : valor } : m));
  }
  function setGanador(matchId, valor) {
    persistMatches(matches.map(m => m.id === matchId ? { ...m, ganador: m.ganador === valor ? null : valor } : m));
  }
  function setFigura(matchId, pid) {
    persistMatches(matches.map(m => m.id === matchId ? { ...m, figura: pid } : m));
  }
  function setGoleador(matchId, pid) {
    persistMatches(matches.map(m => m.id === matchId ? { ...m, goleador: pid } : m));
  }

  // ── asistencias ──
  function toggleAsistencia(matchId, playerId) {
    persistMatches(matches.map(m => {
      if (m.id !== matchId) return m;
      const att = { ...m.asistencias };
      att[playerId] = !att[playerId];
      return { ...m, asistencias: att };
    }));
  }

  const diff = Math.abs(teamAvgScore(teams[0], matches) - teamAvgScore(teams[1], matches)).toFixed(2);
  const diffColor = parseFloat(diff) <= 0.4 ? "#10b981" : parseFloat(diff) <= 1 ? "#f59e0b" : "#ef4444";

  // ── asistencia global por jugador ──
  function playerAttendance(pid) {
    const relevant = matches.filter(m => (m.team1 || []).includes(pid) || (m.team2 || []).includes(pid));
    const attended  = relevant.filter(m => m.asistencias && m.asistencias[pid]).length;
    return { total: relevant.length, attended };
  }

  // ── estadísticas acumuladas por jugador (toda la temporada) ──
  function playerStats(pid) {
    let pj = 0, v = 0, e = 0, d = 0, presencias = 0, figuras = 0, goles = 0;
    matches.forEach(m => {
      const inT1 = (m.team1 || []).includes(pid);
      const inT2 = (m.team2 || []).includes(pid);
      if (!inT1 && !inT2) return;
      pj++;
      if (m.asistencias && m.asistencias[pid]) presencias++;
      if (m.figura === pid) figuras++;
      if (m.goleador === pid) goles++;
      const team = inT1 ? "team1" : "team2";
      if (m.ganador === "empate") e++;
      else if (m.ganador === "team1" || m.ganador === "team2") (m.ganador === team ? v++ : d++);
    });
    const decididos = v + d;
    const winRate = decididos ? v / decididos : 0;
    // Bayesiano: suaviza las muestras chicas hacia 0.5 (el que jugó 1 y ganó no lidera)
    const bayes = (v + 1.5) / (decididos + 3);
    const presRate = matches.length ? presencias / matches.length : 0;
    // Base "rendimiento + compromiso" (0–100) y puntos extra por figura/goleador
    const base = (decididos || presencias) ? 0.6 * bayes + 0.4 * presRate : 0;
    const puntos = Math.round(base * 100) + figuras * 5 + goles * 3;
    return { pj, v, e, d, decididos, presencias, winRate, bayes, presRate, figuras, goles, puntos };
  }

  // Lista de jugadores con al menos un partido jugado, con sus stats
  function statList() {
    return players.map(p => ({ p, st: playerStats(p.id) })).filter(x => x.st.pj > 0);
  }

  const rankingVictorias  = statList().sort((a, b) => b.st.v - a.st.v || b.st.winRate - a.st.winRate);
  const rankingPresencias = statList().sort((a, b) => b.st.presencias - a.st.presencias);
  const equipoAnio        = statList().sort((a, b) => b.st.puntos - a.st.puntos).slice(0, 5);

  return (
    <div style={{ minHeight: "100vh", background: "#060c15", fontFamily: "'Outfit','Segoe UI',sans-serif", color: "#e2e8f0", paddingBottom: 80 }}>
      <link href="https://fonts.googleapis.com/css2?family=Bebas+Neue&family=Outfit:wght@300;400;600;700&display=swap" rel="stylesheet" />

      {/* HEADER */}
      <div style={{ background: "linear-gradient(180deg,#0c1c30 0%,#060c15 100%)", borderBottom: "1px solid #0f2d4a", padding: "16px 20px 12px", position: "sticky", top: 0, zIndex: 100 }}>
        <div style={{ maxWidth: 560, margin: "0 auto", display: "flex", alignItems: "center", gap: 12 }}>
          <div style={{ width: 40, height: 40, borderRadius: 11, background: "linear-gradient(135deg,#1e40af,#0ea5e9)", display: "flex", alignItems: "center", justifyContent: "center", fontSize: 20, flexShrink: 0 }}>⚽</div>
          <div>
            <div style={{ fontFamily: "'Bebas Neue',cursive", fontSize: 22, letterSpacing: 3, color: "#fff", lineHeight: 1 }}>FÚTBOL 5 — DOMINGO</div>
            <div style={{ fontSize: 10, color: "#2d4a6a", letterSpacing: 1.5, marginTop: 2 }}>
              {players.length} JUGADORES · {matches.length} PARTIDOS
              {cloud.ready && <span style={{ color: "#10b981", letterSpacing: 0 }}> · ☁️ en la nube</span>}
            </div>
          </div>
        </div>
      </div>

      {/* TABS */}
      <div style={{ background: "#09141f", borderBottom: "1px solid #0f2d4a", display: "flex" }}>
        {[
          { id: "jugadores", label: "JUGADORES", icon: "👥" },
          { id: "equipos",   label: "EQUIPOS",   icon: "🔀" },
          { id: "historial", label: "HISTORIAL",  icon: "📋" },
          { id: "stats",     label: "STATS",      icon: "🏆" },
        ].map(t => (
          <button key={t.id} onClick={() => setTab(t.id)} style={{
            flex: 1, padding: "12px 0", border: "none", background: "transparent",
            color: tab === t.id ? "#0ea5e9" : "#3d5a73",
            borderBottom: `2px solid ${tab === t.id ? "#0ea5e9" : "transparent"}`,
            fontFamily: "'Bebas Neue',cursive", fontSize: 13, letterSpacing: 1,
            cursor: "pointer", display: "flex", alignItems: "center", justifyContent: "center", gap: 4,
          }}>
            {t.icon} {t.label}
          </button>
        ))}
      </div>

      <div style={{ maxWidth: 560, margin: "0 auto", padding: "0 14px" }}>

        {/* ══════ JUGADORES ══════ */}
        {tab === "jugadores" && (
          <>
            <div style={{ marginTop: 18, background: "linear-gradient(145deg,#0c1c30,#09141f)", border: `1px solid ${editId ? "#f59e0b44" : "#0f2d4a"}`, borderRadius: 18, padding: 20 }}>
              <div style={{ fontFamily: "'Bebas Neue',cursive", fontSize: 16, letterSpacing: 2, color: editId ? "#f59e0b" : "#0ea5e9", marginBottom: 16 }}>
                {editId ? "✏️  EDITAR JUGADOR" : "➕  NUEVO JUGADOR"}
              </div>
              <input placeholder="Nombre del jugador…" value={form.name}
                onChange={e => setForm(f => ({ ...f, name: e.target.value }))}
                onKeyDown={e => e.key === "Enter" && handleSave()}
                style={{ width: "100%", padding: "11px 14px", borderRadius: 10, background: "#060c15", border: "1px solid #1a3a55", color: "#e2e8f0", fontSize: 15, outline: "none", boxSizing: "border-box", marginBottom: 18 }} />
              <div style={{ fontSize: 11, color: "#2d4a6a", letterSpacing: 1.5, marginBottom: 12 }}>HABILIDADES (1 – 10)</div>
              {SKILLS.map(s => (
                <ScorePicker key={s.key} sk={s} value={form[s.key]} onChange={v => setForm(f => ({ ...f, [s.key]: v }))} />
              ))}
              <button type="button" onClick={() => setForm(f => ({ ...f, lesionado: !f.lesionado }))} style={{
                width: "100%", marginTop: 4, padding: "11px 14px", borderRadius: 11, cursor: "pointer", textAlign: "left",
                background: form.lesionado ? "#3b1e1e" : "#060c15",
                border: `1px solid ${form.lesionado ? "#ef4444" : "#1a3a55"}`,
                color: form.lesionado ? "#fca5a5" : "#64748b",
                display: "flex", alignItems: "center", gap: 10, fontSize: 14,
              }}>
                <span style={{ fontSize: 18 }}>🚑</span>
                <span style={{ flex: 1 }}>Lesionado{form.lesionado ? " · no entra al armado" : ""}</span>
                <span style={{ fontFamily: "'Bebas Neue',cursive", fontSize: 14, letterSpacing: 1, color: form.lesionado ? "#ef4444" : "#3d5a73" }}>{form.lesionado ? "SÍ" : "NO"}</span>
              </button>
              <div style={{ display: "flex", gap: 10, marginTop: 16 }}>
                <button onClick={handleSave} style={{ flex: 1, padding: 13, borderRadius: 11, background: editId ? "linear-gradient(135deg,#92400e,#f59e0b)" : "linear-gradient(135deg,#1e40af,#0ea5e9)", border: "none", color: "#fff", fontFamily: "'Bebas Neue',cursive", fontSize: 18, letterSpacing: 2, cursor: "pointer" }}>
                  {editId ? "GUARDAR CAMBIOS" : "AGREGAR"}
                </button>
                {editId && (
                  <button onClick={() => { setEditId(null); setForm(EMPTY_FORM); }} style={{ padding: "13px 16px", borderRadius: 11, background: "#0c1c30", border: "1px solid #1a3a55", color: "#3d5a73", cursor: "pointer", fontSize: 18 }}>✕</button>
                )}
              </div>
            </div>

            {players.length >= 2 && (
              <div style={{ marginTop: 12, display: "flex", gap: 10, alignItems: "center", background: "#09141f", borderRadius: 12, padding: "11px 14px", border: "1px solid #0f2d4a" }}>
                <div style={{ flex: 1, fontSize: 12, color: "#3d5a73" }}>{selected.length ? `${selected.length} seleccionados` : "Tocá para seleccionar"}</div>
                <button onClick={() => setSelected(selected.length === players.length ? [] : players.map(p => p.id))}
                  style={{ padding: "6px 12px", borderRadius: 8, background: "#0c1c30", border: "1px solid #1a3a55", color: "#3d5a73", cursor: "pointer", fontSize: 12, whiteSpace: "nowrap" }}>
                  {selected.length === players.length ? "Ninguno" : "Todos"}
                </button>
                <button onClick={handleBalance} style={{ padding: "8px 16px", borderRadius: 10, background: "linear-gradient(135deg,#064e3b,#10b981)", border: "none", color: "#fff", fontFamily: "'Bebas Neue',cursive", fontSize: 16, letterSpacing: 1, cursor: "pointer", whiteSpace: "nowrap" }}>⚡ ARMAR</button>
              </div>
            )}

            <div style={{ marginTop: 12 }}>
              {players.length === 0 ? (
                <div style={{ textAlign: "center", padding: "50px 20px", color: "#1a3a55", border: "1px dashed #1a3a55", borderRadius: 16 }}>
                  <div style={{ fontSize: 42, marginBottom: 8 }}>⚽</div>
                  <div style={{ fontFamily: "'Bebas Neue',cursive", fontSize: 17, letterSpacing: 2 }}>AGREGÁ TUS JUGADORES</div>
                </div>
              ) : players.map(p => {
                const sel = selected.includes(p.id);
                const att = playerAttendance(p.id);
                return (
                  <div key={p.id} onClick={() => toggleSelect(p.id)} style={{ background: sel ? "#0c1e33" : "#09141f", border: `1px solid ${sel ? "#0ea5e9" : p.lesionado ? "#5b2b2b" : "#0f2d4a"}`, borderRadius: 14, padding: "13px 14px", marginBottom: 10, cursor: "pointer", transition: "all .15s", opacity: p.lesionado ? 0.7 : 1 }}>
                    <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 7 }}>
                      <span style={{ fontWeight: 700, fontSize: 15, color: "#f1f5f9", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{p.name}</span>
                      {p.lesionado && <span style={{ fontSize: 11, background: "#3b1e1e", color: "#fca5a5", borderRadius: 5, padding: "1px 6px", flexShrink: 0 }}>🚑</span>}
                      <span style={{ flex: 1 }} />
                      {att.total > 0 && (
                        <span style={{ fontSize: 10, color: "#3d5a73", background: "#0c1c30", padding: "2px 7px", borderRadius: 6 }}>
                          {att.attended}/{att.total} partidos
                        </span>
                      )}
                      {sel && <span style={{ fontSize: 10, background: "#0ea5e920", color: "#0ea5e9", borderRadius: 5, padding: "1px 6px", flexShrink: 0 }}>✓</span>}
                      <button onClick={e => { e.stopPropagation(); toggleLesion(p.id); }} title="Lesionado" style={{ padding: "4px 8px", borderRadius: 7, background: p.lesionado ? "#3b1e1e" : "#0c1c30", border: `1px solid ${p.lesionado ? "#ef4444" : "#1a3a55"}`, color: p.lesionado ? "#fca5a5" : "#64748b", cursor: "pointer", fontSize: 12 }}>🚑</button>
                      <button onClick={e => { e.stopPropagation(); handleEdit(p); }} style={{ padding: "4px 8px", borderRadius: 7, background: "#0c1c30", border: "1px solid #1a3a55", color: "#64748b", cursor: "pointer", fontSize: 12 }}>✏️</button>
                      <button onClick={e => { e.stopPropagation(); handleDelete(p.id); }} style={{ padding: "4px 8px", borderRadius: 7, background: "#0c1c30", border: "1px solid #3b1e1e", color: "#f87171", cursor: "pointer", fontSize: 12 }}>🗑️</button>
                    </div>
                    <SkillDots p={p} />
                  </div>
                );
              })}
            </div>
          </>
        )}

        {/* ══════ EQUIPOS ══════ */}
        {tab === "equipos" && (
          <>
            {!generated ? (
              <div style={{ textAlign: "center", padding: "60px 20px", color: "#1a3a55" }}>
                <div style={{ fontSize: 50, marginBottom: 10 }}>🔀</div>
                <div style={{ fontFamily: "'Bebas Neue',cursive", fontSize: 20, letterSpacing: 2, marginBottom: 20 }}>TODAVÍA NO HAY EQUIPOS</div>
                <button onClick={() => setTab("jugadores")} style={{ padding: "12px 28px", borderRadius: 12, background: "linear-gradient(135deg,#1e40af,#0ea5e9)", border: "none", color: "#fff", fontFamily: "'Bebas Neue',cursive", fontSize: 18, letterSpacing: 2, cursor: "pointer" }}>IR A JUGADORES</button>
              </div>
            ) : (
              <>
                {/* control */}
                <div style={{ marginTop: 16, background: "#09141f", border: "1px solid #0f2d4a", borderRadius: 12, padding: "11px 14px", display: "flex", alignItems: "center", gap: 10 }}>
                  <div style={{ flex: 1, fontSize: 12, color: "#3d5a73" }}>
                    <span style={{ color: diffColor, fontWeight: 700 }}>
                      {parseFloat(diff) <= 0.4 ? "✓ Muy parejos" : parseFloat(diff) <= 1 ? "~ Parejos" : "⚠ Disparejos"}
                    </span>
                  </div>
                  <button onClick={handleRandom} style={{ padding: "7px 12px", borderRadius: 9, background: "#0c1c30", border: "1px solid #1a3a55", color: "#64748b", cursor: "pointer", fontFamily: "'Bebas Neue',cursive", fontSize: 13, letterSpacing: 1 }}>🎲 AZAR</button>
                  <button onClick={handleBalance} style={{ padding: "7px 14px", borderRadius: 9, background: "linear-gradient(135deg,#064e3b,#10b981)", border: "none", color: "#fff", fontFamily: "'Bebas Neue',cursive", fontSize: 13, letterSpacing: 1, cursor: "pointer" }}>⚡ BALANCEAR</button>
                </div>

                {/* camisetas */}
                <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10, marginTop: 12 }}>
                  {[0, 1].map(ti => (
                    <div key={ti} style={{ background: "#09141f", border: "1px solid #0f2d4a", borderRadius: 10, padding: "10px 12px" }}>
                      <div style={{ fontSize: 10, color: "#3d5a73", letterSpacing: 1.5, marginBottom: 8 }}>CAMISETA {ti + 1}</div>
                      <div style={{ display: "flex", flexWrap: "wrap", gap: 5 }}>
                        {PALETTES.map(c => (
                          <div key={c.name} onClick={() => { const n = [...palettes]; n[ti] = c; setPalettes(n); }}
                            style={{ width: 20, height: 20, borderRadius: 4, background: c.bg, border: palettes[ti].name === c.name ? "2px solid #0ea5e9" : "2px solid transparent", cursor: "pointer", boxSizing: "border-box" }} />
                        ))}
                      </div>
                    </div>
                  ))}
                </div>

                {/* equipos sin stats */}
                <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12, marginTop: 14 }}>
                  {[0, 1].map(ti => (
                    <div key={ti} style={{ background: "#09141f", border: `1px solid ${palettes[ti].bg}55`, borderRadius: 16, overflow: "hidden" }}>
                      <div style={{ background: palettes[ti].bg, padding: "10px 14px", display: "flex", alignItems: "center", gap: 8 }}>
                        <Shirt pal={palettes[ti]} num={ti + 1} size={34} />
                        <div style={{ fontFamily: "'Bebas Neue',cursive", fontSize: 18, color: palettes[ti].txt, letterSpacing: 2 }}>EQUIPO {ti + 1}</div>
                      </div>
                      <div style={{ padding: "10px 12px" }}>
                        {teams[ti].map((p, idx) => (
                          <div key={p.id} style={{ display: "flex", alignItems: "center", gap: 10, padding: "8px 0", borderBottom: idx < teams[ti].length - 1 ? "1px solid #0f2040" : "none" }}>
                            <div style={{ width: 24, height: 24, borderRadius: 6, background: palettes[ti].bg + "33", border: `1px solid ${palettes[ti].bg}55`, display: "flex", alignItems: "center", justifyContent: "center", fontFamily: "'Bebas Neue',cursive", fontSize: 13, color: palettes[ti].bg, flexShrink: 0 }}>{idx + 1}</div>
                            <span style={{ fontSize: 14, fontWeight: 600, color: "#f1f5f9" }}>{p.name}</span>
                          </div>
                        ))}
                      </div>
                      <div style={{ background: "#060c15", padding: "6px 12px", borderTop: `1px solid ${palettes[ti].bg}22`, fontSize: 11, color: "#3d5a73", textAlign: "center", letterSpacing: 1 }}>
                        {teams[ti].length} JUGADORES
                      </div>
                    </div>
                  ))}
                </div>

                {/* guardar partido */}
                <button onClick={saveMatchToHistory} style={{ width: "100%", marginTop: 14, padding: 13, borderRadius: 11, background: "linear-gradient(135deg,#1e3a5f,#1e40af)", border: "none", color: "#93c5fd", fontFamily: "'Bebas Neue',cursive", fontSize: 16, letterSpacing: 2, cursor: "pointer" }}>
                  💾 GUARDAR EN HISTORIAL
                </button>

                {/* copiar */}
                <div style={{ marginTop: 12, background: "#09141f", border: "1px solid #0f2d4a", borderRadius: 12, padding: "14px 16px" }}>
                  <div style={{ fontFamily: "'Bebas Neue',cursive", fontSize: 12, letterSpacing: 2, color: "#2d4a6a", marginBottom: 10 }}>📋 LISTO PARA COPIAR</div>
                  <div style={{ background: "#060c15", borderRadius: 10, padding: "12px 14px", fontSize: 14, lineHeight: 1.9, color: "#94a3b8", fontFamily: "monospace", whiteSpace: "pre-wrap", userSelect: "all" }}>
{`⚽ FÚTBOL 5 — DOMINGO

🔴 EQUIPO 1
${teams[0].map((p, i) => `${i + 1}. ${p.name}`).join("\n")}

🔵 EQUIPO 2
${teams[1].map((p, i) => `${i + 1}. ${p.name}`).join("\n")}

¡A jugar! 🎉`}
                  </div>
                  <button onClick={() => {
                    const txt = `⚽ FÚTBOL 5 — DOMINGO\n\n🔴 EQUIPO 1\n${teams[0].map((p, i) => `${i + 1}. ${p.name}`).join("\n")}\n\n🔵 EQUIPO 2\n${teams[1].map((p, i) => `${i + 1}. ${p.name}`).join("\n")}\n\n¡A jugar! 🎉`;
                    navigator.clipboard.writeText(txt).then(() => showToast("✓ Copiado"));
                  }} style={{ width: "100%", marginTop: 10, padding: 11, borderRadius: 10, border: "none", cursor: "pointer", background: "linear-gradient(135deg,#1e40af,#0ea5e9)", color: "#fff", fontFamily: "'Bebas Neue',cursive", fontSize: 16, letterSpacing: 2 }}>
                    📋 COPIAR
                  </button>
                </div>
              </>
            )}
          </>
        )}

        {/* ══════ HISTORIAL ══════ */}
        {tab === "historial" && (
          <>
            {matches.length === 0 ? (
              <div style={{ textAlign: "center", padding: "50px 20px", color: "#1a3a55", border: "1px dashed #1a3a55", borderRadius: 16, marginTop: 18 }}>
                <div style={{ fontSize: 42, marginBottom: 8 }}>📋</div>
                <div style={{ fontFamily: "'Bebas Neue',cursive", fontSize: 17, letterSpacing: 2 }}>
                  ACÁ VAN A APARECER TUS PARTIDOS
                </div>
                <div style={{ fontSize: 12, color: "#2d4a6a", marginTop: 6 }}>
                  Armá equipos y guardá el partido
                </div>
              </div>
            ) : matches.map(m => {
              const pal1 = PALETTES.find(p => p.name === m.pal1) || PALETTES[0];
              const pal2 = PALETTES.find(p => p.name === m.pal2) || PALETTES[1];
              const matchPlayers = [...(m.team1 || []), ...(m.team2 || [])];
              const matchNames = {};
              (m.team1 || []).forEach((id, idx) => { matchNames[id] = (m.team1Names && m.team1Names[idx]) || playerMap[id] || id; });
              (m.team2 || []).forEach((id, idx) => { matchNames[id] = (m.team2Names && m.team2Names[idx]) || playerMap[id] || id; });
              const allPlayers = [...(m.team1 || []), ...(m.team2 || [])];
              const playerMap = {};
              players.forEach(p => { playerMap[p.id] = p.name; });

              return (
                <div key={m.id} style={{ background: "#09141f", border: `1px solid ${m.resultado === "parejo" ? "#10b98133" : m.resultado === "disparejo" ? "#ef444433" : "#0f2d4a"}`, borderRadius: 16, marginTop: 16, overflow: "hidden" }}>
                  {/* header */}
                  <div style={{ padding: "12px 14px", display: "flex", alignItems: "center", justifyContent: "space-between", borderBottom: "1px solid #0f2040" }}>
                    <div>
                      <div style={{ fontFamily: "'Bebas Neue',cursive", fontSize: 16, letterSpacing: 2, color: "#fff" }}>
                        {fmtDate(m.date)}
                      </div>
                      <div style={{ fontSize: 11, color: "#3d5a73" }}>
                        {(m.team1Names?.length || 0) + (m.team2Names?.length || 0)} jugadores
                        {m.ganador === "team1" && <span style={{ color: pal1.bg }}> · ganó Equipo 1</span>}
                        {m.ganador === "team2" && <span style={{ color: pal2.bg }}> · ganó Equipo 2</span>}
                        {m.ganador === "empate" && <span style={{ color: "#94a3b8" }}> · empate</span>}
                      </div>
                    </div>
                    {m.resultado ? (
                      <div style={{
                        padding: "4px 12px", borderRadius: 20, fontSize: 12, fontWeight: 700,
                        background: m.resultado === "parejo" ? "#10b98122" : "#ef444422",
                        color: m.resultado === "parejo" ? "#10b981" : "#ef4444",
                        letterSpacing: 1,
                      }}>
                        {m.resultado === "parejo" ? "👍 PAREJO" : "⚠️ DISPAREJO"}
                      </div>
                    ) : (
                      <div style={{ fontSize: 11, color: "#3d5a73", fontStyle: "italic" }}>sin calificar</div>
                    )}
                  </div>

                  {/* equipos */}
                  <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 1, background: "#0f2040" }}>
                    {[{ names: m.team1Names, pal: pal1, label: "EQUIPO 1" }, { names: m.team2Names, pal: pal2, label: "EQUIPO 2" }].map((t, ti) => (
                      <div key={ti} style={{ background: "#09141f", padding: "10px 12px" }}>
                        <div style={{ fontSize: 11, fontFamily: "'Bebas Neue',cursive", letterSpacing: 1.5, color: t.pal.bg, marginBottom: 6 }}>{t.label}</div>
                        {(t.names || []).map((name, i) => (
                          <div key={i} style={{ fontSize: 13, color: "#94a3b8", paddingBottom: 2 }}>
                            {i + 1}. {name}
                          </div>
                        ))}
                      </div>
                    ))}
                  </div>

                  {/* acciones */}
                  <div style={{ padding: "12px 14px", display: "flex", flexDirection: "column", gap: 10 }}>

                    {/* ¿quién ganó? */}
                    <div>
                      <div style={{ fontSize: 11, color: "#3d5a73", letterSpacing: 1, marginBottom: 8 }}>¿QUIÉN GANÓ?</div>
                      <div style={{ display: "flex", gap: 8 }}>
                        {[
                          { val: "team1",  label: "EQUIPO 1", accent: pal1.bg },
                          { val: "empate", label: "EMPATE",   accent: "#64748b" },
                          { val: "team2",  label: "EQUIPO 2", accent: pal2.bg },
                        ].map(opt => {
                          const on = m.ganador === opt.val;
                          return (
                            <button key={opt.val} onClick={() => setGanador(m.id, opt.val)} style={{
                              flex: 1, padding: "9px 4px", borderRadius: 10, cursor: "pointer",
                              border: `1px solid ${on ? opt.accent : "#1a3a55"}`,
                              background: on ? opt.accent + "22" : "#0c1c30",
                              color: on ? opt.accent : "#64748b",
                              fontFamily: "'Bebas Neue',cursive", fontSize: 13, letterSpacing: 1,
                            }}>{opt.label}</button>
                          );
                        })}
                      </div>
                    </div>

                    {/* ¿estuvo parejo? (feedback para el balanceo) */}
                    <div>
                      <div style={{ fontSize: 11, color: "#3d5a73", letterSpacing: 1, marginBottom: 8 }}>
                        ¿ESTUVO PAREJO? <span style={{ color: "#2d4a6a" }}>· ajusta el balanceo futuro</span>
                      </div>
                      <div style={{ display: "flex", gap: 8 }}>
                        <button onClick={() => setResultado(m.id, "parejo")} style={{ flex: 1, padding: "10px", borderRadius: 10, border: `1px solid ${m.resultado === "parejo" ? "#10b981" : "#10b98144"}`, background: m.resultado === "parejo" ? "#10b98122" : "#10b98111", color: "#10b981", fontFamily: "'Bebas Neue',cursive", fontSize: 15, letterSpacing: 1, cursor: "pointer" }}>
                          👍 PAREJO
                        </button>
                        <button onClick={() => setResultado(m.id, "disparejo")} style={{ flex: 1, padding: "10px", borderRadius: 10, border: `1px solid ${m.resultado === "disparejo" ? "#ef4444" : "#ef444444"}`, background: m.resultado === "disparejo" ? "#ef444422" : "#ef444411", color: "#ef4444", fontFamily: "'Bebas Neue',cursive", fontSize: 15, letterSpacing: 1, cursor: "pointer" }}>
                          ⚠️ DISPAREJO
                        </button>
                      </div>
                      {m.resultado === "disparejo" && m.ganador !== "team1" && m.ganador !== "team2" && (
                        <div style={{ fontSize: 11, color: "#f59e0b", marginTop: 6 }}>
                          Marcá arriba qué equipo se lo llevó cómodo y bajamos a los sobrevalorados.
                        </div>
                      )}
                    </div>

                    {/* figura y goleador (suman puntos extra en la general) */}
                    <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8 }}>
                      {[
                        { label: "⭐ FIGURA", val: m.figura, set: setFigura, accent: "#fbbf24" },
                        { label: "⚽ GOLEADOR", val: m.goleador, set: setGoleador, accent: "#10b981" },
                      ].map((f, fi) => (
                        <div key={fi}>
                          <div style={{ fontSize: 11, color: "#3d5a73", letterSpacing: 1, marginBottom: 6 }}>{f.label}</div>
                          <select value={f.val ?? ""} onChange={e => f.set(m.id, e.target.value === "" ? null : Number(e.target.value))}
                            style={{ width: "100%", padding: "9px 10px", borderRadius: 9, background: "#0c1c30", border: `1px solid ${f.val != null ? f.accent + "88" : "#1a3a55"}`, color: f.val != null ? f.accent : "#64748b", fontSize: 13, outline: "none", cursor: "pointer" }}>
                            <option value="" style={{ color: "#000" }}>— elegir —</option>
                            {matchPlayers.map(pid => (
                              <option key={pid} value={pid} style={{ color: "#000" }}>{matchNames[pid]}</option>
                            ))}
                          </select>
                        </div>
                      ))}
                    </div>

                    {/* asistencias */}
                    <div>
                      <button onClick={() => setAttModal(attModal === m.id ? null : m.id)} style={{ width: "100%", padding: "8px", borderRadius: 8, background: "#0c1c30", border: "1px solid #1a3a55", color: "#64748b", cursor: "pointer", fontSize: 13, fontFamily: "'Bebas Neue',cursive", letterSpacing: 1 }}>
                        {attModal === m.id ? "▲ CERRAR ASISTENCIAS" : `📅 REGISTRAR ASISTENCIAS (${Object.values(m.asistencias || {}).filter(Boolean).length}/${allPlayers.length})`}
                      </button>

                      {attModal === m.id && (
                        <div style={{ marginTop: 10, display: "grid", gridTemplateColumns: "1fr 1fr", gap: 6 }}>
                          {allPlayers.map(pid => {
                            const name = playerMap[pid] || pid;
                            const present = m.asistencias?.[pid] || false;
                            return (
                              <button key={pid} onClick={() => toggleAsistencia(m.id, pid)} style={{
                                padding: "8px 10px", borderRadius: 9, cursor: "pointer",
                                background: present ? "#10b98118" : "#0c1c30",
                                border: `1px solid ${present ? "#10b981" : "#1a3a55"}`,
                                color: present ? "#10b981" : "#475569",
                                fontSize: 13, fontWeight: 600, textAlign: "left",
                                display: "flex", alignItems: "center", gap: 6, transition: "all .15s",
                              }}>
                                <span style={{ fontSize: 14 }}>{present ? "✅" : "⬜"}</span>
                                <span style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{name}</span>
                              </button>
                            );
                          })}
                        </div>
                      )}
                    </div>

                    {/* eliminar */}
                    <button onClick={() => { persistMatches(matches.filter(x => x.id !== m.id)); showToast("Partido eliminado"); }} style={{ padding: "6px", borderRadius: 8, background: "transparent", border: "1px solid #3b1e1e", color: "#7f3131", cursor: "pointer", fontSize: 12 }}>
                      🗑️ Eliminar partido
                    </button>
                  </div>
                </div>
              );
            })}
          </>
        )}

        {/* ══════ STATS ══════ */}
        {tab === "stats" && (
          <>
            {statList().length === 0 ? (
              <div style={{ textAlign: "center", padding: "50px 20px", color: "#1a3a55", border: "1px dashed #1a3a55", borderRadius: 16, marginTop: 18 }}>
                <div style={{ fontSize: 42, marginBottom: 8 }}>🏆</div>
                <div style={{ fontFamily: "'Bebas Neue',cursive", fontSize: 17, letterSpacing: 2 }}>
                  TODAVÍA NO HAY ESTADÍSTICAS
                </div>
                <div style={{ fontSize: 12, color: "#2d4a6a", marginTop: 6 }}>
                  Jugá partidos y cargá resultados y asistencias
                </div>
              </div>
            ) : (
              <>
                {/* EQUIPO DEL AÑO — pieza principal */}
                <div style={{ marginTop: 18, background: "linear-gradient(160deg,#1c1606,#0a0a0a)", border: "1px solid #f5b30144", borderRadius: 18, overflow: "hidden" }}>
                  <div style={{ padding: "14px 16px", borderBottom: "1px solid #f5b30122", display: "flex", alignItems: "center", gap: 10 }}>
                    <span style={{ fontSize: 22 }}>🏆</span>
                    <div>
                      <div style={{ fontFamily: "'Bebas Neue',cursive", fontSize: 20, letterSpacing: 2, color: "#fbbf24", lineHeight: 1 }}>EQUIPO DEL AÑO</div>
                      <div style={{ fontSize: 10, color: "#a16207", letterSpacing: 1, marginTop: 3 }}>EL 5 IDEAL SEGÚN LAS ESTADÍSTICAS</div>
                    </div>
                  </div>
                  <div style={{ padding: "8px 14px 14px" }}>
                    {equipoAnio.map((x, i) => (
                      <div key={x.p.id} style={{ display: "flex", alignItems: "center", gap: 12, padding: "10px 0", borderBottom: i < equipoAnio.length - 1 ? "1px solid #2a210a" : "none" }}>
                        <div style={{ width: 26, textAlign: "center", fontSize: 16 }}>
                          {i === 0 ? "🥇" : i === 1 ? "🥈" : i === 2 ? "🥉" : <span style={{ fontFamily: "'Bebas Neue',cursive", color: "#a16207", fontSize: 15 }}>{i + 1}</span>}
                        </div>
                        <div style={{ flex: 1, minWidth: 0 }}>
                          <div style={{ fontSize: 15, fontWeight: 700, color: "#fef3c7", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{x.p.name}</div>
                          <div style={{ fontSize: 11, color: "#a16207" }}>
                            {x.st.v}G · {x.st.e}E · {x.st.d}P · {x.st.presencias} pres
                            {x.st.figuras > 0 && <span style={{ color: "#fbbf24" }}> · ⭐{x.st.figuras}</span>}
                            {x.st.goles > 0 && <span style={{ color: "#86efac" }}> · ⚽{x.st.goles}</span>}
                          </div>
                        </div>
                        <div style={{ textAlign: "right" }}>
                          <div style={{ fontFamily: "'Bebas Neue',cursive", fontSize: 20, color: "#fbbf24", lineHeight: 1 }}>{x.st.puntos}</div>
                          <div style={{ fontSize: 9, color: "#a16207", letterSpacing: 1 }}>PUNTOS</div>
                        </div>
                      </div>
                    ))}
                  </div>
                </div>

                {/* RANKING DE VICTORIAS */}
                <div style={{ marginTop: 16, background: "#09141f", border: "1px solid #0f2d4a", borderRadius: 16, overflow: "hidden" }}>
                  <div style={{ padding: "12px 16px", borderBottom: "1px solid #0f2040", display: "flex", alignItems: "center", gap: 8 }}>
                    <span style={{ fontSize: 16 }}>⚽</span>
                    <div style={{ fontFamily: "'Bebas Neue',cursive", fontSize: 16, letterSpacing: 2, color: "#10b981" }}>RANKING DE VICTORIAS</div>
                  </div>
                  <div style={{ padding: "4px 14px 10px" }}>
                    {rankingVictorias.map((x, i) => (
                      <div key={x.p.id} style={{ display: "flex", alignItems: "center", gap: 12, padding: "9px 0", borderBottom: i < rankingVictorias.length - 1 ? "1px solid #0f2040" : "none" }}>
                        <div style={{ width: 22, textAlign: "center", fontFamily: "'Bebas Neue',cursive", fontSize: 14, color: "#3d5a73" }}>{i + 1}</div>
                        <div style={{ flex: 1, minWidth: 0, fontSize: 14, fontWeight: 600, color: "#f1f5f9", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{x.p.name}</div>
                        <div style={{ fontSize: 11, color: "#3d5a73" }}>{x.st.decididos ? Math.round(x.st.winRate * 100) + "%" : "—"}</div>
                        <div style={{ minWidth: 54, textAlign: "right" }}>
                          <span style={{ fontFamily: "'Bebas Neue',cursive", fontSize: 18, color: "#10b981" }}>{x.st.v}</span>
                          <span style={{ fontSize: 11, color: "#3d5a73" }}> /{x.st.pj}</span>
                        </div>
                      </div>
                    ))}
                  </div>
                </div>

                {/* RANKING DE PRESENCIAS */}
                <div style={{ marginTop: 16, background: "#09141f", border: "1px solid #0f2d4a", borderRadius: 16, overflow: "hidden" }}>
                  <div style={{ padding: "12px 16px", borderBottom: "1px solid #0f2040", display: "flex", alignItems: "center", gap: 8 }}>
                    <span style={{ fontSize: 16 }}>📅</span>
                    <div style={{ fontFamily: "'Bebas Neue',cursive", fontSize: 16, letterSpacing: 2, color: "#0ea5e9" }}>RANKING DE PRESENCIAS</div>
                  </div>
                  <div style={{ padding: "4px 14px 10px" }}>
                    {rankingPresencias.map((x, i) => {
                      const max = rankingPresencias[0].st.presencias || 1;
                      return (
                        <div key={x.p.id} style={{ display: "flex", alignItems: "center", gap: 12, padding: "9px 0", borderBottom: i < rankingPresencias.length - 1 ? "1px solid #0f2040" : "none" }}>
                          <div style={{ width: 22, textAlign: "center", fontFamily: "'Bebas Neue',cursive", fontSize: 14, color: "#3d5a73" }}>{i + 1}</div>
                          <div style={{ flex: 1, minWidth: 0 }}>
                            <div style={{ fontSize: 14, fontWeight: 600, color: "#f1f5f9", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", marginBottom: 4 }}>{x.p.name}</div>
                            <div style={{ height: 4, borderRadius: 2, background: "#0f2040" }}>
                              <div style={{ height: "100%", width: `${(x.st.presencias / max) * 100}%`, borderRadius: 2, background: "#0ea5e9" }} />
                            </div>
                          </div>
                          <div style={{ minWidth: 30, textAlign: "right", fontFamily: "'Bebas Neue',cursive", fontSize: 18, color: "#0ea5e9" }}>{x.st.presencias}</div>
                        </div>
                      );
                    })}
                  </div>
                </div>

                <div style={{ fontSize: 11, color: "#2d4a6a", textAlign: "center", marginTop: 14, lineHeight: 1.6 }}>
                  Los puntos combinan rendimiento (victorias, suavizado) y compromiso (presencias), más bonus por figura del partido (+5) y goleador (+3).
                </div>
              </>
            )}
          </>
        )}
      </div>

      {/* TOAST */}
      {toast && (
        <div style={{ position: "fixed", bottom: 28, left: "50%", transform: "translateX(-50%)", background: "#0c1c30", border: "1px solid #1a3a55", borderRadius: 12, padding: "11px 22px", color: "#e2e8f0", fontSize: 14, boxShadow: "0 8px 32px #000c", zIndex: 999, whiteSpace: "nowrap" }}>
          {toast}
        </div>
      )}

      <style>{`
        * { box-sizing: border-box; }
        input, select, button { font-family: inherit; }
        input:focus { border-color: #0ea5e9 !important; }
        ::-webkit-scrollbar { width: 3px; }
        ::-webkit-scrollbar-thumb { background: #1a3a55; border-radius: 2px; }
      `}</style>
    </div>
  );
}
