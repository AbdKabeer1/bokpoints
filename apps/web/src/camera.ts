export interface CameraDevice {
  id: string;
  label: string;
}

interface PermissionStream {
  getTracks(): Array<{ stop(): void }>;
}

interface CameraMediaDevices {
  getUserMedia(constraints: MediaStreamConstraints): Promise<PermissionStream>;
}

/**
 * Called directly by the camera button's click handler. Mobile Safari is much
 * more reliable when the permission request still belongs to the user's tap
 * instead of starting later from a React effect.
 */
export async function requestCameraAccess(
  mediaDevices: CameraMediaDevices | undefined = navigator.mediaDevices,
): Promise<void> {
  if (mediaDevices?.getUserMedia === undefined) throw new Error('CAMERA_UNSUPPORTED');

  const stream = await mediaDevices.getUserMedia({
    audio: false,
    video: { facingMode: { ideal: 'environment' } },
  });
  for (const track of stream.getTracks()) track.stop();
}

/** Prefer the phone's rear camera. Labels are available after permission. */
export function chooseRearCamera(cameras: CameraDevice[]): string | null {
  if (cameras.length === 0) return null;
  const rear = cameras.find((camera) => /back|rear|environment/i.test(camera.label));
  return rear?.id ?? cameras.at(-1)?.id ?? null;
}

/** Browser errors are inconsistent (Error, DOMException, or strings). */
export function cameraProblem(caught: unknown): string {
  const name = caught instanceof DOMException ? caught.name : '';
  const detail = caught instanceof Error ? `${caught.name} ${caught.message}` : String(caught);

  if (name === 'NotAllowedError' || /permission|denied|not allowed/i.test(detail)) {
    return 'Camera permission was refused. Allow Camera for this site in your browser settings, then try again — or use Take QR photo.';
  }
  if (name === 'NotFoundError' || /not found|no camera|devicesnotfound/i.test(detail)) {
    return 'No camera was found on this device. Type the code or use Take QR photo.';
  }
  if (/CAMERA_UNSUPPORTED|secure context|mediaDevices/i.test(detail)) {
    return 'This browser cannot use a live camera here. Type the code or use Take QR photo.';
  }
  return 'The live camera did not start. Try again, type the code, or use Take QR photo.';
}

export type TillPanelMode = 'recorded' | 'camera' | 'register' | 'scan' | 'customer';

/**
 * The camera belongs to the find-customer step, so it must win before the
 * `hasCustomer` branch. Keeping this order in one tested function prevents a
 * nested ternary from silently hiding the scanner again.
 */
export function tillPanelMode(input: {
  hasRecordedSale: boolean;
  cameraOpen: boolean;
  hasCustomer: boolean;
  registerOpen: boolean;
}): TillPanelMode {
  if (input.hasRecordedSale) return 'recorded';
  if (input.cameraOpen) return 'camera';
  if (input.hasCustomer) return 'customer';
  return input.registerOpen ? 'register' : 'scan';
}
