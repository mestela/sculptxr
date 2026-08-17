// Nomad Link client (protocol v1) over a browser WebSocket.
//
// Nomad's host accepts a WebSocket upgrade directly, so there is no relay: the
// page dials the device running Nomad. From an https page the browser may show a
// one-time local-network permission prompt. Connecting before entering VR was
// advised on the theory that the prompt cannot be answered inside an immersive
// session; in practice connecting from inside VR works (Galaxy XR, 2026-08-15),
// so it is a precaution, not a requirement, and the panel no longer says otherwise.
//
// Framing (identical on the wire to the raw-TCP transport Nomad's other bridges
// use): uint32 json length, uint32 binary length, the JSON header, the blob.
// A WebSocket message may carry part of a packet or several, so bytes are
// buffered and drained rather than parsed per message.

import NomadCodec from './NomadCodec.js';

var PROTOCOL = 1;
var DEFAULT_PORT = 48312;
var CLIENT_NAME = 'SculptXR';
var BRIDGE_VERSION = '0.11.35';
var PING_INTERVAL = 10000;
// Silence required before a recovery request is safe to send. The risk of going
// too low is real — asking mid-transfer makes Nomad restart the scene from the
// beginning, which loops — so this is a latency/robustness dial, not free. The
// Houdini bridge uses a very conservative 10s; 3s is comfortably longer than the
// gaps seen between packets of a single transfer on a LAN. If restarts reappear
// (the same mesh arriving over and over), put this back up.
var DEFER_QUIET = 3000;
var TICK = 1000;
// Chatter that says nothing about whether a transfer is still streaming.
var QUIET_EXEMPT = { camera: true, ping: true, pong: true };
var TOKEN_KEY = 'sculptxr_nomad_tokens';

function newId() {
  if (window.crypto && window.crypto.randomUUID) return window.crypto.randomUUID();
  return 'sxr-' + Date.now().toString(16) + '-' + Math.random().toString(16).slice(2);
}

// What we can honestly handle today: we receive geometry, whole or as per-stroke
// deltas. Deliberately no 'ngon' — SculptXR is tris and quads only, so letting
// Nomad know keeps it from sending corner-format faces we would have to fan.
// 'scene_edits' is what makes Nomad stream live edits at all: MEASURED on the wire
// (2026-08-15) — without it, request_scene still works but not a single mesh_delta
// ever arrives while sculpting. Do not trim it as "we don't send edits"; it means
// "this peer understands live edit messages", which is how we receive them.
var CAPABILITIES = [
  'selection_transfer',
  'scene_transfer',
  'scene_edits',
  'object_state',
  'session_config',
  'mesh_delta_receive'
];

class NomadLink {

  constructor() {
    this._socket = null;
    this._host = '';
    this._port = DEFAULT_PORT;
    this._buffer = new Uint8Array(0);
    this._pingTimer = 0;
    this._status = 'disconnected';
    this._message = 'Disconnected';
    this._peerCapabilities = [];
    this._sessionConfig = null;
    this._deferred = [];        // recovery requests waiting for the transfer to finish
    this._pendingInstances = []; // instance headers whose geometry has not arrived
    this._haveMesh = {};        // mesh ids whose geometry has arrived
    this._haveGeometry = {};    // geometry ids we hold, under any mesh id
    this._quietSince = 0;       // when the last packet arrived
    this._activeSource = '';    // which side Nomad currently accepts live edits from
    this._claimPending = false;

    // Consumers assign these.
    this.onStatus = null;   // (status, message) => void
    this.onMesh = null;     // (decodedMesh, header) => void
    this.onDelta = null;    // (decodedDelta) => bool, false when it could not be applied
    this.onInstance = null; // (header) => bool, false when the geometry is not here yet
    this.onObjectDelete = null; // (nomadMeshId) => void, Nomad deleted an object
    this.onAck = null;      // (header) => void, Nomad accepted a mesh we sent
    this.onLog = null;      // (text) => void
  }

  getStatus() { return this._status; }
  getMessage() { return this._message; }
  isConnected() { return this._status === 'connected'; }
  peerHas(capability) { return this._peerCapabilities.indexOf(capability) !== -1; }

