import { I18nText, useLocale } from "@dirrio/ui/i18n";
import { Link } from "react-router-dom";
import { Button } from "@/components/ui/button";

export function NotFoundPage() {
  useLocale();
  return (
    <div className="mx-auto flex min-h-[50vh] max-w-md flex-col items-center justify-center gap-3 text-center">
      <h1 className="text-xl font-semibold text-zinc-100">
        <I18nText text="Page not found" />
      </h1>
      <p className="text-sm text-zinc-500">
        <I18nText text="That route does not exist in Dirrio." />
      </p>
      <Button asChild>
        <Link to="/projects">
          <I18nText text="Go to projects" />
        </Link>
      </Button>
    </div>
  );
}
