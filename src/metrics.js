/**
 * FPS and latency measurement for the on-screen readout and the README table.
 * @module metrics
 */

/** Counts events per second: `rate` over the last ~1 s, `average()` since creation. */
function createRateCounter() {
  const startedAt = performance.now();
  let windowStart = startedAt;
  let windowCount = 0;
  let total = 0;
  let rate = 0;
  return {
    tick(now) {
      windowCount++;
      total++;
      if (now - windowStart >= 1000) {
        rate = (windowCount * 1000) / (now - windowStart);
        windowCount = 0;
        windowStart = now;
      }
    },
    get rate() { return rate; },
    average(now) { return (total * 1000) / (now - startedAt); },
  };
}

/**
 * Rolling (last N samples) and whole-session statistics for a value in ms.
 * The first `warmup` samples are ignored: model/GPU start-up spikes would skew the average.
 */
function createRollingStat(windowSize = 60, warmup = 30) {
  const recent = [];
  let recentSum = 0;
  let total = 0;
  let count = 0;
  let max = 0;
  let seen = 0;
  return {
    add(value) {
      if (++seen <= warmup) return;
      recent.push(value);
      recentSum += value;
      if (recent.length > windowSize) recentSum -= recent.shift();
      total += value;
      count++;
      if (value > max) max = value;
    },
    recentAverage: () => (recent.length ? recentSum / recent.length : 0),
    sessionAverage: () => (count ? total / count : 0),
    max: () => max,
  };
}

/**
 * Everything the app measures, behind four small calls:
 * - render FPS: how often the screen is redrawn
 * - detect FPS: how often the face model runs (limited by the camera)
 * - inference ms: time spent inside the face model per frame
 * - latency ms: from the camera capturing a frame to the finished render of it
 */
export function createMetrics() {
  const render = createRateCounter();
  const detect = createRateCounter();
  const inference = createRollingStat();
  const latency = createRollingStat();

  return {
    /** A frame was drawn to the screen. @param {number} now ms timestamp */
    frameRendered(now) { render.tick(now); },

    /** The face model ran once. @param {number} now ms timestamp @param {number} ms inference time */
    detected(now, ms) {
      detect.tick(now);
      inference.add(ms);
    },

    /** A camera frame is now on screen. @param {number} ms time since it was captured */
    frameLatency(ms) { latency.add(ms); },

    /** Two text lines for the on-screen HUD. */
    hudLines() {
      return [
        `render ${render.rate.toFixed(0)} FPS · detect ${detect.rate.toFixed(0)} FPS` +
          ` · infer ${inference.recentAverage().toFixed(1)} ms`,
        `latency ${latency.recentAverage().toFixed(0)} ms` +
          ` (avg ${latency.sessionAverage().toFixed(0)}, max ${latency.max().toFixed(0)})`,
      ];
    },

    /** Session averages as a plain object (for console.table / the README). */
    summary(now = performance.now()) {
      return {
        'render FPS (avg)': render.average(now).toFixed(1),
        'detect FPS (avg)': detect.average(now).toFixed(1),
        'inference ms (avg)': inference.sessionAverage().toFixed(1),
        'capture-to-render latency ms (avg)': latency.sessionAverage().toFixed(1),
        'capture-to-render latency ms (max)': latency.max().toFixed(1),
      };
    },
  };
}
