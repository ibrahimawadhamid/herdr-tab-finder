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
// keys.json can also send "Tab finder.focus", ".favorite", ".mute", ".clear" and ".new" (section
// "mod:Tab finder"), and pane.go can move onto a board pane (mod.json: focusable).
//
// Making tabs: the + button opens Herdr's own + menu (terminal, agents, space, worktree), so it always
// offers exactly what Herdr does. When a search matches no tab, the board offers to make one named after
// it: a terminal, or any agent Herdr knows is installed (knownAgents(), the same list the + menu shows).
//
// "In every new space" (off by default, the switch at the bottom of the board): every space made from then
// on gets a board as its first tab, and turning it on can add one to the spaces you already have. Herdr
// tells mods nothing when a space is made, so any open board (or the popup) adds the missing ones; each
// space is handled once, so a board you close stays closed.
//
// Quiet by design: only tabs that need your input are highlighted. A tab whose agent finished while you
// weren't looking gets a small "New output" mark. A tab that finishes 3 or more times within an hour
// (an agent on a loop or a schedule) is marked "On a loop" and never highlighted, and the bell on a card
// mutes "New output" for that tab.
//
// Optional files next to this one (Herdr reloads the board when you save them; a file that isn't valid
// JSON is ignored and named in red at the bottom of the board):
//   config.json  { "name", "icons": "auto" | "emoji" | "letters",
//                  "spaces": { "<space name or id>": { "title", "noun": "agent" | ["person", "people"] } } }
//   notes.json   { "Tab name": "one line", "Space name / Tab name": "one line" }
// Pane props (optional): { "space": "<space name or id>", "scope": "space" | "all", "title", "noun" }.
// Favorites, mutes and recent tabs live in Herdr's shared state (keys "tabfinder.*"), so they follow you
// across layouts. Nothing here reaches the network or reads files outside this folder; the only program it
// ever starts is the system's link opener, when you click the credit to open the project page.
//
// Made with ❤️ by Ibrahim Awad.

import { View, div, svg } from "gpui-kit";
import * as kit from "gpui-kit";
import { v_flex, h_flex, InputState, Input, ScrollHandle } from "gpui-base";
import { spaces, agents, panes, terminals, machines, run, theme, props, appHome, readTextFile, checking,
         shared, setShared, focused, closeOverlay, fonts, window, settings, placement, nextCommand, exec } from "herdr";
// Newer Herdr APIs, looked up at use so the mod still loads on a Herdr without them.
import * as herdr from "herdr";

