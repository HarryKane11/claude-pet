"use strict";

const fs = require("fs");
const os = require("os");
const path = require("path");

/**
 * 기억.
 *
 * "이거 기억해 둬" 라고 시키는 대신, 지난 작업에서 남길 만한 것을 스스로 골라
 * 두고 사람이 승인만 하게 한다. 시키는 순간에만 남는 기억은 대개 안 남는다 —
 * 정작 중요한 것은 일하는 중에 지나가기 때문이다.
 *
 * ── 왜 이 구조인가 ─────────────────────────────────────────
 *
 * 벡터도 그래프도 안 쓴다. 게을러서가 아니라 **이 규모에서 이득이 없어서**다.
 * 기억은 많아야 수백 개고, 질의는 "지금 이 프로젝트에서 알아야 할 것" 하나다.
 * 그 조건에서는 목록 + 색인이 임베딩보다 빠르고, 무엇보다 **사람이 직접 읽고
 * 고칠 수 있다.** 데스크탑 펫에 SQLite 를 얹는 것도 과하다.
 *
 * 대신 논문·오픈소스에서 값이 증명된 것 넷을 가져왔다:
 *
 *   유효 기간  (Zep) — 사실에 "언제까지 참인가" 를 단다. 시점 스냅샷보다 낫다는
 *                      것이 LongMemEval 에서 15점 차이로 나왔다. 낡은 기억은
 *                      없는 것보다 나쁘다.
 *   사용 기록  (RMM, ACL 2025) — 실제로 인용된 기억에 가중치를 준다. 온라인 RL
 *                      까지는 못 해도, 쓰인 것과 안 쓰인 것을 구분할 수는 있다.
 *   승격·거부  (memory-lake) — 후보 → 사실 → 규칙. 그리고 **왜 안 남겼는지도**
 *                      남긴다. 자동 추출의 최대 실패는 쓰레기가 쌓이는 것이고,
 *                      거부 이유를 적어 두면 기준이 눈에 보인다.
 *   연결      (A-MEM) — `[[이름]]` 으로 서로 건다. 새 사실이 옛 사실을 갱신한다.
 *
 * ── 어디에 쓰는가 ──────────────────────────────────────────
 *
 * 우리만의 저장소를 새로 만들지 않는다. 승인된 기억은 **하네스가 이미 읽는
 * 자리**로 간다(`<프로젝트>/memory/<이름>.md` + `MEMORY.md` 한 줄). 그래야
 * 다음 세션에서 실제로 로드된다 — 아무도 안 읽는 기억은 기억이 아니다.
 */

const HOME = process.env.KIBITZ_PET_HOME || path.join(os.homedir(), ".kibitz-pet");
const PENDING = path.join(HOME, "memory", "pending");
const REJECTED = path.join(HOME, "memory", "rejected.jsonl");
const USAGE = path.join(HOME, "memory", "usage.json");

const TYPES = new Set(["user", "feedback", "project", "reference"]);

/* ── 프론트매터 ────────────────────────────────────────────
   YAML 파서를 붙이지 않는다. 우리가 쓰고 우리가 읽는 형식이고, 하네스가 쓰는
   모양(name/description/metadata)만 맞추면 된다. */

function parse(text) {
  const m = /^---\n([\s\S]*?)\n---\n?/.exec(text);
  if (!m) return { meta: {}, body: text.trim() };
  const meta = {};
  let section = null;
  for (const raw of m[1].split("\n")) {
    if (!raw.trim()) continue;
    const nested = /^\s{2,}(\w+):\s*(.*)$/.exec(raw);
    if (nested && section) {
      meta[section][nested[1]] = value(nested[2]);
      continue;
    }
    const top = /^(\w+):\s*(.*)$/.exec(raw);
    if (!top) continue;
    if (top[2].trim() === "") {
      section = top[1];
      meta[section] = {};
    } else {
      section = null;
      meta[top[1]] = value(top[2]);
    }
  }
  return { meta, body: text.slice(m[0].length).trim() };
}

