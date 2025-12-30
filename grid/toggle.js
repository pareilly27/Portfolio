const toggleBtn = document.getElementById('toggleBtn');
const toggleLabel = document.getElementById('toggleLabel');
const grid = document.getElementById('grid');
const bubbleCanvas = document.getElementById('bubbleCanvas');

toggleBtn.addEventListener('click', () => {
    grid.classList.toggle('active-view');
    bubbleCanvas.classList.toggle('active-view');
    toggleBtn.classList.toggle('toggled');
    
    if (toggleBtn.classList.contains('toggled')) {
        toggleLabel.textContent = "Playtime";
    } else {
        toggleLabel.textContent = "Precision";
    }
});