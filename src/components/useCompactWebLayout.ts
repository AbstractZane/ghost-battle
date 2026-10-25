import { useEffect, useState } from 'react';
import { Platform, useWindowDimensions } from 'react-native';
import { compactWebLayout } from './compactWebLayout';

export function useCompactWebLayout() {
  const dimensions = useWindowDimensions();
  const [availableHeight, setAvailableHeight] = useState<number | undefined>();
  useEffect(() => {
    if (Platform.OS !== 'web' || typeof window === 'undefined') return;
    const update = () => setAvailableHeight(window.visualViewport?.height ?? window.innerHeight);
    update();
    window.visualViewport?.addEventListener('resize', update);
    window.addEventListener('resize', update);
    return () => {
      window.visualViewport?.removeEventListener('resize', update);
      window.removeEventListener('resize', update);
    };
  }, []);
  return {
    ...compactWebLayout(Platform.OS, dimensions.width, availableHeight ?? dimensions.height),
    availableHeight: availableHeight ?? dimensions.height,
  };
}
