/**
 * 주인공 캐릭터 시트.
 *
 * 앞서 만든 다섯은 몬스터로 읽혔다. 덩어리 몸에 다리가 붙은 실루엣은 아무리
 * 색을 바꿔도 몬스터다 — **주인공으로 읽히는 것은 비율**이다: 머리와 몸통이
 * 나뉘고, 팔이 있고, 손에 무언가를 들고 있다.
 *
 * 그래서 몸은 인간형 리그로 그린다. 머리·몸통·팔·다리를 따로 두고 자세만
 * 바꾼다. 다리는 짧게 — 이 크기에서 다리를 살리려 들면 비율이 무너진다.
 *
 *   node make-heroes.mjs
 */

import path from "node:path";
import fs from "node:fs";
import { fileURLToPath } from "node:url";
import { makeGrid, put, rect, line, outline, INK, WHITE, bakeSheet, writeSheet } from "./tools/pixel.mjs";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const OUT = path.join(HERE, "renderer", "pets");

const G = 24;
const GH = 26;
const S = 8;
const COLS = 6;

/* ── 리그 ──────────────────────────────────────────────────
   좌표를 한곳에 모아 둔다. 캐릭터마다 다시 정하면 한 가족처럼 안 보인다. */

/*
   비율과 얼굴은 취향으로 정하지 않았다. 오래 사랑받는 캐릭터들(카카오·라인
   프렌즈, 쿠마몬, 피크민)이 공통으로 지키는 것이 있다:

     · 머리를 키우고 몸을 줄인다 — 얼굴에 쓸 자리가 그만큼 늘어난다
     · 눈은 **얼굴 아래쪽**에 크게. 아기 얼굴의 비율이고, 이것 하나로 인상이 갈린다
     · 볼터치는 광대 위에
     · 코·귀·눈썹은 그리지 않는다. 표정이 복잡해질수록 귀엽지 않다
     · 모서리를 깎는다. 각진 실루엣은 안전해 보이지 않는다

   앞서 머리를 작게 잡고 눈을 얼굴 한가운데 뒀더니 블록 덩어리가 나왔다.
*/
/* 머리 장비가 격자 위로 잘려 나가서 뾰족 모자 끝이 사라졌다. 몸 전체를 내리고,
   흔들림도 아래로만 준다 — 위로 흔들면 그 순간마다 모자가 잘린다. */
const HEAD = { x: 5, y: 8, w: 14, h: 10 };
const TORSO = { x: 9, y: 19, w: 6, h: 4 };
const ARM = { y: 19, h: 3 };
const LEG = { y: 23, h: 2 };

/* ── 캐릭터 ────────────────────────────────────────────────
   색은 다섯: 피부·옷·옷그늘·옷밝음·금속. 여기서 더 늘리면 축소했을 때 뭉갠다. */

const CAST = [
  {
    id: "rook",
    name: "Rook",
    hint: "투구를 쓴 기사. 검과 방패.",
    skin: "#e8b98f",
    cloth: "#5a7fc4",
    dim: "#3a5691",
    lit: "#8fb0e8",
    metal: "#9aa8bd",
    head: "helm",
    weapon: "sword",
    cape: "#c4434a",
  },
  {
    id: "vela",
    name: "Vela",
    hint: "뾰족 모자를 쓴 마법사. 지팡이.",
    skin: "#f0c9a4",
    cloth: "#6b4fa8",
    dim: "#48327a",
    lit: "#9a7fd6",
    metal: "#ffd166",
    head: "wizhat",
    weapon: "staff",
    cape: "#4a3580",
  },
  {
    id: "fenn",
    name: "Fenn",
    hint: "후드를 쓴 순찰자. 활.",
    skin: "#dbaa7d",
    cloth: "#4f8f5c",
    dim: "#356140",
    lit: "#7fc48d",
    metal: "#b98a4e",
    head: "hood",
    weapon: "bow",
    cape: "#3d6b47",
  },
  {
    id: "nyx",
    name: "Nyx",
    hint: "복면을 쓴 도적. 단검 둘.",
    skin: "#e0b48c",
    cloth: "#3b3f52",
    dim: "#252838",
    lit: "#5f6683",
    metal: "#aeb7c6",
    head: "mask",
    weapon: "dagger",
    cape: "#2b2e3d",
  },
  {
    id: "pip",
    name: "Pip",
    hint: "고글을 쓴 정비공. 렌치.",
    skin: "#f0c9a4",
    cloth: "#c98a3a",
    dim: "#93611f",
    lit: "#e8b163",
    metal: "#c9d2de",
    head: "goggles",
    weapon: "wrench",
    cape: null,
  },
];

