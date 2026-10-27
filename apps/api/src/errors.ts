export class HttpError extends Error {
  constructor(
    public statusCode: number,
    message: string,
  ) {
    super(message);
  }
}

export const httpError = {
  unauthorized: (msg = "Unauthorized") => new HttpError(401, msg),
  forbidden: (msg = "Forbidden") => new HttpError(403, msg),
  badRequest: (msg = "Bad Request") => new HttpError(400, msg),
  notFound: (msg = "Not Found") => new HttpError(404, msg),
};
