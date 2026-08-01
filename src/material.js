"use strict";

const fs = require("fs");
const os = require("os");
const path = require("path");
const memory = require("./memory");

/**
 * 큐레이터에게 보낼 자료를 모은다.
 *
 * 세션 파일을 통째로 보내지 않는다. **보내는 양이 곧 비용이고 노출**이라서,
 * 필요한 것만 고른다:
 *
 *   사람이 시킨 말   사실의 원천은 대개 여기다. 코드에서 알 수 없는 것 —
 *                    취향, 제약, 왜 그렇게 정했는지 — 은 사람 입에서 나온다
 *   끝난 답의 첫 문장  무엇이 끝났는지. 도구 출력은 안 보낸다
 *   이미 있는 기억     같은 것을 또 뽑지 않게
 *   지난 회차 거부     같은 것을 또 제안하지 않게
 *
 * 도구 인자도, 파일 내용도, 에이전트의 긴 설명도 보내지 않는다. 화면에 뜰
 * 글이면서 동시에 밖으로 나가는 글이라, 적게 보내는 쪽이 언제나 맞다.
 */

const CLAUDE_ROOT = process.env.KIBITZ_PET_CLAUDE_ROOT || path.join(os.homedir(), ".claude", "projects");
const CODEX_ROOT = process.env.KIBITZ_PET_CODEX_ROOT || path.join(os.homedir(), ".codex", "sessions");

/** 한 회차에 볼 세션 파일 수. 이보다 오래된 것은 이미 지난 회차가 봤다. */
const MAX_FILES = 8;
const MAX_BYTES = 400_000;

function recentFiles(root, since, out = [], depth = 0) {
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
      recentFiles(full, since, out, depth + 1);
    } else if (e.name.endsWith(".jsonl")) {
      try {
        const st = fs.statSync(full);
        if (st.mtimeMs > since) out.push({ path: full, mtime: st.mtimeMs, size: st.size });
      } catch {
        /* 못 읽는 파일은 없는 것으로 */
      }
    }
  }
  return out;
}

/** 파일 꼬리만 읽는다. 지난 회차 이후의 일은 대개 끝에 있다. */
function tail(file, size, bytes = 200_000) {
  const fd = fs.openSync(file, "r");
  try {
    const start = Math.max(0, size - bytes);
    const buf = Buffer.alloc(size - start);
    const n = fs.readSync(fd, buf, 0, buf.length, start);
    const text = buf.subarray(0, n).toString("utf8");
    // 앞이 잘렸으면 반쪽 줄이 하나 생긴다.
    return start > 0 ? text.slice(text.indexOf("\n") + 1) : text;
  } finally {
    fs.closeSync(fd);
  }
}

const textOf = (content) => {
  if (typeof content === "string") return content;
  if (!Array.isArray(content)) return "";
  return content
    .filter((b) => b && b.type === "text" && typeof b.text === "string")
    .map((b) => b.text)
    .join("\n");
};

function harvest(file, size, since, out) {
  let text;
  try {
    text = tail(file, size);
  } catch {
    return;
  }
  let lastSay = "";
  for (const line of text.split("\n")) {
    if (!line.trim()) continue;
    let o;
    try {
      o = JSON.parse(line);
    } catch {
      continue;
    }
    const when = Date.parse(o.timestamp || 0) || 0;
    if (when && when < since) continue;

    if (o.type === "user") {
      const kind = o.origin && typeof o.origin === "object" ? o.origin.kind : null;
      // 사람이 친 말만. 도구 결과와 주입된 블록은 사람의 말이 아니다.
      if (kind && kind !== "human") continue;
      if (o.isMeta || o.sourceToolUseID) continue;
      const t = textOf(o.message && o.message.content).trim();
      if (t && !t.startsWith("<") && t.length < 400) out.prompts.push(t);
    } else if (o.type === "assistant") {
      const said = textOf(o.message && o.message.content).trim();
      if (said) lastSay = said;
    }
  }
  if (lastSay) {
    const first = lastSay.split(/\n\n/)[0].replace(/\n/g, " ").trim();
    out.done.push(first.length > 200 ? first.slice(0, 199) + "…" : first);
  }
}

/** 이미 저장된 기억의 이름과 한 줄. 같은 것을 또 뽑지 않게. */
function knownMemories(dirs) {
  const out = [];
  for (const dir of dirs) {
    let files;
    try {
      files = fs.readdirSync(dir).filter((f) => f.endsWith(".md") && f !== "MEMORY.md");
    } catch {
      continue;
    }
    for (const f of files.slice(0, 60)) {
      try {
        const { meta } = memory.parse(fs.readFileSync(path.join(dir, f), "utf8"));
        out.push(`${meta.name || f} — ${meta.description || ""}`);
      } catch {
        /* 못 읽으면 없는 것으로 */
      }
    }
  }
  return out;
}

function pastRejections(limit = 20) {
  try {
    return fs
      .readFileSync(memory.REJECTED, "utf8")
      .trim()
      .split("\n")
      .slice(-limit)
      .map((l) => JSON.parse(l))
      .map((r) => ({ name: r.name, reason: r.reason }));
  } catch {
    return [];
  }
}

/**
 * @param since 마지막 회차 시각(ms)
 */
async function since(sinceMs) {
  const files = [...recentFiles(CLAUDE_ROOT, sinceMs), ...recentFiles(CODEX_ROOT, sinceMs)]
    .sort((a, b) => b.mtime - a.mtime)
    .slice(0, MAX_FILES);

  const out = { prompts: [], done: [], known: [], rejected: [], recentLines: [] };
  let budget = MAX_BYTES;
  const dirs = new Set();
  for (const f of files) {
    if (budget <= 0) break;
    budget -= Math.min(f.size, 200_000);
    harvest(f.path, f.size, sinceMs, out);
    dirs.add(path.join(path.dirname(f.path), "memory"));
  }

  out.known = knownMemories([...dirs]);
  out.rejected = pastRejections();
  return out;
}

module.exports = { since, knownMemories, pastRejections };
