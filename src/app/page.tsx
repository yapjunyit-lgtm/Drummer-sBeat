import Link from "next/link";
import AuthButton from "@/components/AuthButton";

const FEATURES = [
  {
    zh: "音色分区",
    en: "Three sound zones",
    desc: "鼓心 (center), 鼓边 (edge) and 鼓圆 (rim) hits on one visual grid.",
    mark: "●",
  },
  {
    zh: "节奏编排",
    en: "Rhythm patterns",
    desc: "Quarter, eighth, triplet, 16th and 32nd slots per beat.",
    mark: "≫",
  },
  {
    zh: "即时回放",
    en: "Real-time playback",
    desc: "Tone.js audio engine with a playhead that sweeps the score.",
    mark: "▶",
  },
  {
    zh: "社区分享",
    en: "Community hub",
    desc: "Publish, discover, like, comment and fork scores. Phase 3.",
    mark: "◈",
  },
];

const ZONE_ROW = [
  { symbol: "●", zh: "鼓心", en: "Center" },
  { symbol: "✕", zh: "鼓边", en: "Edge" },
  { symbol: "▷", zh: "鼓圆", en: "Frame" },
];

export default function Home() {
  return (
    <main id="main" className="flex flex-1 flex-col">
      <header className="mx-auto flex w-full max-w-5xl items-center justify-between px-4 py-6">
        <span className="text-lg font-bold tracking-tight">
          Drummer&apos;s Beat <span className="text-zinc-500">· 节拍鼓韵</span>
        </span>
        <div className="flex items-center gap-2">
          <Link
            href="/dashboard"
            className="rounded-lg border border-zinc-700 px-4 py-2 text-sm text-zinc-200 transition-colors hover:border-zinc-500 hover:text-white"
          >
            My Dashboard 我的项目
          </Link>
          <AuthButton />
        </div>
      </header>

      <section className="relative mx-auto flex w-full max-w-5xl flex-1 flex-col items-center justify-center overflow-hidden px-4 pb-24 pt-20 text-center">
        {/* One contained accent: a warm drum-energy glow behind the hero. */}
        <div
          aria-hidden
          className="pointer-events-none absolute left-1/2 top-[-220px] h-[520px] w-[720px] -translate-x-1/2 rounded-full opacity-60"
          style={{
            background:
              "radial-gradient(closest-side, rgb(245 158 11 / 0.16), transparent)",
          }}
        />
        <div className="animate-fade-up relative">
          <p className="mb-5 rounded-full border border-amber-500/30 bg-amber-500/10 px-4 py-1 text-sm text-amber-300">
            为二十四节令鼓而生的在线鼓谱编辑器
          </p>
          <h1 className="mx-auto max-w-3xl text-4xl font-bold leading-[1.05] tracking-tight sm:text-6xl">
            Compose for{" "}
            <span className="text-amber-400">24 Festive Drums</span>
            <span className="text-zinc-500"> in your browser.</span>
          </h1>
          <p className="mx-auto mt-6 max-w-xl text-lg leading-relaxed text-zinc-400">
            Click beats to build 鼓心, 鼓边 and 鼓圆 rhythms, hear them
            instantly, and export a score worthy of the stage.
          </p>
          <div className="mt-10 flex flex-col justify-center gap-3 sm:flex-row">
            <Link
              href="/dashboard"
              className="rounded-xl bg-amber-500 px-7 py-3 text-base font-semibold text-zinc-950 shadow-lg shadow-amber-500/20 transition-colors hover:bg-amber-400"
            >
              Start Composing
            </Link>
            <a
              href="#features"
              className="rounded-xl border border-zinc-700 px-7 py-3 text-base font-semibold text-zinc-200 transition-colors hover:border-zinc-500 hover:text-white"
            >
              How it works
            </a>
          </div>
          <div className="mt-12 flex items-center justify-center gap-6 text-sm text-zinc-500">
            {ZONE_ROW.map((z) => (
              <span key={z.en} className="flex items-center gap-2">
                <span className="text-base text-zinc-300">{z.symbol}</span>
                {z.zh} <span className="hidden text-zinc-600 sm:inline">{z.en}</span>
              </span>
            ))}
          </div>
        </div>
      </section>

      <section id="features" className="mx-auto w-full max-w-5xl px-4 py-20">
        <div className="grid gap-x-12 gap-y-10 sm:grid-cols-2">
          {FEATURES.map((f) => (
            <div key={f.en} className="border-t border-zinc-800 pt-6">
              <div className="flex items-center gap-3">
                <span className="text-lg text-amber-400/80">{f.mark}</span>
                <h2 className="text-xl font-semibold tracking-tight">{f.zh}</h2>
                <span className="text-sm text-zinc-500">{f.en}</span>
              </div>
              <p className="mt-2 max-w-[52ch] text-sm leading-6 text-zinc-400">
                {f.desc}
              </p>
            </div>
          ))}
        </div>
      </section>

      <footer className="border-t border-zinc-900 py-8 text-center text-sm text-zinc-600">
        Drummer&apos;s Beat · MVP editor. Next up: accounts &amp; the
        community hub.
      </footer>
    </main>
  );
}
