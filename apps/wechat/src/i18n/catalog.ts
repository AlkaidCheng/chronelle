export const supportedLocales = ["zh-CN", "en-US"] as const;

export type AppLocale = (typeof supportedLocales)[number];

const catalog = {
  "en-US": {
    eyebrow: "WeChat Mini Program",
    title: "Your life, held together.",
    description:
      "Chronelle connects the people, plans, places, and memories that make up a life.",
    status: "Native workspace foundation ready",
    detail:
      "Sign-in and synchronized Events arrive in the next delivery slices.",
  },
  "zh-CN": {
    eyebrow: "微信小程序",
    title: "把生活的脉络，安放在一处。",
    description: "Chronelle 将构成生活的人、计划、地点与回忆，清晰地连接起来。",
    status: "原生工作空间基础已就绪",
    detail: "登录与同步活动将在后续交付中接入。",
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
