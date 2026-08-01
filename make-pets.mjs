/**
 * 우리 캐릭터 스프라이트 시트를 만든다.
 *
 * 규격은 codex-pets 팩과 같다 — 셀 192×208, 열은 프레임, 행은 상태. 그래야 팩이
 * 하나도 안 깔린 사람도 같은 코드로 같은 애니메이션을 본다.
 *
 * 그림은 24×26 격자에 찍고 8배로 키운다. 픽셀 게임의 인상은 해상도가 아니라
 * **한 칸이 크게 보이는 것**에서 온다. 좌표는 전부 정수다 — 반 칸이 생기는 순간
 * 픽셀아트가 아니라 흐릿한 그림이 된다.
 *
 *   node make-pets.mjs
 *
 * 결과: renderer/pets/<id>.png
 */

import fs from "node:fs";
import path from "node:path";
import zlib from "node:zlib";
import { fileURLToPath } from "node:url";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const OUT = path.join(HERE, "renderer", "pets");

const G = 24; // 격자 가로
const GH = 26; // 격자 세로
const S = 8; // 배율 → 192×208
const COLS = 6;
const ROWS = 9;

/* ── 캔버스 ─────────────────────────────────────────────── */

function grid() {
  return Array.from({ length: GH }, () => Array(G).fill(null));
}

const put = (g, x, y, c) => {
  if (c && x >= 0 && y >= 0 && x < G && y < GH) g[y][x] = c;
};
const rect = (g, x, y, w, h, c) => {
  for (let j = 0; j < h; j++) for (let i = 0; i < w; i++) put(g, x + i, y + j, c);
};

/* ── 색 ────────────────────────────────────────────────────
   한 캐릭터에 네 톤만 쓴다: 본체·밝은 면·그늘·외곽선. 톤이 늘수록 축소했을 때
   뭉개지고, 무엇보다 **캐릭터로 안 읽힌다.** 게임 스프라이트가 선명한 이유다. */

const INK = "#20161c";
const WHITE = "#f6f1e8";
const EYE = "#20161c";

/* ── 종족별 실루엣 ──────────────────────────────────────────
   몸을 함수로 둔다. 손으로 24×26 를 종족마다 아홉 번씩 그리면 캐릭터마다
   비율이 달라져서 한 가족처럼 안 보인다. */

/** 둥근 덩어리 — 슬라임. */
function blobMask(x, y) {
  const dx = (x - 11.5) / 8.2;
  const dy = (y - 15) / 6.4;
  return dx * dx + dy * dy <= 1;
}
/** 네모난 몸통 — 로봇. */
function botMask(x, y) {
  return x >= 5 && x <= 18 && y >= 9 && y <= 20;
}
/** 아래가 흔들리는 몸 — 유령. */
function ghostMask(x, y) {
  const dx = (x - 11.5) / 7.4;
  const dy = (y - 13) / 6.2;
  if (y <= 15) return dx * dx + dy * dy <= 1;
  if (y > 21) return false;
  return x >= 4 && x <= 19 && (x + (y % 2 ? 1 : 0)) % 4 !== 0;
}
/** 위가 뾰족한 몸 — 불씨. 물방울을 뒤집은 모양이라야 불로 읽힌다. */
function flameMask(x, y) {
  if (y < 4 || y > 21) return false;
  // 위는 뾰족하게 좁히고 아래는 둥글게 부풀린다. 위아래 폭이 비슷하면
  // 오각형 집처럼 보인다 — 실제로 그렇게 나왔다.
  const t = (y - 4) / 17;
  const w = 1.2 + 7.4 * Math.sqrt(t) - 2.2 * t * t;
  const wob = y > 6 && y < 12 ? (y % 3 === 0 ? -0.8 : 0) : 0;
  return Math.abs(x - 11.5) <= w + wob;
}
/** 씨앗 몸 — 새싹. */
function seedMask(x, y) {
  const dx = (x - 11.5) / 6.6;
  const dy = (y - 16) / 6.0;
  return dx * dx + dy * dy <= 1;
}

/* ── 캐릭터 정의 ─────────────────────────────────────────── */

