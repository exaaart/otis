import { directions, services, faq, timeSlots } from './data.js';

const $ = (s, root = document) => root.querySelector(s);
const $$ = (s, root = document) => [...root.querySelectorAll(s)];
const reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
const dirById = Object.fromEntries(directions.map((d) => [d.id, d]));
const serviceById = Object.fromEntries(services.map((s) => [s.id, s]));

const plural = (n, [one, few, many]) => {
  const m10 = n % 10;
  const m100 = n % 100;
  if (m10 === 1 && m100 !== 11) return one;
  if (m10 >= 2 && m10 <= 4 && (m100 < 10 || m100 >= 20)) return few;
  return many;
};
const icon = (d) =>
  `<svg class="ico" viewBox="0 0 24 24" aria-hidden="true"><path d="${d}"/></svg>`;

/* ---------- Плавный переход для изменений интерфейса ---------- */
function transition(fn) {
  if (!reduceMotion && document.startViewTransition) document.startViewTransition(fn);
  else fn();
}

/* ---------- Hero: единая анимация появления ---------- */
requestAnimationFrame(() => document.body.classList.add('is-ready'));

/* ---------- Шапка, меню, scrollspy ---------- */
const header = $('#header');
const onScroll = () => header.classList.toggle('is-scrolled', window.scrollY > 8);
onScroll();
window.addEventListener('scroll', onScroll, { passive: true });

const burger = $('.burger');
const menu = $('#mobileMenu');
function setMenu(open) {
  burger.setAttribute('aria-expanded', String(open));
  burger.setAttribute('aria-label', open ? 'Закрыть меню' : 'Открыть меню');
  document.body.classList.toggle('menu-open', open);
  if (open) {
    menu.hidden = false;
    requestAnimationFrame(() => menu.classList.add('is-open'));
    $('a', menu)?.focus({ preventScroll: true });
  } else {
    menu.classList.remove('is-open');
    const hide = () => (menu.hidden = true);
    reduceMotion ? hide() : setTimeout(hide, 280);
  }
}
burger.addEventListener('click', () => setMenu(burger.getAttribute('aria-expanded') !== 'true'));
menu.addEventListener('click', (e) => e.target.closest('a') && setMenu(false));
document.addEventListener('keydown', (e) => {
  if (e.key === 'Escape' && burger.getAttribute('aria-expanded') === 'true') {
    setMenu(false);
    burger.focus();
  }
});
window.matchMedia('(min-width: 1101px)').addEventListener('change', (e) => e.matches && setMenu(false));

const navLinks = $$('.nav__list a');
const spy = new IntersectionObserver(
  (entries) => {
    entries.forEach((entry) => {
      if (!entry.isIntersecting) return;
      const id = entry.target.id;
      navLinks.forEach((a) => {
        const on = a.getAttribute('href') === `#${id}`;
        a.classList.toggle('is-active', on);
        on ? a.setAttribute('aria-current', 'true') : a.removeAttribute('aria-current');
      });
    });
  },
  { rootMargin: '-45% 0px -50% 0px' }
);
$$('main section[id]').forEach((s) => spy.observe(s));

/* ---------- Фото: заглушка, если файла нет ---------- */
$$('.photo').forEach((fig) => {
  const img = $('img', fig);
  const markEmpty = () => fig.classList.add('is-empty');
  const markLoaded = () => fig.classList.add('is-loaded');
  if (!img) return markEmpty();
  if (img.complete) img.naturalWidth ? markLoaded() : markEmpty();
  img.addEventListener('error', markEmpty);
  img.addEventListener('load', markLoaded);
});

/* ---------- Направления ---------- */
const counts = services.reduce((acc, s) => ((acc[s.direction] = (acc[s.direction] || 0) + 1), acc), {});
$('#directionsGrid').innerHTML = directions
  .map(
    (d) => `
    <li class="dir">
      <button type="button" class="dir__btn" data-direction="${d.id}">
        ${icon(d.icon)}
        <span class="dir__title">${d.title}</span>
        <span class="dir__text">${d.text}</span>
        <span class="dir__more">${counts[d.id] || 0} ${plural(counts[d.id] || 0, ['услуга', 'услуги', 'услуг'])}</span>
      </button>
    </li>`
  )
  .join('');

