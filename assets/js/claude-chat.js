// ============================================================
// Claude Chat — Direct chat overlay via WebSocket relay
// TX42-Client version — connects to tx42-server.onrender.com
// ============================================================

(function() {
  'use strict';

  const CC_WS_URL = 'wss://tx42-server.onrender.com';
  const CC_ROOM = 'ClaudeChat';
  const CC_ALLOWED_NAME = 'johnjohn';
  const CC_HEARTBEAT_MS = 15000;

  let ccSocket = null;
  let ccConnected = false;
  let ccReconnectTimer = null;
  let ccHeartbeatTimer = null;
  let ccReconnectDelay = 1000;
  let ccOpen = false;

  // ---- UI Toggle ----
  window.claudeChatToggle = function() {
    const backdrop = document.getElementById('claudeChatBackdrop');
    if (!backdrop) return;

    if (ccOpen) {
      backdrop.style.display = 'none';
      ccOpen = false;
      claudeChatDisconnect();
    } else {
      backdrop.style.display = 'flex';
      ccOpen = true;

      // Check access
      const name = (typeof playerName !== 'undefined' && playerName) ? playerName : '';
      if (name.toLowerCase() !== CC_ALLOWED_NAME) {
        claudeChatAddMessage('System', 'Claude Chat is not available for this account.', false, true);
        ccUpdateStatus('disconnected');
        return;
      }
      claudeChatConnect();
      // Focus input
      const input = document.getElementById('claudeChatInput');
      if (input) setTimeout(() => input.focus(), 100);
    }
  };

  // ---- Connection ----
  window.claudeChatConnect = function() {
    if (ccSocket && (ccSocket.readyState === WebSocket.OPEN || ccSocket.readyState === WebSocket.CONNECTING)) return;

    const name = (typeof playerName !== 'undefined' && playerName) ? playerName : 'Player';
    ccUpdateStatus('connecting');

    try {
      ccSocket = new WebSocket(CC_WS_URL);
    } catch (e) {
      console.error('[ClaudeChat] WebSocket create error:', e);
      ccUpdateStatus('disconnected');
      ccScheduleReconnect();
      return;
    }

    ccSocket.onopen = function() {
      console.log('[ClaudeChat] Connected');
      ccConnected = true;
      ccReconnectDelay = 1000;
      ccUpdateStatus('connected');

      // Join room
      ccSocket.send(JSON.stringify({ type: 'join', room: CC_ROOM }));
      // Hello
      ccSocket.send(JSON.stringify({ type: 'chat', room: CC_ROOM, seat: 0, name: name, text: '** joined Claude Chat **', t: Date.now() }));

      // Heartbeat
      clearInterval(ccHeartbeatTimer);
      ccHeartbeatTimer = setInterval(function() {
        if (ccSocket && ccSocket.readyState === WebSocket.OPEN) {
          ccSocket.send(JSON.stringify({ type: 'ping', room: CC_ROOM }));
        }
      }, CC_HEARTBEAT_MS);
    };

    ccSocket.onmessage = function(event) {
      try {
        const msg = JSON.parse(event.data);
        if (msg.type === 'chat') {
          const selfName = (typeof playerName !== 'undefined' && playerName) ? playerName : 'Player';
          const isSelf = msg.name && msg.name.toLowerCase() === selfName.toLowerCase();
          // Skip own messages -- already shown locally on send
          if (!isSelf) {
            claudeChatAddMessage(msg.name || 'Unknown', msg.text || '', false, false);
          }
        }
      } catch (e) {
        // ignore non-JSON
      }
    };

    ccSocket.onclose = function() {
      console.log('[ClaudeChat] Disconnected');
      ccConnected = false;
      ccUpdateStatus('disconnected');
      clearInterval(ccHeartbeatTimer);
      if (ccOpen) ccScheduleReconnect();
    };

    ccSocket.onerror = function(err) {
      console.error('[ClaudeChat] WebSocket error:', err);
      ccUpdateStatus('disconnected');
    };
  };

  window.claudeChatDisconnect = function() {
    clearTimeout(ccReconnectTimer);
    clearInterval(ccHeartbeatTimer);
    ccReconnectTimer = null;
    if (ccSocket) {
      try { ccSocket.close(); } catch (e) {}
      ccSocket = null;
    }
    ccConnected = false;
    ccUpdateStatus('disconnected');
  };

  function ccScheduleReconnect() {
    if (ccReconnectTimer) return;
    ccReconnectTimer = setTimeout(function() {
      ccReconnectTimer = null;
      if (ccOpen) claudeChatConnect();
    }, ccReconnectDelay);
    ccReconnectDelay = Math.min(ccReconnectDelay * 2, 30000);
  }

  // ---- Send ----
  window.claudeChatSend = function() {
    const input = document.getElementById('claudeChatInput');
    if (!input) return;
    const text = input.value.trim();
    if (!text) return;
    if (!ccSocket || ccSocket.readyState !== WebSocket.OPEN) return;

    const name = (typeof playerName !== 'undefined' && playerName) ? playerName : 'Player';
    ccSocket.send(JSON.stringify({
      type: 'chat',
      room: CC_ROOM,
      seat: 0,
      name: name,
      text: text,
      t: Date.now()
    }));

    // Show own message locally
    claudeChatAddMessage(name, text, true, false);

    input.value = '';
    input.focus();
  };

  // ---- Display ----
  window.claudeChatAddMessage = function(name, text, isSelf, isSystem) {
    const container = document.getElementById('claudeChatMessages');
    if (!container) return;

    const div = document.createElement('div');
    div.className = 'claude-chat-msg' + (isSelf ? ' claude-chat-msg-self' : '') + (isSystem ? ' claude-chat-msg-system' : '');

    const time = new Date();
    const timeStr = time.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });

    if (isSystem) {
      div.innerHTML = '<span class="claude-chat-msg-text-system">' + escapeHtml(text) + '</span>';
    } else {
      div.innerHTML =
        '<div class="claude-chat-msg-header">' +
          '<span class="claude-chat-msg-name">' + escapeHtml(name) + '</span>' +
          '<span class="claude-chat-msg-time">' + timeStr + '</span>' +
        '</div>' +
        '<div class="claude-chat-msg-text">' + escapeHtml(text) + '</div>';
    }

    container.appendChild(div);
    container.scrollTop = container.scrollHeight;
  };

  function ccUpdateStatus(state) {
    const el = document.getElementById('claudeChatStatus');
    if (!el) return;
    el.className = 'claude-chat-status claude-chat-status-' + state;
    const textEl = el.querySelector('.claude-chat-status-text');
    if (textEl) {
      textEl.textContent = state === 'connected' ? 'Connected' : state === 'connecting' ? 'Connecting...' : 'Disconnected';
    }
  }

  function escapeHtml(str) {
    const d = document.createElement('div');
    d.textContent = str;
    return d.innerHTML;
  }

  // ---- Event Listeners ----
  document.addEventListener('DOMContentLoaded', function() {
    const closeBtn = document.getElementById('claudeChatCloseBtn');
    if (closeBtn) {
      closeBtn.addEventListener('click', function() {
        claudeChatToggle();
      });
    }

    const backdrop = document.getElementById('claudeChatBackdrop');
    if (backdrop) {
      backdrop.addEventListener('click', function(e) {
        if (e.target === backdrop) claudeChatToggle();
      });
    }

    const sendBtn = document.getElementById('claudeChatSendBtn');
    if (sendBtn) {
      sendBtn.addEventListener('click', function() {
        claudeChatSend();
      });
    }

    const input = document.getElementById('claudeChatInput');
    if (input) {
      input.addEventListener('keydown', function(e) {
        if (e.key === 'Enter') {
          e.preventDefault();
          claudeChatSend();
        }
      });
    }
  });

})();
