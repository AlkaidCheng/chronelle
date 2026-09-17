import { cookies, headers } from "next/headers";
import { getRequestConfig } from "next-intl/server";

import {
  acceptedLanguages,
  isLocale,
  localeCookie,
  negotiateLocale,
} from "./locales";
import { loadMessages } from "./messages";

/**
 * The locale of one request: the explicit choice in the cookie when there
 * is one, else the browser's languages negotiated against the list.
 */
export default getRequestConfig(async () => {
  const chosen = (await cookies()).get(localeCookie)?.value;
  const locale = isLocale(chosen)
    ? chosen
    : negotiateLocale(
        acceptedLanguages((await headers()).get("accept-language")),
      );
  return { locale, messages: await loadMessages(locale) };
});
