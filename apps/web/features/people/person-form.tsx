"use client";

import type { PersonContactKind, PersonResponse } from "@chronelle/schemas";
import { useTranslations } from "next-intl";
import { type FormEvent, useMemo, useState } from "react";
import { CountedField } from "../../components/counted-field";
import {
  DiscardActions,
  EditorDialogHeader,
} from "../../components/editor-dialog-controls";
import { EditorForm } from "../../components/editor-form";
import { useKeepEditorDraft } from "../../lib/editor-draft-context";
import type { PersonDraftSnapshot } from "../../lib/editor-draft-store";
import { useFriendsQuery } from "../../lib/friend-queries";
import {
  joinPersonContacts,
  joinPersonFields,
  type PersonContactField,
  personFieldsPayload,
  readPersonFields,
  splitPersonContacts,
  splitPersonFields,
} from "../../lib/person-fields";
import {
  type ContextCreateAttempt,
  useCreatePerson,
  usePersonsQuery,
  useSessionQuery,
  useUpdatePerson,
} from "../../lib/queries";
import { useEditorDraft } from "../../lib/use-editor-draft";
import { useDialogHelp } from "../../lib/use-dialog-help";
import { usePlanningEditorDialog } from "../../lib/use-planning-editor-dialog";
import { EditorControls, useConflictSlot } from "../events/editor-controls";
import {
  EditorDraftRecovery,
  EditorDraftStatus,
} from "../events/editor-draft-recovery";
import { useOpenHistory } from "../history/history-provider";
import { LabelPicker } from "../tasks/label-picker";

interface PersonFormProps {
  readonly onCancel?: (() => void) | undefined;
  readonly onRefresh?: (() => Promise<void>) | undefined;
  readonly person?: PersonResponse | undefined;
}

// A new person's draft is keyed like a new Event's: its recovery checks the
// session rather than an object's access.
const newPersonDraft = { id: "person:new", accessId: "new" };

const contactKinds: readonly PersonContactKind[] = ["email", "phone", "other"];
const contactInputTypes: Record<PersonContactKind, string> = {
  email: "email",
  phone: "tel",
  other: "text",
};

export function PersonForm(props: PersonFormProps) {
  const draftId = props.person?.id ?? newPersonDraft.id;
  return (
    <EditorDraftRecovery
      kind="person"
      id={draftId}
      accessId={props.person?.id ?? newPersonDraft.accessId}
      onClose={() => props.onCancel?.()}
    >
      {(initialDraft) => (
        <PersonEditor
          {...props}
          draftId={draftId}
          initialDraft={initialDraft}
        />
      )}
    </EditorDraftRecovery>
  );
}

