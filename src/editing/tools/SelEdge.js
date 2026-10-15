import SelLoop from './SelLoop.js';

// SEL EDGE: Sel Loop for one edge -- the same preselect, tap toggles the edge under the cursor
// (and its mirror with symmetry on) in the shared edge selection that Bevel reads.
class SelEdge extends SelLoop {
  _edgesFrom(adj, a, b) {
    return [[a, b]];
  }
}

export default SelEdge;
