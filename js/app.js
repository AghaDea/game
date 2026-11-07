// ========== RUSSIAN ROULETTE GAME ==========
// Full client-side app with Supabase realtime + demo fallback

let sb = null; // renamed to avoid conflict with window.supabase from CDN
let currentUser = null;
let currentRoom = null;
let roomChannel = null;
let notifChannel = null;
let currentView = 'home';

// ========== INIT ==========
document.addEventListener('DOMContentLoaded', async () => {
  // Load Supabase if configured
  if (!DEMO_MODE && typeof window.supabase !== 'undefined') {
    sb = window.supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY);
  }

  // Check existing session
  const saved = localStorage.getItem('rr_user');
  if (saved) {
    try {
      currentUser = JSON.parse(saved);
      if (DEMO_MODE) {
        showApp();
      } else {
        // Verify with DB
        const { data } = await sb.from('profiles').select('*').eq('id', currentUser.id).single();
        if (data) {
          currentUser = data;
          localStorage.setItem('rr_user', JSON.stringify(currentUser));
          showApp();
        } else {
          localStorage.removeItem('rr_user');
          showAuth();
        }
      }
    } catch (e) {
      localStorage.removeItem('rr_user');
      showAuth();
    }
  } else {
    showAuth();
  }

  setupEventListeners();
});

// ========== AUTH ==========
function showAuth() {
  document.getElementById('auth-screen').classList.remove('hidden');
  document.getElementById('app').classList.add('hidden');
}

function showApp() {
  document.getElementById('auth-screen').classList.add('hidden');
  document.getElementById('app').classList.remove('hidden');
  updateNavbar();
  navigateTo('home');
  if (!DEMO_MODE) {
    subscribeToNotifications();
    updateOnlineStatus(true);
  }
  loadNotifications();
}

function setupEventListeners() {
  // Auth tabs
  document.querySelectorAll('.auth-tab').forEach(tab => {
    tab.addEventListener('click', () => {
      document.querySelectorAll('.auth-tab').forEach(t => t.classList.remove('active'));
      tab.classList.add('active');
      const isLogin = tab.dataset.tab === 'login';
      document.getElementById('login-form').classList.toggle('hidden', !isLogin);
      document.getElementById('register-form').classList.toggle('hidden', isLogin);
    });
  });

  document.getElementById('login-form').addEventListener('submit', handleLogin);
  document.getElementById('register-form').addEventListener('submit', handleRegister);

  // Nav
  document.querySelectorAll('.nav-item').forEach(item => {
    item.addEventListener('click', () => navigateTo(item.dataset.view));
  });

  // Notif button
  document.getElementById('notif-btn').addEventListener('click', toggleNotifPanel);
  document.getElementById('close-notif').addEventListener('click', () => {
    document.getElementById('notif-panel').classList.add('hidden');
  });

  // Logout
  document.getElementById('logout-btn').addEventListener('click', logout);

  // Create room
  document.getElementById('create-room-btn')?.addEventListener('click', createRoom);
  document.getElementById('join-code-btn')?.addEventListener('click', joinByCode);
}

async function handleRegister(e) {
  e.preventDefault();
  const username = document.getElementById('reg-username').value.trim();
  const password = document.getElementById('reg-password').value;
  const displayName = document.getElementById('reg-displayname').value.trim() || username;

  if (username.length < 3) return toast('نام کاربری حداقل ۳ کاراکتر', 'error');
  if (password.length < 4) return toast('رمز عبور حداقل ۴ کاراکتر', 'error');

  showLoading(true);
  try {
    if (DEMO_MODE) {
      const users = JSON.parse(localStorage.getItem('rr_users') || '{}');
      if (users[username]) throw new Error('این نام کاربری قبلاً ثبت شده');
      const hash = await hashPassword(password);
      const user = {
        id: crypto.randomUUID(),
        username,
        password_hash: hash,
        display_name: displayName,
        xp: 0, level: 1, wins: 0, losses: 0, draws: 0, total_games: 0,
        title: 'تازه‌کار', rank_points: 1000,
        created_at: new Date().toISOString()
      };
      users[username] = user;
      localStorage.setItem('rr_users', JSON.stringify(users));
      currentUser = { ...user };
      delete currentUser.password_hash;
      localStorage.setItem('rr_user', JSON.stringify(currentUser));
      toast('ثبت‌نام موفق!', 'success');
      showApp();
    } else {
      const hash = await hashPassword(password);
      const { data, error } = await sb.from('profiles').insert({
        username, password_hash: hash, display_name: displayName
      }).select().single();
      if (error) throw error;
      currentUser = data;
      localStorage.setItem('rr_user', JSON.stringify(currentUser));
      toast('ثبت‌نام موفق!', 'success');
      showApp();
    }
  } catch (err) {
    toast(err.message || 'خطا در ثبت‌نام', 'error');
  }
  showLoading(false);
}

