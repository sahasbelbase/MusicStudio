/**
 * Music Studio - Ultra-Clean Client Application
 */

document.addEventListener('DOMContentLoaded', () => {
  // ===== ANDROID PLATFORM INITIALIZATION =====
  if (/Android/i.test(navigator.userAgent)) {
    document.body.classList.add('platform-android');
  }

  // ==================== UNIVERSAL API & SERVER ROUTING ====================
  function getServerBaseUrl() {
    const custom = (localStorage.getItem('musicstudio_server_url') || '').trim();
    if (custom) return custom.replace(/\/+$/, '');
    return '';
  }

  function resolveApiUrl(path) {
    if (!path) return '';
    if (path.startsWith('http://') || path.startsWith('https://') || path.startsWith('blob:') || path.startsWith('data:')) {
      return path;
    }
    const base = getServerBaseUrl();
    const clean = path.startsWith('/') ? path : '/' + path;
    return base ? `${base}${clean}` : clean;
  }

  const nativeFetch = window.fetch.bind(window);
  window.fetch = function (input, init) {
    if (typeof input === 'string' && input.startsWith('/api/')) {
      input = resolveApiUrl(input);
    } else if (input instanceof Request && input.url.includes('/api/')) {
      // In case Request object is passed
    }
    return nativeFetch(input, init);
  };

  // DOM Elements
  const inputUrl = document.getElementById('input-url');
  const platformIcon = document.getElementById('platform-icon');
  const btnDownload = document.getElementById('btn-download');
  const btnPaste = document.getElementById('btn-paste');
  const btnStop = document.getElementById('btn-stop-download');
  const btnEnrichAll = document.getElementById('btn-enrich-all');
  const btnOpenFolder = document.getElementById('btn-open-folder');
  const btnRefreshLibrary = document.getElementById('btn-refresh-library');

  // Status & Telemetry
  const statusBadge = document.getElementById('status-badge');
  const metricPlaylistName = document.getElementById('metric-playlist-name');
  const metricStatusMsg = document.getElementById('metric-status-msg');
  const metricDownloaded = document.getElementById('metric-downloaded');
  const metricSkipped = document.getElementById('metric-skipped');
  const metricTotal = document.getElementById('metric-total');
  const metricPercent = document.getElementById('metric-percent');
  const metricSpeed = document.getElementById('metric-speed');
  const progressBar = document.getElementById('progress-bar');
  const streamFeed = document.getElementById('stream-feed');
  const navSongCount = document.getElementById('nav-song-count');
  const mobileNavSongCount = document.getElementById('mobile-nav-song-count');

  // Settings
  const settingThreads = document.getElementById('setting-threads');
  const settingQuality = document.getElementById('setting-quality');
  const settingSort = document.getElementById('setting-sort');
  const settingNaming = document.getElementById('setting-naming');

  // Library Elements
  const libraryContainer = document.getElementById('library-container');
  const librarySearch = document.getElementById('library-search');
  const btnClearSearch = document.getElementById('btn-clear-search');
  const libraryCountLabel = document.getElementById('library-count-label');
  const viewGridBtn = document.getElementById('view-grid-btn');
  const viewListBtn = document.getElementById('view-list-btn');

  // Drawer Elements
  const trackDrawer = document.getElementById('track-drawer');
  const drawerOverlay = document.getElementById('drawer-overlay');
  const drawerCloseBtn = document.getElementById('drawer-close-btn');
  const drawerCover = document.getElementById('drawer-cover');
  const drawerBitrate = document.getElementById('drawer-bitrate');
  const drawerTitle = document.getElementById('drawer-title');
  const drawerArtist = document.getElementById('drawer-artist');
  const drawerGenre = document.getElementById('drawer-genre');
  const drawerYear = document.getElementById('drawer-year');
  const drawerSize = document.getElementById('drawer-size');
  const drawerAlbum = document.getElementById('drawer-album');
  const drawerCollabRow = document.getElementById('drawer-collab-row');
  const drawerCollab = document.getElementById('drawer-collab');
  const drawerDuration = document.getElementById('drawer-duration');
  const drawerFilename = document.getElementById('drawer-filename');
  const drawerPlayBtn = document.getElementById('drawer-play-btn');
  const drawerDeleteBtn = document.getElementById('drawer-delete-btn');

  // Confirmation Modal Elements
  const confirmModal = document.getElementById('confirm-modal');
  const confirmModalBackdrop = document.getElementById('confirm-modal-backdrop');
  const confirmModalClose = document.getElementById('confirm-modal-close');
  const confirmModalTitle = document.getElementById('confirm-modal-title');
  const confirmModalMessage = document.getElementById('confirm-modal-message');
  const confirmModalDetails = document.getElementById('confirm-modal-details');
  const confirmModalItemTitle = document.getElementById('confirm-modal-item-title');
  const confirmModalItemSub = document.getElementById('confirm-modal-item-sub');
  const confirmModalCancelBtn = document.getElementById('confirm-modal-cancel-btn');
  const confirmModalActionBtn = document.getElementById('confirm-modal-action-btn');
  let currentConfirmCallback = null;

  // ==================== DUAL-DECK DJ AUDIO ENGINE & PROXY ====================
  // Supports Apple Music-style smooth genre transitions and live DJ crossfading
  const rawDeckA = document.getElementById('audio-engine');
  const rawDeckB = document.getElementById('audio-engine-secondary');
  let activeDeck = rawDeckA;
  let standbyDeck = rawDeckB;
  let currentMasterVolume = parseFloat(localStorage.getItem('musicstudio_volume') || localStorage.getItem('spotistudio_volume')) || 0.8;

  // Crossfade state
  let isCrossfading = false;
  let crossfadeAnimId = null;
  let crossfadeProgress = 0; // 0 to 1
  let crossfadeOutgoingDeck = null;
  let crossfadeIncomingDeck = null;
  let hasTriggeredAutoCrossfade = false;
  let isManualTransitionRequested = false;

  // Unified event dispatcher for the active deck
  const audioEventHandlers = {
    timeupdate: new Set(),
    loadedmetadata: new Set(),
    durationchange: new Set(),
    play: new Set(),
    pause: new Set(),
    ended: new Set(),
    error: new Set()
  };

  function dispatchAudioEvent(eventName, originalEvent) {
    const handlers = audioEventHandlers[eventName];
    if (handlers) {
      handlers.forEach(fn => {
        try {
          fn(originalEvent);
        } catch (e) {
          console.error(`Error in audio ${eventName} handler:`, e);
        }
      });
    }
  }

  // Route raw DOM events from both physical audio elements
  [rawDeckA, rawDeckB].forEach(deck => {
    if (!deck) return;
    deck.addEventListener('timeupdate', (e) => {
      if (e.target === activeDeck) dispatchAudioEvent('timeupdate', e);
    });
    deck.addEventListener('loadedmetadata', (e) => {
      if (e.target === activeDeck) dispatchAudioEvent('loadedmetadata', e);
    });
    deck.addEventListener('durationchange', (e) => {
      if (e.target === activeDeck) dispatchAudioEvent('durationchange', e);
    });
    deck.addEventListener('play', (e) => {
      if (e.target === activeDeck) dispatchAudioEvent('play', e);
    });
    deck.addEventListener('pause', (e) => {
      if (e.target === activeDeck && (!isCrossfading || activeDeck.paused)) {
        dispatchAudioEvent('pause', e);
      }
    });
    deck.addEventListener('ended', (e) => {
      if (isCrossfading && e.target === crossfadeOutgoingDeck) return;
      if (e.target === activeDeck) dispatchAudioEvent('ended', e);
    });
    deck.addEventListener('error', (e) => {
      if (e.target === activeDeck) dispatchAudioEvent('error', e);
    });
  });

  // Virtual audioEngine Proxy: seamlessly intercepts all existing codebase references
  const audioEngine = new Proxy(rawDeckA, {
    get(target, prop) {
      if (prop === 'volume') return currentMasterVolume;
      if (prop === 'addEventListener') {
        return (type, listener) => {
          if (!audioEventHandlers[type]) audioEventHandlers[type] = new Set();
          audioEventHandlers[type].add(listener);
        };
      }
      if (prop === 'removeEventListener') {
        return (type, listener) => {
          if (audioEventHandlers[type]) audioEventHandlers[type].delete(listener);
        };
      }
      if (prop === 'play') {
        return () => {
          if (isCrossfading && crossfadeOutgoingDeck && !crossfadeOutgoingDeck.paused) {
            crossfadeOutgoingDeck.play().catch(() => {});
          }
          return activeDeck ? activeDeck.play() : Promise.resolve();
        };
      }
      if (prop === 'pause') {
        return () => {
          if (isCrossfading && crossfadeOutgoingDeck) {
            crossfadeOutgoingDeck.pause();
          }
          if (activeDeck) activeDeck.pause();
        };
      }
      if (prop === 'load') {
        return () => { if (activeDeck) activeDeck.load(); };
      }
      if (prop === 'rawElement' || prop === 'activeElement') {
        return activeDeck;
      }
      if (!activeDeck) return undefined;
      const val = Reflect.get(activeDeck, prop, activeDeck);
      if (typeof val === 'function') {
        return val.bind(activeDeck);
      }
      return val;
    },
    set(target, prop, value) {
      if (prop === 'volume') {
        currentMasterVolume = Math.max(0, Math.min(value, 1));
        if (isCrossfading && crossfadeOutgoingDeck && crossfadeIncomingDeck) {
          crossfadeOutgoingDeck.volume = currentMasterVolume * Math.cos(crossfadeProgress * 0.5 * Math.PI);
          crossfadeIncomingDeck.volume = currentMasterVolume * Math.sin(crossfadeProgress * 0.5 * Math.PI);
        } else {
          if (activeDeck) activeDeck.volume = currentMasterVolume;
          if (standbyDeck) standbyDeck.volume = 0;
        }
        return true;
      }
      if (activeDeck) Reflect.set(activeDeck, prop, value, activeDeck);
      return true;
    }
  });
  const playerCover = document.getElementById('player-cover');
  const playerTitle = document.getElementById('player-title');
  const playerArtist = document.getElementById('player-artist');
  const playerShuffle = document.getElementById('player-shuffle');
  const playerPrev = document.getElementById('player-prev');
  const playerPlayBtn = document.getElementById('player-play');
  const playerPlayIcon = document.getElementById('player-play-icon');
  const playerNext = document.getElementById('player-next');
  const playerRepeat = document.getElementById('player-repeat');
  const repeatBadge = document.getElementById('repeat-badge');
  const playerScrubber = document.getElementById('player-scrubber');
  const scrubberWrap = document.getElementById('scrubber-wrap');
  const scrubberTooltip = document.getElementById('scrubber-tooltip');
  const playerCurrentTime = document.getElementById('player-current-time');
  const playerTotalTime = document.getElementById('player-total-time');
  const playerVolume = document.getElementById('player-volume');
  const playerMuteBtn = document.getElementById('player-mute-btn');
  const volumeIcon = document.getElementById('volume-icon');
  const dockTrackInfo = document.getElementById('dock-track-info');
  const playerDock = document.getElementById('player-bar');
  const playerExpandBtn = document.getElementById('player-expand-btn');
  const playerTransitionBtn = document.getElementById('player-transition-btn');
  const fsTransitionBtn = document.getElementById('fs-transition-btn');

  // Fullscreen "Now Playing" Overlay Elements
  const fullscreenPlayer = document.getElementById('fullscreen-player');
  const fsMinimizeBtn = document.getElementById('fs-minimize-btn');
  const fsCover = document.getElementById('fs-cover');
  const fsTitle = document.getElementById('fs-title');
  const fsArtist = document.getElementById('fs-artist');
  const fsAlbum = document.getElementById('fs-album');
  const fsCurrentTime = document.getElementById('fs-current-time');
  const fsTotalTime = document.getElementById('fs-total-time');
  const fsScrubber = document.getElementById('fs-scrubber');
  const fsShuffle = document.getElementById('fs-shuffle');
  const fsPrev = document.getElementById('fs-prev');
  const fsPlay = document.getElementById('fs-play');
  const fsPlayIcon = document.getElementById('fs-play-icon');
  const fsNext = document.getElementById('fs-next');
  const fsRepeat = document.getElementById('fs-repeat');
  const fsRepeatBadge = document.getElementById('fs-repeat-badge');
  const fsVolume = document.getElementById('fs-volume');
  const fsMuteBtn = document.getElementById('fs-mute-btn');
  const fsVolIcon = document.getElementById('fs-vol-icon');
  const fsDrawerBtn = document.getElementById('fs-drawer-btn');
  const fsAmbientGlow = document.getElementById('fs-ambient-glow');

  // Library Grouping & Sorting Elements
  const groupPills = document.querySelectorAll('.group-pill');
  const librarySortSelect = document.getElementById('library-sort-select');
  const viewSwitchWrap = document.getElementById('view-switch-wrap');

  // Discover & Explore Elements
  const exploreSearchInput = document.getElementById('explore-search-input');
  const btnClearExploreSearch = document.getElementById('btn-clear-explore-search');
  const exploreSearchSection = document.getElementById('explore-search-section');
  const exploreSearchGrid = document.getElementById('explore-search-grid');
  const exploreSearchTitle = document.getElementById('explore-search-title');
  const exploreSearchCount = document.getElementById('explore-search-count');
  const featuredPlaylistsGrid = document.getElementById('featured-playlists-grid');
  const trendingTracksGrid = document.getElementById('trending-tracks-grid');
  const searchFilterPills = document.getElementById('search-filter-pills');
  const searchAlbumsContainer = document.getElementById('search-albums-container');
  const searchAlbumsGrid = document.getElementById('search-albums-grid');
  const searchAlbumsBadge = document.getElementById('search-albums-badge');
  const searchTracksContainer = document.getElementById('search-tracks-container');
  const searchTracksSubTitle = document.getElementById('search-tracks-sub-title');
  let currentSearchFilter = 'all';
  let currentSearchResults = { tracks: [], albums: [] };

  // Playlist Modal & Custom Playlist Elements
  const playlistModal = document.getElementById('playlist-modal');
  const playlistModalBackdrop = document.getElementById('playlist-modal-backdrop');
  const modalCloseBtn = document.getElementById('modal-close-btn');
  const modalCover = document.getElementById('modal-cover');
  const modalBadge = document.getElementById('modal-badge');
  const modalTitle = document.getElementById('modal-title');
  const modalSubtitle = document.getElementById('modal-subtitle');
  const modalTrackCount = document.getElementById('modal-track-count');
  const btnModalDownloadAll = document.getElementById('btn-modal-download-all');
  const btnModalPlayAll = document.getElementById('btn-modal-play-all');
  const btnModalShuffle = document.getElementById('btn-modal-shuffle');
  const btnModalFavorite = document.getElementById('btn-modal-favorite');
  const modalFavText = document.getElementById('modal-fav-text');
  const modalTracklist = document.getElementById('modal-tracklist');
  let currentModalPlaylist = null;
  let exploreSearchDebounce = null;

  // Custom Playlist Creator Elements
  const btnCreatePlaylist = document.getElementById('btn-create-playlist');
  const createPlaylistModal = document.getElementById('create-playlist-modal');
  const createPlaylistBackdrop = document.getElementById('create-playlist-backdrop');
  const createPlaylistClose = document.getElementById('create-playlist-close');
  const btnCancelPlaylist = document.getElementById('btn-cancel-playlist');
  const createPlaylistForm = document.getElementById('create-playlist-form');
  const coverPreviewBox = document.getElementById('cover-preview-box');
  const coverPreviewImg = document.getElementById('cover-preview-img');
  const playlistFileInput = document.getElementById('playlist-file-input');
  const playlistNameInput = document.getElementById('playlist-name-input');
  const playlistDescInput = document.getElementById('playlist-desc-input');
  const playlistUrlInput = document.getElementById('playlist-url-input');

  // Add to Playlist Modal Elements
  const addToPlaylistModal = document.getElementById('add-to-playlist-modal');
  const addToPlaylistBackdrop = document.getElementById('add-to-playlist-backdrop');
  const addToPlaylistClose = document.getElementById('add-to-playlist-close');
  const addToPlaylistTrackName = document.getElementById('add-to-playlist-track-name');
  const addToPlaylistList = document.getElementById('add-to-playlist-list');
  const btnQuickCreateFromAdd = document.getElementById('btn-quick-create-from-add');
  const drawerAddPlaylistBtn = document.getElementById('drawer-add-playlist-btn');

  // Mac Notch & Dynamic Island HUD Elements
  const notchHud = document.getElementById('mac-notch-hud');
  const notchPill = document.getElementById('notch-pill');
  const notchMiniArt = document.getElementById('notch-mini-art');
  const notchMiniTitle = document.getElementById('notch-mini-title');
  const notchMiniArtist = document.getElementById('notch-mini-artist');
  const notchMiniPlayBtn = document.getElementById('notch-mini-play-btn');
  const notchMiniPlayIcon = document.getElementById('notch-mini-play-icon');
  const notchExpandedIsland = document.getElementById('notch-expanded-island');
  const notchExpandedArt = document.getElementById('notch-expanded-art');
  const notchExpandedTitle = document.getElementById('notch-expanded-title');
  const notchExpandedArtist = document.getElementById('notch-expanded-artist');
  const notchProgressTrack = document.getElementById('notch-progress-track');
  const notchProgressFill = document.getElementById('notch-progress-fill');
  const notchCurrTime = document.getElementById('notch-curr-time');
  const notchTotalTime = document.getElementById('notch-total-time');
  const notchPrevBtn = document.getElementById('notch-prev-btn');
  const notchPlayBtn = document.getElementById('notch-play-btn');
  const notchPlayIcon = document.getElementById('notch-play-icon');
  const notchNextBtn = document.getElementById('notch-next-btn');
  const notchFsBtn = document.getElementById('notch-fs-btn');

  // Platform Detection & Notch Suppression
  const isMacDesktop = /Macintosh|MacIntel|MacPPC|Mac68K/i.test(navigator.userAgent) && !/iPhone|iPad|iPod/i.test(navigator.userAgent);
  if (!isMacDesktop) {
    document.body.classList.add('not-mac');
    if (notchHud) notchHud.style.display = 'none';
  }
  if (/Windows/i.test(navigator.userAgent)) {
    document.body.classList.add('platform-windows');
  }
  if (/Android/i.test(navigator.userAgent) || window.AndroidMusicScanner) {
    document.body.classList.add('platform-android');
  }

  // Queue DOM Elements & Storage
  const playerQueueBtn = document.getElementById('player-queue-btn');
  const fsQueueBtn = document.getElementById('fs-queue-btn');
  const queueOverlay = document.getElementById('queue-overlay');
  const queueDrawer = document.getElementById('queue-drawer');
  const queueCloseBtn = document.getElementById('queue-close-btn');
  const btnClearQueue = document.getElementById('btn-clear-queue');
  const queueCountLabel = document.getElementById('queue-count-label');
  const queueBadge = document.getElementById('queue-badge');
  const queueNpCover = document.getElementById('queue-np-cover');
  const queueNpTitle = document.getElementById('queue-np-title');
  const queueNpArtist = document.getElementById('queue-np-artist');
  const queueUserList = document.getElementById('queue-user-list');
  const queueContextList = document.getElementById('queue-context-list');
  const drawerQueueBtn = document.getElementById('drawer-queue-btn');

  let userPlayQueue = [];
  try {
    const savedQueue = localStorage.getItem('musicstudio_queue');
    if (savedQueue) userPlayQueue = JSON.parse(savedQueue);
  } catch (e) {}



  // Import Playlist Modal Elements
  const btnImportPlaylist = document.getElementById('btn-import-playlist');
  const importPlaylistModal = document.getElementById('import-playlist-modal');
  const importPlaylistBackdrop = document.getElementById('import-playlist-backdrop');
  const importPlaylistClose = document.getElementById('import-playlist-close');
  const btnCancelImport = document.getElementById('btn-cancel-import');
  const importPlaylistForm = document.getElementById('import-playlist-form');
  const importPlaylistUrl = document.getElementById('import-playlist-url');
  const importPlaylistCustomName = document.getElementById('import-playlist-custom-name');
  const btnImportPaste = document.getElementById('btn-import-paste');
  const importPlaylistStatus = document.getElementById('import-playlist-status');
  const importStatusTitle = document.getElementById('import-status-title');
  const importStatusSubtitle = document.getElementById('import-status-subtitle');
  const btnSubmitImport = document.getElementById('btn-submit-import');

  // Application State
  let rawLibrarySongs = [];
  let librarySongs = [];
  let userPlaylists = [];
  let pendingCoverBase64 = null;
  let trackToAdd = null;
  let playlistSubFilter = 'all'; // 'all' | 'custom' | 'favorites'
  let currentSongIndex = -1;
  let isPlaying = false;
  let isSeeking = false;
  let isDeviceOffline = !navigator.onLine;
  let hasRecordedPlayForCurrentTrack = false;
  let isShuffle = (localStorage.getItem('musicstudio_shuffle') || localStorage.getItem('spotistudio_shuffle')) === 'true';
  let repeatMode = localStorage.getItem('musicstudio_repeat') || localStorage.getItem('spotistudio_repeat') || 'off'; // 'off' | 'all' | 'one'
  let currentGroupMode = 'tracks'; // 'tracks' | 'artists' | 'albums' | 'genres' | 'playlists' | 'most_played'
  let currentSortMode = 'recent'; // 'recent' | 'title' | 'artist' | 'duration'
  let shuffleQueue = [];
  let shufflePointer = 0;
  let playHistory = [];
  let selectedSong = null;
  let searchDebounce = null;
  let previousVolume = parseFloat(localStorage.getItem('musicstudio_volume') || localStorage.getItem('spotistudio_volume')) || 0.8;
  let transitionMode = localStorage.getItem('musicstudio_transition') === 'true'; // Smart Transition: OFF by default

  // Platform Icons SVG
  const ICONS = {
    search: `<svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="2"><circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/></svg>`,
    spotify: `<svg viewBox="0 0 24 24" width="20" height="20" fill="currentColor"><path d="M12 2C6.477 2 2 6.477 2 12s4.477 10 10 10 10-4.477 10-10S17.523 2 12 2zm4.586 14.424a.627.627 0 0 1-.863.208c-2.36-1.442-5.33-1.768-8.828-.97a.625.625 0 1 1-.277-1.22c3.827-.874 7.113-.502 9.76 1.118a.625.625 0 0 1 .208.864zm1.224-2.723a.784.784 0 0 1-1.08.258c-2.702-1.66-6.822-2.14-10.017-1.171a.784.784 0 1 1-.452-1.501c3.65-1.107 8.204-.576 11.29 1.334a.783.783 0 0 1 .259 1.08zm.105-2.835C14.692 8.95 9.375 8.775 6.297 9.71a.94.94 0 1 1-.55-1.801c3.528-1.07 9.408-.86 13.136 1.353a.941.941 0 0 1-.969 1.604z"/></svg>`,
    youtube: `<svg viewBox="0 0 24 24" width="20" height="20" fill="currentColor"><path d="M23.498 6.186a3.016 3.016 0 0 0-2.122-2.136C19.505 3.545 12 3.545 12 3.545s-7.505 0-9.377.505A3.017 3.017 0 0 0 .502 6.186C0 8.07 0 12 0 12s0 3.93.502 5.814a3.016 3.016 0 0 0 2.122 2.136c1.871.505 9.376.505 9.376.505s7.505 0 9.377-.505a3.015 3.015 0 0 0 2.122-2.136C24 15.93 24 12 24 12s0-3.93-.502-5.814zM9.545 15.568V8.432L15.818 12l-6.273 3.568z"/></svg>`
  };

  // ==================== GENRE METADATA & BADGES ====================
  function getGenreBadgeMeta(genre) {
    const g = (genre || '').toLowerCase();
    if (g.includes('pop')) return { icon: '🎤', bg: 'linear-gradient(135deg, #ec4899 0%, #8b5cf6 100%)', border: '#ec4899' };
    if (g.includes('rock') || g.includes('metal') || g.includes('punk')) return { icon: '🎸', bg: 'linear-gradient(135deg, #ef4444 0%, #f97316 100%)', border: '#ef4444' };
    if (g.includes('hip') || g.includes('rap') || g.includes('trap')) return { icon: '🎧', bg: 'linear-gradient(135deg, #f59e0b 0%, #d97706 100%)', border: '#f59e0b' };
    if (g.includes('elect') || g.includes('dance') || g.includes('house') || g.includes('edm') || g.includes('techno') || g.includes('club')) return { icon: '🎛️', bg: 'linear-gradient(135deg, #06b6d4 0%, #3b82f6 100%)', border: '#06b6d4' };
    if (g.includes('classic') || g.includes('orchestr') || g.includes('piano') || g.includes('symphon')) return { icon: '🎻', bg: 'linear-gradient(135deg, #8b5cf6 0%, #6366f1 100%)', border: '#8b5cf6' };
    if (g.includes('jazz') || g.includes('blues') || g.includes('soul') || g.includes('funk')) return { icon: '🎷', bg: 'linear-gradient(135deg, #d97706 0%, #b45309 100%)', border: '#d97706' };
    if (g.includes('r&b') || g.includes('rnb')) return { icon: '🎙️', bg: 'linear-gradient(135deg, #d946ef 0%, #c026d3 100%)', border: '#d946ef' };
    if (g.includes('countr') || g.includes('folk') || g.includes('acoustic')) return { icon: '🪕', bg: 'linear-gradient(135deg, #f97316 0%, #ea580c 100%)', border: '#f97316' };
    if (g.includes('reggae') || g.includes('dub') || g.includes('ska')) return { icon: '🌴', bg: 'linear-gradient(135deg, #10b981 0%, #eab308 100%)', border: '#10b981' };
    if (g.includes('indie') || g.includes('alt')) return { icon: '🌿', bg: 'linear-gradient(135deg, #10b981 0%, #06b6d4 100%)', border: '#10b981' };
    if (g.includes('latin') || g.includes('salsa') || g.includes('reggaeton')) return { icon: '💃', bg: 'linear-gradient(135deg, #f43f5e 0%, #e11d48 100%)', border: '#f43f5e' };
    if (g.includes('bollywood') || g.includes('hindi') || g.includes('desi') || g.includes('punjabi') || g.includes('nepali')) return { icon: '🪘', bg: 'linear-gradient(135deg, #ea580c 0%, #c026d3 100%)', border: '#ea580c' };
    if (g.includes('soundtrack') || g.includes('score') || g.includes('ost') || g.includes('movie')) return { icon: '🎬', bg: 'linear-gradient(135deg, #3b82f6 0%, #1d4ed8 100%)', border: '#3b82f6' };
    if (g.includes('chill') || g.includes('ambient') || g.includes('lofi') || g.includes('lo-fi')) return { icon: '🌌', bg: 'linear-gradient(135deg, #14b8a6 0%, #0f766e 100%)', border: '#14b8a6' };
    if (g.includes('k-pop') || g.includes('j-pop') || g.includes('anime')) return { icon: '✨', bg: 'linear-gradient(135deg, #ec4899 0%, #06b6d4 100%)', border: '#ec4899' };
    return { icon: '🎵', bg: 'linear-gradient(135deg, #6366f1 0%, #a855f7 100%)', border: '#6366f1' };
  }

  // ==================== SMART TRANSITION COLOR ENGINE ====================

  /**
   * Returns {primary, secondary} color strings for a genre (used as CORS fallback).
   */
  function getGenreColors(genre) {
    const meta = getGenreBadgeMeta(genre);
    const matches = meta.bg.match(/#([0-9a-fA-F]{6})/g);
    if (matches && matches.length >= 2) return { primary: matches[0], secondary: matches[1] };
    if (matches && matches.length === 1) return { primary: matches[0], secondary: matches[0] };
    return { primary: '#10b981', secondary: '#8b5cf6' };
  }

  /**
   * Extracts the dominant & accent colors from an image via Canvas API.
   * Falls back gracefully to genre palette on CORS or canvas errors.
   */
  function extractDominantColor(imgSrc, genre) {
    return new Promise((resolve) => {
      const fallback = getGenreColors(genre);
      if (!imgSrc || imgSrc === 'placeholder.svg' || imgSrc.endsWith('placeholder.svg')) {
        return resolve(fallback);
      }
      const img = new Image();
      img.crossOrigin = 'anonymous';
      const timeout = setTimeout(() => resolve(fallback), 3000);
      img.onload = () => {
        clearTimeout(timeout);
        try {
          const SIZE = 80;
          const canvas = document.createElement('canvas');
          canvas.width = SIZE;
          canvas.height = SIZE;
          const ctx = canvas.getContext('2d');
          ctx.drawImage(img, 0, 0, SIZE, SIZE);
          const data = ctx.getImageData(0, 0, SIZE, SIZE).data;
          let r1 = 0, g1 = 0, b1 = 0, c1 = 0;
          let r2 = 0, g2 = 0, b2 = 0, c2 = 0;
          for (let i = 0; i < data.length; i += 12) {
            const r = data[i], g = data[i + 1], b = data[i + 2];
            const brightness = (r + g + b) / 3;
            if (brightness < 18 || brightness > 238) continue;
            r1 += r; g1 += g; b1 += b; c1++;
            const maxC = Math.max(r, g, b);
            const minC = Math.min(r, g, b);
            const sat = maxC === 0 ? 0 : (maxC - minC) / maxC;
            if (sat > 0.35) { r2 += r; g2 += g; b2 += b; c2++; }
          }
          if (!c1) return resolve(fallback);
          const pr = Math.round(r1 / c1);
          const pg = Math.round(g1 / c1);
          const pb = Math.round(b1 / c1);
          const sr = c2 ? Math.round(r2 / c2) : Math.min(255, pr + 40);
          const sg = c2 ? Math.round(g2 / c2) : Math.max(0, pg - 20);
          const sb = c2 ? Math.round(b2 / c2) : Math.min(255, pb + 60);
          resolve({
            primary: `rgb(${sr},${sg},${sb})`,
            secondary: `rgb(${Math.max(0, pr - 20)},${Math.max(0, pg - 20)},${Math.min(255, pb + 40)})`
          });
        } catch (e) {
          resolve(fallback);
        }
      };
      img.onerror = () => { clearTimeout(timeout); resolve(fallback); };
      img.src = imgSrc;
    });
  }

  /**
   * Apple Music-style Smart Transition.
   * Morphs ambient background orbs, fullscreen glow, and crossfades covers.
   */
  async function applySmartTransition(song) {
    if (!transitionMode) return;
    const genre = (song && (song.genre || resolveSongGenreForTransition(song))) || '';
    const coverUrl = (song && song.cover_url) ? song.cover_url : 'placeholder.svg';

    if (playerCover) playerCover.classList.add('cover-transitioning');
    if (fsCover) fsCover.classList.add('cover-transitioning');

    const colors = await extractDominantColor(coverUrl, genre);

    const orbEmerald = document.querySelector('.orb-emerald');
    const orbViolet  = document.querySelector('.orb-violet');
    const orbCyan    = document.querySelector('.orb-cyan');
    if (orbEmerald) orbEmerald.style.background = `radial-gradient(circle, ${colors.primary}, transparent 70%)`;
    if (orbViolet)  orbViolet.style.background  = `radial-gradient(circle, ${colors.secondary}, transparent 70%)`;
    if (orbCyan)    orbCyan.style.background    = `radial-gradient(circle, ${colors.primary}99, transparent 70%)`;

    if (fsAmbientGlow) {
      fsAmbientGlow.style.background = `radial-gradient(circle, ${colors.primary}3d 0%, ${colors.secondary}26 40%, transparent 70%)`;
    }

    const dockCoverWrap = document.getElementById('dock-cover-wrap');
    if (dockCoverWrap) dockCoverWrap.classList.add('transition-active');

    setTimeout(() => {
      if (playerCover) playerCover.classList.remove('cover-transitioning');
      if (fsCover) fsCover.classList.remove('cover-transitioning');
    }, 380);
  }

  function resolveSongGenreForTransition(song) {
    if (!song) return 'Studio Hits';
    if (song.genre && song.genre !== 'General' && song.genre !== 'Unknown' && song.genre.trim()) {
      return song.genre.trim();
    }
    const combined = `${song.artist || ''} ${song.title || ''} ${song.album || ''}`.toLowerCase();
    if (combined.includes('rock') || combined.includes('metallica') || combined.includes('linkin') || combined.includes('nirvana') || combined.includes('beatles')) return 'Rock';
    if (combined.includes('hip hop') || combined.includes('rap') || combined.includes('drake') || combined.includes('eminem') || combined.includes('kendrick') || combined.includes('kanye')) return 'Hip-Hop';
    if (combined.includes('edm') || combined.includes('dance') || combined.includes('house') || combined.includes('avicii')) return 'Electronic';
    if (combined.includes('pop') || combined.includes('swift') || combined.includes('sheeran') || combined.includes('grande') || combined.includes('bieber') || combined.includes('weeknd') || combined.includes('billie')) return 'Pop';
    if (combined.includes('r&b') || combined.includes('sza') || combined.includes('beyonce') || combined.includes('rihanna')) return 'R&B';
    if (combined.includes('classical') || combined.includes('mozart') || combined.includes('beethoven') || combined.includes('piano') || combined.includes('orchestra')) return 'Classical';
    if (combined.includes('jazz') || combined.includes('sinatra') || combined.includes('coltrane')) return 'Jazz';
    if (combined.includes('country') || combined.includes('luke combs') || combined.includes('wallen')) return 'Country';
    if (combined.includes('latin') || combined.includes('bad bunny') || combined.includes('reggaeton')) return 'Latin';
    if (combined.includes('k-pop') || combined.includes('bts') || combined.includes('blackpink')) return 'K-Pop';
    if (combined.includes('hindi') || combined.includes('bollywood') || combined.includes('arijit') || combined.includes('nepali')) return 'Desi & Hindi';
    if (combined.includes('lofi') || combined.includes('chill') || combined.includes('ambient')) return 'Chillout & Lofi';
    if (combined.includes('indie') || combined.includes('tame impala') || combined.includes('arctic monkeys')) return 'Indie & Alternative';
    if (combined.includes('soundtrack') || combined.includes('score') || combined.includes('zimmer')) return 'Soundtrack';
    return 'Studio Hits';
  }

  function resetAmbientOrbs() {
    const orbEmerald = document.querySelector('.orb-emerald');
    const orbViolet  = document.querySelector('.orb-violet');
    const orbCyan    = document.querySelector('.orb-cyan');
    if (orbEmerald) orbEmerald.style.background = 'radial-gradient(circle, var(--emerald), transparent 70%)';
    if (orbViolet)  orbViolet.style.background  = 'radial-gradient(circle, var(--violet), transparent 70%)';
    if (orbCyan)    orbCyan.style.background    = 'radial-gradient(circle, var(--cyan), transparent 70%)';
    if (fsAmbientGlow) {
      fsAmbientGlow.style.background = 'radial-gradient(circle, rgba(16,185,129,0.2) 0%, rgba(6,182,212,0.12) 40%, transparent 70%)';
    }
    const dockCoverWrap = document.getElementById('dock-cover-wrap');
    if (dockCoverWrap) dockCoverWrap.classList.remove('transition-active');
  }

  // ==================== ADVANCED WEB AUDIO DJ FX PROCESSOR ====================
  const djAudioFx = {
    ctx: null,
    sourceA: null,
    sourceB: null,
    filterA: null,
    filterB: null,
    gainA: null,
    gainB: null,
    echoSendA: null,
    echoSendB: null,
    echoDelay: null,
    echoFeedback: null,
    echoFilter: null,
    masterGain: null,
    isInitialized: false,

    init() {
      if (this.isInitialized) return true;
      try {
        const AudioContextClass = window.AudioContext || window.webkitAudioContext;
        if (!AudioContextClass) return false;
        this.ctx = new AudioContextClass();

        // Deck A Nodes
        this.sourceA = this.ctx.createMediaElementSource(rawDeckA);
        this.filterA = this.ctx.createBiquadFilter();
        this.filterA.type = 'lowpass';
        this.filterA.frequency.value = 22050;
        this.filterA.Q.value = 1.0;
        this.gainA = this.ctx.createGain();
        this.gainA.gain.value = 1.0;

        // Deck B Nodes
        this.sourceB = this.ctx.createMediaElementSource(rawDeckB);
        this.filterB = this.ctx.createBiquadFilter();
        this.filterB.type = 'highpass';
        this.filterB.frequency.value = 20;
        this.filterB.Q.value = 1.0;
        this.gainB = this.ctx.createGain();
        this.gainB.gain.value = 1.0;

        // Master Output
        this.masterGain = this.ctx.createGain();
        this.masterGain.gain.value = 1.0;

        // Stereo Dub Delay / Echo-Out Bus
        this.echoSendA = this.ctx.createGain();
        this.echoSendA.gain.value = 0.0;
        this.echoSendB = this.ctx.createGain();
        this.echoSendB.gain.value = 0.0;

        this.echoDelay = this.ctx.createDelay(1.5);
        this.echoDelay.delayTime.value = 0.35; // ~1/2 beat at 85-130 BPM

        this.echoFeedback = this.ctx.createGain();
        this.echoFeedback.gain.value = 0.44; // smooth musical decay

        this.echoFilter = this.ctx.createBiquadFilter();
        this.echoFilter.type = 'lowpass';
        this.echoFilter.frequency.value = 2600; // warm tape delay color

        // Wire Deck A
        this.sourceA.connect(this.filterA);
        this.filterA.connect(this.gainA);
        this.gainA.connect(this.masterGain);
        this.sourceA.connect(this.echoSendA);
        this.echoSendA.connect(this.echoDelay);

        // Wire Deck B
        this.sourceB.connect(this.filterB);
        this.filterB.connect(this.gainB);
        this.gainB.connect(this.masterGain);
        this.sourceB.connect(this.echoSendB);
        this.echoSendB.connect(this.echoDelay);

        // Wire Echo Loop
        this.echoDelay.connect(this.echoFilter);
        this.echoFilter.connect(this.echoFeedback);
        this.echoFeedback.connect(this.echoDelay);
        this.echoFilter.connect(this.masterGain);

        // Connect Master to Speakers
        this.masterGain.connect(this.ctx.destination);

        this.isInitialized = true;
        return true;
      } catch (err) {
        console.warn('Web Audio DJ Engine fallback to native audio:', err);
        return false;
      }
    },

    resume() {
      if (this.ctx && this.ctx.state === 'suspended') {
        this.ctx.resume().catch(() => {});
      }
    },

    resetFilters() {
      if (!this.isInitialized || !this.ctx) return;
      const t = this.ctx.currentTime;
      try {
        if (this.filterA) {
          this.filterA.type = 'lowpass';
          this.filterA.frequency.cancelScheduledValues(t);
          this.filterA.frequency.setValueAtTime(22050, t);
        }
        if (this.filterB) {
          this.filterB.type = 'highpass';
          this.filterB.frequency.cancelScheduledValues(t);
          this.filterB.frequency.setValueAtTime(20, t);
        }
        if (this.echoSendA) {
          this.echoSendA.gain.cancelScheduledValues(t);
          this.echoSendA.gain.setValueAtTime(0, t);
        }
        if (this.echoSendB) {
          this.echoSendB.gain.cancelScheduledValues(t);
          this.echoSendB.gain.setValueAtTime(0, t);
        }
      } catch (e) {}
    },

    applyFilterSweep(outgoingDeck, incomingDeck, durationSec) {
      if (!this.isInitialized || !this.ctx) return;
      this.resume();
      const t = this.ctx.currentTime;
      const dur = Math.max(0.8, durationSec);

      const isOutgoingA = (outgoingDeck === rawDeckA);
      const outFilter = isOutgoingA ? this.filterA : this.filterB;
      const inFilter = isOutgoingA ? this.filterB : this.filterA;

      try {
        // Outgoing track: sweep lowpass down to 260Hz so bass/highs leave space
        outFilter.type = 'lowpass';
        outFilter.frequency.cancelScheduledValues(t);
        outFilter.frequency.setValueAtTime(22050, t);
        outFilter.frequency.exponentialRampToValueAtTime(260, t + dur * 0.85);

        // Incoming track: highpass starts at 450Hz (no clashing bass!) and sweeps down to 20Hz (clean bass drop)
        inFilter.type = 'highpass';
        inFilter.frequency.cancelScheduledValues(t);
        inFilter.frequency.setValueAtTime(450, t);
        inFilter.frequency.exponentialRampToValueAtTime(20, t + dur * 0.95);
      } catch (e) {}
    },

    triggerEchoOut(outgoingDeck, durationSec = 2.0) {
      if (!this.isInitialized || !this.ctx) return;
      this.resume();
      const t = this.ctx.currentTime;
      const isOutgoingA = (outgoingDeck === rawDeckA);
      const sendNode = isOutgoingA ? this.echoSendA : this.echoSendB;

      try {
        sendNode.gain.cancelScheduledValues(t);
        sendNode.gain.setValueAtTime(0.85, t);
        sendNode.gain.setValueAtTime(0.85, t + 0.28);
        sendNode.gain.linearRampToValueAtTime(0, t + 0.55);
      } catch (e) {}
    },

    triggerVinylBrake(deck, durationSec = 0.38) {
      if (!deck) return;
      try {
        const startRate = deck.playbackRate || 1.0;
        const startTime = performance.now();
        const durMs = durationSec * 1000;
        const brakeStep = (now) => {
          const progress = Math.min(1, (now - startTime) / durMs);
          deck.playbackRate = Math.max(0.06, startRate * (1 - Math.pow(progress, 1.8)));
          if (progress < 1) {
            requestAnimationFrame(brakeStep);
          } else {
            deck.playbackRate = 1.0;
            deck.pause();
          }
        };
        requestAnimationFrame(brakeStep);
      } catch (e) {}
    },

    playRiserSweep(durationSec = 2.2) {
      if (!this.isInitialized || !this.ctx) return;
      try {
        this.resume();
        const sampleRate = this.ctx.sampleRate;
        const length = sampleRate * durationSec;
        const buffer = this.ctx.createBuffer(1, length, sampleRate);
        const data = buffer.getChannelData(0);
        let b0 = 0, b1 = 0, b2 = 0;
        for (let i = 0; i < length; i++) {
          const white = Math.random() * 2 - 1;
          b0 = 0.99886 * b0 + white * 0.0555179;
          b1 = 0.99332 * b1 + white * 0.0750759;
          b2 = 0.96900 * b2 + white * 0.1538520;
          data[i] = (b0 + b1 + b2 + white * 0.1) * 0.18;
        }

        const source = this.ctx.createBufferSource();
        source.buffer = buffer;

        const bandpass = this.ctx.createBiquadFilter();
        bandpass.type = 'bandpass';
        bandpass.Q.value = 3.2;

        const gainNode = this.ctx.createGain();
        const t = this.ctx.currentTime;

        bandpass.frequency.setValueAtTime(320, t);
        bandpass.frequency.exponentialRampToValueAtTime(3400, t + durationSec * 0.9);

        gainNode.gain.setValueAtTime(0.001, t);
        gainNode.gain.exponentialRampToValueAtTime(0.35, t + durationSec * 0.85);
        gainNode.gain.linearRampToValueAtTime(0.001, t + durationSec);

        source.connect(bandpass);
        bandpass.connect(gainNode);
        gainNode.connect(this.masterGain);

        source.start(t);
        source.stop(t + durationSec);
      } catch (e) {}
    }
  };

  // ==================== SMART HOOK & INTRO/OUTRO CUEING PLANNER ====================

  function getGenreTransitionDuration(trackOrSong) {
    if (!trackOrSong) return 5.5;
    const genre = (trackOrSong.genre || resolveSongGenreForTransition(trackOrSong) || '').toLowerCase();
    if (genre.includes('electronic') || genre.includes('edm') || genre.includes('dance') || genre.includes('house')) {
      return 5.0; // Punchy club blend
    }
    if (genre.includes('hip-hop') || genre.includes('rap') || genre.includes('trap')) {
      return 4.2; // Clean hip-hop drop
    }
    if (genre.includes('rock') || genre.includes('metal') || genre.includes('indie')) {
      return 4.8; // Dynamic rock transition
    }
    if (genre.includes('chill') || genre.includes('lofi') || genre.includes('ambient') || genre.includes('classical') || genre.includes('soundtrack')) {
      return 7.5; // Lush cinematic expansive fade
    }
    if (genre.includes('jazz') || genre.includes('acoustic') || genre.includes('r&b') || genre.includes('rnb') || genre.includes('soul')) {
      return 6.0; // Silky studio transition
    }
    return 5.0;
  }

  /**
   * Dynamically analyzes outgoing and incoming track profiles (genre, tempo feel, intro/outro lengths)
   * to determine the optimal DJ blend style, cue jump offset, and sound effect transitions.
   */
  function planSmartTransition(outgoingTrack, incomingTrack, isManualSkip = false) {
    const outGenre = (outgoingTrack && (outgoingTrack.genre || resolveSongGenreForTransition(outgoingTrack)) || '').toLowerCase();
    const inGenre = (incomingTrack && (incomingTrack.genre || resolveSongGenreForTransition(incomingTrack)) || '').toLowerCase();

    const isOutBeatDriven = outGenre.includes('elect') || outGenre.includes('edm') || outGenre.includes('dance') || outGenre.includes('house') || outGenre.includes('pop') || outGenre.includes('hip') || outGenre.includes('rap') || outGenre.includes('latin');
    const isInBeatDriven = inGenre.includes('elect') || inGenre.includes('edm') || inGenre.includes('dance') || inGenre.includes('house') || inGenre.includes('pop') || inGenre.includes('hip') || inGenre.includes('rap') || inGenre.includes('latin');

    let durationMs = 4800;
    let cueOffset = 0.35; // Default: skip digital zero-padding at file start
    let style = 'filter_swap'; // 'filter_swap' | 'echo_drop' | 'ambient_morph'
    let triggerRiser = false;
    let triggerVinylBrake = false;

    if (isManualSkip) {
      // Manual Next Track skip: punchy DJ cut with tape stop + dub echo
      durationMs = 2400;
      style = 'echo_drop';
      triggerVinylBrake = true;
      cueOffset = 0.45;
    } else if (outGenre.includes('ambient') || outGenre.includes('lofi') || outGenre.includes('chill') || inGenre.includes('ambient') || inGenre.includes('lofi') || inGenre.includes('chill')) {
      // Lush cinematic slow dissolve
      durationMs = 7200;
      style = 'ambient_morph';
      cueOffset = 0.15;
    } else if (isOutBeatDriven && isInBeatDriven) {
      // Club DJ Low-End Swap (Clean Filter Sweep)
      durationMs = 5000;
      style = 'filter_swap';
      cueOffset = 0.4;
      // If incoming track is an extended mix with long intro build, trigger euphoric riser sweep
      if (incomingTrack && ((incomingTrack.title || '').toLowerCase().includes('extended') || (incomingTrack.duration && incomingTrack.duration > 300))) {
        triggerRiser = true;
        cueOffset = 1.2;
      }
    } else {
      // Genre mismatch or sudden tempo shift: Dub Echo tail bridges the energy gap
      durationMs = 4200;
      style = 'echo_drop';
      triggerRiser = true;
      cueOffset = 0.35;
    }

    return {
      durationMs,
      cueOffset,
      style,
      triggerRiser,
      triggerVinylBrake
    };
  }

  function getEffectiveAudioDuration() {
    if (activeDeck && activeDeck.duration && isFinite(activeDeck.duration) && activeDeck.duration > 0) {
      return activeDeck.duration;
    }
    const curTrackObj = isOnlineStreaming ? currentStreamingTrack : (currentSongIndex >= 0 ? librarySongs[currentSongIndex] : null);
    if (curTrackObj && curTrackObj.duration && curTrackObj.duration > 0) {
      return curTrackObj.duration;
    }
    return 0;
  }

  function peekNextTrack() {
    if (repeatMode === 'one') {
      if (isOnlineStreaming && currentStreamingTrack) {
        return { type: 'online', track: currentStreamingTrack, queue: currentOnlineQueue, index: currentOnlineQueueIndex };
      }
      if (currentSongIndex >= 0 && librarySongs[currentSongIndex]) {
        return { type: 'library', index: currentSongIndex, song: librarySongs[currentSongIndex] };
      }
      return null;
    }

    if (userPlayQueue && userPlayQueue.length > 0) {
      return { type: 'queue', track: userPlayQueue[0] };
    }

    if (isOnlineStreaming) {
      if (!currentOnlineQueue || !currentOnlineQueue.length) return null;
      if (isShuffle) {
        const pool = currentOnlineQueue.filter((_, i) => i !== currentOnlineQueueIndex);
        const nextIdx = pool.length ? currentOnlineQueue.indexOf(pool[Math.floor(Math.random() * pool.length)]) : 0;
        return { type: 'online', track: currentOnlineQueue[nextIdx], queue: currentOnlineQueue, index: nextIdx };
      }
      if (currentOnlineQueueIndex < currentOnlineQueue.length - 1) {
        const nextIdx = currentOnlineQueueIndex + 1;
        return { type: 'online', track: currentOnlineQueue[nextIdx], queue: currentOnlineQueue, index: nextIdx };
      }
      if (repeatMode === 'all' || transitionMode || currentOnlineQueue.length > 1) {
        return { type: 'online', track: currentOnlineQueue[0], queue: currentOnlineQueue, index: 0 };
      }
      if (librarySongs && librarySongs.length > 0) {
        return { type: 'library', index: 0, song: librarySongs[0] };
      }
      return { type: 'online', track: currentOnlineQueue[0], queue: currentOnlineQueue, index: 0 };
    }

    if (librarySongs && librarySongs.length > 0) {
      if (isShuffle) {
        if (!shuffleQueue.length || shuffleQueue.length !== librarySongs.length) {
          generateShuffleQueue(currentSongIndex);
        }
        const nextPtr = shufflePointer + 1;
        if (nextPtr < shuffleQueue.length) {
          const nextIdx = shuffleQueue[nextPtr];
          return { type: 'library', index: nextIdx, song: librarySongs[nextIdx] };
        }
        if (repeatMode === 'all' || transitionMode) {
          return { type: 'library', index: shuffleQueue[0] || 0, song: librarySongs[shuffleQueue[0] || 0] };
        }
        return null;
      }
      if (currentSongIndex < librarySongs.length - 1) {
        const nextIdx = currentSongIndex + 1;
        return { type: 'library', index: nextIdx, song: librarySongs[nextIdx] };
      }
      if (repeatMode === 'all' || transitionMode) {
        return { type: 'library', index: 0, song: librarySongs[0] };
      }
    }
    return null;
  }

  function cancelCrossfade() {
    if (!isCrossfading && !crossfadeAnimId) return;
    if (crossfadeAnimId) {
      cancelAnimationFrame(crossfadeAnimId);
      crossfadeAnimId = null;
    }
    if (crossfadeOutgoingDeck) {
      try {
        crossfadeOutgoingDeck.pause();
        crossfadeOutgoingDeck.currentTime = 0;
        crossfadeOutgoingDeck.src = '';
        crossfadeOutgoingDeck.volume = 0;
        crossfadeOutgoingDeck.playbackRate = 1.0;
      } catch (e) {}
    }
    if (activeDeck) {
      try {
        activeDeck.volume = currentMasterVolume;
        activeDeck.playbackRate = 1.0;
      } catch (e) {}
    }
    if (djAudioFx) djAudioFx.resetFilters();
    isCrossfading = false;
    crossfadeProgress = 0;
    crossfadeOutgoingDeck = null;
    crossfadeIncomingDeck = null;
    [playerTransitionBtn, fsTransitionBtn].forEach(btn => {
      if (btn) btn.classList.remove('crossfading');
    });
  }

  let activeTransitionPlan = null;
  function startCrossfadeAnimation(outgoingDeck, incomingDeck, durationOrPlan) {
    if (crossfadeAnimId) cancelAnimationFrame(crossfadeAnimId);
    isCrossfading = true;
    crossfadeOutgoingDeck = outgoingDeck;
    crossfadeIncomingDeck = incomingDeck;
    crossfadeProgress = 0;

    djAudioFx.init();
    djAudioFx.resume();

    const plan = (typeof durationOrPlan === 'object' && durationOrPlan !== null)
      ? durationOrPlan
      : { durationMs: Math.max(700, durationOrPlan || 4800), style: 'filter_swap', cueOffset: 0.35 };

    activeTransitionPlan = plan;
    const durationMs = plan.durationMs;
    const durationSec = durationMs / 1000;

    // Apply DJ FX based on transition plan
    if (plan.style === 'filter_swap') {
      djAudioFx.applyFilterSweep(outgoingDeck, incomingDeck, durationSec);
    } else if (plan.style === 'echo_drop') {
      djAudioFx.triggerEchoOut(outgoingDeck, 2.2);
      if (plan.triggerVinylBrake) {
        djAudioFx.triggerVinylBrake(outgoingDeck, 0.36);
      }
    }
    if (plan.triggerRiser) {
      djAudioFx.playRiserSweep(durationSec);
    }

    [playerTransitionBtn, fsTransitionBtn].forEach(btn => {
      if (btn && transitionMode) {
        btn.classList.add('crossfading');
        btn.title = `Smart Transition: ${plan.style === 'filter_swap' ? 'DJ Filter Swap' : (plan.style === 'echo_drop' ? 'Echo-Out Drop' : 'Ambient Morph')} Active (T)`;
      }
    });

    const startTime = performance.now();

    function step(now) {
      if (!isCrossfading) return;
      const elapsed = now - startTime;
      const t = Math.min(1, Math.max(0, elapsed / durationMs));
      crossfadeProgress = t;

      const outVol = currentMasterVolume * Math.cos(t * 0.5 * Math.PI);
      const inVol = currentMasterVolume * Math.sin(t * 0.5 * Math.PI);

      try {
        if (!plan.triggerVinylBrake || t > 0.4) {
          outgoingDeck.volume = Math.max(0, Math.min(1, outVol));
        }
        incomingDeck.volume = Math.max(0, Math.min(1, inVol));
      } catch (e) {}

      if (t < 1) {
        crossfadeAnimId = requestAnimationFrame(step);
      } else {
        finishCrossfade(outgoingDeck, incomingDeck);
      }
    }

    crossfadeAnimId = requestAnimationFrame(step);
  }

  function finishCrossfade(outgoingDeck, incomingDeck) {
    if (crossfadeAnimId) cancelAnimationFrame(crossfadeAnimId);
    crossfadeAnimId = null;
    try {
      outgoingDeck.pause();
      outgoingDeck.currentTime = 0;
      outgoingDeck.src = '';
      outgoingDeck.volume = 0;
      outgoingDeck.playbackRate = 1.0;
    } catch (e) {}
    try {
      incomingDeck.volume = currentMasterVolume;
      incomingDeck.playbackRate = 1.0;
    } catch (e) {}
    if (djAudioFx) djAudioFx.resetFilters();
    isCrossfading = false;
    crossfadeProgress = 0;
    crossfadeOutgoingDeck = null;
    crossfadeIncomingDeck = null;
    hasTriggeredAutoCrossfade = false;
    activeTransitionPlan = null;
    [playerTransitionBtn, fsTransitionBtn].forEach(btn => {
      if (btn) {
        btn.classList.remove('crossfading');
        btn.title = transitionMode
          ? 'Smart Transition: ON — Dynamic hook cueing & DJ crossfade active (T)'
          : 'Smart Transition: OFF — Click to enable (T)';
      }
    });
    saveCurrentPlaybackState();
  }

  let isAutoCrossfadeInProgress = false;
  function transitionToAudio(audioUrl, durationOrTrack, datasetMeta = null) {
    const outgoingDeck = activeDeck;
    const incomingDeck = standbyDeck;

    const currentTrack = isOnlineStreaming ? currentStreamingTrack : (currentSongIndex >= 0 ? librarySongs[currentSongIndex] : null);
    const incomingTrack = (durationOrTrack && typeof durationOrTrack === 'object') ? durationOrTrack : null;
    const transitionPlan = planSmartTransition(currentTrack, incomingTrack, isManualTransitionRequested);
    isManualTransitionRequested = false;
    const isAutoCrossfade = isAutoCrossfadeInProgress;
    isAutoCrossfadeInProgress = false;

    const isCurrentlyPlayingAudio = (isPlaying || !activeDeck.paused || isAutoCrossfade) && activeDeck && activeDeck.src && activeDeck.currentTime > 0.4;

    if (transitionMode && isCurrentlyPlayingAudio) {
      cancelCrossfade();

      if (datasetMeta) {
        incomingDeck.dataset.streamMode = datasetMeta.streamMode || 'full';
        if (datasetMeta.streamFullEndpoint) incomingDeck.dataset.streamFullEndpoint = datasetMeta.streamFullEndpoint;
        else delete incomingDeck.dataset.streamFullEndpoint;
        if (datasetMeta.streamQuery) incomingDeck.dataset.streamQuery = datasetMeta.streamQuery;
        else delete incomingDeck.dataset.streamQuery;
      } else {
        incomingDeck.dataset.streamMode = 'full';
        delete incomingDeck.dataset.streamFullEndpoint;
        delete incomingDeck.dataset.streamQuery;
      }

      incomingDeck.src = audioUrl;
      incomingDeck.volume = 0;
      incomingDeck.currentTime = transitionPlan.cueOffset || 0.35; // Instant hook / silence skip!
      incomingDeck.load();

      // Swap deck pointers immediately so UI/scrubber binds to incoming track
      activeDeck = incomingDeck;
      standbyDeck = outgoingDeck;

      const playPromise = incomingDeck.play();
      if (playPromise !== undefined) {
        playPromise.then(() => {
          startCrossfadeAnimation(outgoingDeck, incomingDeck, transitionPlan);
        }).catch((err) => {
          console.warn('Playback on incoming deck failed:', err);
          activeDeck = outgoingDeck;
          standbyDeck = incomingDeck;
          outgoingDeck.volume = currentMasterVolume;
          updatePlayIcon(false);
        });
      } else {
        startCrossfadeAnimation(outgoingDeck, incomingDeck, transitionPlan);
      }
    } else {
      cancelCrossfade();
      if (datasetMeta) {
        activeDeck.dataset.streamMode = datasetMeta.streamMode || 'full';
        if (datasetMeta.streamFullEndpoint) activeDeck.dataset.streamFullEndpoint = datasetMeta.streamFullEndpoint;
        else delete activeDeck.dataset.streamFullEndpoint;
        if (datasetMeta.streamQuery) activeDeck.dataset.streamQuery = datasetMeta.streamQuery;
        else delete activeDeck.dataset.streamQuery;
      } else {
        activeDeck.dataset.streamMode = 'full';
        delete activeDeck.dataset.streamFullEndpoint;
        delete activeDeck.dataset.streamQuery;
      }

      activeDeck.src = audioUrl;
      activeDeck.volume = currentMasterVolume;
      activeDeck.currentTime = 0;
      activeDeck.load();
      const playPromise = activeDeck.play();
      if (playPromise !== undefined) {
        playPromise.catch(() => {
          updatePlayIcon(false);
        });
      }
    }
  }

  function updateTransitionBtnState() {
    const label = transitionMode
      ? 'Smart Transition: ON — Dynamic hook cueing, filter swap & echo FX active (T)'
      : 'Smart Transition: OFF — Click to enable (T)';
    [playerTransitionBtn, fsTransitionBtn].forEach(btn => {
      if (!btn) return;
      btn.classList.toggle('active', transitionMode);
      btn.title = label;
    });
  }

  function toggleTransitionMode() {
    transitionMode = !transitionMode;
    localStorage.setItem('musicstudio_transition', transitionMode);
    updateTransitionBtnState();
    if (transitionMode) {
      djAudioFx.init();
      djAudioFx.resume();
      showToast('✨ Smart DJ Transition ON — Dynamic hook cueing, filter swap & echo FX active', 'success');
      const currentSong = isOnlineStreaming
        ? currentStreamingTrack
        : (librarySongs[currentSongIndex] || null);
      if (currentSong) applySmartTransition(currentSong);
    } else {
      showToast('Smart Transition OFF — Standard playback', 'info');
      cancelCrossfade();
      resetAmbientOrbs();
    }
  }

  if (playerTransitionBtn) playerTransitionBtn.addEventListener('click', toggleTransitionMode);
  if (fsTransitionBtn) fsTransitionBtn.addEventListener('click', toggleTransitionMode);
  updateTransitionBtnState();

  // ==================== NAVIGATION TABS (DESKTOP + MOBILE) ====================
  function activateTab(target) {
    if (isDeviceOffline && (target === 'discover' || target === 'downloader')) {
      showToast('⚡ Device is offline: Discover & Downloader require internet. Showing your Library.', 'warning');
      target = 'library';
    }

    document.querySelectorAll('.nav-item').forEach(b => {
      b.classList.toggle('active', b.getAttribute('data-tab') === target);
    });
    document.querySelectorAll('.mobile-nav-item').forEach(b => {
      b.classList.toggle('active', b.getAttribute('data-tab') === target);
    });
    document.querySelectorAll('.tab-view').forEach(v => {
      v.classList.toggle('active', v.id === `tab-${target}`);
    });

    if (target === 'library') {
      loadLibrary();
    } else if (target === 'discover') {
      loadExplore();
    }
  }

  document.querySelectorAll('.nav-item, .mobile-nav-item').forEach(btn => {
    btn.addEventListener('click', (e) => {
      const target = btn.getAttribute('data-tab');
      if (isDeviceOffline && (target === 'discover' || target === 'downloader')) {
        e.preventDefault();
        showToast('\u26a1 Device is offline: Discover & Downloader require internet. Showing your Library.', 'warning');
        activateTab('library');
        return;
      }
      if (target) activateTab(target);
    });
  });

  // ==================== URL INPUT AUTO-DETECTION ====================
  function detectPlatform(url) {
    platformIcon.className = 'platform-icon';
    if (url.includes('spotify.com')) {
      platformIcon.classList.add('spotify');
      platformIcon.innerHTML = ICONS.spotify;
    } else if (url.includes('youtube.com') || url.includes('youtu.be')) {
      platformIcon.classList.add('youtube');
      platformIcon.innerHTML = ICONS.youtube;
    } else {
      platformIcon.innerHTML = ICONS.search;
    }
  }

  inputUrl.addEventListener('input', (e) => {
    detectPlatform(e.target.value.trim());
  });

  // ==================== PASTE BUTTON ====================
  btnPaste.addEventListener('click', async () => {
    try {
      const text = await navigator.clipboard.readText();
      if (text) {
        inputUrl.value = text.trim();
        detectPlatform(text.trim());
        showToast('Link pasted!', 'success');
      }
    } catch {
      inputUrl.focus();
      showToast('Press Cmd+V to paste', 'warning');
    }
  });

  // ==================== QUICK CHIPS ====================
  const chipSpotify = document.getElementById('chip-spotify-hit');
  if (chipSpotify) {
    chipSpotify.addEventListener('click', () => {
      inputUrl.value = 'https://open.spotify.com/playlist/37i9dQZF1DXcBWIGoYBM5M';
      detectPlatform(inputUrl.value);
      showToast('Loaded Top Hits playlist');
    });
  }

  const chipSingle = document.getElementById('chip-single-test');
  if (chipSingle) {
    chipSingle.addEventListener('click', () => {
      inputUrl.value = 'https://open.spotify.com/track/4P9Q0GoiGfFp2WrmUkyv1m';
      detectPlatform(inputUrl.value);
      showToast('Loaded single track');
    });
  }

  // ==================== MUSIC FOLDER & DEVICE FILE PICKER ====================
  const isMobilePlatform = window.location.protocol === 'capacitor:' ||
    (window.location.hostname === 'localhost' && (window.location.port === '' || window.location.port === '80')) ||
    /Android|iPhone|iPad|iPod/i.test(navigator.userAgent);

  const localMusicFolderInput = document.getElementById('local-music-folder-input');
  const localMusicFilesInput = document.getElementById('local-music-files-input');
  const btnChooseDeviceMusic = document.getElementById('btn-choose-device-music');

  window.localDeviceAudioFiles = window.localDeviceAudioFiles || new Map();

  function scanAndroidDeviceAudio() {
    if (window.AndroidMusicScanner && typeof window.AndroidMusicScanner.scanDeviceAudio === 'function') {
      try {
        const jsonStr = window.AndroidMusicScanner.scanDeviceAudio();
        const songs = JSON.parse(jsonStr || '[]');
        if (songs && songs.length > 0) {
          try {
            localStorage.setItem('musicstudio_device_songs', JSON.stringify(songs));
          } catch (storageErr) {
            console.warn('Could not cache all songs to localStorage (quota exceeded):', storageErr);
          }
          return songs;
        }
      } catch (e) {
        console.warn('Error in Android scanner:', e);
      }
    }
    return [];
  }

  window.onAndroidPermissionsGranted = function() {
    console.log('[Android] Audio permissions granted, refreshing device library...');
    const songs = scanAndroidDeviceAudio();
    if (songs && songs.length > 0) {
      rawLibrarySongs = songs;
      navSongCount.textContent = rawLibrarySongs.length;
      if (mobileNavSongCount) mobileNavSongCount.textContent = rawLibrarySongs.length;
      libraryCountLabel.textContent = `${rawLibrarySongs.length} track${rawLibrarySongs.length === 1 ? '' : 's'}`;
      applySortAndFilter();
      showToast(`Loaded ${songs.length} tracks from your phone!`, 'success');
    }
  };
  window.reloadAndroidLibrary = window.onAndroidPermissionsGranted;

  window.onAndroidDownloadComplete = function() {
    console.log('[Android] Download finished, rescanning device library...');
    const songs = scanAndroidDeviceAudio();
    if (songs && songs.length > 0) {
      rawLibrarySongs = songs;
      navSongCount.textContent = rawLibrarySongs.length;
      if (mobileNavSongCount) mobileNavSongCount.textContent = rawLibrarySongs.length;
      libraryCountLabel.textContent = `${rawLibrarySongs.length} track${rawLibrarySongs.length === 1 ? '' : 's'}`;
      applySortAndFilter();
      showToast('Track saved to your device library!', 'success');
    }
  };

  function triggerLocalMusicPicker() {
    if (window.AndroidMusicScanner) {
      if (typeof window.AndroidMusicScanner.hasStoragePermission === 'function' && !window.AndroidMusicScanner.hasStoragePermission()) {
        window.AndroidMusicScanner.requestStoragePermission();
        showToast('Please grant storage/audio permission in the dialog', 'info');
        return;
      }
      const songs = scanAndroidDeviceAudio();
      if (songs && songs.length > 0) {
        rawLibrarySongs = songs;
        navSongCount.textContent = rawLibrarySongs.length;
        if (mobileNavSongCount) mobileNavSongCount.textContent = rawLibrarySongs.length;
        libraryCountLabel.textContent = `${rawLibrarySongs.length} track${rawLibrarySongs.length === 1 ? '' : 's'}`;
        applySortAndFilter();
        showToast(`Loaded ${songs.length} tracks from your phone!`, 'success');
        return;
      }
    }

    if (localMusicFilesInput) {
      localMusicFilesInput.click();
    } else if (localMusicFolderInput) {
      try {
        localMusicFolderInput.click();
      } catch (e) {
        if (localMusicFilesInput) localMusicFilesInput.click();
      }
    }
  }

  if (btnOpenFolder) {
    if (isMobilePlatform) {
      btnOpenFolder.title = 'Choose Music Folder';
    }
    btnOpenFolder.addEventListener('click', async () => {
      if (isMobilePlatform) {
        triggerLocalMusicPicker();
        return;
      }
      // On desktop, try to open folder via backend API
      try {
        const res = await fetch('/api/open-folder', { method: 'POST' });
        if (res.ok) {
          showToast('Opened Songs directory in file manager', 'info');
          return;
        }
      } catch {}
      triggerLocalMusicPicker();
    });
  }

  if (btnChooseDeviceMusic) {
    btnChooseDeviceMusic.addEventListener('click', () => {
      triggerLocalMusicPicker();
    });
  }

  function handleLocalAudioFiles(files) {
    if (!files || files.length === 0) return;
    const audioFiles = Array.from(files).filter(f =>
      f.type.startsWith('audio/') ||
      /\.(mp3|m4a|wav|flac|ogg|opus|aac|wma)$/i.test(f.name)
    );
    if (audioFiles.length === 0) {
      showToast('No audio tracks found in selected folder', 'warning');
      return;
    }

    let addedCount = 0;
    audioFiles.forEach(file => {
      const fileId = 'local_' + encodeURIComponent(file.name) + '_' + file.size;
      window.localDeviceAudioFiles.set(fileId, file);

      let baseName = file.name.replace(/\.[^/.]+$/, '');
      let artist = 'Local Music';
      let title = baseName;
      if (baseName.includes(' - ')) {
        const parts = baseName.split(' - ');
        artist = parts[0].trim();
        title = parts.slice(1).join(' - ').trim();
      }

      const songObj = {
        id: fileId,
        filename: file.name,
        title: title || file.name,
        artist: artist,
        album: 'Device Music',
        duration: 0,
        is_local_device: true,
        file_ref_id: fileId,
        cover_url: 'placeholder.svg',
        mtime: file.lastModified ? Math.floor(file.lastModified / 1000) : Math.floor(Date.now() / 1000)
      };

      const existingIdx = rawLibrarySongs.findIndex(s => s.filename === file.name);
      if (existingIdx >= 0) {
        rawLibrarySongs[existingIdx] = songObj;
      } else {
        rawLibrarySongs.unshift(songObj);
        addedCount++;
      }
    });

    try {
      localStorage.setItem('musicstudio_cached_library', JSON.stringify(rawLibrarySongs));
    } catch (e) {}

    navSongCount.textContent = rawLibrarySongs.length;
    if (mobileNavSongCount) mobileNavSongCount.textContent = rawLibrarySongs.length;
    libraryCountLabel.textContent = `${rawLibrarySongs.length} track${rawLibrarySongs.length === 1 ? '' : 's'}`;
    applySortAndFilter();
    reconcileRestoredPlaybackWithLibrary();
    showToast(`Loaded ${addedCount || audioFiles.length} song${(addedCount || audioFiles.length) === 1 ? '' : 's'} from your device!`, 'success');
  }

  if (localMusicFolderInput) {
    localMusicFolderInput.addEventListener('change', (e) => {
      handleLocalAudioFiles(e.target.files);
    });
  }
  if (localMusicFilesInput) {
    localMusicFilesInput.addEventListener('change', (e) => {
      handleLocalAudioFiles(e.target.files);
    });
  }

  // ==================== START DOWNLOAD ====================
  btnDownload.addEventListener('click', async () => {
    const url = inputUrl.value.trim();
    if (!url) {
      showToast('Please enter a Spotify or YouTube Music link', 'warning');
      inputUrl.focus();
      return;
    }

    const payload = {
      url: url,
      threads: parseInt(settingThreads.value) || 3,
      quality: settingQuality.value || '320k',
      sort: settingSort.value || 'latest',
      naming: settingNaming.value || 'title'
    };

    try {
      btnDownload.disabled = true;
      btnDownload.innerHTML = `<span class="pulse-dot"></span> <span>Starting...</span>`;

      const res = await fetch('/api/download/start', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload)
      });

      if (!res.ok) {
        const err = await res.json();
        throw new Error(err.detail || 'Download failed to start');
      }

      showToast('Download started! Streaming tracks...', 'success');
      btnStop.style.display = 'inline-flex';
      statusBadge.className = 'hud-status-badge active-download';
      statusBadge.textContent = 'Downloading';
    } catch (e) {
      showToast(e.message, 'error');
    } finally {
      btnDownload.disabled = false;
      btnDownload.innerHTML = `<svg viewBox="0 0 24 24" width="17" height="17" fill="currentColor"><polygon points="5 3 19 12 5 21 5 3"/></svg> <span>Download</span>`;
    }
  });

  // ==================== STOP DOWNLOAD ====================
  btnStop.addEventListener('click', async () => {
    try {
      await fetch('/api/download/stop', { method: 'POST' });
      showToast('Stopping downloader...', 'warning');
      btnStop.style.display = 'none';
      statusBadge.className = 'hud-status-badge';
      statusBadge.textContent = 'Stopping';
    } catch {
      showToast('Failed to stop download', 'error');
    }
  });

  // ==================== ENRICH METADATA BUTTON ====================
  btnEnrichAll.addEventListener('click', async () => {
    try {
      btnEnrichAll.disabled = true;
      btnEnrichAll.textContent = 'Enriching...';

      const res = await fetch('/api/enrich/start', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ threads: 4, upgrade_artwork: true, force: false })
      });

      if (!res.ok) {
        const err = await res.json();
        throw new Error(err.detail || 'Enrichment failed');
      }

      showToast('Studio metadata enrichment active!', 'success');
      statusBadge.className = 'hud-status-badge active-enrich';
      statusBadge.textContent = 'Enriching';
    } catch (e) {
      showToast(e.message, 'error');
    } finally {
      btnEnrichAll.disabled = false;
      btnEnrichAll.textContent = '✨ Enrich Studio Art & Tags';
    }
  });

  // ==================== REAL-TIME SSE STREAM ====================
  function initEventStream() {
    const evtSource = new EventSource('/api/events');

    evtSource.onmessage = (e) => {
      try {
        const msg = JSON.parse(e.data);
        const { type, data } = msg;

        if (type === 'playlist_loaded') {
          metricPlaylistName.textContent = data.title || 'Playlist';
          metricStatusMsg.textContent = `${data.total} tracks queued`;
          metricTotal.textContent = `0 / ${data.total}`;
          statusBadge.className = 'hud-status-badge active-download';
          statusBadge.textContent = 'Downloading';
        } else if (type === 'progress') {
          const { processed, total, percent, downloaded, skipped, last_song } = data;
          progressBar.style.width = `${percent}%`;
          metricPercent.textContent = `${percent}%`;
          metricTotal.textContent = `${processed} / ${total}`;
          metricDownloaded.textContent = downloaded || 0;
          metricSkipped.textContent = skipped || 0;

          if (last_song) {
            appendStreamRow(last_song);
          }
        } else if (type === 'enrich_progress') {
          const { current, total, percent, title, status } = data;
          progressBar.style.width = `${percent}%`;
          metricPercent.textContent = `${percent}%`;
          metricTotal.textContent = `${current} / ${total}`;
          metricStatusMsg.textContent = `${status || 'Enriching'}: ${title || ''}`;
        } else if (type === 'enrich_complete') {
          showToast(`✨ Enrichment complete! Updated ${data.updated || 0} tracks`, 'success');
          statusBadge.className = 'hud-status-badge';
          statusBadge.textContent = 'Idle';
          metricStatusMsg.textContent = 'Metadata & HD art enriched';
          loadLibrary();
        } else if (type === 'completed') {
          showToast(`Done! Downloaded ${data.downloaded} tracks (${data.time}s)`, 'success');
          btnStop.style.display = 'none';
          statusBadge.className = 'hud-status-badge';
          statusBadge.textContent = 'Idle';
          metricStatusMsg.textContent = 'Download session finished';
          loadLibrary();
        } else if (type === 'status') {
          metricStatusMsg.textContent = data.message || '';
        } else if (type === 'playback_command') {
          if (data.action === 'toggle') {
            togglePlay();
          } else if (data.action === 'play') {
            if (audioEngine.paused) togglePlay();
          } else if (data.action === 'pause') {
            if (!audioEngine.paused) togglePlay();
          } else if (data.action === 'next') {
            playNextTrack();
          } else if (data.action === 'prev') {
            playPrevTrack();
          } else if (data.action === 'seek' && typeof data.time === 'number') {
            seekAudioTo(data.time);
          } else if (data.action === 'stream_track' || data.action === 'play_stream') {
            let trackData = null;
            if (data.filename && data.filename.startsWith('{')) {
              try {
                trackData = JSON.parse(data.filename);
              } catch (e) {}
            }
            if (!trackData && data.title) {
              trackData = {
                title: data.title,
                artist: data.artist || '',
                album: data.album || 'Online Stream',
                cover_url: data.cover_url || '',
                duration: data.duration || 0,
                query: data.query || `${data.title} ${data.artist || ''}`
              };
            }
            if (trackData) {
              playOnlineTrack(trackData);
            }
          } else if (data.action === 'play_track') {
            const matchIdx = librarySongs.findIndex(s => s.filename === data.filename || (data.title && s.title.toLowerCase() === data.title.toLowerCase()));
            if (matchIdx >= 0) {
              playTrack(matchIdx);
            } else if (data.filename && data.filename.startsWith('{')) {
              try {
                const trackData = JSON.parse(data.filename);
                playOnlineTrack(trackData);
              } catch (e) {}
            } else if (data.title) {
              playOnlineTrack({
                title: data.title,
                artist: data.artist || '',
                album: 'Online Stream',
                query: data.title
              });
            }
          } else if (data.action === 'play_index' && typeof data.index === 'number') {
            if (data.index >= 0 && data.index < librarySongs.length) {
              playTrack(data.index);
            }
          }
        }
      } catch (err) {
        console.error('SSE parse error:', err);
      }
    };

    evtSource.onerror = () => {
      setTimeout(initEventStream, 3000);
    };
  }

  function appendStreamRow(song) {
    const emptyState = streamFeed.querySelector('.empty-state');
    if (emptyState) emptyState.remove();

    const row = document.createElement('div');
    row.className = 'feed-item';

    const statusClass = song.status === 'downloaded' ? 'downloaded' : (song.status === 'skipped' ? 'skipped' : 'failed');
    const statusLabel = song.status === 'downloaded' ? '⚡ 320k' : (song.status === 'skipped' ? '⏩ Cached' : '❌ Failed');
    const coverUrl = `/api/songs/artwork/${encodeURIComponent(song.filename || song.title + '.mp3')}`;

    row.innerHTML = `
      <div class="feed-item-left">
        <img class="feed-thumb" src="${coverUrl}" onerror="this.src='placeholder.svg'" alt="Cover" />
        <div class="feed-item-text truncate">
          <div class="feed-item-title truncate">${escapeHtml(song.title || 'Unknown Track')}</div>
          <div class="feed-item-artist truncate">${escapeHtml(song.artist || 'Unknown Artist')}</div>
        </div>
      </div>
      <div class="feed-item-right">
        <span class="status-chip ${statusClass}">${statusLabel}</span>
      </div>
    `;

    streamFeed.prepend(row);
    if (streamFeed.children.length > 30) {
      streamFeed.removeChild(streamFeed.lastChild);
    }
  }

  // ==================== LIBRARY LOADING, GROUPING & SORTING ====================
  async function loadLibrary(query = '') {
    try {
      const url = query ? `/api/songs?search=${encodeURIComponent(query)}` : '/api/songs';
      const res = await fetch(url);
      const contentType = res.headers.get('content-type') || '';
      if (!res.ok || !contentType.includes('application/json')) throw new Error('Desktop server not available');

      rawLibrarySongs = await res.json();
      if (!query) {
        localStorage.setItem('musicstudio_cached_library', JSON.stringify(rawLibrarySongs));
      }
    } catch (e) {
      let songs = [];
      if (window.AndroidMusicScanner) {
        songs = scanAndroidDeviceAudio();
      }
      if (!songs || songs.length === 0) {
        try {
          const cachedDev = localStorage.getItem('musicstudio_device_songs');
          if (cachedDev) songs = JSON.parse(cachedDev);
        } catch (err) {}
      }
      if (!songs || songs.length === 0) {
        try {
          const cached = localStorage.getItem('musicstudio_cached_library');
          if (cached) songs = JSON.parse(cached);
        } catch (err) {}
      }

      rawLibrarySongs = songs || [];
      if (query && rawLibrarySongs.length > 0) {
        const qLower = query.toLowerCase();
        rawLibrarySongs = rawLibrarySongs.filter(s =>
          (s.title || '').toLowerCase().includes(qLower) ||
          (s.artist || '').toLowerCase().includes(qLower) ||
          (s.album || '').toLowerCase().includes(qLower)
        );
      }
    }

    navSongCount.textContent = rawLibrarySongs.length;
    if (mobileNavSongCount) mobileNavSongCount.textContent = rawLibrarySongs.length;
    libraryCountLabel.textContent = `${rawLibrarySongs.length} track${rawLibrarySongs.length === 1 ? '' : 's'}`;
    applySortAndFilter();
    reconcileRestoredPlaybackWithLibrary();
  }

  async function loadUserPlaylists() {
    try {
      const res = await fetch('/api/playlists');
      if (res.ok) {
        userPlaylists = await res.json();
        localStorage.setItem('musicstudio_cached_playlists', JSON.stringify(userPlaylists));
        if (currentGroupMode === 'playlists') {
          renderLibrary();
        }
      }
    } catch (e) {
      console.warn('Network issue fetching playlists, falling back to local cache:', e);
      const cached = localStorage.getItem('musicstudio_cached_playlists');
      if (cached) {
        try {
          userPlaylists = JSON.parse(cached);
          if (currentGroupMode === 'playlists') {
            renderLibrary();
          }
        } catch (err) {}
      }
    }
  }

  function applySortAndFilter() {
    let list = [...rawLibrarySongs];
    const q = (librarySearch.value || '').trim().toLowerCase();
    if (q) {
      list = list.filter(s =>
        (s.title || '').toLowerCase().includes(q) ||
        (s.artist || '').toLowerCase().includes(q) ||
        (s.album || '').toLowerCase().includes(q) ||
        (s.genre || '').toLowerCase().includes(q)
      );
    }

    if (currentSortMode === 'recent') {
      list.sort((a, b) => (b.mtime || 0) - (a.mtime || 0));
    } else if (currentSortMode === 'title') {
      list.sort((a, b) => (a.title || '').localeCompare(b.title || ''));
    } else if (currentSortMode === 'artist') {
      list.sort((a, b) => (a.artist || '').localeCompare(b.artist || ''));
    } else if (currentSortMode === 'duration') {
      list.sort((a, b) => (b.duration || 0) - (a.duration || 0));
    }

    librarySongs = list;

    if (currentGroupMode === 'playlists' || currentGroupMode === 'most_played') {
      renderLibrary();
      return;
    }

    libraryCountLabel.textContent = `${librarySongs.length} track${librarySongs.length === 1 ? '' : 's'}`;
    generateShuffleQueue(currentSongIndex >= 0 ? currentSongIndex : -1);
    renderLibrary();
  }

  function renderLibrary() {
    libraryContainer.innerHTML = '';

    if (currentGroupMode === 'playlists') {
      if (viewSwitchWrap) viewSwitchWrap.style.display = 'none';
      libraryContainer.classList.add('grid-mode');
      libraryContainer.classList.remove('list-mode');
      renderPlaylistsGroupView();
      return;
    }

    if (currentGroupMode === 'most_played') {
      if (viewSwitchWrap) viewSwitchWrap.style.display = 'flex';
      renderMostPlayedGroupView();
      return;
    }

    if (librarySongs.length === 0) {
      const isSearchActive = Boolean((librarySearch.value || '').trim());
      if (isSearchActive) {
        libraryContainer.innerHTML = `
          <div class="empty-state glass" style="grid-column: 1 / -1; width: 100%;">
            <div class="empty-icon-wrap">
              <svg viewBox="0 0 24 24" width="28" height="28" fill="none" stroke="currentColor" stroke-width="1.5">
                <circle cx="12" cy="12" r="10" />
                <polygon points="10 8 16 12 10 16 10 8" />
              </svg>
            </div>
            <p>No tracks matching search criteria</p>
          </div>
        `;
      } else {
        libraryContainer.innerHTML = `
          <div class="empty-state glass" style="grid-column: 1 / -1; width: 100%; padding: 45px 20px; text-align: center;">
            <div style="font-size: 3rem; margin-bottom: 12px;">📁</div>
            <h3 style="font-size: 1.28rem; font-weight: 700; margin-bottom: 8px; color: var(--text-primary);">No Local Songs Found</h3>
            <p style="font-size: 0.9rem; color: var(--text-secondary); max-width: 420px; margin: 0 auto 22px; line-height: 1.5;">
              Choose your music folder on this device to instantly load your downloaded songs, or connect to your desktop PC.
            </p>
            <div style="display: flex; gap: 12px; justify-content: center; flex-wrap: wrap;">
              <button class="btn-primary" id="btn-empty-choose-folder" style="padding: 11px 20px; border-radius: 10px; font-weight: 600; display: inline-flex; align-items: center; gap: 8px; font-size: 0.9rem;">
                <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2"><path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z"/></svg>
                <span>Choose Music Folder</span>
              </button>
              <button class="btn-secondary" id="btn-empty-choose-files" style="padding: 11px 20px; border-radius: 10px; font-weight: 600; display: inline-flex; align-items: center; gap: 8px; font-size: 0.9rem;">
                <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="10"/><line x1="12" y1="8" x2="12" y2="16"/><line x1="8" y1="12" x2="16" y2="12"/></svg>
                <span>Select Audio Files</span>
              </button>
            </div>
          </div>
        `;
        const emptyFolderBtn = document.getElementById('btn-empty-choose-folder');
        const emptyFilesBtn = document.getElementById('btn-empty-choose-files');
        if (emptyFolderBtn) emptyFolderBtn.addEventListener('click', triggerLocalMusicPicker);
        if (emptyFilesBtn) emptyFilesBtn.addEventListener('click', () => {
          if (localMusicFilesInput) localMusicFilesInput.click();
        });
      }
      return;
    }

    if (currentGroupMode === 'tracks') {
      if (viewSwitchWrap) viewSwitchWrap.style.display = 'flex';
      const isGrid = libraryContainer.classList.contains('grid-mode');

      if (isGrid) {
        librarySongs.forEach((song, idx) => {
          const card = document.createElement('div');
          card.className = 'song-card' + (idx === currentSongIndex ? ' playing' : '');
          card.dataset.index = idx;
          const coverUrl = (song.cover_url && song.cover_url !== 'placeholder.svg') ? song.cover_url : (song.is_local_device ? 'placeholder.svg' : resolveApiUrl(`/api/songs/artwork/${encodeURIComponent(song.filename)}`));

          card.innerHTML = `
            <div class="song-card-art-wrap">
              <img class="song-card-art" src="${coverUrl}" onerror="this.src='placeholder.svg'" alt="Cover" loading="lazy" />
              <div class="song-card-play-overlay">
                <div class="card-play-circle" title="Play">
                  <svg viewBox="0 0 24 24" width="18" height="18" fill="currentColor"><polygon points="5 3 19 12 5 21 5 3"/></svg>
                </div>
              </div>
            </div>
            <div class="song-card-info">
              <div class="song-card-title truncate" title="${escapeHtml(song.title)}">${escapeHtml(song.title)}</div>
              <div class="song-card-artist truncate" title="${escapeHtml(song.artist)}">${escapeHtml(song.artist)}</div>
            </div>
          `;

          card.querySelector('.card-play-circle').addEventListener('click', (e) => {
            e.stopPropagation();
            playTrack(idx);
          });

          card.addEventListener('dblclick', () => {
            playTrack(idx);
          });

          card.addEventListener('click', () => {
            openDrawer(song, idx);
          });

          libraryContainer.appendChild(card);
        });
      } else {
        librarySongs.forEach((song, idx) => {
          const row = document.createElement('div');
          row.className = 'song-row' + (idx === currentSongIndex ? ' playing' : '');
          row.dataset.index = idx;
          const coverUrl = (song.cover_url && song.cover_url !== 'placeholder.svg') ? song.cover_url : (song.is_local_device ? 'placeholder.svg' : resolveApiUrl(`/api/songs/artwork/${encodeURIComponent(song.filename)}`));
          const durationFormatted = formatSeconds(song.duration || 0);

          row.innerHTML = `
            <div class="song-row-left">
              <span class="song-row-num">${idx + 1}</span>
              <img class="song-row-thumb" src="${coverUrl}" onerror="this.src='placeholder.svg'" alt="Cover" />
              <div class="song-row-meta truncate">
                <div class="song-row-title truncate" title="${escapeHtml(song.title)}">${escapeHtml(song.title)}</div>
                <div class="song-row-artist truncate" title="${escapeHtml(song.artist)}">${escapeHtml(song.artist)}</div>
              </div>
            </div>
            <div class="song-row-album truncate">${escapeHtml(song.album || '—')}</div>
            <div class="song-row-duration">${durationFormatted}</div>
            <div class="song-row-actions">
              <button class="row-delete-btn" title="Delete from Library">
                <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2">
                  <polyline points="3 6 5 6 21 6"></polyline>
                  <path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"></path>
                  <line x1="10" y1="11" x2="10" y2="17"></line>
                  <line x1="14" y1="11" x2="14" y2="17"></line>
                </svg>
              </button>
              <button class="row-play-btn" title="Play Track">
                <svg viewBox="0 0 24 24" width="18" height="18" fill="currentColor"><polygon points="5 3 19 12 5 21 5 3"/></svg>
              </button>
            </div>
          `;

          const rowDelBtn = row.querySelector('.row-delete-btn');
          if (rowDelBtn) {
            rowDelBtn.addEventListener('click', (e) => {
              e.stopPropagation();
              promptDeleteSong(song);
            });
          }

          row.querySelector('.row-play-btn').addEventListener('click', (e) => {
            e.stopPropagation();
            playTrack(idx);
          });

          row.addEventListener('dblclick', () => {
            playTrack(idx);
          });

          row.addEventListener('click', () => {
            openDrawer(song, idx);
          });

          libraryContainer.appendChild(row);
        });
      }
    } else if (currentGroupMode === 'artists') {
      if (viewSwitchWrap) viewSwitchWrap.style.display = 'none';
      libraryContainer.classList.add('grid-mode');
      libraryContainer.classList.remove('list-mode');

      const artistMap = {};
      librarySongs.forEach(song => {
        const a = song.artist || 'Unknown Artist';
        if (!artistMap[a]) artistMap[a] = [];
        artistMap[a].push(song);
      });

      const artists = Object.keys(artistMap).sort((a, b) => a.localeCompare(b));
      artists.forEach(artist => {
        const songs = artistMap[artist];
        const repCover = `/api/songs/artwork/${encodeURIComponent(songs[0].filename)}`;
        const card = document.createElement('div');
        card.className = 'group-card';
        card.innerHTML = `
          <img class="artist-avatar" src="${repCover}" onerror="this.src='placeholder.svg'" alt="${escapeHtml(artist)}" />
          <div class="group-title truncate" title="${escapeHtml(artist)}">${escapeHtml(artist)}</div>
          <div class="group-sub">${songs.length} track${songs.length === 1 ? '' : 's'}</div>
        `;
        card.addEventListener('click', () => {
          librarySearch.value = artist;
          btnClearSearch.style.display = 'block';
          currentGroupMode = 'tracks';
          groupPills.forEach(p => p.classList.toggle('active', p.dataset.group === 'tracks'));
          applySortAndFilter();
        });
        libraryContainer.appendChild(card);
      });
    } else if (currentGroupMode === 'albums') {
      if (viewSwitchWrap) viewSwitchWrap.style.display = 'none';
      libraryContainer.classList.add('grid-mode');
      libraryContainer.classList.remove('list-mode');

      const albumMap = {};
      librarySongs.forEach(song => {
        const key = `${song.album || 'Unknown Album'}___${song.artist || ''}`;
        if (!albumMap[key]) {
          albumMap[key] = {
            album: song.album || 'Unknown Album',
            artist: song.artist || 'Unknown Artist',
            year: song.year || '',
            songs: []
          };
        }
        albumMap[key].songs.push(song);
      });

      const albums = Object.values(albumMap).sort((a, b) => a.album.localeCompare(b.album));
      albums.forEach(item => {
        const repCover = `/api/songs/artwork/${encodeURIComponent(item.songs[0].filename)}`;
        const card = document.createElement('div');
        card.className = 'group-card';
        card.innerHTML = `
          <div class="album-art-wrap">
            <img src="${repCover}" onerror="this.src='placeholder.svg'" alt="${escapeHtml(item.album)}" />
          </div>
          <div class="group-title truncate" title="${escapeHtml(item.album)}">${escapeHtml(item.album)}</div>
          <div class="group-sub truncate">${escapeHtml(item.artist)}${item.year ? ` • ${item.year}` : ''} • ${item.songs.length} tracks</div>
        `;
        card.addEventListener('click', () => {
          librarySearch.value = item.album;
          btnClearSearch.style.display = 'block';
          currentGroupMode = 'tracks';
          groupPills.forEach(p => p.classList.toggle('active', p.dataset.group === 'tracks'));
          applySortAndFilter();
        });
        libraryContainer.appendChild(card);
      });
    } else if (currentGroupMode === 'genres') {
      if (viewSwitchWrap) viewSwitchWrap.style.display = 'none';
      libraryContainer.classList.add('grid-mode');
      libraryContainer.classList.remove('list-mode');

      function resolveSongGenre(song) {
        if (song.genre && song.genre !== 'General' && song.genre !== 'Unknown' && song.genre.trim()) {
          return song.genre.trim();
        }
        const combined = `${song.artist || ''} ${song.title || ''} ${song.album || ''}`.toLowerCase();
        if (combined.includes('rock') || combined.includes('queen') || combined.includes('ac/dc') || combined.includes('metallica') || combined.includes('linkin park') || combined.includes('nirvana') || combined.includes('beatles')) return 'Rock';
        if (combined.includes('hip hop') || combined.includes('rap') || combined.includes('drake') || combined.includes('eminem') || combined.includes('kendrick') || combined.includes('travis') || combined.includes('kanye') || combined.includes('future') || combined.includes('tupac')) return 'Hip-Hop';
        if (combined.includes('edm') || combined.includes('dance') || combined.includes('house') || combined.includes('dj') || combined.includes('avicii') || combined.includes('garrix') || combined.includes('tiesto') || combined.includes('marshmello') || combined.includes('guetta')) return 'Electronic';
        if (combined.includes('pop') || combined.includes('swift') || combined.includes('sheeran') || combined.includes('grande') || combined.includes('dua lipa') || combined.includes('bieber') || combined.includes('weeknd') || combined.includes('billie') || combined.includes('bruno') || combined.includes('olivia')) return 'Pop';
        if (combined.includes('r&b') || combined.includes('sza') || combined.includes('beyonce') || combined.includes('rihanna') || combined.includes('frank ocean') || combined.includes('chris brown') || combined.includes('usher')) return 'R&B';
        if (combined.includes('classical') || combined.includes('orchestra') || combined.includes('mozart') || combined.includes('beethoven') || combined.includes('bach') || combined.includes('chopin') || combined.includes('piano')) return 'Classical';
        if (combined.includes('jazz') || combined.includes('miles davis') || combined.includes('coltrane') || combined.includes('sinatra') || combined.includes('armstrong') || combined.includes('fitzgerald')) return 'Jazz';
        if (combined.includes('country') || combined.includes('luke combs') || combined.includes('morgan wallen') || combined.includes('dolly') || combined.includes('cash') || combined.includes('zach bryan')) return 'Country';
        if (combined.includes('latin') || combined.includes('bad bunny') || combined.includes('reggaeton') || combined.includes('j balvin') || combined.includes('rosalia') || combined.includes('maluma')) return 'Latin';
        if (combined.includes('k-pop') || combined.includes('bts') || combined.includes('blackpink') || combined.includes('twice') || combined.includes('stray kids') || combined.includes('newjeans')) return 'K-Pop';
        if (combined.includes('hindi') || combined.includes('bollywood') || combined.includes('arijit') || combined.includes('shreya') || combined.includes('atif') || combined.includes('nepali') || combined.includes('punjabi') || combined.includes('sidhu')) return 'Desi & Hindi';
        if (combined.includes('lofi') || combined.includes('chill') || combined.includes('ambient') || combined.includes('relax')) return 'Chillout & Lofi';
        if (combined.includes('indie') || combined.includes('arctic monkeys') || combined.includes('tame impala') || combined.includes('strokes') || combined.includes('phoenix')) return 'Indie & Alternative';
        if (combined.includes('soundtrack') || combined.includes('score') || combined.includes('zimmer') || combined.includes('williams') || combined.includes('morricone') || combined.includes('ost')) return 'Soundtrack';
        return 'Studio Hits';
      }

      const genreMap = {};
      librarySongs.forEach(song => {
        const g = resolveSongGenre(song);
        if (!genreMap[g]) genreMap[g] = [];
        genreMap[g].push(song);
      });

      const genres = Object.keys(genreMap).sort((a, b) => a.localeCompare(b));
      genres.forEach(genre => {
        const songs = genreMap[genre];
        const meta = getGenreBadgeMeta(genre);
        const repCover = songs[0].cover_url || (songs[0].filename ? resolveApiUrl(`/api/songs/artwork/${encodeURIComponent(songs[0].filename)}`) : 'placeholder.svg');
        const card = document.createElement('div');
        card.className = 'group-card genre-card';
        card.innerHTML = `
          <div class="genre-card-art-container" style="position: relative; width: 100%; aspect-ratio: 1/1; border-radius: var(--radius-md); overflow: hidden; margin-bottom: 12px; background: ${meta.bg};">
            <img src="${repCover}" onerror="this.style.opacity='0'" style="width: 100%; height: 100%; object-fit: cover; opacity: 0.78; filter: brightness(0.9); transition: transform 0.3s ease;" class="genre-bg-img" />
            <div class="genre-badge-icon" style="position: absolute; bottom: 10px; right: 10px; background: rgba(0,0,0,0.65); backdrop-filter: blur(8px); border: 1px solid ${meta.border}; border-radius: 10px; width: 44px; height: 44px; font-size: 1.5rem; display: flex; align-items: center; justify-content: center; box-shadow: 0 4px 12px rgba(0,0,0,0.5);">${meta.icon}</div>
          </div>
          <div class="group-title truncate" title="${escapeHtml(genre)}">${escapeHtml(genre)}</div>
          <div class="group-sub">${songs.length} track${songs.length === 1 ? '' : 's'}</div>
        `;
        card.addEventListener('click', () => {
          librarySearch.value = genre;
          btnClearSearch.style.display = 'block';
          currentGroupMode = 'tracks';
          groupPills.forEach(p => p.classList.toggle('active', p.dataset.group === 'tracks'));
          applySortAndFilter();
        });
        libraryContainer.appendChild(card);
      });
    }
  }

  function renderPlaylistsGroupView() {
    libraryContainer.innerHTML = '';

    const isCustomPl = (p) => Boolean(p.is_custom) || p.type === 'custom';
    const customCount = userPlaylists.filter(p => !p.is_smart && isCustomPl(p)).length;
    const favCount = userPlaylists.filter(p => !p.is_smart && !isCustomPl(p)).length;

    // Sub-filters bar
    const filterBar = document.createElement('div');
    filterBar.className = 'playlist-filter-bar';
    filterBar.innerHTML = `
      <button class="playlist-filter-pill ${playlistSubFilter === 'all' ? 'active' : ''}" data-sub="all">All Playlists (${userPlaylists.length})</button>
      <button class="playlist-filter-pill ${playlistSubFilter === 'custom' ? 'active' : ''}" data-sub="custom">Custom (${customCount})</button>
      <button class="playlist-filter-pill ${playlistSubFilter === 'favorites' ? 'active' : ''}" data-sub="favorites">Saved (${favCount})</button>
    `;

    filterBar.querySelectorAll('.playlist-filter-pill').forEach(btn => {
      btn.addEventListener('click', () => {
        playlistSubFilter = btn.dataset.sub;
        renderPlaylistsGroupView();
      });
    });

    libraryContainer.appendChild(filterBar);

    let filtered = [...userPlaylists];
    if (playlistSubFilter === 'custom') {
      filtered = filtered.filter(p => !p.is_smart && isCustomPl(p));
    } else if (playlistSubFilter === 'favorites') {
      filtered = filtered.filter(p => !p.is_smart && !isCustomPl(p));
    }

    const q = (librarySearch.value || '').trim().toLowerCase();
    if (q) {
      filtered = filtered.filter(p =>
        (p.title || '').toLowerCase().includes(q) ||
        (p.description || '').toLowerCase().includes(q)
      );
    }

    libraryCountLabel.textContent = `${filtered.length} playlist${filtered.length === 1 ? '' : 's'}`;

    if (filtered.length === 0) {
      const empty = document.createElement('div');
      empty.className = 'empty-state glass';
      empty.style.cssText = 'grid-column: 1 / -1; width: 100%; padding: 48px 20px;';
      empty.innerHTML = `
        <div class="empty-icon-wrap">
          <svg viewBox="0 0 24 24" width="32" height="32" fill="none" stroke="currentColor" stroke-width="1.8">
            <line x1="8" y1="6" x2="21" y2="6"/>
            <line x1="8" y1="12" x2="21" y2="12"/>
            <line x1="8" y1="18" x2="21" y2="18"/>
            <circle cx="4" cy="6" r="1.5" fill="currentColor"/>
            <circle cx="4" cy="12" r="1.5" fill="currentColor"/>
            <circle cx="4" cy="18" r="1.5" fill="currentColor"/>
          </svg>
        </div>
        <p style="font-size: 1rem; font-weight: 700; color: var(--text-primary); margin-top: 10px;">No playlists found</p>
        <span style="font-size: 0.8rem; color: var(--text-secondary); margin-top: 4px;">Create your personal custom playlist or save curated playlists from Discover</span>
        <button class="btn-primary" id="btn-empty-create-pl" style="margin-top: 16px;">+ Create New Playlist</button>
      `;
      const btn = empty.querySelector('#btn-empty-create-pl');
      if (btn) btn.addEventListener('click', openCreatePlaylistModal);
      libraryContainer.appendChild(empty);
      return;
    }

    filtered.forEach(playlist => {
      const card = document.createElement('div');
      card.className = 'playlist-card';
      const trackCount = playlist.track_count || (playlist.tracks ? playlist.tracks.length : 0);
      const isSmart = Boolean(playlist.is_smart) || playlist.id === 'smart_most_played';
      const isCustom = !isSmart && isCustomPl(playlist);
      const badgeClass = isSmart ? 'playlist-badge-smart' : (isCustom ? 'playlist-badge-custom' : 'playlist-badge-saved');
      const badgeText = isSmart ? '🔥 Top 100' : (isCustom ? 'Custom' : 'Saved');
      const coverSrc = playlist.cover_url || 'placeholder.svg';

      if (isSmart) card.classList.add('smart-card');

      card.innerHTML = `
        <div class="playlist-card-art-wrap">
          <img class="playlist-card-art" src="${coverSrc}" onerror="this.src='placeholder.svg'" alt="${escapeHtml(playlist.title)}" loading="lazy" />
          <span class="playlist-card-badge ${badgeClass}">${badgeText}</span>
          <button class="playlist-card-delete-btn" title="Delete Playlist">
            <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2">
              <polyline points="3 6 5 6 21 6"/>
              <path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/>
            </svg>
          </button>
          <div class="playlist-card-overlay">
            <div class="playlist-card-open-btn">
              <svg viewBox="0 0 24 24" width="16" height="16" fill="currentColor"><polygon points="5 3 19 12 5 21 5 3"/></svg>
              <span>Open Collection</span>
            </div>
          </div>
        </div>
        <div class="playlist-card-info">
          <div class="playlist-card-title truncate" title="${escapeHtml(playlist.title)}">${escapeHtml(playlist.title)}</div>
          <div class="playlist-card-subtitle truncate">${escapeHtml(playlist.description || (isCustom ? 'Personal Studio Playlist' : 'Saved Collection'))} • ${trackCount} track${trackCount === 1 ? '' : 's'}</div>
        </div>
      `;

      const delBtn = card.querySelector('.playlist-card-delete-btn');
      if (isSmart && delBtn) {
        delBtn.style.display = 'none';
      } else if (delBtn) {
        delBtn.addEventListener('click', (e) => {
          e.stopPropagation();
          showConfirmDialog({
            title: 'Delete Playlist?',
            message: 'Are you sure you want to delete "' + (playlist.title || 'Playlist') + '"? Audio tracks will remain in your library.',
            itemTitle: playlist.title,
            itemSub: (playlist.tracks ? playlist.tracks.length : 0) + ' tracks',
            confirmText: 'Delete Playlist',
            isDanger: true,
            onConfirm: () => {
              deleteUserPlaylist(playlist.id);
            }
          });
        });
      }

      card.addEventListener('click', () => {
        openPlaylistModal(playlist.id, false, playlist);
      });

      libraryContainer.appendChild(card);
    });
  }

  async function deleteUserPlaylist(playlistId) {
    try {
      const res = await fetch(`/api/playlists/${encodeURIComponent(playlistId)}`, {
        method: 'DELETE'
      });
      if (!res.ok) {
        const err = await res.json();
        throw new Error(err.detail || 'Failed to delete playlist');
      }
      showToast('Playlist deleted successfully', 'info');
      await loadUserPlaylists();
      renderLibrary();
    } catch (e) {
      showToast(e.message, 'error');
    }
  }

  async function renderMostPlayedGroupView() {
    libraryContainer.innerHTML = '';
    
    let topTracks = [];
    try {
      const res = await fetch('/api/play-stats/most-played?limit=100');
      if (res.ok) {
        topTracks = await res.json();
      }
    } catch (e) {}

    if (!topTracks.length) {
      const stored = JSON.parse(localStorage.getItem('musicstudio_play_counts') || '{}');
      topTracks = librarySongs.map(s => {
        const key = s.filename || `${(s.title||'').toLowerCase()} - ${(s.artist||'').toLowerCase()}`;
        return { ...s, play_count: stored[key] || 0 };
      }).filter(s => s.play_count > 0).sort((a,b) => b.play_count - a.play_count);
    }

    const q = (librarySearch.value || '').trim().toLowerCase();
    if (q) {
      topTracks = topTracks.filter(s =>
        (s.title || '').toLowerCase().includes(q) ||
        (s.artist || '').toLowerCase().includes(q) ||
        (s.album || '').toLowerCase().includes(q)
      );
    }

    libraryCountLabel.textContent = `${topTracks.length} track${topTracks.length === 1 ? '' : 's'}`;

    if (topTracks.length === 0) {
      const empty = document.createElement('div');
      empty.className = 'empty-state glass';
      empty.style.cssText = 'grid-column: 1 / -1; width: 100%; padding: 48px 20px;';
      empty.innerHTML = `
        <div class="empty-icon-wrap" style="color: #f97316; font-size: 28px;">🔥</div>
        <p style="font-size: 1rem; font-weight: 700; color: var(--text-primary); margin-top: 10px;">No played tracks recorded yet</p>
        <span style="font-size: 0.8rem; color: var(--text-secondary); margin-top: 4px;">Play your favorite songs in Music Studio and they will automatically rank here in your Top 100!</span>
      `;
      libraryContainer.appendChild(empty);
      return;
    }

    const isGrid = libraryContainer.classList.contains('grid-mode');
    if (isGrid) {
      topTracks.forEach((song, idx) => {
        const card = document.createElement('div');
        card.className = 'song-card';
        const coverUrl = (song.cover_url && song.cover_url !== 'placeholder.svg') ? song.cover_url : (song.filename ? resolveApiUrl(`/api/songs/artwork/${encodeURIComponent(song.filename)}`) : 'placeholder.svg');

        card.innerHTML = `
          <div class="song-card-art-wrap">
            <img class="song-card-art" src="${coverUrl}" onerror="this.src='placeholder.svg'" alt="Cover" loading="lazy" />
            <div class="song-card-play-overlay">
              <div class="card-play-circle" title="Play">
                <svg viewBox="0 0 24 24" width="18" height="18" fill="currentColor"><polygon points="5 3 19 12 5 21 5 3"/></svg>
              </div>
            </div>
            <div class="play-count-badge" style="position: absolute; top: 8px; left: 8px; z-index: 2;">🔥 ${song.play_count || 1}</div>
          </div>
          <div class="song-card-info">
            <div class="song-card-title truncate" title="${escapeHtml(song.title)}">${escapeHtml(song.title)}</div>
            <div class="song-card-artist truncate" title="${escapeHtml(song.artist)}">${escapeHtml(song.artist)}</div>
          </div>
        `;

        card.querySelector('.card-play-circle').addEventListener('click', (e) => {
          e.stopPropagation();
          playTopTrack(song, topTracks, idx);
        });
        card.addEventListener('dblclick', () => playTopTrack(song, topTracks, idx));
        card.addEventListener('click', () => openDrawer(song, idx));
        libraryContainer.appendChild(card);
      });
    } else {
      topTracks.forEach((song, idx) => {
        const row = document.createElement('div');
        row.className = 'song-row';
        const coverUrl = (song.cover_url && song.cover_url !== 'placeholder.svg') ? song.cover_url : (song.filename ? resolveApiUrl(`/api/songs/artwork/${encodeURIComponent(song.filename)}`) : 'placeholder.svg');

        row.innerHTML = `
          <div class="col-index">
            <span class="index-num" style="color: #f97316; font-weight: 700;">#${idx + 1}</span>
            <div class="row-play-btn">
              <svg viewBox="0 0 24 24" width="14" height="14" fill="currentColor"><polygon points="5 3 19 12 5 21 5 3"/></svg>
            </div>
          </div>
          <div class="col-title">
            <img class="song-row-thumb" src="${coverUrl}" onerror="this.src='placeholder.svg'" alt="Thumb" loading="lazy" />
            <div class="song-title-group">
              <div class="song-row-title truncate" title="${escapeHtml(song.title)}">${escapeHtml(song.title)}</div>
              <div class="song-row-artist truncate" title="${escapeHtml(song.artist)}">${escapeHtml(song.artist)}</div>
            </div>
            <div class="play-count-badge">🔥 ${song.play_count || 1} play${song.play_count === 1 ? '' : 's'}</div>
          </div>
          <div class="col-album truncate" title="${escapeHtml(song.album || 'Top 100')}">${escapeHtml(song.album || 'Top 100')}</div>
          <div class="col-duration">${song.duration ? formatSeconds(song.duration) : '--:--'}</div>
        `;

        row.addEventListener('click', () => openDrawer(song, idx));
        row.addEventListener('dblclick', () => playTopTrack(song, topTracks, idx));
        const pBtn = row.querySelector('.row-play-btn');
        if (pBtn) {
          pBtn.addEventListener('click', (e) => {
            e.stopPropagation();
            playTopTrack(song, topTracks, idx);
          });
        }
        libraryContainer.appendChild(row);
      });
    }
  }

  function playTopTrack(song, queue, idx) {
    if (song.filename) {
      const matchIdx = librarySongs.findIndex(s => s.filename === song.filename);
      if (matchIdx >= 0) {
        playTrack(matchIdx);
        return;
      }
    }
    playStreamTrack(song, queue, idx);
  }

  // View switchers
  viewGridBtn.addEventListener('click', () => {
    viewGridBtn.classList.add('active');
    viewListBtn.classList.remove('active');
    libraryContainer.className = 'library-container grid-mode';
    renderLibrary();
  });

  viewListBtn.addEventListener('click', () => {
    viewListBtn.classList.add('active');
    viewGridBtn.classList.remove('active');
    libraryContainer.className = 'library-container list-mode';
    renderLibrary();
  });

  // Grouping Pills & Sort Select Listeners
  groupPills.forEach(pill => {
    pill.addEventListener('click', () => {
      groupPills.forEach(p => p.classList.remove('active'));
      pill.classList.add('active');
      currentGroupMode = pill.dataset.group;
      renderLibrary();
    });
  });

  if (librarySortSelect) {
    librarySortSelect.addEventListener('change', (e) => {
      currentSortMode = e.target.value;
      applySortAndFilter();
    });
  }

  // Library Search (Instant in-memory filtering)
  librarySearch.addEventListener('input', (e) => {
    const q = e.target.value.trim();
    btnClearSearch.style.display = q ? 'block' : 'none';
    clearTimeout(searchDebounce);
    searchDebounce = setTimeout(() => {
      applySortAndFilter();
    }, 150);
  });

  btnClearSearch.addEventListener('click', () => {
    librarySearch.value = '';
    btnClearSearch.style.display = 'none';
    applySortAndFilter();
  });

  btnRefreshLibrary.addEventListener('click', () => {
    loadLibrary(librarySearch.value.trim());
    loadUserPlaylists();
    showToast('Library refreshed');
  });

  // ==================== TRACK INSPECTOR DRAWER ====================
  function openDrawer(song, idx) {
    selectedSong = song;
    currentSongIndex = idx;
    const coverUrl = (song.cover_url && song.cover_url !== 'placeholder.svg') ? song.cover_url : (song.filename ? resolveApiUrl(`/api/songs/artwork/${encodeURIComponent(song.filename)}`) : 'placeholder.svg');

    drawerCover.src = coverUrl;
    drawerBitrate.textContent = song.bitrate || '320 kbps';
    drawerTitle.textContent = song.title || 'Unknown Title';
    drawerArtist.textContent = song.artist || 'Unknown Artist';
    drawerGenre.textContent = song.genre || 'Music';
    drawerYear.textContent = song.year || 'Studio Audio';
    drawerSize.textContent = `${song.size_mb || 0} MB`;
    drawerAlbum.textContent = song.album || '—';
    drawerDuration.textContent = formatSeconds(song.duration || 0);
    drawerFilename.textContent = song.filename || '';

    if (song.collaborators && song.collaborators.length > 0) {
      drawerCollabRow.style.display = 'flex';
      drawerCollab.textContent = song.collaborators.join(', ');
    } else {
      drawerCollabRow.style.display = 'none';
    }

    trackDrawer.classList.add('open');
    drawerOverlay.classList.add('open');
  }

  function closeDrawer() {
    if (trackDrawer) trackDrawer.classList.remove('open');
    if (drawerOverlay) drawerOverlay.classList.remove('open');
  }

  // ==================== CONFIRMATION DIALOG ====================
  function showConfirmDialog(opts) {
    var title = opts.title || 'Confirm Deletion';
    var message = opts.message || 'Are you sure you want to proceed?';
    var itemTitle = opts.itemTitle;
    var itemSub = opts.itemSub;
    var confirmText = opts.confirmText || 'Delete';
    var isDanger = opts.isDanger !== false;
    var onConfirm = opts.onConfirm;

    if (!confirmModal) {
      if (window.confirm(title + '\n\n' + message)) {
        if (onConfirm) onConfirm();
      }
      return;
    }

    if (confirmModalTitle) confirmModalTitle.textContent = title;
    if (confirmModalMessage) confirmModalMessage.textContent = message;
    if (confirmModalDetails) {
      if (itemTitle) {
        confirmModalDetails.style.display = 'block';
        if (confirmModalItemTitle) confirmModalItemTitle.textContent = itemTitle;
        if (confirmModalItemSub) confirmModalItemSub.textContent = itemSub || '';
      } else {
        confirmModalDetails.style.display = 'none';
      }
    }
    if (confirmModalActionBtn) {
      confirmModalActionBtn.textContent = confirmText;
      confirmModalActionBtn.className = isDanger ? 'btn-danger-confirm' : 'btn-primary';
    }
    currentConfirmCallback = onConfirm;

    confirmModal.style.display = 'flex';
    document.body.style.overflow = 'hidden';
  }

  function closeConfirmDialog() {
    if (confirmModal) confirmModal.style.display = 'none';
    document.body.style.overflow = '';
    currentConfirmCallback = null;
  }

  if (confirmModalClose) confirmModalClose.addEventListener('click', closeConfirmDialog);
  if (confirmModalBackdrop) confirmModalBackdrop.addEventListener('click', closeConfirmDialog);
  if (confirmModalCancelBtn) confirmModalCancelBtn.addEventListener('click', closeConfirmDialog);
  if (confirmModalActionBtn) {
    confirmModalActionBtn.addEventListener('click', async function() {
      var cb = currentConfirmCallback;
      closeConfirmDialog();
      if (cb) {
        try {
          await cb();
        } catch (err) {
          console.error('Confirm dialog action error:', err);
        }
      }
    });
  }

  function promptDeleteSong(song) {
    if (!song || !song.filename) return;
    showConfirmDialog({
      title: 'Delete Track from Library?',
      message: 'Are you sure you want to delete this track? This action permanently removes the audio file from your library and computer.',
      itemTitle: song.title || 'Untitled Track',
      itemSub: (song.artist || 'Unknown Artist') + ' • ' + (song.album || 'Library'),
      confirmText: 'Delete Track',
      isDanger: true,
      onConfirm: async function() {
        await executeDeleteSong(song);
      }
    });
  }

  async function executeDeleteSong(song) {
    try {
      var songFilename = song.filename;
      // If currently playing track is being deleted, stop audio
      if (currentlyPlayingTrack && (currentlyPlayingTrack.filename === songFilename || currentlyPlayingTrack.title === song.title)) {
        if (audioEngine) {
          audioEngine.pause();
          audioEngine.src = '';
        }
        currentlyPlayingTrack = null;
        if (playerTrackTitle) playerTrackTitle.textContent = 'Select a track';
        if (playerArtist) playerArtist.textContent = 'Music Studio';
        if (playerPlayBtn) {
          var svg = playerPlayBtn.querySelector('svg');
          if (svg) svg.outerHTML = '<svg viewBox="0 0 24 24" width="20" height="20" fill="currentColor"><polygon points="5 3 19 12 5 21 5 3"/></svg>';
        }
      }

      var res = await fetch('/api/songs/' + encodeURIComponent(songFilename), {
        method: 'DELETE'
      });

      if (!res.ok) {
        var err = await res.json().catch(function() { return {}; });
        throw new Error(err.detail || 'Failed to delete track from disk');
      }

      showToast('Deleted "' + (song.title || songFilename) + '" from library', 'success');
      closeDrawer();
      await loadLibrary();
    } catch (err) {
      showToast(err.message || 'Error deleting track', 'error');
    }
  }


  if (drawerCloseBtn) {
    drawerCloseBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      closeDrawer();
    });
  }

  if (drawerOverlay) {
    drawerOverlay.addEventListener('click', (e) => {
      e.stopPropagation();
      closeDrawer();
    });
  }

  if (drawerPlayBtn) {
    drawerPlayBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      if (currentSongIndex >= 0 && currentSongIndex < librarySongs.length) {
        playTrack(currentSongIndex);
      }
    });
  }

  // ==================== DISCOVER & EXPLORE LOGIC ====================
  async function loadExplore() {
    try {
      let data = null;
      try {
        const res = await fetch('/api/explore/featured');
        const contentType = res.headers.get('content-type') || '';
        if (contentType.includes('application/json') && res.ok) {
          data = await res.json();
        }
      } catch (err) {}

      if (!data || (!data.featured && !data.trending)) {
        // Direct public RSS feed fallback for trending and charts (works offline/standalone mobile)
        const rssRes = await fetch('https://itunes.apple.com/us/rss/topsongs/limit=35/json');
        if (rssRes.ok) {
          const rssData = await rssRes.json();
          const entries = (rssData.feed && rssData.feed.entry) || [];
          const trendingTracks = entries.map((entry, idx) => {
            const title = entry['im:name'] ? entry['im:name'].label : (entry.title ? entry.title.label : 'Unknown Track');
            const artist = entry['im:artist'] ? entry['im:artist'].label : 'Unknown Artist';
            const images = entry['im:image'] || [];
            const cover_url = images.length > 0 ? images[images.length - 1].label.replace(/55x55bb|60x60bb|170x170bb/g, '600x600bb') : 'placeholder.svg';
            const linkObj = Array.isArray(entry.link) ? entry.link.find(l => l.attributes && l.attributes.type && l.attributes.type.includes('audio')) : null;
            const preview_url = linkObj && linkObj.attributes ? linkObj.attributes.href : '';
            return {
              id: `top_${idx + 1}`,
              title: title,
              artist: artist,
              album: entry['im:collection'] ? entry['im:collection']['im:name']?.label || 'Top Hits' : 'Top Hits',
              cover_url: cover_url,
              preview_url: preview_url,
              duration: 210,
              query: `${title} ${artist}`
            };
          });

          const featuredPlaylists = [
            {
              id: 'top-hits-2026',
              title: "Today's Top Hits",
              subtitle: 'The hottest tracks right now worldwide',
              cover_url: trendingTracks[0]?.cover_url || 'placeholder.svg',
              badge: 'GLOBAL CHART',
              tracks: trendingTracks.slice(0, 20)
            },
            {
              id: 'trending-pop',
              title: 'Trending Pop & Viral',
              subtitle: 'Pop sensations & chart-toppers',
              cover_url: trendingTracks[1]?.cover_url || 'placeholder.svg',
              badge: 'POP CHART',
              tracks: trendingTracks.slice(5, 25)
            },
            {
              id: 'chill-vibes',
              title: 'Acoustic & Chillout',
              subtitle: 'Smooth melodies and relaxing rhythms',
              cover_url: trendingTracks[2]?.cover_url || 'placeholder.svg',
              badge: 'CHILLOUT',
              tracks: trendingTracks.slice(10, 30)
            }
          ];

          data = {
            featured: featuredPlaylists,
            trending: trendingTracks
          };
        }
      }

      if (data) {
        if (data.featured) renderFeaturedPlaylists(data.featured);
        if (data.trending) renderTrendingTracks(data.trending);
      }
    } catch (e) {
      console.warn('Explore feed notice:', e);
    }
  }

  function renderFeaturedPlaylists(playlists) {
    if (!featuredPlaylistsGrid) return;
    featuredPlaylistsGrid.innerHTML = '';

    playlists.forEach(pl => {
      const card = document.createElement('div');
      card.className = 'playlist-card';
      card.innerHTML = `
        <div class="playlist-card-art-wrap">
          <img class="playlist-card-art" src="${pl.cover_url}" alt="${escapeHtml(pl.title)}" loading="lazy" />
          <span class="playlist-card-badge">${escapeHtml(pl.badge || 'Playlist')}</span>
          <div class="playlist-card-overlay">
            <div class="playlist-card-open-btn">
              <svg viewBox="0 0 24 24" width="16" height="16" fill="currentColor"><polygon points="5 3 19 12 5 21 5 3"/></svg>
              <span>Explore Songs</span>
            </div>
          </div>
        </div>
        <div class="playlist-card-info">
          <div class="playlist-card-title truncate" title="${escapeHtml(pl.title)}">${escapeHtml(pl.title)}</div>
          <div class="playlist-card-subtitle truncate" title="${escapeHtml(pl.subtitle)}">${escapeHtml(pl.subtitle)}</div>
        </div>
      `;

      card.addEventListener('click', () => {
        openPlaylistModal(pl.id);
      });

      featuredPlaylistsGrid.appendChild(card);
    });
  }

  let trendingTracksQueue = [];
  let currentStreamingTrack = null;
  let isOnlineStreaming = false;
  let currentOnlineQueue = [];
  let currentOnlineQueueIndex = -1;
  let hasPrefetchedNextTrack = false;

  function normalizeSongString(str) {
    return (str || '')
      .toLowerCase()
      .replace(/[^\w\s]/g, '')
      .replace(/\s+/g, ' ')
      .trim();
  }

  function findLocalLibraryMatch(track) {
    if (!rawLibrarySongs || !rawLibrarySongs.length || !track) return null;
    const tTitle = normalizeSongString(track.title);
    const tArtist = normalizeSongString(track.artist);
    if (!tTitle) return null;

    // 1. Exact match on title and artist
    for (const song of rawLibrarySongs) {
      const sTitle = normalizeSongString(song.title);
      const sArtist = normalizeSongString(song.artist);
      if (sTitle === tTitle) {
        if (tArtist && sArtist && sArtist !== 'unknown artist' && tArtist !== 'unknown artist') {
          if (sArtist.includes(tArtist) || tArtist.includes(sArtist)) {
            return song;
          }
        } else if (!tArtist || !sArtist || sArtist === 'unknown artist' || tArtist === 'unknown artist') {
          const sFile = normalizeSongString(song.filename);
          if (sFile === tTitle || (tArtist && sFile.includes(tArtist))) {
            return song;
          }
        }
      }
    }

    // 2. Loose match (only if artist definitely matches)
    for (const song of rawLibrarySongs) {
      const sTitle = normalizeSongString(song.title);
      const sArtist = normalizeSongString(song.artist);
      if (!tArtist || !sArtist || sArtist === 'unknown artist' || tArtist === 'unknown artist') continue;
      const artistMatches = sArtist.includes(tArtist) || tArtist.includes(sArtist);
      if (artistMatches && sTitle && tTitle && (sTitle.includes(tTitle) || tTitle.includes(sTitle))) {
        return song;
      }
    }
    return null;
  }

  function updateStreamingDownloadUI(isSaved, isDownloading) {
    const dockQuickDl = document.getElementById('dock-quick-dl-btn');
    const dockDlText = document.querySelector('.dock-dl-label');
    const fsSaveBtn = document.getElementById('fs-save-btn');
    const fsSaveText = document.getElementById('fs-save-text');

    if (isSaved) {
      if (dockQuickDl) {
        dockQuickDl.classList.add('saved');
        dockQuickDl.classList.remove('downloading');
        dockQuickDl.title = 'Saved in Library';
      }
      if (dockDlText) dockDlText.textContent = 'Saved';
      if (fsSaveBtn) {
        fsSaveBtn.classList.add('saved');
        fsSaveBtn.classList.remove('downloading');
        fsSaveBtn.disabled = true;
      }
      if (fsSaveText) fsSaveText.textContent = '✓ Saved in Library';
    } else if (isDownloading) {
      if (dockQuickDl) {
        dockQuickDl.classList.add('downloading');
        dockQuickDl.classList.remove('saved');
        dockQuickDl.title = 'Saving to Library...';
      }
      if (dockDlText) dockDlText.textContent = 'Saving...';
      if (fsSaveBtn) {
        fsSaveBtn.classList.add('downloading');
        fsSaveBtn.classList.remove('saved');
        fsSaveBtn.disabled = true;
      }
      if (fsSaveText) fsSaveText.textContent = 'Saving to Library (320k)...';
    } else {
      if (dockQuickDl) {
        dockQuickDl.classList.remove('saved', 'downloading');
        dockQuickDl.disabled = false;
        dockQuickDl.title = 'Save to Library (320 kbps MP3)';
      }
      if (dockDlText) dockDlText.textContent = 'Save';
      if (fsSaveBtn) {
        fsSaveBtn.classList.remove('saved', 'downloading');
        fsSaveBtn.disabled = false;
        fsSaveBtn.title = 'Save to Library (320 kbps Master)';
      }
      if (fsSaveText) fsSaveText.textContent = 'Save to Library (320 kbps)';
    }
  }

  async function saveCurrentStreamingTrack() {
    if (!currentStreamingTrack) return;
    const track = currentStreamingTrack;
    updateStreamingDownloadUI(false, true);

    try {
      await downloadSingleTrack(track);
      updateStreamingDownloadUI(true, false);
      showToast(`✓ Saved "${track.title}" to library!`, 'success');
    } catch (e) {
      updateStreamingDownloadUI(false, false);
      showToast(e.message || 'Download failed', 'error');
    }
  }

  function renderTrendingTracks(tracks) {
    if (!trendingTracksGrid) return;
    trendingTracksGrid.innerHTML = '';

    // Filter out songs already in user's library
    const filteredTracks = (tracks || []).filter(t => !findLocalLibraryMatch(t));
    trendingTracksQueue = filteredTracks;

    if (filteredTracks.length === 0) {
      trendingTracksGrid.innerHTML = `
        <div class="empty-state glass" style="grid-column: 1 / -1; width: 100%; padding: 24px; text-align: center;">
          <p style="color: var(--text-secondary);">All trending songs are already in your library! 🎉</p>
        </div>
      `;
      return;
    }

    filteredTracks.forEach((track, idx) => {
      const card = createExploreTrackCard(track, trendingTracksQueue, idx);
      trendingTracksGrid.appendChild(card);
    });
  }

  function createExploreTrackCard(track, queue = [], idx = -1) {
    const card = document.createElement('div');
    card.className = 'explore-song-card';

    const durationText = (track.duration && track.duration > 0) ? formatSeconds(track.duration) : '3:30';
    const coverUrl = track.cover_url || 'placeholder.svg';
    const isSaved = !!findLocalLibraryMatch(track);

    card.innerHTML = `
      <div class="explore-song-thumb-wrap">
        <img class="explore-song-thumb" src="${coverUrl}" onerror="this.src='placeholder.svg'" alt="Cover" />
        <div class="explore-song-preview-overlay" title="Play Full Track Online (Stream)">
          <svg viewBox="0 0 24 24" width="16" height="16" fill="currentColor"><polygon points="5 3 19 12 5 21 5 3"/></svg>
        </div>
      </div>
      <div class="explore-song-info">
        <div class="explore-song-title truncate" title="${escapeHtml(track.title)}">${escapeHtml(track.title)}</div>
        <div class="explore-song-artist truncate" title="${escapeHtml(track.artist)}">${escapeHtml(track.artist)}</div>
        <div class="explore-song-meta">${durationText} • Studio Master</div>
      </div>
      <div class="explore-song-actions">
        <button class="btn-quick-queue icon-btn" title="Add to Queue" style="padding: 6px 8px; border-radius: 8px; background: rgba(255,255,255,0.06); color: var(--text-secondary); border: 1px solid rgba(255,255,255,0.1); margin-right: 4px; display: inline-flex; align-items: center;">
          <svg viewBox="0 0 24 24" width="13" height="13" fill="none" stroke="currentColor" stroke-width="2.2">
            <line x1="8" y1="6" x2="21" y2="6"/>
            <line x1="8" y1="12" x2="21" y2="12"/>
            <line x1="8" y1="18" x2="21" y2="18"/>
            <polyline points="3 6 4 7 6 5"/>
            <polyline points="3 12 4 13 6 11"/>
            <polyline points="3 18 4 19 6 17"/>
          </svg>
        </button>
        <button class="btn-quick-download ${isSaved ? 'downloaded' : ''}" title="${isSaved ? 'In Library' : 'Save to Library (320 kbps)'}">
          ${isSaved ? `
            <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2.5"><polyline points="20 6 9 17 4 12"/></svg>
            <span>Added</span>
          ` : `
            <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2.5">
              <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/>
              <polyline points="7 10 12 15 17 10"/>
              <line x1="12" y1="15" x2="12" y2="3"/>
            </svg>
            <span>Get</span>
          `}
        </button>
      </div>
    `;

    // Clicking play overlay or song info plays full track online without downloading!
    const playHandler = (e) => {
      e.stopPropagation();
      playOnlineTrack(track, queue, idx);
    };

    const previewBtn = card.querySelector('.explore-song-preview-overlay');
    if (previewBtn) previewBtn.addEventListener('click', playHandler);
    const infoSection = card.querySelector('.explore-song-info');
    if (infoSection) infoSection.addEventListener('click', playHandler);

    const queueBtn = card.querySelector('.btn-quick-queue');
    if (queueBtn) {
      queueBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        addToQueue(track);
      });
    }

    // 1-click Download / Save
    const downloadBtn = card.querySelector('.btn-quick-download');
    downloadBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      downloadSingleTrack(track, downloadBtn);
    });

    return card;
  }

  function playOnlineTrack(track, queue = [], index = -1) {
    if (!track) return;

    // Check if song already exists locally in user's library
    const localMatch = findLocalLibraryMatch(track);
    if (localMatch) {
      const localIdx = librarySongs.findIndex(s => s.filename === localMatch.filename);
      if (localIdx >= 0) {
        showToast(`Playing local library file: ${localMatch.title}`, 'info');
        playTrack(localIdx);
        return;
      }
    }

    isOnlineStreaming = true;
    currentSongIndex = -1;
    currentStreamingTrack = track;
    hasRecordedPlayForCurrentTrack = false;
    hasPrefetchedNextTrack = false;
    hasTriggeredAutoCrossfade = false;

    if (queue && queue.length) {
      currentOnlineQueue = queue;
      currentOnlineQueueIndex = index >= 0 ? index : queue.findIndex(t => t.title === track.title && t.artist === track.artist);
    } else {
      currentOnlineQueue = [track];
      currentOnlineQueueIndex = 0;
    }

    const query = track.query || `${track.title} ${track.artist}`;
    const streamEndpoint = resolveApiUrl(`/api/stream?q=${encodeURIComponent(query)}`);
    const coverUrl = track.cover_url || 'placeholder.svg';
    const totalSec = (track.duration && track.duration > 0) ? track.duration : 0;

    // Instant-Play Streaming Engine: If a high-bitrate preview stream is available, start playback immediately (<150ms)!
    let streamMode = 'full';
    let finalAudioUrl = streamEndpoint;
    let streamFullEndpoint = null;
    let streamQuery = null;

    if (track.preview_url && track.preview_url.startsWith('http')) {
      streamMode = 'preview';
      finalAudioUrl = track.preview_url;
      streamFullEndpoint = streamEndpoint;
      streamQuery = query;
      // Concurrently prefetch and cache the full studio master stream in background
      fetch(resolveApiUrl(`/api/stream/prefetch?q=${encodeURIComponent(query)}`)).catch(() => {});
    }

    transitionToAudio(finalAudioUrl, track, {
      streamMode,
      streamFullEndpoint,
      streamQuery
    });

    // Update Dock
    playerCover.src = coverUrl;
    playerTitle.textContent = track.title || 'Unknown Track';
    playerArtist.textContent = track.artist || 'Online Stream';
    playerScrubber.value = 0;
    updateScrubberFill(0);
    playerCurrentTime.textContent = '0:00';
    playerTotalTime.textContent = totalSec ? formatSeconds(totalSec) : '--:--';

    const dockStreamBadge = document.getElementById('dock-stream-badge');
    if (dockStreamBadge) dockStreamBadge.style.display = 'inline-block';
    const dockQuickDl = document.getElementById('dock-quick-dl-btn');
    if (dockQuickDl) {
      dockQuickDl.style.display = 'inline-flex';
      updateStreamingDownloadUI(false, false);
    }

    // Synchronize to Fullscreen "Now Playing" Overlay
    if (fsCover) fsCover.src = coverUrl;
    if (fsTitle) fsTitle.textContent = track.title || 'Unknown Track';
    if (fsArtist) fsArtist.textContent = track.artist || 'Online Stream';
    if (fsAlbum) fsAlbum.textContent = track.album || 'Online Stream Master';
    if (fsScrubber) {
      fsScrubber.value = 0;
      updateFsScrubberFill(0);
    }
    if (fsCurrentTime) fsCurrentTime.textContent = '0:00';
    if (fsTotalTime) fsTotalTime.textContent = totalSec ? formatSeconds(totalSec) : '--:--';

    const fsStreamActions = document.getElementById('fs-stream-actions');
    if (fsStreamActions) fsStreamActions.style.display = 'flex';
    const fsStreamBadge = document.getElementById('fs-stream-badge-floating');
    if (fsStreamBadge) fsStreamBadge.style.display = 'inline-flex';

    // Synchronize to Mac Notch HUD & HTML5 MediaSession
    setupMediaSession({
      title: track.title || 'Unknown Track',
      artist: track.artist || 'Online Stream',
      album: track.album || 'Online Stream Master',
      artwork_url: coverUrl,
      duration: totalSec
    });
    updateNotchHUD({
      title: track.title || 'Unknown Track',
      artist: track.artist || 'Online Stream',
      artwork_url: coverUrl,
      duration: totalSec
    });

    isPlaying = true;
    applySmartTransition(track);
    updatePlayIcon(true);
    highlightPlayingRow();
    broadcastPlaybackState();
    showToast(`Streaming live: ${track.title} - ${track.artist}`, 'info');
  }

  function previewTrackAudio(track) {
    playOnlineTrack(track);
  }

  async function downloadSingleTrack(track, btnEl) {
    if (!track) return;

    const query = track.query || `${track.title} ${track.artist}`;
    const serverBase = getServerBaseUrl();

    // 1. On Android native app: download full audio directly to phone storage (NEVER 30-sec preview!)
    if (window.AndroidMusicScanner && typeof window.AndroidMusicScanner.downloadTrackToDevice === 'function') {
      let fullAudioUrl = '';

      if (serverBase) {
        fullAudioUrl = `${serverBase}/api/stream?q=${encodeURIComponent(query)}`;
      } else {
        const resolved = resolveApiUrl(`/api/stream?q=${encodeURIComponent(query)}`);
        if (resolved && (resolved.startsWith('http://') || resolved.startsWith('https://'))) {
          fullAudioUrl = resolved;
        }
      }

      if (fullAudioUrl) {
        if (btnEl) {
          btnEl.classList.add('downloading');
          btnEl.innerHTML = `<span class="pulse-dot"></span> <span>Saving...</span>`;
        }
        try {
          const ok = window.AndroidMusicScanner.downloadTrackToDevice(
            fullAudioUrl,
            track.title || 'Track',
            track.artist || 'Artist',
            track.album || 'Music Studio',
            track.cover_url || ''
          );
          if (ok) {
            showToast(`Saving full track "${track.title}" to phone storage`, 'success');
            if (btnEl) {
              btnEl.classList.remove('downloading');
              btnEl.classList.add('downloaded');
              btnEl.innerHTML = `<svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2.5"><polyline points="20 6 9 17 4 12"/></svg> <span>Saved</span>`;
            }
            if (serverBase) {
              fetch(`${serverBase}/api/download/track`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                  title: track.title,
                  artist: track.artist,
                  album: track.album || 'Single',
                  cover_url: track.cover_url,
                  query: query,
                  quality: settingQuality ? settingQuality.value : '320k',
                  naming: settingNaming ? settingNaming.value : 'title'
                })
              }).catch(() => {});
            }
            return;
          }
        } catch (err) {
          console.warn('[AndroidBridge] downloadTrackToDevice error:', err);
        }
      } else {
        showToast('To download full 320kbps tracks to your phone, set your PC Server IP in Settings (e.g. http://192.168.1.xxx:5050)', 'warning');
        if (btnEl) {
          btnEl.classList.remove('downloading');
          btnEl.innerHTML = `<span>Get</span>`;
        }
        return;
      }
    }

    // 2. Server-side download (via yt-dlp 320kbps MP3 encoder)
    if (btnEl) {
      btnEl.classList.add('downloading');
      btnEl.innerHTML = `<span class="pulse-dot"></span> <span>Saving...</span>`;
    }

    try {
      const res = await fetch(resolveApiUrl('/api/download/track'), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          title: track.title,
          artist: track.artist,
          album: track.album || 'Single',
          cover_url: track.cover_url,
          query: query,
          quality: settingQuality ? settingQuality.value : '320k',
          naming: settingNaming ? settingNaming.value : 'title'
        })
      });

      if (!res.ok) {
        const err = await res.json();
        throw new Error(err.detail || 'Download request failed');
      }

      showToast(`Downloading: ${track.title}`, 'success');
      if (statusBadge) {
        statusBadge.className = 'hud-status-badge active-download';
        statusBadge.textContent = 'Downloading';
      }

      if (btnEl) {
        btnEl.classList.remove('downloading');
        btnEl.classList.add('downloaded');
        btnEl.innerHTML = `<svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2.5"><polyline points="20 6 9 17 4 12"/></svg> <span>Added</span>`;
      }
    } catch (e) {
      showToast(e.message || 'Could not connect to download server', 'error');
      if (btnEl) {
        btnEl.classList.remove('downloading');
        btnEl.innerHTML = `<span>Retry</span>`;
      }
    }
  }

  // ==================== LIVE SEARCH ====================
  if (exploreSearchInput) {
    exploreSearchInput.addEventListener('input', (e) => {
      const q = e.target.value.trim();
      if (btnClearExploreSearch) {
        btnClearExploreSearch.style.display = q ? 'block' : 'none';
      }
      clearTimeout(exploreSearchDebounce);
      if (!q) {
        exploreSearchSection.style.display = 'none';
        return;
      }
      exploreSearchDebounce = setTimeout(() => {
        performExploreSearch(q);
      }, 250);
    });
  }

  if (btnClearExploreSearch) {
    btnClearExploreSearch.addEventListener('click', () => {
      exploreSearchInput.value = '';
      btnClearExploreSearch.style.display = 'none';
      exploreSearchSection.style.display = 'none';
    });
  }

  // Search Hint Pills
  document.querySelectorAll('.hint-pill').forEach(pill => {
    pill.addEventListener('click', () => {
      const q = pill.getAttribute('data-query');
      if (exploreSearchInput && q) {
        exploreSearchInput.value = q;
        if (btnClearExploreSearch) btnClearExploreSearch.style.display = 'block';
        performExploreSearch(q);
      }
    });
  });

  // Search Filter Pills Listener
  document.querySelectorAll('.search-filter-pill').forEach(pill => {
    pill.addEventListener('click', () => {
      document.querySelectorAll('.search-filter-pill').forEach(p => p.classList.remove('active'));
      pill.classList.add('active');
      currentSearchFilter = pill.getAttribute('data-filter') || 'all';
      renderSearchResults(exploreSearchInput ? exploreSearchInput.value.trim() : '');
    });
  });

  async function performExploreSearch(q) {
    if (!q) return;
    try {
      exploreSearchSection.style.display = 'block';
      exploreSearchTitle.textContent = `Searching for "${q}"...`;
      exploreSearchCount.textContent = 'Fetching songs & albums...';

      let data = null;
      try {
        const res = await fetch(`/api/explore/search?q=${encodeURIComponent(q)}&type=all`);
        const contentType = res.headers.get('content-type') || '';
        if (contentType.includes('application/json') && res.ok) {
          data = await res.json();
        }
      } catch (err) {}

      if (!data || (!data.tracks && !data.results && !data.albums)) {
        // Direct public client-side search fallback (works standalone on mobile / without PC server)
        const itunesRes = await fetch(`https://itunes.apple.com/search?term=${encodeURIComponent(q)}&entity=song&limit=40`);
        if (!itunesRes.ok) throw new Error('Search failed to connect to online music database.');
        const itunesData = await itunesRes.json();

        let albumResults = [];
        try {
          const itunesAlbumsRes = await fetch(`https://itunes.apple.com/search?term=${encodeURIComponent(q)}&entity=album&limit=12`);
          if (itunesAlbumsRes.ok) {
            const albData = await itunesAlbumsRes.json();
            albumResults = albData.results || [];
          }
        } catch (err) {}

        const mappedTracks = (itunesData.results || []).map((item, index) => ({
          id: `itunes_${item.trackId || index}`,
          title: item.trackName || 'Unknown Title',
          artist: item.artistName || 'Unknown Artist',
          album: item.collectionName || 'Single',
          duration: item.trackTimeMillis ? Math.round(item.trackTimeMillis / 1000) : 180,
          cover_url: item.artworkUrl100 ? item.artworkUrl100.replace('100x100bb', '600x600bb') : 'placeholder.svg',
          preview_url: item.previewUrl || '',
          query: `${item.trackName} ${item.artistName}`,
          source: 'itunes',
          can_stream: true
        }));

        const mappedAlbums = albumResults.map((alb, index) => ({
          id: alb.collectionId || index,
          title: alb.collectionName || 'Unknown Album',
          artist: alb.artistName || 'Unknown Artist',
          cover_url: alb.artworkUrl100 ? alb.artworkUrl100.replace('100x100bb', '600x600bb') : 'placeholder.svg',
          year: alb.releaseDate ? alb.releaseDate.substring(0, 4) : '',
          track_count: alb.trackCount || 0
        }));

        data = {
          tracks: mappedTracks,
          albums: mappedAlbums
        };
      }

      currentSearchResults = {
        tracks: data.tracks || data.results || [],
        albums: data.albums || []
      };

      renderSearchResults(q);
    } catch (e) {
      exploreSearchTitle.textContent = 'Search Notice';
      exploreSearchCount.textContent = e.message;
      showToast(e.message, 'warning');
    }
  }

  function renderSearchResults(q = '') {
    const { tracks, albums } = currentSearchResults;
    const searchFilter = currentSearchFilter;
    const queryStr = q || (exploreSearchInput ? exploreSearchInput.value.trim() : '');

    const hasAlbums = albums && albums.length > 0;
    const hasTracks = tracks && tracks.length > 0;

    const showAlbums = (searchFilter === 'all' || searchFilter === 'albums') && hasAlbums;
    const showTracks = (searchFilter === 'all' || searchFilter === 'tracks') && hasTracks;

    exploreSearchTitle.textContent = `Results for "${queryStr}"`;

    if (searchFilter === 'all') {
      exploreSearchCount.textContent = `${albums.length} albums • ${tracks.length} songs found`;
    } else if (searchFilter === 'albums') {
      exploreSearchCount.textContent = `${albums.length} albums found`;
    } else {
      exploreSearchCount.textContent = `${tracks.length} songs found`;
    }

    // Render Albums Section
    if (showAlbums && searchAlbumsContainer && searchAlbumsGrid) {
      searchAlbumsContainer.style.display = 'block';
      if (searchAlbumsBadge) searchAlbumsBadge.textContent = `${albums.length} albums`;
      searchAlbumsGrid.innerHTML = '';
      albums.forEach(album => {
        const card = createSearchAlbumCard(album);
        searchAlbumsGrid.appendChild(card);
      });
    } else if (searchAlbumsContainer) {
      searchAlbumsContainer.style.display = 'none';
    }

    // Render Tracks Section
    if (showTracks && searchTracksContainer && exploreSearchGrid) {
      searchTracksContainer.style.display = 'block';
      if (searchTracksSubTitle) {
        searchTracksSubTitle.style.display = (searchFilter === 'all' && hasAlbums) ? 'block' : 'none';
      }
      exploreSearchGrid.innerHTML = '';
      tracks.forEach(track => {
        const card = createExploreTrackCard(track);
        exploreSearchGrid.appendChild(card);
      });
    } else if (searchTracksContainer) {
      searchTracksContainer.style.display = 'none';
    }

    // Empty state
    if (!hasAlbums && !hasTracks) {
      if (searchAlbumsContainer) searchAlbumsContainer.style.display = 'none';
      if (searchTracksContainer) searchTracksContainer.style.display = 'block';
      exploreSearchGrid.innerHTML = `<div class="empty-state" style="grid-column: 1/-1;"><p>No results found for "${escapeHtml(queryStr)}". Try searching another artist, band, or song title.</p></div>`;
    }
  }

  function createSearchAlbumCard(album) {
    const card = document.createElement('div');
    card.className = 'search-album-card';
    const coverUrl = album.cover_url || 'placeholder.svg';
    const trackCountText = album.track_count ? `${album.track_count} Tracks` : 'Album';
    const metaText = album.year ? `${album.year} • ${trackCountText}` : trackCountText;

    card.innerHTML = `
      <div class="album-card-art-wrap">
        <img class="album-card-art" src="${coverUrl}" onerror="this.src='placeholder.svg'" alt="Cover" />
        <span class="album-card-badge">Album</span>
      </div>
      <div class="album-card-info">
        <div class="album-card-title truncate" title="${escapeHtml(album.title)}">${escapeHtml(album.title)}</div>
        <div class="album-card-artist truncate" title="${escapeHtml(album.artist)}">${escapeHtml(album.artist)}</div>
        <div class="album-card-meta">${escapeHtml(metaText)}</div>
      </div>
      <div class="album-card-actions">
        <button class="btn-album-download" title="Download Entire Album (${trackCountText})">
          <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2.5">
            <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/>
            <polyline points="7 10 12 15 17 10"/>
            <line x1="12" y1="15" x2="12" y2="3"/>
          </svg>
          <span>Download Album</span>
        </button>
      </div>
    `;

    card.addEventListener('click', (e) => {
      if (e.target.closest('.btn-album-download')) return;
      openPlaylistModal(`album_${album.id}`);
    });

    const btnDownload = card.querySelector('.btn-album-download');
    btnDownload.addEventListener('click', async (e) => {
      e.stopPropagation();
      downloadEntireAlbum(album, btnDownload);
    });

    return card;
  }

  async function downloadEntireAlbum(album, btnEl) {
    if (btnEl) {
      btnEl.classList.add('downloading');
      btnEl.innerHTML = `<span class="pulse-dot"></span> <span>Fetching...</span>`;
    }
    try {
      const res = await fetch(`/api/explore/album/${album.id}`);
      if (!res.ok) throw new Error('Failed to fetch album tracks');
      const data = await res.json();
      await downloadEntirePlaylist(data);
      if (btnEl) {
        btnEl.classList.remove('downloading');
        btnEl.classList.add('downloaded');
        btnEl.innerHTML = `<svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2.5"><polyline points="20 6 9 17 4 12"/></svg> <span>Queued (${data.tracks ? data.tracks.length : 0})</span>`;
      }
    } catch (err) {
      showToast(err.message, 'error');
      if (btnEl) {
        btnEl.classList.remove('downloading');
        btnEl.innerHTML = `<span>Error</span>`;
      }
    }
  }

  // ==================== PLAYLIST & ALBUM PREVIEW MODAL ====================
  async function openPlaylistModal(playlistId, isAlbumParam = false, existingData = null) {
    if (!playlistModal) return;
    playlistModal.style.display = 'flex';
    document.body.style.overflow = 'hidden';

    let data = existingData || null;

    if (!data) {
      const isAlbum = isAlbumParam || String(playlistId).startsWith('album_') || String(playlistId).startsWith('album-');
      if (modalBadge) modalBadge.textContent = isAlbum ? 'OFFICIAL ALBUM' : 'CURATED COLLECTION';
      modalTitle.textContent = isAlbum ? 'Loading album...' : 'Loading playlist...';
      modalSubtitle.textContent = 'Fetching tracklist and studio metadata...';
      modalTrackCount.textContent = '...';
      modalTracklist.innerHTML = `<div style="padding: 40px; text-align: center; color: var(--text-tertiary);"><span class="pulse-dot"></span> Loading tracks...</div>`;

      try {
        let res = await fetch(`/api/explore/playlist/${encodeURIComponent(playlistId)}`);
        if (!res.ok) {
          res = await fetch(`/api/playlists/${encodeURIComponent(playlistId)}`);
        }
        if (res.ok) {
          data = await res.json();
        }
      } catch (e) {}

      if (!data && String(playlistId).startsWith('album_')) {
        const rawId = String(playlistId).replace('album_', '');
        try {
          const lookupRes = await fetch(`https://itunes.apple.com/lookup?id=${encodeURIComponent(rawId)}&entity=song&limit=50`);
          if (lookupRes.ok) {
            const lookupData = await lookupRes.json();
            const results = lookupData.results || [];
            if (results.length > 0) {
              const albumMeta = results[0];
              const songs = results.slice(1).map((s, idx) => ({
                id: `song_${s.trackId || idx}`,
                title: s.trackName || 'Unknown Title',
                artist: s.artistName || albumMeta.artistName || 'Unknown Artist',
                album: s.collectionName || albumMeta.collectionName || 'Album',
                duration: s.trackTimeMillis ? Math.round(s.trackTimeMillis / 1000) : 210,
                cover_url: s.artworkUrl100 ? s.artworkUrl100.replace('100x100bb', '600x600bb') : 'placeholder.svg',
                preview_url: s.previewUrl || '',
                query: `${s.trackName} ${s.artistName}`
              }));
              data = {
                id: playlistId,
                type: 'album',
                title: albumMeta.collectionName || 'Album',
                artist: albumMeta.artistName || 'Artist',
                subtitle: `${albumMeta.artistName || 'Artist'} • ${albumMeta.releaseDate ? albumMeta.releaseDate.substring(0, 4) : ''}`,
                cover_url: albumMeta.artworkUrl100 ? albumMeta.artworkUrl100.replace('100x100bb', '600x600bb') : 'placeholder.svg',
                tracks: songs,
                track_count: songs.length
              };
            }
          }
        } catch (err) {}
      }

      if (!data) {
        modalTitle.textContent = 'Error Loading Collection';
        modalSubtitle.textContent = 'Unable to fetch collection metadata';
        modalTracklist.innerHTML = `<div style="padding: 40px; text-align: center; color: var(--text-tertiary);">Unable to load tracks. Check connection.</div>`;
        return;
      }
    }

    currentModalPlaylist = data;
    const isCustom = Boolean(data.is_custom) || data.type === 'custom';
    const isAlbType = (data.type === 'album' || isAlbumParam || String(data.id || '').startsWith('album_'));

    modalTitle.textContent = data.title;
    modalSubtitle.textContent = data.subtitle || data.description || (isCustom ? 'Personal Custom Playlist' : (isAlbType ? `${data.artist || 'Artist'} • Album Master` : 'Curated Studio Collection'));
    modalCover.src = data.cover_url || 'placeholder.svg';
    const count = (data.tracks ? data.tracks.length : (data.track_count || 0));
    modalTrackCount.textContent = `${count} track${count === 1 ? '' : 's'}`;

    if (modalBadge) {
      modalBadge.textContent = isCustom ? 'CUSTOM PLAYLIST' : (isAlbType ? 'OFFICIAL ALBUM' : 'CURATED COLLECTION');
    }

    // Check favorite state
    updateModalFavoriteBtnState();

    if (btnModalPlayAll) {
      btnModalPlayAll.innerHTML = `
        <svg viewBox="0 0 24 24" width="16" height="16" fill="currentColor"><polygon points="5 3 19 12 5 21 5 3"/></svg>
        <span>${isAlbType ? `Play Album (${count} Songs)` : 'Play / Stream All'}</span>
      `;
      btnModalPlayAll.onclick = () => {
        const tracks = data.tracks || [];
        if (!tracks.length) {
          showToast('No tracks available to stream in this collection.', 'warning');
          return;
        }
        playOnlineTrack(tracks[0], tracks, 0);
        showToast(`Streaming "${data.title}"`, 'info');
      };
    }

    if (btnModalShuffle) {
      btnModalShuffle.onclick = () => {
        const tracks = data.tracks || [];
        if (!tracks.length) {
          showToast('No tracks available to stream in this collection.', 'warning');
          return;
        }
        const shuffled = [...tracks].sort(() => Math.random() - 0.5);
        playOnlineTrack(shuffled[0], shuffled, 0);
        showToast(`Shuffling "${data.title}"`, 'info');
      };
    }

    if (btnModalDownloadAll) {
      btnModalDownloadAll.innerHTML = `
        <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2.5">
          <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/>
          <polyline points="7 10 12 15 17 10"/>
          <line x1="12" y1="15" x2="12" y2="3"/>
        </svg>
        <span>${isAlbType ? `Download Entire Album (${count} Songs)` : 'Download Entire Playlist'}</span>
      `;

      btnModalDownloadAll.onclick = () => {
        downloadEntirePlaylist(data);
      };
    }

    renderModalTracklist(data.tracks || []);
  }

  function updateModalFavoriteBtnState() {
    if (!btnModalFavorite) return;
    if (!currentModalPlaylist) {
      btnModalFavorite.style.display = 'none';
      return;
    }
    if (Boolean(currentModalPlaylist.is_custom) || currentModalPlaylist.type === 'custom') {
      btnModalFavorite.style.display = 'none';
      return;
    }
    btnModalFavorite.style.display = 'inline-flex';
    const isFav = userPlaylists.some(p => p.id === currentModalPlaylist.id || (!p.is_custom && p.title === currentModalPlaylist.title));
    if (isFav) {
      btnModalFavorite.classList.add('favorited');
      if (modalFavText) modalFavText.textContent = 'Favorited ♥';
    } else {
      btnModalFavorite.classList.remove('favorited');
      if (modalFavText) modalFavText.textContent = 'Save Playlist';
    }
  }

  if (btnModalFavorite) {
    btnModalFavorite.addEventListener('click', async () => {
      if (!currentModalPlaylist) return;
      const alreadyFav = userPlaylists.some(p => p.id === currentModalPlaylist.id || (!p.is_custom && p.title === currentModalPlaylist.title));
      if (alreadyFav) {
        showToast(`"${currentModalPlaylist.title}" is already saved in your Library!`, 'info');
        return;
      }

      try {
        btnModalFavorite.disabled = true;
        const res = await fetch('/api/playlists/favorite', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            id: currentModalPlaylist.id,
            title: currentModalPlaylist.title,
            description: currentModalPlaylist.subtitle || currentModalPlaylist.description || '',
            cover_url: currentModalPlaylist.cover_url || '',
            tracks: currentModalPlaylist.tracks || []
          })
        });

        if (!res.ok) {
          const err = await res.json();
          throw new Error(err.detail || 'Failed to save playlist');
        }

        showToast(`Saved "${currentModalPlaylist.title}" to your Playlists!`, 'success');
        btnModalFavorite.classList.add('favorited');
        if (modalFavText) modalFavText.textContent = 'Favorited ♥';
        await loadUserPlaylists();
      } catch (e) {
        showToast(e.message, 'error');
      } finally {
        btnModalFavorite.disabled = false;
      }
    });
  }

  function closePlaylistModal() {
    if (!playlistModal) return;
    playlistModal.style.display = 'none';
    document.body.style.overflow = '';
  }

  if (modalCloseBtn) modalCloseBtn.addEventListener('click', closePlaylistModal);
  if (playlistModalBackdrop) playlistModalBackdrop.addEventListener('click', closePlaylistModal);

  function renderModalTracklist(tracks) {
    modalTracklist.innerHTML = '';
    if (!tracks.length) {
      modalTracklist.innerHTML = `<div style="padding: 30px; text-align: center; color: var(--text-tertiary);">No tracks found in this collection.</div>`;
      return;
    }

    const isCustom = currentModalPlaylist && (Boolean(currentModalPlaylist.is_custom) || currentModalPlaylist.type === 'custom');

    tracks.forEach((track, idx) => {
      const row = document.createElement('div');
      row.className = 'modal-track-row';
      const durationText = (track.duration && track.duration > 0) ? formatSeconds(track.duration) : '3:30';
      const coverUrl = track.cover_url || 'placeholder.svg';

      row.innerHTML = `
        <span class="row-num">${idx + 1}</span>
        <div class="row-meta">
          <img class="row-thumb" src="${coverUrl}" onerror="this.src='placeholder.svg'" alt="Cover" />
          <div class="row-text">
            <div class="row-title truncate" title="${escapeHtml(track.title)}">${escapeHtml(track.title)}</div>
            <div class="row-artist truncate" title="${escapeHtml(track.artist)}">${escapeHtml(track.artist)}</div>
          </div>
        </div>
        <div class="row-album truncate" title="${escapeHtml(track.album || '')}">${escapeHtml(track.album || '—')}</div>
        <div class="row-time">${durationText}</div>
        <div class="row-actions">
          <button class="btn-row-preview" title="Play Track">
            <svg viewBox="0 0 24 24" width="16" height="16" fill="currentColor"><polygon points="5 3 19 12 5 21 5 3"/></svg>
          </button>
          <button class="btn-row-add-pl" title="Add to Playlist">
            <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2.2">
              <line x1="12" y1="5" x2="12" y2="19"/>
              <line x1="5" y1="12" x2="19" y2="12"/>
            </svg>
          </button>
          ${isCustom ? `
          <button class="btn-row-remove-pl" title="Remove from Playlist">
            <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2.2">
              <line x1="18" y1="6" x2="6" y2="18"/>
              <line x1="6" y1="6" x2="18" y2="18"/>
            </svg>
          </button>
          ` : `
          <button class="btn-row-download" title="Download This Track">
            <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2.5">
              <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/>
              <polyline points="7 10 12 15 17 10"/>
              <line x1="12" y1="15" x2="12" y2="3"/>
            </svg>
          </button>
          `}
        </div>
      `;

      // Preview audio listener
      const prevBtn = row.querySelector('.btn-row-preview');
      if (prevBtn) {
        prevBtn.addEventListener('click', () => {
          playOnlineTrack(track, tracks, idx);
        });
      }

      // Add to playlist listener
      const addPlBtn = row.querySelector('.btn-row-add-pl');
      if (addPlBtn) {
        addPlBtn.addEventListener('click', (e) => {
          e.stopPropagation();
          openAddToPlaylistModal(track);
        });
      }

      // If custom playlist, remove track listener
      const removeBtn = row.querySelector('.btn-row-remove-pl');
      if (removeBtn) {
        removeBtn.addEventListener('click', (e) => {
          e.stopPropagation();
          var trkTitle = track.title || 'this track';
          var plTitle = currentModalPlaylist.title || 'Playlist';
          showConfirmDialog({
            title: 'Remove Track from Playlist?',
            message: 'Are you sure you want to remove "' + trkTitle + '" from "' + plTitle + '"?',
            itemTitle: track.title || 'Track',
            itemSub: track.artist || '',
            confirmText: 'Remove',
            isDanger: true,
            onConfirm: async () => {
              try {
                var url = '/api/playlists/' + encodeURIComponent(currentModalPlaylist.id) + '/tracks/' + idx;
                var res = await fetch(url, {
                  method: 'DELETE'
                });
                if (res.ok) {
                  var updated = await res.json();
                  currentModalPlaylist.tracks = updated.tracks;
                  renderModalTracklist(currentModalPlaylist.tracks);
                  var count = currentModalPlaylist.tracks.length;
                  modalTrackCount.textContent = count + (count === 1 ? ' track' : ' tracks');
                  showToast('Removed from playlist', 'info');
                  loadUserPlaylists();
                }
              } catch (err) {
                showToast('Failed to remove track', 'error');
              }
            }
          });
        });
      }

      // Check if this track is currently streaming/playing
      const isCurrentlyPlaying = isOnlineStreaming && currentStreamingTrack &&
        (currentStreamingTrack.title === track.title && (currentStreamingTrack.artist === track.artist || !track.artist));
      if (isCurrentlyPlaying) {
        row.classList.add('is-playing');
      }

      // Clicking row streams track live immediately
      row.title = `Click to stream "${track.title}" live`;
      row.addEventListener('click', (e) => {
        if (e.target.closest('button')) return;
        playOnlineTrack(track, tracks, idx);
      });

      // Download single track listener
      const dlBtn = row.querySelector('.btn-row-download');
      if (dlBtn) {
        dlBtn.addEventListener('click', (e) => {
          e.stopPropagation();
          downloadSingleTrack(track, dlBtn);
        });
      }

      modalTracklist.appendChild(row);
    });
  }

  // ==================== CREATE PLAYLIST MODAL HANDLERS ====================
  function openCreatePlaylistModal() {
    if (!createPlaylistModal) return;
    createPlaylistModal.style.display = 'flex';
    document.body.style.overflow = 'hidden';
    pendingCoverBase64 = null;
    if (coverPreviewImg) coverPreviewImg.src = 'placeholder.svg';
    if (playlistNameInput) {
      playlistNameInput.value = '';
      setTimeout(() => playlistNameInput.focus(), 100);
    }
    if (playlistDescInput) playlistDescInput.value = '';
    if (playlistUrlInput) playlistUrlInput.value = '';
    if (playlistFileInput) playlistFileInput.value = '';
  }

  function closeCreatePlaylistModal() {
    if (!createPlaylistModal) return;
    createPlaylistModal.style.display = 'none';
    document.body.style.overflow = '';
    pendingCoverBase64 = null;
  }

  if (btnCreatePlaylist) btnCreatePlaylist.addEventListener('click', openCreatePlaylistModal);
  if (createPlaylistClose) createPlaylistClose.addEventListener('click', closeCreatePlaylistModal);
  if (createPlaylistBackdrop) createPlaylistBackdrop.addEventListener('click', closeCreatePlaylistModal);
  if (btnCancelPlaylist) btnCancelPlaylist.addEventListener('click', closeCreatePlaylistModal);

  if (coverPreviewBox && playlistFileInput) {
    coverPreviewBox.addEventListener('click', () => {
      playlistFileInput.click();
    });

    playlistFileInput.addEventListener('change', (e) => {
      const file = e.target.files[0];
      if (!file) return;
      const reader = new FileReader();
      reader.onload = (evt) => {
        pendingCoverBase64 = evt.target.result;
        coverPreviewImg.src = pendingCoverBase64;
      };
      reader.readAsDataURL(file);
    });

    coverPreviewBox.addEventListener('dragover', (e) => {
      e.preventDefault();
      coverPreviewBox.style.borderColor = 'var(--emerald)';
    });
    coverPreviewBox.addEventListener('dragleave', () => {
      coverPreviewBox.style.borderColor = '';
    });
    coverPreviewBox.addEventListener('drop', (e) => {
      e.preventDefault();
      coverPreviewBox.style.borderColor = '';
      if (e.dataTransfer.files && e.dataTransfer.files[0]) {
        const file = e.dataTransfer.files[0];
        const reader = new FileReader();
        reader.onload = (evt) => {
          pendingCoverBase64 = evt.target.result;
          coverPreviewImg.src = pendingCoverBase64;
        };
        reader.readAsDataURL(file);
      }
    });
  }

  if (playlistUrlInput) {
    playlistUrlInput.addEventListener('input', (e) => {
      const url = e.target.value.trim();
      if (url && !pendingCoverBase64) {
        coverPreviewImg.src = url;
      } else if (!pendingCoverBase64) {
        coverPreviewImg.src = 'placeholder.svg';
      }
    });
  }

  if (createPlaylistForm) {
    createPlaylistForm.addEventListener('submit', async (e) => {
      e.preventDefault();
      const title = playlistNameInput ? playlistNameInput.value.trim() : '';
      if (!title) {
        showToast('Please enter a playlist title', 'error');
        return;
      }
      const description = playlistDescInput ? playlistDescInput.value.trim() : '';
      const cover_url = playlistUrlInput ? playlistUrlInput.value.trim() : '';

      try {
        const submitBtn = document.getElementById('btn-submit-playlist');
        if (submitBtn) {
          submitBtn.disabled = true;
          submitBtn.textContent = 'Creating...';
        }

        const res = await fetch('/api/playlists', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ title, description, cover_url })
        });

        if (!res.ok) {
          const err = await res.json();
          throw new Error(err.detail || 'Failed to create playlist');
        }

        const newPlaylist = await res.json();

        // If custom uploaded local image
        if (pendingCoverBase64) {
          try {
            await fetch(`/api/playlists/${newPlaylist.id}/cover`, {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ image_data: pendingCoverBase64 })
            });
          } catch (covErr) {
            console.error('Failed to upload cover', covErr);
          }
        }

        closeCreatePlaylistModal();
        showToast(`Playlist "${newPlaylist.title}" created successfully!`, 'success');

        // If we had a track waiting to be added, add it now!
        if (trackToAdd) {
          await addTrackToPlaylistById(newPlaylist.id, trackToAdd);
          trackToAdd = null;
        }

        // Switch to playlists view in library
        activateTab('library');
        currentGroupMode = 'playlists';
        groupPills.forEach(p => p.classList.toggle('active', p.dataset.group === 'playlists'));
        await loadUserPlaylists();
        renderLibrary();
      } catch (err) {
        showToast(err.message, 'error');
      } finally {
        const submitBtn = document.getElementById('btn-submit-playlist');
        if (submitBtn) {
          submitBtn.disabled = false;
          submitBtn.textContent = 'Create Playlist';
        }
      }
    });
  }

  // ==================== ADD TO PLAYLIST MODAL HANDLERS ====================
  function openAddToPlaylistModal(track) {
    trackToAdd = track;
    if (!addToPlaylistModal) return;
    addToPlaylistModal.style.display = 'flex';
    document.body.style.overflow = 'hidden';

    if (addToPlaylistTrackName) {
      addToPlaylistTrackName.textContent = `Select a playlist for "${track.title}"`;
    }

    renderAddToPlaylistList();
  }

  function closeAddToPlaylistModal() {
    if (!addToPlaylistModal) return;
    addToPlaylistModal.style.display = 'none';
    document.body.style.overflow = '';
  }

  if (addToPlaylistClose) addToPlaylistClose.addEventListener('click', closeAddToPlaylistModal);
  if (addToPlaylistBackdrop) addToPlaylistBackdrop.addEventListener('click', closeAddToPlaylistModal);

  if (btnQuickCreateFromAdd) {
    btnQuickCreateFromAdd.addEventListener('click', () => {
      closeAddToPlaylistModal();
      openCreatePlaylistModal();
    });
  }

  function renderAddToPlaylistList() {
    if (!addToPlaylistList) return;
    addToPlaylistList.innerHTML = '';

    if (!userPlaylists.length) {
      addToPlaylistList.innerHTML = `
        <div style="padding: 24px; text-align: center; color: var(--text-tertiary); font-size: 0.85rem;">
          No playlists created yet. Create your first playlist below!
        </div>
      `;
      return;
    }

    userPlaylists.forEach(pl => {
      const item = document.createElement('div');
      item.className = 'add-to-playlist-item';
      const count = pl.track_count || (pl.tracks ? pl.tracks.length : 0);
      const thumbSrc = pl.cover_url || 'placeholder.svg';
      const badgeClass = pl.is_custom ? 'playlist-badge-custom' : 'playlist-badge-saved';
      const badgeText = pl.is_custom ? 'Custom' : 'Saved';

      item.innerHTML = `
        <img class="add-to-playlist-thumb" src="${thumbSrc}" onerror="this.src='placeholder.svg'" alt="Cover" />
        <div class="add-to-playlist-info">
          <div class="add-to-playlist-name truncate">${escapeHtml(pl.title)}</div>
          <div class="add-to-playlist-sub">${count} track${count === 1 ? '' : 's'}</div>
        </div>
        <span class="add-to-playlist-badge ${badgeClass}">${badgeText}</span>
      `;

      item.addEventListener('click', async () => {
        if (!trackToAdd) return;
        await addTrackToPlaylistById(pl.id, trackToAdd);
        closeAddToPlaylistModal();
      });

      addToPlaylistList.appendChild(item);
    });
  }

  async function addTrackToPlaylistById(playlistId, track) {
    try {
      const payload = {
        title: track.title,
        artist: track.artist || 'Unknown Artist',
        album: track.album || '',
        cover_url: track.cover_url || (track.filename ? `/api/songs/artwork/${encodeURIComponent(track.filename)}` : ''),
        duration: track.duration || 0,
        query: track.query || `${track.artist || ''} - ${track.title}`
      };

      const res = await fetch(`/api/playlists/${encodeURIComponent(playlistId)}/tracks`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload)
      });

      if (!res.ok) {
        const err = await res.json();
        throw new Error(err.detail || 'Failed to add track');
      }

      showToast(`Added "${track.title}" to playlist!`, 'success');
      await loadUserPlaylists();
    } catch (e) {
      showToast(e.message, 'error');
    }
  }

  if (drawerDeleteBtn) {
    drawerDeleteBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      if (selectedSong) {
        promptDeleteSong(selectedSong);
      }
    });
  }

  if (drawerAddPlaylistBtn) {
    drawerAddPlaylistBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      if (selectedSong) {
        openAddToPlaylistModal({
          title: selectedSong.title,
          artist: selectedSong.artist,
          album: selectedSong.album,
          filename: selectedSong.filename,
          cover_url: `/api/songs/artwork/${encodeURIComponent(selectedSong.filename)}`,
          duration: selectedSong.duration
        });
      }
    });
  }

  async function downloadEntirePlaylist(playlistData) {
    if (!playlistData || !playlistData.tracks || !playlistData.tracks.length) return;

    closePlaylistModal();

    try {
      const res = await fetch('/api/download/playlist-tracks', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          title: playlistData.title,
          tracks: playlistData.tracks,
          threads: parseInt(settingThreads ? settingThreads.value : 3) || 3,
          quality: settingQuality ? settingQuality.value : '320k',
          naming: settingNaming ? settingNaming.value : 'title'
        })
      });

      if (!res.ok) {
        const err = await res.json();
        throw new Error(err.detail || 'Failed to start batch download');
      }

      showToast(`Downloading "${playlistData.title}" (${playlistData.tracks.length} tracks)...`, 'success');
      btnStop.style.display = 'inline-flex';
      statusBadge.className = 'hud-status-badge active-download';
      statusBadge.textContent = 'Downloading';

      // Switch to Downloader tab to show live progress HUD
      const dlTabBtn = document.querySelector('.nav-item[data-tab="downloader"]');
      if (dlTabBtn) dlTabBtn.click();
    } catch (e) {
      showToast(e.message, 'error');
    }
  }

  // ==================== AUDIO PLAYER ENGINE ====================
  function updateScrubberFill(pct) {
    if (!playerScrubber) return;
    const clamped = Math.max(0, Math.min(pct || 0, 100));
    playerScrubber.style.background = `linear-gradient(to right, var(--emerald) 0%, var(--emerald) ${clamped}%, rgba(255, 255, 255, 0.12) ${clamped}%, rgba(255, 255, 255, 0.12) 100%)`;
  }

  function updateVolumeFill(val) {
    if (!playerVolume) return;
    const pct = Math.max(0, Math.min((val || 0) * 100, 100));
    playerVolume.style.background = `linear-gradient(to right, var(--emerald) 0%, var(--emerald) ${pct}%, rgba(255, 255, 255, 0.12) ${pct}%, rgba(255, 255, 255, 0.12) 100%)`;
  }

  function updateShuffleUI() {
    if (!playerShuffle) return;
    if (isShuffle) {
      playerShuffle.classList.add('active');
      playerShuffle.title = 'Shuffle: On (S)';
    } else {
      playerShuffle.classList.remove('active');
      playerShuffle.title = 'Shuffle: Off (S)';
    }
  }

  function updateRepeatUI() {
    if (!playerRepeat) return;
    if (repeatMode === 'off') {
      playerRepeat.classList.remove('active');
      playerRepeat.title = 'Repeat: Off (R)';
      if (repeatBadge) repeatBadge.classList.remove('show');
    } else if (repeatMode === 'all') {
      playerRepeat.classList.add('active');
      playerRepeat.title = 'Repeat: All (R)';
      if (repeatBadge) repeatBadge.classList.remove('show');
    } else if (repeatMode === 'one') {
      playerRepeat.classList.add('active');
      playerRepeat.title = 'Repeat: Current Track (R)';
      if (repeatBadge) repeatBadge.classList.add('show');
    }
  }

  function highlightPlayingRow() {
    document.querySelectorAll('.song-card, .song-row').forEach(el => {
      el.classList.remove('playing');
    });
    if (currentSongIndex >= 0) {
      const activeEls = document.querySelectorAll(
        `.song-card[data-index="${currentSongIndex}"], .song-row[data-index="${currentSongIndex}"]`
      );
      activeEls.forEach(el => el.classList.add('playing'));
    }
  }

  // -------------------------------------------------------------
  // HTML5 MediaSession & Mac Notch Dynamic Island HUD System
  // -------------------------------------------------------------
  function setupMediaSession(meta) {
    if (!('mediaSession' in navigator)) return;
    try {
      const artworkSrc = meta.artwork_url || 'placeholder.svg';
      const absoluteArt = new URL(artworkSrc, window.location.origin).href;
      navigator.mediaSession.metadata = new MediaMetadata({
        title: meta.title || 'Music Studio Track',
        artist: meta.artist || 'Music Studio',
        album: meta.album || 'Music Studio Master',
        artwork: [
          { src: absoluteArt, sizes: '96x96', type: 'image/jpeg' },
          { src: absoluteArt, sizes: '128x128', type: 'image/jpeg' },
          { src: absoluteArt, sizes: '256x256', type: 'image/jpeg' },
          { src: absoluteArt, sizes: '512x512', type: 'image/jpeg' },
        ]
      });

      const handlers = [
        ['play', () => { audioEngine.play().catch(() => {}); }],
        ['pause', () => { audioEngine.pause(); }],
        ['previoustrack', () => { playPrevTrack(); }],
        ['nexttrack', () => { playNextTrack(); }],
        ['seekbackward', (details) => {
          const skip = (details && details.seekOffset) || 10;
          audioEngine.currentTime = Math.max(0, audioEngine.currentTime - skip);
        }],
        ['seekforward', (details) => {
          const skip = (details && details.seekOffset) || 10;
          audioEngine.currentTime = Math.min(audioEngine.duration || 0, audioEngine.currentTime + skip);
        }],
        ['seekto', (details) => {
          if (details && details.seekTime !== undefined && details.seekTime !== null) {
            audioEngine.currentTime = details.seekTime;
          }
        }],
        ['stop', () => {
          audioEngine.pause();
          audioEngine.currentTime = 0;
        }]
      ];

      for (const [action, handler] of handlers) {
        try {
          navigator.mediaSession.setActionHandler(action, handler);
        } catch (e) {}
      }
    } catch (e) {
      console.warn('setupMediaSession failed', e);
    }
  }

  function updateMediaSessionPlaybackState(state) {
    if (!('mediaSession' in navigator)) return;
    try {
      navigator.mediaSession.playbackState = state;
    } catch (e) {}
  }

  function updateMediaSessionPosition() {
    if (!('mediaSession' in navigator) || !audioEngine.duration || !isFinite(audioEngine.duration)) return;
    try {
      if ('setPositionState' in navigator.mediaSession) {
        navigator.mediaSession.setPositionState({
          duration: Math.max(0, audioEngine.duration),
          playbackRate: audioEngine.playbackRate || 1.0,
          position: Math.max(0, Math.min(audioEngine.currentTime, audioEngine.duration))
        });
      }
    } catch (e) {}
  }

  function updateNotchHUD(meta) {
    if (!notchHud) return;
    if (!meta) {
      notchHud.classList.add('hud-hidden');
      return;
    }
    notchHud.classList.remove('hud-hidden');

    const title = meta.title || 'Unknown Track';
    const artist = meta.artist || 'Unknown Artist';
    const artUrl = meta.artwork_url || 'placeholder.svg';

    if (notchMiniArt) notchMiniArt.src = artUrl;
    if (notchMiniTitle) notchMiniTitle.textContent = title;
    if (notchMiniArtist) notchMiniArtist.textContent = artist;

    if (notchExpandedArt) notchExpandedArt.src = artUrl;
    if (notchExpandedTitle) notchExpandedTitle.textContent = title;
    if (notchExpandedArtist) notchExpandedArtist.textContent = artist;

    if (notchTotalTime && meta.duration) {
      notchTotalTime.textContent = formatSeconds(meta.duration);
    }
  }

  function updateNotchProgress(pct, currentSec) {
    if (notchProgressFill) notchProgressFill.style.width = `${pct}%`;
    if (notchCurrTime) notchCurrTime.textContent = formatSeconds(currentSec);
  }

  function playTrack(idx) {
    if (idx < 0 || idx >= librarySongs.length) return;
    isOnlineStreaming = false;
    currentStreamingTrack = null;
    currentSongIndex = idx;
    hasRecordedPlayForCurrentTrack = false;
    hasTriggeredAutoCrossfade = false;
    playHistory.push(idx);
    if (playHistory.length > 100) playHistory.shift();

    const song = librarySongs[idx];
    let audioUrl = '';
    let coverUrl = 'placeholder.svg';

    if (song.is_android_mediastore && song.file_path) {
      if (window.Capacitor && typeof window.Capacitor.convertFileSrc === 'function') {
        audioUrl = window.Capacitor.convertFileSrc(song.file_path);
      } else {
        audioUrl = song.file_path;
      }
      coverUrl = song.cover_url || 'placeholder.svg';
      if ((!coverUrl || coverUrl === 'placeholder.svg') && window.AndroidMusicScanner && typeof window.AndroidMusicScanner.getTrackArtwork === 'function') {
        const art = window.AndroidMusicScanner.getTrackArtwork(song.file_path, song.album_id || -1);
        if (art && art.startsWith('data:image')) {
          coverUrl = art;
          song.cover_url = art;
        }
      }
    } else if (song.is_local_device && song.file_ref_id) {
      const localFile = window.localDeviceAudioFiles.get(song.file_ref_id);
      if (localFile) {
        audioUrl = URL.createObjectURL(localFile);
      } else {
        showToast('Please re-select your music folder to play this local track', 'info');
        triggerLocalMusicPicker();
        return;
      }
    } else {
      audioUrl = resolveApiUrl(`/api/songs/audio/${encodeURIComponent(song.filename)}`);
      coverUrl = resolveApiUrl(`/api/songs/artwork/${encodeURIComponent(song.filename)}`);
    }

    transitionToAudio(audioUrl, song);

    playerCover.src = coverUrl;
    playerTitle.textContent = song.title || 'Unknown Track';
    playerArtist.textContent = song.artist || 'Unknown Artist';

    playerScrubber.value = 0;
    updateScrubberFill(0);
    playerCurrentTime.textContent = '0:00';
    playerTotalTime.textContent = formatSeconds(song.duration || 0);

    // Hide stream actions
    const dockStreamBadge = document.getElementById('dock-stream-badge');
    if (dockStreamBadge) dockStreamBadge.style.display = 'none';
    const dockQuickDl = document.getElementById('dock-quick-dl-btn');
    if (dockQuickDl) dockQuickDl.style.display = 'none';

    // Synchronize to Fullscreen "Now Playing" Overlay
    if (fsCover) fsCover.src = coverUrl;
    if (fsTitle) fsTitle.textContent = song.title || 'Unknown Track';
    if (fsArtist) fsArtist.textContent = song.artist || 'Unknown Artist';
    if (fsAlbum) fsAlbum.textContent = song.album || 'Music Studio Master';
    if (fsScrubber) {
      fsScrubber.value = 0;
      updateFsScrubberFill(0);
    }
    if (fsCurrentTime) fsCurrentTime.textContent = '0:00';
    if (fsTotalTime) fsTotalTime.textContent = formatSeconds(song.duration || 0);

    const fsStreamActions = document.getElementById('fs-stream-actions');
    if (fsStreamActions) fsStreamActions.style.display = 'none';
    const fsStreamBadge = document.getElementById('fs-stream-badge-floating');
    if (fsStreamBadge) fsStreamBadge.style.display = 'none';

    // Synchronize to Mac Notch HUD & HTML5 MediaSession
    setupMediaSession({
      title: song.title || 'Unknown Track',
      artist: song.artist || 'Unknown Artist',
      album: song.album || 'Music Studio Master',
      artwork_url: coverUrl,
      duration: song.duration
    });
    updateNotchHUD({
      title: song.title || 'Unknown Track',
      artist: song.artist || 'Unknown Artist',
      artwork_url: coverUrl,
      duration: song.duration
    });

    isPlaying = true;
    applySmartTransition(song);
    updatePlayIcon(true);
    highlightPlayingRow();
  }

  function togglePlay() {
    if (!audioEngine.src) {
      if (isOnlineStreaming && currentStreamingTrack) {
        playOnlineTrack(currentStreamingTrack, currentOnlineQueue, currentOnlineQueueIndex);
        return;
      }
      if (currentSongIndex >= 0 && librarySongs[currentSongIndex]) {
        playTrack(currentSongIndex);
        return;
      }
      if (librarySongs.length > 0) {
        playTrack(0);
        return;
      }
      return;
    }
    if (audioEngine.paused) {
      djAudioFx.init();
      djAudioFx.resume();
      const playPromise = audioEngine.play();
      if (playPromise && typeof playPromise.then === 'function') {
        playPromise.then(() => {
          isPlaying = true;
          updatePlayIcon(true);
        }).catch((err) => {
          console.warn('audioEngine.play() error or aborted, attempting recovery:', err);
          if (isOnlineStreaming && currentStreamingTrack) {
            playOnlineTrack(currentStreamingTrack, currentOnlineQueue, currentOnlineQueueIndex);
          } else if (currentSongIndex >= 0 && librarySongs[currentSongIndex]) {
            playTrack(currentSongIndex);
          } else {
            try {
              audioEngine.load();
              audioEngine.play().then(() => {
                isPlaying = true;
                updatePlayIcon(true);
              }).catch(() => {
                isPlaying = false;
                updatePlayIcon(false);
              });
            } catch (e) {
              isPlaying = false;
              updatePlayIcon(false);
            }
          }
        });
      } else {
        isPlaying = true;
        updatePlayIcon(true);
      }
    } else {
      audioEngine.pause();
      isPlaying = false;
      updatePlayIcon(false);
    }
  }

  function updatePlayIcon(playing) {
    const playSvg = `<polygon points="5 3 19 12 5 21 5 3"/>`;
    const pauseSvg = `<rect x="6" y="4" width="4" height="16"/><rect x="14" y="4" width="4" height="16"/>`;
    if (playerPlayIcon) playerPlayIcon.innerHTML = playing ? pauseSvg : playSvg;
    if (fsPlayIcon) fsPlayIcon.innerHTML = playing ? pauseSvg : playSvg;
    if (notchMiniPlayIcon) notchMiniPlayIcon.innerHTML = playing ? pauseSvg : playSvg;
    if (notchPlayIcon) notchPlayIcon.innerHTML = playing ? pauseSvg : playSvg;
    if (notchHud) {
      if (playing) {
        notchHud.classList.add('is-playing');
      } else {
        notchHud.classList.remove('is-playing');
      }
    }
    updateMediaSessionPlaybackState(playing ? 'playing' : 'paused');
  }

  // Fisher-Yates Shuffled Permutation Engine
  function generateShuffleQueue(startIdx = -1) {
    if (!librarySongs.length) {
      shuffleQueue = [];
      shufflePointer = 0;
      return;
    }
    const arr = Array.from({ length: librarySongs.length }, (_, i) => i);
    for (let i = arr.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [arr[i], arr[j]] = [arr[j], arr[i]];
    }
    if (startIdx >= 0) {
      const p = arr.indexOf(startIdx);
      if (p > 0) {
        arr.splice(p, 1);
        arr.unshift(startIdx);
      }
    }
    shuffleQueue = arr;
    shufflePointer = 0;
  }

  function playNextTrack() {
    if (repeatMode === 'one') {
      audioEngine.currentTime = 0;
      audioEngine.play().catch(() => {});
      return;
    }

    // Check userPlayQueue first!
    if (userPlayQueue.length > 0) {
      const nextTrack = userPlayQueue.shift();
      updateQueueBadge();
      renderQueueDrawer();
      playQueueTrack(nextTrack);
      return;
    }

    if (isOnlineStreaming) {
      if (!currentOnlineQueue || !currentOnlineQueue.length) return;
      if (isShuffle) {
        const nextIdx = Math.floor(Math.random() * currentOnlineQueue.length);
        playOnlineTrack(currentOnlineQueue[nextIdx], currentOnlineQueue, nextIdx);
      } else {
        if (currentOnlineQueueIndex < currentOnlineQueue.length - 1) {
          const nextIdx = currentOnlineQueueIndex + 1;
          playOnlineTrack(currentOnlineQueue[nextIdx], currentOnlineQueue, nextIdx);
        } else if (repeatMode === 'all' || transitionMode || currentOnlineQueue.length > 1) {
          playOnlineTrack(currentOnlineQueue[0], currentOnlineQueue, 0);
        } else {
          audioEngine.pause();
          audioEngine.currentTime = 0;
          isPlaying = false;
          updatePlayIcon(false);
        }
      }
      return;
    }

    if (!librarySongs.length) return;

    if (isShuffle) {
      if (!shuffleQueue.length || shuffleQueue.length !== librarySongs.length) {
        generateShuffleQueue(currentSongIndex);
      }
      shufflePointer++;
      if (shufflePointer >= shuffleQueue.length) {
        if (repeatMode === 'all' || transitionMode) {
          generateShuffleQueue();
        } else {
          audioEngine.pause();
          audioEngine.currentTime = 0;
          isPlaying = false;
          updatePlayIcon(false);
          return;
        }
      }
      playTrack(shuffleQueue[shufflePointer]);
    } else {
      if (currentSongIndex < librarySongs.length - 1) {
        playTrack(currentSongIndex + 1);
      } else {
        if (repeatMode === 'all' || transitionMode) {
          playTrack(0);
        } else {
          audioEngine.pause();
          audioEngine.currentTime = 0;
          isPlaying = false;
          updatePlayIcon(false);
        }
      }
    }
  }

  function playPrevTrack() {
    // Standard player UX: if played > 3s, restart current track
    if (audioEngine.currentTime > 3) {
      audioEngine.currentTime = 0;
      return;
    }

    if (isOnlineStreaming) {
      if (!currentOnlineQueue || !currentOnlineQueue.length) return;
      if (isShuffle) {
        const prevIdx = Math.floor(Math.random() * currentOnlineQueue.length);
        playOnlineTrack(currentOnlineQueue[prevIdx], currentOnlineQueue, prevIdx);
      } else {
        if (currentOnlineQueueIndex > 0) {
          const prevIdx = currentOnlineQueueIndex - 1;
          playOnlineTrack(currentOnlineQueue[prevIdx], currentOnlineQueue, prevIdx);
        } else if (repeatMode === 'all') {
          const prevIdx = currentOnlineQueue.length - 1;
          playOnlineTrack(currentOnlineQueue[prevIdx], currentOnlineQueue, prevIdx);
        } else {
          audioEngine.currentTime = 0;
        }
      }
      return;
    }

    if (!librarySongs.length) return;

    if (isShuffle && shuffleQueue.length) {
      if (shufflePointer > 0) {
        shufflePointer--;
        playTrack(shuffleQueue[shufflePointer]);
        return;
      }
    }

    if (currentSongIndex > 0) {
      playTrack(currentSongIndex - 1);
    } else if (repeatMode === 'all' || isShuffle) {
      playTrack(librarySongs.length - 1);
    } else {
      audioEngine.currentTime = 0;
    }
  }

  playerPlayBtn.addEventListener('click', togglePlay);
  playerNext.addEventListener('click', () => {
    isManualTransitionRequested = true;
    playNextTrack();
  });
  playerPrev.addEventListener('click', () => {
    isManualTransitionRequested = true;
    playPrevTrack();
  });

  if (playerShuffle) {
    playerShuffle.addEventListener('click', () => {
      isShuffle = !isShuffle;
      localStorage.setItem('musicstudio_shuffle', isShuffle ? 'true' : 'false');
      generateShuffleQueue(currentSongIndex);
      updateShuffleUI();
      broadcastPlaybackState();
      showToast(isShuffle ? 'Shuffle: On' : 'Shuffle: Off', 'info');
    });
  }

  // Queue UI Event Listeners
  if (playerQueueBtn) {
    playerQueueBtn.addEventListener('click', () => toggleQueueDrawer());
  }
  if (fsQueueBtn) {
    fsQueueBtn.addEventListener('click', () => toggleQueueDrawer());
  }
  if (queueCloseBtn) {
    queueCloseBtn.addEventListener('click', () => toggleQueueDrawer(false));
  }
  if (queueOverlay) {
    queueOverlay.addEventListener('click', () => toggleQueueDrawer(false));
  }
  if (btnClearQueue) {
    btnClearQueue.addEventListener('click', () => clearUserQueue());
  }
  if (drawerQueueBtn) {
    drawerQueueBtn.addEventListener('click', () => {
      if (selectedSong) {
        addToQueue(selectedSong);
        closeDrawer();
      }
    });
  }

  updateQueueBadge();
  setTimeout(restoreLastPlaybackState, 350);

  if (playerRepeat) {
    playerRepeat.addEventListener('click', () => {
      if (repeatMode === 'off') {
        repeatMode = 'all';
      } else if (repeatMode === 'all') {
        repeatMode = 'one';
      } else {
        repeatMode = 'off';
      }
      localStorage.setItem('musicstudio_repeat', repeatMode);
      updateRepeatUI();
      const label = repeatMode === 'one' ? 'Repeat: Current Track' : (repeatMode === 'all' ? 'Repeat: All Tracks' : 'Repeat: Off');
      showToast(label, 'info');
    });
  }

  function updateShuffleUI() {
    const title = isShuffle ? 'Shuffle: On (S)' : 'Shuffle: Off (S)';
    if (playerShuffle) {
      playerShuffle.classList.toggle('active', isShuffle);
      playerShuffle.title = title;
    }
    if (fsShuffle) {
      fsShuffle.classList.toggle('active', isShuffle);
      fsShuffle.title = title;
    }
  }

  function updateRepeatUI() {
    const title = repeatMode === 'one' ? 'Repeat: Current Track (R)' : (repeatMode === 'all' ? 'Repeat: All Tracks (R)' : 'Repeat: Off (R)');
    if (playerRepeat) {
      playerRepeat.classList.toggle('active', repeatMode !== 'off');
      playerRepeat.title = title;
      if (repeatBadge) repeatBadge.classList.toggle('show', repeatMode === 'one');
    }
    if (fsRepeat) {
      fsRepeat.classList.toggle('active', repeatMode !== 'off');
      fsRepeat.title = title;
      if (fsRepeatBadge) fsRepeatBadge.classList.toggle('show', repeatMode === 'one');
    }
  }

  function updateFsScrubberFill(pct) {
    if (!fsScrubber) return;
    const clamped = Math.max(0, Math.min(pct || 0, 100));
    fsScrubber.style.background = `linear-gradient(to right, var(--emerald) 0%, var(--emerald) ${clamped}%, rgba(255, 255, 255, 0.12) ${clamped}%, rgba(255, 255, 255, 0.12) 100%)`;
  }

  function updateFsVolumeFill(val) {
    if (!fsVolume) return;
    const pct = Math.max(0, Math.min((val || 0) * 100, 100));
    fsVolume.style.background = `linear-gradient(to right, var(--emerald) 0%, var(--emerald) ${pct}%, rgba(255, 255, 255, 0.12) ${pct}%, rgba(255, 255, 255, 0.12) 100%)`;
  }

  // Audio Engine Lifecycle
  let lastPlaybackBroadcast = 0;
  function broadcastPlaybackState() {
    let title = 'Music Studio';
    let artist = 'Local Library';
    let album = '';
    let coverUrl = 'placeholder.svg';

    if (isOnlineStreaming && (currentStreamingTrack || currentStreamMeta)) {
      const cur = currentStreamingTrack || currentStreamMeta;
      title = cur.title || 'Online Stream';
      artist = cur.artist || 'Music Studio';
      album = cur.album || 'Online Stream';
      coverUrl = cur.cover_url || cur.artwork_url || 'placeholder.svg';
    } else if (currentSongIndex >= 0 && librarySongs[currentSongIndex]) {
      const s = librarySongs[currentSongIndex];
      title = s.title || title;
      artist = s.artist || artist;
      album = s.album || album;
      if (s.cover_url) {
        coverUrl = s.cover_url;
      } else {
        coverUrl = `/api/songs/artwork/${encodeURIComponent(s.filename)}`;
      }
    }

    let dur = (audioEngine.duration && isFinite(audioEngine.duration)) ? audioEngine.duration : 0;
    if ((!dur || dur <= 0) && isOnlineStreaming && currentStreamingTrack && currentStreamingTrack.duration) {
      dur = currentStreamingTrack.duration;
    }
    let curTime = (audioEngine.currentTime && isFinite(audioEngine.currentTime)) ? audioEngine.currentTime : 0;

    // Synchronize to Android Native MediaSession (AirPods / Bluetooth) and Home Screen Widget
    if (window.AndroidMusicScanner && typeof window.AndroidMusicScanner.updatePlaybackState === 'function') {
      try {
        window.AndroidMusicScanner.updatePlaybackState(
          !audioEngine.paused,
          title,
          artist,
          album,
          Math.round(dur * 1000),
          Math.round(curTime * 1000),
          coverUrl,
          !!isShuffle
        );
      } catch (e) {
        console.warn('Android updatePlaybackState error:', e);
      }
    }

    fetch('/api/playback', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        is_playing: !audioEngine.paused,
        title: title,
        artist: artist,
        album: album,
        cover_url: coverUrl,
        current_time: curTime,
        duration: dur,
        index: currentSongIndex
      })
    }).catch(() => {});
  }

  function recordActiveTrackPlay() {
    let payload = null;
    if (isOnlineStreaming && currentStreamingTrack) {
      payload = {
        title: currentStreamingTrack.title || '',
        artist: currentStreamingTrack.artist || '',
        album: currentStreamingTrack.album || 'Online Stream',
        duration: currentStreamingTrack.duration || 0,
        filename: ''
      };
    } else if (currentSongIndex >= 0 && librarySongs[currentSongIndex]) {
      const s = librarySongs[currentSongIndex];
      payload = {
        title: s.title || '',
        artist: s.artist || '',
        album: s.album || '',
        duration: s.duration || 0,
        filename: s.filename || ''
      };
    }
    if (!payload || !payload.title) return;

    try {
      const stored = JSON.parse(localStorage.getItem('musicstudio_play_counts') || '{}');
      const key = payload.filename || `${payload.title.toLowerCase()} - ${payload.artist.toLowerCase()}`;
      stored[key] = (stored[key] || 0) + 1;
      localStorage.setItem('musicstudio_play_counts', JSON.stringify(stored));
    } catch (e) {}

    if (!isDeviceOffline) {
      fetch('/api/play-stats/record', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload)
      }).catch(() => {});
    }
  }

  audioEngine.addEventListener('timeupdate', () => {
    const curTrackObj = isOnlineStreaming ? currentStreamingTrack : (currentSongIndex >= 0 ? librarySongs[currentSongIndex] : null);
    const effectiveDur = getEffectiveAudioDuration();

    if (!isSeeking && effectiveDur > 0) {
      const pct = Math.min(100, (activeDeck.currentTime / effectiveDur) * 100);
      playerScrubber.value = pct;
      updateScrubberFill(pct);
      saveCurrentPlaybackState();
      playerCurrentTime.textContent = formatSeconds(activeDeck.currentTime);

      if (!hasRecordedPlayForCurrentTrack && activeDeck.currentTime >= 15) {
        hasRecordedPlayForCurrentTrack = true;
        recordActiveTrackPlay();
      }

      if (fsScrubber) {
        fsScrubber.value = pct;
        updateFsScrubberFill(pct);
      }
      if (fsCurrentTime) {
        fsCurrentTime.textContent = formatSeconds(activeDeck.currentTime);
      }
      updateNotchProgress(pct, activeDeck.currentTime);
      updateMediaSessionPosition();

      // Preview stream to full master stream handover
      if (isOnlineStreaming && audioEngine.dataset.streamMode === 'preview' && audioEngine.dataset.streamFullEndpoint) {
        if (audioEngine.currentTime >= 27.5) {
          const fullUrl = audioEngine.dataset.streamFullEndpoint;
          const curPos = audioEngine.currentTime;
          audioEngine.dataset.streamMode = 'full';
          audioEngine.src = fullUrl;
          audioEngine.currentTime = curPos;
          audioEngine.play().catch(() => {});
        }
      }

      // Intelligent zero-gap next-song prefetching (Prioritizing User Queue)
      if (effectiveDur > 15 && !hasPrefetchedNextTrack && (activeDeck.currentTime / effectiveDur) >= 0.65) {
        hasPrefetchedNextTrack = true;
        let nextTrack = null;
        if (userPlayQueue && userPlayQueue.length > 0) {
          nextTrack = userPlayQueue[0];
        } else if (isOnlineStreaming && currentOnlineQueue && currentOnlineQueue.length) {
          if (isShuffle) {
            const pool = currentOnlineQueue.filter((_, i) => i !== currentOnlineQueueIndex);
            if (pool.length) nextTrack = pool[Math.floor(Math.random() * pool.length)];
          } else if (currentOnlineQueueIndex < currentOnlineQueue.length - 1) {
            nextTrack = currentOnlineQueue[currentOnlineQueueIndex + 1];
          } else if (repeatMode === 'all') {
            nextTrack = currentOnlineQueue[0];
          }
        }
        if (nextTrack) {
          const nextQuery = nextTrack.query || `${nextTrack.title} ${nextTrack.artist}`;
          fetch(resolveApiUrl(`/api/stream/prefetch?q=${encodeURIComponent(nextQuery)}`)).catch(() => {});
        }
      }

      // Smart Transition: DJ & Apple Music-Style Audio Crossfade Engine
      if (transitionMode && !isCrossfading && !hasTriggeredAutoCrossfade && effectiveDur > 0) {
        const nextItem = peekNextTrack();
        const nextTrackObj = nextItem ? (nextItem.track || nextItem.song) : null;
        const plan = planSmartTransition(curTrackObj, nextTrackObj, false);
        const safeDuration = Math.min(plan.durationMs / 1000, Math.max(3.8, effectiveDur * 0.28));
        const remainingTime = effectiveDur - activeDeck.currentTime;

        if (remainingTime <= safeDuration && remainingTime > 0.2 && activeDeck.currentTime > 3) {
          hasTriggeredAutoCrossfade = true;
          isAutoCrossfadeInProgress = true;
          playNextTrack();
        }
      }

      const now = Date.now();
      if (now - lastPlaybackBroadcast > 1000) {
        lastPlaybackBroadcast = now;
        broadcastPlaybackState();
      }
    }
  });

  audioEngine.addEventListener('loadedmetadata', () => {
    const dur = getEffectiveAudioDuration();
    if (dur > 0) {
      playerTotalTime.textContent = formatSeconds(dur);
      if (fsTotalTime) fsTotalTime.textContent = formatSeconds(dur);
      if (notchTotalTime) notchTotalTime.textContent = formatSeconds(dur);
      updateMediaSessionPosition();
      broadcastPlaybackState();
    }
  });

  audioEngine.addEventListener('durationchange', () => {
    const dur = getEffectiveAudioDuration();
    if (dur > 0) {
      playerTotalTime.textContent = formatSeconds(dur);
      if (fsTotalTime) fsTotalTime.textContent = formatSeconds(dur);
      if (notchTotalTime) notchTotalTime.textContent = formatSeconds(dur);
      updateMediaSessionPosition();
      broadcastPlaybackState();
    }
  });

  audioEngine.addEventListener('play', () => {
    isPlaying = true;
    updatePlayIcon(true);
    highlightPlayingRow();
    broadcastPlaybackState();
  });

  audioEngine.addEventListener('pause', () => {
    isPlaying = false;
    updatePlayIcon(false);
    broadcastPlaybackState();
  });

  audioEngine.addEventListener('ended', () => {
    if (!hasRecordedPlayForCurrentTrack && audioEngine.currentTime >= 5) {
      hasRecordedPlayForCurrentTrack = true;
      recordActiveTrackPlay();
    }

    if (repeatMode === 'one') {
      audioEngine.currentTime = 0;
      audioEngine.play().catch(() => {});
      return;
    }
    if (transitionMode && !isCrossfading) {
      isAutoCrossfadeInProgress = true;
      playNextTrack();
      return;
    }
    if (isOnlineStreaming) {
      playNextTrack();
    } else if (currentSongIndex >= 0 && librarySongs.length > 0) {
      playNextTrack();
    } else {
      isPlaying = false;
      updatePlayIcon(false);
      playerScrubber.value = 0;
      updateScrubberFill(0);
      playerCurrentTime.textContent = '0:00';
      if (fsScrubber) {
        fsScrubber.value = 0;
        updateFsScrubberFill(0);
      }
      if (fsCurrentTime) fsCurrentTime.textContent = '0:00';
    }
  });

  audioEngine.addEventListener('error', (e) => {
    console.warn('Audio playback engine encountered an error:', e);
    if (isPlaying) {
      if (isOnlineStreaming && currentStreamingTrack) {
        console.log('Attempting online stream recovery upon error...');
        playOnlineTrack(currentStreamingTrack, currentOnlineQueue, currentOnlineQueueIndex);
      } else {
        isPlaying = false;
        updatePlayIcon(false);
      }
    }
  });

  // Dock & Fullscreen Streaming Save Buttons
  const dockQuickDlBtn = document.getElementById('dock-quick-dl-btn');
  if (dockQuickDlBtn) {
    dockQuickDlBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      saveCurrentStreamingTrack();
    });
  }

  const fsSaveBtn = document.getElementById('fs-save-btn');
  if (fsSaveBtn) {
    fsSaveBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      saveCurrentStreamingTrack();
    });
  }

  // Dock Scrubber: Live Dragging & Seeking
  playerScrubber.addEventListener('pointerdown', () => {
    isSeeking = true;
  });

  playerScrubber.addEventListener('input', (e) => {
    isSeeking = true;
    const pct = parseFloat(e.target.value);
    updateScrubberFill(pct);
    updateFsScrubberFill(pct);
    if (audioEngine.duration && isFinite(audioEngine.duration)) {
      const previewTime = (pct / 100) * audioEngine.duration;
      playerCurrentTime.textContent = formatSeconds(previewTime);
      if (fsCurrentTime) fsCurrentTime.textContent = formatSeconds(previewTime);
    }
  });

  function seekAudioTo(targetTime) {
    if (!audioEngine) return;
    hasTriggeredAutoCrossfade = false;
    if (isCrossfading) {
      cancelCrossfade();
    }
    if (isOnlineStreaming && audioEngine.dataset.streamMode === 'preview' && targetTime > 27.5 && audioEngine.dataset.streamFullEndpoint) {
      const fullUrl = audioEngine.dataset.streamFullEndpoint;
      audioEngine.dataset.streamMode = 'full';
      audioEngine.src = fullUrl;
      audioEngine.currentTime = targetTime;
      audioEngine.play().catch(() => {});
    } else {
      const effDur = getEffectiveAudioDuration();
      const maxDur = effDur > 0 ? effDur : ((audioEngine.duration && isFinite(audioEngine.duration)) ? audioEngine.duration : 10000);
      audioEngine.currentTime = Math.max(0, Math.min(targetTime, maxDur - 0.2));
    }
  }

  playerScrubber.addEventListener('change', (e) => {
    const pct = parseFloat(e.target.value);
    const dur = getEffectiveAudioDuration();
    if (dur > 0) {
      const targetTime = (pct / 100) * dur;
      seekAudioTo(targetTime);
    }
    setTimeout(() => {
      isSeeking = false;
    }, 120);
  });

  // Fullscreen Scrubber: Live Dragging & Seeking
  if (fsScrubber) {
    fsScrubber.addEventListener('pointerdown', () => {
      isSeeking = true;
    });

    fsScrubber.addEventListener('input', (e) => {
      isSeeking = true;
      const pct = parseFloat(e.target.value);
      updateScrubberFill(pct);
      updateFsScrubberFill(pct);
      const dur = getEffectiveAudioDuration();
      if (dur > 0) {
        const previewTime = (pct / 100) * dur;
        playerCurrentTime.textContent = formatSeconds(previewTime);
        if (fsCurrentTime) fsCurrentTime.textContent = formatSeconds(previewTime);
      }
    });

    fsScrubber.addEventListener('change', (e) => {
      const pct = parseFloat(e.target.value);
      const dur = getEffectiveAudioDuration();
      if (dur > 0) {
        const targetTime = (pct / 100) * dur;
        seekAudioTo(targetTime);
      }
      setTimeout(() => {
        isSeeking = false;
      }, 120);
    });
  }

  // Scrubber Wheel Scrolling
  if (scrubberWrap) {
    scrubberWrap.addEventListener('wheel', (e) => {
      e.preventDefault();
      if (!audioEngine.duration || !isFinite(audioEngine.duration)) return;

      const direction = (e.deltaY < 0 || e.deltaX > 0) ? 1 : -1;
      const step = direction * 4;
      const targetTime = Math.max(0, Math.min(audioEngine.currentTime + step, audioEngine.duration - 0.2));
      audioEngine.currentTime = targetTime;

      const pct = (targetTime / audioEngine.duration) * 100;
      playerScrubber.value = pct;
      updateScrubberFill(pct);
      playerCurrentTime.textContent = formatSeconds(targetTime);
      if (fsScrubber) {
        fsScrubber.value = pct;
        updateFsScrubberFill(pct);
      }
      if (fsCurrentTime) fsCurrentTime.textContent = formatSeconds(targetTime);
    }, { passive: false });

    scrubberWrap.addEventListener('mousemove', (e) => {
      if (!scrubberTooltip || !audioEngine.duration || !isFinite(audioEngine.duration)) return;
      const rect = scrubberWrap.getBoundingClientRect();
      const offsetX = Math.max(0, Math.min(e.clientX - rect.left, rect.width));
      const ratio = offsetX / rect.width;
      const previewSec = ratio * audioEngine.duration;
      scrubberTooltip.textContent = formatSeconds(previewSec);
      scrubberTooltip.style.left = `${offsetX}px`;
    });
  }

  // Volume & Mute Initialization
  const initialVol = Math.max(0, Math.min(previousVolume, 1));
  audioEngine.volume = initialVol;
  playerVolume.value = initialVol;
  updateVolumeFill(initialVol);
  updateVolumeIcon(initialVol);
  if (fsVolume) {
    fsVolume.value = initialVol;
    updateFsVolumeFill(initialVol);
  }

  playerVolume.addEventListener('input', (e) => {
    const val = parseFloat(e.target.value);
    audioEngine.volume = val;
    previousVolume = val;
    localStorage.setItem('musicstudio_volume', val.toString());
    updateVolumeFill(val);
    updateVolumeIcon(val);
    if (fsVolume) {
      fsVolume.value = val;
      updateFsVolumeFill(val);
    }
  });

  playerMuteBtn.addEventListener('click', () => {
    if (audioEngine.volume > 0) {
      previousVolume = audioEngine.volume;
      audioEngine.volume = 0;
      playerVolume.value = 0;
      updateVolumeFill(0);
      updateVolumeIcon(0);
      if (fsVolume) {
        fsVolume.value = 0;
        updateFsVolumeFill(0);
      }
    } else {
      const restored = previousVolume > 0 ? previousVolume : 0.8;
      audioEngine.volume = restored;
      playerVolume.value = restored;
      updateVolumeFill(restored);
      updateVolumeIcon(restored);
      if (fsVolume) {
        fsVolume.value = restored;
        updateFsVolumeFill(restored);
      }
    }
  });

  // Fullscreen Player Controls
  if (fsPlay) fsPlay.addEventListener('click', togglePlay);
  if (fsNext) fsNext.addEventListener('click', () => {
    isManualTransitionRequested = true;
    playNextTrack();
  });
  if (fsPrev) fsPrev.addEventListener('click', () => {
    isManualTransitionRequested = true;
    playPrevTrack();
  });
  if (fsShuffle) {
    fsShuffle.addEventListener('click', () => {
      if (playerShuffle) playerShuffle.click();
    });
  }
  if (fsRepeat) {
    fsRepeat.addEventListener('click', () => {
      if (playerRepeat) playerRepeat.click();
    });
  }
  if (fsVolume) {
    fsVolume.addEventListener('input', (e) => {
      const val = parseFloat(e.target.value);
      audioEngine.volume = val;
      previousVolume = val;
      localStorage.setItem('musicstudio_volume', val.toString());
      playerVolume.value = val;
      updateVolumeFill(val);
      updateVolumeIcon(val);
      updateFsVolumeFill(val);
    });
  }
  if (fsMuteBtn) {
    fsMuteBtn.addEventListener('click', () => {
      if (playerMuteBtn) playerMuteBtn.click();
    });
  }
  if (fsDrawerBtn) {
    fsDrawerBtn.addEventListener('click', () => {
      if (currentSongIndex >= 0 && currentSongIndex < librarySongs.length) {
        openDrawer(librarySongs[currentSongIndex], currentSongIndex);
      }
    });
  }

  // Fullscreen Player Open / Close
  function openFullscreenPlayer() {
    if (!fullscreenPlayer) return;
    fullscreenPlayer.style.display = 'flex';
    fullscreenPlayer.offsetHeight; // trigger CSS transition
    fullscreenPlayer.classList.add('active');
    document.body.style.overflow = 'hidden';

    // Synchronize current track data
    if (currentSongIndex >= 0 && currentSongIndex < librarySongs.length) {
      const song = librarySongs[currentSongIndex];
      if (fsTitle) fsTitle.textContent = song.title || 'Unknown Track';
      if (fsArtist) fsArtist.textContent = song.artist || 'Unknown Artist';
      if (fsAlbum) fsAlbum.textContent = song.album || 'Music Studio Master';
      if (fsCover) fsCover.src = (song.cover_url && song.cover_url !== 'placeholder.svg') ? song.cover_url : (song.filename ? resolveApiUrl(`/api/songs/artwork/${encodeURIComponent(song.filename)}`) : 'placeholder.svg');
    }
    updatePlayIcon(isPlaying);
    updateShuffleUI();
    updateRepeatUI();
    if (audioEngine.duration && isFinite(audioEngine.duration)) {
      const pct = (audioEngine.currentTime / audioEngine.duration) * 100;
      if (fsScrubber) {
        fsScrubber.value = pct;
        updateFsScrubberFill(pct);
      }
      if (fsCurrentTime) fsCurrentTime.textContent = formatSeconds(audioEngine.currentTime);
      if (fsTotalTime) fsTotalTime.textContent = formatSeconds(audioEngine.duration);
    }
  }

  function closeFullscreenPlayer() {
    if (!fullscreenPlayer) return;
    fullscreenPlayer.classList.remove('active');
    document.body.style.overflow = '';
    setTimeout(() => {
      if (!fullscreenPlayer.classList.contains('active')) {
        fullscreenPlayer.style.display = 'none';
      }
    }, 400);
  }

  if (fsMinimizeBtn) fsMinimizeBtn.addEventListener('click', closeFullscreenPlayer);

  // ONLY maximize fullscreen player when clicking the small cover or the max button
  if (playerExpandBtn) {
    playerExpandBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      openFullscreenPlayer();
    });
  }

  const dockCoverWrap = document.getElementById('dock-cover-wrap') || document.querySelector('.dock-cover-wrap');
  if (dockCoverWrap) {
    dockCoverWrap.addEventListener('click', (e) => {
      e.stopPropagation();
      openFullscreenPlayer();
    });
  } else if (playerCover) {
    playerCover.addEventListener('click', (e) => {
      e.stopPropagation();
      openFullscreenPlayer();
    });
  }

  // Mobile swipe down gesture to dismiss fullscreen player
  let fsTouchStartY = 0;
  if (fullscreenPlayer) {
    fullscreenPlayer.addEventListener('touchstart', (e) => {
      if (e.touches && e.touches.length > 0) {
        fsTouchStartY = e.touches[0].clientY;
      }
    }, { passive: true });

    fullscreenPlayer.addEventListener('touchend', (e) => {
      if (e.changedTouches && e.changedTouches.length > 0) {
        const fsTouchEndY = e.changedTouches[0].clientY;
        if (fsTouchEndY - fsTouchStartY > 80) {
          closeFullscreenPlayer();
        }
      }
    }, { passive: true });
  }

  // Mobile drawer drag bar to dismiss track drawer
  const drawerDragBar = document.querySelector('.drawer-drag-bar');
  if (drawerDragBar) {
    drawerDragBar.addEventListener('click', () => {
      if (trackDrawer) trackDrawer.classList.remove('open');
      if (drawerOverlay) drawerOverlay.classList.remove('open');
    });
  }

  function updateVolumeIcon(vol) {
    const muteSvg = `<polygon points="11 5 6 9 2 9 2 15 6 15 11 19 11 5"/><line x1="23" y1="9" x2="17" y2="15"/><line x1="17" y1="9" x2="23" y2="15"/>`;
    const lowSvg = `<polygon points="11 5 6 9 2 9 2 15 6 15 11 19 11 5"/><path d="M15.54 8.46a5 5 0 0 1 0 7.07"/>`;
    const highSvg = `<polygon points="11 5 6 9 2 9 2 15 6 15 11 19 11 5"/><path d="M19.07 4.93a10 10 0 0 1 0 14.14M15.54 8.46a5 5 0 0 1 0 7.07"/>`;

    const iconHtml = vol === 0 ? muteSvg : (vol < 0.5 ? lowSvg : highSvg);
    if (volumeIcon) volumeIcon.innerHTML = iconHtml;
    if (fsVolIcon) fsVolIcon.innerHTML = iconHtml;
  }

  // ==================== GLOBAL KEYBOARD SHORTCUTS ====================
  document.addEventListener('keydown', (e) => {
    const activeTag = document.activeElement ? document.activeElement.tagName.toLowerCase() : '';
    if (activeTag === 'input' || activeTag === 'textarea' || activeTag === 'select') {
      return;
    }

    if (e.code === 'Space') {
      e.preventDefault();
      togglePlay();
    } else if (e.code === 'ArrowLeft') {
      e.preventDefault();
      if (audioEngine.duration && isFinite(audioEngine.duration)) {
        audioEngine.currentTime = Math.max(0, audioEngine.currentTime - 5);
      }
    } else if (e.code === 'ArrowRight') {
      e.preventDefault();
      if (audioEngine.duration && isFinite(audioEngine.duration)) {
        audioEngine.currentTime = Math.min(audioEngine.duration, audioEngine.currentTime + 5);
      }
    } else if (e.code === 'ArrowUp') {
      e.preventDefault();
      const newVol = Math.min(1, audioEngine.volume + 0.05);
      audioEngine.volume = newVol;
      playerVolume.value = newVol;
      updateVolumeFill(newVol);
      updateVolumeIcon(newVol);
      if (fsVolume) {
        fsVolume.value = newVol;
        updateFsVolumeFill(newVol);
      }
    } else if (e.code === 'ArrowDown') {
      e.preventDefault();
      const newVol = Math.max(0, audioEngine.volume - 0.05);
      audioEngine.volume = newVol;
      playerVolume.value = newVol;
      updateVolumeFill(newVol);
      updateVolumeIcon(newVol);
      if (fsVolume) {
        fsVolume.value = newVol;
        updateFsVolumeFill(newVol);
      }
    } else if (e.key === 's' || e.key === 'S') {
      if (playerShuffle) playerShuffle.click();
    } else if (e.key === 'r' || e.key === 'R') {
      if (playerRepeat) playerRepeat.click();
    } else if (e.key === 't' || e.key === 'T') {
      toggleTransitionMode();
    } else if (e.key === 'm' || e.key === 'M') {
      if (playerMuteBtn) playerMuteBtn.click();
    } else if (e.key === 'f' || e.key === 'F') {
      if (fullscreenPlayer && fullscreenPlayer.classList.contains('active')) {
        closeFullscreenPlayer();
      } else {
        openFullscreenPlayer();
      }
    } else if (e.key === 'n' || e.key === 'N' || (e.shiftKey && e.code === 'ArrowRight')) {
      isManualTransitionRequested = true;
      playNextTrack();
    } else if (e.key === 'p' || e.key === 'P' || (e.shiftKey && e.code === 'ArrowLeft')) {
      isManualTransitionRequested = true;
      playPrevTrack();
    } else if (e.code === 'Escape') {
      if (fullscreenPlayer && fullscreenPlayer.classList.contains('active')) {
        closeFullscreenPlayer();
      } else {
        closeDrawer();
        closePlaylistModal();
      }
    }
  });

  // ==================== TOAST NOTIFICATIONS ====================
  function showToast(msg, type = 'info') {
    const stack = document.getElementById('toast-container');
    const toast = document.createElement('div');
    toast.className = `toast ${type}`;
    toast.textContent = msg;
    stack.appendChild(toast);

    setTimeout(() => {
      toast.style.opacity = '0';
      toast.style.transform = 'translateY(10px) scale(0.95)';
      setTimeout(() => toast.remove(), 250);
    }, 3200);
  }

  // Helper formatting utilities
  function formatSeconds(sec) {
    const num = Number(sec);
    if (!num || isNaN(num) || !isFinite(num) || num < 0) return '0:00';
    const m = Math.floor(num / 60);
    const s = Math.floor(num % 60);
    return `${m}:${s < 10 ? '0' : ''}${s}`;
  }

  function escapeHtml(str) {
    if (!str) return '';
    return String(str)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#039;');
  }

  // Hash-based Tab Routing (e.g. #library, #settings, #discover)
  function handleHash() {
    const hash = window.location.hash.replace('#', '');
    if (hash) {
      const targetBtn = document.querySelector(`.nav-item[data-tab="${hash}"]`);
      if (targetBtn) {
        targetBtn.click();
      }
    }
  }
  // -------------------------------------------------------------
  // Mac Notch HUD Event Listeners & Interactive Controls
  // -------------------------------------------------------------
  if (notchHud) {
    // Prevent clicks inside the expanded island from closing it immediately
    if (notchExpandedIsland) {
      notchExpandedIsland.addEventListener('click', (e) => {
        e.stopPropagation();
      });
    }

    // Toggle expand/collapse when clicking the notch pill
    if (notchPill) {
      notchPill.addEventListener('click', (e) => {
        e.stopPropagation();
        notchHud.classList.toggle('is-expanded');
      });
    }

    // Play/Pause from mini notch pill button
    if (notchMiniPlayBtn) {
      notchMiniPlayBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        togglePlay();
      });
    }

    // Play/Pause from expanded notch controls
    if (notchPlayBtn) {
      notchPlayBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        togglePlay();
      });
    }

    // Prev / Next from expanded notch
    if (notchPrevBtn) {
      notchPrevBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        playPrevTrack();
      });
    }

    if (notchNextBtn) {
      notchNextBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        playNextTrack();
      });
    }

    // Open Fullscreen player from Notch HUD
    if (notchFsBtn) {
      notchFsBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        notchHud.classList.remove('is-expanded');
        openFullscreenPlayer();
      });
    }

    // Click seeking on notch progress bar
    if (notchProgressTrack) {
      notchProgressTrack.addEventListener('click', (e) => {
        e.stopPropagation();
        if (!audioEngine.duration || !isFinite(audioEngine.duration)) return;
        const rect = notchProgressTrack.getBoundingClientRect();
        const clickX = e.clientX - rect.left;
        const ratio = Math.max(0, Math.min(clickX / rect.width, 1));
        audioEngine.currentTime = ratio * audioEngine.duration;
      });
    }

    // Clicking anywhere else in the document collapses the notch
    document.addEventListener('click', (e) => {
      if (notchHud.classList.contains('is-expanded') && !notchHud.contains(e.target)) {
        notchHud.classList.remove('is-expanded');
      }
    });
  }

  // -------------------------------------------------------------
  // Import Playlist Modal & API Wiring
  // -------------------------------------------------------------
  function openImportPlaylistModal() {
    if (!importPlaylistModal) return;
    if (importPlaylistUrl) importPlaylistUrl.value = '';
    if (importPlaylistCustomName) importPlaylistCustomName.value = '';
    if (importPlaylistStatus) importPlaylistStatus.style.display = 'none';
    if (btnSubmitImport) {
      btnSubmitImport.disabled = false;
      btnSubmitImport.innerHTML = `
        <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
          <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/>
          <polyline points="7 10 12 15 17 10"/>
          <line x1="12" y1="15" x2="12" y2="3"/>
        </svg>
        <span>Import Now</span>
      `;
    }
    importPlaylistModal.style.display = 'flex';
    importPlaylistModal.classList.add('open');
    if (importPlaylistBackdrop) importPlaylistBackdrop.classList.add('open');
    document.body.style.overflow = 'hidden';
    setTimeout(() => {
      if (importPlaylistUrl) importPlaylistUrl.focus();
    }, 100);
  }

  function closeImportPlaylistModal() {
    if (!importPlaylistModal) return;
    importPlaylistModal.classList.remove('open');
    importPlaylistModal.style.display = 'none';
    if (importPlaylistBackdrop) importPlaylistBackdrop.classList.remove('open');
    document.body.style.overflow = '';
  }

  if (btnImportPlaylist) {
    btnImportPlaylist.addEventListener('click', openImportPlaylistModal);
  }
  if (importPlaylistClose) {
    importPlaylistClose.addEventListener('click', closeImportPlaylistModal);
  }
  if (importPlaylistBackdrop) {
    importPlaylistBackdrop.addEventListener('click', closeImportPlaylistModal);
  }
  if (btnCancelImport) {
    btnCancelImport.addEventListener('click', closeImportPlaylistModal);
  }

  // Paste from clipboard helper
  if (btnImportPaste) {
    btnImportPaste.addEventListener('click', async () => {
      try {
        if (navigator.clipboard && navigator.clipboard.readText) {
          const text = await navigator.clipboard.readText();
          if (text && importPlaylistUrl) {
            importPlaylistUrl.value = text.trim();
            showToast('Pasted URL from clipboard', 'info');
          }
        } else {
          showToast('Clipboard API not available; please paste manually', 'warning');
        }
      } catch (err) {
        showToast('Clipboard access denied; please paste manually (Cmd+V)', 'warning');
      }
    });
  }

  // Form submission & import execution
  if (importPlaylistForm) {
    importPlaylistForm.addEventListener('submit', async (e) => {
      e.preventDefault();
      const url = importPlaylistUrl ? importPlaylistUrl.value.trim() : '';
      const customName = importPlaylistCustomName ? importPlaylistCustomName.value.trim() : '';

      if (!url) {
        showToast('Please enter a Spotify or YouTube Music playlist link', 'warning');
        return;
      }

      // Show in-modal loader
      if (importPlaylistStatus) importPlaylistStatus.style.display = 'block';
      if (importStatusTitle) importStatusTitle.textContent = 'Analyzing and importing playlist...';
      if (importStatusSubtitle) importStatusSubtitle.textContent = 'Extracting track information and metadata. This takes just a moment.';
      if (btnSubmitImport) {
        btnSubmitImport.disabled = true;
        btnSubmitImport.innerHTML = `
          <div class="inline-spinner" style="width:16px;height:16px;border:2px solid rgba(255,255,255,0.3);border-top-color:#fff;border-radius:50%;animation:spin 0.8s linear infinite;"></div>
          <span>Importing...</span>
        `;
      }

      try {
        const res = await fetch('/api/playlists/import', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ url, custom_name: customName })
        });
        const data = await res.json();

        if (res.ok && data.success && data.playlist) {
          showToast(`Successfully imported "${data.playlist.name}" (${data.playlist.track_count || 0} tracks)!`, 'success');
          closeImportPlaylistModal();

          // Refresh user playlists
          await loadUserPlaylists();

          // Switch tab to library #custom-playlists subfilter or open modal directly
          const customSubPill = document.querySelector('.group-pill[data-subfilter="custom"]');
          if (customSubPill) {
            const libraryTabBtn = document.querySelector('.nav-item[data-tab="library"]');
            if (libraryTabBtn) libraryTabBtn.click();
            customSubPill.click();
          }

          // Open the imported playlist in modal view
          openPlaylistModal(data.playlist);
        } else {
          const errMsg = data.detail || data.error || 'Failed to import playlist';
          if (importStatusTitle) importStatusTitle.textContent = 'Import Error';
          if (importStatusSubtitle) importStatusSubtitle.textContent = errMsg;
          showToast(errMsg, 'error');
          if (btnSubmitImport) {
            btnSubmitImport.disabled = false;
            btnSubmitImport.innerHTML = `<span>Try Again</span>`;
          }
        }
      } catch (err) {
        console.error('Import playlist error:', err);
        const errMsg = err.message || 'Connection failure while importing playlist';
        if (importStatusTitle) importStatusTitle.textContent = 'Network Error';
        if (importStatusSubtitle) importStatusSubtitle.textContent = errMsg;
        showToast(errMsg, 'error');
        if (btnSubmitImport) {
          btnSubmitImport.disabled = false;
          btnSubmitImport.innerHTML = `<span>Try Again</span>`;
        }
      }
    });
  }

  function initOfflineDetection() {
    const offlinePill = document.getElementById('offline-mode-pill');
    const forceOfflineToggle = document.getElementById('setting-force-offline');

    function applyOfflineState(offline) {
      isDeviceOffline = offline;
      document.body.classList.toggle('is-offline-mode', offline);

      if (offlinePill) {
        offlinePill.style.display = offline ? 'inline-flex' : 'none';
      }

      document.querySelectorAll('.nav-item, .mobile-nav-item').forEach(b => {
        const tab = b.getAttribute('data-tab');
        if (tab === 'discover' || tab === 'downloader') {
          b.classList.toggle('tab-offline-disabled', offline);
          b.setAttribute('title', offline ? 'Unavailable offline' : '');
        }
      });

      if (offline) {
        const activeTab = document.querySelector('.tab-view.active');
        if (activeTab && (activeTab.id === 'tab-discover' || activeTab.id === 'tab-downloader')) {
          activateTab('library');
          showToast('⚡ Offline Mode: Switched to downloaded music library', 'warning');
        }
      }
    }

    window.addEventListener('online', () => {
      if (forceOfflineToggle && forceOfflineToggle.checked) return;
      applyOfflineState(false);
      showToast('🌐 Connection restored: Online streaming & downloader active.', 'success');
    });

    window.addEventListener('offline', () => {
      applyOfflineState(true);
      showToast('⚡ Device offline: Switched to local offline Library.', 'warning');
    });

    if (forceOfflineToggle) {
      forceOfflineToggle.addEventListener('change', (e) => {
        applyOfflineState(e.target.checked || !navigator.onLine);
      });
    }

    // Server URL configuration in Settings
    const serverUrlInput = document.getElementById('setting-server-url');
    const saveServerUrlBtn = document.getElementById('btn-save-server-url');
    const testServerUrlBtn = document.getElementById('btn-test-server-url');

    if (serverUrlInput) {
      const stored = localStorage.getItem('musicstudio_server_url') || '';
      // Only default to origin if NOT on mobile / capacitor localhost
      if (stored) {
        serverUrlInput.value = stored;
      } else if (!isMobilePlatform && window.location.origin && !window.location.origin.includes('localhost:80')) {
        serverUrlInput.value = window.location.origin;
      } else {
        serverUrlInput.value = '';
      }
    }

    if (saveServerUrlBtn && serverUrlInput) {
      saveServerUrlBtn.addEventListener('click', () => {
        let val = serverUrlInput.value.trim();
        if (val) {
          if (!val.startsWith('http://') && !val.startsWith('https://')) {
            val = 'http://' + val;
            serverUrlInput.value = val;
          }
          val = val.replace(/\/+$/, '');
          localStorage.setItem('musicstudio_server_url', val);
          showToast(`Server URL saved: ${val}`, 'success');
          loadLibrary();
          loadExplore();
          loadUserPlaylists();
        } else {
          localStorage.removeItem('musicstudio_server_url');
          showToast('Server URL cleared (Standalone Mode)', 'info');
        }
      });
    }

    if (testServerUrlBtn && serverUrlInput) {
      testServerUrlBtn.addEventListener('click', async () => {
        let val = serverUrlInput.value.trim();
        if (!val) {
          showToast('Please enter your computer\'s Wi-Fi address (e.g. http://192.168.1.xxx:5050)', 'warning');
          return;
        }
        if (!val.startsWith('http://') && !val.startsWith('https://')) {
          val = 'http://' + val;
          serverUrlInput.value = val;
        }
        val = val.replace(/\/+$/, '');
        testServerUrlBtn.disabled = true;
        testServerUrlBtn.textContent = 'Connecting...';
        try {
          const res = await nativeFetch(`${val}/api/playlists`);
          const contentType = res.headers.get('content-type') || '';
          if (res.ok && contentType.includes('application/json')) {
            localStorage.setItem('musicstudio_server_url', val);
            showToast('✅ Connected to Music Studio PC Server! Syncing...', 'success');
            testServerUrlBtn.textContent = 'Connected!';
            loadLibrary();
            loadExplore();
            loadUserPlaylists();
          } else {
            throw new Error(`Server returned HTTP ${res.status}`);
          }
        } catch (err) {
          showToast(`❌ Cannot reach ${val}. Check Wi-Fi and port 5050.`, 'error');
          testServerUrlBtn.textContent = 'Failed';
        } finally {
          setTimeout(() => {
            testServerUrlBtn.disabled = false;
            testServerUrlBtn.textContent = 'Test Connection';
          }, 3000);
        }
      });
    }

    applyOfflineState(!navigator.onLine);
  }


  // ==================== SPOTIFY-STYLE QUEUE IMPLEMENTATION ====================
  function updateQueueBadge() {
    if (!queueBadge) return;
    const count = userPlayQueue.length;
    if (count > 0) {
      queueBadge.textContent = count > 99 ? '99+' : count;
      queueBadge.style.display = 'block';
    } else {
      queueBadge.style.display = 'none';
    }
    if (queueCountLabel) {
      queueCountLabel.textContent = `${count} track${count === 1 ? '' : 's'} queued`;
    }
    try {
      localStorage.setItem('musicstudio_queue', JSON.stringify(userPlayQueue));
    } catch (e) {}
  }

  function addToQueue(track, playNextInLine = false) {
    if (!track) return;
    const queueItem = {
      id: track.id || ('q_' + Date.now() + '_' + Math.random().toString(36).substr(2, 5)),
      title: track.title || 'Unknown Title',
      artist: track.artist || 'Unknown Artist',
      album: track.album || '',
      duration: track.duration || 0,
      cover_url: track.cover_url || (track.filename ? resolveApiUrl(`/api/songs/artwork/${encodeURIComponent(track.filename)}`) : 'placeholder.svg'),
      filename: track.filename || '',
      file_path: track.file_path || '',
      preview_url: track.preview_url || '',
      query: track.query || `${track.title} ${track.artist}`,
      is_online: Boolean(track.is_online || isOnlineStreaming || track.preview_url),
      is_android_mediastore: Boolean(track.is_android_mediastore),
      is_local_device: Boolean(track.is_local_device),
      file_ref_id: track.file_ref_id || null
    };

    if (playNextInLine) {
      userPlayQueue.unshift(queueItem);
    } else {
      userPlayQueue.push(queueItem);
    }

    updateQueueBadge();
    renderQueueDrawer();
    showToast(`✓ Added "${track.title}" to Queue`, 'success');
  }

  function removeFromQueue(index) {
    if (index >= 0 && index < userPlayQueue.length) {
      const removed = userPlayQueue.splice(index, 1)[0];
      updateQueueBadge();
      renderQueueDrawer();
      showToast(`Removed "${removed.title}" from Queue`, 'info');
    }
  }

  function clearUserQueue() {
    userPlayQueue = [];
    updateQueueBadge();
    renderQueueDrawer();
    showToast('Queue cleared', 'info');
  }

  function playQueueTrack(track) {
    if (!track) return;
    if (track.is_online || track.preview_url || !track.filename) {
      playOnlineTrack(track, [], -1);
    } else {
      const localIdx = librarySongs.findIndex(s => s.filename === track.filename);
      if (localIdx >= 0) {
        playTrack(localIdx);
      } else if (track.is_android_mediastore && track.file_path) {
        librarySongs.unshift(track);
        playTrack(0);
      } else {
        playOnlineTrack(track, [], -1);
      }
    }
    showToast(`Playing from Queue: ${track.title}`, 'info');
  }

  let draggedQueueIndex = null;

  function renderQueueDrawer() {
    if (!queueDrawer) return;

    // 1. Now Playing section
    if (queueNpTitle && queueNpArtist) {
      if (isOnlineStreaming && currentStreamingTrack) {
        queueNpTitle.textContent = currentStreamingTrack.title || 'Unknown Track';
        queueNpArtist.textContent = currentStreamingTrack.artist || 'Online Stream';
        if (queueNpCover) queueNpCover.src = currentStreamingTrack.cover_url || 'placeholder.svg';
      } else if (currentSongIndex >= 0 && librarySongs[currentSongIndex]) {
        const s = librarySongs[currentSongIndex];
        queueNpTitle.textContent = s.title || 'Unknown Track';
        queueNpArtist.textContent = s.artist || 'Unknown Artist';
        if (queueNpCover) {
          queueNpCover.src = s.cover_url || (s.filename ? resolveApiUrl(`/api/songs/artwork/${encodeURIComponent(s.filename)}`) : 'placeholder.svg');
        }
      } else {
        queueNpTitle.textContent = 'No track selected';
        queueNpArtist.textContent = 'Music Studio Engine';
        if (queueNpCover) queueNpCover.src = 'placeholder.svg';
      }
    }

    // 2. Next In Queue section (User's queue)
    if (queueUserList) {
      queueUserList.innerHTML = '';
      if (userPlayQueue.length === 0) {
        queueUserList.innerHTML = `<div class="queue-empty-msg">Queue is empty. Click "Add to Queue" on any track to line up your songs.</div>`;
      } else {
        userPlayQueue.forEach((track, idx) => {
          const item = document.createElement('div');
          item.className = 'queue-item';
          item.draggable = true;
          item.dataset.index = idx;

          const dur = (track.duration && track.duration > 0) ? formatSeconds(track.duration) : '--:--';
          const cover = track.cover_url || 'placeholder.svg';

          item.innerHTML = `
            <div class="queue-item-drag" title="Drag to reorder">
              <svg viewBox="0 0 24 24" width="16" height="16" fill="currentColor">
                <circle cx="9" cy="6" r="1.5"/><circle cx="15" cy="6" r="1.5"/>
                <circle cx="9" cy="12" r="1.5"/><circle cx="15" cy="12" r="1.5"/>
                <circle cx="9" cy="18" r="1.5"/><circle cx="15" cy="18" r="1.5"/>
              </svg>
            </div>
            <img src="${cover}" onerror="this.src='placeholder.svg'" class="queue-item-thumb" />
            <div class="queue-item-info">
              <div class="queue-item-title truncate" title="${escapeHtml(track.title)}">${escapeHtml(track.title)}</div>
              <div class="queue-item-artist truncate" title="${escapeHtml(track.artist)}">${escapeHtml(track.artist)}</div>
            </div>
            <span style="font-size: 0.78rem; color: var(--text-tertiary); font-family: var(--font-mono); margin-right: 4px;">${dur}</span>
            <button class="queue-item-remove" title="Remove from queue" data-idx="${idx}">&times;</button>
          `;

          // HTML5 Drag and Drop events
          item.addEventListener('dragstart', (e) => {
            draggedQueueIndex = idx;
            item.classList.add('dragging');
            e.dataTransfer.effectAllowed = 'move';
            e.dataTransfer.setData('text/plain', idx);
          });

          item.addEventListener('dragend', () => {
            item.classList.remove('dragging');
            document.querySelectorAll('.queue-item').forEach(el => el.classList.remove('drag-over'));
            draggedQueueIndex = null;
          });

          item.addEventListener('dragover', (e) => {
            e.preventDefault();
            e.dataTransfer.dropEffect = 'move';
            item.classList.add('drag-over');
          });

          item.addEventListener('dragleave', () => {
            item.classList.remove('drag-over');
          });

          item.addEventListener('drop', (e) => {
            e.preventDefault();
            item.classList.remove('drag-over');
            const fromIdx = draggedQueueIndex !== null ? draggedQueueIndex : parseInt(e.dataTransfer.getData('text/plain'), 10);
            const toIdx = idx;
            if (!isNaN(fromIdx) && fromIdx !== toIdx && fromIdx >= 0 && fromIdx < userPlayQueue.length) {
              const [moved] = userPlayQueue.splice(fromIdx, 1);
              userPlayQueue.splice(toIdx, 0, moved);
              updateQueueBadge();
              renderQueueDrawer();
            }
          });

          // Click remove button
          const removeBtn = item.querySelector('.queue-item-remove');
          if (removeBtn) {
            removeBtn.addEventListener('click', (e) => {
              e.stopPropagation();
              removeFromQueue(idx);
            });
          }

          // Double click to play immediately
          item.addEventListener('dblclick', () => {
            const [selected] = userPlayQueue.splice(idx, 1);
            updateQueueBadge();
            renderQueueDrawer();
            playQueueTrack(selected);
          });

          queueUserList.appendChild(item);
        });
      }
    }

    // 3. Next Up from Context
    if (queueContextList) {
      queueContextList.innerHTML = '';
      let upcoming = [];
      if (isOnlineStreaming && currentOnlineQueue && currentOnlineQueue.length > 0) {
        const start = currentOnlineQueueIndex + 1;
        upcoming = currentOnlineQueue.slice(start, start + 8);
      } else if (currentSongIndex >= 0 && librarySongs.length > 0) {
        upcoming = librarySongs.slice(currentSongIndex + 1, currentSongIndex + 9);
      }

      if (upcoming.length === 0) {
        queueContextList.innerHTML = `<div style="padding: 12px; font-size: 0.78rem; color: var(--text-tertiary); text-align: center;">End of playback context</div>`;
      } else {
        upcoming.forEach((track, uIdx) => {
          const uItem = document.createElement('div');
          uItem.className = 'queue-item';
          uItem.style.cursor = 'pointer';
          const dur = (track.duration && track.duration > 0) ? formatSeconds(track.duration) : '--:--';
          const cover = track.cover_url || (track.filename ? resolveApiUrl(`/api/songs/artwork/${encodeURIComponent(track.filename)}`) : 'placeholder.svg');

          uItem.innerHTML = `
            <span style="font-size: 0.75rem; color: var(--text-tertiary); min-width: 18px; text-align: center;">${uIdx + 1}</span>
            <img src="${cover}" onerror="this.src='placeholder.svg'" class="queue-item-thumb" />
            <div class="queue-item-info">
              <div class="queue-item-title truncate">${escapeHtml(track.title)}</div>
              <div class="queue-item-artist truncate">${escapeHtml(track.artist)}</div>
            </div>
            <span style="font-size: 0.78rem; color: var(--text-tertiary); font-family: var(--font-mono);">${dur}</span>
          `;

          uItem.addEventListener('click', () => {
            if (isOnlineStreaming) {
              const targetIdx = currentOnlineQueueIndex + 1 + uIdx;
              playOnlineTrack(track, currentOnlineQueue, targetIdx);
            } else {
              const targetIdx = currentSongIndex + 1 + uIdx;
              playTrack(targetIdx);
            }
          });

          queueContextList.appendChild(uItem);
        });
      }
    }
  }

  function toggleQueueDrawer(open) {
    if (!queueDrawer || !queueOverlay) return;
    const willOpen = open !== undefined ? open : !queueDrawer.classList.contains('is-open');
    if (willOpen) {
      renderQueueDrawer();
      queueDrawer.classList.add('is-open');
      queueOverlay.classList.add('is-open');
    } else {
      queueDrawer.classList.remove('is-open');
      queueOverlay.classList.remove('is-open');
    }
  }

  // ==================== STATE PERSISTENCE LOGIC ====================
  let lastStateSaveTime = 0;
  function saveCurrentPlaybackState(force = false) {
    const now = Date.now();
    if (!force && now - lastStateSaveTime < 1000) return;
    lastStateSaveTime = now;

    let trackInfo = null;
    if (isOnlineStreaming && currentStreamingTrack) {
      trackInfo = {
        isOnline: true,
        title: currentStreamingTrack.title,
        artist: currentStreamingTrack.artist,
        album: currentStreamingTrack.album || 'Online Stream',
        duration: currentStreamingTrack.duration || (audioEngine.duration && isFinite(audioEngine.duration) ? audioEngine.duration : 0),
        cover_url: currentStreamingTrack.cover_url || 'placeholder.svg',
        preview_url: currentStreamingTrack.preview_url || '',
        query: currentStreamingTrack.query || '',
        time: (audioEngine.currentTime && isFinite(audioEngine.currentTime)) ? audioEngine.currentTime : 0,
        was_playing: !audioEngine.paused,
        is_shuffle: isShuffle,
        repeat_mode: repeatMode
      };
    } else if (currentSongIndex >= 0 && librarySongs[currentSongIndex]) {
      const s = librarySongs[currentSongIndex];
      trackInfo = {
        isOnline: false,
        filename: s.filename,
        file_path: s.file_path,
        is_android_mediastore: s.is_android_mediastore,
        title: s.title,
        artist: s.artist,
        album: s.album,
        duration: s.duration || (audioEngine.duration && isFinite(audioEngine.duration) ? audioEngine.duration : 0),
        cover_url: s.cover_url || '',
        time: (audioEngine.currentTime && isFinite(audioEngine.currentTime)) ? audioEngine.currentTime : 0,
        was_playing: !audioEngine.paused,
        is_shuffle: isShuffle,
        repeat_mode: repeatMode
      };
    }

    if (trackInfo) {
      try {
        localStorage.setItem('musicstudio_last_played', JSON.stringify(trackInfo));
      } catch (e) {}
    }
  }

  function reconcileRestoredPlaybackWithLibrary() {
    try {
      const saved = localStorage.getItem('musicstudio_last_played');
      if (!saved) return;
      const data = JSON.parse(saved);
      if (!data || !data.title) return;

      if (!data.isOnline && librarySongs && librarySongs.length > 0) {
        let matchIdx = -1;
        if (data.filename) {
          matchIdx = librarySongs.findIndex(s => s.filename === data.filename);
        }
        if (matchIdx === -1 && data.title) {
          const tLower = (data.title || '').toLowerCase();
          const aLower = (data.artist || '').toLowerCase();
          matchIdx = librarySongs.findIndex(s =>
            (s.title || '').toLowerCase() === tLower &&
            (!aLower || (s.artist || '').toLowerCase() === aLower)
          );
        }
        if (matchIdx >= 0) {
          currentSongIndex = matchIdx;
          highlightPlayingRow();
          if (isShuffle) {
            generateShuffleQueue(currentSongIndex);
          }
        }
      }
    } catch (e) {}
  }

  function restoreLastPlaybackState() {
    try {
      const saved = localStorage.getItem('musicstudio_last_played');
      if (!saved) return;
      const data = JSON.parse(saved);
      if (!data || !data.title) return;

      const dur = data.duration || 0;
      const pos = data.time || 0;
      const cover = data.cover_url || (data.filename ? resolveApiUrl(`/api/songs/artwork/${encodeURIComponent(data.filename)}`) : 'placeholder.svg');

      playerTitle.textContent = data.title;
      playerArtist.textContent = data.artist || 'Music Studio';
      playerCover.src = cover;
      playerTotalTime.textContent = dur ? formatSeconds(dur) : '--:--';
      playerCurrentTime.textContent = formatSeconds(pos);

      if (dur > 0) {
        const pct = Math.max(0, Math.min((pos / dur) * 100, 100));
        playerScrubber.value = pct;
        updateScrubberFill(pct);
      }

      // Sync Fullscreen Overlay
      if (fsCover) fsCover.src = cover;
      if (fsTitle) fsTitle.textContent = data.title;
      if (fsArtist) fsArtist.textContent = data.artist || 'Music Studio';
      if (fsAlbum) fsAlbum.textContent = data.album || '';
      if (fsTotalTime) fsTotalTime.textContent = dur ? formatSeconds(dur) : '--:--';
      if (fsCurrentTime) fsCurrentTime.textContent = formatSeconds(pos);
      if (fsScrubber && dur > 0) {
        const pct = Math.max(0, Math.min((pos / dur) * 100, 100));
        fsScrubber.value = pct;
        updateFsScrubberFill(pct);
      }

      // Sync MediaSession & MacNotch HUD
      setupMediaSession({
        title: data.title,
        artist: data.artist || 'Music Studio',
        album: data.album || '',
        artwork_url: cover,
        duration: dur
      });
      updateNotchHUD({
        title: data.title,
        artist: data.artist || 'Music Studio',
        artwork_url: cover,
        duration: dur
      });

      if (data.isOnline) {
        currentStreamingTrack = data;
        isOnlineStreaming = true;
        currentSongIndex = -1;
        const query = data.query || `${data.title} ${data.artist}`;
        const streamEndpoint = resolveApiUrl(`/api/stream?q=${encodeURIComponent(query)}`);

        if (data.preview_url && data.preview_url.startsWith('http') && pos < 27.5) {
          audioEngine.dataset.streamMode = 'preview';
          audioEngine.dataset.streamFullEndpoint = streamEndpoint;
          audioEngine.dataset.streamQuery = query;
          audioEngine.src = data.preview_url;
        } else {
          audioEngine.dataset.streamMode = 'full';
          delete audioEngine.dataset.streamFullEndpoint;
          delete audioEngine.dataset.streamQuery;
          audioEngine.src = streamEndpoint;
        }
      } else if (data.is_android_mediastore && data.file_path) {
        audioEngine.src = (window.Capacitor && window.Capacitor.convertFileSrc) ? window.Capacitor.convertFileSrc(data.file_path) : data.file_path;
      } else if (data.filename) {
        const localIdx = librarySongs.findIndex(s => s.filename === data.filename);
        if (localIdx >= 0) {
          currentSongIndex = localIdx;
          highlightPlayingRow();
        }
        audioEngine.src = resolveApiUrl(`/api/songs/audio/${encodeURIComponent(data.filename)}`);
      }

      if (audioEngine.src) {
        try {
          audioEngine.load();
        } catch (e) {}
      }

      // Reliably seek to exact position once audio metadata is available
      if (pos > 0) {
        const applySeek = () => {
          try {
            audioEngine.currentTime = pos;
          } catch (e) {}
          audioEngine.removeEventListener('loadedmetadata', applySeek);
        };
        audioEngine.addEventListener('loadedmetadata', applySeek);
        try {
          audioEngine.currentTime = pos;
        } catch (e) {}
      }

      // Restore shuffle queue and UI
      if (isShuffle) {
        if (currentSongIndex >= 0) {
          generateShuffleQueue(currentSongIndex);
        } else {
          generateShuffleQueue();
        }
        updateShuffleUI();
      }
      if (repeatMode !== 'off') {
        updateRepeatUI();
      }

      // If song was actively playing when closed, auto-resume playback!
      if (data.was_playing) {
        isPlaying = true;
        updatePlayIcon(true);
        const playPromise = audioEngine.play();
        if (playPromise !== undefined) {
          playPromise.catch(() => {
            isPlaying = false;
            updatePlayIcon(false);
          });
        }
      } else {
        isPlaying = false;
        updatePlayIcon(false);
      }
    } catch (e) {
      console.warn('Error restoring playback state:', e);
    }
  }

  // Synchronously save state when closing or hiding window/app
  window.addEventListener('beforeunload', () => {
    saveCurrentPlaybackState(true);
  });
  window.addEventListener('pagehide', () => {
    saveCurrentPlaybackState(true);
  });
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'hidden') {
      saveCurrentPlaybackState(true);
    }
  });


  // ==================== ANDROID NATIVE INTEGRATION ====================
  // AirPods, Bluetooth headset, and Home Screen Widget Controls
  window.androidMediaControl = function(action) {
    console.log('[Android Native Media Control]:', action);
    if (action === 'play') {
      if (audioEngine.paused) togglePlay();
    } else if (action === 'pause') {
      if (!audioEngine.paused) togglePlay();
    } else if (action === 'toggle' || action === 'play_pause') {
      togglePlay();
    } else if (action === 'next') {
      playNextTrack();
    } else if (action === 'prev' || action === 'previous') {
      playPrevTrack();
    } else if (action === 'shuffle') {
      isShuffle = !isShuffle;
      localStorage.setItem('musicstudio_shuffle', isShuffle ? 'true' : 'false');
      generateShuffleQueue(currentSongIndex);
      updateShuffleUI();
      broadcastPlaybackState();
      showToast(isShuffle ? 'Shuffle: On' : 'Shuffle: Off', 'info');
    }
  };

  // Android File Opener (ACTION_VIEW from Files, WhatsApp, Downloads, etc.)
  window.onAndroidOpenFile = function(songData) {
    try {
      const song = typeof songData === 'string' ? JSON.parse(songData) : songData;
      if (!song) return;
      const existingIdx = rawLibrarySongs.findIndex(s =>
        (s.content_uri && s.content_uri === song.content_uri) ||
        (s.file_path && s.file_path === song.file_path)
      );
      if (existingIdx !== -1) {
        currentSongIndex = existingIdx;
        playTrack(existingIdx);
      } else {
        rawLibrarySongs.unshift(song);
        applySortAndFilter();
        playTrack(0);
      }
      showToast(`Playing: ${song.title || 'Audio File'}`, 'success');
    } catch (e) {
      console.error('Error handling opened Android audio file:', e);
    }
  };

  // Default Music Player Settings & First-Run Prompt
  const btnSetDefaultPlayer = document.getElementById('btn-set-default-player');
  const settingCardDefaultPlayer = document.getElementById('setting-card-default-player');
  if (window.AndroidMusicScanner && settingCardDefaultPlayer) {
    settingCardDefaultPlayer.style.display = 'block';
  }
  if (btnSetDefaultPlayer) {
    btnSetDefaultPlayer.addEventListener('click', () => {
      if (window.AndroidMusicScanner && typeof window.AndroidMusicScanner.openDefaultAppsSettings === 'function') {
        window.AndroidMusicScanner.openDefaultAppsSettings();
      } else {
        showToast('Only available when running on Android device', 'info');
      }
    });
  }

  // Lock Screen Album Art Settings
  const settingCardLockscreenArt = document.getElementById('setting-card-lockscreen-art');
  const settingToggleLockscreenArt = document.getElementById('setting-toggle-lockscreen-art');
  if (window.AndroidMusicScanner && settingCardLockscreenArt) {
    settingCardLockscreenArt.style.display = 'block';
    const savedLockscreen = localStorage.getItem('musicstudio_lockscreen_wallpaper');
    if (savedLockscreen !== null && settingToggleLockscreenArt) {
      const isEn = savedLockscreen === 'true';
      settingToggleLockscreenArt.checked = isEn;
      if (typeof window.AndroidMusicScanner.setLockscreenWallpaperEnabled === 'function') {
        window.AndroidMusicScanner.setLockscreenWallpaperEnabled(isEn);
      }
    }
  }
  if (settingToggleLockscreenArt) {
    settingToggleLockscreenArt.addEventListener('change', (e) => {
      const enabled = e.target.checked;
      localStorage.setItem('musicstudio_lockscreen_wallpaper', enabled ? 'true' : 'false');
      if (window.AndroidMusicScanner && typeof window.AndroidMusicScanner.setLockscreenWallpaperEnabled === 'function') {
        window.AndroidMusicScanner.setLockscreenWallpaperEnabled(enabled);
      }
      showToast('Lock Screen Cover Art: ' + (enabled ? 'Enabled' : 'Disabled'), 'info');
    });
  }

  function checkAndroidDefaultPlayerPrompt() {
    if (!window.AndroidMusicScanner) return;
    if (localStorage.getItem('musicstudio_default_player_prompted') === 'true') return;

    setTimeout(() => {
      if (document.getElementById('default-player-banner')) return;
      const banner = document.createElement('div');
      banner.id = 'default-player-banner';
      banner.className = 'default-player-prompt-banner';
      banner.innerHTML = `
        <div class="default-player-prompt-content">
          <div class="default-player-prompt-icon">🎵</div>
          <div class="default-player-prompt-text">
            <strong>Set as Default Music Player?</strong>
            <span>Tap to make Music Studio your phone's default player for audio files.</span>
          </div>
        </div>
        <div class="default-player-prompt-actions">
          <button id="btn-prompt-set-default" class="prompt-btn primary">Set as Default</button>
          <button id="btn-prompt-dismiss-default" class="prompt-btn secondary">Not Now</button>
        </div>
      `;
      document.body.appendChild(banner);

      document.getElementById('btn-prompt-set-default')?.addEventListener('click', () => {
        localStorage.setItem('musicstudio_default_player_prompted', 'true');
        banner.remove();
        if (typeof window.AndroidMusicScanner.openDefaultAppsSettings === 'function') {
          window.AndroidMusicScanner.openDefaultAppsSettings();
        }
      });

      document.getElementById('btn-prompt-dismiss-default')?.addEventListener('click', () => {
        localStorage.setItem('musicstudio_default_player_prompted', 'true');
        banner.remove();
      });
    }, 2000);
  }
  checkAndroidDefaultPlayerPrompt();

  // Initial Load
  initOfflineDetection();
  initEventStream();
  loadExplore();
  loadLibrary();
  loadUserPlaylists();
  handleHash();
  updateShuffleUI();
  updateRepeatUI();
  updateScrubberFill(0);
});

