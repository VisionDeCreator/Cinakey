export function adminDestination(next: string | null) {
  return next?.startsWith("/") &&
    !next.startsWith("//") &&
    !/[\\\r\n]/.test(next) &&
    !/^\/sign-in(?:[/?#]|$)/.test(next)
    ? next
    : "/users";
}
