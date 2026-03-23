// ============================================================
// TX42-Client — multiplayer.js
// Thin multiplayer WebSocket client for TX42 server
// Server is source of truth — client sends intents, receives confirmations
// ============================================================

// --- Multiplayer WebSocket Mode ---
// MP global variables are declared in game.js (loaded first)
// Only constants and MP-only variables declared here
function mpPlayerCount(){ return 4; } // TX42-Client: always 4 players
function mpMaxPip(){ return 6; }     // TX42-Client: double-6 set
function mpHandSize(){ return 7; }   // TX42-Client: 7 tiles per hand
const MP_WS_URL = 'wss://tx42-server.onrender.com';  // TX42-Client: new server
const MP_VERSION = 'v1.0.0-TX42';  // TX42-Client version

// ═══════════════════════════════════════════════════════════════
// V10_FIX: Multiplayer Sync Fix Variables
// ═══════════════════════════════════════════════════════════════
let _biddingCompleting = false;    // FIX1: Prevents double-advance during bidding completion
let _aiActionInProgress = false;   // FIX3: Prevents overlapping AI actions
let _aiActionTimer = null;         // FIX3: Track current AI timer for cleanup
let _allAITimers = [];             // FIX5: Track all AI timers for cleanup

// V10_113: Connection stability — heartbeat & reconnection
let _mpHeartbeatInterval = null;  // Interval ID for ping heartbeat
let _mpLastPongTime = Date.now(); // Track last pong received
let _mpReconnectAttempts = 0;     // Reconnection retry counter
const MP_HEARTBEAT_INTERVAL = 15000;  // Send ping every 15s
const MP_PONG_TIMEOUT = 30000;       // Consider dead if no activity in 30s
// V10_122: UNLIMITED reconnection attempts with capped exponential backoff
const MP_RECONNECT_DELAYS = [2000, 5000, 10000, 20000, 30000]; // Exponential backoff: 2s, 5s, 10s, 20s, 30s (max)

// V10_113: Diagnostic logging system
const _mpDiagLog = [];
const MP_DIAG_MAX_ENTRIES = 2000;

function mpLogEntry(direction, category, data, extra) {
  if(_mpDiagLog.length >= MP_DIAG_MAX_ENTRIES) _mpDiagLog.shift();
  const entry = {
    t: Date.now(), ts: new Date().toISOString().substr(11, 12),
    dir: direction, cat: category, data: data,
    seat: typeof mpSeat !== 'undefined' ? mpSeat : -1,
    host: typeof mpIsHost !== 'undefined' ? mpIsHost : false,
    phase: session ? session.phase : '?',
    cp: session && session.game ? session.game.current_player : '?',
    trick: session && session.game ? session.game.trick_number : '?'
  };
  if(extra) entry.extra = extra;
  _mpDiagLog.push(entry);
}

// V10_115: current_player change tracker — logs every cp change with source
let _cpTracker = { lastCp: -1, lastPhase: '?' };
function _trackCpChange(source) {
  try { if(!session || !session.game) return; } catch(e) { return; } // V10_115: Guard against TDZ during init
  const cp = session.game.current_player;
  const phase = session.phase;
  if(cp !== _cpTracker.lastCp || phase !== _cpTracker.lastPhase) {
    const msg = source + ': cp ' + _cpTracker.lastCp + '→' + cp + ' phase=' + phase;
    console.log('[CP-TRACK]', msg);
    mpLogEntry('STATE', 'cp-change', msg);
    _cpTracker.lastCp = cp;
    _cpTracker.lastPhase = phase;
  }
}

// V10_115: Bidding timer tracking — so we can cancel stale timers
let _biddingTimerIds = [];
function _addBiddingTimer(id) { _biddingTimerIds.push(id); }
function _clearBiddingTimers() {
  _biddingTimerIds.forEach(id => clearTimeout(id));
  _biddingTimerIds = [];
}

// V10_115: Turn recovery timer — re-enables clicks if our turn but player hasn't played
let _turnRecoveryTimer = null;
function _startTurnRecovery() {
  if(_turnRecoveryTimer) clearTimeout(_turnRecoveryTimer);
  _turnRecoveryTimer = setTimeout(() => {
    if(!session || !MULTIPLAYER_MODE || session.phase !== PHASE_PLAYING) return;
    if(session.game.current_player === mpSeat && !isAnimating) {
      console.log('[MP] Turn recovery — re-enabling clicks after 8s');
      mpLogEntry('STATE', 'turn-recovery', 'Re-enabling clicks cp=' + session.game.current_player + ' mpSeat=' + mpSeat);
      waitingForPlayer1 = true;
      enablePlayer1Clicks();
      updatePlayer1ValidStates();
      showHint();
      setStatus('Trick ' + (session.game.trick_number + 1) + ' - Click a domino to play');
      mpHideWaiting();
    }
  }, 8000);
}

function mpGetGameSnapshot() {
  if(!session || !session.game) return { noSession: true };
  return {
    phase: session.phase,
    currentPlayer: session.game.current_player,
    trickNumber: session.game.trick_number,
    activePlayers: session.game.active_players ? session.game.active_players.slice() : [],
    playedThisTrick: session.game.playedThisTrick ? session.game.playedThisTrick.map(t => t ? [t[0],t[1]] : null) : [],
    handSizes: session.game.hands ? session.game.hands.map(h => h ? h.length : 0) : [],
    teamMarks: session.team_marks ? session.team_marks.slice() : [],
    bidWinner: session.bid_winner_seat,
    trump: session.game.trump,
    contract: session.game.contract,
    mpSeat: mpSeat,
    mpIsHost: mpIsHost,
    mpConnected: mpConnected,
    mpWaitingForRemote: mpWaitingForRemote,
    socketState: mpSocket ? mpSocket.readyState : -1
  };
}

