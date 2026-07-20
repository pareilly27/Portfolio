const toggleBtn = document.getElementById('toggleBtn');
const toggleLabel = document.getElementById('toggleLabel');

// Experimental cells are locked to the artwork's 7:5 ratio, so row
// HEIGHT is dictated by column width -- which means the row count has
// to be derived from the viewport instead of being a fixed number.
// Math.ceil (not floor) so the last row runs past the bottom edge and
// gets clipped: the grid then covers every pixel of the screen, and
// the hover reveal keeps working all the way down, including in that
// partial row.
const EXPERIMENTAL_COLUMNS = 5;

function experimentalRows() {
    const cellHeight = (window.innerWidth / EXPERIMENTAL_COLUMNS) * 5 / 7;
    return Math.max(1, Math.ceil(window.innerHeight / cellHeight));
}

// Bubbles belong to the Linear side of the control. Experimental clears the
// layer, while leaving the underlying homepage and its content untouched.
function setPlaytime(enabled) {
    toggleBtn.classList.toggle('toggled', enabled);
    document.body.classList.toggle('is-experimental', enabled);
    if (!enabled) {
        document.getElementById('gridCrosshair')?.classList.remove('is-visible');
        document.getElementById('gridFocusTile')?.classList.remove('is-visible');
    }
    toggleBtn.setAttribute('aria-pressed', String(enabled));
    toggleLabel.textContent = enabled ? 'Experimental' : 'Linear';
    if (window.HomeImageGrid) {
        window.HomeImageGrid.setDimensions(
            enabled ? EXPERIMENTAL_COLUMNS : 12,
            enabled ? experimentalRows() : 5,
            enabled ? 'experimental' : 'linear'
        );
    }
    window.dispatchEvent(new CustomEvent(enabled ? 'bubbles:deactivate' : 'bubbles:activate'));
}

toggleBtn.addEventListener('click', () => {
    setPlaytime(!toggleBtn.classList.contains('toggled'));
});

// Cell height depends on viewport WIDTH, so a resize changes how many
// rows are needed to reach the bottom -- recompute or the grid stops
// short (or overshoots wildly) after the window changes size.
let experimentalResizeTimer = null;
window.addEventListener('resize', () => {
    if (!document.body.classList.contains('is-experimental')) return;
    clearTimeout(experimentalResizeTimer);
    experimentalResizeTimer = setTimeout(() => {
        if (!window.HomeImageGrid) return;
        window.HomeImageGrid.setDimensions(EXPERIMENTAL_COLUMNS, experimentalRows(), 'experimental');
    }, 150);
}, { passive: true });
