(() => {
  const header = document.querySelector('.header');
  const projects = document.getElementById('grid-container');
  const bubbleScene = document.getElementById('bubbleScene');
  if (!header || !projects) return;

  const rows = [...projects.querySelectorAll(':scope > .project-row')];
  if (!rows.length) return;
  // The contact section lives inside #grid-container too, so it scrolls
  // with the grid content and sits over the grid-cell lines.
  const contact = projects.querySelector(':scope > .contact-section');

  const viewport = document.createElement('div');
  viewport.className = 'project-grid-sticky-viewport';

  const visual = document.createElement('div');
  visual.className = 'project-grid-visual';
  visual.setAttribute('aria-hidden', 'true');

  const cells = document.createElement('div');
  cells.className = 'project-grid-cells';
  visual.append(cells);

  const content = document.createElement('div');
  content.className = 'project-grid-content';
  content.append(...rows);
  if (contact) content.append(contact);

  viewport.append(visual, content);
  projects.replaceChildren(viewport);

  let queued = false;
  let layoutDirty = true;
  let stickyTop = 0;
  let viewportHeight = 1;
  let contentHeight = 1;
  let trackHeight = 1;
  let projectDocumentTop = 0;
  let maximumTravel = 0;

  function measureLayout() {
    const rootStyle = getComputedStyle(document.documentElement);
    const columns = parseInt(rootStyle.getPropertyValue('--grid-columns'), 10) || 9;
    const rowsPerViewport = parseInt(rootStyle.getPropertyValue('--grid-rows'), 10) || 4;
    const headerBottom = Math.max(0, header.getBoundingClientRect().bottom);
    stickyTop = headerBottom + 75;
    viewportHeight = Math.max(1, innerHeight - stickyTop);
    const rowHeight = innerHeight / rowsPerViewport;
    contentHeight = content.scrollHeight;
    const requiredRows = Math.max(1, Math.ceil(Math.max(contentHeight, viewportHeight) / rowHeight));
    const requiredCells = columns * requiredRows;

    if (cells.children.length !== requiredCells) {
      const fragment = document.createDocumentFragment();
      for (let index = 0; index < requiredCells; index += 1) {
        const cell = document.createElement('div');
        cell.className = 'project-grid-cell';
        fragment.append(cell);
      }
      cells.replaceChildren(fragment);
    }

    projects.style.setProperty('--project-grid-sticky-top', `${stickyTop}px`);
    projects.style.setProperty('--project-grid-viewport-height', `${viewportHeight}px`);

    trackHeight = Math.max(contentHeight, viewportHeight);
    projects.style.height = `${trackHeight}px`;
    projectDocumentTop = projects.getBoundingClientRect().top + scrollY;
    maximumTravel = Math.max(0, contentHeight - viewportHeight);
    layoutDirty = false;
  }

  function update() {
    queued = false;
    if (layoutDirty) measureLayout();

    const projectTop = projectDocumentTop - scrollY;
    const travel = Math.min(Math.max(0, stickyTop - projectTop), maximumTravel);
    content.style.transform = `translate3d(0, ${-travel}px, 0)`;
    cells.style.transform = `translate3d(0, ${-travel}px, 0)`;

    if (bubbleScene) {
      const stickyLimit = projectDocumentTop + trackHeight - viewportHeight - scrollY;
      const viewportTop = Math.min(Math.max(projectTop, stickyTop), stickyLimit);
      bubbleScene.style.position = 'fixed';
      bubbleScene.style.top = `${viewportTop - innerHeight}px`;
    }
  }

  function schedule() {
    if (queued) return;
    queued = true;
    requestAnimationFrame(update);
  }

  function scheduleLayout() {
    layoutDirty = true;
    schedule();
  }

  addEventListener('scroll', schedule, { passive: true });
  addEventListener('resize', scheduleLayout, { passive: true });
  new ResizeObserver(scheduleLayout).observe(content);
  new ResizeObserver(scheduleLayout).observe(header);
  update();
})();
