import { escapeMarkup } from './charts.js';
import { thresholdProfile, thresholdRange, validateThresholds } from './map-thresholds.js';
import { reportMetricName } from './report-labels.js';
import { sortableList } from './sortable-list.js';

const steps = ['Choose workbooks', 'Choose KPIs', 'Customise PowerPoint', 'Arrange workbook sections'];
const kpiOrderStorageKey = 'surveyor-report-kpi-order';
const checkbox = (value, label, checked) => `<label class="checkbox-label">
  <input type="checkbox" value="${escapeMarkup(String(value))}" ${checked ? 'checked' : ''}>
  ${escapeMarkup(label)}</label>`;
const moveButtons = (name, index, count) => `<div class="actions">
  <button type="button" data-move="-1" aria-label="Move ${escapeMarkup(name)} up" ${index === 0 ? 'disabled' : ''}>Move up</button>
  <button type="button" data-move="1" aria-label="Move ${escapeMarkup(name)} down" ${index === count - 1 ? 'disabled' : ''}>Move down</button>
</div>`;

export function defaultReportKpiOrder(keys) {
  const isNr = key => /^(?:5G[\s_-]+)?NR(?:[\s_-]|$)/i.test(key);
  const firstNr = keys.findIndex(isNr);
  return firstNr < 0 ? keys : [...keys.slice(0, firstNr), ...keys.slice(firstNr).filter(isNr), ...keys.slice(firstNr).filter(key => !isNr(key))];
}

export function applySavedKpiOrder(keys, saved) {
  const remaining = new Set(keys);
  return [...saved.filter(key => remaining.delete(key)), ...defaultReportKpiOrder([...remaining])];
}

