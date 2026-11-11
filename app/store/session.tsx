import { createContext, useCallback, useContext, useEffect, useMemo, useState } from "react";
import type { PropsWithChildren } from "react";
import { api, tokenStorage } from "@/services/api";
import * as auth from "@/services/auth";
import type { AuthResponse, Credentials, RegisterInput } from "@/services/auth";
import { clearLocalData } from "@/services/local-data";
import { deleteAccount as deleteAccountOnServer, takeDevicePushToken } from "@/services/users";

export type SessionStatus = "loading" | "authenticated" | "unauthenticated";

/** Lo que el login cuenta al llegar: por ahora, que la cuenta se eliminó. */
export type SessionNotice = "accountDeleted";

export interface Session {
  status: SessionStatus;
  pendingGoals: boolean;
  notice: SessionNotice | null;
  signIn(credentials: Credentials): Promise<void>;
  signUp(input: RegisterInput): Promise<void>;
  signOut(): Promise<void>;
  /**
   * Borra la cuenta. Hasta que el servidor confirma no se toca nada local: si falla,
   * lanza y se puede reintentar. Confirmado, limpia los tokens y los archivos del teléfono y
   * vuelve al login con el aviso.
   */
  deleteAccount(): Promise<void>;
  finishOnboarding(): void;
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
  const [pendingGoals, setPendingGoals] = useState(false);
  const [notice, setNotice] = useState<SessionNotice | null>(null);

  useEffect(
    () =>
      api.onSessionExpired(() => {
        // Sin sesión no hay cómo sacar el token: lo mueve la próxima cuenta que entre.
        takeDevicePushToken();
        setPendingGoals(false);
        setStatus("unauthenticated");
      }),
    [],
  );

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
    setNotice(null);
    setStatus("authenticated");
  }, []);

  const signUp = useCallback(async (input: RegisterInput) => {
    await startSession(await auth.register(input));
    setNotice(null);
    setPendingGoals(true);
    setStatus("authenticated");
  }, []);

  const signOut = useCallback(async () => {
    try {
      const tokens = await tokenStorage.get();
      const pushToken = takeDevicePushToken();
      if (tokens) auth.logout(tokens, pushToken).catch(() => undefined);
      await api.clearSession();
    } finally {
      setPendingGoals(false);
      setStatus("unauthenticated");
    }
  }, []);

  const deleteAccount = useCallback(async () => {
    await deleteAccountOnServer();
    // El token de avisos de este teléfono se borró con la cuenta.
    takeDevicePushToken();
    try {
      await api.clearSession();
      await clearLocalData();
    } finally {
      setPendingGoals(false);
      setNotice("accountDeleted");
      setStatus("unauthenticated");
    }
  }, []);

  const finishOnboarding = useCallback(() => setPendingGoals(false), []);

  const session = useMemo(
    () => ({
      status,
      pendingGoals,
      notice,
      signIn,
      signUp,
      signOut,
      deleteAccount,
      finishOnboarding,
    }),
    [status, pendingGoals, notice, signIn, signUp, signOut, deleteAccount, finishOnboarding],
  );

  return <SessionContext value={session}>{children}</SessionContext>;
}

export function useSession(): Session {
  const session = useContext(SessionContext);
  if (!session) throw new Error("useSession se usa dentro de <SessionProvider>");
  return session;
}
