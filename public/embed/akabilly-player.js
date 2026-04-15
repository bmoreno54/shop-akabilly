/**
 * akabilly embeddable player
 * 
 * Usage:
 *   <div id="akabilly-player" 
 *        data-src="https://shop.akabilly.com/audio/lode.mp3"
 *        data-title="lode"
 *        data-artist="akabilly"
 *        data-trail="true">
 *   </div>
 *   <script src="https://shop.akabilly.com/embed/akabilly-player.js"></script>
 * 
 * Options (data attributes):
 *   data-src       — audio URL (required)
 *   data-title     — track title
 *   data-artist    — artist name (default: akabilly)
 *   data-trail     — opt-in to trail networking (default: false)
 *   data-theme     — "dark" (default) or "light"
 *   data-accent    — hex color for waveform progress (default: #d4a853)
 *   data-callback  — JS callback name for play events
 * 
 * Trail networking:
 *   When data-trail="true", play/pause/seek/finish events are sent
 *   to the akabilly DSD trail endpoint. This feeds listening trails
 *   back into the graph as user-path edges, connecting the embedded
 *   context to the akabilly ecosystem. The referrer URL becomes a
 *   node, creating cross-site graph connections.
 * 
 *   No personal data is collected. Trail events contain:
 *   - track slug, event type, referrer URL, timestamp
 *   - anonymous session hash (no cookies, no tracking)
 * 
 * API:
 *   window.akabillyPlayer.play()
 *   window.akabillyPlayer.pause()
 *   window.akabillyPlayer.seek(seconds)
 *   window.akabillyPlayer.on(event, callback)
 *   window.akabillyPlayer.off(event, callback)
 */
