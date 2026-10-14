// An error with a wire code. The pipe server turns any RequestError thrown by a
// handler into an error reply with that code; anything else is 'internal'.
export class RequestError extends Error {
  readonly code: string;
  constructor(code: string, message: string) {
    super(message);
    this.code = code;
  }
}
