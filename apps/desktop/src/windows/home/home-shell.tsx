/**
 * INPUT:  the page registry + the home store's current page.
 * OUTPUT: <HomeShell> — the two-pane home layout: left menu (one icon+label entry per registry row) + lazily mounted,
 *         visited page bodies, shared client context, and the shared Home status banner on non-chat pages.
 * POS:    ui/windows/home — the window root. Owns navigation, the shared Home connection, that socket's Approval
 *         modal, and the one ToastHost; visited page instances remain in memory for this window only.
 */

import { useEffect, useState } from "react";
import { MONITOR_MODE_CONFIG_KEY } from "@taki/shared";
import { ToastHost } from "@/components/toast/toast-host.js";
import { ConnectionStatusBanner } from "@/components/connection-status/connection-status.js";
import { useHomeStore } from "./home-store.ts";
import { useHomeNavigateEvent } from "./use-home-navigate-event.ts";
import { useHomeConnection } from "./use-home-connection.ts";
import { HomeClientContext } from "./home-client-context.ts";
import { HOME_PAGES, visibleHomePages } from "./pages.ts";
import { useApprovalDialog } from "@/components/approval/use-approval-dialog.js";
import { appendVisitedPage } from "./visited-page-ids.ts";

const ACTIVE_ROW = "bg-white text-rose-700 shadow-sm ring-1 ring-rose-200/70";
const IDLE_ROW = "text-slate-500 ring-1 ring-transparent hover:bg-white/70 hover:text-slate-700";

// The registry row type, not the wider HomePage interface: it keeps the literal id navigate() expects.
type MenuRow = (typeof HOME_PAGES)[number];

function useMonitorVisibility(client: ReturnType<typeof useHomeConnection>["client"]): boolean {
  const [enabled, setEnabled] = useState(false);
  useEffect(() => {
    if (!client) { setEnabled(false); return; }
    let current = true;
    const unsubscribe = client.onConfigChanged((change) => {
      if (change.key === MONITOR_MODE_CONFIG_KEY && current) setEnabled(change.value !== "DISABLED");
    });
    void client.subscribeConfig().catch(() => undefined);
    void client.monitorState().then(
      (state) => { if (current) setEnabled(state.enabled); },
      () => { if (current) setEnabled(false); },
    );
    return () => { current = false; unsubscribe(); };
  }, [client]);
  return enabled;
}

function MenuItem({ page, active, disabled }: { page: MenuRow; active: boolean; disabled?: boolean }) {
  const navigate = useHomeStore((state) => state.navigate);
  const Icon = page.icon;
  return (
    <button
      type="button"
      onClick={() => { if (!disabled) navigate(page.id); }}
      disabled={disabled}
      aria-current={active ? "page" : undefined}
      className={`flex w-full items-center gap-2.5 rounded-lg px-3 py-2 text-left text-sm transition-colors ${
        active ? ACTIVE_ROW : IDLE_ROW
      } ${disabled ? "cursor-not-allowed opacity-50" : ""}`}
    >
      <Icon className={`h-[18px] w-[18px] shrink-0 ${active ? "text-rose-500" : "text-slate-400"}`} />
      <span className="truncate">{page.label}</span>
    </button>
  );
}

function Brand() {
  return (
    <div className="mb-4 flex items-center gap-2.5 px-2">
      <span className="flex h-7 w-7 items-center justify-center rounded-lg bg-rose-500 text-xs font-semibold text-white">
        T
      </span>
      <span className="text-sm font-semibold tracking-tight text-slate-700">TakiAgent</span>
    </div>
  );
}

export function HomeShell() {
  useHomeNavigateEvent();
  const connection = useHomeConnection();
  const currentPage = useHomeStore((state) => state.currentPage);
  const [visitedPages, setVisitedPages] = useState<readonly (typeof HOME_PAGES)[number]["id"][]>([currentPage]);
  const approvalDialog = useApprovalDialog(connection.client);
  const monitorEnabled = useMonitorVisibility(connection.client);
  // Monitoring is an operator/developer surface, not a disabled product page. Keep the registry closed, but remove
  // the row entirely while Core reports DISABLED so the default Home navigation contains no monitor affordance.
  const visiblePages = visibleHomePages(monitorEnabled);
  const visiblePage = visiblePages.find((entry) => entry.id === currentPage) ?? visiblePages[0]!;
  const visibleMountedPages = visiblePages.filter((entry) => visitedPages.includes(entry.id) || entry.id === visiblePage.id);

  useEffect(() => {
    setVisitedPages((previous) => appendVisitedPage(previous, currentPage));
  }, [currentPage]);
  useEffect(() => { if (currentPage === "monitor" && !monitorEnabled) useHomeStore.getState().navigate("chat"); }, [currentPage, monitorEnabled]);

  return (
    <HomeClientContext.Provider value={connection}>
      <div className="flex h-full bg-slate-100 text-slate-800">
        <nav className="flex w-56 shrink-0 flex-col gap-1 border-r border-slate-200 bg-slate-100 px-3 py-4">
          <Brand />
          {visiblePages.map((entry) => (
            <MenuItem key={entry.id} page={entry} active={entry.id === currentPage} />
          ))}
        </nav>
        <main className="flex min-w-0 flex-1 flex-col overflow-hidden bg-white">
          {visiblePage.id !== "chat" && <ConnectionStatusBanner status={connection.status} />}
          {visibleMountedPages.map((entry) => {
            const PageComponent = entry.component;
            const active = entry.id === visiblePage.id;
            return (
              <div
                key={entry.id}
                hidden={!active}
                aria-hidden={active ? undefined : true}
                className="min-h-0 flex flex-1 flex-col"
              >
                <PageComponent />
              </div>
            );
          })}
        </main>
        <ToastHost />
        {approvalDialog}
      </div>
    </HomeClientContext.Provider>
  );
}
