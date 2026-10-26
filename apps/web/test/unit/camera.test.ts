import { describe, expect, it, vi } from 'vitest';
import { cameraProblem, chooseRearCamera, requestCameraAccess } from '../../src/camera';

describe('requestCameraAccess', () => {
  it('requests the rear camera from the click and releases the permission stream', async () => {
    const stop = vi.fn();
    const getUserMedia = vi.fn().mockResolvedValue({ getTracks: () => [{ stop }] });

    await requestCameraAccess({ getUserMedia });

    expect(getUserMedia).toHaveBeenCalledWith({
      audio: false,
      video: { facingMode: { ideal: 'environment' } },
    });
    expect(stop).toHaveBeenCalledOnce();
  });

  it('refuses plainly when this browser has no camera API', async () => {
    await expect(requestCameraAccess(undefined)).rejects.toThrow('CAMERA_UNSUPPORTED');
  });
});

describe('chooseRearCamera', () => {
  it('prefers a labelled rear camera and otherwise uses the last device', () => {
    expect(
      chooseRearCamera([
        { id: 'front', label: 'Front Camera' },
        { id: 'back', label: 'Back Camera' },
      ]),
    ).toBe('back');
    expect(
      chooseRearCamera([
        { id: 'one', label: '' },
        { id: 'two', label: '' },
      ]),
    ).toBe('two');
  });
});

describe('cameraProblem', () => {
  it('turns browser failures into instructions a cashier can act on', () => {
    expect(cameraProblem(new DOMException('Permission denied', 'NotAllowedError'))).toContain(
      'permission',
    );
    expect(cameraProblem(new DOMException('No camera', 'NotFoundError'))).toContain('camera');
    expect(cameraProblem('unknown')).toContain('Take QR photo');
  });
});
