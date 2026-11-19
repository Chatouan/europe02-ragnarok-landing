'use strict';

// TAF2 platform token; replacement in HTML AND JavaScript must be checked in AFBooster.
const CONVERSION_DESTINATION = '#go2offer#';
function setupConversionLinks(root) {
  root.querySelectorAll('a.conversion-link').forEach(link => {
    link.setAttribute('href', CONVERSION_DESTINATION);
    link.setAttribute('target', '_blank');
    link.setAttribute('rel', 'noopener noreferrer');
  });
}

// All players claim the same slot before play(): a pending play is also exclusive.
function createMediaArbiter() {
  let owner = null;
  return {
    claim(next) {
      if (owner === next) return;
      const previous = owner;
      owner = next;
      if (previous) previous.stop();
    },
    release(entry) { if (owner === entry) owner = null; },
    owns(entry) { return owner === entry; }
  };
}

function createGalleryClock({ delay, setTimer, clearTimer, advance }) {
  let timer = null;
  let running = false;
  function cancel() { if (timer !== null) clearTimer(timer); timer = null; }
  function schedule() {
    cancel();
    if (!running) return;
    timer = setTimer(async () => {
      timer = null;
      await advance();
      if (running) schedule();
    }, delay);
  }
  return { setRunning(value) { running = value; schedule(); }, stop() { running = false; cancel(); } };
}

