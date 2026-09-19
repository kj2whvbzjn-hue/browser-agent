import { createHash } from 'node:crypto';

const INTERACTIVE_ROLES = new Set([
  'button', 'link', 'textbox', 'searchbox', 'checkbox', 'radio', 'combobox', 'switch',
  'menuitem', 'menuitemcheckbox', 'menuitemradio', 'tab', 'option', 'slider', 'spinbutton',
  'treeitem', 'gridcell', 'rowheader', 'columnheader'
]);

const AX_ROLES = new Set([
  ...INTERACTIVE_ROLES,
  'rootwebarea', 'dialog', 'alertdialog', 'alert', 'heading', 'navigation', 'main', 'form', 'listbox', 'menu'
]);

const OBSERVER_STORE_KEY = '__browserAgentObserverRefsV2';

function clean(value, max = 300) {
  return String(value ?? '').replace(/\s+/g, ' ').trim().slice(0, max);
}

function hashText(value) {
  return createHash('sha256').update(String(value ?? ''), 'utf8').digest('hex').slice(0, 16);
}

function originOf(url) {
  try { return new URL(url).origin; } catch { return ''; }
}

function elementSignature(element) {
  return [
    element.frame?.url || '',
    element.role || '',
    element.accessibleName || element.label || '',
    element.name || '',
    element.type || '',
    element.text || '',
    element.context || ''
  ].join('|').slice(0, 1600);
}


function elementIdentity(element) {
  return [
    element.frame?.url || '',
    element.role || '',
    element.accessibleName || element.label || '',
    element.attributes?.id || '',
    element.name || '',
    element.type || '',
    element.context || ''
  ].join('|').slice(0, 1600);
}

function describeChanged(before, after) {
  return {
    element: describeForDiff(after),
    before: {
      text: clean(before.text, 120),
      value: clean(before.value, 160),
      states: before.states || {},
      occluded: Boolean(before.occluded),
      inViewport: Boolean(before.inViewport)
    },
    after: {
      text: clean(after.text, 120),
      value: clean(after.value, 160),
      states: after.states || {},
      occluded: Boolean(after.occluded),
      inViewport: Boolean(after.inViewport)
    }
  };
}
function describeForDiff(element) {
  return {
    role: element.role || null,
    name: element.accessibleName || element.label || element.text || null,
    text: clean(element.text, 120),
    context: clean(element.context, 160),
    frame: element.frame?.id || 'f0'
  };
}

export function diffObservations(before, after) {
  if (!before || !after) return null;
  const beforeMap = new Map((before.elements || []).map(element => [elementSignature(element), element]));
  const afterMap = new Map((after.elements || []).map(element => [elementSignature(element), element]));
  const added = [];
  const removed = [];
  for (const [key, element] of afterMap) if (!beforeMap.has(key)) added.push(describeForDiff(element));
  for (const [key, element] of beforeMap) if (!afterMap.has(key)) removed.push(describeForDiff(element));

  const beforeIdentity = new Map((before.elements || []).map(element => [elementIdentity(element), element]));
  const afterIdentity = new Map((after.elements || []).map(element => [elementIdentity(element), element]));
  const changed = [];
  for (const [key, afterElement] of afterIdentity) {
    const beforeElement = beforeIdentity.get(key);
    if (!beforeElement) continue;
    const beforeComparable = JSON.stringify({ text: beforeElement.text, value: beforeElement.value, states: beforeElement.states, occluded: beforeElement.occluded, inViewport: beforeElement.inViewport });
    const afterComparable = JSON.stringify({ text: afterElement.text, value: afterElement.value, states: afterElement.states, occluded: afterElement.occluded, inViewport: afterElement.inViewport });
    if (beforeComparable !== afterComparable) changed.push(describeChanged(beforeElement, afterElement));
  }

  const beforeDialogs = new Set((before.dialogs || []).map(dialog => `${dialog.frame?.id || 'f0'}|${dialog.role}|${dialog.name}|${dialog.text}`));
  const afterDialogs = new Set((after.dialogs || []).map(dialog => `${dialog.frame?.id || 'f0'}|${dialog.role}|${dialog.name}|${dialog.text}`));
  const dialogsOpened = (after.dialogs || []).filter(dialog => !beforeDialogs.has(`${dialog.frame?.id || 'f0'}|${dialog.role}|${dialog.name}|${dialog.text}`));
  const dialogsClosed = (before.dialogs || []).filter(dialog => !afterDialogs.has(`${dialog.frame?.id || 'f0'}|${dialog.role}|${dialog.name}|${dialog.text}`));

  const beforeFocused = (before.elements || []).find(element => element.states?.focused);
  const afterFocused = (after.elements || []).find(element => element.states?.focused);
  const focusedBefore = beforeFocused ? describeForDiff(beforeFocused) : null;
  const focusedAfter = afterFocused ? describeForDiff(afterFocused) : null;

  return {
    urlChanged: before.url !== after.url,
    beforeUrl: before.url,
    afterUrl: after.url,
    titleChanged: before.title !== after.title,
    textChanged: hashText(before.pageText) !== hashText(after.pageText),
    interactiveCountBefore: (before.elements || []).length,
    interactiveCountAfter: (after.elements || []).length,
    addedCount: added.length,
    removedCount: removed.length,
    changedCount: changed.length,
    added: added.slice(0, 12),
    removed: removed.slice(0, 12),
    changed: changed.slice(0, 12),
    dialogsOpened: dialogsOpened.slice(0, 6),
    dialogsClosed: dialogsClosed.slice(0, 6),
    focusChanged: JSON.stringify(focusedBefore) !== JSON.stringify(focusedAfter),
    focusedBefore,
    focusedAfter
  };
}

