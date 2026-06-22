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
    img.src = src;
});

function createGrid(rows, columns) {
    const gridContainer = document.getElementById('grid');
    gridContainer.innerHTML = '';
    
    const totalCells = rows * columns;
    for (let i = 0; i < totalCells; i++) {
        const cell = document.createElement('div');
        cell.className = 'cell';
        cell.style.setProperty('--bg-image', `url('${images[i % images.length]}')`);
        
        const row = Math.floor(i / columns);
        const col = i % columns;
        
        let shadows = [];
        if (row !== 0) shadows.push('inset 0 0.2px 0 0 #9d9d9d');
        if (col !== 0) shadows.push('inset 0.2px 0 0 0 #9d9d9d');
        if (col !== columns - 1) shadows.push('inset -0.2px 0 0 0 #9d9d9d');
        if (row !== rows - 1) shadows.push('inset 0 -0.2px 0 0 #9d9d9d');

        cell.style.boxShadow = shadows.join(', ') || 'none';
        gridContainer.appendChild(cell);
    }
}

const gridColumns = parseInt(getComputedStyle(document.documentElement).getPropertyValue('--grid-columns'));
const gridRows = parseInt(getComputedStyle(document.documentElement).getPropertyValue('--grid-rows'));

createGrid(gridRows, gridColumns);

document.getElementById('grid').classList.add('active-view');

