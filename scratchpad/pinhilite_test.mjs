// Node harness for RIG PRESELECTION in src/editing/Skeleton.js.
//
// This exists because a highlight that is computed correctly and cannot be SEEN looks exactly
// like a highlight that was never computed. The pin markers had been writing HILITE_COLOR into
// `material.color` the whole time, on a material with vertexColors on — so the yellow was
// multiplied into a pure red axis, a pure green one and a pure blue one, and lifted none of
// them. Every value in the code was right and nothing changed on screen.
//
// So the checks below EVALUATE the drawing code rather than matching its spelling: the block is
// lifted from the real source and run against fake meshes, and what is asserted is the material
// a hovered pin ends up rendering with.
//
// Run: node scratchpad/pinhilite_test.mjs   (from the repo root)
//
// Defect injections (standing lesson 1):
//   PIN_INJECT=tintonly   the highlight goes back to being a tint on the axis-coloured
//                         material — the exact bug, and one no colour check would catch
//   PIN_INJECT=jointgrow  joint preselection grows the sphere again as well as colouring it
import fs from 'fs';
import path from 'path';

const REPO = '/Users/mattestela/sculptxr';
let SRC = fs.readFileSync(path.join(REPO, 'src/editing/Skeleton.js'), 'utf8');

{
  const inj = process.env.PIN_INJECT || '';
  if (inj === 'tintonly') {
    const a = '        const wantMat = (pinHandColor || pinHot) ? o.userData.plainMat : o.userData.vcMat;';
    if (!SRC.includes(a)) throw new Error('inject tintonly: anchor moved');
    SRC = SRC.replace(a, '        const wantMat = o.userData.vcMat;');
  } else if (inj === 'jointgrow') {
    const a = '      o.scale.setScalar(isSel ? jr * 1.7 : jr);';
    if (!SRC.includes(a)) throw new Error('inject jointgrow: anchor moved');
    SRC = SRC.replace(a, '      o.scale.setScalar(isHi || isSel ? jr * 1.7 : jr);');
  }
}

let failures = 0;
const check = (n, ok, d) => { if (ok) return console.log('  ok   ' + n);
  failures++; console.log('  FAIL ' + n + (d ? '  ' + d : '')); };

// Lift a brace-balanced block starting at the line that contains `head`.
function lift(head) {
  const i = SRC.indexOf(head);
  if (i < 0) throw new Error('lift: anchor moved: ' + head);
  let depth = 0;
  for (let k = SRC.indexOf('{', i); k < SRC.length; k++) {
    if (SRC[k] === '{') depth++;
    else if (SRC[k] === '}' && --depth === 0) return SRC.slice(i, k + 1);
  }
  throw new Error('lift: unbalanced: ' + head);
}

