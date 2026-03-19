export class Target {
  constructor(width = 640, height = 480) {
    this.width = width;
    this.height = height;
    this.speedMin = 0.01;
    this.speedMax = 0.05;
    this.speed = 0.03;
    this.clickOdds = 0.1;
    this.chooseOdds = 0.01;
    this.markTime = 0;
    this.timeInterval = 200;

    this.posX = 0;
    this.posY = 0;
    this.targetX = 0;
    this.targetY = 0;
    this.minDist = 5;
    this.clicked = false;
    this.armResetAll = false;

    this.pickTarget();
  }

  run() {
    this.posX = this._lerp(this.posX, this.targetX, this.speed);
    this.posY = this._lerp(this.posY, this.targetY, this.speed);

    const now = performance.now();
    const dist = this._dist(this.posX, this.posY, this.targetX, this.targetY);

    if (now > this.markTime + this.timeInterval || dist < this.minDist) {
      this.pickTarget();
    }
  }

  pickTarget() {
    this.markTime = performance.now();

    const halfW = this.width / 2;
    const halfH = this.height / 2;

    this.targetX = this._lerp(this.posX, this._random(-halfW, halfW), 0.5);
    this.targetY = this._lerp(this.posY, this._random(-halfH, halfH), 0.5);

    this.speed = this._random(this.speedMin, this.speedMax);
    const r = Math.random();
    if (r < this.clickOdds) this.clicked = !this.clicked;
    if (r < this.chooseOdds) this.armResetAll = true;
  }

  _lerp(a, b, t) {
    return a + (b - a) * t;
  }

  _dist(x1, y1, x2, y2) {
    const dx = x2 - x1;
    const dy = y2 - y1;
    return Math.sqrt(dx * dx + dy * dy);
  }

  _random(min, max) {
    return min + Math.random() * (max - min);
  }
}
