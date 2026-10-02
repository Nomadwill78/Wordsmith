import { Game, RULES } from "./game.js";
import { STORE } from "./config.js";

const $ = (id) => document.getElementById(id);
const SITE_URL = "https://wordsmiths-gambit.vercel.app/";
// The daily seed is the UTC calendar date, so every player worldwide gets the same floor.
const today = new Date().toISOString().slice(0, 10);

const store = {
  get(k) { try { return localStorage.getItem(k); } catch (_) { return null; } },
  set(k, v) { try { localStorage.setItem(k, v); } catch (_) {} },
};

let game, bank;

// ---------- Daily floor label (UTC) ----------
function updateDaily() {
  const nowUTC = new Date().toISOString().slice(0, 10);
  if (nowUTC !== today) {
    $("demo-date").textContent = "A new daily floor is live. Reload the page to play it.";
    $("h-daily").textContent = "New daily floor is live. Reload to play it.";
    return;
  }
  const now = new Date();
  const next = Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() + 1);
  const mins = Math.max(0, Math.ceil((next - now.getTime()) / 60000));
  const left = `${Math.floor(mins / 60)}h ${mins % 60}m`;
  const local = new Date(next).toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit", timeZoneName: "short" }).replace(":00", ""); // "7:00 PM CDT" -> "7 PM CDT"
  const day = new Date(today + "T00:00:00Z").toLocaleDateString(undefined, { weekday: "long", month: "long", day: "numeric", timeZone: "UTC" });
  $("demo-date").textContent = `${day} (UTC) · same floor for everyone worldwide`;
  const dailyEl = $("h-daily");
  dailyEl.innerHTML = `Daily <span class="long">floor </span>${today} UTC · resets ${escapeHtml(local)}<span class="long"> (in ${left})</span>`;
  dailyEl.setAttribute("aria-label", `Daily floor ${today}, UTC. It resets at 00:00 UTC, which is ${local} for you, in ${left}.`);
}
updateDaily();
setInterval(updateDaily, 30000);

// ---------- Analytics (Vercel Web Analytics) ----------
// Hobby plan doesn't include custom events, so each action is also sent as a virtual page view
// (shows up under Pages as /demo/start, /demo/complete, /buy/base ...). Custom events start working if you move to Pro.
const tracked = new Set();
function track(name, data, once = true) {
  if (once && tracked.has(name)) return;
  tracked.add(name);
  const path = "/" + name.replace(/_/g, "/");
  try {
    window.va?.("event", { name, ...(data ? { data } : {}) });
    window.va?.("pageview", { route: path, path });
  } catch (_) {}
  sbInsert("wg_events", { name }); // own counter in Supabase, works on any Vercel plan
}

async function boot() {
  try {
    const res = await fetch("data/bank.json");
    bank = (await res.json()).words;
  } catch (e) {
    $("event").textContent = "Couldn't load the word bank. Refresh to try again.";
    return;
  }
  $("hint-cost").textContent = RULES.WRONG_LETTER_COST;
  setHint(store.get("wg_hint_seen") !== "1");
  buildKeys();
  newGame();
}

function newGame() {
  demoStarted = false;
  $("h-delta").hidden = true;
  lastSel = -2; lastCursorKey = ""; log = []; lastSeq = -1; flash = null;
  game = new Game(bank, "daily-" + today, render);
  render();
}

// ---------- First-run hint ----------
function setHint(show) {
  $("hint").hidden = !show;
  $("hint-open").hidden = show;
  $("hint-open").setAttribute("aria-expanded", String(show));
  if (!show) store.set("wg_hint_seen", "1");
}
$("hint-close").addEventListener("click", () => { setHint(false); $("game").focus({ preventScroll: true }); });
$("hint-open").addEventListener("click", () => { setHint(true); $("game").focus({ preventScroll: true }); });
$("restart").addEventListener("click", () => { newGame(); $("game").focus({ preventScroll: true }); });

