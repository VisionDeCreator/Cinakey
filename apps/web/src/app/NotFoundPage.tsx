import { Link } from "react-router-dom";
import { Button } from "@/components/ui/button";

export function NotFoundPage() {
  return (
    <div className="mx-auto flex min-h-[50vh] max-w-md flex-col items-center justify-center gap-3 text-center">
      <h1 className="text-xl font-semibold text-zinc-100">Page not found</h1>
      <p className="text-sm text-zinc-500">
        That route does not exist in Cinakey.
      </p>
      <Button asChild>
        <Link to="/projects">Go to projects</Link>
      </Button>
    </div>
  );
}
