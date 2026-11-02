import { describe, expect, it } from "vitest";
import { findInvalidAssetPaths } from "./check-base-path.mjs";

describe("findInvalidAssetPaths", () => {
  it("accepts src and href values that start with the base path", () => {
    const html = `<script type="module" src="/beat-grid/assets/index.js"></script>
<link rel="stylesheet" href='/beat-grid/assets/index.css'>`;
    expect(findInvalidAssetPaths(html)).toEqual([]);
  });

  it("reports src and href values outside the base path", () => {
    const html = `<script src="/assets/index.js"></script>
<link href="assets/index.css"><a href="/beat-grid/ok">ok</a>`;
    expect(findInvalidAssetPaths(html)).toEqual([
      "/assets/index.js",
      "assets/index.css",
    ]);
  });

  it("returns nothing for html without asset attributes", () => {
    expect(findInvalidAssetPaths("<p>hello</p>")).toEqual([]);
  });
});