function setupMedia(root, env = window) {
  const variant = env.matchMedia('(max-width: 767px)').matches ? 'mobile' : 'desktop';
  const motion = env.matchMedia('(prefers-reduced-motion: reduce)');
  const connection = navigator.connection || navigator.mozConnection || navigator.webkitConnection;
  const limited = () => motion.matches || !!(connection && (connection.saveData || /^(slow-2g|2g|3g)$/.test(connection.effectiveType)));
  const arbiter = createMediaArbiter();
  let sequence = 0;
  let languageLayoutChanging = false;
  let languagePlaybackHold = false;
  let legalOpen = false;
  const states = [];
  const containers = Array.from(root.querySelectorAll('[data-video-base]'));
  containers.forEach(node => {
    if (node.dataset.mediaAvailable === 'false') return;
    const video = node.querySelector('video');
    const poster = node.querySelector('.video-poster');
    const play = node.querySelector('[data-play]');
    const sound = node.querySelector('[data-sound]');
    const volume = node.querySelector('[data-volume]');
    const status = node.querySelector('[data-media-status]');
    const controls = node.querySelector('[data-media-controls]');
    const hero = node.classList.contains('hero');
    const state = { node, video, ratio: 0, near: false, ready: !!poster.complete, attached: false,
      paused: false, failed: false, manual: false, priority: 0, loading: false, token: 0, timer: null };
    const say = (key, fallback = '') => {
      if (!status) return;
      if (key) setLocalizedText(status, key, fallback);
      else { status.textContent = ''; delete status.dataset.i18n; }
    };
    const update = () => {
      const paused = video.paused && !state.loading;
      setLocalizedAttribute(play, 'aria-label', hero ? (paused ? 'playVideo' : 'pauseVideo') : (paused ? 'playScene' : 'pauseScene'), hero ? (paused ? 'Play video' : 'Pause video') : (paused ? 'Play scene' : 'Pause scene'));
      const playIcon = play.querySelector('[data-play-icon]');
      if (playIcon) playIcon.src = paused ? 'assets/icons/play-fill.svg' : 'assets/icons/pause-fill.svg';
      if (sound) {
        const muted = video.muted || video.volume === 0;
        setLocalizedAttribute(sound, 'aria-label', muted ? 'soundOn' : 'soundOff', muted ? 'Sound on' : 'Sound off');
        const soundIcon = sound.querySelector('[data-sound-icon]');
        if (soundIcon) soundIcon.src = muted ? 'assets/icons/sound-off.svg' : 'assets/icons/sound-on.svg';
      }
    };
    state.stop = () => {
      state.token++;
      state.loading = false;
      env.clearTimeout(state.timer);
      video.pause();
      video.muted = true;
      state.manual = false;
      state.priority = 0;
      node.dataset.frame = 'false';
      if (state.attached) {
        state.attached = false;
        video.removeAttribute('src');
        video.load(); // Request cancellation as well as pause; actual transfers need browser verification.
      }
      arbiter.release(state);
      update();
    };
    state.start = async () => {
      if (state.loading || (!video.paused && arbiter.owns(state))) return;
      arbiter.claim(state);
      const token = ++state.token;
      state.loading = true;
      if (!state.attached) {
        state.attached = true;
        video.src = `assets/videos/optimized/${node.dataset.videoBase}-${variant}.mp4`;
        video.load();
      }
      say('mediaLoading', 'Loading video…');
      update();
      state.timer = env.setTimeout(() => {
        if (token !== state.token || !state.loading) return;
        state.stop(); state.failed = true;
        say('mediaRetry', 'Still preview. Select Play to retry the scene.');
      }, 12000);
      try {
        await video.play();
        if (token !== state.token) return;
        if (root.hidden || (!languageLayoutChanging && state.ratio <= 0) || !arbiter.owns(state)) { state.stop(); return; }
        say('');
      } catch (error) {
        if (token !== state.token) return;
        state.stop(); state.failed = true;
        say(error.name === 'NotAllowedError' ? 'mediaBlocked' : 'mediaFailed', error.name === 'NotAllowedError' ? 'Select Play to start the scene.' : 'Video unavailable. The still preview is shown. Select Play to retry.');
      } finally {
        if (token === state.token) { state.loading = false; env.clearTimeout(state.timer); }
        update();
      }
    };
    const request = () => {
      languagePlaybackHold = false;
      state.paused = false; state.failed = false; state.manual = true; state.priority = ++sequence;
      refresh();
    };
    video.muted = true;
    video.volume = 0.5;
    video.addEventListener('playing', () => {
      if (!arbiter.owns(state) || root.hidden || (!languageLayoutChanging && state.ratio <= 0)) { state.stop(); return; }
      node.dataset.frame = 'true'; say(''); update();
    });
    video.addEventListener('pause', update);
    video.addEventListener('volumechange', update);
    video.addEventListener('error', () => {
      if (!state.attached) return;
      state.stop(); state.failed = true;
      say('mediaFailed', 'Video unavailable. The still preview is shown. Select Play to retry.');
    });
    play.addEventListener('click', () => {
      if (!video.paused || state.loading) {
        state.paused = true; state.stop(); say('mediaPaused', 'Video paused.'); refresh();
      } else { video.muted = true; request(); }
    });
    if (sound) sound.addEventListener('click', () => {
      if (!video.muted && video.volume > 0) { video.muted = true; }
      else {
        if (video.volume === 0) { video.volume = 0.5; if (volume) volume.value = '0.5'; }
        video.muted = false; // An explicit Sound gesture is the only route to audible playback.
        request();
      }
      update();
    });
    if (volume) volume.addEventListener('input', () => {
      video.volume = Number(volume.value);
      if (video.volume === 0) video.muted = true;
      update();
    });
    const posterReady = () => { state.ready = true; refresh(); };
    if (!poster.complete) { poster.addEventListener('load', posterReady, { once: true }); poster.addEventListener('error', posterReady, { once: true }); }
    if (controls) controls.hidden = false;
    if (limited()) say('mediaStill', 'Still preview. Select Play to watch.');
    update(); states.push(state);
  });
  function refresh() {
    if (languageLayoutChanging) return;
    if (legalOpen || root.hidden) { states.forEach(state => state.stop()); return; }
    if (languagePlaybackHold) return;
    const candidates = states.filter(state => state.near && state.ratio > 0 && !state.paused && !state.failed && (state.ready || state.manual) && (!limited() || state.manual));
    candidates.sort((a,b) => b.priority - a.priority || b.ratio - a.ratio);
    const chosen = candidates[0];
    states.forEach(state => { if (state !== chosen && (state.attached || state.loading || !state.video.paused)) state.stop(); });
    if (chosen) chosen.start();
  }
  if ('IntersectionObserver' in env) {
    const near = new env.IntersectionObserver(entries => {
      entries.forEach(entry => { const state = states.find(s => s.node === entry.target); state.near = entry.isIntersecting; });
      refresh();
    }, { rootMargin: '200px 0px' });
    const visible = new env.IntersectionObserver(entries => {
      entries.forEach(entry => {
        const state = states.find(s => s.node === entry.target);
        state.ratio = entry.isIntersecting ? entry.intersectionRatio : 0;
        if (!languageLayoutChanging && !state.ratio && (state.attached || state.loading)) state.stop();
      });
      refresh();
    }, { threshold: [0, .1, .25, .5, .75, 1] });
    states.forEach(state => { near.observe(state.node); visible.observe(state.node); });
  } else {
    // No observer: calculate visibility and keep all distant sources unattached.
    const measure = () => {
      states.forEach(state => {
        const r = state.node.getBoundingClientRect();
        state.near = r.bottom > -200 && r.top < scrollViewportHeight(root, env) + 200;
        state.ratio = Math.max(0, Math.min(r.bottom, scrollViewportHeight(root, env)) - Math.max(r.top,0)) / Math.max(r.height,1);
      }); refresh();
    };
    scrollEventTarget(root, env).addEventListener('scroll', measure, { passive: true }); env.addEventListener('resize', measure); measure();
  }
  root.addEventListener('legalmodalchange', event => { legalOpen = event.detail.open; refresh(); });
  root.addEventListener('languagewillchange', () => { languageLayoutChanging = true; languagePlaybackHold = true; });
  root.addEventListener('languagechange', () => { languageLayoutChanging = false; });
  const releaseLanguageHold = event => {
    if (!languagePlaybackHold || languageLayoutChanging) return;
    if (event.target && event.target.closest && event.target.closest('.locale-picker')) return;
    languagePlaybackHold = false;
    refresh();
  };
  ['wheel','touchmove','pointerdown','keydown'].forEach(type => root.addEventListener(type, releaseLanguageHold, { passive: true }));
  const changed = () => { states.forEach(state => state.stop()); refresh(); };
  root.addEventListener('visibilitychange', () => { if (root.hidden) changed(); else refresh(); });
  env.addEventListener('pagehide', () => states.forEach(state => state.stop()));
  env.addEventListener('pageshow', refresh);
  if (motion.addEventListener) motion.addEventListener('change', changed); else motion.addListener(changed);
  if (connection && connection.addEventListener) connection.addEventListener('change', changed);
  return { states, refresh, arbiter };
}

