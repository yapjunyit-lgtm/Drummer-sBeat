import Link from "next/link";
import AuthButton from "@/components/AuthButton";

const FEATURES = [
  {
    zh: "音色分区",
    en: "Three sound zones",
    desc: "鼓心 (center), 鼓边 (edge) and 鼓棒 (drumstick) hits on one visual grid.",
    icon: (
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" className="h-5 w-5">
        <rect x="3.5" y="3.5" width="7.5" height="7.5" rx="1.5" />
        <rect x="13" y="3.5" width="7.5" height="7.5" rx="1.5" />
        <rect x="3.5" y="13" width="7.5" height="7.5" rx="1.5" />
        <rect x="13" y="13" width="7.5" height="7.5" rx="1.5" />
      </svg>
    ),
  },
  {
    zh: "节奏编排",
    en: "Rhythm patterns",
    desc: "Quarter, eighth, triplet, 16th and 32nd slots per beat.",
    icon: (
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" className="h-5 w-5">
        <rect x="4" y="10" width="3" height="9" rx="1" />
        <rect x="9.5" y="6" width="3" height="13" rx="1" />
        <rect x="15" y="8.5" width="3" height="10.5" rx="1" />
        <rect x="20" y="12" width="3" height="7" rx="1" />
      </svg>
    ),
  },
  {
    zh: "即时回放",
    en: "Real-time playback",
    desc: "Tone.js audio engine with a playhead that sweeps the score.",
    icon: (
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round" className="h-5 w-5">
        <circle cx="12" cy="12" r="9" />
        <path d="m9.5 8.5 6 3.5-6 3.5z" fill="currentColor" stroke="none" />
      </svg>
    ),
  },
  {
    zh: "社区分享",
    en: "Community hub",
    desc: "Publish, discover, like, comment and fork scores. Phase 3.",
    icon: (
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round" className="h-5 w-5">
        <circle cx="8" cy="7" r="3" />
        <circle cx="17" cy="10" r="3" />
        <circle cx="8" cy="17" r="3" />
        <path d="M10.5 8.5 15 9.5M10.5 15.5 15 14.5" />
      </svg>
    ),
  },
];

const ZONE_ROW = [
  {
    symbol: "●",
    zh: "鼓心",
    en: "Center",
    icon: (
      <svg viewBox="0 0 24 24" fill="currentColor" className="h-5 w-5">
        <circle cx="12" cy="12" r="8" />
      </svg>
    ),
  },
  {
    symbol: "✕",
    zh: "鼓边",
    en: "Edge",
    icon: (
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="h-5 w-5">
        <circle cx="12" cy="12" r="8" />
        <circle cx="8.4" cy="15.6" r="2.4" fill="currentColor" stroke="none" />
      </svg>
    ),
  },
  {
    symbol: "▷",
    zh: "鼓棒",
    en: "Drumstick",
    icon: (
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" className="h-5 w-5">
        <path d="M6 18 16 8" />
        <circle cx="16.5" cy="7.5" r="2.4" fill="currentColor" stroke="none" />
      </svg>
    ),
  },
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
              "radial-gradient(closest-side, rgb(242 169 59 / 0.16), transparent)",
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
            Click beats to build 鼓心, 鼓边 and 鼓棒 rhythms, hear them
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
                <span className="text-amber-400">{z.icon}</span>
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
                <span className="text-amber-400/80">{f.icon}</span>
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