/* ── 부위 ─────────────────────────────────────────────────
   빛은 늘 왼쪽 위. 프레임마다 광원이 돌면 같은 사람으로 안 보인다. */

function cape(g, h, dy, flap) {
  if (!h.cape) return;
  const x = TORSO.x - 1;
  const y = TORSO.y + dy - 1;
  rect(g, x, y, TORSO.w + 2, TORSO.h + 1, h.cape);
  // 자락은 프레임마다 흔들린다. 이게 없으면 망토가 판자처럼 보인다.
  // 다리보다 길게 늘어뜨리면 다리 사이로 삐져나와 지저분해진다.
  for (let i = 0; i < TORSO.w + 2; i++) {
    if ((i + flap) % 3 === 0) put(g, x + i, y + TORSO.h + 1, h.cape);
  }
}

function torso(g, h, dy) {
  const { x, y, w, h: hh } = TORSO;
  rect(g, x, y + dy, w, hh, h.cloth);
  rect(g, x, y + dy, 2, hh, h.lit);
  rect(g, x + w - 1, y + dy, 1, hh, h.dim);
  rect(g, x, y + dy + hh - 1, w, 1, h.metal); // 허리띠
}

function arms(g, h, dy, { left = 0, right = 0 } = {}) {
  // 손가락은 그리지 않는다. 이 크기에서 손을 그리면 뭉개지고, 뭉개진 손은
  // 귀여움을 깎아먹는다 — 둥근 뭉툭한 팔이 낫다.
  rect(g, TORSO.x - 2, ARM.y + dy + left, 2, ARM.h, h.cloth);
  rect(g, TORSO.x + TORSO.w, ARM.y + dy + right, 2, ARM.h, h.cloth);
  rect(g, TORSO.x - 2, ARM.y + dy + left + ARM.h, 2, 1, h.skin);
  rect(g, TORSO.x + TORSO.w, ARM.y + dy + right + ARM.h, 2, 1, h.skin);
}

function legs(g, h, dy, phase) {
  const y = LEG.y + dy;
  const a = phase % 2 ? 1 : 0;
  rect(g, TORSO.x, y, 2, LEG.h - a, h.dim);
  rect(g, TORSO.x + TORSO.w - 2, y, 2, LEG.h - (1 - a), h.dim);
  rect(g, TORSO.x - 1, y + LEG.h - a, 3, 1, "#2b2118");
  rect(g, TORSO.x + TORSO.w - 3, y + LEG.h - (1 - a), 3, 1, "#2b2118");
}

function head(g, h, dy, { closed = false, look = 0, mouth = "" } = {}) {
  const { x, y, w, h: hh } = HEAD;
  rect(g, x, y + dy, w, hh, h.skin);
  // 모서리를 깎는다 — 각진 머리는 인형이 아니라 상자로 보인다.
  for (const [cx, cy] of [
    [x, y + dy],
    [x + w - 1, y + dy],
    [x, y + dy + hh - 1],
    [x + w - 1, y + dy + hh - 1],
  ]) {
    put(g, cx, cy, null);
    g[Math.max(0, cy)][Math.max(0, cx)] = null;
  }
  rect(g, x, y + dy, 1, hh, "#00000014");

  // 눈은 얼굴 **아래쪽** 3분의 2 지점. 가운데 두면 어른 얼굴이 되고 인상이 식는다.
  const ey = y + dy + Math.round(hh * 0.58);
  const lx = x + 2;
  const rx = x + w - 5;
  if (closed) {
    rect(g, lx, ey + 1, 3, 1, INK);
    rect(g, rx, ey + 1, 3, 1, INK);
  } else {
    rect(g, lx, ey, 3, 4, INK);
    rect(g, rx, ey, 3, 4, INK);
    // 눈동자 위 흰 점 하나. 이게 있고 없고가 살아 있는 눈과 단추의 차이다.
    put(g, lx + 1 + look, ey + 1, WHITE);
    put(g, rx + 1 + look, ey + 1, WHITE);
  }
  // 볼터치 — 광대 위, 눈 바깥쪽.
  rect(g, x + 1, ey + 3, 2, 1, h.blush || "#e88b8b66");
  rect(g, x + w - 3, ey + 3, 2, 1, h.blush || "#e88b8b66");

  if (mouth === "open") rect(g, x + Math.round(w / 2) - 1, ey + 5, 2, 2, "#8a3f47");
  else if (mouth === "smile") {
    rect(g, x + Math.round(w / 2) - 1, ey + 5, 2, 1, INK);
    put(g, x + Math.round(w / 2) - 2, ey + 4, INK);
    put(g, x + Math.round(w / 2) + 1, ey + 4, INK);
  }
}

