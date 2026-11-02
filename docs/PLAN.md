# beat-grid 規劃文件（MVP）

網頁版鼓機／步進音序器。純前端靜態網頁，部署到 GitHub Pages。
本文件只做規劃；功能程式碼依照下方任務清單以 TDD 小步完成。

---

## 1. 目標與範圍

### MVP 包含

- 16 步 × 4 軌（大鼓 Kick、小鼓 Snare、Hi-hat、拍手 Clap）的格子，點擊切換開／關
- 播放時高亮目前步數
- 播放／停止、BPM 調整（60–200）、清除全部
- 鼓聲全部用 Web Audio API 即時合成，不使用任何音檔或第三方服務
- 使用 lookahead scheduler 精準排程（不使用單純 `setInterval` 直接發聲）
- 手機可用：窄螢幕每軌分兩排、每排 8 格，觸控目標 ≥ 32px，不可橫向捲動
- iPhone 上在使用者第一次 `click` 後才建立／恢復 `AudioContext`
- GitHub Actions：push 到 `main` 時執行測試 → build → 部署到 GitHub Pages

### MVP 不包含（之後再說）

- 存檔／分享 pattern（localStorage、URL）
- Swing、音量／音色參數調整、每軌靜音／獨奏
- 多個 pattern、歌曲模式、MIDI、匯出音訊

---

## 2. 技術選擇

| 項目 | 選擇 | 理由 |
| --- | --- | --- |
| 執行環境 | Node.js 24 LTS，以 `.nvmrc` 與 `package.json` 的 `engines` 固定 | 本機與 CI 版本一致 |
| 套件鎖定 | commit `package-lock.json`，CI 使用 `npm ci` | 可重現的安裝 |
| 建置工具 | Vite（`base: "/beat-grid/"`） | 零設定的 TS 支援，產出純靜態檔案 |
| 語言 | TypeScript（`strict: true`） | 型別保護核心邏輯 |
| UI | 原生 DOM API（不使用框架） | 畫面簡單；減少依賴 |
| 測試 | Vitest（核心用 `node` 環境，UI 用 `jsdom`）＋ `@vitest/coverage-v8` | 與 Vite 整合；`core/` 覆蓋率 100% 門檻 |
| Lint／格式 | ESLint（typescript-eslint）＋ Prettier | 一致的程式風格 |
| 部署 | GitHub Actions + `actions/deploy-pages` | 官方 Pages 流程 |

---

## 3. 架構設計

採用「純函式核心 + 薄的副作用外殼」（functional core, imperative shell）。

```
┌──────────────────────────── 瀏覽器 ────────────────────────────┐
│                                                                │
│  ui/（DOM，薄層）           app/（組裝與副作用）                  │
│  ┌──────────────┐  事件     ┌──────────────────┐               │
│  │ grid-view    │ ───────▶ │ store            │               │
│  │ transport-   │          │ (state + dispatch)│               │
│  │   view       │ ◀─────── │                  │               │
│  └──────────────┘  render  └────────┬─────────┘               │
│         ▲                           │ 讀取 pattern / bpm        │
│         │ 高亮步數                   ▼                          │
│  ┌──────┴───────┐         ┌──────────────────┐                │
│  │ playhead     │ ◀────── │ audio/transport  │ setTimeout     │
│  │ (rAF loop)   │ 排程紀錄 │ (lookahead 迴圈) │ 每 25ms tick   │
│  └──────────────┘         └────────┬─────────┘                │
│                                    │ trigger(ctx, sessionGain, │
│                                    ▼          time)            │
│                           ┌──────────────────┐                │
│                           │ audio/voices     │ Web Audio      │
│                           │ kick/snare/hat/  │ 節點合成        │
│                           │ clap             │                │
│                           └──────────────────┘                │
│                                                                │
│  core/（純函式，無 DOM、無 Web Audio、100% 單元測試）              │
│  pattern · tempo · sequencer-state · scheduler · playhead-queue│
└────────────────────────────────────────────────────────────────┘
```

### 依賴方向（必須遵守）

```
ui ──▶ app ──▶ core
        │
        └────▶ audio ──▶ core
```

