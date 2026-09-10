(() => {
  const header = document.querySelector('.header');
  const track = document.querySelector('.about-scroll-grid');
  if (!header || !track) return;

  const sections = [...track.children];
  if (!sections.length) return;

  const viewport = document.createElement('div');
  viewport.className = 'about-grid-sticky-viewport';

  const visual = document.createElement('div');
  visual.className = 'about-grid-visual';
  visual.setAttribute('aria-hidden', 'true');

  const cells = document.createElement('div');
  cells.className = 'about-grid-cells';
  visual.append(cells);

  const content = document.createElement('div');
  content.className = 'about-grid-content';
  content.append(...sections);

  viewport.append(visual, content);
  track.replaceChildren(viewport);

  let queued = false;

  function fitFluffToGrid(rowHeight) {
    const fluff = content.querySelector('.fluff-section');
    if (!fluff) return;

    const controls = fluff.querySelector('.fluff-controls');
    const copy = fluff.querySelector('.fluff-copy');
    if (!controls || !copy) return;

    const fluffStyle = getComputedStyle(fluff);
    const controlsStyle = getComputedStyle(controls);
    const requiredHeight =
      parseFloat(fluffStyle.paddingTop) +
      controls.offsetHeight +
      parseFloat(controlsStyle.marginBottom) +
      copy.scrollHeight +
      parseFloat(fluffStyle.paddingBottom);
    const rows = Math.max(2, Math.ceil(requiredHeight / rowHeight));
    const nextValue = String(rows);

    if (fluff.style.getPropertyValue('--fluff-grid-rows') !== nextValue) {
      fluff.style.setProperty('--fluff-grid-rows', nextValue);
    }
  }

  function update() {
    queued = false;

    const headerBottom = Math.max(0, header.getBoundingClientRect().bottom);
    const stickyTop = headerBottom + 75;
    const viewportHeight = Math.max(1, innerHeight - stickyTop);
    const rowHeight = innerHeight / 4;
    fitFluffToGrid(rowHeight);
    const contentHeight = content.scrollHeight;
    const gridHeight = Math.max(contentHeight, viewportHeight);
    const firstRowHeight = rowHeight / 3;
    const requiredRows = Math.max(1, 1 + Math.ceil(Math.max(0, gridHeight - firstRowHeight) / rowHeight));
    const requiredCells = 9 * requiredRows;

    if (cells.children.length !== requiredCells) {
      const fragment = document.createDocumentFragment();
      for (let index = 0; index < requiredCells; index += 1) {
        const cell = document.createElement('div');
        cell.className = 'about-grid-cell';
        fragment.append(cell);
      }
      cells.replaceChildren(fragment);
    }

    track.style.setProperty('--about-grid-sticky-top', `${stickyTop}px`);
    track.style.setProperty('--about-grid-viewport-height', `${viewportHeight}px`);

    const trackHeight = Math.max(contentHeight, viewportHeight);
    track.style.height = `${trackHeight}px`;

    const trackTop = track.getBoundingClientRect().top;
    const maximumTravel = Math.max(0, contentHeight - viewportHeight);
    const travel = Math.min(Math.max(0, stickyTop - trackTop), maximumTravel);

    content.style.transform = `translate3d(0, ${-travel}px, 0)`;
    cells.style.transform = `translate3d(0, ${-travel}px, 0)`;
  }

  function schedule() {
    if (queued) return;
    queued = true;
    requestAnimationFrame(update);
  }

  addEventListener('scroll', schedule, { passive: true });
  addEventListener('resize', schedule, { passive: true });
  const contentResizeObserver = new ResizeObserver(schedule);
  contentResizeObserver.observe(content);
  const fluffCopy = content.querySelector('.fluff-copy');
  if (fluffCopy) contentResizeObserver.observe(fluffCopy);
  new ResizeObserver(schedule).observe(header);
  update();
})();
