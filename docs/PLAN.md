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
- 手機可用（觸控、窄螢幕版面）；iPhone 上在使用者第一次點擊後才建立／恢復 `AudioContext`
- GitHub Actions：push 到 `main` 時執行測試 → build → 部署到 GitHub Pages

### MVP 不包含（之後再說）

- 存檔／分享 pattern（localStorage、URL）
- Swing、音量／音色參數調整、每軌靜音／獨奏
- 多個 pattern、歌曲模式、MIDI、匯出音訊

---

## 2. 技術選擇

| 項目 | 選擇 | 理由 |
| --- | --- | --- |
| 建置工具 | Vite（`base: "/beat-grid/"`） | 零設定的 TS 支援，產出純靜態檔案 |
| 語言 | TypeScript（`strict: true`） | 型別保護核心邏輯 |
| UI | 原生 DOM API（不使用框架） | 畫面簡單；減少依賴 |
| 測試 | Vitest（核心用 `node` 環境，UI 用 `jsdom`） | 與 Vite 整合 |
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
│                                    │ trigger(voice, time)      │
│                                    ▼                           │
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
2. 每次喚醒時，讀取 `audioContext.currentTime`，把落在 `[now, now + lookahead)`（lookahead 約 100 ms）內、尚未排程的步數全部算出來。
3. 對每個要發聲的步數呼叫 `voice.trigger(ctx, time)`，`time` 是精確的音訊時鐘時間，由 Web Audio 在音訊執行緒上準時播放。
4. 「哪些步數要在什麼時間播放」完全由純函式 `scheduler.collectDueSteps()` 計算，可單元測試；外層 `transport` 只負責計時器與呼叫。
5. BPM 變更時，從下一個尚未排程的步數開始套用新的步長，不會跳拍。

### 播放位置高亮

- 音訊排程比畫面早最多 lookahead 時間，所以不能「排程時就高亮」。
- 排程時把 `{ step, time }` 推進 `playhead-queue`；`requestAnimationFrame` 迴圈每幀以 `audioContext.currentTime` 呼叫純函式 `currentStepAt(queue, now)` 取得應高亮的步數，再更新 DOM。

### iPhone／行動裝置音訊解鎖

- 頁面載入時**不**建立 `AudioContext`。
- 第一次使用者手勢（播放鈕的 `pointerdown`／`click`，或任一格子點擊）時：建立（或 `resume()`）`AudioContext`，並播放一個極短的無聲 buffer，以解鎖 iOS Safari。
- 解鎖邏輯集中在 `audio/audio-unlock.ts`，以 `ensureAudioContext()` 對外提供，冪等（重複呼叫安全）。
- 監聽 `visibilitychange`／`statechange`，iOS 背景中斷後回到前景時重新 `resume()`。

---

## 4. 模組切分與目錄結構

```
beat-grid/
├── index.html
├── vite.config.ts            # base: "/beat-grid/"，Vitest 設定
├── tsconfig.json
├── eslint.config.js
├── .prettierrc
├── package.json
├── .github/workflows/deploy.yml
├── docs/PLAN.md
├── src/
│   ├── core/                 # 純函式，無副作用
│   │   ├── tracks.ts         # TrackId、TRACKS、STEP_COUNT 常數
│   │   ├── pattern.ts        # 建立／切換／清除 pattern
│   │   ├── tempo.ts          # BPM 夾限、步長計算
│   │   ├── sequencer-state.ts# AppState 與 reducer
│   │   ├── scheduler.ts      # lookahead 排程計算
│   │   └── playhead-queue.ts # 由音訊時間推算目前步數
│   ├── audio/                # Web Audio 外殼
│   │   ├── audio-unlock.ts   # 建立／恢復 AudioContext、iOS 解鎖
│   │   ├── voices/
│   │   │   ├── voice.ts      # Voice 介面
│   │   │   ├── kick.ts
│   │   │   ├── snare.ts
│   │   │   ├── hihat.ts
│   │   │   ├── clap.ts
│   │   │   └── noise.ts      # 共用白噪音 buffer
│   │   └── transport.ts      # setTimeout 迴圈 + 呼叫 scheduler
│   ├── ui/                   # DOM 渲染
│   │   ├── grid-view.ts
│   │   ├── transport-view.ts
│   │   └── styles.css
│   └── app/
│       ├── store.ts          # 持有 state、dispatch、subscribe
│       ├── playhead.ts       # rAF 迴圈
│       └── main.ts           # 組裝點
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
export function clampBpm(bpm: number): number;       // 非數字 → DEFAULT_BPM，四捨五入
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
export function enqueue(q: PlayheadQueue, items: { step: number; time: number }[]): PlayheadQueue;
export function currentStepAt(q: PlayheadQueue, now: number): { step: number | null; queue: PlayheadQueue };

// audio/voices/voice.ts
export interface Voice {
  trigger(ctx: BaseAudioContext, destination: AudioNode, time: number): void;
}
```

