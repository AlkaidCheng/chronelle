import { createRequire } from "node:module";

import { describe, expect, it } from "vitest";

const require = createRequire(import.meta.url);

interface PackageJson {
  readonly version: string;
  readonly dependencies?: Readonly<Record<string, string>>;
  readonly peerDependencies?: Readonly<Record<string, string>>;
}

function manifest(name: string, from?: string): PackageJson {
  const path = require.resolve(
    `${name}/package.json`,
    from === undefined ? undefined : { paths: [from] },
  );
  return require(path) as PackageJson;
}

/** Whether a version satisfies a caret range, as npm reads one. */
function satisfiesCaret(version: string, range: string): boolean {
  const [low, installed] = [range.replace(/^\^/u, ""), version].map((value) =>
    value.split(".").map((part) => Number.parseInt(part, 10)),
  );
  const [major = 0, minor = 0, patch = 0] = low ?? [];
  const [vMajor = 0, vMinor = 0, vPatch = 0] = installed ?? [];
  if (vMajor !== major) return false;
  if (major === 0 && vMinor !== minor) return false;
  if (vMinor !== minor) return vMinor > minor;
  return vPatch >= patch;
}

// The renderer and Babel preset Taro builds the Mini Program with declare the
// React and Babel lines they support; a newer major compiles but fails at launch.
const taroReact = manifest("@tarojs/react");
const babelPresetTaro = manifest(
  "babel-preset-taro",
  require.resolve("@tarojs/cli"),
);

describe("Mini Program Taro toolchain", () => {
  it.each([
    ["react", taroReact.peerDependencies?.react],
    ["react-dom", taroReact.peerDependencies?.react],
    ["@babel/core", babelPresetTaro.peerDependencies?.["@babel/core"]],
    [
      "@babel/preset-react",
      babelPresetTaro.peerDependencies?.["@babel/preset-react"],
    ],
    ["react-refresh", babelPresetTaro.peerDependencies?.["react-refresh"]],
    ["@babel/runtime", babelPresetTaro.dependencies?.["@babel/runtime"]],
  ])("installs a %s that Taro supports (%s)", (name, range) => {
    expect(range).toBeDefined();
    const version = manifest(name).version;
    expect(
      satisfiesCaret(version, range ?? ""),
      `${name} ${version} is outside ${range}`,
    ).toBe(true);
  });

  it("reads caret ranges the way npm does", () => {
    expect(satisfiesCaret("18.3.1", "^18")).toBe(true);
    expect(satisfiesCaret("19.3.0", "^18")).toBe(false);
    expect(satisfiesCaret("0.14.2", "^0.14.0")).toBe(true);
    expect(satisfiesCaret("0.19.0", "^0.14.0")).toBe(false);
    expect(satisfiesCaret("7.29.7", "^7.24.4")).toBe(true);
    expect(satisfiesCaret("7.20.0", "^7.24.4")).toBe(false);
  });
});
