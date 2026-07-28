const images = [
  'img/grid_img1.webp',
  'img/grid_img2.webp',
  'img/grid_img3.webp',
  'img/grid_img4.webp',
  'img/grid_img5.webp',
  'img/grid_img6.webp',
  'img/grid_img7.webp',
  'img/grid_img8.webp',
  'img/grid_img9.webp',
  'img/grid_img10.webp',
  'img/grid_img11.webp',
  'img/grid_img12.webp',
  'img/grid_img13.webp',
  'img/grid_img14.webp',
  'img/grid_img15.webp',
  'img/grid_img16.webp',
  'img/grid_img17.webp',
  'img/grid_img18.webp',
  'img/grid_img19.webp',
  'img/grid_img20.webp',
  'img/grid_img21.webp',
  'img/grid_img22.webp',
  'img/grid_img23.webp',
  'img/grid_img24.webp',
  'img/grid_img25.webp',
  'img/grid_img26.webp',
  'img/grid_img27.webp',
  'img/grid_img28.webp',
  'img/grid_img29.webp',
  'img/grid_img30.webp',
  'img/grid_img31.webp',
  'img/grid_img32.webp',
  'img/grid_img33.webp',
  'img/grid_img34.webp',
  'img/grid_img35.webp',
  'img/grid_img36.webp',
  'img/grid_img37.webp',
  'img/grid_img38.webp',
  'img/grid_img39.webp',
  'img/grid_img40.webp',
  'img/grid_img41.webp',
  'img/grid_img42.webp',
  'img/grid_img43.webp',
  'img/grid_img44.webp',
  'img/grid_img45.webp',
  'img/grid_img46.webp',
  'img/grid_img47.webp',
  'img/grid_img48.webp',
  'img/grid_img49.webp',
  'img/grid_img50.webp',
  'img/grid_img51.webp',
  'img/grid_img52.webp',
  'img/grid_img53.webp',
  'img/grid_img54.webp',
  'img/grid_img55.webp',
  'img/grid_img56.webp',
  'img/grid_img57.webp',
  'img/grid_img58.webp',
  'img/grid_img59.webp',
  'img/grid_img60.webp',
];

// Preload images
images.forEach(src => {
    const img = new Image();
    // These paths are used by CSS relative to grid/style.css. A JavaScript
    // Image resolves relative to index.html instead, so give the preloader
    // the equivalent explicit grid/ base and avoid false /img/* 404s.
    img.src = new URL(src, new URL('grid/', document.baseURI)).href;
});

