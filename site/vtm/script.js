(() => {
  const root = document.documentElement;
  const motionButton = document.querySelector('.motion-button');
  const menu = document.querySelector('.menu');
  const preference = matchMedia('(prefers-reduced-motion: reduce)');
  const desktop = matchMedia('(min-width: 1000px)');
  const chapters = [...document.querySelectorAll('[data-chapter]')];
  const steps = [...document.querySelectorAll('[data-scene]')];
  const navigation = [...document.querySelectorAll('nav a[href^="#"]')];
  const images = [...document.querySelectorAll('.scene-image')];
  const symbol = document.querySelector('.scene-symbol');
  const stageTitle = document.querySelector('.scene-title');
  const stageSubtitle = document.querySelector('.scene-subtitle');
  const counter = document.querySelector('.scene-counter');
  const kicker = document.querySelector('.scene-kicker');
  const credit = document.querySelector('.scene-credit');
  const story = document.querySelector('.narrative');
  const assets = {
    rain: { author: 'Josh Hild', link: 'https://unsplash.com/photos/a-person-walks-across-a-wet-street-in-the-rain-TBd0-kgIaC8', alt: 'Одинокий прохожий на мокрой городской улице ночью' },
    street: { author: 'Josh Hild', link: 'https://unsplash.com/photos/rainy-city-street-at-night-with-bright-lights-coam-W6_tK0', alt: 'Свет фар на дождливой ночной улице' },
    cathedral: { author: 'Chris Dreyer', link: 'https://unsplash.com/photos/a-large-cathedral-with-chandeliers-hanging-from-the-ceiling-hWxHFDtiE1s', alt: 'Готический интерьер с высокими колоннами и люстрами' },
    camera: { author: 'Justus Menke', link: 'https://unsplash.com/photos/white-security-camera-beside-wall-EGRUT40HNlQ', alt: 'Камера наблюдения на углу здания' }
  };
  let manuallyDisabled = false;
  try { manuallyDisabled = localStorage.getItem('vtm-motion') === 'off'; } catch {}
  let motionDisabled = false;
  let activeStep = null;
  let activeImage = 'rain';
  let currentLayer = 0;
  let imageRequest = 0;
  let scheduled = false;

  function updateMotion() {
    motionDisabled = preference.matches || manuallyDisabled;
    root.classList.toggle('motion-enabled', !motionDisabled);
    root.classList.toggle('motion-off', motionDisabled);
    motionButton.hidden = false;
    motionButton.disabled = preference.matches;
    motionButton.textContent = motionDisabled ? 'Анимация: выкл' : 'Анимация: вкл';
    motionButton.setAttribute('aria-pressed', String(motionDisabled));
    motionButton.title = preference.matches ? 'Движение отключено настройкой устройства' : motionDisabled ? 'Включить движение иллюстраций' : 'Отключить движение иллюстраций';
    schedule();
  }

  async function changeImage(name) {
    if (name === activeImage) return;
    activeImage = name;
    const request = ++imageRequest;
    const nextLayer = 1 - currentLayer;
    const target = images[nextLayer];
    target.src = `assets/photos/${name}.webp`;
    try { await target.decode(); } catch { return; }
    if (request !== imageRequest) return;
    images[currentLayer].classList.remove('is-current');
    images[currentLayer].alt = '';
    images[currentLayer].setAttribute('aria-hidden', 'true');
    target.alt = assets[name].alt;
    target.removeAttribute('aria-hidden');
    target.classList.add('is-current');
    currentLayer = nextLayer;
    credit.href = assets[name].link;
    credit.textContent = `Фото: ${assets[name].author} / Unsplash`;
  }

  function setScene(step) {
    if (step === activeStep) return;
    activeStep = step;
    const chapter = step.closest('[data-chapter]');
    const scene = chapter.dataset;
    const heading = chapter.querySelector('h2').innerText.replace(/\s+/g, ' ').trim();
    const number = scene.chapter.padStart(2, '0');
    root.dataset.activeChapter = chapter.id;
    root.dataset.activeScene = step.id || chapter.id;
    stageTitle.textContent = step.dataset.sceneLabel || scene.sceneLabel;
    stageSubtitle.textContent = step === chapter ? scene.sceneSubtitle : (chapter.id === 'clans' ? 'Твоя кровь — не только твоя история.' : 'За обещаниями стоит чужая воля.');
    counter.textContent = `${number} / 09`;
    kicker.textContent = heading;
    const emblem = step.dataset.sceneSymbol || scene.sceneSymbol;
    symbol.hidden = !emblem;
    if (emblem) symbol.src = `assets/vtm/${emblem}.svg`;
    navigation.forEach(link => {
      if (link.hash === `#${chapter.id}`) link.setAttribute('aria-current', 'location');
      else link.removeAttribute('aria-current');
    });
    if (desktop.matches) changeImage(scene.image);
  }

  function render() {
    scheduled = false;
    const line = innerHeight * .43;
    let chosen = steps[0];
    for (const step of steps) {
      if (step.getBoundingClientRect().top <= line) chosen = step;
      else break;
    }
    setScene(chosen);
    const start = scrollY + story.getBoundingClientRect().top - 90;
    const total = Math.max(1, story.offsetHeight - innerHeight + 90);
    const progress = Math.max(0, Math.min(1, (scrollY - start) / total));
    root.style.setProperty('--reading-progress', progress.toFixed(4));
    const chapter = chosen.closest('[data-chapter]');
    const pan = motionDisabled || !desktop.matches ? 0 : Math.max(-10, Math.min(10, -chapter.getBoundingClientRect().top / innerHeight * 9));
    root.style.setProperty('--scene-pan', `${pan.toFixed(2)}px`);
  }

  function schedule() {
    if (scheduled) return;
    scheduled = true;
    requestAnimationFrame(render);
  }

  motionButton.addEventListener('click', () => {
    manuallyDisabled = !manuallyDisabled;
    try { localStorage.setItem('vtm-motion', manuallyDisabled ? 'off' : 'on'); } catch {}
    updateMotion();
  });
  navigation.forEach(link => link.addEventListener('click', () => { menu.open = false; }));
  document.addEventListener('keydown', event => {
    if (event.key === 'Escape' && menu.open) { menu.open = false; menu.querySelector('summary').focus(); }
  });
  document.addEventListener('click', event => {
    if (menu.open && !menu.contains(event.target)) menu.open = false;
  });
  preference.addEventListener('change', updateMotion);
  desktop.addEventListener('change', () => {
    if (desktop.matches && activeStep) changeImage(activeStep.closest('[data-chapter]').dataset.image);
    schedule();
  });
  addEventListener('scroll', schedule, { passive: true });
  addEventListener('resize', schedule, { passive: true });
  addEventListener('load', schedule);
  document.fonts?.ready.then(schedule);
  root.classList.add('story-ready');
  updateMotion();
})();

