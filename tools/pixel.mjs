/**
 * 픽셀 시트 공용 도구.
 *
 * 격자에 찍고, 정수 배율로 키우고, PNG 로 쓴다. 이미지 라이브러리는 안 쓴다 —
 * 시트 하나 고치자고 저장소를 클론한 사람이 설치부터 하게 만들 이유가 없다.
 */

import fs from "node:fs";
import path from "node:path";
import zlib from "node:zlib";

export const INK = "#20161c";
export const WHITE = "#f6f1e8";

export function makeGrid(w, h) {
  return Array.from({ length: h }, () => Array(w).fill(null));
}

export function put(g, x, y, c) {
  if (!c) return;
  if (y < 0 || y >= g.length) return;
  if (x < 0 || x >= g[0].length) return;
  g[y][x] = c;
}

export function rect(g, x, y, w, h, c) {
  for (let j = 0; j < h; j++) for (let i = 0; i < w; i++) put(g, x + i, y + j, c);
}

/** 대각선 — 무기 자루와 속도선에 쓴다. */
export function line(g, x0, y0, dx, dy, len, c) {
  for (let i = 0; i < len; i++) put(g, x0 + dx * i, y0 + dy * i, c);
}

/** 채운 도형의 바깥 한 줄을 외곽선으로 두른다. 이게 있어야 배경에서 떨어져 나온다. */
export function outline(g, c = INK) {
  const h = g.length;
  const w = g[0].length;
  const edge = [];
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      if (g[y][x]) continue;
      const near =
        (y > 0 && g[y - 1][x] && g[y - 1][x] !== c) ||
        (y < h - 1 && g[y + 1][x] && g[y + 1][x] !== c) ||
        (x > 0 && g[y][x - 1] && g[y][x - 1] !== c) ||
        (x < w - 1 && g[y][x + 1] && g[y][x + 1] !== c);
      if (near) edge.push([x, y]);
    }
  }
  for (const [x, y] of edge) g[y][x] = c;
}

/* ── PNG ─────────────────────────────────────────────────── */

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

export function encodePng(w, h, rgba) {
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

/**
 * 격자들을 한 장의 아틀라스로 굽는다.
 *
 * `frame(rowId, i)` 가 격자를 돌려주면 열은 프레임, 행은 상태가 된다 —
 * codex-pets 팩과 같은 규격이라야 렌더러가 같은 코드로 읽는다.
 */
export function bakeSheet({ rows, cols, gw, gh, scale, frame }) {
  const w = gw * scale * cols;
  const h = gh * scale * rows.length;
  const buf = Buffer.alloc(w * h * 4);
  rows.forEach((spec, r) => {
    for (let i = 0; i < spec.frames; i++) {
      const g = frame(spec.id, i);
      for (let y = 0; y < gh; y++) {
        for (let x = 0; x < gw; x++) {
          const c = g[y][x];
          if (!c) continue;
          const [R, G, B, A] = hex(c);
          for (let sy = 0; sy < scale; sy++) {
            for (let sx = 0; sx < scale; sx++) {
              const o = ((r * gh * scale + y * scale + sy) * w + i * gw * scale + x * scale + sx) * 4;
              buf[o] = R;
              buf[o + 1] = G;
              buf[o + 2] = B;
              buf[o + 3] = A;
            }
          }
        }
      }
    }
  });
  return encodePng(w, h, buf);
}

export function writeSheet(dir, id, png) {
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, `${id}.png`), png);
}
