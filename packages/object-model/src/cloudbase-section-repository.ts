import {
  AuthorizationDeniedError,
  type UserPrincipal,
} from "@chronelle/authorization";
import {
  CloudBaseRpcError,
  type CloudBaseRdbClient,
  type SectionView,
  sectionViews,
} from "@chronelle/db";

import {
  cloudbaseDate,
  cloudbaseNullableText,
  cloudbaseText,
} from "./cloudbase-read-support.js";
import { mapRpcError } from "./cloudbase-rpc-errors.js";
import { InvalidObjectStateError } from "./errors.js";
import type {
  CreateSectionInput,
  SectionReadRepository,
  SectionWriteRepository,
  UpdateSectionInput,
} from "./sections.js";
import type { SectionResource } from "./types.js";

function sectionFromSerialized(value: unknown): SectionResource {
  if (value === null || typeof value !== "object")
    throw new Error("CloudBase returned an invalid section.");
  const section = value as Record<string, unknown>;
  const view = cloudbaseText(section.view, "section view");
  if (!sectionViews.includes(view as SectionView))
    throw new Error("CloudBase returned an invalid section view.");
  return {
    id: cloudbaseText(section.id, "section id"),
    workspaceId: cloudbaseText(section.workspaceId, "workspace id"),
    eventId: cloudbaseText(section.eventId, "event id"),
    view: view as SectionView,
    name: cloudbaseText(section.name, "section name"),
    description: cloudbaseNullableText(section.description, "description"),
    rank: cloudbaseText(section.rank, "rank"),
    createdAt: cloudbaseDate(section.createdAt, "createdAt"),
    updatedAt: cloudbaseDate(section.updatedAt, "updatedAt"),
  };
}

/**
 * Sections listed through chronelle_section_list, which authorizes the
 * Event and orders them, and written through the other chronelle_section_*
 * functions.
 */
export class CloudBaseSectionRepository
  implements SectionReadRepository, SectionWriteRepository
{
  readonly #client: Pick<CloudBaseRdbClient, "rpc">;

  constructor(client: Pick<CloudBaseRdbClient, "rpc">) {
    this.#client = client;
  }

  async listSections(
    principal: UserPrincipal,
    eventId: string,
    view: SectionView,
  ): Promise<readonly SectionResource[]> {
    const listed = await this.#rpc("chronelle_section_list", {
      workspace_id: principal.workspaceId,
      user_id: principal.userId,
      event_id: eventId,
      view,
    });
    if (!Array.isArray(listed))
      throw new Error("CloudBase returned an invalid section list.");
    return listed.map(sectionFromSerialized);
  }

  async createSection(
    principal: UserPrincipal,
    eventId: string,
    input: CreateSectionInput,
  ): Promise<SectionResource> {
    return sectionFromSerialized(
      await this.#rpc("chronelle_section_create", {
        workspace_id: principal.workspaceId,
        user_id: principal.userId,
        event_id: eventId,
        input: {
          view: input.view,
          name: input.name,
          description: input.description ?? null,
          ...(input.afterSectionId !== undefined && {
            afterSectionId: input.afterSectionId,
          }),
        },
      }),
    );
  }

  async updateSection(
    principal: UserPrincipal,
    sectionId: string,
    input: UpdateSectionInput,
  ): Promise<SectionResource> {
    return sectionFromSerialized(
      await this.#rpc("chronelle_section_update", {
        workspace_id: principal.workspaceId,
        user_id: principal.userId,
        section_id: sectionId,
        changes: {
          ...(input.name !== undefined && { name: input.name }),
          ...(input.description !== undefined && {
            description: input.description,
          }),
          ...(input.afterSectionId !== undefined && {
            afterSectionId: input.afterSectionId,
          }),
        },
      }),
    );
  }

  async deleteSection(
    principal: UserPrincipal,
    sectionId: string,
  ): Promise<SectionResource> {
    return sectionFromSerialized(
      await this.#rpc("chronelle_section_delete", {
        workspace_id: principal.workspaceId,
        user_id: principal.userId,
        section_id: sectionId,
      }),
    );
  }

  async #rpc(
    functionName: string,
    args: Record<string, unknown>,
  ): Promise<unknown> {
    try {
      return await this.#client.rpc(functionName, args);
    } catch (error) {
      if (error instanceof CloudBaseRpcError)
        throw mapRpcError(error, {
          invalidRequest: (message) => new InvalidObjectStateError(message),
          notFound: () => new AuthorizationDeniedError(),
        });
      throw error;
    }
  }
}
