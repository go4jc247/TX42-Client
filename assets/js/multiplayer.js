// TX42-Client — multiplayer.js (v38 Clean Architecture)
// Serial message queue, clean state machine, identical game.js interface.
// Server is sole source of truth. This file: transport + rendering only.

'use strict';

// ── Constants ──────────────────────────────────────────────────────────────

const MP_WS_URL          = 'wss://tx42-server.onrender.com';
const MP_VERSION         = 'v38-TX42';
const MP_HEARTBEAT_MS    = 20000;
const MP_PONG_TIMEOUT_MS = 45000;
const MP_RECONNECT_DELAYS = [2000, 5000, 10000, 20000, 30000];

const MP_ALL_ROOMS = [
  { name: 'Tx42room001', label: 'Room #1', mode: 'T42' },
  { name: 'Tx42room002', label: 'Room #2', mode: 'T42' },
  { name: 'Tx42room003', label: 'Room #3', mode: 'T42' },
  { name: 'Tx42room004', label: 'Room #4', mode: 'T42' },
  { name: 'Tx42room005', label: 'Room #5', mode: 'T42' },
];

// ── Private Transport State ────────────────────────────────────────────────

let _hbInterval     = null;
let _lastPong       = Date.now();
let _reconnectCount = 0;

// ── Serial Message Queue ───────────────────────────────────────────────────

let _msgQueue     = [];
let _queueRunning = false;

function _enqueue(msg) {
  _msgQueue.push(msg);
  if (!_queueRunning) _drainQueue();
}

async function _drainQueue() {
  _queueRunning = true;
  while (_msgQueue.length > 0) {
    const msg = _msgQueue.shift();
    try {
      await _dispatch(msg);
    } catch (e) {
      console.warn('[MP] Dispatch error:', e);
      isAnimating = false;
    }
  }
  _queueRunning = false;
}

// ── Transport ──────────────────────────────────────────────────────────────

function mpConnect(roomName) {
  if (mpSocket && mpSocket.readyState === WebSocket.OPEN) {
    mpRoom      = roomName;
    mpConnected = false;
    mpUpdateStatus('Joining room...', '#f59e0b');
    _sendRaw({ type: 'join', room: roomName, name: playerName || 'Player',
               playerId: mpPlayerId || undefined, preferredSeat: mpPreferredSeat });
    return;
  }
  if (mpSocket) { try { mpSocket.close(); } catch (e) {} }
  _stopHeartbeat();
  mpRoom      = roomName;
  mpConnected = false;
  mpUpdateStatus('Connecting...', '#f59e0b');
  console.log('[MP] Connecting to', roomName);

  mpSocket = new WebSocket(MP_WS_URL);

  mpSocket.onopen = () => {
    _reconnectCount = 0;
    _lastPong       = Date.now();
    console.log('[MP] Open → joining', roomName);
    _sendRaw({ type: 'join', room: roomName, name: playerName || 'Player',
               playerId: mpPlayerId || undefined, preferredSeat: mpPreferredSeat });
    _startHeartbeat();
  };

  mpSocket.onmessage = (evt) => {
    _lastPong = Date.now();
    let msg;
    try { msg = JSON.parse(evt.data); } catch { return; }
    if (msg.type === 'pong') return;
    _enqueue(msg);
  };

  mpSocket.onclose = (evt) => {
    console.log('[MP] Closed', evt.code, evt.reason);
    mpConnected = false;
    _stopHeartbeat();
    mpUpdateStatus('Disconnected', '#ef4444');
    mpUpdateIndicator();
    _maybeReconnect();
  };

  mpSocket.onerror = () => {
    mpUpdateStatus('Connection error', '#ef4444');
  };
}

function _maybeReconnect() {
  if (!MULTIPLAYER_MODE || !mpRoom) return;
  if (_reconnectCount >= 50) {
    mpUpdateStatus('Connection lost. Refresh to retry.', '#ef4444');
    setStatus('Connection lost.');
    return;
  }
  const delay = MP_RECONNECT_DELAYS[Math.min(_reconnectCount, MP_RECONNECT_DELAYS.length - 1)];
  _reconnectCount++;
  mpUpdateStatus('Reconnecting (' + _reconnectCount + '/50)...', '#f59e0b');
  setTimeout(() => mpConnect(mpRoom), delay);
}

function mpDisconnect() {
  mpGameStarted = false;
  _stopHeartbeat();
  if (mpSocket) { try { mpSocket.close(); } catch (e) {} mpSocket = null; }
  mpConnected   = false;
  mpSeat        = -1;
  mpIsHost      = false;
  mpPlayers     = {};
  mpRoom        = null;
  _msgQueue     = [];
  _queueRunning = false;
  mpUpdateStatus('Disconnected', '#ef4444');
  mpUpdateIndicator();
  _showLobbyReset();
}

function _sendRaw(msg) {
  if (mpSocket && mpSocket.readyState === WebSocket.OPEN) {
    try { mpSocket.send(JSON.stringify(msg)); } catch (e) {
      console.warn('[MP] Send error:', e);
      if (mpSocket) mpSocket.close();
    }
  }
}

function mpSendMove(moveObj) {
  if (!MULTIPLAYER_MODE || mpSuppressSend) return;
  console.log('[MP] Send move:', moveObj);
  _sendRaw({ type: 'move', move: moveObj, t: Date.now() });
}

function _startHeartbeat() {
  _stopHeartbeat();
  _hbInterval = setInterval(() => {
    _sendRaw({ type: 'ping' });
    if (Date.now() - _lastPong > MP_PONG_TIMEOUT_MS && mpSocket) {
      console.warn('[MP] Pong timeout — closing');
      mpSocket.close();
    }
  }, MP_HEARTBEAT_MS);
}

function _stopHeartbeat() {
  if (_hbInterval) { clearInterval(_hbInterval); _hbInterval = null; }
}

// ── Message Dispatcher ─────────────────────────────────────────────────────

