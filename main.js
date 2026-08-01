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
const { nextNudge } = require("./src/nudges");

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
    const nudge = nextNudge(agents, { mood });
    const sig = JSON.stringify(agents);
    if (sig === lastSig && !nudge) return;
    lastSig = sig;
    win.webContents.send("agents", agents, nudge);
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

  win.on("closed", () => {
    if (timer) clearInterval(timer);
    timer = null;
    win = null;
  });
}

ipcMain.handle("pets", () => listPets());

/**
 * 말수. 스위치 하나로는 안 된다 — 어떤 사람에게는 시간당 세 번도 많고,
 * 어떤 사람에게는 반려동물이 하루 두 마디만 하면 죽은 것 같다.
 */
let mood = "normal";
ipcMain.on("mood", (_e, m) => {
  mood = ["quiet", "normal", "chatty"].includes(m) ? m : "normal";
});

ipcMain.on("quit", () => app.quit());

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
  createWindow();
  app.on("activate", () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

// 창을 닫아도 앱이 살아 있을 이유가 없다.
app.on("window-all-closed", () => app.quit());
