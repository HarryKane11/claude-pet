/**
 * 무기 픽셀 에셋.
 *
 * 검은 이미 있으므로(`garment-badge`) 나머지 셋만 만든다. 규칙은 배경 타일과 같다:
 * 정수 좌표, `currentColor`, 48 박스, `crispEdges`. 색은 CSS 가 정한다.
 */
import { writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const OUT = join(dirname(fileURLToPath(import.meta.url)), "renderer", "assets");
const px = (x, y, w, h) => `<rect x="${x}" y="${y}" width="${w}" height="${h}"/>`;
const svg = (body) =>
  `<svg xmlns="http://www.w3.org/2000/svg" version="1.1" viewBox="0 0 48 48" fill="currentColor" shape-rendering="crispEdges">${body}</svg>\n`;

/** 완드 — 손잡이와 끝의 보석. */
const wand = svg(
  [px(10, 30, 4, 8), px(13, 26, 4, 5), px(16, 22, 4, 5), px(19, 18, 4, 5),
   px(23, 12, 8, 8), px(25, 8, 4, 4), px(21, 10, 4, 4), px(29, 10, 4, 4)].join(""),
);

/** 활 — 활대와 시위, 화살. */
const bow = svg(
  [px(14, 8, 4, 4), px(11, 12, 3, 6), px(10, 18, 3, 12), px(11, 30, 3, 6), px(14, 36, 4, 4),
   px(17, 12, 2, 24),
   px(19, 22, 18, 3), px(34, 19, 3, 3), px(34, 26, 3, 3), px(37, 22, 4, 3)].join(""),
);

/** 망치 — 자루와 머리. */
const hammer = svg(
  [px(20, 30, 5, 12), px(22, 26, 5, 6),
   px(14, 10, 20, 12), px(11, 13, 3, 6), px(34, 13, 3, 6),
   px(17, 22, 14, 4)].join(""),
);

await writeFile(join(OUT, "weapon-wand.svg"), wand, "utf8");
await writeFile(join(OUT, "weapon-bow.svg"), bow, "utf8");
await writeFile(join(OUT, "weapon-hammer.svg"), hammer, "utf8");
console.log("weapons →", OUT);
