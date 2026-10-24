import { router } from "expo-router";
import { createContext, useCallback, useContext, useMemo, useState } from "react";
import type { PropsWithChildren } from "react";
import { ApiError } from "@/services/api-error";
import type { Credentials, Profile } from "@/services/auth";
import { useSession } from "@/store/session";

export interface SignUpDraft {
  credentials: Credentials | null;
  error: ApiError | null;
  start(credentials: Credentials): void;
  complete(profile: Profile): Promise<void>;
}

const SignUpDraftContext = createContext<SignUpDraft | null>(null);

export function SignUpDraftProvider({ children }: PropsWithChildren) {
  const { signUp } = useSession();
  const [credentials, setCredentials] = useState<Credentials | null>(null);
  const [error, setError] = useState<ApiError | null>(null);

  const start = useCallback((next: Credentials) => {
    setCredentials(next);
    setError(null);
  }, []);

  const complete = useCallback(
    async (profile: Profile) => {
      if (!credentials) throw new Error("No hay un registro en curso");
      try {
        await signUp({ ...credentials, profile });
      } catch (err) {
        if (!(err instanceof ApiError && err.code === "EMAIL_TAKEN")) throw err;
        setError(err);
        router.dismissTo("/register");
      }
    },
    [credentials, signUp],
  );

  const draft = useMemo(
    () => ({ credentials, error, start, complete }),
    [credentials, error, start, complete],
  );

  return <SignUpDraftContext value={draft}>{children}</SignUpDraftContext>;
}

export function useSignUpDraft(): SignUpDraft {
  const draft = useContext(SignUpDraftContext);
  if (!draft) throw new Error("useSignUpDraft se usa dentro de <SignUpDraftProvider>");
  return draft;
}
