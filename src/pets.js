"use strict";

const fs = require("fs");
const os = require("os");
const path = require("path");

/**
 * 스프라이트 팩.
 *
 * `codex-pets` 로 깔린 팩을 그대로 읽는다(`~/.codex/pets/<id>/`). 시트를 이 저장소로
 * 복사하지 않는 것은 게을러서가 아니다 — 남이 그린 그림을, 그 사람이 정한 배포
 * 경로 밖으로 옮겨 우리 배포물에 섞지 않는다. 깔려 있으면 쓰고, 없으면 우리 것을
 * 쓴다.
 *
 * 여기서는 **어떤 팩이 있는지만** 말한다. 격자가 몇 칸인지는 시트마다 다르고
 * (Clawd 1536×1872 = 9행, Pepe 1536×2288 = 11행), 그걸 여기서 짐작하면
 * 캐릭터가 반쪽씩 잘려 나온다. 크기는 그림을 실제로 연 쪽 — 렌더러 — 이 잰다.
 */

function petsDir() {
  return process.env.CLAUDE_PET_PACKS || process.env.KIBITZ_PET_PACKS || path.join(os.homedir(), ".codex", "pets");
}

function listPets() {
  let entries;
  try {
    entries = fs.readdirSync(petsDir(), { withFileTypes: true });
  } catch {
    return [];
  }
  const out = [];
  for (const e of entries) {
    if (!e.isDirectory()) continue;
    const base = path.join(petsDir(), e.name);
    let meta;
    try {
      meta = JSON.parse(fs.readFileSync(path.join(base, "pet.json"), "utf8"));
    } catch {
      continue;
    }
    const sheet = path.join(base, meta.spritesheetPath || "spritesheet.webp");
    if (!fs.existsSync(sheet)) continue;
    out.push({ id: String(meta.id || e.name), name: String(meta.displayName || e.name), sheet });
  }
  return out.sort((a, b) => a.id.localeCompare(b.id));
}

module.exports = { listPets };