- `core/` 不得 import `ui/`、`audio/`、`app/`，也不得使用 `window`、`document`、`AudioContext`、`Date.now()`、`setTimeout`。時間一律以參數傳入。
- `audio/` 只依賴 `core/` 與 Web Audio 型別；`AudioContext` 透過參數注入（方便用 fake 測試）。
- `ui/` 只負責 DOM 渲染與把使用者事件轉成 action，不含業務邏輯。
- `app/main.ts` 是唯一的組裝點（composition root）。

### Lookahead scheduler 原理

參考 Chris Wilson「A Tale of Two Clocks」的做法：

1. 以 `setTimeout`（約每 25 ms）喚醒一次排程迴圈 —— 計時器**只負責喚醒**，不直接發聲。
2. 每次喚醒時，讀取 `audioContext.currentTime`，把落在 `[now, now + lookahead)`（lookahead = 0.1 s）內、尚未排程的步數全部算出來。
3. 對每個要發聲的步數呼叫 `voice.trigger(ctx, sessionGain, time)`，`time` 是精確的音訊時鐘時間，由 Web Audio 在音訊執行緒上準時播放。
4. 「哪些步數要在什麼時間播放」完全由純函式 `scheduler.collectDueSteps()` 計算，可單元測試；外層 `transport` 只負責計時器與呼叫。
5. BPM 變更時，從下一個尚未排程的步數開始套用新的步長，不會跳拍。

#### 落後與重新對齊規則（`collectDueSteps`）

令 `d = stepDurationSeconds(bpm)`，排程器狀態為 `{ nextStep, nextStepTime }`。

- **輕微落後**（`now - lookahead ≤ nextStepTime < now`）：視為正常，照常輸出該步（Web Audio 會立即播放過去時間的事件）。
- **嚴重落後**（`nextStepTime < now - lookahead`，例如分頁被背景節流後恢復）：**重新對齊**，規則如下：
  1. 計算跳過的步數 `k = ceil((now - nextStepTime) / d)`（`k ≥ 1`）。
  2. `nextStep ← (nextStep + k) mod 16`
  3. `nextStepTime ← nextStepTime + k × d`（因此 `now ≤ nextStepTime < now + d`）
  4. 被跳過的 `k` 步**不輸出、不補播**；重新對齊後再照正常流程收集 `[now, now + lookahead)` 內的步數。
- 效果：保持原本的節拍相位（步數與時間仍對齊在同一條格線上），恢復後從「本來就該在這個時間點的那一步」繼續，不會一次爆量補播。

### 播放位置高亮

- 音訊排程比畫面早最多 lookahead 時間，所以不能「排程時就高亮」。
- 排程時把 `{ step, time }` 推進 `playhead-queue`；`requestAnimationFrame` 迴圈每幀以 `audioContext.currentTime` 呼叫純函式 `currentStepAt(queue, now)` 取得應高亮的步數，再更新 DOM。

### 停止播放

停止時必須立即靜音且畫面歸位：

1. `transport.stop()`：清除 `setTimeout`，不再排程。
2. **每次播放使用獨立的 session `GainNode`**：`transport.start()` 時建立一個新的 `GainNode` 接到 master gain，所有 voice 都接到這個 session gain；`stop()` 時對它呼叫 `disconnect()`，已排程但尚未播完的聲音（含未來 lookahead 內的事件與衰減尾音）都會被切斷，避免殘音。下一次播放再建立新的 session gain。
   - 若實測斷開時有爆音，再加入 ≤ 10 ms 的淡出後斷開（列為後續調整，不在 MVP 範圍內預先實作）。
3. **清空 playhead queue**（`clearQueue()` 回傳空佇列），並停止 rAF 迴圈。
4. **高亮設為 `null`**：`grid-view.setCurrentStep(null)`，畫面上不再有高亮格。
5. state 的 `isPlaying` 設為 `false`；下次播放從第 0 步開始（`startScheduler(ctx.currentTime + 小延遲)`）。

### iPhone／行動裝置音訊解鎖

