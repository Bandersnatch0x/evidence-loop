/** Domain errors for the auth module — routes map them to HTTP status codes. */

export class AuthError extends Error {
  public constructor(
    public readonly code:
      | 'unauthorized'
      | 'forbidden'
      | 'conflict'
      | 'validation'
      | 'not_found',
    message: string
  ) {
    super(message)
    this.name = 'AuthError'
  }
}

export function isAuthError(error: unknown): error is AuthError {
  return error instanceof AuthError
}

export function authStatusCode(error: AuthError): number {
  switch (error.code) {
    case 'unauthorized':
      return 401
    case 'forbidden':
      return 403
    case 'conflict':
      return 409
    case 'validation':
      return 400
    case 'not_found':
      return 404
    default: {
      const _exhaustive: never = error.code
      return _exhaustive
    }
  }
}