async function handleLogin(e) {
  e.preventDefault();
  const username = document.getElementById('login-username').value.trim();
  const password = document.getElementById('login-password').value;

  showLoading(true);
  try {
    if (DEMO_MODE) {
      const users = JSON.parse(localStorage.getItem('rr_users') || '{}');
      const user = users[username];
      if (!user) throw new Error('کاربر یافت نشد');
      const hash = await hashPassword(password);
      if (user.password_hash !== hash) throw new Error('رمز عبور اشتباه است');
      currentUser = { ...user };
      delete currentUser.password_hash;
      localStorage.setItem('rr_user', JSON.stringify(currentUser));
      toast('ورود موفق!', 'success');
      showApp();
    } else {
      const { data, error } = await sb.from('profiles')
        .select('*').eq('username', username).single();
      if (error || !data) throw new Error('کاربر یافت نشد');
      const hash = await hashPassword(password);
      if (data.password_hash !== hash) throw new Error('رمز عبور اشتباه است');
      currentUser = data;
      localStorage.setItem('rr_user', JSON.stringify(currentUser));
      await sb.from('profiles').update({ is_online: true, last_online: new Date().toISOString() }).eq('id', currentUser.id);
      toast('ورود موفق!', 'success');
      showApp();
    }
  } catch (err) {
    toast(err.message || 'خطا در ورود', 'error');
  }
  showLoading(false);
}

async function hashPassword(pass) {
  const encoder = new TextEncoder();
  const data = encoder.encode(pass + 'rr_salt_2024');
  const hash = await crypto.subtle.digest('SHA-256', data);
  return Array.from(new Uint8Array(hash)).map(b => b.toString(16).padStart(2, '0')).join('');
}

function logout() {
  if (!DEMO_MODE && currentUser) {
    sb.from('profiles').update({ is_online: false }).eq('id', currentUser.id);
  }
  if (roomChannel) roomChannel.unsubscribe();
  if (notifChannel) notifChannel.unsubscribe();
  currentUser = null;
  currentRoom = null;
  localStorage.removeItem('rr_user');
  showAuth();
}

// ========== NAVIGATION ==========
function navigateTo(view) {
  currentView = view;
  document.querySelectorAll('.nav-item').forEach(i => {
    i.classList.toggle('active', i.dataset.view === view);
  });
  document.querySelectorAll('.view').forEach(v => v.classList.add('hidden'));
  const el = document.getElementById(`view-${view}`);
  if (el) el.classList.remove('hidden');

  if (view === 'home') loadLobby();
  if (view === 'profile') loadProfile(currentUser);
  if (view === 'leaderboard') loadLeaderboard();
  if (view === 'settings') loadSettings();
}

function updateNavbar() {
  if (!currentUser) return;
  document.getElementById('nav-username').textContent = currentUser.display_name || currentUser.username;
  document.getElementById('nav-title').textContent = currentUser.title || 'تازه‌کار';
  document.getElementById('nav-avatar').textContent = (currentUser.display_name || currentUser.username)[0].toUpperCase();
}

// ========== LOBBY ==========
async function loadLobby() {
  const list = document.getElementById('room-list');
  list.innerHTML = '<div class="text-center text-muted p-4">در حال بارگذاری...</div>';

  if (DEMO_MODE) {
    const rooms = JSON.parse(localStorage.getItem('rr_rooms') || '[]');
    const open = rooms.filter(r => r.status === 'waiting' || r.status === 'playing');
    renderRoomList(open);
  } else {
    const { data } = await sb.from('rooms')
      .select('*, player1:profiles!rooms_player1_id_fkey(username, display_name), player2:profiles!rooms_player2_id_fkey(username, display_name)')
      .in('status', ['waiting', 'playing'])
      .order('created_at', { ascending: false })
      .limit(20);
    renderRoomList(data || []);
  }
}

