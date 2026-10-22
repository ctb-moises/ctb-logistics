// Short audible feedback for scans (browser only). Warehouse staff look at the
// shelf, not the screen, so success and errors must be heard.
let context: AudioContext | null = null;

export function beep(kind: "success" | "error") {
  try {
    context ??= new AudioContext();
    const oscillator = context.createOscillator();
    const gain = context.createGain();
    oscillator.type = "sine";
    oscillator.frequency.value = kind === "success" ? 880 : 220;
    gain.gain.value = 0.15;
    oscillator.connect(gain).connect(context.destination);
    oscillator.start();
    oscillator.stop(context.currentTime + (kind === "success" ? 0.12 : 0.4));
  } catch {
    // Audio unavailable (e.g. autoplay blocked): feedback stays visual only.
  }
}
