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

const { app, BrowserWindow, ipcMain, screen, shell } = require("electron");
const path = require("node:path");
const { spawn } = require("node:child_process");
const { liveAgents } = require("./src/reader");

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
  win.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true });
  win.loadFile(path.join(__dirname, "renderer", "index.html"));

  // 상태를 밀어 준다. 렌더러가 물어보지 않아도 되게 — 폴링은 한 곳에서만.
  const push = () => {
    if (!win || win.isDestroyed()) return;
    win.webContents.send("agents", liveAgents());
  };
  push();
  timer = setInterval(push, POLL_MS);

  win.on("closed", () => {
    if (timer) clearInterval(timer);
    timer = null;
    win = null;
  });
}

ipcMain.on("quit", () => app.quit());

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