// ---------- Rendering ----------
let cellEls = new Map(), chEls = new Map(), roomEls = [], log = [], lastSeq = -1, flash = null, flashTimer, builtFloor = 0, demoStarted = false, deltaTimer, lastSel = -2, lastCursorKey = "";
function startDemo() {
  ensureVisible();
  // On phones the hint folds away at the first keystroke so the board gets the space (rule chips stay visible).
  if (!demoStarted && window.matchMedia("(max-width: 640px)").matches && !$("hint").hidden) setHint(false);
  if (!demoStarted) { demoStarted = true; track("demo_start"); }
}

// Keep the whole play panel (HUD, clue, board, keyboard) inside the viewport when the player starts typing.
function ensureVisible() {
  const r = $("game").getBoundingClientRect();
  if (r.top < 70 || r.bottom > window.innerHeight + 2) $("game").scrollIntoView({ block: "start" });
}

function buildBoard() {
  const b = $("board");
  b.innerHTML = "";
  cellEls = new Map(); chEls = new Map();
  b.style.setProperty("--cols", game.cols);
  b.style.setProperty("--rows", game.rows);
  // Each room's first square carries the room number printed on the tile.
  const starts = new Map();
  game.rooms.forEach((r) => { const k = game.cells(r.id)[0]; if (!starts.has(k)) starts.set(k, r.id + 1); });
  for (const [k] of game.grid) {
    const [x, y] = k.split(",").map(Number);
    const el = document.createElement("button");
    el.className = "cell";
    el.style.gridColumn = x + 1;
    el.style.gridRow = y + 1;
    el.type = "button";
    el.dataset.k = k;
    el.tabIndex = -1;
    const num = document.createElement("span"), ch = document.createElement("span");
    num.className = "num"; ch.className = "ch";
    num.setAttribute("aria-hidden", "true"); ch.setAttribute("aria-hidden", "true");
    if (starts.has(k)) num.textContent = starts.get(k);
    el.append(num, ch);
    el.addEventListener("click", (e) => clickCell(k, e.detail === 0));
    b.appendChild(el);
    cellEls.set(k, el);
    chEls.set(k, ch);
  }
  buildRooms();
  builtFloor = game.floor;
}

// Rooms panel: one row per word, built once per floor and updated in place.
function buildRooms() {
  const ul = $("rooms");
  ul.innerHTML = "";
  roomEls = game.rooms.map((r) => {
    const li = document.createElement("li"), btn = document.createElement("button");
    btn.type = "button"; btn.className = "room-row";
    btn.innerHTML = '<i class="dot" aria-hidden="true"></i><span><span class="rn"></span><span class="rs"><b></b> · <span class="rd"></span></span></span>';
    btn.querySelector(".rn").textContent = game.monsterName(r.id);
    btn.querySelector(".rd").textContent = `${r.dx ? "Across" : "Down"} · ${r.answer.length}`;
    btn.addEventListener("click", () => { if (game.rooms[r.id].state === "open") { game.select(r.id); $("game").focus({ preventScroll: true }); } });
    li.appendChild(btn); ul.appendChild(li);
    return btn;
  });
}

function updateRooms(playing) {
  game.rooms.forEach((r, i) => {
    const btn = roomEls[i];
    const active = playing && game.sel === r.id;
    const st = active ? "fighting" : r.state === "solved" ? "solved" : r.state === "sealed" ? "sealed" : r.state === "open" ? (r.isBoss ? "awake" : "open") : "locked";
    btn.dataset.st = st;
    btn.classList.toggle("is-active", active);
    btn.disabled = r.state !== "open" || !playing;
    if (active) btn.setAttribute("aria-current", "true"); else btn.removeAttribute("aria-current");
    btn.querySelector("b").textContent = st;
  });
}

