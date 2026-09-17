import {
  workspaceMemberAddRequestSchema,
  workspaceMemberListResponseSchema,
  workspaceMemberParamsSchema,
  workspaceMemberRemovalResponseSchema,
  workspaceMemberSchema,
} from "@chronelle/schemas";
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
 * The members of the current workspace: listed for any member; a friend
 * added as viewer or editor, or a member removed, by an Owner.
 */
export function registerWorkspaceRoutes(
  app: FastifyInstance,
  dependencies: WorkspaceRouteDependencies,
): void {
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
