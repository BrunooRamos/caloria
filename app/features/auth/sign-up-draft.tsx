import { router } from "expo-router";
import { createContext, useCallback, useContext, useMemo, useState } from "react";
import type { PropsWithChildren } from "react";
import { deviceTimeZone } from "@/features/profile/timezone";
import { EMPTY_PROFILE } from "@/features/profile/validation";
import type { ProfileInput, ProfileValues } from "@/features/profile/validation";
import { ApiError } from "@/services/api-error";
import type { Credentials } from "@/services/auth";
import { useSession } from "@/store/session";

export interface SignUpDraft {
  credentials: Credentials | null;
  profile: ProfileValues;
  error: ApiError | null;
  start(credentials: Credentials): void;
  saveProfile(values: Partial<ProfileValues>): void;
  complete(profile: ProfileInput): Promise<void>;
}

const SignUpDraftContext = createContext<SignUpDraft | null>(null);

export function SignUpDraftProvider({ children }: PropsWithChildren) {
  const { signUp } = useSession();
  const [credentials, setCredentials] = useState<Credentials | null>(null);
  const [profile, setProfile] = useState<ProfileValues>(EMPTY_PROFILE);
  const [error, setError] = useState<ApiError | null>(null);

  const start = useCallback((next: Credentials) => {
    setCredentials(next);
    setError(null);
  }, []);

  const saveProfile = useCallback((values: Partial<ProfileValues>) => {
    setProfile((current) => ({ ...current, ...values }));
  }, []);

  const complete = useCallback(
    async (input: ProfileInput) => {
      if (!credentials) throw new Error("No hay un registro en curso");
      try {
        await signUp({ ...credentials, profile: { ...input, timezone: deviceTimeZone() } });
      } catch (err) {
        if (!(err instanceof ApiError && err.code === "EMAIL_TAKEN")) throw err;
        setError(err);
        router.dismissTo("/register");
      }
    },
    [credentials, signUp],
  );

  const draft = useMemo(
    () => ({ credentials, profile, error, start, saveProfile, complete }),
    [credentials, profile, error, start, saveProfile, complete],
  );

  return <SignUpDraftContext value={draft}>{children}</SignUpDraftContext>;
}

export function useSignUpDraft(): SignUpDraft {
  const draft = useContext(SignUpDraftContext);
  if (!draft) throw new Error("useSignUpDraft se usa dentro de <SignUpDraftProvider>");
  return draft;
}
