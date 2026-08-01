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
  let el;
  el = {
    tagName: tag.toUpperCase(),
    children: [],
    dataset: {},
    style: {},
    className: "",
    textContent: "",
    _html: "",
    _parsedFor: null,
    _parsed: new Map(),
    /** innerHTML 을 몇 번 다시 썼는지 — "안 바뀌면 안 그린다"를 이걸로 본다. */
    writes: 0,
    get innerHTML() {
      return this._html;
    },
    set innerHTML(v) {
      this._html = v;
      this.writes += 1;
    },
    // 진짜로 담아 둔다. 흉내만 내면 "말풍선이 떴는가" 를 확인할 수 없다.
    _cls: new Set(),
    classList: {
      add(c) { el._cls.add(c); },
      remove(c) { el._cls.delete(c); },
      toggle(c, on) { if (on === undefined) el._cls.has(c) ? el._cls.delete(c) : el._cls.add(c); else if (on) el._cls.add(c); else el._cls.delete(c); },
      contains: (c) => el._cls.has(c),
    },
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
    /**
     * innerHTML 에서 그 클래스를 가진 태그를 찾아 준다.
     *
     * 진짜 파서가 아니다 — 갱신 경로가 붙이는 핸들러를 눌러 볼 수 있을 만큼만
     * 한다. 이게 없으면 버튼에 걸린 코드가 테스트에서 한 번도 안 돌아서,
     * "아이템이 안 바뀐다" 같은 회귀를 그대로 통과시킨다.
     */
    querySelectorAll(sel) {
      // 같은 innerHTML 에는 같은 노드를 돌려줘야 한다. 매번 새로 만들면 렌더러가
      // 건 핸들러가 버려져서, 테스트에서 버튼을 눌러도 아무 일이 안 일어난다.
      if (this._parsedFor !== this._html) {
        this._parsedFor = this._html;
        this._parsed = new Map();
      }
      if (this._parsed.has(sel)) return this._parsed.get(sel);
      const cls = sel.replace(/^\./, "");
      const out = [];
      const re = new RegExp(`<(\\w+)([^>]*class="[^"]*\\b${cls}\\b[^"]*"[^>]*)>`, "g");
      let m;
      while ((m = re.exec(this._html))) {
        const node = makeEl(m[1]);
        for (const [, k, v] of m[2].matchAll(/data-(\w+)="([^"]*)"/g)) node.dataset[k] = v;
        out.push(node);
      }
      this._parsed.set(sel, out);
      return out;
    },
  };
  // 패널 안에서 `q(".title")` 처럼 찾는다. 클래스마다 노드를 하나씩 만들어 둔다.
  const bag = new Map();
  el.querySelector = (sel) => {
    if (!bag.has(sel)) bag.set(sel, makeEl());
    return bag.get(sel);
  };
  return el;
}

function runRenderer(settings = {}) {
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
        getSettings: () =>
          Promise.resolve({ mood: "chatty", pet: "", hat: "wizard", weapon: "sword", ...settings }),
        setSettings: () => Promise.resolve({}),
        onSettings() {},
        openSettings() {},
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
    clearTimeout() {},
    console,
  };
  sandbox.globalThis = sandbox;
  vm.createContext(sandbox);
  vm.runInContext(script, sandbox, { filename: "renderer/index.html" });
  return { root, push: (agents, nudge, chatter) => onAgents(agents, nudge, chatter), doc, sandbox };
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

test.skip("아이템을 고르면 그 자리에서 바뀐다 — 설정 창으로 옮김", () => {
  const app = runRenderer();
  app.push([AGENT]);
  const pet = app.root.children[0];
  const weapon = pet.querySelector(".weapon");
  const before = weapon.src;

  // 지금 든 것과 다른 무기를 고른다.
  const buttons = pet.querySelector(".weapons").querySelectorAll(".wbtn");
  assert.ok(buttons.length > 1, "고를 무기가 있어야 한다");
  // 어느 것이 지금 것인지는 모른다. 다른 것을 누를 때까지 눌러 본다.
  // 새 상태가 오기를 기다리지 않는다 — 누른 그 순간 바뀌어야 한다.
  let changed = false;
  for (const b of buttons) {
    b.onclick({ stopPropagation() {} });
    if (weapon.src !== before) { changed = true; break; }
  }
  assert.ok(changed, "클릭 즉시 다시 그려야 한다");
});

