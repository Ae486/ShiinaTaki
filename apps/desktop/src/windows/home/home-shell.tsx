/**
 * INPUT:  page registry, requested route, shared Home connection, and last-confirmed Monitor availability
 * OUTPUT: navigation, retained page instances, client context, connection feedback, Approval modal, and ToastHost
 * POS:    ui/home — window root; transient disconnects retain Monitor's mounted controller and selection,
 *         while confirmed DISABLED removes the optional surface and applies the existing Chat fallback
 */

import { useEffect, useState } from "react";
import { ToastHost } from "@/components/toast/toast-host.js";
import { ConnectionStatusBanner } from "@/components/connection-status/connection-status.js";
import { SelectionTile } from "@/components/ui/selection-tile.js";
import { useHomeStore } from "./home-store.ts";
import { useHomeNavigateEvent } from "./use-home-navigate-event.ts";
import { useHomeConnection } from "./use-home-connection.ts";
import { HomeClientContext } from "./home-client-context.ts";
import { HOME_PAGES, visibleHomePages } from "./pages.ts";
import { useApprovalDialog } from "@/components/approval/use-approval-dialog.js";
import { appendVisitedPage } from "./visited-page-ids.ts";
import { usePageVisibilityStore } from "./page-visibility-store.ts";
import { useMonitorAvailability } from "./use-monitor-availability.ts";
import { observeHomeDocumentVisibility } from "./home-document-visibility.ts";

const BRAND_MARK = "flex h-7 w-7 items-center justify-center rounded-lg bg-accent text-xs font-semibold text-white";

// The registry row type, not the wider HomePage interface: it keeps the literal id navigate() expects.
type MenuRow = (typeof HOME_PAGES)[number];

function MenuItem({ page, active, disabled }: { page: MenuRow; active: boolean; disabled?: boolean }) {
  const navigate = useHomeStore((state) => state.navigate);
  const Icon = page.icon;
  return (
    // Batch-2: the nav row is the 6th SelectionTile site — the ONE accent recipe (ring emphasis, aria-current).
    <SelectionTile
      selected={active}
      stateAttr="aria-current"
      layout="row"
      disabled={disabled}
      onSelect={() => navigate(page.id)}
      className="gap-2.5 text-sm"
    >
      <Icon className={`h-[18px] w-[18px] shrink-0 ${active ? "text-accent" : "text-text-faint"}`} />
      <span className="truncate">{page.label}</span>
    </SelectionTile>
  );
}

function Brand() {
  return (
    <div className="mb-4 flex items-center gap-2.5 px-2">
      <span className={BRAND_MARK}>T</span>
      <span className="text-sm font-semibold tracking-tight text-text-body">TakiAgent</span>
    </div>
  );
}

export function HomeShell() {
  useHomeNavigateEvent();
  const connection = useHomeConnection();
  const currentPage = useHomeStore((state) => state.currentPage);
  const [visitedPages, setVisitedPages] = useState<readonly (typeof HOME_PAGES)[number]["id"][]>([currentPage]);
  const approvalDialog = useApprovalDialog(connection.client);
  const monitor = useMonitorAvailability(connection.client, currentPage);
  // Monitoring is an operator/developer surface, not a disabled product page. Keep the registry closed, but remove
  // the row entirely while Core reports DISABLED so the default Home navigation contains no monitor affordance.
  const visiblePages = visibleHomePages(monitor.enabled);
  const visiblePage = visiblePages.find((entry) => entry.id === currentPage) ?? visiblePages[0]!;
  const visibleMountedPages = visiblePages.filter((entry) => visitedPages.includes(entry.id) || entry.id === visiblePage.id);

  useEffect(() => {
    setVisitedPages((previous) => appendVisitedPage(previous, currentPage));
  }, [currentPage]);
  // P1e: publish the ACTUALLY-shown page so keep-alive page instances can stop working while hidden (the chat page
  // ignores the signal by contract). Written from visiblePage, not currentPage, so the monitor-disabled fallback is truth.
  const setActivePage = usePageVisibilityStore((state) => state.setActivePage);
  useEffect(() => { setActivePage(visiblePage.id); }, [visiblePage.id, setActivePage]);
  useEffect(() => observeHomeDocumentVisibility(document, usePageVisibilityStore.getState().setDocumentVisible), []);

  return (
    <HomeClientContext.Provider value={connection}>
      <div className="flex h-full bg-surface-sunken text-text-strong">
        <nav className="flex w-56 shrink-0 flex-col gap-1 border-r border-border bg-surface-sunken px-3 py-4">
          <Brand />
          {visiblePages.map((entry) => (
            <MenuItem key={entry.id} page={entry} active={entry.id === currentPage} />
          ))}
        </nav>
        {/* relative anchors the ConnectionStatusBanner overlay (U6): it floats over the page instead of shifting it. */}
        <main className="relative flex min-w-0 flex-1 flex-col overflow-hidden bg-surface">
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
