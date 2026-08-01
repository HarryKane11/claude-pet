"use strict";

/**
 * kibitz 데스크탑 펫.
 *
 * 항상 위에 떠 있는 작은 투명 창 하나. 지금 돌고 있는 코드 에이전트의 상태를
 * 세션 파일에서 직접 읽어 캐릭터로 보여 준다 — kibitz 서버가 떠 있지 않아도 되고,
 * 훅을 깔 필요도 없다.
 *
 * 창은 마우스를 통과시키지 않는다(클릭해서 접을 수 있어야 한다). 대신 작고,
 * 드래그로 옮길 수 있고, 아무 에이전트도 안 돌면 스스로 숨는다 — 안 쓰는 동안
 * 화면을 차지하는 펫은 귀엽지 않다.
 */

const { app, BrowserWindow, ipcMain, screen, shell, powerMonitor } = require("electron");
const path = require("node:path");
const { spawn } = require("node:child_process");
const { liveAgents } = require("./src/reader");
const { listPets } = require("./src/pets");
const { nextNudge, nextChatter } = require("./src/nudges");
const settings = require("./src/settings");
const memory = require("./src/memory");
const curator = require("./src/curator");

const POLL_MS = 2000;
const W = 500;
const H = 660;

let win = null;
let timer = null;

function createWindow() {
  const { workArea } = screen.getPrimaryDisplay();
  win = new BrowserWindow({
    width: W,
    height: H,
    x: workArea.x + workArea.width - W - 24,
    y: workArea.y + workArea.height - H - 24,
    frame: false,
    transparent: true,
    resizable: false,
    hasShadow: false,
    skipTaskbar: true,
    alwaysOnTop: true,
    // 전체화면 앱 위에서도 보이게 — 펫이 숨으면 펫이 아니다.
    fullscreenable: false,
    webPreferences: {
      preload: path.join(__dirname, "preload.js"),
      contextIsolation: true,
      nodeIntegration: false,
    },
  });

  win.setAlwaysOnTop(true, "screen-saver");

  /**
   * 창은 기본적으로 **클릭을 통과시킨다.**
   *
   * 투명한 창이라도 OS 는 창 영역 전체를 이 앱의 것으로 본다. 그래서 펫 옆의
   * 빈 공간이 그 아래 있는 것들(에디터·브라우저)의 클릭을 통째로 먹는다.
   * 화면 구석에 항상 떠 있는 물건이 그 구석을 못 쓰게 만들면 그건 방해다.
   *
   * `forward: true` 라서 통과 상태에서도 마우스 이동은 렌더러에 전달된다.
   * 렌더러가 커서 아래에 실제 요소가 있는지 보고 그때만 클릭을 받는다.
   */
  win.setIgnoreMouseEvents(true, { forward: true });
  win.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true });
  win.loadFile(path.join(__dirname, "renderer", "index.html"));

  // 상태를 밀어 준다. 렌더러가 물어보지 않아도 되게 — 폴링은 한 곳에서만.
  // 같은 내용을 다시 보내면 렌더러가 DOM 을 통째로 다시 그린다. 마우스가 올라가
  // 있던 슬롯도 그때 사라진다 — 2초마다 툴팁이 끊기는 원인이었다. 바뀐 것이 없으면
  // 아무것도 보내지 않는다.
  let lastSig = "";
  const push = () => {
    if (!win || win.isDestroyed()) return;
    const agents = liveAgents();
    // 말은 상태가 안 바뀌어도 나올 수 있다 — 기다린 시간이 흐른 것 자체가 사건이다.
    // 그래서 중복 차단보다 먼저 본다.
    const mood = settings.load().mood;
    const nudge = nextNudge(agents, { mood });
    // 혼잣말은 예산 밖이다. 말풍선이 나가는 동안에는 겹치지 않게 쉰다.
    const chatter = nudge ? null : nextChatter(agents, { mood });
    const sig = JSON.stringify(agents);
    if (sig === lastSig && !nudge && !chatter) return;
    lastSig = sig;
    win.webContents.send("agents", agents, nudge, chatter);
  };
  push();
  timer = setInterval(push, POLL_MS);

  // 화면에 없는 펫을 위해 파일을 읽을 이유가 없다. 잠자기·다른 데스크탑도 같다.
  const resume = () => {
    if (timer) return;
    push();
    timer = setInterval(push, POLL_MS);
  };
  const pause = () => {
    if (timer) clearInterval(timer);
    timer = null;
  };
  win.on("hide", pause);
  win.on("minimize", pause);
  win.on("show", resume);
  win.on("restore", resume);
  powerMonitor.on("suspend", pause);
  powerMonitor.on("resume", resume);

  /* 렌더러가 죽어도 창은 그대로 떠 있는다 — 흰 화면으로. 이 저장소에서 이미
     두 번 겪었고, 그때마다 프로세스는 멀쩡해 보였다. 그래서 프로세스가 살아
     있다는 것만으로는 아무것도 증명되지 않는다. */
  win.webContents.on("render-process-gone", () => {
    if (!quitting && win && !win.isDestroyed()) win.reload();
  });
  win.on("unresponsive", () => {
    if (!quitting && win && !win.isDestroyed()) win.reload();
  });

  win.on("close", (e) => {
    // 펫 창은 사람이 종료를 누를 때만 닫힌다.
    if (quitting) return;
    e.preventDefault();
  });

  win.on("closed", () => {
    if (timer) clearInterval(timer);
    timer = null;
    win = null;
    revive();
  });
}

