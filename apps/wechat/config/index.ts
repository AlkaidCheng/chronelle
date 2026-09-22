import { defineConfig, type UserConfigExport } from "@tarojs/cli";

const config: UserConfigExport<"webpack5"> = {
  projectName: "chronelle",
  date: "2026-09-21",
  designWidth: 750,
  deviceRatio: {
    375: 2,
    640: 1.17,
    750: 1,
    828: 0.905,
  },
  sourceRoot: "src",
  outputRoot: "dist/weapp",
  framework: "react",
  compiler: "webpack5",
  cache: {
    enable: false,
  },
  mini: {
    postcss: {
      pxtransform: {
        enable: true,
        config: {},
      },
      cssModules: {
        enable: false,
        config: {
          namingPattern: "module",
          generateScopedName: "[name]__[local]___[hash:base64:5]",
        },
      },
    },
  },
};

export default defineConfig<"webpack5">(config);
