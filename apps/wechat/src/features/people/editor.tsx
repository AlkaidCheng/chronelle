import { ApiClientError } from "@chronelle/api-client";
import type { PersonResponse, SessionResponse } from "@chronelle/schemas";
import {
  Button,
  Input,
  Picker,
  Text,
  Textarea,
  View,
} from "@tarojs/components";
import Taro, { useRouter } from "@tarojs/taro";
import { useEffect, useRef, useState } from "react";

import { useSession } from "../../auth/session-context";
import { canCreateInActiveWorkspace } from "../../auth/workspace-access";
import { EditorFieldLabel, EditorStateCard } from "../../components/editor";
import {
  getMessages,
  resolveLocale,
  type MessageKey,
} from "../../i18n/catalog";
import {
  emptyPersonFields,
  fieldsFromPerson,
  personCreatePayload,
  personUpdatePayload,
  PersonValidationError,
  type ContactKind,
  type PersonFields,
  type PersonIssue,
} from "../../people/model";
import {
  useCreatePerson,
  usePersonDetail,
  useUpdatePerson,
} from "../../people/queries";
import { useReadyAppRuntime } from "../../runtime/app-runtime";
import "../../styles/editor.scss";
import "./people.scss";

const contactKinds: ContactKind[] = ["email", "phone", "other"];
const issueKeys: Record<PersonIssue, MessageKey> = {
  name: "personNameInvalid",
  nickname: "personNicknameInvalid",
  description: "personDescriptionInvalid",
  contact: "personContactInvalid",
  "too-many-contacts": "personContactsLimit",
};

interface ContactDraft {
  readonly key: string;
  readonly kind: ContactKind;
  readonly value: string;
}

interface PersonDraft extends Omit<PersonFields, "contacts"> {
  readonly contacts: readonly ContactDraft[];
}

function withContactKeys(fields: PersonFields): PersonDraft {
  return {
    ...fields,
    contacts: fields.contacts.map((contact, index) => ({
      ...contact,
      key: `saved-${index}`,
    })),
  };
}

