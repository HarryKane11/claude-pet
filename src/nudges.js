"use strict";

const fs = require("fs");
const os = require("os");
const path = require("path");

/**
 * 펫이 먼저 말을 거는 것.
 *
 * Clippy 가 미움받은 이유는 못생겨서가 아니라 **모르면서 말을 걸어서**다. 그래서
 * 규칙 하나를 지킨다: **관측된 사실 없이는 입을 열지 않는다.**
 *
 * 자주 말하는 것과 이 규칙은 부딪히지 않는다. 부딪히는 것처럼 보였다면 그건
 * 펫이 이미 보고 있는데 **안 쓰던 관측이 많아서**였다 — 지금 무슨 도구를 쓰는지,
 * 분신이 몇 나가 있는지, 이 요청이 몇 분째인지, 얼마나 오래 붙어 있었는지.
 * 근거를 버려서 수다스러워지는 게 아니라, 근거를 더 쓰면 수다스러워진다.
 *
 * 일은 둘로 나뉜다:
 *
 *   무엇을 말할지 — 코드 에이전트가 하루 한두 번 적어 둔다(`notes.json`).
 *   언제 말할지   — 여기. 지금 무슨 일이 벌어지는지는 펫만 안다.
 *
 * 그래서 이 파일에는 LLM 도 네트워크도 없다. 적어 둔 말이 없으면 기본 문구를
 * 쓴다. 새벽에 몰입한 사람에게 "쉬어" 라고 말하는 것을 막는 것은 좋은 문장이
 * 아니라 **말할 때를 아는 쪽**이다.
 *
 * `pick` 은 순수 함수다. 시간에 얽힌 규칙은 눈으로 봐서 틀린 것을 못 찾는다.
 */

const HOME = process.env.KIBITZ_PET_HOME || path.join(os.homedir(), ".kibitz-pet");
const STATE_FILE = path.join(HOME, "nudges.json");
const NOTES_FILE = path.join(HOME, "notes.json");

/** 한 번 띄운 말은 이만큼 뒤에 스스로 사라진다. 닫기 버튼은 두지 않는다. */
const SHOW_MS = 12_000;

/**
 * 얼마나 말이 많은가.
 *
 * 켜고 끄는 스위치 하나로는 안 된다. 어떤 사람에게는 시간당 세 번도 많고 어떤
 * 사람에게는 반려동물이 하루 두 마디만 하면 죽은 것 같다.
 */
const MOODS = {
  quiet: { perHour: 0, minGap: Infinity },
  normal: { perHour: 3, minGap: 6 * 60_000, kinds: ["waiting", "levelup", "streak", "gear"] },
  // 예산만으로는 부족하다. 시간당 14번이어도 처음 14분에 다 쓰면 기관총이다.
  chatty: { perHour: 14, minGap: 3 * 60_000 }, // kinds 없음 = 전부
};

const WAITING_MS = 5 * 60_000;
const LONG_REQUEST_MS = 8 * 60_000;
const STREAK_MS = 2 * 3_600_000;
const IDLE_MS = 12 * 60_000;

/**
 * 종류마다 다시 말하기까지 쉬는 시간.
 *
 * 예산만으로 막으면 한 종류가 예산을 다 먹고 같은 말을 세 번 한다. 반려동물이
 * 같은 소리를 세 번 하면 그건 반려동물이 아니라 알림음이다.
 */
const COOLDOWN = {
  waiting: 0, // 아래에서 답변마다 한 번으로 따로 막는다
  levelup: 0,
  gear: 30 * 60_000,
  deep: 15 * 60_000,
  long: 12 * 60_000,
  streak: 60 * 60_000,
  // 도구별이 아니라 **도구 이야기 전체**의 쿨다운이다. 도구마다 따로 두었더니
  // 도구를 갈아 쓸 때마다 말해서 1분에 한 번씩 떠들었다.
  tool: 9 * 60_000,
  idle: 25 * 60_000,
  hello: 8 * 3_600_000,
};

/* ── 기본 문구 ─────────────────────────────────────────────
   적어 둔 말이 없을 때 쓴다. 여러 개를 두는 것은 변화를 주려는 게 아니라,
   같은 문장을 세 번째 보면 사람이 읽기를 그만두기 때문이다. */