  _log(text) {
    if (this.onLog) this.onLog(text);
    else console.log('[NomadLink] ' + text);
  }

  _setStatus(status, message) {
    this._status = status;
    this._message = message;
    if (this.onStatus) this.onStatus(status, message);
  }

  // ---------------------------------------------------------------- tokens

  _loadTokens() {
    try { return JSON.parse(window.localStorage.getItem(TOKEN_KEY)) || {}; }
    catch (e) { return {}; }
  }

  _saveToken(host, token) {
    var tokens = this._loadTokens();
    tokens[host] = token;
    try { window.localStorage.setItem(TOKEN_KEY, JSON.stringify(tokens)); }
    catch (e) { /* private browsing: pair again next time */ }
  }

  // ------------------------------------------------------------- lifecycle

  // Why a connection most likely failed, when the browser will not say.
  //
  // The case worth calling out is iOS. EVERY browser there is WebKit — Chrome on an iPad is a
  // WKWebView wrapper and does not bring Chrome's networking rules with it — and WebKit does
  // not appear to implement the loopback exception that lets an https page open a plain ws://
  // to 127.0.0.1. Desktop Chrome does, which is exactly why this works on the desktop and
  // fails on the iPad with no visible difference in what you typed. Without this line, a
  // blocked connection is indistinguishable from a typo in the address, and you would go
  // looking for the typo.
  _failureHint() {
    var https = window.location && window.location.protocol === 'https:';
    if (!https) return '. Check Nomad is running with Link enabled.';

    var nav = window.navigator || {};
    var ua = nav.userAgent || '';
    // Modern iPadOS reports itself as a Mac; the touch points are what give it away.
    var ios = /iP(hone|ad|od)/.test(ua) || (nav.platform === 'MacIntel' && nav.maxTouchPoints > 1);
    if (ios) {
      return '. iOS browsers block ws:// from an https page. Run Nomad on another device, '
        + 'or open SculptXR over http.';
    }
    return '. Check Nomad is running with Link enabled, and allow the local network prompt.';
  }

  connect(host, port) {
    this.disconnect();
    this._host = (host || '').trim();
    this._port = port || DEFAULT_PORT;
    if (!this._host) {
      this._setStatus('error', 'Enter the IP address shown in Nomad\'s Link menu');
      return false;
    }

    // Always ws:// — Nomad does not serve TLS. Allowed from an https page to a
    // private address, behind the browser's local-network permission prompt.
    var url = 'ws://' + this._host + ':' + this._port;
    this._setStatus('connecting', 'Connecting to ' + this._host + '...');

    var socket;
    try {
      socket = new WebSocket(url);
    } catch (e) {
      // A synchronous throw here is the unambiguous version of the same problem: some
      // browsers refuse a mixed-content WebSocket at construction rather than failing the
      // connection later, and then we can name the cause instead of listing candidates.
      var blocked = e && (e.name === 'SecurityError' || /insecure|security/i.test(e.message || ''));
      this._setStatus('error', 'Could not open ' + url + ': ' + e.message
        + (blocked ? '. The browser blocked ws:// from an https page.' : this._failureHint()));
      return false;
    }
    socket.binaryType = 'arraybuffer';
    this._socket = socket;

    socket.onopen = () => {
      this._send({
        type: 'hello',
        protocol: PROTOCOL,
        pair_token: this._loadTokens()[this._host] || '',
        bridge_version: BRIDGE_VERSION,
        client_name: CLIENT_NAME,
        capabilities: CAPABILITIES
      });
      this._quietSince = Date.now();
      var lastPing = 0;
      this._pingTimer = window.setInterval(() => {
        if (!this.isConnected()) return;
        var now = Date.now();
        if (now - lastPing >= PING_INTERVAL) {
          lastPing = now;
          this._send({ type: 'ping' });
        }
        this._flushDeferred();
      }, TICK);
    };

    socket.onmessage = (event) => this._receive(event.data);

    socket.onerror = () => {
      // The browser deliberately withholds the reason — a blocked connection and a wrong
      // address look identical here — so say what the likely causes are instead of
      // pretending to know which one it was.
      this._setStatus('error', 'Could not reach Nomad at ' + this._host + ':' + this._port
        + this._failureHint());
    };

    socket.onclose = () => {
      this._stopPing();
      if (this._status !== 'error') this._setStatus('disconnected', 'Disconnected');
    };

    return true;
  }

