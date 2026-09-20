"use client";

import type { PersonResponse } from "@chronelle/schemas";
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
import { usePlanningEditorDialog } from "../../lib/use-planning-editor-dialog";
import { EditorControls, useConflictSlot } from "../events/editor-controls";
import {
  EditorDraftRecovery,
  EditorDraftStatus,
} from "../events/editor-draft-recovery";
import { useOpenHistory } from "../history/history-provider";
import {
  type LinkableAccount,
  type PersonLink,
  PersonNameField,
} from "./person-name-field";
import {
  ContactRows,
  CustomFieldRows,
  DescriptionRow,
  LabelsRow,
  PersonRows,
} from "./person-rows";

interface PersonFormProps {
  readonly onCancel?: (() => void) | undefined;
  readonly onRefresh?: (() => Promise<void>) | undefined;
  readonly person?: PersonResponse | undefined;
}

// A new person's draft is keyed like a new Event's: its recovery checks the
// session rather than an object's access.
const newPersonDraft = { id: "person:new", accessId: "new" };

const nameLimit = 240;

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
  const mutation = person === undefined ? create : update;
  const [fieldError, setFieldError] = useState("");
  const openHistory = useOpenHistory();
  const me = session.data?.user;
  const friends = useFriendsQuery();
  // An account already behind another card of the workspace is not offered.
  const takenElsewhere = (accountId: string) =>
    people.data?.items.some(
      (other) => other.userId === accountId && other.id !== person?.id,
    ) === true;
  const accounts: LinkableAccount[] = [
    ...(me !== undefined && !takenElsewhere(me.id)
      ? [
          {
            userId: me.id,
            displayName: me.displayName,
            email: me.email,
            relation: "you" as const,
          },
        ]
      : []),
    ...(friends.data?.friends ?? [])
      .filter((friend) => !takenElsewhere(friend.userId))
      .map((friend) => ({
        userId: friend.userId,
        displayName: friend.displayName,
        email: friend.email,
        relation: "friend" as const,
      })),
  ];
  // A card linked to an account that is neither the user's nor a friend's
  // keeps that link; the mark reads it without a clear.
  const link: PersonLink | null =
    userId === ""
      ? null
      : userId === me?.id
        ? "you"
        : friends.data?.friends.some((friend) => friend.userId === userId)
          ? "friend"
          : "elsewhere";
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

  // Linking fills the name and adds the account's address as an email
  // contact unless the contacts already carry it.
  function linkAccount(account: LinkableAccount) {
    const hasEmail =
      account.email === null ||
      contacts.some(
        (contact) =>
          contact.kind === "email" &&
          contact.value.trim().toLowerCase() === account.email?.toLowerCase(),
      );
    draft.change({
      userId: account.userId,
      displayName: account.displayName,
      ...(hasEmail
        ? {}
        : {
            contacts: joinPersonContacts([
              ...contacts,
              { kind: "email", value: account.email ?? "" },
            ]),
          }),
    });
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
      className="event-create-dialog person-dialog"
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
        <div className="event-create-body event-inspector-fields person-editor-body">
          <div className="editor-conflict-slot" ref={conflictSlot.ref} />
          <div className="person-name-row">
            <PersonNameField
              accounts={accounts}
              disabled={mutation.isPending}
              inputRef={nameInput}
              limit={nameLimit}
              link={link}
              onChange={(displayName) => draft.change({ displayName })}
              onLink={linkAccount}
              onUnlink={() => draft.change({ userId: "" })}
              value={displayName}
            />
            <CountedField
              disabled={mutation.isPending}
              hideLabel
              label={t("nickname")}
              limit={nameLimit}
              onChange={(nickname) => draft.change({ nickname })}
              placeholder={t("nickname")}
              value={nickname}
            />
          </div>
          <PersonRows>
            <ContactRows
              contacts={contacts}
              disabled={mutation.isPending}
              onChange={(next) =>
                draft.change({ contacts: joinPersonContacts(next) })
              }
            />
            <LabelsRow
              disabled={mutation.isPending}
              onChange={(labels) => draft.change({ labels })}
              value={labels}
            />
            <DescriptionRow
              disabled={mutation.isPending}
              onChange={(description) => draft.change({ description })}
              value={description}
            />
            <CustomFieldRows
              disabled={mutation.isPending}
              fields={fields}
              onChange={(next) =>
                draft.change({ properties: joinPersonFields(next) })
              }
            />
          </PersonRows>
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
