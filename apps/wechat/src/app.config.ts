export default defineAppConfig({
  darkmode: true,
  entryPagePath: "pages/index/index",
  lazyCodeLoading: "requiredComponents",
  pages: ["pages/index/index"],
  themeLocation: "theme.json",
  window: {
    backgroundColor: "@backgroundColor",
    backgroundTextStyle: "@backgroundTextStyle",
    navigationBarBackgroundColor: "@navigationBarBackgroundColor",
    navigationBarTextStyle: "@navigationBarTextStyle",
    navigationBarTitleText: "Chronelle",
  },
});