// Chronicle: the last seven events, newest first, fading with age.
function updateChronicle() {
  if (game.eventSeq === lastSeq) return;
  lastSeq = game.eventSeq;
  log.unshift({ t: game.event, k: game.eventKind });
  log = log.slice(0, 7);
  const ol = $("chronicle");
  ol.innerHTML = "";
  log.forEach((e, i) => {
    const li = document.createElement("li"), star = document.createElement("span"), txt = document.createElement("span");
    li.dataset.k = e.k; li.style.opacity = Math.max(0.35, 1 - i * 0.12);
    star.textContent = "✦"; star.setAttribute("aria-hidden", "true");
    txt.textContent = e.t;
    li.append(star, txt); ol.appendChild(li);
  });
}

function clickCell(k, fromKeyboard) {
  const rooms = game.grid.get(k).rooms;
  // Prefer a room other than the current one, so clicking a crossing switches direction
  const open = rooms.filter((r) => game.rooms[r].state === "open");
  const pick = open.find((r) => r !== game.sel) ?? open[0];
  if (pick !== undefined) game.select(pick);
  if (!fromKeyboard) $("game").focus({ preventScroll: true });
}

// Screen-reader name: position on the board, direction, square number, clue, and filled/selected state.
function cellLabel(k, roomCells, inSelected, isCursor) {
  const c = game.grid.get(k);
  const [x, y] = k.split(",").map(Number);
  const parts = c.rooms.map((rid) => {
    const r = game.rooms[rid];
    const pos = roomCells[rid].indexOf(k) + 1;
    const status = r.state === "solved" ? ", room solved" : r.state === "locked" ? ", room locked" : r.state === "sealed" ? ", sealed boss word" : r.isBoss ? ", boss word" : "";
    return `${r.dx ? "Across" : "Down"}, square ${pos} of ${r.answer.length}${status}. Clue: ${r.clue}`;
  });
  const letter = game.showLetter(k) ? `Filled with ${c.letter}.` : "Empty.";
  const sel = inSelected && game.status === "playing" ? (isCursor ? " Selected room, next square to type." : " Selected room.") : "";
  return `Row ${y + 1}, column ${x + 1}. ${parts.join(" Crossing: ")} ${letter}${sel}`;
}

function reveal(el) {
  const w = $("board-wrap"), er = el.getBoundingClientRect(), wr = w.getBoundingClientRect(), pad = 10;
  // Narrow screens: the page scrolls and the header and keyboard are sticky, so keep the cell between them.
  if (getComputedStyle($("demo-top")).position === "sticky") {
    const top = $("demo-top").getBoundingClientRect().bottom + pad, bottom = $("demo-bottom").getBoundingClientRect().top - pad;
    if (er.top < top) window.scrollBy({ top: er.top - top, behavior: "instant" });
    else if (er.bottom > bottom) window.scrollBy({ top: er.bottom - bottom, behavior: "instant" });
  }
  if (er.top < wr.top) w.scrollTop -= wr.top - er.top + pad;
  else if (er.bottom > wr.bottom) w.scrollTop += er.bottom - wr.bottom + pad;
  if (er.left < wr.left) w.scrollLeft -= wr.left - er.left + pad;
  else if (er.right > wr.right) w.scrollLeft += er.right - wr.right + pad;
}

