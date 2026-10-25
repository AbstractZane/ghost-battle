import { useCallback, useLayoutEffect, useRef, useState } from 'react';
import type { PoseResult } from '@/pose/poseTypes';

/** Mount the camera with this key and both callbacks. Old native/async callbacks
 * cannot resume a failed/replaced source. This does not classify or award reps. */
export function useCameraRecovery({
  onPose,
  onInvalidate,
  active = true,
  sourceId = 'camera',
}: {
  onPose(pose: PoseResult): void;
  onInvalidate(reason?: string): void;
  active?: boolean;
  sourceId?: string;
}) {
  const [key, setKey] = useState(0);
  // An A -> B -> A navigation must not revive A's original callbacks. Adjust
  // this scope before committing children, avoiding a duplicate camera mount.
  const [scope, setScope] = useState(() => ({ id: sourceId, version: 0 }));
  if (scope.id !== sourceId) setScope({ id: sourceId, version: scope.version + 1 });
  const [error, setError] = useState<string | null>(null);
  const currentKey = useRef(0);
  const failed = useRef(false);
  const mounted = useRef(false);
  const currentSource = useRef(scope);
  const enabled = useRef(active);
  useLayoutEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);
  useLayoutEffect(() => {
    enabled.current = active;
  }, [active]);
  useLayoutEffect(() => {
    currentSource.current = scope;
    failed.current = false;
    setError(null);
  }, [scope]);
  const ownsSource = useCallback(
    () => mounted.current && currentKey.current === key && currentSource.current === scope,
    [key, scope],
  );
  const canProcess = useCallback(
    () => ownsSource() && enabled.current && !failed.current,
    [ownsSource],
  );
  const processPose = useCallback(
    (pose: PoseResult) => {
      if (canProcess()) onPose(pose);
    },
    [canProcess, onPose],
  );
  const reportError = useCallback(
    (message: string) => {
      if (!ownsSource()) return;
      if (!failed.current) {
        failed.current = true;
        onInvalidate('camera-error');
      }
      setError(message);
    },
    [ownsSource, onInvalidate],
  );
  const restart = useCallback(() => {
    if (!ownsSource()) return;
    currentKey.current++;
    failed.current = false;
    onInvalidate('camera-restart');
    setError(null);
    setKey(currentKey.current);
  }, [onInvalidate, ownsSource]);
  return {
    key: `${scope.version}:${scope.id}:${key}`,
    error,
    onPose: processPose,
    onError: reportError,
    restart,
    canProcess,
  };
}
