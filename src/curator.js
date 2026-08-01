"use strict";

const fs = require("fs");
const os = require("os");
const path = require("path");
const { spawn } = require("child_process");
const memory = require("./memory");

/**
 * 큐레이터 — 하루 한두 번 지난 작업을 훑어 기억 후보와 할 말을 뽑는다.
 *
 * ── 왜 세션을 안 끄는가 ────────────────────────────────────
 *
 * 대화를 길게 이어 붙이면 기억처럼 보이지만 실은 **잊어버리는 기억**이다.
 * 컨텍스트가 차면 날아가고, 회전하는 순간 어제 일을 못 말한다. 그런데 우리가
 * 기억해야 할 것은 대화 맥락이 아니라 사실이고, 사실은 이미 파일에 있다.
 * 그래서 매번 새로 시작하고 **맥락은 이 코드가 조립한다.**
 *
 * ── 왜 시스템 프롬프트를 갈아 끼우는가 ─────────────────────
 *
 * 재 보고 정했다(정상 상태, Haiku 기준):
 *
 *   덧붙이기(--append-system-prompt)   26,018 토큰   $0.0177
 *   갈아 끼우기(--system-prompt)       19,522 토큰   $0.0037
 *
 * 인격만 바뀌는 게 아니라 **다섯 배 싸진다.** 코드 에이전트의 시스템 프롬프트를
 * 이고 다닐 이유가 없다 — 우리 펫은 코드를 고치지 않는다.
 *
 * ── 왜 도구를 끄는가 ──────────────────────────────────────
 *
 * 안전 때문만이 아니다. **무엇이 이 기계를 떠났는지 정확히 말할 수 있어야**
 * 프라이버시를 이야기할 수 있다. 자료는 우리가 조립해서 stdin 으로 주고,
 * 돌아온 JSON 을 우리가 검증해서 쓴다. 파일 쓰기를 맡기지 않는다.
 */

const HOME = process.env.KIBITZ_PET_HOME || path.join(os.homedir(), ".kibitz-pet");
const NOTES = path.join(HOME, "notes.json");
const STATE = path.join(HOME, "curator.json");

/**
 * 기억을 뽑는 것과 말을 짓는 것은 난이도가 다르다.
 *
 * 같은 자료로 두 모델을 돌려 봤다. Haiku 는 "폴링을 62ms → 0.04ms 로 줄였다" 를
 * 기억으로 남겼다 — 커밋 로그를 보면 아는 것이라 남기지 말라고 적어 둔 바로
 * 그것이다. Sonnet 은 그 둘을 정확히 그 이유로 거부하고, 대신 **코드에서 알 수
 * 없는 것**(사용자가 말한 설계 취향과 일하는 방식)을 남겼다.
 *
 * 무엇을 버릴지 아는 것이 이 일의 전부다. 하루 두 번에 월 $3 이면 값이 맞는다.
 */
const MODEL = process.env.KIBITZ_PET_MODEL || "claude-sonnet-5";

