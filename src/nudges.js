"use strict";

const fs = require("fs");
const os = require("os");
const path = require("path");

/**
 * 펫이 먼저 말을 거는 것.
 *
 * Clippy 가 미움받은 이유는 못생겨서가 아니라 **모르면서 말을 걸어서**다. 그래서
 * 여기서는 규칙 하나를 지킨다: **관측된 사실 없이는 입을 열지 않는다.** 시계만
 * 보고 심심해서 하는 말은 없다.
 *
 * 일을 둘로 나눈다:
 *
 *   무엇을 말할지 — 코드 에이전트가 cron 으로 미리 적어 둔다(`notes.json`).
 *                   농담·칭찬·기억 후보처럼 맥락과 취향이 필요한 것.
 *   언제 말할지   — 여기. 지금 무슨 일이 벌어지는지는 펫만 안다.
 *
 * 그래서 이 파일에는 LLM 도 네트워크도 없다. 적어 둔 말이 없으면 기본 문구를
 * 쓰고, 있으면 그걸 쓴다. 새벽에 몰입한 사람에게 "쉬어" 라고 말하는 것을 막는
 * 것은 좋은 문장이 아니라 **말할 때를 아는 쪽**이다.
 *
 * 순수 함수로 둔다(`pick`). 이 저장소에서 렌더러 버그로 두 번 데었고, 시간에
 * 얽힌 규칙은 눈으로 봐서는 틀린 것을 못 찾는다.
 */

const HOME = process.env.KIBITZ_PET_HOME || path.join(os.homedir(), ".kibitz-pet");
const STATE_FILE = path.join(HOME, "nudges.json");
const NOTES_FILE = path.join(HOME, "notes.json");

/** 시간당 이만큼만. 넘으면 그날부터 배경 소음이 된다. */
const PER_HOUR = 3;
/** 답을 다 쓰고 이만큼 지나면 부른다. */
const WAITING_MS = 5 * 60_000;
/** 한 번 띄운 말은 이만큼 뒤에 스스로 사라진다. 닫기 버튼은 두지 않는다. */
const SHOW_MS = 12_000;

/* ── 기본 문구 ─────────────────────────────────────────────
   cron 이 적어 둔 말이 없을 때 쓴다. 여러 개를 두는 것은 변화를 주려는 게
   아니라, 같은 문장을 세 번째 보면 사람이 읽기를 그만두기 때문이다. */

const FALLBACK = {
  waiting: [
    "다 썼어. 보러 올래?",
    "답 다 나왔는데 아직 안 왔네",
    "여기 끝났어",
  ],
  levelup: ["레벨 {level}", "{level} 찍었다", "레벨 {level} — 잘하고 있어"],
};

function pool(kind) {
  return FALLBACK[kind] || [];
}

/** 같은 상황에서 늘 같은 문장이 나오게. 무작위면 재현이 안 되고 테스트도 못 한다. */
function choose(list, seed) {
  if (!list.length) return "";
  let h = 0;
  for (let i = 0; i < seed.length; i++) h = (h * 31 + seed.charCodeAt(i)) >>> 0;
  return list[h % list.length];
}

/* ── 저장 ─────────────────────────────────────────────────── */

function emptyState() {
  return { spoken: {}, recent: [], level: 0 };
}

