import { AssetLibrary } from "@/features/assets/AssetLibrary";

export function AssetsPage() {
  return (
    <AssetLibrary
      title="Assets"
      description="Every file across your projects — upload, search, and inspect lineage."
      requireProject
    />
  );
}
