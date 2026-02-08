class Buffer {

  constructor(gl, type, hint, tag = "Untagged") {
    this._gl = gl; // webgl context
    this._buffer = gl.createBuffer(); // the buffer
    this._type = type; // the type (vert data vs index)
    this._hint = hint; //the buffer update hint
    this._size = 0; // the size of the buffer
    this._tag = tag;
  }

  bind() {
    if (!this._buffer) this._buffer = this._gl.createBuffer();
    this._gl.bindBuffer(this._type, this._buffer);
  }

  release() {
    this._gl.deleteBuffer(this._buffer);
    this._buffer = null;
    this._size = 0;
  }

  update(data, nbElts) {
    if (!data) return; // Safety check
    this.bind();

    // OPTIMIZATION: Removed gl.getError loop (Caused 85ms stalls in VR)
    // while (this._gl.getError() !== this._gl.NO_ERROR) { };

    if (nbElts !== undefined && nbElts !== data.length)
      data = data.subarray(0, nbElts);

    if (data.length > this._size) {
      this._gl.bufferData(this._type, data, this._hint);
      this._size = data.length;
    } else {
      this._gl.bufferSubData(this._type, 0, data);
    }

    // var err = this._gl.getError();
    // if (err !== this._gl.NO_ERROR) { ... }
  }
}

export default Buffer;
