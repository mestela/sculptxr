// EyeCollide: lids pushed out of the eyes, sucked back on, upper never past lower, rest untouched,
// follows a look, oval eye ok, still eye (looks move only lids) ok.
// node scratchpad/eye_collide_test.mjs
//   EC_INJECT=push  skips the push-out: the penetration checks must fail
//   EC_INJECT=suck  skips the suck-on: the lift check must fail
//   EC_INJECT=meet  skips the lids-meet clamp: the overshoot check must fail
//   EC_INJECT=carry  stops carrying the edge's rise up the lid: the rows-in-order check must fail
//   EC_INJECT=meetknown skips the known-edge meet: the rig overshoot and fold checks must fail
//   EC_INJECT=front turns a fold in front of the lower lid like one behind it: the fold check must fail
import fs from 'node:fs';

const dir = new URL('../src/editing/', import.meta.url);
const sr = fs.readFileSync(new URL('ShapeRetarget.js', dir), 'utf8');
const lidsData = fs.readFileSync(new URL('gnmLids.js', dir), 'utf8');
let src = fs.readFileSync(new URL('EyeCollide.js', dir), 'utf8');
const inject = {
  push: ['if (g < k - eps) to =', 'if (false) to ='],
  suck: ['} else if (hug[n] > 0 && rules.suck) {', '} else if (false) {'],
  meet: ['if (!(EE < lo - 1e-4)) continue;', 'continue;'],
  front: ['w = (1 - smooth(th, 3 * th, d - rho - gap[n])) * hug[n]', 'w = hug[n]'],
  carry: ['rise[k] = src[k] >= 0 ? need[src[k]] * carry[k] : 0;', 'rise[k] = 0;'],
  meetknown: ['      meetKnown(eye, q, lids.length);', ''],
}[process.env.EC_INJECT];
if (inject) {
  if (!src.includes(inject[0])) throw new Error('anchor moved: ' + inject[0]);
  src = src.replace(inject[0], inject[1]);
}
// Copies beside each other in a temp dir, so the injected copy still finds ShapeRetarget.
const tmp = fs.mkdtempSync(new URL('./_ec_', import.meta.url).pathname);
fs.writeFileSync(`${tmp}/ShapeRetarget.js`, sr);
fs.writeFileSync(`${tmp}/gnmLids.js`, lidsData);
fs.writeFileSync(`${tmp}/EyeCollide.js`, src);
const { buildEyes, collide } = await import(`${tmp}/EyeCollide.js`);
fs.rmSync(tmp, { recursive: true });

let fails = 0;
const check = (name, ok, info = '') => { console.log(`${ok ? 'ok  ' : 'FAIL'} ${name} ${info}`); if (!ok) fails++; };
const D = Math.PI / 180;

const P = [], F = [];
// A grid over azimuth a (about +y, 0 = forward +z) and elevation e, radius R, x stretched by sx.
function patch(R, a0, a1, e0, e1, na, ne, sx) {
  const off = P.length / 3;
  for (let i = 0; i <= ne; i++) for (let j = 0; j <= na; j++) {
    const e = e0 + (e1 - e0) * i / ne, a = a0 + (a1 - a0) * j / na;
    P.push(sx * R * Math.cos(e) * Math.sin(a), R * Math.sin(e), R * Math.cos(e) * Math.cos(a));
  }
  for (let i = 0; i < ne; i++) for (let j = 0; j < na; j++) {
    const p = off + i * (na + 1) + j;
    F.push(p, p + 1, p + na + 2, p, p + na + 2, p + na + 1);
  }
  return [off, P.length / 3];
}
// Radius, elevation and azimuth in the unstretched eye, after undoing a look of `b` about x.
function ang(v, i, sx, b = 0) {
  const x = v[i * 3] / sx, y = v[i * 3 + 1], z = v[i * 3 + 2];
  const yy = y * Math.cos(b) + z * Math.sin(b), zz = -y * Math.sin(b) + z * Math.cos(b);
  return { e: Math.atan2(yy, Math.hypot(x, zz)), a: Math.atan2(x, zz), r: Math.hypot(x, yy, zz) };
}