const SYSTEM = `너는 사람의 화면 구석에 떠 있는 작은 픽셀 캐릭터다. 코드 에이전트가 아니다 —
코드를 고치지도, 파일을 열지도 않는다. 옆에서 지켜본 것을 바탕으로 기억해 둘
사실을 고르고 말을 걸 문장을 준비하는 것이 전부다.

## 기억으로 남길 것

남긴다:
- 이 사람이 누구인가 — 역할, 익숙한 것, 쓰는 도구
- 하지 말라고 했거나 고쳐 준 것, 그리고 그 이유
- 코드나 git 이력에서 알 수 없는 사정 — 왜 그렇게 정했는지, 무엇을 못 하는지
- 다시 찾아갈 자리 — 대시보드, 티켓, 문서 주소

남기지 않는다:
- **코드나 커밋 로그를 보면 아는 것.** 무엇을 고쳤는지, 얼마나 빨라졌는지,
  어떤 파일을 만들었는지. 이것이 가장 흔한 실수다
- 이번 대화에서만 쓸 것
- 이미 CLAUDE.md 나 README 에 적힌 것
- 한 번뿐인 일. 두 번 이상 나타났거나 사람이 직접 말해 준 것만 사실로 본다

자동 추출이 망하는 방식은 틀린 것을 남기는 게 아니라 **아무거나 남기는 것**이다.
애매하면 남기지 말고 rejected 에 이유와 함께 적어라.

## 유효 기간

사실에는 수명이 있다. 기존 기억과 부딪히면 지우라고 하지 말고 supersedes 에
무엇을 대체하는지 적어라 — 언제까지 참이었는지도 정보다.

## 말

- 관측한 것에서만. "6시간째 같은 파일" 은 되고 "힘내" 는 안 된다
- 칭찬은 구체적인 것을 인용할 때만. "대단해요" 는 사흘이면 안 읽힌다
- 두 문장을 넘지 마라
- when 은 펫이 그 말을 꺼낼 자리다:
  waiting(답 다 쓰고 사람을 기다리는 중) · levelup · streak(오래 붙어 있을 때)
  · gear(새 스킬·플러그인) · deep(분신이 나가 있을 때) · long(요청이 길어질 때)
  · tool(도구를 쓰는 중) · idle(아무도 안 부를 때) · hello(오늘 처음)
- 자리마다 하나씩 준비해 두면 펫이 하루 종일 다르게 말한다

## 출력

JSON 하나만. 설명도 코드펜스도 없이.
{"lines":[{"when":"waiting","text":"..."}],
 "memories":[{"name":"kebab-case","description":"한 줄","type":"user|feedback|project|reference","body":"...","supersedes":[],"sources":[]}],
 "rejected":[{"name":"...","reason":"..."}]}`;

/* ── 산출물 검증 ───────────────────────────────────────────
   모델이 준 것을 그대로 파일로 만들지 않는다. 코드펜스로 감싸 오기도 하고,
   type 을 지어내기도 한다 — 실제로 둘 다 겪었다. */

const TYPES = new Set(["user", "feedback", "project", "reference"]);
/** 펫이 말을 꺼낼 수 있는 자리. nudges.js 의 트리거 종류와 같아야 한다 —
    여기 없는 `when` 으로 적어 두면 그 문장은 영영 안 나온다. */
const WHENS = ["waiting", "levelup", "streak", "gear", "deep", "long", "tool", "idle", "hello"];
const slug = (s) => String(s || "").toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");

/** 코드펜스와 앞뒤 잡말을 걷어내고 JSON 만 남긴다. */
function extractJson(text) {
  const s = String(text || "").trim();
  const fenced = /```(?:json)?\s*([\s\S]*?)```/.exec(s);
  const body = fenced ? fenced[1] : s;
  const start = body.indexOf("{");
  const end = body.lastIndexOf("}");
  if (start < 0 || end <= start) return null;
  try {
    return JSON.parse(body.slice(start, end + 1));
  } catch {
    return null;
  }
}

function validate(raw) {
  const out = { lines: [], memories: [], rejected: [] };
  if (!raw || typeof raw !== "object") return out;

  for (const l of Array.isArray(raw.lines) ? raw.lines : []) {
    if (!l || typeof l.text !== "string" || !l.text.trim()) continue;
    const when = WHENS.includes(l.when) ? l.when : "waiting";
    // 두 문장까지. 길면 말풍선이 아니라 문서가 된다.
    out.lines.push({ when, text: l.text.trim().slice(0, 160), expires: l.expires || null });
  }

  for (const m of Array.isArray(raw.memories) ? raw.memories : []) {
    if (!m || typeof m.body !== "string" || !m.body.trim()) continue;
    const name = slug(m.name || m.description);
    if (!name) continue;
    out.memories.push({
      name,
      description: String(m.description || "").trim(),
      metadata: {
        type: TYPES.has(m.type) ? m.type : "project",
        supersedes: [].concat(m.supersedes || []).map(slug).filter(Boolean),
        sources: [].concat(m.sources || []).map(String),
        confidence: typeof m.confidence === "number" ? m.confidence : undefined,
      },
      body: m.body.trim(),
    });
  }

  for (const r of Array.isArray(raw.rejected) ? raw.rejected : []) {
    if (!r || !r.name) continue;
    out.rejected.push({ name: slug(r.name), reason: String(r.reason || "") });
  }
  return out;
}

