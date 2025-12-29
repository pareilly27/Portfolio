const toggleBtn = document.getElementById('toggleBtn');
const grid = document.getElementById('grid');
const bubbleCanvas = document.getElementById('bubbleCanvas');

toggleBtn.addEventListener('click', () => {
    grid.classList.toggle('active-view');
    bubbleCanvas.classList.toggle('active-view');
    toggleBtn.classList.toggle('toggled');
});