ipcMain.handle("pets", () => listPets());

/**
 * 말수. 스위치 하나로는 안 된다 — 어떤 사람에게는 시간당 세 번도 많고,
 * 어떤 사람에게는 반려동물이 하루 두 마디만 하면 죽은 것 같다.
 */
ipcMain.handle("settings:get", () => settings.load());
ipcMain.handle("settings:set", (_e, patch) => {
  const next = settings.save(patch || {});
  applyAutostart(next);
  // 두 창이 같은 값을 봐야 한다. 설정 창에서 캐릭터를 바꾸면 펫도 즉시 바뀐다.
  for (const w of BrowserWindow.getAllWindows()) w.webContents.send("settings", next);
  return next;
});

/* 기억 — 승인 없이 쌓인 기억은 자기 기억이 아니라 남의 기억이다. */
ipcMain.handle("memory:list", () => memory.pending());
ipcMain.handle("memory:approve", (_e, name, dir) => {
  try {
    return { ok: true, ...memory.approve(name, dir) };
  } catch (e) {
    return { ok: false, reason: String(e && e.message) };
  }
});
ipcMain.handle("memory:reject", (_e, name, reason) => {
  memory.reject(name, reason);
  return { ok: true };
});
ipcMain.handle("curator:state", () => {
  try {
    return JSON.parse(require("fs").readFileSync(curator.STATE, "utf8"));
  } catch {
    return { lastRun: 0, runs: 0, cost: 0 };
  }
});

/**
 * 설정 창.
 *
 * 말풍선 패널에 다 우겨넣고 있었다. 캐릭터 고르기까지는 어떻게 됐는데 기억
 * 승인은 갈 자리가 없었다 — 목록을 보고 하나씩 판단하는 일은 12초 뒤 사라지는
 * 말풍선에서 할 수 있는 일이 아니다.
 */
let panel = null;
ipcMain.on("settings:open", () => {
  if (panel && !panel.isDestroyed()) {
    panel.show();
    panel.focus();
    return;
  }
  panel = new BrowserWindow({
    width: 660,
    height: 560,
    minWidth: 520,
    minHeight: 420,
    title: "claude-pet",
    backgroundColor: "#12151c",
    webPreferences: { preload: path.join(__dirname, "preload.js") },
  });
  panel.setMenuBarVisibility(false);
  panel.loadFile(path.join(__dirname, "renderer", "settings.html"));
  panel.on("closed", () => (panel = null));
});

/**
 * 끄는 것은 사람만 한다.
 *
 * 그 전까지는 무슨 일이 있어도 다시 세운다 — 창이 닫혀도, 렌더러가 죽어도,
 * 설정 창을 닫아도. 화면 구석에 있어야 할 것이 조용히 사라지면, 사라졌다는
 * 사실조차 한참 뒤에 알게 된다.
 */
let quitting = false;

/**
 * 로그인할 때 자동으로 뜨게.
 *
 * 앱이 살아남는 것과 기계가 꺼졌다 켜지는 것은 다른 문제다. 앞은 우리가
 * 책임지지만, 뒤는 사람이 켜 주기 전에는 하지 않는다.
 */
function applyAutostart(cfg) {
  if (process.platform === "linux") return; // 배포판마다 방식이 다르다
  const want = cfg.autostart === true;
  let now = false;
  try {
    now = app.getLoginItemSettings().openAtLogin === true;
  } catch {
    return;
  }
  // 이미 그 상태면 건드리지 않는다. `false` 로 다시 쓰는 것만으로도 서명 안 된
  // 빌드에서는 "Operation not permitted" 가 난다.
  if (want === now) return;
  try {
    app.setLoginItemSettings({ openAtLogin: want, openAsHidden: true });
  } catch {
    /* 아래에서 실제 상태를 다시 읽는다 */
  }
  // **정말 걸렸는지 다시 읽어서** 설정에 반영한다. 안 걸렸는데 켜졌다고
  // 표시하면, 다음 부팅에 펫이 없는 것을 보고서야 알게 된다.
  try {
    const real = app.getLoginItemSettings().openAtLogin === true;
    if (real !== want) settings.save({ autostart: real });
  } catch {
    /* 읽지도 못하면 그대로 둔다 */
  }
}

/** 없으면 다시 세운다. 껐다고 착각하고 사라져 있는 것이 가장 나쁘다. */
function revive() {
  if (quitting) return;
  if (!win || win.isDestroyed()) setTimeout(() => !quitting && createWindow(), 400);
}

