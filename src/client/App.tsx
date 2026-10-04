import type { ReactNode } from "react";
import type { AuthState, PrinterDto, UserDto } from "../shared/types.js";
import { useCallback, useEffect, useRef, useState } from "react";
import { api } from "./api.js";
import { IconJobs, IconLibrary, IconLogout, IconPresets, IconPrinter, IconSliders, IconUser, IconUsers } from "./components/Icons.js";
import { BrandMark, Notice } from "./components/ui.js";
import { AccountPage } from "./pages/AccountPage.js";
import { AdminPrintersPage } from "./pages/AdminPrintersPage.js";
import { JobsPage } from "./pages/JobsPage.js";
import { LibraryPage } from "./pages/LibraryPage.js";
import { LoginPage } from "./pages/LoginPage.js";
import { PresetsPage } from "./pages/PresetsPage.js";
import { PrintPage } from "./pages/PrintPage.js";
import { UsersPage } from "./pages/UsersPage.js";
import { useAsyncError } from "./util.js";

type Page = "print" | "jobs" | "presets" | "library" | "printers" | "users" | "account";

interface PageDef {
  id: Page;
  label: string;
  title: string;
  description: string;
  icon: ReactNode;
  admin?: boolean;
}

const PAGES: PageDef[] = [
  { id: "print", label: "Print", title: "Print", description: "Send a document to a printer.", icon: <IconPrinter /> },
  { id: "jobs", label: "Jobs", title: "Jobs", description: "Everything printed, and what the printer said about it.", icon: <IconJobs /> },
  { id: "presets", label: "Presets", title: "Presets", description: "Saved settings to pick instead of choosing options each time.", icon: <IconPresets /> },
  { id: "library", label: "Library", title: "Library", description: "Documents kept for good, each with its preset, so printing them again is one click.", icon: <IconLibrary /> },
  { id: "printers", label: "Printers", title: "Printers", description: "Add printers and check what they can do.", icon: <IconSliders />, admin: true },
  { id: "users", label: "Users", title: "Users", description: "Who can sign in, and who can administer.", icon: <IconUsers />, admin: true },
  { id: "account", label: "Account", title: "Account", description: "Your sign-in details.", icon: <IconUser /> },
];