const FALLBACK = {
  waiting: ["다 썼어. 보러 올래?", "답 나왔는데 아직 안 왔네", "여기 끝났어", "기다리고 있었어"],
  levelup: ["레벨 {level}", "{level} 찍었다", "레벨 {level}이야, 봤어?"],
  gear: ["{what} 꺼냈네", "{what} 장착했어", "오, {what}"],
  deep: ["분신 {n}개 나가 있어", "{n}명이 밖에서 일하는 중", "{n}개 보내놓고 기다리는 중"],
  long: ["이거 {min}분째야", "{min}분째 붙잡고 있네", "{min}분... 어려운 건가 보다"],
  streak: [
    "{h}시간째야. 물 한 잔 어때",
    "{h}시간 연속이야. 어깨 좀 펴",
    "{h}시간 봤어. 잠깐 일어날래?",
  ],
  idle: ["아무도 안 부르네", "심심해", "낮잠 자는 중이야", "여기 있어. 부르면 와"],
  hello: ["왔다!", "오늘도 잘 부탁해", "기다렸어"],
  // 도구마다 다르게. 무엇을 하는지 알고 있다는 느낌은 여기서 나온다.
  tool: {
    Bash: ["뭔가 열심히 치고 있어", "터미널에 손이 바쁘네", "명령어 날리는 중"],
    Read: ["읽는 중이야", "뭐라고 써 있나 보는 중", "문서 넘기는 소리"],
    Grep: ["뒤지는 중", "어디 있더라...", "찾는 중이야"],
    Glob: ["파일 세는 중", "어디 있나 보는 중"],
    Edit: ["고치는 중", "손보는 중이야", "다듬고 있어"],
    Write: ["새로 쓰는 중", "빈 종이에 쓰고 있어"],
    WebSearch: ["찾아보러 나갔어", "검색하는 중"],
    WebFetch: ["어디서 읽어오는 중", "가져오는 중이야"],
    Agent: ["분신 보냈어", "누구 시키는 중"],
    Task: ["분신 보냈어", "누구 시키는 중"],
  },
};

function pool(kind, tool) {
  if (kind !== "tool") return FALLBACK[kind] || [];
  return FALLBACK.tool[tool] || [`${tool} 쓰는 중`];
}

/**
 * 같은 상황에서 늘 같은 문장이 나온다.
 *
 * 무작위로 뽑으면 재현이 안 되고 테스트도 못 한다. 대신 씨앗에 말한 횟수를
 * 섞어서, 같은 상황이 반복되면 다른 문장이 나오게 한다 — 사람이 느끼는 변화는
 * 난수가 아니라 "아까와 다르다" 이다.
 */
function choose(list, seed) {
  if (!list.length) return "";
  let h = 0;
  for (let i = 0; i < seed.length; i++) h = (h * 31 + seed.charCodeAt(i)) >>> 0;
  return list[h % list.length];
}

/* ── 저장 ─────────────────────────────────────────────────── */

function emptyState() {
  return { spoken: {}, recent: [], level: 0, seenAt: {}, workSince: {}, said: 0, day: "", lastKind: "", chatterAt: 0, chatterTool: "", chatterN: 0 };
}

function loadState() {
  try {
    const s = JSON.parse(fs.readFileSync(STATE_FILE, "utf8"));
    return { ...emptyState(), ...s, spoken: s.spoken || {}, recent: s.recent || [], seenAt: s.seenAt || {}, workSince: s.workSince || {} };
  } catch {
    return emptyState();
  }
}

function saveState(state) {
  try {
    fs.mkdirSync(HOME, { recursive: true });
    fs.writeFileSync(STATE_FILE, JSON.stringify(state));
  } catch {
    /* 못 써도 말은 할 수 있다. 다음에 같은 말을 또 할 뿐이다. */
  }
}

/**
 * 큐레이터가 적어 둔 말과 기억 후보.
 *
 * 규격을 여기 하나로 못 박는다. 어떤 에이전트가 쓰든 파일만 맞으면 된다 —
 * 에이전트마다 어댑터를 두면 지원하는 만큼 깨진다.
 */