function setupGallery(root, env = window, options = {}) {
  const gallery = root.getElementById(options.id || 'steam-gallery');
  if (!gallery) return;
  const slides = Array.from(gallery.querySelectorAll('.gallery-slide'));
  const previous = gallery.querySelector('[data-gallery-prev]');
  const next = gallery.querySelector('[data-gallery-next]');
  const toggle = gallery.querySelector('[data-gallery-pause]');
  const icon = toggle.querySelector('[data-gallery-icon]');
  let keyboardMode = false, keyboardHeld = false, legalOpen = false;
  const motion = env.matchMedia('(prefers-reduced-motion: reduce)');
  const desktop = options.desktopOnly ? env.matchMedia('(min-width: 1024px)') : null;
  const enabled = () => !desktop || desktop.matches;
  const connection = navigator.connection;
  const variant = env.matchMedia('(max-width: 767px)').matches ? 'mobile' : 'desktop';
  let index = 0, paused = false, visible = false, request = 0, fadeTimer = null, pointer = null, swiped = false;
  const limited = () => motion.matches || !!(connection && (connection.saveData || /^(slow-2g|2g|3g)$/.test(connection.effectiveType)));
  const clock = createGalleryClock({ delay: options.delay || 2000, setTimer: env.setTimeout.bind(env), clearTimer: env.clearTimeout.bind(env), advance: () => show(index + 1, false) });
  function sync() {
    if (visible && enabled() && !root.hidden) {
      const currentImage = slides[index].querySelector('img');
      if (!currentImage.getAttribute('src')) currentImage.src = currentImage.dataset[variant];
    }
    toggle.disabled = limited();
    const stopped = paused || limited();
    setLocalizedAttribute(toggle, 'aria-label', limited() ? 'autoOff' : stopped ? 'resumeGallery' : 'pauseGallery', limited() ? 'Auto rotation off' : stopped ? 'Resume slideshow' : 'Pause slideshow');
    if (icon) icon.src = stopped ? 'assets/icons/play-fill.svg' : 'assets/icons/pause-fill.svg';
    clock.setRunning(!legalOpen && !paused && !keyboardHeld && !pointer && !limited() && enabled() && visible && !root.hidden);
  }
  async function show(target, manual = true) {
    if (!enabled()) return;
    if (manual) clock.stop();
    const targetIndex = (target + slides.length) % slides.length;
    if (targetIndex === index) { if (manual) sync(); return; }
    const ticket = ++request;
    const image = slides[targetIndex].querySelector('img');
    if (!image.getAttribute('src')) image.src = image.dataset[variant];
    if (!image.complete) await new Promise(resolve => {
      const loaded = () => { image.removeEventListener('load', loaded); image.removeEventListener('error', loaded); resolve(); };
      image.addEventListener('load', loaded); image.addEventListener('error', loaded);
    });
    if (ticket !== request) return;
    if (!image.naturalWidth || (!manual && (paused || keyboardHeld || pointer || !enabled() || !visible || root.hidden || limited()))) { if (manual) sync(); return; }
    env.clearTimeout(fadeTimer);
    const old = slides[index];
    const restoreFocus = manual && old.contains(root.activeElement);
    slides.forEach((slide,i) => {
      if (i !== index && i !== targetIndex) { slide.hidden = true; slide.classList.remove('is-active','is-leaving'); }
    });
    const fresh = slides[targetIndex];
    fresh.hidden = false; fresh.classList.remove('is-leaving'); fresh.setAttribute('aria-hidden','false'); fresh.querySelector('[data-gallery-steam]').tabIndex = 0;
    old.setAttribute('aria-hidden','true'); old.querySelector('[data-gallery-steam]').tabIndex = -1;
    old.classList.remove('is-active'); old.classList.add('is-leaving');
    env.requestAnimationFrame(() => { if (index === targetIndex) fresh.classList.add('is-active'); });
    index = targetIndex;
    if (restoreFocus) fresh.querySelector('[data-gallery-steam]').focus({ preventScroll: true });
    fadeTimer = env.setTimeout(() => { old.hidden = true; old.classList.remove('is-leaving'); }, motion.matches ? 0 : 450);
    if (manual) sync();
  }
  previous.addEventListener('click', () => show(index - 1)); next.addEventListener('click', () => show(index + 1));
  toggle.addEventListener('click', () => { paused = !paused; if (paused) request++; sync(); });
  root.addEventListener('keydown', event => {
    if (event.key === 'Tab') keyboardMode = true;
  }, true);
  gallery.addEventListener('pointerdown', () => { keyboardMode = false; keyboardHeld = false; sync(); }, true);
  gallery.addEventListener('focusin', () => { if (keyboardMode) { keyboardHeld = true; request++; sync(); } });
  gallery.addEventListener('focusout', event => {
    if (!gallery.contains(event.relatedTarget)) { keyboardHeld = false; sync(); }
  });
  // Hover and mouse movement never pause the slideshow.
  gallery.addEventListener('keydown', event => {
    if (['Tab','ArrowLeft','ArrowRight','Enter',' '].includes(event.key)) { keyboardMode = true; keyboardHeld = true; sync(); }
    if (event.key === 'ArrowLeft' || event.key === 'ArrowRight') { event.preventDefault(); show(index + (event.key === 'ArrowRight' ? 1 : -1)); }
  });
  slides.forEach(slide => {
    const photo = slide.querySelector('[data-gallery-steam]');
    photo.addEventListener('click', event => {
      if (event.defaultPrevented || swiped) return;
      env.open(CONVERSION_DESTINATION, '_blank', 'noopener,noreferrer');
    });
  });
  const stage = gallery.querySelector('.gallery-stage');
  stage.addEventListener('pointerdown', event => { if (event.isPrimary && event.pointerType !== 'mouse') { pointer = { x:event.clientX, y:event.clientY }; request++; sync(); } });
  stage.addEventListener('pointercancel', () => { pointer = null; sync(); });
  stage.addEventListener('pointerup', event => {
    if (!pointer) return;
    const x=event.clientX-pointer.x,y=event.clientY-pointer.y; pointer=null;
    if (Math.abs(x)>45 && Math.abs(x)>Math.abs(y)*1.2) {
      swiped=true; event.preventDefault(); show(index + (x<0 ? 1 : -1));
      env.setTimeout(() => { swiped=false; },400);
    }
    sync();
  });
  stage.addEventListener('click', event => { if (swiped) { event.preventDefault(); swiped=false; } }, true);
  const gallerySection = gallery;
  if ('IntersectionObserver' in env) new env.IntersectionObserver(entries => { visible=entries[0].isIntersecting; sync(); }, { threshold: 0 }).observe(gallerySection);
  else {
    const measure=()=>{const r=gallerySection.getBoundingClientRect();visible=r.bottom>0&&r.top<scrollViewportHeight(root, env);sync();};
    scrollEventTarget(root, env).addEventListener('scroll',measure,{passive:true});env.addEventListener('resize',measure);measure();
  }
  root.addEventListener('visibilitychange',sync);
  root.addEventListener('legalmodalchange',event=>{legalOpen=event.detail.open;request++;sync();});
  env.addEventListener('pagehide',()=>clock.stop()); env.addEventListener('pageshow',sync);
  const preferences=()=>{request++;sync();};
  if(motion.addEventListener)motion.addEventListener('change',preferences);else motion.addListener(preferences);
  if(connection&&connection.addEventListener)connection.addEventListener('change',preferences);
  if (desktop) {
    if (desktop.addEventListener) desktop.addEventListener('change', preferences); else desktop.addListener(preferences);
  }
  gallery.querySelector('.gallery-controls').hidden=false;
  sync();
  return { show, sync };
}

