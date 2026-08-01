/**
 * GIF89a 인코더.
 *
 * README 에 캐릭터가 가만히 서 있는 그림만 올리면, 이 앱이 무엇을 하는지가
 * 전달되지 않는다 — 움직이는 것이 요점이기 때문이다. 그래서 굽는다.
 *
 * 라이브러리는 안 쓴다. 이 저장소에 이미지 의존성이 하나도 없다는 점이
 * `npm run assets` 를 누구나 바로 돌릴 수 있게 해 주는데, 문서 그림 하나 때문에
 * 그걸 깨는 것은 값이 안 맞는다.
 *
 * 색은 팔레트로 모은다. 우리 그림은 캐릭터마다 대여섯 색이라 256 안에 넉넉히
 * 들어간다 — 안 들어가면 그건 색을 너무 쓴 것이지 GIF 의 잘못이 아니다.
 */

/** LSB 부터 채우는 비트 스트림. GIF 의 코드 배치가 그렇다. */
class BitWriter {
  constructor() {
    this.bytes = [];
    this.acc = 0;
    this.n = 0;
  }
  write(code, len) {
    this.acc |= code << this.n;
    this.n += len;
    while (this.n >= 8) {
      this.bytes.push(this.acc & 255);
      this.acc >>= 8;
      this.n -= 8;
    }
  }
  flush() {
    if (this.n > 0) {
      this.bytes.push(this.acc & 255);
      this.acc = 0;
      this.n = 0;
    }
    return this.bytes;
  }
}

function lzw(indices, minCodeSize) {
  const clear = 1 << minCodeSize;
  const end = clear + 1;
  const out = new BitWriter();
  let dict = new Map();
  let next = end + 1;
  let size = minCodeSize + 1;

  const reset = () => {
    dict = new Map();
    next = end + 1;
    size = minCodeSize + 1;
  };

  out.write(clear, size);
  reset();

  let prev = String(indices[0]);
  for (let i = 1; i < indices.length; i++) {
    const k = indices[i];
    const cand = prev + "," + k;
    if (dict.has(cand)) {
      prev = cand;
      continue;
    }
    out.write(dict.has(prev) ? dict.get(prev) : Number(prev), size);
    dict.set(cand, next++);
    if (next === (1 << size) + 1 && size < 12) size++;
    else if (next > 4095) {
      out.write(clear, size);
      reset();
    }
    prev = String(k);
  }
  out.write(dict.has(prev) ? dict.get(prev) : Number(prev), size);
  out.write(end, size);
  return out.flush();
}

const byte = (n) => n & 255;
const short = (n) => [n & 255, (n >> 8) & 255];

function blocks(bytes) {
  const out = [];
  for (let i = 0; i < bytes.length; i += 255) {
    const chunk = bytes.slice(i, i + 255);
    out.push(chunk.length, ...chunk);
  }
  out.push(0);
  return out;
}

/**
 * @param frames RGBA 버퍼 배열. 전부 같은 크기.
 * @param delayMs 프레임 간격
 */
export function encodeGif(frames, w, h, delayMs) {
  // 팔레트 — 투명은 0번을 비워 둔다.
  const key = (r, g, b) => (r << 16) | (g << 8) | b;
  const seen = new Map();
  const palette = [[0, 0, 0]];
  for (const f of frames) {
    for (let i = 0; i < w * h; i++) {
      if (f[i * 4 + 3] < 128) continue;
      const k = key(f[i * 4], f[i * 4 + 1], f[i * 4 + 2]);
      if (seen.has(k)) continue;
      seen.set(k, palette.length);
      palette.push([f[i * 4], f[i * 4 + 1], f[i * 4 + 2]]);
    }
  }
  if (palette.length > 256) throw new Error(`색이 ${palette.length}가지다 — GIF 팔레트는 256까지`);

  let bits = 1;
  while (1 << bits < palette.length) bits++;
  bits = Math.max(2, bits);
  const size = 1 << bits;

  const out = [];
  out.push(...[0x47, 0x49, 0x46, 0x38, 0x39, 0x61]); // GIF89a
  out.push(...short(w), ...short(h));
  out.push(0xf0 | (bits - 1), 0, 0); // 전역 팔레트 사용
  for (let i = 0; i < size; i++) {
    const [r, g, b] = palette[i] || [0, 0, 0];
    out.push(byte(r), byte(g), byte(b));
  }
  // 무한 반복
  out.push(0x21, 0xff, 11, ...[..."NETSCAPE2.0"].map((c) => c.charCodeAt(0)), 3, 1, 0, 0, 0);

  const delay = Math.round(delayMs / 10);
  for (const f of frames) {
    // 폐기 방식 2 = 다음 프레임 전에 지운다. 투명 픽셀이 겹쳐 쌓이지 않게.
    out.push(0x21, 0xf9, 4, 0x09, ...short(delay), 0, 0);
    out.push(0x2c, ...short(0), ...short(0), ...short(w), ...short(h), 0);
    const idx = new Array(w * h);
    for (let i = 0; i < w * h; i++) {
      idx[i] = f[i * 4 + 3] < 128 ? 0 : seen.get(key(f[i * 4], f[i * 4 + 1], f[i * 4 + 2]));
    }
    out.push(bits);
    out.push(...blocks(lzw(idx, bits)));
  }
  out.push(0x3b);
  return Buffer.from(out);
}