function render() {
  if (builtFloor !== game.floor) buildBoard();
  const playing = game.status === "playing";
  const roomCells = game.rooms.map((_, i) => game.cells(i));
  const selCells = game.sel >= 0 ? roomCells[game.sel] : [];
  const curKey = playing && game.sel >= 0 ? selCells[game.cursor] : undefined;
  const bossSel = playing && game.sel >= 0 && game.rooms[game.sel].isBoss;
  if (game.flashKey) { // wrong letter: flash the square for 380ms
    flash = { k: game.flashKey, until: performance.now() + 380 };
    game.flashKey = null;
    clearTimeout(flashTimer);
    flashTimer = setTimeout(render, 400);
  }
  const flashing = flash && performance.now() < flash.until ? flash.k : null;
  for (const [k, el] of cellEls) {
    const i = selCells.indexOf(k), inSel = i >= 0 && playing;
    el.className = "cell " + game.cellClass(k) + (inSel ? " sel" : "") + (inSel && bossSel ? " bossroom" : "") + (k === curKey ? " cursor" : "") + (k === flashing ? " error" : "");
    const cell = game.grid.get(k), shown = game.showLetter(k);
    // Boss letters that crossings already revealed show dimmed, since the boss word must still be typed in full.
    const dim = !shown && bossSel && i >= 0 && cell.revealed;
    const ch = chEls.get(k);
    ch.textContent = shown || dim ? cell.letter : "";
    ch.classList.toggle("dim", dim);
    el.setAttribute("aria-label", cellLabel(k, roomCells, i >= 0, k === curKey));
    el.tabIndex = k === curKey ? 0 : -1;
    if (k === curKey) el.setAttribute("aria-current", "true"); else el.removeAttribute("aria-current");
  }
  if (playing && curKey && (game.sel !== lastSel || curKey !== lastCursorKey)) reveal(cellEls.get(curKey));
  lastSel = game.sel; lastCursorKey = curKey || "";

  $("h-floor").textContent = `${game.floor}/${RULES.DEMO_FLOORS}`;
  $("h-hp").textContent = `${game.hp}/${RULES.START_HP}`;
  $("h-hpbar").style.width = (100 * game.hp / RULES.START_HP) + "%";
  $("h-ink").textContent = game.ink;
  $("h-combo").textContent = "×" + game.combo;
  const comboChip = $("h-combo").parentElement, hot = game.combo >= RULES.COMBO_THRESHOLD;
  comboChip.dataset.lvl = hot ? "3" : game.combo > 0 ? "1" : "0";
  comboChip.title = hot ? `Combo ×${game.combo}: every hit lands 1.5×` : "Combo: clean rooms in a row. At 3, every hit lands 1.5×";
  const bs = game.boss.state;
  $("h-seal").innerHTML = bs === "sealed" ? `<span class="long">Sealed </span>${game.solvedNonBoss()}/${game.needed()}` : bs === "open" ? "Awake" : "Slain";
  $("h-seal").parentElement.dataset.state = bs;

  const r = game.sel >= 0 ? game.rooms[game.sel] : null;
  $("clue").textContent = r && playing ? r.clue : "";
  $("clue-label").textContent = r && playing ? `${r.dx ? "Across" : "Down"} · ${r.answer.length} letters` : "";
  $("room-tag").textContent = r && playing ? `${r.isBoss ? "Boss room" : "Room"} ${r.id + 1}` : "";

  // Enemy panel. A defeated enemy is always drawn at 0 HP, never with the last value it had mid-fight.
  const f = game.fight, k = game.kill;
  const showKill = !f && k && game.status !== "playing";
  $("monster").hidden = !(f || showKill);
  const isBoss = f ? f.boss : showKill ? k.boss : false;
  $("room-card").classList.toggle("is-boss", !!isBoss);
  const sigil = isBoss ? "assets/sigil-boss.svg" : "assets/sigil-monster.svg";
  if ($("sigil").getAttribute("src") !== sigil) $("sigil").setAttribute("src", sigil);
  if (f) {
    $("m-name").textContent = f.name;
    $("m-bar").style.width = (100 * f.hp / f.max) + "%";
    $("m-hp").textContent = `${f.hp}/${f.max} HP`;
  } else if (showKill) {
    $("m-name").textContent = `${k.name} (slain)`;
    $("m-bar").style.width = "0%";
    $("m-hp").textContent = `0/${k.max} HP`;
  }
  updateRooms(playing);
  updateChronicle();

  // Damage rules: mistakes and enemy strikes are separate penalties, each with its own condition.
  $("r-mistake").textContent = `-${RULES.WRONG_LETTER_COST} HP`;
  $("rule-strike").hidden = !f;
  if (f) {
    $("r-strike").textContent = f.hp > 0 ? `-${f.attack} HP` : "none";
    $("r-strike-when").textContent = f.hp > 0 ? "if still alive when you finish" : "none, it is down";
  }

  // What just cost HP, so the number on the HP bar always has a visible reason.
  const d = game.lastDelta;
  game.lastDelta = null;
  if (d) {
    const el = $("h-delta");
    el.textContent = `-${d.n} HP ${d.kind === "strike" ? "enemy strike" : "mistake"}`;
    el.dataset.kind = d.kind;
    el.hidden = false;
    clearTimeout(deltaTimer);
    deltaTimer = setTimeout(() => { el.hidden = true; }, 4000);
  }

  $("event").textContent = game.event;
  $("event").dataset.tone = game.eventKind;
  if (d) shake();
  renderOverlay();
}