function setupNavigation(root) {
  setupClassesAnchorNavigation(root);
  const menu = root.querySelector('.menu');
  if (menu) {
    menu.addEventListener('keydown', event => { if (event.key === 'Escape') { menu.open=false; menu.querySelector('summary').focus(); } });
    menu.querySelectorAll('a').forEach(link=>link.addEventListener('click',()=>{menu.open=false;}));
    root.addEventListener('click',event=>{if(menu.open&&!menu.contains(event.target))menu.open=false;});
  }
  const picker=root.getElementById('class-picker');
  if(!picker)return;
  const buttons=Array.from(picker.querySelectorAll('button'));
  const profiles=buttons.map(button=>root.getElementById(button.getAttribute('aria-controls')));
  function select(button){buttons.forEach((candidate,i)=>{
    const active=candidate===button;candidate.setAttribute('aria-pressed',String(active));profiles[i].hidden=!active;
    if(active){const image=profiles[i].querySelector('img');if(image.dataset.src&&!image.getAttribute('src'))image.src=image.dataset.src;}
  });}
  buttons.forEach(button=>button.addEventListener('click',()=>select(button)));select(buttons[0]);picker.hidden=false;
}

if (typeof document !== 'undefined') {
  setupConversionLinks(document);
  setupLanguage(document);
  setupNavigation(document);
  setupConversionDock(document);
  setupMobileSectionSnap(document);
  setupDesktopPanels(document);
  setupMedia(document);
  setupGallery(document);
  setupGallery(document, window, { id: 'classes-gallery', delay: 1500, desktopOnly: true });
  setupConversionHalos(document);
  setupLegalDialogs(document);
}


