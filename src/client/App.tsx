import type { ReactNode } from "react";
import type { AuthState, PrinterDto, UserDto } from "../shared/types.js";
import { useCallback, useEffect, useState } from "react";
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

function initials(name: string): string {
  return name.split(/\s+/).filter(Boolean).slice(0, 2).map(w => w[0]!.toUpperCase()).join("");
}

function Nav({ pages, page, pending, onSelect }: { pages: PageDef[]; page: Page; pending: number; onSelect: (p: Page) => void }) {
  return (
    <nav className="nav" aria-label="Main">
      {pages.map(p => (
        <button
          key={p.id}
          type="button"
          className={`nav-item${page === p.id ? " active" : ""}`}
          aria-current={page === p.id ? "page" : undefined}
          onClick={() => onSelect(p.id)}
        >
          {p.icon}
          {p.label}
          {p.id === "printers" && pending > 0 && <span className="count" aria-label={`${pending} capability changes to review`}>{pending}</span>}
        </button>
      ))}
    </nav>
  );
}

function Shell({ user, onSignedOut }: { user: UserDto; onSignedOut: () => void }) {
  const [page, setPage] = useState<Page>("print");
  const [printers, setPrinters] = useState<PrinterDto[] | null>(null);
  const [jobsKey, setJobsKey] = useState(0);
  const { error, fail, clear } = useAsyncError();

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

  return (
    <div className="app">
      <aside className="sidebar">
        <div className="brand">
          <BrandMark />
          printmax
        </div>
        <Nav pages={pages} page={page} pending={pending} onSelect={setPage} />
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
          <Nav pages={pages} page={page} pending={pending} onSelect={setPage} />
        </header>

        <main className="page">
          <div className="page-header">
            <div>
              <h1>{current.title}</h1>
              <p>{current.description}</p>
            </div>
          </div>
          {error && <Notice tone="error">{error}</Notice>}
          {page === "print" && (
            <PrintPage
              printers={list}
              loading={printers === null}
              jobsKey={jobsKey}
              isAdmin={user.role === "admin"}
              onSubmitted={() => setJobsKey(k => k + 1)}
              onGoToJobs={() => setPage("jobs")}
            />
          )}
          {page === "jobs" && <JobsPage user={user} refreshKey={jobsKey} />}
          {page === "presets" && <PresetsPage user={user} printers={list} />}
          {page === "library" && <LibraryPage user={user} printers={list} onPrinted={() => setJobsKey(k => k + 1)} />}
          {page === "printers" && user.role === "admin" && <AdminPrintersPage printers={list} onChanged={refreshPrinters} />}
          {page === "users" && user.role === "admin" && <UsersPage me={user} />}
          {page === "account" && <AccountPage user={user} />}
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
