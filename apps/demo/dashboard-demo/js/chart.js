/* ========================================
   chart.js — 柱状图 + 折线图 + 环形图(native canvas,无依赖)
   左:最近 7 天订单柱状图 + 折线趋势叠加
   右:渠道占比环形图(新增可视化)
   ======================================== */

window.renderChart = function () {
  const canvas = document.getElementById('chart-canvas');
  if (!canvas) return;

  const ctx = canvas.getContext('2d');
  const data = window.CHART_DATA;
  const share = window.SHARE_DATA || [];
  const w = canvas.width;
  const h = canvas.height;

  // 清除
  ctx.fillStyle = '#131938';
  ctx.fillRect(0, 0, w, h);

  // ---------- 左侧:柱状图(最近 7 天订单) ----------
  const maxVal = Math.max(...data.map((d) => d.value));
  const padding = 40;
  const chartW = 480 - padding * 2;
  const chartH = h - padding * 2;
  const barW = chartW / data.length - 14;

  // 网格线 + 纵轴刻度值(补充统计读数)
  ctx.strokeStyle = 'rgba(0, 212, 255, 0.1)';
  ctx.lineWidth = 1;
  for (let i = 0; i <= 4; i++) {
    const y = padding + (chartH / 4) * i;
    ctx.beginPath();
    ctx.moveTo(padding, y);
    ctx.lineTo(padding + chartW, y);
    ctx.stroke();
    ctx.fillStyle = 'rgba(156, 163, 175, 0.75)';
    ctx.font = '10px sans-serif';
    ctx.textAlign = 'right';
    ctx.fillText(Math.round(maxVal - (maxVal / 4) * i).toLocaleString(), padding - 6, y + 3);
  }

  // 汇总统计:峰值 / 均值 / 环比(画在柱状区顶部)
  const total = data.reduce((s, d) => s + d.value, 0);
  const avg = Math.round(total / data.length);
  const peak = data.reduce((a, b) => (b.value > a.value ? b : a), data[0]);
  const last = data[data.length - 1];
  const prev = data[data.length - 2];
  const wow = prev.value ? (((last.value - prev.value) / prev.value) * 100).toFixed(1) : '0.0';
  ctx.textAlign = 'left';
  ctx.font = '11px sans-serif';
  ctx.fillStyle = '#9ca3af';
  ctx.fillText(`峰值 ${peak.label} ${peak.value.toLocaleString()}`, padding, 16);
  ctx.fillStyle = '#00d4ff';
  ctx.fillText(`7日均值 ${avg.toLocaleString()}`, padding + 150, 16);
  ctx.fillStyle = Number(wow) >= 0 ? '#10b981' : '#ef4444';
  ctx.fillText(`昨日环比 ${Number(wow) >= 0 ? '+' : ''}${wow}%`, padding + 260, 16);

  data.forEach((d, i) => {
    const x = padding + (chartW / data.length) * i + 7;
    const barH = (d.value / maxVal) * chartH;
    const y = padding + chartH - barH;

    // 渐变
    const grad = ctx.createLinearGradient(0, y, 0, y + barH);
    grad.addColorStop(0, '#00d4ff');
    grad.addColorStop(1, '#10b981');

    ctx.fillStyle = grad;
    ctx.fillRect(x, y, barW, barH);

    // 底部日期标签
    ctx.fillStyle = '#9ca3af';
    ctx.font = '12px sans-serif';
    ctx.textAlign = 'center';
    ctx.fillText(d.label, x + barW / 2, h - padding + 20);
  });

  // ---------- 折线叠加(最近 7 天订单趋势) ----------
  const pts = data.map((d, i) => ({
    x: padding + (chartW / data.length) * i + 7 + barW / 2,
    y: padding + chartH - (d.value / maxVal) * chartH,
  }));

  // 折线下方渐变面积
  const lineGrad = ctx.createLinearGradient(0, padding, 0, padding + chartH);
  lineGrad.addColorStop(0, 'rgba(251, 191, 36, 0.22)');
  lineGrad.addColorStop(1, 'rgba(251, 191, 36, 0)');
  ctx.beginPath();
  ctx.moveTo(pts[0].x, padding + chartH);
  pts.forEach((p) => ctx.lineTo(p.x, p.y));
  ctx.lineTo(pts[pts.length - 1].x, padding + chartH);
  ctx.closePath();
  ctx.fillStyle = lineGrad;
  ctx.fill();

  // 折线
  ctx.beginPath();
  pts.forEach((p, i) => (i === 0 ? ctx.moveTo(p.x, p.y) : ctx.lineTo(p.x, p.y)));
  ctx.strokeStyle = '#fbbf24';
  ctx.lineWidth = 2;
  ctx.lineJoin = 'round';
  ctx.stroke();

  // 数据点 + 顶部数值标注
  pts.forEach((p, i) => {
    ctx.beginPath();
    ctx.arc(p.x, p.y, 3.5, 0, Math.PI * 2);
    ctx.fillStyle = '#0a0e27';
    ctx.fill();
    ctx.strokeStyle = '#fbbf24';
    ctx.lineWidth = 2;
    ctx.stroke();

    ctx.fillStyle = '#fbbf24';
    ctx.font = '10px sans-serif';
    ctx.textAlign = 'center';
    ctx.fillText(data[i].value.toLocaleString(), p.x, p.y - 8);
  });

  // ---------- 分隔线 ----------
  ctx.strokeStyle = 'rgba(0, 212, 255, 0.08)';
  ctx.beginPath();
  ctx.moveTo(530, padding);
  ctx.lineTo(530, h - padding);
  ctx.stroke();

  // ---------- 右侧:环形图(渠道占比) ----------
  if (!share.length) return;

  const cx = 610;
  const cy = h / 2;
  const rOuter = 62;
  const thickness = 22;
  const colors = ['#00d4ff', '#10b981', '#fbbf24', '#ef4444', '#a78bfa'];

  // 按实际占比总和归一化(自动刷新会让各值浮动,总和未必还是 100)
  const shareTotal = share.reduce((s, d) => s + d.value, 0) || 1;

  let start = -Math.PI / 2;
  share.forEach((s, i) => {
    const angle = (s.value / shareTotal) * Math.PI * 2;
    ctx.beginPath();
    ctx.arc(cx, cy, rOuter - thickness / 2, start, start + angle);
    ctx.lineWidth = thickness;
    ctx.lineCap = 'butt';
    ctx.strokeStyle = colors[i % colors.length];
    ctx.stroke();
    start += angle;
  });

  // 环心文案
  ctx.textAlign = 'center';
  ctx.fillStyle = '#e5e7eb';
  ctx.font = 'bold 16px sans-serif';
  ctx.fillText('渠道', cx, cy - 4);
  ctx.fillStyle = '#9ca3af';
  ctx.font = '12px sans-serif';
  ctx.fillText('占比', cx, cy + 14);

  // 图例
  const legendX = 700;
  ctx.textAlign = 'left';
  share.forEach((s, i) => {
    const y = cy - 45 + i * 30;
    ctx.fillStyle = colors[i % colors.length];
    ctx.fillRect(legendX, y - 8, 10, 10);
    ctx.fillStyle = '#9ca3af';
    ctx.font = '12px sans-serif';
    ctx.fillText(s.label, legendX + 16, y);
    ctx.fillStyle = '#e5e7eb';
    ctx.fillText(Math.round((s.value / shareTotal) * 100) + '%', legendX + 16, y + 14);
  });
};
