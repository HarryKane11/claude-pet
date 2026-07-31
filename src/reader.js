"use strict";

/**
 * 지금 돌고 있는 코드 에이전트를 세션 파일에서 읽는다.
 *
 * 의존성이 없다 — `node:fs` 만 쓴다. 펫은 kibitz 서버가 떠 있지 않아도 혼자 돌아야
 * 하고, 훅을 깔라고 요구해서도 안 된다. 그래서 웹의 `lib/live-agent.ts` 와 같은
 * 규칙을 여기에 순수 JS 로 한 벌 더 둔다. 두 벌이 되는 것은 알고 있고, 그 대신
 * **읽기 전용**이라 판정이 갈릴 여지가 없다 — 여기서 계산하는 것은 화면에 띄울
 * 현재 상태뿐이고, 트레이스는 만들지 않는다.
 */

const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { levelFor } = require("./level");

/**
 * 누적 토큰 저장소.
 *
 * 레벨은 **여태 쓴 전부**로 정해진다. 그래서 파일별 마지막 집계를 남겨 두고,
 * 펫을 껐다 켜도 처음부터 다시 세지 않는다. 파일별로 들고 있는 이유는 중복 계상을
 * 막기 위해서다 — 합계 하나만 저장하면 재시작 때 같은 파일을 또 더하게 된다.
 */
const PROGRESS = path.join(os.homedir(), ".kibitz-pet", "progress.json");

function loadProgress() {
  try {
    return JSON.parse(fs.readFileSync(PROGRESS, "utf8"));
  } catch {
    return { files: {} };
  }
}

let progress = loadProgress();
let progressDirty = false;

function saveProgress() {
  if (!progressDirty) return;
  try {
    fs.mkdirSync(path.dirname(PROGRESS), { recursive: true });
    // 반쯤 쓰인 파일을 읽는 일이 없게 임시 파일에 쓰고 옮긴다.
    const tmp = `${PROGRESS}.tmp`;
    fs.writeFileSync(tmp, JSON.stringify(progress));
    fs.renameSync(tmp, PROGRESS);
    progressDirty = false;
  } catch {
    /* 진행도를 못 남겨도 펫은 돌아야 한다 */
  }
}

/** 지금까지 쓴 전부. */
function totalTokens() {
  return Object.values(progress.files).reduce((a, n) => a + (Number(n) || 0), 0);
}

// 테스트에서 가짜 세션 폴더를 물릴 수 있게 해 둔다. 실사용에서는 건드리지 않는다.
const CLAUDE_ROOT = process.env.KIBITZ_PET_CLAUDE_ROOT || path.join(os.homedir(), ".claude", "projects");
const CODEX_ROOT = process.env.KIBITZ_PET_CODEX_ROOT || path.join(os.homedir(), ".codex", "sessions");

/** 이 시간 안에 쓰인 파일만 "살아 있다"고 본다. */
const LIVE_WINDOW_MS = 120_000;
const TAIL_BYTES = 96_000;
const HEAD_BYTES = 160_000;

/** 최근에 쓰인 세션 파일 전부. 여러 개를 띄워 뒀으면 여러 개가 나온다. */
function liveFiles(root, out = [], depth = 0) {
  let entries;
  try {
    entries = fs.readdirSync(root, { withFileTypes: true });
  } catch {
    return out;
  }
  for (const e of entries) {
    const full = path.join(root, e.name);
    if (e.isDirectory()) {
      if (e.name === "subagents" || depth > 3) continue;
      liveFiles(full, out, depth + 1);
    } else if (e.name.endsWith(".jsonl")) {
      try {
        const st = fs.statSync(full);
        if (Date.now() - st.mtimeMs <= LIVE_WINDOW_MS) out.push({ path: full, mtime: st.mtimeMs });
      } catch {
        /* 읽을 수 없는 파일은 없는 것으로 */
      }
    }
  }
  return out;
}

