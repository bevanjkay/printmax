import type { FormEvent } from "react";
import type { UserDto } from "../../shared/types.js";
import { useState } from "react";
import { api } from "../api.js";
import { BrandMark, Button, Field, Notice } from "../components/ui.js";
import { useAsyncError } from "../util.js";

interface Props {
  needsSetup: boolean;
  setupTokenRequired: boolean;
  googleSignIn: boolean;
  onSignedIn: (user: UserDto) => void;
}

const GOOGLE_ERRORS: Record<string, string> = {
  setup: "Create the admin account before anyone signs in with Google.",
  expired: "That Google sign-in timed out. Try again.",
  cancelled: "Google sign-in was cancelled.",
  rejected: "Google sign-in didn't work. Try again.",
  unavailable: "printmax couldn't reach Google. Try again in a moment.",
  unverified: "That Google account has no verified email address.",
  domain: "That Google account isn't allowed to use printmax. Sign in with your work account.",
  conflict: "That email is already linked to a different Google account. Ask an administrator.",
};

/** The Google callback lands back here with a refusal code in the query string; take it once and tidy the address bar. */
function takeGoogleError(): string | null {
  const code = new URLSearchParams(window.location.search).get("google_error");
  if (code === null)
    return null;
  window.history.replaceState(null, "", window.location.pathname);
  return Object.hasOwn(GOOGLE_ERRORS, code) ? GOOGLE_ERRORS[code]! : GOOGLE_ERRORS.rejected!;
}

export function LoginPage({ needsSetup, setupTokenRequired, googleSignIn, onSignedIn }: Props) {
  const [googleError] = useState(takeGoogleError);
  const [name, setName] = useState("");
  const [setupToken, setSetupToken] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const { error, fail, clear } = useAsyncError();

  async function submit(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    clear();
    try {
      const user = needsSetup ? await api.setup({ name, email, password, ...(setupTokenRequired ? { setupToken } : {}) }) : await api.login({ email, password });
      onSignedIn(user);
    }
    catch (err) {
      fail(err);
    }
    finally {
      setBusy(false);
    }
  }

  return (
    <div className="auth">
      <form className="panel" onSubmit={submit}>
        <div className="panel-body">
          <div className="brand">
            <BrandMark />
            printmax
          </div>
          <h1>{needsSetup ? "Create the admin account" : "Sign in"}</h1>
          <p className="lede">{needsSetup ? "No accounts exist yet. This first account administers printers, presets and users." : googleSignIn ? "Use your work Google account, or the account an administrator created for you." : "Use the account an administrator created for you."}</p>
          {!needsSetup && googleSignIn && (
            <>
              <a className="btn btn-lg btn-block" href="/api/auth/google">Sign in with Google</a>
              {googleError && <Notice tone="error">{googleError}</Notice>}
              <p className="or">or</p>
            </>
          )}
          {needsSetup && (
            <Field label="Name">
              <input className="control" required autoComplete="name" value={name} onChange={e => setName(e.target.value)} />
            </Field>
          )}
          <Field label="Email">
            <input className="control" type="email" required autoComplete="username" value={email} onChange={e => setEmail(e.target.value)} />
          </Field>
          <Field label="Password" hint={needsSetup ? "At least 8 characters." : undefined}>
            <input className="control" type="password" required minLength={needsSetup ? 8 : undefined} autoComplete={needsSetup ? "new-password" : "current-password"} value={password} onChange={e => setPassword(e.target.value)} />
          </Field>
          {needsSetup && setupTokenRequired && (
            <Field label="Setup token" hint="Printed in the server log when printmax started, or the SETUP_TOKEN you configured.">
              <input className="control" required autoComplete="off" spellCheck={false} value={setupToken} onChange={e => setSetupToken(e.target.value)} />
            </Field>
          )}
          {error && <Notice tone="error">{error}</Notice>}
          <Button type="submit" variant="primary" size="lg" loading={busy} className="btn-block">
            {needsSetup ? "Create account" : "Sign in"}
          </Button>
          {!needsSetup && <p className="forgot">Forgotten your password? An administrator can reset it.</p>}
        </div>
      </form>
    </div>
  );
}
