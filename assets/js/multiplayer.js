// ============================================================
// TX42-Client — multiplayer.js (Clean Rewrite v30)
// Thin WebSocket client for TX42-Server
// Server is source of truth for dealing, bidding, trump,
// play validation, AI for empty seats, and scoring.
// ============================================================

const MP_WS_URL = 'wss://tx42-server.onrender.com';
const MP_VERSION = 'v30-TX42';

// --- TX42 Constants ---
function mpPlayerCount() { return 4; }
function mpMaxPip() { return 6; }
function mpHandSize() { return 7; }

// --- Rooms ---
const MP_ALL_ROOMS = [
  { name: 'Tx42room001', label: 'Room #1', mode: 'T42' },
  { name: 'Tx42room002', label: 'Room #2', mode: 'T42' },
  { name: 'Tx42room003', label: 'Room #3', mode: 'T42' },
  { name: 'Tx42room004', label: 'Room #4', mode: 'T42' },
  { name: 'Tx42room005', label: 'Room #5', mode: 'T42' },
];

// ============================================================
// SECTION 1: Connection & Transport
// ============================================================

// Heartbeat / reconnection constants
const MP_HEARTBEAT_INTERVAL = 15000;
const MP_PONG_TIMEOUT = 30000;
const MP_RECONNECT_DELAYS = [2000, 5000, 10000, 20000, 30000];

let _mpHeartbeatInterval = null;
let _mpLastPongTime = Date.now();
let _mpReconnectAttempts = 0;
// _mpLastActivityTime is declared in game.js — do NOT redeclare here

// Diagnostic log
const _mpDiagLog = [];
const MP_DIAG_MAX_ENTRIES = 2000;

function mpLogEntry(direction, category, data, extra) {
  if (_mpDiagLog.length >= MP_DIAG_MAX_ENTRIES) _mpDiagLog.shift();
  const entry = {
    t: Date.now(), ts: new Date().toISOString().substr(11, 12),
    dir: direction, cat: category, data: data,
    seat: typeof mpSeat !== 'undefined' ? mpSeat : -1,
    phase: session ? session.phase : '?',
    cp: session && session.game ? session.game.current_player : '?',
    trick: session && session.game ? session.game.trick_number : '?'
  };
  if (extra) entry.extra = extra;
  _mpDiagLog.push(entry);
}

// current_player change tracker
let _cpTracker = { lastCp: -1, lastPhase: '?' };
function _trackCpChange(source) {
  try { if (!session || !session.game) return; } catch (e) { return; }
  const cp = session.game.current_player;
  const phase = session.phase;
  if (cp !== _cpTracker.lastCp || phase !== _cpTracker.lastPhase) {
    mpLogEntry('STATE', 'cp-change', source + ': cp ' + _cpTracker.lastCp + '->' + cp + ' phase=' + phase);
    _cpTracker.lastCp = cp;
    _cpTracker.lastPhase = phase;
  }
}

/**
 * Connect to a room on the TX42 server.
 * Sends a `join` message. Server will reply with `joined` then `seat_assign`.
 */
function mpConnect(roomName) {
  // Reuse existing open socket
  if (mpSocket && mpSocket.readyState === WebSocket.OPEN) {
    mpRoom = roomName;
    mpConnected = false;
    _mpReconnectAttempts = 0;
    mpUpdateStatus('Joining room...', '#f59e0b');
    try {
      mpSocket.send(JSON.stringify({
        type: 'join', room: roomName,
        name: playerName || 'Player',
        playerId: mpPlayerId || undefined,
        preferredSeat: mpPreferredSeat
      }));
    } catch (e) {
      console.error('[MP] Join send error:', e);
      mpSocket.close();
    }
    return;
  }

  // Close stale socket
  if (mpSocket && mpSocket.readyState <= 1) mpSocket.close();
  mpStopHeartbeat();
  mpRoom = roomName;
  mpConnected = false;
  mpUpdateStatus('Connecting...', '#f59e0b');

  mpSocket = new WebSocket(MP_WS_URL);

  mpSocket.onopen = () => {
    console.log('[MP] WebSocket opened, joining room:', roomName);
    _mpReconnectAttempts = 0;
    try {
      mpSocket.send(JSON.stringify({
        type: 'join', room: roomName,
        name: playerName || 'Player',
        playerId: mpPlayerId || undefined,
        preferredSeat: mpPreferredSeat
      }));
    } catch (e) {
      console.error('[MP] Join send error on open:', e);
      mpSocket.close();
      return;
    }
    mpStartHeartbeat();
    mpLogEntry('INFO', 'socket', 'WebSocket opened, joining ' + roomName);
  };

  mpSocket.onmessage = (evt) => {
    let msg;
    try { msg = JSON.parse(evt.data); } catch (e) { return; }
    _mpLastPongTime = Date.now();
    if (msg.type === 'pong') return;
    console.log('[MP] Received:', msg);
    if (msg.type === 'move' && msg.move) {
      mpLogEntry('RECV', msg.move.action || 'move', msg.move);
    } else {
      mpLogEntry('RECV', msg.type || 'unknown', msg);
    }
    mpHandleMessage(msg);
  };

  mpSocket.onclose = (evt) => {
    console.log('[MP] WebSocket closed:', evt.code, evt.reason);
    mpLogEntry('INFO', 'socket', 'closed code=' + evt.code);
    mpConnected = false;
    mpStopHeartbeat();
    mpUpdateStatus('Disconnected', '#ef4444');
    mpUpdateIndicator();

    // Auto-reconnect with exponential backoff (max 50 attempts)
    if (MULTIPLAYER_MODE && mpGameStarted && mpRoom) {
      if (_mpReconnectAttempts < 50) {
        const delay = mpGetReconnectDelay();
        _mpReconnectAttempts++;
        console.log('[MP] Auto-reconnect attempt', _mpReconnectAttempts, 'in', delay, 'ms');
        mpUpdateStatus('Reconnecting (' + _mpReconnectAttempts + '/50)...', '#f59e0b');
        setTimeout(() => mpConnect(mpRoom), delay);
      } else {
        mpUpdateStatus('Connection lost. Refresh to retry.', '#ef4444');
        setStatus('Connection lost.');
      }
    }
  };

  mpSocket.onerror = () => {
    mpLogEntry('ERROR', 'socket', 'WebSocket error');
    mpUpdateStatus('Connection error', '#ef4444');
  };
}

function mpDisconnect() {
  mpGameStarted = false;
  if (mpSocket) {
    try { mpSocket.close(); } catch (e) {}
    mpSocket = null;
  }
  mpStopHeartbeat();
  mpConnected = false;
  mpSeat = -1;
  mpIsHost = false;
  mpPlayers = {};
  mpRoom = null;
  mpUpdateStatus('Disconnected', '#ef4444');
  mpUpdateIndicator();
  // Reset lobby UI
  document.getElementById('mpConnect').style.display = '';
  document.getElementById('mpDisconnect').style.display = 'none';
  document.getElementById('mpPlayerList').style.display = 'none';
  document.getElementById('mpStartGame').style.display = 'none';
  document.getElementById('mpHostSettings').style.display = 'none';
  document.getElementById('mpRoomSection').style.display = '';
  document.getElementById('mpSeatSection').style.display = 'none';
}

/** Send a raw JSON message (bypasses move wrapper). */
function mpSendRaw(msg) {
  if (mpSocket && mpSocket.readyState === WebSocket.OPEN) {
    try {
      mpSocket.send(JSON.stringify(msg));
    } catch (e) {
      console.error('[MP] Send raw error:', e);
      if (mpSocket) mpSocket.close();
    }
  }
}

/** Send a game move wrapped in {type:'move', move:...}. */
function mpSendMove(moveObj) {
  if (!MULTIPLAYER_MODE || mpSuppressSend) return;
  if (mpSocket && mpSocket.readyState === WebSocket.OPEN) {
    try {
      mpSocket.send(JSON.stringify({ type: 'move', move: moveObj, t: Date.now() }));
      console.log('[MP] Sent move:', moveObj);
      mpLogEntry('SEND', 'move', moveObj);
    } catch (e) {
      console.error('[MP] Send error:', e);
      if (mpSocket) mpSocket.close();
    }
  }
}