(function() {
  'use strict';

  const TRAIL_ENDPOINT = 'https://shop.akabilly.com/api/trail';
  const WAVESURFER_CDN = 'https://cdn.jsdelivr.net/npm/wavesurfer.js@7/dist/wavesurfer.esm.js';

  const containers = document.querySelectorAll(
    '[id="akabilly-player"], [data-akabilly-player]'
  );
  if (!containers.length) return;
  // Generate anonymous session hash (no cookies)
  function sessionHash() {
    var nav = navigator.userAgent + screen.width + screen.height;
    var hash = 0;
    for (var i = 0; i < nav.length; i++) {
      hash = ((hash << 5) - hash) + nav.charCodeAt(i);
      hash |= 0;
    }
    return 'anon-' + Math.abs(hash).toString(36);
  }

  // Event emitter
  function Emitter() {
    this._listeners = {};
  }
  Emitter.prototype.on = function(evt, fn) {
    (this._listeners[evt] = this._listeners[evt] || []).push(fn);
    return this;
  };
  Emitter.prototype.off = function(evt, fn) {
    var arr = this._listeners[evt];
    if (arr) this._listeners[evt] = arr.filter(function(f) { return f !== fn; });
    return this;
  };
  Emitter.prototype.emit = function(evt, data) {
    (this._listeners[evt] || []).forEach(function(fn) { fn(data); });
  };
  // Trail reporter
  function TrailReporter(slug) {
    this.slug = slug;
    this.session = sessionHash();
    this.referrer = window.location.href;
    this.enabled = false;
  }
  TrailReporter.prototype.send = function(eventType, extra) {
    if (!this.enabled) return;
    var payload = {
      slug: this.slug,
      event: eventType,
      referrer: this.referrer,
      session: this.session,
      ts: new Date().toISOString()
    };
    if (extra) {
      for (var k in extra) payload[k] = extra[k];
    }
    // Fire-and-forget beacon
    if (navigator.sendBeacon) {
      navigator.sendBeacon(TRAIL_ENDPOINT, JSON.stringify(payload));
    } else {
      var xhr = new XMLHttpRequest();
      xhr.open('POST', TRAIL_ENDPOINT, true);
      xhr.setRequestHeader('Content-Type', 'application/json');
      xhr.send(JSON.stringify(payload));
    }
  };

  // Inject styles
  var style = document.createElement('style');
  style.textContent = [
    '.akb-player { font-family: Inter, system-ui, sans-serif; border-radius: 8px; padding: 12px 16px; display: flex; align-items: center; gap: 10px; }',
    '.akb-player.dark { background: #141414; border: 1px solid #2a2a2a; color: #e8e8e8; }',
    '.akb-player.light { background: #f5f5f5; border: 1px solid #ddd; color: #1a1a1a; }',
    '.akb-play-btn { background: none; border: none; cursor: pointer; padding: 4px; display: flex; width: 32px; height: 32px; align-items: center; justify-content: center; flex-shrink: 0; }',
    '.akb-player.dark .akb-play-btn { color: var(--akb-accent, #d4a853); }',
    '.akb-player.light .akb-play-btn { color: var(--akb-accent, #b8922e); }',
    '.akb-info { flex: 1; min-width: 0; }',
    '.akb-title { font-weight: 600; font-size: 13px; margin-bottom: 4px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }',
    '.akb-waveform { min-height: 28px; cursor: pointer; }',
    '.akb-time { display: flex; justify-content: space-between; font-size: 11px; margin-top: 2px; opacity: 0.5; }',
    '.akb-credit { font-size: 10px; opacity: 0.4; text-decoration: none; margin-left: 8px; white-space: nowrap; }',
    '.akb-player.dark .akb-credit { color: #e8e8e8; }',
    '.akb-player.light .akb-credit { color: #1a1a1a; }',
  ].join('\n');
  document.head.appendChild(style);
  function fmt(s) {
    var m = Math.floor(s / 60);
    var sec = Math.floor(s % 60);
    return m + ':' + (sec < 10 ? '0' : '') + sec;
  }

  function initPlayer(container) {
    var src = container.dataset.src;
    if (!src) return;
    var title = container.dataset.title || 'untitled';
    var artist = container.dataset.artist || 'akabilly';
    var trail = container.dataset.trail === 'true';
    var theme = container.dataset.theme || 'dark';
    var accent = container.dataset.accent || '#d4a853';
    var callbackName = container.dataset.callback;
    var slug = title.toLowerCase().replace(/[^a-z0-9]+/g, '-');

    var emitter = new Emitter();
    var reporter = new TrailReporter(slug);
    reporter.enabled = trail;

    // Build DOM
    container.className = 'akb-player ' + theme;
    container.style.setProperty('--akb-accent', accent);
    container.innerHTML = [
      '<button class="akb-play-btn" aria-label="Play">',
      '  <svg width="18" height="18" viewBox="0 0 20 20" fill="currentColor">',
      '    <polygon class="akb-icon-play" points="5,3 17,10 5,17" />',
      '    <g class="akb-icon-pause" style="display:none">',
      '      <rect x="4" y="3" width="4" height="14" />',
      '      <rect x="12" y="3" width="4" height="14" />',
      '    </g>',
      '  </svg>',
      '</button>',
      '<div class="akb-info">',
      '  <div class="akb-title">' + title + ' — ' + artist + '</div>',
      '  <div class="akb-waveform"></div>',
      '  <div class="akb-time"><span class="akb-current">0:00</span><span class="akb-duration">0:00</span></div>',
      '</div>',
      '<a class="akb-credit" href="https://shop.akabilly.com" target="_blank" rel="noopener">akabilly.com</a>',
    ].join('\n');

    var playBtn = container.querySelector('.akb-play-btn');
    var iconPlay = container.querySelector('.akb-icon-play');
    var iconPause = container.querySelector('.akb-icon-pause');
    var waveformEl = container.querySelector('.akb-waveform');
    var currentEl = container.querySelector('.akb-current');
    var durationEl = container.querySelector('.akb-duration');
    var waveColor = theme === 'dark' ? '#2a2a2a' : '#ccc';

    // Load wavesurfer dynamically
    import(WAVESURFER_CDN).then(function(mod) {
      var WaveSurfer = mod.default;
      var ws = WaveSurfer.create({
        container: waveformEl,
        url: src,
        height: 28,
        barWidth: 2,
        barGap: 1,
        barRadius: 1,
        waveColor: waveColor,
        progressColor: accent,
        cursorColor: accent,
        cursorWidth: 1,
        normalize: true,
      });
      ws.on('ready', function() { durationEl.textContent = fmt(ws.getDuration()); });
      ws.on('audioprocess', function() { currentEl.textContent = fmt(ws.getCurrentTime()); });
      ws.on('seeking', function() { currentEl.textContent = fmt(ws.getCurrentTime()); });

      ws.on('play', function() {
        iconPlay.style.display = 'none';
        iconPause.style.display = '';
        emitter.emit('play', { time: ws.getCurrentTime() });
        reporter.send('play', { time: ws.getCurrentTime() });
      });
      ws.on('pause', function() {
        iconPlay.style.display = '';
        iconPause.style.display = 'none';
        emitter.emit('pause', { time: ws.getCurrentTime() });
        reporter.send('pause', { time: ws.getCurrentTime() });
      });
      ws.on('finish', function() {
        iconPlay.style.display = '';
        iconPause.style.display = 'none';
        emitter.emit('finish', {});
        reporter.send('finish', {});
      });
      ws.on('seeking', function() {
        reporter.send('seek', { time: ws.getCurrentTime() });
      });

      playBtn.addEventListener('click', function() { ws.playPause(); });

      // Expose API
      var api = {
        play: function() { ws.play(); },
        pause: function() { ws.pause(); },
        seek: function(t) { ws.seekTo(t / ws.getDuration()); },
        getDuration: function() { return ws.getDuration(); },
        getCurrentTime: function() { return ws.getCurrentTime(); },
        on: function(e, fn) { emitter.on(e, fn); return api; },
        off: function(e, fn) { emitter.off(e, fn); return api; },
        setTrail: function(enabled) { reporter.enabled = !!enabled; },
      };

      window.akabillyPlayer = api;

      // Fire external callback if configured
      if (callbackName && typeof window[callbackName] === 'function') {
        window[callbackName](api);
      }

      emitter.emit('ready', api);
    });
  }

  containers.forEach(initPlayer);
})();