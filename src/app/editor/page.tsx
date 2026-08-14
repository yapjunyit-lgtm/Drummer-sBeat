import Link from "next/link";
import AuthGate from "@/components/AuthGate";
import AuthButton from "@/components/AuthButton";
import StaveEditor from "@/components/StaveEditor";

export default function EditorPage() {
  return (
    <AuthGate>
    <main
      id="main"
      className="mx-auto flex h-dvh w-full max-w-[1700px] flex-col overflow-hidden"
    >
      <header className="flex shrink-0 items-center justify-between border-b border-zinc-800 bg-zinc-950 px-6 py-3">
        <Link
          href="/"
          className="text-sm text-zinc-500 transition-colors hover:text-zinc-200"
        >
          ← Drummer&apos;s Beat
        </Link>
        <AuthButton />
      </header>
      <div className="flex min-h-0 flex-1 flex-col">
        <StaveEditor />
      </div>
    </main>
    </AuthGate>
  );
}