export const VERSION = "1.2.0";
export const REPO = "https://github.com/ibrahimawadhamid/herdr-tab-finder";

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
  everySpace: "tabfinder.everySpace",      // true: every new space gets a board as its first tab
  spacesSeen: "tabfinder.everySpace.seen", // spaces already given one (or skipped), so each is done once
  moveFirst: "tabfinder.everySpace.move",  // space id -> when its board was added, until it's moved first
};
const BOARD_NAME = "Find a tab";
const LOOP_COUNT = 3, LOOP_WINDOW = 60 * 60 * 1000;
const GAP = 12, CARD_MIN = 260, CARD_MAX = 300, CARD_H = 78;
// A popup grows with its content (up to its mod.json height), so its list gets a height of its own.
const POPUP_LIST_MAX = 440, HEAD_H = 16;
// Everything in a popup but its list (padding, greeting, title, search box, footer), at zoom 1.
const POPUP_CHROME = 196;
// Herdr gives a render a time budget, and a few hundred cards exceed it. So the board draws one page of
// this many cards at a time; search and the counts always cover every tab.
const MAX_CARDS = 100;
const ROW_H = 32;          // a row of the "make a new tab" list
const NAME_MAX = 120;      // a new tab's name, from the search text
const AGENTS_TTL = 60000;  // how long the installed-agents list is reused (Herdr checks at most once a minute)
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
  [/\b(build|compile)/i, "🏗️"], [/\b(agents?|assistant|bots?)\b/i, "🤖"],
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
// Tooltips draw one line per line of text: wrap long text at spaces, and cut very long text short.
function wrap(text, width = 56, max = 300) {
  let t = String(text || "");
  if ([...t].length > max) t = [...t].slice(0, max - 1).join("").trimEnd() + "…";
  return t.split("\n").map((line) => {
    const out = [];
    let cur = "";
    for (const word of line.split(/\s+/)) {
      if (!word) continue;
      if (cur && [...cur].length + 1 + [...word].length > width) { out.push(cur); cur = word; }
      else cur = cur ? `${cur} ${word}` : word;
      while ([...cur].length > width) { out.push([...cur].slice(0, width).join("")); cur = [...cur].slice(width).join(""); }
    }
    if (cur) out.push(cur);
    return out.join("\n");
  }).join("\n");
}
// A new tab's name from search text: one line, at most NAME_MAX characters, cut at a word when it's long.
function tabName(text) {
  const one = String(text || "").trim().replace(/\s+/g, " ");
  const chars = [...one];
  if (chars.length <= NAME_MAX) return one;
  const cut = chars.slice(0, NAME_MAX - 1).join("");
  const at = cut.lastIndexOf(" ");
  return (at > NAME_MAX / 2 ? cut.slice(0, at) : cut).trimEnd() + "…";
}
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
    this.props = p;
    this.overlay = p.overlay ?? null;
    this.filter = "";
    this.chip = "all";
    this.notes = {};
    this.config = {};
    this.problems = [];
    this.sel = null;
    this.page = 0;
    this.width = 1100;
    this.height = 0;
    this.listCap = POPUP_LIST_MAX;   // a popup's list height, lowered when the window is too short for it
    this.lastListH = 0;
    this.lastSeen = null;
    this.wasActive = false;
    this.scroll = ScrollHandle.new();
    this.csel = 0;            // the selected row of the "make a new tab" list
    this.known = {};          // machine ("" here) -> { list, at, loading, failed }: installed agents
    this.making = null;       // { name, target, choices } while the board offers to make a tab
    // Herdr's own + menu (its shipped "new-menu" mod) came with knownAgents(), which it uses, so a Herdr
    // with that API has the menu. Older ones get a plain new terminal tab from the + button.
    this.hasMenu = typeof herdr.openOverlay === "function" && typeof herdr.knownAgents === "function";
    this.asking = false;      // asking whether turning on "In every new space" covers existing spaces
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
    this.input.on("change", (_e, cx) => { this.filter = this.input.value(); this.sel = null; this.page = 0; this.csel = 0; cx.notify(); });
    this.input.on("submit", (_e, cx) => {
      // Keys and Enter can arrive before the board redraws: act only on what the board shows for the
      // text in the box now, and otherwise redraw and wait for the next Enter.
      if (this.input.value() !== this.filter) { this.filter = this.input.value(); this.sel = null; this.page = 0; this.csel = 0; cx.notify(); return; }
      const pick = (this.lastFlat || [])[this.pickedIndex()];
      if (pick) this.open(pick);
      else if (this.making && this.making.name === tabName(this.filter)) this.make(this.making.choices[this.csel] || this.making.choices[0]);
    });
    this.handle = cx.focus_handle();
    if (this.overlay) this.input.focus();
    if (checking()) return;
    this.migrate();
    // Commands from keys.json ("Tab finder.focus", ".favorite", ".mute", ".clear", ".new"), and "focus" from
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
    // "In every new space": a light look for new spaces every 2 seconds, while it's on, without redrawing.
    cx.timer.every(2000, () => { try { if (shared(K.everySpace) === true) this.addToSpaces(this.spaceFacts()); } catch {} });
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

  // Each time a tab turns "done" (finished while nobody looked), remember when, by this computer's clock.
  // A tab that does this LOOP_COUNT times within LOOP_WINDOW is on a loop. Per tab, shared state keeps
  // { at: [times], done }: `done` marks a finish already counted, so it counts once however long it lasts
  // and whatever its other agents do meanwhile, and several copies of this mod never count it twice.
  // It writes only when a tab turns done or stops being done, or when an old finish expires.
  trackFinishes(all) {
    const now = Date.now();
    const old = shared(K.finishes);
    const prev = old && typeof old === "object" && !Array.isArray(old) ? old : {};
    const read = (v) => {
      const e = Array.isArray(v) ? { at: v } : v && typeof v === "object" ? v : {};
      return { at: list(e.at).filter((x) => typeof x === "number"), done: e.done === true };
    };
    const keep = (e) => ({ at: e.at.filter((x) => now - x < LOOP_WINDOW && x <= now + 60000), done: e.done });
    const same = (a, v) => {
      if (!v || Array.isArray(v) || typeof v !== "object") return !a.at.length && !a.done;
      const b = read(v);
      return a.done === b.done && a.at.length === b.at.length && a.at.every((x, i) => x === b.at[i]);
    };
    const next = {};
    let changed = false;
    const seen = new Set();
    for (const sp of all) for (const tab of sp.tabs || []) {
      seen.add(tab.id);
      const e = keep(read(prev[tab.id]));
      if (tab.status === "done") {
        if (!e.done) { e.at = [...e.at, now].slice(-8); e.done = true; }
      } else e.done = false;
      if (e.at.length || e.done) next[tab.id] = e;
      if (!same(e, prev[tab.id])) changed = true;
    }
    // Tabs we can't see right now (a machine that is offline) keep theirs until they expire.
    for (const id of Object.keys(prev)) {
      if (seen.has(id)) continue;
      const e = keep(read(prev[id]));
      if (e.at.length) next[id] = e;
      if (!same(e, prev[id]) || !e.at.length) changed = true;
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
    // Each tab's lead pane, as Herdr's tab bar picks it: its agent, else its first terminal, else any pane.
    const rank = (x) => (x.program && x.program.agent ? 2 : x.terminal ? 1 : 0);
    const paneOf = new Map();
    for (const x of allPanes) {
      const had = paneOf.get(x.tab);
      if (!had || rank(x) > rank(had)) paneOf.set(x.tab, x);
    }
    // Agents per tab, and the helpers they started (sub-agents), counted once.
    const byTab = new Map();
    for (const a of safe(agents)) { if (!byTab.has(a.tab)) byTab.set(a.tab, []); byTab.get(a.tab).push(a); }
    const kids = new Map();
    // What each agent says it is doing (its OSC 7501 message), by terminal address.
    const said = new Map();
    for (const t of safe(terminals)) {
      if (t.state === "live" && t.parent) { if (!kids.has(t.parent)) kids.set(t.parent, []); kids.get(t.parent).push(t.address); }
      const r = t.report && typeof t.report === "object" ? t.report : t.status && typeof t.status === "object" ? t.status : null;
      if (r && typeof r.msg === "string" && r.msg.trim()) said.set(t.address, r.msg.trim());
    }
    const team = (addr, seen) => (kids.get(addr) || []).reduce((n, k) => (seen.has(k) ? n : (seen.add(k), n + 1 + team(k, seen))), 0);
    const info = new Map();
    for (const [tab, as] of byTab) {
      let main = as[0];
      for (const a of as) if (a.focused || (!main.focused && a.seq > main.seq)) main = a;
      // Agents in the tab are counted once each, so a helper that is also an agent here isn't counted twice.
      const seen = new Set(as.map((a) => a.address));
      let title = cleanTitle(main.title);
      if (title && main.program && title === main.program.name) title = "";
      info.set(tab, { title, count: as.length + as.reduce((n, a) => n + team(a.address, seen), 0) });
    }
    const finishes = checking() ? {} : this.trackFinishes(all);
    const loops = new Set(Object.keys(finishes).filter((id) => finishes[id].at.length >= LOOP_COUNT));
    const muted = new Set(list(shared(K.muted)));
    const scoped = this.scope === "all" ? all : [home].filter(Boolean);
    const items = scoped.flatMap((sp) => sp.tabs.filter((t) => !boards.has(t.id)).map((t) => ({ ...t, space: sp })));
    const favs = list(shared(K.favorites));
    const recent = list(shared(K.recent));
    // Machines we can't reach: Herdr still lists their spaces as last seen, so their status is stale.
    const away = new Set(safe(machines).filter((m) => m.name && m.layout === "unavailable").map((m) => m.name));
    const finished = new Set(Object.keys(finishes).filter((id) => finishes[id].at.length));
    const memo = { label: new Map(), sub: new Map(), key: new Map() };
    let front = null;
    try { front = (focused() || {}).tab || null; } catch {}
    return { all, boards, home, paneOf, said, info, items, favs, recent, away, loops, muted, finished, memo, front };
  }

  // Label, subtitle and sort key are worked out once per tab per render (hundreds of tabs sort quickly).
  label(s, tab) {
    let v = s.memo.label.get(tab.id);
    if (v === undefined) { v = this.labelOf(s, tab); s.memo.label.set(tab.id, v); }
    return v;
  }
  // The agent's live title when it says something useful, as Herdr's tab bar judges it: not a path, an
  // address, user@host or the program's own name.
  liveTitle(lead) {
    if (!lead || !lead.program || !lead.program.agent) return "";
    const live = cleanTitle(lead.title);
    const raw = (lead.title || "").replace(/^[^\p{L}\p{N}~/]+/u, "");
    const path = /^[~/]|^[A-Za-z]:\\/.test(raw);
    const prog = lead.program.name;
    return live && live !== lead.terminal && live !== prog && !path && !live.includes("@")
      && live.toLowerCase() !== String(lead.program.key || "").toLowerCase() ? live : "";
  }
  // The same name Herdr's tab bar shows: a name you gave stays; a tab Herdr named (unnamed, or named
  // after its program, as the + menu does) follows its agent's live title.
  labelOf(s, tab) {
    const lead = s.paneOf.get(tab.id);
    const prog = lead && lead.program ? lead.program.name : "";
    const live = this.liveTitle(lead);
    if ((!tab.named || tab.name === prog) && live) return live;
    if (tab.named) return tab.name;
    if (lead && lead.mod) return lead.title || lead.mod;
    return prog || "Terminal";
  }
  // A note is found by the tab's own name (when someone named it) or by the name the card shows, with or
  // without "Space / " in front. Herdr's numbers for unnamed tabs ("2") are never used: they'd match the
  // second tab of every space.
  note(tab, s) {
    const names = [tab.named ? tab.name : null, s ? this.label(s, tab) : null].filter(Boolean);
    for (const n of names) {
      const v = this.notes[`${tab.space.name} / ${n}`] ?? this.notes[n];
      if (typeof v === "string") return v;
    }
    return "";
  }
  subtitle(s, tab) {
    let v = s.memo.sub.get(tab.id);
    if (v === undefined) { v = this.subtitleOf(s, tab); s.memo.sub.set(tab.id, v); }
    return v;
  }
  // Under the name: your note, else what the agent says it is doing, else its live title, else the
  // program and where it runs.
  subtitleOf(s, tab) {
    const n = this.note(tab, s);
    if (n) return n;
    const name = this.label(s, tab);
    const lead = s.paneOf.get(tab.id);
    const msg = lead && lead.terminal ? s.said.get(lead.terminal) : "";
    if (msg && msg !== name) return msg;
    const live = this.liveTitle(lead);
    if (live && live !== name) return live;
    if (!lead || !lead.terminal) return "";
    const where = [base(lead.cwd), lead.branch].filter(Boolean).join(" · ");
    const prog = lead.program && lead.program.name !== name ? lead.program.name : "";
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
      const [, many] = this.custom(s.home).noun;
      out.push({ title: `All ${many}`, tabs: [...pool].sort(this.byLabel(s)) });
    }
    return out;
  }

  // This board's own words, for the space it shows: its props first, then config.json's "spaces"
  // section for that space (by name or id). Older configs kept "title" and "noun" at the top next to the
  // "space" they were meant for; those apply to that space only, never to other boards.
  custom(sp) {
    const str = (v) => (typeof v === "string" && v.trim() ? v.trim() : "");
    const noun = (v) => (Array.isArray(v) && str(v[0]) ? [str(v[0]), str(v[1]) || `${str(v[0])}s`] : str(v) ? [str(v), `${str(v)}s`] : null);
    const c = this.config || {};
    const per = c.spaces && typeof c.spaces === "object" && !Array.isArray(c.spaces) ? c.spaces : {};
    const mine = sp ? per[sp.id] || per[sp.name] || {} : {};
    const legacy = sp && str(c.space) && (str(c.space) === sp.name || str(c.space) === sp.id) ? c : {};
    const p = this.overlay ? {} : this.props || {};
    return {
      title: str(p.title) || str(mine.title) || str(legacy.title),
      noun: noun(p.noun) || noun(mine.noun) || noun(legacy.noun) || ["tab", "tabs"],
    };
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
    else if (c === "new") this.openNewMenu();
  }

  // ---- actions ----
  open(tab) {
    if (tab.space && !tab.space.active) run("space.select", { id: tab.space.id });
    run("tab.select", { id: tab.id });
    if (this.overlay) closeOverlay(this.overlay);
  }
  // The space a new tab goes to: this board's own space, else the one in front.
  target(s) {
    if (this.scope === "space" && s.home) return s.home;
    return s.all.find((x) => x.active) || null;
  }
  // Herdr's own + menu, as its tab bar opens it, for the space in front. Without one (an older Herdr),
  // a new terminal tab.
  openNewMenu() {
    if (checking()) return;
    if (this.overlay) closeOverlay(this.overlay);
    if (this.hasMenu) {
      try { herdr.openOverlay({ mod: "new-menu", kind: "popup", width: 250, height: 512 }); return; } catch {}
    }
    const sp = this.target(this.snapshot());
    run("tab.new", sp ? { space: sp.id } : {});
  }
  // The agents Herdr can start on a machine (the + menu's list), asked once a minute at most.
  agentsOn(machine, cx) {
    const m = machine || "";
    const k = this.known[m];
    if (checking() || typeof herdr.knownAgents !== "function") return [];
    if (!k || (!k.loading && Date.now() - k.at > AGENTS_TTL)) {
      const entry = { list: k ? k.list : [], at: Date.now(), loading: true, failed: false };
      this.known[m] = entry;
      cx.spawn(async (cx) => {
        try {
          const got = await herdr.knownAgents(machine ? { on: machine } : {});
          entry.list = list(got).filter((a) => a && a.installed && Array.isArray(a.run) && a.run.length && a.name);
        } catch { entry.failed = true; }
        entry.loading = false;
        entry.at = Date.now();
        cx.notify();
      });
    }
    return this.known[m].list;
  }
  make(choice) {
    const m = this.making;
    if (!m || !choice || checking()) return;
    const args = { name: m.name };
    if (m.target) args.space = m.target.id;
    if (choice.argv) args.argv = choice.argv;
    this.input.set_value(""); this.filter = ""; this.sel = null; this.page = 0; this.csel = 0; this.making = null;
    if (this.overlay) closeOverlay(this.overlay);
    run("tab.new", args);
  }
  // "In every new space": give each space not seen before a board as its first tab. Spaces are marked
  // as seen before anything is made, so other boards rendering at the same time don't add a second one.
  // Just what addToSpaces needs, without the work of a full snapshot.
  spaceFacts() {
    const all = safe(spaces);
    const boards = new Set(safe(panes).filter((x) => x.mod === SELF).map((x) => x.tab));
    const away = new Set(safe(machines).filter((m) => m.name && m.layout === "unavailable").map((m) => m.name));
    return { all, boards, away };
  }
  // Machines that can't take a new tab yet: unreachable, or still connecting.
  notReady() {
    return new Set(safe(machines).filter((m) => m.name && m.layout && m.layout !== "ready").map((m) => m.name));
  }
  addToSpaces(s) {
    if (checking() || shared(K.everySpace) !== true) return;
    const seen = list(shared(K.spacesSeen));
    // A space on a machine that can't take a tab yet (unreachable, still connecting) waits until it can.
    const wait = this.notReady();
    const fresh = s.all.filter((sp) => sp && sp.id && !seen.includes(sp.id) && !(sp.machine && wait.has(sp.machine)));
    const now = Date.now();
    if (fresh.length) {
      // Spaces that are gone are forgotten only past 1000, and spaces still here are always kept, so a
      // board someone closed never comes back. (A machine that dropped off lists its spaces again later.)
      const here = new Set(s.all.map((sp) => sp.id));
      let ids = [...seen, ...fresh.map((sp) => sp.id)];
      if (ids.length > 1000) {
        let drop = ids.length - 1000;
        ids = ids.filter((id) => (drop > 0 && !here.has(id) ? (drop--, false) : true));
      }
      setShared(K.spacesSeen, ids);
      // Look again just before adding: another copy may have added one since this one looked.
      const boards = new Set(safe(panes).filter((x) => x.mod === SELF).map((x) => x.tab));
      const moves = { ...(shared(K.moveFirst) || {}) };
      for (const sp of fresh) {
        const live = safe(spaces).find((x) => x.id === sp.id) || sp;
        if (live.tabs.some((t) => boards.has(t.id))) continue;
        try {
          run("tab.new", { space: sp.id, name: BOARD_NAME, mod: SELF, props: { space: sp.id }, focus: false });
          moves[sp.id] = now;
        } catch {}
      }
      setShared(K.moveFirst, moves);
    }
    // A board just added goes last; once it shows, any copy moves it to the front (tab.move counts from 1).
    const pending = shared(K.moveFirst);
    if (pending && typeof pending === "object" && Object.keys(pending).length) {
      const left = {};
      for (const [id, at] of Object.entries(pending)) {
        const sp = s.all.find((x) => x.id === id);
        const tab = sp && sp.tabs.find((t) => s.boards.has(t.id));
        if (tab) { if (sp.tabs[0] !== tab) { try { run("tab.move", { id: tab.id, index: 1 }); } catch {} } }
        else if (sp && now - Number(at) < 15000) left[id] = at;
      }
      if (Object.keys(left).length !== Object.keys(pending).length) setShared(K.moveFirst, left);
    }
  }
  // Turning it on: everything already here counts as seen unless `existing`, which adds a board to
  // every space that has none.
  setEverySpace(on, existing, s) {
    this.asking = false;
    if (!on) { setShared(K.everySpace, false); return; }
    setShared(K.spacesSeen, existing ? [] : s.all.map((sp) => sp.id));
    setShared(K.everySpace, true);
  }
  // Spaces with no board that one could be added to now.
  withoutBoard(s) {
    const wait = this.notReady();
    return s.all.filter((sp) => !sp.tabs.some((x) => s.boards.has(x.id)) && !(sp.machine && wait.has(sp.machine))).length;
  }
  everySpaceSwitch(t, s) {
    const on = shared(K.everySpace) === true;
    const without = this.withoutBoard(s);
    return this.pill(t, on ? "In every new space: on" : "In every new space: off", null, on, "tf-every", () => {
      if (on) this.setEverySpace(false, false, s);
      else if (without > 0) this.asking = !this.asking;
      else this.setEverySpace(true, false, s);
    }).accessibility_label(`In every new space, ${on ? "on" : "off"}: give each new space a "${BOARD_NAME}" tab first`)
      .tooltip(on
        ? `Every new space gets a "${BOARD_NAME}" tab first. Click to stop; the ones already added stay.`
        : `Give every new space a "${BOARD_NAME}" tab as its first tab`);
  }
  everySpaceQuestion(t, s) {
    const without = this.withoutBoard(s);
    return h_flex().flex_none().gap(8).items_center().flex_wrap().px(12).py(8).rounded(10)
      .border_1().border_color(t.accent).bg(alpha(t.accent, 0.08))
      .child(div().text_size(12).text_color(t.foreground)
        .child(`New spaces will get a "${BOARD_NAME}" tab first. Add one to the ${plural(without, "space")} without one too?`))
      .child(this.pill(t, `Yes, add ${without === 1 ? "it" : "them"}`, null, true, "tf-every-all", () => this.setEverySpace(true, true, s)))
      .child(this.pill(t, "No, only new spaces", null, false, "tf-every-new", () => this.setEverySpace(true, false, s)))
      .child(this.pill(t, "Cancel", null, false, "tf-every-no", () => { this.asking = false; }));
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
      // Long names and lines are cut to fit the card; hovering shows them whole.
      .when([...name].length > 24 || [...sub].length > 34, (el) => el.tooltip(wrap(sub ? `${name}\n${sub}` : name)))
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
  // Opens the project page in the browser, the way Herdr's own mods open links: the system's link
  // opener, run only when this is clicked.
  openRepo() {
    if (checking()) return;
    let platform = "";
    try { platform = window().platform; } catch {}
    const [cmd, args] = platform === "macos" ? ["open", [REPO]]
      : platform === "windows" ? ["explorer", [REPO]]
      : ["xdg-open", [REPO]];
    try { exec(cmd, args).catch(() => {}); } catch {}
  }
  credit(t) {
    const heart = t.ansi1 || t.blocked;
    return h_flex().id("tf-credit").flex_none().gap(5).items_center().px(10).py(3).rounded(14)
      .border_1().border_color(t.border)
      .cursor_pointer().hover((st) => st.bg(t.hover).border_color(t.accent))
      .role("link").accessibility_label("Made with love by Ibrahim Awad. Open Tab finder on GitHub")
      .tooltip("Open Tab finder on GitHub: star it, report a bug or suggest an idea")
      .on_click(() => this.openRepo())
      .child(div().text_size(11).text_color(t.dim).child("Made with"))
      .child(svg(ICON("heart")).size(11).text_color(heart))
      .child(div().text_size(11).text_color(t.dim).child("by"))
      .child(div().text_size(11).font_semibold().text_color(t.muted).child("Ibrahim Awad"))
      .child(svg(ICON("star")).size(11).text_color(t.dim));
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
      try { this.addToSpaces(s); } catch {}
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
    // A search that matches no tab: offer to make one named after it, in this board's space (or the one
    // in front), as a terminal or any agent Herdr knows is installed there.
    const q = tabName(this.filter);
    let offer = null;
    if (q && total === 0 && this.chip === "all" && !checking()) {
      const target = this.target(s);
      const machine = target && target.machine ? target.machine : null;
      const away = !!(machine && s.away.has(machine));
      const choices = away ? [] : [{ key: "terminal", name: "Terminal", icon: "icons/shell.svg", tint: true, argv: null },
        ...this.agentsOn(machine, cx).map((a) => ({ key: a.key, name: a.name, icon: a.icon, tint: !!a.tint, argv: a.run }))];
      const k = this.known[machine || ""];
      // A board showing one space: say when other spaces have tabs that match.
      let elsewhere = 0;
      if (this.scope === "space") {
        const words = fold(q).split(/\s+/);
        for (const sp of s.all) {
          if (target && sp.id === target.id) continue;
          for (const t of sp.tabs) {
            if (s.boards.has(t.id)) continue;
            const h = fold(`${this.label(s, { ...t, space: sp })} ${t.name || ""} ${sp.name || ""}`);
            if (words.every((w) => h.includes(w))) elsewhere++;
          }
        }
      }
      offer = { name: q, target, choices, away, machine, elsewhere,
        loading: !away && !!(k && k.loading && !k.list.length), failed: !away && !!(k && k.failed && !k.list.length) };
    }
    this.making = offer && offer.choices.length ? offer : null;
    const making = this.making;
    if (making && this.csel >= making.choices.length) this.csel = making.choices.length - 1;
    const before = this.page * MAX_CARDS;
    const after = total - before - flat.length;
    this.lastFlat = flat;
    // The selection follows its tab (in its section), not a position: when statuses change and cards
    // move, the same tab stays selected, or nothing is when it's gone from this page.
    const secOf = secs.flatMap((x) => x.tabs.map(() => x.title));
    const remember = () => {
      this.selRef = this.sel !== null && flat[this.sel] ? { id: flat[this.sel].id, sec: secOf[this.sel] } : null;
    };
    if (this.sel === null) this.selRef = null;
    else if (this.selRef) {
      let i = flat.findIndex((t, j) => t.id === this.selRef.id && secOf[j] === this.selRef.sec);
      if (i < 0) i = flat.findIndex((t) => t.id === this.selRef.id);
      this.sel = i >= 0 ? i : null;
      if (i < 0) this.selRef = null;
    } else if (this.sel >= flat.length) this.sel = flat.length ? flat.length - 1 : null;

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
      : offer ? 40 + offer.choices.length * (ROW_H + GAP) + (offer.loading || offer.failed ? 16 + GAP : 0) + (offer.elsewhere ? 18 : 0)
      : 40;
    const listH = Math.max(Math.min(96, contentH), Math.min(this.listCap, POPUP_LIST_MAX, contentH));
    this.lastListH = listH;
    // A popup or a floating block grows with its content, so its list needs a height of its own.
    let floating = false;
    try { floating = !!placement(); } catch {}
    const sized = !!this.overlay || floating;
    // A short pane (a small laptop screen, a split) drops the greeting and tightens spacing for more cards.
    const short = !sized && this.height > 0 && this.height < 600;

    const mine = this.custom(this.scope === "space" ? sp : null);
    const count = plural(all.length, mine.noun[0], mine.noun[1]);
    const title = this.scope === "all" || !sp ? "All your tabs"
      : mine.title || sp.name;
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

    const empty = this.filter ? (this.overlay ? "Nothing matches your search." : "Nothing matches your search. Press Esc to clear it.")
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
    // Moving down reveals the card's row (and the "Next page" line under the last one); moving up also
    // reveals the section title or "Previous page" line above it. scroll_to_item scrolls as little as it
    // can, so revealing a title when moving down would leave the card itself below the view.
    const shortName = [...q].length > 60 ? [...q].slice(0, 59).join("") + "…" : q;
    const image = typeof kit.image === "function" ? kit.image : null;
    const makeIcon = (c) => {
      try {
        if (c.icon && c.tint) return svg(c.icon).size(15).flex_none().text_color(t.foreground);
        if (c.icon && image) return image(c.icon).size(15).flex_none();
      } catch {}
      return div().w(15).flex_none().text_size(12).font_bold().text_color(t.muted).child(([...c.name][0] || "?").toUpperCase());
    };
    const makeRow = (c, i) => h_flex().id(`tf-make-${i}`).h(ROW_H).flex_none().w_full().max_w(520).px(10).gap(10)
      .items_center().rounded(8).border_1()
      .border_color(i === this.csel ? t.accent : t.border)
      .bg(i === this.csel ? alpha(t.accent, 0.13) : t.surface)
      .role("list_box_option").aria_selected(i === this.csel).when(i === this.csel, (el) => el.aria_active_descendant())
      .accessibility_label(c.argv ? `New tab named ${q}, running ${c.name}` : `New terminal tab named ${q}`)
      .tooltip(c.argv ? `Start ${c.name} in a new tab named "${wrap(q, 56, 200)}"` : `Open a terminal in a new tab named "${wrap(q, 56, 200)}"`)
      .cursor_pointer().hover((st) => st.bg(t.hover))
      .on_click((_e, cx) => { this.csel = i; this.make(c); cx.notify(); })
      .child(makeIcon(c))
      .child(div().flex_1().min_w(0).truncate().text_size(13).text_color(t.foreground).child(c.name))
      .child(div().flex_none().text_size(11).text_color(t.dim).child(i === this.csel ? "Enter" : ""));
    // The offer's rows sit straight in the scrolling list (child 0 is its line), so the keys can scroll to them.
    const offerRows = (el) => el
      .child(div().text_size(12.5).text_color(t.muted).child(offer.away
        ? `Nothing matches "${shortName}", and ${offer.machine} can't be reached, so a new tab can't start there right now.`
        : offer.elsewhere
          ? `Nothing here matches "${shortName}", but ${plural(offer.elsewhere, "tab")} in ${offer.elsewhere === 1 ? "another space does" : "other spaces do"} (${this.overlay ? "turn off This space only" : "click Show all spaces"} to see ${offer.elsewhere === 1 ? "it" : "them"}). Or make a new tab with that name here:`
          : `Nothing matches "${shortName}". Make a new tab with that name${offer.target && offer.target.name ? ` in ${offer.target.name}` : ""}:`))
      .children(offer.choices.map((c, i) => makeRow(c, i)))
      .when(offer.loading, (el) => el.child(div().text_size(11.5).text_color(t.dim).child("Checking which agents are installed…")))
      .when(offer.failed, (el) => el.child(div().text_size(11.5).text_color(t.dim).child("Couldn't check which agents are installed; the + button has Herdr's full list.")));

    const reveal = (i, down) => {
      const pos = where[i];
      if (!pos) return;
      let child = pos[2];
      if (down) {
        if (rows[pos[2] + 1] && rows[pos[2] + 1].page) child = pos[2] + 1;
      } else {
        if (pos[2] > 0 && (rows[pos[2] - 1].head || rows[pos[2] - 1].page)) child = pos[2] - 1;
        if (pos[2] > 1 && rows[pos[2] - 1].head && rows[pos[2] - 2].page) child = pos[2] - 2;
      }
      this.scroll.scroll_to_item(child);
    };
    // A page turned with the keys: put the cursor on its first or last card once it is drawn.
    if (this.turned) {
      const next = this.turned === "next";
      this.sel = next ? 0 : flat.length - 1;
      this.turned = null;
      if (flat.length) { remember(); reveal(this.sel, !next); } else this.sel = null;
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
      if (cur < 0) { this.sel = 0; remember(); reveal(0, false); return true; }
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
      remember();
      reveal(this.sel, k === "down" || k === "pagedown" || k === "right");
      return true;
    };

    return v_flex()
      .id("tf-root")
      .track_focus(this.handle)
      // Sizes here are reported zoomed; card sizes are written at zoom 1 and Herdr scales them.
      .on_size_change((size, cx) => {
        const zoom = Number((settings() || {}).zoom) || 1;
        const width = size.width / zoom;
        const height = size.height / zoom;
        let redraw = false;
        if (Math.abs(width - this.width) > 4) { this.width = width; redraw = true; }
        if (Math.abs(height - this.height) > 4) { this.height = height; redraw = true; }
        // A popup or floating block can't be taller than Herdr allows (a share of the window), and Herdr
        // doesn't say how tall the window is: when this copy comes out shorter than its content, the
        // window is short, so the list gives up the difference and the footer stays in view.
        if (sized && this.lastListH && height < this.lastListH + POPUP_CHROME - 6) {
          const cap = Math.max(96, Math.floor(height - POPUP_CHROME - 6));
          if (cap < this.listCap) { this.listCap = cap; redraw = true; }
        }
        if (redraw) cx.notify();
      })
      .size_full()
      .bg(this.overlay ? t.popover : t.background)
      .px(pad).pt(narrow || short ? 12 : 22).pb(short ? 6 : 10)
      .gap(short ? 10 : 14)
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
        } else if (making && !flat.length && ["down", "up", "pagedown", "pageup"].includes(k)) {
          const n = making.choices.length;
          const step = k === "down" ? 1 : k === "up" ? -1 : k === "pagedown" ? 4 : -4;
          this.csel = Math.max(0, Math.min(n - 1, this.csel + step));
          this.scroll.scroll_to_item(this.csel + 1);
        } else if (["down", "up", "pagedown", "pageup"].includes(k) || (["left", "right"].includes(k) && this.caretAllows(k))) {
          if (!move(k)) return;
        } else return;
        cx.stop_propagation();
        cx.notify();
      })
      .child(h_flex().items_end().justify_between().gap(16).flex_wrap()
        .child(v_flex().gap(2).min_w(0)
          .when(!short, (el) => el.child(div().text_size(12).text_color(t.dim).child(greeting(typeof this.config.name === "string" ? this.config.name : ""))))
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
          .child(making ? "Enter to make it" : this.overlay ? "Enter to open, Esc to close" : this.filter ? "Esc to clear" : "Arrow keys to move, Enter to open")))
        .child(div().id("tf-new").flex_none().p(4).rounded(6)
          .role("button").accessibility_label("New tab")
          .tooltip(this.hasMenu ? "New tab: a terminal, an agent, a space or a worktree" : "New terminal tab")
          .text_color(t.muted).cursor_pointer()
          .hover((st) => st.text_color(t.foreground).bg(t.raised))
          .on_click((_e, cx) => { cx.stop_propagation(); this.openNewMenu(); })
          .child(svg(ICON("plus")).size(15))))
      .child(v_flex().id("tf-scroll").when(sized, (el) => el.h(listH).flex_none()).when(!sized, (el) => el.flex_1()).min_h(0).overflow_y_scrollbar().track_scroll(this.scroll).gap(GAP).pb(12)
        .role("list_box").accessibility_label(this.filter ? "Search results" : "Tabs")
        .when(flat.length === 0 && !offer, (el) => el.child(div().text_size(12.5).text_color(t.muted).child(empty)))
        .when(flat.length === 0 && !!offer, offerRows)
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
      .when(this.asking, (el) => el.child(this.everySpaceQuestion(t, s)))
      .when(this.problems.length > 0, (el) => el.child(v_flex().flex_none().gap(2)
        .children(this.problems.map((x, i) => div().id(`tf-problem-${i}`).text_size(11).text_color(t.blocked).child(x)))))
      .child(h_flex().flex_none().items_center().justify_between().gap(12).flex_wrap()
        .when(!narrow && !short, (el) => el.child(div().text_size(10.5).text_color(t.dim)
          .child("Star a tab to keep it in Favorites (Ctrl+S). The bell mutes its new output (Ctrl+M).")))
        .child(h_flex().gap(8).items_center().flex_wrap()
          .when(!checking(), (el) => el.child(this.everySpaceSwitch(t, s)))
          .child(this.credit(t))));
  }
}
