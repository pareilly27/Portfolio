const toggleBtn = document.getElementById('toggleBtn');
const toggleLabel = document.getElementById('toggleLabel');

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
        window.HomeImageGrid.setDimensions(enabled ? 9 : 12, enabled ? 6 : 5, enabled ? 'experimental' : 'linear');
    }
    window.dispatchEvent(new CustomEvent(enabled ? 'bubbles:deactivate' : 'bubbles:activate'));
}

toggleBtn.addEventListener('click', () => {
    setPlaytime(!toggleBtn.classList.contains('toggled'));
});
