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

/* 몸은 24×26 에 그린다 — 리그 좌표를 그대로 두기 위해서다. 그다음 두 배로 펴서
   48×52 에 얹고, **거기서부터 세밀한 것을 얹는다.** 셀은 여전히 192×208 이라
   codex-pets 규격을 지키면서 쓸 수 있는 픽셀만 네 배가 된다.

   처음부터 48×52 에 그리려면 모든 좌표 상수를 두 배로 고쳐야 하는데, 그러면
   지금까지 맞춰 놓은 비율이 한 번에 다 틀어진다. 굵은 형태는 그대로 두고
   디테일만 새 격자에서 더하는 쪽이 안전하다. */
const G = 24;
const GH = 26;
const U = 2; // 확대 배수
const FG = G * U; // 48
const FGH = GH * U; // 52
const S = 4; // 최종 배율 → 192×208
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
    id: "bunbun",
    name: "Bunbun",
    hint: "귀가 긴 토끼. 당근을 든다.",
    skin: "#f5ede2",
    cloth: "#f2a3b8",
    dim: "#c9748d",
    lit: "#ffc9d8",
    metal: "#ffffff",
    blush: "#f28aa8aa",
    head: "bunny",
    weapon: "carrot",
    cape: null,
  },
  {
    id: "choco",
    name: "Choco",
    hint: "둥근 귀 곰. 꿀단지를 안는다.",
    skin: "#c68a5a",
    cloth: "#8a5a3a",
    dim: "#5e3b24",
    lit: "#b57c50",
    metal: "#ffd166",
    blush: "#d9705faa",
    head: "bear",
    weapon: "honey",
    cape: null,
  },
  {
    id: "nimbus",
    name: "Nimbus",
    hint: "구름 머리. 우산을 든다.",
    skin: "#eef3fb",
    cloth: "#7fb8e8",
    dim: "#4c86bb",
    lit: "#b3dcff",
    metal: "#ffffff",
    blush: "#8fb8e0aa",
    head: "cloud",
    weapon: "umbrella",
    cape: null,
  },
  {
    id: "momo",
    name: "Momo",
    hint: "복숭아 머리. 잎이 하나.",
    skin: "#ffcfd8",
    cloth: "#7fc48d",
    dim: "#4f8f5c",
    lit: "#a8e8b4",
    metal: "#ffe08a",
    blush: "#ff9aa8aa",
    head: "peach",
    weapon: "spoon",
    cape: null,
  },
  {
    id: "mocha",
    name: "Mocha",
    hint: "컵을 머리에 인 요정. 김이 난다.",
    skin: "#f0dcc4",
    cloth: "#a9714a",
    dim: "#71482c",
    lit: "#d1a077",
    metal: "#f6f1e8",
    blush: "#c98a6aaa",
    head: "cup",
    weapon: "straw",
    cape: null,
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
  // 손을 무기 쪽으로 한 칸 뻗는다. 팔과 무기 사이가 비면 들고 있는 것으로 안 보인다.
  rect(g, TORSO.x + TORSO.w + 2, ARM.y + dy + right + ARM.h - 1, 1, 2, h.cloth);
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
    case "bunny": {
      // 긴 귀 둘. 실루엣만으로 토끼가 되는 유일한 부위다.
      const ex = [x + 2, x + w - 5];
      ex.forEach((bx, k) => {
        const tilt = k ? 1 : -1;
        for (let i = 0; i < 8; i++) {
          const yy = t - 1 - i;
          const xx = bx + Math.round((i / 8) * 2) * tilt;
          rect(g, xx, yy, 3, 1, h.skin);
          if (i > 1 && i < 7) put(g, xx + 1, yy, h.cloth); // 귀 안쪽
        }
      });
      break;
    }
    case "bear":
      // 둥근 귀는 머리 위가 아니라 **옆 위**에 붙는다. 위에 얹으면 곰이 아니라 인형이다.
      rect(g, x - 1, t - 3, 5, 5, h.skin);
      rect(g, x + w - 4, t - 3, 5, 5, h.skin);
      rect(g, x, t - 2, 3, 3, h.dim);
      rect(g, x + w - 3, t - 2, 3, 3, h.dim);
      break;
    case "cloud": {
      // 뭉게뭉게 — 크기가 다른 덩어리 셋을 겹친다. 같은 크기로 늘어놓으면 구름이 아니다.
      const puff = [
        [x - 1, t - 4, 6, 5],
        [x + 4, t - 6, 7, 6],
        [x + w - 4, t - 3, 5, 4],
      ];
      for (const [px, py, pw, ph] of puff) rect(g, px, py, pw, ph, h.metal);
      break;
    }
    case "peach":
      // 위가 살짝 갈라진 복숭아. 잎 하나가 전부다.
      rect(g, x + 1, t - 3, w - 2, 4, h.skin);
      rect(g, x + 3, t - 4, w - 6, 1, h.skin);
      rect(g, x + Math.round(w / 2) - 1, t - 3, 1, 3, "#e8a8b4"); // 골
      rect(g, x + Math.round(w / 2) + 1, t - 7, 4, 2, h.cloth); // 잎
      rect(g, x + Math.round(w / 2) + 2, t - 8, 2, 1, h.dim);
      rect(g, x + Math.round(w / 2), t - 5, 1, 2, "#8a5a3a"); // 꼭지
      break;
    case "cup":
      // 머리에 인 잔. 김은 프레임마다 흔들려야 뜨거워 보인다.
      rect(g, x, t - 6, w, 6, h.metal);
      rect(g, x + 1, t - 5, w - 2, 3, h.cloth);
      rect(g, x - 2, t - 5, 2, 3, h.metal); // 손잡이
      rect(g, x - 3, t - 4, 1, 1, h.metal);
      rect(g, x - 1, t - 7, w + 2, 1, h.metal); // 잔 테두리
      break;
    default:
      break;
  }
}

