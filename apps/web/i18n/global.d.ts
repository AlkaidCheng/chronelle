import type en from "../messages/en.json";
import type { Locale } from "./locales";

// Message keys and ICU parameters are checked against the English catalog.
declare module "next-intl" {
  interface AppConfig {
    Locale: Locale;
    Messages: typeof en;
  }
}