- 頁面載入時**不**建立 `AudioContext`。
- **只使用 `click` 事件**解鎖（播放鈕或任一格子的 `click`）；**不使用** `pointerdown`、`touchstart`、`touchend`。理由：`click` 是 iOS／各瀏覽器一致承認的使用者啟用手勢，`touchstart`／`pointerdown` 在捲動、長按時行為不一致，且在部分 iOS 版本不被視為可解鎖音訊的手勢。
- 第一次 `click` 時：建立（或 `resume()`）`AudioContext`，並播放一個極短的無聲 buffer，以解鎖 iOS Safari。
- `new AudioContext()`、`resume()` 與無聲 buffer 的 `start()` 必須在 click handler 中**同步**呼叫（第一個 `await` 之前），再回傳 Promise 供呼叫端 `await`。
- 解鎖邏輯集中在 `audio/audio-unlock.ts`，以 `ensureAudioContext(): Promise<AudioContext>` 對外提供，冪等（重複呼叫回傳同一個 context）。
- 監聽 `visibilitychange`，iOS 背景中斷（`state` 為 `suspended`／`interrupted`）後，於下一次 `click` 時重新 `resume()`。

### 響應式版面

- **寬螢幕**：每軌一排，軌名在左、16 格橫排，每 4 格一組（組間加大間距）。
- **窄螢幕**（`max-width: 640px`）：每軌的軌名獨立一行，16 格**分成兩排、每排 8 格**（第 1–8 步、第 9–16 步）。
  - 以 CSS Grid 實作：每軌容器為 `grid-template-columns: repeat(16, …)`，窄螢幕改為 `repeat(8, …)`，DOM 結構不變。
- 觸控目標（每一格與所有按鈕）**≥ 32 × 32 px**。
- **不可橫向捲動**：在 320 px 寬的視窗下 `document.documentElement.scrollWidth ≤ clientWidth`。
  - 估算：8 × 32 px + 7 × 4 px 間距 = 284 px，加左右 16 px 邊距 = 316 px ≤ 320 px。
- 控制列（播放、BPM、清除）在窄螢幕換行排列。

---

## 4. 模組切分與目錄結構

```
beat-grid/
├── .nvmrc                    # 24
├── index.html
├── vite.config.ts            # base: "/beat-grid/"，Vitest 與覆蓋率設定
├── tsconfig.json
├── eslint.config.js
├── .prettierrc
├── package.json              # engines.node: ">=24 <25"
├── package-lock.json         # 需 commit
├── scripts/check-base-path.mjs # 檢查 dist/index.html 的資源路徑
├── .github/workflows/deploy.yml
├── docs/PLAN.md
└── src/
    ├── core/                 # 純函式，無副作用
    │   ├── tracks.ts         # TrackId、TRACK_IDS、STEP_COUNT 常數
    │   ├── pattern.ts        # 建立／切換／清除 pattern
    │   ├── tempo.ts          # BPM 夾限、步長計算
    │   ├── sequencer-state.ts# AppState 與 reducer
    │   ├── scheduler.ts      # lookahead 排程計算與重新對齊
    │   └── playhead-queue.ts # 由音訊時間推算目前步數
    ├── audio/                # Web Audio 外殼
    │   ├── testing/fake-audio-context.ts
    │   ├── audio-unlock.ts   # 建立／恢復 AudioContext、iOS 解鎖
    │   ├── master.ts         # master GainNode
    │   ├── voices/
    │   │   ├── voice.ts      # Voice 介面
    │   │   ├── noise.ts      # 共用白噪音 buffer
    │   │   ├── kick.ts       # 範本（architect）
    │   │   ├── snare.ts
    │   │   ├── hihat.ts
    │   │   └── clap.ts
    │   └── transport.ts      # setTimeout 迴圈、session gain、呼叫 scheduler
    ├── ui/                   # DOM 渲染
    │   ├── grid-view.ts
    │   ├── transport-view.ts
    │   └── styles.css
    └── app/
        ├── store.ts          # 持有 state、dispatch、subscribe
        ├── playhead.ts       # rAF 迴圈
        └── main.ts           # 組裝點
```

> 測試檔與原始碼並列：`src/core/pattern.ts` ↔ `src/core/pattern.test.ts`。

---

## 5. 資料結構