const CAST = [
  {
    id: "blip",
    name: "Blip",
    hint: "말랑한 슬라임. 기본값.",
    mask: blobMask,
    body: "#4fbf7a",
    lit: "#83e3a6",
    dim: "#2f8f56",
    eyes: [[8, 13], [15, 13]],
    legs: [7, 12, 16],
  },
  {
    id: "cog",
    name: "Cog",
    hint: "네모난 작은 로봇.",
    mask: botMask,
    body: "#6f8bd6",
    lit: "#a8bdf0",
    dim: "#41579c",
    eyes: [[8, 13], [15, 13]],
    legs: [7, 16],
    antenna: true,
  },
  {
    id: "wisp",
    name: "Wisp",
    hint: "떠다니는 유령. 다리가 없다.",
    mask: ghostMask,
    body: "#b3a4e6",
    lit: "#dcd3ff",
    dim: "#7d6ab5",
    eyes: [[8, 12], [15, 12]],
    legs: [],
    float: true,
  },
  {
    id: "ember",
    name: "Ember",
    hint: "위가 뾰족한 불씨.",
    mask: flameMask,
    body: "#f0682e",
    lit: "#ffc24d",
    dim: "#a83714",
    eyes: [[9, 16], [14, 16]],
    legs: [9, 14],
  },
  {
    id: "sprout",
    name: "Sprout",
    hint: "잎이 달린 씨앗.",
    mask: seedMask,
    body: "#c8a06a",
    lit: "#e8c894",
    dim: "#8e6a3e",
    eyes: [[9, 15], [14, 15]],
    legs: [8, 15],
    leaf: true,
  },
];

/* ── 몸 그리기 ─────────────────────────────────────────────
   빛은 늘 왼쪽 위에서 온다. 프레임마다 광원이 돌면 덩어리가 흔들려 보인다. */

function drawBody(g, ch, { dy = 0, squash = 0, lean = 0 } = {}) {
  for (let y = 0; y < GH; y++) {
    for (let x = 0; x < G; x++) {
      // 눌림과 기울임은 좌표를 비틀어 만든다. 프레임마다 실루엣을 새로 그리면
      // 같은 캐릭터로 안 보인다.
      const sy = y - dy + (squash ? Math.round((y - 15) * squash) : 0);
      const sx = x - Math.round(lean * (15 - y) * 0.25);
      if (!ch.mask(sx, sy)) continue;
      const edge =
        !ch.mask(sx - 1, sy) || !ch.mask(sx + 1, sy) || !ch.mask(sx, sy - 1) || !ch.mask(sx, sy + 1);
      if (edge) put(g, x, y, INK);
      else if (ch.mask(sx - 2, sy - 2) === false) put(g, x, y, ch.lit);
      else if (!ch.mask(sx + 2, sy + 2)) put(g, x, y, ch.dim);
      else put(g, x, y, ch.body);
    }
  }
}

function drawEyes(g, ch, { dy = 0, closed = false, wide = false } = {}) {
  for (const [ex, ey] of ch.eyes) {
    const y = ey + dy;
    if (closed) {
      rect(g, ex - 1, y + 1, 3, 1, INK);
      continue;
    }
    rect(g, ex - 1, y - 1, 3, 3, WHITE);
    rect(g, ex, y, wide ? 2 : 1, wide ? 2 : 1, EYE);
  }
}

/**
 * 몸의 위·아래 끝.
 *
 * 소품 좌표를 상수로 박았더니 모자가 머리 위에 붕 뜨고 다리는 몸에 묻혔다.
 * 종족마다 실루엣이 다르니 **기준점을 몸에서 가져온다.**
 */
function topOf(ch, dy) {
  for (let y = 0; y < GH; y++) for (let x = 0; x < G; x++) if (ch.mask(x, y)) return y + dy;
  return 8;
}
function bottomOf(ch, dy) {
  for (let y = GH - 1; y >= 0; y--) for (let x = 0; x < G; x++) if (ch.mask(x, y)) return y + dy;
  return 20;
}

function drawLegs(g, ch, phase, dy = 0) {
  if (!ch.legs.length) return;
  // 다리는 몸 아래 한 줄에서 함께 시작한다. 기둥마다 따로 재면 둥근 몸에서는
  // 바깥 다리가 몸 속에 박혀서 가운데 하나만 튀어나온 것처럼 보인다.
  const y = bottomOf(ch, dy) - 1;
  ch.legs.forEach((lx, i) => {
    const up = (phase + i) % 2 === 0;
    // 짧은 쪽도 몸 밖으로 나와야 한다. 둥근 몸에서는 2칸이면 실루엣에 먹혀서
    // 가운데 다리 하나만 남은 것처럼 보인다.
    const len = up ? 3 : 5;
    rect(g, lx, y, 2, len, ch.dim);
    rect(g, lx - 1, y + len, 4, 1, INK); // 발 — 이게 있어야 서 있는 것처럼 보인다
  });
}

