/* ════════════════════════════════════════════════════
   IMPOSTER — Frontend Game Logic
════════════════════════════════════════════════════ */

const socket = io();

// ── State ───────────────────────────────────────────────────────
const state = {
  myName:           '',
  roomCode:         '',
  isHost:           false,
  isImposter:       false,
  selectedCategory: null,
  players:          [],
  hasRevealedRole:  false,
  category:         ''
};

// ── Utility: Screen Management ──────────────────────────────────
function showScreen(id) {
  document.querySelectorAll('.screen').forEach(s => s.classList.remove('active'));
  document.getElementById(id).classList.add('active');
  window.scrollTo({ top: 0, behavior: 'smooth' });
}

function showToast(msg, type = '') {
  const toast = document.getElementById('toast');
  toast.textContent = msg;
  toast.className = `toast ${type}`;
  clearTimeout(toast._timer);
  toast._timer = setTimeout(() => { toast.className = 'toast hidden'; }, 3000);
}

function esc(str) {
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

// ── URL: pre-fill room code from ?room= param ───────────────────
window.addEventListener('DOMContentLoaded', () => {
  const params = new URLSearchParams(window.location.search);
  const room = params.get('room');
  if (room) {
    document.getElementById('room-code-input').value = room.toUpperCase();
    document.getElementById('player-name').focus();
  }
});

// ════════════════════════════════════════════════════
// HOME SCREEN
// ════════════════════════════════════════════════════

function createRoom() {
  const name = document.getElementById('player-name').value.trim();
  if (!name) return showToast('Enter your name first!', 'error');
  state.myName = name;
  socket.emit('create-room', { playerName: name });
}

function joinRoom() {
  const name = document.getElementById('player-name').value.trim();
  const code = document.getElementById('room-code-input').value.trim().toUpperCase();
  if (!name) return showToast('Enter your name first!', 'error');
  if (code.length < 6) return showToast('Enter the full 6-character room code.', 'error');
  state.myName = name;
  socket.emit('join-room', { roomCode: code, playerName: name });
}

// ════════════════════════════════════════════════════
// LOBBY
// ════════════════════════════════════════════════════

function enterLobby({ roomCode, players, categories, isHost }) {
  state.roomCode  = roomCode;
  state.isHost    = isHost;
  state.players   = players;
  state.selectedCategory = null;

  document.getElementById('display-room-code').textContent = roomCode;

  renderPlayerList('player-list', players);
  document.getElementById('player-count').textContent = players.length;

  if (isHost) {
    document.getElementById('host-controls').classList.remove('hidden');
    document.getElementById('waiting-msg').classList.add('hidden');
    buildCategoryGrid(categories);
    updateStartButton();
  } else {
    document.getElementById('host-controls').classList.add('hidden');
    document.getElementById('waiting-msg').classList.remove('hidden');
  }

  showScreen('screen-lobby');
}

function renderPlayerList(listId, players) {
  const ul = document.getElementById(listId);
  if (!ul) return;
  ul.innerHTML = '';

  players.forEach(p => {
    const li = document.createElement('li');

    // Avatar
    const av = document.createElement('div');
    av.className = 'player-avatar';
    av.textContent = p.name.charAt(0).toUpperCase();
    li.appendChild(av);

    // Name
    const nm = document.createElement('span');
    nm.className = 'player-name-text';
    nm.textContent = p.name;
    li.appendChild(nm);

    // Host badge
    if (p.isHost) {
      const hb = document.createElement('span');
      hb.className = 'player-badge';
      hb.textContent = 'Host';
      li.appendChild(hb);
    }

    // "You" badge
    if (p.name === state.myName) {
      const yb = document.createElement('span');
      yb.className = 'player-badge you-badge';
      yb.textContent = 'You';
      li.appendChild(yb);
    }

    ul.appendChild(li);
  });
}

function buildCategoryGrid(categories) {
  const grid = document.getElementById('category-grid');
  grid.innerHTML = '';
  categories.forEach(cat => {
    const btn = document.createElement('button');
    btn.className = 'category-btn';
    btn.textContent = cat;
    btn.dataset.category = cat;
    btn.addEventListener('click', () => selectCategory(cat));
    grid.appendChild(btn);
  });
}

function selectCategory(cat) {
  state.selectedCategory = cat;
  document.querySelectorAll('.category-btn').forEach(b => {
    b.classList.toggle('selected', b.dataset.category === cat);
  });
  updateStartButton();
}

function updateStartButton() {
  const btn  = document.getElementById('start-btn');
  const hint = document.getElementById('start-hint');
  if (!btn) return;

  const enoughPlayers = state.players.length >= 2;
  const hasCat        = !!state.selectedCategory;

  btn.disabled = !(enoughPlayers && hasCat);

  if (!enoughPlayers)       hint.textContent = 'Need at least 2 players';
  else if (!hasCat)         hint.textContent = 'Select a category to begin';
  else                      hint.textContent = `${state.players.length} players • Ready!`;
}

function startGame() {
  if (!state.selectedCategory) return showToast('Pick a category first!', 'error');
  socket.emit('start-game', { category: state.selectedCategory });
}

function shareRoom() {
  const url = `${window.location.origin}${window.location.pathname}?room=${state.roomCode}`;
  if (navigator.share) {
    navigator.share({ title: 'Join my Imposter game!', url }).catch(() => copyToClipboard(url));
  } else {
    copyToClipboard(url);
  }
}

function copyToClipboard(text) {
  navigator.clipboard.writeText(text)
    .then(() => showToast('Link copied to clipboard!', 'success'))
    .catch(() => showToast('Copy failed — share the code manually.', 'error'));
}

// ════════════════════════════════════════════════════
// ROLE REVEAL
// ════════════════════════════════════════════════════

function enterRoleReveal(category) {
  state.category       = category;
  state.hasRevealedRole = false;
  state.isImposter     = false;

  document.getElementById('reveal-category').textContent = category;

  // Reset to "hidden" state
  document.getElementById('role-hidden').classList.remove('hidden');
  document.getElementById('role-shown').classList.add('hidden');
  document.getElementById('role-imposter').classList.add('hidden');
  document.getElementById('role-innocent').classList.add('hidden');
  document.getElementById('proceed-wrap').classList.add('hidden');

  showScreen('screen-role-reveal');
}

function revealRole() {
  socket.emit('get-my-role');
}

function displayRole({ isImposter, word }) {
 function displayRole({ isImposter, word }) {
  console.log('Role received:', isImposter, word); // add this
  ...
  state.isImposter     = isImposter;
  state.hasRevealedRole = true;

  // Swap hidden → shown
  document.getElementById('role-hidden').classList.add('hidden');
  document.getElementById('role-shown').classList.remove('hidden');

  if (isImposter) {
    document.getElementById('role-imposter').classList.remove('hidden');
    document.getElementById('role-innocent').classList.add('hidden');
  } else {
    document.getElementById('role-imposter').classList.add('hidden');
    document.getElementById('role-innocent').classList.remove('hidden');
    document.getElementById('secret-word-display').textContent = word;
  }

  // Show the "Continue" button
  document.getElementById('proceed-wrap').classList.remove('hidden');
}

function hideRole() {
  document.getElementById('role-hidden').classList.remove('hidden');
  document.getElementById('role-shown').classList.add('hidden');
  // proceed-wrap stays visible after first reveal
}

function proceedToGame() {
  enterPlayingScreen();
}

// ════════════════════════════════════════════════════
// PLAYING SCREEN
// ════════════════════════════════════════════════════

function enterPlayingScreen() {
  document.getElementById('playing-category').textContent = state.category;

  renderPlayerList('playing-player-list', state.players);
  document.getElementById('playing-player-count').textContent = state.players.length;

  const imposterControls  = document.getElementById('imposter-controls');
  const hostEndControls   = document.getElementById('host-end-controls');

  if (state.isImposter) {
    imposterControls.classList.remove('hidden');
    hostEndControls.classList.add('hidden');
  } else if (state.isHost) {
    imposterControls.classList.add('hidden');
    hostEndControls.classList.remove('hidden');
  } else {
    imposterControls.classList.add('hidden');
    hostEndControls.classList.add('hidden');
  }

  showScreen('screen-playing');
}

function confirmEndGame() {
  if (confirm('End the game now and reveal the Imposter to everyone?')) {
    socket.emit('end-game');
  }
}

// ════════════════════════════════════════════════════
// END SCREEN
// ════════════════════════════════════════════════════

function showEndScreen({ secretWord, imposterName, category }) {
  document.getElementById('end-category').textContent     = category;
  document.getElementById('end-word').textContent         = secretWord;
  document.getElementById('end-imposter-name').textContent = imposterName;

  if (state.isHost) {
    document.getElementById('host-play-again').classList.remove('hidden');
    document.getElementById('player-waiting-again').classList.add('hidden');
  } else {
    document.getElementById('host-play-again').classList.add('hidden');
    document.getElementById('player-waiting-again').classList.remove('hidden');
  }

  showScreen('screen-end');
}

function playAgain() {
  socket.emit('play-again');
}

// ════════════════════════════════════════════════════
// SOCKET EVENTS
// ════════════════════════════════════════════════════

socket.on('room-created', (data) => {
  enterLobby({ ...data, isHost: true });
});

socket.on('room-joined', (data) => {
  enterLobby({ ...data, isHost: false });
});

socket.on('players-updated', ({ players }) => {
  state.players = players;

  // Update lobby if visible
  renderPlayerList('player-list', players);
  document.getElementById('player-count').textContent = players.length;
  updateStartButton();

  // Update playing screen if visible
  if (document.getElementById('screen-playing').classList.contains('active')) {
    renderPlayerList('playing-player-list', players);
    document.getElementById('playing-player-count').textContent = players.length;
  }

  // Check if I'm now the host (host transferred on disconnect)
  const myPlayer = players.find(p => p.name === state.myName);
  if (myPlayer && myPlayer.isHost && !state.isHost) {
    state.isHost = true;
    showToast('You are now the host!', 'success');
    // Rebuild host controls if in lobby
    if (document.getElementById('screen-lobby').classList.contains('active')) {
      document.getElementById('host-controls').classList.remove('hidden');
      document.getElementById('waiting-msg').classList.add('hidden');
    }
  }
});

socket.on('game-started', ({ category }) => {
  state.category = category;
  if (!state.selectedCategory) state.selectedCategory = category; // sync non-host
  enterRoleReveal(category);
});

socket.on('your-role', (role) => {
  displayRole(role);
});

socket.on('game-ended', (data) => {
  showEndScreen(data);
});

socket.on('reset-game', ({ players, categories }) => {
  state.players         = players;
  state.isImposter      = false;
  state.hasRevealedRole = false;
  state.selectedCategory = null;

  const myPlayer = players.find(p => p.name === state.myName);
  state.isHost = myPlayer ? myPlayer.isHost : false;

  enterLobby({
    roomCode:   state.roomCode,
    players,
    categories,
    isHost:     state.isHost
  });
});

socket.on('game-error', ({ message }) => {
  showToast(message, 'error');
});

socket.on('disconnect', () => {
  showToast('Disconnected from server. Refresh to reconnect.', 'error');
});