/* ---------- Фильтр и карточки услуг ---------- */
let currentFilter = 'all';
const filtersEl = $('#serviceFilters');
filtersEl.innerHTML = [{ id: 'all', title: 'Все услуги' }, ...directions]
  .map(
    (d) => `<li><button type="button" class="chip" data-filter="${d.id}" aria-pressed="${d.id === 'all'}">${d.title}</button></li>`
  )
  .join('');

const grid = $('#serviceGrid');
grid.innerHTML = services
  .map(
    (s) => `
    <li class="svc" data-dir="${s.direction}" style="view-transition-name: svc-${s.id}">
      <p class="svc__dir">${dirById[s.direction].title}</p>
      <h3 class="svc__title">${s.title}</h3>
      <p class="svc__text">${s.short}</p>
      <div class="svc__actions">
        <button type="button" class="btn btn--ghost btn--sm" data-details="${s.id}">Подробнее</button>
        <button type="button" class="link" data-book="${s.id}">Записаться</button>
      </div>
    </li>`
  )
  .join('');

function applyFilter(id) {
  currentFilter = id;
  $$('.chip', filtersEl).forEach((c) => c.setAttribute('aria-pressed', String(c.dataset.filter === id)));
  let n = 0;
  $$('.svc', grid).forEach((card) => {
    const show = id === 'all' || card.dataset.dir === id;
    card.hidden = !show;
    if (show) n++;
  });
  $('#servicesCount').textContent =
    id === 'all'
      ? `${n} ${plural(n, ['услуга', 'услуги', 'услуг'])} в ${directions.length} направлениях`
      : `${dirById[id].title}: ${n} ${plural(n, ['услуга', 'услуги', 'услуг'])}`;
}
applyFilter('all');

filtersEl.addEventListener('click', (e) => {
  const chip = e.target.closest('.chip');
  if (chip && chip.dataset.filter !== currentFilter) transition(() => applyFilter(chip.dataset.filter));
});

$('#directionsGrid').addEventListener('click', (e) => {
  const btn = e.target.closest('[data-direction]');
  if (!btn) return;
  applyFilter(btn.dataset.direction);
  $('#services').scrollIntoView({ behavior: reduceMotion ? 'auto' : 'smooth' });
  // Переводим фокус на активный фильтр, чтобы клавиатурный пользователь не потерялся.
  setTimeout(() => $(`.chip[data-filter="${btn.dataset.direction}"]`)?.focus({ preventScroll: true }), reduceMotion ? 0 : 600);
});

/* ---------- Подробности услуги ---------- */
const drawer = $('#serviceDrawer');
let drawerService = null;
let drawerOpener = null;
function openDrawer(id, opener) {
  const s = serviceById[id];
  if (!s) return;
  drawerService = s;
  drawerOpener = opener;
  $('#drawerDir').textContent = dirById[s.direction].title;
  $('#drawerTitle').textContent = s.title;
  $('#drawerShort').textContent = s.short;
  $('#drawerWhen').innerHTML = s.when.map((w) => `<li>${w}</li>`).join('');
  $('#drawerSteps').innerHTML = s.steps.map((w) => `<li>${w}</li>`).join('');
  $('#drawerVisits').textContent = s.visits;
  drawer.showModal();
  document.body.classList.add('drawer-open');
}
function closeDrawer() {
  if (!drawer.open) return;
  drawer.classList.add('is-closing');
  const done = () => {
    drawer.classList.remove('is-closing');
    drawer.close();
  };
  reduceMotion ? done() : setTimeout(done, 240);
}
drawer.addEventListener('close', () => {
  document.body.classList.remove('drawer-open');
  drawerOpener?.focus({ preventScroll: true });
});
drawer.addEventListener('cancel', (e) => {
  e.preventDefault();
  closeDrawer();
});
drawer.addEventListener('click', (e) => {
  if (e.target === drawer || e.target.closest('[data-close]')) closeDrawer();
});
$('#drawerBook').addEventListener('click', () => {
  const id = drawerService?.id;
  drawerOpener = null;
  closeDrawer();
  setTimeout(() => bookService(id), reduceMotion ? 0 : 260);
});

document.addEventListener('click', (e) => {
  const details = e.target.closest('[data-details]');
  if (details) return openDrawer(details.dataset.details, details);
  const book = e.target.closest('[data-book]');
  if (book) {
    e.preventDefault();
    bookService(book.dataset.book);
  }
});