```ts
// core/tracks.ts
export const STEP_COUNT = 16;
export const TRACK_IDS = ["kick", "snare", "hihat", "clap"] as const;
export type TrackId = (typeof TRACK_IDS)[number];

// core/pattern.ts —— 不可變（readonly），所有更新回傳新物件
export type Steps = readonly boolean[];              // 長度 = STEP_COUNT
export type Pattern = Readonly<Record<TrackId, Steps>>;

export function createEmptyPattern(): Pattern;
export function toggleStep(p: Pattern, track: TrackId, step: number): Pattern;
export function clearPattern(): Pattern;             // 等同 createEmptyPattern
export function activeTracksAt(p: Pattern, step: number): TrackId[];

// core/tempo.ts
export const MIN_BPM = 60;
export const MAX_BPM = 200;
export const DEFAULT_BPM = 120;
export function clampBpm(bpm: number): number;       // 非有限數字 → DEFAULT_BPM，四捨五入後夾限
export function stepDurationSeconds(bpm: number): number; // 16 分音符 = 60 / bpm / 4

// core/sequencer-state.ts
export interface AppState {
  readonly pattern: Pattern;
  readonly bpm: number;
  readonly isPlaying: boolean;
}
export type Action =
  | { type: "toggleStep"; track: TrackId; step: number }
  | { type: "clearAll" }
  | { type: "setBpm"; bpm: number }
  | { type: "play" }
  | { type: "stop" };
export function initialState(): AppState;
export function reducer(state: AppState, action: Action): AppState;

// core/scheduler.ts
export const LOOKAHEAD_SECONDS = 0.1;
export interface SchedulerState {
  readonly nextStep: number;       // 0..15
  readonly nextStepTime: number;   // 音訊時鐘秒數
}
export interface ScheduledStep {
  readonly step: number;
  readonly time: number;
  readonly tracks: readonly TrackId[];   // 該步要發聲的軌（可為空）
}
export function startScheduler(startTime: number): SchedulerState;
export function collectDueSteps(
  state: SchedulerState,
  input: { now: number; lookahead: number; bpm: number; pattern: Pattern },
): { state: SchedulerState; due: ScheduledStep[] };

// core/playhead-queue.ts
export type PlayheadQueue = readonly { step: number; time: number }[];
export function enqueue(q: PlayheadQueue, items: readonly { step: number; time: number }[]): PlayheadQueue;
export function currentStepAt(q: PlayheadQueue, now: number): { step: number | null; queue: PlayheadQueue };
export function clearQueue(): PlayheadQueue;         // 回傳空佇列

// audio/voices/voice.ts
export interface Voice {
  trigger(ctx: BaseAudioContext, destination: AudioNode, time: number): void;
}
export type VoiceMap = Partial<Readonly<Record<TrackId, Voice>>>; // 未註冊的軌直接略過（M1 只有 kick）

// audio/transport.ts
export interface Transport {
  start(): void;   // 建立新的 session GainNode、開始 setTimeout 迴圈；已在播放時為 no-op
  stop(): void;    // 清除計時器、disconnect session gain；未播放時為 no-op
}
export function createTransport(deps: {
  ctx: BaseAudioContext;
  master: AudioNode;
  voices: VoiceMap;
  getState: () => Pick<AppState, "pattern" | "bpm">;
  onScheduled: (steps: readonly { step: number; time: number }[]) => void;
}): Transport;
```

---

## 6. 合成音色設計（kick 由 architect 定案為範本，其餘由 implementer 依範本實作）

| 軌 | 做法 |
| --- | --- |
| Kick | Sine oscillator，頻率從 ~150 Hz 指數下滑到 ~50 Hz（約 0.1 s），增益包絡快速起音、~0.5 s 衰減 |
| Snare | 白噪音 → highpass（~1 kHz）＋ triangle 音調成分（~180 Hz），各自短衰減（~0.2 s） |
| Hi-hat | 白噪音 → bandpass／highpass（~7–10 kHz），極短衰減（~0.05 s） |
| Clap | 白噪音 → bandpass（~1.5 kHz），3–4 次相隔 ~10 ms 的短脈衝 + 一段較長尾音 |

**kick 範本（T2.4）需確立、其他 voice 必須沿用的慣例：**

