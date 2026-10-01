import Link from "next/link";
import AuthGate from "@/components/AuthGate";
import AuthButton from "@/components/AuthButton";
import Brand from "@/components/Brand";
import StaveEditor from "@/components/StaveEditor";

export default function EditorPage() {
  return (
    <AuthGate>
    <main
      id="main"
      className="editor-shell mx-auto flex h-dvh w-full flex-col overflow-hidden"
    >
      <header className="site-header editor-header">
        <Brand />
        <nav aria-label="Editor navigation" className="flex items-center gap-4">
        <Link
          href="/dashboard"
          className="text-sm font-medium text-zinc-300 transition-colors hover:text-amber-300"
        >
          ← My scores <span className="hidden sm:inline">我的乐谱</span>
        </Link>
        <AuthButton />
        </nav>
      </header>
      <div className="flex min-h-0 flex-1 flex-col">
        <StaveEditor />
      </div>
    </main>
    </AuthGate>
  );
}
