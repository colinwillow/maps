// Street furniture, built as merged low-poly geometry rather than instanced.
//
// Instancing is the reflex answer and it is the wrong one HERE: there are
// twenty-two kinds, and one InstancedMesh per kind per chunk is twenty-two
// draw calls for a few hundred triangles each. Merged, a whole chunk's
// furniture -- six hundred objects -- is ONE call. The trade is that a prop
// cannot move, and none of these do.
//
// Every prop is built to be read at twenty metres from a phone. A tree is
// fourteen triangles because at that distance the silhouette is the whole of
// what you see, and a thousand-triangle tree is nine hundred and eighty-six
// triangles of nothing.

import { Soup } from './build.js';
import { PROP, PROP_DEFAULT, LEAF_TINTS, CAR_COLORS } from './tune.js';

const rgb = (h) => [(h >> 16) & 255, (h >> 8) & 255, h & 255];
const mul = (c, k) => [Math.min(255, c[0]*k)|0, Math.min(255, c[1]*k)|0, Math.min(255, c[2]*k)|0];

// EVERY FACE IN HERE IS WOUND SO ITS DERIVED NORMAL POINTS OUT OF THE SOLID,
// and all three primitives below had it backwards in the first build. Nothing
// LOOKED broken: a back-faced post is culled on the near side and you see its
// far side instead, which for a thin cylinder is the same silhouette -- so what
// it actually costs is the LIGHTING, every lamp post and tree trunk and parked
// car in the city lit from the inside. `Soup.tri` derives the normal from the
// winding precisely so there is one thing to get right; getting it right needs
// a test that cannot be satisfied by a plausible picture, which is why
// tests/pdx-runtime.test.mjs measures the enclosed VOLUME (the divergence
// theorem: a closed surface with outward normals integrates to +3V, and an
// inside-out one to -3V). A count or a bounding box cannot see it at all.
function box(s, x, y, z, hx, hy, hz, yaw, c) {
  const ca = Math.cos(yaw), sa = Math.sin(yaw);
  const P = (dx, dy, dz) => [x + dx*ca - dz*sa, y + dy, z + dx*sa + dz*ca];
  const a=P(-hx,0,-hz), b=P(hx,0,-hz), cc=P(hx,0,hz), d=P(-hx,0,hz);
  const e=P(-hx,hy*2,-hz), f=P(hx,hy*2,-hz), g=P(hx,hy*2,hz), h=P(-hx,hy*2,hz);
  const dk = mul(c, 0.84), lt = mul(c, 1.03);
  s.quad(h,g,f,e, lt,lt,lt,lt);                    // top
  s.quad(e,f,b,a, c,c,c,c);                        // -z
  s.quad(f,g,cc,b, dk,dk,dk,dk);                   // +x
  s.quad(g,h,d,cc, c,c,c,c);                       // +z
  s.quad(h,e,a,d, dk,dk,dk,dk);                    // -x
}

function cylinder(s, x, y, z, r, h, sides, c) {
  const dk = mul(c, 0.8);
  for (let i = 0; i < sides; i++) {
    const a0 = i / sides * Math.PI * 2, a1 = (i + 1) / sides * Math.PI * 2;
    const x0 = x + Math.cos(a0)*r, z0 = z + Math.sin(a0)*r;
    const x1 = x + Math.cos(a1)*r, z1 = z + Math.sin(a1)*r;
    const shade = 0.78 + 0.32 * (0.5 + 0.5*Math.cos(a0 - 0.9));
    const cs = mul(c, shade);
    s.quad([x1,y,z1], [x0,y,z0], [x0,y+h,z0], [x1,y+h,z1], cs, cs, cs, cs);
  }
}

function cone(s, x, y, z, r, h, sides, c) {
  for (let i = 0; i < sides; i++) {
    const a0 = i / sides * Math.PI * 2, a1 = (i + 1) / sides * Math.PI * 2;
    const shade = 0.72 + 0.4 * (0.5 + 0.5*Math.cos(a0 - 0.9));
    const cs = mul(c, shade);
    s.tri(x + Math.cos(a1)*r, y, z + Math.sin(a1)*r,
          x + Math.cos(a0)*r, y, z + Math.sin(a0)*r,
          x, y + h, z, cs[0], cs[1], cs[2]);
  }
}