async function frameOffset(frame) {
  const parent = frame.parentFrame();
  if (!parent) return { x: 0, y: 0 };
  try {
    const frameElement = await frame.frameElement();
    const box = await frameElement.boundingBox();
    await frameElement.dispose().catch(() => {});
    if (box) return { x: box.x, y: box.y };
  } catch {}
  return { x: 0, y: 0 };
}

async function observeFrame(frame, frameInfo, generation, { registerRefs = true } = {}) {
  const local = await frame.evaluate(({ generation, frameId, registerRefs, storeKey }) => {
    const maxText = (value, max = 500) => String(value ?? '').replace(/\s+/g, ' ').trim().slice(0, max);
    const interactiveRoles = new Set([
      'button', 'link', 'textbox', 'searchbox', 'checkbox', 'radio', 'combobox', 'switch',
      'menuitem', 'menuitemcheckbox', 'menuitemradio', 'tab', 'option', 'slider', 'spinbutton',
      'treeitem', 'gridcell', 'rowheader', 'columnheader'
    ]);
    const nativeTags = new Set(['button', 'input', 'textarea', 'select', 'a', 'summary']);

    const roleFor = el => {
      const explicit = maxText(el.getAttribute?.('role') || '', 80).toLowerCase();
      if (explicit) return explicit;
      const tag = el.tagName?.toLowerCase?.() || '';
      if (tag === 'button' || tag === 'summary') return 'button';
      if (tag === 'option') return 'option';
      if (tag === 'a' && el.hasAttribute('href')) return 'link';
      if (tag === 'textarea') return 'textbox';
      if (tag === 'select') return el.multiple || Number(el.size || 0) > 1 ? 'listbox' : 'combobox';
      if (tag === 'input') {
        const type = String(el.type || 'text').toLowerCase();
        if (type === 'checkbox') return 'checkbox';
        if (type === 'radio') return 'radio';
        if (type === 'range') return 'slider';
        if (type === 'number') return 'spinbutton';
        if (type === 'search') return 'searchbox';
        if (['button', 'submit', 'reset', 'image'].includes(type)) return 'button';
        if (type === 'hidden') return null;
        return 'textbox';
      }
      if (el.isContentEditable) return 'textbox';
      return null;
    };

    const textFromIds = value => {
      if (!value) return '';
      return value.split(/\s+/).map(id => document.getElementById(id)?.innerText || document.getElementById(id)?.textContent || '').join(' ');
    };

    const accessibleName = el => {
      const labelledBy = textFromIds(el.getAttribute?.('aria-labelledby'));
      const labels = el.labels ? [...el.labels].map(label => label.innerText || label.textContent || '').join(' ') : '';
      const tag = el.tagName?.toLowerCase?.() || '';
      const type = String(el.getAttribute?.('type') || '').toLowerCase();
      const buttonValue = tag === 'input' && ['button', 'submit', 'reset'].includes(type) ? el.value : '';
      return maxText(
        el.getAttribute?.('aria-label') || labelledBy || labels || el.getAttribute?.('alt') ||
        el.getAttribute?.('placeholder') || buttonValue || el.getAttribute?.('title') ||
        el.innerText || el.textContent || '',
        300
      );
    };

    const nearestContext = el => {
      let current = el.parentElement;
      for (let depth = 0; current && depth < 4; depth += 1, current = current.parentElement) {
        const tag = current.tagName?.toLowerCase?.() || '';
        const role = current.getAttribute?.('role') || '';
        if (['li', 'tr', 'article', 'section', 'form', 'dialog', 'fieldset'].includes(tag) || ['row', 'dialog', 'listitem', 'article'].includes(role)) {
          const own = maxText(el.innerText || el.textContent || '', 300);
          const context = maxText(current.innerText || current.textContent || '', 500);
          if (context && context !== own) return context;
        }
      }
      return '';
    };

    const getAllElements = root => {
      const out = [];
      const visit = node => {
        if (!node) return;
        const children = node instanceof Document || node instanceof ShadowRoot ? node.children : node.children;
        if (!children) return;
        for (const child of children) {
          out.push(child);
          if (child.shadowRoot) visit(child.shadowRoot);
          visit(child);
        }
      };
      visit(root);
      return out;
    };

    const isVisible = (el, rect, style) => {
      if (!(rect.width > 0 && rect.height > 0)) return false;
      if (style.display === 'none' || style.visibility === 'hidden' || Number(style.opacity || 1) === 0) return false;
      if (el.closest?.('[hidden],[aria-hidden="true"]')) return false;
      return true;
    };

    const isInteractive = (el, role, style) => {
      const tag = el.tagName?.toLowerCase?.() || '';
      if (nativeTags.has(tag)) {
        if (tag !== 'a' || el.hasAttribute('href')) return true;
      }
      if (role && interactiveRoles.has(role)) return true;
      if (el.isContentEditable) return true;
      if (el.tabIndex >= 0) return true;
      if (typeof el.onclick === 'function' || el.hasAttribute?.('onclick')) return true;
      if (style.cursor === 'pointer') return true;
      return false;
    };

    const hitTest = (el, rect) => {
      const left = Math.max(0, rect.left);
      const right = Math.min(innerWidth - 1, rect.right);
      const top = Math.max(0, rect.top);
      const bottom = Math.min(innerHeight - 1, rect.bottom);
      const inViewport = right > left && bottom > top;
      if (!inViewport) return { inViewport: false, occluded: false, coveredBy: null };
      const x = (left + right) / 2;
      const y = (top + bottom) / 2;
      const hit = document.elementFromPoint(x, y);
      const composedAncestors = node => {
        const out = new Set();
        let current = node;
        while (current) {
          out.add(current);
          if (current.parentNode) current = current.parentNode;
          else {
            const root = current.getRootNode?.();
            current = root instanceof ShadowRoot ? root.host : null;
          }
        }
        return out;
      };
      const hitAncestors = hit ? composedAncestors(hit) : new Set();
      const elAncestors = composedAncestors(el);
      const ownsHit = Boolean(hit && (hit === el || hitAncestors.has(el) || elAncestors.has(hit)));
      return {
        inViewport: true,
        occluded: Boolean(hit && !ownsHit),
        coveredBy: hit && !ownsHit ? {
          tag: hit.tagName?.toLowerCase?.() || null,
          role: roleFor(hit),
          name: accessibleName(hit),
          text: maxText(hit.innerText || hit.textContent || '', 120)
        } : null
      };
    };

    const all = getAllElements(document);
    const legacySelector = ['button','input','textarea','select','a[href]','[role=\"button\"]','[role=\"link\"]','[role=\"textbox\"]','[role=\"checkbox\"]','[role=\"radio\"]','[role=\"combobox\"]','[contenteditable=\"true\"]'].join(',');
    const legacyNodes = [...document.querySelectorAll(legacySelector)];
    const legacyIndex = new Map(legacyNodes.map((node, index) => [node, index]));
    const elements = [];
    const dialogs = [];
    const store = registerRefs ? new Map() : null;
    let localIndex = 0;

    for (const el of all) {
      const rect = el.getBoundingClientRect();
      const style = getComputedStyle(el);
      if (!isVisible(el, rect, style)) continue;
      const role = roleFor(el);
      const name = accessibleName(el);
      const tag = el.tagName.toLowerCase();
      const dialogRole = role === 'dialog' || role === 'alertdialog' || (tag === 'dialog' && el.open);
      if (dialogRole) {
        dialogs.push({
          role: role || 'dialog',
          name,
          text: maxText(el.innerText || el.textContent || '', 700),
          bounds: { x: Math.round(rect.x), y: Math.round(rect.y), width: Math.round(rect.width), height: Math.round(rect.height) }
        });
      }
      if (!isInteractive(el, role, style)) continue;

      localIndex += 1;
      const refToken = `${frameId}-r${generation}-${localIndex}`;
      if (store) store.set(refToken, el);
      const hit = hitTest(el, rect);
      const type = el.getAttribute('type');
      const value = 'value' in el ? String(el.value ?? '') : null;
      const checked = 'checked' in el ? Boolean(el.checked) : null;
      const selected = 'selected' in el ? Boolean(el.selected) : null;
      const ariaInvalid = el.getAttribute('aria-invalid');
      const invalid = ariaInvalid === 'true' || (typeof el.checkValidity === 'function' && !el.checkValidity());
      const focused = document.activeElement === el || (el.getRootNode() instanceof ShadowRoot && el.getRootNode().activeElement === el);
      elements.push({
        refToken,
        domIndex: legacyIndex.has(el) ? legacyIndex.get(el) : null,
        tag,
        role,
        accessibleName: name,
        label: name,
        text: maxText(el.innerText || el.textContent || '', 500),
        context: nearestContext(el),
        type,
        name: el.getAttribute('name'),
        value,
        editable: tag === 'textarea' || tag === 'input' || el.isContentEditable,
        visible: true,
        inViewport: hit.inViewport,
        occluded: hit.occluded,
        coveredBy: hit.coveredBy,
        bounds: { x: Math.round(rect.x), y: Math.round(rect.y), width: Math.round(rect.width), height: Math.round(rect.height) },
        states: {
          disabled: Boolean('disabled' in el ? el.disabled : el.getAttribute('aria-disabled') === 'true'),
          readonly: Boolean('readOnly' in el ? el.readOnly : el.getAttribute('aria-readonly') === 'true'),
          required: Boolean('required' in el ? el.required : el.getAttribute('aria-required') === 'true'),
          checked,
          selected,
          expanded: el.hasAttribute('aria-expanded') ? el.getAttribute('aria-expanded') === 'true' : null,
          pressed: el.hasAttribute('aria-pressed') ? el.getAttribute('aria-pressed') === 'true' : null,
          invalid,
          focused
        },
        attributes: {
          id: el.id || null,
          href: el.getAttribute('href'),
          autocomplete: el.getAttribute('autocomplete'),
          ariaDescribedBy: el.getAttribute('aria-describedby'),
          tabindex: el.hasAttribute('tabindex') ? Number(el.getAttribute('tabindex')) : null
        }
      });
    }

    if (registerRefs) {
      try { globalThis[storeKey] = { generation, refs: store }; } catch {}
    }

    const root = document.documentElement;
    const body = document.body;
    const documentWidth = Math.max(root?.scrollWidth || 0, body?.scrollWidth || 0, innerWidth);
    const documentHeight = Math.max(root?.scrollHeight || 0, body?.scrollHeight || 0, innerHeight);
    return {
      url: location.href,
      title: document.title,
      text: maxText(body?.innerText || '', 10000),
      elements,
      dialogs,
      layout: {
        viewport: { width: innerWidth, height: innerHeight },
        scroll: { x: scrollX, y: scrollY },
        document: { width: documentWidth, height: documentHeight },
        horizontalOverflow: documentWidth > innerWidth + 1
      }
    };
  }, { generation, frameId: frameInfo.id, registerRefs, storeKey: OBSERVER_STORE_KEY });

  return local;
}

