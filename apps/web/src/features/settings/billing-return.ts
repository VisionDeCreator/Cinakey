/** Polar appends a portal bearer token to successful checkout return URLs.
 * Cinakey creates owner-authorized portal sessions itself, so discard the token
 * before auth/router initialization can preserve it in redirects or history.
 */
export function cleanBillingReturnUrl(href: string): string | null {
  const url = new URL(href);
  if (!url.searchParams.has("customer_session_token")) return null;
  url.searchParams.delete("customer_session_token");
  return `${url.pathname}${url.search}${url.hash}`;
}