function renderRoomList(rooms) {
  const list = document.getElementById('room-list');
  if (!rooms.length) {
    list.innerHTML = '<div class="text-center text-muted p-4">هیچ رومی باز نیست. یکی بساز!</div>';
    return;
  }
  list.innerHTML = rooms.map(r => `
    <div class="room-item">
      <div class="room-info">
        <h4>روم ${r.room_code}</h4>
        <div class="room-meta">
          ${r.status === 'waiting' ? '⏳ در انتظار' : '🎮 در حال بازی'} • 
          ${r.player1?.display_name || r.player1?.username || 'بازیکن ۱'}
          ${r.player2 ? ' vs ' + (r.player2.display_name || r.player2.username) : ''}
        </div>
      </div>
      <button class="btn btn-sm btn-primary" onclick="joinRoom('${r.id}')">
        ${r.status === 'waiting' ? 'ورود' : 'تماشا'}
      </button>
    </div>
  `).join('');
}

async function createRoom() {
  if (!currentUser) return;
  showLoading(true);
  const code = generateRoomCode();
  const chambers = Math.floor(Math.random() * 7) + 2; // 2-8
  const { cylinder, loaded } = generateCylinder(chambers);

  try {
    if (DEMO_MODE) {
      const room = {
        id: crypto.randomUUID(),
        room_code: code,
        creator_id: currentUser.id,
        player1_id: currentUser.id,
        player2_id: null,
        status: 'waiting',
        current_turn: currentUser.id,
        chambers,
        loaded_count: loaded,
        cylinder,
        current_chamber: 0,
        player1_lives: 4,
        player2_lives: 4,
        created_at: new Date().toISOString()
      };
      const rooms = JSON.parse(localStorage.getItem('rr_rooms') || '[]');
      rooms.push(room);
      localStorage.setItem('rr_rooms', JSON.stringify(rooms));
      currentRoom = room;
      enterGame(room);
    } else {
      const { data, error } = await sb.from('rooms').insert({
        room_code: code,
        creator_id: currentUser.id,
        player1_id: currentUser.id,
        status: 'waiting',
        current_turn: currentUser.id,
        chambers,
        loaded_count: loaded,
        cylinder,
        current_chamber: 0
      }).select().single();
      if (error) throw error;
      currentRoom = data;
      enterGame(data);
    }
    toast(`روم ${code} ساخته شد`, 'success');
  } catch (err) {
    toast(err.message || 'خطا در ساخت روم', 'error');
  }
  showLoading(false);
}

function generateRoomCode() {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  let code = '';
  for (let i = 0; i < 6; i++) code += chars[Math.floor(Math.random() * chars.length)];
  return code;
}

function generateCylinder(chambers) {
  // Never all empty or all loaded
  const loadedCount = Math.floor(Math.random() * (chambers - 1)) + 1; // 1 to chambers-1
  const cylinder = Array(chambers).fill(false);
  const positions = [...Array(chambers).keys()];
  // Shuffle and pick loaded positions
  for (let i = positions.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [positions[i], positions[j]] = [positions[j], positions[i]];
  }
  for (let i = 0; i < loadedCount; i++) {
    cylinder[positions[i]] = true;
  }
  // Random start chamber
  return { cylinder, loaded: loadedCount, start: Math.floor(Math.random() * chambers) };
}

async function joinByCode() {
  const code = document.getElementById('join-code-input').value.trim().toUpperCase();
  if (!code) return toast('کد روم را وارد کنید', 'error');
  showLoading(true);
  try {
    if (DEMO_MODE) {
      const rooms = JSON.parse(localStorage.getItem('rr_rooms') || '[]');
      const room = rooms.find(r => r.room_code === code && r.status === 'waiting');
      if (!room) throw new Error('روم یافت نشد یا پر است');
      if (room.player1_id === currentUser.id) throw new Error('خودت سازنده رومی');
      room.player2_id = currentUser.id;
      room.status = 'playing';
      room.current_turn = room.player1_id;
      localStorage.setItem('rr_rooms', JSON.stringify(rooms));
      currentRoom = room;
      enterGame(room);
    } else {
      const { data: room, error } = await sb.from('rooms')
        .select('*').eq('room_code', code).eq('status', 'waiting').single();
      if (error || !room) throw new Error('روم یافت نشد یا پر است');
      if (room.player1_id === currentUser.id) throw new Error('خودت سازنده رومی');
      const { data: updated, error: upErr } = await sb.from('rooms')
        .update({ player2_id: currentUser.id, status: 'playing', current_turn: room.player1_id })
        .eq('id', room.id)
        .select().single();
      if (upErr) throw upErr;
      // Notify creator
      await sb.from('notifications').insert({
        user_id: room.player1_id,
        type: 'duel_accepted',
        title: 'حریف وارد شد!',
        message: `${currentUser.display_name || currentUser.username} به روم ${code} پیوست`,
        data: { room_id: room.id }
      });
      currentRoom = updated;
      enterGame(updated);
    }
    toast('وارد روم شدی!', 'success');
  } catch (err) {
    toast(err.message, 'error');
  }
  showLoading(false);
}