/* ---------- FAQ ---------- */
$('#faqList').innerHTML = faq
  .map(
    (f, i) => `
    <div class="acc">
      <h3 class="acc__h">
        <button type="button" class="acc__btn" id="faq-b${i}" aria-expanded="false" aria-controls="faq-p${i}">
          <span>${f.q}</span>
          <span class="acc__icon" aria-hidden="true"></span>
        </button>
      </h3>
      <div class="acc__panel" id="faq-p${i}" role="region" aria-labelledby="faq-b${i}">
        <div class="acc__inner"><p>${f.a}</p></div>
      </div>
    </div>`
  )
  .join('');
$('#faqList').addEventListener('click', (e) => {
  const btn = e.target.closest('.acc__btn');
  if (!btn) return;
  const open = btn.getAttribute('aria-expanded') !== 'true';
  btn.setAttribute('aria-expanded', String(open));
  btn.closest('.acc').classList.toggle('is-open', open);
});

/* ---------- Форма записи ---------- */
const form = $('#bookingForm');
const select = $('#fService');
select.innerHTML =
  `<option value="consult">Консультация — пока не знаю, что выбрать</option>` +
  directions
    .map(
      (d) =>
        `<optgroup label="${d.title}">${services
          .filter((s) => s.direction === d.id)
          .map((s) => `<option value="${s.id}">${s.title}</option>`)
          .join('')}</optgroup>`
    )
    .join('');

function bookService(id) {
  if (id && (serviceById[id] || id === 'consult')) select.value = id;
  const target = $('#booking');
  target.scrollIntoView({ behavior: reduceMotion ? 'auto' : 'smooth' });
  if (!$('#bookingDone').hidden) resetForm();
  select.classList.add('is-flash');
  setTimeout(() => select.classList.remove('is-flash'), 1400);
  setTimeout(() => select.focus({ preventScroll: true }), reduceMotion ? 0 : 650);
}

// Даты: ближайшие 14 дней, воскресенье — выходной.
const WD = ['Вс', 'Пн', 'Вт', 'Ср', 'Чт', 'Пт', 'Сб'];
const MONTHS = ['января', 'февраля', 'марта', 'апреля', 'мая', 'июня', 'июля', 'августа', 'сентября', 'октября', 'ноября', 'декабря'];
const MON_SHORT = ['янв', 'фев', 'мар', 'апр', 'мая', 'июн', 'июл', 'авг', 'сен', 'окт', 'ноя', 'дек'];
const days = [];
const today = new Date();
today.setHours(0, 0, 0, 0);
for (let i = 0; i < 14; i++) {
  const d = new Date(today);
  d.setDate(today.getDate() + i);
  days.push(d);
}
const dayPicker = $('#dayPicker');
dayPicker.innerHTML = days
  .map((d, i) => {
    const off = d.getDay() === 0;
    const label = i === 0 ? 'Сегодня' : i === 1 ? 'Завтра' : WD[d.getDay()];
    return `<button type="button" role="radio" class="day" data-i="${i}" aria-checked="false" ${off ? 'disabled aria-disabled="true"' : ''}
      aria-label="${label}, ${d.getDate()} ${MONTHS[d.getMonth()]}${off ? ', выходной' : ''}">
      <span class="day__wd">${label}</span>
      <span class="day__num">${d.getDate()}</span>
      <span class="day__mon">${off ? 'выходной' : MON_SHORT[d.getMonth()]}</span>
    </button>`;
  })
  .join('');

const slotPicker = $('#slotPicker');
slotPicker.innerHTML = timeSlots
  .map((t) => `<button type="button" role="radio" class="slot" data-time="${t}" aria-checked="false">${t}</button>`)
  .join('');

let chosenDay = null;
let chosenTime = null;

function radioGroup(container, selector, onPick) {
  const items = () => $$(selector, container).filter((b) => !b.disabled);
  function pick(btn, focus = false) {
    $$(selector, container).forEach((b) => {
      const on = b === btn;
      b.setAttribute('aria-checked', String(on));
      b.tabIndex = on ? 0 : -1;
    });
    if (focus) btn.focus();
    onPick(btn);
  }
  container.addEventListener('click', (e) => {
    const b = e.target.closest(selector);
    if (b && !b.disabled) pick(b);
  });
  container.addEventListener('keydown', (e) => {
    const list = items();
    const i = list.indexOf(document.activeElement);
    if (i < 0) return;
    const next = { ArrowRight: 1, ArrowDown: 1, ArrowLeft: -1, ArrowUp: -1 }[e.key];
    if (!next) return;
    e.preventDefault();
    pick(list[(i + next + list.length) % list.length], true);
  });
  return { pick, items };
}