function shake() {
  const g = $("game");
  g.classList.remove("shake");
  void g.offsetWidth;
  g.classList.add("shake");
}

// ---------- Results: stats, personal comparison, share ----------
function summary() {
  return {
    seed: today, ink: game.ink, mistakes: game.mistakes, clean: game.cleanRooms, rooms: game.roomsCleared,
    hp: game.hp, won: game.status === "demo_complete", floors: game.status === "demo_complete" ? RULES.DEMO_FLOORS : game.floor - 1,
  };
}

// Better run = cleared the demo, then more Ink, then fewer mistakes.
const better = (a, b) => (a.won !== b.won ? a.won : a.ink !== b.ink ? a.ink > b.ink : a.mistakes < b.mistakes);

function recordResult(s) {
  const storeKey = "wg_scores_" + s.seed;
  let list = [];
  try { list = JSON.parse(store.get(storeKey) || "[]"); } catch (_) {}
  if (!game.recorded) {
    game.recorded = true;
    list.push(s);
    list = list.slice(-20);
    store.set(storeKey, JSON.stringify(list));
  }
  const rank = 1 + list.filter((o) => better(o, s)).length;
  const best = list.reduce((a, o) => (better(o, a) ? o : a), list[0] || s);
  return { rank, n: list.length, best };
}

function shareText(s) {
  return `Wordsmith's Gambit | Daily floor ${s.seed} (UTC)\n` +
    `${s.won ? "Demo cleared" : "Fell on floor " + (s.floors + 1)} | Ink ${s.ink} | Mistakes ${s.mistakes} | Clean rooms ${s.clean}/${s.rooms} | HP ${s.hp}/${RULES.START_HP}\n` +
    `Same floor for everyone: ${SITE_URL}`;
}

async function shareResult(s) {
  const text = shareText(s), note = $("o-note"), box = $("o-share");
  track("demo_share", null, false);
  try {
    if (navigator.share) { await navigator.share({ title: "Wordsmith's Gambit", text }); note.textContent = "Shared."; return; }
  } catch (e) { if (e && e.name === "AbortError") return; }
  try {
    await navigator.clipboard.writeText(text);
    note.textContent = "Result copied. Paste it anywhere to compare with friends.";
  } catch (_) {
    box.value = text; box.hidden = false; box.focus(); box.select();
    note.textContent = "Copy this result and send it to a friend.";
  }
}