// Keep Experimental tied to the project gallery rather than maintaining a
// second hand-curated image list. The active project cards supply 12 images,
// so every experimental row can contain each project exactly once.
function projectGridImages() {
    return Array.from(document.querySelectorAll('#grid-container .square'))
        .map(square => {
            const match = /url\((['"]?)(.*?)\1\)/.exec(square.style.backgroundImage);
            // A custom property is consumed by grid/style.css, so a relative
            // URL would be resolved from /grid/. Make project-card paths
            // document-relative before handing them to that stylesheet.
            return match ? new URL(match[2], document.baseURI).href : null;
        })
        .filter(Boolean);
}

function createGrid(rows, columns, imageSet = 'linear') {
    const gridContainer = document.getElementById('grid');
    const sources = imageSet === 'experimental' ? projectGridImages() : images;
    gridContainer.innerHTML = '';
    
    const totalCells = rows * columns;
    for (let i = 0; i < totalCells; i++) {
        const cell = document.createElement('div');
        cell.className = 'cell';
        const row = Math.floor(i / columns);
        const col = i % columns;
        // Straight sequential walk through the list: guarantees every
        // project appears before any repeat, for any grid size. Also
        // avoids vertical repetition here because the column count (5)
        // and project count (12) are coprime, so each column steps
        // through all 12 before coming back around.
        //
        // (Earlier offset schemes -- (col+row)%n, then (i+row)%n --
        // both created a stride sharing a factor with 12 and silently
        // dropped projects: 8 of 12 shown at 5x4, then 10 of 12.)
        const imageIndex = i % sources.length;
        const source = sources[imageIndex];
        cell.style.setProperty('--bg-image', `url('${source}')`);
        
        let shadows = [];
        if (row !== 0) shadows.push('inset 0 0.2px 0 0 #9d9d9d');
        if (col !== 0) shadows.push('inset 0.2px 0 0 0 #9d9d9d');
        if (col !== columns - 1) shadows.push('inset -0.2px 0 0 0 #9d9d9d');
        if (row !== rows - 1) shadows.push('inset 0 -0.2px 0 0 #9d9d9d');

        cell.style.boxShadow = shadows.join(', ') || 'none';
        gridContainer.appendChild(cell);
    }
}

const gridContainer = document.getElementById('grid');
let gridColumns = parseInt(getComputedStyle(document.documentElement).getPropertyValue('--grid-columns'));
let gridRows = parseInt(getComputedStyle(document.documentElement).getPropertyValue('--grid-rows'));
let gridImageSet = 'linear';

function setDimensions(columns, rows, imageSet = 'linear') {
    if (columns === gridColumns && rows === gridRows && imageSet === gridImageSet) return;
    gridColumns = columns;
    gridRows = rows;
    gridImageSet = imageSet;
    // The CSS variables define the visual grid tracks; rebuilding the cells
    // gives the reveal canvas a matching image mosaic for every new track.
    document.documentElement.style.setProperty('--grid-columns', columns);
    document.documentElement.style.setProperty('--grid-rows', rows);
    createGrid(rows, columns, imageSet);
    if (imageSet === 'experimental') {
        // A focused tile exists immediately on entry; subsequent focus changes
        // wait for the hover dwell below.
        setGridFocus(gridContainer.querySelector('.cell'));
    }
}

createGrid(gridRows, gridColumns);
gridContainer.classList.add('active-view');

window.HomeImageGrid = { setDimensions };

// The locator uses event delegation so it keeps working after the grid cells
// are rebuilt when switching between Linear and Experimental layouts.
const crosshair = document.getElementById('gridCrosshair');
const focusTile = document.getElementById('gridFocusTile');
const leadDesignerLabel = document.getElementById('leadDesignerLabel');
const REVEAL_DELAY = 260;
// How hard the tile/crosshair chase the cursor, per frame. 1 = rigid
// lock (old behaviour), lower = more lag. The tile trails the pointer
// and catches up when you stop, so fast movements visibly outrun it.
const FOLLOW_EASE = 0.06;
let trackedCell = null;
let crosshairTimer = null;
let focusedCell = null;
// Latest pointer position, in viewport coords. The focused tile is drawn
// centred here rather than inside its cell, so the image square travels
// with the cursor: moving up within the same cell carries the picture up
// with it, instead of the cell acting as a fixed window.
let pointerX = -1000;
let pointerY = -1000;
// The drawn position, eased toward the pointer each frame.
let followX = -1000;
let followY = -1000;
let followRaf = null;

function hideCrosshair() {
    clearTimeout(crosshairTimer);
    crosshairTimer = null;
    if (crosshair) crosshair.classList.remove('is-visible');
    if (focusTile) focusTile.classList.remove('is-visible');
    if (leadDesignerLabel) leadDesignerLabel.classList.remove('is-visible');
    if (focusedCell) {
        focusedCell.classList.remove('is-revealed');
        focusedCell = null;
    }
}

// Position-only update: runs on every pointer move, so the tile and the
// crosshair follow the cursor continuously even while the *image* stays
// the same (the image only changes when the dwell timer promotes a new
// cell in setGridFocus).
function positionFocus() {
    if (focusTile) {
        focusTile.style.setProperty('--tile-x', `${followX}px`);
        focusTile.style.setProperty('--tile-y', `${followY}px`);
    }
    if (crosshair) {
        crosshair.style.setProperty('--crosshair-x', `${followX}px`);
        crosshair.style.setProperty('--crosshair-y', `${followY}px`);
    }
    // Fixed horizontally (set once in CSS); only the vertical position
    // here tracks the crosshair's horizontal line, so the label always
    // sits just above it.
    if (leadDesignerLabel) {
        leadDesignerLabel.style.setProperty('--label-y', `${followY}px`);
    }
}

// Runs only while the drawn position is still catching up, then parks
// itself -- no idle rAF loop when the cursor is at rest.
function followLoop() {
    const dx = pointerX - followX;
    const dy = pointerY - followY;

    if (Math.abs(dx) < 0.1 && Math.abs(dy) < 0.1) {
        followX = pointerX;
        followY = pointerY;
        positionFocus();
        followRaf = null;
        return;
    }

    followX += dx * FOLLOW_EASE;
    followY += dy * FOLLOW_EASE;
    positionFocus();
    followRaf = requestAnimationFrame(followLoop);
}

function startFollow() {
    if (followRaf === null) followRaf = requestAnimationFrame(followLoop);
}

function setGridFocus(cell) {
    if (!cell || !crosshair) return;
    if (focusedCell && focusedCell !== cell) focusedCell.classList.remove('is-revealed');
    focusedCell = cell;
    focusedCell.classList.add('is-revealed');

    if (focusTile) {
        const rect = cell.getBoundingClientRect();
        // The tile matches the cell's dimensions so it reads as the grid
        // square itself having moved, not as a free-floating thumbnail.
        focusTile.style.setProperty('--tile-w', `${rect.width}px`);
        focusTile.style.setProperty('--tile-h', `${rect.height}px`);
        focusTile.style.setProperty('--tile-image', cell.style.getPropertyValue('--bg-image'));
        focusTile.classList.add('is-visible');
    }

    if (followX < -900) {
        // First appearance: start at the pointer instead of sliding in
        // from the off-screen initial value.
        followX = pointerX;
        followY = pointerY;
    }
    positionFocus();
    crosshair.classList.add('is-visible');
    if (leadDesignerLabel) leadDesignerLabel.classList.add('is-visible');
}

gridContainer.addEventListener('pointermove', event => {
    if (!document.body.classList.contains('is-experimental') || !crosshair) return;

    pointerX = event.clientX;
    pointerY = event.clientY;
    startFollow();

    const cell = event.target.closest('.cell');
    if (!cell || (cell === trackedCell && (crosshair.classList.contains('is-visible') || crosshairTimer))) return;
    trackedCell = cell;
    clearTimeout(crosshairTimer);
    crosshairTimer = setTimeout(() => {
        crosshairTimer = null;
        // Keep the crosshair attached only to a tile whose delayed image is
        // actually eligible to appear, never to an in-between hover target.
        if (!document.body.classList.contains('is-experimental') || trackedCell !== cell) return;
        setGridFocus(cell);
    }, REVEAL_DELAY);
});

gridContainer.addEventListener('pointerleave', () => {
    trackedCell = null;
    if (followRaf !== null) {
        cancelAnimationFrame(followRaf);
        followRaf = null;
    }
    hideCrosshair();
});