async function accessibilitySummary(page) {
  let session;
  try {
    session = await page.context().newCDPSession(page);
    await session.send('Accessibility.enable').catch(() => {});
    const { nodes = [] } = await session.send('Accessibility.getFullAXTree');
    const summarized = [];
    for (const node of nodes) {
      if (node.ignored) continue;
      const role = clean(node.role?.value, 80).toLowerCase();
      const name = clean(node.name?.value, 300);
      if (!role || !AX_ROLES.has(role)) continue;
      const props = {};
      for (const prop of node.properties || []) {
        if (['disabled', 'expanded', 'focused', 'selected', 'checked', 'required', 'invalid', 'editable'].includes(prop.name)) {
          props[prop.name] = prop.value?.value ?? null;
        }
      }
      summarized.push({ role, name, backendNodeId: node.backendDOMNodeId || null, states: props });
      if (summarized.length >= 160) break;
    }
    return summarized;
  } catch {
    return [];
  } finally {
    await session?.detach().catch(() => {});
  }
}

export async function resolveObservedElement(ref) {
  if (!ref?.frame || !ref?.refToken) return null;
  try {
    const handle = await ref.frame.evaluateHandle(({ storeKey, refToken, generation }) => {
      const store = globalThis[storeKey];
      if (!store || store.generation !== generation) return null;
      return store.refs?.get(refToken) || null;
    }, { storeKey: OBSERVER_STORE_KEY, refToken: ref.refToken, generation: ref.generation });
    const element = handle.asElement();
    if (!element) await handle.dispose().catch(() => {});
    return element;
  } catch {
    return null;
  }
}