---

## 6. 合成音色設計（初版方向，由 architect 定案）

| 軌 | 做法 |
| --- | --- |
| Kick | Sine oscillator，頻率從 ~150 Hz 指數下滑到 ~50 Hz（約 0.1 s），增益包絡快速起音、~0.5 s 衰減 |
| Snare | 白噪音 → highpass（~1 kHz）＋ triangle 音調成分（~180 Hz），各自短衰減（~0.2 s） |
| Hi-hat | 白噪音 → bandpass／highpass（~7–10 kHz），極短衰減（~0.05 s） |
| Clap | 白噪音 → bandpass（~1.5 kHz），3–4 次相隔 ~10 ms 的短脈衝 + 一段較長尾音 |

- 包絡參數抽成純資料（例如 `KICK_PARAMS`），可測試數值範圍。
- 白噪音 buffer 每個 `AudioContext` 只產生一次並快取。
- 所有 voice 接到同一個 master `GainNode`，避免爆音（預設 0.8）。
- 停止增益時用 `exponentialRampToValueAtTime` 到 0.001，不可 ramp 到 0。

---

## 7. 測試策略

| 層 | 測試方式 |
| --- | --- |
| `core/*` | 純單元測試，Vitest `node` 環境，目標覆蓋率 100% |
| `audio/voices/*` | 以手寫的 fake `AudioContext`（記錄建立的節點與排程呼叫）驗證：在正確時間 `start`／`stop`、包絡 ramp 目標正確 |
| `audio/transport.ts` | 以 fake timer（`vi.useFakeTimers`）＋ fake clock 驗證：tick 時呼叫 voice、stop 後不再排程 |
| `audio/audio-unlock.ts` | fake `AudioContext` 工廠，驗證冪等與 `resume()` |
| `ui/*` | `jsdom`：渲染 64 個格子、點擊派送正確 action、高亮 class 正確 |
| 手動 | 桌機 Chrome／Firefox／Safari、iPhone Safari 實機聽感與時間穩定度 |

TDD 循環：紅（寫失敗測試）→ 綠（最小實作）→ 重構。每個任務完成時 `npm test`、`npm run lint`、`npm run typecheck`、`npm run build` 都必須通過。

---

## 8. 代理分工

| 代理 | 模型 | 負責 |
| --- | --- | --- |
| **architect** | opus | 困難任務：lookahead scheduler、transport、音色合成設計、iOS 音訊解鎖、最終 code review |
| **implementer** | sonnet | 中等任務：pattern／state／tempo 純函式、UI 格子與控制列、store、一般 TDD 實作 |
| **runner** | haiku | 簡單／重複任務：專案骨架設定、執行 test/lint/build、修正格式與型別小錯誤、更新 README、回報結果 |

分派規則詳見 `CLAUDE.md`。

---

## 9. 任務清單

> 格式：`[ID] 任務` — 難度 — 代理。每個任務一個（或少數幾個）commit，依序進行。
> 「驗收」為完成條件。

### 階段 0：專案骨架

- [ ] **T0.1** 初始化 Vite + TypeScript 專案（`package.json`、`tsconfig.json` strict、`index.html`）— 簡單 — runner
  - 驗收：`npm run dev` 能開出空白頁；`npm run build` 成功
- [ ] **T0.2** `vite.config.ts` 設定 `base: "/beat-grid/"` 與 Vitest（預設 `node`，`src/ui/**` 用 `jsdom`）— 簡單 — runner
  - 驗收：`npm test` 能跑一個 placeholder 測試
- [ ] **T0.3** ESLint + Prettier 設定，加入 `lint`、`format`、`typecheck` scripts — 簡單 — runner
  - 驗收：`npm run lint`、`npm run typecheck` 通過
- [ ] **T0.4** GitHub Actions `deploy.yml`：push `main` → `npm ci` → lint → typecheck → test → build → upload `dist` → deploy-pages — 中等 — implementer
  - 驗收：workflow YAML 通過語法檢查；PR 上只跑 test/build，不部署

### 階段 1：核心純函式（TDD）

- [ ] **T1.1** `core/tracks.ts` 常數與型別 — 簡單 — runner
- [ ] **T1.2** `core/pattern.ts`：`createEmptyPattern`、`toggleStep`（含越界 step 防護、不可變性）、`clearPattern`、`activeTracksAt` — 中等 — implementer
  - 驗收：測試涵蓋切換兩次還原、原物件未被修改、越界不改變
