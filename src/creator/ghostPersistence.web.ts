import { browserStore } from './browserStore';
export const ghostPersistence = {
  async read(key: string): Promise<string | null> {
    const value = await browserStore.read(`metadata:${key}`);
    return typeof value === 'string' ? value : null;
  },
  async write(key: string, value: string): Promise<void> {
    await browserStore.write(`metadata:${key}`, value);
  },
};