function newestFile(root, depth = 0) {
  let best = null;
  let entries;
  try {
    entries = fs.readdirSync(root, { withFileTypes: true });
  } catch {
    return null;
  }
  for (const e of entries) {
    const full = path.join(root, e.name);
    if (e.isDirectory()) {
      if (e.name === "subagents" || depth > 3) continue;
      const inner = newestFile(full, depth + 1);
      if (inner && (!best || inner.mtime > best.mtime)) best = inner;
    } else if (e.name.endsWith(".jsonl")) {
      try {
        const s = fs.statSync(full);
        if (!best || s.mtimeMs > best.mtime) best = { path: full, mtime: s.mtimeMs };
      } catch {
        /* 읽을 수 없는 파일은 없는 것으로 */
      }
    }
  }
  return best;
}

function slice(file, start, end) {
  const fd = fs.openSync(file, "r");
  try {
    const len = Math.max(0, end - start);
    const buf = Buffer.alloc(len);
    const read = fs.readSync(fd, buf, 0, len, start);
    return buf.subarray(0, read).toString("utf8");
  } finally {
    fs.closeSync(fd);
  }
}

function linesOf(file) {
  const size = fs.statSync(file).size;
  // 앞은 장비의 근거(세션 시작 때 붙는다), 뒤는 지금 상태.
  const big = size > HEAD_BYTES;
  const head = slice(file, 0, Math.min(HEAD_BYTES, size));
  const tail = big ? slice(file, Math.max(0, size - TAIL_BYTES), size) : "";
  const parse = (text, dropFirst) => {
    const rows = text.split("\n");
    return (dropFirst ? rows.slice(1) : rows).filter((l) => l.trim());
  };
  // 큰 파일에서만 머리의 마지막 줄을 버린다 — 잘려 있을 수 있고, 어차피 꼬리가
  // 이어받는다. 작은 파일에서 버리면 **마지막 사건이 통째로 사라진다**:
  // 위임 복귀도 최종 답변도 대개 그 줄에 있다.
  const headLines = parse(head, false);
  return big ? [...headLines.slice(0, -1), ...parse(tail, true)] : headLines;
}

/* ── 경험치 ────────────────────────────────────────────────────
   레벨은 **얼마나 많이 했는가**지 얼마나 잘했는가가 아니다. 그래서 세는 것은
   관측 수 하나뿐이고, 툴팁에 그 숫자를 그대로 적는다 — 점수처럼 보이면 안 된다.

   파일 전체를 매번 읽지 않는다. 커서를 들고 있다가 **새로 붙은 만큼만** 센다. */

const cursors = new Map(); // path → { at, obs, requests, promptIds:Set }

function countIncremental(file) {
  let st;
  try {
    st = fs.statSync(file);
  } catch {
    return { obs: 0, tokens: 0, requests: 0 };
  }
  let c = cursors.get(file);
  // 파일이 줄었으면 다른 파일이 된 것이다 — 처음부터 다시 센다.
  if (!c || st.size < c.at) c = { at: 0, obs: 0, tokens: 0, promptIds: new Set() };

  if (st.size > c.at) {
    const text = slice(file, c.at, st.size);
    const lines = text.split("\n");
    // 마지막 줄은 아직 다 안 쓰였을 수 있다. 다음 번에 다시 읽는다.
    const complete = text.endsWith("\n") ? lines : lines.slice(0, -1);
    const consumed = complete.reduce((n, l) => n + Buffer.byteLength(l) + 1, 0);
    for (const line of complete) {
      if (!line.trim()) continue;
      let o;
      try {
        o = JSON.parse(line);
      } catch {
        continue;
      }
      if (o.type === "assistant" && Array.isArray(o.message?.content)) {
        const calls = o.message.content.filter((b) => b && b.type === "tool_use").length;
        c.obs += calls || 1;
        // 토큰은 메시지 단위 실측값이다. kibitz 의 `totalTokens` 와 같은 식으로 센다:
        // 캐시 기록 + 새 입력 + 출력. 캐시 **읽기**는 빼는데, 그건 다시 낸 값이 아니다.
        const u = o.message.usage || {};
        c.tokens +=
          (Number(u.cache_creation_input_tokens) || 0) +
          (Number(u.input_tokens) || 0) +
          (Number(u.output_tokens) || 0);
      }
      if (o.type === "user" && o.promptId && !o.isMeta && !o.sourceToolUseID) {
        const content = o.message?.content;
        const isToolResult =
          Array.isArray(content) && content.some((b) => b && b.type === "tool_result");
        if (!isToolResult) c.promptIds.add(o.promptId);
      }
    }
    c.at += consumed;
  }
  cursors.set(file, c);
  if (progress.files[file] !== c.tokens) {
    progress.files[file] = c.tokens;
    progressDirty = true;
  }
  return { obs: c.obs, tokens: c.tokens, requests: c.promptIds.size };
}

