export default class GuiTimeline {
  constructor(main) {
    this._main = main;
    this._container = null;
    this._canvas = null;
    this._ctx = null;
    this._visible = false;
    this._isDragging = false;

    this.initDOM();
    this.startLoop();
  }

  initDOM() {
    this._container = document.createElement('div');
    this._container.style.position = 'fixed';
    this._container.style.bottom = '0';
    this._container.style.left = '0';
    this._container.style.height = '150px'; // Slightly shorter for desktop
    this._container.style.backgroundColor = '#181818';
    this._container.style.zIndex = '2000'; // High z-index to be on top
    this._container.style.display = 'none'; // Hidden by default
    this._container.style.borderTop = '2px solid #444';

    this._canvas = document.createElement('canvas');
    this._canvas.style.width = '100%';
    this._canvas.style.height = '100%';
    this._container.appendChild(this._canvas);
    document.body.appendChild(this._container);

    this._ctx = this._canvas.getContext('2d');

    window.addEventListener('resize', this.onResize.bind(this));
    
    // Mouse interactions
    this._canvas.addEventListener('mousedown', this.onMouseDown.bind(this));
    window.addEventListener('mousemove', this.onMouseMove.bind(this));
    window.addEventListener('mouseup', this.onMouseUp.bind(this));

    this.onResize();
  }

  onResize() {
    const sidebar = document.querySelector('.gui-sidebar');
    if (sidebar) {
      this._container.style.right = sidebar.offsetWidth + 'px';
      this._container.style.width = 'auto';
      
      if (!this._sidebarObserver) {
        this._sidebarObserver = new ResizeObserver(entries => {
          for (let entry of entries) {
            this._container.style.right = entry.contentRect.width + 'px';
            this.onResize();
          }
        });
        this._sidebarObserver.observe(sidebar);
      }
    } else {
      this._container.style.width = '100%';
    }

    const rect = this._container.getBoundingClientRect();
    const dpr = window.devicePixelRatio || 1;
    this._canvas.width = rect.width * dpr;
    this._canvas.height = rect.height * dpr;
    
    this._cssWidth = rect.width;
    this._cssHeight = rect.height;
    
    this._ctx.scale(dpr, dpr);
    this.draw();
  }

  setVisibility(visible) {
    this._visible = visible;
    this._container.style.display = visible ? 'block' : 'none';
    if (visible) {
      this.onResize(); // Ensure size is correct
      this.draw();
    }
  }

  startLoop() {
    const loop = () => {
      if (this._visible) {
        this.draw();
      }
      requestAnimationFrame(loop);
    };
    loop();
  }

  onMouseDown(e) {
    this._isDragging = true;
    this.handleInteraction(e);
  }

  onMouseMove(e) {
    if (this._isDragging) {
      this.handleInteraction(e);
    }
  }

  onMouseUp() {
    this._isDragging = false;
  }

  handleInteraction(e) {
    const rect = this._canvas.getBoundingClientRect();
    const rx = e.clientX - rect.left;
    const ry = e.clientY - rect.top;

    const tlX = 200; // Matching the VR layout for now
    const tlW = this._cssWidth - 220;

    if (rx >= tlX && rx <= tlX + tlW) {
      let t = (rx - tlX) / tlW;
      t = Math.max(0, Math.min(1, t));



      const mDurVal = (window._animMasterDuration !== undefined && window._animMasterDuration > 0) ? window._animMasterDuration : 2.0;
      const loopStart = window._animLoopStart !== undefined ? window._animLoopStart : 0.0;
      const loopEnd = window._animLoopEnd !== undefined ? window._animLoopEnd : mDurVal;
      const visibleDuration = Math.max(0.1, loopEnd - loopStart);

      const targetTime = loopStart + t * visibleDuration;

      window._animPlaying = false;
      window._animCurrentTime = targetTime;

      if (window._animationRegistry) {
        window._animationRegistry.globalPlaybackTime = targetTime;
        if (this._main && this._main._meshes) {
          this._main._meshes.forEach(m => window._animationRegistry.update(m, true));
        }
        if (this._main.render) this._main.render();
      }
    }
  }

