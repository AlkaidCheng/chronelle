export class ObjectConflictError extends Error {
  constructor() {
    super("The object changed after the supplied version was read.");
    this.name = "ObjectConflictError";
  }
}

export class InvalidObjectStateError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "InvalidObjectStateError";
  }
}

export class InvalidRelationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "InvalidRelationError";
  }
}

export class RelationConflictError extends Error {
  constructor() {
    super("The active relationship already exists.");
    this.name = "RelationConflictError";
  }
}
