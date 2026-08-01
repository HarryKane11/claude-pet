/**
 * README 그림을 굽는다.
 *
 * 캐릭터가 가만히 서 있는 그림만 올리면 이 앱이 무엇인지가 전달되지 않는다 —
 * 움직이는 것이 요점이기 때문이다. 그래서 시트에서 프레임을 도로 꺼내
 * 애니메이션으로 만든다. 손으로 캡처하지 않는 이유는 하나다: 캐릭터를 고치면
 * 문서 그림도 같이 바뀌어야 하는데, 손으로 뜬 그림은 반드시 뒤처진다.
 *
 *   node make-readme-art.mjs
 *
 * 결과: docs/cast.gif · docs/states.gif · docs/lineup.png
 */

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { decodePng, blit, encodePng } from "./tools/pixel.mjs";
import { encodeGif } from "./tools/gif.mjs";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const PETS = path.join(HERE, "renderer", "pets");
const OUT = path.join(HERE, "docs");

const CELL_W = 192;
const CELL_H = 208;
const SHRINK = 2; // 96×104 — GitHub 에서 읽히는 크기
const W = CELL_W / SHRINK;
const H = CELL_H / SHRINK;
// 칸 사이 여백. 붙여 놓으면 옆 캐릭터의 모자와 이 캐릭터의 발이 맞닿아서
// 둘 다 잘린 것처럼 보인다 — 실제로 그렇게 나왔다.
const PAD = 10;
const TW = W + PAD;
const TH = H + PAD;

const canvas = (w, h) => ({ w, h, data: Buffer.alloc(w * h * 4) });
const sheetOf = (id) => decodePng(fs.readFileSync(path.join(PETS, `${id}.png`)));

/** 행마다 그려진 프레임이 몇 개인지. 없는 칸을 보여 주면 캐릭터가 사라진다. */
function framesIn(sheet, row) {
  let n = 1;
  for (let c = 0; c < Math.floor(sheet.w / CELL_W); c++) {
    let solid = 0;
    for (let y = row * CELL_H; y < (row + 1) * CELL_H; y += 4) {
      for (let x = c * CELL_W; x < (c + 1) * CELL_W; x += 4) {
        if (sheet.data[(y * sheet.w + x) * 4 + 3] > 8) solid++;
      }
    }
    if (solid > 8) n = c + 1;
    else break;
  }
  return n;
}

const CAST = JSON.parse(fs.readFileSync(path.join(PETS, "index.json"), "utf8"));

/* ── 1. 전원 정렬 — 각자 서 있는 동작을 돌린다 ─────────────── */

function castGif(ids, row, cols, file, delay = 190) {
  const sheets = ids.map(sheetOf);
  const counts = sheets.map((s) => framesIn(s, row));
  const rows = Math.ceil(ids.length / cols);
  // 캐릭터마다 프레임 수가 다르면 최소공배수만큼 돌아야 이음매가 안 보인다.
  // 넉넉히 두 바퀴 굽던 것을 고쳤다 — 똑같은 그림을 두 번 넣으면 파일만 두 배가 된다.
  const gcd = (a, b) => (b ? gcd(b, a % b) : a);
  const steps = Math.min(24, counts.reduce((a, b) => (a * b) / gcd(a, b), 1));

  const frames = [];
  for (let f = 0; f < steps; f++) {
    const c = canvas(cols * TW, rows * TH);
    sheets.forEach((s, k) => {
      const i = f % counts[k];
      blit(s, c, {
        sx: i * CELL_W,
        sy: row * CELL_H,
        sw: CELL_W,
        sh: CELL_H,
        dx: (k % cols) * TW + PAD / 2,
        dy: Math.floor(k / cols) * TH + PAD / 2,
        shrink: SHRINK,
      });
    });
    frames.push(c.data);
  }
  fs.writeFileSync(path.join(OUT, file), encodeGif(frames, cols * TW, rows * TH, delay));
  console.log(`${file}  ${cols * TW}×${rows * TH}  ${frames.length}프레임`);
}

/* ── 2. 상태별 — 한 캐릭터가 행을 옮겨 간다 ────────────────── */

const STATE_ROWS = [
  { row: 5, label: "waiting" },
  { row: 0, label: "thinking" },
  { row: 8, label: "searching" },
  { row: 7, label: "running" },
  { row: 3, label: "fixing" },
  { row: 6, label: "answering" },
];

function statesGif(ids, file, delay = 190) {
  const sheets = ids.map(sheetOf);
  const frames = [];
  for (const { row } of STATE_ROWS) {
    const counts = sheets.map((s) => framesIn(s, row));
    // 상태마다 한 바퀴씩. 너무 빨리 넘어가면 무슨 동작인지 못 읽는다.
    for (let f = 0; f < Math.max(...counts); f++) {
      const c = canvas(ids.length * TW, TH);
      sheets.forEach((s, k) => {
        blit(s, c, {
          sx: (f % counts[k]) * CELL_W,
          sy: row * CELL_H,
          sw: CELL_W,
          sh: CELL_H,
          dx: k * TW + PAD / 2,
          dy: PAD / 2,
          shrink: SHRINK,
        });
      });
      frames.push(c.data);
    }
  }
  fs.writeFileSync(path.join(OUT, file), encodeGif(frames, ids.length * TW, TH, delay));
  console.log(`${file}  ${ids.length * TW}×${TH}  ${frames.length}프레임`);
}

/* ── 3. 정지 그림 — GIF 가 안 도는 자리를 위해 ─────────────── */

function lineupPng(ids, cols, file) {
  const sheets = ids.map(sheetOf);
  const rows = Math.ceil(ids.length / cols);
  const c = canvas(cols * TW, rows * TH);
  sheets.forEach((s, k) => {
    blit(s, c, {
      sx: 0,
      sy: 0,
      sw: CELL_W,
      sh: CELL_H,
      dx: (k % cols) * TW + PAD / 2,
      dy: Math.floor(k / cols) * TH + PAD / 2,
      shrink: SHRINK,
    });
  });
  fs.writeFileSync(path.join(OUT, file), encodePng(c.w, c.h, c.data));
  console.log(`${file}  ${c.w}×${c.h}`);
}

fs.mkdirSync(OUT, { recursive: true });

const HEROES = ["rook", "vela", "fenn", "nyx", "pip"];
const FRIENDS = ["bunbun", "choco", "nimbus", "momo", "mocha"];
const CREATURES = ["blip", "cog", "wisp", "ember", "sprout"];

castGif([...HEROES, ...FRIENDS, ...CREATURES], 0, 5, "cast.gif");
castGif(HEROES, 1, 5, "heroes.gif");
castGif(FRIENDS, 1, 5, "friends.gif");
castGif(CREATURES, 1, 5, "creatures.gif");
statesGif(["rook", "bunbun", "mocha"], "states.gif", 220);
lineupPng([...HEROES, ...FRIENDS, ...CREATURES], 5, "lineup.png");

console.log(`캐릭터 ${CAST.length}종`);
