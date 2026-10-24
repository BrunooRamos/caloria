import { createContext, useCallback, useContext, useEffect, useMemo, useState } from "react";
import type { PropsWithChildren } from "react";
import { api, tokenStorage } from "@/services/api";
import * as auth from "@/services/auth";
import type { AuthResponse, Credentials, RegisterInput } from "@/services/auth";

export type SessionStatus = "loading" | "authenticated" | "unauthenticated";

export interface Session {
  status: SessionStatus;
  signIn(credentials: Credentials): Promise<void>;
  signUp(input: RegisterInput): Promise<void>;
  /** Borra los tokens al instante; el `/auth/logout` sale en segundo plano y no bloquea si falla. */
  signOut(): Promise<void>;
}

const SessionContext = createContext<Session | null>(null);

export const STARTUP_REFRESH_TIMEOUT_MS = 8000;

async function restoreSession(): Promise<SessionStatus> {
  if (!(await tokenStorage.get())) return "unauthenticated";
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<void>((done) => {
    timer = setTimeout(done, STARTUP_REFRESH_TIMEOUT_MS);
  });
  try {
    await Promise.race([api.refreshSession(), timeout]);
  } catch {
    // El cliente solo borra los tokens si el servidor rechazó el refresh.
  } finally {
    clearTimeout(timer);
  }
  return (await tokenStorage.get()) ? "authenticated" : "unauthenticated";
}

async function startSession({ accessToken, refreshToken }: AuthResponse): Promise<void> {
  await tokenStorage.set({ accessToken, refreshToken });
}

export function SessionProvider({ children }: PropsWithChildren) {
  const [status, setStatus] = useState<SessionStatus>("loading");

  useEffect(() => api.onSessionExpired(() => setStatus("unauthenticated")), []);

  useEffect(() => {
    let active = true;
    restoreSession()
      .catch((): SessionStatus => "unauthenticated")
      .then((next) => {
        if (active) setStatus(next);
      });
    return () => {
      active = false;
    };
  }, []);

  const signIn = useCallback(async (credentials: Credentials) => {
    await startSession(await auth.login(credentials));
    setStatus("authenticated");
  }, []);

  const signUp = useCallback(async (input: RegisterInput) => {
    await startSession(await auth.register(input));
    setStatus("authenticated");
  }, []);

  const signOut = useCallback(async () => {
    try {
      const tokens = await tokenStorage.get();
      if (tokens) auth.logout(tokens).catch(() => undefined);
      await api.clearSession();
    } finally {
      setStatus("unauthenticated");
    }
  }, []);

  const session = useMemo(
    () => ({ status, signIn, signUp, signOut }),
    [status, signIn, signUp, signOut],
  );

  return <SessionContext value={session}>{children}</SessionContext>;
}

export function useSession(): Session {
  const session = useContext(SessionContext);
  if (!session) throw new Error("useSession se usa dentro de <SessionProvider>");
  return session;
}
