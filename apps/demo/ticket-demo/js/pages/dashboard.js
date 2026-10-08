/* ========================================
   pages/dashboard.js — 概览页(可改 KPI 内容)
   ======================================== */

window.Pages = window.Pages || {};

window.Pages.dashboard = function () {
  const tickets = window.TICKETS;
  const total = tickets.length;
  const pending = tickets.filter((t) => t.status === 'pending').length;
  const progress = tickets.filter((t) => t.status === 'progress').length;
  const done = tickets.filter((t) => t.status === 'done' || t.status === 'closed').length;

  // 最近 5 条
  const recent = [...tickets]
    .sort((a, b) => (a.createdAt > b.createdAt ? -1 : 1))
    .slice(0, 5);

  const statusOf = (s) => window.CONFIG.statuses.find((x) => x.value === s);
  const priorityOf = (p) => window.CONFIG.priorities.find((x) => x.value === p);

  return `
    <div class="page-header">
      <div>
        <div class="page-title">概览</div>
        <div class="page-subtitle">系统数据一览</div>
      </div>
    </div>

    <div class="kpi-grid">
      <div class="kpi-card">
        <div class="kpi-label">工单总数</div>
        <div class="kpi-value">${total}</div>
        <div class="kpi-change">↑ 12% 较上周</div>
      </div>
      <div class="kpi-card">
        <div class="kpi-label">待办</div>
        <div class="kpi-value">${pending}</div>
        <div class="kpi-change">需处理</div>
      </div>
      <div class="kpi-card">
        <div class="kpi-label">处理中</div>
        <div class="kpi-value">${progress}</div>
        <div class="kpi-change">进行中</div>
      </div>
      <div class="kpi-card">
        <div class="kpi-label">已完成</div>
        <div class="kpi-value">${done}</div>
        <div class="kpi-change">✓ ${Math.round((done / total) * 100)}%</div>
      </div>
    </div>

    <div class="card">
      <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:16px;">
        <h3 style="font-size:15px;font-weight:600;">最近工单</h3>
        <a href="#/tickets" class="btn">查看全部 →</a>
      </div>
      <table>
        <thead>
          <tr>
            <th>ID</th>
            <th>标题</th>
            <th>状态</th>
            <th>优先级</th>
            <th>处理人</th>
            <th>创建时间</th>
          </tr>
        </thead>
        <tbody>
          ${recent
            .map(
              (t) => `
            <tr onclick="location.hash='#/tickets/${t.id}'">
              <td><code>${t.id}</code></td>
              <td>${t.title}</td>
              <td><span class="tag ${statusOf(t.status)?.tagClass || ''}">${statusOf(t.status)?.label || t.status}</span></td>
              <td>${priorityOf(t.priority)?.label || t.priority}</td>
              <td>${t.assignee}</td>
              <td>${t.createdAt}</td>
            </tr>
          `,
            )
            .join('')}
        </tbody>
      </table>
    </div>
  `;
};