- [ ] **T1.3** `core/tempo.ts`：`clampBpm`（邊界 60/200、NaN、小數）、`stepDurationSeconds` — 簡單 — implementer
- [ ] **T1.4** `core/sequencer-state.ts`：`initialState`、`reducer` 處理五種 action — 中等 — implementer
  - 驗收：每個 action 都有測試；未知狀態轉換（如重複 play）為 no-op
- [ ] **T1.5** `core/scheduler.ts`：`startScheduler`、`collectDueSteps` — 困難 — architect
  - 驗收測試要點：
    - 120 BPM、lookahead 0.1 s，一次取出正確數量的步與時間
    - 16 步後回繞到 0
    - 連續呼叫不重複、不遺漏步
    - 中途改 BPM 只影響之後的步
    - `now` 遠落後時（分頁被背景暫停後恢復）不會一次爆量補播：跳到 `now` 重新對齊
- [ ] **T1.6** `core/playhead-queue.ts`：`enqueue`、`currentStepAt`（丟棄已過期項目）— 中等 — implementer

### 階段 2：音訊層

- [ ] **T2.1** 測試用 fake `AudioContext`（`src/audio/testing/fake-audio-context.ts`），記錄節點、`start/stop`、`AudioParam` 排程呼叫 — 中等 — implementer
- [ ] **T2.2** `audio/audio-unlock.ts`：`ensureAudioContext()` 延遲建立、`resume()`、iOS 無聲 buffer 解鎖、冪等 — 困難 — architect
- [ ] **T2.3** `audio/voices/noise.ts` + `voice.ts` 介面 + master gain — 中等 — architect
- [ ] **T2.4** `audio/voices/kick.ts` — 困難 — architect
- [ ] **T2.5** `audio/voices/snare.ts` — 困難 — architect
- [ ] **T2.6** `audio/voices/hihat.ts` — 中等 — architect
- [ ] **T2.7** `audio/voices/clap.ts` — 困難 — architect
- [ ] **T2.8** `audio/transport.ts`：`start(getState)`／`stop()`，`setTimeout` 喚醒 + `collectDueSteps` + `voice.trigger` + 回報排程到 playhead queue — 困難 — architect
  - 驗收：fake timers 測試；stop 後無殘留計時器；BPM 變更即時生效

### 階段 3：UI

- [ ] **T3.1** `app/store.ts`：`createStore(reducer, initial)`，`getState`／`dispatch`／`subscribe` — 中等 — implementer
- [ ] **T3.2** `ui/grid-view.ts`：渲染 4×16 按鈕（`aria-pressed`、軌名標籤），點擊派送 `toggleStep`，依 state 更新 — 中等 — implementer
- [ ] **T3.3** `ui/transport-view.ts`：播放／停止鈕、BPM 滑桿 + 數字輸入（同步、夾限）、清除全部 — 中等 — implementer
- [ ] **T3.4** 播放位置高亮：`app/playhead.ts` rAF 迴圈 + `grid-view` 的 `setCurrentStep(step | null)` — 中等 — implementer
- [ ] **T3.5** `ui/styles.css`：響應式版面（手機上格子可橫向捲動或縮小；觸控目標 ≥ 32px）、每 4 步分組視覺、高亮樣式 — 中等 — implementer
- [ ] **T3.6** `app/main.ts` 組裝：store ↔ views ↔ transport ↔ unlock；第一次手勢解鎖音訊 — 中等 — implementer

### 階段 4：收尾

- [ ] **T4.1** 執行全部 test/lint/typecheck/build，修正小錯誤並回報 — 簡單 — runner
- [ ] **T4.2** 更新 README（實際指令、截圖位置、已知限制）— 簡單 — runner
- [ ] **T4.3** 手動驗證清單（桌機三瀏覽器 + iPhone Safari）文件化 — 簡單 — runner
- [ ] **T4.4** 最終 code review：架構邊界、計時正確性、記憶體洩漏（節點斷開、計時器清除）、可存取性 — 困難 — architect

---

## 10. 風險與對策

| 風險 | 對策 |
| --- | --- |
| 背景分頁 `setTimeout` 被節流 → 漏拍或補播爆量 | `collectDueSteps` 偵測落後並重新對齊；lookahead 100 ms 提供緩衝 |
| iOS 靜音開關導致 Web Audio 無聲 | README 註明；（選做）播放無聲 `<audio>` 技巧另列為後續任務 |
| 快速連點播放／停止造成重複計時器 | transport 內部單一 timer id，start 為冪等 |
| 合成節點累積造成記憶體壓力 | 每個 voice 的節點在 `stop` 後自然回收；不保存參照 |
| GitHub Pages 子路徑資源 404 | `base: "/beat-grid/"`；CI build 後檢查 `dist/index.html` 資源路徑 |
