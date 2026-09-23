export default defineAppConfig({
  darkmode: true,
  entryPagePath: "pages/index/index",
  lazyCodeLoading: "requiredComponents",
  pages: ["pages/index/index", "pages/event/index"],
  subPackages: [
    {
      root: "features/event-editor",
      pages: ["index"],
    },
    {
      root: "features/planning",
      pages: ["index"],
    },
    {
      root: "features/task-editor",
      pages: ["index"],
    },
  ],
  themeLocation: "theme.json",
  window: {
    backgroundColor: "@backgroundColor",
    backgroundTextStyle: "@backgroundTextStyle",
    navigationBarBackgroundColor: "@navigationBarBackgroundColor",
    navigationBarTextStyle: "@navigationBarTextStyle",
    navigationBarTitleText: "Chronelle",
  },
});
