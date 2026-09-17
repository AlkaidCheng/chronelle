import { activeLocale } from "../i18n/active-locale";

interface Money {
  readonly amount: string;
  readonly currency: string;
}

function isDecimalAmount(amount: string): amount is `${number}` {
  return /^-?\d+(?:\.\d{1,4})?$/.exec(amount)?.[0] === amount;
}

/** Format decimal money without rounding away stored fractional digits. */
export function formatMoney(
  amount: string,
  currency: string,
  locale: string = activeLocale(),
): string {
  if (!isDecimalAmount(amount)) return `${currency} ${amount}`;
  return new Intl.NumberFormat(locale, {
    currency,
    maximumFractionDigits: 4,
    style: "currency",
  }).format(amount);
}

/** Sum four-decimal amounts by currency, retaining the first-seen currency order. */
export function sumMoneyByCurrency(entries: readonly Money[]): Money[] {
  const totals = new Map<string, bigint>();
  for (const { amount, currency } of entries) {
    if (!isDecimalAmount(amount)) {
      throw new RangeError(
        "Amounts must be decimals with at most four fractional digits.",
      );
    }
    const [integer, fraction = ""] = amount.split(".");
    const units = BigInt(`${integer}${fraction.padEnd(4, "0")}`);
    totals.set(currency, (totals.get(currency) ?? 0n) + units);
  }

  return [...totals].map(([currency, units]) => {
    const sign = units < 0n ? "-" : "";
    const magnitude = units < 0n ? -units : units;
    return {
      amount: `${sign}${magnitude / 10_000n}.${String(magnitude % 10_000n).padStart(4, "0")}`,
      currency,
    };
  });
}
