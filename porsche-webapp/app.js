const modeCards = document.querySelectorAll(".mode-card");
const swatches = document.querySelectorAll(".swatch");
const modeName = document.querySelector('[data-output="mode-name"]');
const modeScore = document.querySelector('[data-output="mode-score"]');
const dialProgress = document.querySelector(".dial-progress");
const hero = document.querySelector(".hero");

const paintColors = {
  carmine: "#f0312f",
  graphite: "#3a3d42",
  chalk: "#d8d2c6",
  "racing-green": "#2f7b62",
};

function setMode(card) {
  const score = Number(card.dataset.score);
  const offset = 364 - (364 * score) / 100;

  modeCards.forEach((item) => item.classList.toggle("active", item === card));
  modeName.textContent = card.dataset.mode;
  modeScore.textContent = score;
  dialProgress.style.strokeDashoffset = String(offset);
}

function setPaint(button) {
  const color = paintColors[button.dataset.color];

  swatches.forEach((item) => item.classList.toggle("active", item === button));
  hero.style.setProperty("--red", color);
}

modeCards.forEach((card) => {
  card.addEventListener("click", () => setMode(card));
});

swatches.forEach((button) => {
  button.addEventListener("click", () => setPaint(button));
});