function renderOverlay() {
  const o = $("overlay"), s = game.status;
  if (s === "playing") {
    if (!o.hidden) { o.hidden = true; $("game").focus({ preventScroll: true }); } // keep typing working after overlays
    return;
  }
  o.hidden = false;
  const ctas = $("o-ctas");
  ctas.innerHTML = "";
  const stats = $("o-stats"), extra = $("o-extra");
  stats.hidden = true; stats.innerHTML = ""; extra.textContent = "";
  $("o-note").textContent = ""; $("o-share").hidden = true; $("o-kicker").textContent = "";
  const btn = (label, fn, ghost) => {
    const b = document.createElement("button");
    b.className = "btn" + (ghost ? " btn-ghost" : "");
    b.textContent = label;
    b.addEventListener("click", fn);
    ctas.appendChild(b);
    return b;
  };
  const showResult = () => {
    const sm = summary(), rec = recordResult(sm);
    const rows = [
      ["Seed", `${sm.seed} (UTC)`], ["Ink", sm.ink], ["Mistakes", sm.mistakes],
      ["Clean rooms", `${sm.clean} of ${sm.rooms}`], ["Floors cleared", `${sm.floors} of ${RULES.DEMO_FLOORS}`], ["HP left", `${sm.hp}/${RULES.START_HP}`],
    ];
    for (const [label, value] of rows) {
      const wrap = document.createElement("div");
      const dt = document.createElement("dt"), dd = document.createElement("dd");
      dt.textContent = label; dd.textContent = value;
      wrap.append(dt, dd); stats.appendChild(wrap);
    }
    stats.hidden = false;
    extra.textContent = rec.n === 1
      ? "First run on today's floor on this device. Share it to compare with friends on the same seed."
      : rec.rank === 1
        ? `Best run of ${rec.n} on today's floor on this device.`
        : `Ranks #${rec.rank} of ${rec.n} runs on today's floor on this device. Best: ${rec.best.ink} Ink, ${rec.best.mistakes} mistakes.`;
    return sm;
  };
  if (s === "descend") {
    const k = game.kill;
    $("o-kicker").textContent = `Floor ${game.floor} cleared`;
    $("o-title").textContent = "The seal is broken";
    $("o-body").textContent = `${k.name} falls at 0/${k.max} HP. You cleared floor ${game.floor} with ${game.hp} HP and ${game.ink} Ink. Descend to heal ${RULES.FLOOR_HEAL} HP and face a bigger floor.`;
    btn("Descend to floor 2", () => game.descend()).focus();
  } else if (s === "dead") {
    track("demo_death");
    $("o-kicker").textContent = "Your ink runs dry";
    $("o-title").textContent = `Fallen on floor ${game.floor}`;
    $("o-body").textContent = `${game.ink} Ink gathered. In the full game, that Ink buys permanent perks for your next run.`;
    const sm = showResult();
    btn("Try again", newGame).focus();
    btn("Share result", () => shareResult(sm), true);
    btn("Get the full game", () => location.hash = "#buy", true);
    signupLink();
  } else if (s === "demo_complete") {
    track("demo_complete");
    const k = game.kill;
    $("o-kicker").textContent = "Daily floor cleared";
    $("o-title").textContent = "Demo complete";
    $("o-body").textContent = `${k.name} falls at 0/${k.max} HP. Three deeper floors, bigger bosses and the Scriptorium are waiting in the full game.`;
    const sm = showResult();
    btn("Get the full game — $9.99", () => openCheckout("base")).focus();
    btn("Share result", () => shareResult(sm), true);
    btn("Play again", newGame, true);
    signupLink();
  }
}

function signupLink() {
  const a = document.createElement("a");
  a.href = "#signup"; a.className = "o-signup fine";
  a.textContent = "Not today? Get the weekly seed by email";
  $("o-ctas").appendChild(a);
}

function escapeHtml(s) { return s.replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c])); }

// ---------- Input ----------
function buildKeys() {
  const rows = ["QWERTYUIOP", "ASDFGHJKL", "ZXCVBNM"];
  const k = $("keys");
  rows.forEach((row, ri) => {
    const r = document.createElement("div");
    r.className = "key-row";
    for (const ch of row) {
      const b = document.createElement("button");
      b.type = "button"; b.className = "key"; b.textContent = ch;
      b.addEventListener("click", () => { startDemo(); game.type(ch); });
      r.appendChild(b);
    }
    if (ri === 2) {
      const t = document.createElement("button");
      t.type = "button"; t.className = "key key-wide"; t.textContent = "Next ⇥";
      t.setAttribute("aria-label", "Next room");
      t.addEventListener("click", () => game.cycle(1));
      r.appendChild(t);
    }
    k.appendChild(r);
  });
}

const ARROWS = { ArrowLeft: [-1, 0], ArrowRight: [1, 0], ArrowUp: [0, -1], ArrowDown: [0, 1] };

