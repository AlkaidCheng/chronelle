import {
  accessibleWorkspaceSchema,
  workspaceCreateRequestSchema,
  workspaceLeaveResponseSchema,
  workspaceMemberAddRequestSchema,
  workspaceMemberListResponseSchema,
  workspaceMemberParamsSchema,
  workspaceMemberRemovalResponseSchema,
  workspaceMemberRoleRequestSchema,
  workspaceMemberSchema,
  workspaceUpdateRequestSchema,
} from "@livtales/schemas";
import type { FastifyInstance, FastifyRequest } from "fastify";

import { UnauthenticatedError } from "../errors.js";
import { parseRequest } from "../request-validation.js";
import type {
  MembershipActor,
  MembershipStore,
  WorkspaceMemberView,
} from "./membership-store.js";

export interface WorkspaceRouteDependencies {
  readonly members: MembershipStore;
}

function actorOf(request: FastifyRequest): MembershipActor {
  if (request.identitySession === null) throw new UnauthenticatedError();
  return {
    userId: request.identitySession.user.id,
    workspaceId: request.identitySession.workspace.id,
  };
}

function memberPayload(member: WorkspaceMemberView) {
  return { ...member, joinedAt: member.joinedAt.toISOString() };
}

/**
 * Workspaces and their members: a new shared workspace for anyone, with
 * the caller as its Owner; the current workspace renamed by an Owner; its
 * members listed for any member, a friend added with a role, a member's
 * role changed, or a member removed by an Owner; and leaving it for any
 * member but its personal owner.
 */
export function registerWorkspaceRoutes(
  app: FastifyInstance,
  dependencies: WorkspaceRouteDependencies,
): void {
  app.post(
    "/api/workspaces",
    { preHandler: app.authenticate },
    async (request, reply) => {
      const input = parseRequest(workspaceCreateRequestSchema, request.body);
      const workspace = await dependencies.members.create(
        actorOf(request).userId,
        input.displayName,
        request.id,
      );
      return reply.code(201).send(accessibleWorkspaceSchema.parse(workspace));
    },
  );

  app.patch(
    "/api/workspaces/current",
    { preHandler: app.authenticate },
    async (request) => {
      const input = parseRequest(workspaceUpdateRequestSchema, request.body);
      return accessibleWorkspaceSchema.parse(
        await dependencies.members.rename(
          actorOf(request),
          input.displayName,
          request.id,
        ),
      );
    },
  );

  app.post(
    "/api/workspaces/current/leave",
    { preHandler: app.authenticate },
    async (request) => {
      const actor = actorOf(request);
      await dependencies.members.leave(actor, request.id);
      return workspaceLeaveResponseSchema.parse({
        userId: actor.userId,
        left: true,
      });
    },
  );

  app.get(
    "/api/workspaces/current/members",
    { preHandler: app.authenticate },
    async (request) => {
      const members = await dependencies.members.list(actorOf(request));
      return workspaceMemberListResponseSchema.parse({
        items: members.map(memberPayload),
      });
    },
  );

  app.post(
    "/api/workspaces/current/members",
    { preHandler: app.authenticate },
    async (request, reply) => {
      const input = parseRequest(workspaceMemberAddRequestSchema, request.body);
      const member = await dependencies.members.add(
        actorOf(request),
        input.friendId,
        input.role,
        request.id,
      );
      return reply
        .code(201)
        .send(workspaceMemberSchema.parse(memberPayload(member)));
    },
  );

  app.patch(
    "/api/workspaces/current/members/:userId",
    { preHandler: app.authenticate },
    async (request) => {
      const { userId } = parseRequest(
        workspaceMemberParamsSchema,
        request.params,
      );
      const input = parseRequest(
        workspaceMemberRoleRequestSchema,
        request.body,
      );
      const member = await dependencies.members.changeRole(
        actorOf(request),
        userId,
        input.role,
        request.id,
      );
      return workspaceMemberSchema.parse(memberPayload(member));
    },
  );

  app.delete(
    "/api/workspaces/current/members/:userId",
    { preHandler: app.authenticate },
    async (request) => {
      const { userId } = parseRequest(
        workspaceMemberParamsSchema,
        request.params,
      );
      await dependencies.members.remove(actorOf(request), userId, request.id);
      return workspaceMemberRemovalResponseSchema.parse({
        userId,
        removed: true,
      });
    },
  );
}
