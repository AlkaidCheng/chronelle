"use client";

import type { SectionResponse, SectionView } from "@chronelle/schemas";
import { useTranslations } from "next-intl";
import { useCallback, useState } from "react";

import {
  useCreateSection,
  useDeleteSection,
  useUpdateSection,
} from "../../lib/queries";
import { sectionAfterIndex, sectionAfterStep } from "../../lib/section-groups";
import type { SectionDraft } from "./section-parts";

/** Which section editor is open: one for a new section at a place, or one section's own. */
export type SectionEditing =
  | { readonly kind: "add"; readonly after: string | null }
  | { readonly kind: "edit"; readonly id: string };

/**
 * The state and writes behind a view's sections: which editor is open, the
 * create, rename, move, and delete of a section, and the words said after
 * each. The sections themselves arrive with the view's projection.
 */
export function useSectionEditing(
  eventId: string,
  view: SectionView,
  sections: readonly SectionResponse[],
) {
  const t = useTranslations("sections");
  const [editing, setEditing] = useState<SectionEditing | null>(null);
  const [announcement, setAnnouncement] = useState("");
  const create = useCreateSection(eventId);
  const update = useUpdateSection();
  const remove = useDeleteSection();
  const pending = create.isPending || update.isPending || remove.isPending;
  const error = create.isError
    ? create
    : update.isError
      ? update
      : remove.isError
        ? remove
        : null;

  const openAdd = useCallback((after: string | null) => {
    setEditing({ kind: "add", after });
  }, []);
  const openEdit = useCallback((id: string) => {
    setEditing({ kind: "edit", id });
  }, []);
  const cancel = useCallback(() => setEditing(null), []);

  const save = useCallback(
    (draft: SectionDraft) => {
      if (editing === null) return;
      if (editing.kind === "add")
        create.mutate(
          { view, ...draft, afterSectionId: editing.after },
          {
            onSuccess: (section) => {
              setEditing(null);
              setAnnouncement(t("said.added", { name: section.name }));
            },
          },
        );
      else
        update.mutate(
          { id: editing.id, input: draft },
          {
            onSuccess: (section) => {
              setEditing(null);
              setAnnouncement(t("said.saved", { name: section.name }));
            },
          },
        );
    },
    [create, editing, t, update, view],
  );

  /** A step up or down from the menu or the grip's arrow keys. */
  const move = useCallback(
    (id: string, direction: -1 | 1) => {
      const after = sectionAfterStep(sections, id, direction);
      if (after === undefined) return;
      const section = sections.find((candidate) => candidate.id === id);
      update.mutate(
        { id, input: { afterSectionId: after } },
        {
          onSuccess: () =>
            setAnnouncement(t("said.moved", { name: section?.name ?? "" })),
        },
      );
    },
    [sections, t, update],
  );

  /** A drop among the other sections, by its index among them. */
  const place = useCallback(
    (id: string, others: readonly string[], index: number) => {
      const section = sections.find((candidate) => candidate.id === id);
      update.mutate(
        { id, input: { afterSectionId: sectionAfterIndex(others, index) } },
        {
          onSuccess: () =>
            setAnnouncement(t("said.moved", { name: section?.name ?? "" })),
        },
      );
    },
    [sections, t, update],
  );

  const destroy = useCallback(
    (id: string) => {
      const section = sections.find((candidate) => candidate.id === id);
      remove.mutate(id, {
        onSuccess: () => {
          setEditing((current) =>
            current?.kind === "edit" && current.id === id ? null : current,
          );
          setAnnouncement(
            t("said.deleted", {
              name: section?.name ?? "",
              hint:
                view === "todos" ? t("deleteHint") : t("deleteHintExpenses"),
            }),
          );
        },
      });
    },
    [remove, sections, t, view],
  );

  return {
    announcement,
    cancel,
    destroy,
    editing,
    error,
    move,
    openAdd,
    openEdit,
    pending,
    place,
    save,
  };
}
