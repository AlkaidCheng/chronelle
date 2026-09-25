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
      root: "features/sharing",
      pages: ["index"],
    },
    {
      root: "features/history",
      pages: ["index"],
    },
    {
      root: "features/task-editor",
      pages: ["index"],
    },
    {
      root: "features/expense-editor",
      pages: ["index"],
    },
    {
      root: "features/account-preferences",
      pages: ["index"],
    },
    {
      root: "features/reminder-editor",
      pages: ["index"],
    },
    {
      root: "features/trash",
      pages: ["index"],
    },
    {
      root: "features/people",
      pages: ["index", "editor", "friends"],
    },
  ],
  themeLocation: "theme.json",
  window: {
    backgroundColor: "@backgroundColor",
    backgroundTextStyle: "@backgroundTextStyle",
    navigationBarBackgroundColor: "@navigationBarBackgroundColor",
    navigationBarTextStyle: "@navigationBarTextStyle",
    navigationBarTitleText: "LivTales",
  },
});