(() => {
  const triggers = [...document.querySelectorAll('.term')];
  let active = null;
  let closeTimer = null;

  function isOpen(popup) {
    return typeof popup.showPopover === 'function' ? popup.matches(':popover-open') : popup.classList.contains('is-open');
  }

  function close() {
    clearTimeout(closeTimer);
    if (!active) return;
    const { trigger, popup } = active;
    active = null;
    trigger.setAttribute('aria-expanded', 'false');
    if (typeof popup.hidePopover === 'function') {
      if (isOpen(popup)) popup.hidePopover();
    } else popup.classList.remove('is-open');
  }

  function position() {
    if (!active) return;
    const { trigger, popup } = active;
    const anchor = trigger.getBoundingClientRect();
    if (anchor.bottom < 0 || anchor.top > innerHeight) { close(); return; }
    const box = popup.getBoundingClientRect();
    const left = Math.max(14, Math.min(innerWidth - box.width - 14, anchor.left + anchor.width / 2 - box.width / 2));
    let top = anchor.bottom + 10;
    if (top + box.height > innerHeight - 14) top = anchor.top - box.height - 10;
    top = Math.max(14, Math.min(top, innerHeight - box.height - 14));
    popup.style.setProperty('--popover-left', `${left}px`);
    popup.style.setProperty('--popover-top', `${top}px`);
    popup.dataset.positioned = '';
  }

  function open(trigger, pinned = false) {
    clearTimeout(closeTimer);
    if (active?.trigger === trigger) {
      active.pinned ||= pinned;
      position();
      return;
    }
    close();
    const popup = document.getElementById(trigger.getAttribute('popovertarget'));
    active = { trigger, popup, pinned };
    if (typeof popup.showPopover === 'function') popup.showPopover();
    else popup.classList.add('is-open');
    trigger.setAttribute('aria-expanded', 'true');
    position();
  }

  function scheduleClose() {
    clearTimeout(closeTimer);
    if (!active || active.pinned || document.activeElement === active.trigger) return;
    closeTimer = setTimeout(close, 180);
  }

  triggers.forEach(trigger => {
    const popup = document.getElementById(trigger.getAttribute('popovertarget'));
    trigger.setAttribute('aria-expanded', 'false');
    trigger.addEventListener('pointerenter', event => { if (event.pointerType !== 'touch') open(trigger); });
    trigger.addEventListener('pointerleave', scheduleClose);
    trigger.addEventListener('focus', () => open(trigger));
    trigger.addEventListener('blur', () => {
      if (active?.trigger === trigger && !popup.matches(':hover')) close();
    });
    trigger.addEventListener('click', event => {
      event.preventDefault();
      if (active?.trigger === trigger && active.pinned) close();
      else open(trigger, true);
    });
    popup.addEventListener('pointerenter', () => clearTimeout(closeTimer));
    popup.addEventListener('pointerleave', scheduleClose);
    popup.addEventListener('toggle', event => {
      if (event.newState === 'closed' && active?.popup === popup) {
        active.trigger.setAttribute('aria-expanded', 'false');
        active = null;
      }
    });
  });
  document.addEventListener('keydown', event => { if (event.key === 'Escape') close(); });
  document.addEventListener('click', event => {
    if (active && !active.trigger.contains(event.target) && !active.popup.contains(event.target)) close();
  });
  addEventListener('scroll', position, { passive: true });
  addEventListener('resize', position, { passive: true });
})();