function value(s) {
  const t = s.trim();
  if (t === "null" || t === "") return null;
  if (t === "true") return true;
  if (t === "false") return false;
  if (/^\[.*\]$/.test(t)) {
    const inner = t.slice(1, -1).trim();
    return inner ? inner.split(",").map((x) => x.trim().replace(/^["']|["']$/g, "")) : [];
  }
  if (/^-?\d+(\.\d+)?$/.test(t)) return Number(t);
  return t.replace(/^["']|["']$/g, "");
}

function dump(v) {
  if (v === null || v === undefined) return "null";
  if (Array.isArray(v)) return `[${v.join(", ")}]`;
  return String(v);
}

/**
 * 하네스가 읽는 모양으로 쓴다.
 *
 * 우리가 더한 필드(observed·valid_until·supersedes·uses)는 metadata 안에 둔다.
 * 하네스는 모르는 키를 무시하고, 우리는 필요한 것을 들고 갈 수 있다.
 */
function render(mem) {
  const md = mem.metadata || {};
  const lines = [
    "---",
    `name: ${mem.name}`,
    `description: ${mem.description || ""}`,
    "metadata:",
    "  node_type: memory",
    `  type: ${TYPES.has(md.type) ? md.type : "project"}`,
  ];
  // 아는 키만 골라 쓰면 모르는 키가 조용히 사라진다. 실제로 `superseded_by` 가
  // 그렇게 없어졌고, 그러면 "무엇이 이걸 대체했는지" 를 다시는 알 수 없다.
  // 순서만 정해 두고 나머지는 전부 따라 나온다.
  const first = ["originSessionId", "observed", "valid_until", "supersedes", "superseded_by", "sources", "confidence"];
  const keys = [...first.filter((k) => md[k] !== undefined), ...Object.keys(md).filter((k) => !first.includes(k) && k !== "node_type" && k !== "type")];
  for (const k of keys) lines.push(`  ${k}: ${dump(md[k])}`);
  lines.push("---", "", mem.body.trim(), "");
  return lines.join("\n");
}

/* ── 후보 ──────────────────────────────────────────────────── */

function read(file) {
  const { meta, body } = parse(fs.readFileSync(file, "utf8"));
  return {
    name: String(meta.name || path.basename(file, ".md")),
    description: String(meta.description || ""),
    metadata: meta.metadata || {},
    body,
    file,
  };
}

/** 승인을 기다리는 것들. */
function pending() {
  let files;
  try {
    files = fs.readdirSync(PENDING).filter((f) => f.endsWith(".md"));
  } catch {
    return [];
  }
  const out = [];
  for (const f of files) {
    try {
      out.push(read(path.join(PENDING, f)));
    } catch {
      /* 반쯤 쓰인 파일은 다음 번에 */
    }
  }
  return out.sort((a, b) => a.name.localeCompare(b.name));
}

/* ── 승인 ──────────────────────────────────────────────────── */

const indexLine = (mem) => `- [${mem.description || mem.name}](${mem.name}.md) — ${hookOf(mem)}`;

/** 색인 한 줄의 꼬리. 본문 첫 문장이면 충분하다 — 색인은 고르기 위한 것이지
    읽기 위한 것이 아니다. */
function hookOf(mem) {
  const first = mem.body.split(/\n\n/)[0].replace(/\n/g, " ").trim();
  return first.length > 90 ? first.slice(0, 89) + "…" : first;
}

function updateIndex(dir, mem) {
  const file = path.join(dir, "MEMORY.md");
  let lines = [];
  try {
    lines = fs.readFileSync(file, "utf8").split("\n");
  } catch {
    /* 처음이면 빈 색인 */
  }
  const link = `(${mem.name}.md)`;
  const at = lines.findIndex((l) => l.includes(link));
  if (at >= 0) lines[at] = indexLine(mem);
  else lines.push(indexLine(mem));
  fs.writeFileSync(file, lines.filter((l, i) => l.trim() || i < lines.length - 1).join("\n").trimEnd() + "\n");
}

/**
 * 옛 사실을 물러나게 한다.
 *
 * **지우지 않는다.** 언제까지 참이었는지가 그 자체로 정보이기 때문이다 —
 * "이 프로젝트는 npm 을 쓴다" 가 틀린 게 아니라 7월까지는 맞았던 것이다.
 */
function retire(dir, name, { now, by }) {
  const file = path.join(dir, `${name}.md`);
  if (!fs.existsSync(file)) return false;
  const old = read(file);
  old.metadata = { ...old.metadata, valid_until: now, superseded_by: by };
  const archive = path.join(dir, "archive");
  fs.mkdirSync(archive, { recursive: true });
  fs.writeFileSync(path.join(archive, `${name}.md`), render(old));
  fs.rmSync(file);
  // 색인에서도 내린다. 파일만 치우고 색인을 두면 다음 세션이 없는 파일을 연다.
  const index = path.join(dir, "MEMORY.md");
  try {
    const kept = fs
      .readFileSync(index, "utf8")
      .split("\n")
      .filter((l) => !l.includes(`(${name}.md)`));
    fs.writeFileSync(index, kept.join("\n").trimEnd() + "\n");
  } catch {
    /* 색인이 없으면 할 일도 없다 */
  }
  return true;
}

/**
 * 후보를 진짜 기억으로 만든다.
 *
 * @param name 후보 이름
 * @param dir  하네스의 memory 디렉터리
 */
function approve(name, dir, { now = new Date().toISOString().slice(0, 10) } = {}) {
  const file = path.join(PENDING, `${name}.md`);
  const mem = read(file);
  mem.metadata = { ...mem.metadata, observed: mem.metadata.observed || now };

  fs.mkdirSync(dir, { recursive: true });
  const retired = [];
  for (const old of [].concat(mem.metadata.supersedes || [])) {
    if (old && retire(dir, String(old), { now, by: mem.name })) retired.push(String(old));
  }

  fs.writeFileSync(path.join(dir, `${mem.name}.md`), render(mem));
  updateIndex(dir, mem);
  fs.rmSync(file);
  return { name: mem.name, path: path.join(dir, `${mem.name}.md`), retired };
}

/**
 * 거부도 남긴다.
 *
 * 자동 추출의 최대 실패는 쓰레기가 쌓이는 것이다. 무엇을 왜 안 남겼는지가
 * 적혀 있으면 다음 회차가 그 기준을 읽고 덜 뽑는다.
 */
function reject(name, reason = "") {
  const file = path.join(PENDING, `${name}.md`);
  let mem = { name, description: "" };
  try {
    mem = read(file);
  } catch {
    /* 이미 없으면 기록만 남긴다 */
  }
  fs.mkdirSync(path.dirname(REJECTED), { recursive: true });
  fs.appendFileSync(
    REJECTED,
    JSON.stringify({ name, description: mem.description, reason, at: new Date().toISOString() }) + "\n",
  );
  try {
    fs.rmSync(file);
  } catch {
    /* 없으면 그만 */
  }
}

/* ── 사용 기록 ─────────────────────────────────────────────
   RMM 의 retrospective reflection 을 우리 형편에 맞춘 것. 온라인 RL 은 못 하지만,
   **실제로 쓰인 기억과 한 번도 안 쓰인 기억을 구분**하는 것만으로도 색인 순서를
   고칠 수 있다. 안 쓰이는 기억이 위에 있으면 그다음부터 아무도 색인을 안 읽는다. */

function loadUsage() {
  try {
    return JSON.parse(fs.readFileSync(USAGE, "utf8"));
  } catch {
    return {};
  }
}

function recordUse(names, { now = Date.now() } = {}) {
  const u = loadUsage();
  for (const n of [].concat(names || [])) {
    const cur = u[n] || { uses: 0, last: 0 };
    u[n] = { uses: cur.uses + 1, last: now };
  }
  fs.mkdirSync(path.dirname(USAGE), { recursive: true });
  fs.writeFileSync(USAGE, JSON.stringify(u));
  return u;
}

/** 색인 순서용 점수. 자주 쓰이면 위로, 오래 안 쓰이면 아래로. */
function rank(name, { now = Date.now(), usage = loadUsage() } = {}) {
  const u = usage[name];
  if (!u) return 0;
  const days = (now - u.last) / 86_400_000;
  // 반감기 30일. 한 달 안 쓰인 기억은 절반의 무게만 갖는다.
  return u.uses * Math.pow(0.5, days / 30);
}

function stats() {
  return { pending: pending().length };
}

module.exports = {
  pending,
  approve,
  reject,
  recordUse,
  rank,
  stats,
  parse,
  render,
  retire,
  PENDING,
  REJECTED,
};
