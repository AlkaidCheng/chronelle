import { NextIntlClientProvider } from "next-intl";
import type { ComponentType, ReactNode } from "react";

import en from "../messages/en.json";

type Wrapper = ComponentType<{ readonly children: ReactNode }>;

/**
 * Every unit test renders inside the messages provider with English, the
 * locale the assertions are written against; a caller's own wrapper nests
 * inside it.
 */
export function withIntl(Inner?: Wrapper): Wrapper {
  return function IntlWrapper({ children }: { readonly children: ReactNode }) {
    return (
      <NextIntlClientProvider locale="en" messages={en}>
        {Inner === undefined ? children : <Inner>{children}</Inner>}
      </NextIntlClientProvider>
    );
  };
}