function run(sx, still = false, rigged = false) {
  const tag = `sx${sx}${still ? ' still' : ''}${rigged ? ' rig' : ''}`;
  P.length = 0; F.length = 0;
  // Upper lid (the skin, biggest) above an opening at -12..+15 deg, lower lid below; eye radius 1.
  const [u0, u1] = patch(1.08, -85 * D, 85 * D, 15 * D, 75 * D, 48, 24, sx);
  const [w0, w1] = patch(1.08, -85 * D, 85 * D, -70 * D, -12 * D, 40, 20, sx);
  const [e0, e1] = patch(1, -180 * D, 180 * D, -90 * D, 90 * D, 32, 24, sx);   // closed at the poles
  // Known lids: the upper patch's bottom row and the lower patch's top row as the edge loops. The
  // lower edge row tucked INTO the eye at rest (radius 0.97): left out by the gap filter, kept by the rig.
  const row = (from, na, i) => Array.from({ length: na + 1 }, (_, j) => from + i * (na + 1) + j);
  const rig = rigged ? [{ upper: row(u0, 48, 0), lower: row(w0, 40, 20), socket: [] }] : null;
  if (rigged) for (const v of rig[0].lower) for (let c = 0; c < 3; c++) P[v * 3 + c] *= 0.97 / 1.08;
  const nv = P.length / 3, base = Float32Array.from(P), tris = Uint32Array.from(F);
  const isUp = (v) => v >= u0 && v < u1;

  const shape = (fn) => { const d = new Float32Array(nv * 3); fn(d); return d; };
  // squash: upper lid 30% toward the centre. lift: 0.05 off the eye. far: 0.6 off.
  const radial = (k) => (d) => { for (let v = u0; v < u1; v++) for (let c = 0; c < 3; c++) d[v * 3 + c] = k * base[v * 3 + c]; };
  // blink: the upper lid turned 35 deg down about x (+t turns the front down), past the lower lid's -12 deg edge.
  const turn = (t, from, to) => (d) => {
    for (let v = from; v < to; v++) {
      const y = base[v * 3 + 1], z = base[v * 3 + 2];
      d[v * 3 + 1] = y * Math.cos(t) - z * Math.sin(t) - y; d[v * 3 + 2] = y * Math.sin(t) + z * Math.cos(t) - z;
    }
  };
  const look = 20 * D;
  const lookUp = shape(still ? (d) => { for (let v = u0; v < u1; v++) d[v * 3 + 1] = 0.02; } : turn(look, e0, e1));
  const shapes = new Map([['eyeBlinkLeft', shape(turn(35 * D, u0, u1))], ['eyeLookUpLeft', lookUp],
    ['fold', shape((d) => {
      turn(35 * D, u0, u1)(d);   // then out along the TURNED direction, 0.4 off the eye
      for (let v = u0; v < u1; v++) for (let c = 0; c < 3; c++) d[v * 3 + c] = (base[v * 3 + c] + d[v * 3 + c]) * (1 + 0.4 / 1.08) - base[v * 3 + c];
    })],
    ['squash', shape(radial(-0.3))], ['lift', shape(radial(0.05 / 1.08))], ['far', shape(radial(0.6 / 1.08))]]);
  // bulge: one lower lid vertex AWAY from the edge (row 5) lifted to elevation 0, above the edge.
  shapes.set('bulge', shape((d) => { const v = w0 + 5 * 41 + 20, e = ang(base, v, sx); const R = Math.hypot(base[v * 3] / sx, base[v * 3 + 1], base[v * 3 + 2]);
    d[v * 3] = sx * R * Math.sin(e.a) - base[v * 3]; d[v * 3 + 1] = -base[v * 3 + 1]; d[v * 3 + 2] = R * Math.cos(e.a) - base[v * 3 + 2]; }));
  const state = buildEyes(base, tris, nv, shapes, rig);
  check(`${tag}: one eye found`, state && state.eyes.length === 1, state && `lids ${state.eyes[0]?.lids.length}`);
  if (!state) return;
  const eye = state.eyes[0];
  let wrong = 0;
  for (let n = 0; n < eye.lids.length; n++) if (eye.side[n] !== 0 && (eye.side[n] === 1) !== isUp(eye.lids[n])) wrong++;
  check(`${tag}: upper/lower split at the opening`, wrong === 0, `misfiled ${wrong}`);

  const pose = (w) => base.map((x, i) => { let y = x; for (const [n, k] of Object.entries(w)) y += k * shapes.get(n)[i]; return y; });
  const apply = (v) => { const d = new Float32Array(v.length); const n = collide(state, base, v, d); return [v.map((x, i) => x + d[i]), n]; };
  const depth = (v, b = 0) => { let w = 0; for (let i = u0; i < u1; i++) w = Math.max(w, 1 - ang(v, i, sx, b).r); return w; };

  if (rigged) {
    const have = new Set(eye.lids);
    check(`${tag}: the tucked-in edge is a lid`, rig[0].lower.every((v) => have.has(v)), `${rig[0].lower.filter((v) => have.has(v)).length}/${rig[0].lower.length}`);
  }
  const [, nRest] = apply(pose({}));
  check(`${tag}: rest pose untouched`, nRest === 0, `moved ${nRest}`);

  const raw = pose({ squash: 1 }), [hit] = apply(raw);
  check(`${tag}: squash pushed out`, depth(raw) > 0.1 && depth(hit) < 0.03, `${depth(raw).toFixed(3)} -> ${depth(hit).toFixed(4)}`);
  const b = still ? 0 : look;
  const rawL = pose({ squash: 0.85, eyeLookUpLeft: 1 }), [hitL] = apply(rawL);
  check(`${tag}: squash + look pushed out of the turned eye`, depth(hitL, b) < 0.03, `${depth(rawL, b).toFixed(3)} -> ${depth(hitL, b).toFixed(4)}`);

  // Suck on: a hugging lid lifted 0.05 goes back toward its rest gap (0.08); lifted 0.6 is left.
  const gapOf = (v) => { let m = 0, n = 0; for (let i = u0; i < u1; i++) { const a = ang(v, i, sx); if (Math.abs(a.a) < 60 * D && a.e < 40 * D) { m += a.r - 1; n++; } } return m / n; };
  const liftRaw = pose({ lift: 1 }), [lifted] = apply(liftRaw);
  check(`${tag}: a lifted lid is sucked back on`, gapOf(lifted) < 0.095, `gap ${gapOf(liftRaw).toFixed(3)} -> ${gapOf(lifted).toFixed(3)} (rest ${gapOf(base).toFixed(3)})`);
  const farRaw = pose({ far: 1 }), [farHit] = apply(farRaw);
  check(`${tag}: a lid lifted far is left alone`, Math.abs(gapOf(farHit) - gapOf(farRaw)) < 1e-3, `gap ${gapOf(farRaw).toFixed(3)} -> ${gapOf(farHit).toFixed(3)}`);

  // Lids meet: an overdriven blink stops on the lower lid's edge; a half blink is untouched.
  const lowEdge = (v) => { let m = -Infinity; for (let i = w0; i < w1; i++) { const a = ang(v, i, sx); if (Math.abs(a.a) < 60 * D) m = Math.max(m, a.e); } return m; };
  const upMin = (v) => { let m = Infinity; for (let i = u0; i < u1; i++) { const a = ang(v, i, sx); if (Math.abs(a.a) < 60 * D) m = Math.min(m, a.e); } return m; };
  // How far the upper lid's edge row sits below the lower lid's edge row AT THE SAME AZIMUTH (the
  // lids may meet halfway only where they cross, so the global min and max are not comparable).
  const crossing = (v) => {
    let worst = -Infinity;
    for (let j = 0; j <= 48; j++) {
      const a = ang(v, u0 + j, sx);
      if (Math.abs(a.a) >= 60 * D) continue;
      let lo = -Infinity, best = Infinity;
      for (let i = 0; i <= 40; i++) { const b = ang(v, w0 + 20 * 41 + i, sx), da = Math.abs(b.a - a.a); if (da < best) { best = da; lo = b.e; } }
      worst = Math.max(worst, lo - a.e);
    }
    return worst;
  };
  const blinkRaw = pose({ eyeBlinkLeft: 1 }), [blinkHit] = apply(blinkRaw);
  check(`${tag}: overdriven blink stops on the lower lid`, crossing(blinkHit) <= 1 * D,
    `upper below lower by ${(crossing(blinkRaw) / D).toFixed(1)} -> ${(crossing(blinkHit) / D).toFixed(1)} deg`);
  // A fold: the upper lid down past the lower one but hanging 0.4 IN FRONT of it (brow down over a
  // squint). Left where it is -- turning it up above the edge opened the eye.
  const foldRaw = pose({ fold: 1 }), [foldHit] = apply(foldRaw);
  let foldTurn = 0;
  for (let i = u0; i < u1; i++) foldTurn = Math.max(foldTurn, Math.abs(ang(foldHit, i, sx).e - ang(foldRaw, i, sx).e));
  if (!rigged) check(`${tag}: a fold in front of the lower lid is left hanging`, foldTurn < 0.5 * D && upMin(foldHit) < lowEdge(foldHit) - 5 * D, `max turn ${(foldTurn / D).toFixed(2)} deg, upper ${(upMin(foldHit) / D).toFixed(1)} lower edge ${(lowEdge(foldHit) / D).toFixed(1)}`);
  // Known lids: the upper lid closes ONTO the lower one, fold and all (matt's square_anim_eyes,
  // frame 30), and lifts as a sheet: its rows stay in order up the lid, at least 0.25 deg apart
  // (rest spacing 2.5 deg) -- without the carry they pile onto the edge.
  const inOrder = (v) => { let bad = 0; for (let i = 0; i < 24; i++) for (let j = 8; j <= 40; j++) { const a = u0 + i * 49 + j; if (ang(v, a + 49, sx).e < ang(v, a, sx).e + 0.25 * D) bad++; } return bad; };
  if (rigged) {
    check(`${tag}: a fold closes onto the lower lid`, crossing(foldHit) <= 1 * D, `upper below lower by ${(crossing(foldRaw) / D).toFixed(1)} -> ${(crossing(foldHit) / D).toFixed(1)} deg`);
    check(`${tag}: the closed lid's rows stay in order`, inOrder(foldHit) === 0 && inOrder(apply(pose({ eyeBlinkLeft: 1 }))[0]) === 0, `out of order ${inOrder(foldHit)} fold, ${inOrder(apply(pose({ eyeBlinkLeft: 1 }))[0])} blink`);
  }

  if (rigged) {
    // With known lids the lower edge is the loop, so a lower lid vertex bulging above it elsewhere
    // does not turn the upper lid.
    const hb = pose({ eyeBlinkLeft: 0.5, bulge: 1 }), [hbHit] = apply(hb);
    let t = 0;
    for (let i = u0; i < u1; i++) t = Math.max(t, Math.abs(ang(hbHit, i, sx).e - ang(hb, i, sx).e));
    check(`${tag}: a bulge off the edge does not move the upper lid`, t < 1e-4, `max turn ${(t / D).toFixed(3)} deg`);
  }

  // A half blink stays clear of the lower lid, so no lid is turned (the radial push still lifts
  // it: a linearly blended turn passes INSIDE the arc, 1.03 against 1.08 here, and that is the point).
  const half = pose({ eyeBlinkLeft: 0.5 }), [halfHit] = apply(half);
  let turned = 0;
  for (let i = u0; i < u1; i++) turned = Math.max(turned, Math.abs(ang(halfHit, i, sx).e - ang(half, i, sx).e));
  check(`${tag}: half blink (clear of the lower lid) is not turned`, turned < 1e-4, `max turn ${(turned / D).toFixed(4)} deg`);
}
run(1);
run(1.3);
run(1, true);
run(1, false, true);
console.log(fails ? `${fails} FAILED` : 'all checks passed');
process.exit(fails ? 1 : 0);