const dayGroup = radioGroup(dayPicker, '.day', (b) => {
  chosenDay = days[+b.dataset.i];
  updateSlots();
});
const slotGroup = radioGroup(slotPicker, '.slot', (b) => {
  chosenTime = b.dataset.time;
  $('#fAnyTime').checked = false;
});

// Сегодня нельзя выбрать прошедшее время.
function updateSlots() {
  const now = new Date();
  const isToday = chosenDay && chosenDay.getTime() === today.getTime();
  $$('.slot', slotPicker).forEach((b) => {
    const [h, m] = b.dataset.time.split(':').map(Number);
    const past = isToday && h * 60 + m <= now.getHours() * 60 + now.getMinutes() + 60;
    b.disabled = past;
    if (past && b.getAttribute('aria-checked') === 'true') {
      b.setAttribute('aria-checked', 'false');
      chosenTime = null;
    }
  });
  const first = slotGroup.items()[0];
  $$('.slot', slotPicker).forEach((b) => (b.tabIndex = b.getAttribute('aria-checked') === 'true' || (!chosenTime && b === first) ? 0 : -1));
}

function initPickers() {
  chosenDay = null;
  chosenTime = null;
  const firstDay = dayGroup.items().find((b) => {
    const d = days[+b.dataset.i];
    // если сегодня поздно, начинаем с завтра
    return !(d.getTime() === today.getTime() && new Date().getHours() >= 18);
  });
  dayGroup.pick(firstDay);
  $$('.slot', slotPicker).forEach((b) => b.setAttribute('aria-checked', 'false'));
  updateSlots();
}
initPickers();

$('#fAnyTime').addEventListener('change', (e) => {
  if (e.target.checked) {
    chosenTime = null;
    $$('.slot', slotPicker).forEach((b) => b.setAttribute('aria-checked', 'false'));
  }
  slotPicker.classList.toggle('is-muted', e.target.checked);
});

// Маска телефона: +7 (XXX) XXX-XX-XX
const phone = $('#fPhone');
phone.addEventListener('input', () => {
  let digits = phone.value.replace(/\D/g, '');
  if (digits.startsWith('8')) digits = '7' + digits.slice(1);
  if (!digits.startsWith('7')) digits = '7' + digits;
  digits = digits.slice(0, 11);
  const p = digits.slice(1);
  let out = '+7';
  if (p.length) out += ' (' + p.slice(0, 3);
  if (p.length >= 3) out += ')';
  if (p.length > 3) out += ' ' + p.slice(3, 6);
  if (p.length > 6) out += '-' + p.slice(6, 8);
  if (p.length > 8) out += '-' + p.slice(8, 10);
  phone.value = digits.length > 1 ? out : '';
});

function setError(input, errorEl, msg) {
  errorEl.textContent = msg || '';
  input.setAttribute('aria-invalid', msg ? 'true' : 'false');
  if (msg) input.setAttribute('aria-describedby', errorEl.id);
  else input.removeAttribute('aria-describedby');
  input.closest('.field, .check')?.classList.toggle('has-error', !!msg);
}

function validate() {
  const name = $('#fName');
  const consent = $('#fConsent');
  const errors = [];
  const nameMsg = name.value.trim().length < 2 ? 'Введите имя — так администратор будет к вам обращаться.' : '';
  setError(name, $('#fNameError'), nameMsg);
  if (nameMsg) errors.push(name);

  const digits = phone.value.replace(/\D/g, '');
  const phoneMsg = digits.length !== 11 ? 'Введите номер полностью: 10 цифр после +7.' : '';
  setError(phone, $('#fPhoneError'), phoneMsg);
  if (phoneMsg) errors.push(phone);

  const consentMsg = consent.checked ? '' : 'Отметьте согласие, чтобы мы могли связаться с вами.';
  setError(consent, $('#fConsentError'), consentMsg);
  if (consentMsg) errors.push(consent);
  return errors;
}

['#fName', '#fPhone', '#fConsent'].forEach((s) =>
  $(s).addEventListener(s === '#fConsent' ? 'change' : 'blur', () => form.dataset.tried && validate())
);