async function joinRoom(roomId) {
  showLoading(true);
  try {
    if (DEMO_MODE) {
      const rooms = JSON.parse(localStorage.getItem('rr_rooms') || '[]');
      const room = rooms.find(r => r.id === roomId);
      if (!room) throw new Error('روم یافت نشد');
      if (room.status === 'waiting' && !room.player2_id) {
        room.player2_id = currentUser.id;
        room.status = 'playing';
        localStorage.setItem('rr_rooms', JSON.stringify(rooms));
      }
      currentRoom = room;
      enterGame(room);
    } else {
      const { data: room } = await sb.from('rooms').select('*').eq('id', roomId).single();
      if (!room) throw new Error('روم یافت نشد');
      if (room.status === 'waiting' && !room.player2_id && room.player1_id !== currentUser.id) {
        await sb.from('rooms').update({
          player2_id: currentUser.id,
          status: 'playing',
          current_turn: room.player1_id
        }).eq('id', roomId);
      }
      const { data: updated } = await sb.from('rooms').select('*').eq('id', roomId).single();
      currentRoom = updated;
      enterGame(updated);
    }
  } catch (err) {
    toast(err.message, 'error');
  }
  showLoading(false);
}

// ========== GAME ==========
function enterGame(room) {
  currentRoom = room;
  navigateTo('game');
  renderGame();
  if (!DEMO_MODE) subscribeToRoom(room.id);
}

function renderGame() {
  const room = currentRoom;
  if (!room) return;

  // Players
  const isP1 = room.player1_id === currentUser.id;
  const myLives = isP1 ? room.player1_lives : room.player2_lives;
  const oppLives = isP1 ? room.player2_lives : room.player1_lives;
  const myTurn = room.current_turn === currentUser.id;

  document.getElementById('player1-name').textContent = isP1 ? 
    (currentUser.display_name || currentUser.username) : 'حریف';
  document.getElementById('player2-name').textContent = isP1 ? 'حریف' : 
    (currentUser.display_name || currentUser.username);

  // Lives
  document.getElementById('player1-lives').innerHTML = renderLives(isP1 ? myLives : oppLives);
  document.getElementById('player2-lives').innerHTML = renderLives(isP1 ? oppLives : myLives);

  // Active turn highlight
  document.getElementById('player1-card').classList.toggle('active-turn', 
    (isP1 && myTurn) || (!isP1 && !myTurn));
  document.getElementById('player2-card').classList.toggle('active-turn', 
    (isP1 && !myTurn) || (!isP1 && myTurn));

  // Cylinder
  renderCylinder(room);

  // Actions
  const actions = document.getElementById('game-actions');
  if (room.status === 'finished') {
    actions.innerHTML = `<p class="text-muted">بازی تمام شد</p>`;
  } else if (room.status === 'waiting') {
    actions.innerHTML = `
      <p class="text-muted mb-4">در انتظار حریف... کد روم: <strong style="color:var(--gold)">${room.room_code}</strong></p>
      <button class="btn btn-secondary" onclick="leaveRoom()">خروج از روم</button>
    `;
  } else if (myTurn) {
    actions.innerHTML = `
      <p class="text-muted mb-3">نوبت توست! تیر را به کجا بزنی؟</p>
      <div class="action-buttons">
        <button class="btn btn-danger action-btn" onclick="shoot('self')">
          🔫 به خودم
        </button>
        <button class="btn btn-primary action-btn" onclick="shoot('opponent')">
          🎯 به حریف
        </button>
      </div>
      <button class="btn btn-ghost mt-4" onclick="leaveRoom()">ترک بازی</button>
    `;
  } else {
    actions.innerHTML = `
      <p class="text-muted mb-3">منتظر نوبت حریف...</p>
      <button class="btn btn-ghost" onclick="leaveRoom()">ترک بازی</button>
    `;
  }

  // Room info
  document.getElementById('room-info').textContent = 
    `روم ${room.room_code} • ${room.chambers} خان • ${room.loaded_count} تیر پر`;
}