function scrollEventTarget(root, env) {
  return (root.getElementById && root.getElementById('page-viewport')) || env;
}
function scrollViewportHeight(root, env) {
  const viewport = root.getElementById && root.getElementById('page-viewport');
  return viewport ? viewport.clientHeight : env.innerHeight;
}
function conversionDockVisible({ heroVisible, secondReached, finalVisible, footerVisible, documentHidden }) {
  return secondReached && !heroVisible && !finalVisible && !footerVisible && !documentHidden;
}
function setupConversionDock(root, env = window) {
  const dock = root.getElementById('conversion-dock');
  const page = root.getElementById('page-viewport');
  const hero = root.getElementById('hero');
  const second = root.getElementById('discover');
  const final = root.querySelector('.final-cta');
  const footer = root.querySelector('.site-footer');
  if (!dock || !page || !hero || !second || !final || !footer) return;
  dock.hidden = true;
  root.body.classList.add('has-conversion-dock');
  root.body.dataset.dockVisible = 'false';
  let shown = false;
  let scheduled = false;
  let reservedSpace = '';
  const panelMobile = env.matchMedia('(max-width: 767px), (max-width: 1023px) and (max-height: 500px) and (pointer: coarse)');
  const panelDesktop = env.matchMedia('(min-width: 1024px)');
  function reserveSpace() {
    if (!shown && !panelMobile.matches && !panelDesktop.matches) return;
    // Measure hidden controls too: panel layouts retain a stable rail throughout the page.
    const wasHidden = dock.hidden;
    const previousVisibility = dock.style ? dock.style.visibility : '';
    if (wasHidden) { if (dock.style) dock.style.visibility = 'hidden'; dock.hidden = false; }
    const rect = dock.getBoundingClientRect();
    if (wasHidden) { dock.hidden = true; if (dock.style) dock.style.visibility = previousVisibility; }
    // The scroll viewport ends above the fixed bar/button, including safe-area/bottom offsets.
    const space = panelMobile.matches ? Math.ceil(rect.height + 8) : Math.ceil(env.innerHeight - rect.top + 8);
    const reserved = `${Math.max(space, rect.height)}px`;
    if (reserved !== reservedSpace) {
      reservedSpace = reserved;
      page.dataset.sectionSnap = 'off';
      root.body.style.setProperty('--conversion-space', reserved);
    }
  }
  function update() {
    const bounds = page.getBoundingClientRect();
    const inView = element => { const r = element.getBoundingClientRect(); return r.bottom > bounds.top && r.top < bounds.bottom; };
    const secondRect = second.getBoundingClientRect();
    const next = conversionDockVisible({ heroVisible: inView(hero), secondReached: secondRect.top < bounds.bottom,
      finalVisible: inView(final), footerVisible: inView(footer), documentHidden: root.hidden });
    if (next !== shown) {
      shown = next;
      dock.hidden = !shown;
      root.body.dataset.dockVisible = String(shown);
      if (shown) {
        reserveSpace();
      } else {
        if (dock.contains(root.activeElement)) {
          const target = inView(final) ? final.querySelector('a') : inView(footer) ? footer.querySelector('a') : page;
          if (target) target.focus({ preventScroll: true });
        }
      }
    } else if (shown || panelMobile.matches || panelDesktop.matches) reserveSpace();
  }
  function queue() {
    if (scheduled) return;
    scheduled = true;
    env.requestAnimationFrame(() => { scheduled = false; update(); });
  }
  page.addEventListener('scroll', queue, { passive: true });
  env.addEventListener('resize', queue);
  env.addEventListener('pageshow', queue);
  root.addEventListener('visibilitychange', queue);
  if ('ResizeObserver' in env) {
    const observer = new env.ResizeObserver(queue);
    [dock, page, hero, second, final, footer].forEach(element => observer.observe(element));
  }
  update();
  return { update, reserveSpace };
}


