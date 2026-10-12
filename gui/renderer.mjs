import { createTranslator, formatResets, windowLabel } from './i18n.mjs';

const TOOL_NAME = { claude: 'Claude Code', codex: 'Codex CLI', antigravity: 'Antigravity' };

const content = document.getElementById('content');
const updated = document.getElementById('updated');
const refreshBtn = document.getElementById('refresh');
const hideBtn = document.getElementById('hide');

let lang = 'en';
let t = createTranslator(lang);
let lastResult = null;
let lastFetchedAt = null;

function levelClass(percent) {
  if (percent >= 90) return 'lvl-crit';
  if (percent >= 70) return 'lvl-warn';
  return 'lvl-ok';
}

function formatClock(iso) {
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? '?' : d.toLocaleTimeString(lang, { hour: '2-digit', minute: '2-digit' });
}

function render(result) {
  if (!result || Object.keys(result).length === 0) {
    content.innerHTML = `<p class="empty">${escapeHtml(t('app.noTools'))}</p>`;
    return;
  }

  const sections = Object.entries(result).map(([tool, data]) => {
    const label = TOOL_NAME[tool] || tool;
    if (data?.error && !data.stale) {
      return `<section><h2>${label}</h2><p class="error">${escapeHtml(data.error)}</p></section>`;
    }
    if (!data?.windows?.length) {
      return `<section><h2>${label}</h2><p class="empty">${escapeHtml(t('app.noData'))}</p></section>`;
    }
    const rows = data.windows
      .map((w) => {
        const pct = typeof w.percent === 'number' ? w.percent : 0;
        const name = windowLabel(t, w.window);
        // Screen readers get a labelled progress bar; the visible
        // percentage is the same information for everyone else.
        const aria = escapeHtml(t('app.windowLabel', { tool: label, window: name, percent: w.percent ?? '?' }));
        return `
          <div class="row">
            <div class="row-label">
              <span>${escapeHtml(name)}</span>
              <span class="pct">${w.percent ?? '?'}%</span>
            </div>
            <div class="bar ${levelClass(pct)}" role="progressbar" aria-label="${aria}" aria-valuemin="0" aria-valuemax="100"${
              typeof w.percent === 'number' ? ` aria-valuenow="${pct}"` : ''
            }><span style="width:${Math.min(100, Math.max(0, pct))}%"></span></div>
            <div class="row-label"><span></span><span class="resets">${escapeHtml(formatResets(t, w.resetsAt))}</span></div>
          </div>`;
      })
      .join('');
    if (!data.stale) return `<section aria-label="${escapeHtml(label)}"><h2>${label}</h2>${rows}</section>`;
    const detail = t('app.updateFailed', { error: data.error, time: formatClock(data.lastOkAt) });
    return `<section class="stale" aria-label="${escapeHtml(label)}">
      <h2>${label} <span class="badge" title="${escapeHtml(detail)}">&#9888; ${escapeHtml(t('app.stale'))}</span></h2>
      ${rows}
      <p class="stale-note">${escapeHtml(detail)}</p>
    </section>`;
  });

  content.innerHTML = sections.join('');
}

function escapeHtml(str) {
  return String(str).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

function renderUpdated() {
  updated.textContent = lastFetchedAt ? t('app.updated', { time: new Date(lastFetchedAt).toLocaleTimeString(lang) }) : '';
}

// Static text lives in index.html in English; this re-applies it in the
// current language.
function applyLanguage(next) {
  lang = next;
  t = createTranslator(lang);
  document.documentElement.lang = lang;
  refreshBtn.title = refreshBtn.ariaLabel = t('app.refresh');
  hideBtn.title = hideBtn.ariaLabel = t('app.hide');
  content.ariaLabel = t('app.region');
  if (lastResult) render(lastResult);
  else content.innerHTML = `<p class="empty">${escapeHtml(t('app.loading'))}</p>`;
  renderUpdated();
}

function refresh() {
  updated.textContent = t('app.refreshing');
  void window.agentUsage.refresh();
}

window.agentUsage.onUpdate(({ result, fetchedAt }) => {
  lastResult = result;
  lastFetchedAt = fetchedAt;
  render(result);
  renderUpdated();
});

refreshBtn.addEventListener('click', refresh);

hideBtn.addEventListener('click', () => {
  void window.agentUsage.hide();
});

// Keyboard: Esc hides the widget; F5 or Ctrl/Cmd+R refreshes.
document.addEventListener('keydown', (event) => {
  if (event.key === 'Escape') {
    void window.agentUsage.hide();
  } else if (event.key === 'F5' || ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'r')) {
    event.preventDefault();
    refresh();
  }
});

window.agentUsage.onLanguage(applyLanguage);

window.agentUsage.onLayout((mode) => {
  document.body.dataset.layout = mode;
});

window.agentUsage.requestLimits().then((result) => {
  if (result) {
    lastResult = result;
    render(result);
  }
});
