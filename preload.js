"use strict";

const { contextBridge, ipcRenderer } = require("electron");

/**
 * 렌더러에 주는 것은 둘뿐이다: 상태를 받는 구독과 종료.
 * 파일 접근도 노드도 넘기지 않는다 — 렌더러는 그림만 그린다.
 */
contextBridge.exposeInMainWorld("pet", {
  onAgents: (fn) => ipcRenderer.on("agents", (_e, agents, nudge, chatter) => fn(agents, nudge, chatter)),
  quit: () => ipcRenderer.send("quit"),
  alive: () => ipcRenderer.send("alive"),
  openSession: (id, dashboard) => ipcRenderer.send("open-session", id, dashboard === true),
  drag: (dx, dy) => ipcRenderer.send("drag", dx, dy),
  setInteractive: (on) => ipcRenderer.send("interactive", on),
  // 깔려 있는 스프라이트 팩. 파일 경로만 넘긴다 — 읽는 것은 <img> 가 한다.
  pets: () => ipcRenderer.invoke("pets"),
  getSettings: () => ipcRenderer.invoke("settings:get"),
  setSettings: (patch) => ipcRenderer.invoke("settings:set", patch),
  onSettings: (fn) => ipcRenderer.on("settings", (_e, s) => fn(s)),
  openSettings: () => ipcRenderer.send("settings:open"),
  memoryList: () => ipcRenderer.invoke("memory:list"),
  memoryApprove: (name, dir) => ipcRenderer.invoke("memory:approve", name, dir),
  memoryTarget: () => ipcRenderer.invoke("memory:target"),
  memoryReject: (name, reason) => ipcRenderer.invoke("memory:reject", name, reason),
  curatorState: () => ipcRenderer.invoke("curator:state"),
  curatorRun: () => ipcRenderer.invoke("curator:run"),
  heartbeat: () => ipcRenderer.invoke("heartbeat:get"),
});