async function _dispatch(msg) {
  _mpLastActivityTime = Date.now();
  switch (msg.type) {
    case 'room_status':
      _onRoomStatus(msg); return;
    case 'room_update':
      mpRoomCounts[msg.room] = { count: msg.count, max: msg.max, observers: msg.observers || 0 };
      mpUpdateRoomButtons(); return;
    case 'peer_joined':
    case 'peer_left':
      if (msg.room && msg.playerCount !== undefined) {
        if (mpRoomCounts[msg.room]) mpRoomCounts[msg.room].count = msg.playerCount;
        mpUpdateRoomButtons();
      }
      return;
    case 'chat':      _onChat(msg); return;
    case 'chat_clear': _onChatClear(); return;
    case 'joined':    _onJoined(msg); return;
    case 'join_rejected':
      mpUpdateStatus('Join rejected: ' + (msg.reason || 'Unknown'), '#ef4444'); return;
    case 'error':
      mpUpdateStatus('Error: ' + (msg.reason || 'Unknown'), '#ef4444'); return;
    case 'move':
      if (msg.move) await _dispatchMove(msg.move);
      return;
  }
}

async function _dispatchMove(move) {
  console.log('[MP] Move:', move.action);
  switch (move.action) {
    case 'seat_assign':           _onSeatAssign(move);         break;
    case 'player_list':           _onPlayerList(move);         break;
    case 'start_game':            _onStartGame(move);          break;
    case 'deal':             await _onDeal(move);              break;
    case 'bid_confirmed':         _onBidConfirmed(move);       break;
    case 'pass_confirmed':        _onPassConfirmed(move);      break;
    case 'trump_confirmed':       _onTrumpConfirmed(move);     break;
    case 'play_confirmed':   await _onPlayConfirmed(move);     break;
    case 'play_rejected':         _onPlayRejected(move);       break;
    case 'state_sync':            _onStateSync(move);          break;
    case 'game_over':             _onGameOver(move);           break;
    case 'call_double_confirmed': _onCallDouble(move);         break;
    case 'heartbeat':
    case 'heartbeat_ack':
    case 'seat_ack':
      break;
    default:
      console.log('[MP] Unhandled action:', move.action);
  }
}

// ── Lobby Handlers ─────────────────────────────────────────────────────────

function _onRoomStatus(msg) {
  mpRoomCounts = {};
  if (msg.rooms) {
    msg.rooms.forEach(r => {
      mpRoomCounts[r.room] = { count: r.count, max: r.max, observers: r.observers || 0 };
    });
  }
  mpUpdateRoomButtons();
}

function _onJoined(msg) {
  mpConnected = true;
  mpUpdateStatus('Connected to ' + msg.room, '#22c55e');
  mpUpdateIndicator();
  document.getElementById('mpConnect').style.display     = 'none';
  document.getElementById('mpDisconnect').style.display  = '';
  document.getElementById('mpPlayerList').style.display  = '';
  if (mpGameStarted && mpSeat >= 0) {
    setTimeout(() => {
      if (mpSocket && mpSocket.readyState === WebSocket.OPEN) {
        mpSendMove({ action: 'refresh_request', seat: mpSeat });
      }
    }, 1500);
  }
}

function _onSeatAssign(move) {
  mpSeat   = move.seat;
  mpIsHost = (move.seat === 0);
  MULTIPLAYER_MODE = true;
  if (move.playerId) { mpPlayerId = move.playerId; _saveSession(); }
  const label = move.reconnect ? 'Reconnected! ' : '';
  mpUpdateStatus(label + 'Seat ' + (mpSeat + 1) + ' in ' + mpRoom, '#22c55e');
  mpConnected = true;
  document.getElementById('mpPlayerList').style.display  = '';
  document.getElementById('mpRoomSection').style.display = 'none';
  document.getElementById('mpSeatSection').style.display = 'none';
  mpSendMove({ action: 'seat_ack', seat: mpSeat });
  mpUpdateIndicator();
}

function _onPlayerList(move) {
  const list = move.players || {};
  mpPlayers = {};
  for (const [k, v] of Object.entries(list)) mpPlayers[parseInt(k)] = v;
  if (mpSeat >= 0 && !mpPlayers[mpSeat]) {
    mpPlayers[mpSeat] = { seat: mpSeat, name: playerName || ('Player ' + (mpSeat + 1)) };
  }
  mpRenderPlayerList(list);
  mpUpdateIndicator();
}

function _onStartGame(move) {
  mpGameStarted    = true;
  MULTIPLAYER_MODE = true;
  if (move.marksToWin) mpMarksToWin = move.marksToWin;
  if (move.gameMode && GAME_MODE !== move.gameMode) initGameMode(move.gameMode);
  applyT42Settings();
  document.getElementById('bidBackdrop').style.display = 'none';
  document.getElementById('mpBackdrop').style.display  = 'none';
  setStatus('Game starting...');
}

// ── Deal ───────────────────────────────────────────────────────────────────

async function _onDeal(move) {
  if (mpSeat < 0) { console.warn('[MP] deal before seat assigned'); return; }
  console.log('[MP] Deal for seat', mpSeat);

  mpSuppressSend = true;
  mpGameStarted  = true;

  ['mpBackdrop', 'bidBackdrop'].forEach(id => {
    const el = document.getElementById(id); if (el) el.style.display = 'none';
  });
  if (typeof hideRoundEndSummary === 'function') hideRoundEndSummary();
  if (typeof hideGameEndSummary  === 'function') hideGameEndSummary();
  if (typeof mpShowChatIcon      === 'function') mpShowChatIcon(true);

  applyT42Settings();

  const marksToWin = move.marksToWin || mpMarksToWin || 7;
  if (!session || session.game.player_count !== 4) {
    session = new SessionV6_4g(4, 6, 7, marksToWin);
  }
  session.dealer = move.dealer;

  // Extract our hand
  let myHand = move.hand || [];
  if (!myHand.length && move.hands) {
    myHand = (Array.isArray(move.hands[0]) && Array.isArray(move.hands[0][0]))
      ? (move.hands[mpSeat] || []) : move.hands;
  }

  // Build hands: real for us, dummy face-down for opponents
  const hands = [];
  for (let i = 0; i < 4; i++) {
    hands.push(i === mpSeat ? myHand : Array.from({ length: 7 }, () => [-1, -1]));
  }

  session.game.set_hands(hands, 0);
  session.game.set_trump_suit(null);
  session.game.set_active_players([0, 1, 2, 3]);
  session.phase = PHASE_NEED_BID;
  if (move.teamMarks) session.team_marks = move.teamMarks;

  // Clear visual state
  shadowLayer.innerHTML = '';
  spriteLayer.innerHTML = '';
  sprites.length        = 0;
  currentTrick          = 0;
  playedThisTrick       = [];
  team1TricksWon        = 0;
  team2TricksWon        = 0;
  zIndexCounter         = 100;
  isAnimating           = false;
  waitingForPlayer1     = false;

  document.getElementById('trumpDisplay').classList.remove('visible');
  for (let h = 5; h <= 6; h++) {
    const el = document.getElementById('playerIndicator' + h);
    if (el) el.style.display = 'none';
  }

  createPlaceholders();
  _buildSprites(hands);

  team1Score = session.game.team_points[0];
  team2Score = session.game.team_points[1];
  team1Marks = session.team_marks[0];
  team2Marks = session.team_marks[1];
  updateScoreDisplay();
  positionPlayerIndicators();

  initBiddingRound();
  if (typeof enableBiddingPreview === 'function') enableBiddingPreview();

  mpSuppressSend = false;
  _runBiddingStep();
}