function renderLives(count) {
  let html = '';
  for (let i = 0; i < 4; i++) {
    html += `<div class="life ${i < count ? '' : 'empty'}"></div>`;
  }
  return html;
}

function renderCylinder(room) {
  const cylinder = typeof room.cylinder === 'string' ? JSON.parse(room.cylinder) : room.cylinder;
  const chambers = room.chambers;
  const current = room.current_chamber % chambers;

  const el = document.getElementById('cylinder');
  el.innerHTML = '';
  el.style.transform = `rotate(${current * (360 / chambers)}deg)`;

  // Positions for up to 8 chambers
  const positions = [
    { top: '8%', left: '50%', transform: 'translateX(-50%)' },
    { top: '20%', right: '12%' },
    { top: '45%', right: '5%' },
    { bottom: '20%', right: '12%' },
    { bottom: '8%', left: '50%', transform: 'translateX(-50%)' },
    { bottom: '20%', left: '12%' },
    { top: '45%', left: '5%' },
    { top: '20%', left: '12%' }
  ];

  for (let i = 0; i < chambers; i++) {
    const ch = document.createElement('div');
    ch.className = 'chamber';
    if (cylinder[i]) ch.classList.add('loaded');
    if (i === current) ch.classList.add('current');
    Object.assign(ch.style, positions[i] || {});
    ch.textContent = i + 1;
    el.appendChild(ch);
  }
}

async function shoot(target) {
  if (!currentRoom || currentRoom.current_turn !== currentUser.id) return;
  if (currentRoom.status !== 'playing') return;

  const room = { ...currentRoom };
  const cylinder = typeof room.cylinder === 'string' ? JSON.parse(room.cylinder) : [...room.cylinder];
  const chambers = room.chambers;
  const idx = room.current_chamber % chambers;
  const isLoaded = cylinder[idx];

  // Visual feedback
  document.querySelector('.gun-area')?.classList.add('shoot-flash');
  setTimeout(() => document.querySelector('.gun-area')?.classList.remove('shoot-flash'), 400);

  const isP1 = room.player1_id === currentUser.id;
  let message = '';
  let keepTurn = false;

  if (isLoaded) {
    // HIT
    document.body.classList.add('shake');
    setTimeout(() => document.body.classList.remove('shake'), 500);

    if (target === 'self') {
      if (isP1) room.player1_lives--;
      else room.player2_lives--;
      message = '💥 تیر پر! یک جان از دست دادی';
    } else {
      if (isP1) room.player2_lives--;
      else room.player1_lives--;
      message = '💥 تیر پر به حریف خورد!';
    }
    // Always pass turn after hit
    room.current_turn = isP1 ? room.player2_id : room.player1_id;
  } else {
    // EMPTY
    if (target === 'self') {
      message = '😅 خالی بود! هنوز نوبت توست';
      keepTurn = true; // Keep turn as per user request
    } else {
      message = '😅 خالی بود! نوبت حریف';
      room.current_turn = isP1 ? room.player2_id : room.player1_id;
    }
  }

  // Advance chamber
  room.current_chamber = (room.current_chamber + 1) % chambers;

  // Check win
  let finished = false;
  if (room.player1_lives <= 0 || room.player2_lives <= 0) {
    finished = true;
    room.status = 'finished';
    room.finished_at = new Date().toISOString();
    if (room.player1_lives <= 0) {
      room.winner_id = room.player2_id;
    } else {
      room.winner_id = room.player1_id;
    }
  }

  // Update
  currentRoom = room;
  toast(message, isLoaded ? 'error' : 'info');

  if (DEMO_MODE) {
    const rooms = JSON.parse(localStorage.getItem('rr_rooms') || '[]');
    const idxR = rooms.findIndex(r => r.id === room.id);
    if (idxR >= 0) rooms[idxR] = room;
    localStorage.setItem('rr_rooms', JSON.stringify(rooms));
    renderGame();
    if (finished) endGame(room);
  } else {
    await sb.from('rooms').update({
      player1_lives: room.player1_lives,
      player2_lives: room.player2_lives,
      current_turn: room.current_turn,
      current_chamber: room.current_chamber,
      status: room.status,
      winner_id: room.winner_id,
      finished_at: room.finished_at
    }).eq('id', room.id);

    // Log
    await sb.from('game_logs').insert({
      room_id: room.id,
      player_id: currentUser.id,
      action: isLoaded ? (target === 'self' ? 'hit_self' : 'hit_opponent') : (target === 'self' ? 'empty_self' : 'empty_opponent'),
      details: { chamber: idx, target }
    });

    if (finished) {
      await updateStats(room);
      endGame(room);
    }
  }
}