- 包絡與頻率參數抽成純資料常數（例如 `KICK_PARAMS`），並有測試檢查數值範圍。
- `trigger()` 只建立該次發聲所需的節點，接到傳入的 `destination`（session gain），不保存節點參照。
- 所有 source 都以 `start(time)`、`stop(time + duration)` 排程，不使用 `ctx.currentTime` 以外的時鐘。
- 增益 ramp 結束值用 `0.001`（`exponentialRampToValueAtTime` 不可 ramp 到 0）。
- 測試寫法：以 fake `AudioContext` 驗證節點種類、連線順序、`start`/`stop` 時間與 `AudioParam` 排程。
- 白噪音 buffer 每個 `AudioContext` 只產生一次並快取（`noise.ts`）。

---

## 7. 測試策略

| 層 | 測試方式 |
| --- | --- |
| `core/*` | 純單元測試，Vitest `node` 環境，**覆蓋率門檻 100%**（lines／branches／functions／statements），CI 不達標即失敗 |
| `audio/voices/*` | 以 fake `AudioContext`（記錄建立的節點與排程呼叫）驗證：在正確時間 `start`／`stop`、包絡 ramp 目標正確 |
| `audio/transport.ts` | 以 fake timer（`vi.useFakeTimers()`）＋ fake clock 驗證：tick 時呼叫 voice、stop 後不再排程、session gain 被斷開 |
| `audio/audio-unlock.ts` | fake `AudioContext` 工廠，驗證冪等、`resume()`、只綁定 `click` |
| `ui/*` | `jsdom`：渲染 64 個格子、點擊派送正確 action、高亮狀態正確 |
| 部署 | CI 在 build 後執行 `scripts/check-base-path.mjs`，確認 `dist/index.html` 引用的資源路徑都以 `/beat-grid/` 開頭 |
| 手動 | 桌機 Chrome／Firefox／Safari、iPhone Safari 實機聽感、時間穩定度、320 px 寬無橫向捲動 |

TDD 循環：紅（寫失敗測試）→ 綠（最小實作）→ 重構。每個任務完成時 `npm run lint`、`npm run typecheck`、`npm run test:coverage`、`npm run build` 都必須通過。

---

## 8. 代理分工

| 代理 | 模型 | 負責 |
| --- | --- | --- |
| **architect** | opus | 困難任務：lookahead scheduler、transport、kick 音色範本、iOS 音訊解鎖、最終 code review（含 snare／clap 審查） |
| **implementer** | sonnet | 中等任務：pattern／state／tempo 純函式、noise／voice 介面／master gain、依 kick 範本實作 snare／hi-hat／clap、UI、store、CI、M1 組裝 |
| **runner** | haiku | 簡單／重複任務：專案骨架設定、執行 test/lint/build、修正格式與型別小錯誤、更新 README、回報結果 |

分派規則詳見 `CLAUDE.md`。

---

## 9. 任務清單

> 格式：`[ID] 任務` — 難度 — 代理。每個任務一個（或少數幾個）commit，依列出的順序進行。
> 「驗收」為完成條件。任務 ID 為固定編號，順序調整時不重新編號。

### 階段 0：專案骨架

- [x] **T0.1** 初始化 Vite + TypeScript 專案（`package.json`、`tsconfig.json` strict、`index.html`）— 簡單 — runner
  - 驗收：`npm run dev` 能開出空白頁；`npm run build` 成功；`.nvmrc` 內容為 `24`、`package.json` 有 `"engines": { "node": ">=24 <25" }`；`package-lock.json` 已 commit
- [x] **T0.2** `vite.config.ts` 設定 `base: "/beat-grid/"` 與 Vitest（預設 `node`，`src/ui/**` 用 `jsdom`），加入 `@vitest/coverage-v8` — 簡單 — runner
  - 驗收：`npm test` 能跑一個 placeholder 測試；`npm run test:coverage` 對 `src/core/**` 設 lines／branches／functions／statements 皆 100% 門檻，未達標時指令以非 0 結束
- [x] **T0.3** ESLint + Prettier 設定，加入 `lint`、`format`、`typecheck` scripts — 簡單 — runner
  - 驗收：`npm run lint`、`npm run typecheck` 通過
- [x] **T0.4** GitHub Actions `deploy.yml` 與 `scripts/check-base-path.mjs` — 中等 — implementer
  - 流程：push `main` → `actions/setup-node`（`node-version-file: .nvmrc`、npm cache）→ `npm ci` → lint → typecheck → `npm run test:coverage` → build → `npm run check:base` → upload `dist` → deploy-pages
  - 驗收：PR 上只跑到 `check:base`，不部署；覆蓋率未達門檻時 CI 失敗；`check:base` 在 `dist/index.html` 中任何 `src`／`href` 資源路徑不以 `/beat-grid/` 開頭時失敗（以測試或刻意改壞 base 的方式驗證過）