/* ── 머리 장비 — 실루엣을 가르는 것 ────────────────────────── */

function headgear(g, h, dy) {
  const { x, y, w } = HEAD;
  const t = y + dy;
  switch (h.head) {
    case "helm":
      // 이마까지만 덮는다. 눈을 가리면 표정이 사라지고 블록이 된다.
      // 대신 크게 덮는다 — 이 캐릭터를 한눈에 가르는 것은 이 실루엣 하나다.
      rect(g, x - 1, t - 3, w + 2, 7, h.metal);
      rect(g, x, t - 4, w, 1, h.metal);
      rect(g, x - 1, t + 4, w + 2, 1, h.dim); // 챙
      rect(g, x - 2, t, 2, 6, h.metal); // 뺨가리개
      rect(g, x + w, t, 2, 6, h.metal);
      rect(g, x + Math.round(w / 2) - 1, t - 8, 2, 5, "#c4434a"); // 깃털
      rect(g, x + Math.round(w / 2) - 2, t - 9, 4, 1, "#c4434a");
      break;
    case "wizhat":
      // 위로 갈수록 좁아지고 끝이 꺾인다. 곧은 고깔은 파티 모자로 보인다.
      for (let i = 0; i < 8; i++) {
        const wid = Math.max(2, w - 2 - i * 1.4);
        rect(g, Math.round(x + 1 + i * 0.9), t - 1 - i, Math.round(wid), 1, i > 5 ? h.dim : h.cloth);
      }
      rect(g, x - 3, t + 1, w + 6, 2, h.cloth); // 넓은 챙
      rect(g, x - 3, t + 3, w + 6, 1, h.dim);
      rect(g, x + 8, t - 9, 2, 2, h.metal); // 별
      break;
    case "hood":
      // 뾰족하게 솟은 후드. 얼굴은 앞만 트여 있다.
      rect(g, x - 1, t - 3, w + 2, 6, h.cloth);
      rect(g, x + 2, t - 6, w - 4, 3, h.cloth);
      rect(g, x + 4, t - 8, 3, 2, h.dim);
      rect(g, x - 2, t + 1, 3, 7, h.cloth); // 옆으로 내려오는 자락
      rect(g, x + w - 1, t + 1, 3, 7, h.cloth);
      rect(g, x - 1, t + 3, w + 2, 1, h.dim);
      break;
    case "mask":
      rect(g, x - 1, t - 2, w + 2, 4, h.cloth); // 두건
      rect(g, x, t - 3, w, 1, h.cloth);
      rect(g, x, t + 8, w, 3, h.cloth); // 입가리개
      rect(g, x + w, t, 4, 3, h.cloth); // 뒤로 날리는 천
      rect(g, x + w + 2, t + 3, 3, 2, h.dim);
      break;
    case "goggles":
      rect(g, x - 1, t - 3, w + 2, 4, "#8a5a2a"); // 부스스한 머리
      for (let i = 0; i < w; i += 3) put(g, x + i, t - 4, "#8a5a2a");
      rect(g, x - 2, t + 1, w + 4, 3, "#3a3f4a"); // 이마에 올린 고글
      rect(g, x, t + 1, 4, 3, "#8fc7ff");
      rect(g, x + w - 4, t + 1, 4, 3, "#8fc7ff");
      break;
    default:
      break;
  }
}

/* ── 손에 든 것 ────────────────────────────────────────────── */

