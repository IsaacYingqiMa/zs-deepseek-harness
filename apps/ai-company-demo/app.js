// AI Company Demo · 国企风对话 + 沙盘演示
// ───────────────────────────────────────────────────────────────────

// ── Role definitions ──────────────────────────────────────────────────
const ROLE_DATA = {
  chairman:  { name: '董事长', nick: '董事长', role: '战略层', color: '#7c3aed', initials: '董', desk: { x: 18, y: 28 } },
  gm:        { name: '总经理', nick: '总经理', role: '执行层', color: '#2563eb', initials: '总', desk: { x: 50, y: 28 } },
  cto:       { name: 'CTO',    nick: 'CTO',    role: '技术层', color: '#059669', initials: 'C', desk: { x: 82, y: 28 } },
  pm:        { name: 'PM',     nick: 'PM',     role: '产品层', color: '#f97316', initials: 'P', desk: { x: 14, y: 82 } },
  designer:  { name: '设计师', nick: '设计师', role: 'BU 团队', color: '#ec4899', initials: '设', desk: { x: 36, y: 82 } },
  dev:       { name: '研发',   nick: '研发',   role: 'BU 团队', color: '#0891b2', initials: '研', desk: { x: 64, y: 82 } },
  tester:    { name: '测试',   nick: '测试',   role: 'BU 团队', color: '#d97706', initials: '测', desk: { x: 86, y: 82 } },
};

const MEETING_POSITIONS = [
  { x: 50, y: 44 }, // north
  { x: 64, y: 50 }, // northeast
  { x: 64, y: 62 }, // southeast
  { x: 36, y: 62 }, // southwest
  { x: 36, y: 50 }, // northwest
];

// ── Runtime state ────────────────────────────────────────────────────
const state = {
  running: false,
  paused: false,
  startedAt: 0,
  pausedAt: 0,
  pausedElapsed: 0,
  decisions: 0,
  messages: 0,
};

const conversations = [];
let activeConversationId = null;
const deliverables = [];

// ── DOM refs ───────────────────────────────────────────────────────────
const $ = (sel, root) => (root || document).querySelector(sel);
const convListEl = $('#conv-list');
const chatMessagesEl = $('#chat-messages'); // legacy (unused now)
const chatTitleEl = $('#chat-title'); // legacy
const chatSubtitleEl = $('#chat-subtitle'); // legacy
const activityListEl = $('#activity-list');
const activityCountEl = $('#activity-count');
const delivListEl = $('#deliv-list');
const elapsedEl = $('#elapsed');
const decisionCountEl = $('#decision-count');
const convCountEl = $('#conv-count');
const activeCountEl = $('#active-count');
const convTotalEl = $('#conv-total');
const delivTotalEl = $('#deliv-total');
const meetingCountEl = $('#meeting-count');
const meetingTableEl = $('#meeting-table');
const meetingTopicEl = $('#meeting-topic');
const meetingTopicTextEl = $('#meeting-topic-text');
const detailPanel = $('#character-detail');

const CHECK_MARK = String.fromCharCode(0x2713);

function formatTime(ms) {
  const s = Math.floor(ms / 1000);
  return String(Math.floor(s / 60)).padStart(2, '0') + ':' + String(s % 60).padStart(2, '0');
}

function now() {
  if (!state.startedAt) return 0;
  if (state.paused) return state.pausedAt - state.startedAt - state.pausedElapsed;
  return Date.now() - state.startedAt - state.pausedElapsed;
}

function tick() {
  if (state.running) {
    elapsedEl.textContent = formatTime(Math.max(0, now()));
    if (!state.paused) {
      dispatchScriptEvents();
      // Keep active speech bubbles anchored to their character
      refreshBubbles();
    }
    requestAnimationFrame(tick);
  }
}

// ── Character management ───────────────────────────────────────────────
function spawnCharacter(role) {
  const el = $('#char-' + role);
  if (!el) return;
  el.classList.remove('hidden');
  const roleData = ROLE_DATA[role];
  el.style.left = roleData.desk.x + '%';
  el.style.top = roleData.desk.y + '%';
  el.classList.add('spawning');
  setTimeout(() => el.classList.remove('spawning'), 800);
  updateActiveCount();
}

function moveCharacter(role, x, y) {
  const el = $('#char-' + role);
  if (!el) return;
  el.style.left = x + '%';
  el.style.top = y + '%';
}

function setState(role, s) {
  const el = $('#char-' + role);
  if (!el) return;
  el.dataset.state = s;
  // Toggle desk active glow
  const deskEl = $('#desk-' + role);
  if (deskEl) deskEl.classList.toggle('active', s === 'talking' || s === 'walking');
  updateActiveCount();
}

function updateActiveCount() {
  const actives = $$('.character:not(.hidden)').filter(el =>
    el.dataset.state !== 'idle' && el.dataset.state !== 'done'
  ).length;
  activeCountEl.textContent = actives;
}

// ── Head bubble ────────────────────────────────────────────────────────
// 气泡是 .character 的子元素，用 position: absolute 自然跟随角色移动
const activeBubbles = new Map(); // role -> element

function positionBubble(role) {
  // no-op: 气泡 CSS 已是 absolute，跟随 .character 的 left/top transition 自动移动
}

function showHeadBubble(role, text, type, durationMs) {
  const charEl = $('#char-' + role);
  const el = $('#char-' + role + ' .head-bubble');
  if (!charEl || !el) return;
  el.textContent = text;
  el.className = 'head-bubble show ' + (type || '');
  activeBubbles.set(role, el);
  clearTimeout(el._timer);
  el._timer = setTimeout(function () {
    el.classList.remove('show');
    activeBubbles.delete(role);
  }, durationMs || 4000);
}

// Keep bubbles following characters when they move
function refreshBubbles() {
  // no-op: 气泡自然跟随角色，保留函数以兼容旧调用
}

// Hook into the global tick so bubbles follow character motion
// (integrated directly into tick() above)

// ── Meeting room ───────────────────────────────────────────────────────
const meetingMembers = new Set();

function joinMeeting(role) {
  if (!meetingMembers.has(role)) {
    meetingMembers.add(role);
    const idx = meetingMembers.size - 1;
    if (idx < MEETING_POSITIONS.length) {
      moveCharacter(role, MEETING_POSITIONS[idx].x, MEETING_POSITIONS[idx].y);
    }
  }
  updateMeetingDisplay();
}

function leaveMeeting(role) {
  if (meetingMembers.has(role)) {
    meetingMembers.delete(role);
    const remaining = Array.from(meetingMembers);
    remaining.forEach((r, idx) => {
      if (idx < MEETING_POSITIONS.length) {
        moveCharacter(r, MEETING_POSITIONS[idx].x, MEETING_POSITIONS[idx].y);
      }
    });
  }
  updateMeetingDisplay();
}

function updateMeetingDisplay() {
  const count = meetingMembers.size;
  meetingCountEl.textContent = count === 0 ? '空' : count + ' 人';
  meetingTableEl.classList.toggle('active', count > 0);
}

// 显示/隐藏会议室议题浮卡
function setMeetingTopic(topic, icon) {
  if (!topic) {
    meetingTopicEl.style.display = 'none';
    return;
  }
  meetingTopicEl.style.display = 'block';
  meetingTopicEl.querySelector('.topic-icon').textContent = icon || '📋';
  meetingTopicTextEl.textContent = topic;
}

