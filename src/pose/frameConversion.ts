import type { Frame } from 'react-native-vision-camera';

const DEFAULT_MODEL_WIDTH = 192;
const DEFAULT_MODEL_HEIGHT = 192;

export interface MoveNetInputTransform {
  inputWidth: number;
  inputHeight: number;
  contentWidth: number;
  contentHeight: number;
  padX: number;
  padY: number;
}

export interface PreparedMoveNetInput {
  buffer: ArrayBuffer;
  transform: MoveNetInputTransform;
}

/** Converts a physically rotated camera buffer to aspect-fit, letterboxed MoveNet RGB input. */
export function frameToMoveNetInput(
  frame: Frame,
  inputWidth = DEFAULT_MODEL_WIDTH,
  inputHeight = DEFAULT_MODEL_HEIGHT,
): PreparedMoveNetInput {
  'worklet';
  const source = new Uint8Array(frame.getPixelBuffer());
  const destinationBuffer = new ArrayBuffer(inputWidth * inputHeight * 3);
  const destination = new Uint8Array(destinationBuffer);
  const channels = frame.bytesPerRow >= frame.width * 4 ? 4 : 3;
  const isBgra = frame.pixelFormat === 'rgb-bgra-8-bit';
  const scale = Math.min(inputWidth / frame.width, inputHeight / frame.height);
  const contentWidth = Math.max(1, Math.round(frame.width * scale));
  const contentHeight = Math.max(1, Math.round(frame.height * scale));
  const padX = Math.floor((inputWidth - contentWidth) / 2);
  const padY = Math.floor((inputHeight - contentHeight) / 2);

  for (let y = 0; y < contentHeight; y += 1) {
    const sourceY = Math.min(frame.height - 1, Math.floor((y * frame.height) / contentHeight));
    for (let x = 0; x < contentWidth; x += 1) {
      const sourceX = Math.min(frame.width - 1, Math.floor((x * frame.width) / contentWidth));
      const sourceOffset = sourceY * frame.bytesPerRow + sourceX * channels;
      const destinationOffset = ((y + padY) * inputWidth + x + padX) * 3;
      if (isBgra) {
        destination[destinationOffset] = source[sourceOffset + 2] ?? 0;
        destination[destinationOffset + 1] = source[sourceOffset + 1] ?? 0;
        destination[destinationOffset + 2] = source[sourceOffset] ?? 0;
      } else {
        destination[destinationOffset] = source[sourceOffset] ?? 0;
        destination[destinationOffset + 1] = source[sourceOffset + 1] ?? 0;
        destination[destinationOffset + 2] = source[sourceOffset + 2] ?? 0;
      }
    }
  }
  return {
    buffer: destinationBuffer,
    transform: { inputWidth, inputHeight, contentWidth, contentHeight, padX, padY },
  };
}

function writeUint32BigEndian(bytes: Uint8Array, offset: number, value: number): void {
  bytes[offset] = (value >>> 24) & 0xff;
  bytes[offset + 1] = (value >>> 16) & 0xff;
  bytes[offset + 2] = (value >>> 8) & 0xff;
  bytes[offset + 3] = value & 0xff;
}

function crc32(bytes: Uint8Array): number {
  let crc = 0xffffffff;
  for (const byte of bytes) {
    crc ^= byte;
    for (let bit = 0; bit < 8; bit += 1) {
      crc = (crc >>> 1) ^ (0xedb88320 & -(crc & 1));
    }
  }
  return (crc ^ 0xffffffff) >>> 0;
}

function pngChunk(type: ReadonlyArray<number>, data: Uint8Array): Uint8Array {
  const chunk = new Uint8Array(12 + data.length);
  writeUint32BigEndian(chunk, 0, data.length);
  chunk.set(type, 4);
  chunk.set(data, 8);
  writeUint32BigEndian(chunk, 8 + data.length, crc32(chunk.subarray(4, 8 + data.length)));
  return chunk;
}

function uncompressedZlib(data: Uint8Array): Uint8Array {
  const output: number[] = [0x78, 0x01];
  let offset = 0;
  while (offset < data.length) {
    const length = Math.min(65535, data.length - offset);
    const final = offset + length === data.length;
    const complement = ~length & 0xffff;
    output.push(
      final ? 1 : 0,
      length & 0xff,
      (length >>> 8) & 0xff,
      complement & 0xff,
      (complement >>> 8) & 0xff,
    );
    for (let index = 0; index < length; index += 1) output.push(data[offset + index] ?? 0);
    offset += length;
  }

  let first = 1;
  let second = 0;
  for (const byte of data) {
    first = (first + byte) % 65521;
    second = (second + first) % 65521;
  }
  const adler = ((second << 16) | first) >>> 0;
  output.push((adler >>> 24) & 0xff, (adler >>> 16) & 0xff, (adler >>> 8) & 0xff, adler & 0xff);
  return Uint8Array.from(output);
}

/** Creates an in-memory PNG data URI for the development-only model-input preview. */
export function moveNetInputToPngDataUri(
  rgb: ArrayLike<number>,
  inputWidth = DEFAULT_MODEL_WIDTH,
  inputHeight = DEFAULT_MODEL_HEIGHT,
): string {
  const scanlines = new Uint8Array(inputHeight * (inputWidth * 3 + 1));
  for (let y = 0; y < inputHeight; y += 1) {
    const rowOffset = y * (inputWidth * 3 + 1);
    scanlines[rowOffset] = 0;
    for (let x = 0; x < inputWidth * 3; x += 1) {
      scanlines[rowOffset + x + 1] = rgb[y * inputWidth * 3 + x] ?? 0;
    }
  }

  const header = new Uint8Array(13);
  writeUint32BigEndian(header, 0, inputWidth);
  writeUint32BigEndian(header, 4, inputHeight);
  header.set([8, 2, 0, 0, 0], 8);
  const signature = Uint8Array.from([137, 80, 78, 71, 13, 10, 26, 10]);
  const imageHeader = pngChunk([73, 72, 68, 82], header);
  const imageData = pngChunk([73, 68, 65, 84], uncompressedZlib(scanlines));
  const imageEnd = pngChunk([73, 69, 78, 68], new Uint8Array());
  const png = new Uint8Array(
    signature.length + imageHeader.length + imageData.length + imageEnd.length,
  );
  let offset = 0;
  for (const part of [signature, imageHeader, imageData, imageEnd]) {
    png.set(part, offset);
    offset += part.length;
  }

  let binary = '';
  const chunkSize = 8192;
  for (let index = 0; index < png.length; index += chunkSize) {
    binary += String.fromCharCode(...png.subarray(index, index + chunkSize));
  }
  return `data:image/png;base64,${btoa(binary)}`;
}