// A CROWN IS SEEN FROM UNDERNEATH, and that is the whole design constraint.
// The eye is at 1.7 m and the canopy starts at five: what you look at all day
// is the UNDERSIDE. A squashed octahedron -- the obvious cheap blob -- has a
// point down there, so from the pavement every street tree read as a cone
// hanging nose-down, which is exactly what the first build looked like. The
// bottom is nearly FLAT now and the silhouette is carried by two irregular
// rings instead: twenty triangles, and it reads as a tree from below, from
// across the street and from a roof.
function blob(s, x, y, z, rx, ry, c, seed) {
  const top = [x, y + ry, z];
  const bot = [x, y - ry * 0.18, z];
  const N = 5;
  const lo = [], hi = [];
  for (let i = 0; i < N; i++) {
    const a = i / N * Math.PI * 2 + seed * 3.1;
    // Irregular radii, deterministic on the seed: a crown that is a perfect
    // pentagon reads as a prop, and a street of them reads as wallpaper.
    const j = 0.78 + 0.44 * ((Math.sin(a * 3 + seed * 11) + 1) * 0.5);
    lo.push([x + Math.cos(a) * rx * j * 0.82, y - ry * 0.06, z + Math.sin(a) * rx * j * 0.82]);
    hi.push([x + Math.cos(a + 0.35) * rx * j, y + ry * 0.42, z + Math.sin(a + 0.35) * rx * j]);
  }
  const shade = (i) => 0.72 + 0.42 * (0.5 + 0.5 * Math.cos(i / N * 6.283 - 0.9));
  for (let i = 0; i < N; i++) {
    const j = (i + 1) % N;
    const m = mul(c, shade(i));
    // Angle INCREASES with i, and in (x, -z) -- the frame "seen from above" --
    // that runs CLOCKWISE, so the ring has to be walked backwards for an
    // outward normal. triC takes FLAT coordinates and quad() takes points;
    // passing arrays to triC is a silent `undefined[0]` five frames into boot.
    s.quad(lo[j], lo[i], hi[i], hi[j], mul(m, 0.8), mul(m, 0.8), m, m);
    s.triC(hi[j][0], hi[j][1], hi[j][2], hi[i][0], hi[i][1], hi[i][2],
           top[0], top[1], top[2], m, m, mul(c, 1.2));
    s.triC(lo[i][0], lo[i][1], lo[i][2], lo[j][0], lo[j][1], lo[j][2],
           bot[0], bot[1], bot[2], mul(c, 0.52), mul(c, 0.52), mul(c, 0.46));
  }
}

