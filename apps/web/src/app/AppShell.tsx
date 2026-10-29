import { I18nText, t, useLocale } from "@dirrio/ui/i18n";
import { UploadProgress } from "@/components/UploadProgress";
import { WorkspaceSelector } from "@/features/workspaces/WorkspaceSelector";
import { formatUsd } from "@dirrio/ui/i18n";
import { WorkspaceProvider } from "@/features/workspaces/WorkspaceContext";
import { useWorkspace } from "@/features/workspaces/workspace-context";
import { useAuthActions } from "@convex-dev/auth/react";
import { useMutation, useQuery } from "@/lib/api/hooks";
import {
  Bell,
  Clapperboard,
  Coins,
  CreditCard,
  FolderKanban,
  Images,
  WandSparkles,
  PanelLeftClose,
  PanelLeftOpen,
  Settings,
  MoreHorizontal,
  Search,
  Layers,
} from "lucide-react";
import { useState } from "react";
import {
  Link,
  NavLink,
  Outlet,
  useNavigate,
  useMatch,
  useSearchParams,
} from "react-router-dom";
import { api } from "@dirrio/backend";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { useLocalStorageBool } from "@/lib/useLocalStorageBool";
import { cn } from "@/lib/utils";

const navItems = [
  {
    to: "/projects",
    get label() {
      return t("Projects");
    },
    icon: FolderKanban,
  },
  {
    to: "/series",
    get label() {
      return t("Series");
    },
    icon: Layers,
  },
  {
    to: "/remix",
    get label() {
      return t("Remix");
    },
    icon: WandSparkles,
  },
  {
    to: "/assets",
    get label() {
      return t("Assets");
    },
    icon: Images,
  },
  {
    to: "/billing",
    get label() {
      return t("Billing");
    },
    icon: CreditCard,
  },
  {
    to: "/settings",
    get label() {
      return t("Settings");
    },
    icon: Settings,
  },
] as const;

export function AppShell() {
  useLocale();
  const user = useQuery(api.users.viewer);
  const { signOut } = useAuthActions();
  if (user === undefined)
    return (
      <p role="status" className="p-8">
        <I18nText text="Checking account access…" />
      </p>
    );
  if (user === null)
    return (
      <main className="mx-auto max-w-lg space-y-4 p-10">
        <p role="alert">
          <I18nText text="Account access is unavailable. Sign out and sign in again." />
        </p>
        <Button onClick={() => void signOut()}>
          <I18nText text="Sign out" />
        </Button>
      </main>
    );
  if (user?.suspendedAt !== undefined)
    return (
      <main className="mx-auto max-w-lg space-y-4 p-10">
        <h1>
          <I18nText text="Account suspended" />
        </h1>
        <p role="alert">
          <I18nText text="This account is suspended. Contact support." />
        </p>
        <Button onClick={() => void signOut()}>
          <I18nText text="Sign out" />
        </Button>
      </main>
    );
  return (
    <WorkspaceProvider>
      <WorkspaceShell />
      <UploadProgress />
    </WorkspaceProvider>
  );
}