### 階段 1：核心純函式（TDD）

- [x] **T1.1** `core/tracks.ts` 常數與型別 — 簡單 — runner
  - 驗收：測試確認 `STEP_COUNT === 16`、`TRACK_IDS` 依序為 kick／snare／hihat／clap 且長度 4
- [x] **T1.2** `core/pattern.ts`：`createEmptyPattern`、`toggleStep`（含越界 step 防護、不可變性）、`clearPattern`、`activeTracksAt` — 中等 — implementer
  - 驗收：測試涵蓋切換兩次還原、原物件未被修改、越界（-1、16、小數）不改變、`activeTracksAt` 依 `TRACK_IDS` 順序回傳
- [x] **T1.3** `core/tempo.ts`：`clampBpm`、`stepDurationSeconds` — 簡單 — implementer
  - 驗收：`clampBpm` 對 59→60、201→200、120.6→121、`NaN`／`Infinity`→120 有測試；`stepDurationSeconds(120) === 0.125`
- [x] **T1.4** `core/sequencer-state.ts`：`initialState`、`reducer` 處理五種 action — 中等 — implementer
  - 驗收：每個 action 都有測試；重複 play／stop 為 no-op（回傳同一物件）；`setBpm` 經 `clampBpm` 夾限
- [x] **T1.5** `core/scheduler.ts`：`startScheduler`、`collectDueSteps` — 困難 — architect
  - 驗收測試要點：
    - 120 BPM、lookahead 0.1 s，一次取出正確數量的步與時間
    - 16 步後回繞到 0
    - 連續呼叫不重複、不遺漏步
    - 中途改 BPM 只影響之後的步
    - 輕微落後（`now - lookahead ≤ nextStepTime < now`）：該步照常輸出、不跳步
    - 嚴重落後（`nextStepTime < now - lookahead`）：依 §3「落後與重新對齊規則」跳過 `k = ceil((now - nextStepTime) / d)` 步，被跳過的步不輸出；重新對齊後 `nextStep = (原 nextStep + k) mod 16`、`now ≤ nextStepTime < now + d`
      - 範例：120 BPM（d = 0.125），`{ nextStep: 3, nextStepTime: 1.0 }`、`now = 2.0` → `k = 8`，重新對齊為 `{ nextStep: 11, nextStepTime: 2.0 }`，接著輸出第 11 步（time 2.0）
    - 跨越 16 步邊界的重新對齊（例如 `nextStep = 14`、`k = 5` → `nextStep = 3`）
- [x] **T1.6** `core/playhead-queue.ts`：`enqueue`、`currentStepAt`（丟棄已過期項目）、`clearQueue` — 中等 — implementer
  - 驗收：`now` 早於第一項時回傳 `null`；`now` 介於兩項之間時回傳較早那一項並丟棄更早的項目；`clearQueue()` 後 `currentStepAt` 回傳 `null`；輸入佇列不被修改

### 階段 2：音訊層 → 里程碑 M1

- [x] **T2.1** 測試用 fake `AudioContext`（`src/audio/testing/fake-audio-context.ts`），記錄節點、連線、`start/stop`、`disconnect`、`AudioParam` 排程呼叫 — 中等 — implementer
  - 驗收：有自身的單元測試；可手動推進 `currentTime`
- [x] **T2.2** `audio/audio-unlock.ts`：`ensureAudioContext()` 延遲建立、`resume()`、iOS 無聲 buffer 解鎖、冪等 — 困難 — architect
  - 驗收：
    - 頁面載入時不建立 `AudioContext`
    - **解鎖只綁定 `click` 事件**；程式碼與測試中不出現 `pointerdown`、`touchstart`、`touchend` 監聽（測試以 spy `addEventListener` 驗證）
    - 建立 context、`resume()`、無聲 buffer `start()` 在第一個 `await` 前同步完成
    - 重複呼叫回傳同一個 context，不重複建立
    - `suspended` 狀態下再次 click 會呼叫 `resume()`