function _buildSprites(hands) {
  for (let p = 0; p < 4; p++) {
    sprites[p] = [];
    const visualP = mpVisualPlayer(p);
    const pHand   = hands[p] || [];
    for (let h = 0; h < pHand.length; h++) {
      const tile   = pHand[h];
      if (!tile) continue;
      const sprite = makeSprite(tile);
      const pos    = getHandPosition(visualP, h);
      if (!pos) continue;
      sprite.setPose(pos);
      if (sprite._shadow) shadowLayer.appendChild(sprite._shadow);
      spriteLayer.appendChild(sprite);
      sprites[p][h] = { sprite, tile, originalSlot: h };
      if (p === mpSeat) {
        sprite.setFaceUp(true);
        sprite.addEventListener('click', () => handlePlayer1Click(sprite));
        sprite.addEventListener('touchstart', e => {
          e.preventDefault(); e.stopPropagation(); handlePlayer1Click(sprite);
        }, { passive: false });
      } else {
        sprite.setFaceUp(false);
      }
    }
  }
}

// ── Bidding ────────────────────────────────────────────────────────────────

function _runBiddingStep() {
  if (!biddingState) return;
  if (biddingState.currentBidder === mpSeat) {
    session.phase = PHASE_NEED_BID;
    const status  = biddingState.highBid > 0
      ? 'Current bid: ' + biddingState.highBid + ' by ' + getPlayerDisplayName(biddingState.highBidder) + '. Your bid?'
      : 'Your turn to bid.';
    setStatus(status);
    showBidOverlay(true);
    if (typeof triggerHaptic === 'function') triggerHaptic();
    _hideWaiting();
  } else {
    setStatus(getPlayerDisplayName(biddingState.currentBidder) + ' is bidding...');
  }
}

function _onBidConfirmed(move) {
  const visualNum  = seatToVisual(move.seat);
  const displayBid = move.displayBid || ((move.marks > 1) ? (move.marks + 'x') : move.bid);
  setPlaceholderText(visualNum, displayBid, 'bid');

  if (move.biddingDone && move.bidWinner !== null && move.bidWinner !== undefined) {
    session.bid_winner_seat = move.bidWinner;
    session.current_bid     = move.winningBid;
    session.bid_marks       = move.winningMarks;
    if (move.bidWinner === mpSeat) {
      _showTrumpSelect(move.winningBid);
    } else {
      biddingState = null;
      setStatus(getPlayerDisplayName(move.bidWinner) + ' won the bid at ' + move.winningBid + '. Choosing trump...');
    }
    return;
  }

  if (!biddingState) return;
  biddingState.highBid    = move.bid;
  biddingState.highBidder = move.seat;
  biddingState.highMarks  = move.marks || 1;
  if (move.multiplier) { biddingState.inMultiplierMode = true; biddingState.highMultiplier = move.multiplier; }
  biddingState.bids.push({ seat: move.seat, playerNumber: seatToPlayer(move.seat), bid: move.bid });
  session.status = getPlayerDisplayName(move.seat) + ' bids ' + displayBid + '!';
  setStatus(session.status);
  if (move.nextBidder !== null && move.nextBidder !== undefined) {
    biddingState.currentBidder = move.nextBidder;
  } else if (typeof advanceBidding === 'function') {
    advanceBidding();
  }
  _runBiddingStep();
}

function _onPassConfirmed(move) {
  setPlaceholderText(seatToVisual(move.seat), 'Pass', 'pass');

  if (move.biddingDone) {
    if (move.redeal) { setStatus('Everyone passed. Redealing...'); biddingState = null; return; }
    if (move.bidWinner !== null && move.bidWinner !== undefined) {
      session.bid_winner_seat = move.bidWinner;
      session.current_bid     = move.winningBid;
      session.bid_marks       = move.winningMarks;
      if (move.bidWinner === mpSeat) {
        _showTrumpSelect(move.winningBid);
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
  _runBiddingStep();
}

// ── Trump ──────────────────────────────────────────────────────────────────

function _showTrumpSelect(winningBid) {
  if (typeof nelloDeclareMode !== 'undefined' && nelloDeclareMode) {
    _nelloAllowedAtTrump = false;
  } else if (typeof nelloRestrictFirst !== 'undefined' && nelloRestrictFirst && biddingState) {
    const winMarks = biddingState.highMarks || 1;
    if (!biddingState.inMultiplierMode) {
      _nelloAllowedAtTrump = biddingState.highBid < 42 ? winMarks <= 1 : winMarks <= 2;
    } else {
      _nelloAllowedAtTrump = winMarks <= (biddingState.highMultiplier || 1) + 1;
    }
  } else {
    _nelloAllowedAtTrump = true;
  }

  const highBid = winningBid || (biddingState ? biddingState.highBid : session.current_bid);
  setPlaceholderText(seatToVisual(mpSeat), highBid, 'winner');
  if (typeof initOffTracker === 'function') initOffTracker();

  document.getElementById('bidBackdrop').style.display = 'none';
  biddingState  = null;
  session.phase = PHASE_NEED_TRUMP;
  setStatus('You won the bid at ' + highBid + '! Select trump.');
  if (typeof triggerHaptic === 'function') triggerHaptic([50, 50, 100]);
  _hideWaiting();
  showTrumpOverlay(true);
  trumpSelectionActive = true;
  if (typeof enableTrumpDominoClicks === 'function') enableTrumpDominoClicks();
}

function _onTrumpConfirmed(move) {
  session.bid_winner_seat = move.seat;
  session.bid_marks       = move.marks || 1;

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
            sprites[s].forEach(sd => {
              if (sd && sd.sprite) {
                if (sd.sprite._shadow) sd.sprite._shadow.remove();
                sd.sprite.remove();
              }
            });
            sprites[s] = [];
          }
        }
      }
    }
    session.game.leader         = move.seat;
    session.game.current_player = move.firstPlayer || move.seat;
    session.phase               = PHASE_PLAYING;
  } else {
    if (typeof session.set_trump === 'function') {
      session.set_trump(trumpValue);
    } else {
      session.game.set_trump_suit(trumpValue);
      session.phase = PHASE_PLAYING;
    }
    session.game.leader         = move.seat;
    session.game.current_player = move.firstPlayer || move.seat;
  }

  syncSpritesWithGameState();
  if (typeof sortPlayerHandByTrump === 'function') sortPlayerHandByTrump();
  if (typeof sortAllHandsByTrump   === 'function') sortAllHandsByTrump();
  if (typeof flipTilesForTrump     === 'function') flipTilesForTrump();
  if (typeof updateTrumpDisplay    === 'function') updateTrumpDisplay();

  document.getElementById('trumpBackdrop').style.display = 'none';
  trumpSelectionActive = false;
  if (typeof disableTrumpDominoClicks === 'function') disableTrumpDominoClicks();
  if (typeof clearTrumpHighlights     === 'function') clearTrumpHighlights();

  _checkWhoseTurn();
}

