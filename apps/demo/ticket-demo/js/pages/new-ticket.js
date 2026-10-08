/* ========================================
   pages/new-ticket.js — 新建工单表单(★ 可改字段)
   AI 可以:加新字段、改下拉选项、调整布局
   ======================================== */

window.Pages = window.Pages || {};

window.Pages['new-ticket'] = function () {
  const statuses = window.CONFIG.statuses;
  const priorities = window.CONFIG.priorities;
  const categories = window.CONFIG.categories;

  return `
    <div class="page-header">
      <div>
        <div class="page-title">新建工单</div>
        <div class="page-subtitle">填写工单信息</div>
      </div>
    </div>

    <div class="card">
      <form id="new-ticket-form" onsubmit="event.preventDefault(); alert('演示版本不持久化');">
        <div class="form-group">
          <label class="form-label">标题 *</label>
          <input type="text" class="form-input" placeholder="简短描述问题" required />
        </div>

        <div class="form-group">
          <label class="form-label">描述 *</label>
          <textarea class="form-textarea" placeholder="详细描述..." required></textarea>
        </div>

        <div style="display:grid;grid-template-columns:1fr 1fr 1fr;gap:16px;">
          <div class="form-group">
            <label class="form-label">分类</label>
            <select class="form-select">
              ${categories.map((c) => `<option value="${c.value}">${c.label}</option>`).join('')}
            </select>
          </div>

          <div class="form-group">
            <label class="form-label">优先级</label>
            <select class="form-select">
              ${priorities.map((p) => `<option value="${p.value}">${p.label}</option>`).join('')}
            </select>
          </div>

          <div class="form-group">
            <label class="form-label">初始状态</label>
            <select class="form-select">
              ${statuses.map((s) => `<option value="${s.value}">${s.label}</option>`).join('')}
            </select>
          </div>
        </div>

        <div class="form-group">
          <label class="form-label">处理人</label>
          <input type="text" class="form-input" placeholder="姓名" />
        </div>

        <div style="display:flex;gap:8px;justify-content:flex-end;margin-top:24px;">
          <a href="#/tickets" class="btn">取消</a>
          <button type="submit" class="btn btn-primary">提交</button>
        </div>
      </form>
    </div>
  `;
};