/** 종족을 한눈에 가르는 것. 모자가 없는 행에서는 늘 보인다. */
function crown(g, ch, dy, i) {
  if (ch.leaf) leaf(g, ch, dy);
  if (ch.antenna) antenna(g, ch, dy, i);
  if (ch.float) tail(g, ch, dy, i);
  if (ch.id === "ember") sparks(g, ch, dy, i);
}

/** 유령의 아랫자락. 프레임마다 흔들린다. */
function tail(g, ch, dy, i) {
  for (let x = 4; x <= 19; x++) {
    const on = (x + i) % 4 < 2;
    if (on) put(g, x, 21 + dy, ch.dim);
    put(g, x, 22 + dy - (on ? 0 : 1), INK);
  }
}

/** 불씨가 튄다. */
function sparks(g, ch, dy, i) {
  const t = topOf(ch, dy) - 4;
  const at = [
    [7, 4],
    [16, 3],
    [12, 2],
  ][i % 3];
  put(g, at[0], t + at[1], "#ffbd77");
  put(g, at[0] + 1, t + at[1] + 1, "#ffe066");
}

/* ── 소품 ──────────────────────────────────────────────────
   행마다 뜻을 만드는 것은 자세가 아니라 **소품**이다. 헤드폰이 보이면 듣는 중,
   돋보기가 보이면 찾는 중 — 자세만으로는 그 차이가 안 읽힌다. */

function headphones(g, ch, dy) {
  const y = topOf(ch, dy) + 2;
  rect(g, 6, y + 1, 2, 4, "#3d63c8");
  rect(g, 16, y + 1, 2, 4, "#3d63c8");
  rect(g, 5, y + 1, 1, 4, INK);
  rect(g, 18, y + 1, 1, 4, INK);
  for (let x = 7; x <= 16; x++) put(g, x, y - (x > 9 && x < 14 ? 1 : 0), INK);
}

function hardHat(g, ch, dy) {
  const y = topOf(ch, dy) - 1;
  rect(g, 6, y + 2, 12, 1, "#c98f1c");
  rect(g, 7, y, 10, 2, "#e8b53a");
  rect(g, 7, y - 1, 10, 1, INK);
  rect(g, 6, y + 3, 12, 1, INK);
}

function wrench(g, ch, dy, swing) {
  const x = 18;
  const y = topOf(ch, dy) + 4 + swing;
  rect(g, x, y, 2, 5, "#b9c2cf");
  rect(g, x - 1, y - 2, 4, 2, "#dfe6f0");
  put(g, x, y - 1, INK);
  put(g, x + 1, y - 1, INK);
  rect(g, x - 1, y + 5, 4, 1, INK);
}

function bulb(g, ch, dy, on) {
  const x = 18;
  const y = topOf(ch, dy) - 4;
  rect(g, x, y, 3, 3, on ? "#ffe066" : "#7a7360");
  rect(g, x, y + 3, 3, 1, "#9aa0ab");
  rect(g, x - 1, y, 1, 3, INK);
  rect(g, x + 3, y, 1, 3, INK);
  rect(g, x, y - 1, 3, 1, INK);
  if (on) {
    put(g, x - 2, y - 2, "#ffe066");
    put(g, x + 4, y - 2, "#ffe066");
    put(g, x + 1, y - 3, "#ffe066");
  }
}

function zzz(g, i) {
  const spots = [
    [18, 6],
    [20, 4],
    [21, 2],
  ];
  const [x, y] = spots[i % spots.length];
  rect(g, x, y, 3, 1, WHITE);
  put(g, x + 2, y + 1, WHITE);
  put(g, x, y + 2, WHITE);
  rect(g, x, y + 2, 3, 1, WHITE);
}