// Arrow keys move focus square to square (skipping gaps), so screen-reader users can walk the board.
function moveFocus(fromKey, dx, dy) {
  let [x, y] = fromKey.split(",").map(Number);
  const limit = Math.max(game.cols, game.rows);
  for (let i = 0; i < limit; i++) {
    x += dx; y += dy;
    const el = cellEls.get(x + "," + y);
    if (el) { el.focus(); return true; }
  }
  return false;
}

document.addEventListener("keydown", (e) => {
  if (!game || e.metaKey || e.ctrlKey || e.altKey) return;
  const active = document.activeElement;
  const inDemo = active === $("game") || $("game").contains(active);
  const typing = ["INPUT", "TEXTAREA"].includes(active?.tagName);
  if (typing || !inDemo) return;
  if (e.key === "Escape") { active.blur(); return; } // Tab is used for rooms, so Escape is the way out of the game
  if (ARROWS[e.key] && game.status === "playing") {
    e.preventDefault();
    const [dx, dy] = ARROWS[e.key];
    if (active.classList?.contains("cell")) moveFocus(active.dataset.k, dx, dy);
    else { const cur = [...cellEls.values()].find((el) => el.tabIndex === 0); (cur || [...cellEls.values()][0])?.focus(); }
    return;
  }
  if (e.key === "Tab" && game.status === "playing") { e.preventDefault(); game.cycle(e.shiftKey ? -1 : 1); return; }
  if (e.key === "Enter" && game.status === "descend") { e.preventDefault(); game.descend(); return; }
  if (/^[a-z]$/i.test(e.key)) { e.preventDefault(); startDemo(); game.type(e.key.toUpperCase()); }
});

// Focus the demo when it scrolls into view, so typing just works
$("game").addEventListener("pointerdown", () => $("game").focus({ preventScroll: true }));
new IntersectionObserver(([en]) => { if (en.isIntersecting && document.activeElement === document.body) $("game").focus({ preventScroll: true }); },
  { threshold: 0.6 }).observe($("game"));

// ---------- Checkout ----------
function openCheckout(tier) {
  const p = STORE.products[tier];
  track("buy_" + tier, { tier }, false);
  if (!p?.checkoutUrl) { location.hash = "#buy"; return; }
  const url = new URL(p.checkoutUrl);
  url.searchParams.set("client_reference_id", "website_" + tier); // shows on the Stripe payment
  location.href = url.toString();
}

document.querySelectorAll("[data-buy]").forEach((b) => b.addEventListener("click", () => openCheckout(b.dataset.buy)));
document.querySelectorAll('[data-track="demo_cta"]').forEach((a) => a.addEventListener("click", () => track("demo_cta")));

// ---------- Email signup ----------
$("waitlist-form").addEventListener("submit", async (e) => {
  e.preventDefault();
  const email = $("wl-email").value.trim();
  const msg = $("wl-msg"), btnEl = e.target.querySelector("button");
  if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) { msg.textContent = "Enter a valid email address."; return; }
  btnEl.disabled = true;
  const ok = await saveEmail(email, "weekly-seed");
  btnEl.disabled = false;
  if (ok) { msg.textContent = "You're in. The next weekly seed is on its way."; e.target.reset(); track("signup", null, false); }
  else msg.textContent = "Something went wrong. Please try again in a minute.";
});

function sbInsert(table, row) {
  const sb = STORE.supabase;
  if (!sb?.url) return Promise.resolve(null);
  return fetch(`${sb.url}/rest/v1/${table}`, {
    method: "POST", keepalive: true,
    headers: { apikey: sb.key, "Content-Type": "application/json", Prefer: "return=minimal" },
    body: JSON.stringify(row),
  }).catch(() => null);
}

async function saveEmail(email, source) {
  if (!STORE.supabase?.url) return true; // local preview without a database
  const res = await sbInsert("wg_subscribers", { email, source });
  return !!res && (res.ok || res.status === 409); // 409 = already subscribed
}

window.__wg = () => game; // debug/QA hook
boot();