function weapon(g, h, dy, raise = 0) {
  const x = TORSO.x + TORSO.w + 1;
  const y = ARM.y + dy + ARM.h - raise;
  switch (h.weapon) {
    case "sword":
      rect(g, x, y - 9, 2, 9, h.metal);
      rect(g, x - 1, y - 1, 4, 1, "#8a6a3a"); // 손잡이 가드
      rect(g, x, y, 2, 2, "#6a4a26");
      break;
    case "staff":
      rect(g, x, y - 11, 2, 12, "#8a6a3a");
      rect(g, x - 1, y - 13, 4, 3, h.metal);
      rect(g, x, y - 14, 2, 1, h.metal);
      break;
    case "bow":
      for (let i = 0; i < 9; i++) {
        const bend = i === 0 || i === 8 ? 0 : Math.round(Math.sin((i / 8) * Math.PI) * 2);
        put(g, x + bend, y - 9 + i, h.metal);
      }
      line(g, x, y - 9, 0, 1, 9, "#e8e0d0");
      break;
    case "dagger":
      rect(g, x, y - 5, 2, 5, h.metal);
      rect(g, x - 1, y, 4, 1, "#6a4a26");
      rect(g, TORSO.x - 3, y - 4, 2, 4, h.metal); // 왼손에도 하나
      rect(g, TORSO.x - 4, y, 4, 1, "#6a4a26");
      break;
    case "wrench":
      rect(g, x, y - 6, 2, 7, h.metal);
      rect(g, x - 1, y - 8, 4, 2, "#dfe6f0");
      put(g, x, y - 7, INK);
      put(g, x + 1, y - 7, INK);
      break;
    default:
      break;
  }
}

/* ── 소품 ─────────────────────────────────────────────────── */

function bulb(g, dy, on) {
  const x = 19;
  const y = 1 + dy;
  rect(g, x, y, 3, 3, on ? "#ffe066" : "#6f6a5c");
  rect(g, x, y + 3, 3, 1, "#9aa0ab");
  if (on) {
    put(g, x - 2, y - 1, "#ffe066");
    put(g, x + 4, y - 1, "#ffe066");
    put(g, x + 1, y - 2, "#ffe066");
  }
}

function zzz(g, i) {
  const [x, y] = [[18, 7], [20, 5], [21, 3]][i % 3];
  rect(g, x, y, 3, 1, WHITE);
  put(g, x + 2, y + 1, WHITE);
  rect(g, x, y + 2, 3, 1, WHITE);
}

function lantern(g, dy, i) {
  const x = 18;
  const y = ARM.y + dy + 5;
  rect(g, x, y - 2, 4, 4, i % 2 ? "#ffd166" : "#f0b93a");
  rect(g, x, y - 3, 4, 1, "#7a5a3a");
  rect(g, x, y + 2, 4, 1, "#7a5a3a");
  rect(g, x + 1, y - 5, 2, 2, "#7a5a3a");
}

function speed(g, i) {
  for (let k = 0; k < 3; k++) {
    const y = 8 + k * 5;
    rect(g, 1 - (i % 2), y, 3 + ((i + k) % 3), 1, "#f6f1e8aa");
  }
}

function dust(g, dy, i) {
  const y = LEG.y + dy + LEG.h + 1;
  put(g, 5 + (i % 3), y, "#f6f1e866");
  put(g, 18 - (i % 3), y, "#f6f1e866");
}

/* ── 행 ────────────────────────────────────────────────────
   순서는 codex-pets 팩과 맞춘다. 렌더러가 행 번호로 상태를 찾는다. */

const ROWS = [
  { id: "wait", frames: 6 },
  { id: "walk", frames: 6 },
  { id: "cheer", frames: 6 },
  { id: "fix", frames: 4 },
  { id: "spare", frames: 4 },
  { id: "sleep", frames: 6 },
  { id: "answer", frames: 6 },
  { id: "run", frames: 6 },
  { id: "look", frames: 6 },
];

