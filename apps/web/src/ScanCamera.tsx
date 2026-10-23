import { useEffect, useRef, useState } from 'react';
import { Html5Qrcode } from 'html5-qrcode';

const ZONE_ID = 'poket-scan-zone';

/**
 * Live camera scanning of the customer's QR code (MVP per the component
 * document). The camera starts on mount and stops when a code is read or
 * the cashier closes it. A refused or missing camera says so plainly and
 * leaves the typed-code path, which always works.
 */
export function ScanCamera({
  onRead,
  onClose,
}: {
  onRead: (text: string) => void;
  onClose: () => void;
}) {
  const [problem, setProblem] = useState<string | null>(null);
  const onReadRef = useRef(onRead);
  onReadRef.current = onRead;

  useEffect(() => {
    let active = true;
    const scanner = new Html5Qrcode(ZONE_ID, { verbose: false });

    void (async () => {
      try {
        await scanner.start(
          { facingMode: 'environment' },
          { fps: 10, qrbox: { width: 220, height: 220 } },
          (text) => {
            if (!active) return;
            active = false;
            void scanner.stop().catch(() => undefined);
            onReadRef.current(text);
          },
          // Per-frame misses are normal while aiming; only success speaks.
          () => undefined,
        );
        if (!active) {
          await scanner.stop().catch(() => undefined);
          scanner.clear();
        }
      } catch (caught) {
        if (active) {
          setProblem(
            caught instanceof Error && /permission|denied|not allowed/i.test(caught.message)
              ? 'The camera permission was refused. Type the code instead.'
              : 'No camera available here. Type the code instead.',
          );
        }
      }
    })();

    return () => {
      active = false;
      // A stop that was not awaited (a read just happened, or the start is
      // still pending) rejects here; either way clear() releases the video.
      void scanner.stop().catch(() => undefined).then(() => scanner.clear());
    };
  }, []);

  return (
    <div className="cam">
      <div id={ZONE_ID} className="camzone" />
      {problem !== null ? (
        <p className="error">{problem}</p>
      ) : (
        <p className="muted">Point the camera at the customer&apos;s code.</p>
      )}
      <button className="ghost" type="button" onClick={onClose}>
        Close camera
      </button>
    </div>
  );
}
