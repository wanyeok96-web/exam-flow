/** Exam Flow — js/guide.js (classic script, file:// 호환) */

let pageTourIndex = -1;
let pageTourCards = [];
let pageTourLayoutTimer = null;

function isPageTourActive() {
  return document.body.classList.contains('page-tour-active');
}

function pageTourCardTitle(card) {
  return (card.dataset.tourTitle || card.querySelector('.card__title')?.textContent || '').replace(/\s+/g, ' ').trim();
}

function pageTourCardBody(card) {
  return (card.dataset.tourBody || '').trim()
    || card.querySelector('.hint')?.textContent?.replace(/\s+/g, ' ').trim()
    || '이 카드에서 해당 작업을 진행합니다.';
}

function collectPageTourCards(step) {
  const panel = document.getElementById('step-' + step);
  if (!panel) return [];
  return [...panel.querySelectorAll('.section-card')];
}

function layoutPageTourPop() {
  const pop = $('#page-tour-pop');
  const card = pageTourCards[pageTourIndex];
  if (!pop || !card) return;
  const isNarrow = window.matchMedia('(max-width: 900px)').matches;
  if (isNarrow) {
    pop.classList.add('is-docked');
    pop.style.top = '';
    pop.style.left = '';
    return;
  }
  pop.classList.remove('is-docked');
  const rect = card.getBoundingClientRect();
  const popH = pop.offsetHeight || 180;
  const popW = pop.offsetWidth || 380;
  const spaceBelow = window.innerHeight - rect.bottom;
  let top = spaceBelow >= popH + 20
    ? rect.bottom + 12
    : Math.max(12, rect.top - popH - 12);
  if (top + popH > window.innerHeight - 12) {
    top = Math.max(12, window.innerHeight - popH - 12);
  }
  const left = Math.min(Math.max(12, rect.left), window.innerWidth - popW - 12);
  pop.style.top = `${top}px`;
  pop.style.left = `${left}px`;
}

function showPageTourStep(index) {
  const card = pageTourCards[index];
  if (!card) return;
  pageTourIndex = index;
  pageTourCards.forEach(el => el.classList.toggle('tour-card-spotlight', el === card));
  const progress = $('#page-tour-progress');
  const title = $('#page-tour-title');
  const body = $('#page-tour-body');
  if (progress) progress.textContent = `${index + 1} / ${pageTourCards.length}`;
  if (title) title.textContent = pageTourCardTitle(card);
  if (body) body.textContent = pageTourCardBody(card);
  const prev = $('#page-tour-prev');
  const next = $('#page-tour-next');
  if (prev) prev.disabled = index === 0;
  if (next) next.textContent = index === pageTourCards.length - 1 ? '완료' : '다음';
  card.scrollIntoView({ behavior: 'smooth', block: 'center' });
  clearTimeout(pageTourLayoutTimer);
  pageTourLayoutTimer = setTimeout(() => {
    layoutPageTourPop();
    $('#page-tour-next')?.focus();
  }, 220);
}

function startPageTour(step) {
  if (isPageTourActive()) stopPageTour();
  const cards = collectPageTourCards(step);
  if (!cards.length) return;
  pageTourCards = cards;
  const root = $('#page-tour');
  if (root) root.hidden = false;
  document.body.classList.add('page-tour-active');
  showPageTourStep(0);
}

function stopPageTour() {
  const root = $('#page-tour');
  if (root) root.hidden = true;
  document.body.classList.remove('page-tour-active');
  pageTourCards.forEach(el => el.classList.remove('tour-card-spotlight'));
  pageTourCards = [];
  pageTourIndex = -1;
  clearTimeout(pageTourLayoutTimer);
  const pop = $('#page-tour-pop');
  if (pop) {
    pop.classList.add('is-docked');
    pop.style.top = '';
    pop.style.left = '';
  }
}

function nextPageTour() {
  if (pageTourIndex >= pageTourCards.length - 1) {
    stopPageTour();
    return;
  }
  showPageTourStep(pageTourIndex + 1);
}

function prevPageTour() {
  if (pageTourIndex <= 0) return;
  showPageTourStep(pageTourIndex - 1);
}

function onPageTourKeydown(e) {
  if (!isPageTourActive()) return;
  if (e.key === 'Escape') {
    e.preventDefault();
    stopPageTour();
  } else if (e.key === 'ArrowRight') {
    e.preventDefault();
    nextPageTour();
  } else if (e.key === 'ArrowLeft') {
    e.preventDefault();
    prevPageTour();
  }
}

function initPageTour() {
  $$('.btn-page-tour').forEach(btn => {
    btn.addEventListener('click', () => startPageTour(btn.dataset.tour));
  });
  $('#page-tour-next')?.addEventListener('click', nextPageTour);
  $('#page-tour-prev')?.addEventListener('click', prevPageTour);
  $('#page-tour-skip')?.addEventListener('click', stopPageTour);
  $('#page-tour-scrim')?.addEventListener('click', stopPageTour);
  $('#step-guide')?.addEventListener('click', e => {
    const jump = e.target.closest('[data-goto-step]');
    if (!jump) return;
    if (typeof activateStep === 'function') activateStep(jump.dataset.gotoStep);
  });
  document.addEventListener('keydown', onPageTourKeydown);
  window.addEventListener('resize', () => {
    if (isPageTourActive()) layoutPageTourPop();
  });
  window.addEventListener('scroll', () => {
    if (isPageTourActive()) layoutPageTourPop();
  }, { passive: true });
}
