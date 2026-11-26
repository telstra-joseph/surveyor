const reduceMotion = () => matchMedia('(prefers-reduced-motion: reduce)').matches;

export function sortableList(container, onReorder, { scroll = container, blocked = () => false } = {}) {
  const animations = new WeakMap();
  let drag;

  function move(row, target) {
    const list = row.parentElement;
    const rows = [...list.children];
    const animate = !reduceMotion() && typeof row.animate === 'function';
    const tops = animate ? rows.map(item => item.getBoundingClientRect().top) : [];
    for (const item of rows) animations.get(item)?.cancel();
    list.insertBefore(row, rows.indexOf(row) < rows.indexOf(target) ? target.nextElementSibling : target);
    if (animate) rows.forEach((item, index) => {
      const offset = tops[index] - item.getBoundingClientRect().top;
      if (offset) animations.set(item, item.animate(
        [{ transform: `translateY(${offset}px)` }, { transform: 'translateY(0)' }],
        { duration: 170, easing: 'ease-out' },
      ));
    });
  }

  function commit(row) {
    onReorder(row, [...row.parentElement.children]);
    row.querySelector('[data-sort-handle]').focus({ preventScroll: true });
  }

  function finish(commitOrder) {
    if (!drag) return;
    const { id, row, list, original, frame } = drag;
    drag = undefined;
    cancelAnimationFrame(frame);
    row.classList.remove('is-dragging');
    if (list.hasPointerCapture(id)) list.releasePointerCapture(id);
    if (commitOrder) commit(row);
    else if (original) {
      for (const item of original) {
        animations.get(item)?.cancel();
        list.append(item);
      }
    }
  }

  function dragFrame() {
    const { list, row, y } = drag;
    const bounds = scroll === document.scrollingElement ? { top: 0, bottom: window.innerHeight } : scroll.getBoundingClientRect();
    if (y < bounds.top + 26) scroll.scrollTop -= 9;
    else if (y > bounds.bottom - 26) scroll.scrollTop += 9;
    const rows = [...list.children].filter(item => item !== row);
    const top = list.getBoundingClientRect().top;
    const before = rows.find(item => y < top + item.offsetTop + item.offsetHeight / 2);
    if (before && row.nextElementSibling !== before) {
      const target = row.compareDocumentPosition(before) & Node.DOCUMENT_POSITION_PRECEDING ? before : before.previousElementSibling;
      if (target && target !== row) move(row, target);
    } else if (!before && row.nextElementSibling && rows.length) move(row, rows.at(-1));
    drag.frame = requestAnimationFrame(dragFrame);
  }

  container.addEventListener('pointerdown', event => {
    const handle = event.target.closest('[data-sort-handle]');
    if (!handle || handle.disabled || !event.isPrimary || event.button !== 0 || blocked() || drag) return;
    const row = handle.closest('li'), list = row.parentElement;
    drag = { id: event.pointerId, row, list, startY: event.clientY };
    list.setPointerCapture(event.pointerId);
  });
  container.addEventListener('pointermove', event => {
    if (drag?.id !== event.pointerId) return;
    drag.y = event.clientY;
    if (!drag.original && Math.abs(drag.y - drag.startY) > 4) {
      drag.original = [...drag.list.children];
      drag.row.classList.add('is-dragging');
      dragFrame();
    }
  });
  container.addEventListener('pointerup', event => {
    if (drag?.id !== event.pointerId) return;
    if (drag.original) {
      drag.y = event.clientY;
      cancelAnimationFrame(drag.frame);
      dragFrame();
    }
    finish(Boolean(drag.original));
  });
  for (const type of ['pointercancel', 'lostpointercapture']) {
    container.addEventListener(type, event => { if (drag?.id === event.pointerId) finish(false); });
  }
  container.addEventListener('keydown', event => {
    if (event.key === 'Escape' && drag) {
      event.preventDefault();
      finish(false);
      return;
    }
    const handle = event.target.closest('[data-sort-handle]');
    if (!handle || handle.disabled || blocked() || drag || !['ArrowUp', 'ArrowDown'].includes(event.key)) return;
    event.preventDefault();
    const row = handle.closest('li');
    const target = event.key === 'ArrowUp' ? row.previousElementSibling : row.nextElementSibling;
    if (!target) return;
    move(row, target);
    commit(row);
    handle.scrollIntoView({ block: 'nearest' });
  });
  return { active: () => Boolean(drag), cancel: () => finish(false) };
}
