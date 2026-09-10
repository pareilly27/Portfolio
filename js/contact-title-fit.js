// Scales the GET IN TOUCH title's font-size so the text fills the full
// width at natural letter spacing (no stretching). Re-fits on resize and
// once the Degular webfont has loaded.
(function () {
  var el = document.getElementById('contactTitle');
  if (!el) return;

  var ctx = document.createElement('canvas').getContext('2d');

  function fit() {
    var parent = el.parentElement;
    var target = parent ? parent.clientWidth : document.documentElement.clientWidth;
    if (!target) return;

    var cs = getComputedStyle(el);
    var family = cs.fontFamily || "'Degular', sans-serif";
    var weight = cs.fontWeight || '600';
    var REF = 200; // reference px

    ctx.font = weight + ' ' + REF + 'px ' + family;
    var w = ctx.measureText(el.textContent).width;
    if (w > 0) {
      // 1.005 = tiny overshoot so the outer letters sit flush to the edges
      el.style.fontSize = (REF * target / w * 1.005) + 'px';
    }
  }

  window.addEventListener('resize', fit, { passive: true });
  if (document.fonts && document.fonts.ready) document.fonts.ready.then(fit);
  // also refit a moment later in case the font paints after ready resolves
  setTimeout(fit, 300);
  fit();
})();
