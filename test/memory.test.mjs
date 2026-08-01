/**
 * 기억 테스트.
 *
 * 이 코드는 사람의 파일을 고친다 — 승인하면 하네스가 다음 세션에 읽을 자리에
 * 쓰고, 낡은 사실은 물러나게 한다. 눈으로 봐서는 "색인만 남고 파일은 사라진"
 * 상태 같은 것을 못 찾는다.
 */

import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);

/**
 * 테스트마다 새 집을 준다.
 *
 * 경로는 `home.js` 가 **로드될 때 한 번** 정한다(실사용에서는 프로세스 하나라
 * 그게 맞다). 그래서 여기서는 그 모듈까지 캐시에서 지워야 새 집이 먹는다 —
 * 하나만 지웠다가 앞 테스트의 집을 그대로 쓰는 것을 겪었다.
 */
function freshHome() {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), "petmem-"));
  process.env.CLAUDE_PET_HOME = home;
  for (const m of ["../src/home.js", "../src/memory.js"]) delete require.cache[require.resolve(m)];
  const mem = require("../src/memory.js");
  fs.mkdirSync(mem.PENDING, { recursive: true });
  return { home, mem, target: fs.mkdtempSync(path.join(os.tmpdir(), "petproj-")) };
}

const candidate = (name, over = {}) => `---
name: ${name}
description: ${over.description || "설명 " + name}
metadata:
  node_type: memory
  type: ${over.type || "project"}
  originSessionId: sess-1
${over.supersedes ? `  supersedes: [${over.supersedes}]\n` : ""}---

${over.body || "본문 첫 문단이다.\n\n둘째 문단."}
`;

test("후보를 읽는다", () => {
  const { mem } = freshHome();
  fs.writeFileSync(path.join(mem.PENDING, "a.md"), candidate("a"));
  fs.writeFileSync(path.join(mem.PENDING, "b.md"), candidate("b"));
  const list = mem.pending();
  assert.equal(list.length, 2);
  assert.equal(list[0].name, "a");
  assert.equal(list[0].metadata.type, "project");
});

test("승인하면 하네스가 읽는 자리에 쓰고 색인에 한 줄 남긴다", () => {
  const { mem, target } = freshHome();
  fs.writeFileSync(path.join(mem.PENDING, "uses-pnpm.md"), candidate("uses-pnpm"));

  const r = mem.approve("uses-pnpm", target);
  assert.ok(fs.existsSync(r.path), "기억 파일이 있어야 한다");

  const written = fs.readFileSync(r.path, "utf8");
  assert.match(written, /^---\nname: uses-pnpm/, "하네스가 읽는 프론트매터 형식");
  assert.match(written, /node_type: memory/);
  assert.match(written, /observed: \d{4}-\d{2}-\d{2}/, "언제 관측했는지가 붙어야 한다");

  const index = fs.readFileSync(path.join(target, "MEMORY.md"), "utf8");
  assert.match(index, /\(uses-pnpm\.md\)/, "색인에 링크가 있어야 한다");
  assert.equal(mem.pending().length, 0, "승인한 후보는 대기열에서 빠진다");
});

test("같은 기억을 다시 승인해도 색인이 두 줄이 되지 않는다", () => {
  const { mem, target } = freshHome();
  for (let i = 0; i < 2; i++) {
    fs.writeFileSync(path.join(mem.PENDING, "x.md"), candidate("x", { description: `설명 ${i}` }));
    mem.approve("x", target);
  }
  const lines = fs
    .readFileSync(path.join(target, "MEMORY.md"), "utf8")
    .split("\n")
    .filter((l) => l.includes("(x.md)"));
  assert.equal(lines.length, 1, "갱신이지 추가가 아니다");
  assert.match(lines[0], /설명 1/, "최신 내용으로 갱신돼야 한다");
});

test("낡은 사실은 지우지 않고 물러나게 한다", () => {
  const { mem, target } = freshHome();
  fs.writeFileSync(path.join(mem.PENDING, "npm.md"), candidate("npm"));
  mem.approve("npm", target);

  fs.writeFileSync(path.join(mem.PENDING, "pnpm.md"), candidate("pnpm", { supersedes: "npm" }));
  const r = mem.approve("pnpm", target, { now: "2026-08-01" });

  assert.deepEqual(r.retired, ["npm"]);
  assert.equal(fs.existsSync(path.join(target, "npm.md")), false, "현역에서는 빠진다");

  const archived = fs.readFileSync(path.join(target, "archive", "npm.md"), "utf8");
  assert.match(archived, /valid_until: 2026-08-01/, "언제까지 참이었는지가 남아야 한다");
  assert.match(archived, /superseded_by: pnpm/);

  const index = fs.readFileSync(path.join(target, "MEMORY.md"), "utf8");
  assert.equal(index.includes("(npm.md)"), false, "색인에서도 내려야 한다");
  assert.ok(index.includes("(pnpm.md)"));
});

test("거부는 이유와 함께 남는다", () => {
  const { mem } = freshHome();
  fs.writeFileSync(path.join(mem.PENDING, "noise.md"), candidate("noise"));
  mem.reject("noise", "한 번뿐인 일이라 규칙이 아니다");

  assert.equal(mem.pending().length, 0);
  const log = fs.readFileSync(mem.REJECTED, "utf8").trim().split("\n").map(JSON.parse);
  assert.equal(log.length, 1);
  assert.equal(log[0].name, "noise");
  assert.match(log[0].reason, /한 번뿐/);
});

test("쓰인 기억이 안 쓰인 기억보다 위로 간다", () => {
  const { mem } = freshHome();
  const now = Date.parse("2026-08-01T00:00:00Z");
  mem.recordUse(["a", "a", "b"], { now });
  assert.ok(mem.rank("a", { now }) > mem.rank("b", { now }), "많이 쓰인 쪽이 위");
  assert.equal(mem.rank("never", { now }), 0, "한 번도 안 쓰인 것은 0");
});

test("오래 안 쓰인 기억은 무게가 준다", () => {
  const { mem } = freshHome();
  const now = Date.parse("2026-08-01T00:00:00Z");
  mem.recordUse(["old"], { now: now - 60 * 86400000 });
  const faded = mem.rank("old", { now });
  mem.recordUse(["fresh"], { now });
  assert.ok(mem.rank("fresh", { now }) > faded, "최근 것이 위로");
  assert.ok(faded > 0, "잊는 게 아니라 무게만 준다");
});

test("프론트매터를 넣었다 빼도 그대로다", () => {
  const { mem } = freshHome();
  const src = {
    name: "roundtrip",
    description: "왕복",
    metadata: { type: "feedback", supersedes: ["a", "b"], observed: "2026-08-01" },
    body: "본문.",
  };
  const back = mem.parse(mem.render(src));
  assert.equal(back.meta.name, "roundtrip");
  assert.equal(back.meta.metadata.type, "feedback");
  assert.deepEqual(back.meta.metadata.supersedes, ["a", "b"]);
  assert.equal(back.body, "본문.");
});
