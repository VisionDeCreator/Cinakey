import { useAuthActions } from "@convex-dev/auth/react";
import { useMutation, useQuery } from "convex/react";
import {
  Bell,
  Clapperboard,
  Coins,
  FolderKanban,
  Images,
  Settings,
} from "lucide-react";
import { useEffect } from "react";
import { Link, NavLink, Outlet, useNavigate } from "react-router-dom";
import { api } from "@cinakey/backend";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { Badge } from "@/components/ui/badge";
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
  const balance = useQuery(api.credits.getBalance);
  const unread = useQuery(api.notifications.listUnread);
  const ensureWorkspace = useMutation(api.users.ensurePersonalWorkspace);
  const markRead = useMutation(api.notifications.markRead);
  const markAllRead = useMutation(api.notifications.markAllRead);
  const { signOut } = useAuthActions();
  const navigate = useNavigate();

  useEffect(() => {
    if (
      user !== undefined &&
      user !== null &&
      user.personalWorkspaceId === undefined
    ) {
      void ensureWorkspace();
    }
  }, [user, ensureWorkspace]);

  const email = user?.email ?? "Account";
  const initials = email.slice(0, 2).toUpperCase();
  const unreadCount = unread?.length ?? 0;

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
              end={to === "/projects"}
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
        <header className="flex h-14 items-center justify-end gap-2 border-b border-zinc-800 bg-[var(--color-studio-panel)]/80 px-4 backdrop-blur">
          <div className="flex items-center gap-1.5 rounded-md border border-zinc-800 bg-zinc-900/60 px-2.5 py-1.5 text-sm text-zinc-200">
            <Coins className="size-3.5 text-zinc-400" aria-hidden />
            <span className="tabular-nums">
              {balance === undefined ? "…" : balance.balance.toLocaleString()}
            </span>
            <span className="text-zinc-500">credits</span>
          </div>

          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button variant="ghost" size="icon" className="relative">
                <Bell className="size-4" />
                {unreadCount > 0 ? (
                  <Badge className="absolute -right-1 -top-1 h-4 min-w-4 justify-center px-1 text-[10px]">
                    {unreadCount > 9 ? "9+" : unreadCount}
                  </Badge>
                ) : null}
                <span className="sr-only">Notifications</span>
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="w-80">
              <DropdownMenuLabel className="flex items-center justify-between">
                <span>Notifications</span>
                {unreadCount > 0 ? (
                  <button
                    type="button"
                    className="text-xs font-normal text-zinc-400 hover:text-zinc-200"
                    onClick={() => void markAllRead()}
                  >
                    Mark all read
                  </button>
                ) : null}
              </DropdownMenuLabel>
              <DropdownMenuSeparator />
              {unread === undefined ? (
                <div className="px-2 py-3 text-sm text-zinc-500">Loading…</div>
              ) : unread.length === 0 ? (
                <div className="px-2 py-3 text-sm text-zinc-500">
                  No unread notifications
                </div>
              ) : (
                unread.map((n) => (
                  <DropdownMenuItem
                    key={n._id}
                    className="flex flex-col items-start gap-0.5 py-2"
                    onSelect={() => {
                      void markRead({ notificationId: n._id });
                      if (n.href) navigate(n.href);
                    }}
                  >
                    <span className="text-sm text-zinc-100">{n.title}</span>
                    {n.body ? (
                      <span className="line-clamp-2 text-xs text-zinc-500">
                        {n.body}
                      </span>
                    ) : null}
                  </DropdownMenuItem>
                ))
              )}
            </DropdownMenuContent>
          </DropdownMenu>

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
              {user?.isStaff === true ? (
                <DropdownMenuItem asChild>
                  <Link to="/dev">Dev tools</Link>
                </DropdownMenuItem>
              ) : null}
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