export function buildProps(prop, classNames, lod) {
  const s = new Soup(2048);
  if (!prop) return s.done();
  const near = lod === 'full';
  for (let i = 0; i < prop.n; i++) {
    const name = classNames[prop.kind[i]];
    const look = PROP[name] || PROP_DEFAULT;
    const x = prop.pos[i*3], z = prop.pos[i*3+1], y = prop.pos[i*3+2];
    const sc = prop.scale[i], yaw = prop.yaw[i], tint = prop.tint[i];
    const c = rgb(look.c);
    const h = look.h * sc;
    switch (look.kind) {
      case 'broadleaf': {
        // Trunk to just under the crown, crown OVERLAPPING it. A crown that
        // starts where the trunk stops leaves a visible gap of daylight, and a
        // street tree read from six metres is mostly that join.
        const leaf = rgb(LEAF_TINTS[tint % LEAF_TINTS.length]);
        cylinder(s, x, y, z, 0.13 * sc, h * 0.52, 5, rgb(look.trunk));
        blob(s, x, y + h * 0.72, z, h * 0.29, h * 0.30, leaf, prop.yaw[i]);
        break;
      }
      case 'conifer': {
        // A Douglas fir is TALL AND NARROW -- a quarter of its height in radius
        // is a Christmas tree, and a street of them reads as a garden centre.
        // Three stacked cones, each narrower and shorter than the one below.
        const leaf = rgb(look.c);
        cylinder(s, x, y, z, 0.11 * sc, h * 0.26, 5, rgb(look.trunk));
        cone(s, x, y + h * 0.17, z, h * 0.150, h * 0.40, 6, mul(leaf, 0.9));
        cone(s, x, y + h * 0.43, z, h * 0.120, h * 0.38, 6, leaf);
        cone(s, x, y + h * 0.67, z, h * 0.085, h * 0.35, 6, mul(leaf, 1.14));
        break;
      }
      case 'conifer_far':
        cone(s, x, y, z, h * 0.26, h, 4, rgb(look.c));
        break;
      case 'lamp': {
        if (!near) { cylinder(s, x, y, z, 0.09*sc, h, 4, c); break; }
        cylinder(s, x, y, z, 0.10 * sc, h, 5, c);
        const ax = Math.cos(yaw) * 1.05 * sc, az = Math.sin(yaw) * 1.05 * sc;
        box(s, x + ax*0.5, y + h - 0.16, z + az*0.5, 0.55*sc, 0.07, 0.07, yaw, mul(c,1.1));
        box(s, x + ax, y + h - 0.34, z + az, 0.26*sc, 0.10, 0.14*sc, yaw, [236, 228, 186]);
        break;
      }
      case 'signal': {
        cylinder(s, x, y, z, 0.09 * sc, h, 5, c);
        if (!near) break;
        box(s, x, y + h - 0.85, z, 0.16*sc, 0.42*sc, 0.16*sc, yaw, mul(c, 0.9));
        box(s, x, y + h - 0.35, z, 0.09*sc, 0.07, 0.09*sc, yaw, [214, 82, 56]);
        break;
      }
      case 'sign': {
        cylinder(s, x, y, z, 0.055 * sc, h, 4, [116, 118, 120]);
        box(s, x, y + h - 0.44, z, 0.33*sc, 0.30*sc, 0.035, yaw, c);
        break;
      }
      case 'bench': {
        box(s, x, y, z, 0.86*sc, h*0.5, 0.26*sc, yaw, c);
        if (near) box(s, x - Math.sin(yaw)*0.22*sc, y + h*0.5, z + Math.cos(yaw)*0.22*sc,
                      0.86*sc, h*0.42, 0.06, yaw, mul(c, 0.92));
        break;
      }
      case 'car': {
        // Two boxes and a dark strip. A parked car is read as a SILHOUETTE at
        // the kerb and as a splash of colour in a grey street -- wheels, mirrors
        // and glass are triangles that nobody at eye height ever resolves, and
        // there are thousands of these.
        const body = rgb(CAR_COLORS[tint % CAR_COLORS.length]);
        const len = 4.20 * sc, wid = 1.75 * sc;
        // A dark sill under the body instead of wheels: four cylinders is forty
        // triangles nobody resolves, and a car with a gap under it floats.
        box(s, x, y + 0.06, z, len * 0.47, 0.13, wid * 0.44, yaw, [38, 38, 40]);
        box(s, x, y + 0.32, z, len * 0.5, 0.27, wid * 0.5, yaw, body);
        const bx = Math.cos(yaw) * len * 0.10, bz = Math.sin(yaw) * len * 0.10;
        box(s, x - bx, y + 0.86, z - bz, len * 0.27, 0.21, wid * 0.42, yaw,
            mul(body, 0.80));
        break;
      }
      case 'post':  cylinder(s, x, y, z, 0.11 * sc, h, 5, c); break;
      case 'pole':  cylinder(s, x, y, z, 0.15 * sc, h, 5, c); break;
      case 'rack':
        if (near) { box(s, x, y, z, 0.5*sc, h*0.5, 0.05, yaw, c); }
        break;
      default:      box(s, x, y, z, 0.27*sc, h*0.5, 0.22*sc, yaw, c);
    }
  }
  return s.done();
}
