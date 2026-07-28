// Static mosaic behind #grid-container -- same 60 photos as the ambient
// full-viewport grid, same idea of a grid pattern, but plain and fixed
// in place: no WebGL canvas, no cursor-following reveal. This is what
// sits between the live pixel-reveal effect (which tracks the pointer
// globally and would otherwise still be visible through this section's
// gaps/padding) and the project cards themselves, so the grid pattern
// reads consistently across the page without the reveal effect ever
// showing or being triggerable here.
(function () {
  const backdrop = document.getElementById('gridContainerBackdrop');
  if (!backdrop) return;

  const COLUMNS = 6;

  function build() {
    const sources = window.AmbientGridImages || [];
    if (!sources.length) return;

    const rect = backdrop.getBoundingClientRect();
    const width = rect.width || backdrop.parentElement.clientWidth || 1;
    const height = rect.height || backdrop.parentElement.clientHeight || 1;
    // Same 7:5 photo aspect ratio the ambient/experimental grids use
    // elsewhere, so tiles aren't stretched or cropped oddly.
    const cellHeight = (width / COLUMNS) * (5 / 7);
    const rows = Math.max(1, Math.ceil(height / cellHeight));

    backdrop.style.gridTemplateColumns = `repeat(${COLUMNS}, 1fr)`;
    backdrop.style.gridAutoRows = `${cellHeight}px`;
    backdrop.replaceChildren();

    const total = COLUMNS * rows;
    for (let i = 0; i < total; i++) {
      const cell = document.createElement('div');
      cell.className = 'backdrop-cell';
      const src = sources[i % sources.length];
      // Same document-relative resolution grid.js uses for its own
      // preloader, since these paths are otherwise relative to grid/.
      const href = new URL(src, new URL('grid/', document.baseURI)).href;
      cell.style.backgroundImage = `url('${href}')`;
      backdrop.appendChild(cell);
    }
  }

  let resizeTimer = null;
  function scheduleBuild() {
    clearTimeout(resizeTimer);
    resizeTimer = setTimeout(build, 150);
  }

  window.addEventListener('load', build);
  window.addEventListener('resize', scheduleBuild, { passive: true });
  // #grid-container's own height depends on its content (project cards),
  // which is already sized by the time this script runs at the end of
  // the body -- but build again shortly after in case fonts/images still
  // reflow it.
  build();
  setTimeout(build, 300);
}());
