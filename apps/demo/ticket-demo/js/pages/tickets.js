/* ========================================
   pages/tickets.js — 工单列表(★ 可改)
   AI 可以:加字段列、加 Tab、加筛选、加搜索框
   ======================================== */

window.Pages = window.Pages || {};

window.Pages.tickets = function () {
  const tickets = window.TICKETS;
  const statusOf = (s) => window.CONFIG.statuses.find((x) => x.value === s);
  const priorityOf = (p) => window.CONFIG.priorities.find((x) => x.value === p);
  const categoryOf = (c) => window.CONFIG.categories.find((x) => x.value === c);

  return `
    <div class="page-header">
      <div>
        <div class="page-title">工单列表</div>
        <div class="page-subtitle">共 ${tickets.length} 条工单</div>
      </div>
      <a href="#/new-ticket" class="btn btn-primary">+ 新建工单</a>
    </div>

    <div class="card">
      <table>
        <thead>
          <tr>
            <th>ID</th>
            <th>标题</th>
            <th>状态</th>
            <th>优先级</th>
            <th>分类</th>
            <th>处理人</th>
            <th>创建时间</th>
          </tr>
        </thead>
        <tbody>
          ${tickets
            .map(
              (t) => `
            <tr onclick="location.hash='#/tickets/${t.id}'">
              <td><code>${t.id}</code></td>
              <td>${t.title}</td>
              <td><span class="tag ${statusOf(t.status)?.tagClass || ''}">${statusOf(t.status)?.label || t.status}</span></td>
              <td>${priorityOf(t.priority)?.label || t.priority}</td>
              <td>${categoryOf(t.category)?.label || t.category}</td>
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

// 详情页(单独路由)
window.Pages['ticket-detail'] = function (id) {
  const t = window.TICKETS.find((x) => x.id === id);
  if (!t) {
    return `
      <div class="card">
        <p>工单 ${id} 不存在</p>
        <a href="#/tickets" class="btn">← 返回列表</a>
      </div>
    `;
  }

  const statusOf = (s) => window.CONFIG.statuses.find((x) => x.value === s);
  const priorityOf = (p) => window.CONFIG.priorities.find((x) => x.value === p);
  const categoryOf = (c) => window.CONFIG.categories.find((x) => x.value === c);

  return `
    <div class="page-header">
      <div>
        <a href="#/tickets" style="font-size:12px;color:var(--text-secondary);text-decoration:none;">← 返回列表</a>
        <div class="page-title" style="margin-top:8px;">${t.title}</div>
        <div class="page-subtitle"><code>${t.id}</code> · ${t.createdAt}</div>
      </div>
    </div>

    <div class="card">
      <div style="display:grid;grid-template-columns:repeat(4,1fr);gap:16px;margin-bottom:20px;">
        <div>
          <div class="kpi-label">状态</div>
          <div style="margin-top:4px;"><span class="tag ${statusOf(t.status)?.tagClass || ''}">${statusOf(t.status)?.label || t.status}</span></div>
        </div>
        <div>
          <div class="kpi-label">优先级</div>
          <div style="margin-top:4px;font-weight:600;">${priorityOf(t.priority)?.label || t.priority}</div>
        </div>
        <div>
          <div class="kpi-label">分类</div>
          <div style="margin-top:4px;">${categoryOf(t.category)?.label || t.category}</div>
        </div>
        <div>
          <div class="kpi-label">处理人</div>
          <div style="margin-top:4px;font-weight:600;">${t.assignee}</div>
        </div>
      </div>

      <div style="border-top:1px solid var(--border);padding-top:16px;">
        <div class="kpi-label" style="margin-bottom:8px;">描述</div>
        <p style="line-height:1.7;">${t.description}</p>
      </div>
    </div>

    <div class="card">
      <h3 style="font-size:15px;font-weight:600;margin-bottom:12px;">处理记录</h3>
      <div style="font-size:13px;color:var(--text-secondary);">
        <div style="padding:8px 0;border-bottom:1px solid var(--border);">
          <strong style="color:var(--text);">张三</strong> · 创建工单
          <span style="float:right;">${t.createdAt}</span>
        </div>
        <div style="padding:8px 0;color:var(--text-secondary);">
          暂无更多记录
        </div>
      </div>
    </div>
  `;
};
