// ============================================================
// TX-Dom-Dev — sfx.js
// Sound System extracted from game.js v13.5.0
// ============================================================

/******************************************************************************
 * SOUND SYSTEM - Embedded audio with variation
 ******************************************************************************/
const SOUND_DATA = {
  click: "./assets/audio/sfx-click.mp3",
  play1: "./assets/audio/sfx-play1.mp3",
  play3: "./assets/audio/sfx-play3.mp3",
  shuffle: "./assets/audio/sfx-shuffle.mp3",
  invalid: "./assets/audio/sfx-invalid.mp3",
  collect: "./assets/audio/sfx-collect.mp3"
};

const SFX = {
  ctx: null,
  buffers: {},
  ready: false,
  sfxMuted: false,
  sfxVolume: 0.7,
  bgmMuted: false,
  bgmVolume: 0.5,
  resultPlaying: false,  // Whether a result song is currently playing

  // Variation settings (client specified ±10% for all)
  PITCH_VAR: 0.10,
  VOL_VAR: 0.10,
  SPEED_VAR: 0.10,

  async init(){
    if(this.ready) return;
    try {
      if(!this.ctx) this.ctx = new (window.AudioContext || window.webkitAudioContext)();
      if(this.ctx.state === 'suspended') await this.ctx.resume();
      for(const [key, url] of Object.entries(SOUND_DATA)){
        if(!this.buffers[key]){
          const resp = await fetch(url);
          const buf = await resp.arrayBuffer();
          this.buffers[key] = await this.ctx.decodeAudioData(buf);
        }
      }
      this.ready = true;
      // Load saved SFX volume
      const savedSfx = localStorage.getItem('tn51_sfx_volume');
      if(savedSfx !== null){
        this.sfxVolume = parseFloat(savedSfx);
        const slider = document.getElementById('sfxVolume');
        if(slider) slider.value = Math.round(this.sfxVolume * 100);
      }
      const savedSfxMute = localStorage.getItem('tn51_sfx_muted');
      if(savedSfxMute === 'true'){
        this.sfxMuted = true;
      }
      // Load saved BGM volume
      const savedBgm = localStorage.getItem('tn51_bgm_volume');
      if(savedBgm !== null){
        this.bgmVolume = parseFloat(savedBgm);
        const slider2 = document.getElementById('bgmVolume');
        if(slider2) slider2.value = Math.round(this.bgmVolume * 100);
      }
      const savedBgmMute = localStorage.getItem('tn51_bgm_muted');
      if(savedBgmMute === 'true'){
        this.bgmMuted = true;
      }
      this.updateSfxIcon();
      this.updateBgmIcon();
    } catch(e){
      console.error('SFX init error:', e);
    }
  },

  play(soundId, volumeBoost = 1.0){
    if(!this.ready || this.sfxMuted) return;
    const buffer = this.buffers[soundId];
    if(!buffer) return;

    const pitchShift = 1 + (Math.random() * 2 - 1) * this.PITCH_VAR;
    const volShift = 1 + (Math.random() * 2 - 1) * this.VOL_VAR;
    const speedShift = 1 + (Math.random() * 2 - 1) * this.SPEED_VAR;

    const source = this.ctx.createBufferSource();
    source.buffer = buffer;
    source.playbackRate.value = pitchShift * speedShift;

    const gain = this.ctx.createGain();
    gain.gain.value = Math.min(2.0, this.sfxVolume * volShift * volumeBoost);

    source.connect(gain);
    gain.connect(this.ctx.destination);
    source.start();
  },

  playDomino(){
    // Randomly pick between sound 1 and sound 3
    const pick = Math.random() < 0.5 ? 'play1' : 'play3';
    this.play(pick);
  },

  playShuffle(){
    this.play('shuffle', 1.15);  // 15% louder than other sounds
  },

  playCollect(){
    if(!this.ready || this.sfxMuted) return;
    const buffer = this.buffers['collect'];
    if(!buffer) return;
    const source = this.ctx.createBufferSource();
    source.buffer = buffer;
    const gain = this.ctx.createGain();
    gain.gain.value = this.sfxVolume;
    source.connect(gain);
    gain.connect(this.ctx.destination);
    source.start();
  },


  // Synthesized UI sounds (generated on the fly via Web Audio API)
  playButtonClick(){
    if(!this.ready || this.sfxMuted || !this.ctx) return;
    const buffer = this.buffers['click'];
    if(!buffer) return;
    const source = this.ctx.createBufferSource();
    source.buffer = buffer;
    const gain = this.ctx.createGain();
    gain.gain.value = this.sfxVolume * 0.4;  // Faint but audible
    source.connect(gain);
    gain.connect(this.ctx.destination);
    source.start();
  },

  // V10_109: Invalid selection sound
  playInvalid(){
    this.play('invalid', 0.8);
  },





  // --- SFX volume ---
  setSfxVolume(v){
    this.sfxVolume = Math.max(0, Math.min(2, v));  // Up to 200%
    // V10_122e: Wrap localStorage in try-catch for iOS Safari private mode
    try {
      localStorage.setItem('tn51_sfx_volume', this.sfxVolume.toString());
    } catch(e) {
      console.warn('[iOS] localStorage write error:', e);
    }
    this.updateSfxIcon();
  },
  toggleSfxMute(){
    this.sfxMuted = !this.sfxMuted;
    // V10_122e: Wrap localStorage in try-catch for iOS Safari private mode
    try {
      localStorage.setItem('tn51_sfx_muted', this.sfxMuted.toString());
    } catch(e) {
      console.warn('[iOS] localStorage write error:', e);
    }
    this.updateSfxIcon();
  },
  updateSfxIcon(){
    const icon = document.getElementById('sfxIcon');
    if(icon) icon.textContent = this.sfxMuted ? '🔇' : (this.sfxVolume < 0.3 ? '🔈' : this.sfxVolume < 0.7 ? '🔉' : '🔊');
  },

  // --- BGM volume ---
  setBgmVolume(v){
    this.bgmVolume = Math.max(0, Math.min(1, v));
    // V10_122e: Wrap localStorage in try-catch for iOS Safari private mode
    try {
      localStorage.setItem('tn51_bgm_volume', this.bgmVolume.toString());
    } catch(e) {
      console.warn('[iOS] localStorage write error:', e);
    }
    this.applyBgmVolume();
    this.updateBgmIcon();
  },
  toggleBgmMute(){
    this.bgmMuted = !this.bgmMuted;
    // V10_122e: Wrap localStorage in try-catch for iOS Safari private mode
    try {
      localStorage.setItem('tn51_bgm_muted', this.bgmMuted.toString());
    } catch(e) {
      console.warn('[iOS] localStorage write error:', e);
    }
    this.applyBgmVolume();
    this.updateBgmIcon();
  },
  applyBgmVolume(){
    const vol = this.bgmMuted ? 0 : this.bgmVolume;
    if(this.bgmGain) this.bgmGain.gain.value = vol;
    if(this.resultGain) this.resultGain.gain.value = vol;
  },
  updateBgmIcon(){
    const icon = document.getElementById('bgmIcon');
    if(icon) icon.textContent = this.bgmMuted ? '🔇' : (this.bgmVolume < 0.3 ? '🔈' : this.bgmVolume < 0.7 ? '🔉' : '🔊');
  },

  // =============================================
  // BGM MANAGER - Background Music + Result Songs
  // =============================================
  bgmTracks: [],          // [{name, filename, buffer}] - discovered tracks
  bgmPlaylist: [],        // indices into bgmTracks of selected songs
  bgmLoopMode: 'all',     // 'one', 'selected', 'all'
  bgmCurrentIdx: 0,       // current position in playlist
  bgmPlaying: false,


  // Embedded music data (base64)
  MUSIC_DATA: {
    bgm1: "./assets/audio/bgm1.mp3",
    bgm2: "./assets/audio/bgm2.mp3",
    bgm3: "./assets/audio/bgm3.mp3",
    win_song: "./assets/audio/win-song.mp3",
    lose_song: "./assets/audio/lose-song.mp3"
  },
  // Track display names
  BGM_TRACK_LIST: [
    {key: 'bgm1', name: 'TN51bgmusic'},
    {key: 'bgm2', name: 'TN51bgmusic 19'},
    {key: 'bgm3', name: 'TN51bgmusic 22'},
  ],

  // Initialize BGM - set up tracks from embedded data
  async initBgm(){
    if(!this.ctx) return;

    // Build track list from embedded data
    this.bgmTracks = this.BGM_TRACK_LIST.map(t => ({
      name: t.name,
      dataUri: this.MUSIC_DATA[t.key],
    }));

    // Restore saved selection
    this.loadBgmSelection();

    // Build the UI
    this.buildBgmUI();

    // Auto-start if we have a selection
    if(this.bgmPlaylist.length > 0){
      this.startBgmPlaylist();
    }
  },

  // Save/load BGM selection
  saveBgmSelection(){
    const data = {
      loopMode: this.bgmLoopMode,
      selected: this.bgmPlaylist,
    };
    // V10_122e: Wrap localStorage in try-catch for iOS Safari private mode
    try {
      localStorage.setItem('tn51_bgm_selection', JSON.stringify(data));
    } catch(e) {
      console.warn('[iOS] localStorage write error:', e);
    }
  },

  loadBgmSelection(){
    try {
      const raw = localStorage.getItem('tn51_bgm_selection');
      if(!raw) return;
      const data = JSON.parse(raw);
      this.bgmLoopMode = data.loopMode || 'all';
      // Validate indices against current tracks
      if(data.selected && Array.isArray(data.selected)){
        this.bgmPlaylist = data.selected.filter(i => i >= 0 && i < this.bgmTracks.length);
      }
      if(this.bgmLoopMode === 'all'){
        this.bgmPlaylist = this.bgmTracks.map((_, i) => i);
      }
    } catch(e){}
  },

  // Build BGM selector UI
  buildBgmUI(){
    const container = document.getElementById('bgmTrackList');
    if(!container) return;

    if(this.bgmTracks.length === 0){
      container.innerHTML = '<div style="color:#888;font-size:11px;padding:4px 0;">No music files found</div>';
      return;
    }

    let html = '';

    // Loop mode selector
    html += '<div style="display:flex;gap:4px;margin-bottom:6px;flex-wrap:wrap;">';
    const modes = [{val:'all',lbl:'Loop All'},{val:'selected',lbl:'Loop Selected'},{val:'one',lbl:'Loop One'}];
    modes.forEach(m => {
      const active = this.bgmLoopMode === m.val;
      html += `<button class="bgmModeBtn" data-mode="${m.val}" style="
        padding:2px 8px;font-size:10px;border:1px solid ${active ? '#3b82f6' : '#555'};
        border-radius:10px;background:${active ? '#3b82f6' : 'transparent'};
        color:${active ? '#fff' : '#aaa'};cursor:pointer;
      ">${m.lbl}</button>`;
    });
    html += '</div>';

    // Track list with checkboxes
    this.bgmTracks.forEach((track, i) => {
      const checked = this.bgmPlaylist.includes(i);
      const playing = this.bgmPlaying && this.bgmPlaylist[this.bgmCurrentIdx] === i;
      html += `<div style="display:flex;align-items:center;gap:6px;padding:2px 0;">
        <input type="checkbox" class="bgmTrackCb" data-idx="${i}" ${checked ? 'checked' : ''} style="accent-color:#3b82f6;">
        <span style="font-size:11px;color:${playing ? '#3b82f6' : '#ccc'};flex:1;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;">
          ${playing ? '♪ ' : ''}${track.name}
        </span>
      </div>`;
    });

    container.innerHTML = html;

    // Event listeners for mode buttons
    container.querySelectorAll('.bgmModeBtn').forEach(btn => {
      btn.addEventListener('click', (e) => {
        e.stopPropagation();
        this.bgmLoopMode = btn.dataset.mode;
        if(this.bgmLoopMode === 'all'){
          this.bgmPlaylist = this.bgmTracks.map((_, i) => i);
        }
        this.saveBgmSelection();
        this.buildBgmUI();
        if(this.bgmTracks.length > 0 && this.bgmPlaylist.length > 0){
          this.startBgmPlaylist();
        }
      });
    });

    // Event listeners for track checkboxes
    container.querySelectorAll('.bgmTrackCb').forEach(cb => {
      cb.addEventListener('change', (e) => {
        e.stopPropagation();
        const idx = parseInt(cb.dataset.idx);
        if(cb.checked){
          if(!this.bgmPlaylist.includes(idx)) this.bgmPlaylist.push(idx);
        } else {
          this.bgmPlaylist = this.bgmPlaylist.filter(x => x !== idx);
        }
        this.bgmPlaylist.sort((a,b) => a - b);
        // If in 'all' mode and user unchecks, switch to 'selected'
        if(this.bgmLoopMode === 'all' && !cb.checked){
          this.bgmLoopMode = 'selected';
        }
        this.saveBgmSelection();
        this.buildBgmUI();
        if(this.bgmPlaylist.length > 0){
          this.startBgmPlaylist();
        } else {
          this.stopBgm();
        }
      });
    });
  },

  // --- BGM Playlist Playback (Audio element routed through Web Audio GainNode) ---
  bgmAudio: null,
  bgmGain: null,
  bgmMediaSource: null,

  startBgmPlaylist(){
    this.stopBgm();
    if(this.bgmPlaylist.length === 0) return;
    if(this.bgmCurrentIdx >= this.bgmPlaylist.length) this.bgmCurrentIdx = 0;
    this.playBgmTrack(this.bgmCurrentIdx);
  },

  playBgmTrack(playlistIdx){
    this.stopBgm();
    if(this.bgmPlaylist.length === 0 || !this.ctx) return;
    this.bgmCurrentIdx = playlistIdx % this.bgmPlaylist.length;
    const trackIdx = this.bgmPlaylist[this.bgmCurrentIdx];
    const track = this.bgmTracks[trackIdx];
    if(!track) return;

    this.bgmAudio = new Audio(track.dataUri);

    if(this.bgmLoopMode === 'one' || this.bgmPlaylist.length === 1){
      this.bgmAudio.loop = true;
    } else {
      this.bgmAudio.loop = false;
      this.bgmAudio.onended = () => {
        if(this.bgmPlaying){
          this.bgmCurrentIdx = (this.bgmCurrentIdx + 1) % this.bgmPlaylist.length;
          this.playBgmTrack(this.bgmCurrentIdx);
          this.buildBgmUI();
        }
      };
    }

    // Route through Web Audio API GainNode for reliable volume control
    this.bgmMediaSource = this.ctx.createMediaElementSource(this.bgmAudio);
    this.bgmGain = this.ctx.createGain();
    this.bgmGain.gain.value = this.bgmMuted ? 0 : this.bgmVolume;
    this.bgmMediaSource.connect(this.bgmGain);
    this.bgmGain.connect(this.ctx.destination);

    this.bgmAudio.play().catch(e => console.log('BGM play error:', e));
    this.bgmPlaying = true;
    this.buildBgmUI();
  },

  stopBgm(){
    this.bgmPlaying = false;
    if(this.bgmAudio){
      this.bgmAudio.onended = null;
      this.bgmAudio.pause();
      this.bgmAudio.src = '';
      this.bgmAudio = null;
    }
    if(this.bgmMediaSource){
      try{ this.bgmMediaSource.disconnect(); }catch(e){}
      this.bgmMediaSource = null;
    }
    if(this.bgmGain){
      try{ this.bgmGain.disconnect(); }catch(e){}
      this.bgmGain = null;
    }
  },

  // --- Result song (win/lose) routed through GainNode ---
  resultAudio: null,
  resultGain: null,
  resultMediaSource: null,

  playResultSong(type){
    if(!this.ctx) return;
    const key = type === 'win' ? 'win_song' : 'lose_song';
    const dataUri = this.MUSIC_DATA[key];
    if(!dataUri) return;

    // Fade out BGM over 1 second then stop
    if(this.bgmGain && this.bgmPlaying){
      const now = this.ctx.currentTime;
      this.bgmGain.gain.setValueAtTime(this.bgmGain.gain.value, now);
      this.bgmGain.gain.linearRampToValueAtTime(0, now + 1.0);
      setTimeout(() => this.stopBgm(), 1100);
    } else {
      this.stopBgm();
    }

    // Start result song after brief delay for fade
    setTimeout(() => {
      this.stopResultSong();
      this.resultAudio = new Audio(dataUri);
      this.resultAudio.loop = true;

      this.resultMediaSource = this.ctx.createMediaElementSource(this.resultAudio);
      this.resultGain = this.ctx.createGain();
      // Fade in over 1 second
      this.resultGain.gain.setValueAtTime(0, this.ctx.currentTime);
      this.resultGain.gain.linearRampToValueAtTime(
        this.bgmMuted ? 0 : this.bgmVolume, this.ctx.currentTime + 1.0
      );
      this.resultMediaSource.connect(this.resultGain);
      this.resultGain.connect(this.ctx.destination);

      this.resultAudio.play().catch(e => console.log('Result song error:', e));
      this.resultPlaying = true;
    }, 500);
  },

  stopResultSong(){
    if(this.resultAudio){
      this.resultAudio.pause();
      this.resultAudio.src = '';
      this.resultAudio = null;
    }
    if(this.resultMediaSource){
      try{ this.resultMediaSource.disconnect(); }catch(e){}
      this.resultMediaSource = null;
    }
    if(this.resultGain){
      try{ this.resultGain.disconnect(); }catch(e){}
      this.resultGain = null;
    }
    this.resultPlaying = false;
  },

  // Called when starting a new game - stop result song, resume BGM
  resumeBgmAfterResult(){
    if(this.resultPlaying){
      if(this.resultGain && this.ctx){
        const now = this.ctx.currentTime;
        this.resultGain.gain.setValueAtTime(this.resultGain.gain.value, now);
        this.resultGain.gain.linearRampToValueAtTime(0, now + 0.5);
        setTimeout(() => {
          this.stopResultSong();
          if(this.bgmPlaylist.length > 0){
            this.startBgmPlaylist();
          }
        }, 600);
      } else {
        this.stopResultSong();
        if(this.bgmPlaylist.length > 0){
          this.startBgmPlaylist();
        }
      }
    }
  }
};

// Init sound on first user interaction
document.addEventListener('click', () => { SFX.init().then(() => SFX.initBgm()); }, { once: true });
document.addEventListener('touchstart', () => { SFX.init().then(() => SFX.initBgm()); }, { once: true });