// ── Play ───────────────────────────────────────────────────────────────────

async function _onPlayConfirmed(move) {
  console.log('[MP] Play confirmed: seat', move.seat, 'tile:', move.tile);
  _mpLastActivityTime = Date.now();

  if (move.seat === mpSeat) {
    await _playLocal(move);
  } else {
    await _playRemote(move);
  }

  if (move.handComplete && move.handResult) {
    _applyHandResult(move.handResult);
    await new Promise(r => setTimeout(r, 800));
    _showHandEnd();
    return;
  }

  _checkWhoseTurn();
}

async function _playLocal(move) {
  // Sync engine hand
  const hand = session.game.hands[move.seat] || [];
  let gIdx = -1;
  for (let i = 0; i < hand.length; i++) {
    const t = hand[i];
    if ((t[0] === move.tile[0] && t[1] === move.tile[1]) ||
        (t[0] === move.tile[1] && t[1] === move.tile[0])) { gIdx = i; break; }
  }
  session.game.current_trick.push([move.seat, move.tile]);
  if (gIdx >= 0) session.game.hands[move.seat].splice(gIdx, 1);
  if (move.currentPlayer !== undefined) session.game.current_player = move.currentPlayer;

  // Find sprite by tile value
  const seatSprites = sprites[move.seat] || [];
  let sprIdx = -1;
  for (let i = 0; i < seatSprites.length; i++) {
    const sd = seatSprites[i];
    if (sd && sd.tile &&
        ((sd.tile[0] === move.tile[0] && sd.tile[1] === move.tile[1]) ||
         (sd.tile[0] === move.tile[1] && sd.tile[1] === move.tile[0]))) { sprIdx = i; break; }
  }

  isAnimating = true;
  if (sprIdx >= 0) {
    try { await playDomino(move.seat, sprIdx, move.isLead, null, null); }
    catch (e) { console.warn('[MP] playDomino error:', e); }
  }
  isAnimating = false;

  await _handleTrickEnd(move);
}

async function _playRemote(move) {
  // Update engine state
  if (move.tile) session.game.current_trick.push([move.seat, [move.tile[0], move.tile[1]]]);
  if (move.nextPlayer !== undefined && move.nextPlayer !== null) session.game.current_player = move.nextPlayer;
  if (session.game.hands[move.seat]) session.game.hands[move.seat].pop();

  // Find first non-null face-down sprite in opponent's hand
  const opSprites = sprites[move.seat] || [];
  let removedSlot = -1;
  for (let i = 0; i < opSprites.length; i++) {
    if (opSprites[i]) { removedSlot = i; break; }
  }

  isAnimating = true;

  if (move.tile && typeof makeSprite === 'function') {
    const tile      = [move.tile[0], move.tile[1]];
    const newSprite = makeSprite(tile);
    const sprLayer  = document.getElementById('spriteLayer');
    const shLayer   = document.getElementById('shadowLayer');
    if (sprLayer) sprLayer.appendChild(newSprite);
    if (shLayer && newSprite._shadow) shLayer.appendChild(newSprite._shadow);

    const visualP   = mpVisualPlayer(move.seat);
    const startPos  = (removedSlot >= 0) ? getHandPosition(visualP, removedSlot) : null;
    const targetPos = getPlayedPosition(visualP);

    // Remove old face-down sprite
    if (removedSlot >= 0 && opSprites[removedSlot]) {
      const sd = opSprites[removedSlot];
      if (sd.sprite) { if (sd.sprite._shadow) sd.sprite._shadow.remove(); sd.sprite.remove(); }
      opSprites[removedSlot] = null;
    }

    // Start at hand position (face-down), animate to played position (face-up)
    if (startPos) {
      newSprite.setPose({ x: startPos.x, y: startPos.y, s: startPos.s, rz: startPos.rz, ry: startPos.ry });
    } else if (targetPos) {
      newSprite.setPose({ x: targetPos.x, y: targetPos.y - 40, s: targetPos.s, rz: targetPos.rz, ry: 0 });
    }

    bringToFront(newSprite);
    recenterHand(move.seat);

    if (targetPos) {
      await animateSprite(newSprite,
        { x: targetPos.x, y: targetPos.y, s: targetPos.s, rz: targetPos.rz, ry: targetPos.ry }, 350);
      SFX.playDomino();
      if (move.isLead) showLeadDomino(tile);
      playedThisTrick.push({ sprite: newSprite, seat: move.seat, tile });
      updateWinningHighlight();
    }
  } else {
    // No tile info — remove face-down sprite silently
    if (removedSlot >= 0 && opSprites[removedSlot]) {
      const sd = opSprites[removedSlot];
      if (sd.sprite) { if (sd.sprite._shadow) sd.sprite._shadow.remove(); sd.sprite.remove(); }
      opSprites[removedSlot] = null;
    }
  }

  isAnimating = false;
  await _handleTrickEnd(move);
}

