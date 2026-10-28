import { Languages } from "lucide-react";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "./select";
import { cn } from "./utils";
import {
  languages,
  setLocale,
  t,
  useLocale,
  type Locale,
} from "./i18n-runtime";

export function I18nText({ text }: { text: string }) {
  useLocale();
  return <>{t(text)}</>;
}
export function LanguageSelector({
  className,
  id,
}: {
  className?: string;
  id?: string;
}) {
  const current = useLocale();
  return (
    <Select
      value={current}
      onValueChange={(value) => setLocale(value as Locale)}
    >
      <SelectTrigger
        id={id}
        aria-label={t("Language")}
        className={cn("w-44 gap-3", className)}
      >
        <Languages
          className="size-4 shrink-0 text-zinc-400"
          aria-hidden="true"
        />
        <SelectValue className="flex-1 text-left" />
      </SelectTrigger>
      <SelectContent align="end">
        {languages.map((language) => (
          <SelectItem key={language.code} value={language.code}>
            <span lang={language.code}>{language.name}</span>
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}
