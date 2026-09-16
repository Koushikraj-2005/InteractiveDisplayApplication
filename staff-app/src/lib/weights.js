export function fmtWeight(weight) {
  return `${weight.toFixed(3)} kg`;
}

export function fmtWeightNoUnit(weight) {
  return weight.toFixed(3);
}

export function fmtSignedDiff(diff) {
  const sign = diff > 0 ? '+' : '';
  return `${sign}${diff.toFixed(3)} kg`;
}

export function round3(value) {
  return Math.round(value * 1000) / 1000;
}

const pad2 = (n) => String(n).padStart(2, '0');

export function localIsoNow() {
  const d = new Date();
  return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}T${pad2(d.getHours())}:${pad2(d.getMinutes())}:${pad2(d.getSeconds())}`;
}

export function fmtDateTime(iso) {
  if (!iso) return '—';
  return String(iso).replace('T', ' ');
}

export function parseWeight(raw) {
  if (raw == null) return null;
  const text = String(raw).trim();
  if (text === '') return null;
  const value = Number(text);
  if (!Number.isFinite(value) || value < 0) return null;
  return value;
}

export function evaluateReading(required, current) {
  if (current == null) {
    return {
      type: 'neutral',
      title: 'AWAITING INPUT',
      detail: 'Enter the current weight',
      difference: null,
      correct: false,
    };
  }
  const difference = round3(current - required);
  if (difference === 0) {
    return {
      type: 'accepted',
      title: 'WEIGHT ACCEPTED',
      detail: 'STABLE',
      difference,
      correct: true,
    };
  }
  if (difference < 0) {
    return {
      type: 'underweight',
      title: 'UNDERWEIGHT',
      detail: `Add ${fmtWeight(round3(-difference))}`,
      difference,
      correct: false,
    };
  }
  return {
    type: 'overweight',
    title: 'OVERWEIGHT',
    detail: `Remove ${fmtWeight(difference)}`,
    difference,
    correct: false,
  };
}