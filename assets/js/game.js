// ============================================================
// TX42-Client — Main Game Script
// Stripped-down Texas 42 multiplayer-only client
// Based on TX-Dom-Dev v13.3.0
// ============================================================

// TX42-Client safety: Patch getElementById to avoid null.addEventListener crashes
// Many elements from the original game (start screen, pass&play, etc.) are removed
(function(){
  var _origGetById = document.getElementById.bind(document);
  var _nullProxy = new Proxy({}, {
    get: function(target, prop){
      if(prop === 'addEventListener' || prop === 'removeEventListener'){
        return function(){};
      }
      if(prop === 'style') return {};
      if(prop === 'classList') return { add:function(){}, remove:function(){}, toggle:function(){}, contains:function(){return false;} };
      if(prop === 'querySelectorAll') return function(){ return []; };
      if(prop === 'querySelector') return function(){ return null; };
      if(prop === 'innerHTML' || prop === 'textContent' || prop === 'innerText') return '';
      if(prop === 'value') return '';
      if(prop === 'checked') return false;
      if(prop === 'dataset') return {};
      if(prop === 'children') return [];
      if(prop === 'parentNode' || prop === 'parentElement') return null;
      if(typeof prop === 'string' && prop.startsWith('offset')) return 0;
      return undefined;
    },
    set: function(target, prop, value){ return true; }
  });
  // Elements that exist in our HTML - use real getElementById
  var _existingIds = new Set([
    'viewportWrapper','gameWrapper','topbar','topRow','team1Pill','team1Score','team1Fill',
    'team2Pill','team2Score','team2Fill','marksPill','tallyCanvas1','tallyCanvas2',
    'playerNameDisplay','tableMain','trickHistoryBg','boneyard2Container','boneyard2Canvas',
    'boneyard2Toggle','playerIndicator1','playerIndicator2','playerIndicator3','playerIndicator4',
    'shadowLayer','spriteLayer','statusBar','trumpDisplay','trumpDisplayCanvas','trumpDisplayValue',
    'settingsBtn','settingsMenu','menuNewHand','menuHint','menuBones','menuNotes','menuGameLog',
    'menuSoundSettings','soundSettingsPanel','animSpeedSlider','animSpeedVal','sfxIcon','sfxVolume',
    'bgmIcon','bgmVolume','bgmTrackList','menuHome','menuChangeName','menuAbout','menuClaudeChat',
    'aboutBackdrop','aboutCloseBtn','aboutVersion','claudeChatBackdrop','claudeChatCloseBtn',
    'claudeChatStatus','claudeChatMessages','claudeChatInput','claudeChatSendBtn',
    'bonesBackdrop','bonesCanvas','notesBackdrop','notesCloseBtn','notesTextarea','notesCopyBtn','notesClearBtn',
    'gameLogBackdrop','gameLogCloseBtn','gameLogContent','gameLogCopyBtn',
    'mpIndicator','mpIndicatorDetails','mpStatusText','mpPlayerCount','mpDot',
    'mpBackdrop','mpCloseBtn','mpConnStatus','mpRoomSection','mpRoomGrid',
    'mpSeatSection','mpSeatGrid','mpPlayerList','mpPlayers',
    'mpHostSettings','mpMarksSection','mpHouseRules',
    'mpChkCallForDouble','mpChkNelloDeclare','mpChkNelloRestrict','mpChkChat',
    'mpConnect','mpDisconnect',
    'callDoubleBtnGroup','btnCallDouble','btnPlayRegular',
    'callDoubleBanner','callDoubleBannerBtn',
    'yourTurnBanner',
    'nelloDoublesBackdrop','btnNelloRegular','btnNelloDoublesOnly',
    'dfmChoiceBackdrop','btnDfmYes','btnDfmNo',
    'mpWaiting','mpWaitText','mpWaitSub',
    'syncingOverlay',
    'bidBackdrop','bidHeaderText','bidValueDisplay','bidHintDisplay','bidRangeSlider',
    'bidPassNotch','bid2xNotch','btnBidConfirm','btnNello',
    'trumpBackdrop','trumpCentralDisplay','trumpCentralCanvas','trumpCentralLabel',
    'trumpSlider','trumpSpecialOptions','trumpDoublesBtn','trumpNTBtn','trumpNelloBtn','btnTrumpConfirm',
    'mpChatIcon','mpChatPanel','mpChatCloseBtn','mpChatMessages','mpChatInput','mpChatInputField','mpChatSendBtn',
    'layDownBackdrop','layDownPanel','layDownTiles','layDownActions','btnAcceptLayDown','btnContestLayDown',
    'nameEntryBackdrop','nameInput','nameConfirmBtn'
  ]);
  document.getElementById = function(id){
    var el = _origGetById(id);
    if(el) return el;
    // Return null proxy for missing elements to avoid crashes
    if(!_existingIds.has(id)){
      return _nullProxy;
    }
    return null;
  };
})();

const GAME_VERSION = 'v1.0.0-TX42'; // TX42-Client version

// ============================================================
// Lazy Load Helper — loads JS modules on demand
// ============================================================
function _lazyLoad(src, cb) {
  var existing = document.querySelector('script[src="' + src + '"]');
  if (existing) { if(cb) cb(); return; }
  var s = document.createElement('script');
  s.src = src;
  s.onload = function() { if(cb) cb(); };
  document.head.appendChild(s);
}


// ============================================================
// SECTION 1: Main Game Logic
// ============================================================


// Sound system (SFX) moved to sfx.js


/******************************************************************************
 * DOMINO STYLE SETTINGS - Adjust colors, sizes, and appearance
 ******************************************************************************/

const DOMINO_STYLE = {
  // PIP SIZE - Multiplier for pip dot radius (1 = default, 2 = double size)
  PIP_SCALE: 2.05,

  // DISPLAY PIP SCALE - Separate scale for lead pip, trump display, and trump selector
  // Adjust this to make the pips in these displays larger or smaller (1 = default, 2 = double)
  DISPLAY_PIP_SCALE: 1.5,

  // DOMINO FACE COLORS - 4 states based on highlighted (on/off) and valid (on/off)
  // Highlighted = bright white, Not highlighted = off-white/cream
  // Invalid = pips and center line become more transparent
  FACE: {
    // Highlighted ON (bright white) - used for trump tiles or selected tiles
    HIGHLIGHTED: "rgba(255,255,255,1.0)",
    // Highlighted OFF (off-white/cream) - normal tiles
    NORMAL: "rgba(245,236,221,0.96)",
  },

  // BACK/INSIDE COLORS - also affected by highlight state
  BACK: {
    // Highlighted OFF (tan/cream back)
    NORMAL: "rgba(232,222,205,0.92)",
    // Highlighted ON (slightly whiter)
    HIGHLIGHTED: "rgba(245,240,230,0.95)",
  },

  // EDGE/INSIDE (gray when not highlighted, more yellow/cream when not)
  EDGE: {
    NORMAL: "#d7d7d7",
    HIGHLIGHTED: "#e8e8e8",
  },

  // V12.6: Edge thickness (Z-separation between front/back panels in px)
  EDGE_THICKNESS: 20,

  // INVALID STATE - opacity for pips and center line when tile is invalid/illegal
  INVALID_OPACITY: 0.35,

  // PIP COLORS by pip number (0-7) - 42-style colored pips
  PIP_COLORS: {
    0: "rgba(20,20,22,0.95)",      // black
    1: "rgba(54,178,88,0.98)",     // green
    2: "rgba(240,199,61,0.98)",    // yellow
    3: "rgba(231,76,60,0.98)",     // red
    4: "rgba(0,178,255,0.98)",     // cyan/blue
    5: "rgba(155,89,182,0.98)",    // purple
    6: "rgba(167,110,52,0.98)",    // brown
    7: "rgba(59,130,246,0.98)",    // bright blue
  },

  // BORDER AND CENTER LINE
  BORDER_COLOR: "rgba(0,0,0,0.22)",
  BORDER_WIDTH: 1.4,
  CENTER_LINE_WIDTH: 2,
  CENTER_LINE_COLOR: "rgba(0,0,0,0.22)",

  // BEVEL HIGHLIGHT (inner white stroke for 3D effect)
  BEVEL_OPACITY: 0.40,
  BEVEL_COLOR: "rgba(255,255,255,0.75)",
  BEVEL_WIDTH: 2,

  // DYNAMIC PIPS - ring, highlights, gradient (toggled via menu)
  PIPFX_ENABLED: true,
  PIPFX_RING_WIDTH_RATIO: 0.34,
  PIPFX_RING_OPACITY: 0.06,
  PIPFX_HI1_OPACITY: 0.33,
  PIPFX_HI2_OPACITY: 0.22,
  PIPFX_HI1_SIZE: 0.85,
  PIPFX_HI2_SIZE: 0.24,
  PIPFX_HI1_DX: -0.60,
  PIPFX_HI1_DY: -0.46,
  PIPFX_HI2_DX: -0.12,
  PIPFX_HI2_DY: -0.10,
  PIPFX_HI_LOCK_SCREEN: true,
  PIPFX_GRADIENT: true,

  // FANCY CENTER LINE (toggled via menu)
  FANCY_LINE_ENABLED: true,
  FANCY_LINE_COLOR: "rgba(0,0,0,0.90)",
  CENTER_LINE_HI_COLOR: "rgba(255,255,255,1)",
  CENTER_LINE_HI_OPACITY: 0.45,
  CENTER_LINE_HI_WIDTH_RATIO: 0.40,
  CENTER_LINE_HI_Y_OFFSET_PX: -1.6,
  CENTER_LINE_SH_COLOR: "rgba(0,0,0,1)",
  CENTER_LINE_SH_OPACITY: 0.30,
  CENTER_LINE_SH_WIDTH_RATIO: 0.32,
  CENTER_LINE_SH_Y_OFFSET_PX: 1.6,
};

/******************************************************************************
 * ANIMATION SETTINGS - All timing values in milliseconds
 * Adjust these to change animation behavior
 ******************************************************************************/

// SPEED MULTIPLIER - Affects all animation timings
// 1 = normal speed, 2 = 2x faster, 0.5 = half speed
var SPEED_MULTIPLIER = 2;

const ANIM = {
  // Main animation durations (will be divided by SPEED_MULTIPLIER)
  PLAY_DURATION: 400 / SPEED_MULTIPLIER,           // Time for domino to travel from hand to center
  FLIP_DURATION: 300 / SPEED_MULTIPLIER,           // Time for opponent domino to flip over
  COLLECT_DURATION: 350 / SPEED_MULTIPLIER,        // Time for domino to travel from center to trick history
  HAND_RECENTER_DURATION: 250 / SPEED_MULTIPLIER,  // Time for remaining hand dominoes to slide to center

  // Delays (will be divided by SPEED_MULTIPLIER)
  HAND_RECENTER_DELAY: 150 / SPEED_MULTIPLIER,     // Delay before hand re-centers after domino leaves
  COLLECT_STAGGER: 120 / SPEED_MULTIPLIER,         // Delay between each domino moving to trick history
  OPPONENT_PLAY_DELAY: 300 / SPEED_MULTIPLIER,     // Delay between each opponent playing

  // Easing
  EASING: 'ease-in-out'                            // Animation easing function
};

// V12.6: Animation speed control
var ANIM_BASE = { PLAY_DURATION:400, FLIP_DURATION:300, COLLECT_DURATION:350, HAND_RECENTER_DURATION:250, HAND_RECENTER_DELAY:150, COLLECT_STAGGER:120, OPPONENT_PLAY_DELAY:300 };
function updateAnimSpeed(pct){
  var mult = Math.max(0.25, pct / 100);
  SPEED_MULTIPLIER = mult;
  ANIM.PLAY_DURATION = ANIM_BASE.PLAY_DURATION / mult;
  ANIM.FLIP_DURATION = ANIM_BASE.FLIP_DURATION / mult;
  ANIM.COLLECT_DURATION = ANIM_BASE.COLLECT_DURATION / mult;
  ANIM.HAND_RECENTER_DURATION = ANIM_BASE.HAND_RECENTER_DURATION / mult;
  ANIM.HAND_RECENTER_DELAY = ANIM_BASE.HAND_RECENTER_DELAY / mult;
  ANIM.COLLECT_STAGGER = ANIM_BASE.COLLECT_STAGGER / mult;
  ANIM.OPPONENT_PLAY_DELAY = ANIM_BASE.OPPONENT_PLAY_DELAY / mult;
  try{ localStorage.setItem('tn51_anim_speed', pct); }catch(e){}
}
(function(){ try{ var s=localStorage.getItem('tn51_anim_speed'); updateAnimSpeed(s?parseInt(s):200); }catch(e){ updateAnimSpeed(200); } })();

/******************************************************************************
 * GAME ENGINE - Core game logic from Tennessee 51 v18
 ******************************************************************************/

// Utility functions
function isTile(x){ return Array.isArray(x) && x.length===2 && Number.isInteger(x[0]) && Number.isInteger(x[1]); }
function normalizeTile(x){ if(!isTile(x)) return null; return [Number(x[0]), Number(x[1])]; }
function tileContains(t,p){ return t[0]===p || t[1]===p; }
function allDominoesForSet(maxPip){
  const tiles=[];
  for(let a=0;a<=maxPip;a++) for(let b=0;b<=a;b++) tiles.push([a,b]);
  return tiles;
}
function moonDominoesForSet(){
  // Double-6 set minus all blanks except double-blank (22 tiles)
  const tiles = [];
  for(let a = 0; a <= 6; a++) for(let b = 0; b <= a; b++){
    if((a === 0 || b === 0) && !(a === 0 && b === 0)) continue;
    tiles.push([a, b]);
  }
  return tiles;
}
function shuffleInPlace(arr){
  for(let i=arr.length-1;i>0;i--){
    const j=Math.floor(Math.random()*(i+1));
    [arr[i],arr[j]]=[arr[j],arr[i]];
  }
}
class IllegalMoveError extends Error {}
function lexGreater(a,b){
  for(let i=0;i<Math.max(a.length,b.length);i++){
    const av=(i<a.length)?a[i]:0;
    const bv=(i<b.length)?b[i]:0;
    if(av>bv) return true;
    if(av<bv) return false;
  }
  return false;
}

// Core game state
class GameStateV6_4g{
  constructor(playerCount=6,maxPip=7,handSize=6){
    this.player_count=Number(playerCount);
    this.max_pip=Number(maxPip);
    this.hand_size=Number(handSize);
    this.trump_suit=null;
    this.trump_mode="NONE";
    this.active_players=Array.from({length:this.player_count},(_,i)=>i);
    this.hands=[];
    this.leader=0;
    this.current_player=0;
    this.current_trick=[];
    this.tricks_team = GAME_MODE === 'MOON' ? [[],[],[]] : [[],[]];
    this.team_points = GAME_MODE === 'MOON' ? [0,0,0] : [0,0];
    this.trick_number=0;
    this.nello_doubles_suit=false;
    this.force_double_trump=false;
    this.reset_hand(0);
  }

  reset_hand(leader=0){
    const deck=allDominoesForSet(this.max_pip);
    shuffleInPlace(deck);
    this.hands=[];
    let idx=0;
    for(let p=0;p<this.player_count;p++){
      this.hands.push(deck.slice(idx, idx+this.hand_size));
      idx += this.hand_size;
    }
    this.leader=((Number(leader)%this.player_count)+this.player_count)%this.player_count;
    this.current_player=this.leader;
    if(typeof _trackCpChange==='function') _trackCpChange('reset_hand');
    this.current_trick=[];
    this.tricks_team = GAME_MODE === 'MOON' ? [[],[],[]] : [[],[]];
    this.team_points = GAME_MODE === 'MOON' ? [0,0,0] : [0,0];
    this.trick_number=0;
    this.active_players=Array.from({length:this.player_count},(_,i)=>i);
    this.nello_doubles_suit=false;
    this.force_double_trump=false;
  }

  set_hands(hands, leader=0){
    this.hands = hands.map(h => (h||[]).map(t=>[Number(t[0]),Number(t[1])]));
    this.leader=((Number(leader)%this.player_count)+this.player_count)%this.player_count;
    this.current_player=this.leader;
    if(typeof _trackCpChange==='function') _trackCpChange('set_hands');
    this.current_trick=[];
    this.tricks_team = GAME_MODE === 'MOON' ? [[],[],[]] : [[],[]];
    this.team_points = GAME_MODE === 'MOON' ? [0,0,0] : [0,0];
    this.trick_number=0;
  }

  set_trump_suit(trump){
    if(trump===null||trump===undefined){
      this.trump_suit=null; this.trump_mode="NONE";
    }else if(typeof trump==="string" && trump.toUpperCase()==="DOUBLES"){
      this.trump_suit="DOUBLES"; this.trump_mode="DOUBLES";
    }else{
      this.trump_suit=Number(trump); this.trump_mode="PIP";
    }
  }

  set_active_players(players){
    const valid=(players||[]).map(p=>Number(p)).filter(p=>Number.isFinite(p)&&p>=0&&p<this.player_count);
    this.active_players = valid.length ? valid : Array.from({length:this.player_count},(_,i)=>i);
  }

  team_of(p){ if(GAME_MODE === 'MOON') return Number(p); return Number(p)%2; }

  _is_trump_tile(tile){
    const a=tile[0], b=tile[1];
    if(this.trump_mode==="NONE") return false;
    if(this.trump_mode==="DOUBLES") return a===b;
    return a===this.trump_suit || b===this.trump_suit;
  }

  _is_double(tile){ return tile[0] === tile[1]; }

  _sanitized_trick(){
    const out=[];
    for(const e of Array.from(this.current_trick)){
      const p=Number(e[0]); const nt=normalizeTile(e[1]);
      if(nt) out.push([p,nt]);
    }
    return out;
  }

  _next_active_player(cur){
    let p=Number(cur);
    for(let i=0;i<this.player_count;i++){
      p=(p+1)%this.player_count;
      if(this.active_players.includes(p)) return p;
    }
    return Number(cur);
  }

  _led_suit_for_trick(){
    const trick=this._sanitized_trick();
    if(!trick.length) return null;
    for(const [_p,t] of trick){
      const nt=normalizeTile(t);
      if(!nt) continue;
      // Nello doubles-as-suit mode: doubles are their own suit (-2)
      if(this.nello_doubles_suit && this._is_double(nt)) return -2;
      if(this._is_trump_tile(nt)) return -1;
      return Math.max(nt[0],nt[1]);
    }
    return null;
  }

  legal_indices_for_player(p){
    p=Number(p);
    if(!(p>=0 && p<this.player_count)) return [];
    if(!this.active_players.includes(p)) return [];
    const hand=this.hands[p]||[];
    if(!hand.length) return [];
    const suit=this._led_suit_for_trick();
    if(suit===null) return Array.from({length:hand.length},(_,i)=>i);

    // Doubles suit led (nello doubles-as-suit mode)
    if(suit===-2){
      const dblIdx=[];
      for(let i=0;i<hand.length;i++) if(this._is_double(hand[i])) dblIdx.push(i);
      return dblIdx.length ? dblIdx : Array.from({length:hand.length},(_,i)=>i);
    }

    if(suit===-1){
      const trumpIdx=[];
      for(let i=0;i<hand.length;i++) if(this._is_trump_tile(hand[i])) trumpIdx.push(i);
      // Call for double: force double trump if active
      if(this.force_double_trump){
        const forcedIdx = trumpIdx.filter(i => this._is_double(hand[i]));
        if(forcedIdx.length) return forcedIdx;
      }
      // Doubles Follow Me: when doubles are trump and a double was led
      if(this.trump_mode==="DOUBLES" && typeof _dfmActiveThisHand!=='undefined' && _dfmActiveThisHand){
        const trick=this._sanitized_trick();
        if(trick.length>0){
          const ledTile=trick[0][1];
          if(this._is_double(ledTile)){
            // Tier 1: must play any double if you have one
            const dblIdx=[];
            for(let i=0;i<hand.length;i++) if(this._is_double(hand[i])) dblIdx.push(i);
            if(dblIdx.length) return dblIdx;
            // Tier 2: must play tile containing the led double's pip
            const ledPip=ledTile[0]; // double [n,n] → pip is n
            const pipIdx=[];
            for(let i=0;i<hand.length;i++) if(tileContains(hand[i],ledPip)) pipIdx.push(i);
            if(pipIdx.length) return pipIdx;
            // Tier 3: play anything
            return Array.from({length:hand.length},(_,i)=>i);
          }
        }
      }
      return trumpIdx.length ? trumpIdx : Array.from({length:hand.length},(_,i)=>i);
    }

    const suitIdx=[];
    for(let i=0;i<hand.length;i++){
      const t=hand[i];
      // In nello doubles-as-suit mode, doubles don't follow regular suits
      if(this.nello_doubles_suit && this._is_double(t)) continue;
      if(tileContains(t,Number(suit)) && !this._is_trump_tile(t)) suitIdx.push(i);
    }
    return suitIdx.length ? suitIdx : Array.from({length:hand.length},(_,i)=>i);
  }

  _score_trick_points(record){
    if(GAME_MODE === 'MOON') return 1; // Moon: 1 point per trick, no honors
    let pts=1;
    for(const t of record){
      if(!t) continue;
      const s=t[0]+t[1];
      if(s===5) pts+=5;
      else if(s===10) pts+=10;
    }
    return pts;
  }

  _suit_rank(tile,suit){
    const a=tile[0], b=tile[1], s=Number(suit);
    if(a===s && b===s) return [1,0];
    const other=(a===s)?b:a;
    return [0,Number(other)];
  }

  _trump_rank(tile){
    const a=tile[0], b=tile[1];
    if(this.trump_mode==="DOUBLES"){
      if(a===b) return [1,a];
      return [-1,-1];
    }else if(this.trump_mode==="PIP"){
      const t=Number(this.trump_suit);
      if(a===t && b===t) return [1,0];
      const other=(a===t)?b:a;
      return [0,Number(other)];
    }
    return [-1,-1];
  }

  play_tile(playerIndex, tileIndex){
    const p=Number(playerIndex);
    if(p!==Number(this.current_player)) throw new IllegalMoveError("Not your turn.");
    if(!this.active_players.includes(p)) throw new IllegalMoveError("Player is not active.");
    if(!(p>=0 && p<this.hands.length)) throw new IllegalMoveError("Bad player.");
    const hand=this.hands[p];
    if(!(tileIndex>=0 && tileIndex<hand.length)) throw new IllegalMoveError("Bad index.");
    const legal=this.legal_indices_for_player(p);
    if(!legal.includes(tileIndex)) throw new IllegalMoveError("Must follow suit if possible.");

    let tile=hand.splice(tileIndex,1)[0];
    tile=[Number(tile[0]),Number(tile[1])];
    this.current_trick.push([p,tile]);

    if(this._sanitized_trick().length >= this.active_players.length){
      const winner=this._determine_trick_winner();
      const team=this.team_of(winner);
      const record=Array.from({length:this.player_count},()=>null);
      for(const [pi,t] of this._sanitized_trick()) record[pi]=t;
      this.tricks_team[team].push(record);
      this.team_points[team] += this._score_trick_points(record);

      this.trick_number += 1;
      this.leader=Number(winner);
      this.current_player=Number(winner);
      if(typeof _trackCpChange==='function') _trackCpChange('play-trickWon');
      return [tile, Number(winner), true];
    }

    this.current_player=this._next_active_player(this.current_player);
    if(typeof _trackCpChange==='function') _trackCpChange('play-nextPlayer');
    return [tile, null, false];
  }

  _determine_trick_winner(){
    const trick=this._sanitized_trick();
    if(!trick.length) return Number(this.current_player);

    // Doubles-as-suit mode: if doubles were led, highest double wins
    const ledSuit = this._led_suit_for_trick();
    if(ledSuit === -2){
      let bestP = trick[0][0], bestPip = -1;
      for(const [p,t] of trick){
        if(this._is_double(t) && t[0] > bestPip){ bestPip = t[0]; bestP = p; }
      }
      return Number(bestP);
    }

    const trumps=trick.filter(([_p,t])=>this._is_trump_tile(t));
    if(trumps.length){
      let [bestP,bestT]=trumps[0];
      let bestR=this._trump_rank(bestT);
      for(let i=1;i<trumps.length;i++){
        const [p,t]=trumps[i];
        const r=this._trump_rank(t);
        if(lexGreater(r,bestR)){ bestR=r; bestP=p; }
      }
      return Number(bestP);
    }

    const suit=this._led_suit_for_trick();
    if(suit===null || suit===-1) return Number(trick[0][0]);

    let bestP=trick[0][0];
    let bestR=[-1,-1];
    for(const [p,t] of trick){
      if(!tileContains(t,Number(suit))) continue;
      if(this._is_trump_tile(t)) continue;
      // Nello doubles-as-suit: doubles don't count as pip suit followers
      if(this.nello_doubles_suit && this._is_double(t)) continue;
      const r=this._suit_rank(t,Number(suit));
      if(lexGreater(r,bestR)){ bestR=r; bestP=p; }
    }
    return Number(bestP);
  }

  hand_is_over(){
    let total = 0;
    for(let t = 0; t < this.tricks_team.length; t++) total += this.tricks_team[t].length;
    return total >= this.hand_size;
  }
}

// Game phases
const PHASE_SPLASH="SPLASH";
const PHASE_NEED_BID="NEED_BID";
const PHASE_NEED_TRUMP="NEED_TRUMP";
const PHASE_PLAYING="PLAYING";
const PHASE_HAND_PAUSE="HAND_PAUSE";
const PHASE_MOON_WIDOW="MOON_WIDOW";

// Seat-to-display-player mapping (1:1 mapping - internal matches visual)
// Visual layout: P1(bottom), P2(bottom-left), P3(top-left), P4(top), P5(top-right), P6(bottom-right)
// Seat 0 = P1 (bottom), Seat 1 = P2 (bottom-left), Seat 2 = P3 (top-left),
// Seat 3 = P4 (top), Seat 4 = P5 (top-right), Seat 5 = P6 (bottom-right)
const SEAT_TO_PLAYER_TN51 = [1, 2, 3, 4, 5, 6];
const SEAT_TO_PLAYER_T42 = [1, 2, 3, 4];
const PLAYER_TO_SEAT_TN51 = [null, 0, 1, 2, 3, 4, 5];
const PLAYER_TO_SEAT_T42 = [null, 0, 1, 2, 3];
const SEAT_TO_PLAYER_MOON = [1, 2, 3];
const PLAYER_TO_SEAT_MOON = [null, 0, 1, 2];
function seatToPlayer(seat){
  const map = GAME_MODE === 'MOON' ? SEAT_TO_PLAYER_MOON : (GAME_MODE === 'T42' ? SEAT_TO_PLAYER_T42 : SEAT_TO_PLAYER_TN51);
  return map[seat] || (seat + 1);
}
// Returns the visual player position (for placeholder text, indicators, etc.)
// In multiplayer/PP mode, this accounts for seat rotation
function seatToVisual(seat) {
  if (typeof MULTIPLAYER_MODE !== 'undefined' && MULTIPLAYER_MODE && typeof mpVisualPlayer === 'function') return mpVisualPlayer(seat);
  if (typeof PASS_AND_PLAY_MODE !== 'undefined' && PASS_AND_PLAY_MODE && typeof ppVisualPlayer === 'function') return ppVisualPlayer(seat);
  return seatToPlayer(seat);
}

// Session management
class SessionV6_4g{
  constructor(playerCount=6,maxPip=7,handSize=6,marksToWin=7){
    this.game=new GameStateV6_4g(playerCount,maxPip,handSize);
    this.marks_to_win=Number(marksToWin);
    this.team_marks = GAME_MODE === 'MOON' ? [0,0,0] : [0,0];
    this.phase=PHASE_SPLASH;
    this.status="";
    this.contract="NORMAL";
    this.current_bid=0;
    this.bid_marks=1;
    this.dealer=0;
    this.on_change=null;
  }

  _notify(){ if(typeof this.on_change==="function"){ try{ this.on_change(); }catch(_e){} } }

  start_new_game(){
    this.team_marks = GAME_MODE === 'MOON' ? [0,0,0] : [0,0];
    this.new_hand_random();
  }

  new_hand_random(){
    this.contract="NORMAL";
    this.current_bid=0;
    this.bid_marks=1;

    // Rotate dealer clockwise (to next seat)
    // Clockwise order: 0 -> 1 -> 2 -> 3 -> 4 -> 5 -> 0
    this.dealer = (this.dealer + 1) % this.game.player_count;

    const pool = GAME_MODE === 'MOON' ? moonDominoesForSet() : allDominoesForSet(this.game.max_pip);
    shuffleInPlace(pool);

    const hands=Array.from({length:this.game.player_count},()=>[]);
    let idx=0;
    for(let p=0;p<this.game.player_count;p++){
      hands[p]=pool.slice(idx, idx+this.game.hand_size);
      idx += this.game.hand_size;
    }

    this.game.set_hands(hands, 0);
    // Moon: store widow tile (1 leftover after dealing 3x7=21 from 22)
    if(GAME_MODE === 'MOON' && idx < pool.length){
      this.moon_widow = pool[idx];
      this._widowRevealed = false;
    } else {
      this.moon_widow = null;
    }

    // V12.10.4: Save pre-swap snapshot for Moon replay
    // (widow swap changes hands, but replay needs original dealt state)
    if(GAME_MODE === 'MOON' && this.moon_widow){
      this._dealSnapshot = {
        hands: hands.map(h => h.map(t => [t[0], t[1]])),
        moon_widow: [this.moon_widow[0], this.moon_widow[1]]
      };
    } else {
      this._dealSnapshot = null;
    }

    // V12.10.6: Save dealt hands snapshot for replay (ALL modes)
    // This persists until the next deal, so saveHandForReplay always gets current hand
    this._dealtHands = hands.map(h => h.map(t => [t[0], t[1]]));
    this._dealtDealer = this.dealer;
    // V12.10.7: Save original widow at deal time (persists unlike _dealSnapshot)
    this._dealtWidow = this.moon_widow ? [this.moon_widow[0], this.moon_widow[1]] : null;

    this.game.set_trump_suit(null);
    this.game.set_active_players(Array.from({length:this.game.player_count},(_,i)=>i));

    this.phase=PHASE_NEED_BID;
    this.status="Starting bidding round...";
  }

  set_bid(bidAmount, marks=1){
    this.current_bid=Number(bidAmount);
    this.bid_marks=marks;
    this.phase=PHASE_NEED_TRUMP;
    this.status=`Bid: ${this.current_bid}. Pick trump.`;
    this._notify();
  }

  _sort_my_hand_for_trump(){
    const hand=this.game.hands[0] || [];
    const tmode=this.game.trump_mode;
    const tsuit=this.game.trump_suit;

    function isTrump(tile){
      if(tmode==="NONE") return false;
      if(tmode==="DOUBLES") return tile[0]===tile[1];
      return tile[0]===tsuit || tile[1]===tsuit;
    }
    function trumpStrength(tile){
      const a=tile[0], b=tile[1];
      if(tmode==="DOUBLES"){
        if(a===b) return 100 + a;
        return -1;
      }
      const t=Number(tsuit);
      if(a===t && b===t) return 100;
      if(a===t) return b;
      if(b===t) return a;
      return -1;
    }

    const non=[], tr=[];
    for(const tile of hand){
      if(isTrump(tile)) tr.push(tile);
      else non.push(tile);
    }

    non.sort((x,y)=>{
      const xd=(x[0]===x[1])?1:0, yd=(y[0]===y[1])?1:0;
      if(xd!==yd) return yd-xd;
      const xs=Math.max(x[0],x[1])*10 + Math.min(x[0],x[1]);
      const ys=Math.max(y[0],y[1])*10 + Math.min(y[0],y[1]);
      return ys - xs;
    });

    tr.sort((x,y)=> trumpStrength(y) - trumpStrength(x));
    this.game.hands[0] = non.concat(tr);
  }

  set_trump(trumpChoice){
    const bidderSeat = this.bid_winner_seat !== undefined ? this.bid_winner_seat : 0;

    this.game.leader = bidderSeat;
    this.game.current_player = bidderSeat;
    if(typeof _trackCpChange==='function') _trackCpChange('set_trump(bidder=' + bidderSeat + ')');

    if(typeof trumpChoice==="string"){
      const upper=trumpChoice.toUpperCase().trim();
      if(upper==="NT"){ trumpChoice=null; }
      else if((upper==="NELLO" || upper==="NELLO_2") && GAME_MODE !== 'MOON'){
        this.contract="NELLO";
        // V10_111: bid_marks set from declared marks or biddingState, not nello2xEnabled
        if(_nelloWasDeclared && _nelloDeclaredMarks > 1) this.bid_marks = _nelloDeclaredMarks;
        else if(biddingState && biddingState.highMarks > 1) this.bid_marks = biddingState.highMarks;
        this.game.set_trump_suit(null);
        if (GAME_MODE === 'T42') {
          // T42: bidder vs 2 opponents, partner sits out
          const partnerSeat = (bidderSeat + 2) % 4;
          const activePlayers = [0,1,2,3].filter(s => s !== partnerSeat);
          this.game.set_active_players(activePlayers);
          this.game.hands[partnerSeat] = [];
        } else {
          // TN51: remove 2 players (seats 2 and 4)
          this.game.set_active_players([0,1,3,5]);
          this.game.hands[2]=[];
          this.game.hands[4]=[];
        }
        this.phase=PHASE_PLAYING;
        this.status=`Nel-O: Lose all tricks to win.`;
        this._notify();
        return;
      }else if(upper==="DOUBLES"){
        this.contract="NORMAL";
        this.game.set_trump_suit("DOUBLES");
        this.game.set_active_players(Array.from({length:this.game.player_count},(_,i)=>i));
        this._sort_my_hand_for_trump();
        this.phase=PHASE_PLAYING;
        this.status=`Trump: Doubles. Bid: ${this.current_bid}. Play.`;
        this._notify();
        return;
      }
    }

    this.contract="NORMAL";
    this.game.set_trump_suit(trumpChoice);
    this.game.set_active_players(Array.from({length:this.game.player_count},(_,i)=>i));
    this._sort_my_hand_for_trump();

    this.phase=PHASE_PLAYING;
    const tr=(trumpChoice===null||trumpChoice===undefined) ? "NT" : String(trumpChoice);
    this.status=`Trump: ${tr}. Bid: ${this.current_bid}. Play.`;
    this._notify();
  }

  finishWidowPhase(){
    // Called after widow swap decision (or skip) — transition to trump selection
    this.phase = PHASE_NEED_TRUMP;
    this.status = `Bid: ${this.current_bid}. Pick trump.`;
    this._notify();
  }

  swapWidow(handIndex){
    // Swap a tile from bid winner's hand with the widow
    if(!this.moon_widow) return;
    const bidderSeat = this.bid_winner_seat !== undefined ? this.bid_winner_seat : 0;
    const hand = this.game.hands[bidderSeat];
    if(handIndex < 0 || handIndex >= hand.length) return;
    const old = hand[handIndex];
    hand[handIndex] = this.moon_widow;
    this.moon_widow = old;
    this.finishWidowPhase();
  }

  skipWidow(){
    // Keep hand as-is
    this.finishWidowPhase();
  }

  play(playerIndex, handIndex){
    if(this.phase!==PHASE_PLAYING && this.phase!==PHASE_MOON_WIDOW) throw new IllegalMoveError("Game not in playing phase.");
    if(this.phase===PHASE_MOON_WIDOW) throw new IllegalMoveError("Widow swap in progress.");
    const result=this.game.play_tile(playerIndex, handIndex);
    if(this.contract!=="NELLO") this._check_for_set();
    return result;
  }

  _check_for_set(){
    if(this.contract==="NELLO") return null;
    if(GAME_MODE === 'MOON'){
      // Moon: bidder is set if remaining tricks can't reach bid
      const bidderSeat = this.bid_winner_seat !== undefined ? this.bid_winner_seat : 0;
      const bidderTricks = this.game.tricks_team[bidderSeat].length;
      const tricksRemaining = 7 - this.game.trick_number;
      if(bidderTricks + tricksRemaining < this.current_bid) return "SET";
      return null;
    }
    const bidderSeat = this.bid_winner_seat !== undefined ? this.bid_winner_seat : 0;
    const bidderTeamIndex = (bidderSeat % 2 === 0) ? 0 : 1;

    const bidderPoints = this.game.team_points[bidderTeamIndex];
    const totalPossible = GAME_MODE === 'T42' ? 42 : 51;
    const pointsAwarded = this.game.team_points[0] + this.game.team_points[1];
    const pointsRemaining = totalPossible - pointsAwarded;
    const maxBidderCanGet = bidderPoints + pointsRemaining;
    if(maxBidderCanGet < this.current_bid) return "SET";
    return null;
  }
  _is_set(){ return this._check_for_set()==="SET"; }

  // Check if bid is already made (bidder's team has enough points)
  _is_bid_made(){
    if(this.contract==="NELLO") return false;
    if(GAME_MODE === 'MOON'){
      const bidderSeat = this.bid_winner_seat !== undefined ? this.bid_winner_seat : 0;
      return this.game.tricks_team[bidderSeat].length >= this.current_bid;
    }
    const bidderSeat = this.bid_winner_seat !== undefined ? this.bid_winner_seat : 0;
    const bidderTeamIndex = (bidderSeat % 2 === 0) ? 0 : 1;
    const bidderPoints = this.game.team_points[bidderTeamIndex];
    return bidderPoints >= this.current_bid;
  }

  // Check if Nel-O bidder caught a point (won a trick)
  _nello_caught_point(){
    if(this.contract !== "NELLO") return false;
    const bidderSeat = this.bid_winner_seat !== undefined ? this.bid_winner_seat : 0;
    const bidderTeamIndex = (bidderSeat % 2 === 0) ? 0 : 1;
    const bidderTricks = this.game.tricks_team[bidderTeamIndex].length;
    return bidderTricks > 0;
  }

  maybe_finish_hand(){
    const handComplete=this.game.hand_is_over();

    // Moon: ALWAYS play all 7 tricks, never end early
    if(GAME_MODE === 'MOON'){
      if(!handComplete) return false;
      // Moon scoring: individual, trick-based
      const bidderSeat = this.bid_winner_seat !== undefined ? this.bid_winner_seat : 0;
      const bidderTricks = this.game.tricks_team[bidderSeat].length;
      const bidAmount = this.current_bid;
      const isShootTheMoon = this.moon_shoot || false;

      if(isShootTheMoon){
        if(bidderTricks === 7){
          // Shoot the moon success: +21 points
          this.team_marks[bidderSeat] += 21;
          this.status = `Shoot the Moon! P${bidderSeat+1} took all 7 tricks. +21 points!`;
        } else {
          // Shoot the moon fail: -21 points
          this.team_marks[bidderSeat] -= 21;
          // Other players score their tricks
          for(let s = 0; s < 3; s++){
            if(s !== bidderSeat) this.team_marks[s] += this.game.tricks_team[s].length;
          }
          this.status = `Shoot the Moon failed! P${bidderSeat+1} only took ${bidderTricks}. -21 points!`;
        }
      } else if(bidderTricks >= bidAmount){
        // Bid made: bidder scores their bid amount (capped, not actual tricks), others score their tricks
        this.team_marks[bidderSeat] += bidAmount;
        for(let s = 0; s < 3; s++){
          if(s !== bidderSeat) this.team_marks[s] += this.game.tricks_team[s].length;
        }
        this.status = `Bid made! P${bidderSeat+1} took ${bidderTricks} (bid ${bidAmount}). +${bidAmount} to P${bidderSeat+1}. Others score tricks.`;
      } else {
        // Bid failed: bidder scores 0, others get their tricks + the bid
        for(let s = 0; s < 3; s++){
          if(s !== bidderSeat){
            this.team_marks[s] += this.game.tricks_team[s].length + bidAmount;
          }
        }
        this.status = `Bid failed! P${bidderSeat+1} took ${bidderTricks} (bid ${bidAmount}). Opponents score tricks + ${bidAmount}.`;
      }

      // Check for Moon game winner (first to 21+)
      const maxScore = Math.max(...this.team_marks);
      if(maxScore >= 21){
        const winner = this.team_marks.indexOf(maxScore);
        this.status += ` P${winner+1} wins the game with ${maxScore} points!`;
      }
    } else {
      // T42/TN51 team scoring (original code)
      const isSet=this._is_set();
      const isBidMade=this._is_bid_made();
      const isNelloCaught=this._nello_caught_point();

      // End early if: set, bid already made, Nel-O bidder caught point, or all tricks played
      if(!isSet && !isBidMade && !isNelloCaught && !handComplete) return false;

      const marksAtStake=this.bid_marks;
      const bidderSeat = this.bid_winner_seat !== undefined ? this.bid_winner_seat : 0;
      const bidderTeamIndex = (bidderSeat % 2 === 0) ? 0 : 1;
      const defenderTeamIndex = 1 - bidderTeamIndex;
      const bidderTeamNum = bidderTeamIndex + 1;
      const defenderTeamNum = defenderTeamIndex + 1;
      const bidderPoints = this.game.team_points[bidderTeamIndex];

      if(this.contract==="NELLO"){
        const bidderTricks = this.game.tricks_team[bidderTeamIndex].length;
        if(bidderTricks === 0){
          this.team_marks[bidderTeamIndex] += marksAtStake;
          this.status=`Nel-O success! +${marksAtStake} mark(s) to Team ${bidderTeamNum}.`;
        }else{
          this.team_marks[defenderTeamIndex] += marksAtStake;
          this.status=`Nel-O failed! +${marksAtStake} mark(s) to Team ${defenderTeamNum}.`;
        }
      }else if(isSet){
        this.team_marks[defenderTeamIndex] += marksAtStake;
        this.status=`SET! Bid ${this.current_bid}, only ${bidderPoints} possible. +${marksAtStake} mark(s) to Team ${defenderTeamNum}.`;
      }else{
        if(bidderPoints >= this.current_bid){
          this.team_marks[bidderTeamIndex] += marksAtStake;
          this.status=`Bid made! ${bidderPoints} points scored (needed ${this.current_bid}). +${marksAtStake} mark(s) to Team ${bidderTeamNum}.`;
        }else{
          this.team_marks[defenderTeamIndex] += marksAtStake;
          this.status=`Bid failed! Only ${bidderPoints} points (needed ${this.current_bid}). +${marksAtStake} mark(s) to Team ${defenderTeamNum}.`;
        }
      }

      if(Math.max(this.team_marks[0], this.team_marks[1]) >= this.marks_to_win){
        const winner=(this.team_marks[0] > this.team_marks[1]) ? 0 : 1;
        this.status += ` Team ${winner+1} wins the game!`;
      }
    }

    this.phase=PHASE_HAND_PAUSE;
    this._notify();
    return true;
  }

  snapshot(){
    const g=this.game;
    return {
      hands: g.hands.map(h=>h.map(t=>[t[0],t[1]])),
      current_player:Number(g.current_player),
      current_trick: g.current_trick.map(([p,t])=>[Number(p), [t[0],t[1]]]),
      tricks_team:g.tricks_team,
      team_points:g.team_points.map(Number),
      team_marks:this.team_marks.map(Number),
      marks_to_win:Number(this.marks_to_win),
      trump_suit:g.trump_suit,
      trump_mode:g.trump_mode,
      contract:this.contract,
      phase:this.phase,
      status:this.status,
      current_bid:Number(this.current_bid),
      bid_marks:Number(this.bid_marks),
      dealer:Number(this.dealer),
      bid_winner_seat:this.bid_winner_seat !== undefined ? Number(this.bid_winner_seat) : 0,
      leader:g.leader !== undefined ? Number(g.leader) : 0,
      trick_number:g.trick_number !== undefined ? Number(g.trick_number) : 0,
      active_players:g.active_players ? g.active_players.slice() : Array.from({length: g.player_count}, (_, i) => i),
      moon_widow: this.moon_widow || null,
      moon_shoot: this.moon_shoot || false,
    };
  }
}

// AI functions (evaluateHandForBid, aiChooseTrump, choose_tile_ai) moved to ai-engine.js

// ═══════════════════════════════════════════════════════════════════
//  LAY DOWN HAND: UI and game flow
// ═══════════════════════════════════════════════════════════════════

function checkLayDown() {
  // Called when it becomes the bid winner's turn to lead
  // Only check for the bid winner (they're the one who can lay down)
  if (!session || session.phase !== PHASE_PLAYING) return;
  if (session.contract === 'NELLO') return; // No lay down in Nello
  if (layDownDismissed) return; // Player fully declined this hand
  if (layDownContested) return; // V12.10.21: Hand was contested, play it out

  const bidderSeat = session.bid_winner_seat;
  if (bidderSeat === undefined || bidderSeat === null) return;

  // Only check when it's the bidder's turn to LEAD (not follow)
  const gs = session.game;
  if (gs.current_player !== bidderSeat) return;
  if ((gs.current_trick || []).length > 0) return; // Not leading

  // Must have at least 2 tricks remaining
  const hand = gs.hands[bidderSeat] || [];
  if (hand.length < 2) return;

  const result = detectLayDownHand(gs, bidderSeat);
  if (!result) {
    document.getElementById('layDownBtnGroup').style.display = 'none';
    document.getElementById('layDownMinDot').style.display = 'none';
    layDownState = null;
    layDownMinimized = false;
    return;
  }

  layDownState = result;

  // For human bidder: show button group (or keep dot if minimized)
  const localSeat = getLocalSeat();
  if (bidderSeat === localSeat) {
    if (layDownMinimized) {
      // Already minimized — keep showing the dot, don't pop the group back up
      document.getElementById('layDownMinDot').style.display = 'block';
    } else {
      document.getElementById('layDownBtnGroup').style.display = 'flex';
    }
  } else if (!MULTIPLAYER_MODE) {
    // AI bidder in single player — AI decides to lay down
    aiLayDown(result);
  }
}

function aiLayDown(result) {
  // AI always lays down when it has an unbeatable hand
  showLayDownReveal(result, true);
}

function showLayDownDialog() {
  // Human player clicked "Lay Down" button
  if (!layDownState) return;
  document.getElementById('layDownBtnGroup').style.display = 'none';
  showLayDownReveal(layDownState, false);
}

function showLayDownReveal(result, isAI) {
  const panel = document.getElementById('layDownPanel');
  const title = document.getElementById('layDownTitle');
  const desc = document.getElementById('layDownDesc');
  const tilesDiv = document.getElementById('layDownTiles');
  const backdrop = document.getElementById('layDownBackdrop');
  const acceptBtn = document.getElementById('btnAcceptLayDown');
  const contestBtn = document.getElementById('btnContestLayDown');

  const playerNum = seatToPlayer(result.seat);
  title.textContent = isAI ? `P${playerNum} Lays Down Hand!` : 'Lay Down Hand';
  desc.textContent = result.reason;

  // Show tiles as domino canvas images
  tilesDiv.innerHTML = '';
  for (const t of result.hand) {
    const div = document.createElement('div');
    div.className = 'layDownTile';
    if (session.game._is_trump_tile(t)) div.className += ' trump';
    const cvs = renderDominoCanvas(t, 36, 72);
    cvs.style.cssText = 'display:block;border-radius:4px;';
    div.textContent = '';
    div.appendChild(cvs);
    tilesDiv.appendChild(div);
  }

  // In single player: human opponents can accept or contest
  // AI lays down → show accept/contest to human
  // Human lays down → AI auto-accepts (they know it's unbeatable)
  if (isAI) {
    acceptBtn.style.display = '';
    contestBtn.style.display = '';
  } else {
    // Human laid down — opponents accept automatically (AI knows the hand is unbeatable)
    acceptBtn.style.display = '';
    contestBtn.style.display = 'none';
    acceptBtn.textContent = 'OK';
  }

  backdrop.style.display = 'flex';
}

function acceptLayDown() {
  document.getElementById('layDownBackdrop').style.display = 'none';
  document.getElementById('layDownBtnGroup').style.display = 'none';

  if (!layDownState) return;

  // Award all remaining tricks to the bidder's team
  const bidderTeam = layDownState.seat % 2; // 0 = Team 1 index, 1 = Team 2 index
  const hand = layDownState.hand;

  // V12.10.20: Fix lay-down scoring
  // Remaining tricks = tiles in one player's hand (each trick uses one tile per player)
  const gs = session.game;
  const remainingTricks = (gs.hands[0] || []).length;
  let remainingPoints = 0;

  if (GAME_MODE === 'MOON') {
    // Moon: 1 point per trick only, no count tiles
    remainingPoints = remainingTricks;
  } else {
    // TN51/T42: 1 base point per trick + count tiles (pip sum 5 or 10) from ALL hands
    remainingPoints = remainingTricks;
    for (let s = 0; s < gs.player_count; s++) {
      const h = gs.hands[s] || [];
      for (const t of h) {
        const pipSum = t[0] + t[1];
        if (pipSum === 5) remainingPoints += 5;
        else if (pipSum === 10) remainingPoints += 10;
      }
    }
  }
  gs.team_points[bidderTeam] += remainingPoints;

  // Log the lay down
  logEvent('LAY_DOWN', {
    seat: layDownState.seat,
    player: seatToPlayer(layDownState.seat),
    hand: hand.map(t => t[0] + '-' + t[1]),
    pointsAwarded: remainingPoints,
    accepted: true
  });

  // Clear all hands (tricks are done)
  for (let s = 0; s < gs.player_count; s++) {
    gs.hands[s] = [];
  }

  // Force hand end
  session.status = `P${seatToPlayer(layDownState.seat)} laid down hand! +${remainingPoints} points.`;
  setStatus(session.status);

  layDownState = null;

  // Update scores and show hand end
  team1Score = gs.team_points[0];
  team2Score = gs.team_points[1];
  updateScoreDisplay();

  // Check if the hand/game should end
  if (session.maybe_finish_hand()) {
    team1Marks = session.team_marks[0];
    team2Marks = session.team_marks[1];
    updateScoreDisplay();
    logEvent('HAND_END', { status: session.status });
    autoSave();
    setTimeout(() => showHandEndPopup(), 800);
  } else {
    // Force hand end even if maybe_finish_hand didn't trigger
    // (all tiles are gone, so hand must end)
    team1Marks = session.team_marks[0];
    team2Marks = session.team_marks[1];
    updateScoreDisplay();
    logEvent('HAND_END', { status: session.status, layDown: true });
    autoSave();
    setTimeout(() => showHandEndPopup(), 800);
  }
}

function contestLayDown() {
  document.getElementById('layDownBackdrop').style.display = 'none';
  document.getElementById('layDownBtnGroup').style.display = 'none';

  // Contest = play it out normally
  // Log the contest
  if (layDownState) {
    logEvent('LAY_DOWN_CONTESTED', {
      seat: layDownState.seat,
      player: seatToPlayer(layDownState.seat),
      hand: layDownState.hand.map(t => t[0] + '-' + t[1])
    });
    setStatus('Contest! Playing it out...');
  }
  layDownState = null;
  layDownContested = true; // V12.10.21: prevent re-trigger

  // V12.10.23: Safety — ensure backdrop is definitely hidden after a tick
  setTimeout(function(){
    var bd = document.getElementById('layDownBackdrop');
    if(bd) bd.style.display = 'none';
  }, 50);

  // Resume normal play — the bidder was about to lead, so just continue
  if (MULTIPLAYER_MODE) {
    mpCheckWhoseTurn();
  } else if (PASS_AND_PLAY_MODE) {
    setTimeout(() => maybeAIKick(), 100);
  } else {
    // Single player: if it was AI's turn (bidder is AI), resume AI play
    const bidder = session.bid_winner_seat;
    if (bidder !== 0 && bidder !== undefined) {
      aiPlayTurn();
    } else {
      waitingForPlayer1 = true;
      enablePlayer1Clicks();
      updatePlayer1ValidStates();
      showHint();
    }
  }
}

function dismissLayDown() {
  // Player chose not to lay down — animate to minimized dot
  const group = document.getElementById('layDownBtnGroup');
  const dot = document.getElementById('layDownMinDot');
  const traveler = document.getElementById('layDownTraveler');

  // Get button group's bounding box for animation start
  const groupRect = group.getBoundingClientRect();

  // Hide the group immediately
  group.style.display = 'none';

  // Calculate dot target position (where the dot will appear)
  // dot: left:12px, bottom:18%, size 24x24
  const dotLeft = 12;
  const dotTop = window.innerHeight * 0.82 - 24; // bottom:18% means top = 82% - height
  const dotSize = 24;

  // Set traveler to start at the button group position
  traveler.style.left = groupRect.left + 'px';
  traveler.style.top = groupRect.top + 'px';
  traveler.style.width = groupRect.width + 'px';
  traveler.style.height = groupRect.height + 'px';
  traveler.style.opacity = '1';
  traveler.style.display = 'block';

  // Animate traveler from group position → dot position
  const duration = 600; // ms
  const startTime = performance.now();
  const startX = groupRect.left;
  const startY = groupRect.top;
  const startW = groupRect.width;
  const startH = groupRect.height;
  const endX = dotLeft;
  const endY = dotTop;
  const endW = dotSize;
  const endH = dotSize;

  function animate(now) {
    const elapsed = now - startTime;
    const progress = Math.min(elapsed / duration, 1);
    // Ease out cubic for smooth deceleration
    const ease = 1 - Math.pow(1 - progress, 3);

    const curX = startX + (endX - startX) * ease;
    const curY = startY + (endY - startY) * ease;
    const curW = startW + (endW - startW) * ease;
    const curH = startH + (endH - startH) * ease;

    traveler.style.left = curX + 'px';
    traveler.style.top = curY + 'px';
    traveler.style.width = curW + 'px';
    traveler.style.height = curH + 'px';

    if (progress < 1) {
      requestAnimationFrame(animate);
    } else {
      // Animation complete — hide traveler, show dot
      traveler.style.display = 'none';
      dot.style.display = 'block';
      layDownMinimized = true;
    }
  }
  requestAnimationFrame(animate);
}

function restoreLayDown() {
  // Player clicked the minimized dot — animate back to full button group
  const group = document.getElementById('layDownBtnGroup');
  const dot = document.getElementById('layDownMinDot');
  const traveler = document.getElementById('layDownTraveler');

  if (!layDownState && !layDownMinimized) return;

  // Get dot's bounding box for animation start
  const dotRect = dot.getBoundingClientRect();

  // Hide dot immediately
  dot.style.display = 'none';

  // We need to know where the group will appear to animate toward it
  // Temporarily show group off-screen to measure
  group.style.visibility = 'hidden';
  group.style.display = 'flex';
  const groupRect = group.getBoundingClientRect();
  group.style.display = 'none';
  group.style.visibility = '';

  // Set traveler to start at dot position
  traveler.style.left = dotRect.left + 'px';
  traveler.style.top = dotRect.top + 'px';
  traveler.style.width = dotRect.width + 'px';
  traveler.style.height = dotRect.height + 'px';
  traveler.style.opacity = '1';
  traveler.style.display = 'block';

  const duration = 500;
  const startTime = performance.now();
  const startX = dotRect.left;
  const startY = dotRect.top;
  const startW = dotRect.width;
  const startH = dotRect.height;
  const endX = groupRect.left;
  const endY = groupRect.top;
  const endW = groupRect.width;
  const endH = groupRect.height;

  function animate(now) {
    const elapsed = now - startTime;
    const progress = Math.min(elapsed / duration, 1);
    const ease = 1 - Math.pow(1 - progress, 3);

    const curX = startX + (endX - startX) * ease;
    const curY = startY + (endY - startY) * ease;
    const curW = startW + (endW - startW) * ease;
    const curH = startH + (endH - startH) * ease;

    traveler.style.left = curX + 'px';
    traveler.style.top = curY + 'px';
    traveler.style.width = curW + 'px';
    traveler.style.height = curH + 'px';

    if (progress < 1) {
      requestAnimationFrame(animate);
    } else {
      // Animation complete — hide traveler, show group
      traveler.style.display = 'none';
      group.style.display = 'flex';
      layDownMinimized = false;

      // Re-check if lay down is still valid
      if (!layDownState) {
        const gs = session.game;
        const bidderSeat = session.bid_winner_seat;
        const result = detectLayDownHand(gs, bidderSeat);
        if (result) {
          layDownState = result;
        } else {
          group.style.display = 'none';
          layDownDismissed = true;
        }
      }
    }
  }
  requestAnimationFrame(animate);
}

// ═══════════════════════════════════════════════════════════════════
//  OFF-TRACKER: Tracks the bidder's suspected off tile
// ═══════════════════════════════════════════════════════════════════
let offTracker = null;

function initOffTracker() {
  // Only track when there's a bid winner and it's not Nello
  if (session.bid_winner_seat === undefined || session.bid_winner_seat === null) return;
  if (session.contract === 'NELLO') return;

  const bidderSeat = session.bid_winner_seat;
  const bidderTeam = bidderSeat % 2; // 0 or 1
  const trumpSuit = session.game.trump_suit;
  const trumpMode = session.game.trump_mode;
  const maxPip = session.game.max_pip;
  const playerCount = session.game.player_count;

  // Build initial suspicion map: for each non-trump suit, track suspicion that it's the off suit
  // Higher suspicion = more likely this suit contains the bidder's off tile
  const suitSuspicion = {};
  for (let pip = 0; pip <= maxPip; pip++) {
    // Skip trump suit (bidder won't have offs in trump)
    if (trumpMode === 'PIP' && pip === trumpSuit) continue;
    if (trumpMode === 'NONE') continue; // No trumps = no off tracking needed (all doubles)
    if (trumpMode === 'DOUBLES') continue; // Doubles-as-trump = no standard off
    suitSuspicion[pip] = 50; // Start at 50% (neutral)
  }

  offTracker = {
    bidderSeat: bidderSeat,
    bidderTeam: bidderTeam,
    trumpSuit: trumpSuit,
    trumpMode: trumpMode,
    suitSuspicion: suitSuspicion, // pip → suspicion 0-100
    confirmedVoid: new Set(),     // Suits bidder is confirmed void in (showed void)
    caughtOffs: [],               // Tiles confirmed caught
    tricksAnalyzed: 0,            // How many tricks we've analyzed
    bidderPlays: [],              // Track what bidder played each trick
  };
}

function updateOffTracker() {
  if (!offTracker) return;
  if (!session || !session.game) return;

  const gs = session.game;
  const bidderSeat = offTracker.bidderSeat;
  const trumpSuit = offTracker.trumpSuit;
  const maxPip = gs.max_pip;

  // Analyze all completed tricks
  const allTricks = [];
  for (let team = 0; team < 2; team++) {
    for (let ti = 0; ti < (gs.tricks_team[team] || []).length; ti++) {
      const record = gs.tricks_team[team][ti];
      allTricks.push({ record, team, trickIndex: ti });
    }
  }

  // Sort by trick index to process in order
  // We track which tricks we've already analyzed
  let trickCount = 0;
  for (let team = 0; team < 2; team++) {
    trickCount += (gs.tricks_team[team] || []).length;
  }

  if (trickCount <= offTracker.tricksAnalyzed) return; // Nothing new

  // Re-analyze all tricks (simple approach - recalc from scratch)
  // Reset suspicion to base then re-apply all evidence
  for (const pip in offTracker.suitSuspicion) {
    offTracker.suitSuspicion[pip] = 50;
  }
  offTracker.confirmedVoid = new Set();
  offTracker.bidderPlays = [];

  // Reconstruct trick-by-trick analysis
  // We need to figure out what suit was led each trick and what bidder played
  // tricks_team stores tiles by SEAT index for each trick
  // We need to reconstruct the lead suit for each trick

  // Build ordered trick list with lead info
  const orderedTricks = [];
  for (let team = 0; team < 2; team++) {
    for (const record of (gs.tricks_team[team] || [])) {
      orderedTricks.push(record);
    }
  }

  for (const record of orderedTricks) {
    // Find what was led (first non-null tile played)
    // Unfortunately tricks_team stores by seat, not play order
    // We need to figure out the led suit from the winning team context
    // Simplification: look at what the bidder played vs what others played

    const bidderTile = record[bidderSeat];
    if (!bidderTile) continue;

    offTracker.bidderPlays.push(bidderTile);

    // Rule 1: If bidder leads a non-trump tile, that suit's suspicion DECREASES
    // (bidder wouldn't lead their off suit early)
    // Rule 2: If bidder follows suit with the off-suit tile, suspicion for that suit INCREASES
    // Rule 3: If bidder shows void in a suit (plays trump when suit was led), that suit is eliminated

    const bidderPlayedTrump = gs._is_trump_tile(bidderTile);

    // Check each suit: if ALL other players played suit X but bidder played trump,
    // bidder is void in suit X
    for (let pip = 0; pip <= maxPip; pip++) {
      if (offTracker.trumpMode === 'PIP' && pip === trumpSuit) continue;

      let suitWasLed = false;
      for (let seat = 0; seat < gs.player_count; seat++) {
        if (seat === bidderSeat) continue;
        const tile = record[seat];
        if (!tile) continue;
        if ((tile[0] === pip || tile[1] === pip) && !gs._is_trump_tile(tile)) {
          suitWasLed = true;
          break;
        }
      }

      if (suitWasLed && bidderPlayedTrump) {
        // Bidder is void in this suit → suspicion drops to 0
        // (if bidder has no tiles in this suit, this can't be their off suit)
        if (offTracker.suitSuspicion[pip] !== undefined) {
          offTracker.suitSuspicion[pip] = 0;
          offTracker.confirmedVoid.add(pip);
        }
      }

      if (suitWasLed && !bidderPlayedTrump) {
        // Bidder played a tile in this suit (followed suit or played off-suit)
        const bHigh = Math.max(bidderTile[0], bidderTile[1]);
        const bLow = Math.min(bidderTile[0], bidderTile[1]);

        if (bHigh === pip || bLow === pip) {
          // Bidder followed this suit
          const isDouble = bidderTile[0] === bidderTile[1];
          if (isDouble) {
            // Bidder played a double in this suit → less likely to be the off suit
            // (doubles are winners, bidder would keep them)
            if (offTracker.suitSuspicion[pip] !== undefined) {
              offTracker.suitSuspicion[pip] = Math.max(0, offTracker.suitSuspicion[pip] - 20);
            }
          } else {
            // Bidder played a non-double in this suit → INCREASE suspicion
            // This could be the off tile being forced out!
            if (offTracker.suitSuspicion[pip] !== undefined) {
              offTracker.suitSuspicion[pip] = Math.min(100, offTracker.suitSuspicion[pip] + 25);
            }
          }
        }
      }
    }
  }

  // Rule 4: Suits where the double has been played (by anyone) are LESS likely to be the off suit
  // because the bidder typically has the double that covers their off
  for (let pip = 0; pip <= maxPip; pip++) {
    if (offTracker.suitSuspicion[pip] === undefined) continue;
    // Check if this suit's double has been played
    let doubleFound = false;
    for (let team = 0; team < 2; team++) {
      for (const record of (gs.tricks_team[team] || [])) {
        for (let seat = 0; seat < gs.player_count; seat++) {
          const t = record[seat];
          if (t && t[0] === pip && t[1] === pip) {
            doubleFound = true;
            // Rule 5: If the BIDDER played this double, the off might still be in this suit
            // (bidder leads the double to walk it, then the off is exposed)
            if (seat === bidderSeat) {
              offTracker.suitSuspicion[pip] = Math.min(100, offTracker.suitSuspicion[pip] + 15);
            }
          }
        }
      }
    }
    if (doubleFound && offTracker.suitSuspicion[pip] > 0) {
      // Double was played by someone — if NOT by bidder, suspicion decreases
      // (the cover is gone, if bidder had an off here it would have been caught)
      let bidderPlayedIt = false;
      for (const bp of offTracker.bidderPlays) {
        if (bp[0] === pip && bp[1] === pip) { bidderPlayedIt = true; break; }
      }
      if (!bidderPlayedIt) {
        offTracker.suitSuspicion[pip] = Math.max(0, offTracker.suitSuspicion[pip] - 10);
      }
    }
  }

  offTracker.tricksAnalyzed = trickCount;
}

// Get the most suspected off suit(s) and their suspicion levels
function getOffSuspicion() {
  if (!offTracker) return null;
  const entries = Object.entries(offTracker.suitSuspicion)
    .map(([pip, sus]) => ({ pip: Number(pip), suspicion: sus }))
    .filter(e => e.suspicion > 0)
    .sort((a, b) => b.suspicion - a.suspicion);
  return entries;
}

// Check if a tile in hand might be a "catcher" — can catch the bidder's off
function isCatcherTile(tile, gameState) {
  if (!offTracker) return false;
  if (gameState._is_trump_tile(tile)) return false;

  const suspicion = getOffSuspicion();
  if (!suspicion || suspicion.length === 0) return false;

  const topSuit = suspicion[0];
  if (topSuit.suspicion < 40) return false; // Not suspicious enough

  const tilePips = [tile[0], tile[1]];
  // A catcher is a tile in the suspected off suit that is NOT the double
  // (it can force the bidder to play their off)
  if (tilePips.includes(topSuit.pip) && tile[0] !== tile[1]) {
    return true;
  }
  return false;
}

// ═══════════════════════════════════════════════════════════════════
//  LAY DOWN HAND: Detect unbeatable hands
// ═══════════════════════════════════════════════════════════════════
let layDownState = null;
let layDownDismissed = false;
let layDownContested = false; // V12.10.21: prevent re-trigger after contest
let layDownMinimized = false;

function detectLayDownHand(gameState, seat) {
  // Check if the seat's remaining hand is unbeatable
  // Conditions: all remaining tiles are guaranteed winners
  // - Top consecutive trumps (no higher unplayed trump exists)
  // - Doubles where all higher tiles in that suit are played
  // - Covered offs where the covering double is still in hand

  const hand = gameState.hands[seat] || [];
  if (hand.length === 0) return null;

  const trumpSuit = gameState.trump_suit;
  const trumpMode = gameState.trump_mode;
  const maxPip = gameState.max_pip;

  // Build played set
  const playedSet = new Set();
  for (let team = 0; team < 2; team++) {
    for (const record of (gameState.tricks_team[team] || [])) {
      for (let s = 0; s < gameState.player_count; s++) {
        const t = record[s];
        if (t) playedSet.add(Math.min(t[0], t[1]) + ',' + Math.max(t[0], t[1]));
      }
    }
  }
  // Current trick tiles
  for (const play of (gameState.current_trick || [])) {
    if (!Array.isArray(play)) continue;
    const t = play[1];
    if (t) playedSet.add(Math.min(t[0], t[1]) + ',' + Math.max(t[0], t[1]));
  }
  const isPlayed = (a, b) => playedSet.has(Math.min(a, b) + ',' + Math.max(a, b));

  // Separate hand into trumps and non-trumps
  const trumps = [];
  const nonTrumps = [];
  for (const t of hand) {
    if (gameState._is_trump_tile(t)) trumps.push(t);
    else nonTrumps.push(t);
  }

  // Check trumps: must be the top N consecutive trumps remaining
  // Get all unplayed trumps and rank them
  const allTrumpRanks = [];
  if (trumpMode === 'PIP') {
    // Suit trump: double is highest, then pip-1, pip-2, etc.
    const tp = trumpSuit;
    for (let other = 0; other <= maxPip; other++) {
      const a = Math.min(tp, other), b = Math.max(tp, other);
      if (!isPlayed(a, b)) {
        const inHand = hand.some(h =>
          (Math.min(h[0], h[1]) === a && Math.max(h[0], h[1]) === b));
        const rank = (tp === other) ? maxPip + 1 : other; // double is highest
        allTrumpRanks.push({ a, b, rank, inHand });
      }
    }
  } else if (trumpMode === 'DOUBLES') {
    // Doubles-as-trump: all doubles are trump, ranked by pip
    for (let pip = 0; pip <= maxPip; pip++) {
      if (!isPlayed(pip, pip)) {
        const inHand = hand.some(h => h[0] === pip && h[1] === pip);
        allTrumpRanks.push({ a: pip, b: pip, rank: pip, inHand });
      }
    }
  } else if (trumpMode === 'NONE') {
    // No trumps: doubles are winners of each suit
    // In NT, there are no "trumps" per se, but each double wins its suit
    // A lay-down in NT means all your tiles are doubles or covered offs
    // This is handled differently below
  }

  // Sort by rank descending
  allTrumpRanks.sort((a, b) => b.rank - a.rank);

  // Check that our trumps are the top consecutive ones
  let trumpsOk = true;
  if (trumpMode !== 'NONE' && trumps.length > 0) {
    for (let i = 0; i < trumps.length; i++) {
      if (i >= allTrumpRanks.length || !allTrumpRanks[i].inHand) {
        trumpsOk = false;
        break;
      }
    }
  }

  if (!trumpsOk) return null;

  // Check non-trumps: each must be a guaranteed winner
  // A non-trump is a guaranteed winner if:
  // 1. It's a double and we have enough trumps to pull remaining trumps first, OR
  // 2. It's a covered off (we hold the double of its suit) AND
  //    we can lead the double first to walk it, then the off walks too
  // Simplified: for lay-down, non-trumps must be doubles or offs covered by doubles in hand

  // For NT mode: all tiles must be doubles (NT lay-down = all remaining tiles are doubles)
  if (trumpMode === 'NONE') {
    const allDoubles = hand.every(t => t[0] === t[1]);
    if (!allDoubles) return null;
    return {
      seat: seat,
      hand: hand.slice(),
      trumps: [],
      winningNonTrumps: hand.slice(),
      reason: 'All remaining tiles are doubles (No Trumps)'
    };
  }

  // For suit/doubles trump: non-trumps must be walkable
  const doublesInHand = new Set();
  for (const t of nonTrumps) {
    if (t[0] === t[1]) doublesInHand.add(t[0]);
  }

  const winningNonTrumps = [];
  for (const t of nonTrumps) {
    if (t[0] === t[1]) {
      // It's a double — it wins its suit IF we can lead it
      // (we need trump control to guarantee leading)
      winningNonTrumps.push(t);
    } else {
      // It's a non-double — check if covered by a double in hand
      const highPip = Math.max(t[0], t[1]);
      const lowPip = Math.min(t[0], t[1]);
      if (doublesInHand.has(highPip)) {
        // Covered off — verify ALL higher tiles in this suit are accounted for
        // After we lead the double (highPip-highPip), this off (highPip-lowPip) only walks
        // if no unplayed tile in the highPip-suit outranks it.
        // In suit play, tiles rank by their OTHER pip (non-suit pip is irrelevant for following).
        // Actually in dominoes, when following the highPip suit, any tile with highPip beats
        // tiles based on the OTHER pip. So we need to verify no unplayed highPip-X tile
        // exists where X > lowPip (and it's not in our hand).
        let offIsSafe = true;
        for (let otherPip = lowPip + 1; otherPip <= maxPip; otherPip++) {
          if (otherPip === highPip) continue; // that's the double, we have it
          const a = Math.min(highPip, otherPip), b = Math.max(highPip, otherPip);
          if (!isPlayed(a, b)) {
            // This tile is still unplayed — check if WE have it
            const weHaveIt = hand.some(h =>
              (Math.min(h[0], h[1]) === a && Math.max(h[0], h[1]) === b));
            if (!weHaveIt) {
              offIsSafe = false;
              break;
            }
          }
        }
        if (offIsSafe) {
          winningNonTrumps.push(t);
        } else {
          return null;
        }
      } else {
        // Uncovered off — NOT a guaranteed winner
        return null;
      }
    }
  }

  // Final check: we need enough trumps to pull all opponent trumps
  // Count remaining opponent trumps (trumps not in our hand and not played)
  const oppTrumps = allTrumpRanks.filter(tr => !tr.inHand).length;
  // We need at least as many trumps as remaining opponent trumps to pull them
  // Actually we just need our trumps to be the TOP trumps (already checked above)
  // If our trumps are the top N, we can pull all opponent trumps with N leads

  if (trumps.length === 0 && nonTrumps.length > 0 && trumpMode !== 'NONE') {
    // No trumps but have non-trumps — can only lay down if NO unplayed trumps exist
    if (oppTrumps > 0) return null;
  }

  return {
    seat: seat,
    hand: hand.slice(),
    trumps: trumps.slice(),
    winningNonTrumps: winningNonTrumps,
    reason: trumps.length > 0
      ? `${trumps.length} top trump(s) + ${winningNonTrumps.length} winning non-trump(s)`
      : `All remaining tiles are guaranteed winners`
  };
}


// Global session
let GAME_MODE = 'T42'; // TX42-Client: Always T42
let session = new SessionV6_4g(4, 6, 7, 7);

// Texas 42 Layout — 4 players mapped onto TN51 hex positions
// P1 (bottom) = TN51 P1 + 7th tile
// P3 (top/partner) = TN51 P4 + 7th tile
// P2 (left) = TN51 P4 rotated 90° CCW
// P4 (right) = TN51 P4 rotated 90° CW
const LAYOUT_T42 = {
  "sections": [
    {
      "name": "Trick_History",
      "seed": {"xN": 0.106, "yN": 0.2281, "sizeW": 22, "sizeH": 112, "rz": 270, "ry": 180, "scale": 0.393},
      "grid": {"cols": 4, "rows": 8},
      "tile": [6, 1],
      "dominoes": (function(){
        const d = [];
        const yVals = [0.2281, 0.2592, 0.2904, 0.3215];
        const xVals = [0.106, 0.2171, 0.3282, 0.4393, 0.5504, 0.6616, 0.7727, 0.8838];
        let idx = 0;
        for(let r = 0; r < 8; r++){
          for(let c = 0; c < 4; c++){
            d.push({"col": c, "row": r, "index": idx++, "xN": xVals[r], "yN": yVals[c], "scale": 0.393, "rotZ": 270, "rotY": 180});
          }
        }
        return d;
      })()
    },
    {
      "name": "Player_1_Hand",
      "dominoes": (function(){
        const d = [];
        for(let i = 0; i < 7; i++){
          d.push({"col": i, "row": 0, "index": i, "xN": 0.9 - i * 0.13487, "yN": 0.9, "scale": 1.071, "rotZ": 0, "rotY": 180});
        }
        return d;
      })()
    },
    {
      "name": "Player_1_Played_Domino",
      "dominoes": [{"col": 0, "row": 0, "index": 0, "xN": 0.495, "yN": 0.678, "scale": 0.393, "rotZ": 270, "rotY": 180}]
    },
    {
      "name": "Player_2_Hand",
      "dominoes": (function(){
        const d = [];
        const cy = 0.600, sp = 0.0456, x = 0.165;
        for(let i = 0; i < 7; i++){
          d.push({"col": 0, "row": i, "index": i, "xN": x, "yN": (cy - 3*sp) + i*sp, "scale": 0.393, "rotZ": 270, "rotY": 0});
        }
        return d;
      })()
    },
    {
      "name": "Player_2_Played_Domino",
      "dominoes": [{"col": 0, "row": 0, "index": 0, "xN": 0.380, "yN": 0.600, "scale": 0.393, "rotZ": 270, "rotY": 180}]
    },
    {
      "name": "Player_3_Hand",
      "dominoes": (function(){
        const d = [];
        for(let i = 0; i < 7; i++){
          d.push({"col": i, "row": 0, "index": i, "xN": 0.3282 + i * 0.0556, "yN": 0.411, "scale": 0.393, "rotZ": 180, "rotY": 0});
        }
        return d;
      })()
    },
    {
      "name": "Player_3_Played_Domino",
      "dominoes": [{"col": 0, "row": 0, "index": 0, "xN": 0.495, "yN": 0.522, "scale": 0.393, "rotZ": 270, "rotY": 180}]
    },
    {
      "name": "Player_4_Hand",
      "dominoes": (function(){
        const d = [];
        const cy = 0.600, sp = 0.0456, x = 0.835;
        for(let i = 0; i < 7; i++){
          d.push({"col": 0, "row": i, "index": i, "xN": x, "yN": (cy - 3*sp) + i*sp, "scale": 0.393, "rotZ": 90, "rotY": 0});
        }
        return d;
      })()
    },
    {
      "name": "Player_4_Played_Domino",
      "dominoes": [{"col": 0, "row": 0, "index": 0, "xN": 0.610, "yN": 0.600, "scale": 0.393, "rotZ": 270, "rotY": 180}]
    },
    {
      "name": "Lead_Domino",
      "dominoes": [{"col": 0, "row": 0, "index": 0, "xN": 0.495, "yN": 0.600, "scale": 0.393, "rotZ": 0, "rotY": 180}]
    }
  ],
  "totalDominoes": 28
};

// Moon Layout — 3 players: P1 (bottom), P2 (left), P3 (right)
// Based on T42 but without top player
const LAYOUT_MOON = {
  "sections": [
    {
      "name": "Trick_History",
      "seed": {"xN": 0.106, "yN": 0.05, "sizeW": 22, "sizeH": 112, "rz": 270, "ry": 180, "scale": 0.30},
      "grid": {"cols": 7, "rows": 9, "blocks": 3, "rowsPerBlock": 3, "blockGap": 0.015},
      "dominoes": (function(){
        var d = [];
        var xVals = [0.12, 0.22, 0.32, 0.42, 0.52, 0.62, 0.72];
        var rowSpacing = 0.025;
        var blockGap = 0.015;
        var baseY = 0.05;
        var scale = 0.30;
        var idx = 0;
        for(var block = 0; block < 3; block++){
          var blockBaseY = baseY + block * (3 * rowSpacing + blockGap);
          for(var row = 0; row < 3; row++){
            for(var col = 0; col < 7; col++){
              var yN = blockBaseY + row * rowSpacing;
              d.push({"col": col, "row": row, "block": block, "index": idx++, "xN": xVals[col], "yN": yN, "scale": scale, "rotZ": 270, "rotY": 180});
            }
          }
        }
        return d;
      })()
    },
    {
      "name": "Player_1_Hand",
      "dominoes": (function(){
        var d = [];
        for(var i = 0; i < 7; i++){
          d.push({"col": i, "row": 0, "index": i, "xN": 0.9 - i * 0.13487, "yN": 0.9, "scale": 1.071, "rotZ": 0, "rotY": 180});
        }
        return d;
      })()
    },
    {
      "name": "Player_1_Played_Domino",
      "dominoes": [{"col": 0, "row": 0, "index": 0, "xN": 0.495, "yN": 0.725, "scale": 0.393, "rotZ": 270, "rotY": 180}]
    },
    {
      "name": "Player_2_Hand",
      "dominoes": (function(){
        var d = [];
        var cy = 0.600, sp = 0.0456, x = 0.165;
        for(var i = 0; i < 7; i++){
          d.push({"col": 0, "row": i, "index": i, "xN": x, "yN": (cy - 3*sp) + i*sp, "scale": 0.393, "rotZ": 270, "rotY": 0});
        }
        return d;
      })()
    },
    {
      "name": "Player_2_Played_Domino",
      "dominoes": [{"col": 0, "row": 0, "index": 0, "xN": 0.35, "yN": 0.65, "scale": 0.393, "rotZ": 270, "rotY": 180}]
    },
    {
      "name": "Player_3_Hand",
      "dominoes": (function(){
        var d = [];
        var cy = 0.600, sp = 0.0456, x = 0.835;
        for(var i = 0; i < 7; i++){
          d.push({"col": 0, "row": i, "index": i, "xN": x, "yN": (cy - 3*sp) + i*sp, "scale": 0.393, "rotZ": 90, "rotY": 0});
        }
        return d;
      })()
    },
    {
      "name": "Player_3_Played_Domino",
      "dominoes": [{"col": 0, "row": 0, "index": 0, "xN": 0.63, "yN": 0.65, "scale": 0.393, "rotZ": 270, "rotY": 180}]
    },
    {
      "name": "Lead_Domino",
      "dominoes": [{"col": 0, "row": 0, "index": 0, "xN": 0.495, "yN": 0.600, "scale": 0.393, "rotZ": 0, "rotY": 180}]
    }
  ],
  "totalDominoes": 22
};

const PLACEHOLDER_CONFIG_MOON = {
  dominoWidth: 44,
  dominoHeight: 22,
  leadSize: 28,
  players: {
    1: { xN: 0.495, yN: 0.725 },
    2: { xN: 0.35, yN: 0.65 },
    3: { xN: 0.63, yN: 0.65 }
  },
  lead: { xN: 0.485, yN: 0.65 }
};
// V10_107: Fix #13 — Restore saved Moon placeholder positions
(function(){
  try{
    var d = localStorage.getItem('tn51_moon_placeholders');
    if(!d) return;
    var p = JSON.parse(d);
    if(p.p1x !== undefined) PLACEHOLDER_CONFIG_MOON.players[1].xN = p.p1x;
    if(p.p1y !== undefined) PLACEHOLDER_CONFIG_MOON.players[1].yN = p.p1y;
    if(p.p2x !== undefined) PLACEHOLDER_CONFIG_MOON.players[2].xN = p.p2x;
    if(p.p2y !== undefined) PLACEHOLDER_CONFIG_MOON.players[2].yN = p.p2y;
    if(p.p3x !== undefined) PLACEHOLDER_CONFIG_MOON.players[3].xN = p.p3x;
    if(p.p3y !== undefined) PLACEHOLDER_CONFIG_MOON.players[3].yN = p.p3y;
    if(p.leadX !== undefined) PLACEHOLDER_CONFIG_MOON.lead.xN = p.leadX;
    if(p.leadY !== undefined) PLACEHOLDER_CONFIG_MOON.lead.yN = p.leadY;
  }catch(e){}
})();

function applyMoonSettings(){
  if(GAME_MODE !== 'MOON') return;
  var s = MOON_SETTINGS;
  var L = LAYOUT_MOON.sections;
  // P1 Hand (bottom, horizontal, right-to-left)
  var p1h = L.find(function(x){ return x.name === 'Player_1_Hand'; });
  if(p1h){
    for(var i = 0; i < 7; i++){
      p1h.dominoes[i].xN = s.p1HandX - i * s.p1HandSpacing;
      p1h.dominoes[i].yN = s.p1HandY;
      p1h.dominoes[i].scale = s.p1HandScale;
    }
  }
  // P2 Hand (left, vertical)
  var p2h = L.find(function(x){ return x.name === 'Player_2_Hand'; });
  if(p2h){
    var cy2 = s.p2HandY || 0.600;
    for(var i2 = 0; i2 < 7; i2++){
      p2h.dominoes[i2].xN = s.p2HandX;
      p2h.dominoes[i2].yN = (cy2 - 3*s.p2HandSpacing) + i2*s.p2HandSpacing;
      p2h.dominoes[i2].scale = s.p2HandScale;
    }
  }
  // P3 Hand (right, vertical)
  var p3h = L.find(function(x){ return x.name === 'Player_3_Hand'; });
  if(p3h){
    var cy3 = s.p3HandY || 0.600;
    for(var i3 = 0; i3 < 7; i3++){
      p3h.dominoes[i3].xN = s.p3HandX;
      p3h.dominoes[i3].yN = (cy3 - 3*s.p3HandSpacing) + i3*s.p3HandSpacing;
      p3h.dominoes[i3].scale = s.p3HandScale;
    }
  }
  // Played domino + Lead — use trick scale
  var p1pd = L.find(function(x){ return x.name === 'Player_1_Played_Domino'; });
  if(p1pd) p1pd.dominoes[0].scale = s.trickScale;
  var p2pd = L.find(function(x){ return x.name === 'Player_2_Played_Domino'; });
  if(p2pd) p2pd.dominoes[0].scale = s.trickScale;
  var p3pd = L.find(function(x){ return x.name === 'Player_3_Played_Domino'; });
  if(p3pd) p3pd.dominoes[0].scale = s.trickScale;
  var ld = L.find(function(x){ return x.name === 'Lead_Domino'; });
  if(ld) ld.dominoes[0].scale = s.trickScale;
  // Trick History — rebuild domino positions from settings
  var th = L.find(function(x){ return x.name === 'Trick_History'; });
  if(th){
    var colSp = s.thColSpacing || 0.10;
    var rowSp = s.thRowSpacing || 0.025;
    var blkGap = s.thBlockGap || 0.015;
    var baseX = s.thBaseX || 0.12;
    var baseY = 0.05;
    var thScale = s.thScale || s.trickScale || 0.30;
    var idx = 0;
    for(var blk = 0; blk < 3; blk++){
      var blockBaseY = baseY + blk * (3 * rowSp + blkGap);
      for(var row = 0; row < 3; row++){
        for(var col = 0; col < 7; col++){
          if(th.dominoes[idx]){
            th.dominoes[idx].xN = baseX + col * colSp;
            th.dominoes[idx].yN = blockBaseY + row * rowSp;
            th.dominoes[idx].scale = thScale;
          }
          idx++;
        }
      }
    }
  }
  refreshLayout();
  positionPlayerIndicators();
  if(typeof repositionTrickHistorySprites === 'function') repositionTrickHistorySprites();
}

// T42 Layout Adjustment Settings (live-adjustable)
// TN51 Layout Settings (adjustable via Developer Mode)
let TN51_SETTINGS = {
  p1Scale: 1.071, p1x: 0.9, p1y: 0.9, p1Spacing: 0.1618,
  p2Scale: 0.393, p2x: 0.134, p2y: 0.627, p2Spacing: 0.027,
  p3Scale: 0.393, p3x: 0.134, p3y: 0.572, p3Spacing: 0.027,
  p4Scale: 0.393, p4x: 0.356, p4y: 0.411, p4Spacing: 0.0556,
  p5Scale: 0.393, p5x: 0.86, p5y: 0.572, p5Spacing: 0.027,
  p6Scale: 0.393, p6x: 0.86, p6y: 0.627, p6Spacing: 0.027,
  trickScale: 0.393,
  p2xOff: 0, p3xOff: 0, p5xOff: 0, p6xOff: 0,
  // V12.9.4: Trick positions (per-player played domino X/Y)
  p1TrickX: 0.495, p1TrickY: 0.678,
  p2TrickX: 0.380, p2TrickY: 0.639,
  p3TrickX: 0.380, p3TrickY: 0.561,
  p4TrickX: 0.495, p4TrickY: 0.522,
  p5TrickX: 0.610, p5TrickY: 0.561,
  p6TrickX: 0.610, p6TrickY: 0.639,
  // V12.9.4: Lead domino position
  leadScale: 0.393, leadX: 0.495, leadY: 0.600,
  // V12.9.4: Player indicator positions
  ind1x: 0.50, ind1y: 0.72,
  ind2x: 0.32, ind2y: 0.68,
  ind3x: 0.32, ind3y: 0.52,
  ind4x: 0.50, ind4y: 0.47,
  ind5x: 0.68, ind5y: 0.52,
  ind6x: 0.68, ind6y: 0.68,
  // V12.9.5: Trick history layout
  thScale: 0.393, thBaseX: 0.106, thBaseY: 0.197,
  thRowSpacing: 0.1111, thColSpacing: 0.0311,
};

function applyTn51Settings(){
  if(GAME_MODE !== 'TN51') return;
  const s = TN51_SETTINGS;
  const L = LAYOUT.sections;
  // P1 Hand (bottom, horizontal, right-to-left) — 6 tiles in TN51
  const p1h = L.find(x => x.name === 'Player_1_Hand');
  if(p1h){ for(let i = 0; i < p1h.dominoes.length; i++){ p1h.dominoes[i].xN = s.p1x - i * s.p1Spacing; p1h.dominoes[i].yN = s.p1y; p1h.dominoes[i].scale = s.p1Scale; }}
  // P2 Hand (bottom-left, diagonal 240°)
  const p2h = L.find(x => x.name === 'Player_2_Hand');
  if(p2h){ for(let i = 0; i < p2h.dominoes.length; i++){ p2h.dominoes[i].xN = s.p2x + i * s.p2Spacing + i * (s.p2xOff || 0); p2h.dominoes[i].yN = s.p2y + i * s.p2Spacing; p2h.dominoes[i].scale = s.p2Scale; }}
  // P3 Hand (top-left, diagonal 120°)
  const p3h = L.find(x => x.name === 'Player_3_Hand');
  if(p3h){ for(let i = 0; i < p3h.dominoes.length; i++){ p3h.dominoes[i].xN = s.p3x + i * s.p3Spacing + i * (s.p3xOff || 0); p3h.dominoes[i].yN = s.p3y - i * s.p3Spacing; p3h.dominoes[i].scale = s.p3Scale; }}
  // P4 Hand (top, horizontal, left-to-right)
  const p4h = L.find(x => x.name === 'Player_4_Hand');
  if(p4h){ for(let i = 0; i < p4h.dominoes.length; i++){ p4h.dominoes[i].xN = s.p4x + i * s.p4Spacing; p4h.dominoes[i].yN = s.p4y; p4h.dominoes[i].scale = s.p4Scale; }}
  // P5 Hand (top-right, diagonal 60°)
  const p5h = L.find(x => x.name === 'Player_5_Hand');
  if(p5h){ for(let i = 0; i < p5h.dominoes.length; i++){ p5h.dominoes[i].xN = s.p5x - i * s.p5Spacing - i * (s.p5xOff || 0); p5h.dominoes[i].yN = s.p5y - i * s.p5Spacing; p5h.dominoes[i].scale = s.p5Scale; }}
  // P6 Hand (bottom-right, diagonal 300°)
  const p6h = L.find(x => x.name === 'Player_6_Hand');
  if(p6h){ for(let i = 0; i < p6h.dominoes.length; i++){ p6h.dominoes[i].xN = s.p6x - i * s.p6Spacing - i * (s.p6xOff || 0); p6h.dominoes[i].yN = s.p6y + i * s.p6Spacing; p6h.dominoes[i].scale = s.p6Scale; }}
  // V12.9.4: Played dominos — full X/Y + scale control
  const _tn51TrickNames = ['Player_1_Played_Domino','Player_2_Played_Domino','Player_3_Played_Domino','Player_4_Played_Domino','Player_5_Played_Domino','Player_6_Played_Domino'];
  const _tn51TrickKeys = [
    {x:'p1TrickX',y:'p1TrickY'},{x:'p2TrickX',y:'p2TrickY'},{x:'p3TrickX',y:'p3TrickY'},
    {x:'p4TrickX',y:'p4TrickY'},{x:'p5TrickX',y:'p5TrickY'},{x:'p6TrickX',y:'p6TrickY'}
  ];
  for(let ti=0;ti<6;ti++){
    const sec = L.find(x => x.name === _tn51TrickNames[ti]);
    if(sec){ sec.dominoes[0].xN = s[_tn51TrickKeys[ti].x]; sec.dominoes[0].yN = s[_tn51TrickKeys[ti].y]; sec.dominoes[0].scale = s.trickScale; }
  }
  // V12.9.4: Lead domino position + scale
  const _tn51Lead = L.find(x => x.name === 'Lead_Domino');
  if(_tn51Lead){ _tn51Lead.dominoes[0].xN = s.leadX; _tn51Lead.dominoes[0].yN = s.leadY; _tn51Lead.dominoes[0].scale = s.leadScale; }
  // V12.9.4: Sync PLACEHOLDER_CONFIG
  PLACEHOLDER_CONFIG.players[1].xN = s.p1TrickX; PLACEHOLDER_CONFIG.players[1].yN = s.p1TrickY;
  PLACEHOLDER_CONFIG.players[2].xN = s.p2TrickX; PLACEHOLDER_CONFIG.players[2].yN = s.p2TrickY;
  PLACEHOLDER_CONFIG.players[3].xN = s.p3TrickX; PLACEHOLDER_CONFIG.players[3].yN = s.p3TrickY;
  PLACEHOLDER_CONFIG.players[4].xN = s.p4TrickX; PLACEHOLDER_CONFIG.players[4].yN = s.p4TrickY;
  PLACEHOLDER_CONFIG.players[5].xN = s.p5TrickX; PLACEHOLDER_CONFIG.players[5].yN = s.p5TrickY;
  PLACEHOLDER_CONFIG.players[6].xN = s.p6TrickX; PLACEHOLDER_CONFIG.players[6].yN = s.p6TrickY;
  PLACEHOLDER_CONFIG.lead.xN = s.leadX; PLACEHOLDER_CONFIG.lead.yN = s.leadY;
  // V12.9.5: Rebuild Trick_History from settings
  const _tn51TH = L.find(x => x.name === 'Trick_History');
  if(_tn51TH){
    var _thIdx = 0;
    for(var _thR = 0; _thR < 8; _thR++){
      for(var _thC = 0; _thC < 6; _thC++){
        if(_tn51TH.dominoes[_thIdx]){
          _tn51TH.dominoes[_thIdx].xN = s.thBaseX + _thR * s.thRowSpacing;
          _tn51TH.dominoes[_thIdx].yN = s.thBaseY + _thC * s.thColSpacing;
          _tn51TH.dominoes[_thIdx].scale = s.thScale;
        }
        _thIdx++;
      }
    }
  }
  refreshLayout();
  createPlaceholders();
  positionPlayerIndicators();
  if(typeof repositionTrickHistorySprites === 'function') repositionTrickHistorySprites();
}

let T42_SETTINGS = {
  // Player 1 (bottom - you)
  p1Scale: 0.92,
  p1Spacing: 0.137,
  p1x: 0.905,
  p1y: 0.925,
  // Player 2 (left opponent)
  p2Scale: 0.59,
  p2x: 0.09,
  p2y: 0.65,
  p2Spacing: 0.049,
  // Player 3 (top partner)
  p3Scale: 0.59,
  p3x: 0.235,
  p3y: 0.43,
  p3Spacing: 0.087,
  // Player 4 (right opponent)
  p4Scale: 0.59,
  p4x: 0.905,
  p4y: 0.65,
  p4Spacing: 0.049,
  // Trick area (center played dominoes)
  trickScale: 0.59,
  p1TrickX: 0.495,
  p1TrickY: 0.725,
  p2TrickX: 0.35,
  p2TrickY: 0.65,
  p3TrickX: 0.495,
  p3TrickY: 0.585,
  p4TrickX: 0.63,
  p4TrickY: 0.65,
  leadScale: 0.51,
  leadX: 0.485,
  leadY: 0.65,
  // Player indicators
  ind1x: 0.495, ind1y: 0.80,
  ind2x: 0.215, ind2y: 0.65,
  ind3x: 0.495, ind3y: 0.505,
  ind4x: 0.775, ind4y: 0.65,
  // V12.9.5: Trick history layout
  thScale: 0.393, thBaseX: 0.106, thBaseY: 0.2281,
  thRowSpacing: 0.1111, thColSpacing: 0.0311,
};

// Ghost preview dominos for T42 Layout Settings
var _t42GhostSprites = [];
var _t42GhostTimer = null;

function showT42GhostDominos(){
  removeT42GhostDominos();
  if(GAME_MODE !== 'T42') return;
  const sprLayer = document.getElementById('spriteLayer');
  if(!sprLayer) return;
  const sampleTiles = [[6,6],[5,3],[4,2],[6,1]];
  const positions = [
    {name:'Player_1_Played_Domino'}, {name:'Player_2_Played_Domino'},
    {name:'Player_3_Played_Domino'}, {name:'Player_4_Played_Domino'}
  ];
  for(let i = 0; i < 4; i++){
    const section = getActiveLayout().sections.find(s => s.name === positions[i].name);
    if(!section || !section.dominoes[0]) continue;
    const d = section.dominoes[0];
    const sprite = makeSprite(sampleTiles[i]);
    const px = normToPx(d.xN, d.yN);
    sprite.setPose({x: px.x - 28, y: px.y - 56, s: d.scale, rz: d.rotZ, ry: d.rotY});
    sprite.style.opacity = '0.35';
    sprite.style.pointerEvents = 'none';
    if(sprite._shadow) sprite._shadow.style.opacity = '0.15';
    sprLayer.appendChild(sprite);
    if(sprite._shadow){
      const shLayer = document.getElementById('shadowLayer');
      if(shLayer) shLayer.appendChild(sprite._shadow);
    }
    _t42GhostSprites.push(sprite);
  }
  // Also show lead pip ghost
  const leadSec = getActiveLayout().sections.find(s => s.name === 'Lead_Domino');
  if(leadSec && leadSec.dominoes[0]){
    const ld = leadSec.dominoes[0];
    const lpx = normToPx(ld.xN, ld.yN);
    const leadGhost = document.createElement('div');
    leadGhost.style.cssText = 'position:absolute;width:28px;height:44px;background:rgba(255,255,255,0.2);border:1px solid rgba(255,255,255,0.3);border-radius:4px;pointer-events:none;z-index:50;';
    leadGhost.style.left = (lpx.x - 14) + 'px';
    leadGhost.style.top = (lpx.y - 22) + 'px';
    leadGhost.textContent = 'L';
    leadGhost.style.color = 'rgba(255,255,255,0.4)';
    leadGhost.style.textAlign = 'center';
    leadGhost.style.lineHeight = '44px';
    leadGhost.style.fontSize = '11px';
    document.getElementById('tableMain').appendChild(leadGhost);
    _t42GhostSprites.push(leadGhost);
  }
  // V12.9.5: Indicator position ghosts
  for(let _ip = 1; _ip <= 4; _ip++){
    const _ix = T42_SETTINGS['ind'+_ip+'x'];
    const _iy = T42_SETTINGS['ind'+_ip+'y'];
    const _ipx = normToPx(_ix, _iy);
    const _indG = document.createElement('div');
    _indG.style.cssText = 'position:absolute;width:28px;height:28px;border-radius:50%;background:rgba(96,165,250,0.25);border:1px solid rgba(96,165,250,0.5);pointer-events:none;z-index:50;text-align:center;line-height:28px;font-size:10px;color:rgba(96,165,250,0.7);';
    _indG.style.left = (_ipx.x - 14) + 'px';
    _indG.style.top = (_ipx.y - 14) + 'px';
    _indG.textContent = 'P' + _ip;
    document.getElementById('tableMain').appendChild(_indG);
    _t42GhostSprites.push(_indG);
  }
  // V12.9.6: Trick history — full domino sprites at ALL positions (double blanks)
  const _t42ThSec = getActiveLayout().sections.find(s => s.name === 'Trick_History');
  if(_t42ThSec){
    for(let _gIdx = 0; _gIdx < _t42ThSec.dominoes.length; _gIdx++){
      const _gd = _t42ThSec.dominoes[_gIdx];
      if(!_gd) continue;
      const _thSprite = makeSprite([0,0]);
      const _gpx = normToPx(_gd.xN, _gd.yN);
      _thSprite.setPose({x: _gpx.x - 28, y: _gpx.y - 56, s: _gd.scale, rz: _gd.rotZ, ry: _gd.rotY});
      _thSprite.style.opacity = '0.3';
      _thSprite.style.pointerEvents = 'none';
      if(_thSprite._shadow) _thSprite._shadow.style.opacity = '0.1';
      sprLayer.appendChild(_thSprite);
      if(_thSprite._shadow){
        const _shL = document.getElementById('shadowLayer');
        if(_shL) _shL.appendChild(_thSprite._shadow);
      }
      _t42GhostSprites.push(_thSprite);
    }
  }
}

function removeT42GhostDominos(){
  for(const s of _t42GhostSprites){
    if(s._shadow) s._shadow.remove();
    s.remove();
  }
  _t42GhostSprites = [];
  if(_t42GhostTimer){ clearTimeout(_t42GhostTimer); _t42GhostTimer = null; }
}

function refreshT42Ghosts(){
  // Refresh ghost positions after slider change
  showT42GhostDominos();
}

// V12.9.4: Ghost preview dominos for TN51 Layout Settings
var _tn51GhostSprites = [];
var _tn51GhostTimer = null;

function showTN51GhostDominos(){
  removeTN51GhostDominos();
  if(GAME_MODE !== 'TN51') return;
  const sprLayer = document.getElementById('spriteLayer');
  if(!sprLayer) return;
  const sampleTiles = [[6,6],[5,3],[4,2],[6,1],[3,0],[5,5]];
  const positions = [
    {name:'Player_1_Played_Domino'}, {name:'Player_2_Played_Domino'},
    {name:'Player_3_Played_Domino'}, {name:'Player_4_Played_Domino'},
    {name:'Player_5_Played_Domino'}, {name:'Player_6_Played_Domino'}
  ];
  for(let i = 0; i < 6; i++){
    const section = getActiveLayout().sections.find(s => s.name === positions[i].name);
    if(!section || !section.dominoes[0]) continue;
    const d = section.dominoes[0];
    const sprite = makeSprite(sampleTiles[i]);
    const px = normToPx(d.xN, d.yN);
    sprite.setPose({x: px.x - 28, y: px.y - 56, s: d.scale, rz: d.rotZ, ry: d.rotY});
    sprite.style.opacity = '0.35';
    sprite.style.pointerEvents = 'none';
    if(sprite._shadow) sprite._shadow.style.opacity = '0.15';
    sprLayer.appendChild(sprite);
    if(sprite._shadow){
      const shLayer = document.getElementById('shadowLayer');
      if(shLayer) shLayer.appendChild(sprite._shadow);
    }
    _tn51GhostSprites.push(sprite);
  }
  // Lead pip ghost
  const leadSec = getActiveLayout().sections.find(s => s.name === 'Lead_Domino');
  if(leadSec && leadSec.dominoes[0]){
    const ld = leadSec.dominoes[0];
    const lpx = normToPx(ld.xN, ld.yN);
    const leadGhost = document.createElement('div');
    leadGhost.style.cssText = 'position:absolute;width:28px;height:44px;background:rgba(255,255,255,0.2);border:1px solid rgba(255,255,255,0.3);border-radius:4px;pointer-events:none;z-index:50;';
    leadGhost.style.left = (lpx.x - 14) + 'px';
    leadGhost.style.top = (lpx.y - 22) + 'px';
    leadGhost.textContent = 'L';
    leadGhost.style.color = 'rgba(255,255,255,0.4)';
    leadGhost.style.textAlign = 'center';
    leadGhost.style.lineHeight = '44px';
    leadGhost.style.fontSize = '11px';
    document.getElementById('tableMain').appendChild(leadGhost);
    _tn51GhostSprites.push(leadGhost);
  }
  // V12.9.6: Trick history — full domino sprites at ALL positions (double blanks)
  const _tn51ThSec = getActiveLayout().sections.find(s => s.name === 'Trick_History');
  if(_tn51ThSec){
    for(let _gIdx = 0; _gIdx < _tn51ThSec.dominoes.length; _gIdx++){
      const _gd = _tn51ThSec.dominoes[_gIdx];
      if(!_gd) continue;
      const _thSprite = makeSprite([0,0]);
      const _gpx = normToPx(_gd.xN, _gd.yN);
      _thSprite.setPose({x: _gpx.x - 28, y: _gpx.y - 56, s: _gd.scale, rz: _gd.rotZ, ry: _gd.rotY});
      _thSprite.style.opacity = '0.3';
      _thSprite.style.pointerEvents = 'none';
      if(_thSprite._shadow) _thSprite._shadow.style.opacity = '0.1';
      sprLayer.appendChild(_thSprite);
      if(_thSprite._shadow){
        const _shL = document.getElementById('shadowLayer');
        if(_shL) _shL.appendChild(_thSprite._shadow);
      }
      _tn51GhostSprites.push(_thSprite);
    }
  }
  // Indicator position ghosts (small circles)
  for(let p = 1; p <= 6; p++){
    const ix = TN51_SETTINGS['ind'+p+'x'];
    const iy = TN51_SETTINGS['ind'+p+'y'];
    const ipx = normToPx(ix, iy);
    const indGhost = document.createElement('div');
    indGhost.style.cssText = 'position:absolute;width:28px;height:28px;border-radius:50%;background:rgba(96,165,250,0.25);border:1px solid rgba(96,165,250,0.5);pointer-events:none;z-index:50;text-align:center;line-height:28px;font-size:10px;color:rgba(96,165,250,0.7);';
    indGhost.style.left = (ipx.x - 14) + 'px';
    indGhost.style.top = (ipx.y - 14) + 'px';
    indGhost.textContent = 'P' + p;
    document.getElementById('tableMain').appendChild(indGhost);
    _tn51GhostSprites.push(indGhost);
  }
}

function removeTN51GhostDominos(){
  for(const s of _tn51GhostSprites){
    if(s._shadow) s._shadow.remove();
    s.remove();
  }
  _tn51GhostSprites = [];
  if(_tn51GhostTimer){ clearTimeout(_tn51GhostTimer); _tn51GhostTimer = null; }
}

function refreshTN51Ghosts(){
  showTN51GhostDominos();
}

// V12.9.5: Ghost preview dominos for Moon Layout Settings
var _moonGhostSprites = [];

function showMoonGhostDominos(){
  removeMoonGhostDominos();
  if(GAME_MODE !== 'MOON') return;
  const sprLayer = document.getElementById('spriteLayer');
  if(!sprLayer) return;
  const sampleTiles = [[6,6],[5,3],[4,2]];
  const positions = ['Player_1_Played_Domino','Player_2_Played_Domino','Player_3_Played_Domino'];
  for(let i = 0; i < 3; i++){
    const section = getActiveLayout().sections.find(s => s.name === positions[i]);
    if(!section || !section.dominoes[0]) continue;
    const d = section.dominoes[0];
    const sprite = makeSprite(sampleTiles[i]);
    const px = normToPx(d.xN, d.yN);
    sprite.setPose({x: px.x - 28, y: px.y - 56, s: d.scale, rz: d.rotZ, ry: d.rotY});
    sprite.style.opacity = '0.35';
    sprite.style.pointerEvents = 'none';
    if(sprite._shadow) sprite._shadow.style.opacity = '0.15';
    sprLayer.appendChild(sprite);
    if(sprite._shadow){
      const shLayer = document.getElementById('shadowLayer');
      if(shLayer) shLayer.appendChild(sprite._shadow);
    }
    _moonGhostSprites.push(sprite);
  }
  // Lead ghost
  const leadSec = getActiveLayout().sections.find(s => s.name === 'Lead_Domino');
  if(leadSec && leadSec.dominoes[0]){
    const ld = leadSec.dominoes[0];
    const lpx = normToPx(ld.xN, ld.yN);
    const leadGhost = document.createElement('div');
    leadGhost.style.cssText = 'position:absolute;width:28px;height:44px;background:rgba(255,255,255,0.2);border:1px solid rgba(255,255,255,0.3);border-radius:4px;pointer-events:none;z-index:50;';
    leadGhost.style.left = (lpx.x - 14) + 'px';
    leadGhost.style.top = (lpx.y - 22) + 'px';
    leadGhost.textContent = 'L';
    leadGhost.style.color = 'rgba(255,255,255,0.4)';
    leadGhost.style.textAlign = 'center';
    leadGhost.style.lineHeight = '44px';
    leadGhost.style.fontSize = '11px';
    document.getElementById('tableMain').appendChild(leadGhost);
    _moonGhostSprites.push(leadGhost);
  }
  // Indicator ghosts
  for(let p = 1; p <= 3; p++){
    const ix = MOON_SETTINGS['ind'+p+'x'];
    const iy = MOON_SETTINGS['ind'+p+'y'];
    const ipx = normToPx(ix, iy);
    const indGhost = document.createElement('div');
    indGhost.style.cssText = 'position:absolute;width:28px;height:28px;border-radius:50%;background:rgba(96,165,250,0.25);border:1px solid rgba(96,165,250,0.5);pointer-events:none;z-index:50;text-align:center;line-height:28px;font-size:10px;color:rgba(96,165,250,0.7);';
    indGhost.style.left = (ipx.x - 14) + 'px';
    indGhost.style.top = (ipx.y - 14) + 'px';
    indGhost.textContent = 'P' + p;
    document.getElementById('tableMain').appendChild(indGhost);
    _moonGhostSprites.push(indGhost);
  }
  // V12.9.6: Trick history — full domino sprites at ALL positions (double blanks)
  const _moonThSec = getActiveLayout().sections.find(s => s.name === 'Trick_History');
  if(_moonThSec){
    var _mThXOff = (MOON_SETTINGS.trickHistoryX || 0) / 100;
    var _mThYOff = (MOON_SETTINGS.trickHistoryY || 0) / 100;
    var _mThScale = MOON_SETTINGS.thScale || MOON_SETTINGS.trickScale || 0.30;
    for(let _gIdx = 0; _gIdx < _moonThSec.dominoes.length; _gIdx++){
      const _gd = _moonThSec.dominoes[_gIdx];
      if(!_gd) continue;
      const _thSprite = makeSprite([0,0]);
      const _gpx = normToPx(_gd.xN + _mThXOff, _gd.yN + _mThYOff);
      _thSprite.setPose({x: _gpx.x - 28, y: _gpx.y - 56, s: _mThScale, rz: _gd.rotZ, ry: _gd.rotY});
      _thSprite.style.opacity = '0.3';
      _thSprite.style.pointerEvents = 'none';
      if(_thSprite._shadow) _thSprite._shadow.style.opacity = '0.1';
      sprLayer.appendChild(_thSprite);
      if(_thSprite._shadow){
        const _shL = document.getElementById('shadowLayer');
        if(_shL) _shL.appendChild(_thSprite._shadow);
      }
      _moonGhostSprites.push(_thSprite);
    }
  }
}

function removeMoonGhostDominos(){
  for(const s of _moonGhostSprites){
    if(s._shadow) s._shadow.remove();
    s.remove();
  }
  _moonGhostSprites = [];
}

function refreshMoonGhosts(){
  showMoonGhostDominos();
}

function applyT42Settings(){
  if(GAME_MODE !== 'T42') return;
  const s = T42_SETTINGS;
  const L = LAYOUT_T42.sections;
  // P1 Hand (bottom, horizontal)
  const p1h = L.find(x => x.name === 'Player_1_Hand');
  if(p1h){
    for(let i = 0; i < 7; i++){
      p1h.dominoes[i].xN = s.p1x - i * s.p1Spacing;
      p1h.dominoes[i].yN = s.p1y;
      p1h.dominoes[i].scale = s.p1Scale;
    }
  }
  // P2 Hand (left, vertical)
  const p2h = L.find(x => x.name === 'Player_2_Hand');
  if(p2h){
    for(let i = 0; i < 7; i++){
      p2h.dominoes[i].xN = s.p2x;
      p2h.dominoes[i].yN = (s.p2y - 3*s.p2Spacing) + i*s.p2Spacing;
      p2h.dominoes[i].scale = s.p2Scale;
    }
  }
  // P3 Hand (top, horizontal)
  const p3h = L.find(x => x.name === 'Player_3_Hand');
  if(p3h){
    for(let i = 0; i < 7; i++){
      p3h.dominoes[i].xN = s.p3x + i * s.p3Spacing + i * (s.p3xOff || 0);
      p3h.dominoes[i].yN = s.p3y;
      p3h.dominoes[i].scale = s.p3Scale;
    }
  }
  // P4 Hand (right, vertical)
  const p4h = L.find(x => x.name === 'Player_4_Hand');
  if(p4h){
    for(let i = 0; i < 7; i++){
      p4h.dominoes[i].xN = s.p4x;
      p4h.dominoes[i].yN = (s.p4y - 3*s.p4Spacing) + i*s.p4Spacing;
      p4h.dominoes[i].scale = s.p4Scale;
    }
  }
  // Played domino placeholders — full X/Y control
  const p1pd = L.find(x => x.name === 'Player_1_Played_Domino');
  if(p1pd){ p1pd.dominoes[0].xN = s.p1TrickX; p1pd.dominoes[0].yN = s.p1TrickY; p1pd.dominoes[0].scale = s.trickScale; }
  const p2pd = L.find(x => x.name === 'Player_2_Played_Domino');
  if(p2pd){ p2pd.dominoes[0].xN = s.p2TrickX; p2pd.dominoes[0].yN = s.p2TrickY; p2pd.dominoes[0].scale = s.trickScale; }
  const p3pd = L.find(x => x.name === 'Player_3_Played_Domino');
  if(p3pd){ p3pd.dominoes[0].xN = s.p3TrickX; p3pd.dominoes[0].yN = s.p3TrickY; p3pd.dominoes[0].scale = s.trickScale; }
  const p4pd = L.find(x => x.name === 'Player_4_Played_Domino');
  if(p4pd){ p4pd.dominoes[0].xN = s.p4TrickX; p4pd.dominoes[0].yN = s.p4TrickY; p4pd.dominoes[0].scale = s.trickScale; }
  // Lead domino — full position + scale
  const ld = L.find(x => x.name === 'Lead_Domino');
  if(ld){ ld.dominoes[0].xN = s.leadX; ld.dominoes[0].yN = s.leadY; ld.dominoes[0].scale = s.leadScale; }
  // Update placeholder config
  PLACEHOLDER_CONFIG_T42.players[1].xN = s.p1TrickX;
  PLACEHOLDER_CONFIG_T42.players[1].yN = s.p1TrickY;
  PLACEHOLDER_CONFIG_T42.players[2].xN = s.p2TrickX;
  PLACEHOLDER_CONFIG_T42.players[2].yN = s.p2TrickY;
  PLACEHOLDER_CONFIG_T42.players[3].xN = s.p3TrickX;
  PLACEHOLDER_CONFIG_T42.players[3].yN = s.p3TrickY;
  PLACEHOLDER_CONFIG_T42.players[4].xN = s.p4TrickX;
  PLACEHOLDER_CONFIG_T42.players[4].yN = s.p4TrickY;
  PLACEHOLDER_CONFIG_T42.lead.xN = s.leadX;
  PLACEHOLDER_CONFIG_T42.lead.yN = s.leadY;
  // V12.9.5: Rebuild Trick_History from settings
  const _t42TH = L.find(x => x.name === 'Trick_History');
  if(_t42TH){
    var _thIdx = 0;
    for(var _thR = 0; _thR < 8; _thR++){
      for(var _thC = 0; _thC < 4; _thC++){
        if(_t42TH.dominoes[_thIdx]){
          _t42TH.dominoes[_thIdx].xN = s.thBaseX + _thR * s.thRowSpacing;
          _t42TH.dominoes[_thIdx].yN = s.thBaseY + _thC * s.thColSpacing;
          _t42TH.dominoes[_thIdx].scale = s.thScale;
        }
        _thIdx++;
      }
    }
  }
  // Refresh
  refreshLayout();
  createPlaceholders();
  positionPlayerIndicators();
  if(typeof repositionTrickHistorySprites === 'function') repositionTrickHistorySprites();
}

// T42 placeholder positions
const PLACEHOLDER_CONFIG_T42 = {
  dominoWidth: 44,
  dominoHeight: 22,
  leadSize: 28,
  players: {
    1: { xN: 0.495, yN: 0.725 },
    2: { xN: 0.35, yN: 0.65 },
    3: { xN: 0.495, yN: 0.585 },
    4: { xN: 0.63, yN: 0.65 }
  },
  lead: { xN: 0.485, yN: 0.65 }
};

// Helper: get current layout based on game mode
function getActiveLayout(){ return GAME_MODE === 'MOON' ? LAYOUT_MOON : (GAME_MODE === 'T42' ? LAYOUT_T42 : LAYOUT); }
function getActivePlaceholderConfig(){ return GAME_MODE === 'MOON' ? PLACEHOLDER_CONFIG_MOON : (GAME_MODE === 'T42' ? PLACEHOLDER_CONFIG_T42 : PLACEHOLDER_CONFIG); }

function initGameMode(mode){
  GAME_MODE = mode;
  if(mode === 'MOON'){
    session = new SessionV6_4g(3, 6, 7, 21); // 3 players, double-6, 7 tiles, 21 points to win
    PLAY_ORDER = [1, 2, 3];
    applyMoonSettings();
  } else if(mode === 'T42'){
    session = new SessionV6_4g(4, 6, 7, 7);
    PLAY_ORDER = [1, 2, 3, 4];
    applyT42Settings();
  } else {
    session = new SessionV6_4g(6, 7, 6, 7);
    PLAY_ORDER = [1, 2, 3, 4, 5, 6];
  }
}
let PASS_AND_PLAY_MODE = false; // TX42-Client: Not used

// MP globals — declared here so they're available before multiplayer.js loads
// Functions and protocol logic are in multiplayer.js
let MULTIPLAYER_MODE = true; // TX42-Client: Always multiplayer
let mpSocket = null;
let mpRoom = null;
let mpSeat = -1;
let mpIsHost = false;
let mpPlayers = {};
let mpConnected = false;
let mpGameStarted = false;
let mpWaitingForRemote = false;
let _mpLastActivityTime = Date.now();
let _syncInProgress = false;
let _queuedSync = null;
let mpSuppressSend = false;
let mpPlayerId = null;
let mpPlayerIds = {};
let mpMarksToWin = 7;
let mpPreferredSeat = -1;
let mpHelloNonce = null;
let mpObserver = false;
let mpObserverViewSeat = 0;
let mpRoomCounts = {};
let mpStatusRequested = false;
let _staleRefreshCount = 0;
let mpGamesWon = 0;
let mpGamesLost = 0;
let mpGamesPlayed = 0;


// Player name system (V10_78)
// V10_122e: Wrap localStorage in try-catch for iOS Safari private mode
let playerName = '';
let playerNoName = false;
try {
  playerName = localStorage.getItem('tn51_player_name') || '';
  playerNoName = localStorage.getItem('tn51_player_noname') === 'true';
} catch(e) {
  console.warn('[iOS] localStorage read error (private mode?):', e);
}
// V10_111: nello2xEnabled removed — use nelloRestrictFirst instead
let nelloDeclareMode = false;
let nelloRestrictFirst = true;
try {
  nelloDeclareMode = localStorage.getItem('tn51_nello_declare') === 'true';  // Must declare Nello
  nelloRestrictFirst = localStorage.getItem('tn51_nello_restrict_first') !== 'false';  // Nello restricted to 1x first (default true)
} catch(e) {
  console.warn('[iOS] localStorage read error (private mode?):', e);
}
let _nelloWasDeclared = false;  // V10_111: Track whether Nello was declared during bidding (persists until trump selection)
let _nelloDeclaredMarks = 1;    // V10_111: The marks value when Nello was declared
let _nelloAllowedAtTrump = true; // V10_111: Whether Nello button should appear at trump selection (computed at end of bidding)

const AI_NAMES = [
  'Alex T.','Sam B.','Casey M.','Jordan R.','Taylor H.','Morgan L.','Riley K.','Drew P.',
  'Jamie W.','Quinn D.','Blake S.','Avery N.','Parker F.','Skyler C.','Rowan G.','Sage J.',
  'Reese A.','Finley O.','Hayden V.','Dakota U.','Emery I.','Lennox Z.','Charlie B.','Frankie M.',
  'Harley T.','Jesse W.','Kendall R.','Lane S.','Micah P.','Nico H.','Oakley L.','Pat D.',
  'Robin F.','Shawn K.','Tracy G.','Val J.','Whitney N.','Addison C.','Blair A.','Carmen O.',
  'Dallas V.','Eden U.','Flynn I.','Gray Z.','Harper B.','Indigo M.','Jules T.','Kit W.',
  'Logan R.','Marlo S.','Noel P.','Ollie H.','Piper L.','Reed D.','Sloane F.','Tatum K.',
  'Umber G.','Vance J.','Wren N.','Xander C.','Yael A.','Zion O.','Aspen V.','Briar U.',
  'Cruz I.','Darcy Z.','Ellis B.','Fern M.','Glenn T.','Haven W.','Ira R.','Jade S.',
  'Kai P.','Lark H.','Monroe L.','Navy D.','Onyx F.','Phoenix K.','Remy G.','Scout J.',
  'Teagan N.','Uri C.','Vesper A.','Winter O.','Yara V.','Zen U.','Arden I.','Bodhi Z.',
  'Cleo B.','Devin M.','Ember T.','Greer W.','Hollis R.','Ivy S.','Jude P.','Koda H.',
  'Lyric L.','Milan D.','Nyx F.','Orion K.'
];

// Assign AI names (shuffled) per session
let _aiNamePool = [];
function getAIName() {
  if (_aiNamePool.length === 0) {
    _aiNamePool = AI_NAMES.slice();
    for (let i = _aiNamePool.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [_aiNamePool[i], _aiNamePool[j]] = [_aiNamePool[j], _aiNamePool[i]];
    }
  }
  return _aiNamePool.pop() || 'AI';
}

function getPlayerDisplayName(seat) {
  // Returns display name for status bar: "John P." for named player, "P2" for unnamed
  // V10_113: Check MP remote player names
  if(MULTIPLAYER_MODE && mpPlayers && mpPlayers[seat] && mpPlayers[seat].name) {
    var mpName = mpPlayers[seat].name;
    // Skip generic names like "Player 2"
    if(!/^Player \d/.test(mpName)) {
      var parts = mpName.trim().split(/\s+/);
      if(parts.length >= 2) return parts[0] + ' ' + parts[1][0] + '.';
      return mpName;
    }
  }
  // Local player (seat 0 in SP, mpSeat in MP)
  var localSeat = MULTIPLAYER_MODE ? mpSeat : 0;
  if(seat === localSeat && playerName && !playerNoName){
    var parts = playerName.trim().split(/\s+/);
    if(parts.length >= 2) return parts[0] + ' ' + parts[1][0] + '.';
    return playerName;
  }
  return 'P' + seatToPlayer(seat);
}

function getPlayerInitials(name) {
  if (!name) return '?';
  const parts = name.trim().split(/\s+/);
  if (parts.length >= 2) return (parts[0][0] + parts[1][0]).toUpperCase();
  return name.substring(0, 2).toUpperCase();
}

function promptForName() {
  // V12: Legacy wrapper — just show the inline edit on start screen
  updateScreenNameUI();
  const editDiv = document.getElementById('screenNameEdit');
  const dispDiv = document.getElementById('screenNameDisplay');
  if(editDiv) editDiv.style.display = 'block';
  if(dispDiv) dispDiv.style.display = 'none';
  const inp = document.getElementById('screenNameInput');
  if(inp) inp.focus();
}

// V12: Update the inline screen name section on the start screen
function updateScreenNameUI() {
  const editDiv = document.getElementById('screenNameEdit');
  const dispDiv = document.getElementById('screenNameDisplay');
  const textEl = document.getElementById('screenNameText');
  if(!editDiv || !dispDiv) return;
  if(playerName && !playerNoName) {
    editDiv.style.display = 'none';
    dispDiv.style.display = 'block';
    if(textEl) textEl.textContent = playerName;
  } else {
    editDiv.style.display = 'block';
    dispDiv.style.display = 'none';
  }
}

// V12: Wire up screen name section
(function(){
  const saveBtn = document.getElementById('screenNameSave');
  const input = document.getElementById('screenNameInput');
  const displayBtn = document.getElementById('screenNameDisplayBtn');

  function saveName() {
    const name = input.value.trim();
    if(!name) { input.style.border = '2px solid #ef4444'; return; }
    playerName = name;
    playerNoName = false;
    try {
      localStorage.setItem('tn51_player_name', playerName);
      localStorage.setItem('tn51_player_noname', 'false');
    } catch(e) {}
    updateScreenNameUI();
    if(typeof positionPlayerIndicators === 'function') positionPlayerIndicators();
  }

  if(saveBtn) saveBtn.addEventListener('click', saveName);
  if(input) input.addEventListener('keydown', (e) => { if(e.key === 'Enter') saveName(); });

  // Click display name to edit
  if(displayBtn) displayBtn.addEventListener('click', () => {
    const editDiv = document.getElementById('screenNameEdit');
    const dispDiv = document.getElementById('screenNameDisplay');
    if(editDiv) editDiv.style.display = 'block';
    if(dispDiv) dispDiv.style.display = 'none';
    if(input) { input.value = playerName; input.focus(); }
  });

  // Initialize on load
  if(playerName && !playerNoName) {
    if(input) input.value = playerName;
  }
  updateScreenNameUI();
})();

// Multiplayer protocol moved to multiplayer.js

function getLocalSeat() {
  if (MULTIPLAYER_MODE) return mpSeat;
  if (PASS_AND_PLAY_MODE) return ppActiveViewSeat;
  return 0;
}


// --- Pass & Play V10_36 ---
let ppHumanSeats = new Set([0]);  // Which seats are human (default: just P1)
let ppPrivacyMode = true;         // Show handoff screen between turns
let ppActiveViewSeat = 0;         // Which seat's perspective is currently shown (visual rotation)
let ppRotationOffset = 0;         // How many positions board is rotated (0=normal, 3=P4 in P1 spot)

// Convert a game seat to visual player number based on current rotation
function ppVisualPlayer(seat) {
  // When ppRotationOffset=0, seat 0 -> Player 1 (normal)
  // When ppRotationOffset=3 (P4 viewing), seat 3 -> Player 1 position, seat 0 -> Player 4 position
  return ((seat - ppRotationOffset + session.game.player_count) % session.game.player_count) + 1;
}

// Convert visual player number back to game seat
function ppSeatFromVisual(visualPlayer) {
  return (visualPlayer - 1 + ppRotationOffset) % session.game.player_count;
}

// Check if a seat is human-controlled
function ppIsHuman(seat) {
  if (MULTIPLAYER_MODE) return seat === mpSeat;
  if (!PASS_AND_PLAY_MODE) return seat === 0;
  return ppHumanSeats.has(seat);
}

// Rotate the board to show from a specific seat's perspective
function ppRotateBoard(viewingSeat) {
  ppActiveViewSeat = viewingSeat;
  ppRotationOffset = viewingSeat;  // e.g., seat 3 -> offset 3

  // Update player indicator labels
  for (let seat = 0; seat < session.game.player_count; seat++) {
    const visualP = ppVisualPlayer(seat);
    const el = document.getElementById('playerIndicator' + visualP);
    if (el) {
      el.textContent = 'P' + (seat + 1);  // Show real player number
      // Update team color
      el.classList.remove('team1', 'team2');
      el.classList.add(seat % 2 === 0 ? 'team1' : 'team2');
    }
  }

  // Reposition all hand sprites to rotated positions (compacted, no gaps)
  for (let seat = 0; seat < session.game.player_count; seat++) {
    const seatSprites = sprites[seat];
    if (!seatSprites) continue;
    const visualP = ppVisualPlayer(seat);
    const isFocusSeat = (seat === viewingSeat);

    // Filter non-null sprites and position compactly (like recenterHand)
    const remaining = seatSprites.filter(d => d && d.sprite);
    const section = getSection('Player_' + visualP + '_Hand');
    if (section && section.dominoes.length >= 2 && remaining.length > 0) {
      const first = section.dominoes[0];
      const last = section.dominoes[section.dominoes.length - 1];
      const slotCount = section.dominoes.length - 1;
      const centerXN = (first.xN + last.xN) / 2;
      const centerYN = (first.yN + last.yN) / 2;
      const spacingXN = slotCount > 0 ? (last.xN - first.xN) / slotCount : 0;
      const spacingYN = slotCount > 0 ? (last.yN - first.yN) / slotCount : 0;
      const count = remaining.length;

      remaining.forEach((data, i) => {
        const offsetFromCenter = i - (count - 1) / 2;
        const xN = centerXN + offsetFromCenter * spacingXN;
        const yN = centerYN + offsetFromCenter * spacingYN;
        const px = normToPx(xN, yN);
        const targetPose = {
          x: px.x - 28,
          y: px.y - 56,
          s: first.scale,
          rz: first.rotZ,
          ry: isFocusSeat ? 180 : 0
        };
        data.sprite.setPose(targetPose);
      });
    } else {
      // Fallback: use slot-based positioning
      seatSprites.forEach((data, h) => {
        if (!data || !data.sprite) return;
        const pos = getHandPosition(visualP, h);
        if (pos) {
          data.sprite.setPose(pos);
          if (isFocusSeat) {
            data.sprite.setFaceUp(true);
          } else {
            data.sprite.setFaceUp(false);
          }
        }
      });
    }
  }

  // Reposition played tiles in current trick
  for (const played of playedThisTrick) {
    if (played && played.sprite) {
      const visualP = ppVisualPlayer(played.seat);
      const pos = getPlayedPosition(visualP);
      if (pos) {
        played.sprite.setPose(pos);
      }
    }
  }

  // Reposition player indicators
  ppRepositionIndicators();

  // Reposition placeholders
  ppRepositionPlaceholders();
}

// Reposition player indicators based on rotation
function ppRepositionIndicators() {
  // V12.9.4: Use TN51_SETTINGS for indicator positions
  const indicatorPositions_TN51 = {
    1: { xN: TN51_SETTINGS.ind1x, yN: TN51_SETTINGS.ind1y },
    2: { xN: TN51_SETTINGS.ind2x, yN: TN51_SETTINGS.ind2y },
    3: { xN: TN51_SETTINGS.ind3x, yN: TN51_SETTINGS.ind3y },
    4: { xN: TN51_SETTINGS.ind4x, yN: TN51_SETTINGS.ind4y },
    5: { xN: TN51_SETTINGS.ind5x, yN: TN51_SETTINGS.ind5y },
    6: { xN: TN51_SETTINGS.ind6x, yN: TN51_SETTINGS.ind6y }
  };
  const indicatorPositions_T42 = {
    1: { xN: T42_SETTINGS.ind1x, yN: T42_SETTINGS.ind1y },
    2: { xN: T42_SETTINGS.ind2x, yN: T42_SETTINGS.ind2y },
    3: { xN: T42_SETTINGS.ind3x, yN: T42_SETTINGS.ind3y },
    4: { xN: T42_SETTINGS.ind4x, yN: T42_SETTINGS.ind4y }
  };
  const indicatorPositions = GAME_MODE === 'T42' ? indicatorPositions_T42 : indicatorPositions_TN51;

  for (let seat = 0; seat < session.game.player_count; seat++) {
    const visualP = ppVisualPlayer(seat);
    const el = document.getElementById('playerIndicator' + visualP);
    if (el) {
      const pos = indicatorPositions[visualP];
      if(pos){
        const px = normToPx(pos.xN, pos.yN);
        el.style.left = (px.x - 14) + 'px';
        el.style.top = (px.y - 14) + 'px';
      }
    }
  }
}

// Reposition placeholders based on rotation
function ppRepositionPlaceholders() {
  const _phCfg = getActivePlaceholderConfig();
  const boxes = document.querySelectorAll('.player-placeholder[data-pp-player]');
  boxes.forEach(box => {
    const origPlayer = parseInt(box.dataset.ppPlayer);
    if (!origPlayer) return;
    const seat = origPlayer - 1;
    const newVisualP = ppVisualPlayer(seat);
    const pos = _phCfg.players[newVisualP];
    if (pos) {
      const px = normToPx(pos.xN, pos.yN);
      // Use actual box dimensions (set by createPlayerPlaceholders) for centering
      const bw = box.offsetWidth;
      const bh = box.offsetHeight;
      box.style.left = (px.x - bw / 2) + 'px';
      box.style.top = (px.y - bh / 2) + 'px';
    }
  });
}

// Reset rotation to normal (P1 perspective)
function ppResetRotation() {
  ppRotationOffset = 0;
  ppActiveViewSeat = 0;

  // Reset indicator labels
  const _rstPC = session.game.player_count;
  for (let p = 1; p <= _rstPC; p++) {
    const el = document.getElementById('playerIndicator' + p);
    if (el) {
      el.textContent = 'P' + p;
      el.classList.remove('team1', 'team2');
      el.classList.add((p - 1) % 2 === 0 ? 'team1' : 'team2');
    }
  }

  positionPlayerIndicators();
}

// Show handoff screen for a seat
function ppShowHandoff(seat, phaseName) {
  document.getElementById('ppHandoffLabel').textContent = 'Player ' + (seat + 1) + "'s Turn";
  document.getElementById('ppHandoffPhase').textContent = phaseName || '';
  document.getElementById('ppHandoff').style.display = 'flex';
}

// Hide handoff screen
function ppHideHandoff() {
  document.getElementById('ppHandoff').style.display = 'none';
}

// Hide all tiles (face down) - for privacy transitions
function ppHideAllTiles() {
  for (let seat = 0; seat < session.game.player_count; seat++) {
    const seatSprites = sprites[seat];
    if (!seatSprites) continue;
    seatSprites.forEach(data => {
      if (data && data.sprite) {
        data.sprite.setFaceUp(false);
      }
    });
  }
}

// Transition to next human player's turn in pass & play
function ppTransitionToSeat(seat, phaseName) {
  if (!PASS_AND_PLAY_MODE) return;

  if (ppPrivacyMode) {
    ppHideAllTiles();
    ppShowHandoff(seat, phaseName);
    // Handoff button click will call ppCompleteTransition
  } else {
    ppCompleteTransition(seat);
  }
}

// Complete the transition - rotate board and enable play
function ppCompleteTransition(seat) {
  ppHideHandoff();
  ppRotateBoard(seat);

  // Enable click handlers for the active seat
  ppEnableClicksForSeat(seat);
  // Set the global flag so handlePlayer1Click allows clicks
  waitingForPlayer1 = true;

  // Update valid states so tiles show legal/illegal
  if (session.phase === PHASE_PLAYING) {
    ppUpdateValidStates(seat);
    showHint();
  }
}

// Add click handlers to a specific seat's sprites
function ppEnableClicksForSeat(seat) {
  // First remove ALL click handlers
  for (let s = 0; s < session.game.player_count; s++) {
    const seatSprites = sprites[s];
    if (!seatSprites) continue;
    seatSprites.forEach(data => {
      if (data && data.sprite) {
        data.sprite.classList.remove('clickable');
      }
    });
  }

  // Add clickable class to the active seat's sprites
  const seatSprites = sprites[seat];
  if (!seatSprites) return;
  seatSprites.forEach(data => {
    if (data && data.sprite) {
      data.sprite.classList.add('clickable');
    }
  });
}

// Attach click/touchstart handlers to all human seats' sprites
// Called when PP is enabled on an existing game where sprites were created
// without handlers (because PASS_AND_PLAY_MODE was false at creation time)
function ppAttachClickHandlers() {
  for (let seat = 0; seat < session.game.player_count; seat++) {
    if (!ppIsHuman(seat)) continue;
    if (seat === 0) continue; // Seat 0 already has handlers from creation
    const seatSprites = sprites[seat];
    if (!seatSprites) continue;
    seatSprites.forEach(data => {
      if (data && data.sprite) {
        // Check if handler already attached (avoid duplicates)
        if (data._ppHandlerAttached) return;
        const spriteEl = data.sprite.el ? data.sprite.el : data.sprite;
        spriteEl.addEventListener('click', () => handlePlayer1Click(spriteEl));
        spriteEl.addEventListener('touchstart', (e) => {
          e.preventDefault();
          e.stopPropagation();
          handlePlayer1Click(spriteEl);
        }, { passive: false });
        data._ppHandlerAttached = true;
      }
    });
  }
}

// Update valid states for a specific seat (generalized from P1-only)
function ppUpdateValidStates(seat) {
  if (session.phase !== PHASE_PLAYING) return;
  if (session.game.current_player !== seat) return;

  const hand = session.game.hands[seat] || [];
  const legalIndices = session.game.legal_indices_for_player(seat);
  const legalTiles = legalIndices.map(i => hand[i]);

  const seatSprites = sprites[seat] || [];
  seatSprites.forEach((data, idx) => {
    if (data && data.sprite && data.tile) {
      const isValid = legalTiles.some(lt =>
        lt && ((lt[0] === data.tile[0] && lt[1] === data.tile[1]) ||
               (lt[0] === data.tile[1] && lt[1] === data.tile[0]))
      );
      const isTrump = session.game._is_trump_tile(data.tile);
      data.sprite.setState(isTrump, isValid);
    }
  });
}

let HINT_MODE = false;
// V10_106: Fix #11 — Hint border style defaults (CSS variables)
(function(){
  var _ht = 3, _hf = 4, _hc = '#00ff88';
  try{ _ht = parseFloat(localStorage.getItem('tn51_hint_thickness')) || 3; }catch(e){}
  try{ _hf = parseFloat(localStorage.getItem('tn51_hint_feather')) || 4; }catch(e){}
  try{ _hc = localStorage.getItem('tn51_hint_color') || '#00ff88'; }catch(e){}
  document.documentElement.style.setProperty('--hint-thickness', _ht + 'px');
  document.documentElement.style.setProperty('--hint-feather', _hf + 'px');
  document.documentElement.style.setProperty('--hint-color', _hc);
  window._hintThickness = _ht;
  window._hintFeather = _hf;
  window._hintColor = _hc;
})();
let biddingState = null;

/******************************************************************************
 * BIDDING SYSTEM - Slider-based bidding with free range 34-51
 ******************************************************************************/

let currentBidSelection = GAME_MODE === 'MOON' ? 4 : (GAME_MODE === 'T42' ? 30 : 34); // numeric value or 'Pass' or '2x' or 'Moon' etc
let bidMode = 'range'; // 'pass', 'range', '2x', or multiplier like '3x'

function initBiddingRound() {
  const dealerSeat = session.dealer || 0;
  const _pc = session.game.player_count;
  const firstBidder = (dealerSeat - 1 + _pc) % _pc;

  biddingState = {
    currentBidder: firstBidder,
    highBid: 0,
    highBidder: null,
    highMarks: 1,
    passCount: 0,
    bids: [],
    bidderOrder: [],
    inMultiplierMode: false,
    highMultiplier: 0
  };

  for (let i = 0; i < _pc; i++) {
    biddingState.bidderOrder.push((firstBidder + i) % _pc);  // Clockwise order
  }

  currentBidSelection = GAME_MODE === 'MOON' ? 4 : (GAME_MODE === 'T42' ? 30 : 34);
  bidMode = 'range';
}

function setupBidSlider() {
  const slider = document.getElementById('bidRangeSlider');
  const passNotch = document.getElementById('bidPassNotch');
  const twoxNotch = document.getElementById('bid2xNotch');

  // Set slider min based on current high bid
  const _baseBid = GAME_MODE === 'MOON' ? 4 : (GAME_MODE === 'T42' ? 30 : 34);
  const minBid = Math.max(_baseBid, (biddingState ? biddingState.highBid + 1 : _baseBid));
  slider.min = minBid;
  slider.max = GAME_MODE === 'MOON' ? 7 : (GAME_MODE === 'T42' ? 42 : 51);
  slider.value = minBid;

  // Update bid range labels for game mode
  const _bidLabels = slider.parentElement.querySelector('.bidRangeLabels');
  if(_bidLabels){
    const spans = _bidLabels.querySelectorAll('span');
    if(spans[0]) spans[0].textContent = minBid;
    if(spans[1]) spans[1].textContent = slider.max;
  }

  // Update display when slider moves
  slider.oninput = () => {
    bidMode = 'range';
    currentBidSelection = parseInt(slider.value);
    updateBidDisplay();
    // Deselect notches
    passNotch.classList.remove('active');
    twoxNotch.classList.remove('active');
  };

  // Pass notch click
  passNotch.onclick = () => {
    bidMode = 'pass';
    currentBidSelection = 'Pass';
    updateBidDisplay();
    passNotch.classList.add('active');
    twoxNotch.classList.remove('active');
  };

  // 2x / Shoot the Moon notch click
  twoxNotch.onclick = () => {
    if(GAME_MODE === 'MOON'){
      // Shoot the Moon option
      bidMode = 'moon';
      currentBidSelection = 'Moon';
      twoxNotch.textContent = '\u2605 Moon';
      updateBidDisplay();
      twoxNotch.classList.add('active');
      passNotch.classList.remove('active');
      return;
    }
    // V12.10.23: Removed guard that blocked 2x when highBid >= maxBid — 2x IS the valid outbid

    if(biddingState && biddingState.inMultiplierMode){
      // In multiplier mode - bid next level
      const nextMult = biddingState.highMultiplier + 1;
      bidMode = `${nextMult}x`;
      currentBidSelection = `${nextMult}x`;
      twoxNotch.textContent = `${nextMult}x`;
    } else {
      bidMode = '2x';
      currentBidSelection = '2x';
    }
    updateBidDisplay();
    twoxNotch.classList.add('active');
    passNotch.classList.remove('active');
  };

  // Update 2x notch based on mode
  if(GAME_MODE === 'MOON'){
    twoxNotch.textContent = '\u2605 Moon';
  } else if(biddingState && biddingState.inMultiplierMode){
    const nextMult = biddingState.highMultiplier + 1;
    twoxNotch.textContent = `${nextMult}x`;
  } else {
    twoxNotch.textContent = '2x';
  }

  // Disable slider if high bid is already at max
  const _maxBidForDisable = GAME_MODE === 'MOON' ? 7 : (GAME_MODE === 'T42' ? 42 : 51);
  if(biddingState && biddingState.highBid >= _maxBidForDisable){
    slider.disabled = true;
    slider.style.opacity = '0.3';
    // V12.10.23: Default to Pass when no numeric bid is possible
    bidMode = 'pass';
    currentBidSelection = 'Pass';
    passNotch.classList.add('active');
  } else {
    slider.disabled = false;
    slider.style.opacity = '1';
  }

  // Initialize display
  updateBidDisplay();
}

function updateBidDisplay() {
  const display = document.getElementById('bidValueDisplay');
  display.textContent = currentBidSelection;
  // V10_109: Update bid button text and Nello button state whenever display changes
  updateBidButton();
  updateNelloButton();
}

// V10_109: Determine the current Nello button state
function getNelloButtonState(){
  const maxBid = GAME_MODE === 'T42' ? 42 : 51;
  const slider = document.getElementById('bidRangeSlider');
  const sliderVal = slider ? parseInt(slider.value) : 0;
  const highBid = biddingState ? biddingState.highBid : 0;
  const inMult = biddingState ? biddingState.inMultiplierMode : false;
  const highMult = biddingState ? (biddingState.highMultiplier || 0) : 0;

  // Determine what marks this Nello bid would be
  let marks = 1;
  if(bidMode && bidMode.endsWith('x')){
    marks = parseInt(bidMode);
  } else if(bidMode === '2x'){
    marks = 2;
  }

  // If slider is below max bid, Nello is gray (can't go Nello below 42/51)
  if(bidMode === 'range' && sliderVal < maxBid){
    return { state: 'gray', marks: marks, text: 'Nello ' + marks + 'x' };
  }

  // Now check restrictions
  if(nelloRestrictFirst){
    // First Nello must be 1x (at max bid points)
    if(!inMult && highBid < maxBid){
      // No one has bid max yet — Nello must be 1x
      if(marks > 1){
        return { state: 'red', marks: marks, allowedMarks: 1, text: 'Nello ' + marks + 'x' };
      }
      return { state: 'valid', marks: 1, text: 'Nello 1x' };
    }
    if(!inMult && highBid >= maxBid){
      // Someone bid max but not in multiplier mode — Nello must be 2x to outbid
      const needed = 2;
      if(marks < needed){
        return { state: 'red', marks: marks, allowedMarks: needed, text: 'Nello ' + marks + 'x' };
      }
      return { state: 'valid', marks: marks, text: 'Nello ' + marks + 'x' };
    }
    if(inMult){
      // Already in multiplier mode — Nello must be +1 from current
      const needed = highMult + 1;
      if(marks < needed){
        return { state: 'red', marks: marks, allowedMarks: needed, text: 'Nello ' + marks + 'x' };
      }
      return { state: 'valid', marks: marks, text: 'Nello ' + marks + 'x' };
    }
  }

  // Not restricted — just check if at max bid
  if(bidMode === 'range' && sliderVal >= maxBid){
    return { state: 'valid', marks: 1, text: 'Nello 1x' };
  }
  if(bidMode && bidMode.endsWith && bidMode.endsWith('x')){
    return { state: 'valid', marks: marks, text: 'Nello ' + marks + 'x' };
  }
  if(bidMode === '2x'){
    return { state: 'valid', marks: 2, text: 'Nello 2x' };
  }

  return { state: 'valid', marks: marks, text: 'Nello ' + marks + 'x' };
}

// V10_109: Update Nello button appearance based on state
function updateNelloButton(){
  const nBtn = document.getElementById('btnNello');
  if(!nBtn || nBtn.style.display === 'none') return;
  const ns = getNelloButtonState();

  nBtn.textContent = ns.text;

  if(ns.state === 'valid'){
    nBtn.style.background = 'linear-gradient(135deg,#7c3aed,#a855f7)';
    nBtn.style.opacity = '1';
    nBtn.style.textDecoration = 'none';
    nBtn.style.cursor = 'pointer';
  } else if(ns.state === 'gray'){
    nBtn.style.background = 'linear-gradient(135deg,#4b5563,#6b7280)';
    nBtn.style.opacity = '0.7';
    nBtn.style.textDecoration = 'none';
    nBtn.style.cursor = 'pointer';
  } else if(ns.state === 'red'){
    nBtn.style.background = 'linear-gradient(135deg,#dc2626,#ef4444)';
    nBtn.style.opacity = '1';
    nBtn.style.textDecoration = 'line-through';
    nBtn.style.cursor = 'pointer';
  }
}

// V10_109: Update bid button text and gray state
function updateBidButton(){
  const btn = document.getElementById('btnBidConfirm');
  if(!btn) return;
  const maxBid = GAME_MODE === 'MOON' ? 7 : (GAME_MODE === 'T42' ? 42 : 51);
  const baseBid = GAME_MODE === 'MOON' ? 4 : (GAME_MODE === 'T42' ? 30 : 34);

  if(currentBidSelection === 'Pass'){
    btn.textContent = 'Pass';
    btn.style.background = '';
    btn.classList.add('glossGreen');
    btn.style.opacity = '1';
    return;
  }

  if(bidMode === '2x' || (bidMode && bidMode.endsWith && bidMode.endsWith('x'))){
    btn.textContent = 'Bid ' + currentBidSelection;
    btn.classList.add('glossGreen');
    btn.style.background = '';
    btn.style.opacity = '1';
    return;
  }

  if(bidMode === 'moon'){
    btn.textContent = 'Bid Moon';
    btn.classList.add('glossGreen');
    btn.style.background = '';
    btn.style.opacity = '1';
    return;
  }

  const numVal = typeof currentBidSelection === 'number' ? currentBidSelection : parseInt(currentBidSelection);
  const minRequired = biddingState ? biddingState.highBid + 1 : baseBid;

  btn.textContent = 'Bid ' + numVal;

  if(numVal < minRequired){
    // Gray — below minimum
    btn.classList.remove('glossGreen');
    btn.style.background = 'linear-gradient(135deg,#4b5563,#6b7280)';
    btn.style.opacity = '0.7';
  } else {
    // Valid
    btn.classList.add('glossGreen');
    btn.style.background = '';
    btn.style.opacity = '1';
  }
}

function updateBidHint() {
  const hintEl = document.getElementById('bidHintDisplay');
  if(!hintEl) return;

  if(!HINT_MODE){
    hintEl.textContent = '';
    return;
  }

  try {
    // Get the current bidder's hand
    const bidder = biddingState ? biddingState.currentBidder : 0;
    const hand = session.game.hands[bidder] || [];
    if(hand.length === 0){
      hintEl.textContent = '';
      return;
    }

    // Run AI evaluation
    const evaluation = evaluateHandForBid(hand);

    if(evaluation.action === 'pass'){
      hintEl.textContent = 'AI recommends: Pass';
      hintEl.style.color = '#f87171'; // red-ish
    } else {
      // Check if AI's bid is higher than current high bid
      const highBid = biddingState ? biddingState.highBid : 0;
      if(evaluation.bid > highBid){
        hintEl.textContent = 'AI recommends: Bid ' + evaluation.bid;
        hintEl.style.color = '#4ade80'; // green
      } else {
        // AI would bid but can't beat current bid
        hintEl.textContent = 'AI recommends: Pass (would bid ' + evaluation.bid + ')';
        hintEl.style.color = '#fbbf24'; // yellow/amber
      }
    }
  } catch(e) {
    hintEl.textContent = '';
    console.log("Bid hint error:", e);
  }
}

// Track the trump previewed during bidding (preserved for trump selection)
let biddingPreviewedTrump = null;

function showBidOverlay(show) {
  var bidBd = document.getElementById('bidBackdrop');
  bidBd.style.display = show ? 'flex' : 'none';
  if(show) {
    // Apply Moon bid popup position if in Moon mode
    if(GAME_MODE === 'MOON' && MOON_SETTINGS.bidPopupX !== undefined){
      var bpX = ((MOON_SETTINGS.bidPopupX || 0.50) * 100).toFixed(1);
      var bpY = ((MOON_SETTINGS.bidPopupY || 0.08) * 100).toFixed(1);
      // V12.10.27c: Position using % relative to gameWrapper (not vw/vh)
      var bidPanel = bidBd.querySelector('.modalPanel');
      if(bidPanel){
        bidPanel.style.position = 'absolute';
        bidPanel.style.left = bpX + '%';
        bidPanel.style.transform = 'translateX(-50%)';
        // V12.10.27c: Use popup config top if set, otherwise MOON_SETTINGS
        var pcfg = window.POPUP_CONFIG && window.POPUP_CONFIG['bidBackdrop'];
        bidPanel.style.top = (pcfg && pcfg.top !== null && pcfg.top !== undefined) ? pcfg.top + '%' : bpY + '%';
      }
      // Re-apply config after Moon positioning (so width/height/AR still apply)
      if(window.applyPopupConfig) window.applyPopupConfig('bidBackdrop');
    }
    setupBidSlider();
    updateBidHint();
    // Enable bidding preview - allows clicking dominoes to preview trump sorting
    enableBiddingPreview();
    // V10_109: Show Nello button for TN51/T42, update state
    const _nelloBtn = document.getElementById('btnNello');
    if(_nelloBtn){
      if(GAME_MODE !== 'MOON'){
        _nelloBtn.style.display = '';
        window._nelloDeclared = false;
        window._nelloMarks = 1;
        _nelloWasDeclared = false;   // V10_111: Reset persistent flag at start of new bid round
        _nelloDeclaredMarks = 1;
        _nelloAllowedAtTrump = true; // V10_111: Reset, will be computed at end of bidding
        updateNelloButton();
      } else {
        _nelloBtn.style.display = 'none';
      }
    }
    // V10_109: Update bid button text
    updateBidButton();
  } else {
    // Clear bid hint
    const hintEl = document.getElementById('bidHintDisplay');
    if(hintEl) hintEl.textContent = '';
    // Save the previewed trump before disabling (for trump selection phase)
    biddingPreviewedTrump = previewedTrump;
    // Disable bidding preview but DON'T restore hand order if we're going to trump selection
    // (the hand will stay sorted by the previewed trump)
    disableBiddingPreview();
    // Only restore original hand order if NOT going to trump selection
    // (trump selection will keep the sorted order)
    if(session.phase !== PHASE_NEED_TRUMP && session.phase !== PHASE_NEED_BID) {
      restoreOriginalHandOrder();
    }
  }
}

function showTrumpOverlay(show) {
  document.getElementById('trumpBackdrop').style.display = show ? 'flex' : 'none';
  if(show) buildTrumpOptions();
}

/******************************************************************************
 * TRUMP SELECTION
 ******************************************************************************/

let selectedTrump = null;
let trumpClickState = {
  lastClickedTile: null,
  clickCount: 0
};

const TRUMP_COLORS = {
  0: '#1a1a1e', 1: '#36b258', 2: '#f0c73d', 3: '#e74c3c',
  4: '#00b2ff', 5: '#9b59b6', 6: '#a76e34', 7: '#3b82f6'
};

// Handle domino click for trump selection during NEED_TRUMP phase
function handleTrumpDominoClick(tile){
  // Only handle if trump selection is active
  if(!trumpSelectionActive || session.phase !== PHASE_NEED_TRUMP) return;

  const tileKey = `${tile[0]}-${tile[1]}`;
  const isDouble = tile[0] === tile[1];
  const highPip = Math.max(tile[0], tile[1]);
  const lowPip = Math.min(tile[0], tile[1]);

  // Check if same tile clicked again
  if(trumpClickState.lastClickedTile === tileKey){
    trumpClickState.clickCount++;
  } else {
    trumpClickState.lastClickedTile = tileKey;
    trumpClickState.clickCount = 1;
  }

  let newTrump = null;
  const clickNum = trumpClickState.clickCount;

  if(clickNum === 1){
    // First click: select high pip as trump
    newTrump = highPip;
  } else if(clickNum === 2){
    // Second click: if double, select doubles; otherwise select low pip
    if(isDouble){
      newTrump = 'DOUBLES';
    } else {
      newTrump = lowPip;  // Low pip as trump
    }
  } else if(clickNum === 3){
    // Third click: No Trumps
    newTrump = null;
    trumpClickState.clickCount = 0;  // Reset for next cycle
  } else {
    // Cycle back to first click
    trumpClickState.clickCount = 1;
    newTrump = highPip;
  }

  // Select this trump
  selectedTrump = newTrump;
  document.getElementById('btnTrumpConfirm').disabled = false;

  // Update trump grid selection to match
  updateTrumpGridSelection(newTrump);

  // Highlight dominoes that would be trump
  highlightTrumpDominoes(newTrump);
}

// Update the trump selection UI to show selected option (works with new slider UI)
function updateTrumpGridSelection(trump){
  const slider = document.getElementById('trumpSlider');
  const canvas = document.getElementById('trumpCentralCanvas');
  const label = document.getElementById('trumpCentralLabel');
  const doublesBtn = document.getElementById('trumpDoublesBtn');
  const ntBtn = document.getElementById('trumpNTBtn');
  const nelloBtn = document.getElementById('trumpNelloBtn');

  // Reset all special button selections
  doublesBtn.classList.remove('selected');
  ntBtn.classList.remove('selected');
  nelloBtn.classList.remove('selected');

  const ctx = canvas.getContext('2d');
  ctx.clearRect(0, 0, canvas.width, canvas.height);

  if(trump === 'DOUBLES'){
    doublesBtn.classList.add('selected');
    ctx.fillStyle = '#f59e0b';
    ctx.fillRect(0, 0, 60, 60);
    ctx.fillStyle = '#fff';
    ctx.font = 'bold 36px sans-serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText('D', 30, 32);
    label.textContent = 'Doubles';
  } else if(trump === null){
    ntBtn.classList.add('selected');
    ctx.fillStyle = '#666';
    ctx.fillRect(0, 0, 60, 60);
    ctx.fillStyle = '#fff';
    ctx.font = 'bold 28px sans-serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText('NT', 30, 32);
    label.textContent = 'No Trump';
  } else if(trump === 'NELLO'){
    nelloBtn.classList.add('selected');
    ctx.fillStyle = '#9333ea';
    ctx.fillRect(0, 0, 60, 60);
    ctx.fillStyle = '#fff';
    ctx.font = 'bold 36px sans-serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText('N', 30, 32);
    label.textContent = 'Nel-O';
  } else if(typeof trump === 'number'){
    slider.value = trump;
    drawPipSquare(ctx, trump, 60);
    label.textContent = `${trump}s Trump`;
  }
}

// Highlight player's dominoes that match the selected trump
function highlightTrumpDominoes(trump){
  const activeSeat = getLocalSeat();
  const seatSprites = sprites[activeSeat] || [];
  for(let i = 0; i < seatSprites.length; i++){
    const data = seatSprites[i];
    if(data && data.sprite && data.tile){
      const tile = data.tile;
      let isTrump = false;

      if(trump === 'DOUBLES'){
        isTrump = tile[0] === tile[1];
      } else if(trump !== null && trump !== 'NT' && typeof trump === 'number'){
        isTrump = tile[0] === trump || tile[1] === trump;
      }
      // NT or null means no highlights

      data.sprite.setState(isTrump, true);
    }
  }
}

// Clear trump highlights
function clearTrumpHighlights(){
  const activeSeat = getLocalSeat();
  const seatSprites = sprites[activeSeat] || [];
  for(let i = 0; i < seatSprites.length; i++){
    const data = seatSprites[i];
    if(data && data.sprite){
      data.sprite.setState(false, true);
    }
  }
}

// Flag to track if we're in trump selection mode
let trumpSelectionActive = false;
// Flag to track if we're in bidding preview mode (clicking dominoes to preview trump during bidding)
let biddingPreviewActive = false;
let previewedTrump = null;

// Enable clicking on player's dominoes to select trump
function enableTrumpDominoClicks(){
  trumpSelectionActive = true;
  // Bring player's dominoes above the overlay and make them clickable
  const activeSeat = getLocalSeat();
  const seatSprites = sprites[activeSeat] || [];
  for(let i = 0; i < seatSprites.length; i++){
    const data = seatSprites[i];
    if(data && data.sprite){
      data.sprite.classList.add('clickable');  // Enable pointer events
      data.sprite.style.zIndex = '1100';  // Above modal backdrop (z-index 1000)
      if(data.sprite._shadow){
        data.sprite._shadow.style.zIndex = '1099';
      }
    }
  }
}

// Enable bidding preview mode (clicking dominoes to preview trump during bidding)
function enableBiddingPreview(){
  biddingPreviewActive = true;
  previewedTrump = null;
  // Clear any existing highlights before starting preview mode
  clearTrumpHighlights();
  // Bring player's dominoes above the overlay and make them clickable
  const activeSeat = getLocalSeat();
  const seatSprites = sprites[activeSeat] || [];
  for(let i = 0; i < seatSprites.length; i++){
    const data = seatSprites[i];
    if(data && data.sprite){
      data.sprite.classList.add('clickable');  // Enable pointer events
      data.sprite.style.zIndex = '1100';
      if(data.sprite._shadow){
        data.sprite._shadow.style.zIndex = '1099';
      }
    }
  }
}

function disableBiddingPreview(force){
  if(!force && session && session.phase !== PHASE_PLAYING) return; // Keep preview until play starts
  biddingPreviewActive = false;
  previewedTrump = null;
  clearTrumpHighlights();
  // Reset z-index and remove clickable for player's dominoes
  const activeSeat = getLocalSeat();
  const seatSprites = sprites[activeSeat] || [];
  for(let i = 0; i < seatSprites.length; i++){
    const data = seatSprites[i];
    if(data && data.sprite){
      data.sprite.classList.remove('clickable');  // Disable pointer events
      data.sprite.style.zIndex = '';
      if(data.sprite._shadow){
        data.sprite._shadow.style.zIndex = '';
      }
    }
  }
}

// Handle domino click during bidding for trump preview
function handleBiddingDominoClick(tile){
  if(!biddingPreviewActive || session.phase === PHASE_PLAYING) return;

  const tileKey = `${tile[0]}-${tile[1]}`;
  const isDouble = tile[0] === tile[1];
  const highPip = Math.max(tile[0], tile[1]);
  const lowPip = Math.min(tile[0], tile[1]);

  // Same click cycling logic as trump selection
  if(trumpClickState.lastClickedTile === tileKey){
    trumpClickState.clickCount++;
  } else {
    trumpClickState.lastClickedTile = tileKey;
    trumpClickState.clickCount = 1;
  }

  let newTrump = null;
  const clickNum = trumpClickState.clickCount;

  if(clickNum === 1){
    newTrump = highPip;
  } else if(clickNum === 2){
    if(isDouble){
      newTrump = 'DOUBLES';
    } else {
      newTrump = lowPip;
    }
  } else if(clickNum === 3){
    newTrump = null;  // Clear preview
    trumpClickState.clickCount = 0;
  } else {
    trumpClickState.clickCount = 1;
    newTrump = highPip;
  }

  previewedTrump = newTrump;

  // Play shuffle sound
  SFX.playShuffle();

  // Preview sort the hand (highlights are applied at the END of this function)
  previewSortHandByTrump(newTrump);
}

// Preview sort the hand by a potential trump (temporary visual only)
// Uses same sorting logic as sortPlayerHandByTrump:
// 1. Double trump (far left)
// 2. Trump tiles by OTHER pip descending
// 3. Non-trump doubles, highest to lowest
// 4. Non-trump non-doubles by high pip descending
function previewSortHandByTrump(trump){
  const activeSeat = getLocalSeat();
  // V10_109: Clear highlights before sort — will reapply at end of function
  const _psSprites = sprites[activeSeat] || [];
  for(let i = 0; i < _psSprites.length; i++){
    if(_psSprites[i] && _psSprites[i].sprite){
      _psSprites[i].sprite._highlighted = false;
      _psSprites[i].sprite._dimmed = false;
    }
  }
  const seatSprites = sprites[activeSeat] || [];
  const validSprites = seatSprites.filter(d => d && d.tile);

  if(validSprites.length === 0) return;

  // Sorting function returns [priority, subSort]
  const getSortKey = (tile) => {
    const highPip = Math.max(tile[0], tile[1]);
    const lowPip = Math.min(tile[0], tile[1]);
    const isDouble = tile[0] === tile[1];

    let isTrump = false;
    let isDoubleTrump = false;
    let otherPip = 0;

    if(trump === 'DOUBLES'){
      if(isDouble){
        isTrump = true;
        isDoubleTrump = true;
      }
    } else if(trump !== null && typeof trump === 'number'){
      const hasTrumpPip = tile[0] === trump || tile[1] === trump;
      if(hasTrumpPip){
        isTrump = true;
        isDoubleTrump = isDouble;
        otherPip = (tile[0] === trump) ? tile[1] : tile[0];
      }
    }

    if(isDoubleTrump){
      return [0, 100 - highPip];
    } else if(isTrump){
      return [1, 100 - otherPip];
    } else if(isDouble){
      return [2, 100 - highPip];
    } else {
      return [3, (100 - highPip) * 10 + (100 - lowPip)];
    }
  };

  // Sort sprites by their tiles
  // NOTE: Slot 0 is on the RIGHT, slot 5 is on the LEFT
  // So we reverse the sort: highest priority (lowest number) goes to highest index (leftmost)
  validSprites.sort((a, b) => {
    const keyA = getSortKey(a.tile);
    const keyB = getSortKey(b.tile);
    if(keyA[0] !== keyB[0]) return keyB[0] - keyA[0];
    return keyB[1] - keyA[1];
  });

  // Update sprites array to match sorted order (fixes highlight sync)
  for(let i = 0; i < validSprites.length; i++){
    sprites[activeSeat][i] = validSprites[i];
  }
  // Animate to new positions
  const playerNum = MULTIPLAYER_MODE ? mpVisualPlayer(activeSeat) : (PASS_AND_PLAY_MODE ? ppVisualPlayer(activeSeat) : seatToPlayer(activeSeat));
  for(let i = 0; i < validSprites.length; i++){
    const pos = getHandPosition(playerNum, i);
    if(pos && validSprites[i].sprite){
      animateSprite(validSprites[i].sprite, pos, 200);
    }
  }

  // V10_109: Reapply highlights AFTER sort so they match new positions
  // This must happen before flip animation since flips call redrawCanvases which reads _highlighted
  highlightTrumpDominoes(trump);

  // Preview flip: orient trump pip on top during bidding preview with animation
  // FIRST: restore all tiles to canonical orientation (high pip first = default big suit on top)
  // This ensures previously-flipped tiles from a different trump selection get un-flipped
  for (const data of validSprites) {
    if (data && data.tile && data.sprite && data.tile[0] !== data.tile[1]) {
      const t = data.tile;
      const canonical = [Math.max(t[0], t[1]), Math.min(t[0], t[1])];
      if (t[0] !== canonical[0] || t[1] !== canonical[1]) {
        data.tile = canonical;
        data.sprite._tile = data.tile;
        data.sprite.dataset.tile = JSON.stringify(data.tile);
        data.sprite.redrawCanvases && data.sprite.redrawCanvases();
      }
    }
  }

  // THEN: flip tiles for the newly selected trump
  if (window.FLIP_TRUMP_ENABLED && trump !== null && trump !== 'DOUBLES') {
    const trumpPip = typeof trump === 'number' ? trump : null;
    if (trumpPip !== null) {
      const flipSprites = [];
      for (const data of validSprites) {
        if (data && data.tile && data.sprite) {
          const t = data.tile;
          if (t[0] !== t[1] && t[1] === trumpPip && t[0] !== trumpPip) {
            data.tile = [t[1], t[0]];
            data.sprite._tile = data.tile;
            data.sprite.dataset.tile = JSON.stringify(data.tile);
            // Set rz +180 before redraw (visually cancels the data swap)
            const pose = data.sprite._pose || {x:0,y:0,s:1,rz:0,ry:180};
            const origRz = pose.rz || 0;
            pose.rz = origRz + 180;
            data.sprite._pose = pose;
            data.sprite.style.transform = `translate(${pose.x}px,${pose.y}px) scale(${pose.s}) rotate(${pose.rz}deg)`;
            data.sprite.redrawCanvases && data.sprite.redrawCanvases();
            flipSprites.push({sprite: data.sprite, targetRz: origRz});
          }
        }
      }
      // Animate spin back
      if (flipSprites.length > 0){
        const FLIP_DUR = 350;
        const flipStart = performance.now();
        function animPreviewFlip(now){
          const elapsed = now - flipStart;
          const prog = Math.min(1, elapsed / FLIP_DUR);
          const t2 = prog < 0.5 ? 2*prog*prog : 1 - Math.pow(-2*prog + 2, 2) / 2;
          for (const item of flipSprites){
            const p = item.sprite._pose;
            const curRz = item.targetRz + 180 * (1 - t2);
            p.rz = curRz;
            item.sprite.style.transform = `translate(${p.x}px,${p.y}px) scale(${p.s}) rotate(${curRz}deg)`;
            if(item.sprite._shadow) item.sprite._shadow.style.transform = `translate(${p.x}px,${p.y}px) scale(${p.s}) rotate(${curRz}deg)`;
          }
          if (prog < 1) requestAnimationFrame(animPreviewFlip);
          else {
            for (const item of flipSprites){
              const p = item.sprite._pose;
              p.rz = item.targetRz;
              item.sprite.style.transform = `translate(${p.x}px,${p.y}px) scale(${p.s}) rotate(${item.targetRz}deg)`;
              if(item.sprite._shadow) item.sprite._shadow.style.transform = `translate(${p.x}px,${p.y}px) scale(${p.s}) rotate(${item.targetRz}deg)`;
              item.sprite.redrawCanvases && item.sprite.redrawCanvases();
            }
          }
        }
        requestAnimationFrame(animPreviewFlip);
      }
    }
  }
}

// Restore hand to original order (by originalSlot)
function restoreOriginalHandOrder(){
  const activeSeat = getLocalSeat();
  const seatSprites = sprites[activeSeat] || [];
  const validSprites = seatSprites.filter(d => d && d.tile);

  if(validSprites.length === 0) return;

  // Sort by original slot
  validSprites.sort((a, b) => (a.originalSlot || 0) - (b.originalSlot || 0));

  // Animate back to original positions
  const playerNum = MULTIPLAYER_MODE ? mpVisualPlayer(activeSeat) : (PASS_AND_PLAY_MODE ? ppVisualPlayer(activeSeat) : seatToPlayer(activeSeat));
  for(let i = 0; i < validSprites.length; i++){
    const pos = getHandPosition(playerNum, i);
    if(pos && validSprites[i].sprite){
      animateSprite(validSprites[i].sprite, pos, 200);
    }
  }
}

// Disable trump domino clicks (call when leaving trump selection)
function disableTrumpDominoClicks(){
  trumpSelectionActive = false;
  clearTrumpHighlights();
  // Reset z-index and remove clickable for player's dominoes
  const activeSeat = getLocalSeat();
  const seatSprites = sprites[activeSeat] || [];
  for(let i = 0; i < seatSprites.length; i++){
    const data = seatSprites[i];
    if(data && data.sprite){
      data.sprite.classList.remove('clickable');  // Disable pointer events
      data.sprite.style.zIndex = '';  // Reset to default
      if(data.sprite._shadow){
        data.sprite._shadow.style.zIndex = '';
      }
    }
  }
}

function buildTrumpOptions() {
  selectedTrump = null;
  trumpClickState = { lastClickedTile: null, clickCount: 0 };
  biddingPreviewActive = false;  // V10_105: Fix #8 — prevent bidding preview from intercepting trump clicks
  document.getElementById('btnTrumpConfirm').disabled = true;

  // Check if Nello is available at trump selection
  // V10_111: Use _nelloAllowedAtTrump (computed at end of bidding) to gate by restriction rules
  const maxBidForNello = GAME_MODE === 'MOON' ? 999 : (GAME_MODE === 'T42' ? 42 : 51);
  const bidQualifies = session.current_bid >= maxBidForNello || (biddingState && biddingState.inMultiplierMode);
  const showNello = bidQualifies && _nelloAllowedAtTrump;

  // Enable clicking on player's dominoes for trump selection
  enableTrumpDominoClicks();

  // Setup slider-based UI
  const slider = document.getElementById('trumpSlider');
  const canvas = document.getElementById('trumpCentralCanvas');
  const label = document.getElementById('trumpCentralLabel');
  const doublesBtn = document.getElementById('trumpDoublesBtn');
  const ntBtn = document.getElementById('trumpNTBtn');
  const nelloBtn = document.getElementById('trumpNelloBtn');

  // Show/hide Nel-O button based on bid
  nelloBtn.style.display = showNello ? 'block' : 'none';
  // Hide Doubles button in T42 (standard Texas 42 doesn't use doubles trump)
  // doublesBtn.style.display = GAME_MODE === 'T42' ? 'none' : 'block';
  // Adjust slider max for T42/Moon (0-6) vs TN51 (0-7)
  slider.max = (GAME_MODE === 'T42' || GAME_MODE === 'MOON') ? 6 : 7;

  // Trump selection hint
  if(HINT_MODE){
    const hintSeat = getLocalSeat();
    const hintHand = session.game.hands[hintSeat] || [];
    const hintBid = session.current_bid || (GAME_MODE === 'T42' ? 30 : 34);
    const aiTrump = aiChooseTrump(hintHand, hintBid);
    const hintBar = document.getElementById('trumpHintBar');
    const hintText = document.getElementById('trumpHintText');
    if(hintBar && hintText){
      let label = '';
      if(aiTrump === 'NELLO') label = 'Nel-O';
      else if(aiTrump === 'NT') label = 'No Trump (Doubles)';
      else if(typeof aiTrump === 'number') label = aiTrump + 's Trump';
      else label = String(aiTrump);
      hintText.textContent = label;
      hintBar.style.display = 'block';

      // Pre-select the AI's recommendation
      if(biddingPreviewedTrump === null){
        if(aiTrump === 'NELLO' && showNello){
          selectedTrump = 'NELLO';
          nelloBtn.classList.add('selected');
          document.getElementById('btnTrumpConfirm').disabled = false;
        } else if(aiTrump === 'NT'){
          selectedTrump = 'DOUBLES';
          doublesBtn.classList.add('selected');
          document.getElementById('btnTrumpConfirm').disabled = false;
          highlightTrumpDominoes('DOUBLES');
        } else if(typeof aiTrump === 'number'){
          selectedTrump = aiTrump;
          slider.value = aiTrump;
          document.getElementById('btnTrumpConfirm').disabled = false;
          highlightTrumpDominoes(aiTrump);
          updateTrumpDisplay(aiTrump);
        }
      }
    }
  } else {
    const hintBar = document.getElementById('trumpHintBar');
    if(hintBar) hintBar.style.display = 'none';
  }

  // Reset UI state
  slider.value = 0;
  selectedTrump = null;  // V12.10.19: Reset selectedTrump with visual
  document.getElementById('btnTrumpConfirm').disabled = true;  // V12.10.19: Re-disable confirm
  doublesBtn.classList.remove('selected');
  ntBtn.classList.remove('selected');
  nelloBtn.classList.remove('selected');

  // Update central display function
  function updateTrumpDisplay(pip){
    const ctx = canvas.getContext('2d');
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    drawPipSquare(ctx, pip, 60);
    label.textContent = `${pip}s Trump`;
  }

  // Check if we have a previewed trump from bidding phase to pre-select
  if(biddingPreviewedTrump !== null){
    if(biddingPreviewedTrump === 'DOUBLES'){
      // Pre-select doubles from bidding — enable Confirm so user can just tap it
      selectedTrump = 'DOUBLES';
      doublesBtn.classList.add('selected');
      document.getElementById('btnTrumpConfirm').disabled = false;
      highlightTrumpDominoes('DOUBLES');
      // V12.10.21: Draw 'D' on canvas instead of blank pip-0
      var _dctx = canvas.getContext('2d');
      _dctx.clearRect(0, 0, canvas.width, canvas.height);
      _dctx.fillStyle = '#d97706';
      _dctx.fillRect(0, 0, 60, 60);
      _dctx.fillStyle = '#fff';
      _dctx.font = 'bold 36px sans-serif';
      _dctx.textAlign = 'center';
      _dctx.textBaseline = 'middle';
      _dctx.fillText('D', 30, 32);
      label.textContent = 'Doubles Trump';
    } else if(typeof biddingPreviewedTrump === 'number'){
      // Pre-select the pip value from bidding — enable Confirm
      selectedTrump = biddingPreviewedTrump;
      slider.value = biddingPreviewedTrump;
      document.getElementById('btnTrumpConfirm').disabled = false;
      highlightTrumpDominoes(biddingPreviewedTrump);
      updateTrumpDisplay(biddingPreviewedTrump);
    } else {
      // Initial display (no preview)
      updateTrumpDisplay(0);
    }
    // Clear the saved preview after using it
    biddingPreviewedTrump = null;
  } else {
    // Initial display (no preview)
    updateTrumpDisplay(0);
  }

  // V12.10.19: Sync selectedTrump with visual state to prevent stale value from hints
  // If selectedTrump was set by hint but then visual was reset, fix it
  if(selectedTrump === null){
    document.getElementById('btnTrumpConfirm').disabled = true;
  }
  // Debounce: delay enabling domino clicks to prevent carry-over touch events from bidding
  trumpSelectionActive = false;
  setTimeout(function(){ trumpSelectionActive = true; }, 200);

  // Slider input handler
  slider.oninput = function(){
    const pip = parseInt(slider.value);
    updateTrumpDisplay(pip);
    selectedTrump = pip;
    document.getElementById('btnTrumpConfirm').disabled = false;
    // Deselect special buttons
    doublesBtn.classList.remove('selected');
    ntBtn.classList.remove('selected');
    nelloBtn.classList.remove('selected');
    // Highlight matching dominoes
    highlightTrumpDominoes(pip);
  };

  // Doubles button
  doublesBtn.onclick = function(){
    selectedTrump = 'DOUBLES';
    document.getElementById('btnTrumpConfirm').disabled = false;
    doublesBtn.classList.add('selected');
    ntBtn.classList.remove('selected');
    nelloBtn.classList.remove('selected');
    // Update display to show "D"
    const ctx = canvas.getContext('2d');
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    ctx.fillStyle = '#f59e0b';
    ctx.fillRect(0, 0, 60, 60);
    ctx.fillStyle = '#fff';
    ctx.font = 'bold 36px sans-serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText('D', 30, 32);
    label.textContent = 'Doubles';
    highlightTrumpDominoes('DOUBLES');
  };

  // No Trump button
  ntBtn.onclick = function(){
    selectedTrump = 'NT';  // Use 'NT' string instead of null to distinguish from "nothing selected"
    document.getElementById('btnTrumpConfirm').disabled = false;
    ntBtn.classList.add('selected');
    doublesBtn.classList.remove('selected');
    nelloBtn.classList.remove('selected');
    // Update display to show "NT"
    const ctx = canvas.getContext('2d');
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    ctx.fillStyle = '#666';
    ctx.fillRect(0, 0, 60, 60);
    ctx.fillStyle = '#fff';
    ctx.font = 'bold 28px sans-serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText('NT', 30, 32);
    label.textContent = 'No Trump';
    highlightTrumpDominoes('NT');  // Pass 'NT' to clear highlights (no trump means no highlighting)
  };

  // Nel-O button
  nelloBtn.onclick = function(){
    selectedTrump = 'NELLO';
    document.getElementById('btnTrumpConfirm').disabled = false;
    nelloBtn.classList.add('selected');
    doublesBtn.classList.remove('selected');
    ntBtn.classList.remove('selected');
    // Update display to show "N"
    const ctx = canvas.getContext('2d');
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    ctx.fillStyle = '#9333ea';
    ctx.fillRect(0, 0, 60, 60);
    ctx.fillStyle = '#fff';
    ctx.font = 'bold 36px sans-serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText('N', 30, 32);
    label.textContent = 'Nel-O';
    clearTrumpHighlights();
  };
}

function selectTrumpOption(value, element) {
  console.log("selectTrumpOption called with:", value);

  // Remove selected from all
  document.querySelectorAll('.trumpOption').forEach(el => el.classList.remove('selected'));
  element.classList.add('selected');
  selectedTrump = value;

  // Enable confirm button
  const btn = document.getElementById('btnTrumpConfirm');
  btn.disabled = false;
  console.log("Trump selected:", value, "- button enabled");
}

/******************************************************************************
 * NEL-O OPPONENT SELECTION
 ******************************************************************************/
let selectedNelloOpponent = null;
let pendingNelloMarks = 1;

function showNelloOpponentSelection(marks = 1){
  pendingNelloMarks = marks;
  selectedNelloOpponent = null;

  // Get bidder seat and determine their teammates (both sit out)
  const bidderSeat = session.bid_winner_seat !== undefined ? session.bid_winner_seat : 0;

  // Teammates are same parity (same team) but not the bidder
  const teammates = [];
  for(let s = 0; s < session.game.player_count; s++){
    if(s !== bidderSeat && (s % 2) === (bidderSeat % 2)){
      teammates.push(s);
    }
  }
  const teammatePlayerNums = teammates.map(s => 'P' + seatToPlayer(s));

  // Update teammates display
  document.getElementById('nelloTeammatesDisplay').textContent = teammatePlayerNums.join(' & ');

  // Build opponent options (opponents are on the other team)
  const grid = document.getElementById('nelloOpponentGrid');
  grid.innerHTML = '';

  // Opponents are seats with different parity than bidder
  const opponentSeats = [];
  for(let s = 0; s < session.game.player_count; s++){
    if((s % 2) !== (bidderSeat % 2)){
      opponentSeats.push(s);
    }
  }

  opponentSeats.forEach(seat => {
    const playerNum = seatToPlayer(seat);
    const opt = document.createElement('div');
    opt.className = 'nelloOpponent';
    opt.innerHTML = `
      <div class="nelloOpponentNum">P${playerNum}</div>
      <div class="nelloOpponentLabel">Sit Out</div>
    `;
    opt.addEventListener('click', () => selectNelloOpponent(seat, opt));
    opt.addEventListener('touchend', (e) => {
      e.preventDefault();
      selectNelloOpponent(seat, opt);
    });
    grid.appendChild(opt);
  });

  document.getElementById('btnNelloConfirm').disabled = true;
  document.getElementById('nelloBackdrop').style.display = 'flex';
}

function selectNelloOpponent(seat, element){
  document.querySelectorAll('.nelloOpponent').forEach(el => el.classList.remove('selected'));
  element.classList.add('selected');
  selectedNelloOpponent = seat;
  document.getElementById('btnNelloConfirm').disabled = false;
}

function confirmNelloOpponent(){
  if(selectedNelloOpponent === null) return;

  document.getElementById('nelloBackdrop').style.display = 'none';

  // V10_121 Host Authority: Guest sends intent, host applies engine mutations
  if(MULTIPLAYER_MODE && !mpIsHost){
    // Guest: just send the opponent selection to host. Host will set up nello and broadcast nello_confirmed.
    mpSendMove({ action: 'nello_intent', seat: mpSeat, selectedOpponent: selectedNelloOpponent, marks: pendingNelloMarks });
    setStatus('Waiting for host to confirm nello...');
    return;
  }

  // Host or single-player: execute nello setup
  _executeNelloSetup(selectedNelloOpponent, pendingNelloMarks);
}

// Shared nello setup logic — called by host directly or via mpHandleNelloIntent
function _executeNelloSetup(opponent, marks){
  // Get bidder seat and teammates (both partners on bidder's team sit out)
  const bidderSeat = session.bid_winner_seat !== undefined ? session.bid_winner_seat : 0;

  // In 6-player: teams are by parity. Bidder's teammates are same parity.
  // Teammates: the other 2 seats on bidder's team
  const teammates = [];
  for(let s = 0; s < session.game.player_count; s++){
    if(s !== bidderSeat && (s % 2) === (bidderSeat % 2)){
      teammates.push(s);
    }
  }

  // Active players: bidder + 2 remaining opponents (not the one sitting out)
  // Total: 3 players (bidder vs 2 opponents)
  const activePlayers = [bidderSeat];
  for(let s = 0; s < session.game.player_count; s++){
    // Add opponents who are NOT sitting out
    if((s % 2) !== (bidderSeat % 2) && s !== opponent){
      activePlayers.push(s);
    }
  }

  // Set up Nello with custom active players
  session.contract = 'NELLO';
  session.bid_marks = marks;
  session.game.set_trump_suit(null);
  session.game.set_active_players(activePlayers);

  // Determine nello doubles mode before starting play
  let _needNelloDoublesPopup = false;
  if(nelloDoublesMode === 'doubles_only'){
    nelloDoublesSuitActive = true;
    session.game.nello_doubles_suit = true;
  } else if(nelloDoublesMode === 'player_chooses'){
    const _ndBidder = session.bid_winner_seat !== undefined ? session.bid_winner_seat : 0;
    if(_ndBidder === getLocalSeat()){
      _needNelloDoublesPopup = true; // Show popup after setup
    } else if(mpIsHost && mpIsAI && typeof mpIsAI === 'function' && mpIsAI(_ndBidder)){
      // AI on host decides nello doubles mode
      const _ndHand = session.game.hands[_ndBidder] || [];
      nelloDoublesSuitActive = aiChooseNelloDoublesMode(_ndHand);
      session.game.nello_doubles_suit = nelloDoublesSuitActive;
      if(nelloDoublesSuitActive) setStatus('Nello: Doubles are their own suit');
    } else {
      const _ndHand = session.game.hands[_ndBidder] || [];
      nelloDoublesSuitActive = aiChooseNelloDoublesMode(_ndHand);
      session.game.nello_doubles_suit = nelloDoublesSuitActive;
      if(nelloDoublesSuitActive) setStatus('Nello: Doubles are their own suit');
    }
  } else {
    nelloDoublesSuitActive = false;
    session.game.nello_doubles_suit = false;
  }

  // Clear hands of sitting-out players (both teammates + selected opponent)
  for(const t of teammates){
    session.game.hands[t] = [];
  }
  session.game.hands[opponent] = [];

  // Set leader to bidder
  session.game.leader = bidderSeat;
  session.game.current_player = bidderSeat;
  _trackCpChange('confirmNelloOpponent');

  session.phase = PHASE_PLAYING;
  const marksStr = marks === 2 ? ' (2 Marks)' : '';
  session.status = `Nel-O${marksStr}: Lose all tricks to win.`;

  // Keep bid placeholders visible during play (user preference)

  // Log hand start with detailed v2.0 format for Nel-O
  // Copy hands before sync (sitting out players have been cleared already)
  const handsCopy = session.game.hands.map(h => h ? [...h] : []);

  logHandStart(
    'NONE',           // Nel-O has no trumps
    null,             // No trump suit
    'NELLO',          // Contract type
    session.current_bid,
    bidderSeat,
    handsCopy,
    session.dealer,
    bidderSeat,       // Bidder leads
    { team1: session.team_marks[0] || 0, team2: session.team_marks[1] || 0 }
  );

  // V10_121: Host broadcasts nello_confirmed to all clients
  if(MULTIPLAYER_MODE && mpIsHost){
    mpSendMove({ action: 'nello_confirmed', seat: bidderSeat, selectedOpponent: opponent,
      marks: marks, activePlayers: activePlayers.slice(), firstPlayer: bidderSeat,
      nelloDoublesSuit: nelloDoublesSuitActive });
  }

  // Sync sprites and update display
  syncSpritesWithGameState();
  updateTrumpDisplay();
  renderAll();

  // Show nello doubles choice popup if needed (human bidder, player_chooses mode)
  if(_needNelloDoublesPopup){
    document.getElementById('nelloDoublesBackdrop').style.display = 'flex';
    return; // resumeAfterNelloDoublesChoice() will start play
  }

  // Start play
  if(MULTIPLAYER_MODE){
    mpCheckWhoseTurn();
  } else if(session.game.current_player === getLocalSeat()){
    waitingForPlayer1 = true;
    enablePlayer1Clicks();
    updatePlayer1ValidStates();
    showHint();
  } else {
    waitingForPlayer1 = false;
    disablePlayer1Clicks();
    maybeAIKick();
  }
}

function cancelNelloOpponent(){
  document.getElementById('nelloBackdrop').style.display = 'none';
  // Go back to trump selection
  showTrumpOverlay(true);
  // V10_121g: Ensure trump selection is active for proper domino clicks
  trumpSelectionActive = true;
  enableTrumpDominoClicks();
}

// AI Nello setup - AI picks an opponent to sit out
function setupAINello(bidderSeat, marks = 1){
  // Bidder's teammates (same parity, not bidder)
  const teammates = [];
  for(let s = 0; s < session.game.player_count; s++){
    if(s !== bidderSeat && (s % 2) === (bidderSeat % 2)){
      teammates.push(s);
    }
  }

  // Opponents are on the opposite team (different parity)
  const opponentSeats = [];
  for(let s = 0; s < session.game.player_count; s++){
    if((s % 2) !== (bidderSeat % 2)){
      opponentSeats.push(s);
    }
  }

  // AI picks randomly which opponent sits out
  const sitOutOpponent = opponentSeats[Math.floor(Math.random() * opponentSeats.length)];

  // Active players: bidder + 2 remaining opponents (3 players total)
  const activePlayers = [bidderSeat];
  for(let s = 0; s < session.game.player_count; s++){
    if((s % 2) !== (bidderSeat % 2) && s !== sitOutOpponent){
      activePlayers.push(s);
    }
  }

  // Set up Nello game state
  session.contract = 'NELLO';
  session.bid_marks = marks;
  session.game.set_trump_suit(null);

  // Apply nello doubles mode for AI
  if(nelloDoublesMode === 'doubles_only'){
    nelloDoublesSuitActive = true;
    session.game.nello_doubles_suit = true;
  } else if(nelloDoublesMode === 'player_chooses'){
    const _aiNdHand = session.game.hands[bidderSeat] || [];
    nelloDoublesSuitActive = aiChooseNelloDoublesMode(_aiNdHand);
    session.game.nello_doubles_suit = nelloDoublesSuitActive;
    if(nelloDoublesSuitActive) setStatus('Nello: Doubles are their own suit');
  } else {
    nelloDoublesSuitActive = false;
    session.game.nello_doubles_suit = false;
  }
  session.game.set_active_players(activePlayers);

  // Clear hands of sitting-out players (both teammates + chosen opponent)
  for(const t of teammates){
    session.game.hands[t] = [];
  }
  session.game.hands[sitOutOpponent] = [];

  // Set leader to bidder
  session.game.leader = bidderSeat;
  session.game.current_player = bidderSeat;
  _trackCpChange('aiNelloOpponent');

  session.phase = PHASE_PLAYING;
  const sitOutOpponentPlayer = seatToPlayer(sitOutOpponent);
  const marksStr = marks === 2 ? ' (2 Marks)' : '';
  session.status = `Nel-O${marksStr}: P${sitOutOpponentPlayer} sits out. Lose all tricks to win.`;

  // Log hand start with detailed v2.0 format for AI Nel-O
  const handsCopy = session.game.hands.map(h => h ? [...h] : []);

  logHandStart(
    'NONE',           // Nel-O has no trumps
    null,             // No trump suit
    'NELLO',          // Contract type
    session.current_bid,
    bidderSeat,
    handsCopy,
    session.dealer,
    bidderSeat,       // Bidder leads
    { team1: session.team_marks[0] || 0, team2: session.team_marks[1] || 0 }
  );

  // Sync sprites
  syncSpritesWithGameState();
  updateTrumpDisplay();
}

// Set up Nello button handlers
document.getElementById('btnNelloConfirm').addEventListener('click', confirmNelloOpponent);
document.getElementById('btnNelloCancel').addEventListener('click', cancelNelloOpponent);

// Show the trump display square
function updateTrumpDisplay(){
  const trumpDisplay = document.getElementById('trumpDisplay');
  const canvas = document.getElementById('trumpDisplayCanvas');
  const ctx = canvas.getContext('2d');

  if(session.phase !== PHASE_PLAYING){
    trumpDisplay.classList.remove('visible');
    return;
  }

  const trump = session.game.trump_suit;
  const mode = session.game.trump_mode;

  trumpDisplay.classList.add('visible');

  // Clear canvas
  ctx.clearRect(0, 0, 32, 32);

  if(mode === 'NONE' || trump === null){
    // No Trump - draw "NT" text
    drawTrumpText(ctx, 'NT', '#666', 32);
  } else if(mode === 'DOUBLES'){
    // Doubles - draw "D" text
    drawTrumpText(ctx, 'D', '#d97706', 32);
  } else {
    // Pip trump - draw actual pips using drawPipSquare
    drawPipSquare(ctx, trump, 32);
  }

  // Handle Nello
  if(session.contract === 'NELLO'){
    ctx.clearRect(0, 0, 32, 32);
    drawTrumpText(ctx, 'N', '#9333ea', 32);
  }
}

// Helper function to draw text for special trump types (NT, D, N)
function drawTrumpText(ctx, text, bgColor, size){
  const r = 4;

  // Background
  ctx.fillStyle = bgColor;
  roundRectPath(ctx, 0, 0, size, size, r);
  ctx.fill();

  // Text
  ctx.fillStyle = '#fff';
  ctx.font = `bold ${size * 0.5}px sans-serif`;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText(text, size/2, size/2);
}

/******************************************************************************
 * HARDCODED LAYOUT DATA (from TN51 101 Layout 2.JSON)
 ******************************************************************************/

const LAYOUT = {
  "sections": [
    {
      "name": "Trick_History",
      "seed": {"xN": 0.106, "yN": 0.197, "sizeW": 22, "sizeH": 112, "rz": 270, "ry": 180, "scale": 0.393},
      "grid": {"cols": 6, "rows": 8},
      "tile": [6, 1],
      "dominoes": [
        {"col": 0, "row": 0, "index": 0, "xN": 0.106, "yN": 0.197, "scale": 0.393, "rotZ": 270, "rotY": 180},
        {"col": 1, "row": 0, "index": 1, "xN": 0.106, "yN": 0.2281, "scale": 0.393, "rotZ": 270, "rotY": 180},
        {"col": 2, "row": 0, "index": 2, "xN": 0.106, "yN": 0.2592, "scale": 0.393, "rotZ": 270, "rotY": 180},
        {"col": 3, "row": 0, "index": 3, "xN": 0.106, "yN": 0.2904, "scale": 0.393, "rotZ": 270, "rotY": 180},
        {"col": 4, "row": 0, "index": 4, "xN": 0.106, "yN": 0.3215, "scale": 0.393, "rotZ": 270, "rotY": 180},
        {"col": 5, "row": 0, "index": 5, "xN": 0.106, "yN": 0.3526, "scale": 0.393, "rotZ": 270, "rotY": 180},
        {"col": 0, "row": 1, "index": 6, "xN": 0.2171, "yN": 0.197, "scale": 0.393, "rotZ": 270, "rotY": 180},
        {"col": 1, "row": 1, "index": 7, "xN": 0.2171, "yN": 0.2281, "scale": 0.393, "rotZ": 270, "rotY": 180},
        {"col": 2, "row": 1, "index": 8, "xN": 0.2171, "yN": 0.2592, "scale": 0.393, "rotZ": 270, "rotY": 180},
        {"col": 3, "row": 1, "index": 9, "xN": 0.2171, "yN": 0.2904, "scale": 0.393, "rotZ": 270, "rotY": 180},
        {"col": 4, "row": 1, "index": 10, "xN": 0.2171, "yN": 0.3215, "scale": 0.393, "rotZ": 270, "rotY": 180},
        {"col": 5, "row": 1, "index": 11, "xN": 0.2171, "yN": 0.3526, "scale": 0.393, "rotZ": 270, "rotY": 180},
        {"col": 0, "row": 2, "index": 12, "xN": 0.3282, "yN": 0.197, "scale": 0.393, "rotZ": 270, "rotY": 180},
        {"col": 1, "row": 2, "index": 13, "xN": 0.3282, "yN": 0.2281, "scale": 0.393, "rotZ": 270, "rotY": 180},
        {"col": 2, "row": 2, "index": 14, "xN": 0.3282, "yN": 0.2592, "scale": 0.393, "rotZ": 270, "rotY": 180},
        {"col": 3, "row": 2, "index": 15, "xN": 0.3282, "yN": 0.2904, "scale": 0.393, "rotZ": 270, "rotY": 180},
        {"col": 4, "row": 2, "index": 16, "xN": 0.3282, "yN": 0.3215, "scale": 0.393, "rotZ": 270, "rotY": 180},
        {"col": 5, "row": 2, "index": 17, "xN": 0.3282, "yN": 0.3526, "scale": 0.393, "rotZ": 270, "rotY": 180},
        {"col": 0, "row": 3, "index": 18, "xN": 0.4393, "yN": 0.197, "scale": 0.393, "rotZ": 270, "rotY": 180},
        {"col": 1, "row": 3, "index": 19, "xN": 0.4393, "yN": 0.2281, "scale": 0.393, "rotZ": 270, "rotY": 180},
        {"col": 2, "row": 3, "index": 20, "xN": 0.4393, "yN": 0.2592, "scale": 0.393, "rotZ": 270, "rotY": 180},
        {"col": 3, "row": 3, "index": 21, "xN": 0.4393, "yN": 0.2904, "scale": 0.393, "rotZ": 270, "rotY": 180},
        {"col": 4, "row": 3, "index": 22, "xN": 0.4393, "yN": 0.3215, "scale": 0.393, "rotZ": 270, "rotY": 180},
        {"col": 5, "row": 3, "index": 23, "xN": 0.4393, "yN": 0.3526, "scale": 0.393, "rotZ": 270, "rotY": 180},
        {"col": 0, "row": 4, "index": 24, "xN": 0.5504, "yN": 0.197, "scale": 0.393, "rotZ": 270, "rotY": 180},
        {"col": 1, "row": 4, "index": 25, "xN": 0.5504, "yN": 0.2281, "scale": 0.393, "rotZ": 270, "rotY": 180},
        {"col": 2, "row": 4, "index": 26, "xN": 0.5504, "yN": 0.2592, "scale": 0.393, "rotZ": 270, "rotY": 180},
        {"col": 3, "row": 4, "index": 27, "xN": 0.5504, "yN": 0.2904, "scale": 0.393, "rotZ": 270, "rotY": 180},
        {"col": 4, "row": 4, "index": 28, "xN": 0.5504, "yN": 0.3215, "scale": 0.393, "rotZ": 270, "rotY": 180},
        {"col": 5, "row": 4, "index": 29, "xN": 0.5504, "yN": 0.3526, "scale": 0.393, "rotZ": 270, "rotY": 180},
        {"col": 0, "row": 5, "index": 30, "xN": 0.6616, "yN": 0.197, "scale": 0.393, "rotZ": 270, "rotY": 180},
        {"col": 1, "row": 5, "index": 31, "xN": 0.6616, "yN": 0.2281, "scale": 0.393, "rotZ": 270, "rotY": 180},
        {"col": 2, "row": 5, "index": 32, "xN": 0.6616, "yN": 0.2592, "scale": 0.393, "rotZ": 270, "rotY": 180},
        {"col": 3, "row": 5, "index": 33, "xN": 0.6616, "yN": 0.2904, "scale": 0.393, "rotZ": 270, "rotY": 180},
        {"col": 4, "row": 5, "index": 34, "xN": 0.6616, "yN": 0.3215, "scale": 0.393, "rotZ": 270, "rotY": 180},
        {"col": 5, "row": 5, "index": 35, "xN": 0.6616, "yN": 0.3526, "scale": 0.393, "rotZ": 270, "rotY": 180},
        {"col": 0, "row": 6, "index": 36, "xN": 0.7727, "yN": 0.197, "scale": 0.393, "rotZ": 270, "rotY": 180},
        {"col": 1, "row": 6, "index": 37, "xN": 0.7727, "yN": 0.2281, "scale": 0.393, "rotZ": 270, "rotY": 180},
        {"col": 2, "row": 6, "index": 38, "xN": 0.7727, "yN": 0.2592, "scale": 0.393, "rotZ": 270, "rotY": 180},
        {"col": 3, "row": 6, "index": 39, "xN": 0.7727, "yN": 0.2904, "scale": 0.393, "rotZ": 270, "rotY": 180},
        {"col": 4, "row": 6, "index": 40, "xN": 0.7727, "yN": 0.3215, "scale": 0.393, "rotZ": 270, "rotY": 180},
        {"col": 5, "row": 6, "index": 41, "xN": 0.7727, "yN": 0.3526, "scale": 0.393, "rotZ": 270, "rotY": 180},
        {"col": 0, "row": 7, "index": 42, "xN": 0.8838, "yN": 0.197, "scale": 0.393, "rotZ": 270, "rotY": 180},
        {"col": 1, "row": 7, "index": 43, "xN": 0.8838, "yN": 0.2281, "scale": 0.393, "rotZ": 270, "rotY": 180},
        {"col": 2, "row": 7, "index": 44, "xN": 0.8838, "yN": 0.2592, "scale": 0.393, "rotZ": 270, "rotY": 180},
        {"col": 3, "row": 7, "index": 45, "xN": 0.8838, "yN": 0.2904, "scale": 0.393, "rotZ": 270, "rotY": 180},
        {"col": 4, "row": 7, "index": 46, "xN": 0.8838, "yN": 0.3215, "scale": 0.393, "rotZ": 270, "rotY": 180},
        {"col": 5, "row": 7, "index": 47, "xN": 0.8838, "yN": 0.3526, "scale": 0.393, "rotZ": 270, "rotY": 180}
      ]
    },
    {
      "name": "Player_1_Hand",
      "dominoes": [
        {"col": 0, "row": 0, "index": 0, "xN": 0.9, "yN": 0.9, "scale": 1.071, "rotZ": 0, "rotY": 180},
        {"col": 1, "row": 0, "index": 1, "xN": 0.7382, "yN": 0.9, "scale": 1.071, "rotZ": 0, "rotY": 180},
        {"col": 2, "row": 0, "index": 2, "xN": 0.5763, "yN": 0.9, "scale": 1.071, "rotZ": 0, "rotY": 180},
        {"col": 3, "row": 0, "index": 3, "xN": 0.4145, "yN": 0.9, "scale": 1.071, "rotZ": 0, "rotY": 180},
        {"col": 4, "row": 0, "index": 4, "xN": 0.2527, "yN": 0.9, "scale": 1.071, "rotZ": 0, "rotY": 180},
        {"col": 5, "row": 0, "index": 5, "xN": 0.0908, "yN": 0.9, "scale": 1.071, "rotZ": 0, "rotY": 180}
      ]
    },
    {
      "name": "Player_1_Played_Domino",
      "dominoes": [
        {"col": 0, "row": 0, "index": 0, "xN": 0.495, "yN": 0.678, "scale": 0.393, "rotZ": 270, "rotY": 180}
      ]
    },
    {
      "name": "Player_2_Hand",
      "dominoes": [
        {"col": 0, "row": 0, "index": 0, "xN": 0.134, "yN": 0.627, "scale": 0.393, "rotZ": 240, "rotY": 0},
        {"col": 1, "row": 0, "index": 1, "xN": 0.1618, "yN": 0.654, "scale": 0.393, "rotZ": 240, "rotY": 0},
        {"col": 2, "row": 0, "index": 2, "xN": 0.1896, "yN": 0.6809, "scale": 0.393, "rotZ": 240, "rotY": 0},
        {"col": 3, "row": 0, "index": 3, "xN": 0.2173, "yN": 0.7079, "scale": 0.393, "rotZ": 240, "rotY": 0},
        {"col": 4, "row": 0, "index": 4, "xN": 0.2451, "yN": 0.7348, "scale": 0.393, "rotZ": 240, "rotY": 0},
        {"col": 5, "row": 0, "index": 5, "xN": 0.2729, "yN": 0.7618, "scale": 0.393, "rotZ": 240, "rotY": 0}
      ]
    },
    {
      "name": "Player_2_Played_Domino",
      "dominoes": [
        {"col": 0, "row": 0, "index": 0, "xN": 0.380, "yN": 0.639, "scale": 0.393, "rotZ": 270, "rotY": 180}
      ]
    },
    {
      "name": "Player_3_Hand",
      "dominoes": [
        {"col": 0, "row": 0, "index": 0, "xN": 0.134, "yN": 0.572, "scale": 0.393, "rotZ": 120, "rotY": 0},
        {"col": 1, "row": 0, "index": 1, "xN": 0.1618, "yN": 0.545, "scale": 0.393, "rotZ": 120, "rotY": 0},
        {"col": 2, "row": 0, "index": 2, "xN": 0.1896, "yN": 0.5181, "scale": 0.393, "rotZ": 120, "rotY": 0},
        {"col": 3, "row": 0, "index": 3, "xN": 0.2173, "yN": 0.4911, "scale": 0.393, "rotZ": 120, "rotY": 0},
        {"col": 4, "row": 0, "index": 4, "xN": 0.2451, "yN": 0.4642, "scale": 0.393, "rotZ": 120, "rotY": 0},
        {"col": 5, "row": 0, "index": 5, "xN": 0.2729, "yN": 0.4372, "scale": 0.393, "rotZ": 120, "rotY": 0}
      ]
    },
    {
      "name": "Player_3_Played_Domino",
      "dominoes": [
        {"col": 0, "row": 0, "index": 0, "xN": 0.380, "yN": 0.561, "scale": 0.393, "rotZ": 270, "rotY": 180}
      ]
    },
    {
      "name": "Player_4_Hand",
      "dominoes": [
        {"col": 0, "row": 0, "index": 0, "xN": 0.356, "yN": 0.411, "scale": 0.393, "rotZ": 180, "rotY": 0},
        {"col": 1, "row": 0, "index": 1, "xN": 0.4116, "yN": 0.411, "scale": 0.393, "rotZ": 180, "rotY": 0},
        {"col": 2, "row": 0, "index": 2, "xN": 0.4671, "yN": 0.411, "scale": 0.393, "rotZ": 180, "rotY": 0},
        {"col": 3, "row": 0, "index": 3, "xN": 0.5227, "yN": 0.411, "scale": 0.393, "rotZ": 180, "rotY": 0},
        {"col": 4, "row": 0, "index": 4, "xN": 0.5782, "yN": 0.411, "scale": 0.393, "rotZ": 180, "rotY": 0},
        {"col": 5, "row": 0, "index": 5, "xN": 0.6338, "yN": 0.411, "scale": 0.393, "rotZ": 180, "rotY": 0}
      ]
    },
    {
      "name": "Player_4_Played_Domino",
      "dominoes": [
        {"col": 0, "row": 0, "index": 0, "xN": 0.495, "yN": 0.522, "scale": 0.393, "rotZ": 270, "rotY": 180}
      ]
    },
    {
      "name": "Player_5_Hand",
      "dominoes": [
        {"col": 0, "row": 0, "index": 0, "xN": 0.86, "yN": 0.572, "scale": 0.393, "rotZ": 60, "rotY": 0},
        {"col": 1, "row": 0, "index": 1, "xN": 0.8322, "yN": 0.545, "scale": 0.393, "rotZ": 60, "rotY": 0},
        {"col": 2, "row": 0, "index": 2, "xN": 0.8044, "yN": 0.5181, "scale": 0.393, "rotZ": 60, "rotY": 0},
        {"col": 3, "row": 0, "index": 3, "xN": 0.7767, "yN": 0.4911, "scale": 0.393, "rotZ": 60, "rotY": 0},
        {"col": 4, "row": 0, "index": 4, "xN": 0.7489, "yN": 0.4642, "scale": 0.393, "rotZ": 60, "rotY": 0},
        {"col": 5, "row": 0, "index": 5, "xN": 0.7211, "yN": 0.4372, "scale": 0.393, "rotZ": 60, "rotY": 0}
      ]
    },
    {
      "name": "Player_5_Played_Domino",
      "dominoes": [
        {"col": 0, "row": 0, "index": 0, "xN": 0.610, "yN": 0.561, "scale": 0.393, "rotZ": 270, "rotY": 180}
      ]
    },
    {
      "name": "Player_6_Hand",
      "dominoes": [
        {"col": 0, "row": 0, "index": 0, "xN": 0.86, "yN": 0.627, "scale": 0.393, "rotZ": 300, "rotY": 0},
        {"col": 1, "row": 0, "index": 1, "xN": 0.8322, "yN": 0.654, "scale": 0.393, "rotZ": 300, "rotY": 0},
        {"col": 2, "row": 0, "index": 2, "xN": 0.8044, "yN": 0.6809, "scale": 0.393, "rotZ": 300, "rotY": 0},
        {"col": 3, "row": 0, "index": 3, "xN": 0.7767, "yN": 0.7079, "scale": 0.393, "rotZ": 300, "rotY": 0},
        {"col": 4, "row": 0, "index": 4, "xN": 0.7489, "yN": 0.7348, "scale": 0.393, "rotZ": 300, "rotY": 0},
        {"col": 5, "row": 0, "index": 5, "xN": 0.7211, "yN": 0.7618, "scale": 0.393, "rotZ": 300, "rotY": 0}
      ]
    },
    {
      "name": "Player_6_Played_Domino",
      "dominoes": [
        {"col": 0, "row": 0, "index": 0, "xN": 0.610, "yN": 0.639, "scale": 0.393, "rotZ": 270, "rotY": 180}
      ]
    },
    {
      "name": "Lead_Domino",
      "dominoes": [
        {"col": 0, "row": 0, "index": 0, "xN": 0.495, "yN": 0.600, "scale": 0.393, "rotZ": 0, "rotY": 180}
      ]
    }
  ],
  "totalDominoes": 91
};

// Placeholder positions (same as played positions, used for info boxes)
const PLACEHOLDER_CONFIG = {
  // width and height in pixels for rectangular placeholders (domino-shaped)
  dominoWidth: 44,
  dominoHeight: 22,
  // Square size for lead placeholder
  leadSize: 28,
  // Player placeholder positions (match played domino positions)
  players: {
    1: { xN: 0.495, yN: 0.678 },  // P1: bottom center
    2: { xN: 0.380, yN: 0.639 },  // P2: bottom-left
    3: { xN: 0.380, yN: 0.561 },  // P3: top-left
    4: { xN: 0.495, yN: 0.522 },  // P4: top center
    5: { xN: 0.610, yN: 0.561 },  // P5: top-right
    6: { xN: 0.610, yN: 0.639 }   // P6: bottom-right
  },
  lead: { xN: 0.495, yN: 0.600 }
};

/******************************************************************************
 * END LAYOUT DATA
 ******************************************************************************/

const shadowLayer = document.getElementById('shadowLayer');
const spriteLayer = document.getElementById('spriteLayer');
const statusBar = document.getElementById('statusBar');
const BASE_W = 56, BASE_H = 112;

// All 36 game sprites (6 per player)
// sprites[playerIndex][handIndex] = { sprite, tile, originalSlot }
const sprites = [];

// Track current game state
let currentTrick = 0;
let playedThisTrick = [];
let isAnimating = false;
let waitingForPlayer1 = true;
let leadDominoSprite = null;  // The sprite shown in center indicating lead suit
let placeholderElements = {}; // Store placeholder DOM elements

// Scoring state
let team1Score = 0;
let team2Score = 0;
let team1Marks = 0;
let team2Marks = 0;

// Track trick wins by team for trick history layout
// team1TricksWon = number of tricks won by team 1 this hand
// team2TricksWon = number of tricks won by team 2 this hand
let team1TricksWon = 0;
let team2TricksWon = 0;
// Moon: per-player trick count (index = player seat)
let moonPlayerTricksWon = [0, 0, 0];

// Clockwise order: P1 -> P2 -> P3 -> P4 -> P5 -> P6
let PLAY_ORDER = [1, 2, 3, 4, 5, 6];

/******************************************************************************
 * SCORING & TALLY MARKS
 ******************************************************************************/

// Draw tally marks on a canvas (max 15 marks = 3 groups of 5)
// Hand-drawn style with slight variations - RIGHT ALIGNED
// Groups fill from right to left, but lines within each group draw left-to-right
function drawTallyMarks(canvas, count, teamColor){
  const ctx = canvas.getContext('2d');
  const w = canvas.width;
  ctx.clearRect(0, 0, canvas.width, canvas.height);

  if(count <= 0) return;

  // If count > 15, increase canvas height for extra rows
  const rowCapacity = 15;
  const numRows = Math.ceil(count / rowCapacity);
  const rowH = 24;  // height per row
  const totalH = numRows * rowH;
  if(canvas.height !== totalH){
    canvas.height = totalH;
    canvas.style.height = totalH + 'px';
  }
  const h = rowH;  // each row is this tall

  // Draw each row
  for(let row = 0; row < numRows; row++){
    const rowCount = (row < numRows - 1) ? rowCapacity : (count - row * rowCapacity);
    const yOffset = row * rowH;
    _drawTallyRow(ctx, w, h, yOffset, rowCount, teamColor);
  }
}

function _drawTallyRow(ctx, w, h, yOffset, count, teamColor){
  // Tally mark dimensions
  const lineHeight = h * 0.75;
  const lineWidth = 2;
  const gapBetweenLines = 5;  // Gap between vertical lines within a group
  const groupGap = 8;  // Gap between groups of 5

  ctx.strokeStyle = teamColor;
  ctx.lineCap = 'round';
  ctx.lineWidth = lineWidth;

  // Calculate how many complete groups of 5 and remaining
  const completeGroups = Math.floor(count / 5);
  const remainder = count % 5;

  // Calculate total width needed
  // Each complete group: 4 lines * gapBetweenLines = 20px (the 5th is a diagonal)
  // Remainder: remainder * gapBetweenLines
  // Group gaps: completeGroups * groupGap (if there's also a remainder)
  const completeGroupWidth = 4 * gapBetweenLines;  // Width of 4 vertical lines
  const remainderWidth = remainder > 0 ? remainder * gapBetweenLines : 0;
  const totalGroupGaps = (completeGroups > 0 && remainder > 0) ? groupGap : 0;
  const betweenCompleteGroupGaps = (completeGroups > 1) ? (completeGroups - 1) * groupGap : 0;

  const totalWidth = (completeGroups * completeGroupWidth) + remainderWidth + totalGroupGaps + betweenCompleteGroupGaps;

  // Start from right edge, work backwards
  let x = w - 2;  // Starting x position (right edge with padding)

  // Draw the incomplete group first (rightmost, these are the most recent marks)
  if(remainder > 0){
    // Draw remainder lines from right to left, but facing normal direction
    for(let line = remainder - 1; line >= 0; line--){
      const jitterX = (Math.random() - 0.5) * 1;
      const jitterY1 = (Math.random() - 0.5) * 1.5;
      const jitterY2 = (Math.random() - 0.5) * 1.5;
      const jitterAngle = (Math.random() - 0.5) * 0.08;

      ctx.save();
      ctx.translate(x + jitterX, yOffset + h / 2);
      ctx.rotate(jitterAngle);
      ctx.beginPath();
      ctx.moveTo(0, -lineHeight / 2 + jitterY1);
      ctx.lineTo(0, lineHeight / 2 + jitterY2);
      ctx.stroke();
      ctx.restore();

      x -= gapBetweenLines;
    }

    if(completeGroups > 0) x -= groupGap;  // Gap before complete groups
  }

  // Draw complete groups (from right to left - newest to oldest)
  for(let g = 0; g < completeGroups; g++){
    // Draw the group from right to left
    // Position for rightmost (4th) line
    const groupEndX = x;

    // Draw 4 vertical lines from right to left
    for(let line = 3; line >= 0; line--){
      const jitterX = (Math.random() - 0.5) * 1;
      const jitterY1 = (Math.random() - 0.5) * 1.5;
      const jitterY2 = (Math.random() - 0.5) * 1.5;
      const jitterAngle = (Math.random() - 0.5) * 0.08;

      ctx.save();
      ctx.translate(x + jitterX, yOffset + h / 2);
      ctx.rotate(jitterAngle);
      ctx.beginPath();
      ctx.moveTo(0, -lineHeight / 2 + jitterY1);
      ctx.lineTo(0, lineHeight / 2 + jitterY2);
      ctx.stroke();
      ctx.restore();

      x -= gapBetweenLines;
    }

    const groupStartX = x + gapBetweenLines;  // Left edge of group

    // Draw diagonal slash through the 4 lines (from bottom-left to top-right)
    const jitterY1 = (Math.random() - 0.5) * 1.5;
    const jitterY2 = (Math.random() - 0.5) * 1.5;
    ctx.beginPath();
    ctx.moveTo(groupStartX - 1, yOffset + h / 2 + lineHeight / 2 - 2 + jitterY1);
    ctx.lineTo(groupEndX + 1, yOffset + h / 2 - lineHeight / 2 + 2 + jitterY2);
    ctx.stroke();

    if(g < completeGroups - 1) x -= groupGap;  // Gap before next group
  }
}

// Update the score display
function updateScoreDisplay(){
  if(GAME_MODE === 'MOON'){
    // Moon: individual player scores
    var moonBar = document.getElementById('moonScoreBar');
    if(moonBar){
      moonBar.style.display = 'flex';
      for(var s = 0; s < 3; s++){
        var el = document.getElementById('moonP'+(s+1)+'Score');
        if(el) el.textContent = session ? session.team_marks[s] : 0;
        var tEl = document.getElementById('moonP'+(s+1)+'Tricks');
        if(tEl) tEl.textContent = session && session.game ? session.game.tricks_team[s].length : 0;
        var bEl = document.getElementById('moonP'+(s+1)+'Bid');
        if(bEl){
          if(session && session.bid_winner_seat === s) bEl.textContent = session.current_bid + (session.moon_shoot ? '\u2605' : '');
          else bEl.textContent = '-';
        }
      }
    }
    var t1p = document.getElementById('team1Pill');
    var t2p = document.getElementById('team2Pill');
    var mp = document.getElementById('marksPill');
    if(t1p) t1p.style.display = 'none';
    if(t2p) t2p.style.display = 'none';
    if(mp) mp.style.display = 'none';
    return;
  }
  // Show team UI, hide Moon UI
  var t1p2 = document.getElementById('team1Pill');
  var t2p2 = document.getElementById('team2Pill');
  var mp2 = document.getElementById('marksPill');
  if(t1p2) t1p2.style.display = '';
  if(t2p2) t2p2.style.display = '';
  if(mp2) mp2.style.display = '';
  var moonBar2 = document.getElementById('moonScoreBar');
  if(moonBar2) moonBar2.style.display = 'none';

  document.getElementById('team1Score').textContent = team1Score;
  document.getElementById('team2Score').textContent = team2Score;

  // Update score bars (assuming 250 points to win)
  const maxPoints = 250;
  document.getElementById('team1Fill').style.width = Math.min(100, (team1Score / maxPoints) * 100) + '%';
  document.getElementById('team2Fill').style.width = Math.min(100, (team2Score / maxPoints) * 100) + '%';

  // Update tally marks
  const canvas1 = document.getElementById('tallyCanvas1');
  const canvas2 = document.getElementById('tallyCanvas2');
  drawTallyMarks(canvas1, team1Marks, 'rgba(59,130,246,0.9)');  // Blue for team 1
  drawTallyMarks(canvas2, team2Marks, 'rgba(239,68,68,0.9)');   // Red for team 2
}

// ── Moon Widow Swap ──
// Helper: render a domino tile as a canvas image
function renderDominoCanvas(tile, w, h){
  const cvs = document.createElement('canvas');
  cvs.width = w || 36;
  cvs.height = h || 72;
  const ctx = cvs.getContext('2d');
  drawFace(ctx, tile, cvs.width, cvs.height, false, true, 0);
  return cvs;
}

function showWidowSwap(){
  if(!session || !session.moon_widow || session.phase !== PHASE_MOON_WIDOW) return;
  const bidderSeat = session.bid_winner_seat !== undefined ? session.bid_winner_seat : 0;
  if(!ppIsHuman(bidderSeat)){
    aiWidowSwap(bidderSeat);
    return;
  }

  // Flip widow face-up on the table for the bid winner
  updateWidowDisplay();
  if(widowSprite){
    var wPose = widowSprite.getPose();
    animateSprite(widowSprite, Object.assign({}, wPose, { ry: 180 }), 400);
  }

  // Create small popup
  var popup = document.getElementById('widowSwapPopup');
  if(!popup){
    popup = document.createElement('div');
    popup.id = 'widowSwapPopup';
    document.body.appendChild(popup);
  }
  var swX = ((MOON_SETTINGS.widowSwapX || 0.50) * 100).toFixed(1);
  var swY = ((MOON_SETTINGS.widowSwapY || 0.50) * 100).toFixed(1);
  var swS = MOON_SETTINGS.widowSwapScale || 1.0;
  popup.style.cssText = 'position:fixed;top:' + swY + '%;left:' + swX + '%;transform:translate(-50%,-50%) scale(' + swS + ');z-index:1200;background:linear-gradient(135deg,#1e293b,#0f172a);border-radius:14px;padding:18px 24px;color:#fff;text-align:center;min-width:260px;max-width:85%;border:1px solid rgba(255,255,255,0.15);box-shadow:0 8px 32px rgba(0,0,0,0.6);';
  popup.style.display = 'block';
  popup.innerHTML = '';

  var _widowSwapState = { selectedIdx: -1 };

  var titleDiv = document.createElement('div');
  titleDiv.style.cssText = 'font-size:16px;font-weight:700;margin-bottom:8px;color:#eab308;';
  titleDiv.textContent = 'Widow Swap';
  popup.appendChild(titleDiv);

  var instrDiv = document.createElement('div');
  instrDiv.style.cssText = 'font-size:12px;color:rgba(255,255,255,0.7);margin-bottom:14px;line-height:1.4;';
  instrDiv.textContent = 'Click a domino in your hand to swap with the widow, or keep your hand.';
  popup.appendChild(instrDiv);

  var keepBtn = document.createElement('button');
  keepBtn.id = 'widowKeepBtn';
  keepBtn.style.cssText = 'padding:8px 20px;border-radius:8px;border:none;background:#22c55e;color:#fff;cursor:pointer;font-size:13px;font-weight:600;margin:4px;';
  keepBtn.textContent = "Don't Swap";
  popup.appendChild(keepBtn);

  var confirmBtn = document.createElement('button');
  confirmBtn.id = 'widowConfirmBtn';
  confirmBtn.style.cssText = 'display:none;padding:8px 20px;border-radius:8px;border:none;background:#3b82f6;color:#fff;cursor:pointer;font-size:13px;font-weight:600;margin:4px;';
  confirmBtn.textContent = 'Confirm Swap';
  popup.appendChild(confirmBtn);

  var localSeat = getLocalSeat();
  var seatSprites = sprites[localSeat] || [];

  window._widowSwapClickHandler = function(spriteSlotIndex){
    var spriteData = seatSprites[spriteSlotIndex];
    if(!spriteData || !spriteData.tile) return;
    _widowSwapState.selectedIdx = spriteSlotIndex;
    var tile = spriteData.tile;

    for(var s = 0; s < seatSprites.length; s++){
      if(seatSprites[s] && seatSprites[s].sprite){
        seatSprites[s].sprite.setState(false, true);
      }
    }
    spriteData.sprite.setState(true, true);

    instrDiv.textContent = tile[0] + '-' + tile[1] + ' selected. Confirm swap or pick a different domino.';
    confirmBtn.style.display = 'inline-block';
  };

  window._widowSwapMode = true;

  keepBtn.addEventListener('click', function(){
    _cleanupWidowSwap();
    session.skipWidow();
    popup.style.display = 'none';
    updateWidowDisplay();
    afterWidowSwap();
  });

  confirmBtn.addEventListener('click', function(){
    var idx = _widowSwapState.selectedIdx;
    if(idx < 0) return;

    var spriteData = seatSprites[idx];
    if(!spriteData || !spriteData.tile) return;

    var handTile = spriteData.tile;
    var gameHand = session.game.hands[localSeat];
    var handIdx = -1;
    for(var gi = 0; gi < gameHand.length; gi++){
      if(gameHand[gi][0] === handTile[0] && gameHand[gi][1] === handTile[1]){
        handIdx = gi;
        break;
      }
    }
    if(handIdx < 0) return;

    _cleanupWidowSwap();
    popup.style.display = 'none';

    // Get positions before data swap
    var handSprite = spriteData.sprite;
    var handPose = handSprite.getPose();
    var widowPose = widowSprite ? widowSprite.getPose() : getWidowPose();

    // Do the data swap in session
    session.swapWidow(handIdx);

    // Animate sprites swapping positions
    var swapDuration = 500;
    var promises = [];

    if(widowSprite && handSprite){
      // Hand tile flies to widow position (becomes the discard, face up)
      promises.push(animateSprite(handSprite, Object.assign({}, widowPose, { ry: 180 }), swapDuration));
      // Widow tile flies to hand position (joins the hand)
      promises.push(animateSprite(widowSprite, Object.assign({}, handPose), swapDuration));
    }

    Promise.all(promises).then(function(){
      // handSprite flew to widow position — it becomes the new widowSprite
      // V12.5: Save reference to old widow sprite before reassigning
      var oldWidowEl = widowSprite;
      widowSprite = handSprite;
      widowSprite.id = 'widowSpriteEl';
      widowSprite._tile = session.moon_widow;
      widowSprite.redrawCanvases();
      var finalWidowPose = getWidowPose();
      finalWidowPose.ry = 180;
      widowSprite.setPose(finalWidowPose);

      // V10_106: Fix #7 — Clean full rebuild of hand sprites after widow swap
      // Remove ALL old hand sprites for this seat, then create fresh from game hand
      var gameHand = session.game.hands[localSeat];
      var playerNum = seatToPlayer(localSeat);
      // Remove old hand sprites (NOT widowSprite — that's the discarded tile on table)
      for(var si = 0; si < seatSprites.length; si++){
        if(seatSprites[si] && seatSprites[si].sprite && seatSprites[si].sprite !== widowSprite){
          if(seatSprites[si].sprite._shadow) seatSprites[si].sprite._shadow.remove();
          seatSprites[si].sprite.remove();
        }
      }
      // Create fresh sprites for current hand
      var newSprites = [];
      for(var hi = 0; hi < gameHand.length; hi++){
        var gameTile = gameHand[hi];
        if(!gameTile) continue;
        var freshSprite = makeSprite(gameTile);
        var slotPos = getHandPosition(playerNum, hi);
        if(slotPos){
          freshSprite.setPose(slotPos);
          if(freshSprite._shadow) shadowLayer.appendChild(freshSprite._shadow);
          spriteLayer.appendChild(freshSprite);
          freshSprite.setFaceUp(true);
          (function(spr){
            spr.addEventListener('click', function(){ handlePlayer1Click(spr); });
            spr.addEventListener('touchstart', function(e){
              e.preventDefault(); e.stopPropagation();
              handlePlayer1Click(spr);
            }, { passive: false });
          })(freshSprite);
          newSprites[hi] = { sprite: freshSprite, tile: gameTile, originalSlot: hi };
        }
      }
      sprites[localSeat] = newSprites;

      // V12.5: Remove old widow sprite (flew to hand pos, now replaced by fresh sprites)
      if(oldWidowEl && oldWidowEl !== widowSprite){
        if(oldWidowEl._shadow) oldWidowEl._shadow.remove();
        oldWidowEl.remove();
      }

      var lbl = document.getElementById('moonWidowLabel');
      if(lbl) lbl.textContent = 'Discard';

      syncSpritesWithGameState();
      afterWidowSwap();
    });
  });
}

function _cleanupWidowSwap(){
  window._widowSwapMode = false;
  window._widowSwapClickHandler = null;
  // Clear highlights
  var localSeat = getLocalSeat();
  var seatSprites = sprites[localSeat] || [];
  for(var s = 0; s < seatSprites.length; s++){
    if(seatSprites[s] && seatSprites[s].sprite){
      seatSprites[s].sprite.setState(false, true);
    }
  }
}

function aiWidowSwap(seat){
  // Simple AI: swap widow with worst tile if widow is better
  if(!session || !session.moon_widow) { session.skipWidow(); afterWidowSwap(); return; }
  var hand = session.game.hands[seat];
  var widow = session.moon_widow;
  var trumpSuit = session.game.trump_suit;
  var trumpMode = session.game.trump_mode;

  function tileValue(t){
    var val = t[0] + t[1];
    // Trump tiles are more valuable
    if(trumpMode === 'PIP' && (t[0] === trumpSuit || t[1] === trumpSuit)) val += 20;
    if(trumpMode === 'DOUBLES' && t[0] === t[1]) val += 20;
    if(t[0] === t[1]) val += 10; // Doubles generally strong
    return val;
  }

  var widowVal = tileValue(widow);
  var worstIdx = 0, worstVal = tileValue(hand[0]);
  for(var i = 1; i < hand.length; i++){
    var v = tileValue(hand[i]);
    if(v < worstVal){ worstVal = v; worstIdx = i; }
  }
  if(widowVal > worstVal){
    session.swapWidow(worstIdx);
    rebuildHandSprites(seat);
    syncSpritesWithGameState();
  } else {
    session.skipWidow();
  }
  afterWidowSwap();
}

// ===== MOON WIDOW ON-TABLE DISPLAY =====
var MOON_SETTINGS = {
  ind1x: 0.495, ind1y: 0.8,
  ind2x: 0.25, ind2y: 0.65,
  ind3x: 0.75, ind3y: 0.65,
  p1HandScale: 0.87, p1HandX: 0.895, p1HandY: 0.915, p1HandSpacing: 0.132,
  p2HandScale: 0.695, p2HandX: 0.1, p2HandY: 0.65, p2HandSpacing: 0.049,
  p3HandScale: 0.695, p3HandX: 0.905, p3HandY: 0.65, p3HandSpacing: 0.049,
  trickScale: 0.30,
  thScale: 0.30,
  thColSpacing: 0.103,
  thRowSpacing: 0.022,
  thBlockGap: 0.003,
  thBaseX: 0.12,
  widowLabelY: -30,
  widowHorizontal: true,
  widowScale: 1.37,
  widowSwapX: 0.5,
  widowSwapY: 0.655,
  widowSwapScale: 1.0,
  trickHistoryX: 0,
  trickHistoryY: 13,
  bidPopupX: 0.47,
  bidPopupY: 0.485
};
(function loadMoonSettings(){
  try {
    var saved = localStorage.getItem('tn51_moon_settings');
    if(saved){ Object.assign(MOON_SETTINGS, JSON.parse(saved)); }
  } catch(e){}
})();

var MOON_WIDOW_POS = { xN: 0.5, yN: 0.42 }; // Centered
var widowSprite = null; // Actual domino sprite for the widow tile
(function loadMoonWidowPos(){
  try {
    var saved = localStorage.getItem('tn51_moon_widow_pos');
    if(saved){ var p = JSON.parse(saved); MOON_WIDOW_POS = p; }
  } catch(e){}
})();

function getWidowPose(){
  // Calculate the pose for the widow sprite based on MOON_WIDOW_POS and settings
  var wScale = MOON_SETTINGS.widowScale || 1.0;
  var isHoriz = MOON_SETTINGS.widowHorizontal;
  var px = normToPx(MOON_WIDOW_POS.xN, MOON_WIDOW_POS.yN);
  return {
    x: px.x - 28,
    y: px.y - 56,
    s: wScale * 0.5,
    rz: isHoriz ? 270 : 0,
    ry: 0 // face down by default
  };
}

function updateWidowDisplay(){
  if(GAME_MODE !== 'MOON' || !session || !session.moon_widow){
    if(widowSprite){
      widowSprite.style.display = 'none';
      if(widowSprite._shadow) widowSprite._shadow.style.display = 'none';
    }
    var lbl = document.getElementById('moonWidowLabel');
    if(lbl) lbl.style.display = 'none';
    return;
  }

  // Create widow sprite if it does not exist yet
  if(!widowSprite){
    widowSprite = makeSprite(session.moon_widow);
    widowSprite.id = 'widowSpriteEl';
    if(widowSprite._shadow) shadowLayer.appendChild(widowSprite._shadow);
    spriteLayer.appendChild(widowSprite);
  }

  // Update tile data if widow changed (after swap, the discarded tile is the new moon_widow)
  if(widowSprite._tile[0] !== session.moon_widow[0] || widowSprite._tile[1] !== session.moon_widow[1]){
    widowSprite._tile = session.moon_widow;
    widowSprite.redrawCanvases();
  }

  widowSprite.style.display = '';
  if(widowSprite._shadow) widowSprite._shadow.style.display = '';

  // Determine face-up/down state
  var bidDone = session.phase !== 'NEED_BID' && session.phase !== 'BIDDING';
  var localSeat = typeof getLocalSeat === 'function' ? getLocalSeat() : 0;
  var isBidWinner = session.bid_winner_seat === localSeat;

  var pose = getWidowPose();

  if(!bidDone){
    pose.ry = 0;
  } else if(session.phase === 'MOON_WIDOW'){
    pose.ry = isBidWinner ? 180 : 0;
  } else {
    pose.ry = 180;
    session._widowRevealed = true;
  }

  widowSprite.setPose(pose);

  // Position the "Widow"/"Discard" label above the sprite
  var lbl = document.getElementById('moonWidowLabel');
  if(lbl){
    lbl.style.display = 'block';
    var labelPx = normToPx(MOON_WIDOW_POS.xN, MOON_WIDOW_POS.yN);
    lbl.style.left = (labelPx.x - 20) + 'px';
    var labelYOff = MOON_SETTINGS.widowLabelY !== undefined ? MOON_SETTINGS.widowLabelY : -70;
    lbl.style.top = (labelPx.y + labelYOff) + 'px';
    if(!bidDone || session.phase === 'MOON_WIDOW'){
      lbl.textContent = 'Widow';
    } else {
      lbl.textContent = 'Discard';
    }
  }
}

function drawFaceDown(ctx, w, h){
  // Simple face-down domino rendering
  var r = 4;
  ctx.fillStyle = '#1a3a1a';
  ctx.beginPath();
  ctx.moveTo(r, 0);
  ctx.lineTo(w - r, 0);
  ctx.quadraticCurveTo(w, 0, w, r);
  ctx.lineTo(w, h - r);
  ctx.quadraticCurveTo(w, h, w - r, h);
  ctx.lineTo(r, h);
  ctx.quadraticCurveTo(0, h, 0, h - r);
  ctx.lineTo(0, r);
  ctx.quadraticCurveTo(0, 0, r, 0);
  ctx.closePath();
  ctx.fill();
  ctx.strokeStyle = '#2a5a2a';
  ctx.lineWidth = 1.5;
  ctx.stroke();
  // Center diamond pattern
  ctx.fillStyle = '#2a5a2a';
  var cx = w/2, cy = h/2, ds = 8;
  ctx.beginPath();
  ctx.moveTo(cx, cy - ds);
  ctx.lineTo(cx + ds, cy);
  ctx.lineTo(cx, cy + ds);
  ctx.lineTo(cx - ds, cy);
  ctx.closePath();
  ctx.fill();
}

function animateWidowFlip(callback){
  // Animate widow sprite flipping from face-down to face-up using ry rotation
  if(!widowSprite) { if(callback) callback(); return; }
  var pose = widowSprite.getPose();
  var targetPose = Object.assign({}, pose, { ry: 180 });
  updateWidowDisplay(); // Ensure tile data is current
  animateSprite(widowSprite, targetPose, 400).then(function(){
    if(callback) callback();
  });
}

function showMoonSettingsPanel(){
  var existing = document.getElementById('moonSettingsPanel');
  if(existing){ existing.remove(); return; }

  // V12.10.2: Modal backdrop style matching TN51/T42 panels
  var backdrop = document.createElement('div');
  backdrop.id = 'moonSettingsPanel';
  backdrop.className = 'modalBackdrop';
  backdrop.style.cssText = 'display:flex;z-index:2000;';
  backdrop.addEventListener('click', function(e){ if(e.target === backdrop) backdrop.remove(); });

  var modalDiv = document.createElement('div');
  modalDiv.className = 'modal';
  modalDiv.style.cssText = 'width:360px;max-height:85vh;overflow-y:auto;';

  var header = document.createElement('div');
  header.className = 'modalHeader';
  header.style.cssText = 'padding:12px 16px;';
  var titleSpan = document.createElement('span');
  titleSpan.style.cssText = 'font-weight:700;font-size:15px;';
  titleSpan.textContent = 'Moon Layout Settings';
  header.appendChild(titleSpan);
  var closeX = document.createElement('button');
  closeX.className = 'closeBtn';
  closeX.innerHTML = '&times;';
  closeX.onclick = function(){ backdrop.remove(); };
  header.appendChild(closeX);
  modalDiv.appendChild(header);

  var panel = document.createElement('div');
  panel.className = 'modalBody';
  panel.style.cssText = 'padding:12px 16px;';
  modalDiv.appendChild(panel);
  backdrop.appendChild(modalDiv);

  function addSlider(label, key, obj, min, max, step, onUpdate){
    var val = obj[key];
    var isRaw = (min < 0);
    var group = document.createElement('div');
    group.className = 't42s-group';
    var lbl = document.createElement('label');
    function fmtVal(v){
      if(isRaw) return v.toFixed(1);
      return (v*100).toFixed(1) + '%';
    }
    lbl.textContent = label;
    group.appendChild(lbl);
    var sl = document.createElement('input');
    sl.type = 'range'; sl.min = String(min); sl.max = String(max); sl.step = String(step);
    sl.value = String(isRaw ? val : val * 100);
    sl.style.width = '220px';
    sl.style.verticalAlign = 'middle';
    var valSpan = document.createElement('span');
    valSpan.textContent = (typeof val === 'number' ? fmtVal(val) : val);
    sl.oninput = function(){
      var v = parseFloat(this.value);
      obj[key] = isRaw ? v : v / 100;
      valSpan.textContent = (typeof obj[key] === 'number' ? fmtVal(obj[key]) : obj[key]);
      if(onUpdate) onUpdate();
    };
    group.appendChild(sl);
    group.appendChild(valSpan);
    panel.appendChild(group);
  }

  function addSection(text){
    var s = document.createElement('div');
    s.className = 't42s-section';
    s.textContent = text;
    panel.appendChild(s);
  }

  var saveMoon = function(){
    // V10_122e: Wrap localStorage in try-catch for iOS Safari private mode
    try {
      localStorage.setItem('tn51_moon_settings', JSON.stringify(MOON_SETTINGS));
    } catch(e) {
      console.warn('[iOS] localStorage write error:', e);
    }
    if(typeof positionPlayerIndicators === 'function') positionPlayerIndicators();
    // Reposition all trick history sprites with updated settings
    if(typeof repositionTrickHistorySprites === 'function') repositionTrickHistorySprites();
    // Live-update swap popup position if visible
    var swPopup = document.getElementById('widowSwapPopup');
    if(swPopup && swPopup.style.display !== 'none'){
      var swX = ((MOON_SETTINGS.widowSwapX || 0.50) * 100).toFixed(1);
      var swY = ((MOON_SETTINGS.widowSwapY || 0.50) * 100).toFixed(1);
      var swS = MOON_SETTINGS.widowSwapScale || 1.0;
      swPopup.style.top = swY + '%';
      swPopup.style.left = swX + '%';
      swPopup.style.transform = 'translate(-50%,-50%) scale(' + swS + ')';
    }
    // Live-update bid popup position
    var bidPanel = document.querySelector('#bidBackdrop .modalPanel');
    if(bidPanel){
      var bpX = ((MOON_SETTINGS.bidPopupX || 0.50) * 100).toFixed(1);
      var bpY = ((MOON_SETTINGS.bidPopupY || 0.08) * 100).toFixed(1);
      bidPanel.style.position = 'absolute';
      bidPanel.style.left = bpX + 'vw';
      bidPanel.style.top = bpY + 'vh';
      bidPanel.style.transform = 'translateX(-50%)';
    }
  };
  var saveWidow = function(){
    // V10_122e: Wrap localStorage in try-catch for iOS Safari private mode
    try {
      localStorage.setItem('tn51_moon_widow_pos', JSON.stringify(MOON_WIDOW_POS));
    } catch(e) {
      console.warn('[iOS] localStorage write error:', e);
    }
    if(typeof updateWidowDisplay === 'function') updateWidowDisplay();
  };

  // Widow section
  addSection('Widow');
  addSlider('Widow X', 'xN', MOON_WIDOW_POS, 0, 100, 0.5, saveWidow);
  addSlider('Widow Y', 'yN', MOON_WIDOW_POS, 0, 100, 0.5, saveWidow);
  addSlider('Widow Scale', 'widowScale', MOON_SETTINGS, 0, 200, 1, function(){ saveMoon(); updateWidowDisplay(); });

  // Widow orientation toggle
  var orientDiv = document.createElement('div');
  orientDiv.style.cssText = 'margin-bottom:8px;';
  var orientLabel = document.createElement('label');
  orientLabel.style.cssText = 'font-size:11px;color:#fff;cursor:pointer;display:flex;align-items:center;gap:6px;';
  var orientChk = document.createElement('input');
  orientChk.type = 'checkbox';
  orientChk.checked = MOON_SETTINGS.widowHorizontal;
  orientChk.style.cssText = 'accent-color:#eab308;';
  orientChk.onchange = function(){
    MOON_SETTINGS.widowHorizontal = this.checked;
    saveMoon();
    updateWidowDisplay();
  };
  orientLabel.appendChild(orientChk);
  orientLabel.appendChild(document.createTextNode('Horizontal widow'));
  orientDiv.appendChild(orientLabel);
  panel.appendChild(orientDiv);

  addSlider('Label Y Offset', 'widowLabelY', MOON_SETTINGS, -150, 50, 1, function(){ saveMoon(); updateWidowDisplay(); });

  // Hands section
  addSection('P1 Hand (You)');
  var saveMoonLayout = function(){ saveMoon(); if(typeof applyMoonSettings === 'function') applyMoonSettings(); if(typeof refreshMoonGhosts === 'function') refreshMoonGhosts(); };
  addSlider('P1 Scale', 'p1HandScale', MOON_SETTINGS, 0, 200, 0.5, saveMoonLayout);
  addSlider('P1 X', 'p1HandX', MOON_SETTINGS, 0, 100, 0.5, saveMoonLayout);
  addSlider('P1 Y', 'p1HandY', MOON_SETTINGS, 0, 100, 0.5, saveMoonLayout);
  addSlider('P1 Spacing', 'p1HandSpacing', MOON_SETTINGS, 0, 30, 0.1, saveMoonLayout);

  addSection('P2 Hand (Left)');
  addSlider('P2 Scale', 'p2HandScale', MOON_SETTINGS, 0, 200, 0.5, saveMoonLayout);
  addSlider('P2 X', 'p2HandX', MOON_SETTINGS, 0, 100, 0.5, saveMoonLayout);
  addSlider('P2 Y', 'p2HandY', MOON_SETTINGS, 0, 100, 0.5, saveMoonLayout);
  addSlider('P2 Spacing', 'p2HandSpacing', MOON_SETTINGS, 0, 30, 0.1, saveMoonLayout);

  addSection('P3 Hand (Right)');
  addSlider('P3 Scale', 'p3HandScale', MOON_SETTINGS, 0, 200, 0.5, saveMoonLayout);
  addSlider('P3 X', 'p3HandX', MOON_SETTINGS, 0, 100, 0.5, saveMoonLayout);
  addSlider('P3 Y', 'p3HandY', MOON_SETTINGS, 0, 100, 0.5, saveMoonLayout);
  addSlider('P3 Spacing', 'p3HandSpacing', MOON_SETTINGS, 0, 30, 0.1, saveMoonLayout);

  // Swap Popup section
  addSection('Swap Popup');
  addSlider('Popup X', 'widowSwapX', MOON_SETTINGS, 0, 100, 0.5, saveMoon);
  addSlider('Popup Y', 'widowSwapY', MOON_SETTINGS, 0, 100, 0.5, saveMoon);
  addSlider('Popup Scale', 'widowSwapScale', MOON_SETTINGS, 0, 200, 1, saveMoon);

  // Bid Popup section
  addSection('Bid Popup');
  addSlider('Bid X', 'bidPopupX', MOON_SETTINGS, 0, 100, 0.5, saveMoon);
  addSlider('Bid Y', 'bidPopupY', MOON_SETTINGS, 0, 100, 0.5, saveMoon);

  // Indicators section
  addSection('Indicators');
  addSlider('P1 Ind X', 'ind1x', MOON_SETTINGS, 0, 100, 0.5, saveMoon);
  addSlider('P1 Ind Y', 'ind1y', MOON_SETTINGS, 0, 100, 0.5, saveMoon);
  addSlider('P2 Ind X', 'ind2x', MOON_SETTINGS, 0, 100, 0.5, saveMoon);
  addSlider('P2 Ind Y', 'ind2y', MOON_SETTINGS, 0, 100, 0.5, saveMoon);
  addSlider('P3 Ind X', 'ind3x', MOON_SETTINGS, 0, 100, 0.5, saveMoon);
  addSlider('P3 Ind Y', 'ind3y', MOON_SETTINGS, 0, 100, 0.5, saveMoon);

  // V10_107: Fix #13 — Current trick positions (played dominos + lead)
  addSection('Current Trick Positions');
  // Create a temp config object bound to PLACEHOLDER_CONFIG_MOON
  var _pcm = PLACEHOLDER_CONFIG_MOON;
  function _savePCM(){
    try{ localStorage.setItem('tn51_moon_placeholders', JSON.stringify({
      p1x: _pcm.players[1].xN, p1y: _pcm.players[1].yN,
      p2x: _pcm.players[2].xN, p2y: _pcm.players[2].yN,
      p3x: _pcm.players[3].xN, p3y: _pcm.players[3].yN,
      leadX: _pcm.lead.xN, leadY: _pcm.lead.yN
    })); }catch(e){}
    createPlaceholders();
  }
  // P1 Played position
  addSlider('P1 Played X', 'xN', _pcm.players[1], 0, 100, 0.5, _savePCM);
  addSlider('P1 Played Y', 'yN', _pcm.players[1], 0, 100, 0.5, _savePCM);
  // P2 Played position
  addSlider('P2 Played X', 'xN', _pcm.players[2], 0, 100, 0.5, _savePCM);
  addSlider('P2 Played Y', 'yN', _pcm.players[2], 0, 100, 0.5, _savePCM);
  // P3 Played position
  addSlider('P3 Played X', 'xN', _pcm.players[3], 0, 100, 0.5, _savePCM);
  addSlider('P3 Played Y', 'yN', _pcm.players[3], 0, 100, 0.5, _savePCM);
  // Lead domino position
  addSlider('Lead X', 'xN', _pcm.lead, 0, 100, 0.5, _savePCM);
  addSlider('Lead Y', 'yN', _pcm.lead, 0, 100, 0.5, _savePCM);
  addSlider('Current Trick Scale', 'trickScale', MOON_SETTINGS, 0, 200, 0.5, saveMoonLayout);

  // Trick history section
  addSection('Trick History');
  addSlider('TH Scale', 'thScale', MOON_SETTINGS, 0, 100, 0.5, saveMoonLayout);
  addSlider('History X Offset', 'trickHistoryX', MOON_SETTINGS, -50, 50, 0.5, saveMoon);
  addSlider('History Y Offset', 'trickHistoryY', MOON_SETTINGS, -50, 50, 0.5, saveMoon);
  addSlider('Column Spacing', 'thColSpacing', MOON_SETTINGS, 0, 30, 0.1, saveMoonLayout);
  addSlider('Row Spacing', 'thRowSpacing', MOON_SETTINGS, 0, 10, 0.1, saveMoonLayout);
  addSlider('Group Padding', 'thBlockGap', MOON_SETTINGS, 0, 10, 0.1, saveMoonLayout);
  addSlider('Start X', 'thBaseX', MOON_SETTINGS, 0, 50, 0.1, saveMoonLayout);

  // Export + Preset + Close buttons (matching TN51/T42 style)
  var btnRow1 = document.createElement('div');
  btnRow1.style.cssText = 'text-align:center;margin-top:12px;';
  var exportBtn = document.createElement('button');
  exportBtn.className = 'glossBtn';
  exportBtn.style.cssText = 'padding:6px 14px;font-size:12px;';
  exportBtn.textContent = 'Export Values';
  exportBtn.onclick = function(){
    var dump = { moonSettings: MOON_SETTINGS, moonPlaceholders: PLACEHOLDER_CONFIG_MOON };
    if(typeof MOON_WIDOW_POS !== 'undefined') dump.moonWidowPos = MOON_WIDOW_POS;
    var ta = document.createElement('textarea');
    ta.style.cssText = 'position:fixed;top:10%;left:10%;width:80%;height:70%;z-index:9999;font-size:11px;background:#111;color:#0f0;border:2px solid #0f0;padding:10px;border-radius:8px;';
    ta.value = JSON.stringify(dump, null, 2);
    document.body.appendChild(ta);
    ta.select();
    ta.addEventListener('click', function(){ ta.remove(); });
  };
  btnRow1.appendChild(exportBtn);
  panel.appendChild(btnRow1);

  var btnRow2 = document.createElement('div');
  btnRow2.style.cssText = 'display:flex;gap:8px;justify-content:center;margin-top:8px;';
  var presetBtn = document.createElement('button');
  presetBtn.style.cssText = 'padding:6px 14px;font-size:11px;font-weight:600;background:linear-gradient(135deg,#22c55e,#16a34a);border:none;border-radius:8px;color:#fff;cursor:pointer;';
  presetBtn.textContent = '\u{1F4F1} Built-in Device Presets';
  presetBtn.addEventListener('click', function(){ if(typeof window.showBuiltInPresetPicker==='function') window.showBuiltInPresetPicker(); });
  btnRow2.appendChild(presetBtn);
  panel.appendChild(btnRow2);

  var btnRow3 = document.createElement('div');
  btnRow3.style.cssText = 'text-align:center;margin-top:8px;';
  var closeBtn = document.createElement('button');
  closeBtn.className = 'glossBtn';
  closeBtn.style.cssText = 'padding:6px 14px;font-size:12px;background:#ef4444;border:none;border-radius:8px;color:#fff;cursor:pointer;font-weight:600;';
  closeBtn.textContent = 'Close';
  closeBtn.onclick = function(){ backdrop.remove(); };
  btnRow3.appendChild(closeBtn);
  panel.appendChild(btnRow3);

  document.body.appendChild(backdrop);
}

function afterWidowSwap(){
  // Refresh display after widow swap — now trigger trump selection
  if(typeof refreshLayout === 'function') refreshLayout();
  if(typeof updateScoreDisplay === 'function') updateScoreDisplay();
  if(typeof setStatus === 'function') setStatus(session.status);
  if(typeof updateWidowDisplay === 'function') updateWidowDisplay();

  // Moon flow: after widow swap, bid winner picks trump
  if(GAME_MODE === 'MOON' && session.phase === PHASE_NEED_TRUMP){
    const bidderSeat = session.bid_winner_seat !== undefined ? session.bid_winner_seat : 0;

    // Multiplayer: broadcast swap result and route trump selection through MP logic
    if(MULTIPLAYER_MODE){
      // If local player did the swap, broadcast it
      if(bidderSeat === mpSeat){
        const newWidow = session.moon_widow ? [session.moon_widow[0], session.moon_widow[1]] : null;
        const swapPayload = {
          seat: bidderSeat,
          newWidow: newWidow,
          hand: session.game.hands[bidderSeat].map(t => [t[0], t[1]])
        };
        if(!mpIsHost){
          // Guest: send intent to host
          mpSendMove(Object.assign({ action: 'widow_swap_intent' }, swapPayload));
        } else {
          // Host: broadcast confirmed
          mpSendMove(Object.assign({ action: 'widow_swap_confirmed' }, swapPayload));
        }
      }

      // Route to MP trump selection
      if(bidderSeat === mpSeat){
        setStatus('Widow swap done. Select trump.');
        mpHideWaiting();
        showTrumpOverlay(true);
        // V10_121g: Ensure trump selection is active for proper domino clicks
        trumpSelectionActive = true;
        enableTrumpDominoClicks();
      } else if(mpIsHost && mpIsAI(bidderSeat)){
        // AI on host picks trump after swap
        const hand = session.game.hands[bidderSeat] || [];
        const trump = aiChooseTrump(hand, session.current_bid);
        setStatus(getPlayerDisplayName(bidderSeat) + ' (AI) selects trump: ' + (trump || 'NT'));
        session.set_trump(trump);
        _dfmActiveThisHand = (trump === 'DOUBLES' && doublesFollowMe !== 'off');
        syncSpritesWithGameState();
        updateTrumpDisplay();
        mpSendMove({ action: 'trump_confirmed', trump: trump === null ? 'NT' : trump, seat: bidderSeat, marks: session.bid_marks, isAI: true,
          activePlayers: session.game.active_players ? session.game.active_players.slice() : null, firstPlayer: session.game.current_player, dfmActive: _dfmActiveThisHand });
        setTimeout(() => mpCheckWhoseTurn(), 500);
      } else {
        setStatus(getPlayerDisplayName(bidderSeat) + ' selecting trump...');
      }
      return;
    }

    // Single player / Pass-and-Play
    const isHumanBidder = ppIsHuman(bidderSeat);
    if(isHumanBidder){
      showTrumpOverlay(true);
      // V10_121g: Ensure trump selection is active for proper domino clicks
      trumpSelectionActive = true;
      enableTrumpDominoClicks();
    } else {
      // AI picks trump after widow swap
      const hand = session.game.hands[bidderSeat] || [];
      const trump = aiChooseTrump(hand, session.current_bid);
      const trumpDisplay = trump === "NT" ? "No Trumps" : trump + "s";
      session.status = `P${seatToPlayer(bidderSeat)} bid ${session.current_bid}. Trump: ${trumpDisplay}`;
      setStatus(session.status);
      session.set_trump(trump);
      _dfmActiveThisHand = (trump === 'DOUBLES' && doublesFollowMe !== 'off');
      syncSpritesWithGameState();
      sortAllHandsByTrump();
      flipTilesForTrump();
      updateTrumpDisplay();
      renderAll();
      maybeAIKick();
    }
  }
}

// Demo function to test scoring (can be called from console)
function setScores(t1Score, t2Score, t1Marks, t2Marks){
  team1Score = t1Score;
  team2Score = t2Score;
  team1Marks = t1Marks;
  team2Marks = t2Marks;
  updateScoreDisplay();
}

// Utilities
function clamp01(x){ return Math.max(0,Math.min(1,x)); }
function lerp(a,b,t){ return a+(b-a)*t; }
function smoothstep(t){ t=clamp01(t); return t*t*(3-2*t); }
function getRect(){ return document.getElementById('tableMain').getBoundingClientRect(); }
function normToPx(xN,yN){ const r=getRect(); return { x: r.width*xN, y: r.height*yN }; }

// V12.3: Fixed aspect ratio container with letterboxing
(function(){
  // Default aspect ratio: iPhone 11 portrait (414:896)
  var AR_W = 414;
  var AR_H = 896;

  // Store/load aspect ratio preference
  try {
    var savedAR = localStorage.getItem('tn51_aspect_ratio');
    if(savedAR){
      var parsed = JSON.parse(savedAR);
      if(parsed.w && parsed.h){ AR_W = parsed.w; AR_H = parsed.h; }
    }
  } catch(e){}

  window._gameAspectRatio = { w: AR_W, h: AR_H };

  function updateAspectRatioCSS(){
    // Update CSS variables for aspect ratio
    document.documentElement.style.setProperty('--ar-w', AR_W);
    document.documentElement.style.setProperty('--ar-h', AR_H);
  }

  // Run on load and resize
  updateAspectRatioCSS();
  window.addEventListener('resize', function(){
    clearTimeout(window._arResizeTimer);
    window._arResizeTimer = setTimeout(updateAspectRatioCSS, 100);
  });

  // Expose for settings
  window.setGameAspectRatio = function(w, h){
    AR_W = w; AR_H = h;
    window._gameAspectRatio = { w: w, h: h };
    try { localStorage.setItem('tn51_aspect_ratio', JSON.stringify({w:w,h:h})); } catch(e){}
    updateAspectRatioCSS();
  };

  // CSS handles orientation changes automatically via min() functions
})();


/******************************************************************************
 * DRAWING FUNCTIONS
 ******************************************************************************/
function parseRGBA(str){
  // Handle hex format: #xxxxxx
  let m=str.match(/^#([0-9a-f]{6})$/i);
  if(m){ const h=m[1]; return {r:parseInt(h.slice(0,2),16),g:parseInt(h.slice(2,4),16),b:parseInt(h.slice(4,6),16),a:1}; }
  // Handle rgba format: rgba(r,g,b,a)
  m=str.match(/^rgba?\s*\(\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)\s*(?:,\s*([\d.]+))?\s*\)$/i);
  if(m){ return {r:parseInt(m[1]),g:parseInt(m[2]),b:parseInt(m[3]),a:m[4]?parseFloat(m[4]):1}; }
  return {r:255,g:255,b:255,a:1};
}
function rgbaToStr(c){ return `rgba(${Math.round(c.r)},${Math.round(c.g)},${Math.round(c.b)},${c.a})`; }
function lerpRGB(c1,c2,t){ return {r:lerp(c1.r,c2.r,t),g:lerp(c1.g,c2.g,t),b:lerp(c1.b,c2.b,t),a:1}; }

function roundRectPath(ctx,x,y,w,h,r){
  r=Math.max(0,Math.min(r,Math.min(w,h)/2));
  ctx.beginPath();
  ctx.moveTo(x+r,y); ctx.lineTo(x+w-r,y); ctx.quadraticCurveTo(x+w,y,x+w,y+r);
  ctx.lineTo(x+w,y+h-r); ctx.quadraticCurveTo(x+w,y+h,x+w-r,y+h);
  ctx.lineTo(x+r,y+h); ctx.quadraticCurveTo(x,y+h,x,y+h-r);
  ctx.lineTo(x,y+r); ctx.quadraticCurveTo(x,y,x+r,y); ctx.closePath();
}
function strokeRoundRect(ctx,x,y,w,h,r,lw,col){
  ctx.save(); ctx.strokeStyle=col; ctx.lineWidth=lw;
  roundRectPath(ctx,x,y,w,h,r); ctx.stroke(); ctx.restore();
}

// Use pip colors from DOMINO_STYLE settings
function pipColorForValue(v){ return DOMINO_STYLE.PIP_COLORS[Number(v)] || DOMINO_STYLE.PIP_COLORS[0]; }

// Draw back/inside slab with highlight state support
// highlighted: true = brighter, false = normal cream/tan
function drawPlainSlab(ctx, w, h, highlighted = false){
  const lw = Math.max(2, Math.floor(w * 0.02)), rCss = 12;
  ctx.clearRect(0, 0, w, h);

  const fill = highlighted ? DOMINO_STYLE.BACK.HIGHLIGHTED : DOMINO_STYLE.BACK.NORMAL;
  const top = lerpRGB(parseRGBA(fill), {r:255,g:255,b:255,a:1}, 0.06);
  const bot = lerpRGB(parseRGBA(fill), {r:0,g:0,b:0,a:1}, 0.04);
  const g = ctx.createLinearGradient(0, 0, 0, h);
  g.addColorStop(0, rgbaToStr(top));
  g.addColorStop(1, rgbaToStr(bot));
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, w, h);

  // Subtle diagonal pattern for back
  ctx.save();
  ctx.globalAlpha = 1;
  ctx.strokeStyle = "rgba(0,0,0,0.01)";
  ctx.lineWidth = 1.25;
  const step = Math.max(1, Math.floor(w * 0.2));
  for(let yy = step; yy < h; yy += step){
    ctx.beginPath();
    ctx.moveTo(0, yy);
    ctx.lineTo(w, yy - step);
    ctx.stroke();
  }
  ctx.restore();

  strokeRoundRect(ctx, lw/2, lw/2, w-lw, h-lw, rCss-lw/2, lw, "rgba(224,224,224,1)");
}

// Draw domino face with 4 states:
// highlighted: true = bright white face, false = off-white/cream
// valid: true = full opacity pips, false = transparent pips (invalid/illegal tile)
function drawFace(ctx, tile, w, h, highlighted = false, valid = true, rotRad){
  rotRad = rotRad || 0;
  const lw = Math.max(2, Math.floor(w * 0.02)), rCss = 12;
  ctx.clearRect(0, 0, w, h);

  // Face color based on highlight state
  const faceColor = highlighted ? DOMINO_STYLE.FACE.HIGHLIGHTED : DOMINO_STYLE.FACE.NORMAL;

  // Background fill with gradient
  const topColor = lerpRGB(parseRGBA(faceColor), {r:255,g:255,b:255,a:1}, 0.02);
  const botColor = lerpRGB(parseRGBA(faceColor), {r:0,g:0,b:0,a:1}, 0.02);
  const g = ctx.createLinearGradient(0, 0, 0, h);
  g.addColorStop(0, rgbaToStr(topColor));
  g.addColorStop(1, rgbaToStr(botColor));
  ctx.fillStyle = g;
  roundRectPath(ctx, 0, 0, w, h, rCss);
  ctx.fill();

  // Bevel highlight (inner white stroke for 3D effect)
  ctx.save();
  ctx.globalAlpha = DOMINO_STYLE.BEVEL_OPACITY;
  ctx.strokeStyle = DOMINO_STYLE.BEVEL_COLOR;
  ctx.lineWidth = DOMINO_STYLE.BEVEL_WIDTH;
  roundRectPath(ctx, 1, 1, w-2, h-2, rCss);
  ctx.stroke();
  ctx.restore();

  // Border/Edge - uses highlight state
  const edgeColor = highlighted ? DOMINO_STYLE.EDGE.HIGHLIGHTED : DOMINO_STYLE.EDGE.NORMAL;
  ctx.lineWidth = DOMINO_STYLE.BORDER_WIDTH;
  ctx.strokeStyle = edgeColor;
  roundRectPath(ctx, 0, 0, w, h, rCss);
  ctx.stroke();

  // Pip patterns
  const spots = {
    0: [],
    1: [[0,0]],
    2: [[-1,-1],[1,1]],
    3: [[-1,-1],[0,0],[1,1]],
    4: [[-1,-1],[1,-1],[-1,1],[1,1]],
    5: [[-1,-1],[1,-1],[0,0],[-1,1],[1,1]],
    6: [[-1,-1],[1,-1],[-1,0],[1,0],[-1,1],[1,1]],
    7: [[-1,-1],[1,-1],[-1,0],[0,0],[1,0],[-1,1],[1,1]]
  };

  // Pip geometry
  const hh = h / 2;
  const sx = w * 0.27;
  const sy = hh * 0.27;
  const pr = Math.max(1.2, Math.min(w, hh) * 0.062 * DOMINO_STYLE.PIP_SCALE);

  // Center line
  const lineOpacity = valid ? 1.0 : DOMINO_STYLE.INVALID_OPACITY;
  ctx.save();
  ctx.globalAlpha = lineOpacity;

  if (DOMINO_STYLE.FANCY_LINE_ENABLED) {
    // Fancy groove center line — ends aligned with outermost pip columns
    const cxGrid = w / 2;
    const minX = cxGrid - sx - pr;
    const maxX = cxGrid + sx + pr;
    const baseW = Math.max(DOMINO_STYLE.CENTER_LINE_WIDTH, pr * 0.60);

    // Main groove stroke
    ctx.beginPath();
    ctx.moveTo(minX, h/2);
    ctx.lineTo(maxX, h/2);
    ctx.lineWidth = baseW;
    ctx.strokeStyle = DOMINO_STYLE.FANCY_LINE_COLOR;
    ctx.lineCap = "round";
    ctx.stroke();

    // Top highlight
    const hiA = Math.max(0, Math.min(1, DOMINO_STYLE.CENTER_LINE_HI_OPACITY));
    if (hiA > 0) {
      const hiW = Math.max(1, baseW * Math.max(0.05, DOMINO_STYLE.CENTER_LINE_HI_WIDTH_RATIO));
      const hiY = DOMINO_STYLE.CENTER_LINE_HI_Y_OFFSET_PX;
      ctx.save();
      ctx.globalAlpha = lineOpacity * hiA;
      ctx.strokeStyle = DOMINO_STYLE.CENTER_LINE_HI_COLOR;
      ctx.lineWidth = hiW;
      ctx.beginPath();
      ctx.moveTo(minX, h/2 + hiY);
      ctx.lineTo(maxX, h/2 + hiY);
      ctx.lineCap = "round";
      ctx.stroke();
      ctx.restore();
    }

    // Bottom shadow
    const shA = Math.max(0, Math.min(1, DOMINO_STYLE.CENTER_LINE_SH_OPACITY));
    if (shA > 0) {
      const shW = Math.max(1, baseW * Math.max(0.05, DOMINO_STYLE.CENTER_LINE_SH_WIDTH_RATIO));
      const shY = DOMINO_STYLE.CENTER_LINE_SH_Y_OFFSET_PX;
      ctx.save();
      ctx.globalAlpha = lineOpacity * shA;
      ctx.strokeStyle = DOMINO_STYLE.CENTER_LINE_SH_COLOR;
      ctx.lineWidth = shW;
      ctx.beginPath();
      ctx.moveTo(minX, h/2 + shY);
      ctx.lineTo(maxX, h/2 + shY);
      ctx.lineCap = "round";
      ctx.stroke();
      ctx.restore();
    }
  } else {
    // Simple center line (original)
    ctx.beginPath();
    ctx.moveTo(0, h/2);
    ctx.lineTo(w, h/2);
    ctx.lineWidth = DOMINO_STYLE.CENTER_LINE_WIDTH;
    ctx.strokeStyle = DOMINO_STYLE.CENTER_LINE_COLOR;
    ctx.stroke();
  }
  ctx.restore();

  // Plain pip (flat fill)
  function pip(x, y, pr, col){
    ctx.fillStyle = col;
    ctx.beginPath();
    ctx.arc(x, y, pr, 0, Math.PI * 2);
    ctx.fill();
  }

  // Fancy pip (ring + highlights + optional gradient)
  function pipFancy(x, y, pr, col){
    // Base pip — radial gradient or flat
    if (DOMINO_STYLE.PIPFX_GRADIENT) {
      const parsed = parseRGBA(col);
      const lighter = rgbaToStr({r: Math.min(255, parsed.r + 60), g: Math.min(255, parsed.g + 60), b: Math.min(255, parsed.b + 60), a: parsed.a});
      const darker = rgbaToStr({r: Math.max(0, parsed.r - 30), g: Math.max(0, parsed.g - 30), b: Math.max(0, parsed.b - 30), a: parsed.a});
      const grad = ctx.createRadialGradient(x - pr*0.25, y - pr*0.25, pr*0.1, x, y, pr);
      grad.addColorStop(0, lighter);
      grad.addColorStop(1, darker);
      ctx.fillStyle = grad;
    } else {
      ctx.fillStyle = col;
    }
    ctx.beginPath();
    ctx.arc(x, y, pr, 0, Math.PI * 2);
    ctx.fill();

    // Ring
    const ringRatio = Math.max(0, Math.min(0.9, DOMINO_STYLE.PIPFX_RING_WIDTH_RATIO));
    const ringOpacity = Math.max(0, Math.min(1, DOMINO_STYLE.PIPFX_RING_OPACITY));
    const ringW = Math.max(1, pr * ringRatio);
    if (ringOpacity > 0) {
      ctx.save();
      ctx.globalAlpha = ringOpacity;
      ctx.strokeStyle = "rgba(0,0,0,1)";
      ctx.lineWidth = ringW;
      ctx.beginPath();
      ctx.arc(x, y, pr - ringW * 0.5, 0, Math.PI * 2);
      ctx.stroke();
      ctx.restore();
    }

    // Highlights
    const innerR = Math.max(1, pr - ringW);
    const hi1A = Math.max(0, Math.min(1, DOMINO_STYLE.PIPFX_HI1_OPACITY));
    const hi2A = Math.max(0, Math.min(1, DOMINO_STYLE.PIPFX_HI2_OPACITY));
    const hi1Sz = Math.max(0.02, DOMINO_STYLE.PIPFX_HI1_SIZE);
    const hi2Sz = Math.max(0.02, DOMINO_STYLE.PIPFX_HI2_SIZE);
    const dx1S = DOMINO_STYLE.PIPFX_HI1_DX * innerR;
    const dy1S = DOMINO_STYLE.PIPFX_HI1_DY * innerR;
    const dx2S = DOMINO_STYLE.PIPFX_HI2_DX * innerR;
    const dy2S = DOMINO_STYLE.PIPFX_HI2_DY * innerR;

    function lockToViewer(dx, dy){
      if (!DOMINO_STYLE.PIPFX_HI_LOCK_SCREEN) return {dx, dy};
      const ang = -(rotRad || 0);
      const ca = Math.cos(ang), sa = Math.sin(ang);
      return {dx: dx*ca - dy*sa, dy: dx*sa + dy*ca};
    }

    function drawOval(cx, cy, rx, ry, rot, alpha){
      if (alpha <= 0) return;
      ctx.save();
      ctx.globalAlpha = alpha;
      ctx.fillStyle = "rgba(255,255,255,1)";
      if (ctx.ellipse) {
        ctx.beginPath();
        ctx.ellipse(cx, cy, rx, ry, rot, 0, Math.PI*2);
        ctx.fill();
      } else {
        ctx.beginPath();
        ctx.arc(cx, cy, Math.min(rx, ry), 0, Math.PI*2);
        ctx.fill();
      }
      ctx.restore();
    }

    if (hi1A > 0) {
      const v = lockToViewer(dx1S, dy1S);
      drawOval(x + v.dx, y + v.dy, innerR*hi1Sz*0.70, innerR*hi1Sz*0.55, -0.35, hi1A);
    }
    if (hi2A > 0) {
      const v = lockToViewer(dx2S, dy2S);
      drawOval(x + v.dx, y + v.dy, innerR*hi2Sz*0.55, innerR*hi2Sz*0.45, -0.35, hi2A);
    }
  }

  function drawHalf(val, oy){
    val = Number(val) || 0;
    const cx = w / 2;
    const cy = oy + hh / 2;
    const col = pipColorForValue(val);
    const useFancy = DOMINO_STYLE.PIPFX_ENABLED;
    for(const s of (spots[val] || [])){
      if (useFancy) {
        pipFancy(cx + s[0] * sx, cy + s[1] * sy, pr, col);
      } else {
        pip(cx + s[0] * sx, cy + s[1] * sy, pr, col);
      }
    }
  }

  // Draw pips with opacity based on valid state
  ctx.save();
  ctx.globalAlpha = valid ? 1.0 : DOMINO_STYLE.INVALID_OPACITY;
  drawHalf(tile[0], 0);
  drawHalf(tile[1], h / 2);
  ctx.restore();
}

/******************************************************************************
 * SPRITE CREATION
 ******************************************************************************/
function makeShadow(){
  const shadow = document.createElement("div");
  shadow.className = "dominoShadow";
  const shape = document.createElement("div");
  shape.className = "shadowShape";
  shadow.appendChild(shape);

  shadow._pose = { x:0, y:0, s:1, rz:0 };

  shadow.setPose = ({x,y,s,rz}) => {
    shadow._pose = {x,y,s,rz};
    shadow.style.transform = `translate(${x}px,${y}px) scale(${s}) rotate(${rz}deg)`;
    shadow.style.transformOrigin = "50% 50%";
  };

  return shadow;
}

function makeSprite(tile){
  const el=document.createElement("div");
  el.className = "dominoSprite";
  el.dataset.tile = JSON.stringify(tile);

  // Create shadow element (will be added to shadowLayer separately)
  const shadow = makeShadow();
  el._shadow = shadow;

  const stack=document.createElement("div");
  stack.className="stack";
  const edge=document.createElement("div");
  edge.className="edgeStrip";

  const panelA=document.createElement("div");
  panelA.className="panel panelA";
  panelA.innerHTML=`<div class="face front"><canvas></canvas></div><div class="face back" style="transform:rotateY(180deg)"><canvas></canvas></div>`;

  const panelB=document.createElement("div");
  panelB.className="panel panelB";
  panelB.style.left="2px";
  panelB.innerHTML=`<div class="face front"><canvas></canvas></div><div class="face back" style="transform:rotateY(180deg)"><canvas></canvas></div>`;

  stack.appendChild(edge);
  stack.appendChild(panelB);
  stack.appendChild(panelA);
  el.appendChild(stack);

  const cvs=el.querySelectorAll("canvas");
  const dpr=window.devicePixelRatio||1;
  const w=Math.round(56*dpr), h=Math.round(112*dpr);

  // Track domino state for redrawing
  el._highlighted = false;
  el._valid = true;
  el._tile = tile;

  // Draw canvases based on current state
  function redrawCanvases(){
    const highlighted = el._highlighted;
    const valid = el._valid;
    const currentTile = el._tile || tile;  // Use updated tile data (for trump flip)

    // cvs[0] = panelA front (inside when flipped)
    // cvs[1] = panelA back (face when flipped)
    // cvs[2] = panelB front (back of domino)
    // cvs[3] = panelB back (inside)
    cvs[0].width = w; cvs[0].height = h;
    cvs[1].width = w; cvs[1].height = h;
    cvs[2].width = w; cvs[2].height = h;
    cvs[3].width = w; cvs[3].height = h;

    drawPlainSlab(cvs[0].getContext("2d"), w, h, highlighted);  // Inside
    const rotRad = (el._pose && typeof el._pose.rz==="number") ? (el._pose.rz * Math.PI / 180) : 0;
    drawFace(cvs[1].getContext("2d"), currentTile, w, h, highlighted, valid, rotRad);  // Face
    drawPlainSlab(cvs[2].getContext("2d"), w, h, highlighted);  // Back
    drawPlainSlab(cvs[3].getContext("2d"), w, h, highlighted);  // Inside
  }
  // V12.6: Update edge strip color based on highlight state
  function updateEdgeColor(){
    var edgeCol = el._highlighted ? (DOMINO_STYLE.EDGE.HIGHLIGHTED||'#e8e8e8') : (DOMINO_STYLE.EDGE.NORMAL||'#d7d7d7');
    edge.style.background = edgeCol;
    edge.style.borderColor = edgeCol;
  }
  // Expose for live style updates
  el.redrawCanvases = function(){ redrawCanvases(); updateEdgeColor(); };
  el.updateEdgeThickness = function(){
    // Force re-apply rotY to recalculate edge sizing
    el.setRotY(el._pose ? el._pose.ry : 0);
  };
  redrawCanvases();
  updateEdgeColor();

  // Method to update domino state and redraw
  el.setState = (highlighted, valid) => {
    el._highlighted = highlighted;
    el._valid = valid;
    redrawCanvases();
  };

  let _deg=0, lastSwap=null;

  el.setFaceUp=(faceUp)=>{
    el.setRotY(faceUp ? 180 : 0);
  };

  el.setRotY=(deg)=>{
    _deg=deg;
    let nd=deg%360; if(nd<0)nd+=360;
    const inFlip=(nd>90&&nd<270);
    if(inFlip!==lastSwap){
      lastSwap=inFlip;
      panelA.remove(); panelB.remove();
      if(inFlip){ stack.appendChild(panelA); stack.appendChild(panelB); }
      else { stack.appendChild(panelB); stack.appendChild(panelA); }
    }
    const zSep=DOMINO_STYLE.EDGE_THICKNESS||20;
    const zA=inFlip?-zSep:zSep, zB=inFlip?zSep:-zSep;
    panelA.style.transform=`translateZ(${zA}px) rotateY(${deg}deg)`;
    panelB.style.transform=`translateZ(${zB}px) rotateY(${deg}deg)`;
    const rad=(deg%360)*Math.PI/180;
    const sinVal=Math.sin(rad);
    const tE=1-Math.abs(Math.cos(rad));
    const offMag=2+(8*tE);
    const off=offMag*Math.sign(sinVal||1);
    panelB.style.left=off+"px";
    const angDist=(a,b)=>{let d=Math.abs((a%360+360)%360-(b%360+360)%360);return Math.min(d,360-d);};
    const best=Math.min(angDist(deg,90),angDist(deg,270));
    edge.style.opacity=best<10?1:best>30?0:1-smoothstep((best-10)/20);
    edge.style.left=(28+off/2-Math.max(1,Math.abs(off))/2)+"px";
    edge.style.width=Math.max(1,Math.abs(off))+"px";
  };

  el._pose = { x:0, y:0, s:1, rz:0, ry:0 };

  el.setPose=({x,y,s,rz,ry})=>{
    el._pose = {x,y,s,rz,ry};
    el.style.transform=`translate(${x}px,${y}px) scale(${s}) rotate(${rz}deg)`;
    // If pip highlights are locked to viewer, re-bake face so highlights counter-rotate
    try{ if(DOMINO_STYLE && DOMINO_STYLE.PIPFX_ENABLED && DOMINO_STYLE.PIPFX_HI_LOCK_SCREEN && typeof el.redrawCanvases==="function"){ el.redrawCanvases(); } }catch(e){};
    el.style.transformOrigin="50% 50%";
    el.setRotY(ry);
    // Update shadow to match sprite position (shadow doesn't need ry rotation)
    if(el._shadow){
      el._shadow.setPose({x,y,s,rz});
    }
  };

  el.getPose=()=>({...el._pose});

  // Set face-up or face-down (for flipping at end of round)
  el.setFaceUp=(faceUp)=>{
    const currentPose = el.getPose();
    const newRy = faceUp ? 180 : 0;
    if(currentPose.ry !== newRy){
      el.setPose({...currentPose, ry: newRy});
    }
  };

  el.setRotY(0);
  return el;
}

/******************************************************************************
 * ANIMATION FUNCTIONS
 ******************************************************************************/
let zIndexCounter = 100;

function bringToFront(sprite){
  if(!sprite || !sprite.style) return; // V10_122: Safety check
  zIndexCounter++;
  sprite.style.zIndex = zIndexCounter;
}

function animateSprite(sprite, targetPose, duration, easing = ANIM.EASING){
  return new Promise(resolve => {
    const start = sprite.getPose();
    const startTime = performance.now();
    const startRotY = start.ry;
    const endRotY = targetPose.ry;

    function tick(now){
      const elapsed = now - startTime;
      const progress = Math.min(1, elapsed / duration);

      let t;
      if(easing === 'ease-in-out'){
        t = progress < 0.5
          ? 2 * progress * progress
          : 1 - Math.pow(-2 * progress + 2, 2) / 2;
      } else if(easing === 'ease-in'){
        t = progress * progress;
      } else if(easing === 'ease-out'){
        t = 1 - (1 - progress) * (1 - progress);
      } else {
        t = progress;
      }

      const current = {
        x: lerp(start.x, targetPose.x, t),
        y: lerp(start.y, targetPose.y, t),
        s: lerp(start.s, targetPose.s, t),
        rz: lerp(start.rz, targetPose.rz, t),
        ry: lerp(startRotY, endRotY, t)
      };

      sprite.setPose(current);

      if(progress < 1){
        requestAnimationFrame(tick);
      } else {
        resolve();
      }
    }

    requestAnimationFrame(tick);
  });
}

// ============ V11.4: SHUFFLE SETTINGS ============
var SHUFFLE_SETTINGS = {
  flipDuration: 3000,    // ms spread for random flip timing
  flipAnimSpeed: 300,    // ms per individual flip animation
  slideSpeed: 400,       // ms slide-to-center animation
  reshuffleSpeed: 200,   // ms per reshuffle animation
  reshuffleCount: 3,     // number of reshuffles
  reshufflePause: 50,    // ms pause between reshuffles
  centerXPct: 0,         // center X offset as % of viewport width (-25 to +25)
  centerYPct: 0,         // center Y offset as % of viewport height (-25 to +25)
  spreadXPct: 15,        // spread X as % of viewport width (capped at spreadXMax px)
  spreadYPct: 10,        // spread Y as % of viewport height (capped at spreadYMax px)
  spreadXMax: 120,       // max spread X in px
  spreadYMax: 80,        // max spread Y in px
  tileScale: 0.38,       // scale of tiles in center pile
  dealStagger: 40,       // ms stagger within a group (0-200)
  dealSpeed: 300,        // ms per deal animation
  groupPause: 400,       // ms pause between player groups
};



// Deal animation: create sprites at center, animate to hand positions
// Groups by player, deals in clockwise order starting left of dealer



function getSection(name){
  return getActiveLayout().sections.find(s => s.name === name);
}

function getHandPosition(playerIndex, slotIndex){
  const section = getSection(`Player_${playerIndex}_Hand`);
  if(!section || !section.dominoes[slotIndex]) return null;
  const d = section.dominoes[slotIndex];
  const px = normToPx(d.xN, d.yN);
  return { x: px.x - 28, y: px.y - 56, s: d.scale, rz: d.rotZ, ry: d.rotY };
}

function getPlayedPosition(playerIndex){
  const section = getSection(`Player_${playerIndex}_Played_Domino`);
  if(!section || !section.dominoes[0]) return null;
  const d = section.dominoes[0];
  const px = normToPx(d.xN, d.yN);
  return { x: px.x - 28, y: px.y - 56, s: d.scale, rz: d.rotZ, ry: d.rotY };
}

function getTrickHistoryPosition(teamTrickIndex, winningTeam, playerRowIndex){
  const section = getSection('Trick_History');
  if(!section) return null;

  if(GAME_MODE === 'MOON'){
    // Moon layout: 3 blocks of 3 rows × 7 cols = 63 positions
    // winningTeam = player seat (0,1,2) = which block
    // teamTrickIndex = which column (0-6, the Nth trick this player won)
    // playerRowIndex = which row within the block (0-2, seat of the tile played)
    const block = winningTeam;
    const col = Math.min(6, teamTrickIndex);
    const row = playerRowIndex;
    const index = block * 21 + row * 7 + col; // 21 = 3 rows * 7 cols per block
    const d = section.dominoes[index];
    if(!d) return null;
    var thXOff = (MOON_SETTINGS.trickHistoryX || 0) / 100;
    var thYOff = (MOON_SETTINGS.trickHistoryY || 0) / 100;
    const px = normToPx(d.xN + thXOff, d.yN + thYOff);
    var thScale = MOON_SETTINGS.trickScale || d.scale;
    return { x: px.x - 28, y: px.y - 56, s: thScale, rz: d.rotZ, ry: d.rotY };
  }

  // TN51/T42: original 2-team layout
  const numCols = session.game.player_count;
  const numRows = Math.floor(section.dominoes.length / numCols);
  const maxTeamTricks = numRows - 1;

  let row;
  if(winningTeam === 0){
    row = Math.min(maxTeamTricks, teamTrickIndex);
  } else {
    row = (numRows - 1) - Math.min(maxTeamTricks, teamTrickIndex);
  }

  const col = playerRowIndex;
  const index = row * numCols + col;
  const d = section.dominoes[index];
  if(!d) return null;
  const px = normToPx(d.xN, d.yN);
  return { x: px.x - 28, y: px.y - 56, s: d.scale, rz: d.rotZ, ry: d.rotY };
}

// Reposition all trick history sprites when layout settings change
function repositionTrickHistorySprites(){
  var sl = document.getElementById('spriteLayer');
  if(!sl) return;
  for(var i = 0; i < sl.children.length; i++){
    var child = sl.children[i];
    if(child._inTrickHistory && child._thTeamTrickIndex !== undefined){
      var newPose = getTrickHistoryPosition(child._thTeamTrickIndex, child._thWinningTeam, child._thPlayerRowIndex);
      if(newPose && child.setPose) child.setPose(newPose);
    }
  }
}

function getLeadDominoPosition(){
  const _ldCfg = getActivePlaceholderConfig();
  const px = normToPx(_ldCfg.lead.xN, _ldCfg.lead.yN);
  return { x: px.x, y: px.y };
}

// Draw a single pip (half of a domino) as a square
// highlighted: true = bright white (trump), false = off-white/cream (normal)
function drawPipSquare(ctx, pipValue, size, highlighted = false){
  const lw = 2, r = 6;
  ctx.clearRect(0, 0, size, size);

  // Background with gradient - match domino face colors
  const g = ctx.createLinearGradient(0, 0, 0, size);
  if(highlighted){
    // Trump/highlighted: pure white
    g.addColorStop(0, "#ffffff");
    g.addColorStop(1, "#f8f8f8");
  } else {
    // Normal: off-white/cream to match non-highlighted dominoes
    g.addColorStop(0, "rgba(245,236,221,1)");  // FACE.NORMAL top
    g.addColorStop(1, "rgba(235,226,211,1)");  // Slightly darker bottom
  }
  ctx.fillStyle = g;
  roundRectPath(ctx, 0, 0, size, size, r);
  ctx.fill();

  // Border
  ctx.strokeStyle = "rgba(224,224,224,1)";
  ctx.lineWidth = lw;
  roundRectPath(ctx, lw/2, lw/2, size-lw, size-lw, r-lw/2);
  ctx.stroke();

  // Draw pips
  const spots = {
    0: [],
    1: [[0,0]],
    2: [[-1,-1],[1,1]],
    3: [[-1,-1],[0,0],[1,1]],
    4: [[-1,-1],[1,-1],[-1,1],[1,1]],
    5: [[-1,-1],[1,-1],[0,0],[-1,1],[1,1]],
    6: [[-1,-1],[1,-1],[-1,0],[1,0],[-1,1],[1,1]],
    7: [[-1,-1],[1,-1],[-1,0],[0,0],[1,0],[-1,1],[1,1]]
  };

  const col = pipColorForValue(pipValue);
  const sx = size * 0.25;
  const sy = size * 0.25;
  // Apply display pip scale for adjustable dot size
  const pr = size * 0.08 * (DOMINO_STYLE.DISPLAY_PIP_SCALE || 1);
  const cx = size / 2;
  const cy = size / 2;

  for(const s of (spots[pipValue] || [])){
    const x = cx + s[0] * sx;
    const y = cy + s[1] * sy;

    ctx.fillStyle = col;
    ctx.beginPath();
    ctx.arc(x, y, pr, 0, Math.PI * 2);
    ctx.fill();
  }
}

// Create persistent lead pip display (call once on init)
// Shows faded square perimeter when empty, bright white/yellow square when pip is shown
function createPersistentLeadPip(){
  const size = 36;  // Size of the square (same as pip square)

  // If already exists, just update position
  if(leadDominoSprite){
    const pos = getLeadDominoPosition();
    leadDominoSprite.style.left = (pos.x - size/2) + 'px';
    leadDominoSprite.style.top = (pos.y - (size + 16)/2) + 'px';
    return;
  }

  leadDominoSprite = document.createElement('div');
  leadDominoSprite.className = 'leadPipSquare empty';
  leadDominoSprite.style.width = size + 'px';
  leadDominoSprite.style.height = (size + 16) + 'px';  // Extra height for label

  // LEAD label at top
  const label = document.createElement('div');
  label.className = 'leadLabel';
  label.textContent = 'LEAD';
  leadDominoSprite.appendChild(label);

  const canvas = document.createElement('canvas');
  canvas.className = 'leadPipCanvas';
  const dpr = window.devicePixelRatio || 1;
  canvas.width = size * dpr;
  canvas.height = size * dpr;
  canvas.style.width = size + 'px';
  canvas.style.height = size + 'px';
  leadDominoSprite.appendChild(canvas);

  const pos = getLeadDominoPosition();
  leadDominoSprite.style.left = (pos.x - size/2) + 'px';
  leadDominoSprite.style.top = (pos.y - (size + 16)/2) + 'px';

  document.getElementById('tableMain').appendChild(leadDominoSprite);
}

let leadDominoHideTimeout = null;  // Track pending hide timeout

function showLeadDomino(tile){
  // Cancel any pending hide timeout from previous trick
  if(leadDominoHideTimeout){
    clearTimeout(leadDominoHideTimeout);
    leadDominoHideTimeout = null;
  }

  // Ensure persistent element exists
  createPersistentLeadPip();

  // Determine the lead pip value
  // If trump is set and one side is trump, that side leads
  // Otherwise, the higher pip is the lead
  let leadPip = tile[0];
  const trump = session.game.trump_suit;
  const mode = session.game.trump_mode;

  // Check if either side is trump (for pip trump mode)
  const isTile0Trump = mode === 'PIP' && tile[0] === trump;
  const isTile1Trump = mode === 'PIP' && tile[1] === trump;

  if(isTile1Trump && !isTile0Trump){
    leadPip = tile[1];  // Trump side leads
  } else if(isTile0Trump){
    leadPip = tile[0];  // Trump side leads
  } else {
    leadPip = Math.max(tile[0], tile[1]);  // Higher pip leads
  }

  const isTrump = session.game._is_trump_tile(tile);
  const size = 36;

  // Update the canvas with pip
  const canvas = leadDominoSprite.querySelector('.leadPipCanvas');
  const dpr = window.devicePixelRatio || 1;
  const ctx = canvas.getContext('2d');
  ctx.clearRect(0, 0, canvas.width, canvas.height);
  ctx.save();
  ctx.scale(dpr, dpr);
  // Pass isTrump so lead pip background matches domino highlight state
  drawPipSquare(ctx, leadPip, size, isTrump);
  ctx.restore();

  // Update classes - remove empty/fading and force canvas visible
  leadDominoSprite.classList.remove('empty', 'fading');
  // Force the canvas to be visible (in case CSS transition is stuck)
  canvas.style.opacity = '1';
  if(isTrump){
    leadDominoSprite.classList.add('trump');
  } else {
    leadDominoSprite.classList.remove('trump');
  }
  // Keep the subtle watermark background (already set by CSS)
}

function hideLeadDomino(){
  if(leadDominoSprite){
    // Fade out then set to empty state
    leadDominoSprite.classList.add('fading');
    leadDominoSprite.classList.remove('trump');

    // Cancel any existing timeout
    if(leadDominoHideTimeout){
      clearTimeout(leadDominoHideTimeout);
    }

    leadDominoHideTimeout = setTimeout(() => {
      if(leadDominoSprite){
        leadDominoSprite.classList.remove('fading');
        leadDominoSprite.classList.add('empty');
        // Clear canvas
        const canvas = leadDominoSprite.querySelector('.leadPipCanvas');
        if(canvas){
          const ctx = canvas.getContext('2d');
          ctx.clearRect(0, 0, canvas.width, canvas.height);
        }
      }
      leadDominoHideTimeout = null;
    }, 500);  // Match CSS transition duration
  }
}

// Create placeholder boxes for all players and lead
function createPlaceholders(){
  const tableMain = document.getElementById('tableMain');

  // Remove existing placeholders
  Object.values(placeholderElements).forEach(el => el && el.remove());
  placeholderElements = {};

  const rect = getRect();

  // Create player placeholders (horizontal rectangles like sideways dominoes)
  const _phConfig = getActivePlaceholderConfig();
  const _phCount = GAME_MODE === 'MOON' ? 3 : (GAME_MODE === 'T42' ? 4 : 6);
  // Calculate placeholder size based on game mode trick scale
  // A domino at scale 1.0 = 56×112px. Rotated 90° = width:112, height:56.
  // TN51 uses default 44×22 (≈ 112×0.393, 56×0.393).
  // T42 uses trickScale from T42_SETTINGS for proper sizing.
  const _phScale = (GAME_MODE === 'T42') ? T42_SETTINGS.trickScale : (GAME_MODE === 'MOON') ? (MOON_SETTINGS.trickScale || 0.30) : TN51_SETTINGS.trickScale;
  const _phW = Math.round(BASE_H * _phScale);  // 112 * scale (rotated width)
  const _phH = Math.round(BASE_W * _phScale);  // 56 * scale (rotated height)
  for(let p = 1; p <= _phCount; p++){
    const config = _phConfig.players[p];
    const px = normToPx(config.xN, config.yN);

    const el = document.createElement('div');
    el.className = 'placeholder player-placeholder';
    el.dataset.ppPlayer = String(p);
    el.id = `placeholder-p${p}`;
    el.style.width = _phW + 'px';
    el.style.height = _phH + 'px';
    el.style.left = (px.x - _phW/2) + 'px';
    el.style.top = (px.y - _phH/2) + 'px';

    const text = document.createElement('span');
    text.className = 'text';
    text.textContent = '';  // Will be set during bidding
    el.appendChild(text);

    tableMain.appendChild(el);
    placeholderElements[`p${p}`] = el;
  }

  // Create persistent lead pip display (replaces old lead placeholder)
  createPersistentLeadPip();
}

// Update placeholder text (for bidding display)
function setPlaceholderText(playerId, text, bidType = ''){
  const el = placeholderElements[`p${playerId}`];
  if(el){
    const textEl = el.querySelector('.text');
    if(textEl) textEl.textContent = text;

    // Clear any existing bid classes
    el.classList.remove('bid-active', 'bid-pass', 'bid-winner');

    // Add appropriate class for animation
    if(bidType === 'bid'){
      el.classList.add('bid-active');
    } else if(bidType === 'pass'){
      el.classList.add('bid-pass');
    } else if(bidType === 'winner'){
      el.classList.add('bid-winner');
    }
  }
}

function clearAllPlaceholderText(){
  const _clrCount = GAME_MODE === 'T42' ? 4 : 6;
  for(let p = 1; p <= _clrCount; p++){
    setPlaceholderText(p, '', '');
  }
}

// Position player team indicators near their hands
function positionPlayerIndicators(){
  // In multiplayer, update indicator labels to show correct player numbers
  if (MULTIPLAYER_MODE && session && session.game) {
    for (let seat = 0; seat < session.game.player_count; seat++) {
      const visualP = mpVisualPlayer(seat);
      const el = document.getElementById('playerIndicator' + visualP);
      if (el) {
        // V10_106: Fix #2 — show player names/initials from mpPlayers
        const _mpPData = mpPlayers[seat];
        let _pLabel = 'P' + (seat + 1);
        if(_mpPData && _mpPData.name && _mpPData.name !== 'Player'){
          _pLabel = getPlayerInitials(_mpPData.name);
        }
        if(seat === mpSeat) _pLabel += '*';
        el.textContent = _pLabel;
        el.classList.remove('team1', 'team2', 'team3');
        if (GAME_MODE === 'MOON') {
          // Moon: 3 individual colors — P1 blue, P2 red, P3 neon green
          el.classList.add(seat === 0 ? 'team1' : seat === 1 ? 'team2' : 'team3');
        } else {
          el.classList.add(seat % 2 === 0 ? 'team1' : 'team2');
        }
      }
    }
  }
  // Player positions (xN, yN) - positioned BETWEEN hand center and played domino placeholder
  // P1: Special case - close to placeholder since there's a big gap
  // Others: Centered between rack middle and placeholder
  // V12.9.4: Use TN51_SETTINGS for indicator positions (adjustable via layout panel)
  const indicatorPositions_TN51 = {
    1: { xN: TN51_SETTINGS.ind1x, yN: TN51_SETTINGS.ind1y },
    2: { xN: TN51_SETTINGS.ind2x, yN: TN51_SETTINGS.ind2y },
    3: { xN: TN51_SETTINGS.ind3x, yN: TN51_SETTINGS.ind3y },
    4: { xN: TN51_SETTINGS.ind4x, yN: TN51_SETTINGS.ind4y },
    5: { xN: TN51_SETTINGS.ind5x, yN: TN51_SETTINGS.ind5y },
    6: { xN: TN51_SETTINGS.ind6x, yN: TN51_SETTINGS.ind6y }
  };
  const indicatorPositions_T42 = {
    1: { xN: T42_SETTINGS.ind1x, yN: T42_SETTINGS.ind1y },
    2: { xN: T42_SETTINGS.ind2x, yN: T42_SETTINGS.ind2y },
    3: { xN: T42_SETTINGS.ind3x, yN: T42_SETTINGS.ind3y },
    4: { xN: T42_SETTINGS.ind4x, yN: T42_SETTINGS.ind4y }
  };
  const indicatorPositions_MOON = {
    1: { xN: MOON_SETTINGS.ind1x, yN: MOON_SETTINGS.ind1y },
    2: { xN: MOON_SETTINGS.ind2x, yN: MOON_SETTINGS.ind2y },
    3: { xN: MOON_SETTINGS.ind3x, yN: MOON_SETTINGS.ind3y }
  };
  const indicatorPositions = GAME_MODE === 'MOON' ? indicatorPositions_MOON : (GAME_MODE === 'T42' ? indicatorPositions_T42 : indicatorPositions_TN51);
  const _indCount = GAME_MODE === 'MOON' ? 3 : (GAME_MODE === 'T42' ? 4 : 6);

  // Hide unused indicators
  for(let h = 4; h <= 6; h++){
    const hel = document.getElementById(`playerIndicator${h}`);
    if(hel) hel.style.display = (GAME_MODE === 'MOON' || (GAME_MODE === 'T42' && h > 4)) ? 'none' : '';
  }

  for(let p = 1; p <= _indCount; p++){
    const el = document.getElementById(`playerIndicator${p}`);
    if(el){
      const pos = indicatorPositions[p];
      const px = normToPx(pos.xN, pos.yN);
      el.style.left = (px.x - 14) + 'px';
      el.style.top = (px.y - 14) + 'px';
      // Show player name initials for local player (P1)
      if(p === 1 && playerName && !playerNoName){
        el.textContent = getPlayerInitials(playerName);
      } else if(!MULTIPLAYER_MODE){
        el.textContent = 'P' + p;
      }
      // Moon: assign 3 individual colors (P1 blue, P2 red, P3 neon green)
      if(GAME_MODE === 'MOON'){
        el.classList.remove('team1', 'team2', 'team3');
        el.classList.add(p === 1 ? 'team1' : p === 2 ? 'team2' : 'team3');
      }
    }
  }
}

// Call on window resize and init
window.addEventListener('resize', positionPlayerIndicators);
// Initial positioning after DOM ready
setTimeout(positionPlayerIndicators, 100);

function recenterHand(seat){
  // seat is 0-5, sprites are indexed by seat
  const seatSprites = sprites[seat];
  if(!seatSprites) return Promise.resolve();

  const remaining = seatSprites.filter(s => s !== null);
  if(remaining.length === 0) return Promise.resolve();

  // Convert seat to player number for layout lookups
  const playerNum = MULTIPLAYER_MODE ? mpVisualPlayer(seat) : (PASS_AND_PLAY_MODE ? ppVisualPlayer(seat) : seatToPlayer(seat));
  const section = getSection(`Player_${playerNum}_Hand`);
  if(!section || section.dominoes.length < 2) return Promise.resolve();

  // Get first and last slot positions to calculate the full span
  const first = section.dominoes[0];
  const last = section.dominoes[section.dominoes.length - 1];
  const slotCount = section.dominoes.length - 1;

  // Calculate center point of the hand area
  const centerXN = (first.xN + last.xN) / 2;
  const centerYN = (first.yN + last.yN) / 2;

  // Calculate the spacing vector between adjacent dominoes
  const spacingXN = slotCount > 0 ? (last.xN - first.xN) / slotCount : 0;
  const spacingYN = slotCount > 0 ? (last.yN - first.yN) / slotCount : 0;

  const count = remaining.length;

  const promises = [];
  remaining.forEach((data, i) => {
    // Calculate position relative to center
    // For count dominoes, positions are: -(count-1)/2, -(count-3)/2, ..., (count-1)/2
    const offsetFromCenter = i - (count - 1) / 2;

    const xN = centerXN + offsetFromCenter * spacingXN;
    const yN = centerYN + offsetFromCenter * spacingYN;

    const px = normToPx(xN, yN);
    const targetPose = {
      x: px.x - 28,
      y: px.y - 56,
      s: first.scale,
      rz: first.rotZ,
      ry: data.sprite.getPose().ry
    };

    promises.push(
      new Promise(resolve => {
        setTimeout(() => {
          animateSprite(data.sprite, targetPose, ANIM.HAND_RECENTER_DURATION).then(resolve);
        }, ANIM.HAND_RECENTER_DELAY);
      })
    );
  });

  return Promise.all(promises);
}

/******************************************************************************
 * GAME LOGIC
 ******************************************************************************/

function setStatus(msg){
  statusBar.textContent = msg;
}

function enablePlayer1Clicks(){
  console.log("enablePlayer1Clicks called");
  const localSeat = getLocalSeat();
  const p1Sprites = sprites[localSeat];
  if(!p1Sprites) {
    console.log("No p1Sprites found for seat", localSeat);
    return;
  }
  console.log("p1Sprites count:", p1Sprites.length, "for seat", localSeat);
  p1Sprites.forEach((data, idx) => {
    if(data && data.sprite){
      data.sprite.classList.add('clickable');
      console.log("Added clickable to sprite", idx);
    }
  });
}

function disablePlayer1Clicks(){
  const localSeat = getLocalSeat();
  const p1Sprites = sprites[localSeat];
  if(!p1Sprites) return;
  p1Sprites.forEach(data => {
    if(data && data.sprite){
      data.sprite.classList.remove('clickable');
    }
  });
}

async function playDomino(seat, spriteSlotIndex, isLead = false, aiRec = null, prePlayContext = null){
  // seat is 0-5, sprites are indexed by seat
  const seatSprites = sprites[seat];
  if(!seatSprites) return;

  const data = seatSprites[spriteSlotIndex];
  if(!data) return;

  const sprite = data.sprite;
  const tile = data.tile;

  // Log trick start if this is the lead
  if(isLead){
    const _isTrumpLead = session && session.game && session.game._is_trump_tile(tile);
    const ledPip = _isTrumpLead ? "Trump" : Math.max(tile[0], tile[1]);
    logTrickStart(seat, ledPip);
  }

  // Build play context for logging - use pre-captured context if provided
  const isAISeat = seat !== getLocalSeat();
  const legalTiles = prePlayContext?.legalTiles || [];
  const currentWinner = prePlayContext?.currentWinner || null;

  // Log the play with full context
  logPlay(seat, tile, aiRec?.reason || null, isAISeat, aiRec, {
    legalTiles: legalTiles,
    currentWinner: currentWinner
  });

  seatSprites[spriteSlotIndex] = null;

  bringToFront(sprite);

  // Convert seat to player number for layout lookups
  const playerNum = MULTIPLAYER_MODE ? mpVisualPlayer(seat) : (PASS_AND_PLAY_MODE ? ppVisualPlayer(seat) : seatToPlayer(seat));
  const targetPose = getPlayedPosition(playerNum);
  if(!targetPose) return;

  // Start both animations at the same time
  // Hand recenter starts immediately (with its own delay offset)
  recenterHand(seat);

  // Play animation runs in parallel
  await animateSprite(sprite, targetPose, ANIM.PLAY_DURATION);

  // Play domino place sound
  SFX.playDomino();

  // If this is the lead (first play of the trick), show it in center
  if(isLead){
    showLeadDomino(tile);
  }

  // Highlight trump tiles now that they're face-up
  if(session.game._is_trump_tile(tile)){
    sprite.setState(true, true);  // highlighted=true, valid=true
  }

  playedThisTrick.push({ sprite, seat, tile });

  // Update winning domino highlight
  updateWinningHighlight();
}

// Update which domino has the winning highlight in current trick
function updateWinningHighlight(){
  // Clear all winning highlights first
  for(const played of playedThisTrick){
    if(played.sprite){
      played.sprite.classList.remove('winning');
    }
  }

  // Determine current winner and add highlight
  if(playedThisTrick.length > 0 && session.game.current_trick.length > 0){
    const winnerSeat = session.game._determine_trick_winner();
    // Find the played sprite for the winner
    for(const played of playedThisTrick){
      if(played.seat === winnerSeat && played.sprite){
        played.sprite.classList.add('winning');
        break;
      }
    }
  }
}

// Clear winning highlights (call when trick ends)
function clearWinningHighlight(){
  for(const played of playedThisTrick){
    if(played.sprite){
      played.sprite.classList.remove('winning');
    }
  }
}

async function opponentsPlay(){
  // P2 through P6 play in clockwise order
  for(let i = 1; i < PLAY_ORDER.length; i++){
    const playerNum = PLAY_ORDER[i];
    const _pts = GAME_MODE === 'MOON' ? PLAYER_TO_SEAT_MOON : (GAME_MODE === 'T42' ? PLAYER_TO_SEAT_T42 : PLAYER_TO_SEAT_TN51);
    const seat = _pts[playerNum];
    const seatSprites = sprites[seat];
    const firstAvailable = seatSprites.findIndex(s => s !== null);

    if(firstAvailable !== -1){
      const variedDelay = ANIM.OPPONENT_PLAY_DELAY * (1 + (Math.random() * 2 - 1) * 0.15);
      await new Promise(r => setTimeout(r, variedDelay));
      setStatus(`Player ${playerNum} plays...`);
      await playDomino(seat, firstAvailable);
    }
  }
}

async function collectToHistory(){
  if(playedThisTrick.length === 0) return;

  // Hide boneyard BEFORE animation starts (will be restored after collection + delay)
  if(boneyard2Visible){
    const by2c = document.getElementById('boneyard2Container');
    const thBg = document.getElementById('trickHistoryBg');
    if(by2c) by2c.style.display = 'none';
    if(thBg) thBg.style.display = '';
    showTrickHistorySprites();
  }

  // Clear winning highlight before collecting
  clearWinningHighlight();

  // Play collect sound
  SFX.playCollect();

  setStatus('Collecting to trick history...');

  // Determine which team won the trick
  const winnerSeat = session.game._determine_trick_winner();
  const winningTeam = session.game.team_of(winnerSeat);  // 0 = Team 1, 1 = Team 2 (Moon: player seat 0/1/2)

  // Get the team's trick win index (how many tricks this team/player has won so far)
  let teamTrickIndex;
  if(GAME_MODE === 'MOON'){
    teamTrickIndex = moonPlayerTricksWon[winningTeam] || 0;
    moonPlayerTricksWon[winningTeam]++;
  } else {
    teamTrickIndex = winningTeam === 0 ? team1TricksWon : team2TricksWon;
    if(winningTeam === 0) team1TricksWon++;
    else team2TricksWon++;
  }

  console.log(`Trick won by ${GAME_MODE === 'MOON' ? 'P' + (winningTeam+1) : 'Team ' + (winningTeam+1)} (seat ${winnerSeat}), trick #${teamTrickIndex + 1}`);

  // Sort by player number for consistent ordering
  playedThisTrick.sort((a, b) => seatToPlayer(a.seat) - seatToPlayer(b.seat));

  for(let i = 0; i < playedThisTrick.length; i++){
    const { sprite, seat } = playedThisTrick[i];

    await new Promise(r => setTimeout(r, ANIM.COLLECT_STAGGER));

    bringToFront(sprite);

    // V10_122: Safety check - sprite might be undefined if already collected
    if(!sprite) {
      console.warn('[collectToHistory] Sprite undefined, skipping');
      return;
    }

    // Tag this sprite as being in trick history (for boneyard 2 toggling and repositioning)
    sprite._inTrickHistory = true;
    sprite._thTeamTrickIndex = teamTrickIndex;
    sprite._thWinningTeam = winningTeam;
    sprite._thPlayerRowIndex = GAME_MODE === 'MOON' ? seat : (seatToPlayer(seat) - 1);
    if(sprite._shadow) sprite._shadow._inTrickHistory = true;

    // For Moon: playerRowIndex = seat (0,1,2) = which row within the block
    // For TN51/T42: playerRowIndex = player number - 1
    const playerRowIndex = sprite._thPlayerRowIndex;

    const targetPose = getTrickHistoryPosition(teamTrickIndex, winningTeam, playerRowIndex);
    if(targetPose){
      animateSprite(sprite, targetPose, ANIM.COLLECT_DURATION);
    }
  }

  await new Promise(r => setTimeout(r, ANIM.COLLECT_DURATION));

  // Hide the lead domino display
  hideLeadDomino();



  // Update the scores from the game engine
  team1Score = session.game.team_points[0];
  team2Score = session.game.team_points[1];
  updateScoreDisplay();

  // Log trick end with points scored this trick
  // Use the same formula as the game engine: 1 base + 5 for pip sum=5, + 10 for pip sum=10
  let pointsThisTrick = 1; // base point per trick
  for(const p of playedThisTrick){
    if(!p.tile) continue;
    const s = p.tile[0] + p.tile[1];
    if(s === 5) pointsThisTrick += 5;
    else if(s === 10) pointsThisTrick += 10;
  }
  logTrickEnd(winnerSeat, pointsThisTrick);

  // Update off-tracker with completed trick data
  updateOffTracker();

  // Auto-save after each trick
  autoSave();

  // Refresh boneyard 2 if visible — boneyard was hidden before animation,
  // now bring it back after a 1000ms delay
  if(boneyard2Visible){
    // Trick has been collected — show trick history sprites
    showTrickHistorySprites();
    const container = document.getElementById('boneyard2Container');
    const thBg = document.getElementById('trickHistoryBg');
    // After 1000ms delay, bring boneyard back
    setTimeout(() => {
      if(boneyard2Visible){
        hideTrickHistorySprites();
        if(container) container.style.display = 'block';
        if(thBg) thBg.style.display = 'none';
        renderBoneyard2();
      }
    }, 1000);
  }

  playedThisTrick = [];
  currentTrick++;
}

// Find the current slot index for a sprite element in player 1's hand
function findSpriteSlotIndex(spriteElement){
  // In PP mode, search the active viewing seat
  const searchSeat = getLocalSeat();
  const searchSprites = sprites[searchSeat] || [];
  for(let i = 0; i < searchSprites.length; i++){
    const data = searchSprites[i];
    if(!data) continue;
    const spriteEl = data.sprite.el ? data.sprite.el : data.sprite;
    if(spriteEl === spriteElement){
      return i;
    }
  }
  // Fallback: search all seats
  for(let s = 0; s < session.game.player_count; s++){
    const ss = sprites[s] || [];
    for(let i = 0; i < ss.length; i++){
      const data = ss[i];
      if(!data) continue;
      const spriteEl = data.sprite.el ? data.sprite.el : data.sprite;
      if(spriteEl === spriteElement) return i;
    }
  }
  return -1;
}

async function handlePlayer1Click(spriteSlotIndexOrElement){
  // Support both slot index (legacy) and sprite element (new)
  let spriteSlotIndex;
  if(typeof spriteSlotIndexOrElement === 'number'){
    spriteSlotIndex = spriteSlotIndexOrElement;
  } else {
    // It's a sprite element - find its current position in the array
    spriteSlotIndex = findSpriteSlotIndex(spriteSlotIndexOrElement);
    if(spriteSlotIndex === -1){
      console.log("Could not find sprite in array");
      return;
    }
  }

  console.log("handlePlayer1Click called, spriteSlot:", spriteSlotIndex);
  console.log("isAnimating:", isAnimating, "waitingForPlayer1:", waitingForPlayer1);
  console.log("session.phase:", session.phase, "trumpSelectionActive:", trumpSelectionActive);

  // If in widow swap mode, route to widow swap handler
  if(window._widowSwapMode && typeof window._widowSwapClickHandler === 'function'){
    window._widowSwapClickHandler(spriteSlotIndex);
    return;
  }

  // If in trump selection mode, route to trump selection instead
  // Also do preview shuffle so hand re-sorts when clicking during trump selection
  if(trumpSelectionActive && session.phase === PHASE_NEED_TRUMP){
    const trumpSeat = getLocalSeat();
    const spriteData = sprites[trumpSeat][spriteSlotIndex];
    if(spriteData && spriteData.tile){
      handleTrumpDominoClick(spriteData.tile);
      // Preview sort using the currently selected trump (don't call handleBiddingDominoClick
      // which shares trumpClickState and would double-count the click)
      if(selectedTrump !== undefined && typeof previewSortHandByTrump === 'function'){
        previewSortHandByTrump(selectedTrump);
        SFX.playShuffle();
      }
    }
    return;
  }

  // If in bidding preview mode, route to bidding preview handler
  // Works during ALL pre-play phases: bidding, waiting, trump selection, widow swap
  if(biddingPreviewActive && session.phase !== PHASE_PLAYING){
    const bidSeat = getLocalSeat();
    const spriteData = sprites[bidSeat][spriteSlotIndex];
    if(spriteData && spriteData.tile){
      handleBiddingDominoClick(spriteData.tile);
    }
    return;
  }

  if(isAnimating || !waitingForPlayer1) {
    console.log("Click ignored - animating or not player 1's turn");
    return;
  }

  if(session.phase !== PHASE_PLAYING){
    console.log("Click ignored - not in playing phase");
    return;
  }

  // In PP/MP mode, find which seat this sprite belongs to
  const ppClickSeat = getLocalSeat();
  const spriteData = sprites[ppClickSeat][spriteSlotIndex];
  if(!spriteData || !spriteData.tile) {
    console.log("No sprite data at index", spriteSlotIndex);
    return;
  }

  const clickedTile = spriteData.tile;
  console.log("Clicked tile:", clickedTile);

  // Find this tile's index in the current game hand
  const hand = session.game.hands[ppClickSeat] || [];
  let gameHandIndex = -1;
  for(let i = 0; i < hand.length; i++){
    const ht = hand[i];
    if((ht[0] === clickedTile[0] && ht[1] === clickedTile[1]) ||
       (ht[0] === clickedTile[1] && ht[1] === clickedTile[0])){
      gameHandIndex = i;
      break;
    }
  }

  if(gameHandIndex < 0){
    console.log("Tile not found in game hand:", clickedTile, "hand:", hand);
    setStatus("Error: Tile not in hand");
    return;
  }

  console.log("Found tile at game hand index:", gameHandIndex);

  // Check if this is a legal move
  const legal = session.game.legal_indices_for_player(ppClickSeat);
  if(!legal.includes(gameHandIndex)){
    console.log("Click ignored - illegal move, legal indices:", legal, "clicked index:", gameHandIndex);
    setStatus("That's not a legal play!");
    return;
  }

  // ═══ V10_121: GUEST PATH — Send intent, lift tile, wait for host confirmation ═══
  if (MULTIPLAYER_MODE && !mpIsHost) {
    console.log('[MP-HA] Guest sending play intent:', clickedTile);
    waitingForPlayer1 = false;
    disablePlayer1Clicks();
    clearHint();
    clearPlayer1ValidStates();

    // Minimize lay down button if showing
    if (layDownState && !layDownMinimized) {
      document.getElementById('layDownBtnGroup').style.display = 'none';
      document.getElementById('layDownMinDot').style.display = 'block';
      layDownMinimized = true;
    }
    hideCallDoubleBanner();
    if (_turnRecoveryTimer) { clearTimeout(_turnRecoveryTimer); _turnRecoveryTimer = null; }

    // Lift tile for visual feedback
    _liftTileForIntent(spriteSlotIndex);

    // Send intent to host
    mpSendMove({ action: 'play_intent', seat: mpSeat, tile: clickedTile });
    setStatus('Playing...');
    return; // ← Guest stops here. mpHandlePlayConfirmed() continues on receipt.
  }

  // ═══ HOST / SINGLE-PLAYER PATH — Execute locally ═══

  // If lay down button is showing, minimize to dot (player chose to play a tile)
  if(layDownState && !layDownMinimized) {
    document.getElementById('layDownBtnGroup').style.display = 'none';
    document.getElementById('layDownMinDot').style.display = 'block';
    layDownMinimized = true;
    // Keep layDownState so it can be restored later
  }

  // Hide Call for Double banner if showing (player clicked their forced double)
  hideCallDoubleBanner();

  // V10_115: Clear turn recovery timer — player is playing
  if(_turnRecoveryTimer) { clearTimeout(_turnRecoveryTimer); _turnRecoveryTimer = null; }

  isAnimating = true;
  waitingForPlayer1 = false;
  disablePlayer1Clicks();
  clearHint();
  clearPlayer1ValidStates(); // V10_121: Remove faded tile highlighting immediately after play

  setStatus(PASS_AND_PLAY_MODE ? 'P' + (ppClickSeat + 1) + ' plays...' : 'You play...');

  // Capture context BEFORE playing (for accurate logging)
  const aiRec = choose_tile_ai(session.game, ppClickSeat, session.contract, true, session.current_bid);
  const legalIndices = session.game.legal_indices_for_player(ppClickSeat);
  const legalTiles = legalIndices.map(i => hand[i]).filter(t => t);

  // Capture current trick winner BEFORE this play
  let currentWinner = null;
  const trick = session.game.current_trick || [];
  if(trick.length > 0){
    const winnerSeat = session.game._determine_trick_winner();
    currentWinner = { seat: winnerSeat, team: winnerSeat % 2 === 0 ? 1 : 2 };
  }

  const prePlayContext = { legalTiles, currentWinner };

  // Use the game engine to play the tile
  const isLead = session.game.current_trick.length === 0;
  let _needCallDoubleCheck = false;
  try {
    const playSeat = MULTIPLAYER_MODE ? mpSeat : ppClickSeat;
    session.play(playSeat, gameHandIndex);
    // V10_121: For host MP, defer broadcast until after Call for Double check
    _needCallDoubleCheck = isLead && session.game.trick_number === 0 && callForDoubleEnabled;
    // V10_121: Host broadcasts play_confirmed (not play). Deferred if Call for Double may trigger.
    if (MULTIPLAYER_MODE && mpIsHost && !_needCallDoubleCheck) {
      const _trickComplete = session.game._sanitized_trick().length >= session.game.active_players.length;
      mpSendMove({ action: 'play_confirmed', seat: playSeat, tile: clickedTile, isLead: isLead,
        trickNumber: session.game.trick_number, nextPlayer: session.game.current_player,
        currentPlayer: session.game.current_player, trickComplete: _trickComplete,
        trickWinner: _trickComplete ? session.game._determine_trick_winner() : null,
        handComplete: false, handResult: null });
    }
  } catch(e) {
    console.log("Play error:", e);
    isAnimating = false;
    waitingForPlayer1 = true;
    enablePlayer1Clicks();
    setStatus("Error: " + e.message);
    return;
  }

  // Check for Call for Double BEFORE animating the lead tile
  if(shouldShowCallForDouble()){
    const localSeat = getLocalSeat();
    const bidder = session.bid_winner_seat !== undefined ? session.bid_winner_seat : 0;
    if(bidder === localSeat){
      // Human bidder — show button bar, pause animation until decision
      _pendingCallDoubleAnim = { seat: MULTIPLAYER_MODE ? mpSeat : ppClickSeat, spriteSlotIndex, isLead, aiRec, prePlayContext, ppClickSeat,
        mpPlayData: MULTIPLAYER_MODE ? { seat: MULTIPLAYER_MODE ? mpSeat : ppClickSeat, tile: clickedTile, trickNumber: session.game.trick_number, nextPlayer: session.game.current_player } : null };
      document.getElementById('callDoubleBtnGroup').style.display = 'flex';
      return; // Pause — resumeAfterCallDouble() will continue
    } else {
      // AI bidder — decide automatically
      const shouldCall = aiShouldCallForDouble(bidder);
      if(shouldCall){
        callForDoubleActive = true;
        session.game.force_double_trump = true;
        setStatus(getPlayerDisplayName(bidder) + ' calls for the double!');
        applyForcedDoubleGlow();
      }
      // V10_121: Host broadcasts deferred play_confirmed now
      if(MULTIPLAYER_MODE && mpIsHost){
        const playSeat = mpSeat;
        const _trickComplete = session.game._sanitized_trick().length >= session.game.active_players.length;
        mpSendMove({ action: 'play_confirmed', seat: playSeat, tile: clickedTile, isLead: isLead,
          trickNumber: session.game.trick_number, nextPlayer: session.game.current_player,
          currentPlayer: session.game.current_player, trickComplete: _trickComplete,
          trickWinner: _trickComplete ? session.game._determine_trick_winner() : null,
          handComplete: false, handResult: null });
      }
    }
  } else if(_needCallDoubleCheck && MULTIPLAYER_MODE && mpIsHost){
    // V10_121: Deferred broadcast — Call for Double didn't trigger
    const playSeat = mpSeat;
    const _trickComplete = session.game._sanitized_trick().length >= session.game.active_players.length;
    mpSendMove({ action: 'play_confirmed', seat: playSeat, tile: clickedTile, isLead: isLead,
      trickNumber: session.game.trick_number, nextPlayer: session.game.current_player,
      currentPlayer: session.game.current_player, trickComplete: _trickComplete,
      trickWinner: _trickComplete ? session.game._determine_trick_winner() : null,
      handComplete: false, handResult: null });
  }

  // Animate the domino to the center (seat 0 = player 1, pass AI rec and pre-play context)
  const animSeat = MULTIPLAYER_MODE ? mpSeat : ppClickSeat;
  await playDomino(animSeat, spriteSlotIndex, isLead, aiRec, prePlayContext);

  // Check if trick is complete
  if(session.game._sanitized_trick().length >= session.game.active_players.length){
    await new Promise(r => setTimeout(r, 800));
    // Don't clear current_trick here - collectToHistory needs it to determine winner
    await collectToHistory();
    // Clear current_trick AFTER collecting (winner determination done)
    session.game.current_trick = [];
    // Clear call for double after trick 1
    if(session.game.force_double_trump){
      session.game.force_double_trump = false;
      callForDoubleActive = false;
      clearForcedDoubleGlow();
      hideCallDoubleBanner();
    }
    if (MULTIPLAYER_MODE) {
      playedThisTrick = [];
      currentTrick++;
    }

    // Check if hand is done
    if(session.maybe_finish_hand()){
      // V10_121: Host broadcasts hand-end result to guests
      if (MULTIPLAYER_MODE && mpIsHost) {
        mpSendMove({ action: 'play_confirmed', seat: MULTIPLAYER_MODE ? mpSeat : ppClickSeat,
          tile: clickedTile, isLead: isLead, trickNumber: session.game.trick_number,
          nextPlayer: session.game.current_player, currentPlayer: session.game.current_player,
          trickComplete: true, trickWinner: null,
          handComplete: true, handResult: {
            status: session.status,
            teamPoints: [session.game.team_points[0], session.game.team_points[1]],
            teamMarks: [session.team_marks[0], session.team_marks[1]]
          }
        });
        mpSaveHostState();
      }
      setStatus(session.status);
      team1Score = session.game.team_points[0];
      team2Score = session.game.team_points[1];
      team1Marks = session.team_marks[0];
      team2Marks = session.team_marks[1];
      updateScoreDisplay();
      logEvent('HAND_END', { status: session.status });
      autoSave();
      setTimeout(() => {
        if (MULTIPLAYER_MODE) { mpShowHandEnd(); } else { showHandEndPopup(); }
      }, 800);
      isAnimating = false;
      return;
    }

    // Check for lay down opportunity (shows button, but doesn't block play)
    checkLayDown();
  }

  // AI/Human players take their turns
  isAnimating = false;

  // Clear forced double glow when trick 1 ends
  if(!session.game.force_double_trump){
    clearForcedDoubleGlow();
  }

  if (MULTIPLAYER_MODE) {
    // In multiplayer, check whose turn it is next
    mpCheckWhoseTurn();
  } else if (PASS_AND_PLAY_MODE) {
    // Small delay to ensure any pending animations (recenterHand) settle
    setTimeout(() => maybeAIKick(), 100);
  } else {
    await aiPlayTurn();
  }
}

function dealDominoes(){
  hideGameEndSummary();
  hideRoundEndSummary();
  // Reset house rule flags for new hand
  callForDoubleActive = false;
  callForDoubleTrumpPip = null;
  nelloDoublesSuitActive = false;
  _dfmActiveThisHand = false; // V12.10.21: always start false, set true only when doubles trump confirmed
  _dfmChoiceMade = false;
  if(session && session.game){
    session.game.force_double_trump = false;
    session.game.nello_doubles_suit = false;
  }
  // Hide Call for Double UI
  document.getElementById('callDoubleBtnGroup').style.display = 'none';
  hideCallDoubleBanner();
  clearForcedDoubleGlow();
  shadowLayer.innerHTML = '';
  spriteLayer.innerHTML = '';
  sprites.length = 0;
  currentTrick = 0;
  playedThisTrick = [];
  team1TricksWon = 0;
  team2TricksWon = 0;
  moonPlayerTricksWon = [0, 0, 0];
  zIndexCounter = 100;
  // Clean up previous widow sprite
  if(widowSprite){
    if(widowSprite.parentNode) widowSprite.parentNode.removeChild(widowSprite);
    if(widowSprite._shadow && widowSprite._shadow.parentNode) widowSprite._shadow.parentNode.removeChild(widowSprite._shadow);
    widowSprite = null;
  }
  var _widowLbl = document.getElementById('moonWidowLabel');
  if(_widowLbl) _widowLbl.style.display = 'none';
  isAnimating = false;
  waitingForPlayer1 = true;

  // Create placeholder boxes
  createPlaceholders();

  // Sample tiles for demo — generate dynamically based on game mode
  const _demoPC = session.game.player_count;
  const _demoHS = session.game.hand_size;
  const _demoMP = session.game.max_pip;
  const sampleTiles = [];
  for(let p = 0; p < _demoPC; p++){
    const hand = [];
    for(let h = 0; h < _demoHS; h++){
      const a = (_demoMP - p - h + _demoMP + 1) % (_demoMP + 1);
      const b = (_demoMP - p - h - 1 + _demoMP + 1) % (_demoMP + 1);
      hand.push([a, b]);
    }
    sampleTiles.push(hand);
  }

  for(let p = 0; p < _demoPC; p++){
    sprites[p] = [];
    const playerNum = seatToPlayer(p);  // Convert seat to player number for layout
    for(let h = 0; h < _demoHS; h++){
      const tile = sampleTiles[p][h];
      const sprite = makeSprite(tile);

      const pos = getHandPosition(playerNum, h);
      if(pos){
        sprite.setPose(pos);
        // Add shadow to shadow layer, sprite to sprite layer
        if(sprite._shadow){
          shadowLayer.appendChild(sprite._shadow);
        }
        spriteLayer.appendChild(sprite);

        // Store data
        const data = { sprite, tile, originalSlot: h };
        sprites[p][h] = data;

        // Add click handler for P1 - pass sprite element directly for dynamic lookup after sorting
        if(p === 0){
          sprite.addEventListener('click', () => handlePlayer1Click(sprite));
        }
      }
    }
  }

  enablePlayer1Clicks();
  setStatus('Trick 1 - Click a domino to play');

  // Initialize score display with demo values
  team1Score = 45;
  team2Score = 32;
  team1Marks = 15;
  team2Marks = 15;
  updateScoreDisplay();
}

/******************************************************************************
 * GAME FLOW - Bidding, Trump Selection, and Playing
 ******************************************************************************/

// Sync sprites with game state - updates tile display
// Sort player's hand by trump:
// 1. Double trump (far left)
// 2. Trump tiles by OTHER pip descending (7, 6, 5... skipping the trump value)
// 3. Non-trump doubles, highest to lowest
// 4. Non-trump non-doubles by high pip descending
function sortPlayerHandByTrump(){
  const sortSeat = getLocalSeat();
  const seatSprites = sprites[sortSeat] || [];
  const validSprites = seatSprites.filter(d => d && d.tile);

  if(validSprites.length === 0) return;

  const trumpSuit = session.game.trump_suit;
  const trumpMode = session.game.trump_mode;

  // Sorting function returns [priority, subSort] where lower is better (goes left)
  const getSortKey = (tile) => {
    const highPip = Math.max(tile[0], tile[1]);
    const lowPip = Math.min(tile[0], tile[1]);
    const isDouble = tile[0] === tile[1];

    // Check if this tile is a trump
    let isTrump = false;
    let isDoubleTrump = false;
    let otherPip = 0;  // For trump tiles, the non-trump pip value

    if(trumpMode === 'PIP' && trumpSuit !== null){
      const hasTrumpPip = tile[0] === trumpSuit || tile[1] === trumpSuit;
      if(hasTrumpPip){
        isTrump = true;
        isDoubleTrump = isDouble;  // Both pips are trump
        // Get the other pip (non-trump side)
        otherPip = (tile[0] === trumpSuit) ? tile[1] : tile[0];
      }
    } else if(trumpMode === 'DOUBLES'){
      if(isDouble){
        isTrump = true;
        isDoubleTrump = true;
      }
    }

    // Priority levels (lower = goes more to the left):
    // 0: Double trump
    // 1: Trump tiles (sorted by other pip descending, so 7-trump, 6-trump, etc.)
    // 2: Non-trump doubles (sorted by pip descending)
    // 3: Non-trump non-doubles (sorted by high pip, then low pip)

    if(isDoubleTrump){
      // Double trump goes first (priority 0)
      // Sub-sort by pip value descending (higher double trump goes more left)
      return [0, 100 - highPip];
    } else if(isTrump){
      // Trump tile (not double) - priority 1
      // Sort by the OTHER pip descending (7 goes left of 6, etc.)
      return [1, 100 - otherPip];
    } else if(isDouble){
      // Non-trump double - priority 2
      // Sort by pip descending
      return [2, 100 - highPip];
    } else {
      // Non-trump non-double - priority 3
      // Sort by high pip desc, then low pip desc
      return [3, (100 - highPip) * 10 + (100 - lowPip)];
    }
  };

  // Sort sprites by their tiles
  // NOTE: Slot 0 is on the RIGHT, slot 5 is on the LEFT
  // So we reverse the sort: highest priority (lowest number) goes to highest index (leftmost)
  validSprites.sort((a, b) => {
    const keyA = getSortKey(a.tile);
    const keyB = getSortKey(b.tile);
    // Compare priority first (reversed: b - a so priority 0 goes to end/left)
    if(keyA[0] !== keyB[0]) return keyB[0] - keyA[0];
    // Same priority, compare sub-sort (reversed)
    return keyB[1] - keyA[1];
  });

  // Reassign to sprites array and animate to new positions
  const playerNum = MULTIPLAYER_MODE ? mpVisualPlayer(sortSeat) : (PASS_AND_PLAY_MODE ? ppVisualPlayer(sortSeat) : seatToPlayer(sortSeat));
  for(let i = 0; i < validSprites.length; i++){
    sprites[sortSeat][i] = validSprites[i];
    const pos = getHandPosition(playerNum, i);
    if(pos && validSprites[i].sprite){
      animateSprite(validSprites[i].sprite, pos, 300);
    }
  }

  // Clear remaining slots
  for(let i = validSprites.length; i < 7; i++){
    sprites[sortSeat][i] = null;
  }
}

// Sort ALL players' underlying hand arrays by trump
function sortAllHandsByTrump(){
  if (!session || !session.game) return;
  const trumpSuit = session.game.trump_suit;
  const trumpMode = session.game.trump_mode;

  function isTrump(tile){
    if(trumpMode==="NONE") return false;
    if(trumpMode==="DOUBLES") return tile[0]===tile[1];
    return tile[0]===trumpSuit || tile[1]===trumpSuit;
  }
  function trumpStrength(tile){
    if(trumpMode==="DOUBLES") return tile[0]===tile[1] ? 100+tile[0] : -1;
    const t = Number(trumpSuit);
    if(tile[0]===t && tile[1]===t) return 100;
    if(tile[0]===t) return tile[1];
    if(tile[1]===t) return tile[0];
    return -1;
  }

  for (let seat = 0; seat < session.game.player_count; seat++){
    if (seat === getLocalSeat()) continue; // Local player sorted by sortPlayerHandByTrump
    const hand = session.game.hands[seat] || [];
    const non=[], tr=[];
    for(const tile of hand){
      if(isTrump(tile)) tr.push(tile); else non.push(tile);
    }
    non.sort((x,y)=>{
      const xd=(x[0]===x[1])?1:0, yd=(y[0]===y[1])?1:0;
      if(xd!==yd) return yd-xd;
      return (Math.max(y[0],y[1])*10+Math.min(y[0],y[1])) - (Math.max(x[0],x[1])*10+Math.min(x[0],x[1]));
    });
    tr.sort((x,y)=> trumpStrength(y) - trumpStrength(x));
    session.game.hands[seat] = non.concat(tr);
  }
}

// Flip all tiles so trump pip is on top (tile[0])
// Applies to all hands and sprite data, NOT boneyard
function flipTilesForTrump(){
  if (!window.FLIP_TRUMP_ENABLED) return; // Toggle check
  if (!session || !session.game) return;
  const trumpSuit = session.game.trump_suit;
  const trumpMode = session.game.trump_mode;
  if (trumpMode === 'NONE' || trumpMode === 'DOUBLES') return; // Only flip for PIP mode

  const localSeat = getLocalSeat();

  // V11.4: Restore ALL tiles to canonical orientation first (high pip on top)
  // This ensures preview flips from bidding are undone before applying actual trump flip
  for (let p = 0; p < session.game.player_count; p++){
    const hand = session.game.hands[p] || [];
    for (let i = 0; i < hand.length; i++){
      const t = hand[i];
      if (t && t[0] !== t[1] && t[0] < t[1]) {
        hand[i] = [t[1], t[0]]; // Restore canonical: high pip first
      }
    }
    const seatSprites = sprites[p] || [];
    for (let i = 0; i < seatSprites.length; i++){
      const data = seatSprites[i];
      if (data && data.tile && data.tile[0] !== data.tile[1] && data.tile[0] < data.tile[1]) {
        data.tile = [data.tile[1], data.tile[0]];
        if (data.sprite) {
          data.sprite._tile = data.tile;
          data.sprite.dataset.tile = JSON.stringify(data.tile);
          data.sprite.redrawCanvases && data.sprite.redrawCanvases();
        }
      }
    }
  }

  function shouldFlip(tile){
    if (!tile || tile[0] === tile[1]) return false; // Don't flip doubles
    if (tile[1] === trumpSuit && tile[0] !== trumpSuit) return true;
    return false;
  }

  // Collect sprites that need flipping for animation
  const spritesToAnimate = [];

  // Flip ALL players' hand data (so trump is always on top/left)
  for (let p = 0; p < session.game.player_count; p++){
    const hand = session.game.hands[p] || [];
    for (let i = 0; i < hand.length; i++){
      if (shouldFlip(hand[i])){
        hand[i] = [hand[i][1], hand[i][0]];
      }
    }
  }

  // Flip ALL players' sprite data
  for (let p = 0; p < session.game.player_count; p++){
    const seatSprites = sprites[p] || [];
    for (let i = 0; i < seatSprites.length; i++){
      const data = seatSprites[i];
      if (data && data.tile && shouldFlip(data.tile)){
        data.tile = [data.tile[1], data.tile[0]];
        if (data.sprite) {
          data.sprite._tile = data.tile;
          data.sprite.dataset.tile = JSON.stringify(data.tile);
          if (p === localSeat) {
            // Local player: animate the 180° flip
            const pose = data.sprite._pose || {x:0,y:0,s:1,rz:0,ry:180};
            const origRz = pose.rz || 0;
            pose.rz = origRz + 180;
            data.sprite._pose = pose;
            data.sprite.style.transform = `translate(${pose.x}px,${pose.y}px) scale(${pose.s}) rotate(${pose.rz}deg)`;
            data.sprite.redrawCanvases && data.sprite.redrawCanvases();
            spritesToAnimate.push({sprite: data.sprite, targetRz: origRz});
          } else {
            // Opponents: instant redraw, no animation
            data.sprite.redrawCanvases && data.sprite.redrawCanvases();
          }
        }
      }
    }
  }

  // Animate the 180° spin for all flipped sprites
  if (spritesToAnimate.length > 0){
    const FLIP_DURATION = 400; // ms
    const startTime = performance.now();
    function animateFlips(now){
      const elapsed = now - startTime;
      const progress = Math.min(1, elapsed / FLIP_DURATION);
      // Ease-in-out
      const t = progress < 0.5 ? 2*progress*progress : 1 - Math.pow(-2*progress + 2, 2) / 2;
      for (const item of spritesToAnimate){
        const pose = item.sprite._pose;
        const currentRz = item.targetRz + 180 * (1 - t);
        pose.rz = currentRz;
        item.sprite.style.transform = `translate(${pose.x}px,${pose.y}px) scale(${pose.s}) rotate(${currentRz}deg)`;
        if (item.sprite._shadow){
          item.sprite._shadow.style.transform = `translate(${pose.x}px,${pose.y}px) scale(${pose.s}) rotate(${currentRz}deg)`;
        }
      }
      if (progress < 1){
        requestAnimationFrame(animateFlips);
      } else {
        // Settle at target rz
        for (const item of spritesToAnimate){
          const pose = item.sprite._pose;
          pose.rz = item.targetRz;
          item.sprite.style.transform = `translate(${pose.x}px,${pose.y}px) scale(${pose.s}) rotate(${item.targetRz}deg)`;
          if (item.sprite._shadow){
            item.sprite._shadow.style.transform = `translate(${pose.x}px,${pose.y}px) scale(${pose.s}) rotate(${item.targetRz}deg)`;
          }
          item.sprite.redrawCanvases && item.sprite.redrawCanvases();
        }
      }
    }
    requestAnimationFrame(animateFlips);
  }
}

// ═══ Rebuild hand sprites for a seat from current game state ═══
// Used after widow swap (AI or MP guest) to sync sprites with hands[]
function rebuildHandSprites(seat, excludeSprite){
  var gameHand = session.game.hands[seat] || [];
  var playerNum = seatToPlayer(seat);
  var seatSprites = sprites[seat] || [];

  // Remove old hand sprites
  for(var si = 0; si < seatSprites.length; si++){
    if(seatSprites[si] && seatSprites[si].sprite){
      if(excludeSprite && seatSprites[si].sprite === excludeSprite) continue;
      if(seatSprites[si].sprite._shadow) seatSprites[si].sprite._shadow.remove();
      seatSprites[si].sprite.remove();
    }
  }

  // Determine if this seat is the local player
  var isLocal = (!MULTIPLAYER_MODE && !PASS_AND_PLAY_MODE && seat === 0) ||
                (MULTIPLAYER_MODE && seat === mpSeat) ||
                (PASS_AND_PLAY_MODE && ppIsHuman(seat));

  // Create fresh sprites from current hand
  var newSprites = [];
  for(var hi = 0; hi < gameHand.length; hi++){
    var gameTile = gameHand[hi];
    if(!gameTile) continue;
    var freshSprite = makeSprite(gameTile);
    var slotPos = getHandPosition(playerNum, hi);
    if(slotPos){
      freshSprite.setPose(slotPos);
      if(freshSprite._shadow) shadowLayer.appendChild(freshSprite._shadow);
      spriteLayer.appendChild(freshSprite);
      freshSprite.setFaceUp(isLocal);

      // Click handlers only for local player
      if(isLocal){
        (function(spr){
          spr.addEventListener('click', function(){ handlePlayer1Click(spr); });
          spr.addEventListener('touchstart', function(e){
            e.preventDefault(); e.stopPropagation();
            handlePlayer1Click(spr);
          }, { passive: false });
        })(freshSprite);
      }
      newSprites[hi] = { sprite: freshSprite, tile: gameTile, originalSlot: hi };
    }
  }
  sprites[seat] = newSprites;
}

function syncSpritesWithGameState(){
  // Hide sprites for players who are sitting out (empty hands in Nel-O)
  for(let seat = 0; seat < session.game.player_count; seat++){
    const hand = session.game.hands[seat] || [];
    const playerSprites = sprites[seat] || [];

    // If hand is empty but sprites exist, hide them
    if(hand.length === 0){
      playerSprites.forEach(data => {
        if(data && data.sprite){
          data.sprite.style.display = 'none';
          if(data.sprite._shadow){
            data.sprite._shadow.style.display = 'none';
          }
        }
      });
    } else {
      // Make sure sprites are visible if hand exists
      playerSprites.forEach(data => {
        if(data && data.sprite){
          data.sprite.style.display = '';
          if(data.sprite._shadow){
            data.sprite._shadow.style.display = '';
          }
        }
      });
    }
  }

  // Update valid states
  if (PASS_AND_PLAY_MODE) {
    // In PP mode: only highlight the active viewing seat's tiles
    // Clear highlights on all other seats to prevent face-down trump highlighting
    for (let s = 0; s < session.game.player_count; s++) {
      if (s === ppActiveViewSeat) continue;
      const ss = sprites[s] || [];
      ss.forEach(d => { if (d && d.sprite) d.sprite.setState(false, true); });
    }
    ppUpdateValidStates(ppActiveViewSeat);
  } else {
    updatePlayer1ValidStates();
  }
}

// Update which tiles are legal for P1
function updatePlayer1ValidStates(){
  console.log("updatePlayer1ValidStates called");
  console.log("session.phase:", session.phase, "PHASE_PLAYING:", PHASE_PLAYING);
  console.log("current_player:", session.game.current_player);
  console.log("trump_suit:", session.game.trump_suit, "trump_mode:", session.game.trump_mode);

  if(session.phase !== PHASE_PLAYING) {
    console.log("Early return - not in PLAYING phase");
    return;
  }
  const localSeat = getLocalSeat();
  if(session.game.current_player !== localSeat) {
    console.log("Early return - not local player's turn, current:", session.game.current_player, "local:", localSeat);
    return;
  }

  // Get legal hand indices and convert to actual tiles
  const hand = session.game.hands[localSeat] || [];
  const legalIndices = session.game.legal_indices_for_player(localSeat);
  const legalTiles = legalIndices.map(i => hand[i]);

  console.log("Hand:", hand);
  console.log("Legal indices:", legalIndices);
  console.log("Legal tiles:", legalTiles);

  const p1Sprites = sprites[localSeat] || [];

  // Check each sprite's tile against legal tiles (by value, not index)
  p1Sprites.forEach((data, idx) => {
    if(data && data.sprite && data.tile){
      // Check if this sprite's tile matches any legal tile
      const isValid = legalTiles.some(lt =>
        lt && ((lt[0] === data.tile[0] && lt[1] === data.tile[1]) ||
               (lt[0] === data.tile[1] && lt[1] === data.tile[0]))
      );
      const isTrump = session.game._is_trump_tile(data.tile);
      console.log("Sprite", idx, "tile:", data.tile, "isTrump:", isTrump, "isValid:", isValid);
      data.sprite.setState(isTrump, isValid);
    }
  });
}

// V10_121: Clear valid/invalid highlighting on all local player's tiles
function clearPlayer1ValidStates(){
  const localSeat = getLocalSeat();
  const p1Sprites = sprites[localSeat] || [];
  p1Sprites.forEach((data) => {
    if(data && data.sprite && data.tile){
      const isTrump = (session && session.game.trump_suit !== null && session.game.trump_suit !== undefined)
        ? session.game._is_trump_tile(data.tile) : false;
      data.sprite.setState(isTrump, true); // highlighted if trump, but all valid (no fading)
    }
  });
}

// ═══════════════════════════════════════════════════════════════════
//  HINT SYSTEM — highlight AI-recommended domino with white shadow
// ═══════════════════════════════════════════════════════════════════
function showHint(){
  clearHint(); // clear any previous hint
  if(!HINT_MODE) return;
  if(session.phase !== PHASE_PLAYING) return;

  const hintSeat = getLocalSeat();
  if(session.game.current_player !== hintSeat) return;

  try {
    const aiRec = choose_tile_ai(session.game, hintSeat, session.contract, true, session.current_bid);
    if(!aiRec || !aiRec.tile) return;

    const hintTile = aiRec.tile;
    const hintSprites = sprites[hintSeat] || [];

    for(const data of hintSprites){
      if(!data || !data.sprite || !data.tile) continue;
      if((data.tile[0] === hintTile[0] && data.tile[1] === hintTile[1]) ||
         (data.tile[0] === hintTile[1] && data.tile[1] === hintTile[0])){
        // V10_106: Fix #11 — apply border outline + shadow glow
        data.sprite.classList.add('hintBorder');
        if(data.sprite._shadow){
          data.sprite._shadow.classList.add('hintGlow');
        }
        break;
      }
    }
  } catch(e) {
    console.log("Hint error:", e);
  }
}

function clearHint(){
  // Clear hints on ALL seats (since active seat can change)
  for(let s = 0; s < session.game.player_count; s++){
    const ss = sprites[s] || [];
    for(const data of ss){
      if(data && data.sprite){
        // V10_106: Fix #11 — clear both border and glow
        data.sprite.classList.remove('hintBorder');
        if(data.sprite._shadow){
          data.sprite._shadow.classList.remove('hintGlow');
        }
      }
    }
  }
}

// Process AI bid for a seat
function processAIBid(seat) {
  const hand = session.game.hands[seat] || [];
  const evaluation = evaluateHandForBid(hand);
  if (evaluation.action !== "bid") {
    biddingState.passCount++;
    biddingState.bids.push({ seat, playerNumber: seatToPlayer(seat), bid: "pass" });
    return { action: "pass" };
  }

  const evalMarks = evaluation.marks || 1;
  const maxBid = GAME_MODE === 'MOON' ? 7 : (GAME_MODE === 'T42' ? 42 : 51);
  let bidMarks = evalMarks;
  let bidAmount = evaluation.bid;

  // Moon: AI considers Shoot the Moon for very strong hands (bid 7 with high marks)
  if (GAME_MODE === 'MOON' && evaluation.bid >= 7 && evalMarks >= 2) {
    biddingState.moonShoot = true;
  }

  // If already in multiplier mode, AI with a strong hand should bid the next multiplier up
  if (biddingState.inMultiplierMode && evalMarks >= 2) {
    // AI bids one level above the current highest multiplier
    bidMarks = (biddingState.highMultiplier || 1) + 1;
    bidAmount = maxBid;
  }

  // Check if this bid actually outbids the current leader
  const canOutbid = (
    bidAmount > biddingState.highBid ||
    (bidAmount === biddingState.highBid && bidMarks > (biddingState.highMarks || 1))
  );

  if (canOutbid) {
    biddingState.highBid = bidAmount;
    biddingState.highBidder = seat;
    biddingState.highMarks = bidMarks;
    if (bidMarks > 1) {
      biddingState.inMultiplierMode = true;
      biddingState.highMultiplier = bidMarks;
    }
    biddingState.bids.push({ seat, playerNumber: seatToPlayer(seat), bid: bidAmount });
    return { action: "bid", bid: bidAmount, marks: bidMarks };
  } else {
    biddingState.passCount++;
    biddingState.bids.push({ seat, playerNumber: seatToPlayer(seat), bid: "pass" });
    return { action: "pass" };
  }
}

function advanceBidding() {
  // FIX1: Prevent double-advance during bidding completion
  if (_biddingCompleting) {
    console.log('[FIX1] Bidding already completing, preventing double-advance');
    return { done: true };
  }
  
  const nextIndex = biddingState.bidderOrder.indexOf(biddingState.currentBidder) + 1;

  if (nextIndex >= biddingState.bidderOrder.length) {
    _biddingCompleting = true; // FIX1: Set flag before finalize
    console.log('[FIX1] Bidding completing, flag set');
    const result = finalizeBidding();
    // Reset flag after a delay to allow all messages to propagate
    setTimeout(() => { 
      _biddingCompleting = false; 
      console.log('[FIX1] Bidding completion flag reset');
    }, 2000);
    return result;
  }

  biddingState.currentBidder = biddingState.bidderOrder[nextIndex];
  return { done: false, currentBidder: biddingState.currentBidder };
}

function finalizeBidding() {
  _clearBiddingTimers(); // V10_115: Cancel any pending bidding timers
  if (biddingState.highBidder === null) {
    session.status = "Everyone passed. Redealing...";
    setStatus(session.status);
    setTimeout(() => {
      // V10_121d: In MP mode, host must broadcast new deal to guests
      if (MULTIPLAYER_MODE && mpIsHost) {
        mpSendMove({ action: 'next_hand' });
        mpHostDeal();
      } else {
        startNewHand();
      }
    }, 1500);
    return { done: true, redeal: true };
  }

  session.current_bid = biddingState.highBid;
  session.bid_marks = biddingState.highMarks;
  session.bid_winner_seat = biddingState.highBidder;
  if(GAME_MODE === 'MOON' && biddingState.moonShoot) session.moon_shoot = true;
  else session.moon_shoot = false;

  // Initialize off-tracker now that we know the bidder
  initOffTracker();

  // In multiplayer, route trump selection based on who won
  if (MULTIPLAYER_MODE) {
    const bidWinnerSeat = biddingState.highBidder;
    session.current_bid = biddingState.highBid;
    session.bid_marks = biddingState.highMarks;
    session.bid_winner_seat = bidWinnerSeat;

    setPlaceholderText(seatToVisual(bidWinnerSeat), biddingState.highBid, 'winner');

    // Moon: widow swap before trump selection
    if (GAME_MODE === 'MOON' && session.moon_widow) {
      session.phase = PHASE_MOON_WIDOW;
      if (bidWinnerSeat === mpSeat) {
        // We won - show widow swap UI
        setStatus('You won the bid! Swap with widow or keep hand.');
        mpHideWaiting();
        showWidowSwap();
      } else if (mpIsHost && mpIsAI(bidWinnerSeat)) {
        // AI won on host - do widow swap then trump
        setStatus(getPlayerDisplayName(bidWinnerSeat) + ' (AI) swapping widow...');
        const oldWidow = session.moon_widow ? [session.moon_widow[0], session.moon_widow[1]] : null;
        aiWidowSwap(bidWinnerSeat);
        // After AI swap, broadcast result
        const newWidow = session.moon_widow ? [session.moon_widow[0], session.moon_widow[1]] : null;
        mpSendMove({
          action: 'widow_swap_confirmed',
          seat: bidWinnerSeat,
          newWidow: newWidow,
          hand: session.game.hands[bidWinnerSeat].map(t => [t[0], t[1]]),
          isAI: true
        });
        // afterWidowSwap() handles AI trump pick, but in MP we need to broadcast trump too
        // afterWidowSwap triggers trump selection which will go through the normal MP trump flow
      } else {
        // Remote human won - wait for their widow swap result
        setStatus(getPlayerDisplayName(bidWinnerSeat) + ' won the bid. Widow swap...');
      }
      biddingState = null;
      return { done: true }; // V10_121f: Must return object so callers can read advance.done
    }

    if (bidWinnerSeat === mpSeat) {
      // V10_111: If Nello was declared during bidding AND nelloDeclareMode is ON, skip trump selection
      if(_nelloWasDeclared && GAME_MODE !== 'MOON')  /* V12.10.19: always skip trump for Nel-O */{
        mpHideWaiting();
        const nelloMarks = _nelloDeclaredMarks;
        session.bid_marks = nelloMarks;
        if(GAME_MODE === 'T42'){
          // T42: direct Nello setup
          session.set_trump('NELLO');
          syncSpritesWithGameState();
          updateTrumpDisplay();
          const _nelloActive = session.game.active_players ? session.game.active_players.slice() : [0,1,2,3];
          mpSendMove({ action: 'trump_confirmed', trump: 'NELLO', seat: mpSeat, marks: nelloMarks, nello: true, activePlayers: _nelloActive, firstPlayer: session.game.current_player });
          // Check nello doubles mode
          if(nelloDoublesMode === 'doubles_only'){
            nelloDoublesSuitActive = true;
            session.game.nello_doubles_suit = true;
          } else if(nelloDoublesMode === 'player_chooses'){
            document.getElementById('nelloDoublesBackdrop').style.display = 'flex';
            biddingState = null;
            return { done: true }; // V10_121f: Must return object for callers
          } else {
            nelloDoublesSuitActive = false;
            session.game.nello_doubles_suit = false;
          }
          mpCheckWhoseTurn();
        } else {
          // TN51: still need opponent selection
          showNelloOpponentSelection(nelloMarks);
        }
        biddingState = null;
        return { done: true }; // V10_121f: Must return object for callers
      }
      // V10_111: Compute Nello eligibility at trump selection for MP
      if(nelloDeclareMode){
        _nelloAllowedAtTrump = false;
      } else if(nelloRestrictFirst && biddingState){
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
      // Normal trump selection UI
      session.phase = PHASE_NEED_TRUMP;
      setStatus('You won the bid! Select trump.');
      mpHideWaiting();
      showTrumpOverlay(true);
      // V10_121g: Ensure trump selection is active for proper domino clicks
      trumpSelectionActive = true;
      enableTrumpDominoClicks();
    } else if (mpIsHost && mpIsAI(bidWinnerSeat)) {
      // AI won the bid on host - pick trump and broadcast
      const aiHand = session.game.hands[bidWinnerSeat];
      const aiTrump = aiChooseTrump(aiHand, biddingState.highBid);
      setStatus(getPlayerDisplayName(bidWinnerSeat) + ' (AI) selects trump: ' + (aiTrump || 'NT'));
      // Apply trump
      session.set_trump(aiTrump);
      _dfmActiveThisHand = (aiTrump === 'DOUBLES' && doublesFollowMe !== 'off');
      syncSpritesWithGameState();
      updateTrumpDisplay();
      // V10_121: Host broadcasts trump_confirmed to guests
      mpSendMove({ action: 'trump_confirmed', trump: aiTrump === null ? 'NT' : aiTrump, seat: bidWinnerSeat, marks: session.bid_marks, isAI: true,
        activePlayers: session.game.active_players ? session.game.active_players.slice() : null, firstPlayer: session.game.current_player, dfmActive: _dfmActiveThisHand });
      // Start play
      setTimeout(() => mpCheckWhoseTurn(), 500);
    } else {
      // Remote human player won - wait for their trump selection
      session.phase = PHASE_NEED_TRUMP; // V10_121c: Set phase so state_sync sends correct phase
      setStatus(getPlayerDisplayName(bidWinnerSeat) + ' won the bid. Selecting trump...');
    }
    biddingState = null;
    return { done: true }; // V10_121f: Must return object so callers can read advance.done
  }

  const winnerSeat = biddingState.highBidder;
  const winnerVisual = seatToVisual(winnerSeat);  // for placeholder positioning
  const winnerLabel = seatToPlayer(winnerSeat);    // for status bar labels
  const isHumanControlled = ppIsHuman(winnerSeat);

  // Highlight the winning bid
  const displayBid = biddingState.highMarks > 1 ? `${biddingState.highMarks}x` : biddingState.highBid;
  setPlaceholderText(winnerVisual, displayBid, 'winner');

  if (!isHumanControlled) {
    // AI won the bid - they pick trump
    const hand = session.game.hands[winnerSeat] || [];
    const trump = aiChooseTrump(hand, biddingState.highBid);

    session.status = `P${winnerLabel} wins bid (${biddingState.highBid}). Choosing trump...`;
    renderAll();  // Update UI to show status

    setTimeout(() => {
      if(GAME_MODE === 'MOON' && session.moon_widow){
        // Moon: widow swap first, then trump (afterWidowSwap handles trump)
        session.phase = PHASE_MOON_WIDOW;
        session.status = `P${winnerLabel} bid ${biddingState.highBid}. Widow swap...`;
        setStatus(session.status);
        aiWidowSwap(winnerSeat);
        // afterWidowSwap() will handle AI trump pick
        return;
      }

      const trump = aiChooseTrump(session.game.hands[winnerSeat] || [], biddingState.highBid);
      const trumpDisplay = trump === "NT" ? "No Trumps" : trump === "NELLO" ? "Nel-O" : trump + "s";
      session.status = `P${winnerLabel} bid ${biddingState.highBid}. Trump: ${trumpDisplay}`;

      // Handle Nello with AI opponent selection
      if(trump === "NELLO"){
        setupAINello(winnerSeat, 1);
      } else {
        // Set trump (this changes phase to PLAYING)
        session.set_trump(trump);
        // V11.4j: Set DFM flag for AI
        _dfmActiveThisHand = (trump === 'DOUBLES' && doublesFollowMe !== 'off');

        // Log hand start with detailed v2.0 format for AI trump selection
        const trumpMode = trump === 'DOUBLES' ? 'DOUBLES' : (trump === "NT" || trump === null ? 'NONE' : 'PIP');
        const trumpSuit = trump === 'DOUBLES' || trump === "NT" ? null : trump;
        const handsCopy = session.game.hands.map(h => h ? [...h] : []);

        logHandStart(
          trumpMode,
          trumpSuit,
          'NORMAL',
          biddingState.highBid,
          winnerSeat,
          handsCopy,
          session.dealer,
          winnerSeat,  // Bidder leads
          { team1: session.team_marks[0] || 0, team2: session.team_marks[1] || 0 }
        );
      }

      // Keep bid placeholders visible during play (user preference)

      // Update ALL UI based on new phase (hides overlays, enables clicks, etc.)
      renderAll();

      // Start AI play if it's AI's turn
      maybeAIKick();
    }, 1000);

    return { done: true, winner: winnerSeat, bid: biddingState.highBid };
  }

  if(GAME_MODE === 'MOON' && session.moon_widow){
    // Moon: widow swap first, then trump
    session.phase = PHASE_MOON_WIDOW;
    if (PASS_AND_PLAY_MODE) {
      const bidderLabel = `P${seatToPlayer(winnerSeat)}`;
      session.status = `${bidderLabel} won the bid (${biddingState.highBid}). Widow swap...`;
      setStatus(session.status);
      ppRotateBoard(winnerSeat);
    } else {
      session.status = `You won the bid (${biddingState.highBid}). Swap with widow or keep hand.`;
      setStatus(session.status);
    }
    showWidowSwap();
    return { done: true, winner: winnerSeat, bid: biddingState.highBid };
  }

  // V10_111: Declared Nello skip — when nelloDeclareMode is ON and Nello was declared during bidding,
  // skip trump selection entirely and go straight to Nello play
  if(_nelloWasDeclared && GAME_MODE !== 'MOON')  /* V12.10.19: always skip trump for Nel-O */{
    session.current_bid = biddingState.highBid;
    session.bid_marks = _nelloDeclaredMarks;
    session.bid_winner_seat = winnerSeat;
    initOffTracker();

    // Update placeholder to show Nello declaration
    const nelloDisplay = _nelloDeclaredMarks > 1 ? `Nel ${_nelloDeclaredMarks}x` : 'Nel 1x';
    setPlaceholderText(seatToVisual(winnerSeat), nelloDisplay, 'winner');

    if(GAME_MODE === 'T42'){
      // T42: partner auto sits out, go straight to play
      session.set_trump('NELLO');
      syncSpritesWithGameState();
      updateTrumpDisplay();

      // Check nello doubles mode
      if(nelloDoublesMode === 'doubles_only'){
        nelloDoublesSuitActive = true;
        session.game.nello_doubles_suit = true;
      } else if(nelloDoublesMode === 'player_chooses' && winnerSeat === getLocalSeat()){
        document.getElementById('nelloDoublesBackdrop').style.display = 'flex';
        return { done: true, winner: winnerSeat, bid: biddingState.highBid };
      } else if(nelloDoublesMode === 'player_chooses'){
        const bidderHand = session.game.hands[winnerSeat] || [];
        nelloDoublesSuitActive = aiChooseNelloDoublesMode(bidderHand);
        session.game.nello_doubles_suit = nelloDoublesSuitActive;
      } else {
        nelloDoublesSuitActive = false;
        session.game.nello_doubles_suit = false;
      }

      renderAll();
      if(session.game.current_player === getLocalSeat()){
        waitingForPlayer1 = true;
        enablePlayer1Clicks();
        updatePlayer1ValidStates();
        showHint();
      } else {
        waitingForPlayer1 = false;
        disablePlayer1Clicks();
        runPlayStep();
      }
    } else {
      // TN51: still need opponent selection (not a trump pick — it's Nello-specific)
      showNelloOpponentSelection(_nelloDeclaredMarks);
    }
    return { done: true, winner: winnerSeat, bid: biddingState.highBid };
  }

  // V10_111: Compute whether Nello should be available at trump selection
  // If nelloDeclareMode is ON, Nello can only be played by declaring during bidding — hide at trump
  // If nelloRestrictFirst is ON, check if the winning bid qualifies
  if(nelloDeclareMode){
    _nelloAllowedAtTrump = false;
  } else if(nelloRestrictFirst && biddingState){
    // Nello at trump selection would be at the winning bid's marks level
    // Check: is that marks level valid given the restriction rule (must be +1 from prior highest)?
    const winMarks = biddingState.highMarks || 1;
    if(!biddingState.inMultiplierMode && biddingState.highBid < (GAME_MODE === 'T42' ? 42 : 51)){
      // Nobody bid max — only 1x Nello allowed
      _nelloAllowedAtTrump = (winMarks <= 1);
    } else if(!biddingState.inMultiplierMode){
      // Bid is at max but not multiplier mode — 1x or 2x allowed
      _nelloAllowedAtTrump = (winMarks <= 2);
    } else {
      // In multiplier mode — Nello must be at most highMultiplier + 1
      _nelloAllowedAtTrump = (winMarks <= (biddingState.highMultiplier || 1) + 1);
    }
  } else {
    _nelloAllowedAtTrump = true;
  }

  session.phase = PHASE_NEED_TRUMP;

  // In PP mode, rotate board to the bid winner before showing trump overlay
  if (PASS_AND_PLAY_MODE) {
    const bidderLabel = `P${seatToPlayer(winnerSeat)}`;
    session.status = `${bidderLabel} won the bid (${biddingState.highBid}). Pick trump.`;
    setStatus(session.status);
    // Rotate board to bid winner (no privacy screen — same player just bid)
    ppRotateBoard(winnerSeat);
    showTrumpOverlay(true);
    // V10_121g: Ensure trump selection is active for proper domino clicks
    trumpSelectionActive = true;
    enableTrumpDominoClicks();
    return { done: true, winner: winnerSeat, bid: biddingState.highBid };
  }

  session.status = `You won the bid (${biddingState.highBid}). Pick trump.`;
  setStatus(session.status);
  showTrumpOverlay(true);
  // V10_121g: Ensure trump selection is active for proper domino clicks
  trumpSelectionActive = true;
  enableTrumpDominoClicks();
  return { done: true, winner: winnerSeat, bid: biddingState.highBid };
}

function startBiddingRound() {
  if (!biddingState) initBiddingRound();
  runBiddingStep();
}

function runBiddingStep() {
  const currentBidder = biddingState.currentBidder;
  const isHumanControlled = ppIsHuman(currentBidder);

  if (isHumanControlled) {
    session.phase = PHASE_NEED_BID;
    // In PP mode, transition to this player's perspective
    if (PASS_AND_PLAY_MODE && currentBidder !== ppActiveViewSeat) {
      ppTransitionToSeat(currentBidder, 'Bidding Phase');
      if (ppPrivacyMode) {
        // Privacy ON: handoff button will show bid overlay via its click handler
        return;
      }
      // Privacy OFF: transition completed synchronously, continue to show bid overlay
    }
    const playerLabel = PASS_AND_PLAY_MODE ? `P${seatToPlayer(currentBidder)}'s` : "Your";
    const currentBidDisplay = (biddingState.highMarks > 1) ? `${biddingState.highMarks}x` : biddingState.highBid;
    session.status = biddingState.highBid > 0
      ? `Current bid: ${currentBidDisplay} by P${seatToPlayer(biddingState.highBidder)}. ${playerLabel} bid?`
      : `${playerLabel} turn to bid.`;
    setStatus(session.status);
    showBidOverlay(true);
    return;
  }

  session.status = `P${seatToPlayer(currentBidder)} is thinking...`;
  setStatus(session.status);

  setTimeout(() => {
    const result = processAIBid(currentBidder);
    const playerVisual = seatToVisual(currentBidder);  // for placeholder position
    const playerLabel = seatToPlayer(currentBidder);    // for status label

    if (result.action === "bid") {
      const displayBid = (result.marks && result.marks > 1) ? `${result.marks}x` : result.bid;
      session.status = `P${playerLabel} bids ${displayBid}!`;
      setPlaceholderText(playerVisual, displayBid, 'bid');
    } else {
      session.status = `P${playerLabel} passes.`;
      setPlaceholderText(playerVisual, 'Pass', 'pass');
    }
    setStatus(session.status);

    setTimeout(() => {
      const advance = advanceBidding() || { done: true }; // V10_121f: defensive null-check
      if (!advance.done) {
        runBiddingStep();
      }
    }, 600);
  }, 400);
}

function humanBid(bidAmount, marks = 1) {
  if (!biddingState) return false;
  // V10_109: Nello declared flag — don't reset here, reset after placeholder display
  // The Nello button handler now calls humanBid directly with the correct bid

  const currentBidder = biddingState.currentBidder;
  if (!ppIsHuman(currentBidder)) return false;

  let actualBid = bidAmount;
  let isMoonShoot = false;
  if(typeof bidAmount === 'string'){
    if(bidAmount === 'Pass'){
      return humanPass();
    }
    if(bidAmount === 'Moon'){
      // Shoot the Moon: bid 7, scored at ±21
      actualBid = 7;
      isMoonShoot = true;
    } else if(bidAmount.endsWith('x')){
      const mult = parseInt(bidAmount);
      // For 2x, 3x etc: bid stays at max points, but marks are multiplied
      actualBid = GAME_MODE === 'T42' ? 42 : 51;  // Max points for game mode
      marks = mult;    // But the marks at stake are multiplied
      biddingState.inMultiplierMode = true;
      biddingState.highMultiplier = mult;
    } else {
      actualBid = parseInt(bidAmount);
    }
  }
  if(isMoonShoot) biddingState.moonShoot = true;

  if (actualBid <= biddingState.highBid && !biddingState.inMultiplierMode && !isMoonShoot) {
    session.status = `Must bid higher than ${biddingState.highBid}!`;
    setStatus(session.status);
    return false;
  }

  // V10_121: Guest sends intent to host instead of modifying biddingState
  if (MULTIPLAYER_MODE && !mpIsHost) {
    const bidPayload = { action: 'bid_intent', seat: currentBidder, bid: actualBid, marks: marks, multiplier: biddingState.inMultiplierMode ? biddingState.highMultiplier : 0 };
    if (isMoonShoot) bidPayload.moonShoot = true;
    if (window._nelloDeclared) {
      _nelloWasDeclared = true;
      _nelloDeclaredMarks = marks;
    }
    window._nelloDeclared = false;
    mpSendMove(bidPayload);
    showBidOverlay(false);
    setStatus('Waiting for confirmation...');
    _startIntentTimeout('bid'); // V11.3: Timeout if host is unreachable
    // Guest doesn't update biddingState or advance — wait for bid_confirmed from host
    return true;
  }

  // V10_121: Host or single-player — update biddingState locally
  biddingState.highBid = actualBid;
  biddingState.highBidder = currentBidder;
  biddingState.highMarks = marks;
  biddingState.bids.push({ seat: currentBidder, playerNumber: seatToPlayer(currentBidder), bid: actualBid });

  // V10_121: Host or single-player path — bid_confirmed broadcast is below after advanceBidding

  // Display bid in placeholder with animation
  const playerNum = seatToVisual(currentBidder);
  let displayBid = marks > 1 ? `${marks}x` : `${actualBid}`;
  if(window._nelloDeclared){
    displayBid = 'Nel ' + (marks > 1 ? marks + 'x' : '1x');
    _nelloWasDeclared = true;
    _nelloDeclaredMarks = marks;
  }
  window._nelloDeclared = false;
  setPlaceholderText(playerNum, displayBid, 'bid');

  showBidOverlay(false);

  const advance = advanceBidding() || { done: true }; // V10_121f: defensive null-check

  // V10_121: Host broadcasts confirmed bid to all guests
  if (MULTIPLAYER_MODE && mpIsHost) {
    const confirmed = {
      action: 'bid_confirmed',
      seat: currentBidder,
      bid: actualBid,
      marks: marks,
      multiplier: biddingState ? (biddingState.inMultiplierMode ? biddingState.highMultiplier : 0) : 0,
      moonShoot: isMoonShoot,
      displayBid: displayBid,
      biddingDone: advance.done || false,
      nextBidder: biddingState ? biddingState.currentBidder : null,
      bidWinner: advance.done ? (biddingState ? biddingState.highBidder : session.bid_winner_seat) : null,
      winningBid: advance.done ? (biddingState ? biddingState.highBid : session.current_bid) : null,
      winningMarks: advance.done ? (biddingState ? biddingState.highMarks : session.bid_marks) : null,
      redeal: advance.redeal || false
    };
    mpSendMove(confirmed);
    mpSaveHostState();
  }

  if (!advance.done) {
    if (MULTIPLAYER_MODE) {
      mpRunBiddingStep();
    } else {
      runBiddingStep();
    }
  }
  return true;
}

function humanPass() {
  if (!biddingState) return false;

  const currentBidder = biddingState.currentBidder;
  if (!ppIsHuman(currentBidder)) return false;

  // V10_121: Guest sends intent to host
  if (MULTIPLAYER_MODE && !mpIsHost) {
    mpSendMove({ action: 'pass_intent', seat: currentBidder });
    showBidOverlay(false);
    setStatus('Waiting for confirmation...');
    _startIntentTimeout('pass'); // V11.3: Timeout if host is unreachable
    return true;
  }

  // V10_121: Host or single-player path — process locally
  biddingState.passCount++;
  biddingState.bids.push({ seat: currentBidder, playerNumber: seatToPlayer(currentBidder), bid: "pass" });

  const playerNum = seatToVisual(currentBidder);
  setPlaceholderText(playerNum, 'Pass', 'pass');

  showBidOverlay(false);

  const advance = advanceBidding() || { done: true }; // V10_121f: defensive null-check

  // V10_121: Host broadcasts confirmed pass to all guests
  if (MULTIPLAYER_MODE && mpIsHost) {
    const confirmed = {
      action: 'pass_confirmed',
      seat: currentBidder,
      biddingDone: advance.done || false,
      nextBidder: biddingState ? biddingState.currentBidder : null,
      bidWinner: advance.done ? (biddingState ? biddingState.highBidder : session.bid_winner_seat) : null,
      winningBid: advance.done ? (biddingState ? biddingState.highBid : session.current_bid) : null,
      winningMarks: advance.done ? (biddingState ? biddingState.highMarks : session.bid_marks) : null,
      redeal: advance.redeal || false
    };
    mpSendMove(confirmed);
    mpSaveHostState();
  }

  if (!advance.done) {
    if (MULTIPLAYER_MODE) {
      mpRunBiddingStep();
    } else {
      runBiddingStep();
    }
  }
  return true;
}

/******************************************************************************
 * END OF HAND POPUP
 ******************************************************************************/
// Flip all remaining opponent dominoes face-up at end of round
function flipRemainingDominoes(){
  for(let seat = 1; seat < session.game.player_count; seat++){  // Skip seat 0 (player)
    const seatSprites = sprites[seat] || [];
    for(let i = 0; i < seatSprites.length; i++){
      const data = seatSprites[i];
      if(data && data.sprite && data.tile){
        // Flip face-up
        data.sprite.setFaceUp(true);
        // Highlight if it's a trump tile
        if(session.game._is_trump_tile(data.tile)){
          data.sprite.setState(true, true);  // highlighted=true, valid=true
        }
      }
    }
  }
}

function showHandEndPopup(){
  // Auto-close boneyard 2 at end of hand
  if(boneyard2Visible){
    boneyard2Visible = false;
    const by2c = document.getElementById('boneyard2Container');
    const thBg = document.getElementById('trickHistoryBg');
    const toggleBtn = document.getElementById('boneyard2Toggle');
    if(by2c) by2c.style.display = 'none';
    if(thBg) thBg.style.display = '';
    showTrickHistorySprites();
    if(toggleBtn) toggleBtn.classList.remove('active');
  }
  // Disable BONES button (no tiles left to show)
  const bonesBtn = document.getElementById('boneyard2Toggle');
  if(bonesBtn){
    bonesBtn.style.pointerEvents = 'none';
    bonesBtn.style.opacity = '0.15';
  }

  // Flip remaining opponent dominoes face-up so player can see what they had
  flipRemainingDominoes();

  const status = session.status;
  const btnNextHand = document.getElementById('btnNextHand');

  // Check for game win - change button text accordingly
  if(status.includes('wins the game')){
    // Determine if LOCAL player's team won
    const localTeam = MULTIPLAYER_MODE ? ((mpSeat % 2 === 0) ? 1 : 2) : 1;
    const t1m = session.team_marks[0];
    const t2m = session.team_marks[1];
    const winningTeam = t1m > t2m ? 1 : 2;
    const localWon = (localTeam === winningTeam);
    SFX.playResultSong(localWon ? 'win' : 'lose');
    // Show final scores summary (has its own New Game button inside)
    showGameEndSummary();
  } else {
    // Show round-end summary popup (has its own Next Round button inside)
    showRoundEndSummary();
  }
}

function hideHandEndPopup(){
  document.getElementById('btnNextHand').style.display = 'none';
}

// Handle Next Hand button
document.getElementById('btnNextHand').addEventListener('click', () => {
  hideHandEndPopup();
  SFX.resumeBgmAfterResult();
  if (MULTIPLAYER_MODE && mpIsHost) { mpHostDeal(); return; }
  if (MULTIPLAYER_MODE && !mpIsHost) { setStatus('Waiting for host to deal...'); return; }
  startNewHand();
});

/******************************************************************************
 * RENDER ALL - Master UI update function (mirrors v18's renderAll)
 ******************************************************************************/
function renderAll(){
  if(typeof updateWidowDisplay === 'function') updateWidowDisplay();
  // Update player name display
  var _pnd = document.getElementById('playerNameDisplay');
  if(_pnd){
    if(playerName && !playerNoName){
      _pnd.textContent = playerName;
      _pnd.style.display = 'block';
    } else {
      _pnd.style.display = 'none';
    }
  }
  // Keep bidding preview active during pre-play phases
  if(session && session.phase !== PHASE_PLAYING && !biddingPreviewActive){
    enableBiddingPreview();
  }
  // Force-disable preview when play starts
  if(session && session.phase === PHASE_PLAYING && biddingPreviewActive){
    disableBiddingPreview(true);
  }
  const phase = session.phase;

  // Update status bar
  setStatus(session.status);

  // Update score display
  team1Score = session.game.team_points[0];
  team2Score = session.game.team_points[1];
  team1Marks = session.team_marks[0];
  team2Marks = session.team_marks[1];
  updateScoreDisplay();

  // Sync sprites with game state
  syncSpritesWithGameState();

  // Show/hide overlays based on phase
  const showBidUI = phase === PHASE_NEED_BID &&
    biddingState &&
    ppIsHuman(biddingState.currentBidder);
  document.getElementById('bidBackdrop').style.display = showBidUI ? 'flex' : 'none';
  document.getElementById('trumpBackdrop').style.display = (phase === PHASE_NEED_TRUMP) ? 'flex' : 'none';

  // Show trump display indicator during play
  updateTrumpDisplay();

  // Update player hand clickability
  if(PASS_AND_PLAY_MODE && phase === PHASE_PLAYING) {
    const cp = session.game.current_player;
    if(ppIsHuman(cp) && cp === ppActiveViewSeat) {
      waitingForPlayer1 = true;
      ppEnableClicksForSeat(cp);
      ppUpdateValidStates(cp);
    } else {
      waitingForPlayer1 = false;
    }
  } else if(phase === PHASE_PLAYING && session.game.current_player === 0){
    waitingForPlayer1 = true;
    enablePlayer1Clicks();
    updatePlayer1ValidStates();
    showHint();
  } else {
    waitingForPlayer1 = false;
    disablePlayer1Clicks();
  }
}

/******************************************************************************
 * MAYBE AI KICK - Start AI play if it's AI's turn (mirrors v18's maybeAIKick)
 ******************************************************************************/


// Pass & Play AI loop - plays AI seats until a human seat is reached
async function ppAIPlayLoop() {
  if (isAnimating) {
    console.log('ppAIPlayLoop: blocked by isAnimating, retrying in 500ms');
    setTimeout(() => ppAIPlayLoop(), 500);
    return;
  }
  isAnimating = true;

  try {
    let loopIter = 0;
    while (session.phase === PHASE_PLAYING) {
      loopIter++;
      const seat = session.game.current_player;

      // If this seat is human, stop and transition to them
      if (ppIsHuman(seat)) {
        break;
      }

      // Safety: prevent infinite loops
      if (loopIter > 20) {
        console.log('ppAIPlayLoop: exceeded 20 iterations, breaking');
        break;
      }

      // AI plays
      const hand = session.game.hands[seat] || [];
      const aiRec = choose_tile_ai(session.game, seat, session.contract, true, session.current_bid);
      const gameHandIdx = aiRec.index;

      if (gameHandIdx < 0) {
        console.log('ppAIPlayLoop: AI returned no valid move for seat', seat);
        break;
      }

      const tileToPlay = aiRec.tile || hand[gameHandIdx];
      setStatus('P' + (seat + 1) + ' plays...');

      const variedDelay = ANIM.OPPONENT_PLAY_DELAY * (1 + (Math.random() * 2 - 1) * 0.15);
      await new Promise(r => setTimeout(r, variedDelay));

      // Find sprite for animation
      const seatSprites = sprites[seat] || [];
      let spriteIdx = -1;
      for (let i = 0; i < seatSprites.length; i++) {
        const sd = seatSprites[i];
        if (sd && sd.tile) {
          if ((sd.tile[0] === tileToPlay[0] && sd.tile[1] === tileToPlay[1]) ||
              (sd.tile[0] === tileToPlay[1] && sd.tile[1] === tileToPlay[0])) {
            spriteIdx = i;
            break;
          }
        }
      }

      // Capture pre-play context
      const isLead = session.game.current_trick.length === 0;
      const legalIndices = session.game.legal_indices_for_player(seat);
      const legalTiles = legalIndices.map(i => hand[i]).filter(t => t);
      let currentWinner = null;
      const trick = session.game.current_trick || [];
      if (trick.length > 0) {
        try {
          const ws = session.game._determine_trick_winner();
          currentWinner = { seat: ws, team: ws % 2 === 0 ? 1 : 2 };
        } catch(e) {}
      }

      // Play tile in game engine (MUST succeed for game to continue)
      try {
        session.play(seat, gameHandIdx);
      } catch(e) {
        console.log('ppAIPlayLoop: session.play error for seat', seat, ':', e.message);
        break;
      }

      // Check for Call for Double after AI lead in PP mode
      if(shouldShowCallForDouble()){
        const bidder = session.bid_winner_seat !== undefined ? session.bid_winner_seat : 0;
        if(aiShouldCallForDouble(bidder)){
          callForDoubleActive = true;
          session.game.force_double_trump = true;
          setStatus(getPlayerDisplayName(bidder) + ' calls for the double!');
          applyForcedDoubleGlow();
        }
      }

      // Animate the domino (or skip animation if sprite not found)
      if (spriteIdx >= 0) {
        try {
          await playDomino(seat, spriteIdx, isLead, aiRec, { legalTiles, currentWinner });
        } catch(e) {
          console.log('ppAIPlayLoop: playDomino error:', e.message);
          // Animation failed but game state already advanced — continue
        }
      } else {
        console.log('ppAIPlayLoop: sprite not found for seat', seat, 'tile', tileToPlay, '— skipping animation');
        // Still need to recenter hand since game state changed
        try { recenterHand(seat); } catch(e) {}
      }

      // Check trick complete
      if (session.game._sanitized_trick().length >= session.game.active_players.length) {
        await new Promise(r => setTimeout(r, 800));
        try {
          await collectToHistory();
        } catch(e) {
          console.log('ppAIPlayLoop: collectToHistory error:', e.message);
        }
        session.game.current_trick = [];

        if (session.maybe_finish_hand()) {
          setStatus(session.status);
          team1Score = session.game.team_points[0];
          team2Score = session.game.team_points[1];
          team1Marks = session.team_marks[0];
          team2Marks = session.team_marks[1];
          updateScoreDisplay();
          logEvent('HAND_END', { status: session.status });
          autoSave();
          setTimeout(() => showHandEndPopup(), 800);
          return;
        }
      }
    }

    // After loop: ensure game can continue
    const cp = session.game.current_player;
    if (session.phase === PHASE_PLAYING) {
      if (ppIsHuman(cp)) {
        ppTransitionToSeat(cp, 'Play Phase');
      } else {
        // Current player is still AI — shouldn't happen normally, but recover
        console.log('ppAIPlayLoop: loop ended on AI seat', cp, '— re-kicking in 500ms');
        isAnimating = false;
        setTimeout(() => ppAIPlayLoop(), 500);
        return;
      }
    }
  } catch(outerError) {
    console.log('ppAIPlayLoop: unexpected error:', outerError.message);
    // Emergency recovery: try to re-kick
    if (session.phase === PHASE_PLAYING) {
      isAnimating = false;
      setTimeout(() => maybeAIKick(), 500);
      return;
    }
  } finally {
    isAnimating = false;
  }
}

function maybeAIKick(){
  if(session.phase !== PHASE_PLAYING) return;
  const seat = session.game.current_player;

  if(PASS_AND_PLAY_MODE) {
    if(ppIsHuman(seat)) {
      // It's a human player's turn - transition to them
      ppTransitionToSeat(seat, 'Play Phase');
      return;
    }
    // AI seat in pass & play - let AI play
    // Use longer delay to ensure any pending animations complete
    setTimeout(() => ppAIPlayLoop(), 400);
    return;
  }

  // Normal mode
  if(seat === 0) {
    // Check for lay down on first trick (human bidder leads)
    checkLayDown();
    return;
  }
  setTimeout(() => aiPlayTurn(), 500);
}

/******************************************************************************
 * CONFIRM TRUMP SELECTION - Human picked trump
 ******************************************************************************/
// ============ CALL FOR THE DOUBLE LOGIC ============

// Check if Call for Double should trigger.
// Returns true if popup should be shown (pause game for player decision).
// Called AFTER the bid winner plays their first tile on trick 1.
function shouldShowCallForDouble(){
  if(!callForDoubleEnabled) return false;
  if(!session || session.contract === "NELLO") return false;
  if(session.game.trick_number !== 0) return false; // Only trick 1
  if(session.game.trump_mode !== "PIP") return false; // Only pip trumps

  const trick = session.game._sanitized_trick();
  if(trick.length !== 1) return false; // Must be right after the lead

  const [leaderSeat, leadTile] = trick[0];
  const bidder = session.bid_winner_seat !== undefined ? session.bid_winner_seat : 0;
  if(leaderSeat !== bidder) return false; // Only bid winner can call

  // Must have led a trump
  if(!session.game._is_trump_tile(leadTile)) return false;

  // Must NOT be the double trump
  const trumpPip = session.game.trump_suit;
  if(leadTile[0] === trumpPip && leadTile[1] === trumpPip) return false; // Led the double itself

  // Bidder must NOT have the double trump in their remaining hand
  const bidderHand = session.game.hands[bidder] || [];
  for(const t of bidderHand){
    if(t[0] === trumpPip && t[1] === trumpPip) return false; // Has the double
  }

  callForDoubleTrumpPip = trumpPip;
  return true;
}

// AI decision: should AI call for the double?
// Generally yes — flushing out the highest trump is almost always good strategy.
function aiShouldCallForDouble(seat){
  // Almost always call — it gives trump control
  // Only skip if somehow it would hurt (rare edge case)
  return true;
}

// Pending animation data for Call for Double (set when bidder is local human)
let _pendingCallDoubleAnim = null;

// Resume after Call for Double decision — animate lead tile then continue play
async function resumeAfterCallDouble(){
  const pending = _pendingCallDoubleAnim;
  _pendingCallDoubleAnim = null;

  if(pending){
    // V10_121: Host broadcasts the deferred play_confirmed now
    if(MULTIPLAYER_MODE && mpIsHost && pending.mpPlayData){
      const pd = pending.mpPlayData;
      const _trickComplete = session.game._sanitized_trick().length >= session.game.active_players.length;
      mpSendMove({ action: 'play_confirmed', seat: pd.seat, tile: pd.tile, isLead: true,
        trickNumber: pd.trickNumber, nextPlayer: pd.nextPlayer,
        currentPlayer: session.game.current_player, trickComplete: _trickComplete,
        trickWinner: _trickComplete ? session.game._determine_trick_winner() : null,
        handComplete: false, handResult: null, callDouble: callForDoubleActive });
    }

    // Animate the lead tile that was paused
    await playDomino(pending.seat, pending.spriteSlotIndex, pending.isLead, pending.aiRec, pending.prePlayContext);

    // Continue with post-play logic (trick complete check, etc.)
    if(session.game._sanitized_trick().length >= session.game.active_players.length){
      await new Promise(r => setTimeout(r, 800));
      await collectToHistory();
      session.game.current_trick = [];
      if(session.game.force_double_trump){
        session.game.force_double_trump = false;
        callForDoubleActive = false;
        clearForcedDoubleGlow();
      }
      if(MULTIPLAYER_MODE){
        playedThisTrick = [];
        currentTrick++;
      }
      if(session.maybe_finish_hand()){
        // V10_121: Host broadcasts hand-end play_confirmed
        if(MULTIPLAYER_MODE && mpIsHost && pending.mpPlayData){
          const pd = pending.mpPlayData;
          mpSendMove({ action: 'play_confirmed', seat: pd.seat, tile: pd.tile, isLead: true,
            trickNumber: session.game.trick_number, nextPlayer: session.game.current_player,
            currentPlayer: session.game.current_player, trickComplete: true,
            trickWinner: session.game._determine_trick_winner ? session.game._determine_trick_winner() : null,
            handComplete: true, handResult: {
              status: session.status,
              teamPoints: [session.game.team_points[0], session.game.team_points[1]],
              teamMarks: [session.team_marks[0], session.team_marks[1]]
            }});
        }
        setStatus(session.status);
        team1Score = session.game.team_points[0];
        team2Score = session.game.team_points[1];
        team1Marks = session.team_marks[0];
        team2Marks = session.team_marks[1];
        updateScoreDisplay();
        logEvent('HAND_END', { status: session.status });
        autoSave();
        setTimeout(() => {
          if(MULTIPLAYER_MODE){ mpShowHandEnd(); } else { showHandEndPopup(); }
        }, 800);
        isAnimating = false;
        if(MULTIPLAYER_MODE && mpIsHost) mpSaveHostState();
        return;
      }
      checkLayDown();
    }
    isAnimating = false;
    clearForcedDoubleGlow();
  }

  // Resume AI/player turns
  if(MULTIPLAYER_MODE){
    if(mpIsHost) mpSaveHostState();
    mpCheckWhoseTurn();
  } else if(PASS_AND_PLAY_MODE){
    setTimeout(() => maybeAIKick(), 100);
  } else {
    aiPlayTurn();
  }
}

// Apply blue glow + pulsing white to the forced double trump tile
function applyForcedDoubleGlow(){
  if(!session || !session.game) return;
  const trumpPip = session.game.trump_suit;
  const playerCount = session.game.player_count;
  for(let seat = 0; seat < playerCount; seat++){
    const seatSprites = sprites[seat] || [];
    for(const data of seatSprites){
      if(data && data.tile && data.sprite){
        if(data.tile[0] === trumpPip && data.tile[1] === trumpPip){
          data.sprite.classList.add('forcedDouble');
        }
      }
    }
  }
}

// Clear forced double glow from all tiles
function clearForcedDoubleGlow(){
  const playerCount = session && session.game ? session.game.player_count : 6;
  for(let seat = 0; seat < playerCount; seat++){
    const seatSprites = sprites[seat] || [];
    for(const data of seatSprites){
      if(data && data.sprite){
        data.sprite.classList.remove('forcedDouble');
      }
    }
  }
}

// Show "CALLED FOR DOUBLE" banner for non-bidder players
function showCallDoubleBanner(){
  const banner = document.getElementById('callDoubleBanner');
  const localSeat = getLocalSeat();
  const trumpPip = session.game.trump_suit;
  // Check if local player has the double trump
  const hand = session.game.hands[localSeat] || [];
  const hasDouble = hand.some(t => t[0] === trumpPip && t[1] === trumpPip);
  if(hasDouble){
    banner.classList.add('clickable');
    document.getElementById('callDoubleBannerBtn').textContent = 'CALLED FOR DOUBLE — Click to Play ' + trumpPip + '-' + trumpPip;
  } else {
    banner.classList.remove('clickable');
    document.getElementById('callDoubleBannerBtn').textContent = 'CALLED FOR DOUBLE';
  }
  banner.style.display = 'flex';
  // Auto-hide banner after 3 seconds (unless player has the double)
  if(!hasDouble){
    setTimeout(() => { banner.style.display = 'none'; }, 3000);
  }
}

// Hide Call for Double banner
function hideCallDoubleBanner(){
  document.getElementById('callDoubleBanner').style.display = 'none';
}

// V11.4: Your Turn banner
let _yourTurnBannerTimeout = null;
function showYourTurnBanner(){
  if (_yourTurnBannerTimeout) clearTimeout(_yourTurnBannerTimeout);
  const banner = document.getElementById('yourTurnBanner');
  if (banner) {
    banner.style.display = 'block';
    triggerHaptic(); // V11.4: Vibrate on your turn
    _yourTurnBannerTimeout = setTimeout(() => {
      banner.style.display = 'none';
      _yourTurnBannerTimeout = null;
    }, 3000);
  }
}
function hideYourTurnBanner(){
  if (_yourTurnBannerTimeout) { clearTimeout(_yourTurnBannerTimeout); _yourTurnBannerTimeout = null; }
  const banner = document.getElementById('yourTurnBanner');
  if (banner) banner.style.display = 'none';
}

// V11.4: Haptic feedback
function triggerHaptic(pattern){
  if (navigator.vibrate) {
    try { navigator.vibrate(pattern || 50); } catch(e) {}
  }
}

// ============ NELLO DOUBLES MODE LOGIC ============

// AI decision for nello doubles mode
function aiChooseNelloDoublesMode(hand){
  // Count doubles in hand
  const doubles = hand.filter(t => t[0] === t[1]);
  if(doubles.length < 2) return false; // Need at least 2 doubles for "doubles only" to be useful

  // Check for mix of high and low doubles
  const maxPip = Math.max(...doubles.map(t => t[0]));
  const minPip = Math.min(...doubles.map(t => t[0]));

  // If spread is at least 3 pips, low doubles can protect high doubles
  if(maxPip - minPip >= 3 && doubles.length >= 2) return true;

  // If we have a dangerous high double (5+) AND a low protector
  if(maxPip >= 5 && minPip <= 2) return true;

  return false; // Default to regular
}

// Resume after Nello Doubles choice
function resumeAfterNelloDoublesChoice(){
  // The nello setup is already complete, just need to start play
  const currentPlayer = session.game.current_player;
  if(MULTIPLAYER_MODE){
    mpCheckWhoseTurn();
  } else if(PASS_AND_PLAY_MODE){
    if(ppIsHuman(currentPlayer)){
      ppActiveViewSeat = currentPlayer;
      waitingForPlayer1 = true;
      ppEnableClicksForSeat(currentPlayer);
      ppUpdateValidStates(currentPlayer);
    } else {
      waitingForPlayer1 = false;
      ppAIPlayLoop();
    }
  } else if(currentPlayer === getLocalSeat()){
    waitingForPlayer1 = true;
    enablePlayer1Clicks();
    updatePlayer1ValidStates();
    showHint();
  } else {
    waitingForPlayer1 = false;
    disablePlayer1Clicks();
    setTimeout(() => aiPlayTurn(), 500);
  }
}

function confirmTrumpSelection(){
  const trump = selectedTrump;
  if(trump === null || trump === undefined){
    alert("Please select a trump first!");
    return;
  }

  // V11.4j: Set Doubles Follow Me runtime flag when doubles are picked as trump
  if(trump === 'DOUBLES' && !_dfmChoiceMade){
    if(doublesFollowMe === 'on') _dfmActiveThisHand = true;
    else if(doublesFollowMe === 'off') _dfmActiveThisHand = false;
    else if(doublesFollowMe === 'player_chooses'){
      // Show choice popup — the buttons will call _dfmContinueTrump()
      document.getElementById('dfmChoiceBackdrop').style.display = 'flex';
      return;
    }
  } else if(trump !== 'DOUBLES'){
    _dfmActiveThisHand = false; // Not doubles trump, DFM doesn't apply
  }
  _dfmChoiceMade = false; // Reset for next hand

  // V10_121: Guest sends trump intent to host instead of calling set_trump
  if (MULTIPLAYER_MODE && !mpIsHost) {
    disableTrumpDominoClicks();
    clearTrumpHighlights();
    document.getElementById('trumpBackdrop').style.display = 'none';
    trumpSelectionActive = false;
    selectedTrump = null;

    // Build intent payload
    const trumpVal = trump;
    const isNello = (trumpVal === 'NELLO' || trumpVal === 'NELLO_2');
    if (isNello) {
      // For Nello in T42, guest sends nello trump intent directly
      // For Nello in TN51, opponent selection happens first — but we still send intent
      // The host will handle the nello setup
      const nelloMarks = session.bid_marks || 1;
      mpSendMove({ action: 'trump_intent', trump: trumpVal, seat: mpSeat, marks: nelloMarks, nello: true });
    } else {
      mpSendMove({ action: 'trump_intent', trump: trumpVal, seat: mpSeat, marks: session.bid_marks, dfmActive: _dfmActiveThisHand });
    }
    setStatus('Waiting for host to confirm trump...');
    _startIntentTimeout('trump'); // V11.3: Timeout if host is unreachable
    return; // Guest stops here — mpHandleTrumpConfirmed() continues on receipt
  }

  // ═══ HOST / SINGLE-PLAYER PATH ═══

  // Clean up trump selection state
  disableTrumpDominoClicks();
  clearTrumpHighlights();

  // If Nello selected
  if(trump === 'NELLO' || trump === 'NELLO_2'){
    document.getElementById('trumpBackdrop').style.display = 'none';
    selectedTrump = null;
    const nelloMarks = session.bid_marks || (biddingState ? biddingState.highMarks : 1) || 1;
    // V10_111: Update placeholder to show Nello when selected at trump selection (undeclared path)
    const bidWinnerVisual = seatToVisual(session.bid_winner_seat !== undefined ? session.bid_winner_seat : getLocalSeat());
    const nelloPlaceholderText = nelloMarks > 1 ? `Nel ${nelloMarks}x` : 'Nel 1x';
    setPlaceholderText(bidWinnerVisual, nelloPlaceholderText, 'winner');
    if (GAME_MODE === 'T42') {
      // T42: partner sits out automatically, no opponent selection needed
      const trumpVal = trump === 'NELLO_2' ? 'NELLO_2' : 'NELLO';
      session.bid_marks = nelloMarks;
      session.set_trump(trumpVal);
      syncSpritesWithGameState();
      updateTrumpDisplay();
      renderAll();
      // V10_121: Host broadcasts trump_confirmed (nello) to guests
      if (MULTIPLAYER_MODE && mpIsHost) {
        const _nelloActive = session.game.active_players ? session.game.active_players.slice() : [0,1,2,3];
        mpSendMove({ action: 'trump_confirmed', trump: trumpVal, seat: mpSeat, marks: nelloMarks, nello: true, activePlayers: _nelloActive, firstPlayer: session.game.current_player });
        mpSaveHostState();
      }
      // Check nello doubles mode
      const bidder = session.bid_winner_seat !== undefined ? session.bid_winner_seat : 0;
      if(nelloDoublesMode === 'doubles_only'){
        nelloDoublesSuitActive = true;
        session.game.nello_doubles_suit = true;
      } else if(nelloDoublesMode === 'player_chooses' && bidder === getLocalSeat()){
        // Human bidder picks — show popup
        document.getElementById('nelloDoublesBackdrop').style.display = 'flex';
        return; // Pause until choice
      } else if(nelloDoublesMode === 'player_chooses'){
        // AI bidder picks
        const bidderHand = session.game.hands[bidder] || [];
        nelloDoublesSuitActive = aiChooseNelloDoublesMode(bidderHand);
        session.game.nello_doubles_suit = nelloDoublesSuitActive;
        if(nelloDoublesSuitActive) setStatus('Nello: Doubles are their own suit');
      } else {
        nelloDoublesSuitActive = false;
        session.game.nello_doubles_suit = false;
      }
      // Start play
      if (MULTIPLAYER_MODE) {
        mpCheckWhoseTurn();
      } else if(session.game.current_player === getLocalSeat()){
        waitingForPlayer1 = true;
        enablePlayer1Clicks();
        updatePlayer1ValidStates();
        showHint();
      } else {
        waitingForPlayer1 = false;
        disablePlayer1Clicks();
        runPlayStep();
      }
      return;
    }
    // TN51: show opponent selection overlay
    showNelloOpponentSelection(nelloMarks);
    return;
  }

  // HIDE OVERLAY FIRST - before anything else
  document.getElementById('trumpBackdrop').style.display = 'none';

  // Convert 'NT' back to null for the game engine
  const trumpValue = (trump === 'NT') ? null : trump;

  // Set trump on session (this changes phase to PLAYING)
  session.set_trump(trumpValue);
  _trackCpChange('confirmTrumpSelection');

  // Keep bid placeholders visible during play (user preference)

  // Log hand start with detailed v2.0 format
  const trumpMode = trump === 'DOUBLES' ? 'DOUBLES' : ((trump === null || trump === 'NT') ? 'NONE' : 'PIP');
  const trumpSuit = (trump === 'DOUBLES' || trump === 'NT') ? null : trumpValue;
  const bidderSeat = session.bid_winner_seat !== undefined ? session.bid_winner_seat : 0;
  const leaderSeat = bidderSeat; // Bid winner leads first trick

  // Make a copy of hands before they change
  const handsCopy = session.game.hands.map(h => h ? [...h] : []);

  logHandStart(
    trumpMode,
    trumpSuit,
    'NORMAL',
    session.current_bid,
    bidderSeat,
    handsCopy,
    session.dealer,
    leaderSeat,
    { team1: session.team_marks[0] || 0, team2: session.team_marks[1] || 0 }
  );

  // Clear selection
  selectedTrump = null;

  // Update scores
  team1Score = session.game.team_points[0];
  team2Score = session.game.team_points[1];
  team1Marks = session.team_marks[0];
  team2Marks = session.team_marks[1];
  updateScoreDisplay();

  // Update status
  setStatus(session.status);

  // Sync sprites
  syncSpritesWithGameState();

  // Sort player's hand by trump
  sortPlayerHandByTrump();
  SFX.playShuffle();

  // Sort all other players' hands + flip tiles so trump pip is on top
  sortAllHandsByTrump();
  flipTilesForTrump();

  // Update trump display
  updateTrumpDisplay();

  // Setup for playing
  const currentPlayer = session.game.current_player;
  console.log("confirmTrumpSelection - currentPlayer:", currentPlayer);
  console.log("confirmTrumpSelection - session.phase:", session.phase);
  console.log("confirmTrumpSelection - bid_winner_seat:", session.bid_winner_seat);

  if(MULTIPLAYER_MODE) {
    // V10_121: Host broadcasts trump_confirmed to guests (normal non-nello trump)
    if (mpIsHost) {
      const trumpBroadcast = (trump === 'NT') ? 'NT' : trump;
      mpSendMove({ action: 'trump_confirmed', trump: trumpBroadcast, seat: mpSeat, marks: session.bid_marks, nello: false,
        activePlayers: session.game.active_players ? session.game.active_players.slice() : null,
        firstPlayer: session.game.current_player, dfmActive: _dfmActiveThisHand });
      mpSaveHostState();
    }
    mpCheckWhoseTurn();
  } else if(PASS_AND_PLAY_MODE) {
    // PP mode: bid winner leads first trick
    // Board is already rotated to bid winner from finalizeBidding
    // No privacy screen needed — same player just picked trump
    if(ppIsHuman(currentPlayer)) {
      ppActiveViewSeat = currentPlayer;
      waitingForPlayer1 = true;
      ppEnableClicksForSeat(currentPlayer);
      ppUpdateValidStates(currentPlayer);
    } else {
      // AI won bid somehow (shouldn't happen — AI trump is handled elsewhere)
      waitingForPlayer1 = false;
      ppAIPlayLoop();
    }
  } else if(currentPlayer === 0){
    console.log("Setting up for player 0 to play");
    // Check for lay down on first trick (human bidder selected trump and leads)
    checkLayDown();
    waitingForPlayer1 = true;
    enablePlayer1Clicks();
    updatePlayer1ValidStates();
  } else {
    console.log("AI will play first, current_player:", currentPlayer);
    waitingForPlayer1 = false;
    disablePlayer1Clicks();
    setTimeout(() => aiPlayTurn(), 500);
  }
}

async function aiPlayTurn(){
  // Prevent multiple simultaneous AI turns
  if(isAnimating) {
    console.log("AI turn blocked - animation in progress");
    return;
  }
  isAnimating = true;

  try {
  // Check for lay down at start of AI turn (e.g., AI bidder's first lead)
  if(session.game.current_trick.length === 0) {
    checkLayDown();
    // Only block if AI laid down (human gets button + can still play)
    if(layDownState && session.game.current_player !== 0) { isAnimating = false; return; }
  }

  while(session.phase === PHASE_PLAYING && session.game.current_player !== 0){
    // Check if AI just led trick 1 with a trump and should call for double
    if(shouldShowCallForDouble()){
      const bidder = session.bid_winner_seat !== undefined ? session.bid_winner_seat : 0;
      if(aiShouldCallForDouble(bidder)){
        callForDoubleActive = true;
        session.game.force_double_trump = true;
        setStatus(getPlayerDisplayName(bidder) + ' calls for the double!');
        applyForcedDoubleGlow();
        await new Promise(r => setTimeout(r, 800)); // Brief pause for status to show
      }
    }
    const seat = session.game.current_player;
    const hand = session.game.hands[seat] || [];
    // Get AI recommendation with reason for logging
    const aiRec = choose_tile_ai(session.game, seat, session.contract, true, session.current_bid);
    const gameHandIdx = aiRec.index;

    if(gameHandIdx < 0) {
      console.log("AI seat", seat, "has no legal moves");
      break;
    }

    const tileToPlay = aiRec.tile || hand[gameHandIdx];
    console.log("AI seat", seat, "chose tile", tileToPlay, "at game index", gameHandIdx);
    setStatus(`P${seatToPlayer(seat)} plays...`);
    const variedDelay2 = ANIM.OPPONENT_PLAY_DELAY * (1 + (Math.random() * 2 - 1) * 0.15);
    await new Promise(r => setTimeout(r, variedDelay2));

    // Find the sprite by tile value (not by index)
    const seatSprites = sprites[seat] || [];
    console.log("Looking for tile", tileToPlay, "in seat", seat, "sprites");
    console.log("Seat sprites:", seatSprites.map((s,i) => s ? {idx:i, tile:s.tile} : {idx:i, tile:null}));

    let spriteIdx = -1;
    for(let i = 0; i < seatSprites.length; i++){
      const sd = seatSprites[i];
      if(sd && sd.tile){
        console.log("Checking sprite", i, "tile:", sd.tile);
        if((sd.tile[0] === tileToPlay[0] && sd.tile[1] === tileToPlay[1]) ||
           (sd.tile[0] === tileToPlay[1] && sd.tile[1] === tileToPlay[0])){
          spriteIdx = i;
          console.log("Found matching sprite at index", i);
          break;
        }
      }
    }

    if(spriteIdx >= 0){
      const isLead = session.game.current_trick.length === 0;

      // Capture context BEFORE playing (for accurate logging)
      const legalIndices = session.game.legal_indices_for_player(seat);
      const legalTiles = legalIndices.map(i => hand[i]).filter(t => t);

      // Capture current trick winner BEFORE this play
      let currentWinner = null;
      const trick = session.game.current_trick || [];
      if(trick.length > 0){
        const winnerSeat = session.game._determine_trick_winner();
        currentWinner = { seat: winnerSeat, team: winnerSeat % 2 === 0 ? 1 : 2 };
      }

      const prePlayContext = { legalTiles, currentWinner };

      // Play the tile in the game engine FIRST
      try {
        session.play(seat, gameHandIdx);
        console.log("AI played successfully, current_player now:", session.game.current_player);
      } catch(e) {
        console.log("AI play error:", e);
        break;
      }

      // Animate the domino (pass seat directly with AI recommendation and pre-play context)
      await playDomino(seat, spriteIdx, isLead, aiRec, prePlayContext);
    } else {
      console.log("No sprite found for seat", seat, "tile", tileToPlay);
      break;
    }

    // Check if trick is complete
    if(session.game._sanitized_trick().length >= session.game.active_players.length){
      await new Promise(r => setTimeout(r, 800));
      // Don't clear current_trick here - collectToHistory needs it to determine winner
      await collectToHistory();
      // Clear current_trick AFTER collecting (winner determination done)
      session.game.current_trick = [];
      // Clear call for double after trick 1
      if(session.game.force_double_trump){
        session.game.force_double_trump = false;
        callForDoubleActive = false;
        clearForcedDoubleGlow();
        hideCallDoubleBanner();
      }

      if(session.maybe_finish_hand()){
        setStatus(session.status);
        // Update scores IMMEDIATELY so they display before the button appears
        team1Score = session.game.team_points[0];
        team2Score = session.game.team_points[1];
        team1Marks = session.team_marks[0];
        team2Marks = session.team_marks[1];
        updateScoreDisplay();
        logEvent('HAND_END', { status: session.status });
        autoSave();
        // Show end of hand popup after a brief delay (scores already visible)
        setTimeout(() => showHandEndPopup(), 800);
        return;
      }

      // Check for lay down opportunity (shows button for human, AI auto-lays down)
      checkLayDown();
      if(layDownState && session.game.current_player !== 0) return; // AI laid down
    }

    // If it's now player 0's turn, exit the loop
    if(session.game.current_player === 0){
      break;
    }
  }

  if(session.phase === PHASE_PLAYING && session.game.current_player === 0){
    // Check for lay down for human player
    checkLayDown();

    waitingForPlayer1 = true;
    enablePlayer1Clicks();
    updatePlayer1ValidStates();
    showHint();
    setStatus(`Trick ${session.game.trick_number + 1} - Click a domino to play`);
  }
  } finally {
    isAnimating = false;
  }
}

async function startNewHand(){
  // ═══════════════════════════════════════════════════════════════
  // V10_FIX: Reset all sync fix flags for new hand
  // ═══════════════════════════════════════════════════════════════
  _biddingCompleting = false;  // FIX1: Reset bidding completion flag
  _aiActionInProgress = false; // FIX3: Reset AI action lock
  _clearAllAITimers();         // FIX5: Clear all AI timers
  console.log('[FIX] All sync flags reset for new hand');

  // Reset hand-scoped house rule flags (nello_doubles_suit not reset by new_hand_random)
  nelloDoublesSuitActive = false;
  _dfmActiveThisHand = false;
  _dfmChoiceMade = false;
  if(session && session.game){
    session.game.nello_doubles_suit = false;
    session.game.force_double_trump = false;
  }

  _staleRefreshCount = 0; // V10_118: Reset refresh counter for new hand
  // Hide boneyard 2 overlay when new hand starts
  if(boneyard2Visible){
    boneyard2Visible = false;
    const by2c = document.getElementById('boneyard2Container');
    const thBg = document.getElementById('trickHistoryBg');
    const toggleBtn = document.getElementById('boneyard2Toggle');
    if(by2c) by2c.style.display = 'none';
    if(thBg) thBg.style.display = '';
    if(toggleBtn) toggleBtn.classList.remove('active');
  }
  // Re-enable BONES button for new hand
  const bonesToggle = document.getElementById('boneyard2Toggle');
  if(bonesToggle){
    bonesToggle.style.pointerEvents = 'auto';
    bonesToggle.style.opacity = '';
  }
  hideRoundEndSummary();
  // Hide lay down UI
  document.getElementById('layDownBtnGroup').style.display = 'none';
  document.getElementById('layDownMinDot').style.display = 'none';
  document.getElementById('layDownTraveler').style.display = 'none';
  document.getElementById('layDownBackdrop').style.display = 'none';
  // Hide Call for Double UI
  document.getElementById('callDoubleBtnGroup').style.display = 'none';
  hideCallDoubleBanner();
  clearForcedDoubleGlow();

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
  // Reset widow sprite (cleared by innerHTML='')
  widowSprite = null;
  var _widowLbl = document.getElementById('moonWidowLabel');
  if(_widowLbl) _widowLbl.style.display = 'none';

  // Hide trump display
  document.getElementById('trumpDisplay').classList.remove('visible');

  // Hide unused player indicators based on game mode
  if(GAME_MODE === 'MOON'){
    for(let h = 4; h <= 6; h++){
      const hel = document.getElementById('playerIndicator' + h);
      if(hel) hel.style.display = 'none';
    }
    for(let h = 1; h <= 3; h++){
      const hel = document.getElementById('playerIndicator' + h);
      if(hel) hel.style.display = '';
    }
  } else if(GAME_MODE === 'T42'){
    for(let h = 5; h <= 6; h++){
      const hel = document.getElementById('playerIndicator' + h);
      if(hel) hel.style.display = 'none';
    }
    for(let h = 1; h <= 4; h++){
      const hel = document.getElementById('playerIndicator' + h);
      if(hel) hel.style.display = '';
    }
  } else {
    for(let h = 1; h <= 6; h++){
      const hel = document.getElementById('playerIndicator' + h);
      if(hel) hel.style.display = '';
    }
  }
  positionPlayerIndicators();

  session.new_hand_random();

  // Initialize offTracker for this hand (will be populated after bidding)
  offTracker = null;
  layDownState = null;
  layDownDismissed = false;
  layDownContested = false;
  layDownMinimized = false;

  createPlaceholders();

  const hands = session.game.hands;

  for(let p = 0; p < session.game.player_count; p++){
    sprites[p] = [];
    const playerNum = seatToPlayer(p);  // Convert seat to player number for layout
    for(let h = 0; h < session.game.hand_size; h++){
      const tile = hands[p][h];
      if(!tile) continue;

      const sprite = makeSprite(tile);

      const pos = getHandPosition(playerNum, h);
      if(pos){
        sprite.setPose(pos);
        if(sprite._shadow){
          shadowLayer.appendChild(sprite._shadow);
        }
        spriteLayer.appendChild(sprite);

        const data = { sprite, tile, originalSlot: h };
        sprites[p][h] = data;

        if(p === 0 || (PASS_AND_PLAY_MODE && ppIsHuman(p))){
          // Pass sprite element directly so click handler finds current position after sorting
          sprite.addEventListener('click', () => handlePlayer1Click(sprite));
          // Mobile touch support - use touchstart for immediate response
          sprite.addEventListener('touchstart', (e) => {
            e.preventDefault();
            e.stopPropagation();
            handlePlayer1Click(sprite);
          }, { passive: false });
        }
      }
    }
  }

  // Auto deal: just flip local player's tiles face-up
  const localSeat = getLocalSeat();
  for (const data of (sprites[localSeat] || [])) {
    if (data && data.sprite) data.sprite.setFaceUp(true);
  }

  team1Score = session.game.team_points[0];
  team2Score = session.game.team_points[1];
  team1Marks = session.team_marks[0];
  team2Marks = session.team_marks[1];
  updateScoreDisplay();

  // V12.10.4: Show widow sprite for Moon replay
  if(GAME_MODE === 'MOON' && session.moon_widow){
    if(typeof updateWidowDisplay === 'function') updateWidowDisplay();
  }

  initBiddingRound();

  // V10_109: Enable bidding preview immediately after deal so player can click tiles to shuffle
  enableBiddingPreview();

  // Show widow face-down on table for Moon mode
  if(GAME_MODE === 'MOON' && typeof updateWidowDisplay === 'function') updateWidowDisplay();

  // In Pass & Play mode, set up rotation for first bidder
  if (PASS_AND_PLAY_MODE) {
    const firstBidder = biddingState ? biddingState.currentBidder : 0;
    if (ppIsHuman(firstBidder)) {
      // Transition to the human bidder, then start bidding
      if (ppPrivacyMode) {
        ppTransitionToSeat(firstBidder, 'Bidding Phase');
        // Handoff button handler will resume bidding
      } else {
        ppRotateBoard(firstBidder);
        startBiddingRound();
      }
    } else {
      // First bidder is AI - keep P1 perspective and run bidding
      ppResetRotation();
      startBiddingRound();
    }
  } else if (MULTIPLAYER_MODE) {
    // V10_121d: Use MP-aware bidding stepper that handles remote humans + broadcasts
    mpRunBiddingStep();
  } else {
    startBiddingRound();
  }
}


// mpHostDeal() moved to multiplayer.js


/******************************************************************************
 * BUTTON HANDLERS AND SETTINGS
 ******************************************************************************/

document.getElementById('settingsBtn').addEventListener('click', () => {
  document.getElementById('settingsMenu').classList.toggle('open');
  // V10_113: Show/hide MP Log export based on whether MP was used
  const mpLogItem = document.getElementById('menuMPLog');
  if(mpLogItem) mpLogItem.style.display = (MULTIPLAYER_MODE || _mpDiagLog.length > 0) ? '' : 'none';
});

document.addEventListener('click', (e) => {
  const btn = document.getElementById('settingsBtn');
  const menu = document.getElementById('settingsMenu');
  if(!btn.contains(e.target) && !menu.contains(e.target)){
    menu.classList.remove('open');
    // Collapse sound settings when menu closes
    const panel = document.getElementById('soundSettingsPanel');
    if(panel) panel.style.display = 'none';
  }
});

document.getElementById('menuNewHand').addEventListener('click', () => {
  document.getElementById('settingsMenu').classList.remove('open');
  SFX.resumeBgmAfterResult();
  startNewHand();
});

document.getElementById('menuPassPlay').addEventListener('click', () => {
  document.getElementById('settingsMenu').classList.remove('open');
  if (PASS_AND_PLAY_MODE) {
    ppDeactivate();
  } else {
    ppOpenSetupModal();
  }
});

// Boneyard style controls — persist with localStorage
// V10_122e: Wrap localStorage in try-catch for iOS Safari private mode
window._bonesGap = 7;
window._bonesInnerSize = 1;
window._bonesInnerRadius = 8;
window._bonesOuterSize = 3;
window._bonesOuterRadius = 11;
window._bonesColor = '#beb6ab';
window._bonesOuterColor = '#00deff';
try {
  window._bonesGap = parseInt(localStorage.getItem('tn51_bonesGap')) || 7;
  window._bonesInnerSize = parseInt(localStorage.getItem('tn51_bonesInnerSize')) || 1;
  window._bonesInnerRadius = parseInt(localStorage.getItem('tn51_bonesInnerRadius') || '8');
  window._bonesOuterSize = parseInt(localStorage.getItem('tn51_bonesOuterSize')) || 3;
  window._bonesOuterRadius = parseInt(localStorage.getItem('tn51_bonesOuterRadius') || '11');
  window._bonesColor = localStorage.getItem('tn51_bonesColor') || '#beb6ab';
  window._bonesOuterColor = localStorage.getItem('tn51_bonesOuterColor') || '#00deff';
} catch(e) {
  console.warn('[iOS] localStorage read error (private mode?):', e);
}

function updateBonesStyle(){
  const gapEl = document.getElementById('bonesGap');
  const innerSizeEl = document.getElementById('bonesInnerSize');
  const innerRadiusEl = document.getElementById('bonesInnerRadius');
  const outerSizeEl = document.getElementById('bonesOuterSize');
  const outerRadiusEl = document.getElementById('bonesOuterRadius');
  const colorEl = document.getElementById('bonesColor');
  const outerColorEl = document.getElementById('bonesOuterColor');
  if(gapEl) window._bonesGap = parseInt(gapEl.value);
  if(innerSizeEl) window._bonesInnerSize = parseInt(innerSizeEl.value);
  if(innerRadiusEl) window._bonesInnerRadius = parseInt(innerRadiusEl.value);
  if(outerSizeEl) window._bonesOuterSize = parseInt(outerSizeEl.value);
  if(outerRadiusEl) window._bonesOuterRadius = parseInt(outerRadiusEl.value);
  if(colorEl) window._bonesColor = colorEl.value;
  if(outerColorEl) window._bonesOuterColor = outerColorEl.value;
  // Update display values
  const gv = document.getElementById('bonesGapVal');
  const isv = document.getElementById('bonesInnerSizeVal');
  const irv = document.getElementById('bonesInnerRadiusVal');
  const osv = document.getElementById('bonesOuterSizeVal');
  const orv = document.getElementById('bonesOuterRadiusVal');
  const cv = document.getElementById('bonesColorVal');
  const ocv = document.getElementById('bonesOuterColorVal');
  if(gv) gv.textContent = window._bonesGap;
  if(isv) isv.textContent = window._bonesInnerSize;
  if(irv) irv.textContent = window._bonesInnerRadius;
  if(osv) osv.textContent = window._bonesOuterSize;
  if(orv) orv.textContent = window._bonesOuterRadius;
  if(cv) cv.textContent = window._bonesColor;
  if(ocv) ocv.textContent = window._bonesOuterColor;
  // Persist
  // V10_122e: Wrap localStorage in try-catch for iOS Safari private mode
  try {
    localStorage.setItem('tn51_bonesGap', window._bonesGap);
    localStorage.setItem('tn51_bonesInnerSize', window._bonesInnerSize);
    localStorage.setItem('tn51_bonesInnerRadius', window._bonesInnerRadius);
    localStorage.setItem('tn51_bonesOuterSize', window._bonesOuterSize);
    localStorage.setItem('tn51_bonesOuterRadius', window._bonesOuterRadius);
    localStorage.setItem('tn51_bonesColor', window._bonesColor);
    localStorage.setItem('tn51_bonesOuterColor', window._bonesOuterColor);
  } catch(e) {
    console.warn('[iOS] localStorage write error:', e);
  }
  // Re-render
  renderBoneyard();
}

function initBonesControls(){
  const gapEl = document.getElementById('bonesGap');
  const innerSizeEl = document.getElementById('bonesInnerSize');
  const innerRadiusEl = document.getElementById('bonesInnerRadius');
  const outerSizeEl = document.getElementById('bonesOuterSize');
  const outerRadiusEl = document.getElementById('bonesOuterRadius');
  const colorEl = document.getElementById('bonesColor');
  const outerColorEl = document.getElementById('bonesOuterColor');
  if(gapEl) gapEl.value = window._bonesGap;
  if(innerSizeEl) innerSizeEl.value = window._bonesInnerSize;
  if(innerRadiusEl) innerRadiusEl.value = window._bonesInnerRadius;
  if(outerSizeEl) outerSizeEl.value = window._bonesOuterSize;
  if(outerRadiusEl) outerRadiusEl.value = window._bonesOuterRadius;
  if(colorEl) colorEl.value = window._bonesColor;
  if(outerColorEl) outerColorEl.value = window._bonesOuterColor;
  const gv = document.getElementById('bonesGapVal');
  const isv = document.getElementById('bonesInnerSizeVal');
  const irv = document.getElementById('bonesInnerRadiusVal');
  const osv = document.getElementById('bonesOuterSizeVal');
  const orv = document.getElementById('bonesOuterRadiusVal');
  const cv = document.getElementById('bonesColorVal');
  const ocv = document.getElementById('bonesOuterColorVal');
  if(gv) gv.textContent = window._bonesGap;
  if(isv) isv.textContent = window._bonesInnerSize;
  if(irv) irv.textContent = window._bonesInnerRadius;
  if(osv) osv.textContent = window._bonesOuterSize;
  if(orv) orv.textContent = window._bonesOuterRadius;
  if(cv) cv.textContent = window._bonesColor;
  if(ocv) ocv.textContent = window._bonesOuterColor;
}

document.getElementById('menuBones').addEventListener('click', () => {
  document.getElementById('settingsMenu').classList.remove('open');
  initBonesControls();
  renderBoneyard();
  document.getElementById('bonesBackdrop').style.display = 'block';
});

// ═══════════════════════════════════════════════════════════════════
//  BONEYARD RENDERER — shows all 28 dominoes in triangular layout
//  Played tiles shown as invalid (faded), trump tiles highlighted
// ═══════════════════════════════════════════════════════════════════
// ============================================================
// BONEYARD 2 — Inline overlay on trick history area
// ============================================================
// Boneyard 2 — hardcoded settings
var BY2_GAP = 0;
var BY2_INNER_SIZE = 1;
var BY2_INNER_RADIUS = 5;
var BY2_OUTER_SIZE = 2;
var BY2_OUTER_RADIUS = 8;
var BY2_INNER_COLOR = '#beb6ab';
var BY2_OUTER_COLOR = '#00deff';
var BY2_PLAYED_OPACITY = 0.71;
let boneyard2Visible = false;

function showGameEndSummary(){
  triggerHaptic([100, 50, 100, 50, 200]); // V11.4: Haptic for game end
  // Mark host state as completed so it won't try to resume
  if (MULTIPLAYER_MODE && mpIsHost) mpMarkHostStateCompleted();
  // Create overlay showing final scores — positioned lower on screen, blue theme matching bid panel
  let overlay = document.getElementById('gameEndOverlay');
  if(!overlay){
    overlay = document.createElement('div');
    overlay.id = 'gameEndOverlay';
    overlay.style.cssText = 'position:absolute;left:0;top:0;width:100%;height:100%;z-index:1001;display:flex;align-items:center;justify-content:center;pointer-events:none;padding-top:25%;';
    document.getElementById('tableMain').appendChild(overlay);
  }
  const t1m = session.team_marks[0];
  const t2m = session.team_marks[1];
  const t1p = session.game.team_points[0];
  const t2p = session.game.team_points[1];
  const winner = t1m > t2m ? 1 : 2;
  const _localTeam = MULTIPLAYER_MODE ? ((mpSeat % 2 === 0) ? 1 : 2) : 1;
  const _youWon = (_localTeam === winner);
  const _endTitle = _youWon ? 'Your Team Wins! \u{1F389}' : 'Your Team Lost';
  const _endBg = _youWon ? 'linear-gradient(135deg, #22c55e 0%, #16a34a 100%)' : 'linear-gradient(135deg, #ef4444 0%, #dc2626 100%)';
  // Update tally
  if (MULTIPLAYER_MODE) {
    mpGamesPlayed++;
    if (_youWon) mpGamesWon++;
    else mpGamesLost++;
  }
  const _tallyText = MULTIPLAYER_MODE ? ('Won ' + mpGamesWon + ' of ' + mpGamesPlayed) : '';

  // Determine button section based on mode
  let _btnSection = '';
  if (MULTIPLAYER_MODE && mpIsHost) {
    _btnSection = '<button id="gameEndRematchBtn" style="padding:10px 28px;font-size:15px;font-weight:700;color:#fff;background:linear-gradient(135deg,#a78bfa 0%,#7c3aed 100%);border:none;border-radius:10px;cursor:pointer;box-shadow:0 3px 10px rgba(0,0,0,0.2);transition:transform 0.15s ease;">Play Again?</button>';
  } else if (MULTIPLAYER_MODE && !mpIsHost) {
    _btnSection = '<div id="gameEndWaitMsg" style="font-size:14px;opacity:0.8;padding:4px;">Waiting for host...</div>';
  } else {
    _btnSection = '<button id="gameEndNewGameBtn" style="padding:10px 28px;font-size:15px;font-weight:700;color:#1d4ed8;background:linear-gradient(135deg,#fbbf24 0%,#f59e0b 100%);border:none;border-radius:10px;cursor:pointer;box-shadow:0 3px 10px rgba(0,0,0,0.2);transition:transform 0.15s ease;">New Game</button>';
  }

  overlay.innerHTML = '<div style="background:' + _endBg + ';border-radius:16px;padding:0;text-align:center;color:#fff;font-family:inherit;box-shadow:0 8px 32px rgba(0,0,0,0.4);border:1px solid rgba(255,255,255,0.2);pointer-events:auto;min-width:200px;max-width:80%;overflow:hidden;">'
    + '<div style="padding:14px 28px 10px;">'
    + '<div style="font-size:20px;font-weight:900;margin-bottom:10px;color:#fff;text-shadow:0 1px 3px rgba(0,0,0,0.3);">' + _endTitle + '</div>'
    + (MULTIPLAYER_MODE ? '<div style="font-size:13px;opacity:0.85;margin-bottom:8px;font-weight:600;">' + _tallyText + '</div>' : '')
    + '<div style="display:flex;gap:24px;justify-content:center;margin-bottom:4px;">'
    + '<div style="text-align:center;"><div style="font-size:12px;opacity:0.8;">Team 1</div><div style="font-size:26px;font-weight:bold;color:#fff;">' + t1m + '</div><div style="font-size:10px;opacity:0.6;">marks</div><div style="font-size:13px;margin-top:2px;opacity:0.8;">' + t1p + ' pts</div></div>'
    + '<div style="width:1px;background:rgba(255,255,255,0.2);"></div>'
    + '<div style="text-align:center;"><div style="font-size:12px;opacity:0.8;">Team 2</div><div style="font-size:26px;font-weight:bold;color:#fff;">' + t2m + '</div><div style="font-size:10px;opacity:0.6;">marks</div><div style="font-size:13px;margin-top:2px;opacity:0.8;">' + t2p + ' pts</div></div>'
    + '</div></div>'
    + '<div style="border-top:1px solid rgba(255,255,255,0.15);padding:10px 28px;">' + _btnSection + '</div>'
    + '</div>';
  overlay.style.display = 'flex';
  if(typeof fitOverlayContent === 'function') fitOverlayContent('gameEndOverlay');

  // Attach click handlers based on mode
  const newGameBtn = document.getElementById('gameEndNewGameBtn');
  if (newGameBtn) {
    newGameBtn.addEventListener('click', () => {
      hideGameEndSummary();
      SFX.resumeBgmAfterResult();
      session.team_marks = [0, 0];
      clearSavedGame();
      startNewHand();
    });
  }

  const rematchBtn = document.getElementById('gameEndRematchBtn');
  if (rematchBtn) {
    rematchBtn.addEventListener('click', () => {
      // Host sends rematch invite to all players
      rematchBtn.disabled = true;
      rematchBtn.textContent = 'Waiting for votes...';
      rematchBtn.style.opacity = '0.7';
      mpSendRematchInvite();
    });
  }
}

function hideGameEndSummary(){
  const overlay = document.getElementById('gameEndOverlay');
  if(overlay) overlay.style.display = 'none';
}


// Rematch voting + In-game chat + No Table Talk moved to mp-social.js


function showRoundEndSummary(){
  // Show round-end summary popup (same style as game-end but with round info + Next Round button)
  let overlay = document.getElementById('roundEndOverlay');
  if(!overlay){
    overlay = document.createElement('div');
    overlay.id = 'roundEndOverlay';
    overlay.style.cssText = 'position:absolute;left:0;top:0;width:100%;height:100%;z-index:1001;display:flex;align-items:center;justify-content:center;pointer-events:none;padding-top:25%;';
    document.getElementById('tableMain').appendChild(overlay);
  }
  const t1p = session.game.team_points[0];
  const t2p = session.game.team_points[1];
  const t1m = session.team_marks[0];
  const t2m = session.team_marks[1];
  const status = session.status;

  // Parse the result for a cleaner display
  let resultText = '';
  let resultColor = '#fff';
  if(status.includes('Bid made')){
    resultText = 'Bid Made!';
    resultColor = '#4ade80';  // green
  } else if(status.includes('Bid failed')){
    resultText = 'Bid Failed!';
    resultColor = '#f87171';  // red
  } else if(status.includes('SET!')){
    resultText = 'SET!';
    resultColor = '#f87171';
  } else if(status.includes('Nel-O success')){
    resultText = 'Nel-O Success!';
    resultColor = '#4ade80';
  } else if(status.includes('Nel-O failed')){
    resultText = 'Nel-O Failed!';
    resultColor = '#f87171';
  } else {
    resultText = 'Round Over';
  }

  overlay.innerHTML = `
    <div style="background:linear-gradient(135deg, #3b82f6 0%, #1d4ed8 100%);border-radius:14px;padding:0;text-align:center;color:#fff;font-family:inherit;box-shadow:0 8px 32px rgba(0,0,0,0.4);border:1px solid rgba(255,255,255,0.2);pointer-events:auto;max-width:55%;overflow:hidden;">
      <div style="padding:10px 14px 8px;">
        <div style="font-size:16px;font-weight:900;margin-bottom:4px;color:${resultColor};text-shadow:0 1px 3px rgba(0,0,0,0.3);">${resultText}</div>
        <div style="font-size:10px;opacity:0.7;margin-bottom:6px;">Round Points</div>
        <div style="display:flex;gap:16px;justify-content:center;margin-bottom:4px;">
          <div style="text-align:center;">
            <div style="font-size:10px;opacity:0.8;">Team 1</div>
            <div style="font-size:20px;font-weight:bold;color:#fff;">${t1p}</div>
          </div>
          <div style="width:1px;background:rgba(255,255,255,0.2);"></div>
          <div style="text-align:center;">
            <div style="font-size:10px;opacity:0.8;">Team 2</div>
            <div style="font-size:20px;font-weight:bold;color:#fff;">${t2p}</div>
          </div>
        </div>
        <div style="border-top:1px solid rgba(255,255,255,0.12);margin-top:4px;padding-top:5px;">
          <div style="font-size:10px;opacity:0.7;margin-bottom:2px;">Marks</div>
          <div style="display:flex;gap:14px;justify-content:center;">
            <div style="font-size:16px;font-weight:bold;color:#93c5fd;">${t1m}</div>
            <div style="font-size:12px;opacity:0.5;align-self:center;">-</div>
            <div style="font-size:16px;font-weight:bold;color:#fca5a5;">${t2m}</div>
          </div>
        </div>
      </div>
      <div style="border-top:1px solid rgba(255,255,255,0.15);padding:8px 14px;">
        ${(MULTIPLAYER_MODE && !mpIsHost)
          ? '<div id="roundEndWaitMsg" style="font-size:12px;opacity:0.7;padding:4px 0;">Waiting for host to start next round...</div>'
          : '<button id="roundEndNextBtn" style="padding:8px 20px;font-size:14px;font-weight:700;color:#fff;background:linear-gradient(135deg,#22c55e 0%,#16a34a 100%);border:none;border-radius:10px;cursor:pointer;box-shadow:0 3px 10px rgba(0,0,0,0.2);transition:transform 0.15s ease;">Next Round</button>'
        }
      </div>
    </div>`;
  overlay.style.display = 'flex';
  if(typeof fitOverlayContent === 'function') fitOverlayContent('roundEndOverlay');
  // V10_121: Only host/single-player gets the Next Round button
  const _reBtn = document.getElementById('roundEndNextBtn');
  if (_reBtn) {
    _reBtn.addEventListener('click', async () => {
      hideRoundEndSummary();
      SFX.resumeBgmAfterResult();
      if (MULTIPLAYER_MODE && mpIsHost) {
        mpSendMove({ action: 'next_hand' }); // V10_121: Tell guests to dismiss popup
        mpHostDeal();
        return;
      }
      startNewHand();
    });
  }
}

function hideRoundEndSummary(){
  const overlay = document.getElementById('roundEndOverlay');
  if(overlay) overlay.style.display = 'none';
}

function toggleBoneyard2(){
  boneyard2Visible = !boneyard2Visible;
  const container = document.getElementById('boneyard2Container');
  const thBg = document.getElementById('trickHistoryBg');
  const toggleBtn = document.getElementById('boneyard2Toggle');
  if(boneyard2Visible){
    // Hide trick history background and all trick history sprites
    if(thBg) thBg.style.display = 'none';
    hideTrickHistorySprites();
    container.style.display = 'block';
    toggleBtn.classList.add('active');
    renderBoneyard2();
  } else {
    container.style.display = 'none';
    // Restore trick history
    if(thBg) thBg.style.display = '';
    showTrickHistorySprites();
    toggleBtn.classList.remove('active');
  }
}

function hideTrickHistorySprites(){
  // Hide sprites tagged as trick history (moved there by collectToHistory)
  const spriteEls = document.querySelectorAll('#spriteLayer .dominoSprite');
  spriteEls.forEach(el => {
    if(el._inTrickHistory){
      el._by2Hidden = true;
      el.style.display = 'none';
    }
  });
  // Also hide their shadows
  const shadowEls = document.querySelectorAll('#shadowLayer .dominoShadow');
  shadowEls.forEach(el => {
    if(el._inTrickHistory){
      el._by2Hidden = true;
      el.style.display = 'none';
    }
  });
}

function showTrickHistorySprites(){
  const spriteEls = document.querySelectorAll('#spriteLayer .dominoSprite');
  spriteEls.forEach(el => {
    if(el._by2Hidden){
      el._by2Hidden = false;
      el.style.display = '';
    }
  });
  const shadowEls = document.querySelectorAll('#shadowLayer .dominoShadow');
  shadowEls.forEach(el => {
    if(el._by2Hidden){
      el._by2Hidden = false;
      el.style.display = '';
    }
  });
}

function renderBoneyard2(){
  const canvas = document.getElementById('boneyard2Canvas');
  const container = document.getElementById('boneyard2Container');
  if(!canvas || !container) return;

  const dpr = window.devicePixelRatio || 1;

  // Hardcoded settings
  const gap = BY2_GAP;
  const handInnerSize = BY2_INNER_SIZE;
  const handInnerRadius = BY2_INNER_RADIUS;
  const handOuterSize = BY2_OUTER_SIZE;
  const handOuterRadius = BY2_OUTER_RADIUS;
  const handInnerColor = BY2_INNER_COLOR;
  const handOuterColor = BY2_OUTER_COLOR;
  const handOpacity = BY2_PLAYED_OPACITY;

  // Use trick history grid positions to derive tile sizes and spacing
  // This ensures the boneyard perfectly overlays the trick history area
  const tableEl = document.getElementById('tableMain');
  if(!tableEl) return;
  const tableW = tableEl.offsetWidth;
  const tableH = tableEl.offsetHeight;
  const containerW = container.offsetWidth;
  if(containerW <= 0) return;

  // Trick history normalized positions — same for both modes
  const thColXN = [0.106, 0.2171, 0.3282, 0.4393, 0.5504, 0.6616, 0.7727, 0.8838];
  const thRowYN = GAME_MODE === 'T42'
    ? [0.2281, 0.2592, 0.2904, 0.3215]
    : [0.197, 0.2281, 0.2592, 0.2904, 0.3215, 0.3526];

  const colSpacing = (thColXN[thColXN.length-1] - thColXN[0]) / (thColXN.length-1) * tableW;
  const rowSpacing = (thRowYN[thRowYN.length-1] - thRowYN[0]) / Math.max(1, thRowYN.length-1) * tableH;

  // Trick history tile size: scale 0.393 of 56x112, rotated 270° (landscape)
  // Rendered size: ~44px wide x ~22px tall
  const thScale = 0.393;
  const cellW = Math.round(BASE_H * thScale);  // 112 * 0.393 ≈ 44 (landscape width)
  const cellH = Math.round(BASE_W * thScale);   // 56 * 0.393 ≈ 22 (landscape height)

  // Container is positioned inside tableMain
  // Canvas drawing coords are relative to the container's initial position (5%/16%)
  // When sliders move the container, the canvas moves with it (child element)
  const containerLeft = tableW * 0.05;  // initial container position
  const containerTop = 0;

  // Convert trick history center positions to container-relative positions
  const col0X = thColXN[0] * tableW - containerLeft;

  // Container top = 16% of tableMain (initial position)
  const containerTopOffset = tableH * 0.16;
  const row0Y = thRowYN[0] * tableH - containerTopOffset;

  // Now we know: boneyard rows 0-5 align with trick history rows 0-5
  // Rows 6-7 extend below with same rowSpacing
  const _by2MaxPip = session.game.max_pip;
  const _by2IsMoon = (GAME_MODE === 'MOON');
  // V10_105: Check if tile is excluded from Moon deck (blanks except double-blank)
  function _by2MoonExcluded(a, b){ return _by2IsMoon && ((a === 0 || b === 0) && !(a === 0 && b === 0)); }
  const maxCols = _by2MaxPip + 1;
  const numRows = _by2MaxPip + 1;

  // Canvas height needs to accommodate all 8 rows
  const lastRowY = row0Y + (numRows - 1) * rowSpacing + cellH / 2;
  const canvasH = Math.max(lastRowY + gap + cellH, (numRows - 1) * rowSpacing + cellH + row0Y + 4);

  canvas.width = Math.round(containerW * dpr);
  canvas.height = Math.round(canvasH * dpr);
  canvas.style.width = containerW + 'px';
  canvas.style.height = canvasH + 'px';

  const ctx = canvas.getContext('2d');
  ctx.scale(dpr, dpr);

  // Clear (transparent — natural green shows through)
  ctx.clearRect(0, 0, containerW, canvasH);

  // Build the grid: dynamic based on game mode (double-7 for TN51, double-6 for T42)
  const rows = [];
  const doublesRow = [];
  for(let pip = _by2MaxPip; pip >= 0; pip--) doublesRow.push([pip, pip]);
  rows.push(doublesRow);
  for(let suit = _by2MaxPip; suit >= 1; suit--){
    const row = [];
    for(let low = suit - 1; low >= 0; low--) row.push([suit, low]);
    rows.push(row);
  }

  // Determine played tiles and trump state
  const playedTiles = new Set();
  if(session && session.game){
    const _teamCount = GAME_MODE === 'MOON' ? 3 : 2;
    for(let team = 0; team < _teamCount; team++){
      for(const record of (session.game.tricks_team[team] || [])){
        for(let seat = 0; seat < record.length; seat++){
          const t = record[seat];
          if(t) playedTiles.add(Math.min(t[0],t[1]) + ',' + Math.max(t[0],t[1]));
        }
      }
    }
    // Moon: also mark widow discard as played/known
    if(GAME_MODE === 'MOON' && session.moon_widow && session.phase !== 'MOON_WIDOW' && session.phase !== 'NEED_BID'){
      const w = session.moon_widow;
      playedTiles.add(Math.min(w[0],w[1]) + ',' + Math.max(w[0],w[1]));
    }
    for(const play of (session.game.current_trick || [])){
      if(Array.isArray(play)){
        const t = play[1];
        if(t) playedTiles.add(Math.min(t[0],t[1]) + ',' + Math.max(t[0],t[1]));
      }
    }
  }
  const isTilePlayed = (a, b) => playedTiles.has(Math.min(a,b) + ',' + Math.max(a,b));
  const isTrumpTile = (tile) => {
    if(!session || !session.game) return false;
    return session.game._is_trump_tile(tile);
  };

  // Build hand tile set (PP-aware)
  const handSeat = getLocalSeat();
  const handTiles = new Set();
  if(session && session.game && session.game.hands[handSeat]){
    for(const t of session.game.hands[handSeat]){
      if(t) handTiles.add(Math.min(t[0],t[1]) + ',' + Math.max(t[0],t[1]));
    }
  }
  const isTileInHand = (a, b) => handTiles.has(Math.min(a,b) + ',' + Math.max(a,b));

  // Apply gap as additional spacing between tiles (added to base grid spacing)
  // gap=0 means tiles use exact trick history positions, gap>0 adds extra padding
  // We reduce cellW/cellH to create visual spacing while keeping positions the same
  const effectiveCellW = Math.max(10, cellW - gap);
  const effectiveCellH = Math.max(5, cellH - gap);

  // Draw each tile — landscape orientation (rotated 90° CCW from portrait)
  for(let rowIdx = 0; rowIdx < rows.length; rowIdx++){
    const row = rows[rowIdx];
    const colOffset = maxCols - row.length;  // right-align within grid

    for(let colIdx = 0; colIdx < row.length; colIdx++){
      const tile = row[colIdx];
      const col = colOffset + colIdx;

      // Position: center of this cell aligns with trick history grid position
      const centerX = col0X + col * colSpacing;
      const centerY = row0Y + rowIdx * rowSpacing;
      const x = centerX - effectiveCellW / 2;
      const y = centerY - effectiveCellH / 2;

      const played = isTilePlayed(tile[0], tile[1]);
      const trump = isTrumpTile(tile);
      const inHand = isTileInHand(tile[0], tile[1]);
      const moonExcluded = _by2MoonExcluded(tile[0], tile[1]);

      ctx.save();
      ctx.translate(x, y);

      // Set opacity: Moon-excluded tiles very dim, played tiles ghost, hand tiles full
      if(moonExcluded){
        ctx.globalAlpha = 0.15;  // V10_105: Very dim for tiles not in Moon deck
      } else if(played){
        ctx.globalAlpha = handOpacity;  // "handOpacity" slider now controls played tile opacity
      }

      // Draw the domino face rotated 90° CCW
      // Portrait canvas (effectiveCellH wide x effectiveCellW tall), draw face, then rotate
      const portraitW = effectiveCellH;
      const portraitH = effectiveCellW;

      const tileCanvas = document.createElement('canvas');
      tileCanvas.width = Math.round(portraitW * dpr);
      tileCanvas.height = Math.round(portraitH * dpr);
      const tctx = tileCanvas.getContext('2d');
      tctx.scale(dpr, dpr);
      drawFace(tctx, tile, portraitW, portraitH, trump, !played);

      // Rotate 90° CCW around cell center and draw
      ctx.translate(effectiveCellW / 2, effectiveCellH / 2);
      ctx.rotate(-Math.PI / 2);
      ctx.drawImage(tileCanvas, -portraitW / 2, -portraitH / 2, portraitW, portraitH);

      // Reset transform to cell origin for borders
      ctx.setTransform(dpr, 0, 0, dpr, x * dpr, y * dpr);

      // Reset alpha for borders
      ctx.globalAlpha = 1.0;

      // Border for tiles in player's hand
      if(inHand){
        if(handOuterSize > 0){
          ctx.strokeStyle = handOuterColor;
          ctx.lineWidth = handOuterSize;
          const ohw = handOuterSize / 2;
          roundRectPath(ctx, -ohw, -ohw, effectiveCellW + handOuterSize, effectiveCellH + handOuterSize, handOuterRadius);
          ctx.stroke();
        }
        if(handInnerSize > 0){
          ctx.strokeStyle = handInnerColor;
          ctx.lineWidth = handInnerSize;
          const ihw = handInnerSize / 2;
          roundRectPath(ctx, ihw, ihw, effectiveCellW - handInnerSize, effectiveCellH - handInnerSize, handInnerRadius);
          ctx.stroke();
        }
      }

      ctx.restore();
    }
  }
}

// Toggle button handler
document.getElementById('boneyard2Toggle').addEventListener('click', toggleBoneyard2);
document.getElementById('boneyard2Toggle').addEventListener('touchstart', (e) => {
  e.preventDefault();
  toggleBoneyard2();
}, { passive: false });

// Re-render on resize if visible
window.addEventListener('resize', () => {
  if(boneyard2Visible) renderBoneyard2();
});

// ============================================================
// END BONEYARD 2
// ============================================================

function renderBoneyard(){
  const canvas = document.getElementById('bonesCanvas');
  if(!canvas) return;

  const dpr = window.devicePixelRatio || 1;

  // Tile dimensions — shrunk ~15% from original 48x96
  const tileW = 40;
  const tileH = 80;
  // Read adjustable style settings (or defaults)
  const gap = window._bonesGap || 3;
  const handInnerSize = window._bonesInnerSize != null ? window._bonesInnerSize : 1;
  const handInnerRadius = window._bonesInnerRadius != null ? window._bonesInnerRadius : 8;
  const handOuterSize = window._bonesOuterSize != null ? window._bonesOuterSize : 3;
  const handOuterRadius = window._bonesOuterRadius != null ? window._bonesOuterRadius : 11;
  const handInnerColor = window._bonesColor || '#beb6ab';
  const handOuterColor = window._bonesOuterColor || '#00deff';

  // Layout: Doubles on TOP ROW, each suit in its OWN ROW below.
  // Right-aligned staircase (tiles pushed to the right).
  //
  // Row 0: 7-7  6-6  5-5  4-4  3-3  2-2  1-1  0-0   (all doubles)
  // Row 1: 7-6  7-5  7-4  7-3  7-2  7-1  7-0         (7-suit, 7 tiles)
  // Row 2: 6-5  6-4  6-3  6-2  6-1  6-0               (6-suit, 6 tiles)
  // Row 3: 5-4  5-3  5-2  5-1  5-0                     (5-suit, 5 tiles)
  // Row 4: 4-3  4-2  4-1  4-0                          (4-suit, 4 tiles)
  // Row 5: 3-2  3-1  3-0                               (3-suit, 3 tiles)
  // Row 6: 2-1  2-0                                     (2-suit, 2 tiles)
  // Row 7: 1-0                                          (1-suit, 1 tile)

  // Build the grid: rows[rowIdx] = array of [high, low] tiles
  const rows = [];
  // V10_105: Fix #4 — dynamic tile set based on game mode
  const _boneMaxPip = session ? session.game.max_pip : 7;
  const _boneMoon = (GAME_MODE === 'MOON');
  // Row 0: doubles
  const doublesRow = [];
  for(let pip = _boneMaxPip; pip >= 0; pip--){
    doublesRow.push([pip, pip]);
  }
  rows.push(doublesRow);

  // Rows 1+: each row is one suit (non-double tiles only)
  for(let suit = _boneMaxPip; suit >= 1; suit--){
    const row = [];
    for(let low = suit - 1; low >= 0; low--){
      row.push([suit, low]);
    }
    rows.push(row);
  }

  // Calculate canvas size
  const maxCols = _boneMaxPip + 1;
  const numRows = _boneMaxPip + 1;
  const canvasW = maxCols * (tileW + gap) + gap;
  const canvasH = numRows * (tileH + gap) + gap;

  canvas.width = canvasW * dpr;
  canvas.height = canvasH * dpr;
  canvas.style.width = canvasW + 'px';
  canvas.style.height = canvasH + 'px';

  const ctx = canvas.getContext('2d');
  ctx.scale(dpr, dpr);

  // Background (dark green felt)
  ctx.fillStyle = 'rgba(0,40,0,0.6)';
  ctx.fillRect(0, 0, canvasW, canvasH);

  // Determine played tiles and trump state
  const playedTiles = new Set();

  // Build played set from tricks_team
  if(session && session.game){
    for(let team = 0; team < (gameState.tricks_team || []).length; team++){
      for(const record of (session.game.tricks_team[team] || [])){
        for(let seat = 0; seat < record.length; seat++){
          const t = record[seat];
          if(t) playedTiles.add(Math.min(t[0],t[1]) + ',' + Math.max(t[0],t[1]));
        }
      }
    }
    // Also add tiles currently in play (current trick)
    for(const play of (session.game.current_trick || [])){
      if(Array.isArray(play)){
        const t = play[1];
        if(t) playedTiles.add(Math.min(t[0],t[1]) + ',' + Math.max(t[0],t[1]));
      }
    }
  }

  const isTilePlayedBones = (a, b) => playedTiles.has(Math.min(a,b) + ',' + Math.max(a,b));

  const isTrumpTile = (tile) => {
    if(!session || !session.game) return false;
    return session.game._is_trump_tile(tile);
  };

  // Build set of tiles in current player's hand (PP-aware)
  const handSeat = getLocalSeat();
  const handTiles = new Set();
  if(session && session.game && session.game.hands[handSeat]){
    for(const t of session.game.hands[handSeat]){
      if(t) handTiles.add(Math.min(t[0],t[1]) + ',' + Math.max(t[0],t[1]));
    }
  }
  const isTileInHand = (a, b) => handTiles.has(Math.min(a,b) + ',' + Math.max(a,b));

  // Draw each tile — ROW layout, RIGHT-ALIGNED
  // Row 0 (doubles) = 8 tiles, rows 1-7 have decreasing count.
  // Right-align: offset each row so its last tile aligns with column 7.
  for(let rowIdx = 0; rowIdx < rows.length; rowIdx++){
    const row = rows[rowIdx];
    const colOffset = maxCols - row.length;  // push right

    for(let colIdx = 0; colIdx < row.length; colIdx++){
      const tile = row[colIdx];
      const col = colOffset + colIdx;
      const x = col * (tileW + gap) + gap;
      const y = rowIdx * (tileH + gap) + gap;

      const played = isTilePlayedBones(tile[0], tile[1]);
      const trump = isTrumpTile(tile);
      const inHand = isTileInHand(tile[0], tile[1]);

      // Save context and draw the tile
      ctx.save();
      ctx.translate(x, y);

      // Create a small offscreen canvas for this tile to reuse drawFace
      const tileCanvas = document.createElement('canvas');
      tileCanvas.width = Math.round(tileW * dpr);
      tileCanvas.height = Math.round(tileH * dpr);
      const tctx = tileCanvas.getContext('2d');
      tctx.scale(dpr, dpr);
      drawFace(tctx, tile, tileW, tileH, trump, !played);

      // Draw the tile canvas onto the main canvas
      ctx.drawImage(tileCanvas, 0, 0, tileW, tileH);

      // V10_105: Fix #4 — Dim tiles not in Moon deck (blanks except double-blank)
      if(_boneMoon && ((tile[0] === 0 || tile[1] === 0) && !(tile[0] === 0 && tile[1] === 0))){
        ctx.fillStyle = 'rgba(0,0,0,0.7)';
        ctx.fillRect(0, 0, tileW, tileH);
      }

      // Border for tiles in player's hand (independent inner + outer size/color/radius)
      if(inHand){
        // Outer border (drawn outside the tile edges)
        if(handOuterSize > 0){
          ctx.strokeStyle = handOuterColor;
          ctx.lineWidth = handOuterSize;
          const ohw = handOuterSize / 2;
          roundRectPath(ctx, -ohw, -ohw, tileW + handOuterSize, tileH + handOuterSize, handOuterRadius);
          ctx.stroke();
        }
        // Inner border
        if(handInnerSize > 0){
          ctx.strokeStyle = handInnerColor;
          ctx.lineWidth = handInnerSize;
          const ihw = handInnerSize / 2;
          roundRectPath(ctx, ihw, ihw, tileW - handInnerSize, tileH - handInnerSize, handInnerRadius);
          ctx.stroke();
        }
      }

      ctx.restore();
    }
  }
}

document.getElementById('menuHint').addEventListener('click', () => {
  HINT_MODE = !HINT_MODE;
  document.getElementById('menuHint').textContent = `Hint: ${HINT_MODE ? 'ON' : 'OFF'}`;
  document.getElementById('settingsMenu').classList.remove('open');
  // If hint was just enabled and it's player's turn, show hint immediately
  if(HINT_MODE && waitingForPlayer1 && session.phase === PHASE_PLAYING && session.game.current_player === 0){
    showHint();
  } else if(!HINT_MODE){
    clearHint();
  }
});



// --- Multiplayer Event Listeners ---
// V12.9.2: Multiplayer removed from settings menu, guard handler
if(document.getElementById('menuMultiplayer')) document.getElementById('menuMultiplayer').addEventListener('click', () => {
  document.getElementById('settingsMenu').classList.remove('open');
  mpBuildModeSelector();
  document.getElementById('mpRoomSection').style.display = 'none';
  document.getElementById('mpObserverSection').style.display = 'none';
  document.getElementById('mpRefreshToggleSection').style.display = 'none';
  document.getElementById('mpBackdrop').style.display = 'flex';
  // V10_104: Connect to relay early for room status
  mpRequestRoomStatus();
});

document.getElementById('mpCloseBtn').addEventListener('click', () => {
  document.getElementById('mpBackdrop').style.display = 'none';
  // V12.10.3: Return to home menu instead of showing empty game board
  if(typeof showStartScreen === 'function') showStartScreen();
});

// Show/hide refresh section when MP modal opens
const _mpBackdropOrig = document.getElementById('mpBackdrop');
if (_mpBackdropOrig) {
  const _origDisplay = Object.getOwnPropertyDescriptor(HTMLElement.prototype, 'style');
  // Use MutationObserver to detect when modal becomes visible
  new MutationObserver(() => {
    const disp = _mpBackdropOrig.style.display;
    if (disp === 'flex' || disp === 'block' || disp === '') {
      const rfSec = document.getElementById('mpRefreshSection');
      if (rfSec && mpIsHost && mpGameStarted) rfSec.style.display = 'block';
      else if (rfSec) rfSec.style.display = 'none';
    }
  }).observe(_mpBackdropOrig, { attributes: true, attributeFilter: ['style'] });
}

// V10_119: Wire up auto-refresh disable toggle
document.getElementById('mpDisableRefreshChk').addEventListener('change', function() {
  _staleRefreshDisabled = this.checked;
  console.log('[MP] Auto-refresh disabled:', _staleRefreshDisabled);
});

document.getElementById('mpConnect').addEventListener('click', () => {
  if (!mpRoom) {
    mpUpdateStatus('Please select a room first', '#f59e0b');
    return;
  }
  // V10_104: Check observer mode toggle
  const obsChk = document.getElementById('mpObserverChk');
  if (obsChk && obsChk.checked) {
    mpConnectAsObserver(mpRoom);
    return;
  }
  // V10_119: Read auto-refresh toggle at connect time
  const drChk = document.getElementById('mpDisableRefreshChk');
  if (drChk) _staleRefreshDisabled = drChk.checked;
  // Load saved session for reconnection
  const saved = mpLoadSession(mpRoom);
  if (saved) {
    mpPlayerId = saved.playerId;
  }
  mpConnect(mpRoom);
});

document.getElementById('mpDisconnect').addEventListener('click', () => {
  // Mark host state as completed on intentional disconnect
  if (mpIsHost) mpMarkHostStateCompleted();
  mpDisconnect();
});

document.getElementById('mpStartGame').addEventListener('click', () => {
  // Reset tally for fresh MP game
  mpGamesWon = 0;
  mpGamesLost = 0;
  mpGamesPlayed = 0;
  if (!mpIsHost) return;
  mpGameStarted = true;
  MULTIPLAYER_MODE = true;

  // Disable Pass & Play if it was on
  PASS_AND_PLAY_MODE = false;
  document.getElementById('menuPassPlay').textContent = 'Pass & Play: OFF';

  // Apply layout settings — ensures sizes/positions are loaded from localStorage
  // even when starting MP directly from start screen without going through New Game
  if (GAME_MODE === 'MOON') {
    applyMoonSettings();
  } else if (GAME_MODE === 'T42') {
    applyT42Settings();
  } else {
    applyTn51Settings();
  }

  // Hide any leftover bid overlay from a previous single-player game
  document.getElementById('bidBackdrop').style.display = 'none';

  // V10_109: Read house rules from MP settings panel
  const _mpCFD = document.getElementById('mpChkCallForDouble');
  const _mpNDec = document.getElementById('mpChkNelloDeclare');
  const _mpNRes = document.getElementById('mpChkNelloRestrict');
  if(_mpCFD) callForDoubleEnabled = _mpCFD.checked;
  if(_mpNDec) nelloDeclareMode = _mpNDec.checked;
  if(_mpNRes) nelloRestrictFirst = _mpNRes.checked;
  // Get nello doubles mode from MP panel
  const _mpNDB = document.querySelector('.mpNelloBtn.mpNelloBtnSelected');
  if(_mpNDB) nelloDoublesMode = _mpNDB.dataset.nello;
  // Get doubles follow me mode from MP panel
  const _mpDFB = document.querySelector('.mpDfmBtn.mpDfmBtnSelected');
  if(_mpDFB) doublesFollowMe = _mpDFB.dataset.dfm;

  // Send start game signal with marks and house rules
  mpSendMove({
    action: 'start_game', gameMode: GAME_MODE, marksToWin: mpMarksToWin, version: MP_VERSION,
    houseRules: {
      callForDouble: callForDoubleEnabled,
      nelloDeclare: nelloDeclareMode,
      nelloRestrictFirst: nelloRestrictFirst,
      nelloDoublesMode: nelloDoublesMode,
      doublesFollowMe: doublesFollowMe
    }
  });

  // Close modal
  document.getElementById('mpBackdrop').style.display = 'none';

  // Hide start screen
  const startScreen = document.getElementById('startScreenBackdrop');
  if (startScreen) startScreen.style.display = 'none';

  // Start the game - host deals
  mpHostDeal();
});

// MP marks selection buttons
document.querySelectorAll('.mpMarksBtn').forEach(btn => {
  btn.addEventListener('click', () => {
    mpMarksToWin = parseInt(btn.dataset.marks);

  // V10_109: MP house rules — wire up checkboxes and nello buttons
  // Initialize from current settings
  var _mpCFD = document.getElementById('mpChkCallForDouble');
  var _mpNDec = document.getElementById('mpChkNelloDeclare');
  var _mpNRes = document.getElementById('mpChkNelloRestrict');
  if(_mpCFD) _mpCFD.checked = callForDoubleEnabled;
  if(_mpNDec) _mpNDec.checked = nelloDeclareMode;
  if(_mpNRes) _mpNRes.checked = nelloRestrictFirst;
  // Nello doubles buttons
  document.querySelectorAll('.mpNelloBtn').forEach(function(nb){
    if(nb.dataset.nello === nelloDoublesMode){
      nb.classList.add('mpNelloBtnSelected');
      nb.style.background = 'rgba(96,165,250,0.2)';
      nb.style.border = '1px solid #60a5fa';
    }
    nb.addEventListener('click', function(){
      if(!mpIsHost) return; // guests can't change
      document.querySelectorAll('.mpNelloBtn').forEach(function(b){
        b.classList.remove('mpNelloBtnSelected');
        b.style.background = 'rgba(255,255,255,0.05)';
        b.style.border = '1px solid rgba(255,255,255,0.15)';
      });
      nb.classList.add('mpNelloBtnSelected');
      nb.style.background = 'rgba(96,165,250,0.2)';
      nb.style.border = '1px solid #60a5fa';
    });
  });
  // Doubles Follow Me buttons (MP)
  document.querySelectorAll('.mpDfmBtn').forEach(function(db){
    if(db.dataset.dfm === doublesFollowMe){
      db.classList.add('mpDfmBtnSelected');
      db.style.background = 'rgba(96,165,250,0.2)';
      db.style.border = '1px solid #60a5fa';
    }
    db.addEventListener('click', function(){
      if(!mpIsHost) return;
      document.querySelectorAll('.mpDfmBtn').forEach(function(b){
        b.classList.remove('mpDfmBtnSelected');
        b.style.background = 'rgba(255,255,255,0.05)';
        b.style.border = '1px solid rgba(255,255,255,0.15)';
      });
      db.classList.add('mpDfmBtnSelected');
      db.style.background = 'rgba(96,165,250,0.2)';
      db.style.border = '1px solid #60a5fa';
    });
  });
    document.querySelectorAll('.mpMarksBtn').forEach(b => {
      b.style.borderColor = 'rgba(255,255,255,0.15)';
      b.style.background = 'rgba(255,255,255,0.05)';
      b.classList.remove('mpMarksSelected');
    });
    btn.style.borderColor = '#60a5fa';
    btn.style.background = 'rgba(96,165,250,0.2)';
    btn.classList.add('mpMarksSelected');
  });
});

document.getElementById('menuAbout').addEventListener('click', () => {
  document.getElementById('settingsMenu').classList.remove('open');
  document.getElementById('aboutVersion').textContent = (typeof GAME_VERSION !== 'undefined') ? GAME_VERSION : (typeof MP_VERSION !== 'undefined') ? MP_VERSION : '';
  document.getElementById('aboutBackdrop').style.display = 'flex';
});
document.getElementById('menuClaudeChat').addEventListener('click', () => {
  document.getElementById('settingsMenu').classList.remove('open');
  claudeChatToggle();
});
document.getElementById('aboutCloseBtn').addEventListener('click', () => {
  document.getElementById('aboutBackdrop').style.display = 'none';
});

  // V10_111: Nello 2x setting removed

  // Nello declare checkbox
  var chkNelloDeclare = document.getElementById('chkNelloDeclare');
  if(chkNelloDeclare){
    chkNelloDeclare.checked = nelloDeclareMode;
    chkNelloDeclare.addEventListener('change', function(){
      nelloDeclareMode = this.checked;
      // V10_122e: Wrap localStorage in try-catch for iOS Safari private mode
      try {
        localStorage.setItem('tn51_nello_declare', String(nelloDeclareMode));
      } catch(e) {
        console.warn('[iOS] localStorage write error:', e);
      }
    });
  }
  // V10_109: Nello restrict first checkbox
  var chkNelloRestrict = document.getElementById('chkNelloRestrict');
  if(chkNelloRestrict){
    chkNelloRestrict.checked = nelloRestrictFirst;
    chkNelloRestrict.addEventListener('change', function(){
      nelloRestrictFirst = this.checked;
      // V10_122e: Wrap localStorage in try-catch for iOS Safari private mode
      try {
        localStorage.setItem('tn51_nello_restrict_first', String(nelloRestrictFirst));
      } catch(e) {
        console.warn('[iOS] localStorage write error:', e);
      }
    });
  }

document.getElementById('menuChangeName').addEventListener('click', () => {
  document.getElementById('settingsMenu').classList.remove('open');
  promptForName();
});

// V10_113: Export MP diagnostic log
document.getElementById('menuMPLog').addEventListener('click', () => {
  document.getElementById('settingsMenu').classList.remove('open');
  mpExportDiagLog();
});

document.getElementById('menuHome').addEventListener('click', () => {
  document.getElementById('settingsMenu').classList.remove('open');
  // TX42-Client: Disconnect and show lobby
  if (mpSocket && mpSocket.readyState <= 1) {
    mpGameStarted = false;
    mpSocket.close();
  }
  mpGameStarted = false;
  mpSeat = -1;
  mpIsHost = false;
  mpPlayers = {};
  mpPlayerIds = {};
  MULTIPLAYER_MODE = true;
  // Hide any overlays
  if(typeof hideGameEndSummary === 'function') hideGameEndSummary();
  if(typeof hideRoundEndSummary === 'function') hideRoundEndSummary();
  document.getElementById('bidBackdrop').style.display = 'none';
  document.getElementById('trumpBackdrop').style.display = 'none';
  // Show multiplayer lobby
  document.getElementById('mpBackdrop').style.display = 'flex';
  if(typeof mpBuildRoomButtons === 'function') mpBuildRoomButtons();
});

document.getElementById('menuRestart').addEventListener('click', () => {
  document.getElementById('settingsMenu').classList.remove('open');
  SFX.resumeBgmAfterResult();
  session.team_marks = [0, 0];
  localStorage.removeItem('tn51_saved_game');  // Clear saved game on restart
  startNewHand();
});


// ============================================================
// Stubs for replay.js (lazy-loaded)
// ============================================================
// Replay/save stubs — lazy loaded from replay.js
function saveGameState() { /* no-op */ }
function loadSavedGame() { return null; }
function resumeGameFromSave(s) { /* no-op */ }
function hasSavedGame() { return false; }
function clearSavedGame() { try { localStorage.removeItem("tn51_saved_game"); } catch(e){} }
function checkForSavedGame() { /* no-op */ }
function autoSave() { /* no-op */ }
function loadNotes() { return ""; }
function saveNotes(t) { try { localStorage.setItem("tn51_notes", t); } catch(e){} }
function getSavedHands() { return []; }
function saveHandForReplay() { /* no-op */ }
function replayHand(i) { _lazyLoad("./assets/js/replay.js", function(){ replayHand(i); }); }
function showReplayDialog() { _lazyLoad("./assets/js/replay.js", function(){ showReplayDialog(); }); }



// ============================================================
// Game Settings menu toggle (moved from dev-tools.js — core UI)
// ============================================================
(function(){
  var settingsMenu = document.getElementById('settingsMenu');
  var gsPanel = document.getElementById('soundSettingsPanel');
  var gsBtn = document.getElementById('menuSoundSettings');

  function getMainItems(){
    return Array.from(settingsMenu.children).filter(function(el){
      return el !== gsPanel;
    });
  }

  var gsViewOpen = false;

  var backBtn = document.createElement('div');
  backBtn.className = 'settingsItem';
  backBtn.style.cssText = 'padding:8px 16px;font-weight:bold;color:#60a5fa;';
  backBtn.textContent = '← Back';
  backBtn.style.display = 'none';
  settingsMenu.insertBefore(backBtn, settingsMenu.firstChild);

  gsBtn.addEventListener('click', function(e){
    e.stopPropagation();
    if(gsViewOpen) return;
    gsViewOpen = true;
    getMainItems().forEach(function(el){ el._gsWasDisplay = el.style.display; el.style.display = 'none'; });
    backBtn.style.display = 'block';
    gsPanel.style.display = 'block';
  });

  backBtn.addEventListener('click', function(e){
    e.stopPropagation();
    gsViewOpen = false;
    getMainItems().forEach(function(el){ el.style.display = el._gsWasDisplay || ''; });
    backBtn.style.display = 'none';
    gsPanel.style.display = 'none';
  });

  var observer = new MutationObserver(function(muts){
    muts.forEach(function(m){
      if(m.type === 'attributes' && m.attributeName === 'class'){
        if(!settingsMenu.classList.contains('open') && gsViewOpen){
          gsViewOpen = false;
          getMainItems().forEach(function(el){ el.style.display = el._gsWasDisplay || ''; });
          backBtn.style.display = 'none';
          gsPanel.style.display = 'none';
        }
      }
    });
  });
  observer.observe(settingsMenu, { attributes: true });
})();


// ============================================================
// Settings UI handlers (moved from dev-tools.js — core UI)
// ============================================================
// V12.9.2: Letterbox toggle
(function(){
  var letterboxOn = true; // default ON
  try {
    var saved = localStorage.getItem('tn51_letterbox');
    if(saved === 'off') letterboxOn = false;
  } catch(e){}

  function applyLetterbox(){
    var gw = document.getElementById('gameWrapper');
    if(!gw) return;
    if(letterboxOn){
      gw.style.width = '';
      gw.style.height = '';
    } else {
      gw.style.width = '100vw';
      gw.style.height = '100vh';
    }
  }

  function updateToggleUI(){
    var knob = document.getElementById('letterboxKnob');
    var track = document.getElementById('letterboxToggle');
    var label = document.getElementById('letterboxLabel');
    if(knob){ knob.style.left = letterboxOn ? '20px' : '2px'; }
    if(track){ track.style.background = letterboxOn ? 'rgba(34,197,94,0.8)' : 'rgba(255,255,255,0.2)'; }
    if(label){ label.textContent = letterboxOn ? 'ON' : 'OFF'; }
  }

  applyLetterbox();
  // UI update deferred until DOM ready
  setTimeout(updateToggleUI, 100);

  document.addEventListener('click', function(e){
    if(e.target.closest('#letterboxToggle')){
      letterboxOn = !letterboxOn;
      try { localStorage.setItem('tn51_letterbox', letterboxOn ? 'on' : 'off'); } catch(e){}
      applyLetterbox();
      updateToggleUI();
      // Trigger resize to recalculate layout
      window.dispatchEvent(new Event('resize'));
    }
  });

  window._letterboxEnabled = function(){ return letterboxOn; };
})();


// V12.10.27c: Custom Aspect Ratio slider
(function(){
  var AR_DEFAULT_W = 414;
  var AR_DEFAULT_H = 896;
  var arEnabled = false;
  var arSliderVal = 50; // Middle position = ~1:2.2 (default)

  // Load saved preference
  try {
    var saved = JSON.parse(localStorage.getItem('tn51_custom_ar'));
    if(saved){
      arEnabled = !!saved.enabled;
      if(typeof saved.slider === 'number') arSliderVal = saved.slider;
    }
  } catch(e){}

  // Map slider (0-200) to aspect ratio (w:h)
  // 0 = 1:3, 100 = 1:1, 200 = 3:1
  // Using exponential mapping: ratio = (1/3) * 3^(slider/100)
  function sliderToRatio(val){
    return (1/3) * Math.pow(3, val / 100);
  }

  function ratioToLabel(ratio){
    if(ratio >= 1){
      // Show as N:1
      var n = ratio;
      if(Math.abs(n - Math.round(n)) < 0.05) return Math.round(n) + ':1';
      return n.toFixed(1) + ':1';
    } else {
      // Show as 1:N
      var n = 1 / ratio;
      if(Math.abs(n - Math.round(n)) < 0.05) return '1:' + Math.round(n);
      return '1:' + n.toFixed(1);
    }
  }

  function ratioToSlider(ratio){
    // Inverse of sliderToRatio: slider = 100 * log(ratio * 3) / log(3)
    return Math.round(100 * Math.log(ratio * 3) / Math.log(3));
  }

  function applyAR(){
    if(!arEnabled){
      // Reset to default
      if(typeof window.setGameAspectRatio === 'function'){
        window.setGameAspectRatio(AR_DEFAULT_W, AR_DEFAULT_H);
      }
      return;
    }
    var ratio = sliderToRatio(arSliderVal);
    // Convert ratio to w:h pixels (use 1000 as base height)
    var h = 1000;
    var w = Math.round(h * ratio);
    if(typeof window.setGameAspectRatio === 'function'){
      window.setGameAspectRatio(w, h);
    }
  }

  function updateUI(){
    var check = document.getElementById('arCustomCheck');
    var slider = document.getElementById('arSlider');
    var label = document.getElementById('arRatioLabel');
    if(!check || !slider || !label) return;

    check.checked = arEnabled;
    slider.disabled = !arEnabled;
    slider.style.opacity = arEnabled ? '1' : '0.3';
    slider.style.cursor = arEnabled ? 'pointer' : 'not-allowed';
    slider.value = arSliderVal;

    var ratio = sliderToRatio(arSliderVal);
    label.textContent = ratioToLabel(ratio);
    label.style.color = arEnabled ? '#3b82f6' : '#666';
  }

  function save(){
    try {
      localStorage.setItem('tn51_custom_ar', JSON.stringify({
        enabled: arEnabled,
        slider: arSliderVal
      }));
    } catch(e){}
  }

  // Initialize: compute slider position from current AR
  if(!arEnabled){
    // Set slider to match default AR for visual reference
    var defaultRatio = AR_DEFAULT_W / AR_DEFAULT_H;
    arSliderVal = ratioToSlider(defaultRatio);
  }

  // Apply on load
  setTimeout(function(){
    applyAR();
    updateUI();
  }, 200);

  // Checkbox handler
  document.addEventListener('change', function(e){
    if(e.target && e.target.id === 'arCustomCheck'){
      arEnabled = e.target.checked;
      applyAR();
      updateUI();
      save();
      window.dispatchEvent(new Event('resize'));
    }
  });

  // Slider handler
  document.addEventListener('input', function(e){
    if(e.target && e.target.id === 'arSlider'){
      arSliderVal = parseInt(e.target.value);
      applyAR();
      // Update label only
      var label = document.getElementById('arRatioLabel');
      if(label){
        var ratio = sliderToRatio(arSliderVal);
        label.textContent = ratioToLabel(ratio);
      }
      save();
    }
  });

})();

// V12.9.2: Game Log toggle for multiplayer (default OFF)
(function(){
  var logsEnabled = false; // default OFF
  try {
    var saved = localStorage.getItem('tn51_mp_logs');
    if(saved === 'on') logsEnabled = true;
  } catch(e){}

  function updateLogMenuItems(){
    var inMP = (typeof mpSeat !== 'undefined' && mpSeat >= 0);
    var show = logsEnabled || !inMP; // Always show in single player, only show in MP if enabled
    var gameLog = document.getElementById('menuGameLog');
    var aiLog = document.getElementById('menuAdvancedLog');
    var mpLog = document.getElementById('menuMPLog');
    var mcItem = document.getElementById('menuMonteCarlo');
    if(gameLog) gameLog.style.display = show ? '' : 'none';
    if(aiLog) aiLog.style.display = show ? '' : 'none';
    if(mpLog) mpLog.style.display = (show && inMP) ? '' : 'none';
    if(mcItem) mcItem.style.display = show ? '' : 'none';
  }

  function updateToggleUI(){
    var knob = document.getElementById('mpLogKnob');
    var track = document.getElementById('mpLogToggle');
    var label = document.getElementById('mpLogLabel');
    if(knob){ knob.style.left = logsEnabled ? '20px' : '2px'; }
    if(track){ track.style.background = logsEnabled ? 'rgba(34,197,94,0.8)' : 'rgba(255,255,255,0.2)'; }
    if(label){ label.textContent = logsEnabled ? 'ON' : 'OFF'; }
  }

  setTimeout(function(){ updateToggleUI(); updateLogMenuItems(); }, 200);

  document.addEventListener('click', function(e){
    if(e.target.closest('#mpLogToggle')){
      logsEnabled = !logsEnabled;
      try { localStorage.setItem('tn51_mp_logs', logsEnabled ? 'on' : 'off'); } catch(e){}
      updateToggleUI();
      updateLogMenuItems();
    }
  });

  // Re-check whenever settings menu opens (MP state may have changed)
  var sm = document.getElementById('settingsMenu');
  if(sm){
    var obs = new MutationObserver(function(){ updateLogMenuItems(); });
    obs.observe(sm, { attributes: true });
  }

  window._mpLogsEnabled = function(){ return logsEnabled; };
})();

// SFX volume
// V12.6: Animation speed slider
(function(){
  var slider = document.getElementById('animSpeedSlider');
  var valSpan = document.getElementById('animSpeedVal');
  if(slider){
    var saved = localStorage.getItem('tn51_anim_speed');
    if(saved){ slider.value = parseInt(saved); if(valSpan) valSpan.textContent = saved + '%'; }
    slider.addEventListener('input', function(){
      var pct = parseInt(this.value);
      updateAnimSpeed(pct);
      if(valSpan) valSpan.textContent = pct + '%';
    });
  }
})();
document.getElementById('sfxVolume').addEventListener('input', function(){
  SFX.setSfxVolume(parseInt(this.value) / 100);
});
document.getElementById('sfxIcon').addEventListener('click', function(e){
  e.stopPropagation();
  SFX.toggleSfxMute();
});

// BGM volume
document.getElementById('bgmVolume').addEventListener('input', function(){
  SFX.setBgmVolume(parseInt(this.value) / 100);
});
document.getElementById('bgmIcon').addEventListener('click', function(e){
  e.stopPropagation();
  SFX.toggleBgmMute();
});

// Add faint click sound to all buttons
document.addEventListener('click', function(e){
  const el = e.target;
  if(el.tagName === 'BUTTON' || el.classList.contains('settingsItem') || el.classList.contains('glossBtn')){
    SFX.playButtonClick();
  }
});

document.getElementById('notesTextarea').addEventListener('input', () => {
  saveNotes(document.getElementById('notesTextarea').value);
});

// ============================================================
// Stubs for dev-tools.js (lazy-loaded)
// ============================================================
// Dev tools stubs — lazy loaded from dev-tools.js
function showCustomHandDialog() { _lazyLoad("./assets/js/dev-tools.js", function(){ showCustomHandDialog(); }); }
function closeCustomHandDialog() { /* no-op */ }
function parseCustomHandText(t) { return null; }
function startCustomHand() { _lazyLoad("./assets/js/dev-tools.js", function(){ startCustomHand(); }); }
// Game logging stubs — no-op until dev-tools loaded
var _gameLog = []; var _advLog = [];
var handNumber = 0; var trickNumber = 0; var currentTrickPlays = [];
var _gameLogTab = 'full'; var _advLogTab = 'full';
function logHandStart() {}
function logTrickStart() {}
function logPlay() {}
function logTrickEnd() {}
function logHandEnd() {}
function logEvent() {}
function saveGameLog() {}
function loadGameLog() { return []; }
function formatGameLog() { return ""; }
function formatAdvancedLog() { return ""; }
function refreshGameLogContent() {}
function refreshAdvLogContent() {}
// Device presets stub
var BUILTIN_DEVICE_PRESETS = {};

// ─── Menu item click handlers that need dev-tools.js ───
// These lazy-load dev-tools.js first, then open the panel.
// Once dev-tools loads it re-attaches its own richer handlers.
document.getElementById('menuGameLog').addEventListener('click', function() {
  document.getElementById('settingsMenu').classList.remove('open');
  _lazyLoad("./assets/js/dev-tools.js", function(){
    refreshGameLogContent();
    document.getElementById('gameLogBackdrop').style.display = 'flex';
  });
});

document.getElementById('menuAdvancedLog').addEventListener('click', function() {
  document.getElementById('settingsMenu').classList.remove('open');
  _lazyLoad("./assets/js/dev-tools.js", function(){
    refreshAdvLogContent();
    document.getElementById('advLogBackdrop').style.display = 'flex';
  });
});

// Close buttons — need to work even before dev-tools loads
document.getElementById('gameLogCloseBtn').addEventListener('click', function() {
  document.getElementById('gameLogBackdrop').style.display = 'none';
});
document.getElementById('advLogCloseBtn').addEventListener('click', function() {
  document.getElementById('advLogBackdrop').style.display = 'none';
});



// ============================================================================
// PASS & PLAY SETUP MODAL (V10_36)
// ============================================================================

function ppOpenSetupModal() {
  const grid = document.getElementById('ppPlayerGrid');
  grid.innerHTML = '';

  for (let seat = 0; seat < session.game.player_count; seat++) {
    const p = seat + 1;
    const team = seat % 2 === 0 ? 1 : 2;
    const teamColor = team === 1 ? '#3b82f6' : '#ef4444';
    const checked = ppHumanSeats.has(seat) ? 'checked' : '';

    const div = document.createElement('div');
    div.style.cssText = 'display:flex;align-items:center;gap:6px;padding:8px 10px;border-radius:8px;background:rgba(255,255,255,0.05);cursor:pointer;';
    div.innerHTML = `
      <input type="checkbox" id="ppSeat${seat}" ${checked} style="width:16px;height:16px;accent-color:${teamColor};">
      <span style="font-size:13px;color:${teamColor};font-weight:700;">P${p}</span>
      <span style="font-size:10px;color:#6b7280;">T${team}</span>
    `;
    div.addEventListener('click', (e) => {
      if (e.target.tagName !== 'INPUT') {
        const cb = div.querySelector('input');
        cb.checked = !cb.checked;
      }
    });
    grid.appendChild(div);
  }

  document.getElementById('ppPrivacy').checked = ppPrivacyMode;
  document.getElementById('ppBackdrop').style.display = 'flex';
}

function ppCloseSetupModal() {
  document.getElementById('ppBackdrop').style.display = 'none';
}

function ppActivateFromModal(startNew) {
  // Read selected human seats
  ppHumanSeats = new Set();
  for (let seat = 0; seat < session.game.player_count; seat++) {
    const cb = document.getElementById('ppSeat' + seat);
    if (cb && cb.checked) ppHumanSeats.add(seat);
  }

  // Need at least one human
  if (ppHumanSeats.size === 0) {
    ppHumanSeats.add(0);
  }

  ppPrivacyMode = document.getElementById('ppPrivacy').checked;

  // Enable pass and play
  PASS_AND_PLAY_MODE = true;
  document.getElementById('menuPassPlay').textContent = 'Pass & Play: ON';

  ppCloseSetupModal();

  // Hide all tiles immediately
  ppHideAllTiles();

  if (startNew) {
    ppResetRotation();
    hideStartScreen();
    clearSavedGame();
    startNewHand();
  } else {
    // Continue current game — find whose turn it is and transition
    ppContinueFromCurrentState();
  }
}

function ppContinueFromCurrentState() {
  // Attach click handlers to all human seats' sprites
  // (they may not have handlers if game started in normal mode)
  ppAttachClickHandlers();

  const seat = session.phase === PHASE_NEED_BID && biddingState
    ? biddingState.currentBidder
    : session.game.current_player;

  if (ppIsHuman(seat)) {
    const phase = session.phase === PHASE_NEED_BID ? 'Bidding Phase' :
                  session.phase === PHASE_NEED_TRUMP ? 'Choose Trump' :
                  session.phase === PHASE_PLAYING ? 'Play Phase' : '';
    if (session.phase === PHASE_NEED_BID) {
      // Rotate to bidder and show bid overlay
      ppRotateBoard(seat);
      startBiddingRound();
    } else {
      ppTransitionToSeat(seat, phase);
    }
  } else {
    // AI seat — run AI until we hit a human
    ppResetRotation();
    if (session.phase === PHASE_NEED_BID) {
      startBiddingRound();
    } else if (session.phase === PHASE_PLAYING) {
      maybeAIKick();
    }
  }
}

// Disable pass and play
function ppDeactivate() {
  PASS_AND_PLAY_MODE = false;
  ppResetRotation();
  ppHideHandoff();
  document.getElementById('menuPassPlay').textContent = 'Pass & Play: OFF';

  // Reposition everything to normal (compacted, no gaps)
  for (let seat = 0; seat < session.game.player_count; seat++) {
    const seatSprites = sprites[seat];
    if (!seatSprites) continue;
    const playerNum = seatToPlayer(seat);
    const remaining = seatSprites.filter(d => d && d.sprite);
    const section = getSection('Player_' + playerNum + '_Hand');
    if (section && section.dominoes.length >= 2 && remaining.length > 0) {
      const first = section.dominoes[0];
      const last = section.dominoes[section.dominoes.length - 1];
      const slotCount = section.dominoes.length - 1;
      const centerXN = (first.xN + last.xN) / 2;
      const centerYN = (first.yN + last.yN) / 2;
      const spacingXN = slotCount > 0 ? (last.xN - first.xN) / slotCount : 0;
      const spacingYN = slotCount > 0 ? (last.yN - first.yN) / slotCount : 0;
      const count = remaining.length;

      remaining.forEach((data, i) => {
        const offsetFromCenter = i - (count - 1) / 2;
        const xN = centerXN + offsetFromCenter * spacingXN;
        const yN = centerYN + offsetFromCenter * spacingYN;
        const px = normToPx(xN, yN);
        data.sprite.setPose({
          x: px.x - 28,
          y: px.y - 56,
          s: first.scale,
          rz: first.rotZ,
          ry: seat === 0 ? 180 : 0
        });
      });
    } else {
      seatSprites.forEach((data, h) => {
        if (!data || !data.sprite) return;
        const pos = getHandPosition(playerNum, h);
        if (pos) {
          data.sprite.setPose(pos);
          data.sprite.setFaceUp(seat === 0);
        }
      });
    }
  }

  // Re-enable P1 clicks if it's P1's turn
  if (session.phase === PHASE_PLAYING && session.game.current_player === 0) {
    enablePlayer1Clicks();
    updatePlayer1ValidStates();
  }
}

// Event listeners for PP modal
document.getElementById('ppCloseBtn').addEventListener('click', ppCloseSetupModal);
document.getElementById('ppNewGame').addEventListener('click', () => ppActivateFromModal(true));
document.getElementById('ppContinue').addEventListener('click', () => ppActivateFromModal(false));

document.getElementById('ppHandoffBtn').addEventListener('click', () => {
  const seat = ppActiveViewSeat;
  // Find whose turn it actually is
  const currentSeat = session.game.current_player;
  // For bidding, use biddingState.currentBidder
  const activeSeat = session.phase === PHASE_NEED_BID && typeof biddingState !== 'undefined' && biddingState
    ? biddingState.currentBidder : currentSeat;
  ppCompleteTransition(activeSeat);

  // Resume the appropriate game flow
  if (session.phase === PHASE_NEED_BID) {
    showBidOverlay(true);
  } else if (session.phase === PHASE_NEED_TRUMP) {
    // Trump selection - enable domino clicks
    ppUpdateValidStates(activeSeat);
  } else if (session.phase === PHASE_PLAYING) {
    waitingForPlayer1 = true;
    ppUpdateValidStates(activeSeat);
  }
});



// ============================================================
// Stubs for monte-carlo.js (lazy-loaded)
// ============================================================
// Monte Carlo — lazy loaded from monte-carlo.js
// Entirely self-contained IIFE, no stubs needed


// Load game log on startup
loadGameLog();

// Check for saved game on startup
checkForSavedGame();

document.getElementById('btnBidConfirm').addEventListener('click', () => {
  // V10_109: Smart bid button — gray when below minimum, auto-adjust on click
  const slider = document.getElementById('bidRangeSlider');
  const maxBid = GAME_MODE === 'MOON' ? 7 : (GAME_MODE === 'T42' ? 42 : 51);

  if(currentBidSelection === 'Pass'){
    humanPass();
    return;
  }

  // Check if current bid is valid (above high bid or in multiplier mode)
  const minRequired = biddingState ? biddingState.highBid + 1 : (GAME_MODE === 'MOON' ? 4 : (GAME_MODE === 'T42' ? 30 : 34));
  const numVal = typeof currentBidSelection === 'number' ? currentBidSelection : parseInt(currentBidSelection);

  if(bidMode === 'range' && numVal < minRequired){
    // Invalid — play sound and auto-adjust slider to minimum
    SFX.playInvalid();
    if(slider){
      slider.value = Math.min(minRequired, parseInt(slider.max));
      slider.dispatchEvent(new Event('input'));
    }
    return;
  }

  // V12.10.21: Block bids above game mode maximum
  if(bidMode === 'range' && numVal > maxBid){
    SFX.playInvalid();
    return;
  }

  humanBid(currentBidSelection);
});

// V10_107: Fix #5 — Nello button handler
document.getElementById('btnNello').addEventListener('click', () => {
  // V10_109: Nello button rework — 3 states: colored (valid), gray (slider wrong), red+strikethrough (restricted)
  const slider = document.getElementById('bidRangeSlider');
  const nBtn = document.getElementById('btnNello');
  const maxBid = GAME_MODE === 'T42' ? 42 : 51;
  const nelloState = getNelloButtonState();

  if(nelloState.state === 'valid'){
    // Submit the Nello bid
    window._nelloDeclared = true;
    window._nelloMarks = nelloState.marks;
    const bidStr = nelloState.marks > 1 ? nelloState.marks + 'x' : maxBid;
    humanBid(bidStr, nelloState.marks);
    return;
  }

  // Gray or red — auto-adjust slider to correct position and play invalid sound
  SFX.playInvalid();
  if(nelloState.state === 'gray'){
    // Slider below 42/51 — jump to max
    if(slider){
      slider.value = maxBid;
      slider.dispatchEvent(new Event('input'));
    }
  } else if(nelloState.state === 'red'){
    // Restricted — adjust to the allowed multiplier
    const allowedMarks = nelloState.allowedMarks || 1;
    if(allowedMarks === 1){
      // Need to be at max bid with 1x
      if(slider){
        slider.value = maxBid;
        slider.dispatchEvent(new Event('input'));
      }
      // Deselect 2x notch if active
      const twox = document.getElementById('bid2xNotch');
      if(twox) twox.classList.remove('active');
      bidMode = 'range';
      currentBidSelection = maxBid;
      updateBidDisplay();
    } else {
      // Need higher multiplier — click the 2x/3x notch
      const twox = document.getElementById('bid2xNotch');
      if(twox) twox.click();
    }
  }
  // After adjustment, update the Nello button state
  updateNelloButton();
});

document.getElementById('btnTrumpConfirm').onclick = function() {
  confirmTrumpSelection();
};

// Add touch handler for mobile
document.getElementById('btnTrumpConfirm').ontouchend = function(e) {
  e.preventDefault();
  confirmTrumpSelection();
};

// Full layout refresh - repositions all elements
function refreshLayout(){
  console.log("Refreshing layout...");

  // Reposition all hand sprites
  for(let p = 0; p < session.game.player_count; p++){
    const playerNum = seatToPlayer(p);
    for(let h = 0; h < session.game.hand_size; h++){
      const data = sprites[p] && sprites[p][h];
      if(data && data.sprite){
        const pos = getHandPosition(playerNum, h);
        if(pos){
          data.sprite.setPose(pos);
        }
      }
    }
  }

  // Reposition placeholders
  createPlaceholders();

  // Reposition player indicators
  positionPlayerIndicators();

  // Reposition lead domino if visible
  if(leadDominoSprite){
    const pos = getLeadDominoPosition();
    const size = 36;  // Square size
    leadDominoSprite.style.left = (pos.x - size/2) + 'px';
    leadDominoSprite.style.top = (pos.y - (size + 16)/2) + 'px';  // Extra height for label
  }

  // Note: Trick history dominoes are in fixed positions and handled by their own layout
}

window.addEventListener('resize', refreshLayout);

// Orientation change handler - refresh when returning to portrait
let lastOrientation = window.innerHeight > window.innerWidth ? 'portrait' : 'landscape';

function handleOrientationChange(){
  // Delay to let the browser finish rotating (500ms works well on iOS)
  setTimeout(() => {
    const currentOrientation = window.innerHeight > window.innerWidth ? 'portrait' : 'landscape';

    if(currentOrientation !== lastOrientation){
      console.log(`Orientation changed: ${lastOrientation} -> ${currentOrientation}`);
      lastOrientation = currentOrientation;

      // Refresh layout on any orientation change
      refreshLayout();
    }
  }, 500);
}

// Listen for both orientationchange and resize (some devices only fire one)
window.addEventListener('orientationchange', handleOrientationChange);
window.addEventListener('resize', handleOrientationChange);

// Visibility/network/stale-state handlers moved to multiplayer.js


/******************************************************************************
 * SCREEN SIZE DETECTION
 ******************************************************************************/

// Screen size breakpoints and info
const SCREEN_INFO = {
  type: 'default',     // 'phone-portrait', 'phone-landscape', 'tablet', 'desktop'
  width: 0,
  height: 0,
  scale: 1,
  isPortrait: true,
  isPhone: false,
  isTablet: false
};

function detectScreenSize(){
  const w = window.innerWidth;
  const h = window.innerHeight;
  const isPortrait = h > w;
  const shortSide = Math.min(w, h);
  const longSide = Math.max(w, h);

  SCREEN_INFO.width = w;
  SCREEN_INFO.height = h;
  SCREEN_INFO.isPortrait = isPortrait;

  // Determine device type based on screen size
  // Phone: short side < 500px (typically 320-428px)
  // Tablet: short side 500-900px (typically 768px)
  // Desktop: short side > 900px
  if(shortSide < 500){
    SCREEN_INFO.isPhone = true;
    SCREEN_INFO.isTablet = false;
    SCREEN_INFO.type = isPortrait ? 'phone-portrait' : 'phone-landscape';
    SCREEN_INFO.scale = shortSide / 375;  // iPhone baseline
  } else if(shortSide < 900){
    SCREEN_INFO.isPhone = false;
    SCREEN_INFO.isTablet = true;
    SCREEN_INFO.type = 'tablet';
    SCREEN_INFO.scale = shortSide / 768;  // iPad baseline
  } else {
    SCREEN_INFO.isPhone = false;
    SCREEN_INFO.isTablet = false;
    SCREEN_INFO.type = 'desktop';
    SCREEN_INFO.scale = 1;
  }

  // Update CSS variables
  document.documentElement.style.setProperty('--screen-scale', SCREEN_INFO.scale);
  document.documentElement.style.setProperty('--screen-type', SCREEN_INFO.type);

  console.log(`Screen detected: ${SCREEN_INFO.type} (${w}x${h}), scale: ${SCREEN_INFO.scale.toFixed(2)}`);

  return SCREEN_INFO;
}

// Call on load and resize
detectScreenSize();
window.addEventListener('resize', detectScreenSize);

/******************************************************************************
 * INITIALIZATION
 ******************************************************************************/

// V12.10.8: Splash screen animation
(function(){
  var splash = document.getElementById('splashScreen');
  if(!splash) return;
  // Populate version text dynamically from MP_VERSION
  var sv = document.getElementById('splashVersion');
  if(sv) sv.textContent = (typeof GAME_VERSION !== 'undefined') ? GAME_VERSION : '';
  var fill = document.getElementById('splashLoadingFill');
  var progress = 0;
  var interval = setInterval(function(){
    progress += Math.random() * 15 + 5;
    if(progress > 95) progress = 95;
    if(fill) fill.style.width = progress + '%';
  }, 200);
  setTimeout(function(){
    clearInterval(interval);
    if(fill) fill.style.width = '100%';
    setTimeout(function(){
      splash.style.animation = 'splashFadeOut 0.5s ease-out forwards';
      setTimeout(function(){
        splash.style.display = 'none';
      }, 500);
    }, 300);
  }, 3000);
})();

// V12.10.12: Background + circular image mask customization
(function(){
  var DEFAULT_CENTER = '#0178ff';
  var DEFAULT_EDGE = '#01001e';
  var DEFAULT_SPREAD = 80;
  var DEFAULT_BURST = true;
  var DEFAULT_SPEED = 10;
  var DEFAULT_ROTATE = false;

  var saved = null;
  try { saved = JSON.parse(localStorage.getItem('tn51_bg_colors')); } catch(e){}
  var centerColor = (saved && saved.center) || DEFAULT_CENTER;
  var edgeColor = (saved && saved.edge) || DEFAULT_EDGE;
  var spread = (saved && saved.spread) || DEFAULT_SPREAD;
  var burstOn = (saved && saved.burst != null) ? saved.burst : DEFAULT_BURST;
  var speed = (saved && saved.speed) ? saved.speed : DEFAULT_SPEED;
  var rotateMode = (saved && saved.rotate != null) ? saved.rotate : DEFAULT_ROTATE;

  function applyBg(){
    var bg = 'radial-gradient(circle at 50% 35%, ' + centerColor + ' 0%, ' + edgeColor + ' ' + spread + '%)'; /* V12.10.20: circle not ellipse */
    var backdrop = document.getElementById('startScreenBackdrop');
    if(backdrop) backdrop.style.background = bg;
    var gs = document.getElementById('gameSelectScreen');
    if(gs) gs.style.background = bg;
    var splash = document.getElementById('splashScreen');
    if(splash) splash.style.background = bg;
  }

  function applyBurst(){
    var el = document.getElementById('lightBurst');
    if(el){
      if(burstOn) el.classList.add('active');
      else el.classList.remove('active');
      // Apply animation
      if(rotateMode){
        el.style.animation = 'burstRotate ' + speed + 's linear infinite';
      } else {
        el.style.animation = 'burstSway ' + speed + 's ease-in-out infinite';
      }
    }
    var track = document.getElementById('cpBurstTrack');
    var knob = document.getElementById('cpBurstKnob');
    if(track) track.style.background = burstOn ? '#3b82f6' : 'rgba(255,255,255,0.15)';
    if(knob) knob.style.left = burstOn ? '20px' : '2px';
    // Mode toggle visuals
    var rTrack = document.getElementById('cpRotateTrack');
    var rKnob = document.getElementById('cpRotateKnob');
    var mLabel = document.getElementById('cpModeLabel');
    if(rTrack) rTrack.style.background = rotateMode ? '#3b82f6' : 'rgba(255,255,255,0.15)';
    if(rKnob) rKnob.style.left = rotateMode ? '20px' : '2px';
    if(mLabel) mLabel.textContent = rotateMode ? 'Rotate' : 'Sway';
  }

  function saveAll(){
    try { localStorage.setItem('tn51_bg_colors', JSON.stringify({
      center: centerColor, edge: edgeColor, spread: spread,
      burst: burstOn, speed: speed, rotate: rotateMode
    })); } catch(e){}
  }

  applyBg();
  setTimeout(function(){ applyBurst(); }, 100);

  var elCenter = document.getElementById('cpCenter');
  var elEdge = document.getElementById('cpEdge');
  var elSpread = document.getElementById('cpSpread');
  var elSpreadVal = document.getElementById('cpSpreadVal');
  var elBurst = document.getElementById('cpBurst');
  var elSpeed = document.getElementById('cpSpeed');
  var elSpeedVal = document.getElementById('cpSpeedVal');
  var elRotate = document.getElementById('cpRotate');

  if(elCenter) elCenter.addEventListener('input', function(){ centerColor = this.value; applyBg(); saveAll(); });
  if(elEdge) elEdge.addEventListener('input', function(){ edgeColor = this.value; applyBg(); saveAll(); });
  if(elSpread) elSpread.addEventListener('input', function(){ spread = parseInt(this.value); elSpreadVal.textContent = spread+'%'; applyBg(); saveAll(); });
  if(elBurst) elBurst.addEventListener('change', function(){ burstOn = this.checked; applyBurst(); saveAll(); });
  if(elSpeed){
    elSpeed.value = speed;
    elSpeedVal.textContent = speed + 's';
    elSpeed.addEventListener('input', function(){ speed = parseInt(this.value); elSpeedVal.textContent = speed+'s'; applyBurst(); saveAll(); });
  }
  if(elRotate){
    elRotate.checked = rotateMode;
    elRotate.addEventListener('change', function(){ rotateMode = this.checked; applyBurst(); saveAll(); });
  }

  var elReset = document.getElementById('cpReset');
  if(elReset) elReset.addEventListener('click', function(){
    centerColor = DEFAULT_CENTER; edgeColor = DEFAULT_EDGE;
    spread = DEFAULT_SPREAD; burstOn = DEFAULT_BURST;
    speed = DEFAULT_SPEED; rotateMode = DEFAULT_ROTATE;
    if(elCenter) elCenter.value = centerColor;
    if(elEdge) elEdge.value = edgeColor;
    if(elSpread){ elSpread.value = spread; elSpreadVal.textContent = spread+'%'; }
    if(elBurst) elBurst.checked = burstOn;
    if(elSpeed){ elSpeed.value = speed; elSpeedVal.textContent = speed+'s'; }
    if(elRotate) elRotate.checked = rotateMode;
    applyBg(); applyBurst(); saveAll();
  });

  var elDone = document.getElementById('cpDone');
  if(elDone) elDone.addEventListener('click', function(){
    var panel = document.getElementById('colorPickerPanel');
    if(panel) panel.style.display = 'none';
  });

  var elCopy = document.getElementById('cpCopySettings');
  if(elCopy) elCopy.addEventListener('click', function(){
    var txt = 'BG: center=' + centerColor + ' edge=' + edgeColor + ' spread=' + spread + '% | BURST: ' + (burstOn ? 'ON' : 'OFF') + ' speed=' + speed + 's mode=' + (rotateMode ? 'rotate' : 'sway');
    if(navigator.clipboard && navigator.clipboard.writeText){
      navigator.clipboard.writeText(txt).then(function(){
        elCopy.textContent = '\u2705 Copied!';
        setTimeout(function(){ elCopy.innerHTML = '&#128203; Copy Settings'; }, 2000);
      });
    } else {
      var ta = document.createElement('textarea');
      ta.value = txt;
      document.body.appendChild(ta);
      ta.select();
      document.execCommand('copy');
      document.body.removeChild(ta);
      elCopy.textContent = '\u2705 Copied!';
      setTimeout(function(){ elCopy.innerHTML = '&#128203; Copy Settings'; }, 2000);
    }
  });

  window._cpShowToggle = function(){
    var btn = document.getElementById('colorPickerToggle');
    if(btn) btn.style.display = 'block';
  };
  window._cpHideToggle = function(){
    var btn = document.getElementById('colorPickerToggle');
    var panel = document.getElementById('colorPickerPanel');
    if(btn) btn.style.display = 'none';
    if(panel) panel.style.display = 'none';
  };

  var elToggle = document.getElementById('colorPickerToggle');
  if(elToggle) elToggle.addEventListener('click', function(){
    var panel = document.getElementById('colorPickerPanel');
    if(panel) panel.style.display = panel.style.display === 'none' ? 'block' : 'none';
  });
})();

// Show start screen instead of auto-starting
function showStartScreen(){
  if(typeof _cpShowToggle === 'function') _cpShowToggle();
  const backdrop = document.getElementById('startScreenBackdrop');
  const resumeBtn = document.getElementById('btnStartResumeGame');
  const resumeMPBtn = document.getElementById('btnResumeMP');
  // V12.10.9: Hide full-screen game select if open
  var gsScreen = document.getElementById('gameSelectScreen');
  if(gsScreen) gsScreen.style.display = 'none';
  if(typeof _gsHideCarousel === 'function') _gsHideCarousel();
  const mainBtns = document.getElementById('startMainBtns');
  if(mainBtns) mainBtns.style.display = 'flex'; /* V12.10.20: restore flex so gap works */
  if(hasSavedGame()) resumeBtn.style.display = 'block';
  else resumeBtn.style.display = 'none';
  const savedHostState = mpLoadHostState();
  if(savedHostState && !savedHostState.completedFlag){
    resumeMPBtn.style.display = 'block';
    resumeMPBtn.textContent = 'Resume MP Game (' + (savedHostState.room || 'unknown') + ')';
  } else resumeMPBtn.style.display = 'none';
  backdrop.style.display = 'flex';
}

function hideStartScreen(){
  document.getElementById('startScreenBackdrop').style.display = 'none';
  if(typeof _cpHideToggle === 'function') _cpHideToggle();
}

// Game Settings popup
let selectedMarksToWin = 7;

// House Rules
let callForDoubleEnabled = true; // Call for the Double rule
let nelloDoublesMode = 'regular'; // 'regular', 'doubles_only', 'player_chooses'
let doublesFollowMe = 'on'; // 'on', 'off', 'player_chooses' — Doubles Follow Me when Doubles are trump
let _dfmActiveThisHand = false; // V12.10.21: init false, only set true when DOUBLES trump chosen
let _dfmChoiceMade = false; // Guard to prevent popup re-showing after choice
let callForDoubleActive = false; // Is the double being called this trick?
let callForDoubleTrumpPip = null; // Which trump pip's double is being called
let nelloDoublesSuitActive = false; // Is doubles-as-separate-suit active this hand?

function showGameSettings(){
  document.getElementById('gameSettingsBackdrop').style.display = 'flex';
}
function hideGameSettings(){
  document.getElementById('gameSettingsBackdrop').style.display = 'none';
}

document.querySelectorAll('.gsMarksBtn').forEach(btn => {
  btn.addEventListener('click', () => {
    selectedMarksToWin = parseInt(btn.dataset.marks);
    document.querySelectorAll('.gsMarksBtn').forEach(b => {
      b.style.border = 'none';
      b.classList.remove('gsMarksSelected');
    });
    btn.style.border = '2px solid #fff';
    btn.classList.add('gsMarksSelected');
  });
});

// Game type selector
let selectedGameType = 'TN51';
document.querySelectorAll('.gsGameTypeBtn').forEach(btn => {
  btn.addEventListener('click', () => {
    selectedGameType = btn.dataset.gameType;
    document.querySelectorAll('.gsGameTypeBtn').forEach(b => {
      b.style.border = '2px solid transparent';
      b.style.opacity = '0.7';
      b.classList.remove('gsGameTypeSelected');
    });
    btn.style.border = '2px solid #fff';
    btn.style.opacity = '1';
    btn.classList.add('gsGameTypeSelected');
    if(typeof updateGameSettingsForMode === 'function') updateGameSettingsForMode(selectedGameType);
  });
});

// Back button returns to carousel (game selection)
document.getElementById('btnGameSettingsBack').addEventListener('click', () => {
  hideGameSettings();
  // If carousel is open, show color picker toggle again
  var gs = document.getElementById('gameSelectScreen');
  if(gs && gs.style.display !== 'none'){
    document.getElementById('gsColorPickerToggle').style.display = 'flex';
  } else {
    showStartScreen();
  }
});

// Update game settings visibility based on selected game type
function updateGameSettingsForMode(mode){
  // V10_111: gsNello2xSection removed
  var nelloDecSec = document.getElementById('gsNelloDeclareSection');
  if(nelloDecSec) nelloDecSec.style.display = (mode === 'MOON') ? 'none' : '';
  var nelloResSec = document.getElementById('gsNelloRestrictSection');
  if(nelloResSec) nelloResSec.style.display = (mode === 'MOON') ? 'none' : '';
  const marksSection = document.getElementById('gsMarksSection');
  const nelloSection = document.getElementById('gsNelloSection');
  const nelloBtns = document.getElementById('gsNelloBtns');
  const dfmSection = document.getElementById('gsDfmSection');
  const dfmBtns = document.getElementById('gsDfmBtns');
  if(mode === 'MOON'){
    // Moon: no marks selection (always 21), no Nello, no DFM
    if(marksSection) marksSection.style.display = 'none';
    if(nelloSection) nelloSection.style.display = 'none';
    if(nelloBtns) nelloBtns.style.display = 'none';
    if(dfmSection) dfmSection.style.display = 'none';
    if(dfmBtns) dfmBtns.style.display = 'none';
  } else {
    if(marksSection) marksSection.style.display = '';
    if(nelloSection) nelloSection.style.display = '';
    if(nelloBtns) nelloBtns.style.display = '';
    if(dfmSection) dfmSection.style.display = '';
    if(dfmBtns) dfmBtns.style.display = '';
  }
}

document.getElementById('btnGameSettingsStart').addEventListener('click', () => {
  hideGameSettings();
  // V12.10.27c: Also hide carousel and color picker
  document.getElementById('gameSelectScreen').style.display = 'none';
  if(typeof _gsHideCarousel === 'function') _gsHideCarousel();
  hideStartScreen();
  clearSavedGame();
  initGameMode(selectedGameType);
  session.marks_to_win = selectedMarksToWin;
  // Update start screen title
  // V12.10.9: Title text removed from home screen (image has branding)
  startNewHand();
});

// Start screen button handlers — New Game now opens Game Settings popup
document.getElementById('btnStartMultiplayer').addEventListener('click', () => {
  document.getElementById('startScreenBackdrop').style.display = 'none';
  mpBuildModeSelector();
  document.getElementById('mpRoomSection').style.display = 'none';
  document.getElementById('mpObserverSection').style.display = 'none';
  document.getElementById('mpRefreshToggleSection').style.display = 'none';
  document.getElementById('mpBackdrop').style.display = 'flex';
  // V10_104: Connect to relay early for room status
  mpRequestRoomStatus();
});

document.getElementById('btnResumeMP').addEventListener('click', () => {
  const savedHostState = mpLoadHostState();
  if (!savedHostState) {
    alert('No saved game found.');
    return;
  }
  // Hide start screen
  document.getElementById('startScreenBackdrop').style.display = 'none';
  // Restore full game state
  mpResumeFromSavedState(savedHostState);
  // Show MP modal briefly then connect
  document.getElementById('mpBackdrop').style.display = 'flex';
  setStatus('Resuming game in ' + savedHostState.room + '...');
  // Connect to relay and resume
  setTimeout(() => {
    document.getElementById('mpBackdrop').style.display = 'none';
    mpResumeConnection(savedHostState);
  }, 500);
});

// V12.10.27cb: Game Select — logo-only swipe, bg/burst color-fade, wrap cycling
(function(){
  var GAMES = ['TN51','T42','MOON'];
  var GAME_LABELS = {TN51:'Tennessee 51', T42:'Texas 42', MOON:'Texas Moon'};
  var GAME_DEFAULTS = {
    TN51: {center:'#0178ff', edge:'#01001e', spread:80, burst:true, speed:10, rotate:false, burstX:0, burstY:0, imgSize:75, btn1:'#22c55e', btn2:'#16a34a'},
    T42:  {center:'#4f46e5', edge:'#0f0a2e', spread:75, burst:true, speed:12, rotate:false, burstX:0, burstY:0, imgSize:75, btn1:'#22c55e', btn2:'#16a34a'},
    MOON: {center:'#b45309', edge:'#1a0800', spread:70, burst:true, speed:8, rotate:true, burstX:0, burstY:0, imgSize:75, btn1:'#22c55e', btn2:'#16a34a'}
  };
  var LS_KEY = 'tn51_gs_colors';
  var gsIdx = 0;
  var gsColors = {};

  try { gsColors = JSON.parse(localStorage.getItem(LS_KEY)) || {}; } catch(e){ gsColors = {}; }
  GAMES.forEach(function(g){
    if(!gsColors[g]) gsColors[g] = JSON.parse(JSON.stringify(GAME_DEFAULTS[g]));
    // Ensure new fields exist for saved configs
    var d = GAME_DEFAULTS[g];
    var c = gsColors[g];
    if(c.burstX == null) c.burstX = d.burstX;
    if(c.burstY == null) c.burstY = d.burstY;
    if(c.imgSize == null) c.imgSize = d.imgSize;
  });

  function gsSave(){
    try { localStorage.setItem(LS_KEY, JSON.stringify(gsColors)); } catch(e){}
  }

  function gsGetMode(){ return GAMES[gsIdx]; }

  // Apply background gradient to the screen
  function gsApplyBg(c){
    var gs = document.getElementById('gameSelectScreen');
    if(gs) gs.style.background = 'radial-gradient(circle at 50% 35%, ' + c.center + ' 0%, ' + c.edge + ' ' + c.spread + '%)';
  }

  // Apply burst settings
  function gsApplyBurst(c){
    var burst = document.getElementById('gsBurst');
    if(!burst) return;
    burst.style.opacity = c.burst ? '1' : '0';
    if(c.rotate){
      burst.style.animation = 'burstRotate ' + c.speed + 's linear infinite';
    } else {
      burst.style.animation = 'burstSway ' + c.speed + 's ease-in-out infinite';
    }
    // Position: center is 50%/35% by default, offset by burstX/burstY
    var cx = 50 + (c.burstX || 0);
    var cy = 35 + (c.burstY || 0);
    burst.style.left = cx + '%';
    burst.style.top = cy + '%';
    burst.style.marginLeft = '-125vmax';
    burst.style.marginTop = '-125vmax';
  }

  // Apply image size for current game
  function gsApplyImgSize(game){
    var c = gsColors[game];
    var img = document.querySelector('.gsSlideImg[data-game="' + game + '"]');
    if(img) img.style.width = 'min(' + c.imgSize + 'vw, ' + Math.round(c.imgSize * 5) + 'px)';
  }

  // Apply play button color
  function gsApplyBtn(c){
    var btn = document.getElementById('gsPlayBtn');
    if(btn) btn.style.background = 'linear-gradient(135deg,' + c.btn1 + ',' + c.btn2 + ')';
  }

  // Apply all visuals for current game
  function gsApplyAll(){
    var c = gsColors[gsGetMode()];
    gsApplyBg(c);
    gsApplyBurst(c);
    gsApplyBtn(c);
  }

  // Navigate
  var track = document.getElementById('gsLogoTrack');

  function gsGoTo(idx, animate){
    // Wrap around
    if(idx < 0) idx = GAMES.length - 1;
    if(idx >= GAMES.length) idx = 0;
    gsIdx = idx;
    if(animate === false) track.style.transition = 'none';
    else track.style.transition = 'transform 0.35s cubic-bezier(0.25,0.46,0.45,0.94)';
    track.style.transform = 'translateX(-' + (gsIdx * 100) + 'vw)';
    if(animate === false){ track.offsetHeight; }
    // Dots
    document.querySelectorAll('.gsDot').forEach(function(d,i){
      d.classList.toggle('active', i === gsIdx);
    });
    // Apply bg/burst/btn with transition
    gsApplyAll();
    gsUpdatePickerUI();
  }

  // Swipe handling
  var startX = 0, dx = 0, swiping = false;
  var area = document.getElementById('gsLogoArea');

  area.addEventListener('touchstart', function(e){
    startX = e.touches[0].clientX;
    dx = 0;
    swiping = true;
    track.style.transition = 'none';
  }, {passive:true});

  area.addEventListener('touchmove', function(e){
    if(!swiping) return;
    dx = e.touches[0].clientX - startX;
    var dy = e.touches[0].clientY - (startX ? e.touches[0].clientY : 0);
    var offset = -(gsIdx * window.innerWidth) + dx;
    track.style.transform = 'translateX(' + offset + 'px)';
  }, {passive:true});

  area.addEventListener('touchend', function(){
    if(!swiping) return;
    swiping = false;
    var threshold = window.innerWidth * 0.2;
    if(dx < -threshold){
      gsGoTo(gsIdx + 1);
    } else if(dx > threshold){
      gsGoTo(gsIdx - 1);
    } else {
      gsGoTo(gsIdx); // snap back
    }
  });

  // Arrows — wrap around
  document.getElementById('gsArrowLeft').addEventListener('click', function(){ gsGoTo(gsIdx - 1); });
  document.getElementById('gsArrowRight').addEventListener('click', function(){ gsGoTo(gsIdx + 1); });

  // Dots
  document.querySelectorAll('.gsDot').forEach(function(d){
    d.addEventListener('click', function(){ gsGoTo(parseInt(this.dataset.idx)); });
  });

  // Init image sizes
  GAMES.forEach(function(g){ gsApplyImgSize(g); });

  // Open game select
  document.getElementById('btnStartNewGame').addEventListener('click', function(){
    gsGoTo(0, false);
    document.getElementById('gameSelectScreen').style.display = 'flex';
    document.getElementById('gsColorPickerToggle').style.display = 'flex';
    if(typeof _cpShowToggle === 'function') _cpShowToggle();
  });


  // Moon warning dialog
  function _gsShowMoonWarning(){
    var w = document.createElement('div');
    w.style.cssText = 'position:fixed;left:0;top:0;width:100%;height:100%;z-index:3000;display:flex;align-items:center;justify-content:center;background:rgba(0,0,0,0.7);';
    w.innerHTML = '<div style="background:linear-gradient(135deg,#1e293b,#0f172a);border-radius:16px;padding:28px;text-align:center;color:#fff;min-width:280px;max-width:85%;box-shadow:0 8px 32px rgba(0,0,0,0.5);border:1px solid rgba(255,255,255,0.1);">'
      + '<div style="font-size:20px;font-weight:700;margin-bottom:8px;color:#eab308;">Under Construction</div>'
      + '<div style="font-size:14px;color:rgba(255,255,255,0.7);margin-bottom:20px;line-height:1.5;">Texas Moon is still being developed.<br>Some features may not work as expected.</div>'
      + '<div style="display:flex;gap:12px;justify-content:center;">'
      + '<button id="moonWarningContinue" style="padding:10px 24px;font-size:14px;font-weight:700;color:#fff;background:linear-gradient(135deg,#eab308,#ca8a04);border:none;border-radius:10px;cursor:pointer;">Continue Anyway</button>'
      + '<button id="moonWarningBack" style="padding:10px 24px;font-size:14px;font-weight:600;color:rgba(255,255,255,0.7);background:rgba(255,255,255,0.15);border:1px solid rgba(255,255,255,0.3);border-radius:10px;cursor:pointer;">Go Back</button>'
      + '</div></div>';
    document.body.appendChild(w);
    document.getElementById('moonWarningBack').addEventListener('click', function(){ w.remove(); document.getElementById('gsColorPickerToggle').style.display = 'flex'; });
    document.getElementById('moonWarningContinue').addEventListener('click', function(){ w.remove(); updateGameSettingsForMode('MOON'); showGameSettings(); });
  }

  // Play button — show game settings OVERLAID on carousel
  document.getElementById('gsPlayBtn').addEventListener('click', function(){
    var mode = gsGetMode();
    selectedGameType = mode;
    // Hide color picker
    document.getElementById('gsColorPickerToggle').style.display = 'none';
    document.getElementById('gsColorPickerPanel').style.display = 'none';
    // Update game type button highlight (in case settings panel checks it)
    document.querySelectorAll('.gsGameTypeBtn').forEach(function(b){ b.style.border='2px solid transparent'; b.style.opacity='0.7'; b.classList.remove('gsGameTypeSelected'); });
    var typeBtn = document.querySelector('.gsGameTypeBtn[data-game-type="'+mode+'"]');
    if(typeBtn){ typeBtn.style.border='2px solid #fff'; typeBtn.style.opacity='1'; typeBtn.classList.add('gsGameTypeSelected'); }
    updateGameSettingsForMode(mode);
    if(mode === 'MOON'){
      _gsShowMoonWarning();
    } else {
      // Show game settings overlay on top of carousel (don't hide carousel)
      showGameSettings();
    }
  });

  // Back button
  document.getElementById('gsBackBtn').addEventListener('click', function(){
    document.getElementById('gameSelectScreen').style.display = 'none';
    document.getElementById('gsColorPickerToggle').style.display = 'none';
    document.getElementById('gsColorPickerPanel').style.display = 'none';
  });

  // ===== Per-game Color Picker =====
  var cpToggle = document.getElementById('gsColorPickerToggle');
  var cpPanel = document.getElementById('gsColorPickerPanel');

  cpToggle.addEventListener('click', function(){
    cpPanel.style.display = cpPanel.style.display === 'none' ? 'block' : 'none';
  });

  function gsUpdatePickerUI(){
    var g = gsGetMode();
    var c = gsColors[g];
    var lbl = document.getElementById('gsColorGameLabel');
    if(lbl) lbl.textContent = GAME_LABELS[g];
    var el;
    el = document.getElementById('gsCpImgSize'); if(el) el.value = c.imgSize;
    el = document.getElementById('gsCpImgSizeVal'); if(el) el.textContent = c.imgSize + '%';
    el = document.getElementById('gsCpCenter'); if(el) el.value = c.center;
    el = document.getElementById('gsCpEdge'); if(el) el.value = c.edge;
    el = document.getElementById('gsCpSpread'); if(el) el.value = c.spread;
    el = document.getElementById('gsCpSpreadVal'); if(el) el.textContent = c.spread + '%';
    el = document.getElementById('gsCpBurst'); if(el) el.checked = c.burst;
    var bt = document.getElementById('gsCpBurstTrack');
    var bk = document.getElementById('gsCpBurstKnob');
    if(bt) bt.style.background = c.burst ? '#3b82f6' : 'rgba(255,255,255,0.15)';
    if(bk) bk.style.left = c.burst ? '20px' : '2px';
    el = document.getElementById('gsCpSpeed'); if(el) el.value = c.speed;
    el = document.getElementById('gsCpSpeedVal'); if(el) el.textContent = c.speed + 's';
    el = document.getElementById('gsCpRotate'); if(el) el.checked = c.rotate;
    var rt = document.getElementById('gsCpRotateTrack');
    var rk = document.getElementById('gsCpRotateKnob');
    if(rt) rt.style.background = c.rotate ? '#3b82f6' : 'rgba(255,255,255,0.15)';
    if(rk) rk.style.left = c.rotate ? '20px' : '2px';
    var ml = document.getElementById('gsCpModeLabel');
    if(ml) ml.textContent = c.rotate ? 'Rotate' : 'Sway';
    el = document.getElementById('gsCpBurstX'); if(el) el.value = c.burstX;
    el = document.getElementById('gsCpBurstXVal'); if(el) el.textContent = c.burstX + '%';
    el = document.getElementById('gsCpBurstY'); if(el) el.value = c.burstY;
    el = document.getElementById('gsCpBurstYVal'); if(el) el.textContent = c.burstY + '%';
    el = document.getElementById('gsCpBtn1'); if(el) el.value = c.btn1;
    el = document.getElementById('gsCpBtn2'); if(el) el.value = c.btn2;
  }

  function gsOnColorChange(){
    var g = gsGetMode();
    var c = gsColors[g];
    var el;
    el = document.getElementById('gsCpImgSize'); if(el) c.imgSize = parseInt(el.value);
    el = document.getElementById('gsCpCenter'); if(el) c.center = el.value;
    el = document.getElementById('gsCpEdge'); if(el) c.edge = el.value;
    el = document.getElementById('gsCpSpread'); if(el) c.spread = parseInt(el.value);
    el = document.getElementById('gsCpBurst'); if(el) c.burst = el.checked;
    el = document.getElementById('gsCpSpeed'); if(el) c.speed = parseInt(el.value);
    el = document.getElementById('gsCpRotate'); if(el) c.rotate = el.checked;
    el = document.getElementById('gsCpBurstX'); if(el) c.burstX = parseInt(el.value);
    el = document.getElementById('gsCpBurstY'); if(el) c.burstY = parseInt(el.value);
    el = document.getElementById('gsCpBtn1'); if(el) c.btn1 = el.value;
    el = document.getElementById('gsCpBtn2'); if(el) c.btn2 = el.value;
    gsApplyAll();
    gsApplyImgSize(g);
    gsUpdatePickerUI();
    gsSave();
  }

  ['gsCpCenter','gsCpEdge','gsCpBtn1','gsCpBtn2'].forEach(function(id){
    var el = document.getElementById(id);
    if(el) el.addEventListener('input', gsOnColorChange);
  });
  ['gsCpSpread','gsCpSpeed','gsCpImgSize','gsCpBurstX','gsCpBurstY'].forEach(function(id){
    var el = document.getElementById(id);
    if(el) el.addEventListener('input', gsOnColorChange);
  });
  ['gsCpBurst','gsCpRotate'].forEach(function(id){
    var el = document.getElementById(id);
    if(el) el.addEventListener('change', gsOnColorChange);
  });

  document.getElementById('gsCpReset').addEventListener('click', function(){
    var g = gsGetMode();
    gsColors[g] = JSON.parse(JSON.stringify(GAME_DEFAULTS[g]));
    gsApplyAll();
    gsApplyImgSize(g);
    gsUpdatePickerUI();
    gsSave();
  });

  document.getElementById('gsCpDone').addEventListener('click', function(){
    cpPanel.style.display = 'none';
  });

  window._gsShowCarousel = function(){
    document.getElementById('gsColorPickerToggle').style.display = 'flex';
  };
  window._gsHideCarousel = function(){
    document.getElementById('gsColorPickerToggle').style.display = 'none';
    document.getElementById('gsColorPickerPanel').style.display = 'none';
  };
})();

document.getElementById('btnStartResumeGame').addEventListener('click', () => {
  hideStartScreen();
  if(!resumeGameFromSave()){
    startNewHand();
  }
});

// House Rules handlers
document.getElementById('chkCallForDouble').addEventListener('change', function(){
  callForDoubleEnabled = this.checked;
  const knob = document.getElementById('callForDoubleKnob');
  const bg = this.parentElement.querySelector('span');
  if(this.checked){
    knob.style.left = '22px'; bg.style.background = '#22c55e';
  } else {
    knob.style.left = '2px'; bg.style.background = 'rgba(255,255,255,0.2)';
  }
  // V10_122e: Wrap localStorage in try-catch for iOS Safari private mode
  try {
    localStorage.setItem('tn51_callForDouble', callForDoubleEnabled ? '1' : '0');
  } catch(e) {
    console.warn('[iOS] localStorage write error:', e);
  }
});

// Nello doubles mode buttons
document.querySelectorAll('.gsNelloBtn').forEach(btn => {
  btn.addEventListener('click', () => {
    nelloDoublesMode = btn.dataset.nello;
    document.querySelectorAll('.gsNelloBtn').forEach(b => {
      b.style.border = 'none';
      b.classList.remove('gsNelloSelected');
    });
    btn.style.border = '2px solid #fff';
    btn.classList.add('gsNelloSelected');
    // V10_122e: Wrap localStorage in try-catch for iOS Safari private mode
    try {
      localStorage.setItem('tn51_nelloDoublesMode', nelloDoublesMode);
    } catch(e) {
      console.warn('[iOS] localStorage write error:', e);
    }
  });
});

// Doubles Follow Me choice popup handlers
document.getElementById('btnDfmYes').addEventListener('click', function(){
  _dfmActiveThisHand = true;
  document.getElementById('dfmChoiceBackdrop').style.display = 'none';
  _dfmContinueTrump();
});
document.getElementById('btnDfmNo').addEventListener('click', function(){
  _dfmActiveThisHand = false;
  document.getElementById('dfmChoiceBackdrop').style.display = 'none';
  _dfmContinueTrump();
});
function _dfmContinueTrump(){
  // Resume confirmTrumpSelection after player made their DFM choice
  _dfmChoiceMade = true;
  confirmTrumpSelection();
}

// Doubles Follow Me mode buttons (Game Settings)
document.querySelectorAll('.gsDfmBtn').forEach(btn => {
  btn.addEventListener('click', () => {
    doublesFollowMe = btn.dataset.dfm;
    document.querySelectorAll('.gsDfmBtn').forEach(b => {
      b.style.border = 'none';
      b.classList.remove('gsDfmSelected');
    });
    btn.style.border = '2px solid #fff';
    btn.classList.add('gsDfmSelected');
    try {
      localStorage.setItem('tn51_doublesFollowMe', doublesFollowMe);
    } catch(e) {
      console.warn('[iOS] localStorage write error:', e);
    }
  });
});

// Restore house rules from localStorage
(function(){
  const cfd = localStorage.getItem('tn51_callForDouble');
  if(cfd === '0'){
    callForDoubleEnabled = false;
    const chk = document.getElementById('chkCallForDouble');
    if(chk){ chk.checked = false; }
    const knob = document.getElementById('callForDoubleKnob');
    if(knob) knob.style.left = '2px';
    const bg = chk ? chk.parentElement.querySelector('span') : null;
    if(bg) bg.style.background = 'rgba(255,255,255,0.2)';
  }
  const ndm = localStorage.getItem('tn51_nelloDoublesMode');
  if(ndm && ['regular','doubles_only','player_chooses'].includes(ndm)){
    nelloDoublesMode = ndm;
    document.querySelectorAll('.gsNelloBtn').forEach(b => {
      b.style.border = 'none'; b.classList.remove('gsNelloSelected');
      if(b.dataset.nello === ndm){ b.style.border = '2px solid #fff'; b.classList.add('gsNelloSelected'); }
    });
  }
  // Restore Doubles Follow Me
  const dfm = localStorage.getItem('tn51_doublesFollowMe');
  if(dfm && ['on','off','player_chooses'].includes(dfm)){
    doublesFollowMe = dfm;
    document.querySelectorAll('.gsDfmBtn').forEach(b => {
      b.style.border = 'none'; b.classList.remove('gsDfmSelected');
      if(b.dataset.dfm === dfm){ b.style.border = '2px solid #fff'; b.classList.add('gsDfmSelected'); }
    });
  }
})();

// Call for Double button bar handlers
document.getElementById('btnCallDouble').addEventListener('click', () => {
  document.getElementById('callDoubleBtnGroup').style.display = 'none';
  callForDoubleActive = true;
  session.game.force_double_trump = true;
  setStatus('Called for the double!');
  // V10_121 Host Authority: Guest sends intent and waits; host broadcasts confirmed + resumes
  if(MULTIPLAYER_MODE && !mpIsHost){
    // Guest: send intent to host. Host will broadcast play_confirmed + call_double_confirmed.
    // Guest does NOT call resumeAfterCallDouble — no pending animation on guest side.
    mpSendMove({ action: 'call_double_intent', seat: mpSeat, called: true });
    applyForcedDoubleGlow();
    return;
  }
  // Host MP path: broadcast confirmed + deferred play_confirmed via resumeAfterCallDouble
  if(MULTIPLAYER_MODE && mpIsHost){
    mpSendMove({ action: 'call_double_confirmed', called: true, seat: mpSeat });
    // Deferred play_confirmed will be sent by resumeAfterCallDouble
  }
  // Apply blue glow to forced double tile in other players' hands
  applyForcedDoubleGlow();
  // Resume the paused lead animation + continue play
  resumeAfterCallDouble();
});

document.getElementById('btnPlayRegular').addEventListener('click', () => {
  document.getElementById('callDoubleBtnGroup').style.display = 'none';
  callForDoubleActive = false;
  session.game.force_double_trump = false;
  // V10_121 Host Authority: Guest sends intent and waits; host broadcasts confirmed + resumes
  if(MULTIPLAYER_MODE && !mpIsHost){
    // Guest: send intent to host. Host will broadcast play_confirmed + call_double_confirmed.
    mpSendMove({ action: 'call_double_intent', seat: mpSeat, called: false });
    return;
  }
  // Host MP path: broadcast confirmed + deferred play_confirmed via resumeAfterCallDouble
  if(MULTIPLAYER_MODE && mpIsHost){
    mpSendMove({ action: 'call_double_confirmed', called: false, seat: mpSeat });
  }
  // Resume the paused lead animation + continue play
  resumeAfterCallDouble();
});

// CALLED FOR DOUBLE banner click handler (for player who has the double)
document.getElementById('callDoubleBannerBtn').addEventListener('click', () => {
  const banner = document.getElementById('callDoubleBanner');
  if(!banner.classList.contains('clickable')) return; // Only clickable for double holder
  banner.style.display = 'none';
  // Auto-play the double trump tile
  const localSeat = getLocalSeat();
  const trumpPip = session.game.trump_suit;
  const hand = session.game.hands[localSeat] || [];
  const p1Sprites = sprites[localSeat] || [];
  for(let i = 0; i < p1Sprites.length; i++){
    const data = p1Sprites[i];
    if(data && data.tile && data.tile[0] === trumpPip && data.tile[1] === trumpPip){
      // Found the double trump - simulate click
      handlePlayer1Click(i);
      return;
    }
  }
});

// Nello Doubles Choice popup handlers
document.getElementById('btnNelloRegular').addEventListener('click', () => {
  document.getElementById('nelloDoublesBackdrop').style.display = 'none';
  nelloDoublesSuitActive = false;
  session.game.nello_doubles_suit = false;
  if(MULTIPLAYER_MODE){
    if(!mpIsHost){
      // Guest: send intent to host
      mpSendMove({ action: 'nello_doubles_intent', mode: 'regular', seat: mpSeat });
    } else {
      // Host: apply locally + broadcast confirmed
      mpSendMove({ action: 'nello_doubles_confirmed', mode: 'regular' });
    }
  }
  resumeAfterNelloDoublesChoice();
});

document.getElementById('btnNelloDoublesOnly').addEventListener('click', () => {
  document.getElementById('nelloDoublesBackdrop').style.display = 'none';
  nelloDoublesSuitActive = true;
  session.game.nello_doubles_suit = true;
  if(MULTIPLAYER_MODE){
    if(!mpIsHost){
      // Guest: send intent to host
      mpSendMove({ action: 'nello_doubles_intent', mode: 'doubles_only', seat: mpSeat });
    } else {
      // Host: apply locally + broadcast confirmed
      mpSendMove({ action: 'nello_doubles_confirmed', mode: 'doubles_only' });
    }
  }
  resumeAfterNelloDoublesChoice();
});

// V12.2: Built-in device presets




// Section 2 (Orientation & Persistence IIFE) moved to orientation.js

// Section 3 (Popup Config IIFE) moved to popup-config.js

// ============================================================
// TX42-CLIENT: Multiplayer-Only Initialization Override
// ============================================================
(function tx42ClientInit(){
  // Force T42 mode
  GAME_MODE = 'T42';
  MULTIPLAYER_MODE = true;

  // Hide any start/splash/game-select screens that the original code may show
  function hideAllScreens(){
    ['splashScreen','startScreenBackdrop','gameSelectScreen','gameSettingsBackdrop'].forEach(function(id){
      var el = document.getElementById(id);
      if(el) el.style.display = 'none';
    });
  }

  // Initialize T42 layout
  if(typeof initGameMode === 'function') initGameMode('T42');

  // Wait for DOM to be ready, then set up
  function onReady(){
    try {
    hideAllScreens();

    // Prompt for name if not set
    var savedName = '';
    try { savedName = localStorage.getItem('tn51_player_name') || ''; } catch(e){}
    playerName = savedName;

    if(!playerName){
      // Show name entry
      var nameBackdrop = document.getElementById('nameEntryBackdrop');
      if(nameBackdrop){
        nameBackdrop.style.display = 'flex';
        var nameInput = document.getElementById('nameInput');
        var nameBtn = document.getElementById('nameConfirmBtn');
        if(nameInput) setTimeout(function(){ nameInput.focus(); }, 200);
        if(nameBtn){
          nameBtn.addEventListener('click', function(){
            var val = (nameInput ? nameInput.value.trim() : '') || 'Player';
            playerName = val;
            try { localStorage.setItem('tn51_player_name', val); } catch(e){}
            nameBackdrop.style.display = 'none';
            showMultiplayerLobby();
          });
        }
        if(nameInput){
          nameInput.addEventListener('keydown', function(e){
            if(e.key === 'Enter'){
              e.preventDefault();
              if(nameBtn) nameBtn.click();
            }
          });
        }
      } else {
        playerName = 'Player';
        showMultiplayerLobby();
      }
    } else {
      showMultiplayerLobby();
    }

    // Show the player name display
    var pnd = document.getElementById('playerNameDisplay');
    if(pnd && playerName){
      pnd.textContent = playerName;
      pnd.style.display = 'block';
    }
    } catch(err) {
      console.error('[TX42-Client] Init error:', err);
      document.title = 'ERROR: ' + err.message;
      // Force show lobby anyway
      var mpb = document.getElementById('mpBackdrop');
      if(mpb) mpb.style.display = 'flex';
    }
  }

  function showMultiplayerLobby(){
    // Show multiplayer setup modal
    var mpBackdrop = document.getElementById('mpBackdrop');
    if(mpBackdrop) mpBackdrop.style.display = 'flex';

    // Initialize T42 layout settings
    if(typeof applyT42Settings === 'function') applyT42Settings();
    if(typeof createPlaceholders === 'function') createPlaceholders();
    if(typeof positionPlayerIndicators === 'function') positionPlayerIndicators();

    // Build MP room buttons (via multiplayer.js)
    if(typeof mpBuildRoomButtons === 'function') mpBuildRoomButtons();
  }

  if(document.readyState === 'loading'){
    document.addEventListener('DOMContentLoaded', onReady);
  } else {
    // Small delay to let other scripts initialize
    setTimeout(onReady, 100);
  }
})();