  disconnect() {
    this._stopPing();
    var socket = this._socket;
    this._socket = null;
    this._buffer = new Uint8Array(0);
    this._peerCapabilities = [];
    this._deferred = [];
    this._pendingInstances = [];
    this._haveMesh = {};
    this._haveGeometry = {};
    if (socket) {
      socket.onopen = socket.onmessage = socket.onerror = socket.onclose = null;
      try { socket.close(); } catch (e) { /* already gone */ }
    }
    if (this._status !== 'disconnected') this._setStatus('disconnected', 'Disconnected');
  }

  _stopPing() {
    if (this._pingTimer) {
      window.clearInterval(this._pingTimer);
      this._pingTimer = 0;
    }
  }

  // --------------------------------------------------------------- requests

  requestScene() { return this._request('request_scene'); }
  requestSelection() { return this._request('request_selection'); }

  /**
   * Send a mesh to Nomad. `mesh` is a SculptXR mesh; ids from a mesh that came
   * from Nomad make this replace that object rather than add another.
   *
   * Explicit sends carry live_sync false, which §6 says the receiver always
   * applies — so this works whichever side currently holds the live-edit baton.
   */
  sendMesh(mesh, opts) {
    if (!this.isConnected()) return false;
    opts = opts || {};
    var requestId = 'sxr' + Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
    var packet = NomadCodec.encodeMesh(mesh, {
      meshId: opts.meshId || mesh._nomadMeshId || newId(),
      geometryId: opts.geometryId || mesh._nomadGeometryId || newId(),
      name: opts.name || 'SculptXR',
      worldMatrix: opts.worldMatrix || mesh._nomadWorldMatrix,
      smoothShading: opts.smoothShading !== undefined ? opts.smoothShading : mesh._nomadSmoothShading,
      faceGroupDefs: mesh._nomadFaceGroupDefs,
      requestId: requestId,
      live: !!opts.live
    });
    this._log('sending "' + packet.header.name + '" (' + packet.header.vertex_count +
      ' verts, ' + packet.header.face_count + ' faces)');
    // The request id comes back on the ack, which is how the caller learns the id
    // Nomad filed the mesh under.
    return this._send(packet.header, packet.binary) ? requestId : false;
  }

  /**
   * Tell Nomad an object is gone.
   *
   * Unlike a mesh transfer there is no "explicit" form of this: Nomad (like the
   * Blender bridge) only acts on a delete carrying live_sync true, and live
   * messages only count from whoever holds the edit baton — hence the claim.
   */
  sendDelete(nomadMeshId) {
    if (!this.isConnected() || !nomadMeshId) return false;
    this.claimSync();
    return this._send({ type: 'object_delete', link_id: nomadMeshId, live_sync: true });
  }

  /**
   * Ask to become the side sending live edits. In `auto` mode Nomad hands the
   * baton over after local activity, and takes it back when the user touches
   * Nomad — which is the "one app at a time" model the link is built around.
   */
  claimSync() {
    if (!this.isConnected()) return false;
    var config = this._sessionConfig;
    if (config && config.sync_mode === 'nomad') return false; // Nomad is pinned as editor
    if (this._activeSource === 'client' || this._claimPending) return false;
    this._claimPending = true;
    return this._send({ type: 'claim_sync', source: 'client' });
  }

  /**
   * Send the vertices one stroke moved. Cheap where a full mesh is not: a few
   * hundred vertices instead of megabytes.
   *
   * Sent with live_sync false so Nomad applies it whichever side holds the
   * live-edit baton — §6 says explicit transfers are always applied.
   */
  sendDelta(mesh, indices, opts) {
    if (!this.isConnected() || !indices || !indices.length) return false;
    opts = opts || {};
    var packet = NomadCodec.encodeDelta(mesh, indices, {
      meshId: opts.meshId || mesh._nomadMeshId,
      requestId: 'sxr' + Date.now().toString(36),
      live: !!opts.live
    });
    if (!packet.header.mesh_id) return false;
    this._log('sent ' + packet.header.count + ' moved vertices');
    return this._send(packet.header, packet.binary);
  }