- [x] **T2.3** `audio/voices/noise.ts` + `voice.ts` 介面 + `audio/master.ts` master gain — 中等 — implementer
  - 驗收：同一個 context 呼叫兩次 `getNoiseBuffer` 回傳同一個 buffer；master gain 預設 0.8 並接到 `ctx.destination`
- [x] **T2.4** `audio/voices/kick.ts`（**範本**，確立 §6 慣例）— 困難 — architect
  - 驗收：以 fake ctx 驗證 oscillator 頻率下滑排程、增益 ramp 到 0.001、`start(time)`／`stop` 時間正確、只連到傳入的 destination；在 PR 中說明其他 voice 應沿用的寫法
- [ ] **T2.8** `audio/transport.ts`：`createTransport`、`start()`／`stop()`，`setTimeout` 喚醒 + `collectDueSteps` + `voice.trigger` + `onScheduled` 回報 — 困難 — architect（提前到 M1 之前）
  - 驗收（fake timers + fake ctx）：
    - 每次 `start()` 建立新的 session `GainNode` 並接到 master；voice 接到 session gain
    - `stop()` 後：計時器被清除（`vi.getTimerCount() === 0`）、session gain 被 `disconnect()`、之後推進時間不再呼叫任何 voice
    - 重複 `start()` 不產生第二個計時器；未播放時 `stop()` 為 no-op
    - `VoiceMap` 中未註冊的軌被略過、不報錯
    - BPM 變更於下一次 tick 生效
- [ ] **M1** 里程碑：只有 kick 一軌 + scheduler + transport + 播放鈕，部署到 GitHub Pages 實機試聽 — 中等 — implementer
  - 內容：`app/main.ts` 暫時版本，一個播放／停止鈕，固定 pattern（kick 落在第 0、4、8、12 步）、120 BPM；點擊時先 `await ensureAudioContext()` 再 `transport.start()`
  - 驗收：CI 部署成功；在 `https://anne-lin-www.github.io/beat-grid/` 以桌機與 iPhone Safari 聽到穩定的四拍 kick；切到背景再回來不會爆量補播；停止後立即無聲
- [ ] **T2.5** `audio/voices/snare.ts`（依 kick 範本）— 中等 — implementer
  - 驗收：以 fake ctx 驗證噪音分支經 highpass、triangle 分支、兩條增益 ramp 到 0.001、所有 source 在 `time` 開始並於衰減後 stop
- [ ] **T2.6** `audio/voices/hihat.ts`（依 kick 範本）— 中等 — implementer
  - 驗收：以 fake ctx 驗證使用共用噪音 buffer、經 ≥ 7 kHz 的濾波器、衰減 ≤ 0.1 s
- [ ] **T2.7** `audio/voices/clap.ts`（依 kick 範本）— 中等 — implementer
  - 驗收：以 fake ctx 驗證 3–4 次脈衝的增益排程時間間隔約 10 ms、之後有尾音衰減、經 bandpass 濾波器

### 階段 3：UI

- [ ] **T3.1** `app/store.ts`：`createStore(reducer, initial)`，`getState`／`dispatch`／`subscribe` — 中等 — implementer
  - 驗收：dispatch 後 subscriber 收到新 state；state 未改變（reducer 回傳同一物件）時不通知；`subscribe` 回傳的函式可取消訂閱
- [ ] **T3.2** `ui/grid-view.ts`：渲染 4 軌 × 16 個 `<button>`（`aria-pressed`、`aria-label` 如「Kick 第 1 步」、軌名標籤），點擊派送 `toggleStep`，依 state 更新 — 中等 — implementer
  - 驗收：jsdom 中可用 role／label 找到 64 個按鈕；點擊派送正確的 track／step；state 更新後 `aria-pressed` 同步
- [ ] **T3.3** `ui/transport-view.ts`：播放／停止鈕、BPM 滑桿 + 數字輸入（同步、夾限 60–200）、清除全部 — 中等 — implementer
  - 驗收：播放鈕文字／`aria-pressed` 隨 `isPlaying` 切換；輸入 250 後顯示 200 並派送 `setBpm`；清除鈕派送 `clearAll`
