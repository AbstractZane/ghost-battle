import { NitroModules } from 'react-native-nitro-modules';
import type { YoloPose } from './YoloPose.nitro';
export type { YoloPose } from './YoloPose.nitro';

export function createYoloPose(): YoloPose {
  return NitroModules.createHybridObject<YoloPose>('YoloPose');
}
