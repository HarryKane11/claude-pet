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

/**
 * 살아 있는 파일 목록 캐시.
 *
 * 세션 폴더에는 파일이 수천 개다(이 머신 2,693개). 2초마다 전부 `stat` 하면
 * 가만히 떠 있는 펫이 계속 디스크를 두드린다 — 측정값으로 한 번에 62ms 였다.
 *
 * 그래서 **전체 훑기는 가끔**, 그 사이에는 이미 아는 파일만 확인한다. 새 세션이
 * 15초 늦게 뜨는 것은 사람이 눈치채지 못하지만, 3%의 CPU 가 계속 도는 것은
 * 배터리로 돌아온다.
 */
const RESCAN_MS = 15_000;
// 루트마다 따로 들고 있어야 한다. 한 칸짜리로 두면 Claude 와 Codex 를 번갈아
// 부를 때마다 서로의 캐시를 지워서 매번 전체를 훑게 된다 — 캐시가 없는 것만 못하다.
const scanCaches = new Map();

function liveFilesCached(root) {
  const now = Date.now();
  const cached = scanCaches.get(root);
  if (cached && now - cached.at < RESCAN_MS) {
    // 아는 파일만 다시 본다. 대개 한두 개다.
    return cached.files
      .map((f) => {
        try {
          const st = fs.statSync(f.path);
          return { path: f.path, mtime: st.mtimeMs };
        } catch {
          return null;
        }
      })
      .filter((f) => f && now - f.mtime <= LIVE_WINDOW_MS);
  }
  const files = liveFiles(root);
  scanCaches.set(root, { at: now, files });
  return files;
}

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
    // 마지막 칸은 버린다. 줄이 덜 쓰였으면 다음 번에 다시 읽고, 개행으로 끝났으면
    // 그 칸은 빈 문자열이라 세면 커서가 한 바이트 넘친다.
    const complete = lines.slice(0, -1);
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

/**
 * 설치된 플러그인 — **파일에서 직접**.
 *
 * 세션의 스킬 목록에서 `플러그인명:스킬명` 접두어를 긁어 쓰다가, 목록 형식이 다른
 * 세션(프로젝트 스코프 목록 등)에서는 하나도 못 찾아 모자가 사라졌다. 설치 목록은
 * `~/.claude/plugins/installed_plugins.json` 에 그대로 있다 — 프롬프트 블록을
 * 파싱해 추측할 이유가 없다.
 */
function installedPlugins() {
  try {
    const file = path.join(os.homedir(), ".claude", "plugins", "installed_plugins.json");
    const json = JSON.parse(fs.readFileSync(file, "utf8"));
    // 키는 `플러그인@마켓플레이스` 형식이다. 사람이 부르는 이름은 앞부분이다.
    return Object.keys(json.plugins || {}).map((k) => k.split("@")[0]);
  } catch {
    return [];
  }
}

/** 지금 무엇을 하는 중인가. 마지막 이벤트가 무엇이냐로 끝난다 — 추론하지 않는다. */
/**
 * 세션 상태 캐시.
 *
 * 세션 앞부분(스킬·플러그인·규칙·MCP·제목)은 열릴 때 한 번 붙고 끝이다. 그런데
 * 매 폴링마다 앞 160KB + 뒤 96KB 를 다시 읽고 파싱하고 있었다 — 실제로 늘어난
 * 건 몇백 바이트인데.
 *
 * 그래서 **파일마다 상태를 들고 있다가 새로 붙은 줄만 먹인다.** 커서가 뒤로
 * 가면(파일이 갈렸으면) 처음부터 다시 만든다.
 */
const sessions = new Map();

function freshState() {
  return {
    at: 0, state: "idle", tool: null, title: "", lastPrompt: null, lastSay: null,
    sessionId: "", ts: null, mcp: [], skills: [], plugins: [], rules: [],
    launched: new Set(), returned: new Set(),
    originAware: false, humanPrompt: false, promptCount: 0, toolCallCount: 0,
  };
}

/** 한 줄을 상태에 반영한다. 앞부분이든 새로 붙은 줄이든 같은 코드를 지난다. */
function feed(st, o) {
  const push = (list, v) => { if (v && !list.includes(v)) list.push(v); };
  if (typeof o.sessionId === "string" && o.sessionId) st.sessionId = o.sessionId;
  if (typeof o.customTitle === "string" && o.customTitle) st.title = o.customTitle;
  else if (typeof o.aiTitle === "string" && o.aiTitle && !st.title) st.title = o.aiTitle;
  if (typeof o.timestamp === "string") st.ts = o.timestamp;

  if (o.type === "attachment") {
    const a = o.attachment || {};
    if (a.type === "nested_memory" && a.path) push(st.rules, String(a.path));
    if (a.type === "mcp_instructions_delta") for (const n of a.addedNames || []) push(st.mcp, String(n));
    if (a.type === "skill_listing" && typeof a.content === "string") {
      for (const l of a.content.split("\n")) {
        const m = l.match(/^-\s*([\w:-]+):/);
        if (!m) continue;
        const at = m[1].indexOf(":");
        if (at > 0) push(st.plugins, m[1].slice(0, at));
        else push(st.skills, m[1]);
      }
    }
    return;
  }

  const msg = o.message || {};
  const content = msg.content;

  if (o.type === "user") {
    const kind = o.origin && typeof o.origin === "object" ? o.origin.kind : null;
    if (kind) {
      st.originAware = true;
      if (kind === "human") st.humanPrompt = true;
    }
    const raw = typeof content === "string" ? content : "";
    if (raw.startsWith("<task-notification>")) {
      const m = raw.match(/<tool-use-id>([^<]+)<\/tool-use-id>/);
      if (m) st.returned.add(m[1]);
    }
    const isToolResult =
      Array.isArray(content) && content.some((b) => b && b.type === "tool_result");
    if (isToolResult) {
      st.state = "thinking";
      st.tool = null;
    } else if (!o.isMeta && !o.sourceToolUseID) {
      const text = textOf(content);
      if (text && !text.startsWith("<")) {
        st.promptCount += 1;
        st.lastPrompt = text.slice(0, 160);
        st.state = "thinking";
        st.tool = null;
      }
    }
  } else if (o.type === "assistant" && Array.isArray(content)) {
    for (const b of content) {
      if (b && b.type === "tool_use") {
        st.toolCallCount += 1;
        if (b.name === "Agent" || b.name === "Task") st.launched.add(b.id);
      }
    }
    const said = textOf(content).trim();
    if (said) st.lastSay = said.slice(0, 240);
    const call = content.find((b) => b && b.type === "tool_use");
    if (call) {
      st.state = "working";
      st.tool = call.name || null;
    } else {
      st.state = "answering";
      st.tool = null;
    }
  }
}