- [ ] **T3.4** 播放位置高亮與停止處理：`app/playhead.ts` rAF 迴圈 + `grid-view` 的 `setCurrentStep(step | null)` — 中等 — implementer
  - 驗收：播放中以 `currentStepAt` 結果高亮該步的整欄；**停止時清空 playhead queue（`clearQueue()`）、停止 rAF、`setCurrentStep(null)`，畫面上沒有任何高亮格**（以 fake rAF 與 fake clock 測試）
- [ ] **T3.5** `ui/styles.css`：響應式版面（見 §3「響應式版面」）、每 4 步分組視覺、高亮樣式 — 中等 — implementer
  - 驗收：寬螢幕每軌 16 格一排；`max-width: 640px` 時每軌兩排、每排 8 格；所有格子與按鈕 ≥ 32 × 32 px；320 px 寬視窗下無橫向捲動（DevTools 裝置模擬手動確認，結果記錄在 PR）
- [ ] **T3.6** `app/main.ts` 組裝：store ↔ views ↔ transport ↔ unlock；以完整 4 軌取代 M1 的暫時版本 — 中等 — implementer
  - 驗收：
    - 播放鈕 click handler 中**先 `await ensureAudioContext()`，成功後才 `dispatch({ type: "play" })`**；store 訂閱者看到 `isPlaying` 變 `true` 時才 `transport.start()`
    - `ensureAudioContext()` 失敗時不 dispatch play，並在畫面顯示錯誤訊息
    - stop 時依序：`transport.stop()`、清空 playhead queue、`setCurrentStep(null)`
    - 格子的 click 也會呼叫 `ensureAudioContext()`（不等待，只為解鎖）

### 階段 4：收尾

- [ ] **T4.1** 執行全部 lint／typecheck／test:coverage／build／check:base，修正小錯誤並回報 — 簡單 — runner
- [ ] **T4.2** 更新 README（實際指令、Node 版本、截圖位置、已知限制）— 簡單 — runner
- [ ] **T4.3** 手動驗證清單（桌機三瀏覽器 + iPhone Safari）文件化 — 簡單 — runner
  - 清單需包含：第一次 click 後才有聲音、停止後立即無殘音且無高亮、背景分頁恢復後不爆量補播、320 px 寬無橫向捲動、每格 ≥ 32 px
- [ ] **T4.4** 最終 code review — 困難 — architect
  - 範圍：架構邊界、計時正確性、記憶體洩漏（session gain 斷開、計時器與 rAF 清除、事件監聽）、可存取性
  - **必須審查 implementer 依範本實作的 `snare.ts` 與 `clap.ts`**（是否符合 §6 kick 範本慣例、聽感），`hihat.ts` 一併檢查

---

## 10. 風險與對策

| 風險 | 對策 |
| --- | --- |
| 背景分頁 `setTimeout` 被節流 → 漏拍或補播爆量 | `nextStepTime < now - lookahead` 時依 §3 規則重新對齊、跳過的步不補播；lookahead 100 ms 提供緩衝 |
| iOS 靜音開關導致 Web Audio 無聲 | README 註明；（選做）播放無聲 `<audio>` 技巧另列為後續任務 |
| iOS 不承認觸控事件為解鎖手勢 | 只用 `click`，並在 click handler 內同步建立／恢復 context |
| 停止後仍有已排程的聲音或尾音 | 每次播放使用獨立 session `GainNode`，stop 時 `disconnect()` |
| session gain 斷開瞬間爆音 | M1 實機試聽確認；若有，加入 ≤ 10 ms 淡出 |
| 快速連點播放／停止造成重複計時器 | transport 內部單一 timer id，`start` 為冪等；main 中以 `isPlaying` 狀態驅動 |
| 合成節點累積造成記憶體壓力 | voice 不保存節點參照；session gain 斷開後整串可被回收 |
| GitHub Pages 子路徑資源 404 | `base: "/beat-grid/"`；CI build 後以 `check:base` 檢查 `dist/index.html` |
| 本機與 CI 環境不一致 | `.nvmrc` + `engines` 固定 Node 24；commit `package-lock.json`，CI 用 `npm ci` |
| 依範本實作的 voice 品質不一 | kick 範本先在 M1 實機驗證；snare／clap 在 T4.4 由 architect 審查 |
