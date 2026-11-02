# beat-grid

網頁版鼓機（步進音序器）MVP。在瀏覽器中點格子編排節奏，鼓聲全部由 Web Audio API 即時合成。

> 目前狀態：**規劃階段**。設計與任務清單見 [`docs/PLAN.md`](docs/PLAN.md)，開發規範見 [`CLAUDE.md`](CLAUDE.md)。下方指令在 T0 骨架任務完成後可用。

## 功能（MVP）

- 16 步 × 4 軌：大鼓、小鼓、Hi-hat、拍手；點擊格子切換
- 播放／停止、BPM 60–200、清除全部
- 播放時高亮目前步數
- Lookahead scheduler：以音訊時鐘精準排程，不受 UI 卡頓影響
- 純前端、無音檔、無第三方服務
- 手機可用：窄螢幕每軌分兩排、每排 8 格，不需橫向捲動；iPhone 需先點擊一次以啟動音訊

## 技術

Vite · TypeScript · Web Audio API · Vitest · ESLint · Prettier · GitHub Actions · GitHub Pages

## 本機執行

需求：Node.js 24（版本固定於 `.nvmrc`，可用 `nvm use` 切換）。

```bash
git clone https://github.com/anne-lin-www/beat-grid.git
```

```bash
cd beat-grid
```

```bash
npm ci
```

```bash
npm run dev
```

開啟 <http://localhost:5173/beat-grid/>。

其他指令：

| 指令 | 說明 |
| --- | --- |
| `npm test` | 執行單元測試（Vitest） |
| `npm run test:coverage` | 測試＋覆蓋率（`src/core/` 需 100%） |
| `npm run test:watch` | 監看模式，TDD 時使用 |
| `npm run lint` | ESLint 檢查 |
| `npm run typecheck` | TypeScript 型別檢查 |
| `npm run build` | 產出 `dist/` |
| `npm run check:base` | 檢查 `dist/index.html` 資源路徑含 `/beat-grid/` |
| `npm run preview` | 本機預覽 build 結果 |

## 部署到 GitHub Pages

專案已將 `vite.config.ts` 的 `base` 設為 `"/beat-grid/"`，網址為 `https://<帳號>.github.io/beat-grid/`。

1. 在 GitHub repo 進入 **Settings → Pages**。
2. **Build and deployment → Source** 選擇 **GitHub Actions**。
3. push 到 `main`，`.github/workflows/deploy.yml` 會依序執行：`npm ci` → lint → 型別檢查 → 測試與覆蓋率 → build → 資源路徑檢查 → 部署。PR 只執行檢查，不部署。
4. 到 **Actions** 分頁查看進度；完成後網址會顯示在 workflow 的 deploy 步驟與 Settings → Pages。

> 若 repo 名稱改變，記得同步修改 `vite.config.ts` 的 `base`。

## 已知限制

- iPhone 實體靜音開關開啟時，Web Audio 可能沒有聲音。
- 瀏覽器分頁在背景時計時器會被節流，節奏可能暫停或重新對齊。

## 專案結構

```
src/core/   純函式核心（pattern、tempo、state、scheduler）
src/audio/  Web Audio：音色合成、lookahead transport、音訊解鎖
src/ui/     DOM 畫面
src/app/    組裝點與狀態 store
```
