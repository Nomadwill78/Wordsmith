// Wordsmith's Gambit — browser demo (JS port of the Godot rules, M1–M4)
// Same word bank, same combat numbers. Demo = today's daily run, first 2 floors.

const RULES = {
  START_HP: 30, WRONG_LETTER_COST: 2, MONSTER_HP_PER_LETTER: 3,
  COMBO_THRESHOLD: 3, COMBO_MULT: 1.5, INK_PER_LETTER: 1, INK_PERFECT_BONUS: 5,
  BOSS_HP_MULT: 1.5, BOSS_ATTACK_BONUS: 2, FLOOR_HEAL: 20,
  BOSS_MIN_LENGTH: 7, BASE_WORDS: 6, MAX_WORDS: 10, MAX_COLS: 30, MAX_ROWS: 16,
  BOSS_UNLOCK_RATIO: 0.6, DEMO_FLOORS: 2,
};
const TITLES = ["Wraith", "Warden", "Hollow", "Shade", "Gnasher", "Revenant", "Mimic", "Scribe-Eater"];

// ---------- Seeded RNG ----------
function hashStr(s) { let h = 2166136261; for (const c of s) { h ^= c.charCodeAt(0); h = Math.imul(h, 16777619); } return h >>> 0; }
function mulberry32(a) { return () => { a |= 0; a = (a + 0x6d2b79f5) | 0; let t = Math.imul(a ^ (a >>> 15), 1 | a); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; }; }
const randInt = (rng, lo, hi) => lo + Math.floor(rng() * (hi - lo + 1));
const key = (x, y) => x + "," + y;

// ---------- Floor generation (port of FloorGenerator.gd) ----------
function generateFloor(bank, seed, floorNum) {
  const rng = mulberry32(hashStr(seed + ":" + floorNum));
  const target = Math.min(RULES.BASE_WORDS + floorNum - 1, RULES.MAX_WORDS);
  let best = null;
  for (let a = 0; a < 25; a++) {
    const f = tryBuild(bank, target, rng);
    if (!best || f.rooms.length > best.rooms.length) best = f;
    if (best.rooms.length >= target) break;
  }
  return best;
}

function tryBuild(bank, target, rng) {
  const bosses = bank.filter(w => w.answer.length >= RULES.BOSS_MIN_LENGTH);
  const boss = bosses[randInt(rng, 0, bosses.length - 1)];
  const others = bank.filter(w => w.answer.length < boss.answer.length);
  for (let i = others.length - 1; i > 0; i--) { const j = randInt(rng, 0, i); [others[i], others[j]] = [others[j], others[i]]; }
  const st = { grid: new Map(), rooms: [], lo: [0, 0], hi: [0, 0] };
  place(st, boss, 0, 0, 1, 0);
  for (const e of others) {
    if (st.rooms.length >= target) break;
    const p = bestPlacement(st, e.answer, rng);
    if (p) place(st, e, p.x, p.y, p.dx, p.dy);
  }
  // normalize
  const [mx, my] = st.lo, grid = new Map();
  for (const [k, c] of st.grid) { const [x, y] = k.split(",").map(Number); grid.set(key(x - mx, y - my), c); }
  st.rooms.forEach(r => { r.x -= mx; r.y -= my; });
  st.rooms[0].isBoss = true;
  return { grid, rooms: st.rooms, bossId: 0, cols: st.hi[0] - mx + 1, rows: st.hi[1] - my + 1 };
}

function bestPlacement(st, word, rng) {
  let opts = [], bestScore = 0;
  const cells = [...st.grid.keys()].sort();
  for (const k of cells) {
    const [cx, cy] = k.split(",").map(Number);
    for (let i = 0; i < word.length; i++) {
      if (st.grid.get(k).letter !== word[i]) continue;
      for (const [dx, dy] of [[1, 0], [0, 1]]) {
        const x = cx - dx * i, y = cy - dy * i, s = score(st, word, x, y, dx, dy);
        if (s > bestScore) { bestScore = s; opts = [{ x, y, dx, dy }]; }
        else if (s === bestScore && s > 0) opts.push({ x, y, dx, dy });
      }
    }
  }
  return opts.length ? opts[randInt(rng, 0, opts.length - 1)] : null;
}

function score(st, word, x, y, dx, dy) {
  const g = st.grid, px = dy, py = dx, ex = x + dx * (word.length - 1), ey = y + dy * (word.length - 1);
  if (g.has(key(x - dx, y - dy)) || g.has(key(ex + dx, ey + dy))) return 0;
  const lo = [Math.min(st.lo[0], x), Math.min(st.lo[1], y)], hi = [Math.max(st.hi[0], ex), Math.max(st.hi[1], ey)];
  if (hi[0] - lo[0] + 1 > RULES.MAX_COLS || hi[1] - lo[1] + 1 > RULES.MAX_ROWS) return 0;
  let hits = 0;
  for (let i = 0; i < word.length; i++) {
    const cx = x + dx * i, cy = y + dy * i, c = g.get(key(cx, cy));
    if (c) {
      if (c.letter !== word[i]) return 0;
      if (c.rooms.some(r => st.rooms[r].dx === dx)) return 0;
      hits++;
    } else if (g.has(key(cx + px, cy + py)) || g.has(key(cx - px, cy - py))) return 0;
  }
  return hits;
}