async function updateStats(room) {
  if (DEMO_MODE) return;
  const winnerId = room.winner_id;
  const loserId = winnerId === room.player1_id ? room.player2_id : room.player1_id;

  // Winner
  const { data: winner } = await sb.from('profiles').select('*').eq('id', winnerId).single();
  if (winner) {
    await sb.from('profiles').update({
      wins: winner.wins + 1,
      total_games: winner.total_games + 1,
      xp: winner.xp + 50,
      rank_points: winner.rank_points + 25
    }).eq('id', winnerId);
  }

  // Loser
  const { data: loser } = await sb.from('profiles').select('*').eq('id', loserId).single();
  if (loser) {
    await sb.from('profiles').update({
      losses: loser.losses + 1,
      total_games: loser.total_games + 1,
      xp: Math.max(0, loser.xp + 10),
      rank_points: Math.max(0, loser.rank_points - 15)
    }).eq('id', loserId);
  }

  // Notifications
  await sb.from('notifications').insert([
    {
      user_id: winnerId,
      type: 'game_result',
      title: '🏆 بردی!',
      message: 'تبریک! در رولت روسی پیروز شدی و ۵۰ XP گرفتی',
      data: { room_id: room.id }
    },
    {
      user_id: loserId,
      type: 'game_result',
      title: '💀 باختی',
      message: 'این بار نشد... ۱۰ XP گرفتی. دوباره تلاش کن!',
      data: { room_id: room.id }
    }
  ]);
}

function endGame(room) {
  const isWinner = room.winner_id === currentUser.id;
  const modal = document.getElementById('result-modal');
  modal.classList.remove('hidden');
  modal.querySelector('.modal').className = `modal ${isWinner ? 'win' : 'lose'}`;
  modal.querySelector('h2').textContent = isWinner ? '🏆 بردی!' : '💀 باختی';
  modal.querySelector('p').textContent = isWinner 
    ? 'آفرین! حریفت رو شکست دادی. ۵۰ XP و ۲۵ رتبه گرفتی.'
    : 'این بار شانس با تو نبود. ۱۰ XP گرفتی. دوباره امتحان کن!';
  
  // Auto close room after delay in real mode
  setTimeout(() => {
    if (!DEMO_MODE) {
      sb.from('rooms').update({ status: 'closed' }).eq('id', room.id);
    }
  }, 5000);
}

function closeResultModal() {
  document.getElementById('result-modal').classList.add('hidden');
  leaveRoom();
}

async function leaveRoom() {
  if (roomChannel) {
    roomChannel.unsubscribe();
    roomChannel = null;
  }
  if (currentRoom && !DEMO_MODE && currentRoom.status === 'waiting' && currentRoom.player1_id === currentUser.id) {
    await sb.from('rooms').delete().eq('id', currentRoom.id);
  }
  currentRoom = null;
  navigateTo('home');
}

// Realtime room subscription
function subscribeToRoom(roomId) {
  if (DEMO_MODE || !sb) return;
  if (roomChannel) roomChannel.unsubscribe();

  roomChannel = sb.channel(`room:${roomId}`)
    .on('postgres_changes', {
      event: 'UPDATE',
      schema: 'public',
      table: 'rooms',
      filter: `id=eq.${roomId}`
    }, payload => {
      currentRoom = payload.new;
      renderGame();
      if (currentRoom.status === 'finished') {
        endGame(currentRoom);
      }
    })
    .subscribe();
}

// ========== NOTIFICATIONS ==========
function subscribeToNotifications() {
  if (DEMO_MODE || !sb || !currentUser) return;
  notifChannel = sb.channel(`user:${currentUser.id}:notifs`)
    .on('postgres_changes', {
      event: 'INSERT',
      schema: 'public',
      table: 'notifications',
      filter: `user_id=eq.${currentUser.id}`
    }, payload => {
      loadNotifications();
      const n = payload.new;
      if (n.type === 'duel_request') {
        showDuelRequest(n);
      } else {
        toast(n.title, 'info');
      }
    })
    .subscribe();
}