async function _handleTrickEnd(move) {
  if (!move.trickComplete) return;

  if (move.trickWinner !== null && move.trickWinner !== undefined) {
    const winTeam = session.game.team_of(move.trickWinner);
    if (!session.game.tricks_team[winTeam]) session.game.tricks_team[winTeam] = [];
    const trickRecord = [];
    for (const play of session.game.current_trick) trickRecord[play[0]] = play[1];
    session.game.tricks_team[winTeam].push(trickRecord);
  }

  if (move.teamPoints) {
    session.game.team_points = move.teamPoints;
    team1Score = move.teamPoints[0];
    team2Score = move.teamPoints[1];
  }

  session.game.trick_number = (session.game.trick_number || 0) + 1;
  if (move.trickWinner !== undefined) session.game.current_player = move.trickWinner;

  await new Promise(r => setTimeout(r, 800));
  await collectToHistory();
  session.game.current_trick = [];
  updateScoreDisplay();
  playedThisTrick = [];
  currentTrick++;
}

function _onPlayRejected(move) {
  if (move.seat !== mpSeat) return;
  console.warn('[MP] Play rejected:', move.reason);
  setStatus('Move rejected: ' + (move.reason || 'Unknown'));
  setTimeout(() => mpSendMove({ action: 'refresh_request', seat: mpSeat }), 1000);
}

// ── Whose Turn ─────────────────────────────────────────────────────────────

function _checkWhoseTurn() {
  if (!MULTIPLAYER_MODE || session.phase !== PHASE_PLAYING) return;
  const cp = session.game.current_player;
  console.log('[MP] Whose turn? cp=' + cp + ' mpSeat=' + mpSeat);

  if (cp === mpSeat) {
    waitingForPlayer1 = true;
    enablePlayer1Clicks();
    updatePlayer1ValidStates();
    if (typeof showHint           === 'function') showHint();
    if (typeof showYourTurnBanner === 'function') showYourTurnBanner();
    setStatus('Trick ' + (session.game.trick_number + 1) + ' - Click a domino to play');
    _hideWaiting();
  } else {
    waitingForPlayer1 = false;
    if (typeof clearPlayer1ValidStates === 'function') clearPlayer1ValidStates();
    setStatus(getPlayerDisplayName(cp) + ' is thinking...');
  }
}

// Public alias for game.js compatibility
function mpCheckWhoseTurn() { _checkWhoseTurn(); }

// ── Game Over / Hand End ───────────────────────────────────────────────────

function _onGameOver(move) {
  const teamMarks = move.teamMarks || [0, 0];
  if (session) session.team_marks = teamMarks;
  if (typeof showGameEndSummary === 'function') {
    showGameEndSummary(teamMarks[mpSeat % 2] >= (mpMarksToWin || 7));
  } else {
    setStatus('Game over! ' + teamMarks[0] + ' - ' + teamMarks[1]);
  }
  mpGameStarted = false;
}

function _applyHandResult(hr) {
  session.game.team_points = hr.teamPoints || [0, 0];
  session.team_marks       = hr.teamMarks  || [0, 0];
  team1Score = session.game.team_points[0];
  team2Score = session.game.team_points[1];
  team1Marks = session.team_marks[0];
  team2Marks = session.team_marks[1];
  session.status = hr.status || 'Hand over';
  setStatus(session.status);
  updateScoreDisplay();
}

function _showHandEnd() {
  if (typeof flipRemainingDominoes === 'function') flipRemainingDominoes();
  if (typeof showHandEndPopup      === 'function') showHandEndPopup();
}

// ── Call Double ────────────────────────────────────────────────────────────

function _onCallDouble(move) {
  if (move.called) {
    if (typeof callForDoubleActive !== 'undefined') callForDoubleActive = true;
    session.game.force_double_trump = true;
    if (typeof applyForcedDoubleGlow === 'function') applyForcedDoubleGlow();
    if (typeof showCallDoubleBanner  === 'function') showCallDoubleBanner();
  } else {
    if (typeof callForDoubleActive !== 'undefined') callForDoubleActive = false;
    session.game.force_double_trump = false;
    if (typeof clearForcedDoubleGlow === 'function') clearForcedDoubleGlow();
  }
}

// ── State Sync (reconnect) ─────────────────────────────────────────────────

function _onStateSync(move) {
  try { _doStateSync(move); } catch (e) {
    console.warn('[MP] State sync crashed:', e);
    mpSuppressSend = false;
    isAnimating    = false;
    setStatus('Sync failed - tap refresh to retry');
  }
}

