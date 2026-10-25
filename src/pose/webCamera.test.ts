import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { browserCameraError, stopMediaStream, webCameraConstraints } from './webCamera';

describe('browser camera lifecycle', () => {
  it('requests video only and uses the desired facing mode', () => {
    expect(webCameraConstraints('front')).toMatchObject({
      audio: false,
      video: { facingMode: { ideal: 'user' } },
    });
    expect(webCameraConstraints('back')).toMatchObject({
      audio: false,
      video: { facingMode: { ideal: 'environment' } },
    });
  });

  it('selects exact desktop devices when requested', () => {
    expect(webCameraConstraints('front', 'usb-2')).toEqual({
      audio: false,
      video: { deviceId: { exact: 'usb-2' } },
    });
  });

  it('stops every old track during camera replacement or cleanup', () => {
    const first = { stop: vi.fn() };
    const second = { stop: vi.fn() };
    stopMediaStream({ getTracks: () => [first, second] } as unknown as MediaStream);
    expect(first.stop).toHaveBeenCalledOnce();
    expect(second.stop).toHaveBeenCalledOnce();
  });
});

describe('browser camera recovery guidance', () => {
  beforeEach(() => vi.stubGlobal('window', { isSecureContext: true }));
  afterEach(() => vi.unstubAllGlobals());
  it('points a denied permission to settings rather than promising a new prompt', () => {
    const message = browserCameraError(
      new DOMException('private permission details', 'NotAllowedError'),
    );
    expect(message).toContain('browser’s site settings');
    expect(message).toContain('device’s privacy settings');
    expect(message).not.toContain('private permission details');
  });
  it('distinguishes unavailable selected settings from a missing camera', () => {
    expect(browserCameraError(new DOMException('', 'OverconstrainedError'))).toContain(
      'selected camera or camera settings',
    );
    expect(browserCameraError(new DOMException('', 'NotFoundError'))).toContain(
      'Connect or enable one',
    );
  });
  it('offers recovery for busy and interrupted capture', () => {
    expect(browserCameraError(new DOMException('', 'NotReadableError'))).toContain(
      'Close other apps or tabs',
    );
    expect(browserCameraError(new DOMException('', 'AbortError'))).toContain(
      'Return to the PushPVP tab',
    );
    expect(browserCameraError(new DOMException('', 'InvalidStateError'))).toContain(
      'Return to the PushPVP tab',
    );
  });
  it('distinguishes page restrictions and unavailable browser capture', () => {
    expect(browserCameraError(new DOMException('', 'SecurityError'))).toContain(
      'Open PushPVP directly',
    );
    expect(browserCameraError(new DOMException('', 'NotSupportedError'))).toContain(
      'device’s main browser',
    );
  });
  it('does not blame camera permissions when only the pose tracker failed to initialize', () => {
    const message = browserCameraError(new Error('private model asset trace'), 'tracker');
    expect(message).toContain('rep tracker couldn’t start');
    expect(message).toContain('Check your connection');
    expect(message).not.toContain('site settings');
    expect(message).not.toContain('private model asset trace');
  });
  it('explains insecure context first without exposing raw errors', () => {
    vi.stubGlobal('window', { isSecureContext: false });
    expect(browserCameraError(new Error('private camera trace'))).toContain('HTTPS');
    vi.stubGlobal('window', { isSecureContext: true });
    expect(browserCameraError(new Error('private camera trace'))).not.toContain(
      'private camera trace',
    );
  });
});
