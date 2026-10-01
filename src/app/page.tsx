import Link from "next/link";
import AuthButton from "@/components/AuthButton";
import Brand from "@/components/Brand";

const STEPS = [
  ["Write your rhythm", "写下节奏", "Choose drum heart, drum side or drumstick. Place your notes directly on the score."],
  ["Hear it take shape", "聆听回放", "Play your score with recorded drum sounds. Adjust the tempo or practise with the metronome."],
  ["Bring everyone together", "一起排练", "Arrange parts for your drummers, share scores with collaborators, and export a PDF for rehearsal."],
];

export default function Home() {
  return (
    <main id="main" className="flex flex-1 flex-col">
      <header className="site-header">
        <Brand />
        <nav aria-label="Main navigation" className="flex items-center gap-3 sm:gap-6">
          <Link href="/dashboard" className="text-sm font-medium text-zinc-300 hover:text-amber-300">
            My scores <span className="hidden sm:inline">我的乐谱</span>
          </Link>
          <AuthButton />
        </nav>
      </header>
      <section className="hero">
        <div className="animate-fade-up">
          <h1>Give your <em>rhythm</em> a home.</h1>
          <p className="hero-copy mt-7">
            A thoughtful workspace for 24 Festive Drums.
            Write a score, hear each beat, and bring your ensemble together.
          </p>
          <p className="mt-3 text-sm text-zinc-500">为二十四节令鼓而生，写谱、回放、一起排练。</p>
          <div className="mt-8 flex flex-wrap items-center gap-6">
            <Link href="/dashboard" className="primary-action">
              Start composing 开始写谱
              <span className="action-arrow" aria-hidden="true">↗</span>
            </Link>
            <a href="#how-it-works" className="text-sm font-medium text-zinc-300 underline decoration-zinc-700 underline-offset-4 hover:text-amber-300">
              How it works
            </a>
          </div>
        </div>
        <figure className="preview-shell animate-fade-up">
          <div className="preview-core">
            <div className="flex items-center justify-between gap-3">
              <div>
                <h2 className="text-xl font-semibold tracking-tight">A rhythm, at a glance.</h2>
                <p className="mt-1 text-xs text-zinc-500">Your notes. Your ensemble. 一起合奏。</p>
              </div>
              <span className="rounded-full bg-amber-500/10 px-3 py-1.5 text-xs font-medium text-amber-300">4 / 4</span>
            </div>
            <svg viewBox="0 0 440 190" className="preview-score" role="img" aria-label="Illustrative drum score: two measures with heart, side and drumstick notes">
              <path d="M12 78h416" stroke="#cfc6b7" strokeWidth="0.8" />
              <path d="M12 62v32M218 62v32M426 62v32M430 62v32" stroke="currentColor" strokeWidth="1.4" />
              {[48, 92, 140, 184, 260, 304, 350, 394].map((x, i) => (
                <g key={x}>
                  <path d={`M${x + 5} 78V35`} stroke="currentColor" strokeWidth="1.5" />
                  {i === 2 || i === 5 ? (
                    <path d={`m${x - 5} 73 10 10m0-10-10 10`} stroke="currentColor" strokeWidth="2" />
                  ) : i === 6 ? (
                    <path d={`M${x - 4} 73v10l10-5Z`} fill="none" stroke="currentColor" strokeWidth="1.5" />
                  ) : <ellipse cx={x} cy="78" rx="6" ry="4.5" fill="currentColor" transform={`rotate(-20 ${x} 78)`} />}
                  <text x={x} y="138" textAnchor="middle" fontSize="11" fill="#71695e">{i % 4 + 1}</text>
                </g>
              ))}
              <text x="15" y="20" fontSize="11" fill="#71695e">Drummer 1 鼓手 1</text>
            </svg>
            <div className="zone-legend">
              <span><b className="text-amber-300" aria-hidden="true">●</b> Heart 鼓心</span>
              <span><b className="text-amber-300" aria-hidden="true">✕</b> Side 鼓边</span>
              <span><b className="text-amber-300" aria-hidden="true">▷</b> Stick 鼓棒</span>
            </div>
            <figcaption className="mt-5 border-t border-zinc-800 pt-4 text-xs text-zinc-500">
              An illustrative pattern — turn your own ideas into a score.
            </figcaption>
          </div>
        </figure>
      </section>
      <section id="how-it-works" className="home-features">
        <div>
          <h2 className="max-w-72 text-3xl font-medium leading-tight tracking-tight">From the first beat to rehearsal.</h2>
          <p className="mt-5 max-w-72 text-sm leading-7 text-zinc-400">Keep the music in focus. A clear score, familiar controls, and the sound of your drums.</p>
        </div>
        <ol>
          {STEPS.map(([title, zh, description], i) => (
            <li key={title} className="home-feature">
              <span className="pt-1 text-xs font-medium text-amber-300">0{i + 1}</span>
              <div>
                <h3 className="text-lg font-semibold tracking-tight">{title} <span className="ml-2 text-xs font-normal text-zinc-500">{zh}</span></h3>
                <p className="mt-2 max-w-[55ch] text-sm leading-7 text-zinc-400">{description}</p>
              </div>
            </li>
          ))}
        </ol>
      </section>
      <footer className="mx-auto flex w-full max-w-7xl flex-wrap items-center justify-between gap-4 border-t border-zinc-800 px-6 py-8 text-xs text-zinc-500">
        <span>Drummer&apos;s Beat · 二十四节令鼓</span>
        <Link href="/dashboard" className="hover:text-amber-300">Return to your scores →</Link>
      </footer>
    </main>
  );
}
