"use client";

import { useTranslations } from "next-intl";
import { useId, useMemo, useState } from "react";
import type { PreferencesRequest } from "@livtales/schemas";

import { ErrorNotice } from "../../components/feedback";
import { LocaleControl } from "../../components/locale-control";
import { deviceTimeZone } from "../../i18n/active-preferences";
import { formatDateTime } from "../../lib/format";
import { useSessionQuery, useUpdatePreferences } from "../../lib/queries";
import { useClock } from "../../lib/use-clock";
import { useDisplayPreferences } from "../../lib/use-display-preferences";
import { isKnownTimeZone, zoneOffsetLabel } from "../../lib/zone";
import { type SettingControl, SettingRow } from "./setting-row";

/**
 * Language & time, a row each: the language (also kept on the account), the
 * clock, with the moment under its name, the first day of the week, and
 * the time zone (the device's, or one chosen from the zones the browser
 * knows). Each change is kept on the account and applies at once. The
 * menus show a choice from the moment it is made: the pending keys overlay
 * the session's user until the account has answered.
 */
export function LanguageTimeSettings() {
  const t = useTranslations("preferences");
  const session = useSessionQuery();
  const update = useUpdatePreferences();
  const [pending, setPending] = useState<PreferencesRequest>({});
  const user = session.data?.user;
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
  return (
    <div className="setting-rows">
      <SettingRow label={t("language")}>
        {(control) => (
          <LocaleControl
            {...control}
            className="setting-select"
            onChange={(choice) =>
              update.mutate({ locale: choice === "system" ? null : choice })
            }
          />
        )}
      </SettingRow>
      <SettingRow
        caption={t("now", {
          time: formatDateTime(new Date(now).toISOString(), locale),
        })}
        label={t("timeFormat")}
      >
        {(control) => (
          <select
            {...control}
            className="setting-select"
            onChange={(event) => {
              const next = event.target.value;
              choose({
                hourCycle: next === "h12" || next === "h23" ? next : null,
              });
            }}
            value={hourCycle ?? ""}
          >
            <option value="">{t("fromLanguage")}</option>
            <option value="h12">{t("twelveHour")}</option>
            <option value="h23">{t("twentyFourHour")}</option>
          </select>
        )}
      </SettingRow>
      <SettingRow label={t("weekStart")}>
        {(control) => (
          <select
            {...control}
            className="setting-select"
            onChange={(event) => {
              const next = Number(event.target.value);
              choose({ weekStart: next === 1 || next === 7 ? next : null });
            }}
            value={weekStart ?? ""}
          >
            <option value="">{t("fromLanguage")}</option>
            <option value={1}>{t("monday")}</option>
            <option value={7}>{t("sunday")}</option>
          </select>
        )}
      </SettingRow>
      <TimeZoneRow
        onChange={(timeZone) => choose({ timeZone })}
        value={timeZone}
      />
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
 * The time zone as Settings shows it: a row with the zone menu and, under
 * it, a search field that narrows the menu by name or offset.
 */
function TimeZoneRow({
  onChange,
  value,
}: {
  readonly onChange: (timeZone: string | null) => void;
  readonly value: string | null;
}) {
  const t = useTranslations("preferences");
  const [query, setQuery] = useState("");
  return (
    <SettingRow caption={t("timeZoneNote")} label={t("timeZone")}>
      {(control) => (
        <div className="setting-zone">
          <TimeZoneSelect
            {...control}
            className="setting-select"
            onChange={onChange}
            query={query}
            value={value}
          />
          <label>
            <span className="visually-hidden">{t("searchZones")}</span>
            <input
              aria-controls={control.id}
              className="setting-input"
              onChange={(event) => setQuery(event.target.value)}
              placeholder={t("searchZones")}
              type="search"
              value={query}
            />
          </label>
        </div>
      )}
    </SettingRow>
  );
}

/** The time zone alone, as the Welcome step asks for it. */
export function TimeZoneField({
  onChange,
  value,
}: {
  readonly onChange: (timeZone: string | null) => void;
  readonly value: string | null;
}) {
  const t = useTranslations("preferences");
  const id = useId();
  return (
    <label className="field" htmlFor={id}>
      <span>{t("timeZone")}</span>
      <TimeZoneSelect id={id} onChange={onChange} query="" value={value} />
    </label>
  );
}

/**
 * The zone menu: Device (named, with its offset) or any zone the browser
 * knows, grouped by region with its current offset. `query` keeps the
 * zones whose name or offset holds it, and the chosen zone.
 */
function TimeZoneSelect({
  onChange,
  query,
  value,
  ...attributes
}: SettingControl & {
  readonly className?: string;
  readonly onChange: (timeZone: string | null) => void;
  readonly query: string;
  readonly value: string | null;
}) {
  const t = useTranslations("preferences");
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
    <select
      {...attributes}
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
  );
}
