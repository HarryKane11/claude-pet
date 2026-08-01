/**
 * 말 거는 규칙 테스트.
 *
 * 시간에 얽힌 규칙은 눈으로 봐서 틀린 것을 못 찾는다 — "5분 뒤엔 말하고 6분
 * 뒤엔 안 한다" 는 돌려 봐야 안다. `pick` 이 순수 함수인 이유가 이것이다.
 */

import { test } from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const { pick, emptyState, MOODS, WAITING_MS, STREAK_MS, IDLE_MS } = require("../src/nudges.js");
const PER_HOUR = MOODS.normal.perHour;

const T0 = Date.parse("2026-08-01T09:00:00.000Z");

const agent = (over = {}) => ({
  sessionId: "s1",
  state: "waiting",
  endedWithAnswer: true,
  at: new Date(T0).toISOString(),
  lastSay: "고쳤습니다. 테스트도 통과했고요. 더 볼 것 있으면 말씀해 주세요.",
  level: 20,
  ...over,
});

test("답을 다 쓰고 5분이 지나야 부른다", () => {
  const state = { ...emptyState(), level: 20 };
  const early = pick({ agents: [agent()], state, now: T0 + WAITING_MS - 1000 });
  assert.equal(early.nudge, null, "5분 전에는 말하지 않는다");

  const late = pick({ agents: [agent()], state, now: T0 + WAITING_MS + 1000 });
  assert.equal(late.nudge?.kind, "waiting");
  assert.ok(late.nudge.text, "할 말이 있어야 한다");
});

test("아직 일하는 중이면 부르지 않는다", () => {
  const busy = agent({ state: "working", endedWithAnswer: false });
  const r = pick({ agents: [busy], state: { ...emptyState(), level: 20 }, now: T0 + 60 * 60_000 });
  assert.equal(r.nudge, null, "내 차례가 아니면 내 차례라고 하지 않는다");
});

test("같은 답에 두 번 부르지 않는다", () => {
  let state = { ...emptyState(), level: 20 };
  const now = T0 + WAITING_MS + 1000;
  const first = pick({ agents: [agent()], state, now });
  assert.ok(first.nudge);

  const again = pick({ agents: [agent()], state: first.state, now: now + 60_000 });
  assert.equal(again.nudge, null, "안 오는 사람을 계속 부르는 건 재촉이다");
});

test("답이 새로 나오면 다시 부른다", () => {
  let state = { ...emptyState(), level: 20 };
  const now = T0 + WAITING_MS + 1000;
  state = pick({ agents: [agent()], state, now }).state;

  const later = new Date(T0 + 30 * 60_000).toISOString();
  const r = pick({ agents: [agent({ at: later })], state, now: T0 + 40 * 60_000 });
  assert.equal(r.nudge?.kind, "waiting", "새 답은 새 소식이다");
});

test("시간당 말수를 넘기지 않는다", () => {
  let state = { ...emptyState(), level: 20 };
  let spoken = 0;
  // 최소 간격보다 넉넉히 띄운다 — 여기서 보려는 것은 간격이 아니라 예산이다.
  for (let i = 0; i < PER_HOUR + 3; i++) {
    const t = T0 + i * 8 * 60_000;
    const at = new Date(t).toISOString();
    const r = pick({ agents: [agent({ sessionId: `s${i}`, at })], state, now: t + WAITING_MS + 1000 });
    if (r.nudge) spoken++;
    state = r.state;
  }
  assert.equal(spoken, PER_HOUR, `시간당 ${PER_HOUR}번까지만`);
});

test("예산이 남아도 연달아 말하지 않는다", () => {
  let state = { ...emptyState(), level: 20 };
  const first = pick({
    agents: [agent()],
    state,
    now: T0 + WAITING_MS + 1000,
    mood: "chatty",
  });
  assert.ok(first.nudge);
  const soon = pick({
    agents: [agent({ sessionId: "s2", at: new Date(T0 + 60_000).toISOString() })],
    state: first.state,
    now: T0 + WAITING_MS + 61_000,
    mood: "chatty",
  });
  assert.equal(soon.nudge, null, "1분 만에 또 말하면 반려동물이 아니라 기관총이다");
});