function mpExportDiagLog() {
  if(_mpDiagLog.length === 0) { alert('No MP diagnostic entries to export.'); return; }
  let txt = '=== TN51/TX42 MP Diagnostic Log ===\n';
  txt += 'Exported: ' + new Date().toISOString() + '\n';
  txt += 'Version: ' + MP_VERSION + '\n';
  txt += 'Seat: ' + mpSeat + ' | Host: ' + mpIsHost + ' | Room: ' + (mpRoom || '?') + '\n';
  txt += 'Entries: ' + _mpDiagLog.length + '\n';
  txt += '========================================\n\n';
  for(let i = 0; i < _mpDiagLog.length; i++) {
    const e = _mpDiagLog[i];
    txt += '[' + e.ts + '] ' + e.dir + ' | ' + e.cat;
    txt += ' | phase=' + e.phase + ' cp=' + e.cp + ' trick=' + e.trick;
    txt += ' | ' + (typeof e.data === 'string' ? e.data : JSON.stringify(e.data)) + '\n';
    if(e.extra) txt += '  SNAPSHOT: ' + JSON.stringify(e.extra) + '\n';
  }
  // Show in a modal with copy button
  let overlay = document.getElementById('mpLogOverlay');
  if(!overlay) {
    overlay = document.createElement('div');
    overlay.id = 'mpLogOverlay';
    overlay.style.cssText = 'position:fixed;top:0;left:0;width:100%;height:100%;background:rgba(0,0,0,0.85);z-index:99999;display:flex;flex-direction:column;align-items:center;justify-content:center;padding:20px;box-sizing:border-box;';
    const ta = document.createElement('textarea');
    ta.id = 'mpLogTextarea';
    ta.style.cssText = 'width:100%;max-width:600px;height:60vh;background:#1a1a2e;color:#0f0;font-family:monospace;font-size:11px;border:1px solid #333;border-radius:8px;padding:12px;resize:none;';
    ta.readOnly = true;
    const btnRow = document.createElement('div');
    btnRow.style.cssText = 'display:flex;gap:10px;margin-top:12px;';
    const copyBtn = document.createElement('button');
    copyBtn.textContent = 'Copy to Clipboard';
    copyBtn.style.cssText = 'padding:10px 24px;background:#22c55e;color:#fff;border:none;border-radius:6px;font-size:14px;font-weight:bold;cursor:pointer;';
    copyBtn.addEventListener('click', () => {
      const t = document.getElementById('mpLogTextarea');
      t.select(); t.setSelectionRange(0, 999999);
      navigator.clipboard.writeText(t.value).then(() => {
        copyBtn.textContent = 'Copied!';
        copyBtn.style.background = '#16a34a';
        setTimeout(() => { copyBtn.textContent = 'Copy to Clipboard'; copyBtn.style.background = '#22c55e'; }, 2000);
      }).catch(() => { document.execCommand('copy'); copyBtn.textContent = 'Copied!'; setTimeout(() => { copyBtn.textContent = 'Copy to Clipboard'; }, 2000); });
    });
    // V10_121d: Save as .txt file button
    const saveBtn = document.createElement('button');
    saveBtn.textContent = 'Save as File';
    saveBtn.style.cssText = 'padding:10px 24px;background:#3b82f6;color:#fff;border:none;border-radius:6px;font-size:14px;font-weight:bold;cursor:pointer;';
    saveBtn.addEventListener('click', () => {
      try {
        const t = document.getElementById('mpLogTextarea');
        const blob = new Blob([t.value], { type: 'text/plain' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        const now = new Date();
        const ts = now.toISOString().replace(/[:.]/g, '-').slice(0, 19);
        a.href = url;
        a.download = 'MP_Log_' + (mpIsHost ? 'Host' : 'Guest') + '_' + ts + '.txt';
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        URL.revokeObjectURL(url);
        saveBtn.textContent = 'Saved!';
        saveBtn.style.background = '#2563eb';
        setTimeout(() => { saveBtn.textContent = 'Save as File'; saveBtn.style.background = '#3b82f6'; }, 2000);
      } catch(e) {
        console.error('Save log error:', e);
        saveBtn.textContent = 'Save failed';
        setTimeout(() => { saveBtn.textContent = 'Save as File'; }, 2000);
      }
    });
    const closeBtn = document.createElement('button');
    closeBtn.textContent = 'Close';
    closeBtn.style.cssText = 'padding:10px 24px;background:#ef4444;color:#fff;border:none;border-radius:6px;font-size:14px;font-weight:bold;cursor:pointer;';
    closeBtn.addEventListener('click', () => { overlay.style.display = 'none'; });
    btnRow.appendChild(copyBtn);
    btnRow.appendChild(saveBtn);
    btnRow.appendChild(closeBtn);
    overlay.appendChild(ta);
    overlay.appendChild(btnRow);
    document.body.appendChild(overlay);
  }
  document.getElementById('mpLogTextarea').value = txt;
  overlay.style.display = 'flex';
}

// Win/loss tally and observer globals declared in game.js

// V10_113: Start heartbeat ping interval
function mpStartHeartbeat() {
  mpStopHeartbeat();
  _mpLastPongTime = Date.now();
  _mpHeartbeatInterval = setInterval(() => {
    if(!mpSocket || mpSocket.readyState !== WebSocket.OPEN) return;
    // Check if we missed a pong (connection dead but not closed)
    const timeSincePong = Date.now() - _mpLastPongTime;
    if(timeSincePong > MP_PONG_TIMEOUT){
      console.log('[MP] Heartbeat: no pong for', Math.round(timeSincePong/1000), 's — connection likely dead');
      mpLogEntry('ERROR', 'heartbeat', 'No pong for ' + Math.round(timeSincePong/1000) + 's — closing socket', mpGetGameSnapshot());
      mpSocket.close(); // Will trigger onclose → auto-reconnect
      return;
    }
    // Send ping as a game move (goes through relay to peers, who respond)
    // Also try direct server ping in case server supports it
    try {
      mpSocket.send(JSON.stringify({ type: 'ping', t: Date.now() }));
      mpSocket.send(JSON.stringify({ type: 'move', move: { action: 'heartbeat', seat: mpSeat, t: Date.now() } }));
    } catch(e) {
      console.log('[MP] Heartbeat send error:', e);
    }
  }, MP_HEARTBEAT_INTERVAL);
}

// V10_113: Stop heartbeat
function mpStopHeartbeat() {
  if(_mpHeartbeatInterval) {
    clearInterval(_mpHeartbeatInterval);
    _mpHeartbeatInterval = null;
  }
}

// V10_122: Get reconnect delay with exponential backoff (capped at 30s)
function mpGetReconnectDelay() {
  const idx = Math.min(_mpReconnectAttempts, MP_RECONNECT_DELAYS.length - 1);
  return MP_RECONNECT_DELAYS[idx];
}

// Multiplayer: Connect to relay server
function mpConnect(roomName) {
  // V10_104: If we already have an open socket (from status polling), reuse it
  if (mpSocket && mpSocket.readyState === WebSocket.OPEN) {
    mpRoom = roomName;
    mpConnected = false;
    _mpReconnectAttempts = 0; // V10_113: Reset on successful reuse
    mpUpdateStatus('Joining room...', '#f59e0b');
    try {
      mpSocket.send(JSON.stringify({ type: 'join', room: roomName, name: playerName || 'Player', playerId: mpPlayerId || undefined }));
    } catch(e) {
      console.error('[MP] Join send error:', e);
      mpSocket.close(); // Trigger reconnect
    }
    return;
  }
  if (mpSocket && mpSocket.readyState <= 1) {
    mpSocket.close();
  }
  mpStopHeartbeat(); // V10_113: Stop old heartbeat
  mpRoom = roomName;
  mpConnected = false;
  mpUpdateStatus('Connecting...', '#f59e0b');

  mpSocket = new WebSocket(MP_WS_URL);

  mpSocket.onopen = () => {
    console.log('[MP] WebSocket opened, joining room:', roomName);
    _mpReconnectAttempts = 0; // V10_113: Reset on successful connection
    try {
      mpSocket.send(JSON.stringify({ type: 'join', room: roomName, name: playerName || 'Player', playerId: mpPlayerId || undefined }));
    } catch(e) {
      console.error('[MP] Join send error on open:', e);
      mpSocket.close(); // Trigger reconnect
      return;
    }
    mpStartHeartbeat(); // V10_113: Begin heartbeat
    mpLogEntry('INFO', 'socket', 'WebSocket opened, joining ' + roomName);
  };

  mpSocket.onmessage = (evt) => {
    let msg;
    try { msg = JSON.parse(evt.data); } catch(e) { return; }
    // V10_113: Any message from server counts as a pong (connection alive)
    _mpLastPongTime = Date.now();
    // V10_113: Don't log pong responses (noise)
    if(msg.type === 'pong') return;
    console.log('[MP] Received:', msg);
    // V10_113: Diagnostic log — capture all received messages
    if(msg.type === 'move' && msg.move) {
      mpLogEntry('RECV', msg.move.action || 'move', msg.move);
    } else {
      mpLogEntry('RECV', msg.type || 'unknown', msg);
    }
    mpHandleMessage(msg);
  };

  mpSocket.onclose = (evt) => {
    console.log('[MP] WebSocket closed:', evt.code, evt.reason);
    mpLogEntry('INFO', 'socket', 'WebSocket closed code=' + evt.code + ' reason=' + (evt.reason || 'none'), mpGetGameSnapshot());
    mpConnected = false;
    mpStatusRequested = false;
    mpStopHeartbeat(); // V10_113: Stop heartbeat
    mpUpdateStatus('Disconnected', '#ef4444');
    mpUpdateIndicator();
    // V10_104: Remove observer panel on disconnect
    const obsPanel = document.getElementById('mpObserverPanel');
    if (obsPanel && typeof obsPanel.remove === 'function') obsPanel.remove();
    mpObserver = false;
    // Save host state on disconnect for potential recovery
    if (mpIsHost && mpGameStarted) mpSaveHostState();
    // V11.3: Auto-reconnect with exponential backoff, capped at 50 attempts to save battery
    if (MULTIPLAYER_MODE && mpGameStarted && mpRoom) {
      if(_mpReconnectAttempts < 50) {
        const delay = mpGetReconnectDelay();
        _mpReconnectAttempts++;
        console.log('[MP] Auto-reconnect attempt', _mpReconnectAttempts, '/50 in', delay, 'ms');
        mpLogEntry('INFO', 'reconnect', 'Attempt ' + _mpReconnectAttempts + '/50 delay=' + delay + 'ms');
        mpUpdateStatus('Reconnecting (' + _mpReconnectAttempts + '/50)...', '#f59e0b');
        setTimeout(() => mpConnect(mpRoom), delay);
      } else {
        console.log('[MP] Max reconnect attempts (50) reached');
        mpLogEntry('ERROR', 'reconnect', 'Max reconnect attempts reached');
        mpUpdateStatus('Connection lost. Tap Sync to retry.', '#ef4444');
        setStatus('Connection lost — tap the Sync button to reconnect.');
      }
    }
  };

  mpSocket.onerror = (err) => {
    console.log('[MP] WebSocket error:', err);
    mpLogEntry('ERROR', 'socket', 'WebSocket error');
    mpUpdateStatus('Connection error', '#ef4444');
  };
}

// ═══════════════════════════════════════════════════════════════
// V10_FIX: Helper Functions for Sync Fixes
// ═══════════════════════════════════════════════════════════════

// FIX4: Show/hide syncing overlay to block input during state_sync
function showSyncingOverlay() {
  const overlay = document.getElementById('syncingOverlay');
  if (overlay) {
    overlay.style.display = 'flex';
    overlay._shownAt = Date.now(); // V10_122e: Track when shown for global failsafe
    console.log('[FIX4] Syncing overlay shown - input blocked');
  }
}

function hideSyncingOverlay() {
  const overlay = document.getElementById('syncingOverlay');
  if (overlay) {
    overlay.style.display = 'none';
    overlay._shownAt = null; // V10_122e: Clear timestamp
    console.log('[FIX4] Syncing overlay hidden - input enabled');
  }
}

// FIX5: Clear all AI timers to prevent stale actions
function _clearAllAITimers() {
  console.log('[FIX5] Clearing', _allAITimers.length, 'AI timers');
  _allAITimers.forEach(timer => clearTimeout(timer));
  _allAITimers = [];
  _aiActionInProgress = false; // Also release AI lock
  if (_aiActionTimer) {
    clearTimeout(_aiActionTimer);
    _aiActionTimer = null;
  }
}

// Handle incoming WebSocket messages
function mpHandleMessage(msg) {
  // V10_113: Track activity on ALL message types (not just moves)
  _mpLastActivityTime = Date.now();

  // V10_104: Room status response — update room buttons
  if (msg.type === 'room_status') {
    mpRoomCounts = {};
    if (msg.rooms && Array.isArray(msg.rooms)) {
      msg.rooms.forEach(r => {
        mpRoomCounts[r.room] = { count: r.count, max: r.max, observers: r.observers || 0 };
      });
    }
    mpUpdateRoomButtons();
    return;
  }

  // V10_104: Live room update from lobby
  if (msg.type === 'room_update') {
    mpRoomCounts[msg.room] = { count: msg.count, max: msg.max, observers: msg.observers || 0 };
    mpUpdateRoomButtons();
    return;
  }

  // V10_104: Peer left notification (update room counts)
  if (msg.type === 'peer_left') {
    if (msg.room && msg.playerCount !== undefined) {
      if (mpRoomCounts[msg.room]) {
        mpRoomCounts[msg.room].count = msg.playerCount;
      }
      mpUpdateRoomButtons();
    }
    return;
  }

  // V10_104: Peer joined notification — update room counts
  if (msg.type === 'peer_joined') {
    if (msg.room && msg.playerCount !== undefined) {
      if (mpRoomCounts[msg.room]) {
        mpRoomCounts[msg.room].count = msg.playerCount;
      }
      mpUpdateRoomButtons();
    }
    // Fall through — existing code may also handle peer_joined
  }

  // V10_104: Observer mode - connected to room as observer
  if (msg.type === 'observing') {
    mpConnected = true;
    mpObserver = true;
    mpObserverViewSeat = 0;
    MULTIPLAYER_MODE = true;
    mpSeat = -1;
    mpIsHost = false;
    mpUpdateStatus('Observing ' + msg.room + ' (' + msg.playerCount + ' players)', '#a78bfa');
    document.getElementById('mpBackdrop').style.display = 'none';
    mpShowObserverControls();
    return;
  }

  // V10_104: Route all game messages through observer handler when observing
  if (mpObserver && msg.type === 'move' && msg.move) {
    mpHandleObserverMessage(msg);
    return;
  }

  // V11.4: In-game chat
  if (msg.type === 'chat') {
    mpHandleChat(msg);
    return;
  }
  if (msg.type === 'chat_clear') {
    mpHandleChatClear();
    return;
  }
  if (msg.type === 'no_table_talk') {
    mpHandleNoTableTalk(msg);
    return;
  }

  if (msg.type === 'joined') {
    mpConnected = true;
    mpUpdateStatus('Connected to ' + msg.room, '#22c55e');
    mpUpdateIndicator();
    // Show connect UI updates
    document.getElementById('mpConnect').style.display = 'none';
    document.getElementById('mpDisconnect').style.display = '';
    document.getElementById('mpPlayerList').style.display = '';
    // Send hello to announce presence (include saved playerId for reconnection)
    const savedMpData = mpLoadSession(mpRoom);
    mpHelloNonce = mpGenerateId();
    mpSendRaw({ type: 'move', move: { action: 'hello', name: playerName || 'Player', playerId: savedMpData ? savedMpData.playerId : null, version: MP_VERSION, preferredSeat: mpPreferredSeat, nonce: mpHelloNonce } });
    // V10_113: If reconnecting during active game, auto-request state sync after seat assignment
    if(mpGameStarted && mpSeat >= 0) {
      console.log('[MP] Reconnected during active game — auto-requesting sync in 2s');
      setTimeout(() => {
        if(mpSocket && mpSocket.readyState === WebSocket.OPEN && mpGameStarted){
          if(mpIsHost){
            mpRefreshAll();
            setTimeout(() => mpCheckWhoseTurn(), 500);
          } else {
            mpRequestRefresh();
          }
        }
      }, 2000);
    }
    // TX42-Client: Server assigns seats. If no seat after 10s, show waiting status.
    // The mpIsHost concept is gone — server is the authority.
    setTimeout(() => {
      if (mpConnected && mpSeat < 0) {
        // Still waiting for seat assignment from server
        mpUpdateStatus('Waiting for seat assignment in ' + mpRoom + '...', '#f59e0b');
        // Show host settings panel for room configuration
        if(typeof mpShowHostSettings === 'function') mpShowHostSettings();
      }
    }, 3000);
    return;
  }

  if (msg.type === 'error') {
    mpUpdateStatus('Error: ' + (msg.reason || msg.code || 'Unknown error'), '#ef4444');
    return;
  }

  if (msg.type !== 'move' || !msg.move) return;

  const move = msg.move;

  switch(move.action) {
    case 'heartbeat':
      // V10_122: Activity heartbeat — player is still thinking/active
      // Track when we last heard from this player to prevent false stale detection
      if(move.seat !== undefined && move.seat !== mpSeat) {
        _mpLastHeartbeatReceived[move.seat] = Date.now();
        console.log('[MP] Received activity heartbeat from seat', move.seat);
      }
      // V10_114: Also respond so they know we're alive (backward compatibility)
      if(move.seat !== mpSeat) {
        mpSendRaw({ type: 'move', move: { action: 'heartbeat_ack', seat: mpSeat, t: Date.now() } });
      }
      return; // Don't process further
    case 'heartbeat_ack':
      // Peer responded to our heartbeat — connection confirmed (already handled by onmessage _mpLastPongTime)
      return;
    case 'hello':
      // Another player joined - track them
      mpHandleHello(move);
      break;
    case 'seat_assign':
      // Host assigned us a seat
      mpHandleSeatAssign(move);
      break;
    case 'player_list':
      // Updated player list from host
      mpHandlePlayerList(move);
      break;
    case 'deal':
      // Host dealt - receive hands
      mpHandleDeal(move);
      break;
    // ═══ TX42-Client: Intent messages — server handles all validation ═══
    // Intents are sent TO the server, not processed by client
    case 'play_intent':
    case 'bid_intent':
    case 'pass_intent':
    case 'trump_intent':
    case 'widow_swap_intent':
    case 'call_double_intent':
    case 'nello_intent':
    case 'nello_doubles_intent':
      // Server processes these — client ignores
      break;
    case 'call_double_request':
      // Host asks guest bid winner to decide on Call for Double
      if (!mpIsHost && move.seat === mpSeat) {
        console.log('[MP-HA] Call for Double request received — showing UI');
        document.getElementById('callDoubleBtnGroup').style.display = 'flex';
      }
      break;
    // ═══ V10_121: Confirmed messages (host→all) ═══
    case 'play_confirmed':
      mpHandlePlayConfirmed(move);
      break;
    case 'play_rejected':
      if (!mpIsHost) mpHandlePlayRejected(move);
      break;
    case 'bid_confirmed':
      mpHandleBidConfirmed(move);
      break;
    case 'pass_confirmed':
      mpHandlePassConfirmed(move);
      break;
    case 'trump_confirmed':
      mpHandleTrumpConfirmed(move);
      break;
    case 'widow_swap_confirmed':
      mpHandleWidowSwapConfirmed(move);
      break;
    case 'call_double_confirmed':
      mpHandleCallDoubleConfirmed(move);
      break;
    case 'nello_confirmed':
      mpHandleNelloConfirmed(move);
      break;
    case 'nello_doubles_confirmed':
      mpHandleNelloDoublesConfirmed(move);
      break;
    // ═══ Legacy actions (kept for backward compat during transition) ═══
    case 'bid':
      mpHandleBid(move);
      if (mpIsHost) mpSaveHostState();
      break;
    case 'pass':
      mpHandlePass(move);
      break;
    case 'trump':
      mpHandleTrump(move);
      if (mpIsHost) mpSaveHostState();
      break;
    case 'play':
      mpHandlePlay(move);
      break;
    case 'nello':
      mpHandleNello(move);
      break;
    case 'seat_ack':
      // Player acknowledged their seat
      if (mpIsHost) mpHandleSeatAck(move);
      break;
    case 'start_game':
      // Host started the game
      mpHandleStartGame(move);
      break;
    case 'next_hand':
      // Host starting next hand
      mpHandleNextHand(move);
      break;
    case 'state_sync':
      // Full game state from host (for reconnection)
      mpHandleStateSync(move);
      break;
    case 'call_double':
      // Legacy: Remote player's call for double decision
      if(move.called){
        callForDoubleActive = true;
        session.game.force_double_trump = true;
        setStatus('Double has been called!');
        applyForcedDoubleGlow();
        showCallDoubleBanner();
      } else {
        callForDoubleActive = false;
        session.game.force_double_trump = false;
        clearForcedDoubleGlow();
      }
      break;
    case 'nello_doubles':
      // Legacy: Remote player's nello doubles choice
      nelloDoublesSuitActive = (move.mode === 'doubles_only');
      session.game.nello_doubles_suit = nelloDoublesSuitActive;
      break;
    case 'widow_swap':
      // Legacy: Remote player completed Moon widow swap
      mpHandleWidowSwap(move);
      if (mpIsHost) mpSaveHostState();
      break;
    case 'refresh_request':
      // Guest requesting state refresh from host
      if (mpIsHost && mpGameStarted && session) {
        console.log('[MP] Refresh requested by seat', move.seat);
        mpSendGameState(move.seat);
      }
      break;
    case 'refresh_all':
      // Host broadcasting refresh to all players
      if (!mpIsHost && move.targetSeat === mpSeat) {
        mpHandleStateSync(move);
      }
      break;
    case 'rematch_invite':
      // Host is inviting players to play again
      if (!mpIsHost) {
        mpShowRematchVote();
      }
      break;
    case 'rematch_vote':
      // Guest voted on rematch
      if (mpIsHost) {
        mpHandleRematchVote(move);
      }
      break;
    case 'rematch_start':
      // Host is starting a rematch
      if (!mpIsHost) {
        mpHandleRematchStart();
      }
      break;
    case 'missed_plays_request':
      // Host is asking us for any plays we tracked while host was gone
      if (!mpIsHost) {
        const trackedPlays = mpGuestGetAndClearPlays();
        console.log('[MP] Host requested missed plays, sending', trackedPlays.length, 'plays');
        mpSendMove({ action: 'missed_plays_response', seat: mpSeat, plays: trackedPlays });
      }
      break;
    case 'missed_plays_response':
      // Guest is reporting plays made while host was disconnected
      if (mpIsHost && typeof mpHandleMissedPlaysResponse === 'function') {
        mpHandleMissedPlaysResponse(move);
      }
      break;
    case 'host_resumed':
      // Host has reconnected and resumed - guests should clear tracked plays
      // and wait for state_sync
      if (!mpIsHost) {
        mpGuestClearPlays();
        console.log('[MP] Host has resumed, waiting for state sync');
        setStatus('Host reconnected! Syncing...');
      }
      break;
    default:
      console.log('[MP] Unknown move action:', move.action);
  }
}

// Send a raw message (bypasses move wrapping)
function mpSendRaw(msg) {
  if (mpSocket && mpSocket.readyState === WebSocket.OPEN) {
    // V10_122e: CRITICAL iOS FIX - Wrap WebSocket send in try-catch
    try {
      mpSocket.send(JSON.stringify(msg));
      if(msg.type !== 'ping') mpLogEntry('SEND', 'raw', msg);
    } catch(e) {
      console.error('[MP] Send raw error:', e);
      mpLogEntry('ERROR', 'send_raw', 'WebSocket send failed: ' + e.message, msg);
      // On iOS, WebSocket can fail silently - trigger reconnect
      if(mpSocket) mpSocket.close();
    }
  } else {
    mpLogEntry('ERROR', 'raw', 'Socket not open, state=' + (mpSocket ? mpSocket.readyState : 'null'), msg);
  }
}

// V10_114: Deduplication guard — prevent sending the same play twice
let _mpLastPlayKey = '';
let _mpLastPlayTime = 0;

// Send a game move via relay
function mpSendMove(moveObj) {
  if (!MULTIPLAYER_MODE || mpSuppressSend) return;

  // V10_114: Dedup guard for play actions — if the same seat+tile+trickNumber
  // was sent within 500ms, skip the duplicate
  if (moveObj.action === 'play') {
    const playKey = moveObj.seat + ':' + JSON.stringify(moveObj.tile) + ':' + moveObj.trickNumber;
    const now = Date.now();
    if (playKey === _mpLastPlayKey && (now - _mpLastPlayTime) < 500) {
      console.warn('[MP] Duplicate play blocked:', playKey);
      mpLogEntry('WARN', 'dedup', 'Duplicate play blocked: ' + playKey);
      return;
    }
    _mpLastPlayKey = playKey;
    _mpLastPlayTime = now;
  }

  if (mpSocket && mpSocket.readyState === WebSocket.OPEN) {
    // V10_122e: CRITICAL iOS FIX - Wrap WebSocket send in try-catch
    try {
      mpSocket.send(JSON.stringify({
        type: 'move',
        move: moveObj,
        t: Date.now()
      }));
      console.log('[MP] Sent move:', moveObj);
      mpLogEntry('SEND', 'move', moveObj);
    } catch(e) {
      console.error('[MP] Send error:', e);
      mpLogEntry('ERROR', 'send', 'WebSocket send failed: ' + e.message, moveObj);
      // On iOS, WebSocket can fail silently - trigger reconnect
      if(mpSocket) mpSocket.close();
    }
  } else {
    mpLogEntry('ERROR', 'move', 'Socket not open for move', moveObj);
  }
}

// Update connection status text in modal
function mpUpdateStatus(text, color) {
  const el = document.getElementById('mpConnStatus');
  if (el) {
    el.textContent = text;
    el.style.color = color || '#9ca3af';
  }
}

// V11.3: Update the docked indicator (left of settings gear, no dragging)
function mpUpdateIndicator() {
  const indicator = document.getElementById('mpIndicator');
  if (indicator && mpSeat >= 0) {
    indicator.title = 'Seat ' + (mpSeat+1) + ' (' + (mpIsHost ? 'Host' : 'Guest') + ')';
  }
  const dot = document.getElementById('mpDot');
  const statusText = document.getElementById('mpStatusText');
  const countText = document.getElementById('mpPlayerCount');
  if (!indicator) return;

  if (MULTIPLAYER_MODE) {
    indicator.style.display = 'flex';
    if (mpConnected) {
      dot.style.background = '#22c55e';
      statusText.textContent = mpRoom || 'Connected';
      const playerCount = Object.keys(mpPlayers).length;
      const maxPlayers = mpPlayerCount();
      countText.textContent = playerCount + '/' + maxPlayers;
    } else {
      dot.style.background = '#ef4444';
      statusText.textContent = 'Offline';
      countText.textContent = '';
    }
  } else {
    indicator.style.display = 'none';
  }
}

// V11.3: Toggle MP indicator collapse/expand (docked left of settings, expands left)
let _mpIndicatorMinimized = false;
function mpToggleIndicator(){
  const details = document.getElementById('mpIndicatorDetails');
  const indicator = document.getElementById('mpIndicator');
  if(!details || !indicator) return;
  _mpIndicatorMinimized = !_mpIndicatorMinimized;
  if(_mpIndicatorMinimized){
    details.style.display = 'none';
    indicator.style.padding = '6px';
    indicator.style.borderRadius = '50%';
  } else {
    details.style.display = 'inline';
    indicator.style.padding = '4px 10px';
    indicator.style.borderRadius = '18px';
  }
}
// V11.3: Clear any stale saved position from old draggable code
try{ localStorage.removeItem('tn51_mp_indicator_pos'); }catch(e){}

// Build room grid buttons
var mpSelectedMode = 'T42'; // TX42-Client: always T42

// TX42-Client: Only T42 rooms
const MP_ALL_ROOMS = [
  { name: 'Tx42room001', label: 'Room #1', mode: 'T42' },
  { name: 'Tx42room002', label: 'Room #2', mode: 'T42' },
  { name: 'Tx42room003', label: 'Room #3', mode: 'T42' },
  { name: 'Tx42room004', label: 'Room #4', mode: 'T42' },
  { name: 'Tx42room005', label: 'Room #5', mode: 'T42' },
];

// TX42-Client: Build room buttons directly (no mode selection needed)
function mpBuildRoomButtons(){
  // Skip mode selector, go straight to rooms
  var modeSection = document.getElementById('mpModeSection');
  if(modeSection) modeSection.style.display = 'none';
  var roomSection = document.getElementById('mpRoomSection');
  if(roomSection) roomSection.style.display = 'block';
  mpBuildRoomGrid('T42');
  // Request room status from server
  mpRequestRoomStatus();
}

// Request room status (connect briefly to get room counts)
function mpRequestRoomStatus(){
  if(mpSocket && mpSocket.readyState === WebSocket.OPEN){
    try { mpSocket.send(JSON.stringify({ type: 'room_status_request' })); } catch(e){}
    return;
  }
  // Open a temporary connection just to get room status
  try {
    var tmpSock = new WebSocket(MP_WS_URL);
    tmpSock.onopen = function(){
      try { tmpSock.send(JSON.stringify({ type: 'room_status_request' })); } catch(e){}
    };
    tmpSock.onmessage = function(evt){
      try {
        var msg = JSON.parse(evt.data);
        if(msg.type === 'room_status'){
          mpRoomCounts = {};
          if(msg.rooms && Array.isArray(msg.rooms)){
            msg.rooms.forEach(function(r){
              mpRoomCounts[r.room] = { count: r.count, max: r.max, observers: r.observers || 0 };
            });
          }
          mpUpdateRoomButtons();
        }
      } catch(e){}
    };
    tmpSock.onerror = function(){};
    tmpSock.onclose = function(){};
    // Close after 5s if still open
    setTimeout(function(){ try{ if(tmpSock.readyState <= 1) tmpSock.close(); }catch(e){} }, 5000);
  } catch(e){
    console.log('[MP] Room status request failed:', e);
  }
}

function mpBuildModeSelector() {
  const modeGrid = document.getElementById('mpModeGrid');
  if (!modeGrid) return;
  modeGrid.innerHTML = '';
  const modes = [
    { mode: 'TN51', label: 'TN51', color: '#22c55e', players: '6 players' },
    { mode: 'T42', label: 'Texas 42', color: '#3b82f6', players: '4 players' },
    { mode: 'MOON', label: 'Texas Moon', color: '#eab308', players: '3 players' }
  ];
  modes.forEach(m => {
    const btn = document.createElement('button');
    btn.innerHTML = '<div style="font-weight:700;font-size:14px;">' + m.label + '</div><div style="font-size:10px;opacity:0.7;">' + m.players + '</div>';
    btn.style.cssText = 'flex:1;padding:10px 8px;border:2px solid rgba(255,255,255,0.15);border-radius:8px;background:rgba(255,255,255,0.05);color:#fff;cursor:pointer;transition:all 0.2s;text-align:center;';
    if (mpSelectedMode === m.mode) {
      btn.style.borderColor = m.color;
      btn.style.background = 'rgba(255,255,255,0.12)';
    }
    btn.addEventListener('click', () => {
      mpSelectedMode = m.mode;
      // Highlight selected mode
      modeGrid.querySelectorAll('button').forEach(b => {
        b.style.borderColor = 'rgba(255,255,255,0.15)';
        b.style.background = 'rgba(255,255,255,0.05)';
      });
      btn.style.borderColor = m.color;
      btn.style.background = 'rgba(255,255,255,0.12)';
      // Show rooms for this mode
      mpBuildRoomGrid(m.mode);
      document.getElementById('mpRoomSection').style.display = 'block';
      // V10_104: Show observer toggle
      document.getElementById('mpObserverSection').style.display = 'block';
      // V10_119: Show auto-refresh toggle
      document.getElementById('mpRefreshToggleSection').style.display = 'block';
      // V10_109: Hide marks and Nello settings for Moon mode in MP
      var _mpMS = document.getElementById('mpMarksSection');
      var _mpHR = document.getElementById('mpHouseRules');
      if(_mpMS) _mpMS.style.display = (m.mode === 'MOON') ? 'none' : '';
      if(_mpHR) _mpHR.style.display = (m.mode === 'MOON') ? 'none' : '';
    });
    modeGrid.appendChild(btn);
  });
}

function mpBuildRoomGrid(filterMode) {
  const grid = document.getElementById('mpRoomGrid');
  if (!grid) return;
  grid.innerHTML = '';

  const rooms = MP_ALL_ROOMS.filter(r => r.mode === filterMode);

  rooms.forEach(r => {
    const btn = document.createElement('button');
    btn.dataset.room = r.name;
    btn.dataset.mode = r.mode;
    btn.style.cssText = 'padding:10px;border:2px solid rgba(255,255,255,0.15);border-radius:8px;background:rgba(255,255,255,0.05);color:#fff;font-size:13px;font-weight:600;cursor:pointer;transition:all 0.2s;display:flex;align-items:center;gap:6px;justify-content:center;';
    // V10_104: Build button content with status dot + label + count
    const dot = document.createElement('span');
    dot.className = 'mpRoomDot';
    dot.style.cssText = 'width:8px;height:8px;border-radius:50%;background:#6b7280;flex-shrink:0;display:inline-block;';
    const lbl = document.createElement('span');
    lbl.className = 'mpRoomLabel';
    lbl.textContent = r.label;
    const cnt = document.createElement('span');
    cnt.className = 'mpRoomCount';
    cnt.style.cssText = 'font-size:11px;color:#9ca3af;font-weight:400;';
    const info = mpRoomCounts[r.name];
    if (info) {
      cnt.textContent = info.count + '/' + info.max;
      const dotColor = info.count === 0 ? '#6b7280' : info.count >= info.max ? '#ef4444' : info.count >= info.max - 1 ? '#f59e0b' : '#22c55e';
      dot.style.background = dotColor;
    } else {
      cnt.textContent = '';
    }
    btn.appendChild(dot);
    btn.appendChild(lbl);
    btn.appendChild(cnt);
    // Check if there's a saved session for this room
    const savedSession = mpLoadSession(r.name);
    if (savedSession) {
      btn.style.borderColor = '#f59e0b';
      lbl.textContent = r.label + ' \u21A9';
      btn.title = 'Reconnect (Seat ' + (savedSession.seat + 1) + ')';
    }
    btn.addEventListener('click', () => {
      // Highlight selected room
      grid.querySelectorAll('button').forEach(b => {
        b.style.borderColor = 'rgba(255,255,255,0.15)';
        b.style.background = 'rgba(255,255,255,0.05)';
      });
      btn.style.borderColor = '#60a5fa';
      btn.style.background = 'rgba(96,165,250,0.2)';
      mpRoom = r.name;
      // Set game mode to match room
      if (GAME_MODE !== r.mode) {
        initGameMode(r.mode);
      }
      // Show seat selection for non-host (before connecting)
      mpBuildSeatPicker();
    });
    grid.appendChild(btn);
  });
}

// V10_104: Update room button dots and counts from mpRoomCounts
function mpUpdateRoomButtons() {
  const grid = document.getElementById('mpRoomGrid');
  if (!grid) return;
  grid.querySelectorAll('button').forEach(btn => {
    const room = btn.dataset.room;
    if (!room) return;
    const info = mpRoomCounts[room];
    if (!info) return;
    const dot = btn.querySelector('.mpRoomDot');
    const cnt = btn.querySelector('.mpRoomCount');
    if (cnt) cnt.textContent = info.count + '/' + info.max;
    if (dot) {
      const dotColor = info.count === 0 ? '#6b7280' : info.count >= info.max ? '#ef4444' : info.count >= info.max - 1 ? '#f59e0b' : '#22c55e';
      dot.style.background = dotColor;
    }
  });
}

// Handle "hello" from another player
function mpHandleHello(move) {
  // Check version of joining player
  if (mpIsHost && move.version && move.version !== MP_VERSION) {
    console.log('[MP] Player joining with different version:', move.version, 'vs', MP_VERSION);
  }
  // If we are host, assign them a seat
  if (mpIsHost) {
    const maxSeats = mpPlayerCount();
    
    // Check if this is a reconnecting player (has a known playerId)
    let reconnectSeat = -1;
    if (move.playerId) {
      for (const [seat, pid] of Object.entries(mpPlayerIds)) {
        if (pid === move.playerId && parseInt(seat) !== mpSeat) {
          reconnectSeat = parseInt(seat);
          break;
        }
      }
    }
    
    if (reconnectSeat >= 0) {
      // Reconnecting player - restore their seat
      console.log('[MP] Player reconnecting to seat', reconnectSeat, 'with ID', move.playerId);
      mpPlayers[reconnectSeat] = { seat: reconnectSeat, name: move.name || ('Player ' + (reconnectSeat + 1)), isLocal: false, confirmed: true };
      mpSendMove({ action: 'seat_assign', seat: reconnectSeat, hostSeat: mpSeat, gameMode: GAME_MODE, playerId: move.playerId, reconnect: true, version: MP_VERSION, nonce: move.nonce || null });
      mpBroadcastPlayerList();
      mpUpdateIndicator();
      // If game is in progress, send full state to reconnecting player
      if (mpGameStarted) {
        setTimeout(() => mpSendGameState(reconnectSeat), 500);
      }
    } else {
      // New player - check if they have a preferred seat
      let assignedSeat = -1;
      if (move.preferredSeat >= 0 && move.preferredSeat < maxSeats
          && move.preferredSeat !== mpSeat
          && !(mpPlayers[move.preferredSeat] && mpPlayers[move.preferredSeat].confirmed)) {
        assignedSeat = move.preferredSeat;
      } else {
        // Find next available seat
        for (let s = 0; s < maxSeats; s++) {
          if (s === mpSeat) continue;  // host's seat
          if (mpPlayers[s] && mpPlayers[s].confirmed) continue;  // already taken
          assignedSeat = s;
          break;
        }
      }
      if (assignedSeat >= 0) {
        const newPlayerId = mpGenerateId();
        mpPlayerIds[assignedSeat] = newPlayerId;
        mpPlayers[assignedSeat] = { seat: assignedSeat, name: move.name || ('Player ' + (assignedSeat + 1)), isLocal: false, confirmed: true };
        // Send seat assignment with playerId
        mpSendMove({ action: 'seat_assign', seat: assignedSeat, hostSeat: mpSeat, gameMode: GAME_MODE, playerId: newPlayerId, version: MP_VERSION, nonce: move.nonce || null });
        mpBroadcastPlayerList();
        mpUpdateIndicator();
      } else {
        console.log('[MP] No seats available');
      }
    }
  }
}

// Handle seat assignment from host
function mpHandleSeatAssign(move) {
  if (mpIsHost) return;  // Host doesn't get assigned

  // CRITICAL: Only accept seat_assign meant for us!
  // The relay broadcasts to ALL clients, so we must filter.
  // Match by nonce (new join) or playerId (reconnection).
  if (move.reconnect && move.playerId && move.playerId === mpPlayerId) {
    // Reconnection — our playerId matches
    console.log('[MP] Reconnect seat_assign accepted (playerId match)');
  } else if (move.nonce && move.nonce === mpHelloNonce) {
    // New join — our nonce matches
    console.log('[MP] New seat_assign accepted (nonce match)');
  } else if (mpSeat >= 0) {
    // We already have a seat — ignore seat_assigns not for us
    console.log('[MP] Ignoring seat_assign (already have seat', mpSeat, ')');
    return;
  } else if (!move.nonce) {
    // Legacy host (no nonce support) — accept if we have no seat
    console.log('[MP] Legacy seat_assign accepted (no nonce, no seat)');
  } else {
    // Nonce doesn't match and we don't have a seat yet
    // This seat_assign is for another guest — ignore
    console.log('[MP] Ignoring seat_assign (nonce mismatch:', move.nonce, 'vs', mpHelloNonce, ')');
    return;
  }

  mpSeat = move.seat;
  GAME_MODE = move.gameMode || GAME_MODE;
  MULTIPLAYER_MODE = true;
  mpHelloNonce = null; // Clear nonce after use
  // Save playerId for reconnection
  if (move.playerId) {
    mpPlayerId = move.playerId;
    mpSaveSession();
  }
  // Version check
  if (move.version && move.version !== MP_VERSION) {
    mpShowVersionWarning(move.version, MP_VERSION);
  }
  if (move.reconnect) {
    mpUpdateStatus('Reconnected! Seat ' + (mpSeat + 1) + ' in ' + mpRoom, '#22c55e');
    console.log('[MP] Reconnected to seat:', mpSeat);
  } else {
    mpUpdateStatus('Seat ' + (mpSeat + 1) + ' in ' + mpRoom, '#22c55e');
    console.log('[MP] Assigned seat:', mpSeat);
  }
  mpConnected = true;
  // Show player list and room sections
  var playerListEl = document.getElementById('mpPlayerList');
  if (playerListEl) playerListEl.style.display = '';
  // Hide room grid (already in a room)
  var roomSection = document.getElementById('mpRoomSection');
  if (roomSection) roomSection.style.display = 'none';
  // Acknowledge
  mpSendMove({ action: 'seat_ack', seat: mpSeat });
}

// Handle seat acknowledgment (host side)
function mpHandleSeatAck(move) {
  // Player confirmed their seat
  if (mpPlayers[move.seat]) {
    mpPlayers[move.seat].confirmed = true;
  }
  mpBroadcastPlayerList();
}

// Broadcast player list to all
function mpBroadcastPlayerList() {
  const list = {};
  // V10_121: Use host's actual playerName instead of hardcoded "Player 1 (Host)"
  const hostDisplayName = playerName || ('Player ' + (mpSeat + 1));
  list[mpSeat] = { seat: mpSeat, name: hostDisplayName, isHost: true };
  for (const [k, v] of Object.entries(mpPlayers)) {
    if (parseInt(k) !== mpSeat) {
      list[k] = { seat: parseInt(k), name: v.name };
    }
  }
  mpSendMove({ action: 'player_list', players: list, gameMode: GAME_MODE });
  mpRenderPlayerList(list);
}

// Handle player list update
function mpHandlePlayerList(move) {
  const list = move.players || {};
  mpPlayers = {};
  for (const [k, v] of Object.entries(list)) {
    mpPlayers[parseInt(k)] = v;
  }
  // Make sure our own seat is in the list
  if (mpSeat >= 0) {
    mpPlayers[mpSeat] = mpPlayers[mpSeat] || { seat: mpSeat, name: 'Player ' + (mpSeat + 1) + ' (You)' };
  }
  if (move.gameMode) GAME_MODE = move.gameMode;
  mpRenderPlayerList(list);
  mpUpdateIndicator();
}

// Render player list in modal
function mpRenderPlayerList(players) {
  const container = document.getElementById('mpPlayers');
  if (!container) return;
  container.innerHTML = '';
  const maxSeats = mpPlayerCount();
  for (let s = 0; s < maxSeats; s++) {
    const p = players[s] || mpPlayers[s];
    const div = document.createElement('div');
    div.style.cssText = 'padding:8px 12px;border-radius:6px;background:rgba(255,255,255,0.05);font-size:13px;display:flex;justify-content:space-between;align-items:center;';
    if (p) {
      const isMe = (s === mpSeat);
      div.innerHTML = '<span style="color:#fff;">Seat ' + (s+1) + ': ' + (p.name || ('Player ' + (s+1))) + '</span>' +
        (isMe ? '<span style="color:#22c55e;font-size:11px;">YOU</span>' :
         (p.isHost ? '<span style="color:#f59e0b;font-size:11px;">HOST</span>' : '<span style="color:#60a5fa;font-size:11px;">READY</span>'));
    } else {
      div.innerHTML = '<span style="color:#6b7280;">Seat ' + (s+1) + ': Empty</span><span style="color:#6b7280;font-size:11px;">waiting...</span>';
    }
    container.appendChild(div);
  }

  // Show/hide start button (seat 0 = room leader, controls game options and start)
  const playerCount = Object.keys(mpPlayers).length + (mpPlayers[mpSeat] ? 0 : 1);
  const startBtn = document.getElementById('mpStartGame');
  if (startBtn) {
    startBtn.style.display = (mpSeat === 0 && playerCount >= 1) ? '' : 'none';
  }
  // Show/hide game settings (only room leader — seat 0)
  const hostSettings = document.getElementById('mpHostSettings');
  if (hostSettings) {
    hostSettings.style.display = (mpSeat === 0) ? '' : 'none';
  }
}

// Handle deal from server
async function mpHandleDeal(move) {
  // TX42-Client: Server always deals — don't skip for host
  if (mpSeat < 0) {
    console.error('[MP] Received deal but mpSeat not set! Ignoring.');
    return;
  }
  console.log('[MP] Received deal for seat', mpSeat, ':', move);

  mpSuppressSend = true;
  mpGameStarted = true;
  _staleRefreshCount = 0; // V10_118: Reset refresh counter for new hand
  if (typeof mpShowChatIcon === 'function') mpShowChatIcon(true); // V11.4: Show chat icon when game starts

  // Close multiplayer modal if open
  document.getElementById('mpBackdrop').style.display = 'none';

  // V10_121: Hide round/game end popups when new deal arrives
  hideRoundEndSummary();
  hideGameEndSummary();

  // Hide any leftover bid overlay from a previous game
  document.getElementById('bidBackdrop').style.display = 'none';

  // Ensure game mode matches host's deal
  if (move.gameMode && GAME_MODE !== move.gameMode) {
    initGameMode(move.gameMode);
  }

  // Apply layout settings for current game mode
  if (GAME_MODE === 'MOON') {
    applyMoonSettings();
  } else if (GAME_MODE === 'T42') {
    applyT42Settings();
  } else {
    applyTn51Settings();
  }

  // Set up game state from host's deal data
  const playerCount = mpPlayerCount();
  const maxPip = mpMaxPip();
  const handSize = mpHandSize();
  const marksToWin = move.marksToWin || 7;

  if (!session || session.game.player_count !== playerCount) {
    session = new SessionV6_4g(playerCount, maxPip, handSize, marksToWin);
  }

  // Set dealer
  session.dealer = move.dealer;

  // Set hands from server deal — server only sends our hand
  // Build hands array: our real hand + dummy face-down tiles for opponents
  const myHand = move.hand || move.hands || [];
  const handSize = mpHandSize();
  const hands = [];
  for (let i = 0; i < playerCount; i++) {
    if (i === mpSeat) {
      hands.push(myHand);
    } else {
      // Dummy tiles so renderer draws face-down dominoes for opponents
      const dummy = [];
      for (let j = 0; j < handSize; j++) dummy.push([-1, -1]);
      hands.push(dummy);
    }
  }
  session.game.set_hands(hands, 0);
  session.game.set_trump_suit(null);
  session.game.set_active_players(Array.from({length: playerCount}, (_, i) => i));
  session.phase = PHASE_NEED_BID;

  // Carry over marks if provided
  if (move.teamMarks) {
    session.team_marks = move.teamMarks;
  }

  // V11.4b: Sync No Table Talk from host
  if (typeof move.noTableTalk !== 'undefined') {
    _noTableTalk = !!move.noTableTalk;
    _updateNoTableTalkUI();
  }

  // Re-create visual elements
  shadowLayer.innerHTML = '';
  spriteLayer.innerHTML = '';
  sprites.length = 0;
  widowSprite = null; // V12.10.4: Reset detached widow sprite
  currentTrick = 0;
  playedThisTrick = [];
  team1TricksWon = 0;
  team2TricksWon = 0;
  moonPlayerTricksWon = [0, 0, 0];
  zIndexCounter = 100;
  isAnimating = false;
  waitingForPlayer1 = false;

  document.getElementById('trumpDisplay').classList.remove('visible');

  // Hide unused player indicators
  if (GAME_MODE === 'MOON') {
    for (let h = 4; h <= 6; h++) {
      const hel = document.getElementById('playerIndicator' + h);
      if (hel) hel.style.display = 'none';
    }
    for (let h = 1; h <= 3; h++) {
      const hel = document.getElementById('playerIndicator' + h);
      if (hel) hel.style.display = '';
    }
  } else if (GAME_MODE === 'T42') {
    for (let h = 5; h <= 6; h++) {
      const hel = document.getElementById('playerIndicator' + h);
      if (hel) hel.style.display = 'none';
    }
  }

  // Restore Moon widow if provided
  if (move.moonWidow) {
    session.moon_widow = move.moonWidow;
    session._widowRevealed = false;
  }
  if (move.moonShoot !== undefined) {
    session.moon_shoot = move.moonShoot;
  }

  createPlaceholders();

  // Create sprites - rotate display so local player (mpSeat) is at bottom (position 1)
  for (let p = 0; p < playerCount; p++) {
    sprites[p] = [];
    // Map game seat to visual position: local player -> P1 (bottom)
    const visualP = mpVisualPlayer(p);
    for (let h = 0; h < handSize; h++) {
      const tile = hands[p][h];
      if (!tile) continue;

      const sprite = makeSprite(tile);
      const pos = getHandPosition(visualP, h);
      if (pos) {
        sprite.setPose(pos);
        if (sprite._shadow) shadowLayer.appendChild(sprite._shadow);
        spriteLayer.appendChild(sprite);

        const data = { sprite, tile, originalSlot: h };
        sprites[p][h] = data;

        // Only allow clicks for local player's seat
        if (p === mpSeat) {
          sprite.addEventListener('click', () => handlePlayer1Click(sprite));
          sprite.addEventListener('touchstart', (e) => {
            e.preventDefault();
            e.stopPropagation();
            handlePlayer1Click(sprite);
          }, { passive: false });
        }

        // Show face-up only for local player
        if (p === mpSeat) {
          sprite.setFaceUp(true);
        } else {
          sprite.setFaceUp(false);
        }
      }
    }
  }

  // Auto deal: flip local player's tiles face-up
  for (const data of (sprites[mpSeat] || [])) {
    if (data && data.sprite) data.sprite.setFaceUp(true);
  }

  // Update scores
  if (GAME_MODE === 'MOON') {
    // Moon: 3 individual scores, updateScoreDisplay handles moonScoreBar
    for (let i = 0; i < 3; i++) {
      if (session.game.team_points[i] !== undefined) {}
      if (session.team_marks[i] !== undefined) {}
    }
  } else {
    team1Score = session.game.team_points[0];
    team2Score = session.game.team_points[1];
    team1Marks = session.team_marks[0];
    team2Marks = session.team_marks[1];
  }
  updateScoreDisplay();

  // Show Moon widow if applicable
  if (GAME_MODE === 'MOON' && session.moon_widow) {
    updateWidowDisplay();
  }

  // Position player indicators with correct labels
  positionPlayerIndicators();

  // Start bidding
  initBiddingRound();
  // V10_105: Fix #9 — enable shuffle/preview as soon as deal happens
  enableBiddingPreview();

  // Hide start screen if visible
  const startScreen = document.getElementById('startScreenBackdrop');
  if (startScreen) startScreen.style.display = 'none';

  mpSuppressSend = false;

  // Run bidding - if current bidder is local, show UI; otherwise wait
  mpRunBiddingStep();
  // Auto-save host state after dealing
  mpSaveHostState();
}

// Multiplayer bidding step - like runBiddingStep but checks for local vs remote vs AI
function mpRunBiddingStep() {
  if (!biddingState) { console.log('[MP-HA] mpRunBiddingStep: biddingState is null, aborting'); mpLogEntry('STATE', 'bid-step', 'biddingState=null ABORT'); return; }
  const currentBidder = biddingState.currentBidder;
  mpLogEntry('STATE', 'bid-step', 'currentBidder=' + currentBidder + ' mpSeat=' + mpSeat + ' isAI=' + mpIsAI(currentBidder));

  if (currentBidder === mpSeat) {
    // It's our turn to bid
    session.phase = PHASE_NEED_BID;
    session.status = biddingState.highBid > 0
      ? 'Current bid: ' + biddingState.highBid + ' by P' + seatToPlayer(biddingState.highBidder) + '. Your bid?'
      : 'Your turn to bid.';
    setStatus(session.status);
    showBidOverlay(true);
    if (MULTIPLAYER_MODE) triggerHaptic(); // V11.4: Haptic for bid turn
    mpHideWaiting();
    mpLogEntry('STATE', 'bid-overlay', 'SHOWN for seat=' + mpSeat + ' highBid=' + biddingState.highBid);
  } else if (false && mpIsHost && mpIsAI(currentBidder)) {
    // TX42-Client: DISABLED — server handles all AI bidding
    if (_aiActionInProgress) {
      console.log('[FIX3] AI action already in progress, skipping duplicate');
      mpLogEntry('STATE', 'bid-ai-skip', 'AI action in progress, skipping seat=' + currentBidder);
      return;
    }
    
    // Host handles AI bidding for empty seats
    _aiActionInProgress = true; // FIX3: Set lock
    mpHideWaiting();
    session.status = getPlayerDisplayName(currentBidder) + ' (AI) is thinking...';
    setStatus(session.status);
    // V10_121e: Restructured with try/catch + watchdog to prevent silent hang
    const _aiBidSeat = currentBidder; // Capture for closure safety
    let _aiBidCompleted = false;
    const _aiThinkTimer = setTimeout(() => {
      try {
        if (!biddingState) { 
          mpLogEntry('STATE', 'bid-ai', 'biddingState=null ABORT seat=' + _aiBidSeat); 
          _aiActionInProgress = false; // FIX3: Release lock
          return; 
        }
        mpLogEntry('STATE', 'bid-ai-think', 'seat=' + _aiBidSeat + ' FIRED');
        const result = processAIBid(_aiBidSeat);
        const visualNum = seatToVisual(_aiBidSeat);
        const labelNum = seatToPlayer(_aiBidSeat);
        if (result.action === 'bid') {
          session.status = 'P' + labelNum + ' bids ' + result.bid + '!';
          setPlaceholderText(visualNum, result.bid, 'bid');
        } else {
          session.status = 'P' + labelNum + ' passes.';
          setPlaceholderText(visualNum, 'Pass', 'pass');
        }
        setStatus(session.status);
        const _aiAdvanceTimer = setTimeout(() => {
          try {
            _aiBidCompleted = true;
            if (!biddingState) { 
              mpLogEntry('STATE', 'bid-ai-advance', 'biddingState=null ABORT seat=' + _aiBidSeat); 
              _aiActionInProgress = false; // FIX3: Release lock
              return; 
            }
            mpLogEntry('STATE', 'bid-ai-advance', 'seat=' + _aiBidSeat + ' action=' + result.action);
            const advance = advanceBidding() || { done: true }; // V10_121f: defensive null-check
            if (result.action === 'bid') {
              const displayBid = (result.marks > 1) ? (result.marks + 'x') : result.bid;
              mpSendMove({ action: 'bid_confirmed', seat: _aiBidSeat, bid: result.bid, marks: result.marks || 1,
                displayBid: displayBid, biddingDone: advance.done || false,
                nextBidder: biddingState ? biddingState.currentBidder : null,
                bidWinner: advance.done ? (biddingState ? biddingState.highBidder : session.bid_winner_seat) : null,
                winningBid: advance.done ? (biddingState ? biddingState.highBid : session.current_bid) : null,
                winningMarks: advance.done ? (biddingState ? biddingState.highMarks : session.bid_marks) : null,
                redeal: advance.redeal || false, isAI: true });
            } else {
              mpSendMove({ action: 'pass_confirmed', seat: _aiBidSeat,
                biddingDone: advance.done || false,
                nextBidder: biddingState ? biddingState.currentBidder : null,
                bidWinner: advance.done ? (biddingState ? biddingState.highBidder : session.bid_winner_seat) : null,
                winningBid: advance.done ? (biddingState ? biddingState.highBid : session.current_bid) : null,
                winningMarks: advance.done ? (biddingState ? biddingState.highMarks : session.bid_marks) : null,
                redeal: advance.redeal || false, isAI: true });
            }
            mpSaveHostState();
            _aiActionInProgress = false; // FIX3: Release lock after completion
            if (!advance.done) {
              mpRunBiddingStep();
            }
          } catch(err) {
            console.error('[MP-HA] AI advance error seat ' + _aiBidSeat + ':', err);
            mpLogEntry('STATE', 'bid-ai-error', 'advance seat=' + _aiBidSeat + ' err=' + err.message);
            _aiActionInProgress = false; // FIX3: Release lock on error
          }
        }, 600);
        _addBiddingTimer(_aiAdvanceTimer);
        _allAITimers.push(_aiAdvanceTimer); // FIX5: Track timer
      } catch(err) {
        console.error('[MP-HA] AI think error seat ' + _aiBidSeat + ':', err);
        mpLogEntry('STATE', 'bid-ai-error', 'think seat=' + _aiBidSeat + ' err=' + err.message);
        _aiActionInProgress = false; // FIX3: Release lock on error
      }
    }, 400);
    _addBiddingTimer(_aiThinkTimer);
    _allAITimers.push(_aiThinkTimer); // FIX5: Track timer
    // V10_121e: Watchdog — if AI bid doesn't complete within 5s, force-advance
    const _aiWatchdog = setTimeout(() => {
      if (_aiBidCompleted) return;
      mpLogEntry('STATE', 'bid-ai-watchdog', 'FIRED seat=' + _aiBidSeat + ' forcing advance');
      console.warn('[MP-HA] AI bid watchdog: seat', _aiBidSeat, 'timer never fired — forcing advance');
      if (!biddingState) {
        _aiActionInProgress = false; // FIX3: Release lock
        return;
      }
      // Force pass for the stuck AI seat
      biddingState.passCount++;
      biddingState.bids.push({ seat: _aiBidSeat, playerNumber: seatToPlayer(_aiBidSeat), bid: 'pass' });
      setPlaceholderText(seatToVisual(_aiBidSeat), 'Pass', 'pass');
      const advance = advanceBidding() || { done: true }; // V10_121f: defensive null-check
      mpSendMove({ action: 'pass_confirmed', seat: _aiBidSeat,
        biddingDone: advance.done || false,
        nextBidder: biddingState ? biddingState.currentBidder : null,
        bidWinner: advance.done ? (biddingState ? biddingState.highBidder : session.bid_winner_seat) : null,
        winningBid: advance.done ? (biddingState ? biddingState.highBid : session.current_bid) : null,
        winningMarks: advance.done ? (biddingState ? biddingState.highMarks : session.bid_marks) : null,
        redeal: advance.redeal || false, isAI: true });
      mpSaveHostState();
      _aiBidCompleted = true;
      _aiActionInProgress = false; // FIX3: Release lock
      if (!advance.done) {
        mpRunBiddingStep();
      }
    }, 5000);
    _addBiddingTimer(_aiWatchdog);
    _allAITimers.push(_aiWatchdog); // FIX5: Track watchdog
  } else {
    // Waiting for remote player — show in status bar only (no overlay)
    session.status = getPlayerDisplayName(currentBidder) + ' is thinking...';
    setStatus(session.status);
    mpWaitingForRemote = true;
  }
}

// Handle remote bid
function mpHandleBid(move) {
  if (!biddingState) return;
  console.log('[MP] Remote bid from seat', move.seat, ':', move.bid, 'marks:', move.marks);

  mpSuppressSend = true;
  mpWaitingForRemote = false;

  const bidder = move.seat;
  if (bidder !== biddingState.currentBidder) {
    console.log('[MP] Bid from wrong seat, expected:', biddingState.currentBidder, 'got:', bidder);
    mpSuppressSend = false;
    return;
  }

  // Apply bid
  biddingState.highBid = move.bid;
  biddingState.highBidder = bidder;
  biddingState.highMarks = move.marks || 1;
  if (move.multiplier) {
    biddingState.inMultiplierMode = true;
    biddingState.highMultiplier = move.multiplier;
  }
  if (move.moonShoot) {
    biddingState.moonShoot = true;
  }
  biddingState.bids.push({ seat: bidder, playerNumber: seatToPlayer(bidder), bid: move.bid });

  const visualNum = seatToVisual(bidder);
  const displayBid = (move.marks > 1) ? (move.marks + 'x') : move.bid;
  setPlaceholderText(visualNum, displayBid, 'bid');

  session.status = getPlayerDisplayName(bidder) + ' bids ' + displayBid + '!';
  setStatus(session.status);

  // Advance bidding
  const _bidTimerA = setTimeout(() => {
    const advance = advanceBidding() || { done: true }; // V10_121f: defensive null-check
    mpSuppressSend = false;
    if (!advance.done) {
      mpRunBiddingStep();
    } else {
      // Bidding finalized - handled inside finalizeBidding
    }
  }, 600);
  _addBiddingTimer(_bidTimerA);
}

// Handle remote pass
function mpHandlePass(move) {
  if (!biddingState) return;
  console.log('[MP] Remote pass from seat', move.seat);

  mpSuppressSend = true;
  mpWaitingForRemote = false;

  const passer = move.seat;
  if (passer !== biddingState.currentBidder) {
    console.log('[MP] Pass from wrong seat');
    mpSuppressSend = false;
    return;
  }

  biddingState.passCount++;
  biddingState.bids.push({ seat: passer, playerNumber: seatToPlayer(passer), bid: 'pass' });

  setPlaceholderText(seatToVisual(passer), 'Pass', 'pass');
  session.status = getPlayerDisplayName(passer) + ' passes.';
  setStatus(session.status);

  const _passTimer = setTimeout(() => {
    const advance = advanceBidding() || { done: true }; // V10_121f: defensive null-check
    mpSuppressSend = false;
    if (!advance.done) {
      mpRunBiddingStep();
    }
  }, 600);
  _addBiddingTimer(_passTimer);
}

// Handle remote Moon widow swap result
function mpHandleWidowSwap(move) {
  if (GAME_MODE !== 'MOON' || !session) return;
  console.log('[MP] Remote widow swap from seat', move.seat);

  mpSuppressSend = true;

  // Update the widow tile
  if (move.newWidow) {
    session.moon_widow = [move.newWidow[0], move.newWidow[1]];
  }

  // If host receives from a guest, update the guest's hand
  if (mpIsHost && move.hand && move.seat !== mpSeat) {
    session.game.hands[move.seat] = move.hand.map(t => [t[0], t[1]]);
  }

  // Transition to trump selection
  session.phase = PHASE_NEED_TRUMP;
  updateWidowDisplay();

  const bidWinnerSeat = session.bid_winner_seat;
  if (bidWinnerSeat === mpSeat) {
    // We're the bid winner — this shouldn't normally happen (we'd do it locally)
    setStatus('Widow swap done. Select trump.');
    mpHideWaiting();
    showTrumpOverlay(true);
    // V10_121g: Ensure trump selection is active for proper domino clicks
    trumpSelectionActive = true;
    enableTrumpDominoClicks();
  } else if (mpIsHost && mpIsAI(bidWinnerSeat)) {
    // AI on host — shouldn't get here (host handles AI locally)
  } else {
    // Remote player — now waiting for their trump selection
    setStatus(getPlayerDisplayName(bidWinnerSeat) + ' selecting trump...');
  }

  mpSuppressSend = false;
}

// Handle remote trump selection
function mpHandleTrump(move) {
  console.log('[MP] Remote trump selection:', move);
  mpSuppressSend = true;
  mpWaitingForRemote = false;
  mpHideWaiting();

  // V10_114: Ensure bid_winner_seat is set BEFORE set_trump is called.
  // Host may send trump before guest's bidding finalization setTimeout fires,
  // so bid_winner_seat could still be default (0). The trump move includes
  // the seat of whoever selected trump = the bid winner.
  if (move.seat !== undefined) {
    session.bid_winner_seat = move.seat;
    session.current_bid = move.bid || session.current_bid;
    session.bid_marks = move.marks || session.bid_marks || 1;
  }

  let trumpValue = move.trump;
  if (trumpValue === 'NT') trumpValue = null;

  if (move.nello) {
    session.contract = 'NELLO';
    session.bid_marks = move.marks || 1;
    session.game.set_trump_suit(null);
    if (move.activePlayers) {
      session.game.set_active_players(move.activePlayers);
      // Clear hands of sitting-out players
      for (let p = 0; p < session.game.player_count; p++) {
        if (!move.activePlayers.includes(p)) {
          session.game.hands[p] = [];
          // Clear sprites for that player
          if (sprites[p]) {
            sprites[p].forEach(sd => { if (sd && sd.sprite) { sd.sprite.remove(); if(sd.sprite._shadow) sd.sprite._shadow.remove(); } });
            sprites[p] = [];
          }
        }
      }
    }
    session.game.leader = session.bid_winner_seat;
    session.game.current_player = session.bid_winner_seat;
    _trackCpChange('mpHandleTrump-nello');
    session.phase = PHASE_PLAYING;
    setStatus('Nel-O: Lose all tricks to win.');
  } else {
    session.set_trump(trumpValue);
    _trackCpChange('mpHandleTrump-setTrump');
    syncSpritesWithGameState();
    // V10_119: Sort local player's hand by trump regardless of who won bid.
    // Previously only sorted if mpSeat === bid_winner, but ALL players need
    // their hand sorted visually after trump is set.
    sortPlayerHandByTrump();
    // V10_119: Sort all other players' hands + flip tiles for trump pip orientation
    sortAllHandsByTrump();
    flipTilesForTrump();
    updateTrumpDisplay();
    setStatus(session.status);
  }

  // V10_119: Hide trump selection overlay — guest may have it visible if they
  // were the bid winner selecting trump, or if it was left over from a previous state.
  const _trumpBd = document.getElementById('trumpBackdrop');
  if (_trumpBd) _trumpBd.style.display = 'none';
  // Also clear any leftover trump selection state
  trumpSelectionActive = false;
  disableTrumpDominoClicks();
  clearTrumpHighlights();

  mpSuppressSend = false;

  // Continue to play phase
  mpCheckWhoseTurn();

  // V10_119: Process any plays that were queued while waiting for trump.
  // Network reordering can cause play messages to arrive before trump message.
  if (_mpPlayQueue.length > 0) {
    console.log('[MP] Processing', _mpPlayQueue.length, 'queued play(s) after trump selection');
    const queued = _mpPlayQueue.splice(0);
    for (const qp of queued) {
      setTimeout(() => mpHandlePlay(qp), 100);
    }
  }
}

// Queue for pending remote plays during animation
let _mpPlayQueue = [];

// Handle remote play (tile played)
async function mpHandlePlay(move) {
  // Queue plays that arrive while we're still animating a previous play
  if (isAnimating) {
    console.log('[MP] Queuing play (animation in progress):', move.seat, move.tile);
    _mpPlayQueue.push(move);
    return;
  }
  // V10_119: Queue plays that arrive before trump selection is complete.
  // Network reordering can cause a play to arrive before the trump message.
  // Without this guard, the play processes but mpCheckWhoseTurn exits silently
  // (phase != PLAYING), leaving the guest stuck.
  if (session.phase !== PHASE_PLAYING) {
    console.warn('[MP] Queuing play — phase is', session.phase, 'not PLAYING:', move.seat, move.tile);
    mpLogEntry('WARN', 'play-queued', 'Play queued — phase=' + session.phase + ' seat=' + move.seat);
    _mpPlayQueue.push(move);
    return;
  }
  console.log('[MP] Remote play from seat', move.seat, 'tile:', move.tile, 'current_player:', session.game.current_player);
  mpSuppressSend = true;
  mpWaitingForRemote = false;
  // Guest: track this play in case host disconnects and needs to reconcile
  if (!mpIsHost) mpGuestTrackPlay(move.seat, move.tile);
  mpHideWaiting();

  const seat = move.seat;
  const tile = move.tile;

  // CRITICAL: Sync current_player if out of sync
  // The sender is authoritative — if their seat doesn't match our current_player,
  // our state drifted (e.g. due to timing). Force-sync to allow the play.
  if (seat !== session.game.current_player) {
    console.warn('[MP] Turn out of sync! Expected seat', session.game.current_player, 'but got play from seat', seat, '— force-syncing');
    mpLogEntry('ERROR', 'desync', 'Turn out of sync: expected seat ' + session.game.current_player + ' got seat ' + seat, mpGetGameSnapshot());
    session.game.current_player = seat;
    _trackCpChange('mpHandlePlay-desync');
  }

  // Find the tile in the game hand
  const hand = session.game.hands[seat] || [];
  let gameHandIndex = -1;
  for (let i = 0; i < hand.length; i++) {
    const ht = hand[i];
    if ((ht[0] === tile[0] && ht[1] === tile[1]) || (ht[0] === tile[1] && ht[1] === tile[0])) {
      gameHandIndex = i;
      break;
    }
  }

  if (gameHandIndex < 0) {
    console.log('[MP] Could not find tile in hand:', tile, 'hand:', hand);
    mpLogEntry('ERROR', 'tile-not-found', 'Tile ' + JSON.stringify(tile) + ' not in hand for seat ' + seat, { hand: hand.map(t=>[t[0],t[1]]), snapshot: mpGetGameSnapshot() });
    mpSuppressSend = false;
    return;
  }

  // Find sprite
  const seatSprites = sprites[seat] || [];
  let spriteIdx = -1;
  for (let i = 0; i < seatSprites.length; i++) {
    const sd = seatSprites[i];
    if (sd && sd.tile && ((sd.tile[0] === tile[0] && sd.tile[1] === tile[1]) || (sd.tile[0] === tile[1] && sd.tile[1] === tile[0]))) {
      spriteIdx = i;
      break;
    }
  }

  isAnimating = true;
  
  // V10_122c: Safety timeout for iOS - if animation doesn't complete in 10s, force unlock
  const _animTimeout = setTimeout(() => {
    if(isAnimating){
      console.warn('[MP] Animation timeout — forcing unlock (iOS recovery)');
      isAnimating = false;
      mpCheckWhoseTurn();
    }
  }, 10000);
  
  const isLead = session.game.current_trick.length === 0;

  // Play in game engine
  try {
    session.play(seat, gameHandIndex);
  } catch(e) {
    console.log('[MP] Play error:', e);
    isAnimating = false;
    clearTimeout(_animTimeout);
    mpSuppressSend = false;
    return;
  }

  // Animate
  if (spriteIdx >= 0) {
    try {
      await playDomino(seat, spriteIdx, isLead, null, null);
    } catch(animErr) {
      console.warn('[MP] playDomino error (non-fatal):', animErr);
    }
  }

  // Check trick complete
  if (session.game._sanitized_trick().length >= session.game.active_players.length) {
    await new Promise(r => setTimeout(r, 800));
    await collectToHistory();
    session.game.current_trick = [];
    // Clear call for double after trick 1
    if(session.game.force_double_trump){
      session.game.force_double_trump = false;
      callForDoubleActive = false;
      clearForcedDoubleGlow();
      hideCallDoubleBanner();
    }
    playedThisTrick = [];
    currentTrick++;

    if (session.maybe_finish_hand()) {
      setStatus(session.status);
      team1Score = session.game.team_points[0];
      team2Score = session.game.team_points[1];
      team1Marks = session.team_marks[0];
      team2Marks = session.team_marks[1];
      updateScoreDisplay();
      logEvent('HAND_END', { status: session.status });
      setTimeout(() => mpShowHandEnd(), 800);
      isAnimating = false;
      clearTimeout(_animTimeout);
      mpSuppressSend = false;
      return;
    }
  }

  isAnimating = false;
  clearTimeout(_animTimeout);
  mpSuppressSend = false;

  // Sync current_player from host's broadcast if provided
  if (move.nextPlayer !== undefined && move.nextPlayer !== session.game.current_player) {
    console.warn('[MP] Post-play sync: adjusting current_player from', session.game.current_player, 'to', move.nextPlayer);
    session.game.current_player = move.nextPlayer;
    _trackCpChange('mpHandlePlay-postSync');
  }

  // Process any queued plays
  if (_mpPlayQueue.length > 0) {
    const nextPlay = _mpPlayQueue.shift();
    console.log('[MP] Processing queued play:', nextPlay.seat, nextPlay.tile);
    mpHandlePlay(nextPlay);
    return;
  }

  // Check whose turn it is next
  mpCheckWhoseTurn();
  // Auto-save host state after each play
  if (mpIsHost) mpSaveHostState();
}

// Handle nello setup
function mpHandleNello(move) {
  console.log('[MP] Nello setup:', move);
  // Handled via mpHandleTrump with nello flag
}

// ═══════════════════════════════════════════════════════════════════════
//  V10_121: PURE HOST AUTHORITY — Intent handlers (host only) +
//           Confirmed handlers (all clients)
// ═══════════════════════════════════════════════════════════════════════

// ── Pending intent state for guest "lift tile" UX ──
let _pendingPlayIntent = null;  // {seat, tile, spriteIdx, spriteElement, originalTransform}
let _pendingCallDoubleHostData = null;  // Host: deferred play data waiting for guest's call_double_intent
let _pendingPlayTimeout = null;

// V11.3: Generic intent timeout — covers bid/pass/trump intents that lack
// the play_intent's specific lift/drop UX but still need timeout recovery
// when the host is unreachable.
let _pendingIntentTimeout = null;
function _startIntentTimeout(intentType) {
  if (_pendingIntentTimeout) clearTimeout(_pendingIntentTimeout);
  _pendingIntentTimeout = setTimeout(() => {
    _pendingIntentTimeout = null;
    console.warn('[MP-HA] ' + intentType + ' intent timeout — host may be unreachable');
    mpLogEntry('WARN', intentType + '_timeout', 'No confirmation after 10s');
    setStatus('Host not responding — retrying...');
    if (mpSocket && mpSocket.readyState === WebSocket.OPEN) {
      try { mpSendMove({ action: 'refresh_request', seat: mpSeat }); } catch(e) {}
    } else if (mpRoom) {
      _mpReconnectAttempts = 0;
      mpConnect(mpRoom);
    }
  }, 10000);
}
function _clearIntentTimeout() {
  if (_pendingIntentTimeout) {
    clearTimeout(_pendingIntentTimeout);
    _pendingIntentTimeout = null;
  }
}

// ── HOST: Handle play intent from guest ──
async function mpHandlePlayIntent(move) {
  if (!mpIsHost) return;
  console.log('[MP-HA] Play intent from seat', move.seat, 'tile:', move.tile);
  mpLogEntry('RECV', 'play_intent', 'seat=' + move.seat + ' tile=' + JSON.stringify(move.tile));

  // Validate: correct turn?
  if (move.seat !== session.game.current_player) {
    console.warn('[MP-HA] Rejecting play — wrong turn. Expected', session.game.current_player, 'got', move.seat);
    mpSendMove({ action: 'play_rejected', seat: move.seat, reason: 'Not your turn (expected seat ' + session.game.current_player + ')' });
    return;
  }

  // Find tile in hand
  const hand = session.game.hands[move.seat] || [];
  let gameHandIndex = -1;
  for (let i = 0; i < hand.length; i++) {
    const ht = hand[i];
    if ((ht[0] === move.tile[0] && ht[1] === move.tile[1]) || (ht[0] === move.tile[1] && ht[1] === move.tile[0])) {
      gameHandIndex = i;
      break;
    }
  }
  if (gameHandIndex < 0) {
    console.warn('[MP-HA] Rejecting play — tile not found in hand:', move.tile);
    mpSendMove({ action: 'play_rejected', seat: move.seat, reason: 'Tile not in hand' });
    return;
  }

  // Validate: legal move?
  const legal = session.game.legal_indices_for_player(move.seat);
  if (!legal.includes(gameHandIndex)) {
    console.warn('[MP-HA] Rejecting play — illegal move:', move.tile, 'legal:', legal);
    mpSendMove({ action: 'play_rejected', seat: move.seat, reason: 'Illegal move' });
    return;
  }

  // ── Execute play in engine ──
  const isLead = session.game.current_trick.length === 0;
  try {
    session.play(move.seat, gameHandIndex);
  } catch(e) {
    console.error('[MP-HA] Engine error on play:', e);
    mpSendMove({ action: 'play_rejected', seat: move.seat, reason: 'Engine error' });
    return;
  }

  // Determine trick/hand state AFTER play
  const trickComplete = session.game._sanitized_trick().length >= session.game.active_players.length;
  let trickWinner = null;
  let handComplete = false;
  let handResult = null;

  if (trickComplete) {
    trickWinner = session.game._determine_trick_winner();
  }

  // Build confirmed payload
  const confirmed = {
    action: 'play_confirmed',
    seat: move.seat,
    tile: move.tile,
    isLead: isLead,
    trickNumber: session.game.trick_number,
    nextPlayer: session.game.current_player,
    currentPlayer: session.game.current_player,
    trickComplete: trickComplete,
    trickWinner: trickWinner,
    handComplete: false,
    handResult: null,
    // V11.4: Send running score after every trick so guests can update display
    teamPoints: [session.game.team_points[0], session.game.team_points[1]]
  };

  // ── V10_121: Check for Call for Double before broadcasting ──
  // If bid winner played lead on trick 0 and Call for Double should trigger,
  // we need to defer the play_confirmed broadcast until the decision is made
  if (isLead && shouldShowCallForDouble()) {
    const bidder = session.bid_winner_seat !== undefined ? session.bid_winner_seat : 0;
    if (bidder === move.seat && !mpIsAI(move.seat)) {
      // The guest who played IS the bid winner — ask them to decide
      console.log('[MP-HA] Call for Double check — sending request to guest seat', move.seat);
      _pendingCallDoubleHostData = { confirmed: confirmed, move: move, spriteIdx: -1 };
      // Find sprite for later animation
      const _seatSprites = sprites[move.seat] || [];
      for (let _si = 0; _si < _seatSprites.length; _si++) {
        const _sd = _seatSprites[_si];
        if (_sd && _sd.tile && ((_sd.tile[0] === move.tile[0] && _sd.tile[1] === move.tile[1]) || (_sd.tile[0] === move.tile[1] && _sd.tile[1] === move.tile[0]))) {
          _pendingCallDoubleHostData.spriteIdx = _si;
          break;
        }
      }
      mpSendMove({ action: 'call_double_request', seat: move.seat });
      return; // Wait for call_double_intent from guest
    } else if (mpIsAI(bidder)) {
      // AI decides Call for Double on host
      const shouldCall = aiShouldCallForDouble(bidder);
      if (shouldCall) {
        callForDoubleActive = true;
        session.game.force_double_trump = true;
        setStatus(getPlayerDisplayName(bidder) + ' calls for the double!');
        applyForcedDoubleGlow();
      }
      confirmed.callDouble = shouldCall;
      mpSendMove({ action: 'call_double_confirmed', called: shouldCall, seat: bidder });
    }
  }

  // ── Broadcast BEFORE trick collection so guests can animate ──
  mpSendMove(confirmed);
  mpLogEntry('SEND', 'play_confirmed', 'seat=' + move.seat + ' tile=' + JSON.stringify(move.tile) + ' trickComplete=' + trickComplete);

  // ── Animate on host side ──
  const seatSprites = sprites[move.seat] || [];
  let spriteIdx = -1;
  for (let i = 0; i < seatSprites.length; i++) {
    const sd = seatSprites[i];
    if (sd && sd.tile && ((sd.tile[0] === move.tile[0] && sd.tile[1] === move.tile[1]) || (sd.tile[0] === move.tile[1] && sd.tile[1] === move.tile[0]))) {
      spriteIdx = i;
      break;
    }
  }

  isAnimating = true;
  
  // V10_122c: Safety timeout for iOS
  const _animTimeout = setTimeout(() => {
    if(isAnimating){
      console.warn('[MP-HA] Animation timeout — forcing unlock (iOS recovery)');
      isAnimating = false;
      mpCheckWhoseTurn();
    }
  }, 10000);
  
  if (spriteIdx >= 0) {
    try { await playDomino(move.seat, spriteIdx, isLead, null, null); } catch(e) { console.warn('[MP-HA] playDomino error:', e); }
  }

  // ── Handle trick completion on host ──
  if (trickComplete) {
    await new Promise(r => setTimeout(r, 800));
    await collectToHistory();
    session.game.current_trick = [];
    if (session.game.force_double_trump) {
      session.game.force_double_trump = false;
      callForDoubleActive = false;
      clearForcedDoubleGlow();
      hideCallDoubleBanner();
    }
    playedThisTrick = [];
    currentTrick++;

    if (session.maybe_finish_hand()) {
      // Hand is over — broadcast updated confirmed with hand result
      const handEndConfirmed = {
        action: 'play_confirmed',
        seat: move.seat,
        tile: move.tile,
        isLead: isLead,
        trickNumber: session.game.trick_number,
        nextPlayer: session.game.current_player,
        currentPlayer: session.game.current_player,
        trickComplete: true,
        trickWinner: trickWinner,
        handComplete: true,
        handResult: {
          status: session.status,
          teamPoints: [session.game.team_points[0], session.game.team_points[1]],
          teamMarks: [session.team_marks[0], session.team_marks[1]]
        }
      };
      mpSendMove(handEndConfirmed);

      setStatus(session.status);
      team1Score = session.game.team_points[0];
      team2Score = session.game.team_points[1];
      team1Marks = session.team_marks[0];
      team2Marks = session.team_marks[1];
      updateScoreDisplay();
      logEvent('HAND_END', { status: session.status });
      setTimeout(() => mpShowHandEnd(), 800);
      isAnimating = false;
      clearTimeout(_animTimeout);
      mpSaveHostState();
      return;
    }
  }

  isAnimating = false;
  clearTimeout(_animTimeout);
  mpSaveHostState();
  mpCheckWhoseTurn();
}

// ── GUEST: Handle confirmed play from host ──
async function mpHandlePlayConfirmed(move) {
  // TX42-Client: Server is source of truth — process all confirmations

  console.log('[MP-HA] Play confirmed: seat', move.seat, 'tile:', move.tile, 'trickComplete:', move.trickComplete, 'handComplete:', move.handComplete);
  mpLogEntry('RECV', 'play_confirmed', 'seat=' + move.seat + ' tile=' + JSON.stringify(move.tile));

  // Clear pending intent if this was our play
  if (_pendingPlayIntent && move.seat === mpSeat) {
    _clearPendingPlayIntent();
  }

  // Queue if animating
  if (isAnimating) {
    console.log('[MP-HA] Queuing confirmed play (animating):', move.seat);
    _mpPlayQueue.push(move);
    return;
  }

  _mpLastActivityTime = Date.now();

  // Update guest's local session state (read-only updates)
  // Remove tile from hand
  const hand = session.game.hands[move.seat] || [];
  let gameHandIndex = -1;
  for (let i = 0; i < hand.length; i++) {
    const ht = hand[i];
    if ((ht[0] === move.tile[0] && ht[1] === move.tile[1]) || (ht[0] === move.tile[1] && ht[1] === move.tile[0])) {
      gameHandIndex = i;
      break;
    }
  }

  // Update engine state on guest (without calling session.play)
  if (gameHandIndex >= 0) {
    // Add to current trick
    session.game.current_trick.push([move.seat, hand[gameHandIndex]]);
    // Remove from hand
    session.game.hands[move.seat].splice(gameHandIndex, 1);
  }
  // Sync current_player from host
  session.game.current_player = move.currentPlayer;

  // Find and animate sprite
  const seatSprites = sprites[move.seat] || [];
  let spriteIdx = -1;
  for (let i = 0; i < seatSprites.length; i++) {
    const sd = seatSprites[i];
    if (sd && sd.tile && ((sd.tile[0] === move.tile[0] && sd.tile[1] === move.tile[1]) || (sd.tile[0] === move.tile[1] && sd.tile[1] === move.tile[0]))) {
      spriteIdx = i;
      break;
    }
  }

  // V10_121: Handle Call for Double flag from host
  if (move.callDouble === true) {
    callForDoubleActive = true;
    session.game.force_double_trump = true;
    applyForcedDoubleGlow();
    showCallDoubleBanner();
  } else if (move.callDouble === false) {
    // Explicitly not called — ensure clean state
    callForDoubleActive = false;
    session.game.force_double_trump = false;
  }

  isAnimating = true;
  const isLead = move.isLead;
  if (spriteIdx >= 0) {
    try { await playDomino(move.seat, spriteIdx, isLead, null, null); } catch(e) { console.warn('[MP-HA] Guest playDomino error:', e); }
  }

  // Handle trick completion
  if (move.trickComplete) {
    // V11.4: Update guest's tricks_team before collecting (fixes boneyard tracking)
    if (move.trickWinner !== null && move.trickWinner !== undefined) {
      const _winTeam = session.game.team_of(move.trickWinner);
      if (!session.game.tricks_team[_winTeam]) session.game.tricks_team[_winTeam] = [];
      const _trickRecord = [];
      for (const play of session.game.current_trick) {
        _trickRecord[play[0]] = play[1]; // seat → tile
      }
      session.game.tricks_team[_winTeam].push(_trickRecord);
    }

    // V11.4: Update running score from host (fixes score visibility for clients)
    if (move.teamPoints) {
      session.game.team_points = move.teamPoints;
      team1Score = move.teamPoints[0];
      team2Score = move.teamPoints[1];
    }

    await new Promise(r => setTimeout(r, 800));
    await collectToHistory();
    session.game.current_trick = [];

    // V11.4: Update score display after trick collection
    updateScoreDisplay();

    if (session.game.force_double_trump) {
      session.game.force_double_trump = false;
      callForDoubleActive = false;
      clearForcedDoubleGlow();
      hideCallDoubleBanner();
    }
    playedThisTrick = [];
    currentTrick++;

    // Handle hand completion
    if (move.handComplete && move.handResult) {
      session.game.team_points = move.handResult.teamPoints || [0, 0];
      session.team_marks = move.handResult.teamMarks || [0, 0];
      // V10_121g: Ensure status is properly set from host's handResult
      session.status = move.handResult.status || 'Hand over';
      setStatus(session.status);
      team1Score = session.game.team_points[0];
      team2Score = session.game.team_points[1];
      team1Marks = session.team_marks[0];
      team2Marks = session.team_marks[1];
      updateScoreDisplay();
      logEvent('HAND_END', { status: session.status });
      // V10_121g: Show hand end popup for guests (includes game end check)
      setTimeout(() => mpShowHandEnd(), 800);
      isAnimating = false;
      return;
    }
  }

  isAnimating = false;

  // Process queued plays
  if (_mpPlayQueue.length > 0) {
    const nextPlay = _mpPlayQueue.shift();
    mpHandlePlayConfirmed(nextPlay);
    return;
  }

  mpCheckWhoseTurn();
}

// ── GUEST: Handle play rejection from host ──
function mpHandlePlayRejected(move) {
  if (move.seat !== mpSeat) return;
  console.warn('[MP-HA] Play rejected:', move.reason);
  mpLogEntry('RECV', 'play_rejected', 'reason=' + move.reason);

  // Drop tile back and re-enable
  _dropTileFromIntent();

  setStatus('Move rejected: ' + (move.reason || 'Unknown error'));
  // Request state sync to recover
  setTimeout(() => {
    mpSendMove({ action: 'refresh_request', seat: mpSeat });
  }, 1000);
}

// ── Helper: Lift tile for pending intent (guest UX) ──
function _liftTileForIntent(spriteSlotIndex) {
  const localSeat = getLocalSeat();
  const spriteData = sprites[localSeat] ? sprites[localSeat][spriteSlotIndex] : null;
  if (!spriteData || !spriteData.sprite) return;

  const el = spriteData.sprite;
  const currentTransform = el.style.transform || '';

  _pendingPlayIntent = {
    seat: mpSeat,
    tile: spriteData.tile,
    spriteIdx: spriteSlotIndex,
    spriteElement: el,
    originalTransform: currentTransform
  };

  // Lift tile 20px upward
  el.style.transition = 'transform 0.2s ease';
  el.style.transform = currentTransform + ' translateY(-20px)';

  // Disable other tiles (no visual change, just unclickable)
  const p1Sprites = sprites[localSeat] || [];
  p1Sprites.forEach((data, idx) => {
    if (data && data.sprite && idx !== spriteSlotIndex) {
      data.sprite.style.pointerEvents = 'none';
    }
  });

  // Start timeout
  _pendingPlayTimeout = setTimeout(() => {
    console.warn('[MP-HA] Play intent timeout — requesting state sync');
    mpLogEntry('WARN', 'play_timeout', 'No response to play intent');
    _dropTileFromIntent();
    setStatus('Connection issue — syncing with host...');
    mpSendMove({ action: 'refresh_request', seat: mpSeat });
  }, 5000);
}

// ── Helper: Drop tile back from intent (reject/timeout) ──
function _dropTileFromIntent() {
  if (!_pendingPlayIntent) return;

  const el = _pendingPlayIntent.spriteElement;
  if (el) {
    el.style.transition = 'transform 0.2s ease';
    el.style.transform = _pendingPlayIntent.originalTransform;
    // Clean up transition after it completes
    setTimeout(() => { if (el) el.style.transition = ''; }, 250);
  }

  // Re-enable all tiles
  const localSeat = getLocalSeat();
  const p1Sprites = sprites[localSeat] || [];
  p1Sprites.forEach((data) => {
    if (data && data.sprite) {
      data.sprite.style.pointerEvents = '';
    }
  });

  // Play rejection sound
  if (typeof SFX !== 'undefined' && SFX.invalidSelection) SFX.invalidSelection();

  _clearPendingPlayIntent();

  // Re-enable clicks for player's turn
  waitingForPlayer1 = true;
  enablePlayer1Clicks();
  updatePlayer1ValidStates();
}

// ── Helper: Clear pending intent state ──
function _clearPendingPlayIntent() {
  if (_pendingPlayTimeout) {
    clearTimeout(_pendingPlayTimeout);
    _pendingPlayTimeout = null;
  }

  if (_pendingPlayIntent && _pendingPlayIntent.spriteElement) {
    const el = _pendingPlayIntent.spriteElement;
    el.style.transition = '';
    // Restore pointer events on all tiles
    const localSeat = getLocalSeat();
    const p1Sprites = sprites[localSeat] || [];
    p1Sprites.forEach((data) => {
      if (data && data.sprite) data.sprite.style.pointerEvents = '';
    });
  }

  _pendingPlayIntent = null;
}

// ═══ HOST: Bidding intent handlers ═══

function mpHandleBidIntent(move) {
  if (!mpIsHost || !biddingState) return;
  console.log('[MP-HA] Bid intent from seat', move.seat, 'bid:', move.bid, 'marks:', move.marks);
  mpLogEntry('RECV', 'bid_intent', 'seat=' + move.seat + ' bid=' + move.bid);

  // Validate: correct bidder?
  if (move.seat !== biddingState.currentBidder) {
    console.warn('[MP-HA] Bid from wrong seat, expected:', biddingState.currentBidder, 'got:', move.seat);
    return;
  }

  // Update biddingState on host
  biddingState.highBid = move.bid;
  biddingState.highBidder = move.seat;
  biddingState.highMarks = move.marks || 1;
  if (move.multiplier) {
    biddingState.inMultiplierMode = true;
    biddingState.highMultiplier = move.multiplier;
  }
  if (move.moonShoot) {
    biddingState.moonShoot = true;
  }
  biddingState.bids.push({ seat: move.seat, playerNumber: seatToPlayer(move.seat), bid: move.bid });

  // Display on host
  const visualNum = seatToVisual(move.seat);
  const displayBid = (move.marks > 1) ? (move.marks + 'x') : move.bid;
  setPlaceholderText(visualNum, displayBid, 'bid');
  session.status = getPlayerDisplayName(move.seat) + ' bids ' + displayBid + '!';
  setStatus(session.status);

  // Advance bidding on host
  setTimeout(() => {
    if (!biddingState) return;
    const advance = advanceBidding() || { done: true }; // V10_121f: defensive null-check

    // Broadcast confirmed bid to all (including guests)
    const confirmed = {
      action: 'bid_confirmed',
      seat: move.seat,
      bid: move.bid,
      marks: move.marks || 1,
      multiplier: move.multiplier || 0,
      moonShoot: move.moonShoot || false,
      displayBid: displayBid,
      biddingDone: advance.done || false,
      nextBidder: biddingState ? biddingState.currentBidder : null,
      // If bidding done, include result
      bidWinner: advance.done ? (biddingState ? biddingState.highBidder : session.bid_winner_seat) : null,
      winningBid: advance.done ? (biddingState ? biddingState.highBid : session.current_bid) : null,
      winningMarks: advance.done ? (biddingState ? biddingState.highMarks : session.bid_marks) : null,
      redeal: advance.redeal || false
    };
    mpSendMove(confirmed);
    mpSaveHostState();

    if (!advance.done) {
      mpRunBiddingStep();
    }
    // If done, finalizeBidding() was called inside advanceBidding()
  }, 600);
}

function mpHandlePassIntent(move) {
  if (!mpIsHost || !biddingState) return;
  console.log('[MP-HA] Pass intent from seat', move.seat);
  mpLogEntry('RECV', 'pass_intent', 'seat=' + move.seat);

  // Validate: correct bidder?
  if (move.seat !== biddingState.currentBidder) {
    console.warn('[MP-HA] Pass from wrong seat, expected:', biddingState.currentBidder, 'got:', move.seat);
    return;
  }

  // Update biddingState on host
  biddingState.passCount++;
  biddingState.bids.push({ seat: move.seat, playerNumber: seatToPlayer(move.seat), bid: 'pass' });

  // Display on host
  setPlaceholderText(seatToVisual(move.seat), 'Pass', 'pass');
  session.status = getPlayerDisplayName(move.seat) + ' passes.';
  setStatus(session.status);

  // Advance bidding on host
  setTimeout(() => {
    if (!biddingState) return;
    const advance = advanceBidding() || { done: true }; // V10_121f: defensive null-check

    // Broadcast confirmed pass to all
    const confirmed = {
      action: 'pass_confirmed',
      seat: move.seat,
      biddingDone: advance.done || false,
      nextBidder: biddingState ? biddingState.currentBidder : null,
      bidWinner: advance.done ? (biddingState ? biddingState.highBidder : session.bid_winner_seat) : null,
      winningBid: advance.done ? (biddingState ? biddingState.highBid : session.current_bid) : null,
      winningMarks: advance.done ? (biddingState ? biddingState.highMarks : session.bid_marks) : null,
      redeal: advance.redeal || false
    };
    mpSendMove(confirmed);
    mpSaveHostState();

    if (!advance.done) {
      mpRunBiddingStep();
    }
  }, 600);
}

// ═══ GUEST: Confirmed bid/pass handlers ═══

// Helper: Show trump selection UI for guest who won bid
function _guestShowTrumpSelection(winningBid) {
  if (mpIsHost) return;
  console.log('[MP-HA] Guest won the bid — showing trump selection');
  mpLogEntry('STATE', 'guest-trump', 'Guest won bid, showing trump overlay');

  // V11.3: Compute Nello eligibility (same logic as finalizeBidding host path)
  if(typeof nelloDeclareMode !== 'undefined' && nelloDeclareMode){
    _nelloAllowedAtTrump = false;
  } else if(typeof nelloRestrictFirst !== 'undefined' && nelloRestrictFirst && biddingState){
    const winMarks = biddingState.highMarks || 1;
    if(!biddingState.inMultiplierMode && biddingState.highBid < (GAME_MODE === 'T42' ? 42 : 51)){
      _nelloAllowedAtTrump = (winMarks <= 1);
    } else if(!biddingState.inMultiplierMode){
      _nelloAllowedAtTrump = (winMarks <= 2);
    } else {
      _nelloAllowedAtTrump = (winMarks <= (biddingState.highMultiplier || 1) + 1);
    }
  } else {
    _nelloAllowedAtTrump = true;
  }

  const bidWinnerVisual = seatToVisual(mpSeat);
  const highBid = winningBid || (biddingState ? biddingState.highBid : session.current_bid);
  setPlaceholderText(bidWinnerVisual, highBid, 'winner');
  if (typeof initOffTracker === 'function') initOffTracker();

  // Hide bid overlay
  const bidBackdrop = document.getElementById('bidBackdrop');
  if (bidBackdrop) bidBackdrop.style.display = 'none';

  biddingState = null;
  session.phase = PHASE_NEED_TRUMP;
  setStatus('You won the bid at ' + highBid + '! Select trump.');
  triggerHaptic([50, 50, 100]); // V11.4: Haptic for winning bid
  mpHideWaiting();
  showTrumpOverlay(true);
  trumpSelectionActive = true;
  enableTrumpDominoClicks();
}

function mpHandleBidConfirmed(move) {
  // TX42-Client: Server is source of truth — process all confirmations
  console.log('[MP-HA] Bid confirmed: seat', move.seat, 'bid:', move.bid);
  mpLogEntry('RECV', 'bid_confirmed', 'seat=' + move.seat + ' bid=' + move.bid);
  _clearIntentTimeout(); // V11.3: Clear bid/pass intent timeout

  // V10_121h: Check if bidding is done FIRST (before checking biddingState)
  // This handles the case where guest reconnects or biddingState is null
  if (move.biddingDone && move.bidWinner !== null && move.bidWinner !== undefined) {
    session.bid_winner_seat = move.bidWinner;
    session.current_bid = move.winningBid;
    session.bid_marks = move.winningMarks;
    
    // If WE are the bid winner, show trump selection UI
    if (move.bidWinner === mpSeat) {
      _guestShowTrumpSelection(move.winningBid);
      return;
    }
    // Someone else won - clear bidding state and wait for trump_confirmed
    biddingState = null;
    return;
  }

  if (!biddingState) { mpLogEntry('WARN', 'bid_confirmed', 'biddingState=null, ignoring'); return; }
  _mpLastActivityTime = Date.now();

  // Update guest biddingState
  biddingState.highBid = move.bid;
  biddingState.highBidder = move.seat;
  biddingState.highMarks = move.marks || 1;
  if (move.multiplier) {
    biddingState.inMultiplierMode = true;
    biddingState.highMultiplier = move.multiplier;
  }
  if (move.moonShoot) biddingState.moonShoot = true;
  biddingState.bids.push({ seat: move.seat, playerNumber: seatToPlayer(move.seat), bid: move.bid });

  // Display — V10_121f: log placeholder update for diagnostics
  const visualNum = seatToVisual(move.seat);
  const displayBid = move.displayBid || ((move.marks > 1) ? (move.marks + 'x') : move.bid);
  const phEl = placeholderElements['p' + visualNum];
  mpLogEntry('STATE', 'bid-placeholder', 'seat=' + move.seat + ' visual=p' + visualNum + ' text=' + displayBid + ' elExists=' + !!phEl);
  setPlaceholderText(visualNum, displayBid, 'bid');
  session.status = getPlayerDisplayName(move.seat) + ' bids ' + displayBid + '!';
  setStatus(session.status);

  // Not done — advance to next bidder on guest
  if (move.nextBidder !== null && move.nextBidder !== undefined) {
    biddingState.currentBidder = move.nextBidder;
  } else {
    advanceBidding(); // Fallback
  }
  mpRunBiddingStep();
}

function mpHandlePassConfirmed(move) {
  // TX42-Client: Server is source of truth — process all confirmations
  console.log('[MP-HA] Pass confirmed: seat', move.seat);
  mpLogEntry('RECV', 'pass_confirmed', 'seat=' + move.seat);
  _clearIntentTimeout(); // V11.3: Clear bid/pass intent timeout

  // V10_121h: Check if bidding is done FIRST (before checking biddingState)
  if (move.biddingDone) {
    if (move.bidWinner !== null && move.bidWinner !== undefined) {
      session.bid_winner_seat = move.bidWinner;
      session.current_bid = move.winningBid;
      session.bid_marks = move.winningMarks;
      
      // If WE are the bid winner, show trump selection UI
      if (move.bidWinner === mpSeat) {
        _guestShowTrumpSelection(move.winningBid);
        return;
      }
    }
    if (move.redeal) {
      setStatus('Everyone passed. Redealing...');
      // Host will send new deal
    }
    biddingState = null; // Clear bidding state
    return;
  }

  if (!biddingState) { mpLogEntry('WARN', 'pass_confirmed', 'biddingState=null, ignoring'); return; }
  _mpLastActivityTime = Date.now();

  // Update guest biddingState
  biddingState.passCount++;
  biddingState.bids.push({ seat: move.seat, playerNumber: seatToPlayer(move.seat), bid: 'pass' });

  // Display — V10_121f: log placeholder update for diagnostics
  const _passVisual = seatToVisual(move.seat);
  const _passPhEl = placeholderElements['p' + _passVisual];
  mpLogEntry('STATE', 'pass-placeholder', 'seat=' + move.seat + ' visual=p' + _passVisual + ' elExists=' + !!_passPhEl);
  setPlaceholderText(_passVisual, 'Pass', 'pass');
  session.status = getPlayerDisplayName(move.seat) + ' passes.';
  setStatus(session.status);

  if (move.nextBidder !== null && move.nextBidder !== undefined) {
    biddingState.currentBidder = move.nextBidder;
  } else {
    advanceBidding();
  }
  mpRunBiddingStep();
}

// ═══ HOST: Trump intent handler ═══

function mpHandleTrumpIntent(move) {
  if (!mpIsHost) return;
  console.log('[MP-HA] Trump intent from seat', move.seat, 'trump:', move.trump);
  mpLogEntry('RECV', 'trump_intent', 'seat=' + move.seat + ' trump=' + move.trump);

  // Convert 'NT' to null for engine
  let trumpValue = move.trump;
  if (trumpValue === 'NT') trumpValue = null;

  // V11.4j: Set DFM runtime flag from intent
  if (move.trump === 'DOUBLES') {
    if (doublesFollowMe === 'on') _dfmActiveThisHand = true;
    else if (doublesFollowMe === 'off') _dfmActiveThisHand = false;
    else _dfmActiveThisHand = !!move.dfmActive; // player_chooses: use guest's choice
  } else {
    _dfmActiveThisHand = false;
  }

  // Execute trump selection on host engine
  if (move.nello) {
    // V10_121f: Use set_trump('NELLO') so partner-sit-out logic runs correctly.
    // Previously did manual setup that skipped active_players computation when guest selected Nello.
    session.bid_marks = move.marks || 1;
    session.set_trump('NELLO');
    // set_trump sets leader, current_player, phase, contract, active_players, and clears partner hand
  } else {
    session.set_trump(trumpValue);
  }

  syncSpritesWithGameState();
  sortPlayerHandByTrump();
  sortAllHandsByTrump();
  flipTilesForTrump();
  updateTrumpDisplay();

  // Broadcast confirmed trump to all
  const confirmed = {
    action: 'trump_confirmed',
    trump: move.trump,
    seat: move.seat,
    marks: move.marks || session.bid_marks,
    nello: move.nello || false,
    activePlayers: session.game.active_players ? session.game.active_players.slice() : null,
    firstPlayer: session.game.current_player,
    dfmActive: _dfmActiveThisHand
  };
  mpSendMove(confirmed);
  mpSaveHostState();

  // Start playing
  setTimeout(() => mpCheckWhoseTurn(), 300);
}

// ═══ GUEST: Confirmed trump handler ═══

function mpHandleTrumpConfirmed(move) {
  // TX42-Client: Server is source of truth — process all confirmations
  console.log('[MP-HA] Trump confirmed: trump=', move.trump, 'seat=', move.seat, 'nello=', move.nello);
  mpLogEntry('RECV', 'trump_confirmed', 'trump=' + move.trump + ' seat=' + move.seat);
  _clearIntentTimeout(); // V11.3: Clear trump intent timeout

  _mpLastActivityTime = Date.now();

  // V11.4j: Set DFM runtime flag from confirmed message
  _dfmActiveThisHand = !!move.dfmActive;

  // Set bid winner if needed
  session.bid_winner_seat = move.seat;
  session.bid_marks = move.marks || 1;

  let trumpValue = move.trump;
  if (trumpValue === 'NT') trumpValue = null;

  if (move.nello) {
    session.contract = 'NELLO';
    session.game.set_trump_suit(null);
    if (move.activePlayers) {
      session.game.set_active_players(move.activePlayers);
      // Clear hands/sprites for non-active players
      for (let s = 0; s < session.game.player_count; s++) {
        if (!move.activePlayers.includes(s)) {
          session.game.hands[s] = [];
          if (sprites[s]) {
            sprites[s].forEach(sd => { if (sd && sd.sprite) sd.sprite.remove(); });
            sprites[s] = [];
          }
        }
      }
    }
    session.game.leader = move.seat;
    session.game.current_player = move.firstPlayer || move.seat;
    session.phase = PHASE_PLAYING;
  } else {
    session.set_trump(trumpValue);
    if (move.firstPlayer !== undefined) {
      session.game.current_player = move.firstPlayer;
    }
  }

  syncSpritesWithGameState();
  sortPlayerHandByTrump();
  sortAllHandsByTrump();
  flipTilesForTrump();
  updateTrumpDisplay();

  // Hide trump overlay
  const _trumpBd = document.getElementById('trumpBackdrop');
  if (_trumpBd) _trumpBd.style.display = 'none';
  trumpSelectionActive = false;
  disableTrumpDominoClicks();
  clearTrumpHighlights();

  // Process queued plays (V10_119 pattern)
  if (_mpPlayQueue.length > 0) {
    const queued = _mpPlayQueue.splice(0);
    for (const qp of queued) {
      setTimeout(() => mpHandlePlayConfirmed(qp), 100);
    }
  }

  mpCheckWhoseTurn();
}

// ═══ HOST: Widow swap intent handler ═══

function mpHandleWidowSwapIntent(move) {
  if (!mpIsHost) return;
  console.log('[MP-HA] Widow swap intent from seat', move.seat);
  mpLogEntry('RECV', 'widow_swap_intent', 'seat=' + move.seat);

  // Apply swap on host engine
  const swapHand = move.hand || move.newHand;
  if (swapHand) {
    session.game.hands[move.seat] = swapHand;
  }
  if (move.newWidow) {
    session.moon_widow = move.newWidow;
  }

  // Broadcast confirmed
  const confirmed = {
    action: 'widow_swap_confirmed',
    seat: move.seat,
    newWidow: session.moon_widow ? [session.moon_widow[0], session.moon_widow[1]] : null,
    hand: session.game.hands[move.seat]
  };
  mpSendMove(confirmed);
  mpSaveHostState();

  // Transition to trump selection phase
  session.phase = PHASE_NEED_TRUMP;

  // Host checks who selects trump (should be bid winner)
  const bidWinner = session.bid_winner_seat;
  if (bidWinner === mpSeat) {
    showTrumpOverlay(true);
    // V10_121g: Ensure trump selection is active for proper domino clicks
    trumpSelectionActive = true;
    enableTrumpDominoClicks();
    setStatus('Widow swapped! Select trump.');
  } else if (mpIsAI(bidWinner)) {
    const aiHand = session.game.hands[bidWinner];
    const aiTrump = aiChooseTrump(aiHand, session.current_bid);
    session.set_trump(aiTrump);
    // V11.4j: Set DFM flag for AI trump selection
    _dfmActiveThisHand = (aiTrump === 'DOUBLES' && doublesFollowMe !== 'off');
    syncSpritesWithGameState();
    updateTrumpDisplay();
    mpSendMove({ action: 'trump_confirmed', trump: aiTrump === null ? 'NT' : aiTrump, seat: bidWinner, marks: session.bid_marks, firstPlayer: session.game.current_player, dfmActive: _dfmActiveThisHand });
    setTimeout(() => mpCheckWhoseTurn(), 500);
  } else {
    setStatus(getPlayerDisplayName(bidWinner) + ' selecting trump...');
  }
}

// ═══ GUEST: Confirmed widow swap handler ═══

function mpHandleWidowSwapConfirmed(move) {
  if (mpIsHost) return;
  console.log('[MP-HA] Widow swap confirmed: seat', move.seat);
  _mpLastActivityTime = Date.now();

  // Update guest state
  if (move.newWidow) session.moon_widow = move.newWidow;
  const swapHand = move.hand || move.newHand;
  if (swapHand && move.seat !== undefined) {
    session.game.hands[move.seat] = swapHand;
    // Rebuild sprites for the swapped seat so tiles match the updated hand
    if (typeof rebuildHandSprites === 'function') {
      rebuildHandSprites(move.seat);
      syncSpritesWithGameState();
    }
  }

  session.phase = PHASE_NEED_TRUMP;

  // If we are the bid winner, show trump selection
  if (session.bid_winner_seat === mpSeat) {
    showTrumpOverlay(true);
    // V10_121g: Ensure trump selection is active for proper domino clicks
    trumpSelectionActive = true;
    enableTrumpDominoClicks();
    setStatus('Widow swapped! Select trump.');
  } else {
    setStatus(getPlayerDisplayName(session.bid_winner_seat) + ' selecting trump...');
  }
}

// ═══ HOST: Call for Double intent handler ═══

async function mpHandleCallDoubleIntent(move) {
  if (!mpIsHost) return;
  console.log('[MP-HA] Call for Double intent: called=', move.called, 'seat=', move.seat);

  if (move.called) {
    callForDoubleActive = true;
    session.game.force_double_trump = true;
    applyForcedDoubleGlow();
  } else {
    callForDoubleActive = false;
    session.game.force_double_trump = false;
  }

  // Broadcast confirmed to all
  mpSendMove({ action: 'call_double_confirmed', called: move.called, seat: move.seat });

  // Resume deferred play from mpHandlePlayIntent
  if (_pendingCallDoubleHostData) {
    const pending = _pendingCallDoubleHostData;
    _pendingCallDoubleHostData = null;
    const confirmed = pending.confirmed;
    confirmed.callDouble = move.called;

    // Broadcast the deferred play_confirmed
    mpSendMove(confirmed);
    mpLogEntry('SEND', 'play_confirmed', 'seat=' + confirmed.seat + ' tile=' + JSON.stringify(confirmed.tile) + ' (deferred after call_double)');

    // Animate on host
    isAnimating = true;
    if (pending.spriteIdx >= 0) {
      try { await playDomino(confirmed.seat, pending.spriteIdx, confirmed.isLead, null, null); } catch(e) { console.warn('[MP-HA] playDomino error:', e); }
    }

    // Handle trick completion
    if (confirmed.trickComplete) {
      await new Promise(r => setTimeout(r, 800));
      await collectToHistory();
      session.game.current_trick = [];
      if (session.game.force_double_trump) {
        session.game.force_double_trump = false;
        callForDoubleActive = false;
        clearForcedDoubleGlow();
        hideCallDoubleBanner();
      }
      playedThisTrick = [];
      currentTrick++;

      if (session.maybe_finish_hand()) {
        const handEndConfirmed = Object.assign({}, confirmed, {
          handComplete: true,
          handResult: {
            status: session.status,
            teamPoints: [session.game.team_points[0], session.game.team_points[1]],
            teamMarks: [session.team_marks[0], session.team_marks[1]]
          }
        });
        mpSendMove(handEndConfirmed);
        setStatus(session.status);
        team1Score = session.game.team_points[0];
        team2Score = session.game.team_points[1];
        team1Marks = session.team_marks[0];
        team2Marks = session.team_marks[1];
        updateScoreDisplay();
        logEvent('HAND_END', { status: session.status });
        setTimeout(() => mpShowHandEnd(), 800);
        isAnimating = false;
        mpSaveHostState();
        return;
      }
    }

    isAnimating = false;
    mpSaveHostState();
    mpCheckWhoseTurn();
  } else {
    mpSaveHostState();
  }
}

// ═══ ALL: Confirmed Call for Double ═══

function mpHandleCallDoubleConfirmed(move) {
  if (mpIsHost) return; // Host already applied
  console.log('[MP-HA] Call for Double confirmed: called=', move.called);

  if (move.called) {
    callForDoubleActive = true;
    session.game.force_double_trump = true;
    setStatus('Double has been called!');
    applyForcedDoubleGlow();
    showCallDoubleBanner();
  } else {
    callForDoubleActive = false;
    session.game.force_double_trump = false;
    clearForcedDoubleGlow();
  }
}

// ═══ HOST: Nello opponent selection intent handler ═══

function mpHandleNelloIntent(move) {
  if (!mpIsHost) return;
  console.log('[MP-HA] Nello intent from seat', move.seat, 'opponent=', move.selectedOpponent, 'marks=', move.marks);

  // Guest selected a nello opponent — host executes the nello setup
  if(move.selectedOpponent !== undefined){
    // Nello opponent selection (TN51 6-player only)
    _executeNelloSetup(move.selectedOpponent, move.marks || 1);
  } else {
    // Plain nello without opponent selection (T42 4-player) — handled via trump_intent
    mpHandleTrumpIntent(move);
  }
}

// ═══ GUEST: Confirmed nello ═══
function mpHandleNelloConfirmed(move) {
  if (mpIsHost) return;
  console.log('[MP-HA] Nello confirmed: opponent=', move.selectedOpponent, 'activePlayers=', move.activePlayers);

  if(move.selectedOpponent !== undefined){
    // Apply nello setup on guest from confirmed data
    const bidderSeat = move.seat;
    session.contract = 'NELLO';
    session.bid_marks = move.marks || 1;
    session.game.set_trump_suit(null);
    if(move.activePlayers) session.game.set_active_players(move.activePlayers);

    // Apply nello doubles suit from host
    nelloDoublesSuitActive = !!move.nelloDoublesSuit;
    session.game.nello_doubles_suit = nelloDoublesSuitActive;

    // Clear hands of sitting-out players
    for(let s = 0; s < session.game.player_count; s++){
      if(move.activePlayers && !move.activePlayers.includes(s)){
        session.game.hands[s] = [];
      }
    }

    session.game.leader = bidderSeat;
    session.game.current_player = move.firstPlayer || bidderSeat;
    _trackCpChange('mpHandleNelloConfirmed');
    session.phase = PHASE_PLAYING;
    const marksStr = (move.marks === 2) ? ' (2 Marks)' : '';
    session.status = `Nel-O${marksStr}: Lose all tricks to win.`;

    syncSpritesWithGameState();
    updateTrumpDisplay();
    renderAll();
    mpCheckWhoseTurn();
  } else {
    // Plain nello (T42) — handled via trump_confirmed
    mpHandleTrumpConfirmed(move);
  }
}

// ═══ HOST: Nello doubles intent handler ═══

function mpHandleNelloDoublesIntent(move) {
  if (!mpIsHost) return;
  console.log('[MP-HA] Nello doubles intent: mode=', move.mode);

  nelloDoublesSuitActive = (move.mode === 'doubles_only');
  session.game.nello_doubles_suit = nelloDoublesSuitActive;

  // Broadcast confirmed
  mpSendMove({ action: 'nello_doubles_confirmed', mode: move.mode });
  mpSaveHostState();
}

// ═══ GUEST: Confirmed nello doubles ═══

function mpHandleNelloDoublesConfirmed(move) {
  if (mpIsHost) return;
  console.log('[MP-HA] Nello doubles confirmed: mode=', move.mode);
  nelloDoublesSuitActive = (move.mode === 'doubles_only');
  session.game.nello_doubles_suit = nelloDoublesSuitActive;
}

// ═══ End of V10_121 Host Authority handlers ═══

// Handle start game from host
function mpHandleStartGame(move) {
  console.log('[MP] Game started by host');
  mpGameStarted = true;
  MULTIPLAYER_MODE = true;
  if (move.marksToWin) mpMarksToWin = move.marksToWin;
  // V10_109: Apply host's house rules
  if(move.houseRules){
    const hr = move.houseRules;
    if(typeof hr.callForDouble === 'boolean') callForDoubleEnabled = hr.callForDouble;
    if(typeof hr.nelloDeclare === 'boolean') nelloDeclareMode = hr.nelloDeclare;
    if(typeof hr.nelloRestrictFirst === 'boolean') nelloRestrictFirst = hr.nelloRestrictFirst;
    if(hr.nelloDoublesMode) nelloDoublesMode = hr.nelloDoublesMode;
    if(hr.doublesFollowMe) doublesFollowMe = hr.doublesFollowMe;
  }

  // Ensure game mode matches host
  if (move.gameMode && GAME_MODE !== move.gameMode) {
    initGameMode(move.gameMode);
  }

  // Apply layout settings for the game mode
  if (GAME_MODE === 'MOON') {
    applyMoonSettings();
  } else if (GAME_MODE === 'T42') {
    applyT42Settings();
  } else {
    applyTn51Settings();
  }

  // Hide any leftover bid overlay from single-player
  document.getElementById('bidBackdrop').style.display = 'none';

  if (move.version && move.version !== MP_VERSION) {
    mpShowVersionWarning(move.version, MP_VERSION);
  }
  // V10_109: Update MP settings panel to reflect host's rules (for guests viewing later)
  var _gCFD = document.getElementById('mpChkCallForDouble');
  var _gNDec = document.getElementById('mpChkNelloDeclare');
  var _gNRes = document.getElementById('mpChkNelloRestrict');
  if(_gCFD) { _gCFD.checked = callForDoubleEnabled; _gCFD.disabled = true; }
  if(_gNDec) { _gNDec.checked = nelloDeclareMode; _gNDec.disabled = true; }
  if(_gNRes) { _gNRes.checked = nelloRestrictFirst; _gNRes.disabled = true; }
  var _gRole = document.getElementById('mpSettingsRole');
  if(_gRole) _gRole.textContent = '(View Only)';
  // Disable nello doubles buttons for guests and sync visual state
  document.querySelectorAll('.mpNelloBtn').forEach(function(b){
    b.style.pointerEvents = 'none';
    b.classList.remove('mpNelloBtnSelected');
    b.style.background = 'rgba(255,255,255,0.05)';
    b.style.border = '1px solid rgba(255,255,255,0.15)';
    if(b.dataset.nello === nelloDoublesMode){
      b.classList.add('mpNelloBtnSelected');
      b.style.background = 'rgba(96,165,250,0.2)';
      b.style.border = '1px solid #60a5fa';
    }
  });
  // Disable doubles follow me buttons for guests and sync visual state
  document.querySelectorAll('.mpDfmBtn').forEach(function(b){
    b.style.pointerEvents = 'none';
    b.classList.remove('mpDfmBtnSelected');
    b.style.background = 'rgba(255,255,255,0.05)';
    b.style.border = '1px solid rgba(255,255,255,0.15)';
    if(b.dataset.dfm === doublesFollowMe){
      b.classList.add('mpDfmBtnSelected');
      b.style.background = 'rgba(96,165,250,0.2)';
      b.style.border = '1px solid #60a5fa';
    }
  });
  // Also disable marks buttons for guests
  document.querySelectorAll('.mpMarksBtn').forEach(function(b){ b.style.pointerEvents = 'none'; });

  document.getElementById('mpBackdrop').style.display = 'none';
  // Show sync button in indicator
  const refreshBtn = document.getElementById('mpRefreshBtn');
  if (refreshBtn) refreshBtn.style.display = 'inline-block';

  // Hide start screen
  const startScreen = document.getElementById('startScreenBackdrop');
  if (startScreen) startScreen.style.display = 'none';

  // The deal will follow as a separate message
  setStatus('Game starting...');
  // Show sync button
  const _rfBtn = document.getElementById('mpRefreshBtn');
  if (_rfBtn) _rfBtn.style.display = 'inline-block';
}

// Handle next hand from host
async function mpHandleNextHand(move) {
  console.log('[MP] Next hand from host');
  // V10_121: Auto-dismiss round/game end popups for guests
  hideRoundEndSummary();
  hideGameEndSummary();
  SFX.resumeBgmAfterResult();
  // The deal message will follow from the host
}

// Handle full game state sync (reconnection)
function mpHandleStateSync(move) {
  // V10_122c: CRITICAL - Wrap entire function in try-catch to prevent permanent hangs
  try {
    _mpHandleStateSyncInternal(move);
  } catch(error) {
    console.error('[MP] CRITICAL: State sync crashed:', error);
    mpLogEntry('ERROR', 'state_sync_crash', 'Error: ' + error.message, { stack: error.stack });
    
    // Release sync lock
    _syncInProgress = false;
    console.log('[MP] Sync lock released (crash recovery)');
    
    // Hide syncing overlay
    hideSyncingOverlay();
    
    // Reset flags
    mpSuppressSend = false;
    isAnimating = false;
    
    // Show error to user
    setStatus('Sync failed - please refresh manually');
    
    // Try to recover by requesting fresh sync after delay
    setTimeout(() => {
      if(mpIsHost){
        console.log('[MP] Host recovering from sync crash');
        mpCheckWhoseTurn();
      } else {
        console.log('[MP] Guest recovering from sync crash - requesting refresh');
        mpRequestRefresh();
      }
    }, 2000);
  }
}

// Internal state sync implementation (wrapped by try-catch)
function _mpHandleStateSyncInternal(move) {
  // ═══════════════════════════════════════════════════════════════
  // V10_122: SYNC LOCK MECHANISM - Prevent race conditions
  // ═══════════════════════════════════════════════════════════════
  
  // V10_122e: Clear refresh timeout if it exists (host responded!)
  if(window._mpRefreshTimeout){
    clearTimeout(window._mpRefreshTimeout);
    window._mpRefreshTimeout = null;
  }
  _clearIntentTimeout(); // V11.3: Clear any bid/pass/trump intent timeout
  
  // If sync already in progress, queue this one
  if(_syncInProgress){
    console.log('[MP] Sync already in progress — queueing this state_sync');
    _queuedSync = move;
    return;
  }
  
  _syncInProgress = true;
  console.log('[MP] Sync lock acquired');
  
  // V10_122d: CRITICAL iOS FIX - Sync lock timeout failsafe
  // If sync doesn't complete in 10 seconds, force release lock
  // This prevents permanent hangs if state_sync gets stuck on iOS
  const _syncLockTimeout = setTimeout(() => {
    if(_syncInProgress){
      console.error('[MP] CRITICAL: Sync lock timeout - forcing release');
      mpLogEntry('ERROR', 'sync_timeout', 'Sync lock held for >10s, forcing release');
      _syncInProgress = false;
      hideSyncingOverlay();
      mpSuppressSend = false;
      isAnimating = false;
      setStatus('Sync timeout - please refresh manually');
    }
  }, 10000);
  
  // ═══════════════════════════════════════════════════════════════
  // V10_FIX: Critical sync fixes applied here
  // ═══════════════════════════════════════════════════════════════
  
  // FIX5: Clear all AI timers to prevent stale actions
  _clearAllAITimers();
  
  // V10_121g: Clear any pending play intent (guest was waiting for confirmation)
  if (_pendingPlayIntent) {
    console.log('[MP] State sync clearing pending play intent');
    _dropTileFromIntent();
  }
  
  // FIX4: Show syncing overlay to block all input
  showSyncingOverlay();
  
  // FIX2: FORCE CLOSE ALL OVERLAYS FIRST - prevents frozen UI
  console.log('[FIX2] Closing all overlays before state_sync');
  const bidBackdrop = document.getElementById('bidBackdrop');
  const trumpBackdrop = document.getElementById('trumpBackdrop');
  const handEndBackdrop = document.getElementById('handEndBackdrop');
  const nelloBackdrop = document.getElementById('nelloOpponentBackdrop');
  const nelloDoublesBackdrop = document.getElementById('nelloDoublesBackdrop');
  const widowBackdrop = document.getElementById('widowSwapBackdrop');
  const layDownBackdrop = document.getElementById('layDownBackdrop');
  
  if (bidBackdrop) bidBackdrop.style.display = 'none';
  if (trumpBackdrop) trumpBackdrop.style.display = 'none';
  if (handEndBackdrop) handEndBackdrop.style.display = 'none';
  if (nelloBackdrop) nelloBackdrop.style.display = 'none';
  if (nelloDoublesBackdrop) nelloDoublesBackdrop.style.display = 'none';
  const dfmChoiceBackdrop = document.getElementById('dfmChoiceBackdrop');
  if (dfmChoiceBackdrop) dfmChoiceBackdrop.style.display = 'none';
  if (widowBackdrop) widowBackdrop.style.display = 'none';
  if (layDownBackdrop) layDownBackdrop.style.display = 'none';
  
  // Clear any waiting indicators
  mpHideWaiting();
  
  // V10_122: CRITICAL FIX - Clear all played dominoes from table
  // When syncing during bidding/trump phase, old dominoes from previous hand
  // can still be visible, making it look like PLAYING phase when it's not
  console.log('[V10_122] Clearing table before state_sync');
  const allSprites = document.querySelectorAll('.domino-sprite');
  allSprites.forEach(sprite => {
    // Only remove sprites that are in "played" position (center of table)
    // Don't remove sprites in player hands
    if (sprite._inPlayedPosition || sprite._inTrickHistory) {
      if (sprite._shadow) sprite._shadow.remove();
      sprite.remove();
    }
  });
  
  // Clear any guest-tracked plays since host is sending authoritative state
  mpGuestClearPlays();
  
  // Only process if this state is meant for us
  if (mpSeat < 0) {
    console.error('[MP] Received state_sync but mpSeat not set! Ignoring.');
    hideSyncingOverlay(); // FIX4: Hide overlay even on error
    _syncInProgress = false; // V10_122c: CRITICAL - Release lock on error
    console.log('[MP] Sync lock released (error: no seat)');
    return;
  }
  if (move.targetSeat !== mpSeat) {
    hideSyncingOverlay(); // FIX4: Hide overlay if not for us
    _syncInProgress = false; // V10_122c: CRITICAL - Release lock on wrong seat
    console.log('[MP] Sync lock released (wrong seat)');
    return;
  }

  console.log('[MP] Received state sync for seat', mpSeat);
  mpLogEntry('STATE', 'state_sync', 'Received sync for seat ' + mpSeat + ' phase=' + (move.phase || '?') + ' cp=' + (move.currentPlayer || '?') + ' trick=' + (move.trickNumber || '?'), { moveKeys: Object.keys(move) });

  mpSuppressSend = true;
  mpGameStarted = true;

  // Close multiplayer modal if open
  document.getElementById('mpBackdrop').style.display = 'none';

  // Show sync button
  const _rfBtnSync = document.getElementById('mpRefreshBtn');
  if (_rfBtnSync) _rfBtnSync.style.display = 'inline-block';

  // Hide start screen
  const startScreen = document.getElementById('startScreenBackdrop');
  if (startScreen) startScreen.style.display = 'none';

  // Ensure game mode matches host's state
  if (move.gameMode && GAME_MODE !== move.gameMode) {
    initGameMode(move.gameMode);
  }

  // Set up game state
  const playerCount = mpPlayerCount();
  const maxPip = mpMaxPip();
  const handSize = mpHandSize();
  const marksToWin = move.marksToWin || 7;

  if (!session || session.game.player_count !== playerCount) {
    session = new SessionV6_4g(playerCount, maxPip, handSize, marksToWin);
  }

  session.dealer = move.dealer;
  session.phase = move.phase;
  session.bid_winner_seat = move.bidWinner;
  session.current_bid = move.currentBid;
  session.bid_marks = move.bidMarks || 1;
  session.game.marks_to_win = marksToWin;

  if (move.teamMarks) {
    session.team_marks = move.teamMarks;
  }
  if (move.teamPoints) {
    session.game.team_points = move.teamPoints;
  }
  if (move.trumpSuit !== undefined) {
    session.game.trump_suit = move.trumpSuit;
  }
  if (move.trumpMode !== undefined) {
    session.game.trump_mode = move.trumpMode;
  }
  if (move.leader !== undefined) {
    session.game.leader = move.leader;
  }
  session.game.current_player = move.currentPlayer;
  _trackCpChange('mpHandleStateSync');

  // Restore contract
  if (move.contract) {
    session.contract = move.contract;
  }

  // Restore active players
  if (move.activePlayers && Array.isArray(move.activePlayers)) {
    session.game.active_players = move.activePlayers.slice();
  }

  // Restore engine trick number
  if (move.engineTrickNumber !== undefined) {
    session.game.trick_number = move.engineTrickNumber;
  }

  // Restore tricks_team (completed trick records) - dynamic size for Moon
  if (move.tricksTeam) {
    session.game.tricks_team = move.tricksTeam.map(team =>
      (team || []).map(rec => rec.map(t => t ? [t[0], t[1]] : null))
    );
  }

  // Restore nello doubles suit and force double trump
  if (move.nelloDoublesSuit !== undefined) {
    session.game.nello_doubles_suit = move.nelloDoublesSuit;
    nelloDoublesSuitActive = move.nelloDoublesSuit;
  }
  if (move.forceDoubleTrump !== undefined) {
    session.game.force_double_trump = move.forceDoubleTrump;
    callForDoubleActive = move.forceDoubleTrump;
  }
  if (move.dfmActive !== undefined) {
    _dfmActiveThisHand = move.dfmActive;
  }

  // Restore Moon-specific state
  if (move.moonWidow) {
    session.moon_widow = [move.moonWidow[0], move.moonWidow[1]];
  }
  if (move.moonShoot !== undefined) {
    session.moon_shoot = move.moonShoot;
  }

  // Restore engine current_trick (tiles played this trick in engine format)
  if (move.currentTrick && Array.isArray(move.currentTrick)) {
    session.game.current_trick = move.currentTrick.map(ct => [
      ct.seat,
      ct.tile ? [ct.tile[0], ct.tile[1]] : null
    ]);
  }

  // Set hands from host data
  const hands = move.hands;
  for (let p = 0; p < playerCount; p++) {
    session.game.hands[p] = [];
    if (hands[p]) {
      for (let h = 0; h < hands[p].length; h++) {
        if (hands[p][h]) {
          session.game.hands[p][h] = hands[p][h];
        }
      }
    }
  }

  // Reset visual state
  shadowLayer.innerHTML = '';
  spriteLayer.innerHTML = '';
  sprites.length = 0;
  currentTrick = move.trickNumber || 0;
  playedThisTrick = [];
  team1TricksWon = move.team1TricksWon || 0;
  team2TricksWon = move.team2TricksWon || 0;
  if (move.moonPlayerTricksWon) {
    moonPlayerTricksWon = move.moonPlayerTricksWon.slice();
  }
  zIndexCounter = 100;
  isAnimating = false;
  waitingForPlayer1 = false;

  // Hide unused player indicators
  if (GAME_MODE === 'MOON') {
    for (let h = 4; h <= 6; h++) {
      const hel = document.getElementById('playerIndicator' + h);
      if (hel) hel.style.display = 'none';
    }
    for (let h = 1; h <= 3; h++) {
      const hel = document.getElementById('playerIndicator' + h);
      if (hel) hel.style.display = '';
    }
  } else if (GAME_MODE === 'T42') {
    for (let h = 5; h <= 6; h++) {
      const hel = document.getElementById('playerIndicator' + h);
      if (hel) hel.style.display = 'none';
    }
  } else {
    for (let h = 1; h <= 6; h++) {
      const hel = document.getElementById('playerIndicator' + h);
      if (hel) hel.style.display = '';
    }
  }

  createPlaceholders();

  // Create sprites for remaining tiles in hands
  for (let p = 0; p < playerCount; p++) {
    sprites[p] = [];
    const visualP = mpVisualPlayer(p);
    const hand = session.game.hands[p] || [];
    for (let h = 0; h < hand.length; h++) {
      const tile = hand[h];
      if (!tile) continue;

      const sprite = makeSprite(tile);
      const pos = getHandPosition(visualP, h);
      if (pos) {
        sprite.setPose(pos);
        if (sprite._shadow) shadowLayer.appendChild(sprite._shadow);
        spriteLayer.appendChild(sprite);

        const data = { sprite, tile, originalSlot: h };
        sprites[p][h] = data;

        if (p === mpSeat) {
          sprite.addEventListener('click', () => handlePlayer1Click(sprite));
          sprite.addEventListener('touchstart', (e) => {
            e.preventDefault();
            e.stopPropagation();
            handlePlayer1Click(sprite);
          }, { passive: false });
          sprite.setFaceUp(true);
        } else {
          sprite.setFaceUp(false);
        }
      }
    }
  }

  // Restore played tiles in current trick (show on board)
  if (move.playedThisTrick && move.playedThisTrick.length > 0) {
    for (const pt of move.playedThisTrick) {
      if (pt.tile) {
        playedThisTrick.push({ seat: pt.seat, tile: pt.tile, points: 0 });
        // Create a sprite for the played tile at the trick position
        const sprite = makeSprite(pt.tile);
        const visualP = mpVisualPlayer(pt.seat);
        const pos = getPlayedPosition(visualP);
        if (pos) {
          sprite.setPose(pos);
          sprite.setFaceUp(true);
          if (sprite._shadow) shadowLayer.appendChild(sprite._shadow);
          spriteLayer.appendChild(sprite);
        }
      }
    }
  }

  // V10_121g: Recreate trick history sprites from tricks_team data
  // This fixes the "lost trick history" issue after reconnection
  if (session.game.tricks_team && session.game.tricks_team.length > 0) {
    for (let teamIdx = 0; teamIdx < session.game.tricks_team.length; teamIdx++) {
      const teamTricks = session.game.tricks_team[teamIdx] || [];
      for (let trickIdx = 0; trickIdx < teamTricks.length; trickIdx++) {
        const record = teamTricks[trickIdx];
        if (!record || record.length === 0) continue;
        
        // record[seat] = tile for that seat (or null if didn't play)
        // Create sprites for each tile in this completed trick
        for (let seat = 0; seat < record.length; seat++) {
          const tile = record[seat];
          if (!tile) continue;
          
          const sprite = makeSprite(tile);
          sprite.setFaceUp(true);
          
          // Calculate playerRowIndex same way as collectToHistory
          const playerRowIndex = GAME_MODE === 'MOON' ? seat : (seatToPlayer(seat) - 1);
          
          // Tag as trick history
          sprite._inTrickHistory = true;
          sprite._thTeamTrickIndex = trickIdx;
          sprite._thWinningTeam = teamIdx; // 0 or 1 for normal mode, seat for Moon
          sprite._thPlayerRowIndex = playerRowIndex;
          if (sprite._shadow) sprite._shadow._inTrickHistory = true;
          
          // Position in trick history area
          const targetPose = getTrickHistoryPosition(trickIdx, teamIdx, playerRowIndex);
          if (targetPose) {
            sprite.setPose(targetPose);
            if (sprite._shadow) shadowLayer.appendChild(sprite._shadow);
            spriteLayer.appendChild(sprite);
          }
        }
      }
    }
  }

  // Show trump display if trump is set
  if (session.game.trump_suit !== null && session.game.trump_suit !== undefined) {
    const trumpEl = document.getElementById('trumpDisplay');
    if (trumpEl) {
      trumpEl.classList.add('visible');
      const trumpText = document.getElementById('trumpText');
      if (trumpText) {
        trumpText.textContent = session.game.trump_suit === 'doubles' ? 'Doubles' : session.game.trump_suit;
      }
    }
  }

  // Update scores
  if (GAME_MODE !== 'MOON') {
    team1Score = session.game.team_points[0];
    team2Score = session.game.team_points[1];
    team1Marks = session.team_marks[0];
    team2Marks = session.team_marks[1];
  }
  updateScoreDisplay();
  positionPlayerIndicators();

  // Show Moon widow if applicable
  if (GAME_MODE === 'MOON' && session.moon_widow) {
    updateWidowDisplay();
  }

  // V10_118: After rebuilding sprites from engine data, re-apply visual transformations.
  // Without this, hands appear in dealt order (un-shuffled), unhighlighted, and trump
  // pip orientation is wrong. This was the root cause of "refresh breaks everything."
  if (session.game.trump_suit !== null && session.game.trump_suit !== undefined &&
      session.phase === PHASE_PLAYING) {
    // Re-sort local player's sprites by trump (visual only — rearranges sprites array)
    sortPlayerHandByTrump();
    // Re-flip tiles so trump pip faces up (modifies both engine hands and sprite data)
    flipTilesForTrump();
    // Update trump display indicator
    updateTrumpDisplay();
  }

  // V10_121g: Recenter all hands after state sync (fixes right-alignment issue)
  // When tiles have been played, remaining tiles need to be recentered
  for (let p = 0; p < playerCount; p++) {
    const hand = session.game.hands[p] || [];
    if (hand.length > 0 && hand.length < handSize) {
      // Hand has tiles played, needs recentering
      recenterHand(p);
    }
  }

  // V10_118: Force-reset control flags to a clean state.
  isAnimating = false;
  _mpLastActivityTime = Date.now(); // Reset so stale detector doesn't immediately re-fire
  _staleRefreshCount = 0; // V10_121g: Reset refresh counter on successful sync

  // V10_119: Hide ALL overlays that might be left over from a previous phase.
  // If state_sync restores PHASE_PLAYING but trump overlay is still visible,
  // the game appears frozen ("select your trumps" with unclickable tiles).
  const _ssBd1 = document.getElementById('trumpBackdrop');
  if (_ssBd1) _ssBd1.style.display = 'none';
  trumpSelectionActive = false;
  const _ssBd2 = document.getElementById('callDoubleBtnGroup');
  if (_ssBd2) _ssBd2.style.display = 'none';
  const _ssBd3 = document.getElementById('callDoubleBanner');
  if (_ssBd3) _ssBd3.style.display = 'none';

  // FIX4: Hide syncing overlay after state applied (with small delay for rendering)
  setTimeout(() => {
    hideSyncingOverlay();
    mpSuppressSend = false;
    console.log('[FIX4] State sync complete, input re-enabled');
  }, 300);
  
  // V10_121h: Failsafe - force hide overlay after 1 second if still visible
  setTimeout(() => {
    const overlay = document.getElementById('syncingOverlay');
    if (overlay && overlay.style.display !== 'none') {
      console.warn('[FIX4] Failsafe: Force hiding stuck syncing overlay');
      hideSyncingOverlay();
    }
  }, 1000);

  // Resume game flow based on phase
  if (session.phase === PHASE_PLAYING) {
    setStatus('Reconnected! Resuming game...');
    // V10_118: Immediately check turn (no delay) and ensure clicks are enabled.
    // The 300ms delay could race with stale detector, causing re-triggers.
    mpCheckWhoseTurn();
  } else if (session.phase === PHASE_NEED_BID) {
    // V10_121c: Check if bidding is actually done (bidWinner set, currentBid set)
    // This happens when guest reconnects after their bid was accepted but before trump selection
    if (move.bidWinner !== null && move.bidWinner !== undefined && move.currentBid > 0 && move.trumpSuit === null) {
      console.log('[MP] State sync: bidding done (bidWinner=' + move.bidWinner + ' bid=' + move.currentBid + ') but no trump yet');
      biddingState = null; // Clear stale bidding state
      if (move.bidWinner === mpSeat) {
        // WE are the bid winner — show trump selection
        _guestShowTrumpSelection(move.currentBid);
      } else {
        // Someone else won — wait for trump_confirmed
        session.phase = PHASE_NEED_TRUMP;
        setStatus(getPlayerDisplayName(move.bidWinner) + ' selecting trump...');
      }
    } else if (!biddingState) {
      // V10_116: Don't reset bidding if already in progress — state_sync during
      // bidding should preserve the current bidding flow, not restart it.
      // Only init if biddingState is null (actual reconnect, not stale refresh).
      setStatus('Reconnected! Resuming bidding...');
      initBiddingRound();
      setTimeout(() => mpRunBiddingStep(), 300);
    } else {
      // V10_121h: Bidding already active — refresh the UI to show current state
      _mpLastActivityTime = Date.now();
      console.log('[MP] State sync during active bidding — refreshing UI');
      // Force UI refresh by calling mpRunBiddingStep
      setTimeout(() => mpRunBiddingStep(), 100);
    }
  } else if (session.phase === PHASE_NEED_TRUMP) {
    // V10_121c: If we are the bid winner, show trump selection
    if (session.bid_winner_seat === mpSeat) {
      setStatus('Select trump.');
      showTrumpOverlay(true);
      // V10_121g: Ensure trump selection is active for proper domino clicks
      trumpSelectionActive = true;
      enableTrumpDominoClicks();
    } else {
      setStatus(getPlayerDisplayName(session.bid_winner_seat) + ' selecting trump...');
    }
  } else if (session.phase === PHASE_MOON_WIDOW) {
    // Moon: reconnected during widow swap phase
    const bidWinnerSeat = session.bid_winner_seat;
    if (bidWinnerSeat === mpSeat) {
      setStatus('Widow swap in progress. Select a tile to swap.');
      showWidowSwap();
    } else {
      setStatus(getPlayerDisplayName(bidWinnerSeat) + ' is swapping with widow...');
    }
  } else {
    setStatus('Reconnected!');
  }
  
  // V10_122: Release sync lock and process queued sync if any
  clearTimeout(_syncLockTimeout); // V10_122d: Clear timeout failsafe
  _syncInProgress = false;
  console.log('[MP] Sync lock released');
  
  if(_queuedSync){
    console.log('[MP] Processing queued sync');
    const queued = _queuedSync;
    _queuedSync = null;
    setTimeout(() => mpHandleStateSync(queued), 100);
  }
}

// Check whose turn and set up UI accordingly
function mpCheckWhoseTurn() {
  if (!MULTIPLAYER_MODE || session.phase !== PHASE_PLAYING) return;

  const currentPlayer = session.game.current_player;
  console.log('[MP] Whose turn? seat=' + currentPlayer + ', mpSeat=' + mpSeat + ', visual=P' + seatToVisual(currentPlayer));
  mpLogEntry('STATE', 'whoseTurn', 'cp=' + currentPlayer + ' mpSeat=' + mpSeat + ' isAI=' + mpIsAI(currentPlayer), mpGetGameSnapshot());

  // Validate current_player is an active player
  if (!session.game.active_players.includes(currentPlayer)) {
    console.log("[MP] current_player", currentPlayer, "not in active_players", session.game.active_players, "- fixing");
    mpLogEntry('ERROR', 'invalid-cp', 'current_player ' + currentPlayer + ' not in active_players ' + JSON.stringify(session.game.active_players));
    session.game.current_player = session.game._next_active_player(currentPlayer);
    _trackCpChange('mpCheckWhoseTurn-invalidCpFix');
  }

  if (currentPlayer === mpSeat) {
    // Our turn
    waitingForPlayer1 = true;
    mpWaitingForRemote = false; // V10_115: Reset — we're the active player now
    _mpLastActivityTime = Date.now(); // V10_115: Reset activity timer — our turn started
    enablePlayer1Clicks();
    updatePlayer1ValidStates();
    showHint();
    setStatus('Trick ' + (session.game.trick_number + 1) + ' - Click a domino to play');
    if (MULTIPLAYER_MODE) showYourTurnBanner(); // V11.4: Blue banner + haptic
    mpHideWaiting();
    _startTurnRecovery(); // V10_115: Safety net — re-enable clicks if stuck
  } else if (false && mpIsHost && mpIsAI(currentPlayer)) {
    // TX42-Client: DISABLED — server handles all AI play
    waitingForPlayer1 = false;
    clearPlayer1ValidStates(); // V10_121: Remove faded tile highlighting
    mpWaitingForRemote = false; // V10_115: Reset — host is running AI
    mpHideWaiting();
    mpPlayAITurn(currentPlayer);
  } else {
    // Someone else's turn (remote human) — show in status bar only
    waitingForPlayer1 = false;
    clearPlayer1ValidStates(); // V10_121: Remove faded tile highlighting
    setStatus(getPlayerDisplayName(currentPlayer) + ' is thinking...');
    mpWaitingForRemote = true;
  }
}

// Host plays AI turn for an empty seat and broadcasts the move
async function mpPlayAITurn(seat) {
  // V10_121: Only host runs AI turns in host authority mode
  if (MULTIPLAYER_MODE && !mpIsHost) return;
  isAnimating = true;
  setStatus(getPlayerDisplayName(seat) + ' (AI) plays...');
  // Safety timeout — if AI turn doesn't complete in 10 seconds, unlock
  const _aiTimeout = setTimeout(() => {
    if (isAnimating) {
      console.warn('[MP] AI turn timeout for seat', seat, '— forcing unlock');
      isAnimating = false;
      mpCheckWhoseTurn();
    }
  }, 10000);

  await new Promise(r => setTimeout(r, 600));

  const hand = session.game.hands[seat] || [];
  const aiRec = choose_tile_ai(session.game, seat, session.contract, true, session.current_bid);
  const gameHandIdx = aiRec.index;

  if (gameHandIdx < 0) {
    console.log('[MP] AI seat', seat, 'has no legal moves');
    isAnimating = false;
    clearTimeout(_aiTimeout);
    return;
  }

  const tileToPlay = aiRec.tile || hand[gameHandIdx];

  // Find sprite
  const seatSprites = sprites[seat] || [];
  let spriteIdx = -1;
  for (let i = 0; i < seatSprites.length; i++) {
    const sd = seatSprites[i];
    if (sd && sd.tile && ((sd.tile[0] === tileToPlay[0] && sd.tile[1] === tileToPlay[1]) || (sd.tile[0] === tileToPlay[1] && sd.tile[1] === tileToPlay[0]))) {
      spriteIdx = i;
      break;
    }
  }

  const isLead = session.game.current_trick.length === 0;

  // Play in engine
  try {
    session.play(seat, gameHandIdx);
  } catch(e) {
    console.log('[MP] AI play error:', e);
    isAnimating = false;
    clearTimeout(_aiTimeout);
    return;
  }

  // V10_121: Broadcast play_confirmed (NOT old 'play' action) so guests use confirmed handler
  const _aiTrickComplete = session.game._sanitized_trick().length >= session.game.active_players.length;
  mpSendMove({
    action: 'play_confirmed',
    seat: seat,
    tile: tileToPlay,
    isLead: isLead,
    trickNumber: session.game.trick_number,
    nextPlayer: session.game.current_player,
    currentPlayer: session.game.current_player,
    trickComplete: _aiTrickComplete,
    trickWinner: _aiTrickComplete ? session.game._determine_trick_winner() : null,
    handComplete: false,
    handResult: null,
    isAI: true
  });
  // Auto-save host state after AI play
  mpSaveHostState();

  // Animate
  if (spriteIdx >= 0) {
    try {
      await playDomino(seat, spriteIdx, isLead, aiRec, null);
    } catch(animErr) {
      console.warn('[MP] AI playDomino error (non-fatal):', animErr);
    }
  }

  // Check trick complete
  if (_aiTrickComplete) {
    await new Promise(r => setTimeout(r, 800));
    await collectToHistory();
    session.game.current_trick = [];
    // Clear call for double after trick 1
    if(session.game.force_double_trump){
      session.game.force_double_trump = false;
      callForDoubleActive = false;
      clearForcedDoubleGlow();
      hideCallDoubleBanner();
    }
    playedThisTrick = [];
    currentTrick++;

    if (session.maybe_finish_hand()) {
      // V10_121: Broadcast hand-end to guests so they know the hand is over
      mpSendMove({
        action: 'play_confirmed',
        seat: seat,
        tile: tileToPlay,
        isLead: isLead,
        trickNumber: session.game.trick_number,
        nextPlayer: session.game.current_player,
        currentPlayer: session.game.current_player,
        trickComplete: true,
        trickWinner: session.game._determine_trick_winner ? session.game._determine_trick_winner() : null,
        handComplete: true,
        handResult: {
          status: session.status,
          teamPoints: [session.game.team_points[0], session.game.team_points[1]],
          teamMarks: [session.team_marks[0], session.team_marks[1]]
        },
        isAI: true
      });
      setStatus(session.status);
      team1Score = session.game.team_points[0];
      team2Score = session.game.team_points[1];
      team1Marks = session.team_marks[0];
      team2Marks = session.team_marks[1];
      updateScoreDisplay();
      logEvent('HAND_END', { status: session.status });
      setTimeout(() => mpShowHandEnd(), 800);
      isAnimating = false;
      clearTimeout(_aiTimeout);
      mpSaveHostState();
      return;
    }
  }

  isAnimating = false;
  clearTimeout(_aiTimeout);

  // Continue to next player
  mpCheckWhoseTurn();
}

// Show hand end in multiplayer (host can start next hand)
function mpShowHandEnd() {
  // Auto-save host state at hand end
  if (mpIsHost) mpSaveHostState();
  flipRemainingDominoes();
  showHandEndPopup();
}

// Show waiting status — uses status bar only (no overlay), keeps game visible
function mpShowWaiting(text, sub) {
  // Just update status bar — no overlay in multiplayer (should look like AI mode)
  if (text) setStatus(text);
}

function mpHideWaiting() {
  const el = document.getElementById('mpWaiting');
  if (el) el.style.display = 'none';
}

// Debug: show seat assignment on MP sync button for easy debugging
function mpUpdateSeatDebug() {
  const btn = document.getElementById('mpRefreshBtn');
  if (btn && mpSeat >= 0) {
    btn.title = 'Your seat: ' + (mpSeat+1) + ' (Visual: P1)';
  }
}


// Multiplayer: map game seat to visual player position (local player = P1 at bottom)
function mpVisualPlayer(seat) {
  const viewSeat = mpObserver ? mpObserverViewSeat : mpSeat;
  return ((seat - viewSeat + session.game.player_count) % session.game.player_count) + 1;
}

// Get the local player's seat for the current mode

// getLocalSeat() remains in game.js (serves all modes)


// Check if a seat is played by a real human (for multiplayer: check mpPlayers)
function mpIsRemoteHuman(seat) {
  if (!MULTIPLAYER_MODE) return false;
  if (seat === mpSeat) return true;  // Local player
  return !!mpPlayers[seat];  // Remote player exists
}

// Check if seat should be AI-controlled in multiplayer
function mpIsAI(seat) {
  if (!MULTIPLAYER_MODE) return false;
  if (mpObserver) return false;  // V10_104: Observer never runs AI
  if (seat === mpSeat) return false;  // Local player is not AI
  return !mpPlayers[seat];  // No remote player = AI
}


// ============================================================
// Stubs for observer.js (lazy-loaded)
// ============================================================
// Observer mode stubs — lazy loaded from observer.js
function mpRequestRoomStatus(r,c) { _lazyLoad("./assets/js/observer.js", function(){ mpRequestRoomStatus(r,c); }); }
function mpConnectAsObserver(r) { _lazyLoad("./assets/js/observer.js", function(){ mpConnectAsObserver(r); }); }
function mpHandleObserverMessage(m) { /* no-op until observer loaded */ }
function mpShowObserverControls() { /* no-op until observer loaded */ }

// Disconnect from multiplayer
function mpDisconnect() {
  if (mpSocket) {
    mpGameStarted = false;  // Prevent auto-reconnect
    mpSocket.close();
    mpSocket = null;
  }
  MULTIPLAYER_MODE = false;
  mpConnected = false;
  mpSeat = -1;
  mpIsHost = false;
  mpPlayers = {};
  // Don't clear mpPlayerId or mpRoom - needed for reconnection
  mpGameStarted = false;
  mpWaitingForRemote = false;
  mpSuppressSend = false;
  // V10_104: Reset observer state
  mpObserver = false;
  mpObserverViewSeat = 0;
  mpStatusRequested = false;
  const obsPanel = document.getElementById('mpObserverPanel');
  if (obsPanel) obsPanel.remove();
  mpUpdateIndicator();
  mpHideWaiting();

  // Reset UI
  document.getElementById('mpConnect').style.display = '';
  document.getElementById('mpDisconnect').style.display = 'none';
  document.getElementById('mpStartGame').style.display = 'none';
  document.getElementById('mpPlayerList').style.display = 'none';
  const hostSettings = document.getElementById('mpHostSettings');
  // V10_109: Show settings to all players
  if(hostSettings) hostSettings.style.display = '';
  const mpSettingsRole = document.getElementById('mpSettingsRole');
  if(mpSettingsRole) mpSettingsRole.textContent = mpIsHost ? '(Host)' : '(View Only)';
  if (hostSettings) hostSettings.style.display = 'none';
  mpUpdateStatus('Disconnected', '#9ca3af');
}

// Generate a random 8-character player ID
function mpGenerateId() {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghjkmnpqrstuvwxyz23456789';
  let id = '';
  for (let i = 0; i < 8; i++) id += chars[Math.floor(Math.random() * chars.length)];
  return id;
}

// Save multiplayer session to localStorage (room, seat, playerId)
function mpSaveSession() {
  if (!mpRoom || !mpPlayerId) return;
  try {
    const data = { room: mpRoom, seat: mpSeat, playerId: mpPlayerId, timestamp: Date.now() };
    localStorage.setItem('tn51_mp_session_' + mpRoom, JSON.stringify(data));
    console.log('[MP] Session saved:', data);
  } catch(e) {
    console.warn('[MP] Could not save session (private browsing?):', e);
  }
}

// Load multiplayer session from localStorage for a given room
function mpLoadSession(roomName) {
  if (!roomName) return null;
  try {
    const raw = localStorage.getItem('tn51_mp_session_' + roomName);
    if (!raw) return null;
    const data = JSON.parse(raw);
    // Sessions expire after 15 minutes
    if (Date.now() - data.timestamp > 15 * 60 * 1000) {
      localStorage.removeItem('tn51_mp_session_' + roomName);
      return null;
    }
    return data;
  } catch(e) { return null; }
}

// ===== HOST STATE PERSISTENCE (V10_76) =====
const MP_HOST_STATE_KEY = 'tn51_mp_host_state';
const MP_GUEST_PLAYS_KEY = 'tn51_mp_guest_plays';

// Host: Save full game state to localStorage for crash recovery
function mpSaveHostState() {
  if (!mpIsHost || !session || !mpGameStarted) return;
  try {
    const state = {
      version: MP_VERSION,
      timestamp: Date.now(),
      room: mpRoom,
      seat: mpSeat,
      playerId: mpPlayerId,
      playerIds: Object.assign({}, mpPlayerIds),
      players: JSON.parse(JSON.stringify(mpPlayers)),
      marksToWin: mpMarksToWin,
      gameMode: GAME_MODE,
      gameStarted: true,
      // Engine state (same as state_sync payload)
      session: session.snapshot(),
      // Visual state
      currentTrick: currentTrick,
      playedThisTrick: playedThisTrick.map(pt => ({
        seat: pt.seat,
        tile: pt.tile ? [pt.tile[0], pt.tile[1]] : null
      })),
      team1TricksWon: team1TricksWon,
      team2TricksWon: team2TricksWon,
      moonPlayerTricksWon: moonPlayerTricksWon,
      team1Score: team1Score,
      team2Score: team2Score,
      // House rules
      callForDoubleEnabled: callForDoubleEnabled,
      callForDoubleActive: callForDoubleActive,
      nelloDoublesMode: nelloDoublesMode,
      nelloDoublesSuitActive: nelloDoublesSuitActive,
      doublesFollowMe: doublesFollowMe,
      // Status flag - null means game still in progress
      completedFlag: null
    };
    localStorage.setItem(MP_HOST_STATE_KEY, JSON.stringify(state));
    console.log('[MP] Host state saved to localStorage');
  } catch(e) {
    console.warn('[MP] Failed to save host state:', e);
  }
}

// Host: Load saved state from localStorage
function mpLoadHostState() {
  try {
    const raw = localStorage.getItem(MP_HOST_STATE_KEY);
    if (!raw) return null;
    const state = JSON.parse(raw);
    // Check if game was properly completed
    if (state.completedFlag) {
      console.log('[MP] Saved host state is completed, clearing');
      localStorage.removeItem(MP_HOST_STATE_KEY);
      return null;
    }
    // Check version compatibility
    if (!state.version) {
      localStorage.removeItem(MP_HOST_STATE_KEY);
      return null;
    }
    return state;
  } catch(e) {
    console.warn('[MP] Failed to load host state:', e);
    return null;
  }
}

// Host: Mark state as properly completed (game ended or intentional disconnect)
function mpMarkHostStateCompleted() {
  try {
    const raw = localStorage.getItem(MP_HOST_STATE_KEY);
    if (!raw) return;
    const state = JSON.parse(raw);
    state.completedFlag = 'completed';
    localStorage.setItem(MP_HOST_STATE_KEY, JSON.stringify(state));
    console.log('[MP] Host state marked as completed');
  } catch(e) {}
}

// Host: Clear saved state entirely
function mpClearHostState() {
  try {
    localStorage.removeItem(MP_HOST_STATE_KEY);
    console.log('[MP] Host state cleared');
  } catch(e) {
    console.warn('[MP] Could not clear host state:', e);
  }
}

// Guest: Track plays made while host might be disconnected
function mpGuestTrackPlay(seat, tile) {
  if (mpIsHost) return; // Host doesn't track - it IS the source of truth
  try {
    const raw = localStorage.getItem(MP_GUEST_PLAYS_KEY) || '[]';
    const plays = JSON.parse(raw);
    plays.push({ seat: seat, tile: [tile[0], tile[1]], timestamp: Date.now() });
    localStorage.setItem(MP_GUEST_PLAYS_KEY, JSON.stringify(plays));
    console.log('[MP] Guest tracked play: seat', seat, 'tile', tile);
  } catch(e) {}
}

// Guest: Get tracked plays and clear them
function mpGuestGetAndClearPlays() {
  try {
    const raw = localStorage.getItem(MP_GUEST_PLAYS_KEY) || '[]';
    const plays = JSON.parse(raw);
    localStorage.removeItem(MP_GUEST_PLAYS_KEY);
    return plays;
  } catch(e) { return []; }
}

// Guest: Clear tracked plays (e.g. when receiving state_sync from host)
function mpGuestClearPlays() {
  try {
    localStorage.removeItem(MP_GUEST_PLAYS_KEY);
  } catch(e) {}
}

// Host: Resume from saved state after reconnection
function mpResumeFromSavedState(savedState) {
  console.log('[MP] Resuming host state from localStorage');

  // Restore MP metadata
  mpIsHost = true;
  mpSeat = savedState.seat;
  mpPlayerId = savedState.playerId;
  mpPlayerIds = savedState.playerIds || {};
  mpPlayers = savedState.players || {};
  mpMarksToWin = savedState.marksToWin || 7;
  mpGameStarted = true;
  MULTIPLAYER_MODE = true;
  // Set game mode UI
  const resumeMode = savedState.gameMode || 'TN51';
  if (typeof initGameMode === 'function') initGameMode(resumeMode);

  // Restore session
  const snap = savedState.session;
  const pc = snap.active_players ? Math.max(...snap.active_players) + 1 : mpPlayerCount();
  const maxPip = mpMaxPip();
  const handSize = mpHandSize();

  if (!session || session.game.player_count !== pc) {
    session = new SessionV6_4g(pc, maxPip, handSize, savedState.marksToWin || 7);
  }

  // Restore engine state
  session.game.hands = snap.hands;
  session.game.current_trick = snap.current_trick || [];
  session.game.tricks_team = snap.tricks_team || (GAME_MODE === 'MOON' ? [[],[],[]] : [[],[]]);
  session.game.team_points = snap.team_points || (GAME_MODE === 'MOON' ? [0,0,0] : [0,0]);
  session.game.trump_suit = snap.trump_suit;
  session.game.trump_mode = snap.trump_mode;
  session.game.trick_number = snap.trick_number || 0;
  session.game.current_player = snap.current_player || 0;
  _trackCpChange('mpResumeFromSavedState');
  session.game.leader = snap.leader || 0;
  session.game.active_players = snap.active_players || Array.from({length: pc}, (_, i) => i);
  session.game.nello_doubles_suit = snap.nello_doubles_suit || false;
  session.game.force_double_trump = snap.force_double_trump || false;

  session.phase = snap.phase || PHASE_PLAYING;
  session.team_marks = snap.team_marks || (GAME_MODE === 'MOON' ? [0,0,0] : [0,0]);
  session.marks_to_win = snap.marks_to_win || savedState.marksToWin || 7;
  session.contract = snap.contract || 'NORMAL';
  session.current_bid = snap.current_bid || 0;
  session.bid_marks = snap.bid_marks || 1;
  session.bid_winner_seat = snap.bid_winner_seat || 0;
  session.dealer = snap.dealer || 0;
  // Restore Moon-specific state
  if (snap.moon_widow) session.moon_widow = snap.moon_widow;
  if (snap.moon_shoot !== undefined) session.moon_shoot = snap.moon_shoot;

  // Restore visual state
  currentTrick = savedState.currentTrick || 0;
  playedThisTrick = [];
  team1TricksWon = savedState.team1TricksWon || 0;
  team2TricksWon = savedState.team2TricksWon || 0;
  moonPlayerTricksWon = savedState.moonPlayerTricksWon || [0, 0, 0];
  if (GAME_MODE !== 'MOON') {
    team1Score = savedState.team1Score || snap.team_points[0] || 0;
    team2Score = savedState.team2Score || snap.team_points[1] || 0;
    team1Marks = session.team_marks[0];
    team2Marks = session.team_marks[1];
  }

  // Restore house rules
  callForDoubleEnabled = savedState.callForDoubleEnabled !== undefined ? savedState.callForDoubleEnabled : true;
  callForDoubleActive = savedState.callForDoubleActive || false;
  nelloDoublesMode = savedState.nelloDoublesMode || 'regular';
  nelloDoublesSuitActive = savedState.nelloDoublesSuitActive || false;
  doublesFollowMe = savedState.doublesFollowMe || 'on';

  // Rebuild sprites
  shadowLayer.innerHTML = '';
  spriteLayer.innerHTML = '';
  sprites.length = 0;
  isAnimating = false;
  waitingForPlayer1 = false;
  zIndexCounter = 100;

  // Apply layout settings
  if (GAME_MODE === 'MOON' && typeof applyMoonSettings === 'function') applyMoonSettings();
  if (GAME_MODE === 'T42' && typeof applyT42Settings === 'function') applyT42Settings();
  if (GAME_MODE === 'TN51' && typeof applyTn51Settings === 'function') applyTn51Settings();

  const layout = getActiveLayout();
  const placeholderConfig = getActivePlaceholderConfig();
  const playerCount = session.game.player_count;

  for (let p = 0; p < playerCount; p++) {
    const hand = session.game.hands[p] || [];
    sprites[p] = [];
    for (let idx = 0; idx < hand.length; idx++) {
      const tile = hand[idx];
      if (!tile) { sprites[p][idx] = null; continue; }
      const faceUp = (p === mpSeat);
      const sp = createSprite(tile, p, idx, faceUp, layout, placeholderConfig);
      sprites[p][idx] = { sprite: sp, tile: tile, originalSlot: idx };
    }
  }

  // Restore played tiles on the board visually
  const savedPTT = savedState.playedThisTrick || [];
  for (const pt of savedPTT) {
    if (!pt.tile) continue;
    // Find matching sprite
    const seatSprites = sprites[pt.seat] || [];
    for (let i = 0; i < seatSprites.length; i++) {
      const sd = seatSprites[i];
      if (sd && sd.tile && ((sd.tile[0] === pt.tile[0] && sd.tile[1] === pt.tile[1]) || (sd.tile[0] === pt.tile[1] && sd.tile[1] === pt.tile[0]))) {
        playedThisTrick.push({ seat: pt.seat, tile: sd.tile, sprite: sd.sprite, points: 0 });
        // Move sprite to trick area visually
        if (sd.sprite) {
          const vis = typeof mpVisualPlayer === 'function' ? mpVisualPlayer(pt.seat) : pt.seat + 1;
          const trickPos = getTrickPosition(vis, playedThisTrick.length);
          if (trickPos) {
            sd.sprite.style.left = trickPos.x + '%';
            sd.sprite.style.top = trickPos.y + '%';
            sd.sprite.style.zIndex = 200 + playedThisTrick.length;
          }
          if (sd.sprite.querySelector('.dominoFace')) {
            sd.sprite.querySelector('.dominoFace').style.display = '';
            sd.sprite.querySelector('.dominoBack')?.style && (sd.sprite.querySelector('.dominoBack').style.display = 'none');
          }
        }
        break;
      }
    }
  }

  // Update displays
  updateTrumpDisplay();
  updateScoreDisplay();
  updateBidDisplay();

  console.log('[MP] Host state restored. Phase:', session.phase, 'Current player:', session.game.current_player);
}

// Host sends full game state to a reconnecting player
function mpSendGameState(targetSeat) {
  if (!mpIsHost || !session) return;

  const playerCount = session.game.player_count;
  const handsData = [];
  for (let p = 0; p < playerCount; p++) {
    if (session.game.hands[p]) {
      handsData.push(session.game.hands[p].map(t => t ? [t[0], t[1]] : null));
    } else {
      handsData.push([]);
    }
  }

  // Collect played tiles in current trick
  const trickData = playedThisTrick.map(pt => ({
    seat: pt.seat,
    tile: pt.tile ? [pt.tile[0], pt.tile[1]] : null
  }));

  // Build current_trick data from engine state
  const currentTrickData = (session.game.current_trick || []).map(ct => ({
    seat: ct[0],
    tile: ct[1] ? [ct[1][0], ct[1][1]] : null
  }));

  // Build tricks_team data (dynamic size for Moon's 3 players)
  const tricksTeamData = session.game.tricks_team.map(team =>
    (team || []).map(rec => rec.map(t => t ? [t[0], t[1]] : null))
  );

  const syncPayload = {
    action: 'state_sync',
    targetSeat: targetSeat,
    gameMode: GAME_MODE,
    phase: session.phase,
    contract: session.contract,
    dealer: session.dealer,
    hands: handsData,
    marksToWin: session.game.marks_to_win,
    teamMarks: session.team_marks.slice(),
    teamPoints: session.game.team_points.slice(),
    currentPlayer: session.game.current_player,
    trickNumber: currentTrick,
    engineTrickNumber: session.game.trick_number,
    playedThisTrick: trickData,
    currentTrick: currentTrickData,
    tricksTeam: tricksTeamData,
    activePlayers: session.game.active_players.slice(),
    trumpSuit: session.game.trump_suit,
    trumpMode: session.game.trump_mode,
    bidWinner: session.bid_winner_seat,
    currentBid: session.current_bid,
    bidMarks: session.bid_marks,
    team1TricksWon: team1TricksWon,
    team2TricksWon: team2TricksWon,
    leader: session.game.leader,
    nelloDoublesSuit: session.game.nello_doubles_suit,
    forceDoubleTrump: session.game.force_double_trump,
    dfmActive: _dfmActiveThisHand
  };
  // Include Moon-specific state
  if (GAME_MODE === 'MOON') {
    syncPayload.moonWidow = session.moon_widow ? [session.moon_widow[0], session.moon_widow[1]] : null;
    syncPayload.moonShoot = session.moon_shoot || false;
    syncPayload.moonPlayerTricksWon = moonPlayerTricksWon.slice();
  }
  mpSendMove(syncPayload);
  console.log('[MP] Sent game state to seat', targetSeat);
}

// Host: send full state to ALL connected players
function mpRefreshAll() {
  if (!mpIsHost || !session || !mpGameStarted) return;
  console.log('[MP] Refreshing all players');
  for (let s = 0; s < session.game.player_count; s++) {
    if (s === mpSeat) continue; // skip self
    if (mpIsAI(s)) continue; // skip AI seats
    mpSendGameState(s);
  }
  setStatus('Refreshed all players!');
  setTimeout(() => mpCheckWhoseTurn(), 500);
}

// Host: start a new hand, keeping current score
function mpHostNewHand() {
  if (!mpIsHost || !session) return;
  console.log('[MP] Host starting new hand (keeping score)');
  // Broadcast new hand signal
  mpSendMove({ action: 'next_hand' });
  // Redeal
  mpHostDeal();
}

// Host: Handle missed plays response from a guest
let _mpMissedPlaysResponses = {};
let _mpMissedPlaysExpectedCount = 0;
let _mpMissedPlaysReceivedCount = 0;

function mpHandleMissedPlaysResponse(move) {
  if (!mpIsHost) return;
  const seat = move.seat;
  const plays = move.plays || [];
  console.log('[MP] Received missed plays from seat', seat, ':', plays.length, 'plays');
  _mpMissedPlaysResponses[seat] = plays;
  _mpMissedPlaysReceivedCount++;

  // Check if we've received from all expected guests
  if (_mpMissedPlaysReceivedCount >= _mpMissedPlaysExpectedCount) {
    mpReconcileAfterResume();
  }
}

// Host: Reconcile state after receiving all missed plays responses
function mpReconcileAfterResume() {
  console.log('[MP] Reconciling after resume...');

  // Collect all missed plays sorted by timestamp
  let allMissedPlays = [];
  for (const [seat, plays] of Object.entries(_mpMissedPlaysResponses)) {
    for (const play of plays) {
      allMissedPlays.push(play);
    }
  }
  allMissedPlays.sort((a, b) => a.timestamp - b.timestamp);

  if (allMissedPlays.length > 0) {
    console.log('[MP] Applying', allMissedPlays.length, 'missed plays');
    // Apply missed plays to the engine
    for (const play of allMissedPlays) {
      const seat = play.seat;
      const tile = play.tile;
      // Find tile in hand
      const hand = session.game.hands[seat] || [];
      let idx = -1;
      for (let i = 0; i < hand.length; i++) {
        const ht = hand[i];
        if (ht && ((ht[0] === tile[0] && ht[1] === tile[1]) || (ht[0] === tile[1] && ht[1] === tile[0]))) {
          idx = i;
          break;
        }
      }
      if (idx >= 0) {
        try {
          // Ensure current_player matches
          if (session.game.current_player !== seat) {
            session.game.current_player = seat;
          }
          session.play(seat, idx);
          console.log('[MP] Applied missed play: seat', seat, 'tile', tile);

          // Check if trick completed
          if (session.game._sanitized_trick().length >= session.game.active_players.length) {
            // Complete the trick in the engine
            const winner = session.game._determine_trick_winner();
            const winTeam = winner % 2;
            const trickTiles = session.game.current_trick.slice();
            session.game.tricks_team[winTeam].push(trickTiles);
            // Count points
            let pts = 0;
            for (const [s, t] of trickTiles) { pts += t[0] + t[1]; }
            session.game.team_points[winTeam] += pts;
            session.game.current_trick = [];
            session.game.trick_number++;
            session.game.leader = winner;
            session.game.current_player = session.game._next_active_player(winner);
            currentTrick++;
          }
        } catch(e) {
          console.warn('[MP] Could not apply missed play:', e);
        }
      }
    }
  }

  // Clear responses
  _mpMissedPlaysResponses = {};
  _mpMissedPlaysReceivedCount = 0;
  _mpMissedPlaysExpectedCount = 0;

  // Save updated state
  mpSaveHostState();

  // Broadcast full state to all players
  console.log('[MP] Sending state_sync to all players after reconciliation');
  setTimeout(() => {
    mpRefreshAll();
    setStatus('Game resumed! Synced all players.');
  }, 500);
}

// Host: Connect to room and resume game after restoring state
function mpResumeConnection(savedState) {
  mpRoom = savedState.room;

  // Connect to relay server
  mpSocket = new WebSocket(MP_WS_URL);

  mpSocket.onopen = () => {
    console.log('[MP] Reconnected to relay, joining room:', mpRoom);
    try {
      mpSocket.send(JSON.stringify({ type: 'join', room: mpRoom }));
    } catch(e) {
      console.error('[MP] Reconnect join send error:', e);
      mpSocket.close();
    }
  };

  mpSocket.onmessage = (evt) => {
    let msg;
    try { msg = JSON.parse(evt.data); } catch(e) { return; }
    console.log('[MP] Received:', msg);

    if (msg.type === 'joined') {
      mpConnected = true;
      mpUpdateStatus('Resumed in ' + msg.room, '#22c55e');
      mpUpdateIndicator();

      // Show MP UI
      document.getElementById('mpConnect').style.display = 'none';
      document.getElementById('mpDisconnect').style.display = '';
      document.getElementById('mpPlayerList').style.display = '';

      // Send hello with our saved playerId (other clients will recognize us)
      mpHelloNonce = mpGenerateId();
      mpSendRaw({ type: 'move', move: { action: 'hello', name: 'Player 1 (Host)', playerId: mpPlayerId, version: MP_VERSION, preferredSeat: mpSeat, nonce: mpHelloNonce } });

      // Tell all players host has resumed
      setTimeout(() => {
        mpSendMove({ action: 'host_resumed', hostSeat: mpSeat });
        mpBroadcastPlayerList();

        // Request missed plays from all human players
        _mpMissedPlaysResponses = {};
        _mpMissedPlaysReceivedCount = 0;
        _mpMissedPlaysExpectedCount = 0;

        const playerCount = session.game.player_count;
        for (let s = 0; s < playerCount; s++) {
          if (s === mpSeat) continue;
          if (mpIsAI(s)) continue;
          _mpMissedPlaysExpectedCount++;
        }

        if (_mpMissedPlaysExpectedCount > 0) {
          mpSendMove({ action: 'missed_plays_request' });
          // Timeout: if not all responses in 5 seconds, proceed anyway
          setTimeout(() => {
            if (_mpMissedPlaysReceivedCount < _mpMissedPlaysExpectedCount) {
              console.log('[MP] Timed out waiting for missed plays responses (' + _mpMissedPlaysReceivedCount + '/' + _mpMissedPlaysExpectedCount + ')');
              mpReconcileAfterResume();
            }
          }, 5000);
        } else {
          // No human guests to query, just resync
          setTimeout(() => mpRefreshAll(), 500);
        }
      }, 1000);

    } else if (msg.type === 'move') {
      const move = msg.move || msg;
      if (move.action) {
        mpHandleMessage(msg);
      }
    }
  };

  mpSocket.onclose = (evt) => {
    console.log('[MP] WebSocket closed:', evt.code, evt.reason);
    mpConnected = false;
    mpUpdateStatus('Disconnected', '#ef4444');
    mpUpdateIndicator();
    if (MULTIPLAYER_MODE && mpGameStarted && mpRoom) {
      mpUpdateStatus('Reconnecting...', '#f59e0b');
      setTimeout(() => mpConnect(mpRoom), 2000);
    }
  };

  mpSocket.onerror = (err) => {
    console.log('[MP] WebSocket error:', err);
    mpUpdateStatus('Connection error', '#ef4444');
  };
}

// Guest: request refresh from host
function mpRequestRefresh() {
  // V10_113: If socket is dead, reconnect first (reset attempts so user can always manually retry)
  if(!mpSocket || mpSocket.readyState !== WebSocket.OPEN){
    if(mpRoom){
      _mpReconnectAttempts = 0; // Reset so manual sync always works
      console.log('[MP] Socket not open — reconnecting before refresh');
      setStatus('Reconnecting...');
      mpConnect(mpRoom);
    }
    return;
  }
  // V10_121g: Reset refresh counter on manual sync (user action = fresh start)
  _staleRefreshCount = 0;
  if (mpIsHost) { mpRefreshAll(); return; }
  console.log('[MP] Requesting refresh from host');
  mpSendMove({ action: 'refresh_request', seat: mpSeat });
  setStatus('Requesting refresh from host...');
  
  // V10_122e: CRITICAL iOS FIX - Timeout if host doesn't respond
  // If no state_sync received in 10s, show error and allow retry
  const _refreshTimeout = setTimeout(() => {
    if(!mpGameStarted || !session) return; // Game ended, ignore
    console.error('[MP] Refresh request timeout - host did not respond');
    mpLogEntry('ERROR', 'refresh_timeout', 'No response from host after 10s');
    setStatus('Refresh failed - host not responding');
    hideSyncingOverlay();
    // Show retry button
    const retryBtn = document.createElement('button');
    retryBtn.textContent = 'Retry Sync';
    retryBtn.style.cssText = 'position:fixed;top:50%;left:50%;transform:translate(-50%,-50%);z-index:10001;padding:12px 24px;background:#ef4444;color:#fff;border:none;border-radius:8px;font-size:16px;font-weight:bold;cursor:pointer;box-shadow:0 4px 12px rgba(0,0,0,0.3);';
    retryBtn.onclick = () => {
      retryBtn.remove();
      mpRequestRefresh();
    };
    document.body.appendChild(retryBtn);
    setTimeout(() => retryBtn.remove(), 15000); // Auto-remove after 15s
  }, 10000);
  
  // Store timeout ID so we can clear it when state_sync arrives
  window._mpRefreshTimeout = _refreshTimeout;
}

// Show host settings (marks selection) in MP modal
function mpShowHostSettings() {
  const section = document.getElementById('mpHostSettings');
  if (section) section.style.display = '';
}

// Show version mismatch warning
function mpShowVersionWarning(hostVersion, myVersion) {
  const warn = document.createElement('div');
  warn.id = 'mpVersionWarning';
  warn.style.cssText = 'position:fixed;top:60px;left:50%;transform:translateX(-50%);z-index:2000;background:linear-gradient(135deg,#f59e0b,#d97706);color:#000;padding:10px 20px;border-radius:10px;font-size:13px;font-weight:600;text-align:center;box-shadow:0 4px 12px rgba(0,0,0,0.3);max-width:320px;';
  warn.innerHTML = 'Version mismatch!<br><span style="font-weight:400;font-size:12px;">Host: ' + hostVersion + ' | You: ' + myVersion + '<br>The game may not play properly.</span>';
  // Remove existing warning if any
  const existing = document.getElementById('mpVersionWarning');
  if (existing) existing.remove();
  document.body.appendChild(warn);
  // Auto-dismiss after 10 seconds
  setTimeout(() => { if (warn.parentNode) warn.remove(); }, 10000);
}

// Build seat picker grid in MP modal
function mpBuildSeatPicker() {
  const section = document.getElementById('mpSeatSection');
  const grid = document.getElementById('mpSeatGrid');
  if (!section || !grid) return;

  grid.innerHTML = '';
  const maxSeats = mpPlayerCount();

  // Auto option
  const autoBtn = document.createElement('button');
  autoBtn.textContent = 'Auto';
  autoBtn.style.cssText = 'padding:8px 14px;border:2px solid #60a5fa;border-radius:8px;background:rgba(96,165,250,0.2);color:#fff;font-size:13px;font-weight:600;cursor:pointer;';
  autoBtn.addEventListener('click', () => {
    mpPreferredSeat = -1;
    grid.querySelectorAll('button').forEach(b => {
      b.style.borderColor = 'rgba(255,255,255,0.15)';
      b.style.background = 'rgba(255,255,255,0.05)';
    });
    autoBtn.style.borderColor = '#60a5fa';
    autoBtn.style.background = 'rgba(96,165,250,0.2)';
  });
  grid.appendChild(autoBtn);

  for (let s = 0; s < maxSeats; s++) {
    const btn = document.createElement('button');
    btn.textContent = 'Seat ' + (s + 1);
    btn.style.cssText = 'padding:8px 14px;border:2px solid rgba(255,255,255,0.15);border-radius:8px;background:rgba(255,255,255,0.05);color:#fff;font-size:13px;font-weight:600;cursor:pointer;';
    btn.addEventListener('click', () => {
      mpPreferredSeat = s;
      grid.querySelectorAll('button').forEach(b => {
        b.style.borderColor = 'rgba(255,255,255,0.15)';
        b.style.background = 'rgba(255,255,255,0.05)';
      });
      btn.style.borderColor = '#60a5fa';
      btn.style.background = 'rgba(96,165,250,0.2)';
    });
    grid.appendChild(btn);
  }

  section.style.display = '';
}

// Multiplayer: Host deals and broadcasts hands to all players
async function mpHostDeal() {
  if (!mpIsHost) return;
  mpShowChatIcon(true); // V11.4: Show chat icon for host

  // Hide any leftover overlays
  document.getElementById('bidBackdrop').style.display = 'none';

  // Set up game if needed
  const playerCount = mpPlayerCount();
  const maxPip = mpMaxPip();
  const handSize = mpHandSize();
  const marksToWin = mpMarksToWin || (session ? session.game.marks_to_win : 7);

  if (!session || session.game.player_count !== playerCount) {
    session = new SessionV6_4g(playerCount, maxPip, handSize, marksToWin);
  }
  session.game.marks_to_win = marksToWin;
  session.marks_to_win = marksToWin;

  // Reset visual state
  shadowLayer.innerHTML = '';
  spriteLayer.innerHTML = '';
  sprites.length = 0;
  currentTrick = 0;
  playedThisTrick = [];
  team1TricksWon = 0;
  team2TricksWon = 0;
  moonPlayerTricksWon = [0, 0, 0];
  zIndexCounter = 100;
  isAnimating = false;
  waitingForPlayer1 = false;

  document.getElementById('trumpDisplay').classList.remove('visible');

  // Hide unused player indicators
  if (GAME_MODE === 'MOON') {
    for (let h = 4; h <= 6; h++) {
      const hel = document.getElementById('playerIndicator' + h);
      if (hel) hel.style.display = 'none';
    }
    for (let h = 1; h <= 3; h++) {
      const hel = document.getElementById('playerIndicator' + h);
      if (hel) hel.style.display = '';
    }
  } else if (GAME_MODE === 'T42') {
    for (let h = 5; h <= 6; h++) {
      const hel = document.getElementById('playerIndicator' + h);
      if (hel) hel.style.display = 'none';
    }
  } else {
    for (let h = 1; h <= 6; h++) {
      const hel = document.getElementById('playerIndicator' + h);
      if (hel) hel.style.display = '';
    }
  }

  // Deal
  session.new_hand_random();
  createPlaceholders();

  const hands = session.game.hands;

  // Create sprites - rotate so local player (host) is at bottom
  for (let p = 0; p < playerCount; p++) {
    sprites[p] = [];
    const visualP = mpVisualPlayer(p);
    for (let h = 0; h < handSize; h++) {
      const tile = hands[p][h];
      if (!tile) continue;

      const sprite = makeSprite(tile);
      const pos = getHandPosition(visualP, h);
      if (pos) {
        sprite.setPose(pos);
        if (sprite._shadow) shadowLayer.appendChild(sprite._shadow);
        spriteLayer.appendChild(sprite);

        const data = { sprite, tile, originalSlot: h };
        sprites[p][h] = data;

        if (p === mpSeat) {
          sprite.addEventListener('click', () => handlePlayer1Click(sprite));
          sprite.addEventListener('touchstart', (e) => {
            e.preventDefault();
            e.stopPropagation();
            handlePlayer1Click(sprite);
          }, { passive: false });
        }

        if (p === mpSeat) {
          sprite.setFaceUp(true);
        } else {
          sprite.setFaceUp(false);
        }
      }
    }
  }

  // (mpHostDeal already sets face-up for host's tiles above)

  if (GAME_MODE !== 'MOON') {
    team1Score = session.game.team_points[0];
    team2Score = session.game.team_points[1];
    team1Marks = session.team_marks[0];
    team2Marks = session.team_marks[1];
  }
  updateScoreDisplay();

  // Show Moon widow on host table
  if (GAME_MODE === 'MOON' && session.moon_widow) {
    updateWidowDisplay();
  }

  // Position player indicators with correct labels
  positionPlayerIndicators();

  // Broadcast the deal to all players
  const handsData = [];
  for (let p = 0; p < playerCount; p++) {
    handsData.push(hands[p].map(t => [t[0], t[1]]));
  }
  const dealPayload = {
    action: 'deal',
    dealer: session.dealer,
    hands: handsData,
    gameMode: GAME_MODE,
    marksToWin: session.game.marks_to_win,
    teamMarks: session.team_marks.slice()
  };
  // Include Moon-specific data
  if (GAME_MODE === 'MOON') {
    dealPayload.moonWidow = session.moon_widow ? [session.moon_widow[0], session.moon_widow[1]] : null;
    dealPayload.moonShoot = session.moon_shoot || false;
  }
  // V11.4b: Include No Table Talk setting
  dealPayload.noTableTalk = _noTableTalk;
  mpSendMove(dealPayload);

  // Start bidding
  initBiddingRound();
  mpRunBiddingStep();
}

/******************************************************************************
 * V10_112: VISIBILITY CHANGE HANDLER (Tab Switch Recovery)
 * When user switches away from browser tab/app and comes back, the WebSocket
 * may have been killed by the OS. This handler immediately reconnects and
 * requests a state refresh to prevent "frozen" game state.
 ******************************************************************************/
let _lastVisibleTime = Date.now();

document.addEventListener('visibilitychange', () => {
  if(document.hidden){
    // Tab going hidden — record timestamp
    _lastVisibleTime = Date.now();
    return;
  }

  // Tab becoming visible again
  const hiddenDuration = Date.now() - _lastVisibleTime;
  console.log('[Visibility] Tab visible again after', hiddenDuration, 'ms');

  if(!MULTIPLAYER_MODE || !mpGameStarted) return;

  // If hidden for more than 3 seconds, WebSocket likely needs recovery
  if(hiddenDuration > 3000){
    console.log('[Visibility] Was hidden >', Math.round(hiddenDuration/1000), 's — checking WebSocket');

    // Check if WebSocket is still alive
    if(!mpSocket || mpSocket.readyState !== WebSocket.OPEN){
      console.log('[Visibility] WebSocket not open (state:', mpSocket ? mpSocket.readyState : 'null', ') — reconnecting');
      setStatus('Reconnecting...');
      _mpReconnectAttempts = 0; // V10_113: Reset on tab return (user is actively playing)
      if(mpRoom) mpConnect(mpRoom);
    } else {
      // WebSocket is open but state may be stale — request refresh
      console.log('[Visibility] WebSocket open — requesting state refresh');
      // V10_122b: Host should NOT sync all players when host returns to tab
      // Only guest needs to request refresh when guest returns
      // V10_121g: Reset refresh counter when user returns to tab (manual action)
      _staleRefreshCount = 0;
      _mpLastActivityTime = Date.now(); // V11.3: Prevent stale detector double-firing
      if(mpIsHost){
        // Host: Just check whose turn it is, don't force sync to all players
        console.log('[Visibility] Host returned — checking turn state');
        mpCheckWhoseTurn();
      } else {
        // Guest: request refresh from host
        setStatus('Syncing...');
        mpRequestRefresh();
        // V11.3: Zombie socket detection — if no state_sync arrives within 5s,
        // the socket may appear OPEN but the TCP connection is actually dead.
        // Force close and reconnect.
        const _visFallbackActivity = _mpLastActivityTime;
        setTimeout(() => {
          if(_mpLastActivityTime === _visFallbackActivity && mpSocket && mpSocket.readyState === WebSocket.OPEN){
            console.log('[Visibility] No response after 5s — socket may be zombie, forcing reconnect');
            mpLogEntry('WARN', 'zombie-socket', 'Visibility fallback: no activity after refresh request');
            try { mpSocket.close(); } catch(e) {}
            _mpReconnectAttempts = 0;
            if(mpRoom) mpConnect(mpRoom);
          }
        }, 5000);
      }
    }
  } else if(hiddenDuration > 500){
    // Short hide — just check if it's our turn and UI is stuck
    if(session && session.phase === PHASE_PLAYING && session.game.current_player === mpSeat && !waitingForPlayer1 && !isAnimating){
      console.log('[Visibility] Brief hide — re-enabling player clicks');
      waitingForPlayer1 = true;
      enablePlayer1Clicks();
      updatePlayer1ValidStates();
      showHint();
    }
  }
});

/******************************************************************************
 * V10_122c: iOS SAFARI BACKGROUND HANDLER (pagehide/pageshow)
 * iOS Safari aggressively suspends pages when user switches apps or locks screen.
 * visibilitychange alone is not enough - need pagehide/pageshow for iOS.
 ******************************************************************************/
window.addEventListener('pagehide', () => {
  console.log('[iOS] Page hidden (app backgrounded or screen locked)');
  _lastVisibleTime = Date.now();
  // iOS will likely kill WebSocket - don't try to send anything
});

window.addEventListener('pageshow', (event) => {
  console.log('[iOS] Page shown (app foregrounded), persisted:', event.persisted);
  
  if(!MULTIPLAYER_MODE || !mpGameStarted || !mpRoom) return;
  
  const hiddenDuration = Date.now() - _lastVisibleTime;
  
  // iOS likely killed WebSocket if page was hidden for any significant time
  if(hiddenDuration > 1000){
    console.log('[iOS] Page was hidden for', Math.round(hiddenDuration/1000), 's — reconnecting');
    
    // Always reconnect on iOS after backgrounding
    if(!mpSocket || mpSocket.readyState !== WebSocket.OPEN){
      console.log('[iOS] WebSocket dead — reconnecting');
      setStatus('Reconnecting...');
      _mpReconnectAttempts = 0;
      mpConnect(mpRoom);
    } else {
      // Socket claims to be open but may be stale on iOS
      console.log('[iOS] WebSocket claims open — verifying with heartbeat');
      mpSendMove({ action: 'heartbeat', seat: mpSeat });
      
      // Request refresh after short delay to ensure connection is stable
      setTimeout(() => {
        if(mpIsHost){
          mpCheckWhoseTurn();
        } else {
          setStatus('Syncing...');
          mpRequestRefresh();
        }
      }, 500);
    }
  }
  
  // V10_122c: CRITICAL iOS FIX - Force stale check after returning from background
  // iOS pauses setInterval timers, so stale detection might not run for a long time
  // This causes "display stops refreshing" bug on iPhone
  if(hiddenDuration > 3000 && session && session.phase === PHASE_PLAYING){
    console.log('[iOS] Forcing stale check after background (iOS timer pause recovery)');
    setTimeout(() => {
      // Check if game is stuck
      const timeSinceActivity = Date.now() - _mpLastActivityTime;
      const cp = session.game.current_player;
      
      if(timeSinceActivity > 10000 && !isAnimating){
        console.log('[iOS] Game appears stale after background —', Math.round(timeSinceActivity/1000), 's since activity');
        
        if(cp === mpSeat && !waitingForPlayer1){
          // It's our turn but UI is frozen - re-enable
          console.log('[iOS] Re-enabling our turn after background');
          waitingForPlayer1 = true;
          enablePlayer1Clicks();
          updatePlayer1ValidStates();
          showHint();
        } else if(cp !== mpSeat){
          // Waiting for remote player - request refresh
          console.log('[iOS] Requesting refresh after background');
          mpRequestRefresh();
        }
      }
    }, 1000);
  }
});

/******************************************************************************
 * V10_122: NETWORK CHANGE HANDLER (Mobile Network Switching)
 * Detects when device switches networks (WiFi ↔ Cellular) or goes offline/online.
 * Critical for iPhone users who may switch networks frequently.
 ******************************************************************************/
window.addEventListener('online', () => {
  console.log('[Network] Device came online');
  if(!MULTIPLAYER_MODE || !mpGameStarted || !mpRoom) return;
  
  // Network is back — reconnect immediately
  if(!mpSocket || mpSocket.readyState !== WebSocket.OPEN){
    console.log('[Network] Reconnecting after coming online');
    setStatus('Network restored - reconnecting...');
    _mpReconnectAttempts = 0; // Reset attempts on network restore
    mpConnect(mpRoom);
  }
});

window.addEventListener('offline', () => {
  console.log('[Network] Device went offline');
  if(!MULTIPLAYER_MODE || !mpGameStarted) return;
  
  mpUpdateStatus('Offline - waiting for network...', '#ef4444');
  setStatus('Network connection lost');
});

// V10_122: Detect network quality changes (connection type switching)
// This helps detect WiFi ↔ Cellular switches on mobile devices
// V10_122c: Safari doesn't support navigator.connection - add fallback
if('connection' in navigator){
  try {
    const connection = navigator.connection || navigator.mozConnection || navigator.webkitConnection;
    if(connection && connection.addEventListener){
      connection.addEventListener('change', () => {
        console.log('[Network] Connection type changed:', connection.effectiveType, 'downlink:', connection.downlink);
        
        if(!MULTIPLAYER_MODE || !mpGameStarted || !mpRoom) return;
        
        // If connection changed and WebSocket is not open, reconnect
        if(!mpSocket || mpSocket.readyState !== WebSocket.OPEN){
          console.log('[Network] Reconnecting after connection type change');
          setStatus('Network changed - reconnecting...');
          _mpReconnectAttempts = 0;
          mpConnect(mpRoom);
        } else {
          // Connection changed but socket still open — verify with ping
          console.log('[Network] Connection changed but socket open — verifying');
          mpSendMove({ action: 'heartbeat', seat: mpSeat });
        }
      });
    }
  } catch(e) {
    console.log('[Network] Connection API not fully supported (Safari)');
  }
} else {
  console.log('[Network] Connection API not available (Safari/iOS)');
}

// V10_118: Stale-state auto-recovery — more conservative triggering.
// V10_122: COMPREHENSIVE SYNC OPTIMIZATION
// Increased thresholds to prevent false positives during normal gameplay.
// Added activity heartbeat so players can signal "still thinking" without triggering sync.
// Max 2 refreshes per hand — after that, only re-enable clicks (no state_sync).
// _staleRefreshCount declared in game.js
let _staleRefreshDisabled = false; // V10_119: Per-player toggle to disable auto-refresh
let _mpLastHeartbeatSent = 0; // V10_122: Last time we sent "still_here" heartbeat
let _mpLastHeartbeatReceived = {}; // V10_122: Last heartbeat time per seat

setInterval(() => {
  if(!MULTIPLAYER_MODE || !mpGameStarted || !session) return;
  if(document.hidden) return; // Don't check while tab is hidden
  if(_staleRefreshDisabled) return; // V10_119: Player disabled auto-refresh

  // V10_116: NEVER trigger stale detection during bidding or trump selection.
  if(session.phase === PHASE_NEED_BID || session.phase === PHASE_NEED_TRUMP || session.phase === PHASE_MOON_WIDOW) {
    return;
  }

  const timeSinceActivity = Date.now() - _mpLastActivityTime;

  // V10_122: OPTIMIZED THRESHOLDS - Increased to reduce false positives
  // AI turns: 30s (was 20s) — AI responds in <2s, so 30s is very safe
  // Remote human turns: 90s (was 60s) — humans need time to think, especially in complex situations
  // A premature state_sync causes a visual "snap" that disrupts the other player.
  const cp = session.game.current_player;
  const isRemoteHumanTurn = cp !== mpSeat && !mpIsAI(cp);
  
  // V10_122: Check if we received recent heartbeat from current player
  const lastHeartbeat = _mpLastHeartbeatReceived[cp] || 0;
  const timeSinceHeartbeat = Date.now() - lastHeartbeat;
  const hasRecentHeartbeat = timeSinceHeartbeat < 45000; // Heartbeat within last 45s
  
  // V10_122: If remote human sent heartbeat recently, they're still thinking - don't sync
  const staleThreshold = isRemoteHumanTurn ? 
    (hasRecentHeartbeat ? 120000 : 90000) : // 2 minutes if heartbeat, 90s if no heartbeat
    30000; // 30s for AI turns

  if(timeSinceActivity > staleThreshold && !isAnimating && session.phase === PHASE_PLAYING){
    // V10_115: If it's OUR turn, don't request refresh — just re-enable clicks
    if(cp === mpSeat){
      if(!waitingForPlayer1){
        console.log('[MP] Stale but it is our turn — re-enabling clicks');
        mpLogEntry('STATE', 'stale-self', 'Stale ' + Math.round(timeSinceActivity/1000) + 's but cp=mpSeat, re-enabling', mpGetGameSnapshot());
        _mpLastActivityTime = Date.now();
        waitingForPlayer1 = true;
        mpWaitingForRemote = false;
        enablePlayer1Clicks();
        updatePlayer1ValidStates();
        showHint();
        setStatus('Trick ' + (session.game.trick_number + 1) + ' - Click a domino to play');
        mpHideWaiting();
      }
      return;
    }

    // Detect if we're stuck waiting for something
    const isWaiting = mpWaitingForRemote ||
      (cp !== mpSeat && !mpIsHost);

    // V10_113: Host also checks if it's an AI's turn and nothing happened (AI freeze)
    const isHostAIStuck = mpIsHost && cp !== mpSeat && mpIsAI(cp);

    if(isWaiting || isHostAIStuck){
      console.log('[MP] Stale state detected —', Math.round(timeSinceActivity/1000), 's since last activity.',
        isHostAIStuck ? 'AI appears frozen.' : (isRemoteHumanTurn ? 'Remote human slow.' : 'Requesting refresh.'),
        'Refresh count this hand:', _staleRefreshCount,
        hasRecentHeartbeat ? '(has recent heartbeat)' : '(no heartbeat)'); // V10_122
      mpLogEntry('STATE', 'stale', 'Stale ' + Math.round(timeSinceActivity/1000) + 's' + (isHostAIStuck ? ' AI frozen' : (isRemoteHumanTurn ? ' remote-human' : ' requesting refresh')) + ' count=' + _staleRefreshCount, mpGetGameSnapshot());
      _mpLastActivityTime = Date.now(); // Prevent rapid re-triggers

      if(mpSocket && mpSocket.readyState === WebSocket.OPEN){
        if(isHostAIStuck){
          // V10_113: Host kicks the AI by calling mpCheckWhoseTurn
          console.log('[MP] Host re-kicking AI turn');
          mpCheckWhoseTurn();
        } else if(_staleRefreshCount < 2){
          // V10_118: Only request full refresh twice per hand. After that, refreshes
          // are more likely to make things worse than better.
          _staleRefreshCount++;
          mpRequestRefresh();
        } else {
          // V10_118: Max refreshes reached — just log it, don't request another.
          // Player can manually use the Sync button if needed.
          console.log('[MP] Max stale refreshes reached (' + _staleRefreshCount + '), skipping auto-refresh');
          mpLogEntry('WARN', 'stale-maxed', 'Max refreshes reached, skipping. Player can use Sync button.');
        }
      } else if(mpRoom){
        _mpReconnectAttempts = 0; // Allow reconnect
        mpConnect(mpRoom);
      }
    }
  }
  
  // V10_122: ACTIVITY HEARTBEAT - Send "still_here" signal during our turn
  // This prevents false stale detection when we're thinking
  if(session.phase === PHASE_PLAYING && cp === mpSeat && waitingForPlayer1){
    const timeSinceLastHeartbeat = Date.now() - _mpLastHeartbeatSent;
    if(timeSinceLastHeartbeat > 30000){ // Send heartbeat every 30s during our turn
      _mpLastHeartbeatSent = Date.now();
      mpSendMove({ action: 'heartbeat', seat: mpSeat });
      console.log('[MP] Sent activity heartbeat (still thinking)');
    }
  }
}, 15000); // V10_122: Check every 15s (was 10s) - reduced frequency to lower overhead