function PersonEditor({
  draftId,
  initialDraft,
  onCancel,
  onRefresh,
  person: latestPerson,
}: PersonFormProps & {
  readonly draftId: string;
  readonly initialDraft: PersonDraftSnapshot | undefined;
}) {
  const t = useTranslations("person");
  const te = useTranslations("personEditor");
  const conflictSlot = useConflictSlot();
  const draft = useEditorDraft(latestPerson, readPersonFields, initialDraft);
  const person = draft.source;
  // A retained draft keeps its creation attempt, so a retry after a lost
  // response reuses the command the API already served.
  const [attempt] = useState<ContextCreateAttempt>(
    () => initialDraft?.creationAttempt ?? { current: null },
  );
  const snapshot = useMemo<PersonDraftSnapshot>(
    () => ({
      ...draft.snapshot,
      kind: "person",
      ...(person === undefined ? { creationAttempt: attempt } : {}),
    }),
    [draft.snapshot, person, attempt],
  );
  const recovery = useKeepEditorDraft(
    draftId,
    snapshot,
    draft.isDirty,
    () => onCancel?.(),
    person?.id ?? newPersonDraft.accessId,
  );
  const create = useCreatePerson(attempt);
  const update = useUpdatePerson();
  const session = useSessionQuery();
  const people = usePersonsQuery();
  const { displayName, nickname, description, userId, properties, labels } =
    draft.fields;
  const fields = splitPersonFields(properties);
  const contacts = splitPersonContacts(draft.fields.contacts);
  const contactKindLabels: Record<PersonContactKind, string> = {
    email: t("contactKinds.email"),
    phone: t("contactKinds.phone"),
    other: t("contactKinds.other"),
  };
  const mutation = person === undefined ? create : update;
  const [fieldError, setFieldError] = useState("");
  const openHistory = useOpenHistory();
  const me = session.data?.user.id;
  const friends = useFriendsQuery();
  const friendChoices = (friends.data?.friends ?? []).filter(
    (friend) =>
      !people.data?.items.some(
        (other) => other.userId === friend.userId && other.id !== person?.id,
      ),
  );
  // The link is offered when the person is unlinked, already this user's,
  // or one of the account's friends; a person linked to another account
  // keeps that link.
  const linkedElsewhere =
    person !== undefined &&
    person.userId !== null &&
    person.userId !== me &&
    !friendChoices.some((friend) => friend.userId === person.userId);
  const meTakenBy = people.data?.items.find(
    (other) => other.userId === me && other.id !== person?.id,
  );
  const close = () => {
    recovery.discard();
    onCancel?.();
  };
  const {
    headingId,
    nameInput,
    dialog,
    rememberSubmit,
    isConfirming,
    keepEditingButton,
    keepEditing,
    requestClose,
  } = usePlanningEditorDialog({
    isDirty: draft.isDirty,
    mutation,
    onClose: close,
  });
  const help = useDialogHelp("person");

  function changeFields(next: readonly { key: string; value: string }[]) {
    draft.change({ properties: joinPersonFields(next) });
  }

  function changeContacts(next: readonly PersonContactField[]) {
    draft.change({ contacts: joinPersonContacts(next) });
  }

  function handleSubmit(formEvent: FormEvent<HTMLFormElement>) {
    formEvent.preventDefault();
    if (
      isConfirming ||
      draft.hasNewerVersion ||
      mutation.isPending ||
      !recovery.isRetained
    )
      return;
    let input: ReturnType<typeof personFieldsPayload>;
    try {
      input = personFieldsPayload(draft.fields, person, te);
      setFieldError("");
    } catch (error) {
      setFieldError(error instanceof Error ? error.message : te("checkFields"));
      return;
    }
    rememberSubmit(formEvent.currentTarget);
    if (person === undefined) {
      void recovery.save(
        () => create.mutateAsync(input),
        () => {
          draft.change(readPersonFields());
          onCancel?.();
        },
      );
      return;
    }
    void recovery.save(
      () =>
        update.mutateAsync({
          id: person.id,
          input: { ...input, expectedVersion: person.version },
        }),
      (saved) => {
        draft.accept(saved);
        onCancel?.();
      },
    );
  }

  return (
    <dialog
      ref={dialog}
      className="event-create-dialog"
      aria-labelledby={headingId}
      onCancel={(event) => {
        event.preventDefault();
        requestClose();
      }}
    >
      <EditorDialogHeader
        headingId={headingId}
        title={
          isConfirming
            ? te("discardTitle")
            : person
              ? te("editTitle")
              : te("addTitle")
        }
        closeLabel={te("close")}
        isConfirming={isConfirming}
        isPending={mutation.isPending}
        onClose={requestClose}
        help={help}
      >
        {person && (
          <button
            hidden={isConfirming}
            className="button button-quiet button-small"
            type="button"
            aria-label={te("historyLabel")}
            disabled={mutation.isPending}
            onClick={() =>
              openHistory({
                objectId: person.id,
                displayName: person.displayName,
              })
            }
          >
            {te("history")}
          </button>
        )}
      </EditorDialogHeader>
      {isConfirming && (
        <div className="event-create-body">
          <p>{te("unsaved")}</p>
          <div className="form-actions">
            <DiscardActions
              keepEditingButton={keepEditingButton}
              onKeepEditing={keepEditing}
              onDiscard={close}
            />
          </div>
        </div>
      )}
      <EditorForm
        hidden={isConfirming}
        aria-busy={mutation.isPending}
        className="editor-form event-inspector-form"
        onChangeCapture={() => {
          setFieldError("");
          if (mutation.isSuccess) mutation.reset();
        }}
        onSubmit={handleSubmit}
      >
        <div className="event-create-body event-inspector-fields">
          <div className="editor-conflict-slot" ref={conflictSlot.ref} />
          <CountedField
            className="field-wide"
            disabled={mutation.isPending}
            inputRef={nameInput}
            label={te("name")}
            limit={240}
            onChange={(displayName) => draft.change({ displayName })}
            placeholder={te("namePlaceholder")}
            required
            value={displayName}
          />
          <CountedField
            className="field-wide"
            disabled={mutation.isPending}
            label={t("nickname")}
            limit={240}
            onChange={(nickname) => draft.change({ nickname })}
            placeholder={te("nicknamePlaceholder")}
            value={nickname}
          />
          {linkedElsewhere ? (
            <p className="field-hint field-wide">{te("linkedElsewhere")}</p>
          ) : (
            <>
              <label className="check-field field-wide">
                <input
                  checked={userId !== "" && userId === me}
                  disabled={
                    mutation.isPending ||
                    me === undefined ||
                    meTakenBy !== undefined
                  }
                  onChange={(input) =>
                    draft.change({
                      userId:
                        input.target.checked && me !== undefined ? me : "",
                    })
                  }
                  type="checkbox"
                />
                <span>
                  {meTakenBy === undefined
                    ? te("me")
                    : te("meTaken", { name: meTakenBy.displayName })}
                </span>
              </label>
              {friendChoices.length > 0 ? (
                <label className="field field-wide">
                  <span>{t("linkToFriend")}</span>
                  <select
                    disabled={mutation.isPending || userId === me}
                    onChange={(input) =>
                      draft.change({ userId: input.target.value })
                    }
                    value={
                      friendChoices.some((friend) => friend.userId === userId)
                        ? userId
                        : ""
                    }
                  >
                    <option value="">{t("noFriendLink")}</option>
                    {friendChoices.map((friend) => (
                      <option key={friend.id} value={friend.userId}>
                        {friend.displayName}
                        {friend.email === null ? "" : ` (${friend.email})`}
                      </option>
                    ))}
                  </select>
                </label>
              ) : null}
            </>
          )}
          <fieldset className="person-fields field-wide">
            <legend>{t("contacts")}</legend>
            {contacts.length > 0 ? (
              <ul className="person-field-rows">
                {contacts.map((contact, index) => (
                  // Rows have no identity of their own; their position is it.
                  // biome-ignore lint/suspicious/noArrayIndexKey: positional rows
                  <li key={index}>
                    <label className="field person-contact-kind">
                      <span className="visually-hidden">
                        {t("contactKind", { n: index + 1 })}
                      </span>
                      <select
                        disabled={mutation.isPending}
                        onChange={(event) =>
                          changeContacts(
                            contacts.map((row, at) =>
                              at === index
                                ? {
                                    ...row,
                                    kind: event.target
                                      .value as PersonContactKind,
                                  }
                                : row,
                            ),
                          )
                        }
                        value={contact.kind}
                      >
                        {contactKinds.map((kind) => (
                          <option key={kind} value={kind}>
                            {contactKindLabels[kind]}
                          </option>
                        ))}
                      </select>
                    </label>
                    <CountedField
                      disabled={mutation.isPending}
                      hideLabel
                      label={t("contactValue", { n: index + 1 })}
                      limit={254}
                      onChange={(value) =>
                        changeContacts(
                          contacts.map((row, at) =>
                            at === index ? { ...row, value } : row,
                          ),
                        )
                      }
                      type={contactInputTypes[contact.kind]}
                      value={contact.value}
                    />
                    <button
                      aria-label={t("removeContact", { n: index + 1 })}
                      className="button button-quiet button-small"
                      disabled={mutation.isPending}
                      onClick={() =>
                        changeContacts(contacts.filter((_, at) => at !== index))
                      }
                      type="button"
                    >
                      {te("remove")}
                    </button>
                  </li>
                ))}
              </ul>
            ) : null}
            <button
              className="button button-secondary button-small"
              disabled={mutation.isPending || contacts.length >= 20}
              onClick={() =>
                changeContacts([...contacts, { kind: "email", value: "" }])
              }
              type="button"
            >
              {t("addContact")}
            </button>
          </fieldset>
          <LabelPicker
            disabled={mutation.isPending}
            onChange={(labels) => draft.change({ labels })}
            value={labels}
          />
          <label className="field field-wide">
            <span>{t("description")}</span>
            <textarea
              disabled={mutation.isPending}
              maxLength={2000}
              onChange={(event) =>
                draft.change({ description: event.target.value })
              }
              rows={3}
              value={description}
            />
          </label>
          <fieldset className="person-fields field-wide">
            <legend>{te("fields")}</legend>
            {fields.length === 0 ? (
              <p className="field-hint">{te("fieldsHint")}</p>
            ) : (
              <ul className="person-field-rows">
                {fields.map((field, index) => (
                  // Rows have no identity of their own; their position is it.
                  // biome-ignore lint/suspicious/noArrayIndexKey: positional rows
                  <li key={index}>
                    <CountedField
                      disabled={mutation.isPending}
                      hideLabel
                      label={te("fieldName", { n: index + 1 })}
                      limit={60}
                      onChange={(key) =>
                        changeFields(
                          fields.map((row, at) =>
                            at === index ? { ...row, key } : row,
                          ),
                        )
                      }
                      placeholder={te("fieldPlaceholder")}
                      value={field.key}
                    />
                    <CountedField
                      disabled={mutation.isPending}
                      hideLabel
                      label={te("fieldValue", { n: index + 1 })}
                      limit={500}
                      onChange={(value) =>
                        changeFields(
                          fields.map((row, at) =>
                            at === index ? { ...row, value } : row,
                          ),
                        )
                      }
                      placeholder={te("valuePlaceholder")}
                      value={field.value}
                    />
                    <button
                      aria-label={te("removeField", {
                        name: field.key || String(index + 1),
                      })}
                      className="button button-quiet button-small"
                      disabled={mutation.isPending}
                      onClick={() =>
                        changeFields(fields.filter((_, at) => at !== index))
                      }
                      type="button"
                    >
                      {te("remove")}
                    </button>
                  </li>
                ))}
              </ul>
            )}
            <button
              className="button button-secondary button-small"
              disabled={mutation.isPending}
              onClick={() => changeFields([...fields, { key: "", value: "" }])}
              type="button"
            >
              {te("addField")}
            </button>
          </fieldset>
          {fieldError && <p role="alert">{fieldError}</p>}
        </div>
        <footer className="event-inspector-footer">
          <EditorControls
            conflict={
              person === undefined
                ? undefined
                : { objectId: person.id, slot: conflictSlot.slot }
            }
            disabled={!recovery.isRetained}
            draft={draft}
            mutation={mutation}
            onCancel={requestClose}
            onRefresh={person === undefined ? undefined : onRefresh}
            submitLabel={
              person === undefined ? te("submitAdd") : te("submitSave")
            }
          />
          <EditorDraftStatus
            {...recovery}
            failureMessage={
              person === undefined
                ? te("unconfirmedNew")
                : te("unconfirmedEdit")
            }
          />
        </footer>
      </EditorForm>
    </dialog>
  );
}