  /**
   * Ask for one mesh in full — the recovery path when a delta or an instance
   * cannot be applied.
   *
   * DEFERRED UNTIL THE TRANSFER IS QUIET, and it must stay that way. Asking for
   * anything mid-transfer makes Nomad RESTART the scene from the beginning, so an
   * eager recovery request loops forever: the restart re-sends the packet we could
   * not apply, we ask again, it restarts again. That is what dropouts, hangs and
   * never-arriving instances looked like. Same mechanism as the Houdini and Maya
   * bridges (client.defer / _flush_deferred).
   */
  requestMesh(nomadMeshId, geometryId) {
    if (!nomadMeshId) return false;
    for (var i = 0; i < this._deferred.length; ++i) {
      if (this._deferred[i].linkId === nomadMeshId) return false; // already queued
    }
    this._deferred.push({ linkId: nomadMeshId, geometryId: geometryId || '' });
    return true;
  }

  /** Build one instance, surviving a failure in the consumer. */
  _tryInstance(header) {
    if (!this.onInstance) return false;
    try {
      if (!this.onInstance(header)) return false;
    } catch (e) {
      // Never let a build failure swallow the recovery path with it.
      this._log('could not place instance "' + (header.name || '?') + '": ' + e.message);
      return false;
    }
    this._haveMesh[header.mesh_id] = true;
    return true;
  }

  /** Place any instances whose geometry has since arrived. */
  _retryInstances() {
    if (!this._pendingInstances.length) return;
    var still = [];
    for (var i = 0; i < this._pendingInstances.length; ++i) {
      var header = this._pendingInstances[i];
      if (!this._haveGeometry[header.geometry_id] || !this._tryInstance(header)) {
        still.push(header);
      }
    }
    this._pendingInstances = still;
  }

  /** A deferred request the transfer has already satisfied is just noise. */
  _stillNeeded(entry) {
    if (this._haveMesh[entry.linkId]) return false;
    // The geometry it shares may have arrived later in the same transfer, under
    // another id — which is exactly what resolves an instance.
    return !(entry.geometryId && this._haveGeometry[entry.geometryId]);
  }

  /** Send at most one deferred request, once the stream has gone quiet. */
  _flushDeferred() {
    if (!this._deferred.length || !this.isConnected()) return;
    if (Date.now() - this._quietSince < DEFER_QUIET) return;

    while (this._deferred.length) {
      var entry = this._deferred.shift();
      if (this._stillNeeded(entry)) {
        this._request('request_mesh', entry.linkId);
        this._quietSince = Date.now(); // one per window, so the reply lands first
        return;
      }
    }
  }

  _request(kind, linkId) {
    if (!this.isConnected()) return false;
    var header = { type: kind, request_id: 'sxr' + Date.now().toString(36) };
    if (linkId) header.link_id = linkId;
    return this._send(header);
  }

  // ---------------------------------------------------------------- framing

  _send(header, binary) {
    var socket = this._socket;
    if (!socket || socket.readyState !== WebSocket.OPEN) return false;

    var json = new TextEncoder().encode(JSON.stringify(header));
    var blob = binary ? new Uint8Array(binary) : null;
    var blobLength = blob ? blob.length : 0;
    var packet = new Uint8Array(8 + json.length + blobLength);
    var view = new DataView(packet.buffer);
    view.setUint32(0, json.length);       // big-endian, as the protocol specifies
    view.setUint32(4, blobLength);
    packet.set(json, 8);
    if (blob) packet.set(blob, 8 + json.length);

    socket.send(packet);
    return true;
  }

