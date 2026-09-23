export function peopleListKey(workspaceId: string, query?: string) {
  return query === undefined
    ? (["wechat-people", workspaceId] as const)
    : (["wechat-people", workspaceId, query] as const);
}

export function personDetailKey(workspaceId: string, personId: string) {
  return ["wechat-person", workspaceId, personId] as const;
}

export function friendsKey(userId: string) {
  return ["wechat-friends", userId] as const;
}
