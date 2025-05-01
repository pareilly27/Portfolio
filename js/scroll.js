const header = document.querySelector('.header');
const hero = document.querySelector('.hero');
const heroHeight = hero.offsetHeight;

window.addEventListener('scroll', () => {
  if (window.scrollY >= heroHeight) {
    header.style.background = '#fffffffe';  // Change color when scrolled
  } else {
    header.style.background = 'transparent';
  }
});

window.addEventListener('scroll', () => {
  if (window.scrollY >= window.innerHeight) {
    hero.classList.add('hidden');
  } else {
    hero.classList.remove('hidden');
  }
});