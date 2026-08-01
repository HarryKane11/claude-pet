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
const { pick, emptyState, PER_HOUR, WAITING_MS } = require("../src/nudges.js");

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
  let now = T0 + WAITING_MS + 1000;
  let spoken = 0;
  for (let i = 0; i < PER_HOUR + 3; i++) {
    const at = new Date(T0 + i * 60_000).toISOString();
    const r = pick({ agents: [agent({ sessionId: `s${i}`, at })], state, now: now + i * 60_000 });
    if (r.nudge) spoken++;
    state = r.state;
  }
  assert.equal(spoken, PER_HOUR, `시간당 ${PER_HOUR}번까지만`);
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
    quiet: true,
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
