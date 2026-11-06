/* Additive AI workbench. Original chemistry, scoring and scene engines stay intact. */
(() => {
  'use strict';
  let dialog, previousFocus, openVersion = 0;
  let currentPage = 'predict';
  const pages = [
    ['overview', '研究总览'], ['predict', '气体预测'], ['properties', '材料性质'], ['screening', '批量筛选'],
    ['library', '材料库'], ['archive', '资料档案'], ['history', '预测记录'], ['models', '模型清单'], ['linked', '实验关联']
  ];
  const websitePages = [['overview', '研究总览'], ['library', '材料库'], ['archive', '数据表'], ['models', '模型清单'], ['predict', 'AI 计算服务']];
  let sameServer = false;
  const serviceReady = (async () => {
    if (!/^https?:$/.test(location.protocol) || location.hostname.endsWith('.github.io')) return false;
    try {
      const response = await fetch('/api/integration/status', {signal: AbortSignal.timeout(3500)});
      const data = response.ok && await response.json();
      return sameServer = data?.available === true && data?.chemistry_kernel === 'unchanged';
    } catch { return false; }
  })();
  async function api(path, options = {}) {
    const r = await fetch('/api' + path, options);
    const data = await r.json();
    if (!r.ok) throw new Error(data.detail || '服务暂时不可用');
    return data;
  }
  function close() {
    openVersion++;
    if (!dialog) return;
    dialog.querySelector('iframe')?.remove();
    dialog.remove(); dialog = null; previousFocus?.focus();
  }
  async function syncSnapshot() {
    if (!sameServer) { exportSnapshot(); return; }
    const status = dialog.querySelector('[data-ai-feedback]');
    try {
      const user = await api('/auth/me');
      const state = window.MOFApp?.getState();
      if (!state) throw new Error('实验室尚未准备就绪');
      const context = await api('/integration/contexts', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({experiment_id: `HKUST1-${state.startedAt}`, snapshot: {
          material: 'Cu-BTC / HKUST-1', step: state.step, demo: state.demo,
          weigh: state.weigh, solutions: state.solutions, reaction: state.reaction,
          separation: state.separation, washing: state.washing, activation: state.activation,
          characterization: state.characterization, errors: state.errors,
          processEvents: (state.opLog || []).slice(-300),
          source: '原实验室教学仿真状态', exportedAt: new Date().toISOString()
        }})
      });
      localStorage.setItem(`mof-ai-context:${user.id}`, context.id);
      status.textContent = '实验快照已同步，可在预测结果中关联本次实验';
    } catch (e) {
      status.textContent = /登录/.test(e.message) ? '请先在下方登录或注册，再点击同步' : e.message;
    }
  }
  function exportSnapshot() {
    const state = window.MOFApp?.getState();
    if (!state) return;
    const url = URL.createObjectURL(new Blob([JSON.stringify({schema:'mof-studio-experiment-v1',version:'2026.11.06',exportedAt:new Date().toISOString(),snapshot:state}, null, 2)], {type:'application/json'}));
    const link = document.createElement('a'); link.href = url; link.download = 'MOF-实验快照.json'; link.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
    if (dialog) dialog.querySelector('[data-ai-feedback]').textContent = '实验快照已导出到本机';
  }
  function selectPage(page, notify = true) {
    if (!dialog) return;
    if (!pages.some(([key]) => key === page)) return;
    currentPage = page;
    const activePage = !sameServer && ['properties', 'screening', 'history', 'linked'].includes(page) ? 'predict' : page;
    dialog.querySelectorAll('[data-ai-page]').forEach(button => {
      const active = button.dataset.aiPage === activePage;
      button.classList.toggle('active', active);
      button.setAttribute('aria-selected', String(active));
      button.tabIndex = active ? 0 : -1;
    });
    if (notify) dialog.querySelector('iframe')?.contentWindow?.postMessage({ type: 'mof-ai:navigate', page }, location.origin);
  }
  async function loadStatus() {
    const status = dialog.querySelector('[data-ai-summary]');
    if (!sameServer) {
      status.textContent = '网站材料与数据目录 · 真实 AI 推理由计算服务提供';
      return;
    }
    try {
      const data = await api('/integration/status');
      status.textContent = `${data.materials.toLocaleString()} 个结构 · ${data.archive_files.toLocaleString()} 项资料 · ${data.gas_models + data.property_models} 个已接入模型 · 本地 CPU 推理`;
    } catch {
      status.textContent = '实验室数据服务暂不可用';
    }
  }
  async function open(page = 'predict') {
    close(); previousFocus = document.activeElement;
    const version = openVersion;
    await serviceReady;
    if (version !== openVersion) return;
    currentPage = pages.some(([key]) => key === page) ? page : 'predict';
    dialog = document.createElement('section');
    dialog.className = 'studio-ai-dialog'; dialog.setAttribute('role', 'dialog');
    dialog.setAttribute('aria-modal', 'true'); dialog.setAttribute('aria-label', '材料数据与 AI 预测工作台');
    const tabs = sameServer ? pages : websitePages;
    const http = /^https?:$/.test(location.protocol);
    const frameUrl = sameServer ? `/ai/?page=${encodeURIComponent(currentPage)}${currentPage === 'predict' ? '&material=studio-hkust1' : ''}` : `research/index.html?page=${encodeURIComponent(currentPage)}`;
    dialog.innerHTML = `<header><div class="studio-ai-title"><div><b>材料研究工作台</b><small data-ai-feedback>保留当前实验进度 · 预测使用参考或导入晶体</small></div><button data-ai-close aria-label="返回三维实验室">返回实验室 ×</button></div>
      <nav class="studio-ai-nav" role="tablist" aria-label="研究模块">${tabs.map(([key, label]) => `<button type="button" role="tab" data-ai-page="${key}" aria-selected="${currentPage === key}" class="${currentPage === key ? 'active' : ''}">${label}</button>`).join('')}</nav>
      <div class="studio-ai-meta"><span data-ai-summary>正在读取资料索引…</span><button type="button" data-ai-sync>${sameServer ? '同步当前实验记录' : '导出当前实验记录'}</button></div></header>
      ${http ? `<iframe title="AI 材料研究工作台" src="${frameUrl}"></iframe>` : '<div class="studio-ai-offline">请双击工程中的「启动AI实验室.cmd」打开材料库与 AI 计算工作台。<p><a href="http://127.0.0.1:8001/" target="_blank" rel="noopener">打开本机完整实验室 ↗</a></p></div>'}`;
    document.body.append(dialog);
    if (dialog.querySelector('iframe')) dialog.querySelector('iframe').onload = () => selectPage(currentPage);
    dialog.querySelector('[data-ai-close]').onclick = close;
    dialog.querySelector('[data-ai-sync]').onclick = syncSnapshot;
    dialog.querySelectorAll('[data-ai-page]').forEach(button => button.onclick = () => selectPage(button.dataset.aiPage));
    dialog.querySelector('.studio-ai-nav').onkeydown = event => {
      if (!['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)) return;
      const tabs = [...dialog.querySelectorAll('[data-ai-page]:not(:disabled)')];
      if (!tabs.length) return;
      event.preventDefault();
      const index = tabs.indexOf(document.activeElement);
      const next = event.key === 'Home' ? 0 : event.key === 'End' ? tabs.length - 1 : (index + (event.key === 'ArrowRight' ? 1 : -1) + tabs.length) % tabs.length;
      tabs[next].click(); tabs[next].focus();
    };
    dialog.querySelector('[data-ai-close]').focus();
    loadStatus();
  }
  function init() {
    const tools = document.querySelector('.camera-tools');
    if (tools) {
      const b = document.createElement('button'); b.id = 'aiWorkbenchBtn';
      b.className = 'studio-ai-entry'; b.textContent = 'AI 预测 / 数据'; b.onclick = () => open(); tools.append(b);
    }
    const intro = document.querySelector('.intro-buttons');
    if (intro) {
      const b = document.createElement('button'); b.className = 'secondary-btn';
      b.id = 'introAIBtn'; b.textContent = '材料库与 AI 预测'; b.onclick = () => open('overview'); intro.append(b);
    }
    document.addEventListener('keydown', e => {
      if (e.key === 'Escape' && dialog) {e.stopImmediatePropagation();close();}
      if (e.key === 'Tab' && dialog) {
        const buttons = [...dialog.querySelectorAll('button:not(:disabled),iframe')];
        if (e.shiftKey && document.activeElement === buttons[0]) {e.preventDefault();buttons.at(-1).focus();}
        else if (!e.shiftKey && document.activeElement === buttons.at(-1)) {e.preventDefault();buttons[0].focus();}
      }
    }, true);
  }
  window.MOFAI = {open, close, syncSnapshot, exportSnapshot};
  window.addEventListener('message', event => {
    if (event.origin !== location.origin || !dialog || event.source !== dialog.querySelector('iframe')?.contentWindow) return;
    if (event.data?.type === 'mof-ai:page') selectPage(event.data.page, false);
  });
  document.addEventListener('DOMContentLoaded', init);
})();
