"use client";

import { useRouter } from "next/navigation";
import { useEffect, type ReactNode } from "react";
import { useAuth } from "@/components/AuthProvider";

/* Blocks signed-out users from data pages: redirects to /login (remembering
   where they came from) and renders nothing sensitive until the session is
   confirmed. */
export default function AuthGate({ children }: { children: ReactNode }) {
  const { status } = useAuth();
  const router = useRouter();

  useEffect(() => {
    if (status === "signed-out") {
      const next = encodeURIComponent(
        window.location.pathname + window.location.search
      );
      router.replace(`/login?next=${next}`);
    }
  }, [status, router]);

  if (status !== "signed-in") {
    return (
      <div className="flex h-64 items-center justify-center text-sm text-zinc-500">
        Checking session… 检查登录状态…
      </div>
    );
  }
  return <>{children}</>;
}
