// A follow camera with a horizontal orbit, and nothing else on the right thumb.
//
// The orbit is a RATE, not a position: deflection sets how fast the view turns.
// Reading the stick's absolute direction instead means small pushes do nothing
// and the rim snaps the whole view round at once -- Robits shipped that and
// wrote it down, twice.
//
// The boom SHORTENS against geometry rather than lifting over it. Lifting is
// the reflex fix and it turns the shot into the top-down one you were trying to
// avoid: the fix and the bug are the same mechanism. Snap in, ease out -- easing
// in is time spent inside a wall.

import { CAM, MOVE } from './tune.js';

export class Camera {
  constructor(cam) {
    this.cam = cam;
    this.az = 0;              // bearing the lens LOOKS along
    this.pitch = CAM.pitch;
    this.dist = CAM.dist;
    this.have = CAM.dist;
    this.lx = 0; this.ly = 0; this.lz = 0;
    this.high = false;
  }

  toggleHigh() { this.high = !this.high; }

  step(dt, p, look, ground) {
    const t = Math.abs(look.x) < 0.09 ? 0 : (look.x - Math.sign(look.x) * 0.09) / 0.91;
    this.az += t * CAM.orbitRate * dt;
    const wantPitch = this.high ? CAM.pitchHi : CAM.pitch;
    this.pitch += (wantPitch - this.pitch) * (1 - Math.pow(2, -dt / 0.25));

    const tx = p.x, ty = p.y + CAM.height, tz = p.z;
    const k = 1 - Math.pow(2, -dt / CAM.lookHL);
    this.lx += (tx - this.lx) * k; this.ly += (ty - this.ly) * k; this.lz += (tz - this.lz) * k;

    const ca = Math.cos(this.pitch);
    const bx = -Math.sin(this.az) * ca, bz = Math.cos(this.az) * ca, by = Math.sin(this.pitch);
    const free = this.probe(ground, this.lx, this.ly, this.lz, bx, by, bz, CAM.dist);
    // Snap in, ease out.
    this.have = free < this.have ? free
      : this.have + (free - this.have) * (1 - Math.pow(2, -dt / 0.5));
    const d = Math.max(CAM.minDist, this.have);
    this.cam.position.set(this.lx + bx * d, this.ly + by * d, this.lz + bz * d);
    this.cam.lookAt(this.lx, this.ly, this.lz);
  }

  probe(ground, x, y, z, bx, by, bz, max) {
    // Walked, not raycast, and coarse on purpose: the city is tens of thousands
    // of boxes in a hash, so a dozen lookups beats any ray structure, and a lens
    // clipping a lamp post for an instant is not the failure a lens inside a
    // building is.
    let last = 0;
    for (let d = CAM.probe; d <= max; d += CAM.probe) {
      const px = x + bx * d, pz = z + bz * d, py = y + by * d;
      const r = ground.resolve(px, pz, py, 0.34);
      const under = ground.terrainAt(px, pz) + 0.55;
      if (r[2] || py < under) {
        // Bisect: a boom quantised to the probe step JUMPS sixty centimetres at
        // a time as the shot sways past a wall, which reads as the camera
        // popping. Four more lookups make the number continuous.
        let lo = last, hi = d;
        for (let i = 0; i < 4; i++) {
          const m = (lo + hi) * 0.5;
          const q = ground.resolve(x + bx * m, z + bz * m, y + by * m, 0.34);
          if (q[2] || (y + by * m) < ground.terrainAt(x + bx * m, z + bz * m) + 0.55) hi = m;
          else lo = m;
        }
        return lo;
      }
      last = d;
    }
    return max;
  }
}
