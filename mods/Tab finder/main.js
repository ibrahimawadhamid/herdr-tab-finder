// Tab finder for Herdr: find any tab at a glance.
// A searchable board of your tabs as cards: live status, what each agent is working on, how many agents
// run in each tab, favorites and recent tabs. New tabs appear on their own.
//
// Two ways to use it:
//   * As a tab (a pane): it shows the tabs of the space it lives in, or every space with one click.
//   * As a popup over anything: run `mod.open` with this mod's name (bind a key in keys.json, see README).
//     The popup shows every space and closes when you pick a tab.
// Keys: type to search; arrow keys and Page Up/Down move (past the last card, the next page); Enter opens;
// Ctrl+S stars the selected card and Ctrl+M mutes it; Esc clears the search (in the popup, Esc closes it).
// keys.json can also send "Tab finder.focus", ".favorite", ".mute" and ".clear" (section "mod:Tab finder"),
// and pane.go can move onto a board pane (mod.json: focusable).
//
// Quiet by design: only tabs that need your input are highlighted. A tab whose agent finished while you
// weren't looking gets a small "New output" mark. A tab that finishes 3 or more times within an hour
// (an agent on a loop or a schedule) is marked "On a loop" and never highlighted, and the bell on a card
// mutes "New output" for that tab.
//
// Optional files next to this one (Herdr reloads the board when you save them; a file that isn't valid
// JSON is ignored and named in red at the bottom of the board):
//   config.json  { "title", "name", "space", "noun", "icons": "auto" | "emoji" | "letters" }   all optional
//   notes.json   { "Tab name": "one line", "Space name / Tab name": "one line" }
// Pane props (optional): { "space": "<space name or id>", "scope": "space" | "all" }.
// Favorites, mutes and recent tabs live in Herdr's shared state (keys "tabfinder.*"), so they follow you
// across layouts. Nothing here reaches the network, runs programs or reads files outside this folder.
//
// Made with ❤️ by Ibrahim Awad.

import { View, div, svg } from "gpui-kit";
import { v_flex, h_flex, InputState, Input, ScrollHandle } from "gpui-base";
import { spaces, agents, panes, terminals, machines, run, theme, props, appHome, readTextFile, checking,
         shared, setShared, focused, closeOverlay, fonts, window, settings, placement, nextCommand } from "herdr";

export const VERSION = "1.0.0";