function loadNotes(now = Date.now()) {
  try {
    const n = JSON.parse(fs.readFileSync(NOTES_FILE, "utf8"));
    const lines = (Array.isArray(n.lines) ? n.lines : []).filter((l) => {
      if (!l || typeof l.text !== "string" || !l.text.trim()) return false;
      // 지난 말은 버린다. 어제 일에 대한 농담은 오늘 이상하다.
      return !l.expires || Date.parse(l.expires) > now;
    });
    return { lines };
  } catch {
    return { lines: [] };
  }
}

/* ── 판단 ─────────────────────────────────────────────────── */

/**
 * 지금 할 말이 있는가.
 *
 * 부수효과가 없다 — 상태를 받아서 새 상태를 돌려준다. 그래야 "5분 뒤에는
 * 말하고 6분 뒤에는 안 한다" 같은 규칙을 시계 없이 시험할 수 있다.
 */
function pick({ agents = [], state = emptyState(), notes = { lines: [] }, now = Date.now(), mood = "normal" }) {
  const cfg = MOODS[mood] || MOODS.normal;
  const recent = state.recent.filter((t) => now - t < 3_600_000);
  // `spoken` 까지 복사한다. 얕게 펼치면 같은 객체를 가리켜서, 부수효과가 없다고
  // 해 놓고 부른 쪽의 상태를 고치게 된다 — 순수하다는 말만 순수해진다.
  const next = { ...state, recent, spoken: { ...state.spoken }, seenAt: { ...state.seenAt } };

  // 언제 처음 봤는지는 말을 안 하더라도 기록해 둔다. "3시간째" 를 알려면
  // 그 3시간 동안 세고 있었어야 한다.
  next.workSince = { ...state.workSince };
  for (const a of agents) {
    if (!a.sessionId) continue;
    if (!next.seenAt[a.sessionId]) next.seenAt[a.sessionId] = now;
    // 이번 **요청**이 언제 시작됐는지는 따로 센다. 세션 전체를 재면 "32분째" 가
    // 나오는데, 그 사이 요청은 열 번 끝났다 — 그건 오래 걸린 게 아니다.
    if (a.state === "working") {
      if (!next.workSince[a.sessionId]) next.workSince[a.sessionId] = now;
    } else {
      delete next.workSince[a.sessionId];
    }
  }
  for (const id of Object.keys(next.seenAt)) {
    if (now - next.seenAt[id] > 24 * 3_600_000 && !agents.some((a) => a.sessionId === id)) {
      delete next.seenAt[id];
    }
  }

  if (!cfg.perHour) return { nudge: null, state: next };
  if (recent.length >= cfg.perHour) return { nudge: null, state: next };
  // 예산이 남아도 연달아 말하지 않는다. 시간당 14번이어도 처음 14분에 다 쓰면
  // 그건 반려동물이 아니라 기관총이다.
  const last = recent.length ? Math.max(...recent) : 0;
  if (last && now - last < cfg.minGap) return { nudge: null, state: next };

  const allow = (kind) => !cfg.kinds || cfg.kinds.includes(kind);
  const ready = (kind, key) => {
    if (!allow(kind)) return false;
    const last = next.spoken[key || kind];
    if (last === undefined) return true;
    return now - last >= (COOLDOWN[kind] ?? 10 * 60_000);
  };

  const line = (kind, seed, vars, tool) => {
    const noted = (notes.lines || []).filter((l) => l.when === kind);
    const text = noted.length ? choose(noted.map((l) => l.text), seed) : choose(pool(kind, tool), seed);
    return Object.entries(vars || {}).reduce((s, [k, v]) => s.replaceAll(`{${k}}`, String(v)), text);
  };

  const fire = (kind, key, vars, extra, tool) => {
    // 말한 횟수를 씨앗에 섞는다. 같은 상황이 반복되면 다른 문장이 나온다.
    const seed = `${key}:${next.said}`;
    next.spoken[key || kind] = now;
    next.recent = [...recent, now];
    next.said = (next.said || 0) + 1;
    return {
      nudge: { kind, key, text: line(kind, seed, vars, tool), at: now, showMs: SHOW_MS, ...extra },
      state: next,
    };
  };

  const top = agents[0];

  /* 후보를 모아 두고 고른다.
     먼저 걸리는 것을 바로 뱉으면 한 종류가 계속 이긴다 — 실제로 여덟 시간 동안
     112번 말하는데 92번이 도구 이야기였다. 반려동물이 같은 소리만 내면 그건
     반려동물이 아니라 알림음이다. */
  const cands = [];
  const add = (kind, key, vars, extra, tool, commit) =>
    cands.push({ kind, key: key || kind, vars, extra, tool, commit });

  /* 1. 레벨업. 사람이 뭘 하든 축하는 지금이 맞다. */
  const level = top ? Number(top.level) || 0 : 0;
  if (level && next.level && level > next.level) {
    add("levelup", `level:${level}`, { level }, null, null, () => (next.level = level));
  }
  if (level && !next.level) next.level = level; // 처음 본 레벨로는 축하하지 않는다

  /* 2. 답을 다 쓰고 사람이 안 왔다. 이 펫이 있는 이유에 가장 가깝다. */
  for (const a of agents) {
    if (!a.endedWithAnswer || a.state !== "waiting") continue;
    if (now - Date.parse(a.at) < WAITING_MS) continue;
    // 답변마다 한 번. 안 오는 사람을 계속 부르는 것은 재촉이지 알림이 아니다.
    const key = `waiting:${a.sessionId}:${a.at}`;
    if (next.spoken[key]) continue;
    add("waiting", key, {}, { session: a.sessionId, quote: quoteOf(a) });
    break;
  }

  /* 3. 오래 붙어 있었다. "쉬어" 가 근거를 갖는 유일한 자리다 —
        조용해서 하는 말이 아니라, 세고 있었기 때문에 하는 말이다. */
  for (const a of agents) {
    const since = next.seenAt[a.sessionId];
    if (!since || now - since < STREAK_MS) continue;
    add("streak", `streak:${a.sessionId}`, { h: Math.floor((now - since) / 3_600_000) });
    break;
  }

  /* 4. 새 장비. **무엇을** 처음 봤는지로 판단한다 — 개수로 세었더니 같은
        플러그인을 여덟 번 말했다. 처음 보는 것이 없으면 할 말도 없다. */
  if (top) {
    // 세션마다 세었더니 새 대화방이 열릴 때마다 같은 플러그인을 다시 자랑했다.
    // 스킬과 플러그인은 기계에 깔린 것이지 대화방의 것이 아니다.
    const key = "gearSeen";
    const seen = new Set([].concat(next.spoken[key] || []));
    const have = [...(top.plugins || []), ...(top.skills || [])];
    const fresh = have.filter((x) => !seen.has(x));
    if (fresh.length) {
      add("gear", `gear:${top.sessionId}`, { what: fresh[fresh.length - 1] }, null, null, () => {
        next.spoken[key] = have;
      });
    } else if (!next.spoken[key] && have.length) {
      // 처음 본 세션은 통째로 이미 아는 것으로 친다. 켜자마자 장비 자랑은 자랑이 아니다.
      next.spoken[key] = have;
    }
  }

  /* 5. 분신이 나가 있다. */
  if (top && top.subagents > 0) add("deep", `deep:${top.sessionId}`, { n: top.subagents });

  /* 6. 이 요청이 길어지고 있다. */
  for (const a of agents) {
    if (a.state !== "working") continue;
    const since = next.workSince[a.sessionId];
    if (!since || now - since < LONG_REQUEST_MS) continue;
    add("long", `long:${a.sessionId}`, { min: Math.floor((now - since) / 60_000) });
    break;
  }

  /* 7. 지금 쓰는 도구. 무엇을 하는지 알고 있다는 느낌은 대개 여기서 나온다. */
  if (top && top.tool && top.state === "working") {
    add("tool", "tool", {}, { session: top.sessionId }, top.tool);
  }

  /* 8. 아무도 안 부른다. 이것도 관측이다 — 아무 일이 없다는 관측. */
  if (!agents.length) {
    const quietFor = now - (next.spoken.lastSeenAny || 0);
    if (next.spoken.lastSeenAny && quietFor >= IDLE_MS) add("idle", "idle");
  } else {
    next.spoken.lastSeenAny = now;
  }

  /* 9. 오늘 처음 봤다. */
  const today = new Date(now).toISOString().slice(0, 10);
  if (agents.length && next.day && next.day !== today) {
    add("hello", "hello", {}, null, null, () => (next.day = today));
  }
  if (agents.length && !next.day) next.day = today;

  const eligible = cands.filter((c) => allow(c.kind) && ready(c.kind, c.key));
  if (!eligible.length) return { nudge: null, state: next };

  // 방금 한 것과 다른 이야기를 먼저 고른다. 우선순위는 지키되, 같은 값이면
  // 새 이야기가 이긴다.
  const chosen = eligible.find((c) => c.kind !== state.lastKind) || eligible[0];
  if (chosen.commit) chosen.commit();
  next.lastKind = chosen.kind;
  return fire(chosen.kind, chosen.key, chosen.vars, chosen.extra, chosen.tool);

  return { nudge: null, state: next };
}