/* 김·귀 흔들림처럼 **프레임마다 달라지는** 머리 장식. 위 함수는 정지 상태만 그린다. */
function headFx(g, h, dy, i) {
  const { x, y, w } = HEAD;
  const t = y + dy;
  if (h.head === "cup") {
    for (let k = 0; k < 3; k++) {
      const sx = x + 3 + k * 4 + ((i + k) % 2);
      rect(g, sx, t - 10 - k, 1, 2, "#ffffff55");
    }
  }
  if (h.head === "cloud" && i % 3 === 0) {
    put(g, x + 3, t + 2, "#8fc7ff");
    put(g, x + w - 4, t + 3, "#8fc7ff");
  }
}

/* ── 손에 든 것 ────────────────────────────────────────────── */

function weapon(g, h, dy, raise = 0) {
  // 팔이 x = TORSO.x + TORSO.w 부터 두 칸이다. 거기서 바로 시작하면 무기가
  // 몸에 붙어 손에 든 것으로 안 보인다 — 손 바깥에서 시작한다.
  const x = TORSO.x + TORSO.w + 3;
  const y = ARM.y + dy + ARM.h - raise;
  switch (h.weapon) {
    case "sword":
      rect(g, x, y - 9, 2, 9, h.metal);
      rect(g, x - 1, y - 1, 4, 1, "#8a6a3a"); // 손잡이 가드
      rect(g, x, y, 2, 2, "#6a4a26");
      break;
    case "staff":
      rect(g, x, y - 12, 2, 13, "#8a6a3a");
      rect(g, x - 1, y - 15, 4, 3, h.metal);
      rect(g, x, y - 16, 2, 1, h.metal);
      put(g, x - 2, y - 17, h.metal); // 반짝
      put(g, x + 3, y - 17, h.metal);
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
    case "carrot":
      rect(g, x, y - 6, 3, 6, "#e8833a");
      rect(g, x + 1, y, 1, 2, "#c96a26");
      rect(g, x, y - 8, 1, 2, "#5fa85f");
      rect(g, x + 2, y - 8, 1, 2, "#5fa85f");
      break;
    case "honey":
      rect(g, x, y - 5, 5, 5, "#e8c07a");
      rect(g, x - 1, y - 6, 7, 1, "#f6f1e8");
      rect(g, x + 1, y - 4, 3, 2, "#c98a3a");
      break;
    case "umbrella":
      rect(g, x + 1, y - 8, 1, 9, "#6a4a26");
      for (let k = 0; k < 4; k++) rect(g, x - 1 - k + 2, y - 9 - k, 3 + k * 2, 1, k % 2 ? "#f2a3b8" : "#7fb8e8");
      rect(g, x + 1, y + 1, 2, 1, "#6a4a26");
      break;
    case "spoon":
      rect(g, x + 1, y - 6, 1, 7, h.metal);
      rect(g, x, y - 9, 3, 3, h.metal);
      break;
    case "straw":
      rect(g, x + 1, y - 8, 2, 9, "#e86a7a");
      rect(g, x + 1, y - 10, 4, 2, "#e86a7a");
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
      headFx(g, h, dy, i);
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
      headFx(g, h, dy, i);
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
      headFx(g, h, dy, i);
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
      headFx(g, h, dy, i);
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
      headFx(g, h, dy, i);
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
      headFx(g, h, dy + 1, i);
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
      headFx(g, h, dy, i);
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
      headFx(g, h, dy, i);
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
      headFx(g, h, dy, i);
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

/* ── 진화 ──────────────────────────────────────────────────
   레벨이 올라도 캐릭터가 그대로면 레벨은 그냥 숫자다. 포켓몬이 오래 가는 이유는
   숫자가 아니라 **모습이 바뀌기 때문**이다.

   단계는 지어내지 않는다. 레벨은 토큰이고 토큰은 관측된 사실이므로, 진화도
   관측의 함수다 — 이 앱이 처음부터 지켜 온 규칙 그대로다.

     1단계  Lv.1~   그대로
     2단계  Lv.15~  망토·투구 장식·어깨 보호대. 실루엣이 커진다
     3단계  Lv.35~  오라와 빛나는 테두리. 멀리서도 다르게 보인다

   실루엣이 커지는 순서가 중요하다. 색만 바꾸면 진화가 아니라 색놀이다. */

const STAGES = [
  { stage: 1, from: 1 },
  { stage: 2, from: 15 },
  { stage: 3, from: 35 },
];

/** 24×26 격자를 48×52 로 편다. 디테일은 이 위에 얹는다. */
function upscale(g) {
  const out = makeGrid(FG, FGH);
  for (let y = 0; y < GH; y++) {
    for (let x = 0; x < G; x++) {
      const c = g[y][x];
      if (!c) continue;
      for (let j = 0; j < U; j++) for (let k = 0; k < U; k++) out[y * U + j][x * U + k] = c;
    }
  }
  return out;
}

/** 굵은 격자 좌표 → 세밀한 격자 좌표. */
const F = (n) => Math.round(n * U);

/**
 * 단계별로 더 붙는 것.
 *
 * 굵은 형태를 다시 그리지 않고 **얹기만** 한다. 그래야 세 단계가 한 사람으로
 * 보인다 — 진화는 다른 캐릭터가 되는 게 아니라 같은 캐릭터가 자란 것이다.
 */
/* ── 진화 표식 ────────────────────────────────────────────
   모두에게 왕관을 씌우면 진화가 아니라 스티커다. 기사가 왕관을 쓰면 승급이지만
   토끼가 왕관을 쓰면 그냥 토끼가 왕관을 쓴 것이다.

   그래서 **그 캐릭터가 원래 가진 것을 키운다.** 기사는 갑옷이 두꺼워지고,
   마법사는 별이 늘고, 토끼는 귀가 길어지고, 구름은 비를 내린다. 진화는 다른
   것이 되는 게 아니라 자기 자신이 더 되는 것이다.

   색도 캐릭터에서 가져온다 — 다만 팔레트를 그대로 쓰면 안 된다. Rook 은
   metal 이 투구 색이라 오라를 그려도 투구에 묻혀 아무것도 안 보였다. */

const GLOW = { rook: "#ffd54a", vela: "#a98bff", fenn: "#8fe08a", nyx: "#7fd8ff",
  pip: "#ffb347", bunbun: "#ffd0e0", choco: "#ffd166", nimbus: "#bfe6ff",
  momo: "#ff9ec4", mocha: "#f0c88a" };

function evolve(g, h, stage, row, i, dy) {
  if (stage < 2) return;
  const hx = F(HEAD.x);
  const hy = F(HEAD.y + dy);
  const hw = F(HEAD.w);
  const hh = F(HEAD.h);
  const tx = F(TORSO.x);
  const ty = F(TORSO.y + dy);
  const tw = F(TORSO.w);
  const cx = hx + Math.round(hw / 2);
  const glow = GLOW[h.id] || "#ffd54a";
  const kit = { g, h, hx, hy, hw, hh, tx, ty, tw, cx, glow, i, stage };

  MARKS[h.id] ? MARKS[h.id](kit) : generic(kit);
}

/** 어깨를 넓히는 것은 공통이다. 사람이 커 보이는 가장 싼 방법이고, 큰 머리에
    가리지 않는 유일한 자리이기도 하다. */
function pauldrons({ g, hx, hy, hh, hw, glow }) {
  rect(g, hx - 4, hy + hh - 2, 5, 5, glow);
  rect(g, hx + hw - 1, hy + hh - 2, 5, 5, glow);
  rect(g, hx - 4, hy + hh + 3, 5, 1, INK);
  rect(g, hx + hw - 1, hy + hh + 3, 5, 1, INK);
}

/** 프레임마다 자리를 옮기는 반짝임. 가만히 있으면 빛이 아니라 점이다. */
function sparkle(g, spots, i, glow, lit = "#ffffff") {
  spots.forEach(([px, py], k) => {
    if ((i + k) % 3 !== 0) return;
    put(g, px, py, lit);
    put(g, px + 1, py - 1, glow);
    put(g, px, py - 2, lit);
  });
}

function generic(k) {
  pauldrons(k);
  const { g, hx, hy, hw, glow, i, stage } = k;
  rect(g, hx - 1, hy + 1, hw + 2, 2, glow);
  if (stage < 3) return;
  sparkle(g, [[hx - 6, hy + 4], [hx + hw + 3, hy + 6], [hx - 4, hy - 3]], i, glow);
}

const MARKS = {
  // 기사 — 갑옷이 두꺼워지고, 투구 깃이 자란다. 승급하는 군인.
  rook(k) {
    const { g, hx, hy, hw, cx, glow, i, stage } = k;
    pauldrons(k);
    rect(g, hx - 1, hy + 2, hw + 2, 2, glow); // 투구 띠
    if (stage < 3) return;
    rect(g, cx - 3, hy - 6, 6, 3, glow); // 넓은 깃 받침
    rect(g, cx - 1, hy - 14, 2, 8, "#c4434a"); // 더 길어진 깃
    rect(g, cx - 2, hy - 16, 4, 2, "#c4434a");
    rect(g, hx - 5, hy + 6, 2, 8, glow); // 뺨가리개가 내려온다
    rect(g, hx + hw + 3, hy + 6, 2, 8, glow);
  },

  // 마법사 — 별이 늘고 모자가 길어진다.
  vela(k) {
    const { g, hx, hy, hw, cx, glow, i, stage } = k;
    rect(g, hx - 4, hy + 2, hw + 8, 2, glow); // 챙 테두리
    put(g, hx + hw + 2, hy - 4, glow);
    if (stage < 3) return;
    // 머리 위를 도는 별 셋
    const ring = [[cx - 10, hy - 8], [cx, hy - 14], [cx + 10, hy - 8]];
    ring.forEach(([px, py], n) => {
      const on = (i + n) % 3;
      rect(g, px - 1, py + on, 3, 1, glow);
      rect(g, px, py - 1 + on, 1, 3, glow);
    });
    sparkle(g, [[hx - 6, hy + 8], [hx + hw + 4, hy + 10]], i, glow);
  },

  // 순찰자 — 후드에 잎이 돋고 어깨에 망토 자락이 생긴다.
  fenn(k) {
    const { g, hx, hy, hw, cx, glow, stage, i } = k;
    pauldrons(k);
    rect(g, hx + 2, hy - 3, 4, 2, glow); // 잎
    rect(g, hx + hw - 6, hy - 3, 4, 2, glow);
    if (stage < 3) return;
    for (let n = 0; n < 5; n++) {
      rect(g, hx - 6 + n * 2, hy - 6 - (n % 2) * 2, 2, 3, glow); // 잎사귀 관
      rect(g, hx + hw + 4 - n * 2, hy - 6 - (n % 2) * 2, 2, 3, glow);
    }
    sparkle(g, [[cx - 12, hy + 12], [cx + 12, hy + 8]], i, glow);
  },

  // 도적 — 그림자가 는다. 빛나는 대신 분신이 생긴다.
  nyx(k) {
    const { g, hx, hy, hw, hh, tx, ty, tw, glow, i, stage } = k;
    rect(g, hx + hw, hy + 2, 6, 3, "#3b3f52"); // 뒤로 더 날리는 천
    rect(g, hx + hw + 4, hy + 5, 4, 2, "#252838");
    if (stage < 3) return;
    // 잔상 — 채워 그렸더니 덩어리가 되어 캐릭터를 가렸다. 윤곽만 남긴다.
    const ghost = "#8f9bc0";
    const off = 7 + (i % 2) * 2;
    for (let y = 0; y < hh - 2; y += 2) put(g, hx - off, hy + 4 + y, ghost);
    for (let x = 0; x < hw; x += 3) put(g, hx - off + x, hy + 3, ghost);
    for (let y = 0; y < 8; y += 2) put(g, tx - off, ty + y, ghost);
    sparkle(g, [[hx + hw + 6, hy + 10]], i, glow);
  },

  // 정비공 — 장비가 는다. 고글이 하나 더, 어깨에 공구.
  pip(k) {
    const { g, hx, hy, hw, tx, ty, tw, glow, i, stage } = k;
    pauldrons(k);
    rect(g, hx + hw - 2, hy - 5, 5, 4, glow); // 이마에 올린 두 번째 고글
    if (stage < 3) return;
    rect(g, tx + tw + 4, ty - 8, 3, 10, "#b9c2cf"); // 등에 멘 공구
    rect(g, tx + tw + 2, ty - 11, 7, 3, "#dfe6f0");
    sparkle(g, [[hx - 6, hy + 6], [tx - 8, ty + 4]], i, glow, "#ffe9a8");
  },

  // 토끼 — 귀가 길어진다. 이 캐릭터를 가르는 것이 귀이므로 거기가 자란다.
  bunbun(k) {
    const { g, hx, hy, hw, glow, i, stage } = k;
    rect(g, hx + 1, hy - 6, 5, 6, "#f5ede2"); // 귀 밑동이 굵어진다
    rect(g, hx + hw - 6, hy - 6, 5, 6, "#f5ede2");
    rect(g, hx + 2, hy - 5, 3, 4, glow);
    rect(g, hx + hw - 5, hy - 5, 3, 4, glow);
    if (stage < 3) return;
    // 귀는 위로 자라는데 격자 끝이 있다. 자라는 만큼 벌어지게 해서, 잘리는 대신
    // 옆으로 퍼지게 한다 — 위가 막히면 옆이 답이다.
    for (let n = 0; n < 5; n++) {
      const t = n * 2;
      const spread = Math.round(n * 0.8);
      rect(g, hx + 1 - spread, hy - 11 - t, 5, 3, "#f5ede2");
      rect(g, hx + hw - 6 + spread, hy - 11 - t, 5, 3, "#f5ede2");
    }
    sparkle(g, [[hx - 5, hy + 8], [hx + hw + 3, hy + 6]], i, glow);
  },

  // 곰 — 커진다. 귀가 두꺼워지고 몸에 무게가 붙는다.
  choco(k) {
    const { g, hx, hy, hw, hh, tx, ty, tw, glow, stage, i } = k;
    rect(g, hx - 4, hy - 5, 8, 8, "#c68a5a"); // 귀가 커진다
    rect(g, hx + hw - 4, hy - 5, 8, 8, "#c68a5a");
    rect(g, hx - 2, hy - 3, 4, 4, "#5e3b24");
    rect(g, hx + hw - 2, hy - 3, 4, 4, "#5e3b24");
    if (stage < 3) return;
    rect(g, tx - 5, ty, 4, 10, "#8a5a3a"); // 팔이 굵어진다
    rect(g, tx + tw + 1, ty, 4, 10, "#8a5a3a");
    rect(g, hx + 2, hy + hh - 1, hw - 4, 3, glow); // 목에 두른 것
    sparkle(g, [[hx - 7, hy + 4]], i, glow);
  },

  // 구름 — 비를 내린다. 커지는 게 아니라 날씨가 된다.
  nimbus(k) {
    const { g, hx, hy, hw, glow, i, stage } = k;
    // 덩어리를 둘 더 얹었더니 머리가 두 배가 됐다. 하나만, 작게.
    rect(g, hx + hw - 5, hy - 7, 7, 5, "#ffffff");
    if (stage < 3) return;
    for (let n = 0; n < 6; n++) {
      const px = hx - 4 + n * 5;
      const py = hy + 12 + ((i + n) % 4) * 4;
      rect(g, px, py, 1, 3, glow); // 빗줄기
    }
    // 번개 — 지그재그 한 줄. 사각형 둘은 번개가 아니라 블록이다.
    if (i % 2 === 0) {
      const bx = hx + 4;
      rect(g, bx + 2, hy - 12, 2, 3, "#ffe066");
      rect(g, bx, hy - 9, 2, 3, "#ffe066");
      rect(g, bx + 2, hy - 6, 2, 3, "#ffe066");
    }
  },

  // 복숭아 — 익는다. 잎이 늘고 꽃이 핀다.
  momo(k) {
    const { g, hx, hy, hw, cx, glow, i, stage } = k;
    rect(g, cx + 2, hy - 8, 6, 3, "#7fc48d"); // 잎이 커진다
    rect(g, cx - 8, hy - 7, 5, 3, "#7fc48d");
    if (stage < 3) return;
    const petals = [[cx - 10, hy - 10], [cx + 9, hy - 12], [cx - 2, hy - 15]];
    petals.forEach(([px, py], n) => {
      const on = (i + n) % 3 === 0;
      rect(g, px, py, 3, 3, on ? "#ffd0e0" : glow); // 꽃
      put(g, px + 1, py + 1, "#ffe066");
    });
    sparkle(g, [[hx - 6, hy + 10], [hx + hw + 4, hy + 8]], i, glow);
  },

  // 커피 — 진해진다. 김이 굵어지고 잔이 커진다.
  mocha(k) {
    const { g, hx, hy, hw, glow, i, stage } = k;
    rect(g, hx - 2, hy - 9, hw + 4, 3, "#f6f1e8"); // 잔 테두리가 두꺼워진다
    rect(g, hx - 5, hy - 6, 3, 5, "#f6f1e8"); // 손잡이가 커진다
    if (stage < 3) return;
    for (let k2 = 0; k2 < 4; k2++) {
      const sx = hx + 2 + k2 * 5 + ((i + k2) % 3);
      rect(g, sx, hy - 20 - k2, 2, 8, "#ffffff55"); // 김이 높이 오른다
    }
    rect(g, hx + 2, hy - 12, hw - 4, 2, glow); // 크레마
    sparkle(g, [[hx - 6, hy + 6]], i, glow, "#fff3c4");
  },
};

/** 한 프레임을 세밀한 격자로 완성한다. */
function fineFrame(h, stage, row, i) {
  const base = frameOf(h, row, i);
  const g = upscale(base);
  // 몸이 얼마나 흔들렸는지는 굵은 격자에서 정해졌다. 여기서는 대략만 맞춘다.
  const dy = row === "sleep" ? 3 : 0;
  evolve(g, h, stage, row, i, dy);
  return g;
}

/* ── 굽기 ─────────────────────────────────────────────────── */

const index = [];
for (const h of CAST) {
  const sheets = STAGES.map(({ stage, from }) => {
    const png = bakeSheet({
      rows: ROWS,
      cols: COLS,
      gw: FG,
      gh: FGH,
      scale: S,
      frame: (row, i) => fineFrame(h, stage, row, i),
    });
    const id = stage === 1 ? h.id : `${h.id}-${stage}`;
    writeSheet(OUT, id, png);
    console.log(`${id}.png  ${FG * S * COLS}×${FGH * S * ROWS.length}  Lv.${from}~`);
    return { from, sheet: `pets/${id}.png` };
  });
  index.push({ id: h.id, name: h.name, hint: h.hint, sheet: sheets[0].sheet, stages: sheets });
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