function _doStateSync(move) {
  const snap = move.snapshot || move;
  if (mpSeat < 0) return;
  console.log('[MP] State sync, phase=' + snap.phase);

  mpSuppressSend = true;
  mpGameStarted  = true;
  document.getElementById('mpBackdrop').style.display = 'none';
  ['bidBackdrop', 'trumpBackdrop', 'nelloDoublesBackdrop', 'dfmChoiceBackdrop'].forEach(id => {
    const el = document.getElementById(id); if (el) el.style.display = 'none';
  });
  _hideWaiting();

  if (!session || session.game.player_count !== 4) {
    session = new SessionV6_4g(4, 6, 7, snap.marksToWin || 7);
  }

  session.dealer          = snap.dealer;
  session.phase           = snap.phase;
  session.bid_winner_seat = snap.bidWinnerSeat;
  session.current_bid     = snap.currentBid;
  session.bid_marks       = snap.bidMarks || 1;
  if (snap.contract)     session.contract           = snap.contract;
  if (snap.teamMarks)    session.team_marks          = snap.teamMarks;
  if (snap.teamPoints)   session.game.team_points    = snap.teamPoints;
  if (snap.trumpSuit   !== undefined) session.game.trump_suit   = snap.trumpSuit;
  if (snap.trumpMode   !== undefined) session.game.trump_mode   = snap.trumpMode;
  if (snap.leader      !== undefined) session.game.leader       = snap.leader;
  if (snap.currentPlayer !== undefined) session.game.current_player = snap.currentPlayer;
  if (snap.trickNumber !== undefined) session.game.trick_number = snap.trickNumber;
  if (snap.activePlayers) session.game.set_active_players(snap.activePlayers);
  if (snap.currentTrick)  session.game.current_trick = snap.currentTrick.map(ct => [ct[0], ct[1]]);

  const myHand    = snap.hand || [];
  const handSizes = snap.handSizes || [];
  const hands     = [];
  for (let i = 0; i < 4; i++) {
    if (i === mpSeat) {
      hands.push(myHand);
    } else {
      const sz = handSizes[i] || 0;
      hands.push(Array.from({ length: sz }, () => [-1, -1]));
    }
  }
  session.game.hands = hands.map(h => (h || []).map(t => [Number(t[0]), Number(t[1])]));

  applyT42Settings();
  shadowLayer.innerHTML = '';
  spriteLayer.innerHTML = '';
  sprites.length        = 0;
  playedThisTrick       = [];
  isAnimating           = false;
  waitingForPlayer1     = false;

  createPlaceholders();
  _buildSprites(session.game.hands);

  team1Score = session.game.team_points[0]; team2Score = session.game.team_points[1];
  team1Marks = session.team_marks[0];       team2Marks = session.team_marks[1];
  updateScoreDisplay();
  positionPlayerIndicators();

  if (session.game.trump_suit !== null || session.game.trump_mode !== 'NONE') {
    syncSpritesWithGameState();
    if (typeof sortPlayerHandByTrump === 'function') sortPlayerHandByTrump();
    if (typeof sortAllHandsByTrump   === 'function') sortAllHandsByTrump();
    if (typeof flipTilesForTrump     === 'function') flipTilesForTrump();
    if (typeof updateTrumpDisplay    === 'function') updateTrumpDisplay();
  }

  mpSuppressSend = false;

  if (session.phase === PHASE_NEED_BID || session.phase === 'NEED_BID') {
    if (snap.currentBidder !== undefined) {
      initBiddingRound();
      biddingState.currentBidder = snap.currentBidder;
      biddingState.highBid       = snap.highBid || 0;
      biddingState.highBidder    = snap.highBidder;
      biddingState.passCount     = snap.passCount || 0;
    }
    _runBiddingStep();
  } else if (session.phase === PHASE_NEED_TRUMP || session.phase === 'NEED_TRUMP') {
    if (session.bid_winner_seat === mpSeat) _showTrumpSelect(session.current_bid);
    else setStatus(getPlayerDisplayName(session.bid_winner_seat) + ' is choosing trump...');
  } else if (session.phase === PHASE_PLAYING || session.phase === 'PLAYING') {
    _checkWhoseTurn();
  }
}

// ── Visual Helpers ─────────────────────────────────────────────────────────

function mpVisualPlayer(seat) {
  const viewSeat = mpObserver ? mpObserverViewSeat : mpSeat;
  return ((seat - viewSeat + session.game.player_count) % session.game.player_count) + 1;
}

function mpIsAI(seat) {
  if (!MULTIPLAYER_MODE || seat === mpSeat) return false;
  return !mpPlayers[seat] || mpPlayers[seat].connected === false;
}

function mpIsRemoteHuman(seat) {
  if (!MULTIPLAYER_MODE) return false;
  if (seat === mpSeat) return true;
  return !!mpPlayers[seat] && mpPlayers[seat].connected !== false;
}

function mpUpdateStatus(text, color) {
  const el = document.getElementById('mpConnStatus');
  if (el) { el.textContent = text; el.style.color = color || '#9ca3af'; }
}

function mpUpdateIndicator() {
  const indicator = document.getElementById('mpIndicator');
  const dot       = document.getElementById('mpDot');
  const statusTxt = document.getElementById('mpStatusText');
  const countTxt  = document.getElementById('mpPlayerCount');
  if (!indicator) return;

  if (mpSeat >= 0 && mpConnected) {
    indicator.style.display = 'flex';
    if (dot)       dot.style.background = '#22c55e';
    if (statusTxt) statusTxt.textContent = mpRoom || 'Connected';
    if (countTxt)  countTxt.textContent  = Object.keys(mpPlayers).length + '/4';
  } else if (mpConnected) {
    indicator.style.display = 'flex';
    if (dot)       dot.style.background = '#f59e0b';
    if (statusTxt) statusTxt.textContent = 'Connecting...';
    if (countTxt)  countTxt.textContent  = '';
  } else {
    if (dot)       dot.style.background = '#ef4444';
    if (statusTxt) statusTxt.textContent = 'Offline';
    if (countTxt)  countTxt.textContent  = '';
  }
}

function mpToggleIndicator() {
  document.getElementById('mpBackdrop').style.display = 'flex';
  if (!mpConnected) mpBuildRoomButtons();
}

function _hideWaiting() {
  const el = document.getElementById('mpWaiting');
  if (el) el.style.display = 'none';
}

function mpShowWaiting(text) { if (text) setStatus(text); }
function mpHideWaiting()     { _hideWaiting(); }

// ── Session Persistence ────────────────────────────────────────────────────

function _generateId() {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghjkmnpqrstuvwxyz23456789';
  return Array.from({ length: 8 }, () => chars[Math.floor(Math.random() * chars.length)]).join('');
}

function _saveSession() {
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
  } catch { return null; }
}

// Public aliases / stubs for game.js compatibility
function mpSaveSession()              { _saveSession(); }
function mpSaveHostState()            {}
function mpMarkHostStateCompleted()   {}
function mpConnectAsObserver()        {}
function mpHandleObserverMessage()    {}
function mpGetGameSnapshot() {
  if (!session || !session.game) return { noSession: true };
  return {
    phase: session.phase, currentPlayer: session.game.current_player,
    trickNumber: session.game.trick_number, mpSeat, mpConnected,
    socketState: mpSocket ? mpSocket.readyState : -1
  };
}
function mpExportDiagLog() { console.log('[MP] Diag log not available in v38.'); }

// ── Lobby UI ───────────────────────────────────────────────────────────────

function _showLobbyReset() {
  document.getElementById('mpConnect').style.display      = '';
  document.getElementById('mpDisconnect').style.display   = 'none';
  document.getElementById('mpPlayerList').style.display   = 'none';
  document.getElementById('mpStartGame').style.display    = 'none';
  document.getElementById('mpHostSettings').style.display = 'none';
  document.getElementById('mpRoomSection').style.display  = '';
  document.getElementById('mpSeatSection').style.display  = 'none';
}

