/**
 * 큐레이터 산출물 검증 테스트.
 *
 * 모델이 준 것을 그대로 파일로 만들면 안 된다. 실제로 겪은 것만 적어 두면:
 * Haiku 는 코드펜스로 감싸 왔고, 지어낸 `type` 을 넣었고, 기억으로 남기지 말라고
 * 한 것(커밋 로그를 보면 아는 것)을 남겼다. 앞의 둘은 코드로 막을 수 있고
 * 마지막 하나는 프롬프트와 모델의 몫이다 — 그래서 막을 수 있는 것은 여기서 막는다.
 */

import { test } from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const { extractJson, validate, buildPayload } = require("../src/curator.js");

test("코드펜스로 감싸 와도 읽는다", () => {
  const got = extractJson('```json\n{"lines":[{"when":"waiting","text":"안녕"}]}\n```');
  assert.equal(got.lines[0].text, "안녕");
});

test("앞뒤에 잡말이 붙어 와도 읽는다", () => {
  const got = extractJson('네, 정리했습니다:\n{"lines":[]}\n도움이 되었길 바랍니다.');
  assert.deepEqual(got.lines, []);
});

test("JSON 이 아니면 조용히 포기한다", () => {
  assert.equal(extractJson("죄송하지만 판단할 자료가 부족합니다."), null);
  assert.deepEqual(validate(null), { lines: [], memories: [], rejected: [] });
});

test("지어낸 when 과 type 은 기본값으로 눌러 담는다", () => {
  const got = validate({
    lines: [{ when: "축하해야할때", text: "좋아" }],
    memories: [{ name: "a", type: "insight", body: "몸" }],
  });
  assert.equal(got.lines[0].when, "waiting");
  assert.equal(got.memories[0].metadata.type, "project", "네 가지 밖의 type 은 받지 않는다");
});

test("이름은 파일로 쓸 수 있는 모양으로 눌러 담는다", () => {
  const got = validate({ memories: [{ name: "Polling 은 62ms → 0.04ms!", body: "몸" }] });
  assert.equal(got.memories[0].name, "polling-62ms-0-04ms");
});

test("본문이 없는 기억은 버린다", () => {
  const got = validate({ memories: [{ name: "a", body: "  " }, { name: "b", body: "실체" }] });
  assert.equal(got.memories.length, 1);
  assert.equal(got.memories[0].name, "b");
});

test("말이 길면 자른다", () => {
  const got = validate({ lines: [{ when: "waiting", text: "가".repeat(400) }] });
  assert.ok(got.lines[0].text.length <= 160, "말풍선이 문서가 되면 안 읽는다");
});

test("대체 대상도 같은 규칙으로 이름을 맞춘다", () => {
  const got = validate({ memories: [{ name: "b", body: "몸", supersedes: ["Uses NPM", ""] }] });
  assert.deepEqual(got.memories[0].metadata.supersedes, ["uses-npm"], "빈 것은 빼고 슬러그로");
});

test("보내는 자료에는 준 것만 들어간다", () => {
  const p = buildPayload({
    prompts: ["최적화 전부 적용하자"],
    done: ["폴링 62ms → 0.04ms"],
    known: ["claude-pet-no-image-deps"],
    rejected: [{ name: "readme-updated", reason: "git 이력을 보면 안다" }],
  });
  assert.match(p, /최적화 전부 적용하자/);
  assert.match(p, /claude-pet-no-image-deps/, "이미 아는 기억을 알려야 또 뽑지 않는다");
  assert.match(p, /git 이력을 보면 안다/, "지난 거부 이유도 같이 보낸다");
  assert.equal(/최근에 한 말/.test(p), false, "빈 항목은 아예 안 보낸다 — 보내는 양이 비용이다");
});
