/**
 * 심장 박동 테스트.
 *
 * 시각에 얽힌 규칙은 눈으로 봐서 틀린 것을 못 찾는다. 그리고 이건 틀리면
 * 조용히 틀린다 — 안 도는 일정은 아무 소리도 내지 않는다.
 */

import { test } from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const { parse, due } = require("../src/heartbeat.js");

const at = (h, m = 0) => {
  const d = new Date("2026-08-01T00:00:00");
  d.setHours(h, m, 0, 0);
  return d.getTime();
};

test("사람이 쓴 평문을 읽는다", () => {
  const p = parse(`# 심장 박동\n\n매일 09:00\n매일 18:30\n6시간마다\n켤 때\n`);
  assert.deepEqual(p.daily, [9 * 60, 18 * 60 + 30]);
  assert.equal(p.everyHours, 6);
  assert.equal(p.onBoot, true);
  assert.deepEqual(p.unread, []);
});

test("들여쓴 예시는 일정이 아니다", () => {
  const p = parse(`설명이다.\n\n    매일 03:00\n    켤 때\n\n매일 09:00\n`);
  assert.deepEqual(p.daily, [9 * 60], "문서의 예시가 진짜 일정이 되면 안 된다");
  assert.equal(p.onBoot, false);
});

test("못 읽은 줄은 버리지 않고 남긴다", () => {
  const p = parse(`매일 09:00\n주말 빼고 3시간마다\n매일 25:00\n`);
  assert.deepEqual(p.daily, [9 * 60]);
  assert.ok(p.unread.includes("주말 빼고 3시간마다"), "조용히 무시하면 사람은 도는 줄 안다");
  assert.ok(p.unread.includes("매일 25:00"), "말이 안 되는 시각도 알려야 한다");
});

test("그 시각을 지나면 하루에 한 번 돈다", () => {
  const p = parse("매일 09:00\n");
  assert.equal(due(p, 0, at(8, 59)), null, "시각 전에는 안 돈다");
  assert.ok(due(p, 0, at(9, 1)), "지나면 돈다");

  const ran = at(9, 5);
  assert.equal(due(p, ran, at(11)), null, "오늘 이미 돌았으면 또 돌지 않는다");
  assert.ok(due(p, ran, at(9) + 26 * 3_600_000), "다음 날에는 다시 돈다");
});

test("N시간마다는 마지막으로 돈 때부터 센다", () => {
  const p = parse("6시간마다\n");
  assert.equal(due(p, at(9), at(14)), null);
  assert.ok(due(p, at(9), at(15, 1)));
});

test("켤 때는 한참 안 돌았을 때만", () => {
  const p = parse("켤 때\n");
  assert.equal(due(p, at(9), at(12), { booted: true }), null, "세 시간 전에 돌았으면 됐다");
  assert.ok(due(p, at(9) - 20 * 3_600_000, at(9), { booted: true }), "하루 가까이 지났으면 한 번");
  assert.equal(due(p, 0, at(9), { booted: false }), null, "켠 게 아니면 이 규칙은 안 쓴다");
});

test("일정이 비면 아무 때도 아니다", () => {
  const p = parse("# 아무것도 안 적음\n");
  assert.equal(due(p, 0, at(23, 59)), null, "빈 일정으로 돌면 돈이 조용히 나간다");
});