// ── Conversation system ───────────────────────────────────────────────
function findOrCreateConversation(fromRole, toRole, type) {
  const sortedKey = [fromRole, toRole].sort().join('-');
  for (let i = 0; i < conversations.length; i++) {
    const c = conversations[i];
    if (type === 'meeting' && c.type === 'meeting') {
      if (c.participants.indexOf(fromRole) >= 0 && c.participants.indexOf(toRole) >= 0) {
        return c.id;
      }
    } else if (type === '1on1' && c.type === '1on1') {
      const cKey = c.participants.slice().sort().join('-');
      if (cKey === sortedKey) return c.id;
    }
  }
  const id = 'c-' + (conversations.length + 1);
  const participants = type === 'meeting'
    ? Array.from(new Set([fromRole, toRole]))
    : [fromRole, toRole];
  const conv = {
    id: id,
    type: type,
    title: type === 'meeting' ? '会议室 · 团队讨论' : participants.map(r => ROLE_DATA[r].name).join(' ↔ '),
    participants: participants,
    messages: [],
    unread: 0,
    lastActivity: now(),
  };
  conversations.push(conv);
  renderConversationList();
  return id;
}

function addMessage(convId, fromRole, text, t) {
  const conv = conversations.find(c => c.id === convId);
  if (!conv) return;
  const ts = t || now();
  // 去重保护：同 conv 的最后一条消息如果 from+text+ts 完全相同，则跳过
  const last = conv.messages[conv.messages.length - 1];
  if (last && last.from === fromRole && last.text === text && last.t === ts) {
    return;
  }
  conv.messages.push({ from: fromRole, text: text, t: ts });
  conv.lastActivity = ts;
  state.messages += 1;
  convCountEl.textContent = state.messages;
  if (activeConversationId === convId) {
    // (chat panel removed; only floating windows show messages)
  } else {
    conv.unread += 1;
    renderConversationList();
  }
  // Append to activity stream (always shown)
  appendActivityRow(fromRole, text, ts);
  // Also update any open floating chat windows
  if (typeof refreshFloatingChatMessages === 'function') {
    refreshFloatingChatMessages();
  }
}

function appendActivityRow(fromRole, text, t) {
  if (!activityListEl) return;
  // 去重保护：如果当前第一条 activity-row 与新消息内容相同，不重复插入
  const first = activityListEl.firstElementChild;
  if (first) {
    const firstActor = first.querySelector('.actor');
    const firstText = first.querySelector('.text');
    const firstTime = first.querySelector('.time');
    if (firstActor && firstText && firstTime
        && firstActor.textContent === ROLE_DATA[fromRole].name
        && firstText.textContent === (text.length > 60 ? text.substring(0, 60) + '...' : text)
        && firstTime.textContent === formatTime(t)) {
      return;
    }
  }
  const div = document.createElement('div');
  div.className = 'activity-row';
  const roleData = ROLE_DATA[fromRole];
  const preview = text.length > 60 ? text.substring(0, 60) + '...' : text;
  div.innerHTML =
    '<span class="actor">' + roleData.name + '</span>' +
    '<span class="text">' + escapeHtml(preview) + '</span>' +
    '<span class="time">' + formatTime(t) + '</span>';
  activityListEl.insertBefore(div, activityListEl.firstChild);
  // Trim to 20 items
  while (activityListEl.children.length > 20) {
    activityListEl.removeChild(activityListEl.lastChild);
  }
  // Update count
  if (activityCountEl) {
    const total = activityListEl.querySelectorAll('.activity-row').length;
    activityCountEl.textContent = '(' + total + ')';
  }
  // Auto-scroll to top
  activityListEl.scrollTop = 0;
}

function renderConversationList() {
  convListEl.innerHTML = '';
  conversations.forEach(conv => {
    const item = document.createElement('div');
    item.className = 'conv-item';
    if (conv.id === activeConversationId) item.classList.add('active');
    item.dataset.id = conv.id;
    item.dataset.type = conv.type;
    const lastMsg = conv.messages[conv.messages.length - 1];
    const preview = lastMsg ? lastMsg.text.substring(0, 30) + (lastMsg.text.length > 30 ? '...' : '') : '等待对话...';
    item.innerHTML =
      '<div class="conv-avatar">' + (conv.type === 'meeting' ? '🏢' : '💬') + '</div>' +
      '<div class="conv-content">' +
        '<div class="conv-title">' + escapeHtml(conv.title) + '</div>' +
        '<div class="conv-preview">' + escapeHtml(preview) + '</div>' +
      '</div>' +
      (conv.unread > 0 ? '<div class="conv-badge">' + conv.unread + '</div>' : '');
    item.addEventListener('click', function () { openFloatingChat(conv.id); });
    convListEl.appendChild(item);
  });
  convTotalEl.textContent = '(' + conversations.length + ')';
}

function switchConversation(convId) {
  activeConversationId = convId;
  const conv = conversations.find(c => c.id === convId);
  if (!conv) return;
  conv.unread = 0;
  // (chat panel removed; conversation view handled by floating chat window)
  renderConversationList();
}

function appendMessageToChat(fromRole, text, t) {
  const div = document.createElement('div');
  div.className = 'message';
  const roleData = ROLE_DATA[fromRole];
  const conv = conversations.find(c => c.id === activeConversationId);
  let isSelf = false;
  if (conv) isSelf = conv.participants[0] === fromRole;
  if (isSelf) div.classList.add('from-self');
  div.innerHTML =
    '<div class="msg-avatar" style="background:' + roleData.color + '">' + roleData.initials + '</div>' +
    '<div class="msg-body">' +
      '<div class="msg-name">' + roleData.name + '</div>' +
      '<div class="msg-bubble">' + escapeHtml(text) + '</div>' +
      '<div class="msg-time">' + formatTime(t) + '</div>' +
    '</div>';
  // (legacy chat panel removed; only floating windows are used now)
}