function languageText(key, fallback = '') {
  return globalThis.RagnarokI18n ? globalThis.RagnarokI18n.text(key) : fallback;
}
function setLocalizedText(node, key, fallback) {
  node.dataset.i18n = key;
  node.textContent = languageText(key, fallback);
}
function setLocalizedAttribute(node, attribute, key, fallback) {
  node.setAttribute(`data-i18n-${attribute}`, key);
  node.setAttribute(attribute, languageText(key, fallback));
}
function completeLocales(dictionaries) {
  const keys = Object.keys(dictionaries.en || {});
  return Object.keys(dictionaries).filter(locale => {
    const values = dictionaries[locale];
    return keys.length > 0 && Object.keys(values).length === keys.length && keys.every(key => {
      if (typeof values[key] !== 'string' || !values[key].trim()) return false;
      const tokens = text => (text.match(/\{[a-zA-Z]+\}/g) || []).sort().join(',');
      return tokens(values[key]) === tokens(dictionaries.en[key]);
    });
  });
}
function canonicalLocale(value, available) {
  const base = String(value || '').toLowerCase().replace(/_/g,'-').split('-')[0];
  const alias = base === 'tl' ? 'fil' : base === 'in' ? 'id' : base;
  return available.includes(alias) ? alias : null;
}
function preferredLocale(stored, browserLanguages, available) {
  const manual = canonicalLocale(stored, available);
  if (manual) return manual;
  for (const language of browserLanguages) {
    const supported = canonicalLocale(language, available);
    if (supported) return supported;
  }
  return available.includes('en') ? 'en' : available[0];
}
function setupLanguage(root, env = window, dictionaries = globalThis.RagnarokLocales) {
  const select = root.getElementById('language-select');
  if (!select || !dictionaries) return;
  const available = completeLocales(dictionaries);
  if (!available.includes('en')) return;
  Array.from(select.options).forEach(option => { if (!available.includes(option.value)) option.remove(); });
  const storageKey = 'ragnarok.language';
  let stored = null;
  try { stored = env.localStorage.getItem(storageKey); } catch (_) { /* Storage is optional. */ }
  const browserLanguages = env.navigator.languages && env.navigator.languages.length ? env.navigator.languages : [env.navigator.language || 'en'];
  let current = preferredLocale(stored, browserLanguages, available);
  let revision = 0;
  const parameters = node => { try { return JSON.parse(node.getAttribute('data-i18n-params') || '{}'); } catch (_) { return {}; } };
  function text(key, params = {}) {
    const value = dictionaries[current][key];
    if (typeof value !== 'string') return '';
    return value.replace(/\{([a-zA-Z]+)\}/g, (match, name) => Object.prototype.hasOwnProperty.call(params,name) ? String(params[name]) : match);
  }
  function translateNodes() {
    root.documentElement.lang = current;
    root.querySelectorAll('[data-i18n]').forEach(node => { node.textContent = text(node.dataset.i18n, parameters(node)); });
    for (const attribute of ['aria-label','aria-roledescription','alt','content']) {
      root.querySelectorAll(`[data-i18n-${attribute}]`).forEach(node => {
        node.setAttribute(attribute,text(node.getAttribute(`data-i18n-${attribute}`),parameters(node)));
      });
    }
    select.value = current;
  }
  const event = name => root.dispatchEvent(new env.CustomEvent(name, { detail: { locale: current } }));
  function snapshotPosition() {
    const page = root.getElementById('page-viewport');
    const target = page || root.scrollingElement;
    const snapshot = { target, top: target.scrollTop, left: target.scrollLeft, anchor: null, anchorTop: null };
    if (page && root.elementFromPoint) {
      const bounds = page.getBoundingClientRect();
      const hit = root.elementFromPoint(bounds.left + Math.min(bounds.width / 2,100), bounds.top + 24);
      if (hit && page.contains(hit) && hit.closest) {
        let anchor = hit.closest('p,h1,h2,h3,figure,article,li,summary,section');
        if (anchor && anchor.closest('.gallery-slide,.media-status')) anchor = hit.closest('section');
        if (anchor && !anchor.closest('.hero-media,.ambient-picture')) { snapshot.anchor = anchor; snapshot.anchorTop = anchor.getBoundingClientRect().top; }
      }
    }
    return snapshot;
  }
  function restorePosition(snapshot) {
    const delta = snapshot.anchor && snapshot.anchor.isConnected ? snapshot.anchor.getBoundingClientRect().top - snapshot.anchorTop : 0;
    // Direct properties avoid smooth-scroll animation during a locale swap.
    snapshot.target.scrollTop = snapshot.top + delta;
    snapshot.target.scrollLeft = snapshot.left;
  }
  function setLanguage(value, manual = false) {
    const next = canonicalLocale(value, available);
    if (!next) return false;
    if (manual) { try { env.localStorage.setItem(storageKey,next); } catch (_) { /* Text still changes if storage is blocked. */ } }
    if (next === current) { select.value = current; return true; }
    const ticket = ++revision;
    const snapshot = snapshotPosition();
    event('languagewillchange');
    current = next;
    translateNodes();
    restorePosition(snapshot);
    const finish = () => env.requestAnimationFrame(() => env.requestAnimationFrame(() => {
      if (ticket !== revision) return;
      restorePosition(snapshot);
      event('languagechange');
    }));
    // Localized fonts may alter line metrics; wait before the final anchor restoration.
    if (root.fonts && root.fonts.load) {
      const family = next === 'th' ? 'NotoThai' : next === 'en' ? 'Chiron' : 'NotoLatin';
      Promise.all([root.fonts.load(`400 16px ${family}`),root.fonts.load(`600 16px ${family}`)]).then(finish,finish);
    } else if (root.fonts && root.fonts.ready) root.fonts.ready.then(finish,finish); else finish();
    return true;
  }
  globalThis.RagnarokI18n = { text, setLanguage, get locale() { return current; }, available };
  translateNodes();
  const picker = select.closest('label');
  if (picker) picker.hidden = false;
  select.addEventListener('change', () => setLanguage(select.value,true));
  return globalThis.RagnarokI18n;
}