/* ── 자료 조립 ─────────────────────────────────────────────
   세션 파일을 통째로 보내지 않는다. 필요한 것은 사람이 시킨 말과 무엇이
   끝났는지지, 도구 출력 전부가 아니다 — 보내는 양이 곧 비용이고 노출이다. */

function buildPayload({ prompts = [], done = [], known = [], rejected = [], recentLines = [] }) {
  const section = (title, items) =>
    items.length ? `\n[${title}]\n${items.map((s) => `- ${s}`).join("\n")}` : "";
  return (
    "지난 회차 이후의 기록이다. 여기 있는 것만 보고 판단해라." +
    section("사람이 시킨 말", prompts.slice(-40)) +
    section("끝난 일", done.slice(-20)) +
    section("이미 있는 기억", known) +
    section("지난 회차 거부", rejected.map((r) => `${r.name} — ${r.reason}`)) +
    section("최근에 한 말", recentLines) +
    "\n"
  );
}

/* ── 실행 ─────────────────────────────────────────────────── */

function runClaude(payload, { model = MODEL, timeoutMs = 120_000 } = {}) {
  return new Promise((resolve) => {
    const args = [
      "-p",
      "--output-format", "json",
      "--allowedTools", "",
      "--strict-mcp-config",
      "--mcp-config", '{"mcpServers":{}}',
      "--setting-sources", "",
      "--model", model,
      "--system-prompt", SYSTEM,
      "--exclude-dynamic-system-prompt-sections",
    ];
    const child = spawn("claude", args, { stdio: ["pipe", "pipe", "ignore"] });
    let out = "";
    const timer = setTimeout(() => child.kill(), timeoutMs);
    child.stdout.on("data", (d) => (out += d));
    child.on("error", () => {
      clearTimeout(timer);
      resolve(null);
    });
    child.on("close", () => {
      clearTimeout(timer);
      try {
        const j = JSON.parse(out);
        resolve({ text: j.result, cost: j.total_cost_usd, model });
      } catch {
        resolve(null);
      }
    });
    child.stdin.end(payload);
  });
}

function loadState() {
  try {
    return JSON.parse(fs.readFileSync(STATE, "utf8"));
  } catch {
    return { lastRun: 0, cost: 0, runs: 0 };
  }
}

/**
 * 한 회차.
 *
 * 결과를 두 곳에 나눠 쓴다: 말은 `notes.json` 으로 가서 펫이 꺼내 쓰고, 기억은
 * 승인 대기열로 간다. 사람이 보지 않은 기억을 저장소에 넣지 않는 것은 규칙이다 —
 * 승인 없이 쌓인 기억은 자기 기억이 아니라 남의 기억이다.
 */
async function runOnce(material, { model = MODEL } = {}) {
  const res = await runClaude(buildPayload(material), { model });
  if (!res) return { ok: false, reason: "claude 를 실행하지 못했다" };

  const got = validate(extractJson(res.text));
  fs.mkdirSync(memory.PENDING, { recursive: true });
  for (const m of got.memories) {
    fs.writeFileSync(path.join(memory.PENDING, `${m.name}.md`), memory.render(m));
  }
  for (const r of got.rejected) memory.reject(r.name, r.reason);

  fs.mkdirSync(HOME, { recursive: true });
  fs.writeFileSync(
    NOTES,
    JSON.stringify({ version: 1, generatedAt: new Date().toISOString(), by: model, lines: got.lines }),
  );

  const st = loadState();
  fs.writeFileSync(
    STATE,
    JSON.stringify({ lastRun: Date.now(), runs: st.runs + 1, cost: st.cost + (res.cost || 0) }),
  );

  return { ok: true, lines: got.lines.length, memories: got.memories.length, cost: res.cost };
}

module.exports = { runOnce, buildPayload, validate, extractJson, SYSTEM, MODEL, NOTES, STATE };