function ReadyPersonEditor({
  personId,
  session,
}: {
  readonly personId: string | null;
  readonly session: SessionResponse;
}) {
  const messages = getMessages(resolveLocale(session.user.locale ?? undefined));
  const runtime = useReadyAppRuntime();
  const detail = usePersonDetail(session.workspace.id, personId);
  const create = useCreatePerson(session.workspace.id);
  const update = useUpdatePerson(session.workspace.id, personId ?? "missing");
  const [fields, setFields] = useState<PersonDraft | null>(
    personId === null ? withContactKeys(emptyPersonFields()) : null,
  );
  const [issue, setIssue] = useState<PersonIssue | null>(null);
  const [failure, setFailure] = useState(false);
  const [saved, setSaved] = useState(false);
  const [denied, setDenied] = useState(false);
  const [conflict, setConflict] = useState<PersonResponse | null>(null);
  const [preparing, setPreparing] = useState(false);
  const commandId = useRef<string | null>(null);
  const nextContactKey = useRef(0);
  const submitting = useRef(false);
  const person = detail.data?.person;
  const canEdit =
    personId === null
      ? canCreateInActiveWorkspace(session)
      : detail.data?.access.actions.includes("edit") === true;
  const saving = preparing || create.isPending || update.isPending;

  useEffect(() => {
    if (person && fields === null)
      setFields(withContactKeys(fieldsFromPerson(person)));
  }, [fields, person]);

  function change(next: Partial<PersonDraft>): void {
    setIssue(null);
    setFailure(false);
    setFields((current) => (current ? { ...current, ...next } : current));
  }

  async function save(expectedVersion = person?.version): Promise<void> {
    if (!fields || submitting.current || saved || !canEdit) return;
    submitting.current = true;
    setPreparing(true);
    setFailure(false);
    setIssue(null);
    try {
      if (personId === null) {
        commandId.current ??= await runtime.createCommandId();
        await create.mutateAsync(
          personCreatePayload(fields, commandId.current),
        );
      } else {
        if (expectedVersion === undefined) return;
        await update.mutateAsync(personUpdatePayload(fields, expectedVersion));
      }
    } catch (error) {
      if (error instanceof PersonValidationError) {
        setIssue(error.issue);
        return;
      }
      if (
        error instanceof ApiClientError &&
        [403, 404].includes(error.status)
      ) {
        setDenied(true);
        return;
      }
      if (
        personId !== null &&
        error instanceof ApiClientError &&
        error.code === "version_conflict"
      ) {
        try {
          const latest = await detail.refetch();
          if (
            latest.error instanceof ApiClientError &&
            [403, 404].includes(latest.error.status)
          ) {
            setDenied(true);
          } else if (!latest.isError && latest.data?.person) {
            setConflict(latest.data.person);
          } else {
            setFailure(true);
          }
        } catch {
          setFailure(true);
        }
        return;
      }
      setFailure(true);
      return;
    } finally {
      submitting.current = false;
      setPreparing(false);
    }
    setSaved(true);
    void Taro.navigateBack().catch(() => undefined);
  }

  if (saved) {
    return (
      <View className="editor-shell">
        <EditorStateCard
          action={messages.backToPeople}
          detail={messages.personSaved}
          onAction={() =>
            void Taro.redirectTo({ url: "/features/people/index" }).catch(
              () => undefined,
            )
          }
          title={messages.personSaved}
        />
      </View>
    );
  }

  const unavailable =
    denied ||
    (detail.error instanceof ApiClientError &&
      [403, 404].includes(detail.error.status));
  if (unavailable) {
    return (
      <View className="editor-shell">
        <EditorStateCard
          detail={messages.peopleUnavailable}
          title={messages.people}
        />
      </View>
    );
  }
  if (personId !== null && detail.isPending) {
    return (
      <View className="editor-shell">
        <EditorStateCard
          detail={messages.peopleIntro}
          title={messages.loading}
        />
      </View>
    );
  }
  if (personId !== null && (detail.isError || person === undefined)) {
    return (
      <View className="editor-shell">
        <EditorStateCard
          action={messages.retry}
          detail={messages.errorDetail}
          onAction={() => void detail.refetch()}
          title={messages.errorTitle}
        />
      </View>
    );
  }
  if (!canEdit || fields === null) {
    return (
      <View className="editor-shell">
        {person ? (
          <View className="people-panel">
            <Text className="people-panel__title">
              {person.nickname ?? person.displayName}
            </Text>
            {person.nickname ? (
              <Text className="people-muted">{person.displayName}</Text>
            ) : null}
            {person.description ? (
              <Text className="people-muted">{person.description}</Text>
            ) : null}
            {person.contacts.length > 0 ? (
              <Text className="people-muted">
                {person.contacts.map((contact) => contact.value).join(" · ")}
              </Text>
            ) : null}
            {person.userId ? (
              <Text className="people-muted">{messages.personLinked}</Text>
            ) : null}
            <Text className="people-footnote">{messages.personNoAccess}</Text>
          </View>
        ) : (
          <EditorStateCard
            detail={messages.cannotCreate}
            title={messages.people}
          />
        )}
      </View>
    );
  }

  return (
    <View className="editor-shell">
      <View className="editor-header">
        <Button className="editor-nav" onClick={() => void Taro.navigateBack()}>
          {messages.cancel}
        </Button>
        <Text className="editor-heading">
          {personId === null ? messages.addPerson : messages.editPerson}
        </Text>
        <View className="editor-nav-spacer" />
      </View>
      {conflict ? (
        <View className="people-conflict">
          <Text className="people-conflict__title">
            {messages.personConflictTitle}
          </Text>
          <Text className="people-muted">{messages.personConflictDetail}</Text>
          <Text className="people-conflict__current">
            {messages.personCurrent}:{" "}
            {conflict.nickname ?? conflict.displayName}
            {conflict.nickname ? ` (${conflict.displayName})` : ""}
          </Text>
          {conflict.description ? (
            <Text className="people-muted">{conflict.description}</Text>
          ) : null}
          {conflict.contacts.length > 0 ? (
            <Text className="people-muted">
              {conflict.contacts
                .map((contact) => `${contact.kind}: ${contact.value}`)
                .join(" · ")}
            </Text>
          ) : null}
          <View className="people-row-actions">
            <Button
              className="people-secondary"
              disabled={saving}
              onClick={() => {
                setFields(withContactKeys(fieldsFromPerson(conflict)));
                setConflict(null);
              }}
            >
              {messages.personUseCurrent}
            </Button>
            <Button
              className="people-primary"
              disabled={saving}
              loading={saving}
              onClick={() => void save(conflict.version)}
            >
              {messages.personKeepMine}
            </Button>
          </View>
        </View>
      ) : null}
      <View className="editor-form">
        <View className="editor-field">
          <EditorFieldLabel>{messages.personName}</EditorFieldLabel>
          <Input
            className="editor-input editor-input--title"
            disabled={saving}
            maxlength={240}
            onInput={(event) => change({ displayName: event.detail.value })}
            value={fields.displayName}
          />
        </View>
        <View className="editor-field">
          <EditorFieldLabel>{messages.personNickname}</EditorFieldLabel>
          <Input
            className="editor-input"
            disabled={saving}
            maxlength={240}
            onInput={(event) => change({ nickname: event.detail.value })}
            value={fields.nickname}
          />
        </View>
        <View className="editor-field">
          <EditorFieldLabel>{messages.personContacts}</EditorFieldLabel>
          {fields.contacts.map((contact, index) => (
            <View className="people-contact" key={contact.key}>
              <Picker
                disabled={saving}
                mode="selector"
                range={[
                  messages.contactEmail,
                  messages.contactPhone,
                  messages.contactOther,
                ]}
                value={contactKinds.indexOf(contact.kind)}
                onChange={(event) => {
                  const kind = contactKinds[Number(event.detail.value)];
                  if (!kind) return;
                  change({
                    contacts: fields.contacts.map((item, itemIndex) =>
                      itemIndex === index ? { ...item, kind } : item,
                    ),
                  });
                }}
              >
                <View className="people-contact__kind">
                  {contact.kind === "email"
                    ? messages.contactEmail
                    : contact.kind === "phone"
                      ? messages.contactPhone
                      : messages.contactOther}
                </View>
              </Picker>
              <Input
                className="people-contact__value"
                disabled={saving}
                maxlength={254}
                onInput={(event) =>
                  change({
                    contacts: fields.contacts.map((item, itemIndex) =>
                      itemIndex === index
                        ? { ...item, value: event.detail.value }
                        : item,
                    ),
                  })
                }
                value={contact.value}
              />
              <Button
                aria-label={messages.removeContact}
                className="people-contact__remove"
                disabled={saving}
                onClick={() =>
                  change({
                    contacts: fields.contacts.filter(
                      (_, itemIndex) => itemIndex !== index,
                    ),
                  })
                }
              >
                ×
              </Button>
            </View>
          ))}
          <Button
            className="people-text-button"
            disabled={saving || fields.contacts.length >= 20}
            onClick={() =>
              change({
                contacts: [
                  ...fields.contacts,
                  {
                    key: `added-${nextContactKey.current++}`,
                    kind: "email",
                    value: "",
                  },
                ],
              })
            }
          >
            + {messages.addContact}
          </Button>
        </View>
        <View className="editor-field">
          <EditorFieldLabel>{messages.personDescription}</EditorFieldLabel>
          <Textarea
            autoHeight
            className="editor-textarea"
            disabled={saving}
            maxlength={2000}
            onInput={(event) => change({ description: event.detail.value })}
            value={fields.description}
          />
        </View>
      </View>
      {person?.userId ? (
        <Text className="people-footnote">{messages.personLinked}</Text>
      ) : null}
      {issue || failure ? (
        <Text className="people-alert">
          {issue ? messages[issueKeys[issue]] : messages.personSaveFailed}
        </Text>
      ) : null}
      <Button
        className="people-primary people-save"
        disabled={saving || conflict !== null}
        loading={saving}
        onClick={() => void save()}
      >
        {personId === null ? messages.addPerson : messages.save}
      </Button>
    </View>
  );
}

export default function PersonEditorPage() {
  const session = useSession();
  const route = useRouter();
  const id = route.params.id;
  const personId = typeof id === "string" && id.length > 0 ? id : null;
  if (session.state.status === "ready") {
    return (
      <ReadyPersonEditor personId={personId} session={session.state.session} />
    );
  }
  const messages = getMessages(resolveLocale(undefined));
  return (
    <View className="editor-shell">
      <EditorStateCard detail={messages.errorDetail} title={messages.loading} />
    </View>
  );
}
