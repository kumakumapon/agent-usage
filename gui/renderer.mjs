const TOOL_LABEL = { claude: 'Claude Code', codex: 'Codex CLI', antigravity: 'Antigravity' };

const content = document.getElementById('content');
const updated = document.getElementById('updated');
const refreshBtn = document.getElementById('refresh');
const hideBtn = document.getElementById('hide');

function levelClass(percent) {
  if (percent >= 90) return 'lvl-crit';
  if (percent >= 70) return 'lvl-warn';
  return 'lvl-ok';
}

function formatUntil(iso) {
  if (!iso) return '';
  const target = new Date(iso);
  if (Number.isNaN(target.getTime())) return '';
  const diffMs = target.getTime() - Date.now();
  if (diffMs <= 0) return 'resets soon';
  const mins = Math.round(diffMs / 60000);
  if (mins < 60) return `resets in ${mins}m`;
  const hours = Math.round(mins / 60);
  if (hours < 48) return `resets in ${hours}h`;
  return `resets in ${Math.round(hours / 24)}d`;
}

function render(result) {
  if (!result || Object.keys(result).length === 0) {
    content.innerHTML = '<p class="empty">No tools enabled — right-click the tray icon to pick one.</p>';
    return;
  }

  const sections = Object.entries(result).map(([tool, data]) => {
    const label = TOOL_LABEL[tool] || tool;
    if (data?.error) {
      return `<section><h2>${label}</h2><p class="error">${escapeHtml(data.error)}</p></section>`;
    }
    if (!data?.windows?.length) {
      return `<section><h2>${label}</h2><p class="empty">no data</p></section>`;
    }
    const rows = data.windows
      .map((w) => {
        const pct = typeof w.percent === 'number' ? w.percent : 0;
        return `
          <div class="row">
            <div class="row-label">
              <span>${escapeHtml(w.window)}</span>
              <span class="pct">${w.percent ?? '?'}%</span>
            </div>
            <div class="bar ${levelClass(pct)}"><span style="width:${Math.min(100, Math.max(0, pct))}%"></span></div>
            <div class="row-label"><span></span><span class="resets">${formatUntil(w.resetsAt)}</span></div>
          </div>`;
      })
      .join('');
    return `<section><h2>${label}</h2>${rows}</section>`;
  });

  content.innerHTML = sections.join('');
}

function escapeHtml(str) {
  return String(str).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

window.agentUsage.onUpdate(({ result, fetchedAt }) => {
  render(result);
  updated.textContent = `updated ${new Date(fetchedAt).toLocaleTimeString()}`;
});

refreshBtn.addEventListener('click', () => {
  updated.textContent = 'refreshing…';
  void window.agentUsage.refresh();
});

hideBtn.addEventListener('click', () => {
  void window.agentUsage.hide();
});

window.agentUsage.requestLimits().then((result) => {
  if (result) render(result);
});
