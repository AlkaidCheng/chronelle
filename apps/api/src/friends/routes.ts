import {
  acceptedResponseSchema,
  friendInvitationRequestSchema,
  friendItemParamsSchema,
  friendRequestRequestSchema,
  friendItemStateResponseSchema,
  friendSchema,
  friendsResponseSchema,
  sentInvitationSchema,
} from "@chronelle/schemas";
import type { FastifyInstance, FastifyRequest } from "fastify";

import { UnauthenticatedError } from "../errors.js";
import { parseRequest } from "../request-validation.js";
import type { FriendActor, FriendService } from "./friend-service.js";
import type { ConnectionView, SentItem } from "./friend-store.js";

export interface FriendRouteDependencies {
  readonly friends: FriendService;
}

function actorOf(request: FastifyRequest): FriendActor {
  if (request.identitySession === null) throw new UnauthenticatedError();
  return {
    userId: request.identitySession.user.id,
    workspaceId: request.identitySession.workspace.id,
  };
}

function friendPayload(connection: ConnectionView) {
  return {
    id: connection.id,
    userId: connection.userId,
    displayName: connection.displayName,
    email: connection.email,
    since: (connection.respondedAt ?? connection.createdAt).toISOString(),
  };
}

function requestPayload(connection: ConnectionView) {
  return {
    id: connection.id,
    requester: {
      userId: connection.userId,
      displayName: connection.displayName,
      email: connection.email,
    },
    message: connection.message,
    createdAt: connection.createdAt.toISOString(),
  };
}

function sentPayload(item: SentItem) {
  return {
    ...item,
    createdAt: item.createdAt.toISOString(),
    expiresAt: item.expiresAt?.toISOString() ?? null,
  };
}

/**
 * Friends belong to the account: the list, requests to accounts by id,
 * invitations by email, answers to requests, withdrawals, removals, and
 * sending again. A person named by a request or an invitation is one of
 * the current workspace.
 */
export function registerFriendRoutes(
  app: FastifyInstance,
  dependencies: FriendRouteDependencies,
): void {
  app.get("/api/friends", { preHandler: app.authenticate }, async (request) => {
    const actor = actorOf(request);
    const snapshot = await dependencies.friends.list(actor.userId);
    return friendsResponseSchema.parse({
      friends: snapshot.friends.map(friendPayload),
      incoming: snapshot.incoming.map(requestPayload),
      sent: snapshot.sent.map(sentPayload),
    });
  });

  // A request to an account found by search or by its code.
  app.post(
    "/api/friends/requests",
    { preHandler: app.authenticate },
    async (request, reply) => {
      const actor = actorOf(request);
      const input = parseRequest(friendRequestRequestSchema, request.body);
      const outcome = await dependencies.friends.request(
        actor,
        input,
        request.id,
      );
      return reply
        .code(201)
        .send(sentInvitationSchema.parse(sentPayload(outcome.item)));
    },
  );

  app.post(
    "/api/friends/invitations",
    { preHandler: app.authenticate },
    async (request, reply) => {
      const actor = actorOf(request);
      const input = parseRequest(friendInvitationRequestSchema, request.body);
      const outcome = await dependencies.friends.invite(
        actor,
        input,
        request.id,
      );
      return reply
        .code(201)
        .send(sentInvitationSchema.parse(sentPayload(outcome.item)));
    },
  );

  app.post(
    "/api/friends/invitations/:id/resend",
    { preHandler: app.authenticate },
    async (request, reply) => {
      const actor = actorOf(request);
      const { id } = parseRequest(friendItemParamsSchema, request.params);
      await dependencies.friends.resend(actor.userId, id, request.id);
      return reply
        .code(202)
        .send(acceptedResponseSchema.parse({ accepted: true }));
    },
  );

  app.delete(
    "/api/friends/invitations/:id",
    { preHandler: app.authenticate },
    async (request) => {
      const actor = actorOf(request);
      const { id } = parseRequest(friendItemParamsSchema, request.params);
      const state = await dependencies.friends.withdraw(
        actor.userId,
        id,
        request.id,
      );
      return friendItemStateResponseSchema.parse({
        id: state.id,
        status: state.status,
      });
    },
  );

  app.post(
    "/api/friends/requests/:id/accept",
    { preHandler: app.authenticate },
    async (request) => {
      const actor = actorOf(request);
      const { id } = parseRequest(friendItemParamsSchema, request.params);
      const connection = await dependencies.friends.respond(
        actor.userId,
        id,
        true,
        request.id,
      );
      return friendSchema.parse(friendPayload(connection));
    },
  );

  app.post(
    "/api/friends/requests/:id/decline",
    { preHandler: app.authenticate },
    async (request) => {
      const actor = actorOf(request);
      const { id } = parseRequest(friendItemParamsSchema, request.params);
      const connection = await dependencies.friends.respond(
        actor.userId,
        id,
        false,
        request.id,
      );
      return friendItemStateResponseSchema.parse({
        id: connection.id,
        status: "declined",
      });
    },
  );

  app.delete(
    "/api/friends/:id",
    { preHandler: app.authenticate },
    async (request) => {
      const actor = actorOf(request);
      const { id } = parseRequest(friendItemParamsSchema, request.params);
      const state = await dependencies.friends.remove(
        actor.userId,
        id,
        request.id,
      );
      return friendItemStateResponseSchema.parse({
        id: state.id,
        status: state.status,
      });
    },
  );
}
