"use strict";

const fs = require("fs");
const os = require("os");
const path = require("path");

/**
 * 이 앱이 자기 것을 두는 곳.
 *
 * `~/.kibitz-pet` 이었다. kibitz 안에 있을 때 붙은 이름인데, 저장소가 갈라져
 * 나온 뒤에도 그대로 남아 있었다 — 설정 창에 `~/.kibitz-pet/settings.json` 이라고
 * 적혀 있으면 이 앱이 무엇의 일부인지 헷갈린다.
 *
 * 같은 한 줄이 여섯 파일에 복사되어 있기도 했다. 그런 줄은 언젠가 다섯 곳만
 * 고쳐진다.
 *
 * 옮기는 것은 **한 번, 조용히** 한다. 쓰던 사람의 레벨과 설정이 사라지면
 * 새 이름이 무슨 소용인가.
 */

const LEGACY = path.join(os.homedir(), ".kibitz-pet");

function resolve() {
  const forced = process.env.CLAUDE_PET_HOME || process.env.KIBITZ_PET_HOME;
  if (forced) return forced;

  const home = path.join(os.homedir(), ".claude-pet");
  try {
    if (!fs.existsSync(home) && fs.existsSync(LEGACY)) fs.renameSync(LEGACY, home);
  } catch {
    /* 못 옮기면 새 곳에서 새로 시작한다. 지우지는 않는다 */
  }
  return home;
}

const HOME = resolve();

/** 세션 기록을 어디서 읽는가. 테스트에서 가짜 폴더를 물릴 수 있게 열어 둔다. */
const CLAUDE_ROOT =
  process.env.CLAUDE_PET_CLAUDE_ROOT ||
  process.env.KIBITZ_PET_CLAUDE_ROOT ||
  path.join(os.homedir(), ".claude", "projects");
const CODEX_ROOT =
  process.env.CLAUDE_PET_CODEX_ROOT ||
  process.env.KIBITZ_PET_CODEX_ROOT ||
  path.join(os.homedir(), ".codex", "sessions");

const at = (...parts) => path.join(HOME, ...parts);

module.exports = { HOME, CLAUDE_ROOT, CODEX_ROOT, at, LEGACY };
