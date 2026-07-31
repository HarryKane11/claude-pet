"use strict";

/**
 * 레벨 — 쓴 토큰으로 오른다.
 *
 * 곡선은 **등비**다. 1레벨이 1,000 토큰, 100레벨(만렙)이 1조 토큰이고, 한 레벨
 * 오를 때마다 필요한 누적량이 약 23.5%씩 늘어난다. 그래서 초반엔 금방 오르고
 * 뒤로 갈수록 좀처럼 안 오른다 — 게임에서 그 느낌이 나는 이유는 요구량이 더하기가
 * 아니라 곱하기로 늘기 때문이다.
 *
 *   레벨 1    1,000
 *   레벨 10   약 6,600
 *   레벨 50   약 9,400,000
 *   레벨 100  1,000,000,000,000
 *
 * 레벨은 **얼마나 많이 썼는가**지 얼마나 잘했는가가 아니다. 화면에서도 늘 원본
 * 토큰 수를 같이 보여 준다 — 숫자를 감추면 그때부터 점수처럼 읽힌다.
 */

const BASE = 1_000; // 레벨 1 시작점
const MAX_LEVEL = 100;
const MAX_TOKENS = 1_000_000_000_000; // 1조
/** 레벨당 배수. BASE * RATIO^(99) === MAX_TOKENS 가 되도록 잡는다. */
const RATIO = Math.pow(MAX_TOKENS / BASE, 1 / (MAX_LEVEL - 1));

/** 그 레벨에 도달하는 데 필요한 누적 토큰. */
function thresholdFor(level) {
  return BASE * Math.pow(RATIO, level - 1);
}

function levelFor(tokens) {
  if (tokens < BASE) return { level: 1, xp: tokens, need: BASE, next: BASE };
  const raw = 1 + Math.log(tokens / BASE) / Math.log(RATIO);
  const level = Math.min(MAX_LEVEL, Math.floor(raw));
  if (level >= MAX_LEVEL) {
    return { level: MAX_LEVEL, xp: 1, need: 1, next: MAX_TOKENS, maxed: true };
  }
  const floor = thresholdFor(level);
  const next = thresholdFor(level + 1);
  return {
    level,
    xp: Math.round(tokens - floor),
    need: Math.round(next - floor),
    next: Math.round(next),
  };
}

module.exports = { levelFor, thresholdFor, MAX_LEVEL, MAX_TOKENS, RATIO };