function escapeHtml(s) {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

// ── Communication 接口 ──────────────────────────────────────────────────
// 新流程：发起方走到目标工位 → 双方对话 → 发起方回自己工位
//   约定：toRole 不移动（保留"上级"或"主人"位置感）；fromRole 移动
//   例外：如果是 GM→董事长、GM 推 CTO 来、CTO→GM 汇报等，按场景传 opts
function sendMessage1on1(fromRole, toRole, text, t, opts) {
  opts = opts || {};
  // 自动推断：如果 fromStaysAtHome 为 true 且没显式设 fromReturnsHome，
  // 则也跳过 returnHome（既然发起方不走来，也就不必走回）
  if (opts.fromStaysAtHome && opts.fromReturnsHome === undefined) {
    opts = Object.assign({}, opts, { fromReturnsHome: false });
  }
  const convId = findOrCreateConversation(fromRole, toRole, '1on1');
  addMessage(convId, fromRole, text, t);
  if (activeConversationId !== convId) switchConversation(convId);

  // 移动：发起方走到接收方工位（如果 opts.fromStaysAtHome=true，则不动）
  if (!opts.fromStaysAtHome) {
    walkTo(fromRole, toRole);
  }

  // 用 speakingId 防止后到的覆盖前面
  const speakingId = (sendMessage1on1._id = (sendMessage1on1._id || 0) + 1);
  setTimeout(() => {
    if (speakingId !== sendMessage1on1._id) return;
    setState(fromRole, 'talking');
    setState(toRole, 'thinking');
    showHeadBubble(fromRole, text, 'talking', 4500);
  }, 1400);
  setTimeout(() => {
    if (speakingId !== sendMessage1on1._id) return;
    setState(fromRole, 'idle');
    setState(toRole, 'idle');
    // 发起方回自己工位（如果 opts.fromReturnsHome !== false）
    if (opts.fromReturnsHome !== false) {
      returnHome(fromRole);
    } else {
      // 不回工位（保持在 toRole 工位，例如 CTO 待在 GM 工位汇报）
      // 不动
    }
  }, 5500);
}

function sendMessageInMeeting(fromRole, text, t) {
  let convId = null;
  for (let i = 0; i < conversations.length; i++) {
    if (conversations[i].type === 'meeting' &&
        conversations[i].participants.indexOf(fromRole) >= 0) {
      convId = conversations[i].id;
      break;
    }
  }
  if (!convId) {
    const participants = Array.from(meetingMembers);
    if (participants.indexOf(fromRole) < 0) participants.push(fromRole);
    convId = 'c-meeting-' + Date.now();
    conversations.push({
      id: convId,
      type: 'meeting',
      title: '会议室 · ' + participants.map(r => ROLE_DATA[r].name).join(' · ') + ' 讨论',
      participants: participants,
      messages: [],
      unread: 0,
      lastActivity: now(),
    });
    renderConversationList();
  }
  addMessage(convId, fromRole, text, t);
  if (activeConversationId !== convId) switchConversation(convId);
  setState(fromRole, 'talking');
  showHeadBubble(fromRole, text, 'talking', 4500);
  setTimeout(() => setState(fromRole, 'idle'), 4000);
}

function walkToDesk(role, targetRole) {
  // 走到对方工位旁边（站在对方朝向自己来的方向）
  const targetDesk = ROLE_DATA[targetRole].desk;
  const roleDesk = ROLE_DATA[role].desk;
  let dx = 0, dy = 0;
  if (roleDesk.x < targetDesk.x) dx = -7;
  else if (roleDesk.x > targetDesk.x) dx = 7;
  if (roleDesk.y < targetDesk.y) dy = -5;
  else if (roleDesk.y > targetDesk.y) dy = 5;
  if (Math.abs(roleDesk.y - targetDesk.y) < 5) {
    dx = roleDesk.x < targetDesk.x ? -7 : 7;
    dy = 0;
  }
  setState(role, 'walking');
  moveCharacter(role, targetDesk.x + dx, targetDesk.y + dy);
  setTimeout(() => setState(role, 'idle'), 1500);
}

// 新 API: 走到对方工位（左/右位置由 side 参数决定，避免多人重叠）
// side: 'left' | 'right' | 'auto'
function walkTo(role, targetRole, side) {
  const targetDesk = ROLE_DATA[targetRole].desk;
  let dx = 0, dy = 0;
  if (side === 'left') dx = -7;
  else if (side === 'right') dx = 7;
  else {
    // auto：根据访问者自己的工位判断站哪边
    const myDesk = ROLE_DATA[role].desk;
    if (myDesk.x < targetDesk.x) dx = -7;
    else if (myDesk.x > targetDesk.x) dx = 7;
  }
  // 上下方向
  const myDesk = ROLE_DATA[role].desk;
  if (myDesk.y < targetDesk.y) dy = -5;
  else if (myDesk.y > targetDesk.y) dy = 5;
  if (Math.abs(myDesk.y - targetDesk.y) < 5) dy = 0;

  setState(role, 'walking');
  moveCharacter(role, targetDesk.x + dx, targetDesk.y + dy);
  setTimeout(() => setState(role, 'idle'), 1500);
}

// 新 API: 回到自己工位
function returnHome(role) {
  const desk = ROLE_DATA[role].desk;
  setState(role, 'walking');
  moveCharacter(role, desk.x, desk.y);
  setTimeout(() => setState(role, 'idle'), 1500);
}

// 走到会议室（保留原有逻辑）
function moveToMeeting(role) {
  joinMeeting(role);
  setState(role, 'walking');
  setTimeout(() => setState(role, 'idle'), 1500);
}

// 从会议室回到自己工位
function returnToDesk(role) {
  leaveMeeting(role);
  moveCharacter(role, ROLE_DATA[role].desk.x, ROLE_DATA[role].desk.y);
  setState(role, 'walking');
  setTimeout(() => setState(role, 'idle'), 1500);
}

// 多人汇报布局：把多个角色排到目标工位的两侧
function walkToForReport(reporters, targetRole) {
  // reporters 顺序：第一个站左侧，第二个站右侧，更多依次左右排开
  reporters.forEach((role, idx) => {
    const side = (idx % 2 === 0) ? 'left' : 'right';
    setTimeout(() => walkTo(role, targetRole, side), idx * 200);
  });
}

// ── Deliverables ────────────────────────────────────────────────────────
function addDeliverable(fromRole, type, title, body) {
  const card = document.createElement('div');
  card.className = 'deliv-card';
  card.dataset.type = type;
  card.dataset.from = fromRole;
  card.innerHTML =
    '<div class="deliv-meta">' +
      '<span>' + ROLE_DATA[fromRole].nick + '</span>' +
      '<span>·</span>' +
      '<span>' + type + '</span>' +
      '<span style="margin-left:auto">' + formatTime(now()) + '</span>' +
    '</div>' +
    '<div class="deliv-title">' + escapeHtml(title) + '</div>';
  card.addEventListener('click', function () { openDeliverableModal(fromRole, type, title, body); });
  delivListEl.appendChild(card);
  card.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
  deliverables.push({ from: fromRole, type: type, title: title, body: body });
  state.decisions += 1;
  decisionCountEl.textContent = state.decisions;
  delivTotalEl.textContent = '(' + deliverables.length + ')';
}

function openDeliverableModal(fromRole, type, title, body) {
  const modal = document.createElement('div');
  modal.className = 'deliv-modal';
  modal.innerHTML =
    '<div class="deliv-modal-content">' +
      '<div class="deliv-meta">' + ROLE_DATA[fromRole].name + ' · ' + type + '</div>' +
      '<h2>' + escapeHtml(title) + '</h2>' +
      '<div class="deliv-body">' + body + '</div>' +
      '<button class="deliv-modal-close">关闭</button>' +
    '</div>';
  modal.addEventListener('click', e => { if (e.target === modal) modal.remove(); });
  modal.querySelector('.deliv-modal-close').addEventListener('click', () => modal.remove());
  document.body.appendChild(modal);
}

// ── Character click handler ────────────────────────────────────────────
const $$ = (sel, root) => Array.from((root || document).querySelectorAll(sel));
$$('.character').forEach(el => {
  el.addEventListener('click', function () {
    const role = el.dataset.role;
    showCharacterDetail(role);
    let latestConvId = null;
    let latestT = 0;
    conversations.forEach(conv => {
      if (conv.participants.indexOf(role) >= 0 && conv.lastActivity > latestT) {
        latestT = conv.lastActivity;
        latestConvId = conv.id;
      }
    });
    if (latestConvId) switchConversation(latestConvId);
  });
});

function showCharacterDetail(role) {
  state.selectedRole = role;
  $$('.character').forEach(el => el.classList.remove('selected'));
  $('#char-' + role).classList.add('selected');
  const roleData = ROLE_DATA[role];
  $('#detail-avatar').textContent = roleData.initials;
  $('#detail-avatar').style.background = roleData.color;
  $('#detail-name').textContent = roleData.name;
  $('#detail-role').textContent = roleData.role;
  $('#detail-state').textContent = getStateText($('#char-' + role).dataset.state);
  const bubble = $('#char-' + role + ' .head-bubble');
  $('#detail-task').textContent = (bubble.classList.contains('show') && bubble.textContent) || '—';
  const convDiv = $('#detail-conversations');
  convDiv.innerHTML = '';
  conversations.forEach(conv => {
    if (conv.participants.indexOf(role) >= 0) {
      const div = document.createElement('div');
      div.className = 'item';
      div.textContent = '💬 ' + conv.title + ' · ' + conv.messages.length + ' 条';
      div.addEventListener('click', () => openFloatingChat(conv.id));
      convDiv.appendChild(div);
    }
  });
  if (convDiv.children.length === 0) convDiv.innerHTML = '<div class="item">—</div>';
  const delivDiv = $('#detail-deliverables');
  delivDiv.innerHTML = '';
  deliverables.forEach((d, i) => {
    if (d.from === role) {
      const div = document.createElement('div');
      div.className = 'item';
      div.textContent = '📦 ' + d.title;
      div.addEventListener('click', () => openDeliverableModal(d.from, d.type, d.title, d.body));
      delivDiv.appendChild(div);
    }
  });
  if (delivDiv.children.length === 0) delivDiv.innerHTML = '<div class="item">—</div>';
  detailPanel.classList.add('show');
}

function getStateText(s) {
  return ({ idle: '空闲', thinking: '思考中', talking: '正在发言', walking: '移动中', working: '工作中', done: '已完成' })[s] || s;
}

$('#detail-close').addEventListener('click', () => {
  detailPanel.classList.remove('show');
  $$('.character').forEach(el => el.classList.remove('selected'));
});

// ── Panel toggle ────────────────────────────────────────────────────────
function togglePanel(id) {
  const panel = $('#' + id);
  panel.classList.toggle('collapsed');
  const btn = panel.querySelector('.toggle');
  btn.textContent = panel.classList.contains('collapsed') ? '▢' : '_';
}
window.togglePanel = togglePanel;

// ── Script engine ─────────────────────────────────────────────────────
const scriptQueue = [];
let scriptCursor = 0;
const TIME_SCALE = 1.0;
function t(ms) { return Math.round(ms * TIME_SCALE); }
function scriptEvent(timeMs, fn) {
  scriptQueue.push({ t: timeMs, fn: fn });
  scriptQueue.sort((a, b) => a.t - b.t);
}
function dispatchScriptEvents() {
  const elapsed = now();
  while (scriptCursor < scriptQueue.length && scriptQueue[scriptCursor].t <= elapsed) {
    try { scriptQueue[scriptCursor].fn(); }
    catch (e) { console.error('Script error', e); }
    scriptCursor++;
  }
}

// ── Task input parsing (replaces the click-to-play button) ────────────
const DEFAULT_INPUT = {
  customer: 'AC Corp',
  industry: '政府采购',
  feature: '标书审核智能体',
  deadline: '6 周',
  budget: '¥1.8M',
  risk: '¥500k 违约罚款',
  requirements: ['PDF/Word 上传', '字段提取', '合规规则匹配', '报告生成'],
};

let parsedInput = Object.assign({}, DEFAULT_INPUT);

function parseUserInput() {
  const text = $('#task-input').value.trim();
  // First pull from manual fields (these override)
  const customer = $('#meta-customer').value.trim();
  const industry = $('#meta-industry').value.trim();
  const feature = $('#meta-feature').value.trim();
  const deadline = $('#meta-deadline').value.trim();
  const budget = $('#meta-budget').value.trim();
  if (customer) parsedInput.customer = customer;
  if (industry) parsedInput.industry = industry;
  if (feature) parsedInput.feature = feature;
  if (deadline) parsedInput.deadline = deadline;
  if (budget) parsedInput.budget = budget;
  // If text area is non-empty, try to extract fields
  if (text) {
    // Company name
    if (!customer) {
      const m = text.match(/([一-龥A-Za-z0-9]{2,}(?:公司|集团|Corp|Inc|Co\.|科技|网络|信息))/);
      if (m) parsedInput.customer = m[1];
    }
    // Feature (智能体/系统/平台/工具 after a noun)
    if (!feature) {
      const m = text.match(/(标书|合同|审批|审阅|对话|知识|订单|客户|报表|法务|财务|招聘)[一-龥]{0,4}(智能体|系统|平台|工具|助手|机器)/);
      if (m) parsedInput.feature = m[0];
    }
    // Deadline (X 周/月)
    if (!deadline) {
      const m = text.match(/(\d+\s*周|\d+\s*个?月|两周|一个月)/);
      if (m) parsedInput.deadline = m[1].trim();
    }
    // Budget (¥X万 / X万 / 100万 etc)
    if (!budget) {
      const m = text.match(/[¥￥]?\s*(\d+(?:\.\d+)?)\s*(万|k|K|百万|亿)/);
      if (m) parsedInput.budget = '¥' + m[1] + m[2];
    }
    // Industry hint
    if (!industry) {
      if (/采购|政府|政务/.test(text)) parsedInput.industry = '政府采购';
      else if (/金融|银行|证券|保险/.test(text)) parsedInput.industry = '金融';
      else if (/医疗|医院|药品/.test(text)) parsedInput.industry = '医疗';
      else if (/教育|学校/.test(text)) parsedInput.industry = '教育';
    }
  }
  // Show parsed summary
  const summary = $('#parsed-summary');
  summary.innerHTML =
    '<strong>已解析任务:</strong><br>' +
    '客户: ' + parsedInput.customer + ' · 行业: ' + parsedInput.industry + '<br>' +
    '功能: ' + parsedInput.feature + ' · 时间: ' + parsedInput.deadline + ' · 预算: ' + parsedInput.budget;
  summary.classList.add('show');
}

function loadSample() {
  $('#task-input').value = '客户 AC Corp(省级政府采购中心)要求做一个标书审核智能体,6 周交付,启动金 200 万。要求支持 PDF / Word 上传、字段提取、合规规则匹配、报告生成四个核心功能。合规上要走政府采购数据隐私标准。';
  $('#meta-customer').value = '';
  $('#meta-industry').value = '';
  $('#meta-feature').value = '';
  $('#meta-deadline').value = '';
  $('#meta-budget').value = '';
  parseUserInput();
}

function toggleInputPanel() {
  $('#input-panel').classList.toggle('collapsed');
}

function launchDemo() {
  parseUserInput();
  reset();
  // After reset, run with parsed input
  setTimeout(function () { start(); }, 50);
}

window.toggleInputPanel = toggleInputPanel;
window.loadSample = loadSample;
window.parseFromText = parseUserInput;
window.launchDemo = launchDemo;

// ── Floating chat windows (pop-up from conv-item click) ────────────
const openWindows = new Map(); // convId -> window element

function openFloatingChat(convId) {
  console.log('[openFloatingChat] called for', convId, 'existing windows:', openWindows.size);
  // Close if already open, focus
  if (openWindows.has(convId)) {
    const w = openWindows.get(convId);
    w.style.zIndex = String(300 + openWindows.size);
    w.style.display = 'flex';
    console.log('[openFloatingChat] already open, raised z-index');
    return;
  }
  const conv = conversations.find(c => c.id === convId);
  if (!conv) {
    console.warn('[openFloatingChat] conversation not found:', convId);
    return;
  }
  console.log('[openFloatingChat] creating window for:', conv.title, 'messages:', conv.messages.length);

  // Auto-open conv panel and switch to this conversation
  $('#conv-panel').classList.remove('collapsed');
  switchConversation(convId);

  // Spawn window at cascading position (right-bottom area, away from panels)
  const offset = openWindows.size * 30;
  // Use right side of viewport, but avoid the activity panel (right 360px wide)
  const x = Math.max(20, window.innerWidth - 400 - offset);
  const y = Math.max(120, 60 + offset);

  const win = document.createElement('div');
  win.className = 'chat-window';
  win.style.left = x + 'px';
  win.style.top = y + 'px';
  win.dataset.convId = convId;
  win.innerHTML =
    '<div class="chat-window-header">' +
      '<span style="flex:1; overflow: hidden; text-overflow: ellipsis; white-space: nowrap;">💬 ' + escapeHtml(conv.title) + '</span>' +
      '<button class="close-btn">×</button>' +
    '</div>' +
    '<div class="chat-window-body" data-body></div>';
  // Render messages
  const body = win.querySelector('[data-body]');
  conv.messages.forEach(m => appendMsgToWindow(body, m.from, m.text, m.t));
  body.scrollTop = body.scrollHeight;
  // Close handler
  win.querySelector('.close-btn').addEventListener('click', function (e) {
    e.stopPropagation();
    closeFloatingChat(convId);
  });
  // Make draggable
  makeDraggable(win);
  // Append to main
  $('#main').appendChild(win);
  openWindows.set(convId, win);
}

function closeFloatingChat(convId) {
  const win = openWindows.get(convId);
  if (win) {
    if (typeof win._dragCleanup === 'function') win._dragCleanup();
    win.remove();
    openWindows.delete(convId);
  }
}

function appendMsgToWindow(body, fromRole, text, t) {
  const div = document.createElement('div');
  div.className = 'message';
  const roleData = ROLE_DATA[fromRole];
  // Determine self side based on the active conversation in chat panel
  const conv = conversations.find(c => body.closest('.chat-window') && c.id === body.closest('.chat-window').dataset.convId);
  let isSelf = false;
  if (conv) isSelf = conv.participants[0] === fromRole;
  if (isSelf) div.classList.add('from-self');
  div.innerHTML =
    '<div class="msg-avatar" style="background:' + roleData.color + '">' + roleData.initials + '</div>' +
    '<div class="msg-body">' +
      '<div class="msg-name">' + roleData.name + '</div>' +
      '<div class="msg-bubble">' + escapeHtml(text) + '</div>' +
      '<div class="msg-time">' + formatTime(t) + '</div>' +
    '</div>';
  body.appendChild(div);
}

function refreshFloatingChatMessages() {
  // When new messages are added, update all open windows
  openWindows.forEach(function (win, convId) {
    const conv = conversations.find(c => c.id === convId);
    if (!conv) return;
    const body = win.querySelector('[data-body]');
    body.innerHTML = '';
    conv.messages.forEach(m => appendMsgToWindow(body, m.from, m.text, m.t));
    body.scrollTop = body.scrollHeight;
  });
}

function makeDraggable(el) {
  const header = el.querySelector('.chat-window-header');
  let isDragging = false;
  let startX, startY, initialX, initialY;

  function onMouseDown(e) {
    if (e.target.tagName === 'BUTTON') return;
    isDragging = true;
    startX = e.clientX;
    startY = e.clientY;
    const rect = el.getBoundingClientRect();
    initialX = rect.left;
    initialY = rect.top;
    el.style.zIndex = String(100 + openWindows.size + 1);
    e.preventDefault();
  }
  function onMouseMove(e) {
    if (!isDragging) return;
    const dx = e.clientX - startX;
    const dy = e.clientY - startY;
    el.style.left = (initialX + dx) + 'px';
    el.style.top = (initialY + dy) + 'px';
  }
  function onMouseUp() { isDragging = false; }

  header.addEventListener('mousedown', onMouseDown);
  document.addEventListener('mousemove', onMouseMove);
  document.addEventListener('mouseup', onMouseUp);

  // 把 cleanup 挂到元素上，关窗时调用即可解绑
  el._dragCleanup = function () {
    document.removeEventListener('mousemove', onMouseMove);
    document.removeEventListener('mouseup', onMouseUp);
  };
}

window.openFloatingChat = openFloatingChat;

// ── THE SCRIPT · 新流程(固定工位 + 汇报链路) ─────────────────────────────
// 流程:GM→董事长→GM回工位→CTO来→CTO回工位→PM+研发来→会议室会议→各回工位干活→汇报→PM+研发→CTO→GM→董事长
function runScript() {
  // ─── Act 1: GM 主动走到董事长工位讨论 ───
  scriptEvent(t(500), function () {
    spawnCharacter('chairman');
    setState('chairman', 'thinking');
  });

  scriptEvent(t(2500), function () {
    spawnCharacter('gm');
  });

  scriptEvent(t(3500), function () {
    // GM 走到董事长工位（董事长不动）
    walkTo('gm', 'chairman');
    setTimeout(() => setState('gm', 'idle'), 1500);
  });

  scriptEvent(t(6000), function () {
    // 董事长发起对话（董事长不动,fromStaysAtHome=true）
    sendMessage1on1('chairman', 'gm',
      `总经理,${parsedInput.customer} 这单子你看了吧?省政采中心那个标书审核需求,3 天内要反馈。`,
      t(6000), { fromStaysAtHome: true });
  });

  scriptEvent(t(11000), function () {
    sendMessage1on1('gm', 'chairman',
      `看到了,昨晚 11 点多客户发的。${parsedInput.customer} 是局里数一数二的标杆客户,拿下它,Q4 全省推广就有着落了。这单子接不接,主要看您这边战略上想不想做。`,
      t(11000), { fromStaysAtHome: true, fromReturnsHome: false });
  });

  scriptEvent(t(16000), function () {
    sendMessage1on1('chairman', 'gm',
      '想接,而且必须接。这单的参考价值比合同本身大十倍。你跟技术负责人对一下 6 周交付行不行,标书里要求 8 周,我想压一下。',
      t(16000), { fromStaysAtHome: true });
  });

  scriptEvent(t(21000), function () {
    sendMessage1on1('gm', 'chairman',
      '行,我下午拉技术负责人过一下技术方案。但 6 周我心里没底——Q4 排期本来满的,新加项目要砍别的。研发那边的加班费预算可能也要重新算。',
      t(21000), { fromStaysAtHome: true, fromReturnsHome: false });
  });

  scriptEvent(t(27000), function () {
    sendMessage1on1('chairman', 'gm',
      '加班费的事你跟财务报一下,这块从年度预算里调。还有,合规这块——标书涉及政府采购数据,你让法务那位同事看一眼数据处理协议模板,别踩数据合规的坑。',
      t(27000), { fromStaysAtHome: true });
  });

  scriptEvent(t(33000), function () {
    sendMessage1on1('gm', 'chairman',
      `明白。我今晚之前把方案整出来给您。还有一点——${parsedInput.customer} 那边对接的副局长,据说下个月要调岗,这事我们得尽快定下来,拖到 Q1 他走了就没这么好推了。`,
      t(33000), { fromStaysAtHome: true, fromReturnsHome: false });
  });

  scriptEvent(t(39000), function () {
    addDeliverable('chairman', 'strategic', `战略决策书 · ${parsedInput.customer} ${parsedInput.feature}`,
      '<strong>决策性质:</strong>战略层 · 接受任务并派活<br><br>' +
      `<strong>业务目标:</strong>拿下 ${parsedInput.customer} 标杆客户,撬动 Q4 全省推广<br>` +
      `<strong>硬约束:</strong>${parsedInput.deadline}交付最小可行版本 · 启动金 ${parsedInput.budget} · 风险底线 ${parsedInput.risk}<br>` +
      '<strong>派活指令:</strong>总经理组织执行,技术负责人出技术方案,法务审合同<br>' +
      '<strong>时间窗口:</strong>对接窗口期紧,必须在此之前定下来<br>' +
      '<strong>风险提示:</strong>研发 Q4 排期已满,可能需要砍其他项目或加加班费预算');
    showHeadBubble('chairman', '✓ 已下达战略指令', 'talking', 3000);
  });

  // 战略讨论结束,GM 一次性回到自己工位,之后不动直到最终汇报
  scriptEvent(t(42000), function () {
    returnHome('gm');
  });

  // ─── Act 2: GM 已回工位(由 returnHome 完成),叫 CTO ───
  scriptEvent(t(44000), function () {
    spawnCharacter('cto');
  });

  scriptEvent(t(47000), function () {
    // CTO 走到 GM 工位
    walkTo('cto', 'gm');
    setTimeout(() => {
      setState('cto', 'idle');
      showHeadBubble('cto', '💭 总经理找我,先去他那里', 'thinking', 3500);
    }, 1500);
  });

  scriptEvent(t(52000), function () {
    sendMessage1on1('gm', 'cto',
      `技术负责人,你过来一下。${parsedInput.customer} 那单子,董事长要 6 周交付,你拍个技术方案给我。最小可行版本范围自己定,但标书里那 4 个核心功能(上传、字段提取、合规匹配、报告)必须都要有。`,
      t(52000), { fromStaysAtHome: true });
  });

  scriptEvent(t(57000), function () {
    sendMessage1on1('cto', 'gm',
      '总经理,6 周这事我得掰一下。先说结论:不砍功能的情况下,8 周是底线,因为文档字段提取 + 合规规则引擎这两个都得从零搭。',
      t(57000), { fromStaysAtHome: true, fromReturnsHome: false });
  });

  scriptEvent(t(63000), function () {
    sendMessage1on1('gm', 'cto',
      '8 周董事长那边过不了,他对副局长调岗这事很急。你再想想,能不能把 V1.1 推到后面,最小可行版本只做核心功能?这样 6 周可能挤得出来。',
      t(63000), { fromStaysAtHome: true });
  });

  scriptEvent(t(69000), function () {
    setState('cto', 'thinking');
    showHeadBubble('cto', '💭 重新评估方案范围...', 'thinking', 4000);
  });

  scriptEvent(t(75000), function () {
    sendMessage1on1('cto', 'gm',
      `可以试试。最小可行版本只做 3 个核心:上传、字段提取、合规匹配(只跑我们库里已有的 100 条通用规则,${parsedInput.customer} 自己的专属规则放 V1.1)。报告生成和复杂规则放后面。`,
      t(75000), { fromStaysAtHome: true, fromReturnsHome: false });
  });

  scriptEvent(t(81000), function () {
    sendMessage1on1('gm', 'cto',
      '行,就这么定。你给我报个团队配置——需要几个人、什么级别、加班不?我好跟董事长和财务报预算。',
      t(81000), { fromStaysAtHome: true });
  });

  scriptEvent(t(87000), function () {
    sendMessage1on1('cto', 'gm',
      '需要 2 名高级工程师(主攻文档解析和检索增强合规引擎),1 名中级工程师(对接接口和报告)。加班必须有,周末也得排,不然 6 周真的挤不出来。我今晚把详细方案写成技术方案给你。',
      t(87000), { fromStaysAtHome: true, fromReturnsHome: false });
  });

  scriptEvent(t(93000), function () {
    addDeliverable('cto', 'tech', `技术方案 · ${parsedInput.feature}`,
      '<strong>架构思路:</strong>文档解析 + 检索增强生成 + 后端服务<br>' +
      '<strong>技术栈:</strong>Python 主语言 · 向量数据库 · 前端框架<br>' +
      `<strong>团队配置:</strong>2 名高级工程师 × ${parsedInput.deadline}(主攻核心模块)<br>` +
      '<strong>最小可行版本范围:</strong>上传 + 字段提取 + 通用合规规则匹配<br>' +
      `<strong>二期推迟:</strong>报告生成、${parsedInput.customer} 专属规则、多语言<br>` +
      '<strong>加班安排:</strong>周末排班,需 28 万加班费预算<br>' +
      `<strong>风险:</strong>文档解析准确率依赖样本质量,需 ${parsedInput.customer} 提供历史样本`);
  });

  // CTO 讨论结束,一次性回到自己工位
  scriptEvent(t(95000), function () {
    returnHome('cto');
  });

  // ─── Act 3: CTO 叫 PM + 研发 ───
  scriptEvent(t(98000), function () {
    spawnCharacter('pm');
    spawnCharacter('dev');
  });

  scriptEvent(t(101000), function () {
    // PM 站 CTO 工位左侧,研发站右侧
    walkToForReport(['pm', 'dev'], 'cto');
  });

  scriptEvent(t(107000), function () {
    sendMessage1on1('cto', 'pm',
      `PM,${parsedInput.feature} 项目批了,技术方案你过一下。今晚出需求文档草案,明天早上让设计师、研发、测试一起开个会。范围:最小可行版本只做上传、字段提取、合规匹配三个核心,6 周交付。`,
      t(107000), { fromStaysAtHome: true });
  });

  scriptEvent(t(112000), function () {
    sendMessage1on1('cto', 'dev',
      '研发,后端和前端实现你拉起来。最小可行版本范围:文档上传、字段提取(用文档解析库)、通用合规规则匹配(100 条规则,我给你接口)、报告生成。验收标准 PM 在需求文档里出。6 周,加班在所难免。',
      t(112000), { fromStaysAtHome: true });
  });

  scriptEvent(t(118000), function () {
    addDeliverable('pm', 'product', `需求文档草案 · ${parsedInput.feature}`,
      `<strong>目标用户:</strong>${parsedInput.customer} ${parsedInput.industry}审核员<br>` +
      '<strong>核心用户故事:</strong>5 分钟内出报告,字段准确率 ≥ 95%<br>' +
      `<strong>验收标准:</strong>首屏加载 ≤3 秒,字段准确率 ≥ 95%,合规召回率 ≥ 90%<br>` +
      '<strong>无障碍:</strong>风险分级颜色 + 图标双通道,色盲友好');
  });

  // PM + 研发回工位
  scriptEvent(t(122000), function () {
    returnHome('pm');
    returnHome('dev');
  });

  // ─── Act 4: PM 拉会议室会议（PM 先到,设计/研发/测试 陆续到）───
  scriptEvent(t(127000), function () {
    spawnCharacter('designer');
    spawnCharacter('tester');
  });

  scriptEvent(t(129000), function () {
    // 会议室议题浮卡
    setMeetingTopic('PRD 评审 · 任务对齐', '📋');
    // PM 先到会议室
    joinMeeting('pm');
    moveCharacter('pm', MEETING_POSITIONS[0].x, MEETING_POSITIONS[0].y);
    setState('pm', 'walking');
    setTimeout(() => setState('pm', 'idle'), 1400);
  });

  scriptEvent(t(134000), function () {
    // 设计师走到会议室
    joinMeeting('designer');
    moveCharacter('designer', MEETING_POSITIONS[1].x, MEETING_POSITIONS[1].y);
    setState('designer', 'walking');
    setTimeout(() => setState('designer', 'idle'), 1400);
  });

  scriptEvent(t(138000), function () {
    // 研发走到会议室
    joinMeeting('dev');
    moveCharacter('dev', MEETING_POSITIONS[2].x, MEETING_POSITIONS[2].y);
    setState('dev', 'walking');
    setTimeout(() => setState('dev', 'idle'), 1400);
  });

  scriptEvent(t(142000), function () {
    // 测试走到会议室
    joinMeeting('tester');
    moveCharacter('tester', MEETING_POSITIONS[3].x, MEETING_POSITIONS[3].y);
    setState('tester', 'walking');
    setTimeout(() => setState('tester', 'idle'), 1400);
  });

  scriptEvent(t(147000), function () {
    sendMessageInMeeting('pm',
      '行,人到齐了。技术方案和需求文档我也看了,6 周紧但能做。先对齐几个事:研发,文档解析库处理扫描版 PDF 准确率你测过没?',
      t(147000));
  });

  scriptEvent(t(154000), function () {
    sendMessageInMeeting('dev',
      `测过,样本是公开的 100 份 PDF,准确率 87%。${parsedInput.customer} 的扫描版要差一些,我估计 80% 左右。`,
      t(154000));
  });

  scriptEvent(t(161000), function () {
    sendMessageInMeeting('pm',
      '80% 不到 95% 目标。研发,你能不能加一层大模型后处理?用大模型二次校验,这种成本可控。',
      t(161000));
  });

  scriptEvent(t(168000), function () {
    sendMessageInMeeting('dev',
      '可以。但大模型调用成本我得算一下,100 份标书 × 5 页 × 2 次 = 1000 次调用,大概 ¥800/批。可以接受。',
      t(168000));
  });

  scriptEvent(t(175000), function () {
    sendMessageInMeeting('designer',
      '产品经理,设计稿我有个问题。报告页要展示风险点分级,客户希望"高、中、低"用红黄绿三色标识。无障碍要求是颜色不能单独传递信息——必须配图标。我打算用三角警示、圆圈提示、对勾通过。你看行吗?',
      t(175000));
  });

  scriptEvent(t(182000), function () {
    sendMessageInMeeting('pm',
      '可以,这就对了。颜色加图标双通道,这种细节上次我们没注意,这次补上。测试,这个你的测试用例要覆盖色盲场景。',
      t(182000));
  });

  scriptEvent(t(189000), function () {
    sendMessageInMeeting('tester',
      '收到。色盲模式我加到端到端里。还有个事——研发,你说的大模型二次校验,这个有边界情况要测:原文模糊到文字识别完全识别不出来时,大模型也不能瞎编,得明确返回"无法识别"。',
      t(189000));
  });

  scriptEvent(t(196000), function () {
    sendMessageInMeeting('dev',
      '对,这块我加提示词约束,识别不出来直接返回 null,前端展示"人工复核"。合规上不能大模型瞎猜。',
      t(196000));
  });

  scriptEvent(t(203000), function () {
    sendMessageInMeeting('pm',
      '好,今天的会对齐到这。各自分头干,周五下班前全员给个进度。周三晚上我再看一次设计稿 v1。有阻塞群里喊,不要憋着。散会。',
      t(203000));
  });

  // ─── Act 5: 会议室结束,各自回工位 ───
  scriptEvent(t(210000), function () {
    setMeetingTopic(null);
    returnToDesk('pm');
    returnToDesk('designer');
    returnToDesk('dev');
    returnToDesk('tester');
  });

  scriptEvent(t(215000), function () {
    // 每个角色开始工作
    ['designer', 'dev', 'tester'].forEach(function (r) {
      setState(r, 'working');
      const taskLabel = r === 'designer' ? '🎨 设计稿 v1'
                      : r === 'dev' ? '💻 写代码'
                      : '🧪 写测试用例';
      showHeadBubble(r, taskLabel + ' 干活中...', 'thinking', 12000);
    });
    setState('pm', 'thinking');
    showHeadBubble('pm', '📝 整合需求文档', 'thinking', 8000);
  });

  // ─── Act 6: 异步工作后,设计/测试/研发 逐个汇报 PM ───
  scriptEvent(t(230000), function () {
    setState('designer', 'idle');
    showHeadBubble('designer', '✓ 设计稿 v1 完成,先去汇报', 'talking', 3500);
    sendMessage1on1('designer', 'pm',
      'PM,设计稿 v1 出来了,上传页 / 字段预览页 / 报告页三个核心页面都覆盖了,无障碍双通道也做了。您看一下,有问题我马上调。',
      t(230000));
  });

  scriptEvent(t(238000), function () {
    setState('tester', 'idle');
    showHeadBubble('tester', '✓ 测试用例完成,汇报 PM', 'talking', 3500);
    sendMessage1on1('tester', 'pm',
      'PM,自动化测试用例 87 条已写完,覆盖率目标 80%,端到端 15 个场景。色盲模式测试已加入。等研发代码 ready 就可以跑。',
      t(238000));
  });

  scriptEvent(t(246000), function () {
    setState('dev', 'idle');
    showHeadBubble('dev', '✓ 代码 ready,汇报 PM', 'talking', 3500);
    sendMessage1on1('dev', 'pm',
      'PM,后端核心 3 个模块都写完了——文档解析、字段提取、合规匹配。前端上传组件对接完成,断点续传已实现。本地跑通,可以进入联调。',
      t(246000));
  });

  // ─── Act 7: PM + 研发 联合走到 CTO 工位汇报 ───
  scriptEvent(t(254000), function () {
    showHeadBubble('pm', '📦 整合完成,带研发一起去汇报 CTO', 'talking', 4000);
    // PM 站 CTO 左侧,研发站右侧
    walkToForReport(['pm', 'dev'], 'cto');
  });

  scriptEvent(t(259000), function () {
    sendMessage1on1('cto', 'pm',
      'PM,产品端全部交付完毕——产品需求文档、设计稿、代码、测试报告都在这了。研发也在,你们一起汇报一下。',
      t(259000), { fromStaysAtHome: true });
  });

  scriptEvent(t(265000), function () {
    sendMessage1on1('cto', 'pm',
      '收到,我整合一下。整体的技术交付方案会包含架构图、模块划分、上线策略、回滚方案。我一会儿去给总经理汇报。',
      t(265000));
  });

  // PM + 研发回工位
  scriptEvent(t(272000), function () {
    returnHome('pm');
    returnHome('dev');
  });

  // ─── Act 8: CTO 整合,主动去 GM 工位汇报 ───
  scriptEvent(t(280000), function () {
    showHeadBubble('cto', '📦 整合技术交付方案,准备汇报 GM', 'talking', 4000);
    setState('cto', 'walking');
    moveCharacter('cto', ROLE_DATA.gm.desk.x - 7, ROLE_DATA.gm.desk.y);
    setTimeout(() => setState('cto', 'idle'), 1500);
  });

  scriptEvent(t(284000), function () {
    sendMessage1on1('cto', 'gm',
      '总经理,产品+技术+测试全部交付完成。技术交付方案在附件里,核心数据:最小可行版本 6 周按期交付,准确率超目标(96% vs 95%),阻塞级问题 0 个遗留。',
      t(284000), { fromStaysAtHome: true });
  });

  // CTO 回工位
  scriptEvent(t(291000), function () {
    returnHome('cto');
  });

  // ─── Act 9: GM 最终去董事长工位汇报 ───
  scriptEvent(t(298000), function () {
    addDeliverable('gm', 'execution', `执行方案 · ${parsedInput.feature}`,
      `<strong>业务目标:</strong>${parsedInput.customer} 标杆客户拿下,Q4 全省推广撬动<br>` +
      `<strong>团队:</strong>CTO + 产品经理 + 设计师 + 研发 + 测试 = 5 人 × ${parsedInput.deadline}<br>` +
      `<strong>预算执行:</strong>启动金 ${parsedInput.budget},加班费 28 万,模型调用费 4.8 万,总计 213 万<br>` +
      '<strong>里程碑:</strong>第 2 周字段提取完成,第 4 周引擎联调,第 5 周端到端测试,第 6 周灰度<br>' +
      '<strong>交付物:</strong>产品需求文档 / 设计稿 / 多个代码合并 / 完整测试报告 / 上线方案<br>' +
      '<strong>风险残留:</strong>次要项×2 已记录,二期处理');
    showHeadBubble('gm', '📦 去董事长那儿汇报', 'talking', 3500);
    setState('gm', 'walking');
    moveCharacter('gm', ROLE_DATA.chairman.desk.x - 7, ROLE_DATA.chairman.desk.y);
    setTimeout(() => setState('gm', 'idle'), 1500);
  });

  scriptEvent(t(303000), function () {
    sendMessage1on1('gm', 'chairman',
      `董事长,${parsedInput.customer} 这单子全部搞定。执行方案、技术方案、测试报告都在这里,核心数据:6 周按期交付,准确率 96% 超目标,零遗留阻塞级。Q4 全省推广我这边可以接着推了。请您确认一下,我们这就启动客户对接。`,
      t(303000), { fromStaysAtHome: true });
  });

  // ─── Act 10: 董事长确认 ───
  scriptEvent(t(310000), function () {
    sendMessage1on1('chairman', 'gm',
      `好。这单子做得漂亮。Q4 全省推广我下周一开会布置,你这边先把 ${parsedInput.customer} 验收走完,签字盖章拿到手,别让到嘴的鸭子飞了。`,
      t(310000), { fromStaysAtHome: true });
  });

  // GM 回工位
  scriptEvent(t(317000), function () {
    returnHome('gm');
  });

  // ─── 收尾:全员完成 ───
  scriptEvent(t(323000), function () {
    ['chairman', 'gm', 'cto', 'pm', 'designer', 'dev', 'tester'].forEach(function (r) {
      setState(r, 'done');
    });
    showHeadBubble('chairman', '✓ 全链路交付完成 · 启动验收', 'talking', 5000);
  });


}

// ── Controls ──────────────────────────────────────────────────────────
function start() {
  if (state.running && !state.paused) return;
  if (!state.running) {
    state.startedAt = Date.now();
    state.pausedAt = 0;
    state.pausedElapsed = 0;
    state.running = true;
    state.paused = false;
    state.decisions = 0;
    state.messages = 0;
    scriptQueue.length = 0;
    scriptCursor = 0;
    conversations.length = 0;
    deliverables.length = 0;
    activeConversationId = null;
    meetingMembers.clear();
    convListEl.innerHTML = '';
    if (activityListEl) activityListEl.innerHTML = '';
    if (activityCountEl) activityCountEl.textContent = '(0)';
    // Close all floating chat windows
    openWindows.forEach(function (_win, cid) { closeFloatingChat(cid); });
    delivListEl.innerHTML = '';
    $$('.character').forEach(function (el) {
      el.classList.add('hidden');
      el.classList.remove('selected');
      el.dataset.state = 'idle';
      el.style.left = ROLE_DATA[el.dataset.role].desk.x + '%';
      el.style.top = ROLE_DATA[el.dataset.role].desk.y + '%';
      el.querySelector('.head-bubble').classList.remove('show');
    });
    meetingTableEl.classList.remove('active');
    updateMeetingDisplay();
    decisionCountEl.textContent = '0';
    convCountEl.textContent = '0';
    convTotalEl.textContent = '(0)';
    delivTotalEl.textContent = '(0)';
    runScript();
    requestAnimationFrame(tick);
  } else if (state.paused) {
    state.pausedElapsed += Date.now() - state.pausedAt;
    state.paused = false;
    requestAnimationFrame(tick);
  }
  updatePlayBtn();
}

function pause() {
  if (!state.running || state.paused) return;
  state.paused = true;
  state.pausedAt = Date.now();
  updatePlayBtn();
}

function reset() {
  state.running = false;
  state.paused = false;
  state.startedAt = 0;
  state.pausedAt = 0;
  state.pausedElapsed = 0;
  state.decisions = 0;
  state.messages = 0;
  scriptQueue.length = 0;
  scriptCursor = 0;
  conversations.length = 0;
  deliverables.length = 0;
  activeConversationId = null;
  meetingMembers.clear();
  elapsedEl.textContent = '00:00';
  decisionCountEl.textContent = '0';
  convCountEl.textContent = '0';
  activeCountEl.textContent = '0';
  convTotalEl.textContent = '(0)';
  delivTotalEl.textContent = '(0)';
  updatePlayBtn();
}

function updatePlayBtn() {
  // (legacy play button removed; the start button is in #input-panel)
  // Just update pause/resume button label.
  const btn = $('#pause-btn');
  if (!btn) return;
  if (state.running && state.paused) {
    btn.textContent = '▶ 继续';
  } else if (state.running) {
    btn.textContent = '⏸ 暂停';
  } else {
    btn.textContent = '⏸ 暂停';
  }
}

$('#pause-btn').addEventListener('click', pause);
$('#reset-btn').addEventListener('click', function () { reset(); launchDemo(); });

updatePlayBtn();
updateMeetingDisplay();
convTotalEl.textContent = '(0)';
delivTotalEl.textContent = '(0)';