  _receive(data) {
    var chunk = new Uint8Array(data);
    if (this._buffer.length === 0) {
      this._buffer = chunk;
    } else {
      var merged = new Uint8Array(this._buffer.length + chunk.length);
      merged.set(this._buffer, 0);
      merged.set(chunk, this._buffer.length);
      this._buffer = merged;
    }

    for (;;) {
      var buffer = this._buffer;
      if (buffer.length < 8) return;
      var view = new DataView(buffer.buffer, buffer.byteOffset);
      var jsonSize = view.getUint32(0);
      var binarySize = view.getUint32(4);
      var total = 8 + jsonSize + binarySize;
      if (buffer.length < total) return; // wait for the rest

      var header;
      try {
        header = JSON.parse(new TextDecoder().decode(buffer.subarray(8, 8 + jsonSize)));
      } catch (e) {
        this._setStatus('error', 'Malformed packet from Nomad');
        this.disconnect();
        return;
      }
      var binary = buffer.subarray(8 + jsonSize, total);
      this._buffer = buffer.subarray(total);
      // A transfer in progress keeps recovery waiting — but view sync does NOT
      // count. Nomad streams `camera` continuously (tens per second), so counting
      // it means the stream is never quiet and deferred requests never go out at
      // all, which is why the mirrored eye never arrived.
      if (!QUIET_EXEMPT[header.type]) this._quietSince = Date.now();
      this._handle(header, binary);
    }
  }

  _handle(header, binary) {
    switch (header.type) {

    case 'hello':
      this._peerCapabilities = header.capabilities || [];
      if (header.pair_token) this._saveToken(this._host, header.pair_token);
      this._setStatus('connected', 'Connected to ' + (header.app_name || 'Nomad'));
      break;

    case 'pairing_pending':
      this._setStatus('pairing', 'Accept the pairing request in Nomad');
      break;

    case 'error':
      this._setStatus('error', 'Nomad: ' + (header.message || 'error'));
      break;

    case 'mesh_full':
      this._haveMesh[header.mesh_id] = true;
      if (header.geometry_id) this._haveGeometry[header.geometry_id] = true;
      try {
        var mesh = NomadCodec.decodeMesh(header, binary);
        this._log('received "' + mesh.name + '" (' + mesh.nbVertices + ' verts, ' + mesh.nbFaces + ' faces)');
        if (this.onMesh) this.onMesh(mesh, header);
      } catch (e) {
        this._log('could not decode "' + (header.name || '?') + '": ' + e.message);
      }
      // Fresh geometry may be what an earlier instance was waiting for.
      this._retryInstances();
      break;

    case 'mesh_instance':
      // Another placement of geometry we should already have.
      if (this._tryInstance(header)) break;
      // Not yet: remember it and ask for the geometry. Nomad does NOT re-send the
      // instance once the mesh arrives, so holding the header is what lets the
      // second, third … placement appear at all.
      if (!this._pendingInstances.some((p) => p.mesh_id === header.mesh_id))
        this._pendingInstances.push(header);
      this.requestMesh(header.mesh_id, header.geometry_id);
      break;

    case 'mesh_delta':
      // One completed stroke in Nomad. onDelta returns false when it cannot be
      // applied — unknown mesh, or topology that has since diverged — and the
      // only recovery is to ask for the whole mesh again.
      try {
        var delta = NomadCodec.decodeDelta(header, binary);
        var applied = this.onDelta ? this.onDelta(delta) : false;
        if (!applied) this.requestMesh(delta.meshId);
      } catch (e) {
        this._log('could not apply a delta: ' + e.message);
        this.requestMesh(header.mesh_id);
      }
      break;

    case 'mesh_ack':
      // Nomad accepted a mesh we sent and tells us the id it filed it under —
      // which is the id to reuse next time so we keep replacing the same object.
      if (this.onAck) this.onAck(header);
      this._setStatus('connected', 'Nomad accepted the mesh');
      break;

    case 'object_delete':
      // Nomad removed an object; drop our copy so the scenes stay in step.
      if (this.onObjectDelete) this.onObjectDelete(header.link_id);
      delete this._haveMesh[header.link_id];
      break;

    case 'session_config':
      this._sessionConfig = header;
      this._activeSource = header.active_source;
      // The claim either landed or was refused; either way it is settled.
      this._claimPending = false;
      break;

    default:
      // mesh_delta, mesh_instance, material, light, camera and friends: Nomad
      // sends what it likes regardless of what we advertised. Ignored for now.
      break;
    }
  }
}

NomadLink.DEFAULT_PORT = DEFAULT_PORT;

export default NomadLink;
