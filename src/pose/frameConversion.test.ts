import { describe, expect, it } from 'vitest';
import type { Frame } from 'react-native-vision-camera';
import { inflateSync } from 'node:zlib';

import { frameToMoveNetInput, moveNetInputToPngDataUri } from './frameConversion';
import { normalizeMoveNetOutput } from './moveNet';

function rgbFrame(width: number, height: number): Frame {
  const bytes = new Uint8Array(width * height * 3);
  for (let offset = 0; offset < bytes.length; offset += 3) {
    bytes[offset] = 255;
  }
  return {
    width,
    height,
    bytesPerRow: width * 3,
    pixelFormat: 'rgb-24-bit',
    getPixelBuffer: () => bytes.buffer,
  } as unknown as Frame;
}

describe('MoveNet input preprocessing', () => {
  it('letterboxes a landscape frame without stretching it', () => {
    const input = frameToMoveNetInput(rgbFrame(4, 2));
    const pixels = new Uint8Array(input.buffer);

    expect(input.transform).toEqual({
      inputWidth: 192,
      inputHeight: 192,
      contentWidth: 192,
      contentHeight: 96,
      padX: 0,
      padY: 48,
    });
    expect(pixels[0]).toBe(0);
    expect(pixels[48 * 192 * 3]).toBe(255);
  });

  it('letterboxes a portrait frame without cropping the full height', () => {
    const input = frameToMoveNetInput(rgbFrame(2, 4));
    const pixels = new Uint8Array(input.buffer);

    expect(input.transform).toEqual({
      inputWidth: 192,
      inputHeight: 192,
      contentWidth: 96,
      contentHeight: 192,
      padX: 48,
      padY: 0,
    });
    expect(pixels[0]).toBe(0);
    expect(pixels[48 * 3]).toBe(255);
  });

  it('uses Thunder dimensions while preserving the same aspect-fit letterbox', () => {
    const input = frameToMoveNetInput(rgbFrame(4, 2), 256, 256);
    expect(input.buffer.byteLength).toBe(256 * 256 * 3);
    expect(input.transform).toEqual({
      inputWidth: 256,
      inputHeight: 256,
      contentWidth: 256,
      contentHeight: 128,
      padX: 0,
      padY: 64,
    });
  });

  it('encodes the exact RGB tensor as an in-memory PNG preview', () => {
    const uri = moveNetInputToPngDataUri(new Uint8Array(192 * 192 * 3));
    expect(uri.startsWith('data:image/png;base64,iVBORw0KGgo')).toBe(true);
    const png = Buffer.from(uri.split(',')[1] ?? '', 'base64');
    const imageDataLength = png.readUInt32BE(33);
    expect(inflateSync(png.subarray(41, 41 + imageDataLength))).toHaveLength(192 * (192 * 3 + 1));
  });

  it('maps model coordinates back out of portrait letterboxing', () => {
    const output = new Array<number>(51).fill(0);
    output[15] = 0.5;
    output[16] = 0.25;
    output[17] = 1;
    output[18] = 0.5;
    output[19] = 0.75;
    output[20] = 1;

    const result = normalizeMoveNetOutput(
      output,
      0,
      0,
      {
        sourceWidth: 2,
        sourceHeight: 4,
        cameraFacing: 'back',
        orientation: 'up',
        inputMirrored: false,
        displayMirrored: false,
        poseModel: 'movenet-lightning',
      },
      {
        inputWidth: 192,
        inputHeight: 192,
        contentWidth: 96,
        contentHeight: 192,
        padX: 48,
        padY: 0,
      },
    );
    expect(result?.landmarks.leftShoulder?.x).toBe(0);
    expect(result?.landmarks.rightShoulder?.x).toBe(0.5);
  });

  it.each([
    ['Lightning', 192],
    ['Thunder', 256],
  ] as const)('reconstructs identical canonical coordinates for %s', (_label, inputSize) => {
    const output = new Array<number>(51).fill(0);
    output[15] = 0.5;
    output[16] = 0.25;
    output[17] = 1;
    const result = normalizeMoveNetOutput(
      output,
      0,
      0,
      {
        sourceWidth: 2,
        sourceHeight: 4,
        cameraFacing: 'front',
        orientation: 'up',
        inputMirrored: true,
        displayMirrored: true,
        poseModel: inputSize === 192 ? 'movenet-lightning' : 'movenet-thunder',
      },
      {
        inputWidth: inputSize,
        inputHeight: inputSize,
        contentWidth: inputSize / 2,
        contentHeight: inputSize,
        padX: inputSize / 4,
        padY: 0,
      },
    );
    expect(result?.landmarks.leftShoulder?.x).toBe(0.5);
    expect(result?.landmarks.leftShoulder?.y).toBe(0.5);
    expect(result?.displayMirrored).toBe(true);
  });
});
