export function speechIntervalsFromSilences(silences, startAt, count) {
  const intervals = []
  for (let index = 0; index < silences.length - 1 && intervals.length < count; index += 1) {
    const start = silences[index].end
    const end = silences[index + 1].start
    if (start >= startAt && end > start) intervals.push({ start, end })
  }
  return intervals
}

