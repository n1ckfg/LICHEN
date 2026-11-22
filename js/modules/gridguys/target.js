export class Target {
  // width x height is the frame's size, which GridGuys keeps up to date
  constructor(width, height) {
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

// The 3D mode's cursor: Target's wander in a cube of side `size` cells,
// centred on 0. It is a class of its own, so the 2D mode's Target draws from
// Math.random() exactly as it always did.
export class Target3D {
  constructor(size) {
    this.size = size;
    this.speedMin = 0.01;
    this.speedMax = 0.05;
    this.speed = 0.03;
    this.clickOdds = 0.1;
    this.chooseOdds = 0.01;
    this.markTime = 0;
    this.timeInterval = 200;

    this.pos = [0, 0, 0];
    this.goal = [0, 0, 0];
    this.minDist = 0.5;
    this.clicked = false;
    this.armResetAll = false;

    this.pickTarget();
  }

  run() {
    for (let i = 0; i < 3; i++) this.pos[i] += (this.goal[i] - this.pos[i]) * this.speed;
    const dist = Math.hypot(this.goal[0] - this.pos[0], this.goal[1] - this.pos[1], this.goal[2] - this.pos[2]);
    if (performance.now() > this.markTime + this.timeInterval || dist < this.minDist) {
      this.pickTarget();
    }
  }

  pickTarget() {
    this.markTime = performance.now();
    const half = this.size / 2;
    for (let i = 0; i < 3; i++) {
      this.goal[i] = this.pos[i] + ((Math.random() * 2 - 1) * half - this.pos[i]) * 0.5;
    }
    this.speed = this.speedMin + Math.random() * (this.speedMax - this.speedMin);
    const r = Math.random();
    if (r < this.clickOdds) this.clicked = !this.clicked;
    if (r < this.chooseOdds) this.armResetAll = true;
  }
}
