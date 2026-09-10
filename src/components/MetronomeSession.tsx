"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { MetronomeEngine, type BeatInfo } from "@/lib/metronomeEngine";
import {
  BPM_MAX,
  BPM_MIN,
  bpmFromTaps,
  clampBpm,
  type MetronomeSettings,
  type Subdivision,
} from "@/lib/metronome";
import {
  loadMetronomeSettings,
  saveMetronomeSettings,
} from "@/lib/metronomeSettings";

const SUBDIVISIONS: Subdivision[] = [
  "quarter",
  "eighth",
  "sixteenth",
  "triplet",
  "sextuplet",
];

const SUBDIVISION_LABELS: Record<Subdivision, string> = {
  quarter: "Quarter 四分",
  eighth: "Eighth 八分",
  sixteenth: "Sixteenth 十六分",
  triplet: "Triplet 三连音",
  sextuplet: "Sextuplet 六连音",
};

/* Standalone practice metronome, opened as its own session over the dashboard.

   It shares nothing with score playback: its own settings, its own storage key,
   and an engine that never touches the global audio transport (see
   metronomeEngine.ts). Closing it — by button, Esc, or backdrop — stops the
   sound and hands focus back to whatever opened it.

   Deliberately mount-scoped: the dashboard renders it only while it is open, so
   state initialises fresh per session and there is no prop-change effect to
   keep in sync. */
