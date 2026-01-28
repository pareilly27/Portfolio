const toggleBtn = document.getElementById('toggleBtn');
const toggleCircle = document.getElementById('toggleCircle')
const toggleLabel = document.getElementById('toggleLabel');
const grid = document.getElementById('grid');
const bubbleCanvas = document.getElementById('bubbleCanvas');
const projectGrid = document.getElementById('grid-container');
const selectedText = document.getElementById('selected-text-container');
const contactSection = document.getElementById('contact-section')

toggleCircle.addEventListener('click', () => {
    grid.classList.toggle('active-view');
    bubbleCanvas.classList.toggle('active-view');
    toggleBtn.classList.toggle('toggled');
    
    if (toggleBtn.classList.contains('toggled')) {
        toggleLabel.textContent = "Playtime";
        selectedText.style.display = 'none';
        projectGrid.style.display = 'none';
        contactSection.style.display = 'none';
    } else {
        toggleLabel.textContent = "Precision";
        selectedText.style.display = 'flex';
        projectGrid.style.display = 'grid';
        contactSection.style.display = 'block';
    }
});