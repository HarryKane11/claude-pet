"use strict";

const { contextBridge, ipcRenderer } = require("electron");

/**
 * 렌더러에 주는 것은 둘뿐이다: 상태를 받는 구독과 종료.
 * 파일 접근도 노드도 넘기지 않는다 — 렌더러는 그림만 그린다.
 */
contextBridge.exposeInMainWorld("pet", {
  onAgents: (fn) => ipcRenderer.on("agents", (_e, agents) => fn(agents)),
  quit: () => ipcRenderer.send("quit"),
  openSession: (id, dashboard) => ipcRenderer.send("open-session", id, dashboard === true),
  drag: (dx, dy) => ipcRenderer.send("drag", dx, dy),
});
