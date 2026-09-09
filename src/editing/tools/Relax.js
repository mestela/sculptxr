import Smooth from './Smooth.js';

class Relax extends Smooth {

  constructor(main) {
    super(main);
    
    // Default to tangential smoothing (Relaxation) instead of volume shrinking
    this._tangent = true;
    // THREE PASSES, BECAUSE ONE TANGENTIAL STEP IS A SMALL STEP. Relax moves each vertex towards
    // its neighbours' average with the normal component removed — a convergent step that cannot
    // overshoot, so the way to relax more is to run it again rather than to push the intensity
    // past the point where it oscillates. matt: "relax doesn't relax enough."
    //
    // Three is where the sliver quads on a low-poly tube visibly even out while a stroke still
    // costs about what it did; the number is a property of the tool, so a heavier relax is a
    // stroke more rather than a setting to find.
    this._passes = 3;
  }

}

export default Relax;
