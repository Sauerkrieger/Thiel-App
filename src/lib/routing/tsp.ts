/**
 * TSP-Solver für die Rundtour-Optimierung.
 *
 * Node 0 ist immer das Lager (Depot), Node 1..n sind die Objekte.
 * Zeitfenster:
 *   - earliest[node]: früheste Ankunft (Minuten seit 0 Uhr) – wird ggf. gewartet
 *   - deadline[node]: späteste Ankunft (Minuten seit 0 Uhr), 0 = unbegrenzt
 *
 * Exakt (Held-Karp) bis 15 Stopps, darüber Nearest-Neighbor + 2-opt.
 * Bei Nichterfüllbarkeit wird eine bestmögliche Tour mit feasible=false
 * zurückgegeben, damit der Nutzer eine Warnung erhält.
 */

export type TspSolution = {
  /** Objekt-Nodes in Reihenfolge (1-basiert, ohne Depot) */
  order: number[];
  /** Gesamtdauer in Minuten (inkl. Wartezeit & Servicezeit, inkl. Rückfahrt) */
  totalMinutes: number;
  /** true, wenn alle Zeitfenster eingehalten werden konnten */
  feasible: boolean;
};

export const MAX_EXACT_STOPS = 15;

/**
 * Liefert die Ankunftszeiten für eine Reihenfolge (inkl. Servicezeit je Stopp).
 * `null`, wenn eine Deadline verletzt wird (nur wenn `enforce` true).
 */
export function scheduleTimes(
  order: number[],
  dist: number[][],
  earliest: number[],
  deadline: number[],
  startMinutes: number,
  serviceMinutes: number,
  enforce = true,
): number[] | null {
  const times: number[] = [];
  let t = startMinutes;
  let prev = 0;
  for (const node of order) {
    t = t + (prev === 0 ? 0 : serviceMinutes) + dist[prev][node];
    if (t < earliest[node]) t = earliest[node];
    if (enforce && t >= deadline[node]) return null;
    times.push(t);
    prev = node;
  }
  return times;
}

function tourTotal(
  order: number[],
  times: number[],
  dist: number[][],
  serviceMinutes: number,
): number {
  const last = order[order.length - 1];
  return times[times.length - 1] + serviceMinutes + dist[last][0];
}

/** Held-Karp (exakt) mit Zeitfenstern. */
function solveExact(
  dist: number[][],
  earliest: number[],
  deadline: number[],
  startMinutes: number,
  serviceMinutes: number,
): { order: number[]; totalMinutes: number } | null {
  const stops = dist.length - 1;
  const INF = Number.POSITIVE_INFINITY;
  const size = 1 << stops;
  const full = size - 1;

  // dp[mask][last] = früheste Ankunftszeit bei 'last', nachdem 'mask' besucht
  const dp: number[][] = Array.from({ length: size }, () =>
    new Array<number>(stops).fill(INF),
  );
  const parent: number[][] = Array.from({ length: size }, () =>
    new Array<number>(stops).fill(-1),
  );

  for (let j = 0; j < stops; j++) {
    let t = startMinutes + dist[0][j + 1];
    if (t < earliest[j + 1]) t = earliest[j + 1];
    if (t < deadline[j + 1]) dp[1 << j][j] = t;
  }

  for (let mask = 1; mask < size; mask++) {
    for (let last = 0; last < stops; last++) {
      const cur = dp[mask][last];
      if (cur === INF) continue;
      for (let next = 0; next < stops; next++) {
        if (mask & (1 << next)) continue;
        let t = cur + serviceMinutes + dist[last + 1][next + 1];
        if (t < earliest[next + 1]) t = earliest[next + 1];
        if (t >= deadline[next + 1]) continue;
        const nmask = mask | (1 << next);
        if (t < dp[nmask][next]) {
          dp[nmask][next] = t;
          parent[nmask][next] = last;
        }
      }
    }
  }

  let bestReturn = INF;
  let bestLast = -1;
  for (let last = 0; last < stops; last++) {
    const returnTime = dp[full][last] + serviceMinutes + dist[last + 1][0];
    if (returnTime < bestReturn) {
      bestReturn = returnTime;
      bestLast = last;
    }
  }
  if (bestLast === -1) return null;
  // Gesamtdauer = Rückkehrzeit am Lager abzüglich Startzeit
  const bestTotal = bestReturn - startMinutes;

  const order: number[] = [];
  let mask = full;
  let last = bestLast;
  while (mask !== 0) {
    order.push(last + 1);
    const prev = parent[mask][last];
    mask = mask & ~(1 << last);
    last = prev;
  }
  order.reverse();
  return { order, totalMinutes: bestTotal };
}

