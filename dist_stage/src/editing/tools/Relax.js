import Smooth from './Smooth.js';

class Relax extends Smooth {

  constructor(main) {
    super(main);
    
    // Default to tangential smoothing (Relaxation) instead of volume shrinking
    this._tangent = true; 
  }

}

export default Relax;
