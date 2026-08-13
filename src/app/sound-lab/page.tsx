"use client";

import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import * as Tone from "tone";
import {
  buildVoiceSet,
  SOUND_PROFILES,
  type SoundProfile,
  type VoiceSet,
} from "@/lib/soundProfiles";

const ZONES = [
  { id: "center", symbol: "●", zh: "鼓心", color: "text-red-400" },
  { id: "edge", symbol: "✕", zh: "鼓边", color: "text-amber-400" },
  { id: "rim", symbol: "▷", zh: "鼓棒", color: "text-sky-400" },
] as const;

export default function SoundLabPage() {
  const voicesRef = useRef<Map<string, VoiceSet>>(new Map());
  const [active, setActive] = useState<{ profile: string; zone: string } | null>(
    null
  );

  useEffect(() => {
    const voices = voicesRef.current;
    return () => {
      for (const v of voices.values()) v.dispose();
      voices.clear();
    };
  }, []);

  const getVoices = async (profile: SoundProfile): Promise<VoiceSet> => {
    await Tone.start();
    let set = voicesRef.current.get(profile.id);
    if (!set) {
      set = await buildVoiceSet(profile.id);
      voicesRef.current.set(profile.id, set);
    }
    return set;
  };

  const playZone = async (profile: SoundProfile, zone: "center" | "edge" | "rim") => {
    const voices = await getVoices(profile);
    const now = Tone.now();
    if (zone === "center") {
      voices.center.triggerAttackRelease("8n", now);
    } else if (zone === "edge") {
      voices.edge.triggerAttackRelease("8n", now);
    } else {
      voices.rim.triggerAttackRelease("32n", now);
    }
    setActive({ profile: profile.id, zone });
  };

  const playDemo = async (profile: SoundProfile) => {
    const voices = await getVoices(profile);
    const now = Tone.now();
    voices.center.triggerAttackRelease("8n", now);
    voices.edge.triggerAttackRelease("8n", now + 0.45);
    voices.rim.triggerAttackRelease("32n", now + 0.9);
    voices.center.triggerAttackRelease("q", now + 1.35);
    setActive({ profile: profile.id, zone: "demo" });
  };

  return (
    <main id="main" className="mx-auto w-full max-w-5xl flex-1 px-4 py-10">
      <Link
        href="/"
        className="text-sm text-zinc-500 transition-colors hover:text-zinc-200"
      >
        ← Drummer&apos;s Beat 节拍鼓韵
      </Link>
      <header className="mt-2 mb-8">
        <h1 className="text-2xl font-bold tracking-tight">
          Sound Lab 音色试听
        </h1>
        <p className="mt-1 max-w-2xl text-sm leading-6 text-zinc-400">
          Audition the three sound zones under different synthesis profiles.
          Pick the one you like, and we&apos;ll apply it to the main editor —
          nothing here changes the deployed score engine.
          试听不同音色方案，选好后我们再应用到主编辑器。
        </p>
      </header>

      <div className="grid gap-4 sm:grid-cols-2">
        {SOUND_PROFILES.map((profile) => (
          <div
            key={profile.id}
            className="rounded-2xl border border-zinc-800 bg-zinc-900/60 p-5"
          >
            <div className="flex items-baseline justify-between gap-2">
              <h2 className="font-semibold text-zinc-100">
                {profile.name}{" "}
                <span className="text-sm font-normal text-zinc-500">
                  {profile.zh}
                </span>
              </h2>
              {profile.id === "current" && (
                <span className="rounded-full border border-zinc-700 px-2 py-0.5 text-[10px] text-zinc-400">
                  Current 当前
                </span>
              )}
            </div>
            <p className="mt-1.5 min-h-10 text-xs leading-5 text-zinc-500">
              {profile.description}
            </p>

            <div className="mt-4 flex flex-wrap gap-2">
              {ZONES.map((z) => (
                <button
                  key={z.id}
                  onClick={() => void playZone(profile, z.id)}
                  className={[
                    "flex items-center gap-1.5 rounded-xl border px-3.5 py-2 text-sm font-semibold transition-colors",
                    active?.profile === profile.id && active.zone === z.id
                      ? "border-amber-500 bg-amber-500/15 text-amber-300"
                      : "border-zinc-700 text-zinc-300 hover:border-amber-500/70 hover:text-amber-300",
                  ].join(" ")}
                >
                  <span className={z.color}>{z.symbol}</span>
                  {z.zh}
                </button>
              ))}
              <button
                onClick={() => void playDemo(profile)}
                className={[
                  "rounded-xl border px-3.5 py-2 text-sm font-semibold transition-colors",
                  active?.profile === profile.id && active.zone === "demo"
                    ? "border-emerald-500 bg-emerald-500/15 text-emerald-300"
                    : "border-zinc-700 text-zinc-300 hover:border-emerald-500/70 hover:text-emerald-300",
                ].join(" ")}
              >
                ▶ Demo 试听
              </button>
            </div>
          </div>
        ))}
      </div>

      <p className="mt-8 rounded-xl border border-zinc-800 bg-zinc-900/40 p-4 text-xs leading-5 text-zinc-500">
        Tip: play one zone across all four profiles to compare characters —
        the same hit on 鼓心 sounds deep (taiko), round (low tom), or punchy
        (kick); 鼓棒 is dry everywhere but pitched woodblock vs pure click.
        建议：同一音区在四个方案间对比试听。
      </p>
    </main>
  );
}