function loadState() {
  try {
    const s = JSON.parse(fs.readFileSync(STATE_FILE, "utf8"));
    return {
      spoken: s.spoken && typeof s.spoken === "object" ? s.spoken : {},
      recent: Array.isArray(s.recent) ? s.recent : [],
      level: Number(s.level) || 0,
    };
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
 * cron 이 적어 둔 말과 기억 후보.
 *
 * 규격을 여기 하나로 못 박는다. 어떤 에이전트가 쓰든 파일만 맞으면 된다 —
 * 에이전트마다 어댑터를 두면 지원하는 만큼 깨진다.
 *
 *   {
 *     "version": 1,
 *     "generatedAt": "2026-08-01T…",
 *     "by": "claude-code",
 *     "lines":    [{ "when": "waiting", "text": "…", "session": "…"?, "expires": "…"? }],
 *     "memories": [{ "name": "…", "type": "project", "body": "…", "source": "…" }]
 *   }
 */
function loadNotes(now = Date.now()) {
  try {
    const n = JSON.parse(fs.readFileSync(NOTES_FILE, "utf8"));
    const lines = (Array.isArray(n.lines) ? n.lines : []).filter((l) => {
      if (!l || typeof l.text !== "string" || !l.text.trim()) return false;
      // 지난 말은 버린다. 어제 일에 대한 농담은 오늘 이상하다.
      return !l.expires || Date.parse(l.expires) > now;
    });
    const memories = (Array.isArray(n.memories) ? n.memories : []).filter(
      (m) => m && typeof m.name === "string" && typeof m.body === "string",
    );
    return { lines, memories };
  } catch {
    return { lines: [], memories: [] };
  }
}

/* ── 판단 ─────────────────────────────────────────────────── */

/**
 * 지금 할 말이 있는가.
 *
 * 부수효과가 없다 — 상태를 받아서 새 상태를 돌려준다. 그래야 "5분 뒤에는
 * 말하고 6분 뒤에는 안 한다" 같은 규칙을 시계 없이 시험할 수 있다.
 *
 * @returns {{ nudge: object|null, state: object }}
 */
function pick({ agents = [], state = emptyState(), notes = { lines: [] }, now = Date.now(), quiet = false }) {
  if (quiet) return { nudge: null, state };

  const recent = state.recent.filter((t) => now - t < 3_600_000);
  // `spoken` 까지 복사한다. 얕게 펼치면 같은 객체를 가리켜서, 부수효과가 없다고
  // 해 놓고 부른 쪽의 상태를 고치게 된다 — 순수하다는 말만 순수해진다.
  const next = { ...state, recent, spoken: { ...state.spoken } };
  if (recent.length >= PER_HOUR) return { nudge: null, state: next };

  const said = (key) => Boolean(next.spoken[key]);
  const line = (kind, seed, vars) => {
    const fromNotes = (notes.lines || []).filter((l) => l.when === kind);
    const text = fromNotes.length ? choose(fromNotes.map((l) => l.text), seed) : choose(pool(kind), seed);
    return Object.entries(vars || {}).reduce((s, [k, v]) => s.replaceAll(`{${k}}`, String(v)), text);
  };
  const fire = (kind, key, seed, vars, extra) => {
    next.spoken[key] = now;
    next.recent = [...recent, now];
    return {
      nudge: { kind, key, text: line(kind, seed, vars), at: now, showMs: SHOW_MS, ...extra },
      state: next,
    };
  };

  // 1. 레벨업. 사람이 뭘 하든 축하는 지금이 맞다.
  const top = agents[0];
  const level = top ? Number(top.level) || 0 : 0;
  if (level && next.level && level > next.level) {
    next.level = level;
    return fire("levelup", `level:${level}`, `level:${level}`, { level });
  }
  if (level && !next.level) next.level = level; // 처음 본 레벨로는 축하하지 않는다

  // 2. 답을 다 쓰고 사람이 안 왔다. 이 펫이 있는 이유에 가장 가깝다.
  for (const a of agents) {
    if (!a.endedWithAnswer || a.state !== "waiting") continue;
    const idle = now - Date.parse(a.at);
    if (!(idle >= WAITING_MS)) continue;
    // 세션마다 한 번. 안 오는 사람을 계속 부르는 것은 재촉이지 알림이 아니다.
    const key = `waiting:${a.sessionId}:${a.at}`;
    if (said(key)) continue;
    return fire("waiting", key, key, {}, { session: a.sessionId, quote: quoteOf(a) });
  }

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

/** 실사용 진입점 — 읽고, 고르고, 쓴다. */
function nextNudge(agents, { quiet = false, now = Date.now() } = {}) {
  const state = loadState();
  const { nudge, state: after } = pick({ agents, state, notes: loadNotes(now), now, quiet });
  if (nudge || after.recent.length !== state.recent.length || after.level !== state.level) saveState(after);
  return nudge;
}

module.exports = { pick, nextNudge, loadNotes, quoteOf, emptyState, PER_HOUR, WAITING_MS, SHOW_MS };