// Native mobile panels: observe layout only, never drive or intercept scrolling.
function setupMobileSectionSnap(root, env = window) {
  const page = root.getElementById('page-viewport');
  if (!page) return;
  const mobile = env.matchMedia('(max-width: 767px), (max-width: 1023px) and (max-height: 500px) and (pointer: coarse)');
  const reduced = env.matchMedia('(prefers-reduced-motion: reduce)');
  const panels = Array.from(page.querySelectorAll('.mobile-panel,.site-footer'));
  let scheduled = false;
  function inspect() {
    scheduled = false;
    const height = page.clientHeight;
    const zoomed = env.visualViewport && env.visualViewport.scale > 1.05;
    const overflow = panels.some(panel => panel.getBoundingClientRect().height > height + 2);
    page.dataset.panelOverflow = String(!!zoomed || overflow);
    page.dataset.panelSnap = mobile.matches && !reduced.matches ? 'on' : 'off';
  }
  function queue() {
    if (scheduled) return;
    scheduled = true;
    env.requestAnimationFrame(inspect);
  }
  root.addEventListener('languagewillchange', () => { page.dataset.panelLayout = 'changing'; });
  root.addEventListener('languagechange', () => { inspect(); /* Keep natural scrolling until user resumes. */ });
  page.addEventListener('touchstart', () => { delete page.dataset.panelLayout; }, { passive: true });
  page.addEventListener('wheel', () => { delete page.dataset.panelLayout; }, { passive: true });
  page.addEventListener('toggle', () => { page.dataset.panelLayout = 'changing'; queue(); }, true);
  page.addEventListener('keydown', event => {
    if (['ArrowDown','ArrowUp','PageDown','PageUp','Home','End'].includes(event.key)) delete page.dataset.panelLayout;
  });
  env.addEventListener('resize', queue);
  if (env.visualViewport) env.visualViewport.addEventListener('resize', queue);
  for (const query of [mobile,reduced]) {
    if (query.addEventListener) query.addEventListener('change', queue); else query.addListener(queue);
  }
  if ('ResizeObserver' in env) {
    const observer = new env.ResizeObserver(queue);
    [page,...panels].forEach(panel => observer.observe(panel));
  }
  if (root.fonts && root.fonts.ready) root.fonts.ready.then(queue);
  inspect();
}


// Animate only a visible conversion halo, never the button geometry.
function setupConversionHalos(root, env = window) {
  const targets = Array.from(root.querySelectorAll('a.conversion-link'));
  const reduced = env.matchMedia('(prefers-reduced-motion: reduce)');
  const visible = new Map(targets.map(target => [target, false]));
  let legalOpen = false;
  function sync() {
    targets.forEach(target => {
      target.dataset.haloActive = String(!legalOpen && !root.hidden && !reduced.matches && visible.get(target));
    });
  }
  if ('IntersectionObserver' in env) {
    const observer = new env.IntersectionObserver(entries => {
      entries.forEach(entry => visible.set(entry.target, entry.isIntersecting && entry.intersectionRatio > 0));
      sync();
    }, { threshold: [0, .1] });
    targets.forEach(target => observer.observe(target));
  } else {
    // Conservative fallback: leave a static halo without a visibility observer.
    sync();
  }
  root.addEventListener('visibilitychange', sync);
  root.addEventListener('legalmodalchange', event => { legalOpen = event.detail.open; sync(); });
  if (reduced.addEventListener) reduced.addEventListener('change', sync); else reduced.addListener(sync);
  sync();
}


// Desktop sizing/safety only. Native CSS owns all scroll and snap behavior.
function setupDesktopPanels(root, env = window) {
  const page = root.getElementById('page-viewport');
  if (!page) return;
  const desktop = env.matchMedia('(min-width: 1024px)');
  const reduced = env.matchMedia('(prefers-reduced-motion: reduce)');
  const panels = Array.from(page.querySelectorAll('.desktop-panel'));
  const header = root.querySelector('.site-header');
  let queued = false;
  function inspect() {
    queued = false;
    if (!desktop.matches) { page.dataset.desktopSnap = 'off'; return; }
    // Header is absolute inside the Hero, not a persistent overlay: reserve it only there.
    if (header) page.style.setProperty('--desktop-nav-height', `${Math.ceil(header.getBoundingClientRect().height)}px`);
    const height = page.clientHeight;
    page.style.setProperty('--desktop-panel-height', `${height}px`);
    const overflow = panels.some(panel => panel.getBoundingClientRect().height > height + 2);
    const zoomed = !!(env.visualViewport && env.visualViewport.scale > 1.05);
    const expanded = !!page.querySelector('.faq details[open]');
    page.dataset.desktopSnap = !reduced.matches && !overflow && !zoomed && !expanded ? 'on' : 'off';
  }
  function queue() {
    if (queued) return;
    queued = true;
    env.requestAnimationFrame(inspect);
  }
  root.addEventListener('languagewillchange', () => { page.dataset.desktopLayout = 'changing'; });
  root.addEventListener('languagechange', () => { inspect(); });
  // A real navigation gesture releases the locale/layout hold without moving the page.
  page.addEventListener('wheel', () => { delete page.dataset.desktopLayout; }, { passive: true });
  page.addEventListener('touchstart', () => { delete page.dataset.desktopLayout; }, { passive: true });
  page.addEventListener('keydown', event => {
    if (['ArrowDown','ArrowUp','PageDown','PageUp','Home','End','Tab'].includes(event.key)) delete page.dataset.desktopLayout;
  });
  page.addEventListener('click', event => {
    if (event.target.closest('summary')) page.dataset.desktopLayout = 'changing';
  }, true);
  page.addEventListener('toggle', () => { page.dataset.desktopLayout = 'changing'; queue(); }, true);
  env.addEventListener('resize', queue);
  if (env.visualViewport) env.visualViewport.addEventListener('resize', queue);
  for (const query of [desktop,reduced]) {
    if (query.addEventListener) query.addEventListener('change', queue); else query.addListener(queue);
  }
  if ('ResizeObserver' in env) {
    const observer = new env.ResizeObserver(queue);
    [page,...panels,...(header ? [header] : [])].forEach(panel => observer.observe(panel));
  }
  if (root.fonts && root.fonts.ready) root.fonts.ready.then(queue);
  inspect();
}