export function reportOptions(openButton, getSurveys, onExport) {
  const dialog = document.getElementById('report-dialog');
  const form = document.getElementById('report-options');
  const title = document.getElementById('report-step-title');
  const content = document.getElementById('report-step-content');
  const error = document.getElementById('report-options-error');
  const status = document.getElementById('report-order-status');
  const back = document.getElementById('report-back');
  const next = document.getElementById('report-next');
  const stepPanels = [title.parentElement, content];
  const reduceMotion = matchMedia('(prefers-reduced-motion: reduce)');
  let step, surveys, selected, order, kpiOrder, excludedKeys, overrides, workbookSections, addDividers, dividerTitles;
  let animations, savedKpiOrder, kpiStorageError;

  const metrics = () => order.flatMap(i => surveys[i].metrics);
  const availableKeys = () => {
    const available = new Set(metrics().map(metric => metric.key));
    return kpiOrder.filter(key => available.has(key));
  };
  const editableKeys = () => [...new Set(metrics().filter(metric =>
    !excludedKeys.has(metric.key) && metric.geoCount && thresholdProfile(metric.key)).map(metric => metric.key))];
  const workbookName = i => `S${i + 1} · ${surveys[i].filename}`;

  function renderCustomisation() {
    content.innerHTML = `<h4>Workbook divider slides</h4>
      <label class="checkbox-label"><input type="checkbox" id="report-add-dividers" ${addDividers ? 'checked' : ''}
        aria-controls="report-divider-titles" aria-describedby="report-divider-hint">
        Add a divider slide before each workbook</label>
      <p id="report-divider-hint">Divider slides use the one-section-per-workbook layout.</p>
      <div id="report-divider-titles" ${addDividers ? '' : 'hidden'}>${order.map(id => `<label>
        Divider title for ${escapeMarkup(workbookName(id))}
        <input type="text" maxlength="120" data-divider-title="${id}"
          value="${escapeMarkup(dividerTitles.get(id) ?? surveys[id].filename)}">
      </label>`).join('')}</div>
      <h4>Map thresholds</h4>`;
    const keys = editableKeys();
    if (!keys.length) {
      content.insertAdjacentHTML('beforeend', '<p>None of the selected KPIs have editable map thresholds.</p>');
      return;
    }
    content.insertAdjacentHTML('beforeend', `<p>Changes apply only to maps in this PowerPoint. Cutoffs use the workbook units.
      If a cutoff changes, unchanged default labels update to show the new range.</p>${keys.map((key, index) => {
      const base = thresholdProfile(key);
      const draft = overrides.get(key) ?? base;
      return `<details data-threshold="${index}">
        <summary>${escapeMarkup(reportMetricName(key))}</summary>
        <div class="report-cutoffs">${draft.cuts.map((value, i) => `<label>Cutoff ${i + 1} (${base.unit})
          <input type="number" step="any" data-cut="${i}" value="${Number.isFinite(value) ? value : ''}"></label>`).join('')}</div>
        ${base.bands.map(({ interval }, i) => `<div class="report-band">
          <span data-range="${interval}">${thresholdRange({ ...base, cuts: draft.cuts }, interval)}</span>
          <label>Band ${i + 1} label<input type="text" maxlength="80" data-label="${i}" value="${escapeMarkup(draft.bands[i].label)}"></label>
          <label>Colour<input type="color" data-color="${i}" value="${draft.bands[i].color}" aria-label="Band ${i + 1} colour"></label>
        </div>`).join('')}
        <button type="button" data-reset>Restore default thresholds</button>
      </details>`;
    }).join('')}`);
  }

  function renderOrder() {
    content.innerHTML = `<label>PowerPoint layout
      <select id="report-layout">
        <option value="sections"${workbookSections ? ' selected' : ''}>One section per workbook</option>
        <option value="comparison"${workbookSections ? '' : ' selected'}${addDividers ? ' disabled' : ''}>Compare workbooks by KPI</option>
      </select></label>
      ${addDividers ? '<p>To compare workbooks by KPI, go back and turn off divider slides.</p>' : ''}
      <p>${workbookSections ? 'Move workbooks up or down to set their slide order.' : 'Move workbooks up or down to set their order within the comparisons.'}</p>
      <ol class="report-order">${order.map((id, i) => `<li tabindex="-1" data-workbook="${id}">
        <span>${escapeMarkup(workbookName(id))}</span>${moveButtons(`S${id + 1}`, i, order.length)}
      </li>`).join('')}</ol>`;
  }

  function renderChoices() {
    const keys = availableKeys();
    content.innerHTML = `<div class="actions">
      <button type="button" data-select="all">Select all</button>
      <button type="button" data-select="none">Clear selection</button>
    </div>${step === 0
      ? `<div class="report-choices" role="group" aria-label="Workbooks">${surveys.map((_, i) =>
        checkbox(i, workbookName(i), selected.has(i))).join('')}</div>`
      : `<p id="report-kpi-reorder-hint">Drag the handles to reorder slides, or focus a handle and use the Up and Down arrow keys.</p>
        <button type="button" data-save-kpi-order>Save order as default</button>
        <ol class="report-order report-kpi-order sortable-list" aria-label="KPIs">${keys.map(key => `<li>
          <button type="button" data-sort-handle aria-label="Reorder ${escapeMarkup(reportMetricName(key))}"
            aria-describedby="report-kpi-reorder-hint"><span aria-hidden="true">&#8942;&#8942;</span></button>
          ${checkbox(key, reportMetricName(key), !excludedKeys.has(key))}
        </li>`).join('')}</ol>`}`;
    if (step === 1 && kpiStorageError) error.textContent = kpiStorageError;
  }

  const kpiKey = row => row.querySelector('input').value;
  const kpiSort = sortableList(content, (row, rows) => {
    const keys = new Set(rows.map(kpiKey));
    const ordered = rows.map(kpiKey).values();
    kpiOrder = kpiOrder.map(key => keys.has(key) ? ordered.next().value : key);
    content.querySelector('[data-save-kpi-order]').textContent = 'Save order as default';
    status.textContent = `${reportMetricName(kpiKey(row))} moved to position ${rows.indexOf(row) + 1} of ${rows.length}.`;
  }, { blocked: () => Boolean(animations) });

  function render() {
    title.textContent = steps[step];
    document.getElementById('report-step-number').textContent = `POWERPOINT · STEP ${step + 1} OF ${steps.length}`;
    error.textContent = '';
    status.textContent = '';
    back.hidden = step === 0;
    next.textContent = step === steps.length - 1 ? 'Download PowerPoint' : 'Next';
    if (step < 2) renderChoices();
    else if (step === 2) renderCustomisation();
    else renderOrder();
    content.scrollTop = 0;
    title.focus();
  }

  function stopTransition() {
    for (const animation of animations || []) animation.cancel();
    animations = undefined;
    content.inert = false;
  }

  async function changeStep(direction) {
    if (reduceMotion.matches || !content.animate) {
      step += direction;
      render();
      return;
    }
    const frame = (opacity, offset) => ({ opacity, transform: `translateX(${offset}px)` });
    const animate = (frames, duration) => stepPanels.map(panel =>
      panel.animate(frames, { duration, easing: 'ease-out', fill: 'both' }));
    const outgoing = animations = animate([frame(1, 0), frame(0, -16 * direction)], 110);
    content.inert = true;
    await Promise.allSettled(outgoing.map(animation => animation.finished));
    if (animations !== outgoing || !dialog.open) return;
    stopTransition();
    step += direction;
    render();
    const incoming = animations = animate([frame(0, 16 * direction), frame(1, 0)], 170);
    await Promise.allSettled(incoming.map(animation => animation.finished));
    if (animations === incoming) stopTransition();
  }

  function captureStep(validate) {
    if (step < 2) {
      const values = [...content.querySelectorAll('input:checked')].map(input => input.value);
      if (step === 0) {
        const ids = values.map(Number);
        selected = new Set(ids);
        order = [...order.filter(id => selected.has(id)), ...ids.filter(id => !order.includes(id))];
      } else {
        const checked = new Set(values);
        for (const key of availableKeys()) {
          if (checked.has(key)) excludedKeys.delete(key);
          else excludedKeys.add(key);
        }
      }
      if (validate && !values.length) {
        error.textContent = `Select at least one ${step === 0 ? 'workbook' : 'KPI'}.`;
        content.querySelector('input')?.focus();
        return false;
      }
    } else if (step === 2 && validate) {
      for (const details of content.querySelectorAll('[data-threshold]')) {
        const key = editableKeys()[Number(details.dataset.threshold)];
        if (!overrides.has(key)) continue;
        const message = validateThresholds(key, overrides.get(key));
        if (message) {
          error.textContent = `${reportMetricName(key)}: ${message}`;
          details.open = true;
          details.querySelector('summary').focus();
          return false;
        }
      }
    }
    return true;
  }

  openButton.addEventListener('click', () => {
    stopTransition();
    surveys = getSurveys();
    order = surveys.map((_, i) => i);
    savedKpiOrder = [];
    kpiStorageError = '';
    try {
      const stored = JSON.parse(localStorage.getItem(kpiOrderStorageKey) ?? '[]');
      if (!Array.isArray(stored) || !stored.every(key => typeof key === 'string')) throw new Error('Invalid saved order.');
      savedKpiOrder = stored;
    } catch (cause) {
      kpiStorageError = `Could not load the default KPI order: ${cause.message}`;
    }
    kpiOrder = applySavedKpiOrder([...new Set(metrics().map(metric => metric.key))], savedKpiOrder);
    selected = new Set(order);
    excludedKeys = new Set();
    overrides = new Map();
    workbookSections = true;
    addDividers = false;
    dividerTitles = new Map();
    step = 0;
    dialog.showModal();
    render();
  });
  document.getElementById('report-cancel').addEventListener('click', () => dialog.close());
  dialog.addEventListener('cancel', event => {
    if (kpiSort.active()) {
      event.preventDefault();
      kpiSort.cancel();
    }
  });
  dialog.addEventListener('close', () => {
    if (!dialog.open) {
      kpiSort.cancel();
      stopTransition();
    }
  });
  back.addEventListener('click', () => {
    if (animations || kpiSort.active()) return;
    captureStep(false);
    void changeStep(-1);
  });
  content.addEventListener('input', ({ target }) => {
    error.textContent = '';
    if (target.id === 'report-add-dividers') {
      addDividers = target.checked;
      if (addDividers) workbookSections = true;
      content.querySelector('#report-divider-titles').hidden = !addDividers;
      return;
    }
    if (target.matches('[data-divider-title]')) {
      dividerTitles.set(Number(target.dataset.dividerTitle), target.value);
      return;
    }
    if (target.id === 'report-layout') {
      workbookSections = target.value === 'sections';
      renderOrder();
      content.querySelector('#report-layout').focus();
    }
    const details = target.closest('[data-threshold]');
    if (!details) return;
    const key = editableKeys()[Number(details.dataset.threshold)];
    const cuts = [...details.querySelectorAll('[data-cut]')].map(input => input.valueAsNumber);
    const bands = [...details.querySelectorAll('[data-label]')].map((input, i) => ({
      label: input.value, color: details.querySelector(`[data-color="${i}"]`).value,
    }));
    const base = thresholdProfile(key);
    if (cuts.every((n, i) => n === base.cuts[i]) &&
        bands.every(({ label, color }, i) => label === base.bands[i].label && color.toUpperCase() === base.bands[i].color)) overrides.delete(key);
    else overrides.set(key, { cuts, bands });
    for (const span of details.querySelectorAll('[data-range]')) {
      span.textContent = cuts.every(Number.isFinite) ? thresholdRange({ ...base, cuts }, Number(span.dataset.range)) : 'Enter all cutoffs';
    }
  });
  content.addEventListener('click', ({ target }) => {
    if (target.matches('[data-select]')) {
      for (const box of content.querySelectorAll('input')) box.checked = target.dataset.select === 'all';
      error.textContent = '';
    } else if (target.matches('[data-save-kpi-order]')) {
      const saved = [...new Set([...availableKeys(), ...savedKpiOrder])];
      try {
        localStorage.setItem(kpiOrderStorageKey, JSON.stringify(saved));
        savedKpiOrder = saved;
        error.textContent = kpiStorageError = '';
        status.textContent = 'Default KPI order saved.';
        target.textContent = 'Default order saved';
      } catch (cause) {
        error.textContent = `Could not save the default KPI order: ${cause.message}`;
      }
    } else if (target.matches('[data-reset]')) {
      const { threshold } = target.closest('details').dataset;
      const open = [...content.querySelectorAll('details[open]')].map(item => item.dataset.threshold);
      const scroll = content.scrollTop;
      overrides.delete(editableKeys()[Number(threshold)]);
      renderCustomisation();
      for (const i of open) content.querySelector(`[data-threshold="${i}"]`).open = true;
      content.querySelector(`[data-threshold="${threshold}"] [data-reset]`).focus({ preventScroll: true });
      content.scrollTop = scroll;
      error.textContent = '';
    } else if (target.matches('[data-move]')) {
      const list = content.querySelector('.report-order');
      const i = [...list.children].indexOf(target.closest('li'));
      const position = i + Number(target.dataset.move);
      const count = list.children.length;
      const name = `S${order[i] + 1}`;
      [order[i], order[position]] = [order[position], order[i]];
      renderOrder();
      const row = content.querySelector('.report-order').children[position];
      (row.querySelector(`[data-move="${target.dataset.move}"]:enabled`) || row).focus();
      status.textContent = `${name} moved to position ${position + 1} of ${count}.`;
    }
  });
  form.addEventListener('submit', event => {
    event.preventDefault();
    if (animations || kpiSort.active() || event.submitter !== next || !captureStep(true)) return;
    if (step < steps.length - 1) {
      void changeStep(1);
    } else {
      dialog.close();
      onExport({ surveys: order.map(i => ({ ...surveys[i], sourceIndex: i })), keys: availableKeys().filter(key => !excludedKeys.has(key)),
        dividerTitles: addDividers ? order.map(id => dividerTitles.get(id)?.trim() || surveys[id].filename) : undefined,
        workbookSections, thresholdOverrides: Object.fromEntries(editableKeys().filter(key => overrides.has(key)).map(key => [key, overrides.get(key)])) });
    }
  });
}