function mpBuildRoomButtons() {
  const roomSection = document.getElementById('mpRoomSection');
  if (roomSection) roomSection.style.display = 'block';
  mpBuildRoomGrid('T42');
  _requestRoomStatus();
}

function _requestRoomStatus() {
  if (mpSocket && mpSocket.readyState === WebSocket.OPEN) {
    try { mpSocket.send(JSON.stringify({ type: 'room_status' })); } catch (e) {}
    return;
  }
  try {
    const tmp = new WebSocket(MP_WS_URL);
    tmp.onopen    = () => { try { tmp.send(JSON.stringify({ type: 'room_status' })); } catch (e) {} };
    tmp.onmessage = (evt) => {
      try {
        const msg = JSON.parse(evt.data);
        if (msg.type === 'room_status') {
          mpRoomCounts = {};
          if (msg.rooms) msg.rooms.forEach(r => {
            mpRoomCounts[r.room] = { count: r.count, max: r.max, observers: r.observers || 0 };
          });
          mpUpdateRoomButtons();
        }
      } catch (e) {}
    };
    tmp.onerror = () => {};
    tmp.onclose = () => {};
    setTimeout(() => { try { if (tmp.readyState <= 1) tmp.close(); } catch (e) {} }, 5000);
  } catch (e) {}
}

function mpBuildRoomGrid(filterMode) {
  const grid = document.getElementById('mpRoomGrid');
  if (!grid) return;
  grid.innerHTML = '';
  MP_ALL_ROOMS.filter(r => r.mode === filterMode).forEach(r => {
    const btn = document.createElement('button');
    btn.dataset.room = r.name;
    btn.dataset.mode = r.mode;
    const rc = mpRoomCounts[r.name] || { count: 0 };
    btn.innerHTML =
      '<div style="font-weight:700;font-size:14px;">' + r.label + '</div>' +
      '<div style="font-size:10px;opacity:0.7;" class="mpRoomCount">' + rc.count + '/4 players</div>';
    btn.style.cssText = 'padding:12px;border:2px solid rgba(255,255,255,0.15);border-radius:10px;background:rgba(255,255,255,0.05);color:#fff;cursor:pointer;transition:all 0.2s;text-align:center;';
    btn.addEventListener('click', () => {
      mpPreferredSeat = -1;
      mpBuildSeatGrid(r.name);
      document.getElementById('mpSeatSection').style.display = '';
    });
    grid.appendChild(btn);
  });
}

function mpUpdateRoomButtons() {
  const grid = document.getElementById('mpRoomGrid');
  if (!grid) return;
  grid.querySelectorAll('button').forEach(btn => {
    const rc      = mpRoomCounts[btn.dataset.room] || { count: 0 };
    const countEl = btn.querySelector('.mpRoomCount');
    if (countEl) countEl.textContent = rc.count + '/4 players';
    btn.style.borderColor = rc.count >= 4 ? '#ef4444' : rc.count > 0 ? '#22c55e' : 'rgba(255,255,255,0.15)';
    btn.style.opacity     = rc.count >= 4 ? '0.6' : '1';
  });
}

function mpBuildSeatGrid(roomName) {
  const grid = document.getElementById('mpSeatGrid');
  if (!grid) return;
  grid.innerHTML = '';

  const defStyle = 'flex:1;padding:10px;border:2px solid rgba(255,255,255,0.15);border-radius:8px;background:rgba(255,255,255,0.05);color:#fff;cursor:pointer;font-size:13px;min-width:60px;';
  const selStyle = 'flex:1;padding:10px;border:2px solid #60a5fa;border-radius:8px;background:rgba(96,165,250,0.2);color:#fff;cursor:pointer;font-size:13px;min-width:60px;';

  const selectBtn = (el) => {
    grid.querySelectorAll('button').forEach(b => { b.style.cssText = defStyle; });
    el.style.cssText = selStyle;
  };

  for (let s = 0; s < 4; s++) {
    const btn = document.createElement('button');
    btn.textContent  = 'Seat ' + (s + 1);
    btn.style.cssText = defStyle;
    btn.addEventListener('click', () => { mpPreferredSeat = s; selectBtn(btn); });
    grid.appendChild(btn);
  }

  const anyBtn = document.createElement('button');
  anyBtn.textContent  = 'Any';
  anyBtn.style.cssText = selStyle; // Default selected
  anyBtn.addEventListener('click', () => { mpPreferredSeat = -1; selectBtn(anyBtn); });
  grid.appendChild(anyBtn);

  grid.dataset.pendingRoom = roomName;
}

function mpRenderPlayerList(players) {
  const container = document.getElementById('mpPlayers');
  if (!container) return;
  container.innerHTML = '';
  for (let s = 0; s < 4; s++) {
    const p   = players[s] || mpPlayers[s];
    const div = document.createElement('div');
    div.style.cssText = 'padding:8px 12px;border-radius:6px;background:rgba(255,255,255,0.05);font-size:13px;display:flex;justify-content:space-between;align-items:center;';
    if (p) {
      const name = p.name || ('Player ' + (s + 1));
      const tag  = s === mpSeat
        ? '<span style="color:#22c55e;font-size:11px;">YOU</span>'
        : (p.connected === false
           ? '<span style="color:#ef4444;font-size:11px;">OFFLINE</span>'
           : '<span style="color:#60a5fa;font-size:11px;">READY</span>');
      div.innerHTML = '<span style="color:#fff;">Seat ' + (s + 1) + ': ' + name + '</span>' + tag;
    } else {
      div.innerHTML = '<span style="color:#6b7280;">Seat ' + (s + 1) + ': (AI)</span><span style="color:#9ca3af;font-size:11px;">bot</span>';
    }
    container.appendChild(div);
  }
  const startBtn     = document.getElementById('mpStartGame');
  const hostSettings = document.getElementById('mpHostSettings');
  if (startBtn)     startBtn.style.display     = (mpSeat === 0) ? '' : 'none';
  if (hostSettings) hostSettings.style.display = (mpSeat === 0) ? '' : 'none';
}

// ── Chat ───────────────────────────────────────────────────────────────────

