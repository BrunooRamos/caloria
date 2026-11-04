import { api } from "./api";
import type { AuthTokens } from "./token-storage";

export interface AuthUser {
  id: string;
  email: string;
}

export interface AuthResponse extends AuthTokens {
  user: AuthUser;
}

export interface Credentials {
  email: string;
  password: string;
}

/** Perfil inicial que exige `POST /auth/register` (RF-02). */
export interface Profile {
  sex: "female" | "male";
  /** `YYYY-MM-DD` */
  birthDate: string;
  heightCm: number;
  weightKg: number;
  activity: "sedentary" | "light" | "moderate" | "active" | "very_active";
  goal: "lose" | "maintain" | "gain";
  timezone: string;
}

export interface RegisterInput extends Credentials {
  profile: Profile;
}

export function login(credentials: Credentials): Promise<AuthResponse> {
  return api.post<AuthResponse>("/auth/login", credentials, { auth: false });
}

export function register(input: RegisterInput): Promise<AuthResponse> {
  return api.post<AuthResponse>("/auth/register", input, { auth: false });
}

/** Con `pushToken`, este dispositivo deja de recibir los avisos de la cuenta. */
export function logout(
  { accessToken, refreshToken }: AuthTokens,
  pushToken?: string | null,
): Promise<void> {
  return api.post<void>(
    "/auth/logout",
    pushToken ? { refreshToken, pushToken } : { refreshToken },
    { auth: false, headers: { Authorization: `Bearer ${accessToken}` } },
  );
}