async function loadNotifications() {
  const badge = document.getElementById('notif-badge');
  const list = document.getElementById('notif-list');

  if (DEMO_MODE) {
    const notifs = JSON.parse(localStorage.getItem('rr_notifs_' + (currentUser?.id || '')) || '[]');
    const unread = notifs.filter(n => !n.is_read).length;
    badge.textContent = unread || '';
    badge.classList.toggle('hidden', !unread);
    list.innerHTML = notifs.length ? notifs.map(n => `
      <div class="notif-item ${n.is_read ? '' : 'unread'}">
        <div class="title">${n.title}</div>
        <div class="msg">${n.message}</div>
        <div class="time">${formatTime(n.created_at)}</div>
      </div>
    `).join('') : '<div class="text-center text-muted p-4">اعلانی نیست</div>';
    return;
  }

  const { data } = await sb.from('notifications')
    .select('*')
    .eq('user_id', currentUser.id)
    .order('created_at', { ascending: false })
    .limit(30);

  const unread = (data || []).filter(n => !n.is_read).length;
  badge.textContent = unread || '';
  badge.classList.toggle('hidden', !unread);

  list.innerHTML = (data || []).length ? data.map(n => `
    <div class="notif-item ${n.is_read ? '' : 'unread'}" onclick="markRead('${n.id}')">
      <div class="title">${n.title}</div>
      <div class="msg">${n.message}</div>
      <div class="time">${formatTime(n.created_at)}</div>
    </div>
  `).join('') : '<div class="text-center text-muted p-4">اعلانی نیست</div>';
}

function toggleNotifPanel() {
  document.getElementById('notif-panel').classList.toggle('hidden');
  loadNotifications();
}

async function markRead(id) {
  if (!DEMO_MODE) {
    await sb.from('notifications').update({ is_read: true }).eq('id', id);
  }
  loadNotifications();
}

function showDuelRequest(notif) {
  const data = typeof notif.data === 'string' ? JSON.parse(notif.data) : notif.data;
  const modal = document.getElementById('duel-modal');
  modal.classList.remove('hidden');
  modal.querySelector('.duel-from').textContent = data.from_username || 'بازیکن';
  modal.querySelector('.duel-accept').onclick = () => acceptDuel(data.room_id, notif.id);
  modal.querySelector('.duel-decline').onclick = () => declineDuel(notif.id);
}

async function acceptDuel(roomId, notifId) {
  document.getElementById('duel-modal').classList.add('hidden');
  await markRead(notifId);
  await joinRoom(roomId);
}

async function declineDuel(notifId) {
  document.getElementById('duel-modal').classList.add('hidden');
  await markRead(notifId);
  toast('درخواست دوئل رد شد', 'info');
}

// ========== PROFILE ==========
function loadProfile(user) {
  if (!user) return;
  document.getElementById('profile-avatar').textContent = (user.display_name || user.username)[0].toUpperCase();
  document.getElementById('profile-name').textContent = user.display_name || user.username;
  document.getElementById('profile-username').textContent = '@' + user.username;
  document.getElementById('profile-title').textContent = user.title || 'تازه‌کار';
  document.getElementById('profile-level').textContent = user.level || 1;
  document.getElementById('profile-xp').textContent = user.xp || 0;
  document.getElementById('profile-wins').textContent = user.wins || 0;
  document.getElementById('profile-losses').textContent = user.losses || 0;
  document.getElementById('profile-games').textContent = user.total_games || 0;
  document.getElementById('profile-rank').textContent = user.rank_points || 1000;

  // XP bar (simple: next level at level^2 * 100)
  const level = user.level || 1;
  const currentLevelXp = (level - 1) * (level - 1) * 100;
  const nextLevelXp = level * level * 100;
  const progress = Math.min(100, ((user.xp - currentLevelXp) / (nextLevelXp - currentLevelXp)) * 100);
  document.getElementById('xp-fill').style.width = progress + '%';
  document.getElementById('xp-text').textContent = `${user.xp || 0} / ${nextLevelXp} XP`;
}

async function loadLeaderboard() {
  const list = document.getElementById('leader-list');
  list.innerHTML = '<div class="text-center text-muted p-4">بارگذاری...</div>';

  if (DEMO_MODE) {
    const users = Object.values(JSON.parse(localStorage.getItem('rr_users') || '{}'));
    users.sort((a, b) => (b.rank_points || 0) - (a.rank_points || 0));
    renderLeaderboard(users.slice(0, 20));
  } else {
    const { data } = await sb.from('profiles')
      .select('id, username, display_name, title, level, wins, rank_points, xp')
      .order('rank_points', { ascending: false })
      .limit(20);
    renderLeaderboard(data || []);
  }
}