function frameOf(h, row, i) {
  const g = makeGrid(G, GH);
  const bob = [0, 0, 1, 1, 0, 0][i % 6];

  switch (row) {
    case "wait": {
      const dy = bob;
      cape(g, h, dy, i);
      legs(g, h, dy, 0);
      torso(g, h, dy);
      arms(g, h, dy);
      head(g, h, dy, { closed: i === 4, look: i > 2 ? 1 : 0 });
      headgear(g, h, dy);
      weapon(g, h, dy);
      break;
    }
    case "walk": {
      const dy = i % 2 ? 1 : 0;
      cape(g, h, dy, i);
      legs(g, h, dy, i);
      torso(g, h, dy);
      arms(g, h, dy, { left: i % 2 ? -1 : 1, right: i % 2 ? 1 : -1 });
      head(g, h, dy);
      headgear(g, h, dy);
      weapon(g, h, dy);
      break;
    }
    case "cheer": {
      // 무기를 치켜든다. 무언가 끝났을 때.
      const dy = i % 2 ? 0 : 1;
      cape(g, h, dy, i);
      legs(g, h, dy, 0);
      torso(g, h, dy);
      arms(g, h, dy, { right: -3 });
      head(g, h, dy, { look: 1, mouth: "open" });
      headgear(g, h, dy);
      weapon(g, h, dy, 4);
      break;
    }
    case "fix": {
      const dy = i % 2 ? 1 : 0;
      const swing = i < 2 ? 3 : 0;
      cape(g, h, dy, i);
      legs(g, h, dy, 0);
      torso(g, h, dy);
      arms(g, h, dy, { right: -swing });
      head(g, h, dy, { look: 1 });
      headgear(g, h, dy);
      weapon(g, h, dy, swing);
      break;
    }
    case "spare": {
      // 생각하는 중. 고개를 살짝 숙이고 전구가 켜진다.
      const dy = bob;
      cape(g, h, dy, i);
      legs(g, h, dy, 0);
      torso(g, h, dy);
      arms(g, h, dy, { left: -2 });
      head(g, h, dy, { closed: i === 1, look: -1 });
      headgear(g, h, dy);
      bulb(g, dy, i >= 2);
      break;
    }
    case "sleep": {
      // 앉아서 존다. 서서 눈만 감으면 자는 것으로 안 보인다.
      const dy = 3;
      cape(g, h, dy, 0);
      torso(g, h, dy);
      rect(g, TORSO.x + 1, LEG.y + dy, TORSO.w - 2, 2, h.dim);
      arms(g, h, dy, { left: 1, right: 1 });
      head(g, h, dy + 1, { closed: true });
      headgear(g, h, dy + 1);
      zzz(g, Math.floor(i / 2));
      break;
    }
    case "answer": {
      // 말하는 중 — 한 손을 들고 고개를 든다.
      const dy = bob;
      cape(g, h, dy, i);
      legs(g, h, dy, 0);
      torso(g, h, dy);
      arms(g, h, dy, { right: i % 2 ? -2 : -1 });
      head(g, h, dy, { look: i % 2 ? 1 : 0, mouth: i % 2 ? "open" : "smile" });
      headgear(g, h, dy);
      break;
    }
    case "run": {
      const dy = i % 2 ? 2 : 0;
      speed(g, i);
      cape(g, h, dy, i + 1);
      legs(g, h, dy, i);
      torso(g, h, dy);
      arms(g, h, dy, { left: i % 2 ? -2 : 2, right: i % 2 ? 2 : -2 });
      head(g, h, dy, { look: 1 });
      headgear(g, h, dy);
      dust(g, dy, i);
      break;
    }
    case "look": {
      const dy = bob;
      cape(g, h, dy, i);
      legs(g, h, dy, 0);
      torso(g, h, dy);
      arms(g, h, dy, { right: -2 });
      head(g, h, dy, { look: i % 3 === 0 ? -1 : 1 });
      headgear(g, h, dy);
      lantern(g, dy, i);
      break;
    }
    default:
      torso(g, h, 0);
  }
  // 마지막에 한 번 두른다. 부위마다 그리면 안쪽에도 선이 생겨 지저분해진다.
  outline(g);
  return g;
}

/* ── 굽기 ─────────────────────────────────────────────────── */

const index = [];
for (const h of CAST) {
  const png = bakeSheet({
    rows: ROWS,
    cols: COLS,
    gw: G,
    gh: GH,
    scale: S,
    frame: (row, i) => frameOf(h, row, i),
  });
  writeSheet(OUT, h.id, png);
  index.push({ id: h.id, name: h.name, hint: h.hint, sheet: `pets/${h.id}.png` });
  console.log(`${h.id}.png  ${G * S * COLS}×${GH * S * ROWS.length}`);
}

// 생물 시트 목록과 합쳐 둔다. 렌더러는 이 파일 하나만 읽는다.
const file = path.join(OUT, "index.json");
let prev = [];
try {
  prev = JSON.parse(fs.readFileSync(file, "utf8"));
} catch {
  /* 처음이면 빈 목록 */
}
const merged = [...index, ...prev.filter((p) => !index.some((h) => h.id === p.id))];
fs.writeFileSync(file, JSON.stringify(merged, null, 2) + "\n");
console.log(`index.json  ${merged.length}종`);
