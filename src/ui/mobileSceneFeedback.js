const TARGETS = '.mobile-scene-card-open, .mobile-scene-shot, .mobile-scene-editor-shot-open, .mobile-scene-tile, .mobile-scene-primary, .mobile-scene-actions > button, .mobile-scene-editor-shot-actions > button';

export function createSceneTapFeedback(root, panel) {
  const doc = root.ownerDocument;
  const win = doc.defaultView;
  const removers = [];
  let current = null;
  const active = () => doc.body.classList.contains('mobile-shell') && doc.body.dataset.mobileSheet === 'scenes';
  const reduced = () => win.matchMedia('(prefers-reduced-motion: reduce)').matches;
  const listen = (node, type, handler, options) => {
    node.addEventListener(type, handler, options);
    removers.push(() => node.removeEventListener(type, handler, options));
  };
  const cancel = () => {
    if (!current) return;
    current.cancelled = true;
    current.animation.cancel();
    current.ripple.remove();
  };
  const reset = () => { cancel(); current = null; };
  listen(panel, 'mobile-scene-close', reset);
  listen(doc, 'pointerdown', (event) => {
    reset();
    if (!active() || !event.isPrimary || event.button !== 0) return;
    const button = event.target.closest(TARGETS);
    if (!button || !root.contains(button) || button.disabled) return;
    const surface = button.closest('.mobile-scene-card, .mobile-scene-editor-shot') || button;
    const rect = surface.getBoundingClientRect();
    const x = (event.clientX - rect.left) * surface.offsetWidth / rect.width;
    const y = (event.clientY - rect.top) * surface.offsetHeight / rect.height;
    const radius = Math.hypot(Math.max(x, surface.offsetWidth - x), Math.max(y, surface.offsetHeight - y));
    const ripple = doc.createElement('span');
    ripple.className = 'mobile-scene-tap-ripple';
    ripple.setAttribute('aria-hidden', 'true');
    surface.append(ripple);
    const animation = ripple.animate([
      { clipPath: `circle(0px at ${x}px ${y}px)` },
      { clipPath: `circle(${radius}px at ${x}px ${y}px)` },
    ], { duration: reduced() ? 0 : 120, easing: 'cubic-bezier(0.2, 0, 0, 1)', fill: 'forwards' });
    ripple.style.opacity = '1';
    current = { button, ripple, animation, pointerId: event.pointerId, x: event.clientX, y: event.clientY, cancelled: false, committed: false };
  }, { capture: true, passive: true });
  listen(doc, 'pointermove', (event) => {
    if (current?.pointerId === event.pointerId && Math.hypot(event.clientX - current.x, event.clientY - current.y) > 4) cancel();
  }, { passive: true });
  listen(doc, 'pointercancel', (event) => {
    if (current?.pointerId === event.pointerId) cancel();
  }, { passive: true });
  listen(root, 'scroll', cancel, { capture: true, passive: true });
  listen(win, 'blur', cancel);
  listen(doc, 'pointerup', (event) => {
    const feedback = current;
    if (!feedback || feedback.pointerId !== event.pointerId || feedback.cancelled) return;
    feedback.animation.finished.then(() => {
      if (current === feedback && !feedback.committed) feedback.ripple.style.opacity = '0';
    }).catch(() => {});
  }, { passive: true });
  const run = async (event, action, immediate) => {
    const button = event.currentTarget;
    if (button.disabled) return;
    if (!active() || event.detail === 0 || !button.matches(TARGETS)) {
      reset();
      return action(event);
    }
    const feedback = current;
    if (!feedback || feedback.button !== button) return action(event);
    if (feedback.cancelled || feedback.committed) return;
    feedback.committed = true;
    if (immediate || reduced()) {
      feedback.animation.finished.then(() => {
        if (current === feedback) feedback.ripple.style.opacity = '0';
      }).catch(() => {});
      return action(event);
    }
    try { await feedback.animation.finished; } catch { return; }
    const valid = () => current === feedback && !feedback.cancelled && button.isConnected && !button.disabled && active();
    if (!valid()) return;
    feedback.ripple.style.opacity = '1';
    // Present the completed fill before a scene render or camera action.
    await new Promise((resolve) => win.requestAnimationFrame(() => win.requestAnimationFrame(resolve)));
    if (!valid()) return;
    feedback.ripple.style.opacity = '0';
    return action(event);
  };
  return { run, reset, destroy: () => { reset(); for (const remove of removers) remove(); } };
}