function textOf(content) {
  if (typeof content === "string") return content;
  if (!Array.isArray(content)) return "";
  return content
    .filter((b) => b && typeof b === "object" && b.type === "text")
    .map((b) => String(b.text ?? ""))
    .join(" ");
}

/** 지금 무엇을 하는 중인가. 마지막 이벤트가 무엇이냐로 끝난다 — 추론하지 않는다. */
function readClaudeCode(found) {
  if (!found) return null;

  let state = "idle";
  let tool = null;
  let title = "";
  let lastPrompt = null;
  let lastSay = null;
  let sessionId = "";
  let at = new Date(found.mtime).toISOString();
  const mcp = [];
  // 위임한 에이전트 — 띄운 것에서 돌아온 것을 뺀다. 지금 몇이 밖에 나가 있는가.
  const launched = new Set();
  const returned = new Set();
  const skills = [];
  const plugins = [];
  const rules = [];

  for (const line of linesOf(found.path)) {
    let o;
    try {
      o = JSON.parse(line);
    } catch {
      continue;
    }
    if (typeof o.timestamp === "string") at = o.timestamp;
    if (typeof o.sessionId === "string" && o.sessionId) sessionId = o.sessionId;
    if (typeof o.customTitle === "string" && o.customTitle) title = o.customTitle;
    else if (typeof o.aiTitle === "string" && o.aiTitle && !title) title = o.aiTitle;

    if (o.type === "attachment") {
      const a = o.attachment || {};
      if (a.type === "nested_memory" && a.path) rules.push(String(a.path));
      if (a.type === "mcp_instructions_delta") for (const n of a.addedNames || []) mcp.push(String(n));
      if (a.type === "skill_listing" && typeof a.content === "string") {
        for (const l of a.content.split("\n")) {
          const m = l.match(/^-\s*([\w:-]+):/);
          if (!m) continue;
          const name = m[1];
          const at2 = name.indexOf(":");
          if (at2 > 0) plugins.push(name.slice(0, at2));
          else skills.push(name);
        }
      }
      continue;
    }

    const msg = o.message || {};
    const content = msg.content;

    if (o.type === "user") {
      const raw = typeof content === "string" ? content : "";
      if (raw.startsWith("<task-notification>")) {
        const m = raw.match(/<tool-use-id>([^<]+)<\/tool-use-id>/);
        if (m) returned.add(m[1]);
      }
      const isToolResult =
        Array.isArray(content) && content.some((b) => b && b.type === "tool_result");
      if (isToolResult) {
        state = "thinking";
        tool = null;
      } else if (!o.isMeta && !o.sourceToolUseID) {
        const text = textOf(content);
        if (text && !text.startsWith("<")) {
          lastPrompt = text.slice(0, 160);
          state = "thinking";
          tool = null;
        }
      }
    } else if (o.type === "assistant" && Array.isArray(content)) {
      for (const b of content) {
        if (b && b.type === "tool_use" && (b.name === "Agent" || b.name === "Task")) {
          launched.add(b.id);
        }
      }
      const call = content.find((b) => b && b.type === "tool_use");
      // 도구를 부르기 직전에 한 말이 곧 그 도구를 부른 이유다. 말풍선에 그것을 띄운다.
      const said = textOf(content).trim();
      if (said) lastSay = said.slice(0, 240);
      if (call) {
        state = "working";
        tool = call.name || null;
      } else {
        state = "answering";
        tool = null;
      }
    }
  }

  // 마지막으로 한 일이 **답변**이었나. 알림은 이 순간에만 는다 —
  // 도구를 돌리다 멈춘 것과 할 말을 다 하고 멈춘 것은 다른 사건이다.
  const endedWithAnswer = state === "answering";

  // 30초 넘게 조용하면 사람 차례다.
  if (Date.now() - Date.parse(at) > 30_000) state = "waiting";

  const uniq = (xs) => [...new Set(xs)];
  const counts = countIncremental(found.path);
  // 레벨은 이 세션이 아니라 **여태 쓴 전부**로 정해진다.
  const lv = levelFor(totalTokens());
  return {
    source: "claude-code",
    sessionId,
    obs: counts.obs,
    tokens: counts.tokens,
    totalTokens: totalTokens(),
    level: lv.level,
    xp: lv.xp,
    need: lv.need,
    maxed: Boolean(lv.maxed),
    lastSay,
    title,
    state,
    tool,
    lastPrompt,
    at,
    mcp: uniq(mcp),
    skills: uniq(skills),
    plugins: uniq(plugins),
    rules: uniq(rules).length,
    requests: counts.requests,
    endedWithAnswer,
    subagents: [...launched].filter((id) => !returned.has(id)).length,
  };
}

