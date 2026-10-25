import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { URL } from 'node:url';
const root = new URL('../', import.meta.url);
const baseline = JSON.parse(await readFile(new URL('docs/DETECTOR_BASELINE.json', root), 'utf8'));
for (const file of baseline.files) {
  const source = (await readFile(new URL(file.path, root), 'utf8')).replaceAll('\r\n', '\n');
  const actual = createHash('sha256').update(source).digest('hex');
  if (actual !== file.normalizedSha256)
    throw new Error(`Protected PushPVP module changed: ${file.path}`);
}
console.log(
  `${baseline.files.length} protected detector/camera/workout modules match the PushPVP baseline.`,
);
