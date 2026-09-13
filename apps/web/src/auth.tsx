import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from "react";
import type {
  LoginChallenge,
  LoginInput,
  RegisterInput,
  UpdateProfileInput,
  User,
} from "@ai-arcade/shared";
import { api, API_URL } from "./api";

interface Providers {
  password: boolean;
  github: boolean;
  devLogin: boolean;
  emailDeliveryConfigured: boolean;
}

interface AuthValue {
  user: User | null;
  loading: boolean;
  providers: Providers;
  isModerator: boolean;
  refresh: () => Promise<void>;
  /** Creates the account and emails a sign-in code. Doesn't sign you in yet. */
  register: (input: RegisterInput) => Promise<LoginChallenge>;
  /** Checks the password and emails a sign-in code. Doesn't sign you in yet. */
  login: (input: LoginInput) => Promise<LoginChallenge>;
  /** The code from email + the challenge token → an actual session. */
  verifyLogin: (loginToken: string, code: string) => Promise<void>;
  resendLoginCode: (loginToken: string) => Promise<{ expiresInSeconds: number }>;
  devLogin: (email: string, displayName?: string) => Promise<void>;
  updateProfile: (input: UpdateProfileInput) => Promise<void>;
  changePassword: (newPassword: string, currentPassword?: string) => Promise<void>;
  logout: () => Promise<void>;
}

const AuthContext = createContext<AuthValue | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<User | null>(null);
  const [loading, setLoading] = useState(true);
  const [providers, setProviders] = useState<Providers>({
    password: false,
    github: false,
    devLogin: false,
    emailDeliveryConfigured: false,
  });

  const refresh = useCallback(async () => {
    try {
      const res = await api.session();
      setUser(res.user);
    } catch {
      setUser(null);
    }
  }, []);

  useEffect(() => {
    (async () => {
      await Promise.allSettled([
        refresh(),
        fetch(`${API_URL}/auth/providers`)
          .then((r) => r.json())
          .then((p: Providers) => setProviders(p))
          .catch(() => undefined),
      ]);
      setLoading(false);
    })();
  }, [refresh]);

  const register = useCallback((input: RegisterInput) => api.register(input), []);
  const login = useCallback((input: LoginInput) => api.login(input), []);

  const verifyLogin = useCallback(
    async (loginToken: string, code: string) => {
      await api.verifyLogin({ loginToken, code });
      await refresh();
    },
    [refresh],
  );

  const resendLoginCode = useCallback(
    (loginToken: string) => api.resendLoginCode({ loginToken }),
    [],
  );

  const devLogin = useCallback(
    async (email: string, displayName?: string) => {
      await api.devLogin(email, displayName);
      await refresh();
    },
    [refresh],
  );

  const updateProfile = useCallback(
    async (input: UpdateProfileInput) => {
      const { user } = await api.updateProfile(input);
      setUser(user);
    },
    [],
  );

  const changePassword = useCallback(
    async (newPassword: string, currentPassword?: string) => {
      await api.changePassword({ newPassword, currentPassword });
      await refresh();
    },
    [refresh],
  );

  const logout = useCallback(async () => {
    await api.logout().catch(() => undefined);
    setUser(null);
  }, []);

  const value = useMemo<AuthValue>(
    () => ({
      user,
      loading,
      providers,
      isModerator: user?.role === "moderator" || user?.role === "admin",
      refresh,
      register,
      login,
      verifyLogin,
      resendLoginCode,
      devLogin,
      updateProfile,
      changePassword,
      logout,
    }),
    [
      user,
      loading,
      providers,
      refresh,
      register,
      login,
      verifyLogin,
      resendLoginCode,
      devLogin,
      updateProfile,
      changePassword,
      logout,
    ],
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthValue {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error("useAuth must be used within AuthProvider");
  return ctx;
}
