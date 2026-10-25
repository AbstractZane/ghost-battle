let opening: Promise<IDBDatabase> | null = null;
function database(): Promise<IDBDatabase> {
  opening ??= new Promise((resolve, reject) => {
    if (typeof indexedDB === 'undefined') {
      reject(
        new Error('Browser storage is unavailable. Open Ghost Battle in a regular browser window.'),
      );
      return;
    }
    const request = indexedDB.open('ghost-battle-v1', 1);
    request.onupgradeneeded = () => request.result.createObjectStore('local');
    request.onerror = () => {
      opening = null;
      reject(new Error('Local storage could not open. Check browser storage permissions.'));
    };
    request.onblocked = () => {
      opening = null;
      reject(new Error('Close other Ghost Battle tabs, then retry.'));
    };
    request.onsuccess = () => {
      request.result.onversionchange = () => {
        request.result.close();
        opening = null;
      };
      resolve(request.result);
    };
  });
  return opening;
}
export const browserStore = {
  async read(key: string): Promise<unknown> {
    const db = await database();
    return new Promise((resolve, reject) => {
      const tx = db.transaction('local', 'readonly');
      const request = tx.objectStore('local').get(key);
      request.onsuccess = () => resolve(request.result as unknown);
      request.onerror = () => reject(new Error('That saved item could not load.'));
    });
  },
  async write(key: string, value: unknown): Promise<void> {
    const db = await database();
    return new Promise((resolve, reject) => {
      const tx = db.transaction('local', 'readwrite');
      tx.objectStore('local').put(value, key);
      tx.oncomplete = () => resolve();
      tx.onerror = () =>
        reject(new Error('Could not save locally. Free some browser storage, then retry.'));
      tx.onabort = () => reject(new Error('The save was interrupted. Try again.'));
    });
  },
  async remove(key: string): Promise<void> {
    const db = await database();
    return new Promise((resolve, reject) => {
      const tx = db.transaction('local', 'readwrite');
      tx.objectStore('local').delete(key);
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(new Error('The local item could not be removed.'));
    });
  },
};