function renderLeaderboard(users) {
  const list = document.getElementById('leader-list');
  if (!users.length) {
    list.innerHTML = '<div class="text-center text-muted p-4">هنوز کسی بازی نکرده</div>';
    return;
  }
  list.innerHTML = users.map((u, i) => `
    <div class="leader-item" onclick="viewProfile('${u.id}')">
      <div class="leader-rank ${i === 0 ? 'top1' : i === 1 ? 'top2' : i === 2 ? 'top3' : ''}">${i + 1}</div>
      <div style="flex:1">
        <div style="font-weight:700">${u.display_name || u.username}</div>
        <div class="text-muted" style="font-size:0.8rem">${u.title} • لول ${u.level}</div>
      </div>
      <div style="text-align:left">
        <div style="font-weight:700;color:var(--gold)">${u.rank_points}</div>
        <div class="text-muted" style="font-size:0.75rem">${u.wins} برد</div>
      </div>
    </div>
  `).join('');
}

async function viewProfile(userId) {
  if (DEMO_MODE) {
    const users = Object.values(JSON.parse(localStorage.getItem('rr_users') || '{}'));
    const u = users.find(x => x.id === userId);
    if (u) {
      loadProfile(u);
      navigateTo('profile');
    }
  } else {
    const { data } = await sb.from('profiles').select('*').eq('id', userId).single();
    if (data) {
      loadProfile(data);
      navigateTo('profile');
    }
  }
}

function loadSettings() {
  if (!currentUser) return;
  document.getElementById('settings-displayname').value = currentUser.display_name || '';
  document.getElementById('settings-bio').value = currentUser.bio || '';
}

async function saveSettings() {
  const displayName = document.getElementById('settings-displayname').value.trim();
  const bio = document.getElementById('settings-bio').value.trim();
  showLoading(true);
  try {
    if (DEMO_MODE) {
      currentUser.display_name = displayName;
      currentUser.bio = bio;
      localStorage.setItem('rr_user', JSON.stringify(currentUser));
      const users = JSON.parse(localStorage.getItem('rr_users') || '{}');
      if (users[currentUser.username]) {
        users[currentUser.username].display_name = displayName;
        users[currentUser.username].bio = bio;
        localStorage.setItem('rr_users', JSON.stringify(users));
      }
    } else {
      await sb.from('profiles').update({ display_name: displayName, bio }).eq('id', currentUser.id);
      currentUser.display_name = displayName;
      currentUser.bio = bio;
      localStorage.setItem('rr_user', JSON.stringify(currentUser));
    }
    updateNavbar();
    toast('تنظیمات ذخیره شد', 'success');
  } catch (err) {
    toast('خطا در ذخیره', 'error');
  }
  showLoading(false);
}

// ========== HELPERS ==========
function toast(msg, type = 'info') {
  const container = document.getElementById('toast-container');
  const el = document.createElement('div');
  el.className = `toast ${type}`;
  el.textContent = msg;
  container.appendChild(el);
  setTimeout(() => el.remove(), 3500);
}

function showLoading(show) {
  document.getElementById('loading').classList.toggle('hidden', !show);
}

function formatTime(iso) {
  if (!iso) return '';
  const d = new Date(iso);
  const now = new Date();
  const diff = (now - d) / 1000;
  if (diff < 60) return 'همین الان';
  if (diff < 3600) return Math.floor(diff / 60) + ' دقیقه پیش';
  if (diff < 86400) return Math.floor(diff / 3600) + ' ساعت پیش';
  return d.toLocaleDateString('fa-IR');
}

async function updateOnlineStatus(online) {
  if (DEMO_MODE || !currentUser) return;
  await sb.from('profiles').update({ 
    is_online: online, 
    last_online: new Date().toISOString() 
  }).eq('id', currentUser.id);
}

// Challenge player (extra feature)
async function challengePlayer(username) {
  // Simplified: create room and send notif
  toast('قابلیت چالش به زودی کامل می‌شود', 'info');
}

// Make functions global for onclick
window.joinRoom = joinRoom;
window.shoot = shoot;
window.leaveRoom = leaveRoom;
window.closeResultModal = closeResultModal;
window.markRead = markRead;
window.viewProfile = viewProfile;
window.saveSettings = saveSettings;
window.acceptDuel = acceptDuel;
window.declineDuel = declineDuel;