export async function observePage(page, generation, options = {}) {
  const registerRefs = options.registerRefs !== false;
  const includeAccessibility = options.includeAccessibility !== false;
  const frames = page.frames();
  const mainOrigin = originOf(page.url());
  const internalRefs = new Map();
  const frameStates = [];
  const allElements = [];
  const allDialogs = [];
  const textParts = [];

  for (let index = 0; index < frames.length; index += 1) {
    const frame = frames[index];
    const parent = frame.parentFrame();
    let depth = 0;
    for (let cursor = parent; cursor; cursor = cursor.parentFrame()) depth += 1;
    const info = {
      id: `f${index}`,
      index,
      name: clean(frame.name(), 120),
      url: frame.url(),
      depth,
      main: frame === page.mainFrame(),
      crossOrigin: Boolean(mainOrigin && originOf(frame.url()) && originOf(frame.url()) !== mainOrigin)
    };
    try {
      const offset = await frameOffset(frame);
      const raw = await observeFrame(frame, info, generation, { registerRefs });
      frameStates.push({ ...info, title: clean(raw.title, 300), elementCount: raw.elements.length, layout: raw.layout });
      if (raw.text) textParts.push(info.main ? raw.text : `[Frame ${info.id}${info.name ? ` ${info.name}` : ''}] ${raw.text}`);
      for (const dialog of raw.dialogs) {
        allDialogs.push({ ...dialog, frame: info, bounds: { ...dialog.bounds, x: dialog.bounds.x + offset.x, y: dialog.bounds.y + offset.y } });
      }
      for (const rawElement of raw.elements) {
        const id = `g${generation}-e${allElements.length + 1}`;
        const element = {
          id,
          domIndex: info.main ? rawElement.domIndex : null,
          role: rawElement.role,
          accessibleName: clean(rawElement.accessibleName),
          label: clean(rawElement.label),
          text: clean(rawElement.text),
          context: clean(rawElement.context, 500),
          type: rawElement.type,
          name: rawElement.name,
          value: clean(rawElement.value, 1000),
          disabled: rawElement.states?.disabled ?? false,
          editable: rawElement.editable,
          visible: rawElement.visible,
          inViewport: rawElement.inViewport,
          occluded: rawElement.occluded,
          coveredBy: rawElement.coveredBy,
          states: rawElement.states,
          attributes: rawElement.attributes,
          frame: info,
          bounds: {
            x: Math.round(rawElement.bounds.x + offset.x),
            y: Math.round(rawElement.bounds.y + offset.y),
            width: rawElement.bounds.width,
            height: rawElement.bounds.height
          }
        };
        allElements.push(element);
        if (registerRefs) internalRefs.set(id, { frame, refToken: rawElement.refToken, generation, frameInfo: info });
      }
      if (info.main) info.layout = raw.layout;
    } catch (error) {
      frameStates.push({ ...info, error: clean(error?.message || error, 500), elementCount: 0 });
    }
  }

  const mainFrameState = frameStates.find(frame => frame.main);
  const mainLayout = mainFrameState?.layout || await page.evaluate(() => ({
    viewport: { width: innerWidth, height: innerHeight },
    scroll: { x: scrollX, y: scrollY },
    document: {
      width: Math.max(document.documentElement?.scrollWidth || 0, document.body?.scrollWidth || 0, innerWidth),
      height: Math.max(document.documentElement?.scrollHeight || 0, document.body?.scrollHeight || 0, innerHeight)
    },
    horizontalOverflow: Math.max(document.documentElement?.scrollWidth || 0, document.body?.scrollWidth || 0, innerWidth) > innerWidth + 1
  })).catch(() => null);

  const accessibility = includeAccessibility ? await accessibilitySummary(page) : [];
  const state = {
    generation,
    url: page.url(),
    title: await page.title().catch(() => ''),
    pageText: clean(textParts.join('\n'), 12000),
    elements: allElements,
    dialogs: allDialogs,
    frames: frameStates.map(({ layout, ...frame }) => frame),
    accessibility,
    layout: mainLayout,
    semantic: {
      interactiveElementCount: allElements.length,
      frameCount: frameStates.length,
      dialogCount: allDialogs.length,
      accessibilityNodeCount: accessibility.length,
      occludedElementCount: allElements.filter(element => element.occluded).length,
      offscreenElementCount: allElements.filter(element => !element.inViewport).length
    }
  };

  return { state, internalRefs };
}
