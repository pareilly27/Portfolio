document.getElementById('strip-fluff-button').addEventListener('click', () => {
    document.querySelectorAll('.fluff-text').forEach(el => {
        el.classList.toggle('removed');
    });
});