function place(st, e, x, y, dx, dy) {
  const id = st.rooms.length;
  st.rooms.push({ id, answer: e.answer, clue: e.clue, x, y, dx, dy, state: "locked", isBoss: false });
  const ex = x + dx * (e.answer.length - 1), ey = y + dy * (e.answer.length - 1);
  st.lo = [Math.min(st.lo[0], x), Math.min(st.lo[1], y)]; st.hi = [Math.max(st.hi[0], ex), Math.max(st.hi[1], ey)];
  for (let i = 0; i < e.answer.length; i++) {
    const k = key(x + dx * i, y + dy * i);
    if (!st.grid.has(k)) st.grid.set(k, { letter: e.answer[i], rooms: [], revealed: false });
    st.grid.get(k).rooms.push(id);
  }
}

// ---------- Game state ----------
export class Game {
  constructor(bank, seed, onChange) {
    Object.assign(this, { bank, seed, onChange: () => {} });
    this.hp = RULES.START_HP; this.ink = 0; this.combo = 0; this.floor = 0;
    // Run stats shown on the result card
    this.mistakes = 0;      // wrong letters typed
    this.cleanRooms = 0;    // rooms finished with zero mistakes
    this.roomsCleared = 0;  // rooms finished by typing (crossing auto-solves are not counted)
    this.recorded = false;  // result already saved to the local score list
    this.lastDelta = null;  // last HP loss the player took: { kind: "mistake" | "strike", n }
    this.eventKind = "info"; // hit | hurt | solve | boss | info, used to colour the Chronicle log
    this.eventSeq = 0;      // goes up on every new event so the UI can log each one once
    this.flashKey = null;   // grid square that just took a wrong letter
    this.status = "playing"; // playing | descend | dead | demo_complete
    this.startFloor(1);
    this.onChange = onChange; // attach after setup so the UI never sees a half-built game
  }
  ev(text, kind) { this.event = text; this.eventKind = kind; this.eventSeq++; }
  monsterName(id) {
    const r = this.rooms[id], nrng = mulberry32(hashStr(this.seed + ":" + this.floor + ":" + id));
    return r.answer[0] + r.answer.slice(1).toLowerCase() + " " + (r.isBoss ? "Tyrant" : TITLES[randInt(nrng, 0, TITLES.length - 1)]);
  }
  cells(id) { const r = this.rooms[id]; return [...r.answer].map((_, i) => key(r.x + r.dx * i, r.y + r.dy * i)); }
  get boss() { return this.rooms[this.bossId]; }
  needed() { return Math.ceil((this.rooms.length - 1) * RULES.BOSS_UNLOCK_RATIO); }
  solvedNonBoss() { return this.rooms.filter(r => r.state === "solved" && !r.isBoss).length; }

  startFloor(n) {
    this.floor = n;
    Object.assign(this, generateFloor(this.bank, this.seed, n));
    this.boss.state = "sealed";
    for (const k of this.cells(this.bossId)) for (const r of this.grid.get(k).rooms) if (r !== this.bossId) this.rooms[r].state = "open";
    this.sel = -1; this.fight = null; this.kill = null; this.status = "playing";
    this.ev(`Floor ${n}. Break the seal: solve ${this.needed()} of ${this.rooms.length - 1} rooms.`, "info");
    this.cycle(1);
  }

  select(id) {
    const r = this.rooms[id];
    if (!r || r.state !== "open" || this.status !== "playing") return;
    if (this.fight && this.fight.id !== id) this.rooms[this.fight.id].monsterHp = this.fight.hp;
    this.sel = id; this.cursor = 0; this.advance();
    if (!this.fight || this.fight.id !== id) {
      const len = r.answer.length, max = r.isBoss ? Math.ceil(len * RULES.MONSTER_HP_PER_LETTER * RULES.BOSS_HP_MULT) : len * RULES.MONSTER_HP_PER_LETTER;
      const name = this.monsterName(id);
      this.fight = { id, len, max, hp: r.monsterHp ?? max, streak: 0, mistakes: 0, boss: r.isBoss, name,
        attack: Math.ceil(len / 2) + (r.isBoss ? RULES.BOSS_ATTACK_BONUS : 0) };
    }
    this.onChange();
  }

  advance() {
    if (this.rooms[this.sel].isBoss) return;
    const cs = this.cells(this.sel);
    while (this.cursor < cs.length && this.grid.get(cs[this.cursor]).revealed) this.cursor++;
  }

