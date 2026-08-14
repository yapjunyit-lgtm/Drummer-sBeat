"use client";

import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { Suspense, useEffect, useState, type FormEvent } from "react";
import { useAuth } from "@/components/AuthProvider";
import { isSupabaseConfigured, supabase } from "@/lib/supabase";

function LoginInner() {
  const router = useRouter();
  const params = useSearchParams();
  const next = params.get("next") ?? "/dashboard";
  const { status } = useAuth();

  const [mode, setMode] = useState<"in" | "up">("in");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<{
    kind: "ok" | "error";
    text: string;
  } | null>(null);

  useEffect(() => {
    if (status === "signed-in") router.replace(next);
  }, [status, next, router]);

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    if (!supabase) return;
    setBusy(true);
    setMessage(null);
    try {
      if (mode === "in") {
        const { error } = await supabase.auth.signInWithPassword({
          email,
          password,
        });
        if (error) throw error;
        router.push(next);
      } else {
        const { error } = await supabase.auth.signUp({
          email,
          password,
          options: { emailRedirectTo: `${location.origin}/dashboard` },
        });
        if (error) throw error;
        setMessage({
          kind: "ok",
          text: "Account created! Check your email to confirm, then sign in. 账号已创建，请查收邮件确认后再登录。",
        });
      }
    } catch (err) {
      setMessage({
        kind: "error",
        text:
          err instanceof Error
            ? err.message
            : "Something went wrong 出了点问题",
      });
    } finally {
      setBusy(false);
    }
  };

  const google = async () => {
    if (!supabase) return;
    setMessage(null);
    try {
      const { error } = await supabase.auth.signInWithOAuth({
        provider: "google",
        options: { redirectTo: `${location.origin}/dashboard` },
      });
      if (error) throw error;
    } catch (err) {
      setMessage({
        kind: "error",
        text:
          err instanceof Error
            ? err.message
            : "Google sign-in failed Google 登录失败",
      });
    }
  };

  return (
    <main className="mx-auto flex w-full max-w-md flex-1 flex-col justify-center px-4 py-12">
      <Link
        href="/"
        className="mb-6 text-sm text-zinc-500 transition-colors hover:text-zinc-200"
      >
        ← Drummer&apos;s Beat 节拍鼓韵
      </Link>
      <div className="rounded-2xl border border-zinc-800 bg-zinc-900/70 p-6 shadow-xl">
        <h1 className="text-xl font-bold">
          {mode === "in" ? "Sign in 登录" : "Create account 注册"}
        </h1>
        <p className="mt-1 text-sm text-zinc-500">
          {mode === "in"
            ? "Welcome back to your projects. 欢迎回来。"
            : "Join to share and collaborate on scores. 注册后即可协作编辑。"}
        </p>

        {!isSupabaseConfigured && (
          <div className="mt-4 rounded-xl border border-amber-500/40 bg-amber-500/10 p-3 text-xs leading-5 text-amber-200">
            Cloud features are not configured yet. Add the Supabase env vars
            (see <span className="font-mono">docs/DEPLOYMENT.md</span>) to
            enable accounts and sharing. 云服务尚未配置。
          </div>
        )}

        <form onSubmit={submit} className="mt-5 space-y-3">
          <label className="block">
            <span className="mb-1 block text-xs font-semibold uppercase tracking-wider text-zinc-500">
              Email 邮箱
            </span>
            <input
              type="email"
              required
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              autoComplete="email"
              className="w-full rounded-lg border border-zinc-700 bg-zinc-800 px-3 py-2 text-sm text-zinc-100 focus:border-amber-500 focus:outline-none"
            />
          </label>
          <label className="block">
            <span className="mb-1 block text-xs font-semibold uppercase tracking-wider text-zinc-500">
              Password 密码
            </span>
            <input
              type="password"
              required
              minLength={6}
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              autoComplete={mode === "in" ? "current-password" : "new-password"}
              className="w-full rounded-lg border border-zinc-700 bg-zinc-800 px-3 py-2 text-sm text-zinc-100 focus:border-amber-500 focus:outline-none"
            />
          </label>
          {message && (
            <p
              className={
                message.kind === "ok"
                  ? "text-xs text-emerald-400"
                  : "text-xs text-red-400"
              }
            >
              {message.text}
            </p>
          )}
          <button
            type="submit"
            disabled={busy || !isSupabaseConfigured}
            className="w-full rounded-xl bg-amber-500 px-4 py-2.5 font-semibold text-zinc-950 transition-colors hover:bg-amber-400 disabled:cursor-not-allowed disabled:opacity-50"
          >
            {busy
              ? "Please wait… 请稍候"
              : mode === "in"
                ? "Sign in 登录"
                : "Create account 注册"}
          </button>
        </form>

        <div className="my-4 flex items-center gap-3 text-xs text-zinc-500">
          <span className="h-px flex-1 bg-zinc-700" />
          or 或者
          <span className="h-px flex-1 bg-zinc-700" />
        </div>
        <button
          onClick={google}
          disabled={!isSupabaseConfigured}
          className="w-full rounded-xl border border-zinc-700 px-4 py-2.5 text-sm font-semibold text-zinc-200 transition-colors hover:border-zinc-500 disabled:cursor-not-allowed disabled:opacity-50"
        >
          <svg className="mr-2 inline h-4 w-4 align-text-bottom" viewBox="0 0 24 24" aria-hidden="true">
            <path fill="#4285F4" d="M23.5 12.27c0-.85-.08-1.66-.22-2.45H12v4.64h6.45a5.52 5.52 0 0 1-2.39 3.62v3h3.87c2.26-2.09 3.57-5.16 3.57-8.81z" />
            <path fill="#34A853" d="M12 24c3.24 0 5.96-1.07 7.94-2.91l-3.87-3c-1.08.72-2.45 1.15-4.07 1.15-3.13 0-5.78-2.11-6.73-4.96H1.29v3.1A12 12 0 0 0 12 24z" />
            <path fill="#FBBC05" d="M5.27 14.28a7.2 7.2 0 0 1 0-4.56v-3.1H1.29a12 12 0 0 0 0 10.76z" />
            <path fill="#EA4335" d="M12 4.76c1.76 0 3.34.6 4.58 1.79l3.44-3.44A12 12 0 0 0 1.29 6.62l3.98 3.1C6.22 6.87 8.87 4.76 12 4.76z" />
          </svg>
          Continue with Google
        </button>

        <button
          onClick={() => {
            setMode(mode === "in" ? "up" : "in");
            setMessage(null);
          }}
          className="mt-4 w-full text-center text-xs text-zinc-400 transition-colors hover:text-amber-300"
        >
          {mode === "in"
            ? "New here? Create an account 新用户？注册账号"
            : "Already have an account? Sign in 已有账号？登录"}
        </button>
      </div>
    </main>
  );
}

export default function LoginPage() {
  return (
    <Suspense>
      <LoginInner />
    </Suspense>
  );
}
