import { useCallback, useState } from 'react';
import { parseWeight } from './weights.js';

export const weightSource = {
  mode: 'manual',
};

export function useWeightSource() {
  const [raw, setRaw] = useState('');
  const getReading = useCallback(() => parseWeight(raw), [raw]);
  return { raw, setRaw, getReading };
}