export const RENDERED_E2E_SCHEMA = 'browser-agent-rendered-e2e:v1';

export function sanitizeUrl(value) {
  const raw = String(value || '');
  try {
    const url = new URL(raw);
    if (url.protocol === 'http:' || url.protocol === 'https:') {
      return {
        originPath: `${url.origin}${url.pathname}`,
        queryKeys: [...new Set([...url.searchParams.keys()])].sort(),
        hasHash: Boolean(url.hash),
      };
    }
    return { originPath: `${url.protocol}//`, queryKeys: [], hasHash: Boolean(url.hash) };
  } catch {
    return { originPath: '', queryKeys: [], hasHash: false };
  }
}

function finite(value, fallback = 0) {
  const n = Number(value);
  return Number.isFinite(n) ? n : fallback;
}

export function rectOverlap(a, b) {
  if (!a || !b) return 0;
  const x = Math.max(0, Math.min(a.x + a.width, b.x + b.width) - Math.max(a.x, b.x));
  const y = Math.max(0, Math.min(a.y + a.height, b.y + b.height) - Math.max(a.y, b.y));
  return x * y;
}

export function targetMetric(bounds, viewport) {
  if (!bounds || !viewport) return { visible: false, distancePx: null };
  const width = finite(viewport.width), height = finite(viewport.height);
  const right = bounds.x + bounds.width, bottom = bounds.y + bounds.height;
  const visible = right > 0 && bottom > 0 && bounds.x < width && bounds.y < height;
  const dx = bounds.x >= width ? bounds.x - width : right <= 0 ? -right : 0;
  const dy = bounds.y >= height ? bounds.y - height : bottom <= 0 ? -bottom : 0;
  return { visible, distancePx: Math.round(Math.hypot(dx, dy)) };
}

export function layoutMetric(observation) {
  const viewport = observation?.layout?.viewport || { width: 0, height: 0 };
  const elements = (observation?.elements || []).filter(e => e?.bounds);
  const overlaps = [];
  for (let i = 0; i < elements.length; i += 1) {
    for (let j = i + 1; j < elements.length; j += 1) {
      const area = rectOverlap(elements[i].bounds, elements[j].bounds);
      if (area > 0) overlaps.push({ first: elements[i].id, second: elements[j].id, areaPx2: area });
    }
  }
  const clipped = elements.filter(({ bounds }) =>
    bounds.x < 0 || bounds.x + bounds.width > viewport.width
  ).map(e => e.id);
  const documentWidth = finite(observation?.layout?.document?.width, finite(viewport.width));
  const horizontalOverflowPx = Math.max(0, Math.round(documentWidth - finite(viewport.width)));
  return {
    viewport: { width: finite(viewport.width), height: finite(viewport.height) },
    horizontalOverflow: horizontalOverflowPx > 0,
    horizontalOverflowPx,
    overlappingInteractivePairs: overlaps,
    clippedInteractiveElements: clipped,
  };
}

export function scrollMetric(actions = []) {
  let travelPx = 0;
  let travelVh = 0;
  let reversals = 0;
  let lastSign = 0;
  for (const action of actions) {
    if (action?.action !== 'scroll') continue;
    const delta = finite(action.deltaY);
    const sign = Math.sign(delta);
    const height = Math.max(1, finite(action.viewportHeight, 1));
    travelPx += Math.abs(delta);
    travelVh += Math.abs(delta) / height;
    if (sign && lastSign && sign !== lastSign) reversals += 1;
    if (sign) lastSign = sign;
  }
  return { verticalTravelPx: Math.round(travelPx), verticalTravelVh: Number(travelVh.toFixed(3)), reversalCount: reversals };
}

export function summarizeJourney({
  journeyId,
  expectedDestination,
  actions = [],
  observations = [],
  targetBefore = null,
  targetAfter = null,
}) {
  const first = observations[0] || {};
  const last = observations.at(-1) || {};
  const viewports = [...new Set(observations.map(o => {
    const v = o?.layout?.viewport;
    return v ? `${v.width}x${v.height}` : null;
  }).filter(Boolean))];
  const layout = observations.map(layoutMetric);
  const lastUrl = String(last.url || '');
  return {
    schema: RENDERED_E2E_SCHEMA,
    journeyId: String(journeyId || ''),
    transition: {
      success: expectedDestination == null ? Boolean(lastUrl) : lastUrl === String(expectedDestination),
      destination: sanitizeUrl(lastUrl),
      expectedDestination: expectedDestination == null ? null : sanitizeUrl(expectedDestination),
    },
    actionCount: actions.length,
    ...scrollMetric(actions),
    viewports,
    target: {
      before: targetMetric(targetBefore, first?.layout?.viewport),
      after: targetMetric(targetAfter, last?.layout?.viewport),
    },
    layout: {
      horizontalOverflow: layout.some(x => x.horizontalOverflow),
      horizontalOverflowPx: layout.reduce((max, x) => Math.max(max, finite(x.horizontalOverflowPx)), 0),
      overlapCount: layout.reduce((sum, x) => sum + x.overlappingInteractivePairs.length, 0),
      clippedInteractiveCount: layout.reduce((sum, x) => sum + x.clippedInteractiveElements.length, 0),
    },
  };
}