function WorkspaceShell() {
  useLocale();
  const {
    workspaceId,
    canManage,
    workspaces,
    canWrite,
    subscriptionMessage,
    role,
  } = useWorkspace();
  const isInternal =
    workspaces.find((w) => w.workspace._id === workspaceId)?.workspace
      .billingMode === "internal";
  const user = useQuery(api.users.viewer);
  const providerAvailability = useQuery(api.adminProviders.availability, {});
  const balance = useQuery(
    api.billing.getBalance,
    canManage ? { workspaceId } : "skip",
  );
  const unread = useQuery(api.notifications.listUnread);
  const markRead = useMutation(api.notifications.markRead);
  const markAllRead = useMutation(api.notifications.markAllRead);
  const { signOut } = useAuthActions();
  const navigate = useNavigate();
  const [collapsed, setCollapsed] = useLocalStorageBool(
    "dirrio.sidebarCollapsed",
    false,
  );

  const inProject = Boolean(useMatch("/projects/:projectId/*"));
  const [projectNavigationOpen, setProjectNavigationOpen] = useState(false);
  const compact = inProject ? !projectNavigationOpen : collapsed;

  const [searchParams, setSearchParams] = useSearchParams();
  const onDashboard = Boolean(useMatch("/projects"));
  const onSeries = Boolean(useMatch("/series"));
  const onGenjutsu = Boolean(useMatch("/remix"));
  const onAssets = Boolean(useMatch("/assets"));
  const email = user?.email ?? "";
  const displayName = user?.name?.trim() || email.split("@")[0] || "Account";
  const initials = displayName
    .split(/\s+/)
    .map((part) => part[0])
    .slice(0, 2)
    .join("")
    .toUpperCase();
  const accountAvatar = (
    <Avatar className="size-9">
      <AvatarImage src={user?.image} alt="" />
      <AvatarFallback className="bg-[var(--color-studio-accent-soft)] text-[var(--color-studio-accent)]">
        {initials}
      </AvatarFallback>
    </Avatar>
  );
  const accountItems = (
    <>
      <DropdownMenuLabel className="max-w-64">
        <span className="block truncate">{displayName}</span>
        <span className="block truncate text-xs font-normal text-zinc-400">
          {email}
        </span>
      </DropdownMenuLabel>
      <DropdownMenuSeparator />
      <DropdownMenuItem onSelect={() => navigate("/settings")}>
        <I18nText text="Profile & settings" />
      </DropdownMenuItem>
      <DropdownMenuItem onSelect={() => navigate("/billing")}>
        <I18nText text="Billing" />
      </DropdownMenuItem>
      {user?.isStaff && (
        <>
          <DropdownMenuItem asChild>
            <Link to="/staff">
              <I18nText text="Admin panel" />
            </Link>
          </DropdownMenuItem>
        </>
      )}
      <DropdownMenuSeparator />
      <DropdownMenuItem
        onSelect={() => {
          void signOut().then(() => navigate("/sign-in"));
        }}
      >
        <I18nText text="Sign out" />
      </DropdownMenuItem>
    </>
  );
  const unreadCount = unread?.length ?? 0;

  return (
    <div className="flex h-dvh overflow-hidden">
      <aside
        className={cn(
          "flex shrink-0 flex-col border-r border-zinc-800 bg-[var(--color-studio-panel)] transition-[width] duration-200",
          compact ? "w-14" : "w-14 sm:w-52 lg:w-60",
        )}
      >
        <div
          className={cn(
            "flex h-20 shrink-0 items-center gap-1",
            compact ? "justify-center px-1" : "justify-between px-3",
          )}
        >
          {!compact ? (
            <div className="hidden min-w-0 items-center gap-2 sm:flex">
              <Clapperboard
                className="size-6 shrink-0 text-[var(--color-studio-accent)]"
                aria-hidden
              />
              <span className="truncate text-xl font-semibold tracking-tight">
                Dirrio
              </span>
            </div>
          ) : null}
          <Button
            type="button"
            variant="ghost"
            size="icon"
            className="size-9 shrink-0 text-zinc-300 hover:text-zinc-50"
            title={compact ? t("Expand sidebar") : t("Collapse sidebar")}
            aria-label={compact ? t("Expand sidebar") : t("Collapse sidebar")}
            aria-expanded={!compact}
            onClick={() => {
              if (inProject) setProjectNavigationOpen((open) => !open);
              else setCollapsed((c) => !c);
            }}
          >
            {compact ? (
              <PanelLeftOpen className="size-4" />
            ) : (
              <PanelLeftClose className="size-4" />
            )}
          </Button>
        </div>
        {!compact && (
          <div className="hidden px-3 pb-4 pt-2 sm:block">
            {" "}
            <WorkspaceSelector />
          </div>
        )}
        <nav
          aria-label={t("Main navigation")}
          className="flex flex-1 flex-col gap-2 overflow-y-auto px-1 py-2 sm:px-3"
        >
          {compact ? (
            <div className="mb-1 flex justify-center py-1" title="Dirrio">
              <Clapperboard
                className="size-5 text-[var(--color-studio-accent)]"
                aria-hidden
              />
            </div>
          ) : null}
          {navItems.map(({ to, label, icon: Icon }) => (
            <NavLink
              key={to}
              to={to}
              end={to === "/projects"}
              title={label}
              aria-label={label}
              className={({ isActive }) =>
                cn(
                  "flex items-center gap-3 rounded-xl border-l-2 border-transparent py-3 text-sm text-zinc-400 transition-colors hover:bg-zinc-800 hover:text-zinc-100",
                  compact
                    ? "justify-center px-0"
                    : "justify-center px-0 sm:justify-start sm:px-3",
                  to === "/billing" && "mt-auto",
                  isActive &&
                    "border-l-[var(--color-studio-accent)] bg-zinc-900 text-zinc-50 [&_svg]:text-[var(--color-studio-accent)]",
                )
              }
            >
              <Icon className="size-4 shrink-0" aria-hidden />
              {!compact ? (
                <span className="hidden truncate sm:inline">{label}</span>
              ) : null}
              {compact ? <span className="sr-only">{label}</span> : null}
            </NavLink>
          ))}
        </nav>
        <div
          className={cn(
            "shrink-0 border-t border-zinc-800 p-1",
            !compact && "sm:p-3",
          )}
        >
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <button
                type="button"
                aria-label={t("Sidebar account menu")}
                className={cn(
                  "flex w-full items-center justify-center gap-3 rounded-xl p-1 text-left hover:bg-zinc-900 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--color-studio-accent)]",
                  !compact && "sm:justify-start sm:p-1.5",
                )}
              >
                {accountAvatar}
                {!compact && (
                  <>
                    <span className="hidden min-w-0 flex-1 sm:block">
                      <span className="block truncate text-sm font-medium">
                        {displayName}
                      </span>
                      <span className="mt-0.5 block truncate text-xs text-zinc-400">
                        {email}
                      </span>
                    </span>
                    <MoreHorizontal className="hidden size-4 shrink-0 text-zinc-400 sm:block" />
                  </>
                )}
              </button>
            </DropdownMenuTrigger>
            <DropdownMenuContent side="right" align="end" className="w-64">
              {accountItems}
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
      </aside>

      <div className="flex min-w-0 flex-1 flex-col">
        <header
          className={cn(
            "flex shrink-0 flex-wrap items-center justify-end gap-2 px-4 py-3 sm:flex-nowrap sm:gap-3 sm:px-8 sm:py-0",
            inProject ? "min-h-14 sm:h-14" : "min-h-20 sm:h-20",
          )}
        >
          {(onDashboard || onSeries || onGenjutsu || onAssets) && (
            <div className="relative order-last mr-auto min-w-0 basis-full sm:order-none sm:flex-1 sm:basis-auto">
              <Search className="pointer-events-none absolute left-4 top-3 size-4 text-zinc-400" />
              <Input
                aria-label={
                  onAssets
                    ? t("Search assets")
                    : onGenjutsu
                      ? t("Search transformations")
                      : onSeries
                        ? t("Search series")
                        : t("Search projects")
                }
                placeholder={
                  onAssets
                    ? t("Search assets by name or tag…")
                    : onGenjutsu
                      ? t("Search transformations…")
                      : onSeries
                        ? t("Search series…")
                        : t("Search projects…")
                }
                className="h-10 rounded-full border-zinc-800 bg-transparent pl-11"
                value={searchParams.get("q") ?? ""}
                onChange={(e) => {
                  const next = new URLSearchParams(searchParams);
                  if (e.target.value) next.set("q", e.target.value);
                  else next.delete("q");
                  setSearchParams(next, { replace: true });
                }}
              />
            </div>
          )}
          <WorkspaceSelector
            className={cn("mr-auto w-40 shrink-0", !compact && "sm:hidden")}
          />
          {canManage && (
            <Link
              to="/billing"
              aria-label={t("View workspace billing")}
              title={
                isInternal
                  ? t(
                      "Company-funded workspace · $0 payable. Generation prices track standard usage; company budgets still apply.",
                    )
                  : t("View workspace billing")
              }
              className="flex shrink-0 items-center gap-1.5 whitespace-nowrap rounded-full border border-zinc-800 bg-transparent px-2.5 py-1.5 text-sm text-zinc-200 hover:bg-zinc-800"
            >
              <Coins className="size-3.5 text-zinc-400" aria-hidden />
              <span className="tabular-nums">
                {isInternal
                  ? t("Company-funded")
                  : balance === undefined
                    ? "…"
                    : formatUsd(balance.balance)}
              </span>
              {!isInternal && <span className="text-zinc-500">USD</span>}
            </Link>
          )}

          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button
                variant="ghost"
                size="icon"
                className="relative size-10 rounded-full border border-zinc-800"
              >
                <Bell className="size-4" />
                {unreadCount > 0 ? (
                  <span
                    aria-label={t("{0} unread notifications", {
                      0: unreadCount,
                    })}
                    className="absolute right-0 top-0 size-2 rounded-full bg-[var(--color-studio-accent)]"
                  />
                ) : null}
                <span className="sr-only">
                  <I18nText text="Notifications" />
                </span>
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="w-80">
              <DropdownMenuLabel className="flex items-center justify-between">
                <span>
                  <I18nText text="Notifications" />
                </span>
                {unreadCount > 0 ? (
                  <button
                    type="button"
                    className="text-xs font-normal text-zinc-400 hover:text-zinc-200"
                    onClick={() => void markAllRead()}
                  >
                    <I18nText text="Mark all read" />
                  </button>
                ) : null}
              </DropdownMenuLabel>
              <DropdownMenuSeparator />
              {unread === undefined ? (
                <div className="px-2 py-3 text-sm text-zinc-500">
                  <I18nText text="Loading…" />
                </div>
              ) : unread.length === 0 ? (
                <div className="px-2 py-3 text-sm text-zinc-500">
                  <I18nText text="No unread notifications" />
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
              <Button
                variant="ghost"
                size="icon"
                aria-label={t("Account menu")}
                className="size-10 rounded-full p-0"
              >
                {accountAvatar}
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="w-64">
              {accountItems}
            </DropdownMenuContent>
          </DropdownMenu>
        </header>

        {canWrite === false && (
          <div
            role="status"
            className="border-b border-amber-800 bg-amber-950 px-4 py-3 text-sm text-amber-100"
          >
            {t(subscriptionMessage ?? "")}{" "}
            <I18nText text="Existing work is available to view and download." />{" "}
            {role === "owner" ? (
              <Link to="/billing" className="underline">
                <I18nText text="Manage billing" />
              </Link>
            ) : (
              "Ask the workspace owner to manage billing."
            )}
          </div>
        )}
        <main
          className={
            inProject
              ? "flex min-h-0 flex-1 flex-col overflow-hidden"
              : "flex-1 overflow-auto px-4 pb-8 pt-2 sm:px-8"
          }
        >
          {user?.generationPausedAt !== undefined && (
            <p role="alert" className="m-4 rounded border p-3">
              <I18nText text="Generation is paused for this account. Contact support." />
            </p>
          )}
          {providerAvailability?.models.some((model) => !model.available) && (
            <p role="status" className="m-4 rounded border p-3">
              <I18nText text="Some generation services are temporarily paused:" />{" "}
              {providerAvailability.models
                .filter((model) => !model.available)
                .map((model) => model.id)
                .join(", ")}
            </p>
          )}
          <Outlet />
        </main>
      </div>
    </div>
  );
}
