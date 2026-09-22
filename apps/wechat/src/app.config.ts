export default defineAppConfig({
  darkmode: true,
  entryPagePath: "pages/index/index",
  lazyCodeLoading: "requiredComponents",
  pages: ["pages/index/index", "pages/event/index", "pages/event-editor/index"],
  themeLocation: "theme.json",
  window: {
    backgroundColor: "@backgroundColor",
    backgroundTextStyle: "@backgroundTextStyle",
    navigationBarBackgroundColor: "@navigationBarBackgroundColor",
    navigationBarTextStyle: "@navigationBarTextStyle",
    navigationBarTitleText: "Chronelle",
  },
});
