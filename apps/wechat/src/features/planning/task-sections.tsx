import type { SectionResponse } from "@chronelle/schemas";
import { Button, Input, Text, Textarea, View } from "@tarojs/components";
import Taro from "@tarojs/taro";
import { useState } from "react";

import { getMessages, type AppLocale } from "../../i18n/catalog";
import { useTaskSectionMutation } from "../../tasks/section-queries";
import { sectionAfterStep } from "../../tasks/presentations";

type SectionEditor =
  { readonly kind: "create" } | { readonly kind: "edit"; readonly id: string };

export function TaskSections({
  eventId,
  locale,
  sections,
  workspaceId,
}: {
  readonly eventId: string;
  readonly locale: AppLocale;
  readonly sections: readonly SectionResponse[];
  readonly workspaceId: string;
}) {
  const messages = getMessages(locale);
  const mutation = useTaskSectionMutation(workspaceId, eventId);
  const [open, setOpen] = useState(false);
  const [editor, setEditor] = useState<SectionEditor | null>(null);
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [error, setError] = useState<string | null>(null);

  function begin(section?: SectionResponse): void {
    setName(section?.name ?? "");
    setDescription(section?.description ?? "");
    setEditor(
      section === undefined
        ? { kind: "create" }
        : { kind: "edit", id: section.id },
    );
    setError(null);
    mutation.reset();
  }

  async function save(): Promise<void> {
    const trimmed = name.trim();
    if (editor === null || mutation.isPending) return;
    if (trimmed.length === 0 || trimmed.length > 120) {
      setError(messages.sectionNameRequired);
      return;
    }
    if (description.trim().length > 2000) {
      setError(messages.validationDescriptionTooLong);
      return;
    }
    try {
      const input = { name: trimmed, description: description.trim() || null };
      await mutation.mutateAsync(
        editor.kind === "create"
          ? { kind: "create", input: { ...input, view: "todos" } }
          : { kind: "update", id: editor.id, input },
      );
      setEditor(null);
      setError(null);
    } catch {
      setError(messages.sectionSaveFailed);
    }
  }

  async function move(
    section: SectionResponse,
    direction: -1 | 1,
  ): Promise<void> {
    const afterSectionId = sectionAfterStep(sections, section.id, direction);
    if (afterSectionId === undefined || mutation.isPending) return;
    setError(null);
    try {
      await mutation.mutateAsync({
        kind: "update",
        id: section.id,
        input: { afterSectionId },
      });
    } catch {
      setError(messages.sectionSaveFailed);
    }
  }

  async function remove(section: SectionResponse): Promise<void> {
    if (mutation.isPending) return;
    const answer = await Taro.showModal({
      cancelText: messages.cancel,
      confirmColor: "#a33c2f",
      confirmText: messages.deleteSection,
      content: messages.confirmDeleteSectionDetail,
      title: messages.confirmDeleteSectionTitle,
    });
    if (!answer.confirm) return;
    setError(null);
    try {
      await mutation.mutateAsync({ kind: "delete", id: section.id });
    } catch {
      setError(messages.sectionSaveFailed);
    }
  }

  return (
    <View className="task-sections">
      <Button
        className="text-button"
        onClick={() => setOpen((current) => !current)}
      >
        {open ? messages.doneArranging : messages.manageSections}
      </Button>
      {open ? (
        <View className="task-sections__panel">
          {sections.map((section, index) => (
            <View className="task-sections__row" key={section.id}>
              <View className="task-sections__copy">
                <Text className="task-sections__name">{section.name}</Text>
                {section.description ? (
                  <Text className="task-sections__description">
                    {section.description}
                  </Text>
                ) : null}
              </View>
              <Button
                aria-label={messages.moveEarlier}
                className="icon-button"
                disabled={mutation.isPending || index === 0}
                onClick={() => void move(section, -1)}
              >
                ↑
              </Button>
              <Button
                aria-label={messages.moveLater}
                className="icon-button"
                disabled={mutation.isPending || index === sections.length - 1}
                onClick={() => void move(section, 1)}
              >
                ↓
              </Button>
              <Button
                className="text-button"
                disabled={mutation.isPending}
                onClick={() => begin(section)}
              >
                {messages.editSection}
              </Button>
              <Button
                aria-label={messages.deleteSection}
                className="icon-button icon-button--danger"
                disabled={mutation.isPending}
                onClick={() => void remove(section)}
              >
                ×
              </Button>
            </View>
          ))}
          <Button
            className="text-button text-button--primary"
            disabled={mutation.isPending}
            onClick={() => begin()}
          >
            {messages.addSection}
          </Button>
          {error && editor === null ? (
            <Text className="task-sections__error">{error}</Text>
          ) : null}
        </View>
      ) : null}
      {editor ? (
        <View className="dialog-backdrop" catchMove>
          <View aria-modal className="page-name-dialog" role="dialog">
            <Text className="page-name-dialog__title">
              {editor.kind === "create"
                ? messages.addSection
                : messages.editSection}
            </Text>
            <Text className="page-name-dialog__label">
              {messages.sectionName}
            </Text>
            <Input
              className="page-name-dialog__input"
              focus
              maxlength={120}
              onInput={(event) => setName(event.detail.value)}
              value={name}
            />
            <Text className="page-name-dialog__label">
              {messages.sectionDescription}
            </Text>
            <Textarea
              className="task-sections__textarea"
              maxlength={2000}
              onInput={(event) => setDescription(event.detail.value)}
              value={description}
            />
            {error ? (
              <Text className="page-name-dialog__error">{error}</Text>
            ) : null}
            <View className="page-name-dialog__actions">
              <Button
                className="text-button"
                disabled={mutation.isPending}
                onClick={() => {
                  setEditor(null);
                  setError(null);
                }}
              >
                {messages.cancel}
              </Button>
              <Button
                className="text-button text-button--primary"
                disabled={mutation.isPending}
                onClick={() => void save()}
              >
                {mutation.isPending ? messages.saving : messages.save}
              </Button>
            </View>
          </View>
        </View>
      ) : null}
    </View>
  );
}