function magnifier(g, ch, dy, i) {
  const x = 17 + (i % 2);
  const y = topOf(ch, dy) + 5;
  rect(g, x, y, 5, 1, INK);
  rect(g, x, y + 4, 5, 1, INK);
  rect(g, x - 1, y + 1, 1, 3, INK);
  rect(g, x + 5, y + 1, 1, 3, INK);
  rect(g, x + 1, y + 1, 3, 3, "#8fc7ff");
  rect(g, x + 4, y + 5, 2, 2, "#7a5a3a");
}

function detectiveHat(g, ch, dy) {
  const y = topOf(ch, dy) - 1;
  rect(g, 5, y + 2, 14, 1, "#3a3340");
  rect(g, 7, y, 10, 2, "#4a4250");
  rect(g, 7, y - 1, 10, 1, INK);
  rect(g, 5, y + 3, 14, 1, INK);
}

function board(g, ch, dy) {
  const y = bottomOf(ch, dy) + 2;
  rect(g, 4, y, 16, 2, "#5b3a6e");
  rect(g, 4, y + 2, 16, 1, INK);
  rect(g, 6, y + 2, 2, 2, "#e8b53a");
  rect(g, 16, y + 2, 2, 2, "#e8b53a");
}

function speed(g, i) {
  for (let k = 0; k < 3; k++) {
    const y = 11 + k * 4;
    const len = 3 + ((i + k) % 3);
    rect(g, 1 - (i % 2), y, len, 1, "#f6f1e8aa");
  }
}

function leaf(g, ch, dy) {
  const t = topOf(ch, dy) - 4;
  rect(g, 11, t + 2, 2, 3, "#4a8f3e");
  rect(g, 13, t + 1, 3, 2, "#63bf52");
  rect(g, 13, t, 3, 1, INK);
  rect(g, 8, t + 2, 3, 2, "#63bf52");
  rect(g, 8, t + 1, 3, 1, INK);
}

function antenna(g, ch, dy, i) {
  const t = topOf(ch, dy) - 4;
  rect(g, 11, t + 1, 1, 4, "#8fa0c0");
  rect(g, 10, t - 1, 3, 2, i % 2 ? "#ff6b6b" : "#ffd166");
  rect(g, 10, t - 2, 3, 1, INK);
}

/* ── 행 ────────────────────────────────────────────────────
   순서는 codex-pets 팩과 맞춘다. 렌더러가 행 번호로 상태를 찾기 때문에,
   여기서 순서를 바꾸면 조용히 엉뚱한 캐릭터가 나온다. */

const ROWSPEC = [
  { id: "wait", frames: 6 },
  { id: "walk", frames: 6 },
  { id: "board", frames: 6 },
  { id: "fix", frames: 4 },
  { id: "think", frames: 5 },
  { id: "sleep", frames: 6 },
  { id: "answer", frames: 6 },
  { id: "ride", frames: 6 },
  { id: "look", frames: 6 },
];

function frame(ch, row, i) {
  const g = grid();
  const bob = [0, -1, -1, 0, 1, 1][i % 6];
  const floaty = ch.float ? bob - 1 : 0;

  switch (row) {
    case "wait": {
      const dy = bob + floaty;
      drawBody(g, ch, { dy });
      drawLegs(g, ch, 0, dy);
      drawEyes(g, ch, { dy, closed: i === 3 });
      headphones(g, ch, dy);
      break;
    }
    case "walk": {
      const dy = i % 2 ? -1 : 0;
      drawBody(g, ch, { dy });
      drawLegs(g, ch, i, dy);
      drawEyes(g, ch, { dy });
      crown(g, ch, dy, i);
      break;
    }
    case "board":
    case "ride": {
      const dy = -2 + (i % 2 ? -1 : 0);
      board(g, ch, dy);
      drawBody(g, ch, { dy, lean: 1 });
      drawLegs(g, ch, 0, dy + 1);
      drawEyes(g, ch, { dy, wide: true });
      speed(g, i);
      break;
    }
    case "fix": {
      const dy = i % 2 ? -1 : 0;
      drawBody(g, ch, { dy });
      drawLegs(g, ch, 0, dy);
      drawEyes(g, ch, { dy });
      hardHat(g, ch, dy);
      wrench(g, ch, dy, i < 2 ? 0 : 2);
      break;
    }
    case "think": {
      const dy = bob;
      drawBody(g, ch, { dy, squash: i === 2 ? 0.08 : 0 });
      drawLegs(g, ch, 0, dy);
      drawEyes(g, ch, { dy, closed: i === 1 });
      crown(g, ch, dy, i);
      bulb(g, ch, dy, i >= 3);
      break;
    }
    case "sleep": {
      const dy = 2 + (i < 3 ? 0 : 1);
      drawBody(g, ch, { dy, squash: 0.12 });
      drawEyes(g, ch, { dy, closed: true });
      crown(g, ch, dy, i);
      zzz(g, Math.floor(i / 2));
      break;
    }
    case "answer": {
      const dy = i % 2 ? -2 : 0;
      drawBody(g, ch, { dy, lean: 0.6 });
      drawLegs(g, ch, i, dy);
      drawEyes(g, ch, { dy, wide: true });
      crown(g, ch, dy, i);
      speed(g, i);
      break;
    }
    case "look": {
      const dy = bob;
      drawBody(g, ch, { dy });
      drawLegs(g, ch, 0, dy);
      drawEyes(g, ch, { dy, wide: i % 3 === 0 });
      detectiveHat(g, ch, dy);
      magnifier(g, ch, dy, i);
      break;
    }
    default:
      drawBody(g, ch, {});
  }
  return g;
}

