import { getDatabase } from '@/storage/database';
export const ghostPersistence = {
  async read(key: string): Promise<string | null> {
    const db = await getDatabase();
    return (
      (await db.getFirstAsync<{ value: string }>('SELECT value FROM metadata WHERE key = ?', key))
        ?.value ?? null
    );
  },
  async write(key: string, value: string): Promise<void> {
    const db = await getDatabase();
    await db.runAsync('INSERT OR REPLACE INTO metadata (key, value) VALUES (?, ?)', key, value);
  },
};
