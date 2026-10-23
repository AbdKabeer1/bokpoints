/**
 * Scan feedback: two short blips when a code is read. The AudioContext is
 * created lazily the first time, inside the gesture that follows a scan,
 * because browsers refuse to start audio any other way; a browser that
 * still blocks it simply gets the visual confirmation.
 */
let context: AudioContext | null = null;

export function playScanOk(): void {
  try {
    context ??= new AudioContext();
    const now = context.currentTime;
    const notes: Array<[number, number]> = [
      [0, 988],
      [0.09, 1319],
    ];
    for (const [start, frequency] of notes) {
      const oscillator = context.createOscillator();
      const gain = context.createGain();
      oscillator.type = 'square';
      oscillator.frequency.value = frequency;
      gain.gain.setValueAtTime(0.05, now + start);
      gain.gain.exponentialRampToValueAtTime(0.0001, now + start + 0.08);
      oscillator.connect(gain).connect(context.destination);
      oscillator.start(now + start);
      oscillator.stop(now + start + 0.09);
    }
  } catch {
    // No audio here; the customer card appearing is the visual confirmation.
  }
}
