import { t, useLocale } from "@cinakey/ui/i18n";
import { AssetLibrary } from "@/features/assets/AssetLibrary";

export function AssetsPage() {
  useLocale();
  return <AssetLibrary title={t("Assets")} requireProject />;
}
