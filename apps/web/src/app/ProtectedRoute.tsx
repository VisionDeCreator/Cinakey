import { I18nText, useLocale } from "@cinakey/ui/i18n";
import { useConvexAuth } from "@/lib/api/hooks";
import { Navigate, Outlet, useLocation } from "react-router-dom";

export function ProtectedRoute() {
  useLocale();
  const location = useLocation();
  const { isLoading, isAuthenticated } = useConvexAuth();

  if (isLoading) {
    return (
      <div className="flex min-h-dvh items-center justify-center text-sm text-zinc-400">
        <I18nText text="Loading…" />
      </div>
    );
  }

  if (!isAuthenticated) {
    return (
      <Navigate
        to={`/sign-in?next=${encodeURIComponent(location.pathname + location.search)}`}
        replace
      />
    );
  }

  return <Outlet />;
}
