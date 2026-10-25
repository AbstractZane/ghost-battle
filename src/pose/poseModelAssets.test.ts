import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

const ASSETS = [
  {
    name: 'Lightning',
    filename: 'movenet-lightning-f16.tflite',
    sha256: '0fac2226112d0371903ca86e3853cec24ef603a0b2f96f589b180f0ebdd135ab',
  },
  {
    name: 'Thunder',
    filename: 'movenet-thunder-f16.tflite',
    sha256: '41641538679ec79b07d4101e591dda47d098c09af29607674b2a40b8a3798dd3',
  },
] as const;

describe('bundled official MoveNet assets', () => {
  it.each(ASSETS)('keeps the verified $name TFLite asset intact', ({ filename, sha256 }) => {
    const model = readFileSync(join(process.cwd(), 'assets', 'models', filename));
    expect(model.subarray(4, 8).toString('ascii')).toBe('TFL3');
    expect(createHash('sha256').update(model).digest('hex')).toBe(sha256);
  });
});
