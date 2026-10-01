/* Run: node scripts/verify-drum-voices.mjs */
import assert from "node:assert/strict";
import { registerHooks } from "node:module";
import { readFileSync } from "node:fs";

const nodes = [];
let missing = "";
const toneUrl = `data:text/javascript,${encodeURIComponent(`
  const test = globalThis.drumVoiceTest;
  class Node {
    volume = { value: 0 };
    constructor(options) { this.options = options; test.nodes.push(this); }
    connect() { return this; }
    chain() { return this; }
    start(time) { this.time = time; return this; }
    triggerAttackRelease() { this.triggered = true; }
    dispose() { this.disposed = true; }
  }
  export class Player extends Node {
    constructor(options) { super(options); if (!options.url.loaded) throw Error('not loaded'); }
  }
  export class Volume extends Node { constructor(value) { super(); this.volume.value = value; } }
  export const Filter = Node, MembraneSynth = Node, NoiseSynth = Node;
  export const Oscillator = Node, AmplitudeEnvelope = Node;
  export const now = () => 42;
  export const ToneAudioBuffer = { fromUrl: async (url) => {
    await new Promise(resolve => setTimeout(resolve, 5));
    if (url === test.missing()) throw Error('sample unavailable');
    return { url, loaded: true, dispose() { this.disposed = true; } };
  }};
`)}`;
globalThis.drumVoiceTest = { nodes, missing: () => missing };
const levelsUrl = `data:text/javascript,${encodeURIComponent(
  'export const masterBus = () => null; export const ZONE_BASE_DB = { center: 0, edge: 2, rim: -4 };'
)}`;
registerHooks({
  resolve(specifier, context, nextResolve) {
    const url = specifier === "tone" ? toneUrl : specifier === "@/lib/audioLevels" ? levelsUrl : null;
    return url ? { url, shortCircuit: true } : nextResolve(specifier, context);
  },
});

const { buildDrumVoices } = await import("../src/lib/drumVoices.ts");
const paths = ["/samples/gu-xin.wav", "/samples/gu-bian.wav", "/samples/gu-bang.wav"];
const voices = await buildDrumVoices();
const players = nodes.filter(node => node.options?.url);
assert.deepEqual(players.map(player => player.options.url.url), paths);
assert.deepEqual(Object.values(voices).map(voice => voice.volume.value), [0, 2, -4]);
Object.values(voices).forEach((voice, i) => voice.triggerAttackRelease("32n", 10 + i));
assert.deepEqual(players.map(player => player.time), [10, 11, 12]);
Object.values(voices).forEach(voice => voice.dispose());
assert(players.every(player => player.disposed && player.options.url.disposed));
for (const path of paths) {
  const wav = readFileSync(new URL(`../public${path}`, import.meta.url));
  assert.equal(wav.toString("ascii", 0, 4), "RIFF");
  assert.equal(wav.toString("ascii", 8, 12), "WAVE");
  let offset = 12;
  while (wav.toString("ascii", offset, offset + 4) !== "data") {
    const size = wav.readUInt32LE(offset + 4);
    offset += 8 + size + (size % 2);
  }
  const size = wav.readUInt32LE(offset + 4);
  assert(size > 0 && size < 48000 * 2 * 2, "one hit, under two seconds");
  let peak = 0, onsetPeak = 0;
  for (let i = 0; i < size; i += 2) {
    const amplitude = Math.abs(wav.readInt16LE(offset + 8 + i));
    peak = Math.max(peak, amplitude);
    if (i < 48000 * 2 * 0.05) onsetPeak = Math.max(onsetPeak, amplitude);
  }
  assert(peak > 10000 && peak < 32767, "audible, without clipping");
  assert(onsetPeak > peak / 2, "hit starts within 50ms");
  assert.equal(wav.readInt16LE(offset + 8 + size - 2), 0, "tail fades to zero");
  missing = path;
  nodes.length = 0;
  const fallback = await buildDrumVoices();
  assert.equal(nodes.filter(node => node.options?.url).length, 2);
  Object.values(fallback).forEach(voice => voice.triggerAttackRelease("32n", 42));
  Object.values(fallback).forEach(voice => voice.dispose());
}
console.log("Drum voices: sample mapping, async loading, scheduling, disposal and fallbacks passed.");