/**
 * 심장박동.
 *
 * 렌더러가 예외로 죽으면 창은 떠 있고 프로세스도 살아 있는데 화면만 빈다.
 * 이 저장소에서 실제로 그랬고, `pgrep` 만 보고 고쳤다고 말한 적이 있다.
 * 그래서 렌더러가 스스로 살아 있다고 말하게 하고, 말이 끊기면 다시 띄운다.
 */
let lastBeat = Date.now();
const BEAT_TIMEOUT = 60_000;
ipcMain.on("alive", () => {
  lastBeat = Date.now();
});
let revives = 0;
setInterval(() => {
  if (quitting || !win || win.isDestroyed()) return;
  if (Date.now() - lastBeat < BEAT_TIMEOUT) {
    revives = 0;
    return;
  }
  // 다시 띄워도 계속 죽는다면 그건 일시적 사고가 아니라 버그다. 그때는 간격을
  // 늘린다 — 고쳐지지도 않는 것을 1분마다 다시 띄우면 화면만 깜빡인다.
  if (revives >= 5 && Date.now() - lastBeat < 5 * 60_000) return;
  revives += 1;
  lastBeat = Date.now();
  win.reload();
}, 15_000);
ipcMain.on("quit", () => {
  quitting = true;
  app.quit();
});

/** 커서가 캐릭터·패널 위에 있는 동안만 클릭을 받는다. */
ipcMain.on("interactive", (_e, on) => {
  if (!win || win.isDestroyed()) return;
  win.setIgnoreMouseEvents(!on, { forward: true });
});

/**
 * 사용자가 끌어 옮긴다.
 *
 * `-webkit-app-region: drag` 를 쓰지 않는 이유: 그걸 걸면 그 영역의 클릭이 통째로
 * 먹혀서 캐릭터를 눌러도 아무 일이 없다. 대신 마우스 이동량을 받아 창을 직접 옮기고,
 * 클릭과 드래그는 이동 거리로 구분한다.
 */
ipcMain.on("drag", (_e, dx, dy) => {
  if (!win || win.isDestroyed()) return;
  const [x, y] = win.getPosition();
  win.setPosition(Math.round(x + dx), Math.round(y + dy), false);
});

/**
 * 그 세션을 대시보드에서 연다.
 *
 * 주소는 `KIBITZ_URL` 로 바꿀 수 있다 — `kibitzer serve` 는 4000, `pnpm dev` 는 3000
 * 이라서 하나로 못 박으면 둘 중 하나는 늘 틀린다.
 */
/**
 * 그 대화방을 연다.
 *
 * Claude 데스크탑 앱이 `claude://resume` 딥링크를 등록해 두었으므로 그리로 보낸다 —
 * 사람이 원하는 건 트레이스 페이지가 아니라 **그 대화방으로 돌아가는 것**이다.
 * 열리지 않는 경우를 대비해 두 번째 인자로 대시보드 주소를 받는다.
 */
ipcMain.on("open-session", (_e, sessionId, fallbackToDashboard) => {
  if (sessionId && !fallbackToDashboard) {
    shell
      .openExternal(`claude://resume?sessionId=${encodeURIComponent(sessionId)}`)
      .catch(() => {
        // 딥링크를 못 열면 **이미 떠 있는 앱을 앞으로** 가져오는 것까지는 해 준다.
        // 아무 일도 안 일어나는 클릭보다는 낫다.
        if (process.platform === "darwin") spawn("open", ["-a", "Claude"], { stdio: "ignore" });
      });
    return;
  }
  const base = process.env.KIBITZ_URL || "http://localhost:4000";
  const url = sessionId ? `${base}/sessions/${encodeURIComponent(sessionId)}` : base;
  void shell.openExternal(url);
});

// 펫은 하나만 뜬다. 두 마리가 겹쳐 뜨면 어느 쪽이 진짜인지 알 수 없다.
if (!app.requestSingleInstanceLock()) {
  app.quit();
} else {
  app.on("second-instance", () => {
    if (win) {
      win.show();
      win.focus();
    }
  });
}

app.whenReady().then(() => {
  if (process.platform === "darwin" && app.dock) app.dock.hide();
  applyAutostart(settings.load());
  createWindow();
  app.on("activate", () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

/* 창이 다 닫혀도 끄지 않는다.
   설정 창을 닫는 순간 펫까지 사라지던 길이 여기 있었다 — `window-all-closed` 는
   "마지막 창" 을 세지, 어느 창인지는 보지 않는다. */
app.on("window-all-closed", () => {
  if (quitting) app.quit();
});

app.on("before-quit", (e) => {
  if (quitting) return;
  // 사람이 종료를 누르지 않았다면 이건 사고다. 대신 설정 창만 닫아 준다.
  e.preventDefault();
  for (const w of BrowserWindow.getAllWindows()) {
    if (w !== win) w.close();
  }
  revive();
});
