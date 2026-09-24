import { existsSync, readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

const require = createRequire(import.meta.url);

interface PackageJson {
  readonly version: string;
  readonly dependencies?: Readonly<Record<string, string>>;
  readonly peerDependencies?: Readonly<Record<string, string>>;
}

/** A package's manifest as Node would find it from a file, exports aside. */
function manifest(name: string, from?: string): PackageJson {
  const resolver = from === undefined ? require : createRequire(from);
  for (const directory of resolver.resolve.paths(name) ?? []) {
    const file = join(directory, name, "package.json");
    if (existsSync(file))
      return JSON.parse(readFileSync(file, "utf8")) as PackageJson;
  }
  throw new Error(`${name} is not installed`);
}

/** Whether a version satisfies an exact version or a caret range, as npm reads them. */
function satisfies(version: string, range: string): boolean {
  if (!range.startsWith("^")) return version === range;
  const [low, installed] = [range.slice(1), version].map((value) =>
    value.split(".").map((part) => Number.parseInt(part, 10)),
  );
  const [major = 0, minor = 0, patch = 0] = low ?? [];
  const [vMajor = 0, vMinor = 0, vPatch = 0] = installed ?? [];
  if (vMajor !== major) return false;
  if (major === 0 && vMinor !== minor) return false;
  if (vMinor !== minor) return vMinor > minor;
  return vPatch >= patch;
}

// The renderer, Babel preset, and webpack runner Taro builds the Mini Program
// with declare the versions they support; outside them the build fails or the
// app fails at launch.
const taroReact = manifest("@tarojs/react");
const babelPresetTaro = manifest(
  "babel-preset-taro",
  require.resolve("@tarojs/cli"),
);
const webpackRunner = manifest(
  "@tarojs/webpack5-runner",
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
    ["webpack", webpackRunner.peerDependencies?.webpack],
    ["postcss", webpackRunner.peerDependencies?.postcss],
    ["sass", webpackRunner.peerDependencies?.sass],
  ])("installs a %s that Taro supports (%s)", (name, range) => {
    expect(range).toBeDefined();
    const version = manifest(name).version;
    expect(
      satisfies(version, range ?? ""),
      `${name} ${version} is outside ${range}`,
    ).toBe(true);
  });

  it("reads exact versions and caret ranges the way npm does", () => {
    expect(satisfies("18.3.1", "^18")).toBe(true);
    expect(satisfies("19.3.0", "^18")).toBe(false);
    expect(satisfies("0.14.2", "^0.14.0")).toBe(true);
    expect(satisfies("0.19.0", "^0.14.0")).toBe(false);
    expect(satisfies("7.29.7", "^7.24.4")).toBe(true);
    expect(satisfies("7.20.0", "^7.24.4")).toBe(false);
    expect(satisfies("5.91.0", "5.91.0")).toBe(true);
    expect(satisfies("5.111.1", "5.91.0")).toBe(false);
  });
});
