import '@awesome.me/webawesome/dist/styles/webawesome.css';
import '@awesome.me/webawesome/dist/components/details/details.js';
import '@awesome.me/webawesome/dist/components/button/button.js';
import '@awesome.me/webawesome/dist/components/slider/slider.js';
import '@awesome.me/webawesome/dist/components/input/input.js';
import '@awesome.me/webawesome/dist/components/number-input/number-input.js';

class GuiBlendshapes {
  constructor(guiParent, ctrlGui) {
    this._ctrlGui = ctrlGui;
    this._main = ctrlGui._main;
    this._listContainer = null;
    this.init(guiParent);
  }

  init(guiParent) {
    const sidebarDom = guiParent.domSidebar;
    if (!sidebarDom) return;

    const container = document.createElement('div');
    container.className = 'wa-blendshapes-section wa-dark';
    container.style.padding = '5px';
    container.style.background = '#1e1e1e';
    container.style.color = '#fff';

    // Stop keyboard events from bubbling up to the main app
    container.addEventListener('keydown', (e) => e.stopPropagation());
    container.addEventListener('keyup', (e) => e.stopPropagation());

    const style = document.createElement('style');
    style.innerHTML = `
      .compact-details::part(header) { padding: 4px 8px; }
      .compact-details::part(content) { padding: 8px; }
      .blendshape-row { display: flex; flex-direction: column; gap: 2px; padding: 6px 0; border-bottom: 1px solid #333; }
      .blendshape-header { display: flex; justify-content: space-between; align-items: center; gap: 5px; }
      .blendshape-row wa-slider { width: 100%; --wa-slider-track-height: 4px; --wa-slider-thumb-size: 12px; margin-top: 2px; }
      .blendshape-row wa-button { --wa-button-height: 20px; font-size: 11px; }
      wa-input.compact-input { --wa-input-height: 24px; font-size: 12px; }
      wa-button.compact-btn { --wa-button-height: 24px; font-size: 12px; }
      wa-number-input.compact-number { --wa-input-height: 20px; width: 60px; font-size: 11px; }
    `;
    container.appendChild(style);

    const details = document.createElement('wa-details');
    details.setAttribute('summary', 'Blendshapes');
    details.setAttribute('open', '');
    details.className = 'compact-details';

    const content = document.createElement('div');
    content.className = 'wa-stack';
    content.style.gap = '10px';

    // Create New Blendshape
    const createGroup = document.createElement('div');
    createGroup.style.display = 'flex';
    createGroup.style.gap = '5px';

    const input = document.createElement('wa-input');
    input.setAttribute('placeholder', 'New shape name...');
    input.className = 'compact-input';
    input.style.flex = '1';
    createGroup.appendChild(input);

    input.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') {
        const name = input.value;
        const mesh = this._main.getMesh();
        if (name && mesh) {
          window._animationRegistry.createBlendshape(mesh, name);
          input.value = ''; // Clear input
          this.refreshList(mesh);
        }
      }
    });

    const btnCreate = document.createElement('wa-button');
    btnCreate.innerText = '+';
    btnCreate.setAttribute('variant', 'primary');
    btnCreate.className = 'compact-btn';
    
    btnCreate.addEventListener('click', () => {
      const name = input.value;
      const mesh = this._main.getMesh();
      if (name && mesh) {
        window._animationRegistry.createBlendshape(mesh, name);
        input.value = ''; // Clear input
        this.refreshList(mesh);
      }
    });
    
    createGroup.appendChild(btnCreate);
    content.appendChild(createGroup);

    // List Container
    this._listContainer = document.createElement('div');
    this._listContainer.className = 'wa-stack';
    this._listContainer.style.gap = '0';
    content.appendChild(this._listContainer);

    details.appendChild(content);
    container.appendChild(details);
    sidebarDom.appendChild(container);

    // Initial refresh
    const mesh = this._main.getMesh();
    if (mesh) this.refreshList(mesh);
  }

  refreshList(mesh) {
    if (!this._listContainer || !mesh) return;
    this._listContainer.innerHTML = ''; // Clear

    const track = window._animationRegistry ? window._animationRegistry.tracks.get(mesh.getID()) : null;
    
    // Basis is implicit, no need to show it in the UI

    if (track && track.blendshapes) {
      track.blendshapes.forEach((delta, name) => {
        const bTrack = track.blendshapeTracks.get(name);
        let weight = 0;
        if (bTrack && bTrack.times.length > 0) {
          weight = window._animationRegistry.evaluateScalarTrack(bTrack, track.playbackTime);
        }
        this.addBlendshapeRow(mesh, name, weight, true);
      });
    }
  }

  addBlendshapeRow(mesh, name, weight, editable) {
    const row = document.createElement('div');
    row.className = 'blendshape-row';

    const header = document.createElement('div');
    header.className = 'blendshape-header';

    const nameSpan = document.createElement('span');
    nameSpan.innerText = name;
    nameSpan.style.fontSize = '12px';
    nameSpan.style.flex = '1';
    nameSpan.style.overflow = 'hidden';
    nameSpan.style.textOverflow = 'ellipsis';
    nameSpan.style.whiteSpace = 'nowrap';
    header.appendChild(nameSpan);

    // Number Input
    const numInput = document.createElement('wa-number-input');
    numInput.className = 'compact-number';
    numInput.setAttribute('value', weight.toFixed(2));
    numInput.setAttribute('step', '0.01');
    numInput.setAttribute('without-steppers', '');
    numInput.setAttribute('size', 'small');
    header.appendChild(numInput);

    const btnGroup = document.createElement('div');
    btnGroup.style.display = 'flex';
    btnGroup.style.gap = '2px';

    if (editable) {
      const btnEdit = document.createElement('wa-button');
      const track = window._animationRegistry ? window._animationRegistry.tracks.get(mesh.getID()) : null;
      const isEditing = track && track.editingBlendshape === name;
      
      btnEdit.innerText = isEditing ? 'Done' : 'Edit';
      btnEdit.setAttribute('variant', isEditing ? 'success' : 'primary');
      
      btnEdit.addEventListener('click', () => {
        const tr = window._animationRegistry.tracks.get(mesh.getID());
        if (tr && tr.editingBlendshape === name) {
          window._animationRegistry.exitBlendshapeEditMode(mesh);
        } else {
          if (tr && tr.editingBlendshape) {
            window._animationRegistry.exitBlendshapeEditMode(mesh);
          }
          window._animationRegistry.enterBlendshapeEditMode(mesh, name);
        }
        this.refreshList(mesh);
      });
      btnGroup.appendChild(btnEdit);

      const btnDel = document.createElement('wa-button');
      btnDel.innerText = '🗑';
      btnDel.setAttribute('variant', 'primary');
      btnDel.style.color = '#ff4444';
      btnDel.addEventListener('click', () => {
        window._animationRegistry.deleteBlendshape(mesh, name);
        this.refreshList(mesh);
      });
      btnGroup.appendChild(btnDel);
    }
    header.appendChild(btnGroup);
    row.appendChild(header);

    const slider = document.createElement('wa-slider');
    slider.setAttribute('with-tooltip', '');
    slider.setAttribute('step', '0.01');
    slider.setAttribute('min', '0');
    slider.setAttribute('max', '1');
    
    if (name !== 'Basis') {
      slider.setAttribute('value', weight.toString());
      
      // Sync slider and number input
      let startVal = weight;
      
      slider.addEventListener('focus', () => {
        startVal = parseFloat(slider.value);
      });
      
      slider.addEventListener('input', (e) => {
        const val = parseFloat(e.target.value);
        numInput.value = val.toFixed(2);
        window._animationRegistry.setBlendshapeWeight(mesh, name, val);
      });
      
      slider.addEventListener('change', (e) => {
        const newVal = parseFloat(e.target.value);
        const oldVal = startVal;
        
        if (window.app && window.app.getStateManager()) {
          window.app.getStateManager().pushStateCustom(
            () => { // UNDO
              window._animationRegistry.setBlendshapeWeight(mesh, name, oldVal);
              this.refreshList(mesh);
            },
            () => { // REDO
              window._animationRegistry.setBlendshapeWeight(mesh, name, newVal);
              this.refreshList(mesh);
            },
            false,
            "Change Blendshape Weight"
          );
        }
      });
      
      numInput.addEventListener('input', (e) => {
        const val = parseFloat(e.target.value) || 0;
        slider.value = val;
        window._animationRegistry.setBlendshapeWeight(mesh, name, val);
      });

      numInput.addEventListener('change', (e) => {
        const newVal = parseFloat(e.target.value) || 0;
        const oldVal = startVal;
        
        if (window.app && window.app.getStateManager()) {
          window.app.getStateManager().pushStateCustom(
            () => { // UNDO
              window._animationRegistry.setBlendshapeWeight(mesh, name, oldVal);
              this.refreshList(mesh);
            },
            () => { // REDO
              window._animationRegistry.setBlendshapeWeight(mesh, name, newVal);
              this.refreshList(mesh);
            },
            false,
            "Change Blendshape Weight"
          );
        }
        startVal = newVal;
      });
    } else {
      slider.setAttribute('disabled', '');
      slider.setAttribute('value', '1');
      numInput.setAttribute('disabled', '');
    }
    row.appendChild(slider);

    this._listContainer.appendChild(row);
  }
}

export default GuiBlendshapes;
