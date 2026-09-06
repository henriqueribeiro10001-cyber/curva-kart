// kart.js — kart physics, lap tracking, items and collisions.

const KART_COLORS = ['#ff5a4e', '#3fb6ff', '#ffd23f', '#7ce07c'];

class Kart {
  constructor(slot, name, isAI) {
    this.slot = slot;
    this.name = name;
    this.isAI = isAI;
    this.color = KART_COLORS[slot % KART_COLORS.length];

    const start = TRACK.pointAt(TRACK.startIndex - slot * 3);
    const heading = TRACK.headingAt(TRACK.startIndex);
    // Stagger starting positions across the track width so karts don't overlap.
    const perp = heading + Math.PI / 2;
    const lane = (slot - 1.5) * 40;

    this.x = start.x + Math.cos(perp) * lane;
    this.y = start.y + Math.sin(perp) * lane;
    this.angle = heading;
    this.speed = 0;

    this.trackIndex = TRACK.startIndex;
    this.lapCount = 0;
    this.raceDistance = 0;
    this.finished = false;
    this.finishTime = null;

    this.item = null; // 'boost' | 'banana' | null (held item)
    this.boostTimer = 0;
    this.stunTimer = 0;
    this.itemCooldown = 0;

    this.input = { throttle: 0, steer: 0, useItem: false };

    // AI helper state — how many track points ahead the AI steers toward.
    // Keep this small: a large lookahead cuts corners straight across the
    // infield and drives the AI off-track on every turn.
    this.aiLookahead = 18 + Math.random() * 10;
  }

  get maxSpeed() {
    return this.offTrack ? 140 : 340;
  }

  applyAIInput() {
    if (!this.isAI) return;
    const nearest = TRACK.nearestIndex(this.x, this.y);
    const targetIndex = nearest.index + this.aiLookahead;
    const target = TRACK.pointAt(targetIndex);
    const desiredAngle = Math.atan2(target.y - this.y, target.x - this.x);
    let diff = desiredAngle - this.angle;
    diff = Math.atan2(Math.sin(diff), Math.cos(diff));

    this.input.steer = Math.max(-1, Math.min(1, diff * 3.5));
    this.input.throttle = 1;
    // Occasionally use an item if holding one.
    if (this.item && Math.random() < 0.01) {
      this.input.useItem = true;
    }
  }

  update(dt, others, itemBoxes, bananas) {
    if (this.stunTimer > 0) {
      this.stunTimer -= dt;
      this.speed *= 0.9;
    } else {
      const accel = 420;
      const brakeDrag = 250;
      const friction = 90;

      let targetBoost = this.boostTimer > 0 ? 1.6 : 1;
      if (this.boostTimer > 0) this.boostTimer -= dt;

      if (this.input.throttle > 0) {
        this.speed += accel * this.input.throttle * dt;
      } else if (this.input.throttle < 0) {
        this.speed -= brakeDrag * dt;
      }
      this.speed -= friction * dt;
      this.speed = Math.max(0, Math.min(this.maxSpeed * targetBoost, this.speed));

      const turnRate = 2.6 * Math.min(1, this.speed / 120 + 0.15);
      this.angle += this.input.steer * turnRate * dt;
    }

    this.x += Math.cos(this.angle) * this.speed * dt;
    this.y += Math.sin(this.angle) * this.speed * dt;

    // Track progress / off-track check.
    const nearest = TRACK.nearestIndex(this.x, this.y);
    this.offTrack = nearest.dist > TRACK.TRACK_WIDTH / 2;

    // Lap / unwrap logic: detect wrap-around of the index.
    const n = TRACK.points.length;
    let delta = nearest.index - this.trackIndex;
    if (delta < -n / 2) {
      this.lapCount += 1;
      delta += n;
    } else if (delta > n / 2) {
      this.lapCount -= 1;
      delta -= n;
    }
    this.trackIndex = nearest.index;
    this.raceDistance = this.lapCount * TRACK.totalLength + TRACK.cumDist[nearest.index];

    // Item box pickup.
    if (!this.item && this.itemCooldown <= 0) {
      for (const box of itemBoxes) {
        if (box.active && Math.hypot(box.x - this.x, box.y - this.y) < 45) {
          box.active = false;
          box.respawnTimer = 5;
          this.item = Math.random() < 0.5 ? 'boost' : 'banana';
        }
      }
    }
    if (this.itemCooldown > 0) this.itemCooldown -= dt;

    // Use item.
    if (this.input.useItem && this.item) {
      if (this.item === 'boost') {
        this.boostTimer = 1.4;
      } else if (this.item === 'banana') {
        const behind = this.angle + Math.PI;
        bananas.push({
          x: this.x + Math.cos(behind) * 35,
          y: this.y + Math.sin(behind) * 35,
          owner: this.slot,
          armTimer: 0.4,
        });
      }
      this.item = null;
      this.itemCooldown = 0.3;
    }
    this.input.useItem = false;

    // Banana collisions.
    for (const b of bananas) {
      if (b.armTimer > 0) continue;
      if (b.owner === this.slot) continue;
      if (Math.hypot(b.x - this.x, b.y - this.y) < 30) {
        b.hit = true;
        this.stunTimer = 1.0;
        this.speed *= 0.2;
      }
    }

    // Simple kart-kart push-apart. Karts that have already finished sit
    // parked at the finish line — treat them as ghosts so a kart still
    // racing can never get wedged against one and stall forever.
    for (const other of others) {
      if (other === this || other.finished) continue;
      const dx = this.x - other.x;
      const dy = this.y - other.y;
      const dist = Math.hypot(dx, dy);
      if (dist > 0 && dist < 34) {
        const push = (34 - dist) / 2;
        const nx = dx / dist;
        const ny = dy / dist;
        this.x += nx * push;
        this.y += ny * push;
      }
    }
  }
}
