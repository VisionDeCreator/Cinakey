import { useAuthActions } from "@convex-dev/auth/react";
import { useQuery } from "convex/react";
import { Clapperboard, FolderKanban, Images, Settings } from "lucide-react";
import { NavLink, Outlet, useNavigate } from "react-router-dom";
import { api } from "@cinakey/backend";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Separator } from "@/components/ui/separator";
import { cn } from "@/lib/utils";

const navItems = [
  { to: "/projects", label: "Projects", icon: FolderKanban },
  { to: "/assets", label: "Assets", icon: Images },
  { to: "/settings", label: "Settings", icon: Settings },
] as const;

export function AppShell() {
  const user = useQuery(api.users.viewer);
  const { signOut } = useAuthActions();
  const navigate = useNavigate();

  const email = user?.email ?? "Account";
  const initials = email.slice(0, 2).toUpperCase();

  return (
    <div className="flex min-h-dvh">
      <aside className="flex w-56 shrink-0 flex-col border-r border-zinc-800 bg-[var(--color-studio-panel)]">
        <div className="flex h-14 items-center gap-2 px-4">
          <Clapperboard className="size-5 text-zinc-100" aria-hidden />
          <span className="text-sm font-semibold tracking-wide">Cinakey</span>
        </div>
        <Separator />
        <nav className="flex flex-1 flex-col gap-1 p-3">
          {navItems.map(({ to, label, icon: Icon }) => (
            <NavLink
              key={to}
              to={to}
              className={({ isActive }) =>
                cn(
                  "flex items-center gap-2 rounded-md px-3 py-2 text-sm text-zinc-400 transition-colors hover:bg-zinc-800 hover:text-zinc-100",
                  isActive && "bg-zinc-800 text-zinc-50",
                )
              }
            >
              <Icon className="size-4" aria-hidden />
              {label}
            </NavLink>
          ))}
        </nav>
      </aside>

      <div className="flex min-w-0 flex-1 flex-col">
        <header className="flex h-14 items-center justify-end border-b border-zinc-800 bg-[var(--color-studio-panel)]/80 px-4 backdrop-blur">
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button variant="ghost" className="gap-2 px-2">
                <Avatar>
                  <AvatarFallback>{initials}</AvatarFallback>
                </Avatar>
                <span className="hidden max-w-[12rem] truncate text-sm sm:inline">
                  {email}
                </span>
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end">
              <DropdownMenuLabel>{email}</DropdownMenuLabel>
              <DropdownMenuSeparator />
              <DropdownMenuItem onSelect={() => navigate("/settings")}>
                Settings
              </DropdownMenuItem>
              <DropdownMenuItem
                onSelect={() => {
                  void signOut().then(() => navigate("/sign-in"));
                }}
              >
                Sign out
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        </header>

        <main className="flex-1 overflow-auto p-6">
          <Outlet />
        </main>
      </div>
    </div>
  );
}