// --- Heartbeat ---
function mpStartHeartbeat() {
  mpStopHeartbeat();
  _mpHeartbeatInterval = setInterval(() => {
    if (mpSocket && mpSocket.readyState === WebSocket.OPEN) {
      try { mpSocket.send(JSON.stringify({ type: 'ping' })); } catch (e) {}
    }
    // Check if server seems dead
    if (Date.now() - _mpLastPongTime > MP_PONG_TIMEOUT && mpSocket) {
      console.log('[MP] Pong timeout — closing socket');
      mpSocket.close();
    }
  }, MP_HEARTBEAT_INTERVAL);
}

function mpStopHeartbeat() {
  if (_mpHeartbeatInterval) {
    clearInterval(_mpHeartbeatInterval);
    _mpHeartbeatInterval = null;
  }
}

function mpGetReconnectDelay() {
  const idx = Math.min(_mpReconnectAttempts, MP_RECONNECT_DELAYS.length - 1);
  return MP_RECONNECT_DELAYS[idx];
}

// --- Intent timeout (retry if server doesn't confirm within 10s) ---
let _pendingIntentTimeout = null;
function _startIntentTimeout(intentType) {
  if (_pendingIntentTimeout) clearTimeout(_pendingIntentTimeout);
  _pendingIntentTimeout = setTimeout(() => {
    _pendingIntentTimeout = null;
    console.warn('[MP] ' + intentType + ' intent timeout');
    setStatus('Server not responding — retrying...');
    if (mpSocket && mpSocket.readyState === WebSocket.OPEN) {
      mpSendMove({ action: 'refresh_request', seat: mpSeat });
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

// --- Turn recovery timer ---
let _turnRecoveryTimer = null;
function _startTurnRecovery() {
  if (_turnRecoveryTimer) clearTimeout(_turnRecoveryTimer);
  _turnRecoveryTimer = setTimeout(() => {
    if (!session || !MULTIPLAYER_MODE || session.phase !== PHASE_PLAYING) return;
    if (session.game.current_player === mpSeat && !isAnimating) {
      console.log('[MP] Turn recovery — re-enabling clicks');
      waitingForPlayer1 = true;
      enablePlayer1Clicks();
      updatePlayer1ValidStates();
      if (typeof showHint === 'function') showHint();
      setStatus('Trick ' + (session.game.trick_number + 1) + ' - Click a domino to play');
      mpHideWaiting();
    }
  }, 8000);
}

// --- Play intent visual feedback ---
let _pendingPlayIntent = null;
function _liftTileForIntent(spriteSlotIndex) {
  const localSeat = getLocalSeat();
  const seatSprites = sprites[localSeat] || [];
  const data = seatSprites[spriteSlotIndex];
  if (!data || !data.sprite) return;
  const el = data.sprite;
  _pendingPlayIntent = {
    seat: localSeat,
    spriteSlotIndex: spriteSlotIndex,
    spriteElement: el,
    originalTransform: el.style.transform
  };
  el.style.transition = 'transform 0.15s ease-out';
  el.style.transform = (el.style.transform || '') + ' translateY(-12px)';
}

function _dropTileFromIntent() {
  if (!_pendingPlayIntent) return;
  const el = _pendingPlayIntent.spriteElement;
  if (el) {
    el.style.transition = 'transform 0.15s ease-out';
    el.style.transform = _pendingPlayIntent.originalTransform;
  }
  _pendingPlayIntent = null;
}

function _clearPendingPlayIntent() {
  if (_pendingPlayIntent && _pendingPlayIntent.spriteElement) {
    const el = _pendingPlayIntent.spriteElement;
    el.style.transition = '';
  }
  _pendingPlayIntent = null;
}


// ============================================================
// SECTION 2: Message Router
// ============================================================

let _mpPlayQueue = [];  // Queue plays received while animating

function mpHandleMessage(msg) {
  _mpLastActivityTime = Date.now();

  // --- Top-level message types ---
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

  if (msg.type === 'room_update') {
    mpRoomCounts[msg.room] = { count: msg.count, max: msg.max, observers: msg.observers || 0 };
    mpUpdateRoomButtons();
    return;
  }

  if (msg.type === 'peer_joined') {
    if (msg.room && msg.playerCount !== undefined) {
      if (mpRoomCounts[msg.room]) mpRoomCounts[msg.room].count = msg.playerCount;
      mpUpdateRoomButtons();
    }
    return;
  }

  if (msg.type === 'peer_left') {
    if (msg.room && msg.playerCount !== undefined) {
      if (mpRoomCounts[msg.room]) mpRoomCounts[msg.room].count = msg.playerCount;
      mpUpdateRoomButtons();
    }
    return;
  }

  if (msg.type === 'chat') {
    if (typeof mpHandleChat === 'function') mpHandleChat(msg);
    return;
  }
  if (msg.type === 'chat_clear') {
    if (typeof mpHandleChatClear === 'function') mpHandleChatClear();
    return;
  }

  if (msg.type === 'joined') {
    mpConnected = true;
    mpUpdateStatus('Connected to ' + msg.room, '#22c55e');
    mpUpdateIndicator();
    document.getElementById('mpConnect').style.display = 'none';
    document.getElementById('mpDisconnect').style.display = '';
    document.getElementById('mpPlayerList').style.display = '';
    // If reconnecting during active game, request state sync
    if (mpGameStarted && mpSeat >= 0) {
      setTimeout(() => {
        if (mpSocket && mpSocket.readyState === WebSocket.OPEN && mpGameStarted) {
          mpSendMove({ action: 'refresh_request', seat: mpSeat });
        }
      }, 2000);
    }
    return;
  }

  if (msg.type === 'join_rejected') {
    mpUpdateStatus('Join rejected: ' + (msg.reason || 'Unknown'), '#ef4444');
    return;
  }

  if (msg.type === 'error') {
    mpUpdateStatus('Error: ' + (msg.reason || 'Unknown'), '#ef4444');
    return;
  }

  if (msg.type !== 'move' || !msg.move) return;

  // --- Move actions ---
  const move = msg.move;
  switch (move.action) {
    case 'seat_assign':
      mpHandleSeatAssign(move);
      break;
    case 'player_list':
      mpHandlePlayerList(move);
      break;
    case 'start_game':
      mpHandleStartGame(move);
      break;
    case 'deal':
      mpHandleDeal(move);
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
    case 'play_confirmed':
      mpHandlePlayConfirmed(move);
      break;
    case 'play_rejected':
      mpHandlePlayRejected(move);
      break;
    case 'state_sync':
      mpHandleStateSync(move);
      break;
    case 'game_over':
      mpHandleGameOver(move);
      break;
    case 'call_double_confirmed':
      mpHandleCallDoubleConfirmed(move);
      break;
    case 'heartbeat':
    case 'heartbeat_ack':
    case 'seat_ack':
      // No action needed
      break;
    default:
      console.log('[MP] Unhandled move action:', move.action);
  }
}


// ============================================================
// SECTION 3: Lobby Handlers (seat_assign, player_list, start_game)
// ============================================================

function mpHandleSeatAssign(move) {
  // Server directly assigns seat to us via the `joined` + `seat_assign` flow.
  // The server sends seat_assign only to the joining player.
  mpSeat = move.seat;
  mpIsHost = (move.seat === 0); // Seat 0 = room leader (can start game)
  MULTIPLAYER_MODE = true;

  if (move.playerId) {
    mpPlayerId = move.playerId;
    mpSaveSession();
  }

  if (move.reconnect) {
    mpUpdateStatus('Reconnected! Seat ' + (mpSeat + 1) + ' in ' + mpRoom, '#22c55e');
    console.log('[MP] Reconnected to seat:', mpSeat);
  } else {
    mpUpdateStatus('Seat ' + (mpSeat + 1) + ' in ' + mpRoom, '#22c55e');
    console.log('[MP] Assigned seat:', mpSeat);
  }

  mpConnected = true;
  // Update lobby UI
  document.getElementById('mpPlayerList').style.display = '';
  document.getElementById('mpRoomSection').style.display = 'none';
  document.getElementById('mpSeatSection').style.display = 'none';
  // Acknowledge seat
  mpSendMove({ action: 'seat_ack', seat: mpSeat });
  mpUpdateIndicator();
}

function mpHandlePlayerList(move) {
  const list = move.players || {};
  mpPlayers = {};
  for (const [k, v] of Object.entries(list)) {
    mpPlayers[parseInt(k)] = v;
  }
  // Ensure our seat is in the list
  if (mpSeat >= 0 && !mpPlayers[mpSeat]) {
    mpPlayers[mpSeat] = { seat: mpSeat, name: playerName || ('Player ' + (mpSeat + 1)) };
  }
  mpRenderPlayerList(list);
  mpUpdateIndicator();
}

function mpHandleStartGame(move) {
  console.log('[MP] Game started');
  mpGameStarted = true;
  MULTIPLAYER_MODE = true;
  if (move.marksToWin) mpMarksToWin = move.marksToWin;
  if (move.gameMode && GAME_MODE !== move.gameMode) {
    initGameMode(move.gameMode);
  }
  applyT42Settings();
  document.getElementById('bidBackdrop').style.display = 'none';
  document.getElementById('mpBackdrop').style.display = 'none';
  setStatus('Game starting...');
}


// ============================================================
// SECTION 4: Game Handlers
// ============================================================

// --- DEAL ---
async function mpHandleDeal(move) {
  if (mpSeat < 0) {
    console.error('[MP] Received deal but mpSeat not set!');
    return;
  }
  console.log('[MP] Received deal for seat', mpSeat);

  mpSuppressSend = true;
  mpGameStarted = true;

  // Close lobby & any leftover overlays
  document.getElementById('mpBackdrop').style.display = 'none';
  document.getElementById('bidBackdrop').style.display = 'none';
  if (typeof hideRoundEndSummary === 'function') hideRoundEndSummary();
  if (typeof hideGameEndSummary === 'function') hideGameEndSummary();
  if (typeof mpShowChatIcon === 'function') mpShowChatIcon(true);

  // Ensure layout
  applyT42Settings();

  // Set up session
  const playerCount = 4;
  const handSize = 7;
  const marksToWin = move.marksToWin || mpMarksToWin || 7;
  if (!session || session.game.player_count !== playerCount) {
    session = new SessionV6_4g(playerCount, 6, handSize, marksToWin);
  }
  session.dealer = move.dealer;

  // Build hands: our real hand + dummy face-down for opponents
  let myHand = move.hand || [];
  if (!myHand.length && move.hands) {
    if (Array.isArray(move.hands[0]) && Array.isArray(move.hands[0][0])) {
      myHand = move.hands[mpSeat] || [];
    } else {
      myHand = move.hands;
    }
  }
  const hands = [];
  for (let i = 0; i < playerCount; i++) {
    if (i === mpSeat) {
      hands.push(myHand);
    } else {
      const dummy = [];
      for (let j = 0; j < handSize; j++) dummy.push([-1, -1]);
      hands.push(dummy);
    }
  }
  session.game.set_hands(hands, 0);
  session.game.set_trump_suit(null);
  session.game.set_active_players([0, 1, 2, 3]);
  session.phase = PHASE_NEED_BID;

  // Carry over marks
  if (move.teamMarks) session.team_marks = move.teamMarks;

  // Clear and rebuild visual elements
  shadowLayer.innerHTML = '';
  spriteLayer.innerHTML = '';
  sprites.length = 0;
  currentTrick = 0;
  playedThisTrick = [];
  team1TricksWon = 0;
  team2TricksWon = 0;
  zIndexCounter = 100;
  isAnimating = false;
  waitingForPlayer1 = false;
  _mpPlayQueue = [];

  document.getElementById('trumpDisplay').classList.remove('visible');

  // Hide P5/P6 indicators (T42 = 4 players)
  for (let h = 5; h <= 6; h++) {
    const el = document.getElementById('playerIndicator' + h);
    if (el) el.style.display = 'none';
  }

  createPlaceholders();

  // Create sprites with rotation: local player at bottom (P1)
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
        sprites[p][h] = { sprite, tile, originalSlot: h };

        // Click handlers for local player only
        if (p === mpSeat) {
          sprite.addEventListener('click', () => handlePlayer1Click(sprite));
          sprite.addEventListener('touchstart', (e) => {
            e.preventDefault();
            e.stopPropagation();
            handlePlayer1Click(sprite);
          }, { passive: false });
        }

        // Face-up only for local player
        sprite.setFaceUp(p === mpSeat);
      }
    }
  }

  // Update scores
  team1Score = session.game.team_points[0];
  team2Score = session.game.team_points[1];
  team1Marks = session.team_marks[0];
  team2Marks = session.team_marks[1];
  updateScoreDisplay();
  positionPlayerIndicators();

  // Start bidding
  initBiddingRound();
  if (typeof enableBiddingPreview === 'function') enableBiddingPreview();

  mpSuppressSend = false;
  mpRunBiddingStep();
}


// --- BIDDING ---

function mpRunBiddingStep() {
  if (!biddingState) return;
  const currentBidder = biddingState.currentBidder;

  if (currentBidder === mpSeat) {
    // Our turn to bid
    session.phase = PHASE_NEED_BID;
    const statusMsg = biddingState.highBid > 0
      ? 'Current bid: ' + biddingState.highBid + ' by ' + getPlayerDisplayName(biddingState.highBidder) + '. Your bid?'
      : 'Your turn to bid.';
    setStatus(statusMsg);
    showBidOverlay(true);
    if (typeof triggerHaptic === 'function') triggerHaptic();
    mpHideWaiting();
  } else {
    // Wait for server to confirm someone else's bid/pass
    setStatus(getPlayerDisplayName(currentBidder) + ' is bidding...');
  }
}

function mpHandleBidConfirmed(move) {
  console.log('[MP] Bid confirmed: seat', move.seat, 'bid:', move.bid);
  _clearIntentTimeout();

  // Show the bid in placeholder
  const visualNum = seatToVisual(move.seat);
  const displayBid = move.displayBid || ((move.marks > 1) ? (move.marks + 'x') : move.bid);
  setPlaceholderText(visualNum, displayBid, 'bid');

  // If bidding is done
  if (move.biddingDone && move.bidWinner !== null && move.bidWinner !== undefined) {
    session.bid_winner_seat = move.bidWinner;
    session.current_bid = move.winningBid;
    session.bid_marks = move.winningMarks;

    if (move.bidWinner === mpSeat) {
      // We won the bid — show trump selection
      _showTrumpSelection(move.winningBid);
    } else {
      // Someone else won — wait for trump_confirmed from server
      biddingState = null;
      setStatus(getPlayerDisplayName(move.bidWinner) + ' won the bid at ' + move.winningBid + '. Choosing trump...');
    }
    return;
  }

  if (!biddingState) return;

  // Update bidding state
  biddingState.highBid = move.bid;
  biddingState.highBidder = move.seat;
  biddingState.highMarks = move.marks || 1;
  if (move.multiplier) {
    biddingState.inMultiplierMode = true;
    biddingState.highMultiplier = move.multiplier;
  }
  biddingState.bids.push({ seat: move.seat, playerNumber: seatToPlayer(move.seat), bid: move.bid });

  session.status = getPlayerDisplayName(move.seat) + ' bids ' + displayBid + '!';
  setStatus(session.status);

  // Advance to next bidder
  if (move.nextBidder !== null && move.nextBidder !== undefined) {
    biddingState.currentBidder = move.nextBidder;
  } else if (typeof advanceBidding === 'function') {
    advanceBidding();
  }
  mpRunBiddingStep();
}

function mpHandlePassConfirmed(move) {
  console.log('[MP] Pass confirmed: seat', move.seat);
  _clearIntentTimeout();

  // Show pass in placeholder
  const visualNum = seatToVisual(move.seat);
  setPlaceholderText(visualNum, 'Pass', 'pass');

  // If bidding is done
  if (move.biddingDone) {
    if (move.redeal) {
      setStatus('Everyone passed. Redealing...');
      biddingState = null;
      return;
    }
    if (move.bidWinner !== null && move.bidWinner !== undefined) {
      session.bid_winner_seat = move.bidWinner;
      session.current_bid = move.winningBid;
      session.bid_marks = move.winningMarks;

      if (move.bidWinner === mpSeat) {
        _showTrumpSelection(move.winningBid);
      } else {
        biddingState = null;
        setStatus(getPlayerDisplayName(move.bidWinner) + ' won the bid. Choosing trump...');
      }
    }
    return;
  }

  if (!biddingState) return;

  biddingState.passCount++;
  biddingState.bids.push({ seat: move.seat, playerNumber: seatToPlayer(move.seat), bid: 'pass' });

  session.status = getPlayerDisplayName(move.seat) + ' passes.';
  setStatus(session.status);

  if (move.nextBidder !== null && move.nextBidder !== undefined) {
    biddingState.currentBidder = move.nextBidder;
  } else if (typeof advanceBidding === 'function') {
    advanceBidding();
  }
  mpRunBiddingStep();
}


// --- TRUMP ---

/** Show trump selection UI when we won the bid. */
function _showTrumpSelection(winningBid) {
  console.log('[MP] We won the bid — showing trump selection');

  // Compute Nello eligibility
  if (typeof nelloDeclareMode !== 'undefined' && nelloDeclareMode) {
    _nelloAllowedAtTrump = false;
  } else if (typeof nelloRestrictFirst !== 'undefined' && nelloRestrictFirst && biddingState) {
    const winMarks = biddingState.highMarks || 1;
    if (!biddingState.inMultiplierMode && biddingState.highBid < 42) {
      _nelloAllowedAtTrump = (winMarks <= 1);
    } else if (!biddingState.inMultiplierMode) {
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

  document.getElementById('bidBackdrop').style.display = 'none';
  biddingState = null;
  session.phase = PHASE_NEED_TRUMP;
  setStatus('You won the bid at ' + highBid + '! Select trump.');
  if (typeof triggerHaptic === 'function') triggerHaptic([50, 50, 100]);
  mpHideWaiting();
  showTrumpOverlay(true);
  trumpSelectionActive = true;
  if (typeof enableTrumpDominoClicks === 'function') enableTrumpDominoClicks();
}

function mpHandleTrumpConfirmed(move) {
  console.log('[MP] Trump confirmed: trump=', move.trump, 'seat=', move.seat);
  _clearIntentTimeout();
  _mpLastActivityTime = Date.now();

  session.bid_winner_seat = move.seat;
  session.bid_marks = move.marks || 1;

  let trumpValue = move.trump;
  if (trumpValue === 'NT') trumpValue = null;

  if (move.nello) {
    session.contract = 'NELLO';
    session.game.set_trump_suit(null);
    if (move.activePlayers) {
      session.game.set_active_players(move.activePlayers);
      for (let s = 0; s < session.game.player_count; s++) {
        if (!move.activePlayers.includes(s)) {
          session.game.hands[s] = [];
          if (sprites[s]) {
            sprites[s].forEach(sd => { if (sd && sd.sprite) { if (sd.sprite._shadow) sd.sprite._shadow.remove(); sd.sprite.remove(); } });
            sprites[s] = [];
          }
        }
      }
    }
    session.game.leader = move.seat;
    session.game.current_player = move.firstPlayer || move.seat;
    session.phase = PHASE_PLAYING;
  } else {
    if (typeof session.set_trump === 'function') {
      session.set_trump(trumpValue);
    } else {
      session.game.set_trump_suit(trumpValue);
      session.phase = PHASE_PLAYING;
    }
    session.game.leader = move.seat;
    session.game.current_player = move.firstPlayer || move.seat;
  }

  // Update visuals
  syncSpritesWithGameState();
  if (typeof sortPlayerHandByTrump === 'function') sortPlayerHandByTrump();
  if (typeof sortAllHandsByTrump === 'function') sortAllHandsByTrump();
  if (typeof flipTilesForTrump === 'function') flipTilesForTrump();
  if (typeof updateTrumpDisplay === 'function') updateTrumpDisplay();

  // Hide trump overlay
  document.getElementById('trumpBackdrop').style.display = 'none';
  trumpSelectionActive = false;
  if (typeof disableTrumpDominoClicks === 'function') disableTrumpDominoClicks();
  if (typeof clearTrumpHighlights === 'function') clearTrumpHighlights();

  // Process any queued plays
  if (_mpPlayQueue.length > 0) {
    const queued = _mpPlayQueue.splice(0);
    for (const qp of queued) {
      setTimeout(() => mpHandlePlayConfirmed(qp), 100);
    }
    return;
  }

  mpCheckWhoseTurn();
}


// --- PLAY ---

async function mpHandlePlayConfirmed(move) {
  console.log('[MP] Play confirmed: seat', move.seat, 'tile:', move.tile,
    'trickComplete:', move.trickComplete, 'handComplete:', move.handComplete);

  // Clear pending intent if this was our play
  if (_pendingPlayIntent && move.seat === mpSeat) {
    _clearPendingPlayIntent();
  }

  // Queue if currently animating
  if (isAnimating) {
    _mpPlayQueue.push(move);
    return;
  }

  _mpLastActivityTime = Date.now();
  const isLocalSeat = (move.seat === mpSeat);

  // ── REMOTE PLAYER: Fast-forward state, no animation ──
  if (!isLocalSeat) {
    if (move.nextPlayer !== undefined && move.nextPlayer !== null) {
      session.game.current_player = move.nextPlayer;
    }
    // Remove a dummy tile from opponent hand
    if (session.game.hands[move.seat]) session.game.hands[move.seat].pop();

    // Remove an opponent sprite
    const opSprites = sprites[move.seat] || [];
    for (let i = 0; i < opSprites.length; i++) {
      if (opSprites[i] !== null) {
        const sd = opSprites[i];
        if (sd.sprite) { if (sd.sprite._shadow) sd.sprite._shadow.remove(); sd.sprite.remove(); }
        opSprites[i] = null;
        break;
      }
    }

    if (move.trickComplete) {
      session.game.trick_number = (session.game.trick_number || 0) + 1;
      if (move.trickWinner !== undefined) session.game.current_player = move.trickWinner;
      session.game.current_trick = [];
      if (move.teamPoints) {
        session.game.team_points = move.teamPoints;
        team1Score = move.teamPoints[0]; team2Score = move.teamPoints[1];
        updateScoreDisplay();
      }
    }

    if (move.handComplete && move.handResult) {
      _applyHandResult(move.handResult);
      setTimeout(() => mpShowHandEnd(), 800);
      return;
    }

    // Process queue or advance
    if (_mpPlayQueue.length > 0) {
      mpHandlePlayConfirmed(_mpPlayQueue.shift());
    } else {
      mpCheckWhoseTurn();
    }
    return;
  }

  // ── LOCAL PLAYER: Animate our tile ──

  // Update engine state
  const hand = session.game.hands[move.seat] || [];
  let gameHandIndex = -1;
  for (let i = 0; i < hand.length; i++) {
    const ht = hand[i];
    if ((ht[0] === move.tile[0] && ht[1] === move.tile[1]) ||
        (ht[0] === move.tile[1] && ht[1] === move.tile[0])) {
      gameHandIndex = i;
      break;
    }
  }
  if (gameHandIndex >= 0) {
    session.game.current_trick.push([move.seat, move.tile]);
    session.game.hands[move.seat].splice(gameHandIndex, 1);
  } else {
    session.game.current_trick.push([move.seat, move.tile]);
  }
  if (move.currentPlayer !== undefined) session.game.current_player = move.currentPlayer;

  // Find sprite by tile value
  const seatSprites = sprites[move.seat] || [];
  let spriteIdx = -1;
  for (let i = 0; i < seatSprites.length; i++) {
    const sd = seatSprites[i];
    if (sd && sd.tile &&
        ((sd.tile[0] === move.tile[0] && sd.tile[1] === move.tile[1]) ||
         (sd.tile[0] === move.tile[1] && sd.tile[1] === move.tile[0]))) {
      spriteIdx = i;
      break;
    }
  }

  isAnimating = true;
  const isLead = move.isLead;

  // Safety timeout
  const _animTimeout = setTimeout(() => {
    if (isAnimating) {
      console.warn('[MP] Animation timeout — forcing unlock');
      isAnimating = false;
      // Drain queue
      while (_mpPlayQueue.length > 0) {
        const qm = _mpPlayQueue.shift();
        if (qm.nextPlayer !== undefined) session.game.current_player = qm.nextPlayer;
        if (qm.trickComplete) {
          session.game.trick_number = (session.game.trick_number || 0) + 1;
          if (qm.trickWinner !== undefined) session.game.current_player = qm.trickWinner;
        }
        if (qm.seat !== mpSeat && session.game.hands[qm.seat]) session.game.hands[qm.seat].pop();
      }
      mpCheckWhoseTurn();
    }
  }, 3000);

  if (spriteIdx >= 0) {
    try { await playDomino(move.seat, spriteIdx, isLead, null, null); } catch (e) { console.warn('[MP] playDomino error:', e); }
  }

  // Handle trick completion
  if (move.trickComplete) {
    // Update tricks_team for boneyard tracking
    if (move.trickWinner !== null && move.trickWinner !== undefined) {
      const winTeam = session.game.team_of(move.trickWinner);
      if (!session.game.tricks_team[winTeam]) session.game.tricks_team[winTeam] = [];
      const trickRecord = [];
      for (const play of session.game.current_trick) trickRecord[play[0]] = play[1];
      session.game.tricks_team[winTeam].push(trickRecord);
    }

    if (move.teamPoints) {
      session.game.team_points = move.teamPoints;
      team1Score = move.teamPoints[0]; team2Score = move.teamPoints[1];
    }

    await new Promise(r => setTimeout(r, 800));
    await collectToHistory();
    session.game.current_trick = [];
    updateScoreDisplay();
    playedThisTrick = [];
    currentTrick++;

    if (move.handComplete && move.handResult) {
      _applyHandResult(move.handResult);
      setTimeout(() => mpShowHandEnd(), 800);
      isAnimating = false;
      clearTimeout(_animTimeout);
      return;
    }
  }

  isAnimating = false;
  clearTimeout(_animTimeout);

  // Process queued plays
  if (_mpPlayQueue.length > 0) {
    mpHandlePlayConfirmed(_mpPlayQueue.shift());
    return;
  }

  mpCheckWhoseTurn();
}

function mpHandlePlayRejected(move) {
  if (move.seat !== mpSeat) return;
  console.warn('[MP] Play rejected:', move.reason);
  _dropTileFromIntent();
  setStatus('Move rejected: ' + (move.reason || 'Unknown'));
  // Request state sync to recover
  setTimeout(() => {
    mpSendMove({ action: 'refresh_request', seat: mpSeat });
  }, 1000);
}

/** Apply hand result from server to local state. */
function _applyHandResult(handResult) {
  session.game.team_points = handResult.teamPoints || [0, 0];
  session.team_marks = handResult.teamMarks || [0, 0];
  team1Score = session.game.team_points[0];
  team2Score = session.game.team_points[1];
  team1Marks = session.team_marks[0];
  team2Marks = session.team_marks[1];
  session.status = handResult.status || 'Hand over';
  setStatus(session.status);
  updateScoreDisplay();
}

function mpHandleCallDoubleConfirmed(move) {
  if (move.called) {
    if (typeof callForDoubleActive !== 'undefined') callForDoubleActive = true;
    session.game.force_double_trump = true;
    if (typeof applyForcedDoubleGlow === 'function') applyForcedDoubleGlow();
    if (typeof showCallDoubleBanner === 'function') showCallDoubleBanner();
  } else {
    if (typeof callForDoubleActive !== 'undefined') callForDoubleActive = false;
    session.game.force_double_trump = false;
    if (typeof clearForcedDoubleGlow === 'function') clearForcedDoubleGlow();
  }
}


// --- WHOSE TURN ---

function mpCheckWhoseTurn() {
  if (!MULTIPLAYER_MODE || session.phase !== PHASE_PLAYING) return;
  const currentPlayer = session.game.current_player;
  console.log('[MP] Whose turn? seat=' + currentPlayer + ', mpSeat=' + mpSeat);

  // Validate active player
  if (!session.game.active_players.includes(currentPlayer)) {
    console.warn('[MP] current_player', currentPlayer, 'not active — fixing');
    session.game.current_player = session.game._next_active_player(currentPlayer);
    _trackCpChange('mpCheckWhoseTurn-fix');
  }

  if (currentPlayer === mpSeat) {
    // Our turn
    waitingForPlayer1 = true;
    enablePlayer1Clicks();
    updatePlayer1ValidStates();
    if (typeof showHint === 'function') showHint();
    setStatus('Trick ' + (session.game.trick_number + 1) + ' - Click a domino to play');
    if (typeof showYourTurnBanner === 'function') showYourTurnBanner();
    mpHideWaiting();
    _startTurnRecovery();
  } else {
    // Someone else's turn — wait for server to send play_confirmed
    waitingForPlayer1 = false;
    if (typeof clearPlayer1ValidStates === 'function') clearPlayer1ValidStates();
    setStatus(getPlayerDisplayName(currentPlayer) + ' is thinking...');
  }
}


// --- GAME OVER ---

function mpHandleGameOver(move) {
  console.log('[MP] Game over!', move);
  const teamMarks = move.teamMarks || [0, 0];
  if (session) session.team_marks = teamMarks;

  if (typeof showGameEndSummary === 'function') {
    const myTeam = mpSeat % 2;
    const won = teamMarks[myTeam] >= (mpMarksToWin || 7);
    showGameEndSummary(won);
  } else {
    setStatus('Game over! Team 1: ' + teamMarks[0] + ', Team 2: ' + teamMarks[1]);
  }
  mpGameStarted = false;
}


// --- STATE SYNC (reconnection) ---

function mpHandleStateSync(move) {
  try {
    _mpHandleStateSyncInternal(move);
  } catch (error) {
    console.error('[MP] State sync crashed:', error);
    mpSuppressSend = false;
    isAnimating = false;
    setStatus('Sync failed - tap refresh to retry');
  }
}

function _mpHandleStateSyncInternal(move) {
  _clearIntentTimeout();

  const snap = move.snapshot || move;

  if (mpSeat < 0) return;
  console.log('[MP] State sync received, phase=' + snap.phase);

  mpSuppressSend = true;
  mpGameStarted = true;
  document.getElementById('mpBackdrop').style.display = 'none';

  // Close all overlays
  ['bidBackdrop', 'trumpBackdrop', 'nelloDoublesBackdrop', 'dfmChoiceBackdrop'].forEach(id => {
    const el = document.getElementById(id);
    if (el) el.style.display = 'none';
  });
  mpHideWaiting();

  // Set up session from snapshot
  const playerCount = 4;
  const handSize = 7;
  if (!session || session.game.player_count !== playerCount) {
    session = new SessionV6_4g(playerCount, 6, handSize, snap.marksToWin || 7);
  }

  session.dealer = snap.dealer;
  session.phase = snap.phase;
  session.bid_winner_seat = snap.bidWinnerSeat;
  session.current_bid = snap.currentBid;
  session.bid_marks = snap.bidMarks || 1;
  if (snap.contract) session.contract = snap.contract;
  if (snap.teamMarks) session.team_marks = snap.teamMarks;
  if (snap.teamPoints) session.game.team_points = snap.teamPoints;
  if (snap.trumpSuit !== undefined) session.game.trump_suit = snap.trumpSuit;
  if (snap.trumpMode !== undefined) session.game.trump_mode = snap.trumpMode;
  if (snap.leader !== undefined) session.game.leader = snap.leader;
  if (snap.currentPlayer !== undefined) session.game.current_player = snap.currentPlayer;
  if (snap.trickNumber !== undefined) session.game.trick_number = snap.trickNumber;
  if (snap.activePlayers) session.game.set_active_players(snap.activePlayers);

  // Restore current trick
  if (snap.currentTrick && Array.isArray(snap.currentTrick)) {
    session.game.current_trick = snap.currentTrick.map(ct => [ct[0], ct[1]]);
  }

  // Rebuild hand
  const myHand = snap.hand || [];
  const hands = [];
  const handSizes = snap.handSizes || [];
  for (let i = 0; i < playerCount; i++) {
    if (i === mpSeat) {
      hands.push(myHand);
    } else {
      const sz = handSizes[i] || 0;
      const dummy = [];
      for (let j = 0; j < sz; j++) dummy.push([-1, -1]);
      hands.push(dummy);
    }
  }
  session.game.hands = hands.map(h => (h || []).map(t => [Number(t[0]), Number(t[1])]));

  // Rebuild visuals
  applyT42Settings();
  shadowLayer.innerHTML = '';
  spriteLayer.innerHTML = '';
  sprites.length = 0;
  playedThisTrick = [];
  _mpPlayQueue = [];
  isAnimating = false;
  waitingForPlayer1 = false;

  createPlaceholders();

  for (let p = 0; p < playerCount; p++) {
    sprites[p] = [];
    const visualP = mpVisualPlayer(p);
    const pHand = session.game.hands[p] || [];
    for (let h = 0; h < pHand.length; h++) {
      const tile = pHand[h];
      if (!tile) continue;
      const sprite = makeSprite(tile);
      const pos = getHandPosition(visualP, h);
      if (pos) {
        sprite.setPose(pos);
        if (sprite._shadow) shadowLayer.appendChild(sprite._shadow);
        spriteLayer.appendChild(sprite);
        sprites[p][h] = { sprite, tile, originalSlot: h };
        if (p === mpSeat) {
          sprite.addEventListener('click', () => handlePlayer1Click(sprite));
          sprite.addEventListener('touchstart', (e) => { e.preventDefault(); e.stopPropagation(); handlePlayer1Click(sprite); }, { passive: false });
          sprite.setFaceUp(true);
        } else {
          sprite.setFaceUp(false);
        }
      }
    }
  }

  // Update scores
  team1Score = session.game.team_points[0]; team2Score = session.game.team_points[1];
  team1Marks = session.team_marks[0]; team2Marks = session.team_marks[1];
  updateScoreDisplay();
  positionPlayerIndicators();

  // Apply trump visuals
  if (session.game.trump_suit !== null || session.game.trump_mode !== 'NONE') {
    syncSpritesWithGameState();
    if (typeof sortPlayerHandByTrump === 'function') sortPlayerHandByTrump();
    if (typeof sortAllHandsByTrump === 'function') sortAllHandsByTrump();
    if (typeof flipTilesForTrump === 'function') flipTilesForTrump();
    if (typeof updateTrumpDisplay === 'function') updateTrumpDisplay();
  }

  mpSuppressSend = false;

  // Resume based on phase
  if (session.phase === PHASE_NEED_BID || session.phase === 'NEED_BID') {
    // Restore bidding state from snapshot
    if (snap.currentBidder !== undefined) {
      initBiddingRound();
      biddingState.currentBidder = snap.currentBidder;
      biddingState.highBid = snap.highBid || 0;
      biddingState.highBidder = snap.highBidder;
      biddingState.passCount = snap.passCount || 0;
    }
    mpRunBiddingStep();
  } else if (session.phase === PHASE_NEED_TRUMP || session.phase === 'NEED_TRUMP') {
    if (session.bid_winner_seat === mpSeat) {
      _showTrumpSelection(session.current_bid);
    } else {
      setStatus(getPlayerDisplayName(session.bid_winner_seat) + ' is choosing trump...');
    }
  } else if (session.phase === PHASE_PLAYING || session.phase === 'PLAYING') {
    mpCheckWhoseTurn();
  }
}


// --- HAND END ---

function mpShowHandEnd() {
  if (typeof flipRemainingDominoes === 'function') flipRemainingDominoes();
  if (typeof showHandEndPopup === 'function') showHandEndPopup();
}

function mpShowWaiting(text) {
  if (text) setStatus(text);
}

function mpHideWaiting() {
  const el = document.getElementById('mpWaiting');
  if (el) el.style.display = 'none';
}


// ============================================================
// SECTION 5: Lobby UI
// ============================================================

function mpBuildRoomButtons() {
  var roomSection = document.getElementById('mpRoomSection');
  if (roomSection) roomSection.style.display = 'block';
  mpBuildRoomGrid('T42');
  mpRequestRoomStatus();
}

function mpRequestRoomStatus() {
  if (mpSocket && mpSocket.readyState === WebSocket.OPEN) {
    try { mpSocket.send(JSON.stringify({ type: 'room_status' })); } catch (e) {}
    return;
  }
  // Temporary connection to get room counts
  try {
    var tmpSock = new WebSocket(MP_WS_URL);
    tmpSock.onopen = function() {
      try { tmpSock.send(JSON.stringify({ type: 'room_status' })); } catch (e) {}
    };
    tmpSock.onmessage = function(evt) {
      try {
        var msg = JSON.parse(evt.data);
        if (msg.type === 'room_status') {
          mpRoomCounts = {};
          if (msg.rooms && Array.isArray(msg.rooms)) {
            msg.rooms.forEach(function(r) {
              mpRoomCounts[r.room] = { count: r.count, max: r.max, observers: r.observers || 0 };
            });
          }
          mpUpdateRoomButtons();
        }
      } catch (e) {}
    };
    tmpSock.onerror = function() {};
    tmpSock.onclose = function() {};
    setTimeout(function() { try { if (tmpSock.readyState <= 1) tmpSock.close(); } catch (e) {} }, 5000);
  } catch (e) {}
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
    const rc = mpRoomCounts[r.name] || { count: 0 };
    btn.innerHTML = '<div style="font-weight:700;font-size:14px;">' + r.label + '</div>'
      + '<div style="font-size:10px;opacity:0.7;" class="mpRoomCount">' + rc.count + '/4 players</div>';
    btn.style.cssText = 'padding:12px;border:2px solid rgba(255,255,255,0.15);border-radius:10px;background:rgba(255,255,255,0.05);color:#fff;cursor:pointer;transition:all 0.2s;text-align:center;';
    btn.addEventListener('click', () => {
      mpPreferredSeat = -1;
      // Show seat selection
      mpBuildSeatGrid(r.name);
      document.getElementById('mpSeatSection').style.display = '';
    });
    grid.appendChild(btn);
  });
}

function mpUpdateRoomButtons() {
  const grid = document.getElementById('mpRoomGrid');
  if (!grid) return;
  const btns = grid.querySelectorAll('button');
  btns.forEach(btn => {
    const room = btn.dataset.room;
    if (!room) return;
    const rc = mpRoomCounts[room] || { count: 0 };
    const countEl = btn.querySelector('.mpRoomCount');
    if (countEl) countEl.textContent = rc.count + '/4 players';
    if (rc.count >= 4) {
      btn.style.borderColor = '#ef4444';
      btn.style.opacity = '0.6';
    } else if (rc.count > 0) {
      btn.style.borderColor = '#22c55e';
      btn.style.opacity = '1';
    } else {
      btn.style.borderColor = 'rgba(255,255,255,0.15)';
      btn.style.opacity = '1';
    }
  });
}

function mpBuildSeatGrid(roomName) {
  const grid = document.getElementById('mpSeatGrid');
  if (!grid) return;
  grid.innerHTML = '';
  for (let s = 0; s < 4; s++) {
    const btn = document.createElement('button');
    btn.textContent = 'Seat ' + (s + 1);
    btn.style.cssText = 'flex:1;padding:10px;border:2px solid rgba(255,255,255,0.15);border-radius:8px;background:rgba(255,255,255,0.05);color:#fff;cursor:pointer;font-size:13px;min-width:60px;';
    btn.addEventListener('click', () => {
      mpPreferredSeat = s;
      // Highlight selected
      grid.querySelectorAll('button').forEach(b => {
        b.style.borderColor = 'rgba(255,255,255,0.15)';
        b.style.background = 'rgba(255,255,255,0.05)';
      });
      btn.style.borderColor = '#60a5fa';
      btn.style.background = 'rgba(96,165,250,0.2)';
    });
    grid.appendChild(btn);
  }
  // "Any seat" button
  const anyBtn = document.createElement('button');
  anyBtn.textContent = 'Any';
  anyBtn.style.cssText = 'flex:1;padding:10px;border:2px solid #60a5fa;border-radius:8px;background:rgba(96,165,250,0.2);color:#fff;cursor:pointer;font-size:13px;min-width:60px;';
  anyBtn.addEventListener('click', () => {
    mpPreferredSeat = -1;
    grid.querySelectorAll('button').forEach(b => {
      b.style.borderColor = 'rgba(255,255,255,0.15)';
      b.style.background = 'rgba(255,255,255,0.05)';
    });
    anyBtn.style.borderColor = '#60a5fa';
    anyBtn.style.background = 'rgba(96,165,250,0.2)';
  });
  grid.appendChild(anyBtn);

  // Store room for connect button
  grid.dataset.pendingRoom = roomName;
}

function mpRenderPlayerList(players) {
  const container = document.getElementById('mpPlayers');
  if (!container) return;
  container.innerHTML = '';
  for (let s = 0; s < 4; s++) {
    const p = players[s] || mpPlayers[s];
    const div = document.createElement('div');
    div.style.cssText = 'padding:8px 12px;border-radius:6px;background:rgba(255,255,255,0.05);font-size:13px;display:flex;justify-content:space-between;align-items:center;';
    if (p) {
      const isMe = (s === mpSeat);
      const name = p.name || ('Player ' + (s + 1));
      const tag = isMe ? '<span style="color:#22c55e;font-size:11px;">YOU</span>'
        : (p.connected === false ? '<span style="color:#ef4444;font-size:11px;">OFFLINE</span>'
           : '<span style="color:#60a5fa;font-size:11px;">READY</span>');
      div.innerHTML = '<span style="color:#fff;">Seat ' + (s + 1) + ': ' + name + '</span>' + tag;
    } else {
      div.innerHTML = '<span style="color:#6b7280;">Seat ' + (s + 1) + ': (AI)</span><span style="color:#9ca3af;font-size:11px;">bot</span>';
    }
    container.appendChild(div);
  }

  // Show start button only for seat 0 (room leader)
  const startBtn = document.getElementById('mpStartGame');
  if (startBtn) {
    startBtn.style.display = (mpSeat === 0) ? '' : 'none';
  }
  const hostSettings = document.getElementById('mpHostSettings');
  if (hostSettings) {
    hostSettings.style.display = (mpSeat === 0) ? '' : 'none';
  }
}


// ============================================================
// SECTION 6: Visual Helpers
// ============================================================

/** Map game seat to visual player position (local player = P1 at bottom). */
function mpVisualPlayer(seat) {
  const viewSeat = mpObserver ? mpObserverViewSeat : mpSeat;
  return ((seat - viewSeat + session.game.player_count) % session.game.player_count) + 1;
}

/** Check if a seat is AI (no connected human). */
function mpIsAI(seat) {
  if (!MULTIPLAYER_MODE) return false;
  if (seat === mpSeat) return false;
  return !mpPlayers[seat] || mpPlayers[seat].connected === false;
}

/** Check if seat is a remote human. */
function mpIsRemoteHuman(seat) {
  if (!MULTIPLAYER_MODE) return false;
  if (seat === mpSeat) return true;
  return !!mpPlayers[seat] && mpPlayers[seat].connected !== false;
}

/** Update connection status text in the lobby modal. */
function mpUpdateStatus(text, color) {
  const el = document.getElementById('mpConnStatus');
  if (el) {
    el.textContent = text;
    el.style.color = color || '#9ca3af';
  }
}

/** Update the floating connection indicator. */
function mpUpdateIndicator() {
  const indicator = document.getElementById('mpIndicator');
  const dot = document.getElementById('mpDot');
  const statusText = document.getElementById('mpStatusText');
  const countText = document.getElementById('mpPlayerCount');
  if (!indicator) return;

  if (mpSeat >= 0 && mpConnected) {
    indicator.style.display = 'flex';
    if (dot) dot.style.background = '#22c55e';
    if (statusText) statusText.textContent = mpRoom || 'Connected';
    const humanCount = Object.keys(mpPlayers).length;
    if (countText) countText.textContent = humanCount + '/4';
  } else if (mpConnected) {
    indicator.style.display = 'flex';
    if (dot) dot.style.background = '#f59e0b';
    if (statusText) statusText.textContent = 'Connecting...';
    if (countText) countText.textContent = '';
  } else {
    if (dot) dot.style.background = '#ef4444';
    if (statusText) statusText.textContent = 'Offline';
    if (countText) countText.textContent = '';
  }
}

function mpToggleIndicator() {
  // Open the lobby modal
  document.getElementById('mpBackdrop').style.display = 'flex';
  if (!mpConnected) mpBuildRoomButtons();
}


// ============================================================
// SECTION 7: Session Persistence
// ============================================================

function mpGenerateId() {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghjkmnpqrstuvwxyz23456789';
  let id = '';
  for (let i = 0; i < 8; i++) id += chars[Math.floor(Math.random() * chars.length)];
  return id;
}

function mpSaveSession() {
  if (!mpRoom || !mpPlayerId) return;
  try {
    localStorage.setItem('tn51_mp_session_' + mpRoom, JSON.stringify({
      room: mpRoom, seat: mpSeat, playerId: mpPlayerId, timestamp: Date.now()
    }));
  } catch (e) {}
}

function mpLoadSession(roomName) {
  if (!roomName) return null;
  try {
    const raw = localStorage.getItem('tn51_mp_session_' + roomName);
    if (!raw) return null;
    const data = JSON.parse(raw);
    if (Date.now() - data.timestamp > 15 * 60 * 1000) {
      localStorage.removeItem('tn51_mp_session_' + roomName);
      return null;
    }
    return data;
  } catch (e) { return null; }
}

// Host state persistence stubs (server handles all state now)
function mpSaveHostState() { /* no-op: server is source of truth */ }
function mpMarkHostStateCompleted() { /* no-op */ }


// ============================================================
// SECTION 8: Diagnostic Log Export
// ============================================================

function mpExportDiagLog() {
  if (_mpDiagLog.length === 0) { alert('No MP diagnostic entries.'); return; }
  let txt = '=== TX42 MP Diagnostic Log ===\n';
  txt += 'Exported: ' + new Date().toISOString() + '\n';
  txt += 'Version: ' + MP_VERSION + '\n';
  txt += 'Seat: ' + mpSeat + ' | Room: ' + (mpRoom || '?') + '\n';
  txt += 'Entries: ' + _mpDiagLog.length + '\n';
  txt += '========================================\n\n';
  for (const e of _mpDiagLog) {
    txt += '[' + e.ts + '] ' + e.dir + ' | ' + e.cat;
    txt += ' | phase=' + e.phase + ' cp=' + e.cp + ' trick=' + e.trick;
    txt += ' | ' + (typeof e.data === 'string' ? e.data : JSON.stringify(e.data)) + '\n';
  }
  // Show in overlay
  let overlay = document.getElementById('mpLogOverlay');
  if (!overlay) {
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
    copyBtn.textContent = 'Copy';
    copyBtn.style.cssText = 'padding:10px 24px;background:#22c55e;color:#fff;border:none;border-radius:6px;font-size:14px;font-weight:bold;cursor:pointer;';
    copyBtn.addEventListener('click', () => {
      navigator.clipboard.writeText(document.getElementById('mpLogTextarea').value).then(() => {
        copyBtn.textContent = 'Copied!'; setTimeout(() => { copyBtn.textContent = 'Copy'; }, 2000);
      }).catch(() => { document.execCommand('copy'); });
    });
    const closeBtn = document.createElement('button');
    closeBtn.textContent = 'Close';
    closeBtn.style.cssText = 'padding:10px 24px;background:#ef4444;color:#fff;border:none;border-radius:6px;font-size:14px;font-weight:bold;cursor:pointer;';
    closeBtn.addEventListener('click', () => { overlay.style.display = 'none'; });
    btnRow.appendChild(copyBtn);
    btnRow.appendChild(closeBtn);
    overlay.appendChild(ta);
    overlay.appendChild(btnRow);
    document.body.appendChild(overlay);
  }
  document.getElementById('mpLogTextarea').value = txt;
  overlay.style.display = 'flex';
}

function mpGetGameSnapshot() {
  if (!session || !session.game) return { noSession: true };
  return {
    phase: session.phase,
    currentPlayer: session.game.current_player,
    trickNumber: session.game.trick_number,
    handSizes: session.game.hands ? session.game.hands.map(h => h ? h.length : 0) : [],
    teamMarks: session.team_marks ? session.team_marks.slice() : [],
    mpSeat: mpSeat, mpConnected: mpConnected,
    socketState: mpSocket ? mpSocket.readyState : -1
  };
}


// ============================================================
// SECTION 9: Observer Stubs
// ============================================================

function mpConnectAsObserver() { /* no-op */ }
function mpHandleObserverMessage() { /* no-op */ }
function mpShowObserverControls() { /* no-op */ }


// ============================================================
// SECTION 10: Lobby Wiring (runs on load)
// ============================================================

(function mpInitLobby() {
  // Connect button
  const connectBtn = document.getElementById('mpConnect');
  if (connectBtn) {
    connectBtn.addEventListener('click', () => {
      // Get selected room from seat grid
      const seatGrid = document.getElementById('mpSeatGrid');
      const roomName = (seatGrid && seatGrid.dataset.pendingRoom) || 'Tx42room001';
      // Load saved session for potential reconnect
      const saved = mpLoadSession(roomName);
      if (saved && saved.playerId) mpPlayerId = saved.playerId;
      if (!mpPlayerId) mpPlayerId = mpGenerateId();
      mpConnect(roomName);
    });
  }

  // Disconnect button
  const disconnectBtn = document.getElementById('mpDisconnect');
  if (disconnectBtn) {
    disconnectBtn.addEventListener('click', mpDisconnect);
  }

  // Start game button (room leader only)
  const startBtn = document.getElementById('mpStartGame');
  if (startBtn) {
    startBtn.addEventListener('click', () => {
      if (mpSeat !== 0) return; // Only room leader
      // Read marks setting
      let marksToWin = 7;
      const selectedMarks = document.querySelector('.mpMarksBtn.mpMarksSelected');
      if (selectedMarks) marksToWin = parseInt(selectedMarks.dataset.marks) || 7;
      mpMarksToWin = marksToWin;
      mpSendMove({ action: 'start_game', marksToWin: marksToWin });
    });
  }

  // Marks buttons
  document.querySelectorAll('.mpMarksBtn').forEach(btn => {
    btn.addEventListener('click', () => {
      document.querySelectorAll('.mpMarksBtn').forEach(b => {
        b.classList.remove('mpMarksSelected');
        b.style.borderColor = 'rgba(255,255,255,0.15)';
        b.style.background = 'rgba(255,255,255,0.05)';
      });
      btn.classList.add('mpMarksSelected');
      btn.style.borderColor = '#60a5fa';
      btn.style.background = 'rgba(96,165,250,0.2)';
    });
  });

  // Close button
  const closeBtn = document.getElementById('mpCloseBtn');
  if (closeBtn) {
    closeBtn.addEventListener('click', () => {
      document.getElementById('mpBackdrop').style.display = 'none';
    });
  }

  // Menu -> Lobby opens the MP modal
  const menuHome = document.getElementById('menuHome');
  if (menuHome) {
    menuHome.addEventListener('click', () => {
      document.getElementById('settingsMenu').style.display = 'none';
      document.getElementById('mpBackdrop').style.display = 'flex';
      if (!mpConnected) mpBuildRoomButtons();
    });
  }

  // Name entry
  const nameConfirmBtn = document.getElementById('nameConfirmBtn');
  if (nameConfirmBtn) {
    nameConfirmBtn.addEventListener('click', () => {
      const input = document.getElementById('nameInput');
      const name = input ? input.value.trim() : '';
      if (name) {
        playerName = name;
        try { localStorage.setItem('tn51_player_name', name); localStorage.setItem('tn51_player_noname', 'false'); } catch (e) {}
        playerNoName = false;
      }
      document.getElementById('nameEntryBackdrop').style.display = 'none';
      // Show lobby
      document.getElementById('mpBackdrop').style.display = 'flex';
      mpBuildRoomButtons();
    });
  }

  // On page load: show name entry if no name, otherwise show lobby
  try {
    if (!playerName || playerNoName) {
      document.getElementById('nameEntryBackdrop').style.display = 'flex';
    } else {
      document.getElementById('mpBackdrop').style.display = 'flex';
      mpBuildRoomButtons();
    }
  } catch (e) {
    console.error('[MP] Lobby init error:', e);
    // Fallback: force show lobby
    document.getElementById('mpBackdrop').style.display = 'flex';
    try { mpBuildRoomButtons(); } catch (e2) { console.error('[MP] Room build error:', e2); }
  }

  // Show player name in topbar
  const nameDisplay = document.getElementById('playerNameDisplay');
  if (nameDisplay && playerName) {
    nameDisplay.textContent = playerName;
    nameDisplay.style.display = 'block';
  }
})();


// ============================================================
// SECTION 11: Chat Stubs (loaded separately if needed)
// ============================================================

// In-game chat handler stubs — can be replaced by chat.js
function mpHandleChat(msg) {
  const chatMessages = document.getElementById('mpChatMessages');
  if (!chatMessages) return;
  const div = document.createElement('div');
  div.style.marginBottom = '4px';
  const name = msg.name || ('Seat ' + ((msg.seat !== undefined ? msg.seat : '?') + 1));
  div.innerHTML = '<span style="color:#60a5fa;font-weight:600;">' + name + ':</span> ' + (msg.text || '');
  chatMessages.appendChild(div);
  chatMessages.scrollTop = chatMessages.scrollHeight;
  // Show badge on chat icon
  const badge = document.querySelector('#mpChatIcon .chat-badge');
  const panel = document.getElementById('mpChatPanel');
  if (badge && panel && panel.style.display === 'none') {
    badge.style.display = '';
  }
}

function mpHandleChatClear() {
  const chatMessages = document.getElementById('mpChatMessages');
  if (chatMessages) chatMessages.innerHTML = '';
}

function mpShowChatIcon(show) {
  const icon = document.getElementById('mpChatIcon');
  if (icon) icon.style.display = show ? 'flex' : 'none';
}

// Chat UI wiring
(function() {
  const chatIcon = document.getElementById('mpChatIcon');
  const chatPanel = document.getElementById('mpChatPanel');
  const chatClose = document.getElementById('mpChatCloseBtn');
  const chatSend = document.getElementById('mpChatSendBtn');
  const chatInput = document.getElementById('mpChatInputField');

  if (chatIcon) {
    chatIcon.addEventListener('click', () => {
      if (chatPanel) chatPanel.style.display = chatPanel.style.display === 'flex' ? 'none' : 'flex';
      const badge = chatIcon.querySelector('.chat-badge');
      if (badge) badge.style.display = 'none';
    });
  }
  if (chatClose && chatPanel) {
    chatClose.addEventListener('click', () => { chatPanel.style.display = 'none'; });
  }
  function sendChat() {
    if (!chatInput || !chatInput.value.trim()) return;
    const text = chatInput.value.trim();
    chatInput.value = '';
    if (mpSocket && mpSocket.readyState === WebSocket.OPEN) {
      try { mpSocket.send(JSON.stringify({ type: 'chat', text: text, seat: mpSeat, name: playerName || 'Player' })); } catch (e) {}
    }
  }
  if (chatSend) chatSend.addEventListener('click', sendChat);
  if (chatInput) chatInput.addEventListener('keydown', (e) => { if (e.key === 'Enter') sendChat(); });
})();
