import { useParams } from "react-router-dom";
import { AssetLibrary } from "@/features/assets/AssetLibrary";

export function ProjectAssetsPage() {
  const { projectId } = useParams();
  if (!projectId) return null;
  return (
    <AssetLibrary
      projectId={projectId}
      title="Project assets"
      description="Upload and manage media for this project."
    />
  );
}