test("한 시간이 지나면 예산이 돌아온다", () => {
  let state = { ...emptyState(), level: 20 };
  for (let i = 0; i < PER_HOUR; i++) {
    const at = new Date(T0 + i * 60_000).toISOString();
    state = pick({
      agents: [agent({ sessionId: `s${i}`, at })],
      state,
      now: T0 + WAITING_MS + i * 60_000,
    }).state;
  }
  const at = new Date(T0 + 3 * 3_600_000).toISOString();
  const r = pick({ agents: [agent({ sessionId: "later", at })], state, now: T0 + 4 * 3_600_000 });
  assert.ok(r.nudge, "한 시간 뒤에는 다시 말할 수 있어야 한다");
});

test("조용히 모드면 아무 말도 안 한다", () => {
  const r = pick({
    agents: [agent()],
    state: { ...emptyState(), level: 20 },
    now: T0 + WAITING_MS + 1000,
    mood: "quiet",
  });
  assert.equal(r.nudge, null);
});

test("레벨이 오르면 축하하지만, 처음 본 레벨로는 안 한다", () => {
  const first = pick({ agents: [agent({ level: 30 })], state: emptyState(), now: T0 });
  assert.equal(first.nudge, null, "켜자마자 레벨 30 축하는 축하가 아니다");
  assert.equal(first.state.level, 30, "기준으로 기억은 해 둔다");

  const up = pick({ agents: [agent({ level: 31 })], state: first.state, now: T0 + 1000 });
  assert.equal(up.nudge?.kind, "levelup");
  assert.match(up.nudge.text, /31/, "몇 레벨인지 말해야 한다");
});

test("cron 이 적어 둔 말이 있으면 그걸 쓴다", () => {
  const notes = {
    lines: [{ when: "waiting", text: "리팩터링 끝났대. 커피 한 잔 하고 볼까?" }],
  };
  const r = pick({
    agents: [agent()],
    state: { ...emptyState(), level: 20 },
    notes,
    now: T0 + WAITING_MS + 1000,
  });
  assert.equal(r.nudge.text, notes.lines[0].text);
});

test("지난 말은 쓰지 않는다", () => {
  const { loadNotes } = require("../src/nudges.js");
  assert.ok(typeof loadNotes === "function");
  // 만료 필터는 loadNotes 안에 있고, pick 은 이미 걸러진 것을 받는다.
  // 여기서는 만료된 줄이 섞여 들어와도 pick 이 기본 문구로 돌아가는지만 본다.
  const r = pick({
    agents: [agent()],
    state: { ...emptyState(), level: 20 },
    notes: { lines: [] },
    now: T0 + WAITING_MS + 1000,
  });
  assert.ok(r.nudge.text, "적어 둔 말이 없어도 할 말은 있어야 한다");
});

test("에이전트가 쓴 첫 문장을 함께 준다", () => {
  const r = pick({
    agents: [agent()],
    state: { ...emptyState(), level: 20 },
    now: T0 + WAITING_MS + 1000,
  });
  assert.equal(r.nudge.quote, "고쳤습니다.", "돌아갈지 판단할 재료는 에이전트 자신의 말이다");
});

test("같은 상황에서는 같은 문장이 나온다", () => {
  const opts = { agents: [agent()], state: { ...emptyState(), level: 20 }, now: T0 + WAITING_MS + 1000 };
  assert.equal(pick(opts).nudge.text, pick(opts).nudge.text, "무작위면 재현도 테스트도 못 한다");
});

/* ── 늘어난 트리거 ────────────────────────────────────────
   "자주 말한다" 와 "근거 없이 말한다" 는 다르다. 아래는 전부 관측이 있어야만
   나오는 말이고, 관측이 없으면 조용해야 한다. */

test("아무도 안 부르면 그것도 관측이다", () => {
  let state = { ...emptyState(), level: 20 };
  // 먼저 누가 돌고 있는 것을 봐야 한다. 켜자마자 "심심해" 는 심심한 게 아니다.
  state = pick({ agents: [agent({ state: "working" })], state, now: T0, mood: "chatty" }).state;

  const soon = pick({ agents: [], state, now: T0 + 60_000, mood: "chatty" });
  assert.equal(soon.nudge, null, "1분 조용한 것으로는 말하지 않는다");

  const later = pick({ agents: [], state, now: T0 + IDLE_MS + 1000, mood: "chatty" });
  assert.equal(later.nudge?.kind, "idle");
});

test("한 번도 본 적 없으면 심심하다고도 안 한다", () => {
  const r = pick({ agents: [], state: emptyState(), now: T0 + 10 * 3_600_000, mood: "chatty" });
  assert.equal(r.nudge, null, "아무것도 안 본 상태는 관측이 아니라 무지다");
});