  type(ch) {
    if (this.status !== "playing" || this.sel < 0) return;
    const cs = this.cells(this.sel), f = this.fight;
    if (this.cursor >= cs.length) return;
    const cell = this.grid.get(cs[this.cursor]);
    if (cell.letter === ch) {
      cell.revealed = true; f.streak++;
      let dmg = 1 + f.streak; if (this.combo >= RULES.COMBO_THRESHOLD) dmg = Math.ceil(dmg * RULES.COMBO_MULT);
      f.hp = Math.max(f.hp - dmg, 0); this.ink += RULES.INK_PER_LETTER;
      this.ev(`You hit ${f.name} for ${dmg}. It has ${f.hp}/${f.max} HP left.`, "hit");
      this.cursor++; this.advance();
      if (this.cursor >= cs.length) this.complete();
    } else {
      f.streak = 0; f.mistakes++; this.mistakes++; this.combo = 0;
      this.lastDelta = { kind: "mistake", n: RULES.WRONG_LETTER_COST };
      this.flashKey = cs[this.cursor];
      this.hurt(RULES.WRONG_LETTER_COST);
      if (this.status === "playing") this.ev(`Mistake: wrong letter, -${RULES.WRONG_LETTER_COST} HP. Streak lost.`, "hurt");
    }
    this.onChange();
  }

  hurt(n) { this.hp = Math.max(this.hp - n, 0); if (this.hp === 0) { this.status = "dead"; this.ev(`You fell on floor ${this.floor}.`, "hurt"); } }

  complete() {
    const f = this.fight;
    // Enemy strike: only lands when the word is finished while the monster still has HP.
    let strike = 0;
    if (f.hp > 0) {
      strike = f.attack;
      this.lastDelta = { kind: "strike", n: strike };
      this.hurt(strike);
      if (this.status === "dead") return;
    }
    // A finished word always ends the fight with the monster at 0 HP, so no stale health is left behind.
    f.hp = 0;
    this.kill = { name: f.name, max: f.max, boss: f.boss };
    const perfect = f.mistakes === 0;
    this.roomsCleared++;
    if (perfect) { this.combo++; this.cleanRooms++; this.ink += RULES.INK_PERFECT_BONUS; }
    const strikeText = strike > 0 ? `Enemy strike: ${f.name} was still alive when you finished, so it hits you for -${strike} HP.` : "";
    const perfectText = perfect ? `Perfect! +${RULES.INK_PERFECT_BONUS} Ink.` : "";
    this.ev([strikeText, perfectText].filter(Boolean).join(" ") || "Monster defeated.", strike > 0 ? "hurt" : "solve");
    this.fight = null;
    this.solve(this.sel);
    if (this.boss.state === "solved") {
      if (this.floor >= RULES.DEMO_FLOORS) { this.status = "demo_complete"; this.ev(`Demo complete. ${this.kill.name} slain at 0/${this.kill.max} HP.`, "boss"); }
      else { this.status = "descend"; this.ev(`Boss slain: ${this.kill.name} at 0/${this.kill.max} HP. Descend to heal ${RULES.FLOOR_HEAL} HP.`, "boss"); }
    } else this.cycle(1);
  }

  solve(id) {
    this.rooms[id].state = "solved";
    for (const k of this.cells(id)) for (const o of this.grid.get(k).rooms) if (this.rooms[o].state === "locked") this.rooms[o].state = "open";
    for (const r of this.rooms)
      if ((r.state === "open" || r.state === "locked") && !r.isBoss && this.cells(r.id).every(k => this.grid.get(k).revealed)) {
        if (this.fight && this.fight.id === r.id) this.fight = null;
        this.solve(r.id);
      }
    if (this.boss.state === "sealed" && this.solvedNonBoss() >= this.needed()) {
      this.boss.state = "open"; this.ev(`The seal breaks. The ${this.boss.answer[0] + this.boss.answer.slice(1).toLowerCase()} Tyrant awaits.`, "boss");
    }
  }

  descend() {
    if (this.status !== "descend") return;
    this.hp = Math.min(this.hp + RULES.FLOOR_HEAL, RULES.START_HP);
    this.startFloor(this.floor + 1); this.onChange();
  }

  cycle(step) {
    const n = this.rooms.length, start = Math.max(this.sel, 0);
    for (let i = this.sel < 0 ? 0 : 1; i <= n; i++) {
      const idx = ((start + step * i) % n + n) % n;
      if (this.rooms[idx].state === "open") { this.select(idx); return; }
    }
  }

  cellClass(k) {
    const c = this.grid.get(k);
    if (this.sel === this.bossId && this.boss.state === "open") {
      const i = this.cells(this.bossId).indexOf(k);
      if (i >= this.cursor) return "boss";
    }
    let cls = "locked";
    for (const r of c.rooms) {
      const room = this.rooms[r];
      if (room.state === "solved") return "solved";
      if (room.isBoss) cls = room.state === "open" ? "boss" : "sealed";
      else if (room.state === "open" && cls === "locked") cls = "open";
    }
    return cls;
  }

  showLetter(k) {
    if (!this.grid.get(k).revealed) return false;
    if (this.sel >= 0 && this.rooms[this.sel].isBoss) { const i = this.cells(this.sel).indexOf(k); if (i >= 0) return i < this.cursor; }
    return true;
  }
}

export { RULES };
