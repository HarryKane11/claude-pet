"use strict";

const fs = require("fs");
const os = require("os");
const path = require("path");

/**
 * 목소리.
 *
 * OpenClaw 의 `SOUL.md` 에서 가져온 생각이다 — 인격을 코드가 아니라 **사람이
 * 읽고 고칠 수 있는 파일**에 둔다. 그러면 캐릭터를 바꾸는 것이 그림만 바꾸는
 * 일이 아니게 된다. Rook 은 딱딱하게, Bunbun 은 들떠서, Nyx 는 조사도 빼고
 * 말한다.
 *
 * ── 우리가 비튼 것 ────────────────────────────────────────
 *
 * OpenClaw 의 soul 은 "무엇을 할지" 까지 정한다. 우리는 **말투만** 정하게 한다.
 *
 * 이 앱은 처음부터 "관측된 사실 없이는 말하지 않는다" 를 지켜 왔는데, 인격
 * 파일을 무제한으로 두면 그게 곧 **지어내도 되는 허가증**이 된다. 다정한
 * 캐릭터라고 해서 없는 일을 칭찬하면 그건 다정한 게 아니라 거짓말이다.
 *
 * 그래서 목소리는 "어떻게 말하는가" 만 바꾸고, "무엇을 말하는가" 는 관측이
 * 정한다. 아래 경계 문구가 목소리 뒤에 항상 따라붙는 이유다.
 */

const HOME = process.env.KIBITZ_PET_HOME || path.join(os.homedir(), ".kibitz-pet");
const BUILTIN = path.join(__dirname, "..", "souls");
/** 사람이 직접 쓴 것이 있으면 그게 이긴다. */
const OVERRIDE = path.join(HOME, "SOUL.md");

const BOUNDARY = `
목소리는 **어떻게 말하는가**만 정한다. **무엇을 말하는가**는 관측이 정한다.
성격이 다정하다고 해서 없는 일을 칭찬하지 마라 — 그건 다정한 게 아니라
거짓말이다. 본 것이 없으면 할 말도 없다.`;

function read(file) {
  try {
    const text = fs.readFileSync(file, "utf8").trim();
    return text || null;
  } catch {
    return null;
  }
}

/**
 * @param petId 지금 고른 캐릭터
 * @returns 프롬프트에 붙일 목소리 설명
 */
function soulFor(petId) {
  const own = read(OVERRIDE);
  if (own) return own + "\n" + BOUNDARY;
  const mine = petId ? read(path.join(BUILTIN, `${String(petId).replace(/[^\w-]/g, "")}.md`)) : null;
  return (mine || read(path.join(BUILTIN, "_default.md")) || "") + "\n" + BOUNDARY;
}

/** 어떤 목소리가 있는지. 설정 화면에서 보여 준다. */
function listSouls() {
  try {
    return fs
      .readdirSync(BUILTIN)
      .filter((f) => f.endsWith(".md") && !f.startsWith("_"))
      .map((f) => f.replace(/\.md$/, ""));
  } catch {
    return [];
  }
}

module.exports = { soulFor, listSouls, OVERRIDE, BUILTIN };
