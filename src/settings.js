"use strict";

const fs = require("fs");
const os = require("os");
const path = require("path");

/**
 * 설정.
 *
 * 지금까지는 렌더러의 `localStorage` 에 있었다. 창이 하나일 때는 그래도 됐는데,
 * 설정 창이 생기면서 **두 창이 서로 다른 값을 보는** 문제가 생긴다. 메인
 * 프로세스도 말수를 알아야 하고(말할지 말지를 거기서 정한다), 그러면 진실이
 * 세 군데가 된다.
 *
 * 그래서 파일 하나로 모은다. 사람이 열어 고칠 수도 있다 — 이 앱의 다른 파일들과
 * 같은 이유다.
 */

const HOME = process.env.KIBITZ_PET_HOME || path.join(os.homedir(), ".kibitz-pet");
const FILE = path.join(HOME, "settings.json");

const DEFAULTS = {
  // 기본은 수다다. 보통 모드에는 도구 이야기가 없어서, 처음 켠 사람은 펫이
  // 하루에 두어 마디밖에 안 하는 것을 보게 된다 — 반려동물처럼 보이지 않는다.
  mood: "chatty", // quiet | normal | chatty
  pet: "", // 빈 값이면 깔린 것 중에서 알아서
  hat: "wizard",
  weapon: "sword",
  // 로그인할 때 자동으로 뜬다. 기본은 꺼 둔다 — 묻지 않고 시작 프로그램에
  // 끼어드는 앱은 신뢰를 잃는다.
  autostart: false,
};

let cache = null;

function load() {
  if (cache) return cache;
  try {
    cache = { ...DEFAULTS, ...JSON.parse(fs.readFileSync(FILE, "utf8")) };
  } catch {
    cache = { ...DEFAULTS };
  }
  return cache;
}

function save(patch) {
  const next = { ...load(), ...patch };
  // 모르는 키는 받지 않는다. 설정 파일이 아무거나 담는 서랍이 되면 다음에 이걸
  // 읽는 사람이 무엇이 진짜 설정인지 알 수 없다.
  for (const k of Object.keys(next)) if (!(k in DEFAULTS)) delete next[k];
  if (!["quiet", "normal", "chatty"].includes(next.mood)) next.mood = DEFAULTS.mood;
  cache = next;
  try {
    fs.mkdirSync(HOME, { recursive: true });
    fs.writeFileSync(FILE, JSON.stringify(next, null, 2) + "\n");
  } catch {
    /* 못 써도 이번 실행 동안은 유지된다 */
  }
  return next;
}

module.exports = { load, save, DEFAULTS, FILE };