export default function MetronomeSession({ onClose }: { onClose: () => void }) {
  const engineRef = useRef<MetronomeEngine | null>(null);
  const tapsRef = useRef<number[]>([]);
  const startButtonRef = useRef<HTMLButtonElement | null>(null);
  // Lazy initialiser: reads storage once, on mount, with no cascading render.
  const [settings, setSettings] = useState<MetronomeSettings>(() =>
    loadMetronomeSettings()
  );
  const [running, setRunning] = useState(false);
  const [beat, setBeat] = useState<BeatInfo | null>(null);

  const stop = useCallback(() => {
    engineRef.current?.stop();
    setRunning(false);
    setBeat(null);
  }, []);

  /* Unmount is the one place that must silence the engine: the Tone context
     survives client-side navigation, so a missed cleanup keeps clicking on the
     next page. Focus goes back to whatever opened the panel. Deliberately
     calls the engine directly rather than `stop()`, which would set state on a
     component that is going away. */
  useEffect(() => {
    const previous = document.activeElement as HTMLElement | null;
    startButtonRef.current?.focus();
    return () => {
      engineRef.current?.stop();
      previous?.focus();
    };
  }, []);

  /* A reload or tab close must not leave an orphaned interval behind. */
  useEffect(() => {
    const onHide = () => engineRef.current?.stop();
    window.addEventListener("pagehide", onHide);
    return () => window.removeEventListener("pagehide", onHide);
  }, []);

  /* Settings are saved on the user's action rather than in an effect: an effect
     would also fire on open, writing the defaults back over the values we just
     loaded. */
  const updateSettings = useCallback(
    (patch: Partial<MetronomeSettings>) => {
      const next = { ...settings, ...patch };
      setSettings(next);
      saveMetronomeSettings(next);
      engineRef.current?.update(next);
    },
    [settings]
  );

  const start = useCallback(() => {
    if (!engineRef.current) engineRef.current = new MetronomeEngine();
    engineRef.current.start(settings, setBeat);
    setRunning(true);
  }, [settings]);

  const toggle = useCallback(() => {
    if (running) stop();
    else start();
  }, [running, start, stop]);

  const close = useCallback(() => {
    stop();
    onClose();
  }, [onClose, stop]);

  const tap = useCallback(() => {
    // Keep the last few taps only, so a tempo change mid-tap set converges
    // instead of averaging against stale taps.
    tapsRef.current = [...tapsRef.current, performance.now()].slice(-5);
    const tapped = bpmFromTaps(tapsRef.current);
    if (tapped !== null) updateSettings({ bpm: tapped });
  }, [updateSettings]);

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      const target = event.target as HTMLElement | null;
      const typing =
        target instanceof HTMLInputElement ||
        target instanceof HTMLSelectElement ||
        target?.isContentEditable === true;
      if (event.key === "Escape") {
        event.preventDefault();
        close();
      } else if (event.code === "Space" && !typing) {
        event.preventDefault();
        toggle();
      } else if ((event.key === "t" || event.key === "T") && !typing) {
        tap();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [close, toggle, tap]);

  /* Read once: the beat flash is the only animation here, and a reduce-motion
     user should still see the beat — just without the scale. */
  const reduceMotion = useMemo(
    () =>
      typeof window !== "undefined" &&
      window.matchMedia("(prefers-reduced-motion: reduce)").matches,
    []
  );

  const labelClass =
    "mb-1.5 block text-xs font-semibold uppercase tracking-wider text-zinc-500";
  const fieldClass =
    "w-full rounded-lg border border-zinc-700 bg-zinc-800 px-3 py-2 text-sm text-zinc-100 focus:border-amber-500 focus:outline-none";
  const toggleClass = (active: boolean) =>
    [
      "rounded-lg border px-3 py-2 text-xs font-semibold transition-colors",
      active
        ? "border-amber-500/50 bg-amber-500/10 text-amber-300"
        : "border-zinc-700 text-zinc-400 hover:border-zinc-500 hover:text-zinc-200",
    ].join(" ");

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-zinc-950/80 p-4 backdrop-blur-sm"
      onClick={close}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="metronome-title"
        onClick={(event) => event.stopPropagation()}
        className="w-full max-w-lg rounded-2xl border border-zinc-800 bg-zinc-900/95 p-6 shadow-2xl"
      >
        <header className="mb-6 flex items-start justify-between gap-4">
          <div>
            <h2 id="metronome-title" className="text-xl font-bold tracking-tight">
              Metronome 节拍器
            </h2>
            <p className="mt-1 text-xs text-zinc-500">
              Space start/stop · T tap · Esc close
            </p>
          </div>
          <button
            onClick={close}
            className="rounded-lg border border-zinc-700 px-3 py-1.5 text-xs font-semibold text-zinc-400 transition-colors hover:border-zinc-500 hover:text-zinc-100"
          >
            Close 关闭
          </button>
        </header>

        {/* Beat indicator. Decorative: announcing every beat would flood a
            screen reader, and the audio already carries the information. */}
        <div
          aria-hidden="true"
          className="mb-6 flex h-6 items-center justify-center gap-2"
        >
          {Array.from({ length: settings.beatsPerMeasure }, (_, index) => {
            const active = running && beat?.beat === index;
            const downbeat = index === 0;
            return (
              <span
                key={index}
                className={[
                  "h-3.5 w-3.5 rounded-full",
                  reduceMotion ? "" : "transition-all",
                  active
                    ? downbeat
                      ? "bg-amber-400"
                      : "bg-amber-500/70"
                    : downbeat
                      ? "bg-zinc-600"
                      : "bg-zinc-700",
                  active && !reduceMotion ? "scale-125" : "",
                ].join(" ")}
              />
            );
          })}
          {running && beat?.isCountIn && (
            <span className="ml-2 text-xs font-semibold text-amber-300">
              Count-in 预备
            </span>
          )}
        </div>

        <div className="space-y-5">
          <div>
            <div className="flex items-baseline justify-between">
              <span className={labelClass}>Tempo 速度</span>
              <span className="font-mono text-sm text-zinc-100">
                {settings.bpm} BPM
              </span>
            </div>
            <div className="flex items-center gap-2">
              <input
                type="range"
                min={BPM_MIN}
                max={BPM_MAX}
                value={settings.bpm}
                onChange={(event) =>
                  updateSettings({ bpm: Number(event.target.value) })
                }
                aria-label="Tempo 速度"
                className="flex-1 accent-amber-500"
              />
              <input
                type="number"
                min={BPM_MIN}
                max={BPM_MAX}
                name="metronomeBpm"
                value={settings.bpm}
                onChange={(event) =>
                  updateSettings({ bpm: clampBpm(Number(event.target.value)) })
                }
                aria-label="Tempo value 速度数值"
                className="w-16 rounded-lg border border-zinc-700 bg-zinc-800 px-2 py-1.5 text-center font-mono text-sm text-zinc-100 focus:border-amber-500 focus:outline-none"
              />
              <button
                onClick={tap}
                className="rounded-lg border border-zinc-700 px-3 py-1.5 text-sm font-semibold text-zinc-300 transition-colors hover:border-amber-500 hover:text-amber-300"
              >
                Tap 点击
              </button>
            </div>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className={labelClass} htmlFor="metronome-beats">
                Beats 每小节拍数
              </label>
              <select
                id="metronome-beats"
                value={settings.beatsPerMeasure}
                onChange={(event) =>
                  updateSettings({ beatsPerMeasure: Number(event.target.value) })
                }
                className={fieldClass}
              >
                {[2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12].map((count) => (
                  <option key={count} value={count}>
                    {count}
                  </option>
                ))}
              </select>
            </div>
            <div>
              <label className={labelClass} htmlFor="metronome-subdivision">
                Subdivision 细分
              </label>
              <select
                id="metronome-subdivision"
                value={settings.subdivision}
                onChange={(event) =>
                  updateSettings({
                    subdivision: event.target.value as Subdivision,
                  })
                }
                className={fieldClass}
              >
                {SUBDIVISIONS.map((value) => (
                  <option key={value} value={value}>
                    {SUBDIVISION_LABELS[value]}
                  </option>
                ))}
              </select>
            </div>
          </div>

          <div className="flex flex-wrap gap-2">
            <button
              onClick={() =>
                updateSettings({ accentDownbeat: !settings.accentDownbeat })
              }
              aria-pressed={settings.accentDownbeat}
              className={toggleClass(settings.accentDownbeat)}
            >
              Accent downbeat 重音首拍
            </button>
            <button
              onClick={() => updateSettings({ countIn: !settings.countIn })}
              aria-pressed={settings.countIn}
              className={toggleClass(settings.countIn)}
            >
              Count-in 预备拍
            </button>
          </div>

          <div>
            <div className="flex items-baseline justify-between">
              <label className={labelClass} htmlFor="metronome-volume">
                Volume 音量
              </label>
              <span className="font-mono text-sm text-zinc-100">
                {settings.volume}
              </span>
            </div>
            <input
              id="metronome-volume"
              type="range"
              min={0}
              max={100}
              value={settings.volume}
              onChange={(event) =>
                updateSettings({ volume: Number(event.target.value) })
              }
              className="w-full accent-amber-500"
            />
          </div>
        </div>

        <div className="mt-6 flex items-center justify-end gap-2 border-t border-zinc-800 pt-5">
          <button
            ref={startButtonRef}
            onClick={toggle}
            aria-pressed={running}
            className={[
              "rounded-xl px-6 py-2.5 text-sm font-semibold transition-colors",
              running
                ? "border border-zinc-700 text-zinc-200 hover:border-red-500 hover:text-red-300"
                : "bg-amber-500 text-zinc-950 hover:bg-amber-400",
            ].join(" ")}
          >
            {running ? "Stop 停止" : "Start 开始"}
          </button>
        </div>
      </div>
    </div>
  );
}
