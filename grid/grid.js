const images = [
    'img/_ (36) 2 copy.png',
    'img/_ (36) 2.png',
    'img/_ (42) 2 copy.png',
    'img/_ (42) 2.png',
    'img/10638013 2 copy.png',
    'img/10638013 2.png',
    'img/a 2 copy.png',
    'img/a 2.png',
    'img/ddwd 2 copy.png',
    'img/ddwd 2.png',
    'img/df 2 copy.png',
    'img/df 2.png',
    'img/dfr 2 copy.png',
    'img/dfr 2.png',
    'img/gf 2 copy.png',
    'img/gf 2.png',
    'img/ghk 2 copy.png',
    'img/ghk 2.png',
    'img/gth 2 copy.png',
    'img/gth 2.png',
    'img/gty 2 copy.png',
    'img/gty 2.png',
    'img/hjo 2 copy.png',
    'img/hjo 2.png',
    'img/hu 2 copy.png',
    'img/hu 2.png',
    'img/hy 2 copy.png',
    'img/hy 2.png',
    'img/hyu 2 copy.png',
    'img/hyu 2.png',
    'img/io 2 copy.png',
    'img/io 2.png',
    'img/Jonpaul Douglass on The Great Discontent (TGD) 2.png',
    'img/ki 2.png',
    'img/kj 2.png',
    'img/kl 2.png',
    'img/klo 2.png',
    'img/klop 2.png',
    'img/ko 2.png',
    'img/kol 2.png',
    'img/mkl 2.png',
    'img/mnb 2.png',
    'img/nbn 2.png',
    'img/nc 2.png',
    'img/nhj 2.png',
    'img/nhk 2.png',
    'img/nm 2.png',
    'img/olk 2.png',
    'img/pop 2.png',
    'img/rtg 2.png',
    'img/swd 2.png',
    'img/tgb 2.png',
    'img/tt 2.png',
    'img/ui 2.png',
    'img/ujk 2.png',
    'img/uyh 2.png',
    'img/vf 2.png',
    'img/we 2.png',
    'img/ww 2.png',
    'img/yhf 2.png',
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

