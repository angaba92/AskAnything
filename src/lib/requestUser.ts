const USER_HEADER = "x-askanything-user";

export function requestUser(req: Request): string {
  const forwarded = req.headers.get(USER_HEADER)?.trim();
  if (forwarded) return forwarded;

  const authorization = req.headers.get("authorization");
  if (authorization?.startsWith("Basic ")) {
    try {
      const decoded = atob(authorization.slice(6));
      const separator = decoded.indexOf(":");
      const user = decoded.slice(0, separator >= 0 ? separator : undefined).trim();
      if (user) return user;
    } catch {
      // The middleware already validates Basic Auth; use the local fallback below.
    }
  }

  return "local";
}

export function authenticatedUserHeader(): string {
  return USER_HEADER;
}
