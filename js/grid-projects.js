

function createGrid(rows, columns) {
    const gridContainer = document.getElementById('grid');
    gridContainer.innerHTML = '';
    
    const totalCells = rows * columns;
    for (let i = 0; i < totalCells; i++) {
        const cell = document.createElement('div');
        cell.className = 'cell';
        
        
        const row = Math.floor(i / columns);
        const col = i % columns;
        
        let shadows = [];
        if (row !== 0) shadows.push('inset 0 0.2px 0 0 #5c5b5b');
        if (col !== 0) shadows.push('inset 0.2px 0 0 0 #5c5b5b');
        if (col !== columns - 1) shadows.push('inset -0.2px 0 0 0 #5c5b5b');
        if (row !== rows - 1) shadows.push('inset 0 -0.2px 0 0 #5c5b5b');

        cell.style.boxShadow = shadows.join(', ') || 'none';
        gridContainer.appendChild(cell);
    }
}

const gridColumns = parseInt(getComputedStyle(document.documentElement).getPropertyValue('--grid-columns'));
const gridRows = parseInt(getComputedStyle(document.documentElement).getPropertyValue('--grid-rows'));

createGrid(gridRows, gridColumns);

document.getElementById('grid').classList.add('active-view');

