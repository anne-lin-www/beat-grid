import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

export const BASE_PATH = "/beat-grid/";

const ASSET_ATTRIBUTE_PATTERN =
  /\s(?:src|href)\s*=\s*(?:"([^"]*)"|'([^']*)')/gi;

/**
 * Returns every src/href value in the HTML that does not start with the base path.
 * @param {string} html
 * @param {string} [basePath]
 * @returns {string[]}
 */
export function findInvalidAssetPaths(html, basePath = BASE_PATH) {
  return [...html.matchAll(ASSET_ATTRIBUTE_PATTERN)]
    .map((match) => match[1] ?? match[2] ?? "")
    .filter((assetPath) => !assetPath.startsWith(basePath));
}

function main() {
  const htmlPath = fileURLToPath(
    new URL("../dist/index.html", import.meta.url),
  );
  const invalidPaths = findInvalidAssetPaths(readFileSync(htmlPath, "utf8"));
  if (invalidPaths.length > 0) {
    console.error(
      `dist/index.html has asset paths not starting with ${BASE_PATH}:`,
    );
    for (const assetPath of invalidPaths) console.error(`  ${assetPath}`);
    process.exit(1);
  }
  console.log(`dist/index.html: all asset paths start with ${BASE_PATH}`);
}

if (process.argv[1] === fileURLToPath(import.meta.url)) main();