// ── the pin marker draw, evaluated ───────────────────────────────────────────
{
  const block = lift('      for (const o of [part.solid, part.ghost]) {');
  // Lifted, not copied. A harness holding its own copy of a colour reports a deliberate
  // repaint as a regression, which is how three of these checks broke last time.
  const constOf = (name) => {
    const m = new RegExp('^const ' + name + ' = (0x[0-9a-fA-F]+);', 'm').exec(SRC);
    if (!m) throw new Error('constant moved: ' + name);
    return parseInt(m[1], 16);
  };
  const HILITE_COLOR = constOf('HILITE_COLOR');
  const PIN_POS_COLOR = constOf('PIN_POS_COLOR');
  const PIN_FULL_COLOR = constOf('PIN_FULL_COLOR');
  const PIN_SOFT_COLOR = constOf('PIN_SOFT_COLOR');

  // The smallest thing that answers to what the block touches. `material` is swappable, which
  // is the property under test: the block must be free to put a different one on.
  const mkMesh = (vertexColored) => {
    const vcMat = { vertexColors: vertexColored, color: { hex: 0xffffff, setHex(h) { this.hex = h; } } };
    const plainMat = vertexColored
      ? { vertexColors: false, color: { hex: 0xffffff, setHex(h) { this.hex = h; } } }
      : vcMat;
    return {
      material: vcMat, userData: { vcMat, plainMat }, visible: false,
      position: { copy() {} }, quaternion: { copy() {} }, scale: { setScalar() {} },
      updateMatrix() {}, matrixWorldNeedsUpdate: false,
    };
  };

  const draw = ({ pinHot = false, pinHandColor = null, pinMode = 1, vertexColored = true }) => {
    const part = { solid: mkMesh(vertexColored), ghost: mkMesh(vertexColored) };
    const on = true, size = 1;
    const _vPin = {}, _qPin = {};
    // eslint-disable-next-line no-new-func
    const run = new Function('part', 'on', 'size', '_vPin', '_qPin', 'pinHot', 'pinHandColor',
      'pinMode', 'HILITE_COLOR', 'PIN_POS_COLOR', 'PIN_FULL_COLOR', 'PIN_SOFT_COLOR', block);
    run(part, on, size, _vPin, _qPin, pinHot, pinHandColor, pinMode,
      HILITE_COLOR, PIN_POS_COLOR, PIN_FULL_COLOR, PIN_SOFT_COLOR);
    return part.solid;
  };

  // THE ACTUAL BUG. Not "is the colour yellow" — it always was — but "can that yellow show".
  const hot = draw({ pinHot: true });
  check('a hovered pin renders with vertex colours OFF, so the highlight can be seen',
    hot.material.vertexColors === false,
    'the axis colours multiply the highlight away: yellow leaves red red and green green');
  check('...and it is the highlight colour', hot.material.color.hex === HILITE_COLOR,
    'got 0x' + hot.material.color.hex.toString(16));

  // The other half: an idle pin must keep its axis colouring, or the triad stops reading as
  // three axes and the mode tint has nothing to tint.
  const idle = draw({ pinHot: false, pinMode: 1 });
  check('an idle pin keeps its axis colours', idle.material.vertexColors === true);
  check('...tinted by its mode', idle.material.color.hex === PIN_POS_COLOR,
    'got 0x' + idle.material.color.hex.toString(16));
  check('a 6DOF pin tints differently from a position one',
    draw({ pinMode: 2 }).material.color.hex === PIN_FULL_COLOR
      && PIN_FULL_COLOR !== PIN_POS_COLOR);
  check('and a rotation-only pin tints as the 6DOF one does',
    draw({ pinMode: 4 }).material.color.hex === PIN_FULL_COLOR,
    'it is the same hold minus a half, and the colour says held');

  // A grabbed pin wears its hand colour, and that is a flat colour for exactly the same reason.
  const grabbed = draw({ pinHandColor: 0x00ff00 });
  check('a grabbed pin also drops the axis colours for its hand colour',
    grabbed.material.vertexColors === false && grabbed.material.color.hex === 0x00ff00);

  // The steering marker is flat already, so there is nothing to swap and nothing to break.
  const soft = draw({ pinHot: true, pinMode: 3, vertexColored: false });
  check('a flat marker needs no swap and still highlights',
    soft.material.vertexColors === false && soft.material.color.hex === HILITE_COLOR);
}

// ── the highlight material actually exists on the mesh ───────────────────────
//
// The block above trusts `o.userData.plainMat` to be there. If makePinPart stopped building it
// the draw would fall back to `undefined` and silently keep the axis material, which is the bug
// again by a different route.
{
  const block = lift('function makePinPart(');
  const made = [];
  const makePair = () => {
    const mk = () => ({ material: { vertexColors: false, needsUpdate: false,
      clone() { return { ...this, color: {} }; } }, userData: {}, renderOrder: 0 });
    const p = { solid: mk(), ghost: mk() };
    made.push(p);
    return p;
  };
  // eslint-disable-next-line no-new-func
  const makePinPart = new Function('makePair', block + '; return makePinPart;')(makePair);

  const triad = makePinPart({}, true);
  for (const o of [triad.solid, triad.ghost]) {
    check('a vertex-coloured pin part carries both materials',
      !!o.userData.vcMat && !!o.userData.plainMat && o.userData.vcMat !== o.userData.plainMat);
    check('...the axis one keeps vertex colours', o.userData.vcMat.vertexColors === true);
    check('...and the highlight one does not', o.userData.plainMat.vertexColors === false);
  }
  const flat = makePinPart({}, false);
  check('a flat pin part points both at the one material it has',
    flat.solid.userData.vcMat === flat.solid.userData.plainMat,
    'cloning one for nothing would be a second shader compile for no visible difference');
}

// ── joint preselection is colour only ────────────────────────────────────────
//
// A joint sphere that grows under the cursor makes the whole rig appear to breathe as the hand
// sweeps across it, and size already means something here: the joint radius.
{
  const m = /o\.scale\.setScalar\((.+?)\);/.exec(SRC.slice(SRC.indexOf('const isHi = hiAll.has(id);')));
  check('the joint scale expression is liftable', !!m, 'the placement code moved');
  if (m) {
    // eslint-disable-next-line no-new-func
    const scaleOf = new Function('isHi', 'isSel', 'jr', 'return (' + m[1] + ');');
    check('hovering a joint does not change its size', scaleOf(true, false, 1) === 1,
      'got ' + scaleOf(true, false, 1));
    check('...and neither does hovering a selected one', scaleOf(true, true, 1) === scaleOf(false, true, 1));
    check('outliner selection still scales, since that is a state you set and leave',
      scaleOf(false, true, 1) > 1);
  }
}

console.log(failures ? `\n${failures} FAILURE(S)` : '\nall checks passed');
process.exit(failures ? 1 : 0);
