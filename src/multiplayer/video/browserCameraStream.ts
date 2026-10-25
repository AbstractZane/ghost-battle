type BrowserCameraListener = (stream: MediaStream | null) => void;

let currentStream: MediaStream | null = null;
const listeners = new Set<BrowserCameraListener>();

export function publishBrowserCameraStream(stream: MediaStream): void {
  currentStream = stream;
  for (const listener of listeners) listener(stream);
}

export function clearBrowserCameraStream(stream: MediaStream): void {
  if (currentStream !== stream) return;
  currentStream = null;
  for (const listener of listeners) listener(null);
}

export function subscribeToBrowserCameraStream(listener: BrowserCameraListener): () => void {
  listeners.add(listener);
  listener(currentStream);
  return () => listeners.delete(listener);
}

export function resetBrowserCameraStreamForTests(): void {
  currentStream = null;
  listeners.clear();
}
