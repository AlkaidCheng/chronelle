"use client";

import type { PersonResponse } from "@chronelle/schemas";
import { type FormEvent, useMemo, useState } from "react";
import { CountedField } from "../../components/counted-field";
import { EditorForm } from "../../components/editor-form";
import {
  DiscardActions,
  EditorDialogHeader,
} from "../../components/editor-dialog-controls";
import { EditorControls } from "../events/editor-controls";
import {
  EditorDraftRecovery,
  EditorDraftStatus,
} from "../events/editor-draft-recovery";
import { useOpenHistory } from "../history/history-provider";
import { useKeepEditorDraft } from "../../lib/editor-draft-context";
import type { PersonDraftSnapshot } from "../../lib/editor-draft-store";
import {
  joinPersonFields,
  personFieldsPayload,
  readPersonFields,
  splitPersonFields,
} from "../../lib/person-fields";
import {
  useCreatePerson,
  usePersonsQuery,
  useSessionQuery,
  useUpdatePerson,
} from "../../lib/queries";
import { useEditorDraft } from "../../lib/use-editor-draft";
import { usePlanningEditorDialog } from "../../lib/use-planning-editor-dialog";

interface PersonFormProps {
  readonly onCancel?: (() => void) | undefined;
  readonly onRefresh?: (() => Promise<void>) | undefined;
  readonly person?: PersonResponse | undefined;
}

// A new person's draft is keyed like a new Event's: its recovery checks the
// session rather than an object's access.
const newPersonDraft = { id: "person:new", accessId: "new" };

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
  const draft = useEditorDraft(latestPerson, readPersonFields, initialDraft);
  const person = draft.source;
  const snapshot = useMemo<PersonDraftSnapshot>(
    () => ({ ...draft.snapshot, kind: "person" }),
    [draft.snapshot],
  );
  const recovery = useKeepEditorDraft(
    draftId,
    snapshot,
    draft.isDirty,
    () => onCancel?.(),
    person?.id ?? newPersonDraft.accessId,
  );
  const create = useCreatePerson();
  const update = useUpdatePerson();
  const session = useSessionQuery();
  const people = usePersonsQuery();
  const { displayName, email, userId, properties } = draft.fields;
  const fields = splitPersonFields(properties);
  const mutation = person === undefined ? create : update;
  const [fieldError, setFieldError] = useState("");
  const openHistory = useOpenHistory();
  const me = session.data?.user.id;
  // The link is offered when the person is unlinked or already this user's;
  // a person linked to someone else's account keeps that link.
  const linkedElsewhere =
    person !== undefined && person.userId !== null && person.userId !== me;
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

  function changeFields(next: readonly { key: string; value: string }[]) {
    draft.change({ properties: joinPersonFields(next) });
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
      input = personFieldsPayload(draft.fields, person);
      setFieldError("");
    } catch (error) {
      setFieldError(
        error instanceof Error ? error.message : "Check the fields.",
      );
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
      className={`event-create-dialog${person ? " event-inspector" : ""}`}
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
            ? "Discard person changes?"
            : person
              ? "Edit person"
              : "Add person"
        }
        closeLabel="Close person editor"
        isConfirming={isConfirming}
        isPending={mutation.isPending}
        onClose={requestClose}
      >
        {person && (
          <button
            hidden={isConfirming}
            className="button button-quiet button-small"
            type="button"
            aria-label="View person history"
            disabled={mutation.isPending}
            onClick={() =>
              openHistory({
                objectId: person.id,
                displayName: person.displayName,
              })
            }
          >
            History
          </button>
        )}
      </EditorDialogHeader>
      {isConfirming && (
        <div className="event-create-body">
          <p>Your person changes have not been saved.</p>
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
          <CountedField
            className="field-wide"
            disabled={mutation.isPending}
            inputRef={nameInput}
            label="Name"
            limit={240}
            onChange={(displayName) => draft.change({ displayName })}
            placeholder="Mira Chen"
            required
            value={displayName}
          />
          <CountedField
            className="field-wide"
            disabled={mutation.isPending}
            label="Email"
            limit={254}
            onChange={(email) => draft.change({ email })}
            placeholder="mira@example.com"
            type="email"
            value={email}
          />
          {linkedElsewhere ? (
            <p className="field-hint field-wide">
              Linked to a workspace member's account.
            </p>
          ) : (
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
                    userId: input.target.checked && me !== undefined ? me : "",
                  })
                }
                type="checkbox"
              />
              <span>
                This is me
                {meTakenBy !== undefined
                  ? ` (already ${meTakenBy.displayName})`
                  : ""}
              </span>
            </label>
          )}
          <fieldset className="person-fields field-wide">
            <legend>Fields</legend>
            {fields.length === 0 ? (
              <p className="field-hint">
                Add a field for anything worth keeping: a phone, a birthday, a
                dietary note.
              </p>
            ) : (
              <ul className="person-field-rows">
                {fields.map((field, index) => (
                  // Rows have no identity of their own; their position is it.
                  // biome-ignore lint/suspicious/noArrayIndexKey: positional rows
                  <li key={index}>
                    <CountedField
                      disabled={mutation.isPending}
                      hideLabel
                      label={`Field ${index + 1} name`}
                      limit={60}
                      onChange={(key) =>
                        changeFields(
                          fields.map((row, at) =>
                            at === index ? { ...row, key } : row,
                          ),
                        )
                      }
                      placeholder="Field"
                      value={field.key}
                    />
                    <CountedField
                      disabled={mutation.isPending}
                      hideLabel
                      label={`Field ${index + 1} value`}
                      limit={500}
                      onChange={(value) =>
                        changeFields(
                          fields.map((row, at) =>
                            at === index ? { ...row, value } : row,
                          ),
                        )
                      }
                      placeholder="Value"
                      value={field.value}
                    />
                    <button
                      aria-label={`Remove field ${field.key || index + 1}`}
                      className="button button-quiet button-small"
                      disabled={mutation.isPending}
                      onClick={() =>
                        changeFields(fields.filter((_, at) => at !== index))
                      }
                      type="button"
                    >
                      Remove
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
              Add field
            </button>
          </fieldset>
          {fieldError && <p role="alert">{fieldError}</p>}
        </div>
        <footer className="event-inspector-footer">
          <EditorControls
            disabled={!recovery.isRetained}
            draft={draft}
            mutation={mutation}
            onCancel={requestClose}
            onRefresh={person === undefined ? undefined : onRefresh}
            submitLabel={person === undefined ? "Add person" : "Save person"}
          />
          <EditorDraftStatus
            {...recovery}
            failureMessage={
              person === undefined
                ? "The last save could not be confirmed. Check People before trying again."
                : "The last save could not be confirmed. Refresh latest before trying again."
            }
          />
        </footer>
      </EditorForm>
    </dialog>
  );
}