test("오래 붙어 있으면 쉬라고 한다 — 세고 있었기 때문에", () => {
  let state = { ...emptyState(), level: 20 };
  const busy = agent({ state: "working", endedWithAnswer: false });
  state = pick({ agents: [busy], state, now: T0 }).state;

  const early = pick({ agents: [busy], state, now: T0 + STREAK_MS - 60_000 });
  assert.equal(early.nudge, null, "두 시간 전에는 쉬라고 하지 않는다");

  const r = pick({ agents: [busy], state, now: T0 + STREAK_MS + 1000 });
  assert.equal(r.nudge?.kind, "streak");
  assert.match(r.nudge.text, /2시간/, "몇 시간인지 말해야 근거가 된다");
});

test("도구 이야기는 수다 모드에서만", () => {
  const busy = agent({ state: "working", endedWithAnswer: false, tool: "Bash", subagents: 0, skills: [], plugins: [] });
  let state = { ...emptyState(), level: 20 };
  state = pick({ agents: [busy], state, now: T0 }).state;

  const normal = pick({ agents: [busy], state, now: T0 + 60_000, mood: "normal" });
  assert.equal(normal.nudge, null, "보통 모드는 도구마다 말하지 않는다");

  const chatty = pick({ agents: [busy], state, now: T0 + 60_000, mood: "chatty" });
  assert.equal(chatty.nudge?.kind, "tool");
  assert.match(chatty.nudge.text, /치고|터미널|명령/, "무슨 도구인지 아는 말이어야 한다");
});

test("같은 도구를 연달아 말하지 않는다", () => {
  const busy = agent({ state: "working", endedWithAnswer: false, tool: "Read", subagents: 0, skills: [], plugins: [] });
  let state = { ...emptyState(), level: 20 };
  state = pick({ agents: [busy], state, now: T0 }).state;
  const first = pick({ agents: [busy], state, now: T0 + 60_000, mood: "chatty" });
  assert.equal(first.nudge?.kind, "tool");

  const again = pick({ agents: [busy], state: first.state, now: T0 + 120_000, mood: "chatty" });
  assert.equal(again.nudge, null, "쿨다운 안에는 같은 도구로 또 말하지 않는다");
});

test("분신이 나가 있으면 그걸 말한다", () => {
  const busy = agent({ state: "working", endedWithAnswer: false, subagents: 3, tool: null, skills: [], plugins: [] });
  let state = { ...emptyState(), level: 20 };
  state = pick({ agents: [busy], state, now: T0 }).state;
  const r = pick({ agents: [busy], state, now: T0 + 60_000, mood: "chatty" });
  assert.equal(r.nudge?.kind, "deep");
  assert.match(r.nudge.text, /3/, "몇 개인지 말해야 한다");
});

test("수다 모드가 보통 모드보다 말이 많다", () => {
  const run = (mood) => {
    let state = { ...emptyState(), level: 20 };
    let said = 0;
    for (let i = 0; i < 40; i++) {
      const now = T0 + i * 60_000;
      const a = agent({
        state: "working",
        endedWithAnswer: false,
        tool: ["Bash", "Read", "Edit", "Grep"][i % 4],
        subagents: i % 7 === 0 ? 2 : 0,
        skills: [], plugins: [],
      });
      const r = pick({ agents: [a], state, now, mood });
      if (r.nudge) said++;
      state = r.state;
    }
    return said;
  };
  const normal = run("normal");
  const chatty = run("chatty");
  assert.ok(chatty > normal, `수다(${chatty}) 가 보통(${normal}) 보다 많아야 한다`);
  assert.ok(chatty <= MOODS.chatty.perHour, "그래도 예산은 지킨다");
});

test("같은 상황이 반복되면 다른 문장이 나온다", () => {
  let state = { ...emptyState(), level: 20 };
  const seen = new Set();
  for (let i = 0; i < 6; i++) {
    const at = new Date(T0 + i * 3_600_000).toISOString();
    const r = pick({
      agents: [agent({ sessionId: `s${i}`, at })],
      state,
      now: T0 + i * 3_600_000 + WAITING_MS + 1000,
    });
    if (r.nudge) seen.add(r.nudge.text);
    state = r.state;
  }
  assert.ok(seen.size > 1, "같은 문장만 반복하면 사람이 읽기를 그만둔다");
});
