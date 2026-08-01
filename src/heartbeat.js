"use strict";

const fs = require("fs");
const os = require("os");
const path = require("path");

/**
 * 심장 박동 — 언제 깨어날지.
 *
 * OpenClaw 의 `HEARTBEAT.md` 에서 가져왔다. 일정을 코드에 박지 않고 **사람이
 * 평문으로 쓰는 파일**에 둔다. 하루에 몇 번 도는지가 곧 돈이라, 그걸 우리가
 * 정해 놓고 안 보이는 데 숨기는 것은 옳지 않다.
 *
 *     매일 09:00 — 지난 하루를 훑는다
 *     매일 18:00 — 한 번 더
 *     켤 때 — 마지막으로 돈 지 12시간이 넘었으면 한 번
 *
 * 파서는 일부러 작다. 못 읽은 줄은 **버리지 않고 남겨서 보여 준다** — 조용히
 * 무시하면 사람은 자기가 쓴 일정이 도는 줄 알고 기다린다.
 */

const HOME = process.env.KIBITZ_PET_HOME || path.join(os.homedir(), ".kibitz-pet");
const FILE = path.join(HOME, "HEARTBEAT.md");

const TEMPLATE = `# 심장 박동

펫이 언제 깨어나 지난 작업을 훑을지. 한 줄에 하나씩, 한국어로 쓰면 된다.
훑을 때마다 코드 에이전트를 한 번 부르므로 (Sonnet 기준 회당 약 $0.05) 너무
자주 두지 않는 편이 좋다.

    매일 09:00
    매일 18:00
    켤 때

읽을 수 있는 형식은 셋이다:

  매일 HH:MM      그 시각에 한 번
  N시간마다        마지막으로 돈 지 N시간이 지났으면
  켤 때            앱을 켰을 때, 마지막으로 돈 지 12시간이 넘었으면

매일 09:00
매일 18:00
켤 때
`;

function ensure() {
  try {
    if (!fs.existsSync(FILE)) {
      fs.mkdirSync(HOME, { recursive: true });
      fs.writeFileSync(FILE, TEMPLATE);
    }
  } catch {
    /* 못 만들어도 기본 일정으로 돈다 */
  }
}

const DAILY = /^매일\s+(\d{1,2}):(\d{2})/;
const EVERY = /^(\d+)\s*시간\s*마다/;
const BOOT = /^켤\s*때/;

/**
 * 일정을 읽는다.
 *
 * @returns {{ daily: number[], everyHours: number|null, onBoot: boolean, unread: string[] }}
 *          `daily` 는 자정부터의 분.
 */
function parse(text) {
  const out = { daily: [], everyHours: null, onBoot: false, unread: [] };
  for (const raw of String(text || "").split("\n")) {
    const line = raw.trim();
    // 설명과 들여쓴 예시는 일정이 아니다.
    if (!line || line.startsWith("#") || line.startsWith(">") || /^\s{4}/.test(raw)) continue;
    if (raw !== raw.trimStart()) continue;

    const d = DAILY.exec(line);
    if (d) {
      const h = Number(d[1]);
      const m = Number(d[2]);
      if (h < 24 && m < 60) out.daily.push(h * 60 + m);
      else out.unread.push(line);
      continue;
    }
    const e = EVERY.exec(line);
    if (e) {
      const n = Number(e[1]);
      if (n > 0) out.everyHours = Math.min(out.everyHours ?? n, n);
      else out.unread.push(line);
      continue;
    }
    if (BOOT.test(line)) {
      out.onBoot = true;
      continue;
    }
    // 문장처럼 보이는 줄만 못 읽었다고 알린다. 아무 글이나 다 걸면 시끄럽다.
    if (/[0-9]|매일|시간|때/.test(line)) out.unread.push(line);
  }
  return out;
}

function load() {
  ensure();
  try {
    return parse(fs.readFileSync(FILE, "utf8"));
  } catch {
    return parse(TEMPLATE);
  }
}

/**
 * 지금 돌 때인가.
 *
 * 순수 함수로 둔다. 시각에 얽힌 규칙은 눈으로 봐서 틀린 것을 못 찾는다 —
 * 이 저장소에서 이미 두 번 그랬다.
 *
 * @param plan   `parse` 의 결과
 * @param lastRun 마지막으로 돈 시각(ms). 없으면 0
 * @param now    지금(ms)
 * @param booted 방금 켰는가
 */
function due(plan, lastRun, now, { booted = false } = {}) {
  if (booted && plan.onBoot && now - lastRun > 12 * 3_600_000) return "켤 때";

  if (plan.everyHours && now - lastRun >= plan.everyHours * 3_600_000) {
    return `${plan.everyHours}시간마다`;
  }

  const d = new Date(now);
  const minutes = d.getHours() * 60 + d.getMinutes();
  for (const at of plan.daily) {
    // 그 시각을 지났고, 오늘 그 시각 이후로 아직 안 돌았으면.
    if (minutes < at) continue;
    const todayAt = new Date(d);
    todayAt.setHours(Math.floor(at / 60), at % 60, 0, 0);
    if (lastRun < todayAt.getTime()) return `매일 ${String(Math.floor(at / 60)).padStart(2, "0")}:${String(at % 60).padStart(2, "0")}`;
  }
  return null;
}

module.exports = { load, parse, due, ensure, FILE, TEMPLATE };
