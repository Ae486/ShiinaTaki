/**
 * INPUT:  the page registry + the home store's current page.
 * OUTPUT: <HomeShell> — the two-pane home layout: left menu (one entry per registry row) + the current page's body.
 * POS:    ui/windows/home — the window root. Presentational shell only: pages own their data; the shell owns the
 *         nav switch and the one ToastHost (visual polish lands in the batch-5 style pass).
 */

import { ToastHost } from "@/components/toast/toast-host.js";
import { useHomeStore } from "./home-store.ts";
import { useHomeNavigateEvent } from "./use-home-navigate-event.ts";
import { HOME_PAGES, type PageId } from "./pages.ts";

function MenuItem({ id, label, active }: { id: PageId; label: string; active: boolean }) {
  const navigate = useHomeStore((state) => state.navigate);
  const tone = active ? "bg-white text-slate-900 font-medium" : "text-slate-500 hover:bg-white/60 hover:text-slate-700";
  return (
    <button
      type="button"
      onClick={() => navigate(id)}
      aria-current={active ? "page" : undefined}
      className={`w-full rounded-lg px-3 py-2 text-left text-sm transition-colors ${tone}`}
    >
      {label}
    </button>
  );
}

export function HomeShell() {
  useHomeNavigateEvent();
  const currentPage = useHomeStore((state) => state.currentPage);
  const page = HOME_PAGES.find((entry) => entry.id === currentPage) ?? HOME_PAGES[0];
  const PageBody = page.component;

  return (
    <div className="flex h-full bg-slate-50">
      <nav className="flex w-40 shrink-0 flex-col gap-1 border-r border-slate-200 bg-slate-100 p-2">
        {HOME_PAGES.map((entry) => (
          <MenuItem key={entry.id} id={entry.id} label={entry.label} active={entry.id === currentPage} />
        ))}
      </nav>
      <main className="min-w-0 flex-1">
        <PageBody />
      </main>
      <ToastHost />
    </div>
  );
}