/**
 * 에이전트가 실제로 쓴 첫 문장.
 *
 * 지금 돌아갈지 말지를 판단할 재료는 우리가 지어낸 문구가 아니라 이것이다.
 * 화면에 그대로 뜨는 글이므로 짧게 자른다 — 화면 공유 중일 수도 있다.
 */
function quoteOf(a) {
  const raw = String(a.lastSay || "").trim();
  if (!raw) return "";
  const first = raw.split(/(?<=[.!?。])\s|\n/)[0] || raw;
  return first.length > 70 ? first.slice(0, 69) + "…" : first;
}

/* ── 혼잣말 ────────────────────────────────────────────────
   말풍선과 다른 채널이다.

   도구 이야기를 말풍선으로 냈더니 9분에 한 번, 12초 동안만 보였다. 펫은 97%의
   시간을 조용히 있었고 그건 혼잣말이 아니었다. 알림의 기준으로 설계해 놓고
   혼잣말이라고 부른 것이 잘못이다.

   **혼잣말은 사건이 아니라 상태다.** 지금 무엇을 하는지 계속 중얼거리는 것이지,
   무슨 일이 생겼다고 알리는 것이 아니다. 그래서 예산을 쓰지 않고, 조용히
   나타났다 사라지고, 못 봐도 아무 일이 없다. */

