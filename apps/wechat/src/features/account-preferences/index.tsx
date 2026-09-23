import type { SessionResponse } from "@chronelle/schemas";
import { Button, Input, Picker, Text, View } from "@tarojs/components";
import Taro from "@tarojs/taro";
import { useState } from "react";

import { useSession } from "../../auth/session-context";
import { getMessages, resolveLocale } from "../../i18n/catalog";
import {
  preferencesFromUser,
  preferencesUpdate,
  PreferencesValidationError,
  type AccountPreferences,
} from "./preferences";
import "./index.scss";

function deviceLanguage(): string | undefined {
  try {
    return Taro.getSystemInfoSync().language;
  } catch {
    return undefined;
  }
}

function PreferencesForm({ session }: { readonly session: SessionResponse }) {
  const auth = useSession();
  const [draft, setDraft] = useState<AccountPreferences>(() =>
    preferencesFromUser(session.user),
  );
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);
  const messages = getMessages(
    resolveLocale(session.user.locale ?? deviceLanguage()),
  );
  const original = preferencesFromUser(session.user);
  const supportedLocaleValues: (string | null)[] = [null, "zh-CN", "en-US"];
  const supportedLocaleLabels = [
    messages.preferenceDeviceDefault,
    messages.preferenceChinese,
    messages.preferenceEnglish,
  ];
  const customLocale =
    original.locale !== null && !supportedLocaleValues.includes(original.locale)
      ? original.locale
      : null;
  const localeValues = customLocale
    ? [...supportedLocaleValues, customLocale]
    : supportedLocaleValues;
  const localeOptions = customLocale
    ? [...supportedLocaleLabels, customLocale]
    : supportedLocaleLabels;
  const localeIndex = localeValues.indexOf(draft.locale);
  const hourValues = [null, "h12", "h23"] as const;
  const weekValues = [null, 1, 7] as const;
  const hasChanges =
    draft.locale !== original.locale ||
    (draft.timeZone?.trim() || null) !== original.timeZone ||
    draft.hourCycle !== original.hourCycle ||
    draft.weekStart !== original.weekStart;

  function change<K extends keyof AccountPreferences>(
    key: K,
    value: AccountPreferences[K],
  ) {
    setDraft((current) => ({ ...current, [key]: value }));
    setError(null);
    setSaved(false);
  }

  async function save() {
    setError(null);
    setSaved(false);
    let update: ReturnType<typeof preferencesUpdate>;
    try {
      update = preferencesUpdate(original, draft);
    } catch (failure) {
      setError(
        failure instanceof PreferencesValidationError &&
          failure.issue === "time-zone-unknown"
          ? messages.preferenceUnknownTimeZone
          : messages.preferenceInvalidTimeZone,
      );
      return;
    }
    if (Object.keys(update).length === 0) return;
    setSaving(true);
    try {
      const user = await auth.updatePreferences(update);
      setDraft(preferencesFromUser(user));
      setSaved(true);
    } catch {
      setError(messages.preferenceSaveFailed);
    } finally {
      setSaving(false);
    }
  }

  return (
    <View className="preferences-page">
      <View className="preferences-intro">
        <Text className="preferences-title">{messages.preferenceTitle}</Text>
        <Text className="preferences-detail">{messages.preferenceDetail}</Text>
      </View>
      <View className="preferences-card">
        <Text className="preferences-label">{messages.preferenceLanguage}</Text>
        <Picker
          disabled={saving}
          mode="selector"
          range={localeOptions}
          value={Math.max(localeIndex, 0)}
          onChange={(event) => {
            const index = Number(event.detail.value);
            if (index < localeValues.length)
              change("locale", localeValues[index] ?? null);
          }}
        >
          <View className="preferences-select">
            <Text>{localeOptions[Math.max(localeIndex, 0)]}</Text>
          </View>
        </Picker>

        <Text className="preferences-label">{messages.preferenceTimeZone}</Text>
        <Input
          className="preferences-input"
          disabled={saving}
          maxlength={64}
          onInput={(event) => change("timeZone", event.detail.value || null)}
          placeholder={messages.preferenceTimeZonePlaceholder}
          value={draft.timeZone ?? ""}
        />
        <Text className="preferences-hint">
          {messages.preferenceTimeZoneHint}
        </Text>

        <Text className="preferences-label">
          {messages.preferenceHourCycle}
        </Text>
        <Picker
          disabled={saving}
          mode="selector"
          range={[
            messages.preferenceDeviceDefault,
            messages.preferenceTwelveHour,
            messages.preferenceTwentyFourHour,
          ]}
          value={hourValues.indexOf(draft.hourCycle)}
          onChange={(event) => {
            change("hourCycle", hourValues[Number(event.detail.value)] ?? null);
          }}
        >
          <View className="preferences-select">
            <Text>
              {draft.hourCycle === "h12"
                ? messages.preferenceTwelveHour
                : draft.hourCycle === "h23"
                  ? messages.preferenceTwentyFourHour
                  : messages.preferenceDeviceDefault}
            </Text>
          </View>
        </Picker>

        <Text className="preferences-label">
          {messages.preferenceWeekStart}
        </Text>
        <Picker
          disabled={saving}
          mode="selector"
          range={[
            messages.preferenceDeviceDefault,
            messages.preferenceMonday,
            messages.preferenceSunday,
          ]}
          value={weekValues.indexOf(draft.weekStart)}
          onChange={(event) => {
            change("weekStart", weekValues[Number(event.detail.value)] ?? null);
          }}
        >
          <View className="preferences-select">
            <Text>
              {draft.weekStart === 1
                ? messages.preferenceMonday
                : draft.weekStart === 7
                  ? messages.preferenceSunday
                  : messages.preferenceDeviceDefault}
            </Text>
          </View>
        </Picker>
      </View>
      {error ? <Text className="preferences-error">{error}</Text> : null}
      {saved ? (
        <Text className="preferences-success">{messages.preferenceSaved}</Text>
      ) : null}
      <Button
        className="preferences-save"
        disabled={saving || auth.busy || !hasChanges}
        loading={saving}
        onClick={() => void save()}
      >
        {messages.save}
      </Button>
    </View>
  );
}

export default function AccountPreferencesPage() {
  const auth = useSession();
  if (auth.state.status === "restoring" || auth.state.status === "loading") {
    return (
      <View className="preferences-page">
        <Text className="preferences-detail">
          {getMessages(resolveLocale(deviceLanguage())).restoring}
        </Text>
      </View>
    );
  }
  if (auth.state.status !== "ready") {
    return (
      <View className="preferences-page">
        <Text className="preferences-detail">
          {getMessages(resolveLocale(deviceLanguage())).sessionExpired}
        </Text>
        <Button
          className="preferences-save"
          onClick={() => void Taro.reLaunch({ url: "/pages/index/index" })}
        >
          {getMessages(resolveLocale(deviceLanguage())).backToEvents}
        </Button>
      </View>
    );
  }
  return (
    <PreferencesForm
      key={auth.state.session.user.id}
      session={auth.state.session}
    />
  );
}
