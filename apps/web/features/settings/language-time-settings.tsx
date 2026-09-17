"use client";

import { useTranslations } from "next-intl";
import { useId, useMemo, useState } from "react";
import type { PreferencesRequest } from "@chronelle/schemas";

import { ErrorNotice } from "../../components/feedback";
import { LocaleControl } from "../../components/locale-control";
import {
  deviceTimeZone,
  type HourCycle,
  type WeekStart,
} from "../../i18n/active-preferences";
import { formatDateTime } from "../../lib/format";
import { useSessionQuery, useUpdatePreferences } from "../../lib/queries";
import { useClock } from "../../lib/use-clock";
import { useDisplayPreferences } from "../../lib/use-display-preferences";
import { isKnownTimeZone, zoneOffsetLabel } from "../../lib/zone";

/**
 * Language & time: the language (also kept on the account), the time zone
 * (the device's, or one chosen from the zones the browser knows), the
 * clock, and the first day of the week. Each change is kept on the
 * account and applies at once; a line under the clock shows the moment.
 * The controls show a choice from the moment it is made: the pending keys
 * overlay the session's user until the account has answered.
 */
export function LanguageTimeSettings() {
  const t = useTranslations("preferences");
  const session = useSessionQuery();
  const update = useUpdatePreferences();
  const [pending, setPending] = useState<PreferencesRequest>({});
  const user = session.data?.user;
  const id = useId();
  const now = useClock();
  const { locale } = useDisplayPreferences();
  const choose = (input: PreferencesRequest) => {
    setPending((current) => ({ ...current, ...input }));
    update.mutate(input, { onSettled: () => setPending({}) });
  };
  const timeZone =
    pending.timeZone !== undefined
      ? pending.timeZone
      : (user?.timeZone ?? null);
  const hourCycle =
    pending.hourCycle !== undefined
      ? pending.hourCycle
      : (user?.hourCycle ?? null);
  const weekStart =
    pending.weekStart !== undefined
      ? pending.weekStart
      : (user?.weekStart ?? null);
  const segment = <Value extends string | number | null>(
    name: string,
    legend: string,
    value: Value,
    choices: readonly { readonly value: Value; readonly label: string }[],
    choose: (value: Value) => void,
  ) => (
    <fieldset className="theme-group settings-group">
      <legend>{legend}</legend>
      <div className="theme-segment">
        {choices.map((choice) => (
          <label key={String(choice.value)}>
            <input
              checked={value === choice.value}
              name={`${id}-${name}`}
              onChange={() => choose(choice.value)}
              type="radio"
            />
            <span>{choice.label}</span>
          </label>
        ))}
      </div>
    </fieldset>
  );
  return (
    <div className="settings-preferences">
      <LocaleControl
        legend={t("language")}
        onChange={(choice) =>
          update.mutate({ locale: choice === "system" ? null : choice })
        }
      />
      <TimeZoneField
        onChange={(timeZone) => choose({ timeZone })}
        value={timeZone}
      />
      {segment<HourCycle | null>(
        "hour-cycle",
        t("timeFormat"),
        hourCycle,
        [
          { value: null, label: t("fromLanguage") },
          { value: "h12", label: t("twelveHour") },
          { value: "h23", label: t("twentyFourHour") },
        ],
        (value) => choose({ hourCycle: value }),
      )}
      <p className="settings-note settings-now">
        {t("now", {
          time: formatDateTime(new Date(now).toISOString(), locale),
        })}
      </p>
      {segment<WeekStart | null>(
        "week-start",
        t("weekStart"),
        weekStart,
        [
          { value: null, label: t("fromLanguage") },
          { value: 1, label: t("monday") },
          { value: 7, label: t("sunday") },
        ],
        (value) => choose({ weekStart: value }),
      )}
      {update.isError ? <ErrorNotice error={update.error} /> : null}
    </div>
  );
}

/**
 * The zones the browser knows, always with the device's zone and UTC: some
 * engines leave UTC out of their list, and an older one lists nothing.
 */
function knownTimeZones(): readonly string[] {
  let listed: readonly string[] = [];
  try {
    listed = Intl.supportedValuesOf("timeZone");
  } catch {
    listed = [];
  }
  return [...new Set([...listed, deviceTimeZone(), "UTC"])];
}

const readable = (zone: string) => zone.replaceAll("_", " ");

/**
 * The time zone: Device (named, with its offset) or any zone the browser
 * knows, grouped by region with its current offset; a search field above
 * the list narrows it by name or offset.
 */
function TimeZoneField({
  onChange,
  value,
}: {
  readonly onChange: (timeZone: string | null) => void;
  readonly value: string | null;
}) {
  const t = useTranslations("preferences");
  const id = useId();
  const [query, setQuery] = useState("");
  const zones = useMemo(() => {
    const now = new Date();
    const names = new Set(knownTimeZones());
    if (value !== null && isKnownTimeZone(value)) names.add(value);
    const entries = [...names].map((zone) => {
      const [region, ...rest] = zone.split("/");
      return {
        zone,
        region: rest.length === 0 ? t("otherZones") : (region ?? ""),
        city: readable(rest.length === 0 ? zone : rest.join("/")),
        offset: zoneOffsetLabel(zone, now),
      };
    });
    const groups = new Map<string, typeof entries>();
    for (const entry of entries) {
      const group = groups.get(entry.region) ?? [];
      group.push(entry);
      groups.set(entry.region, group);
    }
    return [...groups]
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([region, members]) => ({
        region,
        members: members.sort((a, b) => a.city.localeCompare(b.city)),
      }));
  }, [t, value]);
  const needle = query.trim().toLowerCase();
  const matches = (entry: { city: string; region: string; offset: string }) =>
    needle === "" ||
    `${entry.region}/${entry.city}`.toLowerCase().includes(needle) ||
    entry.offset.toLowerCase().includes(needle);
  const device = deviceTimeZone();
  return (
    <div className="settings-group settings-zone">
      <label className="field">
        <span>{t("timeZone")}</span>
        <select
          id={`${id}-zone`}
          onChange={(event) =>
            onChange(event.target.value === "" ? null : event.target.value)
          }
          value={value ?? ""}
        >
          <option value="">
            {t("deviceZone", {
              zone: readable(device),
              offset: zoneOffsetLabel(device),
            })}
          </option>
          {zones.map(({ region, members }) => {
            const shown = members.filter(
              (entry) => entry.zone === value || matches(entry),
            );
            return shown.length === 0 ? null : (
              <optgroup key={region} label={region}>
                {shown.map((entry) => (
                  <option key={entry.zone} value={entry.zone}>
                    {`${entry.city} (${entry.offset})`}
                  </option>
                ))}
              </optgroup>
            );
          })}
        </select>
      </label>
      <label className="field settings-zone-search">
        <span className="visually-hidden">{t("searchZones")}</span>
        <input
          aria-controls={`${id}-zone`}
          onChange={(event) => setQuery(event.target.value)}
          placeholder={t("searchZones")}
          type="search"
          value={query}
        />
      </label>
      <p className="settings-note">{t("timeZoneNote")}</p>
    </div>
  );
}
