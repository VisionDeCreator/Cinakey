export function authErrorMessage(error: unknown) {
  const message = error instanceof Error ? error.message : "";
  if (/incorrect or expired|Could not verify code/i.test(message))
    return "That code is incorrect or has expired. Try again or request a new code.";
  if (/Rate limit|Too many/i.test(message))
    return "Too many attempts. Please wait before requesting a new code.";
  if (/account assistance/i.test(message))
    return "We couldn’t sign you in. Please contact Cinakey support for account assistance.";
  return "Could not sign in. Please try again or request a new code.";
}

export function authDestination(value: string | null) {
  if (
    !value ||
    !value.startsWith("/") ||
    value.startsWith("//") ||
    /[\\\r\n]/.test(value) ||
    /^\/sign-(in|up)(?:[/?#]|$)/.test(value)
  )
    return "/projects";
  return value;
}
