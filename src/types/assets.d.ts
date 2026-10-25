declare module '*.tflite' {
  const assetId: number;
  export default assetId;
}

declare module '*.wav' {
  const assetId: number;
  export default assetId;
}

declare module '*.m4a' {
  const assetId: number;
  export default assetId;
}

declare module '*.png' {
  import type { ImageSourcePropType } from 'react-native';

  const source: ImageSourcePropType;
  export default source;
}

declare module '*.webp' {
  import type { ImageSourcePropType } from 'react-native';

  const source: ImageSourcePropType;
  export default source;
}
