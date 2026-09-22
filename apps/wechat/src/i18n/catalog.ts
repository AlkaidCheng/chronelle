export const supportedLocales = ["zh-CN", "en-US"] as const;

export type AppLocale = (typeof supportedLocales)[number];

const catalog = {
  "en-US": {
    eyebrow: "WeChat Mini Program",
    title: "Events",
    description: "Plans and occasions shared with your Chronelle workspace.",
    signInTitle: "Continue with WeChat",
    signInDetail:
      "Chronelle verifies your WeChat identity, then uses its own revocable session.",
    signInAction: "Continue",
    linkTitle: "Link an existing account",
    linkDetail:
      "Sign in once with your Chronelle account to connect this WeChat identity.",
    loginLabel: "Email or username",
    passwordLabel: "Password",
    linkAction: "Link and continue",
    onboardingTitle: "Welcome to Chronelle",
    onboardingDetail: "Confirm the name shown to people you collaborate with.",
    displayNameLabel: "Display name",
    onboardingAction: "Finish setup",
    restoring: "Restoring your workspace",
    loading: "Loading your Events",
    offlineTitle: "You are offline",
    offlineDetail: "Reconnect to load protected workspace data.",
    retry: "Try again",
    configurationTitle: "Mini Program setup is incomplete",
    configurationDetail:
      "Configure the API origin and CloudBase environment before building this package.",
    errorTitle: "Chronelle could not load this view",
    errorDetail: "Your data is unchanged. Try the request again.",
    emptyTitle: "No Events here yet",
    emptyDetail: "Events created on the web will appear here automatically.",
    loadMore: "Load more",
    workspace: "Workspace",
    account: "Account",
    signOut: "Sign out",
    unscheduled: "No date set",
    sharedBy: "Shared by {name}",
    sharedWith: "Shared with {count}",
    ownEvent: "Your workspace",
    roleOwner: "Owner",
    roleEditor: "Editor",
    roleViewer: "Viewer",
    eventOverview: "Event overview",
    location: "Location",
    descriptionLabel: "Details",
    access: "Access",
    inheritedAccess: "Through {name}",
    permissionLostTitle: "This Event is no longer available",
    permissionLostDetail:
      "Its sharing or workspace access may have changed since you opened it.",
    backToEvents: "Back to Events",
    sessionExpired: "Your session ended. Sign in again to continue.",
    signInFailed:
      "We could not sign you in. Check your connection and try again.",
    linkFailed:
      "The account could not be linked. Check the credentials and try again.",
    storageFailed:
      "Secure local session storage is unavailable on this device.",
  },
  "zh-CN": {
    eyebrow: "微信小程序",
    title: "活动",
    description: "查看 Chronelle 工作空间中的计划、行程与共同安排。",
    signInTitle: "使用微信继续",
    signInDetail: "Chronelle 验证微信身份后，会签发独立且可撤销的登录会话。",
    signInAction: "继续",
    linkTitle: "关联已有账户",
    linkDetail: "请使用 Chronelle 账户登录一次，将当前微信身份与账户关联。",
    loginLabel: "邮箱或用户名",
    passwordLabel: "密码",
    linkAction: "关联并继续",
    onboardingTitle: "欢迎使用 Chronelle",
    onboardingDetail: "请确认与他人协作时显示的名称。",
    displayNameLabel: "显示名称",
    onboardingAction: "完成设置",
    restoring: "正在恢复工作空间",
    loading: "正在加载活动",
    offlineTitle: "当前处于离线状态",
    offlineDetail: "连接网络后即可读取受保护的工作空间数据。",
    retry: "重试",
    configurationTitle: "小程序配置尚未完成",
    configurationDetail: "构建前请配置 API 地址与 CloudBase 环境。",
    errorTitle: "暂时无法加载",
    errorDetail: "数据没有发生变化，请稍后重试。",
    emptyTitle: "这里还没有活动",
    emptyDetail: "在网页版创建的活动会自动显示在这里。",
    loadMore: "加载更多",
    workspace: "工作空间",
    account: "账户",
    signOut: "退出登录",
    unscheduled: "尚未设置日期",
    sharedBy: "由 {name} 分享",
    sharedWith: "已与 {count} 人分享",
    ownEvent: "你的工作空间",
    roleOwner: "所有者",
    roleEditor: "编辑者",
    roleViewer: "查看者",
    eventOverview: "活动概览",
    location: "地点",
    descriptionLabel: "详情",
    access: "访问权限",
    inheritedAccess: "通过 {name} 获得",
    permissionLostTitle: "无法再访问此活动",
    permissionLostDetail: "该活动的分享设置或工作空间权限可能已发生变化。",
    backToEvents: "返回活动列表",
    sessionExpired: "登录会话已结束，请重新登录。",
    signInFailed: "暂时无法登录，请检查网络后重试。",
    linkFailed: "账户关联失败，请检查登录信息后重试。",
    storageFailed: "当前设备无法使用安全的本地会话存储。",
  },
} as const satisfies Record<AppLocale, Record<string, string>>;

export type MessageKey = keyof (typeof catalog)["en-US"];

export function resolveLocale(language: string | undefined): AppLocale {
  return language?.toLowerCase().startsWith("en") === true ? "en-US" : "zh-CN";
}

export function getMessages(
  locale: AppLocale,
): Readonly<Record<MessageKey, string>> {
  return catalog[locale];
}

export function interpolate(
  template: string,
  values: Readonly<Record<string, string | number>>,
): string {
  return template.replace(/\{([A-Za-z][A-Za-z0-9]*)\}/gu, (match, key) =>
    key in values ? String(values[key]) : match,
  );
}
