#!/usr/bin/env node
"use strict";

/**
 * 펫을 띄운다.
 *
 * Electron 은 **선택 설치**로 둔다. 이 도구가 하는 일의 대부분(세션 파일을 읽어
 * 지금 무엇을 하는 중인지 알아내는 것)은 Node 만으로 되고, 창을 띄우는 데만
 * 100MB 짜리 런타임이 필요하다. 없으면 조용히 실패하지 않고 설치 방법을 말한다.
 */

const { spawn } = require("node:child_process");
const { join } = require("node:path");

const root = join(__dirname, "..");

let electron;
try {
  electron = require("electron");
} catch {
  console.error(`
The pet needs Electron, which is not installed.

  npm install --prefix "${root}" electron

Then run it again. Everything else here works without it — you can read the
current state with:  node -e "console.log(require('${root}/src/reader').liveAgents())"
`);
  process.exit(1);
}

const child = spawn(electron, [root], { stdio: "inherit" });
child.on("exit", (code) => process.exit(code ?? 0));
