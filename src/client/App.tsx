import type { AuthState, PrinterDto, UserDto } from "../shared/types.js";
import { useCallback, useEffect, useState } from "react";
import { api } from "./api.js";
import { AccountPage } from "./pages/AccountPage.js";
import { AdminPrintersPage } from "./pages/AdminPrintersPage.js";
import { JobsPage } from "./pages/JobsPage.js";
import { LoginPage } from "./pages/LoginPage.js";
import { PresetsPage } from "./pages/PresetsPage.js";
import { PrintPage } from "./pages/PrintPage.js";
import { UsersPage } from "./pages/UsersPage.js";
import { useAsyncError } from "./util.js";

type Page = "print" | "jobs" | "presets" | "printers" | "users" | "account";

const PAGES: Array<{ id: Page; label: string; admin?: boolean }> = [
  { id: "print", label: "Print" },
  { id: "jobs", label: "Jobs" },
  { id: "presets", label: "Presets" },
  { id: "printers", label: "Printers", admin: true },
  { id: "users", label: "Users", admin: true },
  { id: "account", label: "Account" },
];

function Shell({ user, onSignedOut }: { user: UserDto; onSignedOut: () => void }) {
  const [page, setPage] = useState<Page>("print");
  const [printers, setPrinters] = useState<PrinterDto[]>([]);
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

  const pending = printers.reduce((n, p) => n + p.pendingChanges, 0);

  return (
    <main>
      <header className="row between">
        <div>
          <h1>printmax</h1>
        </div>
        <nav>
          {PAGES.filter(p => !p.admin || user.role === "admin").map(p => (
            <button key={p.id} className={page === p.id ? "tab active" : "tab"} onClick={() => setPage(p.id)}>
              {p.label}
              {p.id === "printers" && pending > 0 && <span className="badge">{pending}</span>}
            </button>
          ))}
          <button className="tab" onClick={signOut}>Sign out</button>
        </nav>
      </header>
      {error && <p className="error">{error}</p>}
      {page === "print" && (
        <PrintPage
          printers={printers}
          onSubmitted={() => {
            setJobsKey(k => k + 1);
            setPage("jobs");
          }}
        />
      )}
      {page === "jobs" && <JobsPage user={user} refreshKey={jobsKey} />}
      {page === "presets" && <PresetsPage user={user} printers={printers} />}
      {page === "printers" && user.role === "admin" && <AdminPrintersPage printers={printers} onChanged={refreshPrinters} />}
      {page === "users" && user.role === "admin" && <UsersPage me={user} />}
      {page === "account" && <AccountPage user={user} />}
    </main>
  );
}

export function App() {
  const [auth, setAuth] = useState<AuthState | null>(null);
  const [failed, setFailed] = useState<string | null>(null);

  useEffect(() => {
    api.me().then(setAuth).catch(err => setFailed(err instanceof Error ? err.message : String(err)));
  }, []);

  if (failed)
    return <main className="narrow"><p className="error">{failed}</p></main>;
  if (!auth)
    return <main className="narrow"><p className="muted">Loading…</p></main>;
  if (!auth.user)
    return <LoginPage needsSetup={auth.needsSetup} onSignedIn={user => setAuth({ user, needsSetup: false })} />;
  return <Shell key={auth.user.id} user={auth.user} onSignedOut={() => setAuth({ user: null, needsSetup: false })} />;
}
