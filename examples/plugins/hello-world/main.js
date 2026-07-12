let clicks = 0;
const button = document.getElementById('counter-btn');
button.addEventListener('click', () => {
  clicks += 1;
  button.textContent = `Clicked ${clicks} time${clicks === 1 ? '' : 's'}`;
});