/** 새로 붙은 줄만 먹인다. 완성되지 않은 마지막 줄은 다음 번에 다시 본다. */
function advance(file) {
  let size;
  try {
    size = fs.statSync(file).size;
  } catch {
    return null;
  }
  let st = sessions.get(file);
  if (!st || size < st.at) {
    st = freshState();
    sessions.set(file, st);
  }
  if (size > st.at) {
    const text = slice(file, st.at, size);
    // `"a\nb\n".split("\n")` 의 마지막 칸은 빈 문자열이다. 그걸 한 줄로 세면
    // 커서가 파일 끝을 한 바이트 넘어서고, 다음 폴링이 "파일이 줄었다"고 보고
    // 처음부터 다시 읽는다 — 증분이 통째로 무효가 된다.
    const rows = text.split("\n");
    const complete = rows.slice(0, -1);
    let consumed = 0;
    for (const line of complete) {
      consumed += Buffer.byteLength(line) + 1;
      if (!line.trim()) continue;
      try {
        feed(st, JSON.parse(line));
      } catch {
        /* 반쯤 쓰인 줄은 건너뛴다 */
      }
    }
    st.at += consumed;
  }
  return st;
}

function readClaudeCode(found) {
  if (!found) return null;
  const st = advance(found.path);
  if (!st) return null;

  // 스크립트가 띄운 실행은 대화방이 아니다.
  const automated = st.originAware ? !st.humanPrompt : st.promptCount <= 1 && st.toolCallCount === 0;
  if (automated) return null;

  const at = st.ts || new Date(found.mtime).toISOString();
  const endedWithAnswer = st.state === "answering";
  const silence = Date.now() - Date.parse(at);
  // 답을 다 쓰고 멈췄으면 그 순간 이미 내 차례다. 도구를 돌리다 멈춘 것은
  // 아직 하는 중일 수 있으므로 그대로 30초를 본다.
  const state = silence > (endedWithAnswer ? 3_000 : 30_000) ? "waiting" : st.state;

  const counts = countIncremental(found.path);
  const lv = levelFor(totalTokens());
  const allPlugins = [...new Set([...st.plugins, ...installedPlugins()])];

  return {
    source: "claude-code",
    sessionId: st.sessionId,
    lastSay: st.lastSay,
    title: st.title,
    state,
    tool: st.tool,
    lastPrompt: st.lastPrompt,
    at,
    obs: counts.obs,
    tokens: counts.tokens,
    totalTokens: totalTokens(),
    level: lv.level,
    xp: lv.xp,
    need: lv.need,
    maxed: Boolean(lv.maxed),
    mcp: [...st.mcp],
    skills: [...st.skills],
    plugins: allPlugins,
    rules: st.rules.length,
    requests: counts.requests,
    endedWithAnswer,
    subagents: [...st.launched].filter((id) => !st.returned.has(id)).length,
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
/**
 * 오래 보지 않은 파일의 캐시는 버린다.
 *
 * 며칠 켜 두면 지나간 세션마다 상태 객체가 하나씩 쌓인다. 각각 파싱된 스킬
 * 목록과 Set 을 들고 있어서 가볍지 않다. 살아 있는 파일은 언제나 한 줌이다.
 */
function pruneCaches(live) {
  const keep = new Set(live);
  for (const map of [sessions, cursors]) {
    if (map.size <= keep.size + 8) continue;
    for (const k of map.keys()) if (!keep.has(k)) map.delete(k);
  }
}

function liveAgents(limit = 4) {
  const files = [
    ...liveFilesCached(CLAUDE_ROOT).map((f) => ({ f, read: readClaudeCode })),
    ...liveFilesCached(CODEX_ROOT).map((f) => ({ f, read: readCodex })),
  ]
    .sort((a, b) => b.f.mtime - a.f.mtime)
    .slice(0, limit);

  const out = [];
  for (const { f, read } of files) {
    const a = safe(() => read(f));
    if (a) out.push(a);
  }
  pruneCaches(files.map(({ f }) => f.path));
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