/** Nearest-Neighbor + 2-opt mit Zeitfenster-Feasibility (für > 15 Stopps). */
function solveHeuristic(
  dist: number[][],
  earliest: number[],
  deadline: number[],
  startMinutes: number,
  serviceMinutes: number,
): { order: number[]; totalMinutes: number } | null {
  const stops = dist.length - 1;
  const allNodes = Array.from({ length: stops }, (_, i) => i + 1);

  // 1) Nearest-Neighbor ab Depot (nur zeitlich erreichbare Ziele)
  const order: number[] = [];
  const visited = new Set<number>();
  let current = 0;
  let time = startMinutes;
  while (order.length < stops) {
    let best = -1;
    let bestArrival = Number.POSITIVE_INFINITY;
    for (const node of allNodes) {
      if (visited.has(node)) continue;
      let t = time + (current === 0 ? 0 : serviceMinutes) + dist[current][node];
      if (t < earliest[node]) t = earliest[node];
      if (t >= deadline[node]) continue;
      if (t < bestArrival) {
        bestArrival = t;
        best = node;
      }
    }
    if (best === -1) break;
    visited.add(best);
    order.push(best);
    time = bestArrival;
    current = best;
  }
  // Rest (nicht erreichbar) bestmöglich anhängen
  for (const node of allNodes) {
    if (!visited.has(node)) {
      visited.add(node);
      order.push(node);
    }
  }

  // 2) 2-opt-Verbesserung (nur feasible Umkehrungen akzeptieren)
  let improved = true;
  while (improved) {
    improved = false;
    let times = scheduleTimes(
      order,
      dist,
      earliest,
      deadline,
      startMinutes,
      serviceMinutes,
    );
    if (!times) break;
    const currentTotal = tourTotal(order, times, dist, serviceMinutes);

    for (let i = 0; i < order.length - 1 && !improved; i++) {
      for (let j = i + 1; j < order.length && !improved; j++) {
        const candidate = [
          ...order.slice(0, i),
          ...order.slice(i, j + 1).reverse(),
          ...order.slice(j + 1),
        ];
        const candTimes = scheduleTimes(
          candidate,
          dist,
          earliest,
          deadline,
          startMinutes,
          serviceMinutes,
        );
        if (!candTimes) continue;
        const total = tourTotal(candidate, candTimes, dist, serviceMinutes);
        if (total < currentTotal - 0.5) {
          order.splice(0, order.length, ...candidate);
          improved = true;
        }
      }
    }
  }

  const finalTimes = scheduleTimes(
    order,
    dist,
    earliest,
    deadline,
    startMinutes,
    serviceMinutes,
    false,
  );
  if (!finalTimes) return null;
  return {
    order,
    totalMinutes: tourTotal(order, finalTimes, dist, serviceMinutes) - startMinutes,
  };
}

/**
 * Löst die Rundtour unter Beachtung der Zeitfenster.
 * Rückgabe ist immer bestmöglich; `feasible` zeigt an, ob alle
 * Restriktionen eingehalten werden konnten.
 */
export function solveTspWithWindows(
  dist: number[][],
  earliest: number[],
  deadline: number[],
  startMinutes: number,
  serviceMinutes: number,
): TspSolution {
  const stops = dist.length - 1;
  if (stops === 0) {
    return { order: [], totalMinutes: 0, feasible: true };
  }

  const windows = stops <= MAX_EXACT_STOPS;
  let solution = windows
    ? solveExact(dist, earliest, deadline, startMinutes, serviceMinutes)
    : solveHeuristic(dist, earliest, deadline, startMinutes, serviceMinutes);

  if (solution) {
    // Verifiziere, ob die gefundene Tour tatsächlich alle Fenster einhält
    const times = scheduleTimes(
      solution.order,
      dist,
      earliest,
      deadline,
      startMinutes,
      serviceMinutes,
    );
    return { ...solution, feasible: times !== null };
  }

  // Keine feasible Tour -> bestmögliche Tour ohne Fenster (für die Warnung)
  const open = new Array<number>(dist.length).fill(0);
  const noDeadline = new Array<number>(dist.length).fill(Number.POSITIVE_INFINITY);
  const fallback = windows
    ? solveExact(dist, open, noDeadline, startMinutes, serviceMinutes)
    : solveHeuristic(dist, open, noDeadline, startMinutes, serviceMinutes);

  if (!fallback) {
    return {
      order: Array.from({ length: stops }, (_, i) => i + 1),
      totalMinutes: Number.NaN,
      feasible: false,
    };
  }
  // Der Fallback-Solver liefert bereits die Dauer (Rückkehrzeit - Start)
  return { ...fallback, feasible: false };
}
