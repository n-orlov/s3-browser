import { useState } from 'react';

/**
 * State that returns to `initial` whenever `resetKey` changes. Implemented by adjusting state
 * during render (no effect), so the reset never causes a cascading render.
 */
export function useResettingState<T>(
  initial: T,
  resetKey: string
): [T, React.Dispatch<React.SetStateAction<T>>] {
  const [value, setValue] = useState<T>(initial);
  const [seenKey, setSeenKey] = useState(resetKey);
  if (seenKey !== resetKey) {
    setSeenKey(resetKey);
    setValue(initial);
  }
  return [value, setValue];
}