function _onChat(msg) {
  const chatMessages = document.getElementById('mpChatMessages');
  if (chatMessages) {
    const div  = document.createElement('div');
    div.style.marginBottom = '4px';
    const name = msg.name || ('Seat ' + ((msg.seat !== undefined ? msg.seat : '?') + 1));
    div.innerHTML = '<span style="color:#60a5fa;font-weight:600;">' + name + ':</span> ' + (msg.text || '');
    chatMessages.appendChild(div);
    chatMessages.scrollTop = chatMessages.scrollHeight;
    const badge = document.querySelector('#mpChatIcon .chat-badge');
    const panel = document.getElementById('mpChatPanel');
    if (badge && panel && panel.style.display === 'none') badge.style.display = '';
  }
  mpShowChatBubble(msg.seat, msg.text || '');
}

function _onChatClear() {
  const chatMessages = document.getElementById('mpChatMessages');
  if (chatMessages) chatMessages.innerHTML = '';
}

// Public aliases for game.js compat
function mpHandleChat(msg)   { _onChat(msg); }
function mpHandleChatClear() { _onChatClear(); }

function mpShowChatBubble(seat, text) {
  if (seat === undefined || seat === null || !text) return;
  let visualP;
  try { visualP = mpVisualPlayer(seat); } catch { return; }
  const indicator = document.getElementById('playerIndicator' + visualP);
  if (!indicator) return;
  const existing = document.querySelector('.chatBubble[data-seat="' + seat + '"]');
  if (existing) existing.remove();
  const bubble           = document.createElement('div');
  bubble.className       = 'chatBubble';
  bubble.dataset.seat    = seat;
  bubble.textContent     = text;
  const rect             = indicator.getBoundingClientRect();
  bubble.style.left      = (rect.left + rect.width / 2) + 'px';
  bubble.style.top       = (rect.top - 10) + 'px';
  document.body.appendChild(bubble);
  setTimeout(() => { if (bubble.parentNode) bubble.remove(); }, 4200);
}

function mpShowChatIcon(show) {
  const icon = document.getElementById('mpChatIcon');
  if (icon) icon.style.display = show ? 'flex' : 'none';
}

// ── Lobby Wiring ───────────────────────────────────────────────────────────

(function mpInitLobby() {
  const connectBtn = document.getElementById('mpConnect');
  if (connectBtn) {
    connectBtn.addEventListener('click', () => {
      const seatGrid = document.getElementById('mpSeatGrid');
      const roomName = (seatGrid && seatGrid.dataset.pendingRoom) || 'Tx42room001';
      const saved    = mpLoadSession(roomName);
      if (saved && saved.playerId) mpPlayerId = saved.playerId;
      if (!mpPlayerId) mpPlayerId = _generateId();
      mpConnect(roomName);
    });
  }

  const disconnectBtn = document.getElementById('mpDisconnect');
  if (disconnectBtn) disconnectBtn.addEventListener('click', mpDisconnect);

  const startBtn = document.getElementById('mpStartGame');
  if (startBtn) {
    startBtn.addEventListener('click', () => {
      if (mpSeat !== 0) return;
      let marksToWin   = 7;
      const sel = document.querySelector('.mpMarksBtn.mpMarksSelected');
      if (sel) marksToWin = parseInt(sel.dataset.marks) || 7;
      mpMarksToWin = marksToWin;
      mpSendMove({ action: 'start_game', marksToWin });
    });
  }

  document.querySelectorAll('.mpMarksBtn').forEach(btn => {
    btn.addEventListener('click', () => {
      document.querySelectorAll('.mpMarksBtn').forEach(b => {
        b.classList.remove('mpMarksSelected');
        b.style.borderColor = 'rgba(255,255,255,0.15)';
        b.style.background  = 'rgba(255,255,255,0.05)';
      });
      btn.classList.add('mpMarksSelected');
      btn.style.borderColor = '#60a5fa';
      btn.style.background  = 'rgba(96,165,250,0.2)';
    });
  });

  const closeBtn = document.getElementById('mpCloseBtn');
  if (closeBtn) {
    closeBtn.addEventListener('click', () => {
      document.getElementById('mpBackdrop').style.display = 'none';
    });
  }

  const menuHome = document.getElementById('menuHome');
  if (menuHome) {
    menuHome.addEventListener('click', () => {
      document.getElementById('settingsMenu').style.display = 'none';
      document.getElementById('mpBackdrop').style.display  = 'flex';
      if (!mpConnected) mpBuildRoomButtons();
    });
  }

  const nameConfirmBtn = document.getElementById('nameConfirmBtn');
  if (nameConfirmBtn) {
    nameConfirmBtn.addEventListener('click', () => {
      const input = document.getElementById('nameInput');
      const name  = input ? input.value.trim() : '';
      if (name) {
        playerName = name;
        try {
          localStorage.setItem('tn51_player_name', name);
          localStorage.setItem('tn51_player_noname', 'false');
        } catch (e) {}
        playerNoName = false;
      }
      document.getElementById('nameEntryBackdrop').style.display = 'none';
      document.getElementById('mpBackdrop').style.display = 'flex';
      mpBuildRoomButtons();
    });
  }

  // Chat wiring
  const chatIcon  = document.getElementById('mpChatIcon');
  const chatPanel = document.getElementById('mpChatPanel');
  const chatClose = document.getElementById('mpChatCloseBtn');
  const chatSend  = document.getElementById('mpChatSendBtn');
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
      try {
        mpSocket.send(JSON.stringify({ type: 'chat', text, seat: mpSeat, name: playerName || 'Player' }));
      } catch (e) {}
    }
  }
  if (chatSend)  chatSend.addEventListener('click', sendChat);
  if (chatInput) chatInput.addEventListener('keydown', e => { if (e.key === 'Enter') sendChat(); });

  // Initial display
  try {
    if (!playerName || playerNoName) {
      document.getElementById('nameEntryBackdrop').style.display = 'flex';
    } else {
      document.getElementById('mpBackdrop').style.display = 'flex';
      mpBuildRoomButtons();
    }
  } catch (e) {
    console.warn('[MP] Lobby init error:', e);
    try { document.getElementById('mpBackdrop').style.display = 'flex'; mpBuildRoomButtons(); } catch (e2) {}
  }

  const nameDisplay = document.getElementById('playerNameDisplay');
  if (nameDisplay && playerName) { nameDisplay.textContent = playerName; nameDisplay.style.display = 'block'; }
})();
