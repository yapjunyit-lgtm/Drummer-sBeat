"use client";

import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import { useAuth } from "@/components/AuthProvider";

/* Compact auth control for page headers: shows local/sign-in state, and for a
   signed-in user a small avatar menu with sign out. */
export default function AuthButton() {
  const { status, user, signOut } = useAuth();
  const [open, setOpen] = useState(false);
  const menuRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    const onDoc = (e: MouseEvent) => {
      if (!menuRef.current?.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", onDoc);
    return () => document.removeEventListener("mousedown", onDoc);
  }, []);

  if (status === "local") {
    return (
      <span
        title="Running in local mode — connect Supabase for sharing 本地模式，配置 Supabase 后可分享"
        className="rounded-full border border-zinc-800 px-3 py-1.5 text-xs text-zinc-500"
      >
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round" className="mr-1 inline h-3.5 w-3.5 align-text-bottom" aria-hidden="true">
          <path d="M17.5 19a4.5 4.5 0 0 0 .9-8.9 6 6 0 0 0-11.6 1.6A3.8 3.8 0 0 0 6.5 19z" />
        </svg>
        Local 本地
      </span>
    );
  }
  if (status === "loading") {
    return (
      <span className="h-8 w-20 animate-pulse rounded-full bg-zinc-800" />
    );
  }
  if (status === "signed-out" || !user) {
    return (
      <Link
        href="/login"
        className="rounded-full border border-zinc-700 px-4 py-1.5 text-xs font-semibold text-zinc-200 transition-colors hover:border-amber-500 hover:text-amber-300"
      >
        Sign in 登录
      </Link>
    );
  }

  const initial = (user.email ?? user.id)[0]?.toUpperCase() ?? "?";
  const name =
    user.user_metadata?.full_name ??
    user.user_metadata?.name ??
    user.email?.split("@")[0] ??
    "User";

  return (
    <div ref={menuRef} className="relative">
      <button
        onClick={() => setOpen((v) => !v)}
        aria-haspopup="menu"
        aria-expanded={open}
        className="flex items-center gap-2 rounded-full border border-zinc-700 py-1 pl-1 pr-3 text-xs font-semibold text-zinc-200 transition-colors hover:border-amber-500/70"
      >
        <span className="flex h-6 w-6 items-center justify-center rounded-full bg-amber-500 text-xs font-bold text-zinc-950">
          {initial}
        </span>
        <span className="max-w-28 truncate">{name}</span>
        <span className="text-zinc-600" aria-hidden="true">
          <svg
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            strokeLinecap="round"
            strokeLinejoin="round"
            className="h-3 w-3"
            style={{ transform: open ? "rotate(180deg)" : undefined, transition: "transform 150ms" }}
          >
            <path d="m6 9 6 6 6-6" />
          </svg>
        </span>
      </button>
      {open && (
        <div
          role="menu"
          className="absolute right-0 top-full z-50 mt-2 w-56 overflow-hidden rounded-xl border border-zinc-700 bg-zinc-900 shadow-2xl"
        >
          <div className="border-b border-zinc-800 px-4 py-3">
            <div className="truncate text-sm font-semibold text-zinc-100">
              {name}
            </div>
            <div className="truncate text-xs text-zinc-500">
              {user.email}
            </div>
          </div>
          <Link
            href="/dashboard"
            onClick={() => setOpen(false)}
            className="block px-4 py-2.5 text-sm text-zinc-300 transition-colors hover:bg-zinc-800 hover:text-amber-300"
          >
            Dashboard 项目工作台
          </Link>
          <button
            onClick={() => void signOut()}
            className="block w-full px-4 py-2.5 text-left text-sm text-red-400 transition-colors hover:bg-zinc-800"
          >
            Sign out 退出登录
          </button>
        </div>
      )}
    </div>
  );
}
