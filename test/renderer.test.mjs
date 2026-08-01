/**
 * 렌더러 갱신 경로 테스트.
 *
 * Electron 은 렌더러에서 예외가 나도 창을 그대로 띄워 둔다. 한 번은 그래서 패널이
 * 통째로 비었는데 프로세스는 멀쩡해 보였고, `pgrep` 만 확인한 나는 고쳤다고 말했다.
 * 그래서 브라우저 없이 이 코드를 실제로 돌려 본다 — DOM 은 최소한만 흉내 낸다.
 *
 *   node --test test/*.test.mjs
 */

import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import vm from "node:vm";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const HTML = fs.readFileSync(path.join(here, "..", "renderer", "index.html"), "utf8");

/** 갱신 경로가 건드리는 것만 있는 최소 노드. */
function makeEl(tag = "div") {
  const el = {
    tagName: tag.toUpperCase(),
    children: [],
    dataset: {},
    style: {},
    className: "",
    textContent: "",
    _html: "",
    /** innerHTML 을 몇 번 다시 썼는지 — "안 바뀌면 안 그린다"를 이걸로 본다. */
    writes: 0,
    get innerHTML() {
      return this._html;
    },
    set innerHTML(v) {
      this._html = v;
      this.writes += 1;
    },
    classList: { add() {}, remove() {}, toggle() {}, contains: () => false },
    appendChild(c) {
      this.children.push(c);
      return c;
    },
    remove() {},
    closest: () => null,
    addEventListener() {},
    removeEventListener() {},
    setAttribute() {},
    getBoundingClientRect: () => ({ left: 0, top: 0, width: 120, height: 80 }),
    querySelectorAll: () => [],
  };
  // 패널 안에서 `q(".title")` 처럼 찾는다. 클래스마다 노드를 하나씩 만들어 둔다.
  const bag = new Map();
  el.querySelector = (sel) => {
    if (!bag.has(sel)) bag.set(sel, makeEl());
    return bag.get(sel);
  };
  return el;
}

function runRenderer() {
  const script = HTML.slice(HTML.indexOf("<script>") + 8, HTML.lastIndexOf("</script>"));
  const root = makeEl("body");
  // 펫은 `#list` 안에 붙는다.
  const byId = new Map([["list", root], ["quit", makeEl("button")]]);
  const store = new Map();
  let onAgents = () => {};

  const doc = {
    body: root,
    documentElement: makeEl("html"),
    hidden: false,
    createElement: (t) => makeEl(t),
    querySelector: (s) => root.querySelector(s),
    querySelectorAll: () => [],
    getElementById: (id) => {
      if (!byId.has(id)) byId.set(id, makeEl());
      return byId.get(id);
    },
    addEventListener() {},
    elementFromPoint: () => null,
  };

  const sandbox = {
    document: doc,
    localStorage: {
      getItem: (k) => (store.has(k) ? store.get(k) : null),
      setItem: (k, v) => store.set(k, String(v)),
    },
    window: {
      pet: {
        openSession() {},
        onAgents: (fn) => {
          onAgents = fn;
        },
        setInteractive() {},
        quit() {},
        drag() {},
        open() {},
      },
      addEventListener() {},
      innerWidth: 1440,
      innerHeight: 900,
    },
    requestAnimationFrame: () => 0,
    setInterval: () => 0,
    setTimeout: () => 0,
    clearInterval() {},
    console,
  };
  sandbox.globalThis = sandbox;
  vm.createContext(sandbox);
  vm.runInContext(script, sandbox, { filename: "renderer/index.html" });
  return { root, push: (agents) => onAgents(agents), doc };
}

const AGENT = {
  source: "claude-code",
  sessionId: "t1",
  title: "테스트 대화방",
  state: "working",
  tool: "Bash",
  lastPrompt: "최적화 적용해줘",
  lastSay: "재보고 고칩니다",
  at: new Date().toISOString(),
  obs: 12,
  tokens: 1000,
  totalTokens: 5_000_000,
  level: 20,
  xp: 0.4,
  need: 100,
  maxed: false,
  mcp: ["notion"],
  skills: ["bc-plan", "bc-verify"],
  plugins: ["braincrew"],
  rules: 2,
  requests: 3,
  endedWithAnswer: false,
  subagents: 1,
};

test("갱신이 예외 없이 지나가고 패널이 그려진다", () => {
  const app = runRenderer();
  app.push([AGENT]);
  const pet = app.root.children[0];
  assert.ok(pet, "펫 노드가 붙어야 한다");
  assert.match(pet.innerHTML, /class="panel"/, "패널 마크업이 있어야 한다");
});

test("내용이 그대로면 인벤토리를 다시 그리지 않는다", () => {
  const app = runRenderer();
  app.push([AGENT]);
  const pet = app.root.children[0];
  const inv = pet.querySelector(".inv");
  const drawn = inv.writes;
  assert.ok(drawn >= 1, "처음에는 그려야 한다");

  // 도구만 바뀐 갱신 — 장비 목록은 그대로다.
  app.push([{ ...AGENT, tool: "Read", obs: 13 }]);
  assert.equal(inv.writes, drawn, "장비가 그대로면 다시 그리지 않는다");

  // 스킬이 하나 늘면 그때는 다시 그린다.
  app.push([{ ...AGENT, skills: [...AGENT.skills, "bc-lab"] }]);
  assert.equal(inv.writes, drawn + 1, "바뀌면 다시 그려야 한다");
});