const CHATTER_MS = 22_000;

function chatterFor(agents, state, now = Date.now(), mood = "chatty") {
  if (mood !== "chatty") return null;
  const a = agents[0];
  if (!a || a.state !== "working" || !a.tool) return null;

  const last = state.chatterAt || 0;
  const same = state.chatterTool === a.tool;
  // 도구가 바뀌면 바로, 같은 도구면 한참 뒤에. 같은 일을 하는 동안 계속 떠들면
  // 그건 중얼거림이 아니라 반복 재생이다.
  if (same && now - last < CHATTER_MS * 3) return null;
  if (!same && now - last < 6_000) return null;

  const n = (state.chatterN || 0) + 1;
  return {
    text: choose(pool("tool", a.tool), `${a.tool}:${n}`),
    tool: a.tool,
    session: a.sessionId,
    showMs: 7_000,
    state: { ...state, chatterAt: now, chatterTool: a.tool, chatterN: n },
  };
}

/** 실사용 진입점 — 읽고, 고르고, 쓴다. */
function nextNudge(agents, { mood = "normal", now = Date.now() } = {}) {
  const state = loadState();
  const { nudge, state: after } = pick({ agents, state, notes: loadNotes(now), now, mood });
  saveState(after);
  return nudge;
}

/** 혼잣말. 말풍선 예산과 따로 논다. */
function nextChatter(agents, { mood = "chatty", now = Date.now() } = {}) {
  const state = loadState();
  const got = chatterFor(agents, state, now, mood);
  if (!got) return null;
  const { state: after, ...line } = got;
  saveState(after);
  return line;
}

module.exports = {
  pick,
  nextNudge,
  chatterFor,
  nextChatter,
  CHATTER_MS,
  loadNotes,
  quoteOf,
  emptyState,
  MOODS,
  COOLDOWN,
  WAITING_MS,
  STREAK_MS,
  IDLE_MS,
  SHOW_MS,
};