/** Pages live in the URL hash, so Back, refresh and a bookmark keep the page; the server only ever serves `/`. */
function pageFromHash(): Page {
  const id = window.location.hash.replace(/^#\/?/, "");
  return PAGES.find(p => p.id === id)?.id ?? "print";
}

function initials(name: string): string {
  return name.split(/\s+/).filter(Boolean).slice(0, 2).map(w => w[0]!.toUpperCase()).join("");
}

function Nav({ pages, page, pending }: { pages: PageDef[]; page: Page; pending: number }) {
  return (
    <nav className="nav" aria-label="Main">
      {pages.map(p => (
        <a
          key={p.id}
          href={`#/${p.id}`}
          className={`nav-item${page === p.id ? " active" : ""}`}
          aria-current={page === p.id ? "page" : undefined}
        >
          {p.icon}
          {p.label}
          {p.id === "printers" && pending > 0 && <span className="count" aria-label={`${pending} capability changes to review`}>{pending}</span>}
        </a>
      ))}
    </nav>
  );
}

function Shell({ user, onSignedOut }: { user: UserDto; onSignedOut: () => void }) {
  const [page, setPage] = useState<Page>(pageFromHash);
  const [printers, setPrinters] = useState<PrinterDto[] | null>(null);
  const [jobsKey, setJobsKey] = useState(0);
  const { error, fail, clear } = useAsyncError();
  const headingRef = useRef<HTMLHeadingElement>(null);
  const navigatedRef = useRef(false);

  const refreshPrinters = useCallback(async () => {
    try {
      setPrinters(await api.listPrinters());
      clear();
    }
    catch (err) {
      fail(err);
    }
  }, [fail, clear]);

  useEffect(() => {
    const follow = () => setPage(pageFromHash());
    window.addEventListener("hashchange", follow);
    return () => window.removeEventListener("hashchange", follow);
  }, []);

  useEffect(() => {
    void refreshPrinters();
    const timer = setInterval(() => void refreshPrinters(), 30_000);
    return () => clearInterval(timer);
  }, [refreshPrinters]);

  async function signOut() {
    await api.logout().catch(() => undefined);
    onSignedOut();
  }

  const pages = PAGES.filter(p => !p.admin || user.role === "admin");
  const current = pages.find(p => p.id === page) ?? pages[0]!;
  const pending = (printers ?? []).reduce((n, p) => n + p.pendingChanges, 0);
  const list = printers ?? [];

  // A page change moves focus to its heading, so keyboard and screen reader users land where the new content starts.
  useEffect(() => {
    document.title = `${current.title} · printmax`;
    if (navigatedRef.current)
      headingRef.current?.focus();
    navigatedRef.current = true;
  }, [current.title]);

  return (
    <div className="app">
      <aside className="sidebar">
        <div className="brand">
          <BrandMark />
          printmax
        </div>
        <Nav pages={pages} page={current.id} pending={pending} />
        <div className="sidebar-footer">
          <span className="avatar" aria-hidden="true">{initials(user.name)}</span>
          <div className="who">
            <strong>{user.name}</strong>
            <span>{user.role === "admin" ? "Administrator" : user.email}</span>
          </div>
          <button type="button" className="btn btn-ghost btn-icon" onClick={signOut} aria-label="Sign out" title="Sign out">
            <IconLogout />
          </button>
        </div>
      </aside>

      <div className="main">
        <header className="topbar">
          <div className="topbar-row">
            <div className="brand">
              <BrandMark />
              printmax
            </div>
            <button type="button" className="btn btn-ghost btn-sm" onClick={signOut}>
              <IconLogout />
              Sign out
            </button>
          </div>
          <Nav pages={pages} page={current.id} pending={pending} />
        </header>

        <main className="page">
          <div className="page-header">
            <div>
              <h1 ref={headingRef} tabIndex={-1}>{current.title}</h1>
              <p>{current.description}</p>
            </div>
          </div>
          {error && <Notice tone="error">{error}</Notice>}
          {current.id === "print" && (
            <PrintPage
              printers={list}
              loading={printers === null}
              jobsKey={jobsKey}
              isAdmin={user.role === "admin"}
              onSubmitted={() => setJobsKey(k => k + 1)}
              onGoToJobs={() => {
                window.location.hash = "/jobs";
              }}
            />
          )}
          {current.id === "jobs" && <JobsPage user={user} refreshKey={jobsKey} />}
          {current.id === "presets" && <PresetsPage user={user} printers={list} />}
          {current.id === "library" && <LibraryPage user={user} printers={list} onPrinted={() => setJobsKey(k => k + 1)} />}
          {current.id === "printers" && user.role === "admin" && <AdminPrintersPage printers={list} onChanged={refreshPrinters} />}
          {current.id === "users" && user.role === "admin" && <UsersPage me={user} />}
          {current.id === "account" && <AccountPage user={user} />}
        </main>
      </div>
    </div>
  );
}

export function App() {
  const [auth, setAuth] = useState<AuthState | null>(null);
  const [failed, setFailed] = useState<string | null>(null);

  useEffect(() => {
    api.me().then(setAuth).catch(err => setFailed(err instanceof Error ? err.message : String(err)));
  }, []);

  if (failed)
    return <div className="auth"><Notice tone="error">{failed}</Notice></div>;
  if (!auth)
    return <div className="auth" aria-busy="true" />;
  if (!auth.user)
    return <LoginPage needsSetup={auth.needsSetup} setupTokenRequired={auth.setupTokenRequired ?? false} onSignedIn={user => setAuth({ user, needsSetup: false })} />;
  return <Shell key={auth.user.id} user={auth.user} onSignedOut={() => setAuth({ user: null, needsSetup: false })} />;
}