// This mod's folder name, taken from where it was loaded, so a renamed copy (to avoid a name clash) still
// finds its own files, icons and panes. Falls back to the published name.
const SELF = (() => {
  const m = /[\\/]mods[\\/]([^\\/?#]+)[\\/]main\.js/.exec(new Error().stack || "");
  if (!m) return "Tab finder";
  try { return decodeURIComponent(m[1]); } catch { return m[1]; }
})();
const ICON = (name) => `mods/${SELF}/icons/${name}.svg`;

const K = {
  favorites: "tabfinder.favorites",
  recent: "tabfinder.recent",
  muted: "tabfinder.muted",
  finishes: "tabfinder.finishes",
  migrated: "tabfinder.migrated",
  popupScope: "tabfinder.popup.scope",
};
const LOOP_COUNT = 3, LOOP_WINDOW = 60 * 60 * 1000;
const GAP = 12, CARD_MIN = 260, CARD_MAX = 300, CARD_H = 78;
// A popup grows with its content (up to its mod.json height), so its list gets a height of its own.
const POPUP_LIST_MAX = 440, HEAD_H = 16;
// Herdr gives a render a time budget, and a few hundred cards exceed it. So the board draws one page of
// this many cards at a time; search and the counts always cover every tab.
const MAX_CARDS = 100;
const HUES = ["#5b8def", "#22a99a", "#e3814f", "#8b7cf6", "#3fae6a", "#d9649a", "#c9a227", "#4fb3d9"];
// A picture for common kinds of work, matched on the tab's name. Letters are used when nothing matches.
const ICONS = [
  [/\b(release|deploy|ship)/i, "🚀"], [/\b(workflow|pipeline|ci\b|actions)/i, "⚙️"], [/\b(certif|tls\b|ssl\b|crypto|signing|signature)/i, "🔐"],
  [/\b(orchestrat|lead|manager|coordinat)/i, "🧭"], [/\b(subscription|billing|payment|invoice)/i, "💳"],
  [/\b(fix|bug|hotfix|incident)/i, "🔧"], [/\b(marketing|website|seo\b|landing)/i, "🌐"],
  [/\b(devops|infra|ops\b|k8s|kube|cloud|terraform|docker)/i, "🛠️"], [/\b(security|secur|shield|protect)/i, "🛡️"],
  [/\b(jira|board|sprint|ticket|linear|issue|triage)/i, "📋"], [/\b(audit|logs?\b)/i, "🧾"], [/\bflags?\b/i, "🚩"],
  [/\b(ai|llm|models?|ml)\b/i, "🤖"], [/\b(e?mail|inbox)/i, "📧"], [/\b(auth\b|authn|authz|login|sso\b|oauth|identity)/i, "🔑"],
  [/\b(mobile|ios\b|android|flutter|react native)/i, "📱"], [/\b(mock|tests?\b|testing|qa\b|e2e)/i, "🧪"],
  [/\b(data|sql\b|db\b|database|migrat|schema)/i, "🗄️"], [/\b(legal|contract|compliance)/i, "⚖️"], [/\b(sales|crm\b)/i, "📈"],
  [/\b(customer|support|cs\b)/i, "💬"], [/\b(docs?\b|documentation|readme|wiki|writ)/i, "📚"], [/\b(review|pr\b|pull request)/i, "👀"],
  [/\b(front|ui\b|ux\b|design|css\b)/i, "🎨"], [/\b(backend|api\b|server|service)/i, "🧩"], [/\b(research|investig|explor)/i, "🔎"],
  [/\b(plan|roadmap|spec\b|specs\b)/i, "🗺️"], [/\b(chat|slack|discord)/i, "💬"], [/\b(shell|terminal|zsh|bash)/i, "⌨️"],
  [/\b(build|compile)/i, "🏗️"], [/\b(claude|agent|assistant)/i, "✳️"],
];

const hash = (s) => [...s].reduce((h, c) => (h * 31 + c.charCodeAt(0)) >>> 0, 7);
const hueOf = (s) => HUES[hash(s) % HUES.length];
const iconOf = (s) => (ICONS.find(([re]) => re.test(s)) || [null, null])[1];
const base = (p) => (p || "").replace(/[\\/]+$/, "").split(/[\\/]/).pop() || "";
const list = (v) => (Array.isArray(v) ? v : []);
// Agent titles often start with a status glyph or spinner ("✳ Fix login"); drop it.
const cleanTitle = (s) => (s || "").replace(/^[\s⠀-⣿✳✻✽✶✢·*•●○◐◓◑◒]+/u, "").trim();
function ago(ms) {
  if (!ms) return "";
  const m = Math.max(0, Math.round((Date.now() - ms) / 60000));
  if (m < 1) return "just now";
  if (m < 60) return `${m} min ago`;
  const h = Math.round(m / 60);
  if (h < 24) return `${h} hour${h === 1 ? "" : "s"} ago`;
  const d = Math.round(h / 24);
  return `${d} day${d === 1 ? "" : "s"} ago`;
}
function since(ms) {
  const m = Math.max(0, Math.round((Date.now() - ms) / 60000));
  if (m < 1) return "under a minute";
  if (m < 60) return `${m} min`;
  const h = Math.round(m / 60);
  return h < 24 ? `${h} hour${h === 1 ? "" : "s"}` : `${Math.round(h / 24)} day${Math.round(h / 24) === 1 ? "" : "s"}`;
}
function greeting(name) {
  const h = new Date().getHours();
  const g = h < 5 ? "Working late" : h < 12 ? "Good morning" : h < 17 ? "Good afternoon" : "Good evening";
  return name ? `${g}, ${name}` : g;
}
// A theme color with a new alpha (0..1). Theme colors are #rgb, #rrggbb or #rrggbbaa; anything else is
// returned as it is.
function alpha(color, a) {
  let m = /^#([0-9a-f]{3}|[0-9a-f]{6}|[0-9a-f]{8})$/i.exec(color || "");
  if (!m) return color;
  let h = m[1];
  if (h.length === 3) h = [...h].map((c) => c + c).join("");
  return `#${h.slice(0, 6)}${Math.round(Math.max(0, Math.min(1, a)) * 255).toString(16).padStart(2, "0")}`;
}
// Lower case without accents, so "cafe" finds "Café".
function fold(s) {
  const low = (s || "").toLowerCase();
  try { return low.normalize("NFD").replace(/[\u0300-\u036f]/g, ""); } catch { return low; }
}
// Read a live list from Herdr, or [] when this version doesn't have it.
function safe(fn) { try { const v = fn(); return Array.isArray(v) ? v : []; } catch { return []; } }
const plural = (n, one, many) => `${n} ${n === 1 ? one : (many || one + "s")}`;
// Natural order ("Task 2" before "Task 10"), case-insensitive. Written out because not every JavaScript
// engine honors localeCompare's numeric option. naturalKey runs once per tab; naturalCmp per comparison.
const naturalKey = (s) => (s.toLowerCase().match(/\d+|\D+/g) || []).map((c) => (/^\d/.test(c) ? Number(c) : c));
function naturalCmp(x, y) {
  for (let i = 0; i < Math.min(x.length, y.length); i++) {
    const a = x[i], b = y[i];
    if (a === b) continue;
    if (typeof a === "number" && typeof b === "number") return a - b;
    if (typeof a === "number") return -1;
    if (typeof b === "number") return 1;
    return a < b ? -1 : 1;
  }
  return x.length - y.length;
}
// Fuzzy fallback: every character of the query appears in order.
function subseq(q, s) { let i = 0; for (const c of s) if (c === q[i]) i++; return i === q.length; }

export default class TabFinder extends View {
  init(_props, cx) {
    const p = props() || {};
    this.overlay = p.overlay ?? null;
    this.filter = "";
    this.chip = "all";
    this.notes = {};
    this.config = {};
    this.problems = [];
    this.sel = null;
    this.page = 0;
    this.width = 1100;
    this.lastSeen = null;
    this.wasActive = false;
    this.scroll = ScrollHandle.new();
    // Which space a tab copy belongs to: props, else config.json, else the one shown when it first appeared.
    this.home = typeof p.space === "string" && p.space ? p.space : null;
    if (!this.home) { try { this.home = localStorage.getItem("space"); } catch {} }
    const f = focused();
    if (!this.home && f && f.space && !this.overlay) {
      this.home = f.space;
      try { localStorage.setItem("space", f.space); } catch {}
    }
    this.scope = "space";
    if (this.overlay) {
      // The popup shows every space, or only the one you're in when you last chose "This space only".
      this.home = f && f.space ? f.space : null;
      this.scope = shared(K.popupScope) === "space" && this.home ? "space" : "all";
    } else if (p.scope === "all") this.scope = "all";
    else { try { this.scope = localStorage.getItem("scope") || "space"; } catch {} }
    this.input = InputState.new({ placeholder: "Search by name, task or note…" });
    this.input.on("change", (_e, cx) => { this.filter = this.input.value(); this.sel = null; this.page = 0; cx.notify(); });
    this.input.on("submit", () => { const pick = (this.lastFlat || [])[this.pickedIndex()]; if (pick) this.open(pick); });
    this.handle = cx.focus_handle();
    if (this.overlay) this.input.focus();
    if (checking()) return;
    this.migrate();
    // Commands from keys.json ("Tab finder.focus", ".favorite", ".mute", ".clear"), and "focus" from
    // pane.go now that mod.json says the board is focusable.
    cx.spawn(async (cx) => {
      for (;;) {
        let c;
        try { c = await nextCommand(); } catch { return; }
        this.command(c);
        cx.notify();
      }
    });
    if (this.overlay) cx.timer.after(300, () => this.input.focus());
    cx.timer.every(60000, (cx) => cx.notify());   // keeps "5 min ago" honest and lets old finishes expire
    cx.spawn(async (cx) => {
      const dir = `${appHome()}/mods/${SELF}`;
      // A file that is missing is fine; one that can't be read as an object is reported on the board.
      const read = async (name) => {
        let text = null;
        try { text = await readTextFile(`${dir}/${name}`); } catch { return {}; }
        if (text === null || !text.trim()) return {};
        try {
          const v = JSON.parse(text);
          if (v && typeof v === "object" && !Array.isArray(v)) return v;
          this.problems.push(`${name} should hold one { … } object, so it is ignored.`);
        } catch (e) {
          this.problems.push(`${name} isn't valid JSON, so it is ignored (${String(e && e.message || e).slice(0, 80)}).`);
        }
        return {};
      };
      this.notes = await read("notes.json");
      this.config = await read("config.json");
      if (typeof this.config.space === "string" && this.config.space && !(typeof p.space === "string" && p.space) && !this.overlay) {
        this.home = this.config.space;
      }
      cx.notify();
    });
  }

  // Earlier builds kept favorites and recent tabs under "tabboard.*". Copy them over once.
  migrate() {
    if (shared(K.migrated)) return;
    for (const k of ["favorites", "recent"]) {
      const old = list(shared(`tabboard.${k}`));
      if (old.length && !list(shared(K[k])).length) setShared(K[k], old);
    }
    setShared(K.migrated, true);
  }

  // Each time a tab turns "done" (finished while nobody looked), remember when. A tab that does this
  // LOOP_COUNT times within LOOP_WINDOW is on a loop. `changed_at` identifies the event, so several
  // copies of this mod (a pane and a popup) never count the same one twice.
  trackFinishes(all) {
    const now = Date.now();
    const old = shared(K.finishes);
    const prev = old && typeof old === "object" && !Array.isArray(old) ? old : {};
    const live = new Set();
    const next = {};
    let changed = false;
    for (const sp of all) for (const tab of sp.tabs) {
      live.add(tab.id);
      let times = list(prev[tab.id]).filter((x) => typeof x === "number" && now - x < LOOP_WINDOW);
      if (tab.status === "done" && tab.changed_at && !times.includes(tab.changed_at)) { times = [...times, tab.changed_at].slice(-8); changed = true; }
      if (times.length !== list(prev[tab.id]).length) changed = true;
      if (times.length) next[tab.id] = times;
    }
    // Keep tabs we can't see right now (a machine that is offline); drop the rest when they expire.
    for (const id of Object.keys(prev)) {
      if (live.has(id)) continue;
      const times = list(prev[id]).filter((x) => typeof x === "number" && now - x < LOOP_WINDOW);
      if (times.length) next[id] = times;
      if (times.length !== list(prev[id]).length) changed = true;
    }
    if (changed) setShared(K.finishes, next);
    return next;
  }

  // ---- data, rebuilt once per render ----
  snapshot() {
    const all = safe(spaces);
    const allPanes = safe(panes);
    const boards = new Set(allPanes.filter((x) => x.mod === SELF).map((x) => x.tab));
    const home = all.find((s) => s.id === this.home) || all.find((s) => s.name === this.home) || null;
    // First pane of each tab (a terminal when there is one): its program, folder and branch.
    const paneOf = new Map();
    for (const x of allPanes) {
      const had = paneOf.get(x.tab);
      if (!had || (!had.terminal && x.terminal)) paneOf.set(x.tab, x);
    }
    // Agents per tab, and the helpers they started (sub-agents), counted once.
    const byTab = new Map();
    for (const a of safe(agents)) { if (!byTab.has(a.tab)) byTab.set(a.tab, []); byTab.get(a.tab).push(a); }
    const kids = new Map();
    for (const t of safe(terminals)) {
      if (t.state === "live" && t.parent) { if (!kids.has(t.parent)) kids.set(t.parent, []); kids.get(t.parent).push(t.address); }
    }
    const team = (addr, seen) => (kids.get(addr) || []).reduce((n, k) => (seen.has(k) ? n : (seen.add(k), n + 1 + team(k, seen))), 0);
    const info = new Map();
    for (const [tab, as] of byTab) {
      let main = as[0];
      for (const a of as) if (a.focused || (!main.focused && a.seq > main.seq)) main = a;
      const seen = new Set();
      let title = cleanTitle(main.title);
      if (title && main.program && title === main.program.name) title = "";
      info.set(tab, { title, count: as.length + as.reduce((n, a) => n + team(a.address, seen), 0) });
    }
    const finishes = checking() ? {} : this.trackFinishes(all);
    const loops = new Set(Object.keys(finishes).filter((id) => finishes[id].length >= LOOP_COUNT));
    const muted = new Set(list(shared(K.muted)));
    const scoped = this.scope === "all" ? all : [home].filter(Boolean);
    const items = scoped.flatMap((sp) => sp.tabs.filter((t) => !boards.has(t.id)).map((t) => ({ ...t, space: sp })));
    const favs = list(shared(K.favorites));
    const recent = list(shared(K.recent));
    // Machines we can't reach: Herdr still lists their spaces as last seen, so their status is stale.
    const away = new Set(safe(machines).filter((m) => m.name && m.layout === "unavailable").map((m) => m.name));
    const finished = new Set(Object.keys(finishes));
    const memo = { label: new Map(), sub: new Map(), key: new Map() };
    let front = null;
    try { front = (focused() || {}).tab || null; } catch {}
    return { all, boards, home, paneOf, info, items, favs, recent, away, loops, muted, finished, memo, front };
  }

  // Label, subtitle and sort key are worked out once per tab per render (hundreds of tabs sort quickly).
  label(s, tab) {
    let v = s.memo.label.get(tab.id);
    if (v === undefined) { v = this.labelOf(s, tab); s.memo.label.set(tab.id, v); }
    return v;
  }
  labelOf(s, tab) {
    if (tab.named) return tab.name;
    const i = s.info.get(tab.id);
    const pane = s.paneOf.get(tab.id);
    if (i && i.title) return i.title;
    if (pane && pane.terminal) return base(pane.cwd) || pane.program?.name || `Tab ${tab.index}`;
    if (pane && pane.mod) return pane.title || pane.mod;
    return `Tab ${tab.index}`;
  }
  note(tab) {
    const n = this.notes[`${tab.space.name} / ${tab.name}`] ?? this.notes[tab.name];
    return typeof n === "string" ? n : "";
  }
  subtitle(s, tab) {
    let v = s.memo.sub.get(tab.id);
    if (v === undefined) { v = this.subtitleOf(s, tab); s.memo.sub.set(tab.id, v); }
    return v;
  }
  subtitleOf(s, tab) {
    const n = this.note(tab);
    if (n) return n;
    const i = s.info.get(tab.id);
    if (i && i.title && tab.named && i.title !== tab.name) return i.title;
    const pane = s.paneOf.get(tab.id);
    if (!pane || !pane.terminal) return "";
    const where = [base(pane.cwd), pane.branch].filter(Boolean).join(" · ");
    const prog = pane.program?.name || "";
    return [prog, where && `in ${where}`].filter(Boolean).join(" ");
  }
  // "done" that deserves a mark: not muted and not on a loop.
  fresh(s, tab) { return tab.status === "done" && !s.muted.has(tab.id) && !s.loops.has(tab.id) && !this.offline(s, tab); }
  offline(s, tab) { return !!(tab.space && tab.space.machine && s.away.has(tab.space.machine)); }
  // The status to act on: none for a tab on a machine we can't reach.
  live(s, tab) { return this.offline(s, tab) ? null : tab.status; }

  passes(t, s) {
    if (this.chip === "needs") return this.live(s, t) === "blocked";
    if (this.chip === "working") return this.live(s, t) === "working";
    if (this.chip === "favs") return s.favs.includes(t.id);
    return true;
  }
  sortKey(s, tab) {
    let v = s.memo.key.get(tab.id);
    if (v === undefined) { v = naturalKey(this.label(s, tab)); s.memo.key.set(tab.id, v); }
    return v;
  }
  byLabel(s) { return (a, b) => naturalCmp(this.sortKey(s, a), this.sortKey(s, b)); }

  sections(s) {
    const pool = s.items.filter((t) => this.passes(t, s));
    const q = fold(this.filter.trim());
    const mixed = this.scope === "all";   // cards from several spaces: say which one
    if (q) {
      const words = q.split(/\s+/);
      const hay = (t) => fold(`${this.label(s, t)} ${t.name} ${t.space.name} ${t.space.machine || ""} ${this.subtitle(s, t)}`);
      let hits = pool.filter((t) => { const h = hay(t); return words.every((w) => h.includes(w)); });
      if (!hits.length) hits = pool.filter((t) => subseq(q.replace(/\s+/g, ""), fold(this.label(s, t))));
      const starts = (t) => (fold(this.label(s, t)).startsWith(words[0]) ? 0 : 1);
      hits.sort((a, b) => starts(a) - starts(b) || this.byLabel(s)(a, b));
      return [{ title: hits.length ? plural(hits.length, "result") : "", tabs: hits, where: mixed }];
    }
    if (this.chip !== "all") return [{ title: "", tabs: [...pool].sort(this.byLabel(s)), where: mixed }];
    const ids = new Map(pool.map((t) => [t.id, t]));
    const needs = pool.filter((t) => this.live(s, t) === "blocked");
    const favs = s.favs.map((id) => ids.get(id)).filter(Boolean).sort(this.byLabel(s));
    const shownFav = new Set(favs.map((t) => t.id));
    // Recent: where you were before, so not the tab in front and not what Favorites already shows.
    const rec = s.recent.map((id) => ids.get(id)).filter((t) => t && t.id !== s.front && !shownFav.has(t.id)).slice(0, 4);
    const out = [];
    if (needs.length) out.push({ title: "Waiting for you", tabs: needs, where: mixed, loud: true });
    if (favs.length) out.push({ title: "Favorites", tabs: favs, where: mixed });
    if (rec.length) out.push({ title: "Recent", tabs: rec, where: mixed });
    if (mixed) {
      for (const sp of s.all) {
        const ts = pool.filter((t) => t.space.id === sp.id);
        const where = sp.machine ? ` · on ${sp.machine}${s.away.has(sp.machine) ? ", which can't be reached right now" : ""}` : "";
        if (ts.length) out.push({ title: sp.name + where, tabs: ts });
      }
    } else {
      const noun = this.config.noun;
      out.push({ title: typeof noun === "string" && noun ? `All ${noun}s` : "All tabs", tabs: [...pool].sort(this.byLabel(s)) });
    }
    return out;
  }

  // The card Enter opens: the one picked with the arrows, else the first while searching or in the popup.
  pickedIndex() {
    if (this.sel !== null) return this.sel;
    return this.filter || this.overlay ? 0 : -1;
  }

  // Left/right edit the search text, except past its ends: right at the end moves to the next
  // card, left at the start to the previous one. With no text they always move between cards.
  caretAllows(k) {
    if (!this.filter) return true;
    let r = null;
    try { r = this.input.selected_range(); } catch {}
    if (!r || r.start !== r.end) return false;
    const len = this.input.value().length;
    return (k === "right" && r.end >= len) || (k === "left" && r.start <= 0);
  }

  // The card the keyboard acts on: the selected one, else the first while searching or in the popup.
  current() { const i = this.pickedIndex(); return i >= 0 ? (this.lastFlat || [])[i] || null : null; }
  command(c) {
    if (c === "focus") this.input.focus();
    else if (c === "favorite" || c === "mute") {
      const tab = this.current();
      if (tab) this.toggle(c === "favorite" ? K.favorites : K.muted, tab.id);
    } else if (c === "clear") { this.input.set_value(""); this.filter = ""; this.chip = "all"; this.sel = null; this.page = 0; }
  }

  // ---- actions ----
  open(tab) {
    if (tab.space && !tab.space.active) run("space.select", { id: tab.space.id });
    run("tab.select", { id: tab.id });
    if (this.overlay) closeOverlay(this.overlay);
  }
  toggle(key, id) {
    const f = list(shared(key));
    setShared(key, f.includes(id) ? f.filter((x) => x !== id) : [...f, id]);
  }
  noteRecent(id) {
    const r = list(shared(K.recent));
    if (r[0] === id) return;
    setShared(K.recent, [id, ...r.filter((x) => x !== id)].slice(0, 12));
  }

  // ---- pieces ----
  statusLine(t, tab, s) {
    const agent = s.info.has(tab.id);
    if (this.offline(s, tab)) return ["Offline right now", t.dim];
    if (tab.status === "blocked") return ["Needs your input", t.blocked];
    if (tab.status === "working") return [tab.working_since ? `Working for ${since(tab.working_since)}` : "Working", t.working];
    if (this.fresh(s, tab)) return [tab.changed_at ? `New output, ${ago(tab.changed_at)}` : "New output", t.foreground];
    if (tab.settled) return ["Put away, still running", t.dim];
    const a = ago(tab.changed_at);
    const idle = tab.status === "done" || tab.status === "idle" || agent ? "Idle" : "No agent";
    return [a ? `${idle}, last active ${a}` : idle, t.dim];
  }
  dot(t, tab, s) {
    if (this.live(s, tab) === "working") return svg(ICON("spinner")).size(10).flex_none().text_color(t.working).spin(900);
    const c = this.live(s, tab) === "blocked" ? t.blocked : this.fresh(s, tab) ? t.done : t.dim;
    return div().size(8).flex_none().rounded(4).bg(c);
  }
  tile(name) {
    const hue = hueOf(name);
    const ic = this.emoji ? iconOf(name) : null;
    return h_flex().size(36).flex_none().rounded(10).bg(alpha(hue, 0.15)).border_1().border_color(alpha(hue, 0.33))
      .items_center().justify_center()
      .child(ic ? div().text_size(18).child(ic)
                : div().text_size(15).font_bold().text_color(hue).child(([...name][0] || "?").toUpperCase()));
  }
  iconButton(t, id, icon, color, hoverColor, label, tip, act) {
    return div().id(id).flex_none().p(3).rounded(5)
      .role("button").accessibility_label(label).tooltip(tip)
      .text_color(color).cursor_pointer()
      .hover((st) => st.text_color(hoverColor).bg(t.raised))
      .on_click((_e, cx) => { cx.stop_propagation(); act(); })
      .child(svg(ICON(icon)).size(14));
  }
  card(t, s, tab, idx, key, w, where) {
    const fav = s.favs.includes(tab.id);
    const muted = s.muted.has(tab.id);
    const loop = s.loops.has(tab.id);
    const name = this.label(s, tab);
    const sub = this.subtitle(s, tab);
    const n = (s.info.get(tab.id) || {}).count || 0;
    const [line, lineColor] = this.statusLine(t, tab, s);
    const picked = idx === this.pickedIndex();
    const loud = this.live(s, tab) === "blocked";
    const extra = [
      where ? `${tab.space.name}${tab.space.machine ? ` (${tab.space.machine})` : ""}` : "",
      n > 1 ? plural(n, "agent") : !n && tab.panes > 1 ? plural(tab.panes, "pane") : "",
    ].filter(Boolean).join(" · ");
    const star = t.ansi3 || t.accent;
    // The bell only shows where it matters: tabs that finish on their own, or were muted.
    const bell = muted || tab.status === "done" || s.finished.has(tab.id);
    return h_flex()
      .id(`tf-${key}-${tab.id}`)
      .w(w).h(CARD_H).flex_none()
      .pl(12).pr(6).gap(12).items_center()
      .rounded(12).border_1().border_color(picked ? t.accent : loud ? t.blocked : t.border)
      .bg(picked ? t.hover : t.surface)
      .cursor_pointer()
      .hover((st) => st.bg(t.hover).border_color(t.accent))
      .on_click(() => this.open(tab))
      .role("list_box_option")
      .accessibility_label([name, sub, line, extra, loop ? "on a loop" : "", fav ? "favorite" : "", muted ? "muted" : ""]
        .filter(Boolean).join(", "))
      .aria_selected(picked)
      .when(picked, (el) => el.aria_active_descendant())
      .child(this.tile(name))
      .child(v_flex().flex_1().min_w(0).gap(3)
        .child(h_flex().gap(6).items_center().min_w(0)
          .child(div().truncate().text_size(13.5).font_semibold().text_color(t.foreground).child(name))
          .when(loop, (el) => el.child(h_flex().id(`tfloop-${key}-${tab.id}`).flex_none().gap(3).items_center().px(5).rounded(6).bg(t.raised)
            .tooltip("Finished 3 or more times in the last hour, so it isn't highlighted")
            .child(svg(ICON("loop")).size(10).text_color(t.muted))
            .child(div().text_size(10).text_color(t.muted).child("On a loop")))))
        .when(!!sub, (el) => el.child(div().truncate().text_size(11.5).text_color(t.muted).child(sub)))
        .child(h_flex().gap(6).items_center().min_w(0).child(this.dot(t, tab, s))
          .child(div().truncate().text_size(11).text_color(lineColor).child(line + (extra ? ` · ${extra}` : "")))))
      .child(v_flex().flex_none().self_start().mt(6).gap(2).items_center()
        .child(this.iconButton(t, `tfstar-${key}-${tab.id}`, fav ? "star-filled" : "star", fav ? star : t.dim, star,
          fav ? `Remove ${name} from favorites` : `Add ${name} to favorites`,
          fav ? "Remove from favorites (Ctrl+S)" : "Add to favorites (Ctrl+S)",
          () => this.toggle(K.favorites, tab.id)))
        .when(bell, (el) => el.child(this.iconButton(t, `tfmute-${key}-${tab.id}`, muted ? "bell-off" : "bell",
          muted ? t.muted : t.dim, t.foreground,
          muted ? `Unmute new output from ${name}` : `Mute new output from ${name}`,
          muted ? "Unmute new output (Ctrl+M)" : "Mute new output (Ctrl+M)",
          () => this.toggle(K.muted, tab.id)))));
  }
  // One odd tab must not blank the board: draw a plain card instead.
  safeCard(t, s, tab, idx, key, w, where) {
    try { return this.card(t, s, tab, idx, key, w, where); }
    catch {
      return h_flex().id(`tf-${key}-${tab.id}`).w(w).h(CARD_H).flex_none().px(12).items_center().rounded(12)
        .border_1().border_color(t.border).bg(t.surface).cursor_pointer().on_click(() => this.open(tab))
        .child(div().truncate().text_size(13.5).text_color(t.foreground).child(String(tab.name || "Tab")));
    }
  }
  pill(t, label, color, on, id, act) {
    return div().id(id).role("button").px(10).py(4).rounded(14).text_size(11.5)
      .border_1().border_color(on ? t.accent : t.border)
      .bg(on ? alpha(t.accent, 0.13) : t.surface)
      .text_color(on ? t.foreground : color || t.muted)
      .cursor_pointer().hover((st) => st.bg(t.hover))
      .on_click((_e, cx) => { act(); cx.notify(); })
      .child(label);
  }
  credit(t) {
    const heart = t.ansi1 || t.blocked;
    return h_flex().id("tf-credit").flex_none().gap(5).items_center().px(10).py(3).rounded(14)
      .border_1().border_color(t.border)
      .child(div().text_size(11).text_color(t.dim).child("Made with"))
      .child(svg(ICON("heart")).size(11).text_color(heart))
      .child(div().text_size(11).text_color(t.dim).child("by"))
      .child(div().text_size(11).font_semibold().text_color(t.muted).child("Ibrahim Awad"));
  }

  render(cx) {
    const t = theme();
    const s = this.snapshot();
    const sp = s.home;
    // Emoji tiles where an emoji font is likely (macOS and Windows always; Linux when one is installed).
    if (this.emoji === undefined || this.config.icons !== this.iconsSeen) {
      this.iconsSeen = this.config.icons;
      const mode = this.config.icons || "auto";
      let ok = mode !== "letters";
      if (mode === "auto") {
        try { ok = window().platform !== "linux" || fonts().some((x) => /emoji/i.test(x)); } catch { ok = false; }
      }
      this.emoji = ok;
    }
    if (!checking()) {
      // Recent: whatever tab is in front, opened from here or anywhere else.
      const f = focused();
      if (f && f.tab && !s.boards.has(f.tab) && f.tab !== this.lastSeen) { this.lastSeen = f.tab; this.noteRecent(f.tab); }
      // Put the cursor in the search box each time this tab comes to the front.
      if (!this.overlay && sp) {
        const shown = sp.tabs.find((x) => x.active);
        const active = !!(sp.active && shown && s.boards.has(shown.id));
        if (active && !this.wasActive) this.input.focus();
        this.wasActive = active;
      }
    }
    const all = s.items;
    const nBlocked = all.filter((x) => this.live(s, x) === "blocked").length;
    const nWork = all.filter((x) => this.live(s, x) === "working").length;
    // One page of at most MAX_CARDS cards, the most useful sections first.
    const allSecs = this.sections(s).filter((x) => x.tabs.length);
    const total = allSecs.reduce((n, x) => n + x.tabs.length, 0);
    const pages = Math.max(1, Math.ceil(total / MAX_CARDS));
    if (this.page >= pages) this.page = pages - 1;
    const secs = [];
    let skip = this.page * MAX_CARDS, budget = MAX_CARDS;
    for (const x of allSecs) {
      if (budget <= 0) break;
      if (skip >= x.tabs.length) { skip -= x.tabs.length; continue; }
      const tabs = x.tabs.slice(skip, skip + budget);
      skip = 0;
      budget -= tabs.length;
      secs.push({ ...x, tabs });
    }
    const flat = secs.flatMap((x) => x.tabs);
    const before = this.page * MAX_CARDS;
    const after = total - before - flat.length;
    this.lastFlat = flat;
    if (this.sel !== null && this.sel >= flat.length) this.sel = flat.length ? flat.length - 1 : null;

    // Card width: fill the row evenly between CARD_MIN and CARD_MAX; one full-width column when narrow.
    const pad = this.width < 560 ? 14 : 24;
    const avail = Math.max(180, this.width - 2 * pad - 10);   // 10: room for the scrollbar
    let cols = Math.max(1, Math.floor((avail + GAP) / (CARD_MIN + GAP)));
    let w = Math.floor((avail - (cols - 1) * GAP) / cols);
    if (cols > 1 && w > CARD_MAX) w = CARD_MAX;
    if (cols === 1) w = avail;
    const narrow = pad === 14;

    // Rows of cards, laid out here (not by wrapping) so the arrow keys and scrolling know where each card is.
    const rows = [];      // children of the scroll area: { head }, { cards: [[tab, idx]], key }, { page }
    const where = [];     // flat index -> [row among card rows, column, child index in the scroll area]
    const cardRows = [];
    let idx = 0;
    if (before > 0) rows.push({ page: "prev" });
    secs.forEach((x, si) => {
      if (x.title) rows.push({ head: x.title, loud: x.loud, first: rows.length === 0 });
      for (let i = 0; i < x.tabs.length; i += cols) {
        const cards = x.tabs.slice(i, i + cols).map((tab, c) => { where[idx] = [cardRows.length, c, rows.length]; return [tab, idx++]; });
        cardRows.push(cards.map(([, j]) => j));
        rows.push({ cards, key: si, where: x.where });
      }
    });
    if (after > 0) rows.push({ page: "next" });

    // The popup's list: as tall as its rows, never taller than POPUP_LIST_MAX (then it scrolls).
    const contentH = rows.length
      ? rows.reduce((h, r) => h + (r.page ? 30 : r.head ? HEAD_H + (r.first ? 0 : 8) : CARD_H), 0) + GAP * (rows.length - 1) + 12
      : 40;
    const listH = Math.min(POPUP_LIST_MAX, contentH);
    // A popup or a floating block grows with its content, so its list needs a height of its own.
    let floating = false;
    try { floating = !!placement(); } catch {}
    const sized = !!this.overlay || floating;

    const noun = this.scope === "space" && typeof this.config.noun === "string" && this.config.noun ? this.config.noun : "tab";
    const count = plural(all.length, noun);
    const title = this.scope === "all" || !sp ? "All your tabs"
      : (!this.overlay && typeof this.config.title === "string" && this.config.title) || sp.name;
    const chip = (c) => () => { this.chip = this.chip === c ? "all" : c; this.sel = null; this.page = 0; };

    const pills = h_flex().gap(8).items_center().flex_wrap()
      .when(nBlocked > 0, (el) => el.child(this.pill(t, `● ${nBlocked} need${nBlocked === 1 ? "s" : ""} your input`, t.blocked, this.chip === "needs", "tf-needs", chip("needs"))))
      .when(nWork > 0, (el) => el.child(this.pill(t, `${nWork} working`, t.working, this.chip === "working", "tf-work", chip("working"))))
      .child(this.pill(t, "★ Favorites", null, this.chip === "favs", "tf-favs", chip("favs")))
      .when(!this.overlay, (el) => el.child(this.pill(t, this.scope === "all" ? "Showing all spaces" : "Show all spaces", null, this.scope === "all", "tf-scope", () => {
        this.scope = this.scope === "all" ? "space" : "all"; this.sel = null; this.page = 0;
        try { localStorage.setItem("scope", this.scope); } catch {}
      })))
      .when(!!this.overlay && !!this.home, (el) => el.child(this.pill(t, "This space only", null, this.scope === "space", "tf-scope", () => {
        this.scope = this.scope === "all" ? "space" : "all"; this.sel = null; this.page = 0;
        setShared(K.popupScope, this.scope);
      })));

    const empty = this.filter ? "Nothing matches your search. Press Esc to clear it."
      : this.chip === "favs" ? "No favorites yet. Click the star on a card to add one."
      : this.chip === "needs" ? "Nothing needs your input right now."
      : this.chip === "working" ? "Nothing is working right now."
      : !sp && this.scope !== "all" ? (this.home && !/^sp[0-9a-f]{8,}$/.test(String(this.home).split("/").pop())
        ? `There's no space called "${this.home}". Click Show all spaces to see every tab.`
        : "This space isn't here any more. Click Show all spaces to see every tab.")
      : this.scope === "all" ? "No tabs yet. Open one and it shows up here."
      : "No other tabs in this space yet. Open one and it shows up here.";

    // Scroll so a card shows, with what sits just above or below its row: its section title, or the
    // line that turns the page.
    const reveal = (i) => {
      const pos = where[i];
      if (!pos) return;
      let child = pos[2];
      if (pos[2] > 0 && (rows[pos[2] - 1].head || rows[pos[2] - 1].page)) child = pos[2] - 1;
      if (pos[2] > 1 && rows[pos[2] - 1].head && rows[pos[2] - 2].page) child = pos[2] - 2;
      if (rows[pos[2] + 1] && rows[pos[2] + 1].page) child = pos[2] + 1;
      this.scroll.scroll_to_item(child);
    };
    // A page turned with the keys: put the cursor on its first or last card once it is drawn.
    if (this.turned) {
      this.sel = this.turned === "next" ? 0 : flat.length - 1;
      this.turned = null;
      if (flat.length) reveal(this.sel);
    }
    const turn = (dir) => {
      this.page += dir === "next" ? 1 : -1;
      this.turned = dir;
      this.sel = null;
    };
    const move = (k) => {
      const n = flat.length;
      if (!n) return false;
      const cur = this.sel ?? this.pickedIndex();
      if (cur < 0) { this.sel = 0; return true; }
      const [r, c] = where[cur];
      if (k === "left") this.sel = Math.max(0, cur - 1);
      else if (k === "right") this.sel = Math.min(n - 1, cur + 1);
      else {
        const step = k === "down" ? 1 : k === "up" ? -1 : k === "pagedown" ? 4 : -4;
        // Past the last row of a page, the next page; before the first row, the previous one.
        if (step > 0 && r === cardRows.length - 1 && after > 0) { turn("next"); return true; }
        if (step < 0 && r === 0 && before > 0) { turn("prev"); return true; }
        const target = cardRows[Math.min(cardRows.length - 1, Math.max(0, r + step))];
        this.sel = target[Math.min(c, target.length - 1)];
      }
      reveal(this.sel);
      return true;
    };

    return v_flex()
      .id("tf-root")
      .track_focus(this.handle)
      // Sizes here are reported zoomed; card sizes are written at zoom 1 and Herdr scales them.
      .on_size_change((size, cx) => {
        const zoom = Number((settings() || {}).zoom) || 1;
        const width = size.width / zoom;
        if (Math.abs(width - this.width) > 4) { this.width = width; cx.notify(); }
      })
      .size_full()
      .bg(this.overlay ? t.popover : t.background)
      .px(pad).pt(narrow ? 14 : 22).pb(10)
      .gap(14)
      .on_key_down((e, cx) => {
        const k = e.key;
        const m = e.modifiers || {};
        if (m.control && !m.alt && !m.platform && !m.shift && (k === "s" || k === "m")) {
          if (!this.current()) return;
          this.command(k === "s" ? "favorite" : "mute");
        } else if (k === "escape") {
          if (this.filter || this.chip !== "all" || this.sel !== null || this.page) { this.input.set_value(""); this.filter = ""; this.chip = "all"; this.sel = null; this.page = 0; }
          else if (this.overlay) { closeOverlay(this.overlay); return; }
          else return;
        } else if (["down", "up", "pagedown", "pageup"].includes(k) || (["left", "right"].includes(k) && this.caretAllows(k))) {
          if (!move(k)) return;
        } else return;
        cx.stop_propagation();
        cx.notify();
      })
      .child(h_flex().items_end().justify_between().gap(16).flex_wrap()
        .child(v_flex().gap(2).min_w(0)
          .child(div().text_size(12).text_color(t.dim).child(greeting(typeof this.config.name === "string" ? this.config.name : "")))
          .child(h_flex().gap(10).items_center().min_w(0)
            .child(div().truncate().text_size(22).font_bold().text_color(t.foreground).child(title))
            .child(div().flex_none().px(8).py(1).rounded(10).bg(t.raised).text_size(11.5).text_color(t.muted)
              .child(this.scope === "space" && sp && sp.machine
                ? `${count} · on ${sp.machine}${s.away.has(sp.machine) ? ", can't be reached" : ""}` : count))))
        .child(pills))
      .child(h_flex().h(42).flex_none().w_full().max_w(760).px(14).gap(10).items_center()
        .rounded(12).border_1().border_color(t.accent).bg(t.surface)
        .child(svg(ICON("search")).size(16).flex_none().text_color(t.dim))
        .child(Input.new(this.input).flex_1().h_full().text_size(13.5).text_color(t.foreground))
        .when(!narrow, (el) => el.child(div().flex_none().text_size(11).text_color(t.dim)
          .child(this.overlay ? "Enter to open, Esc to close" : this.filter ? "Esc to clear" : "Arrow keys to move, Enter to open"))))
      .child(v_flex().id("tf-scroll").when(sized, (el) => el.h(listH).flex_none()).when(!sized, (el) => el.flex_1()).min_h(0).overflow_y_scrollbar().track_scroll(this.scroll).gap(GAP).pb(12)
        .role("list_box").accessibility_label(this.filter ? "Search results" : "Tabs")
        .when(flat.length === 0, (el) => el.child(div().text_size(12.5).text_color(t.muted).child(empty)))
        .children(rows.map((row, ri) => row.page
          ? h_flex().id(`tf-page-${row.page}`).flex_none().gap(10).items_center().flex_wrap()
              .when(row.page === "next", (el) => el.pt(4))
              .child(div().text_size(11.5).text_color(t.dim).child(row.page === "next"
                ? `Page ${this.page + 1} of ${pages}. Search finds any tab.`
                : `Page ${this.page + 1} of ${pages}.`))
              .child(this.pill(t, row.page === "next" ? "Next page" : "Previous page",
                null, false, `tf-turn-${row.page}`, () => { this.page += row.page === "next" ? 1 : -1; this.sel = null; this.scroll.scroll_to_item(0); }))
          : row.head
          ? div().id(`tfh-${ri}`).when(!row.first, (el) => el.pt(8)).text_size(12).font_semibold()
              .text_color(row.loud ? t.foreground : t.muted).child(row.head)
          : h_flex().id(`tfr-${ri}`).flex_none().gap(GAP).items_start()
              .children(row.cards.map(([tab, i]) => this.safeCard(t, s, tab, i, row.key, w, row.where))))))
      .when(this.problems.length > 0, (el) => el.child(v_flex().flex_none().gap(2)
        .children(this.problems.map((x, i) => div().id(`tf-problem-${i}`).text_size(11).text_color(t.blocked).child(x)))))
      .child(h_flex().flex_none().items_center().justify_between().gap(12).flex_wrap()
        .when(!narrow, (el) => el.child(div().text_size(10.5).text_color(t.dim)
          .child("Star a tab to keep it in Favorites (Ctrl+S). The bell mutes its new output (Ctrl+M).")))
        .child(this.credit(t)));
  }
}