  draw() {
    const ctx = this._ctx;
    const w = {
      x: 0,
      y: 0,
      w: this._cssWidth,
      h: this._cssHeight
    };

    // 1. Dark Graph Container
    ctx.fillStyle = '#181818';
    ctx.fillRect(w.x, w.y, w.w, w.h);
    
    if (!window._animationRegistry) {
      ctx.fillStyle = '#aaa';
      ctx.font = '24px sans-serif';
      ctx.textAlign = 'center';
      ctx.fillText('No Animation Registry found.', w.w / 2, w.h / 2);
      return;
    }

    const reg = window._animationRegistry;
    const tracks = Array.from(reg.tracks.entries());
    
    const mDurVal = (window._animMasterDuration !== undefined && window._animMasterDuration > 0) ? window._animMasterDuration : 2.0;
    const loopStart = window._animLoopStart !== undefined ? window._animLoopStart : 0.0;
    const loopEnd = window._animLoopEnd !== undefined ? window._animLoopEnd : mDurVal;
    const visibleDuration = Math.max(0.1, loopEnd - loopStart);

    const tlX = 200; // Width allocated for track names
    const tlW = w.w - 220;

    // --- 1. Draw Top Transport Header Strip (30px tall) ---
    const headerH = 30;
    ctx.fillStyle = '#222';
    ctx.fillRect(w.x, w.y, w.w, headerH);

    const fps = window._animFPS || 24;
    const curT = window._animCurrentTime ? Math.round(window._animCurrentTime * fps) : 0;
    const loopStartF = Math.round(loopStart * fps);
    const loopEndF = Math.round(loopEnd * fps);

    ctx.fillStyle = '#888';
    ctx.font = '12px sans-serif';
    ctx.textAlign = 'left';
    ctx.textBaseline = 'middle';
    ctx.fillText(`${loopStartF}f`, tlX + 5, w.y + headerH / 2);
    ctx.textAlign = 'right';
    ctx.fillText(`${loopEndF}f`, tlX + tlW - 5, w.y + headerH / 2);

    // Show status or value of closest key to playhead
    if (reg.isCountingIn || reg.isRecording) {
      ctx.fillStyle = '#ff4444';
      ctx.font = 'bold 14px sans-serif';
      ctx.textAlign = 'center';
      ctx.fillText(window._animStatusText || '', w.w / 2, w.y + headerH / 2);
    } else {
      const activeMesh = this._main.getMesh();
      if (activeMesh) {
        const id = activeMesh.getID();
        const track = reg.tracks.get(id);
        if (track && track.times) {
          const curTime = window._animCurrentTime || 0;
          let closestIdx = -1;
          let minDist = 0.1; // 100ms tolerance
          for (let i = 0; i < track.times.length; i++) {
            const dist = Math.abs(track.times[i] - curTime);
            if (dist < minDist) {
              minDist = dist;
              closestIdx = i;
            }
          }
          if (closestIdx >= 0) {
            const px = track.positions[closestIdx * 3];
            const py = track.positions[closestIdx * 3 + 1];
            const pz = track.positions[closestIdx * 3 + 2];
            
            ctx.fillStyle = '#ffcc00';
            ctx.font = '12px sans-serif';
            ctx.textAlign = 'center';
            ctx.fillText(`Key at ${track.times[closestIdx].toFixed(2)}s: Pos(${px.toFixed(2)}, ${py.toFixed(2)}, ${pz.toFixed(2)})`, w.w / 2, w.y + headerH / 2);
          }
        }
      }
    }

    // 2. Draw Vertical Grid Lines
    ctx.strokeStyle = '#333';
    ctx.lineWidth = 1;
    const totalSeconds = Math.ceil(mDurVal);
    for (let s = 0; s <= totalSeconds; s++) {
      if (s >= loopStart && s <= loopEnd) {
        const gridX = tlX + ((s - loopStart) / visibleDuration) * tlW;
        ctx.beginPath();
        ctx.moveTo(gridX, w.y + headerH);
        ctx.lineTo(gridX, w.y + w.h);
        ctx.stroke();
      }
    }

    // Track Column Border
    ctx.strokeStyle = '#666';
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(tlX, w.y + headerH);
    ctx.lineTo(tlX, w.y + w.h);
    ctx.stroke();

    // 3. Render Track Lanes
    const laneAreaH = w.h - headerH;
    
    if (tracks.length === 0) {
      ctx.fillStyle = '#666';
      ctx.font = '18px sans-serif';
      ctx.textAlign = 'center';
      ctx.fillText('No recorded tracks in memory.', w.w / 2, w.y + headerH + laneAreaH / 2);
    } else {
      const totalAvailableSlots = Math.max(4, tracks.length); 
      const trackH = laneAreaH / totalAvailableSlots;

      tracks.forEach(([id, track], idx) => {
        const ty = w.y + headerH + (idx * trackH);
        
        // Alternate lane background
        if (idx % 2 === 1) {
          ctx.fillStyle = 'rgba(255,255,255,0.03)';
          ctx.fillRect(w.x, ty, w.w, trackH);
        }

        // Lane Label
        ctx.fillStyle = '#aaa';
        ctx.font = '12px sans-serif';
        ctx.textAlign = 'left';
        ctx.textBaseline = 'middle';
        let laneName = `Track ${id}`;
        if (this._main && this._main._meshes) {
          const found = this._main._meshes.find(m => m.getID() === id);
          if (found) {
            laneName = found._permanentStaticLabel || `Object ${id}`;
          }
        }
        ctx.fillText(laneName, w.x + 10, ty + trackH / 2);

        // Transform Data Visualization
        if (track && track.times && track.times.length > 0) {
          ctx.fillStyle = track.muted ? '#888888' : '#00ffff';
          ctx.strokeStyle = track.muted ? '#555555' : '#ffffff';
          ctx.lineWidth = 1;

          for (let i = 0; i < track.times.length; i++) {
            const t = track.times[i];
            if (t >= loopStart && t <= loopEnd) {
              const kx = tlX + ((t - loopStart) / visibleDuration) * tlW;
              const ky = ty + trackH / 2;
              
              ctx.beginPath();
              ctx.arc(kx, ky, 3, 0, Math.PI * 2);
              ctx.fill();
              ctx.stroke();
            }
          }
        }

        // Shape Data Visualization
        if (track && track.shapeTimes) {
          for (let i = 0; i < track.shapeTimes.length; i++) {
            const st = track.shapeTimes[i];
            if (st >= loopStart && st <= loopEnd) {
              const kx = tlX + ((st - loopStart) / visibleDuration) * tlW;
              const ky = ty + trackH / 2;
              
              ctx.fillStyle = '#ffcc00';
              ctx.strokeStyle = '#ffffff';
              ctx.beginPath();
              ctx.moveTo(kx, ky - 5);
              ctx.lineTo(kx + 5, ky);
              ctx.lineTo(kx, ky + 5);
              ctx.lineTo(kx - 5, ky);
              ctx.closePath();
              ctx.fill();
              ctx.stroke();
            }
          }
        }
      });
    }

    // 4. Render Playhead
    const currentTimeVal = window._animCurrentTime !== undefined ? window._animCurrentTime : 0;
    const playheadAlpha = (currentTimeVal - loopStart) / visibleDuration;
    const playheadX = tlX + playheadAlpha * tlW;

    if (playheadX >= tlX && playheadX <= tlX + tlW) {
      // Playhead full vertical line
      ctx.strokeStyle = '#4488ff';
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.moveTo(playheadX, w.y + headerH);
      ctx.lineTo(playheadX, w.y + w.h);
      ctx.stroke();

      // Playhead Cap
      ctx.fillStyle = '#4488ff';
      ctx.beginPath();
      ctx.moveTo(playheadX - 8, w.y);
      ctx.lineTo(playheadX + 8, w.y);
      ctx.lineTo(playheadX + 8, w.y + headerH - 5);
      ctx.lineTo(playheadX, w.y + headerH);
      ctx.lineTo(playheadX - 8, w.y + headerH - 5);
      ctx.closePath();
      ctx.fill();

      // Current Frame text
      ctx.fillStyle = '#ffffff';
      ctx.font = 'bold 10px sans-serif';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText(curT, playheadX, w.y + headerH / 2);
    }
  }
}
