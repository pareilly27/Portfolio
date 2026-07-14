// Crossfades through all <img> tags inside each .laptop-frame__screen,
// one at a time, looping forever. Works with any number of images —
// just drop more <img> tags in and it picks them up automatically.
document.addEventListener('DOMContentLoaded', function () {
  var INTERVAL_MS = 3000;

  document.querySelectorAll('.laptop-frame__screen').forEach(function (screen) {
    var slides = screen.querySelectorAll('img');
    if (slides.length <= 1) return;

    var current = 0;
    slides.forEach(function (img, i) {
      img.classList.toggle('is-active', i === 0);
    });

    setInterval(function () {
      slides[current].classList.remove('is-active');
      current = (current + 1) % slides.length;
      slides[current].classList.add('is-active');
    }, INTERVAL_MS);
  });
});