function readCodex(found) {
  if (!found) return null;
  let state = "idle";
  let tool = null;
  let at = new Date(found.mtime).toISOString();
  for (const line of linesOf(found.path)) {
    let o;
    try {
      o = JSON.parse(line);
    } catch {
      continue;
    }
    if (typeof o.timestamp === "string") at = o.timestamp;
    const p = o.payload || o;
    const type = String(p.type || o.type || "");
    if (type === "function_call" || type === "custom_tool_call") {
      state = "working";
      tool = typeof p.name === "string" ? p.name : null;
    } else if (type.endsWith("_output")) {
      state = "thinking";
      tool = null;
    } else if (type === "message") {
      state = p.role === "user" ? "thinking" : "answering";
      tool = null;
    }
  }
  if (Date.now() - Date.parse(at) > 30_000) state = "waiting";
  const file = path.basename(found.path).replace(/^rollout-/, "").replace(/\.jsonl$/, "");
  return {
    source: "codex", sessionId: file, lastSay: null, title: "", state, tool,
    lastPrompt: null, at, mcp: [], skills: [], plugins: [], rules: 0, subagents: 0, endedWithAnswer: state === "answering",
    ...(() => {
      const c = countIncremental(found.path);
      const l = levelFor(totalTokens());
      return {
        obs: c.obs, tokens: c.tokens, totalTokens: totalTokens(),
        level: l.level, xp: l.xp, need: l.need, maxed: Boolean(l.maxed),
      };
    })(),
  };
}

/**
 * 지금 돌고 있는 것 **전부**.
 *
 * 여러 대화방을 띄워 뒀으면 여러 개가 나온다 — 하나로 합치면 "다른 창에서 뭔가
 * 끝났다"를 알 방법이 없다. 최근에 움직인 순서로 준다.
 */
function liveAgents(limit = 4) {
  const files = [
    ...liveFiles(CLAUDE_ROOT).map((f) => ({ f, read: readClaudeCode })),
    ...liveFiles(CODEX_ROOT).map((f) => ({ f, read: readCodex })),
  ]
    .sort((a, b) => b.f.mtime - a.f.mtime)
    .slice(0, limit);

  const out = [];
  for (const { f, read } of files) {
    const a = safe(() => read(f));
    if (a) out.push(a);
  }
  saveProgress();
  return out;
}

/** 하나만 필요할 때. */
function currentAgent() {
  return liveAgents(1)[0] || null;
}

function safe(fn) {
  try {
    return fn();
  } catch {
    return null;
  }
}

module.exports = { currentAgent, liveAgents };