// Native modal top layer supplies the focus trap/inert background; no external content.
function setupLegalDialogs(root, env = window) {
  const dialog = root.getElementById('legal-dialog');
  const page = root.getElementById('page-viewport');
  if (!dialog || !page) return;
  const titles = { privacy:'legalPrivacy',identity:'legalIdentity',cookies:'legalCookies',terms:'legalTerms' };
  const heading = root.getElementById('legal-title');
  const close = dialog.querySelector('[data-legal-close]');
  let opener = null, position = null;
  const announce = open => root.dispatchEvent(new env.CustomEvent('legalmodalchange', { detail:{open} }));
  function finish() {
    if (!position) return;
    // Snap remains suspended until the next real navigation gesture.
    page.dataset.desktopLayout = 'changing';page.dataset.panelLayout = 'changing';
    page.scrollTop = position.top;page.scrollLeft = position.left;
    if (opener && opener.isConnected !== false) opener.focus({preventScroll:true});
    page.dataset.legalOpen = 'false';
    position = null;opener = null;announce(false);
  }
  function open(kind, button) {
    if (!titles[kind] || dialog.open || typeof dialog.showModal !== 'function') return;
    opener = button;position = {top:page.scrollTop,left:page.scrollLeft};
    page.dataset.legalOpen = 'true';page.dataset.desktopLayout = 'changing';page.dataset.panelLayout = 'changing';
    dialog.querySelectorAll('[data-legal-pane]').forEach(pane => {pane.hidden = pane.dataset.legalPane !== kind;});
    setLocalizedText(heading,titles[kind],titles[kind]);
    dialog.showModal();dialog.scrollTop = 0;close.focus({preventScroll:true});announce(true);
  }
  root.querySelectorAll('[data-legal-open]').forEach(button => button.addEventListener('click',() => open(button.dataset.legalOpen,button)));
  close.addEventListener('click',() => dialog.close());
  dialog.addEventListener('cancel',event => {event.preventDefault();dialog.close();});
  dialog.addEventListener('close',finish);
  return {open,finish};
}


// Explicit anchor activation only: scroll the real reading viewport, never intercept gestures.
function setupClassesAnchorNavigation(root, env = globalThis.window) {
  const page = root.getElementById('page-viewport');
  const target = root.getElementById('classes');
  if (!page || !target || !env) return;
  let revision = 0;
  function cancel() { revision++; delete page.dataset.anchorNavigation; }
  function align() {
    const y = page.scrollTop + target.getBoundingClientRect().top - page.getBoundingClientRect().top - (page.clientTop || 0);
    // Instant navigation also respects reduced-motion and avoids snap/smooth-scroll competition.
    page.scrollTo({ top: Math.max(0,y), behavior:'auto' });
  }
  root.querySelectorAll('a[href="#classes"]').forEach(link => link.addEventListener('click', event => {
    if (event.defaultPrevented || event.ctrlKey || event.metaKey || event.shiftKey || event.altKey || event.button > 0) return;
    event.preventDefault();
    const ticket = ++revision;
    page.dataset.anchorNavigation = 'classes';
    align();target.focus({preventScroll:true});
    try { if (env.location.hash !== '#classes') env.history.pushState(null,'','#classes'); } catch (_) { /* Navigation still works without history access. */ }
    const finish = () => env.requestAnimationFrame(() => env.requestAnimationFrame(() => {
      if (ticket !== revision) return;
      align();delete page.dataset.anchorNavigation;
    }));
    if (root.fonts && root.fonts.ready) root.fonts.ready.then(finish,finish); else finish();
  }));
  page.addEventListener('wheel',cancel,{passive:true});
  page.addEventListener('touchstart',cancel,{passive:true});
  page.addEventListener('keydown',event => { if (['Tab','ArrowDown','ArrowUp','PageDown','PageUp','Home','End','Escape'].includes(event.key)) cancel(); });
}