test("먼저 말을 걸면 말풍선이 뜬다", () => {
  const app = runRenderer();
  app.push([AGENT]);
  const pet = app.root.children[0];
  const bubble = pet.querySelector(".nudge");
  assert.equal(bubble.classList.contains("on"), false, "평소에는 떠 있지 않다");

  app.push([AGENT], {
    kind: "waiting",
    text: "다 썼어. 보러 올래?",
    quote: "고쳤습니다.",
    session: "t1",
    showMs: 12000,
  });
  assert.ok(bubble.classList.contains("on"), "말풍선이 떠야 한다");
  assert.match(bubble.innerHTML, /보러 올래/);
  assert.match(bubble.innerHTML, /고쳤습니다/, "에이전트가 쓴 말도 같이 보여준다");
});

test("설정 버튼은 설정 창을 연다", () => {
  const app = runRenderer();
  app.push([AGENT]);
  const pet = app.root.children[0];
  const hush = pet.querySelector(".hush");
  assert.match(hush.textContent, /설정/, "패널에서 고르던 것은 설정 창으로 갔다");
  let opened = false;
  app.sandbox.window.pet.openSettings = () => (opened = true);
  hush.onclick({ stopPropagation() {} });
  assert.ok(opened, "누르면 설정 창이 열려야 한다");
});

test("조용히면 말풍선이 안 뜬다", async () => {
  const app = runRenderer({ mood: "quiet" });
  // 설정은 메인에서 비동기로 온다. 진짜 차단은 메인이 하고(말을 아예 안 만든다),
  // 렌더러의 검사는 두 번째 방어선이다 — 그 방어선이 도착한 뒤를 본다.
  await new Promise((r) => setImmediate(r));
  app.push([AGENT]);
  const pet = app.root.children[0];
  app.push([AGENT], { kind: "waiting", text: "부르는 중", showMs: 12000 });
  assert.equal(pet.querySelector(".nudge").classList.contains("on"), false);
});

test("혼잣말은 조용히 뜬다 — 예산도 클릭도 없이", () => {
  const app = runRenderer();
  app.push([AGENT]);
  const pet = app.root.children[0];
  const el = pet.querySelector(".mutter");
  assert.equal(el.classList.contains("on"), false);

  app.push([AGENT], null, { text: "뭔가 열심히 치고 있어", tool: "Bash", session: "t1", showMs: 7000 });
  assert.ok(el.classList.contains("on"), "혼잣말이 떠야 한다");
  assert.equal(el.textContent, "뭔가 열심히 치고 있어");
});

test("말풍선이 있으면 혼잣말은 건너뛴다", () => {
  const app = runRenderer();
  app.push([AGENT]);
  const pet = app.root.children[0];
  app.push([AGENT], { kind: "waiting", text: "다 썼어", showMs: 12000 }, { text: "읽는 중", session: "t1" });
  assert.ok(pet.querySelector(".nudge").classList.contains("on"));
  assert.equal(pet.querySelector(".mutter").classList.contains("on"), false, "둘이 겹치면 어느 쪽도 안 읽힌다");
});

test("살아 있다는 보고는 갱신을 다 마친 뒤에 나온다", () => {
  const app = runRenderer();
  let beats = 0;
  app.sandbox.window.pet.alive = () => (beats += 1);
  app.push([AGENT]);
  assert.equal(beats, 1, "한 번 갱신에 한 번");

  // 갱신 도중 터지면 보고도 없어야 한다 — 그게 심장박동의 존재 이유다.
  // 말풍선을 그리다 터뜨린다. 상태는 멀쩡히 남으므로 뒤따르는 갱신에는 영향이 없다.
  const brokenNudge = { kind: "waiting", showMs: 12000, get text() { throw new Error("갱신 중 사고"); } };
  try {
    app.push([AGENT], brokenNudge);
  } catch {
    /* 실제 렌더러에서는 콜백이 통째로 죽는다 */
  }
  assert.equal(beats, 1, "터진 갱신은 살아 있다고 보고하지 않는다");

  app.push([AGENT]);
  assert.equal(beats, 2, "다시 정상으로 돌면 보고도 돌아온다");
});