form.addEventListener('submit', (e) => {
  e.preventDefault();
  form.dataset.tried = '1';
  const errors = validate();
  if (errors.length) {
    errors[0].focus();
    return;
  }
  const service = select.value === 'consult' ? 'консультацию' : `«${serviceById[select.value].title}»`;
  const date = chosenDay ? `${chosenDay.getDate()} ${MONTHS[chosenDay.getMonth()]}` : 'ближайший свободный день';
  const time = chosenTime ? `в ${chosenTime}` : 'в удобное время';
  $('#bookingSummary').textContent = `${$('#fName').value.trim()}, вы записываетесь на ${service}: ${date}, ${time}. Администратор перезвонит на номер ${phone.value}, чтобы подтвердить запись.`;
  transition(() => {
    form.hidden = true;
    $('#bookingDone').hidden = false;
  });
  $('#bookingDone').focus({ preventScroll: true });
});

function resetForm() {
  form.reset();
  delete form.dataset.tried;
  ['#fName', '#fPhone', '#fConsent'].forEach((s) => setError($(s), $(s + 'Error'), ''));
  slotPicker.classList.remove('is-muted');
  initPickers();
  form.hidden = false;
  $('#bookingDone').hidden = true;
}
$('#bookingReset').addEventListener('click', () => {
  transition(resetForm);
  select.focus({ preventScroll: true });
});

/* ---------- 3D-модель зуба ---------- */
const stage = $('#toothStage');
const info = $('#toothInfo');

function webglAvailable() {
  try {
    const c = document.createElement('canvas');
    const gl = window.WebGL2RenderingContext && c.getContext('webgl2');
    if (!gl) return false;
    gl.getExtension('WEBGL_lose_context')?.loseContext();
    return true;
  } catch {
    return false;
  }
}

async function initTooth() {
  if (!webglAvailable()) {
    $('#toothLoader').hidden = true;
    $('#toothFallback').hidden = false;
    $('.stage__bar', stage).hidden = true;
    $('#toothHint').hidden = true;
    return;
  }
  try {
    const { createToothViewer } = await import('./tooth-viewer.js');
    const viewer = await createToothViewer({
      stage,
      host: $('#toothCanvas'),
      layer: $('#toothHotspots'),
      onSelect(item) {
        if (!item) {
          info.hidden = true;
          return;
        }
        $('#toothInfoTitle').textContent = item.label;
        $('#toothInfoText').textContent = item.text;
        info.hidden = false;
      },
    });
    stage.dataset.source = viewer.source;
    stage.classList.add('is-ready');
    $('#toothLoader').hidden = true;
    window.__orisViewer = viewer; // удобно для отладки и демонстрации

    const viewBtns = $$('[data-view]', stage);
    viewBtns.forEach((b) =>
      b.addEventListener('click', () => {
        viewBtns.forEach((x) => x.classList.toggle('is-active', x === b));
        viewer.view(b.dataset.view);
      })
    );
    $('[data-zoom="in"]', stage).addEventListener('click', () => viewer.zoom(0.82));
    $('[data-zoom="out"]', stage).addEventListener('click', () => viewer.zoom(1.22));
    const xrayBtn = $('[data-xray]', stage);
    xrayBtn.addEventListener('click', () => {
      viewer.setXray(!viewer.xray);
      xrayBtn.setAttribute('aria-pressed', String(viewer.xray));
    });
    $('[data-reset]', stage).addEventListener('click', () => {
      viewer.reset();
      xrayBtn.setAttribute('aria-pressed', 'false');
      viewBtns.forEach((x) => x.classList.toggle('is-active', x.dataset.view === 'overview'));
    });
    $('.stage__info-close', stage).addEventListener('click', () => {
      const active = $('.hotspot.is-active', stage);
      if (active) active.click();
      else info.hidden = true;
    });
  } catch (err) {
    console.error('[ORIS] 3D-модель не запустилась', err);
    $('#toothLoader').hidden = true;
    $('#toothFallback').hidden = false;
    $('.stage__bar', stage).hidden = true;
  }
}

// Загружаем 3D, когда сцена рядом с экраном (на первом экране — сразу).
new IntersectionObserver(
  (entries, obs) => {
    if (entries.some((e) => e.isIntersecting)) {
      obs.disconnect();
      initTooth();
    }
  },
  { rootMargin: '200px' }
).observe(stage);
