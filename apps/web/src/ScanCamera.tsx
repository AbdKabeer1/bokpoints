import { useCallback, useEffect, useRef, useState, type ChangeEvent } from 'react';
import { Html5Qrcode } from 'html5-qrcode';
import { cameraProblem, chooseRearCamera } from './camera';

const ZONE_ID = 'poket-scan-zone';

async function release(scanner: Html5Qrcode | null): Promise<void> {
  if (scanner === null) return;
  try {
    await scanner.stop();
  } catch {
    // It may not have reached the running state yet.
  }
  try {
    scanner.clear();
  } catch {
    // Clearing twice is harmless and some browsers throw for it.
  }
}

/**
 * Live QR scanning with a native phone-camera fallback. Permission has
 * already been requested by the button click before this component mounts.
 */
export function ScanCamera({
  initialProblem,
  onRead,
  onClose,
}: {
  initialProblem: string | null;
  onRead: (text: string) => void;
  onClose: () => void;
}) {
  const [problem, setProblem] = useState<string | null>(initialProblem);
  const [starting, setStarting] = useState(initialProblem === null);
  const scannerRef = useRef<Html5Qrcode | null>(null);
  const activeRef = useRef(true);
  const onReadRef = useRef(onRead);
  onReadRef.current = onRead;

  const start = useCallback(async () => {
    setStarting(true);
    setProblem(null);
    await release(scannerRef.current);

    const scanner = new Html5Qrcode(ZONE_ID, { verbose: false });
    scannerRef.current = scanner;
    try {
      const cameras = await Html5Qrcode.getCameras();
      const cameraId = chooseRearCamera(
        cameras.map((camera) => ({ id: camera.id, label: camera.label })),
      );
      if (cameraId === null) throw new DOMException('No camera', 'NotFoundError');

      await scanner.start(
        cameraId,
        { fps: 10, qrbox: { width: 220, height: 220 } },
        (text) => {
          if (!activeRef.current) return;
          void release(scanner);
          onReadRef.current(text);
        },
        // Per-frame misses are normal while aiming; only success speaks.
        () => undefined,
      );
    } catch (caught) {
      if (activeRef.current) setProblem(cameraProblem(caught));
    } finally {
      if (activeRef.current) setStarting(false);
    }
  }, []);

  useEffect(() => {
    activeRef.current = true;
    if (initialProblem === null) void start();
    return () => {
      activeRef.current = false;
      void release(scannerRef.current);
    };
  }, [initialProblem, start]);

  /** `capture=environment` opens the phone's native rear camera. */
  const scanPhoto = async (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    event.target.value = '';
    if (file === undefined) return;

    setStarting(true);
    setProblem(null);
    await release(scannerRef.current);
    const scanner = new Html5Qrcode(ZONE_ID, { verbose: false });
    scannerRef.current = scanner;
    try {
      const text = await scanner.scanFile(file, true);
      onReadRef.current(text);
    } catch (caught) {
      setProblem(
        /qr|code|scan/i.test(String(caught))
          ? 'No QR code was found in that photo. Take another one with the code filling the frame.'
          : cameraProblem(caught),
      );
    } finally {
      setStarting(false);
    }
  };

  return (
    <div className="cam">
      <div id={ZONE_ID} className="camzone" />
      {starting ? <p className="muted">Opening the rear camera…</p> : null}
      {problem !== null ? <p className="error">{problem}</p> : null}
      {!starting && problem === null ? (
        <p className="muted">Point the camera at the customer&apos;s code.</p>
      ) : null}

      <div className="actions">
        {problem !== null ? (
          <button className="ghost" type="button" onClick={() => void start()}>
            Try live camera again
          </button>
        ) : null}
        <label className="ghost photo-button" htmlFor="qr-photo">
          Take QR photo
        </label>
        <input
          id="qr-photo"
          className="visually-hidden"
          type="file"
          accept="image/*"
          capture="environment"
          onChange={(event) => void scanPhoto(event)}
        />
        <button className="ghost" type="button" onClick={onClose}>
          Close camera
        </button>
      </div>
    </div>
  );
}