/* ── PNG ───────────────────────────────────────────────────
   의존성 없이 쓴다. 시트 하나 만들자고 이미지 라이브러리를 받아 오면, 이 저장소를
   클론한 사람이 그림 하나 고치려고 설치부터 해야 한다. */

const CRC = (() => {
  const t = new Int32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c;
  }
  return (buf) => {
    let c = -1;
    for (const b of buf) c = t[(c ^ b) & 255] ^ (c >>> 8);
    return (c ^ -1) >>> 0;
  };
})();

function chunk(type, data) {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length);
  const body = Buffer.concat([Buffer.from(type, "ascii"), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(CRC(body));
  return Buffer.concat([len, body, crc]);
}

function png(w, h, rgba) {
  const stride = w * 4;
  const raw = Buffer.alloc(h * (stride + 1));
  for (let y = 0; y < h; y++) {
    raw[y * (stride + 1)] = 0;
    rgba.copy(raw, y * (stride + 1) + 1, y * stride, (y + 1) * stride);
  }
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(w, 0);
  ihdr.writeUInt32BE(h, 4);
  ihdr[8] = 8;
  ihdr[9] = 6;
  return Buffer.concat([
    Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
    chunk("IHDR", ihdr),
    chunk("IDAT", zlib.deflateSync(raw, { level: 9 })),
    chunk("IEND", Buffer.alloc(0)),
  ]);
}

const hex = (c) => {
  const s = c.replace("#", "");
  const n = parseInt(s.slice(0, 6), 16);
  const a = s.length > 6 ? parseInt(s.slice(6, 8), 16) : 255;
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255, a];
};

function sheet(ch) {
  const w = G * S * COLS;
  const h = GH * S * ROWS;
  const buf = Buffer.alloc(w * h * 4);
  ROWSPEC.forEach((spec, r) => {
    for (let i = 0; i < spec.frames; i++) {
      const g = frame(ch, spec.id, i);
      for (let y = 0; y < GH; y++) {
        for (let x = 0; x < G; x++) {
          const c = g[y][x];
          if (!c) continue;
          const [R, Gc, B, A] = hex(c);
          for (let sy = 0; sy < S; sy++) {
            for (let sx = 0; sx < S; sx++) {
              const px = i * G * S + x * S + sx;
              const py = r * GH * S + y * S + sy;
              const o = (py * w + px) * 4;
              buf[o] = R;
              buf[o + 1] = Gc;
              buf[o + 2] = B;
              buf[o + 3] = A;
            }
          }
        }
      }
    }
  });
  return png(w, h, buf);
}

fs.mkdirSync(OUT, { recursive: true });
const index = [];
for (const ch of CAST) {
  fs.writeFileSync(path.join(OUT, `${ch.id}.png`), sheet(ch));
  index.push({ id: ch.id, name: ch.name, hint: ch.hint, sheet: `pets/${ch.id}.png` });
  console.log(`${ch.id}.png  ${G * S * COLS}×${GH * S * ROWS}`);
}
fs.writeFileSync(path.join(OUT, "index.json"), JSON.stringify(index, null, 2) + "\n");
console.log(`index.json  ${index.length}종`);
