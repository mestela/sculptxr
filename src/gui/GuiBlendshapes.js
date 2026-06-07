import '@awesome.me/webawesome/dist/styles/webawesome.css';
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
    const sidebarDom = guiParent.domSidebar || guiParent.domContainer || guiParent.domMain || guiParent;
    if (!sidebarDom || !sidebarDom.appendChild) {
      console.error("Cannot find a valid DOM element to attach Blendshapes UI!");
      return;
    }

    const content = document.createElement('div');
    content.className = 'wa-stack';
    content.style.gap = '10px';

    // Stop keyboard events from bubbling up to the main app
    content.addEventListener('keydown', (e) => e.stopPropagation());
    content.addEventListener('keyup', (e) => e.stopPropagation());

    // Create New Blendshape
    // The input is hidden by default so the always-visible text field doesn't
    // attract iPadOS Scribble when the pencil passes near the sliders below.
    // Tapping "+" reveals it; Enter/blur hides it again.
    const createGroup = document.createElement('div');
    createGroup.style.display = 'flex';
    createGroup.style.gap = '5px';

    const input = document.createElement('wa-input');
    input.setAttribute('placeholder', 'New shape name...');
    input.setAttribute('autocomplete', 'off');
    input.setAttribute('autocorrect', 'off');
    input.setAttribute('autocapitalize', 'off');
    input.setAttribute('spellcheck', 'false');
    input.setAttribute('writingsuggestions', 'false');
    input.className = 'compact-input';
    input.style.flex = '1';
    input.style.display = 'none'; // hidden until "+" is tapped

    const commitShape = () => {
      const name = input.value?.trim();
      const mesh = this._main.getMesh();
      if (name && mesh) {
        window._animationRegistry.createBlendshape(mesh, name);
        this.refreshList(mesh);
      }
      input.value = '';
      input.style.display = 'none';
      btnCreate.innerText = '+';
    };

    input.addEventListener('keydown', (e) => {
      if (e.key === 'Enter')  { commitShape(); }
      else if (e.key === 'Escape') { input.value = ''; input.style.display = 'none'; btnCreate.innerText = '+'; }
    });
    input.addEventListener('blur', () => {
      // Auto-commit if the user just tapped away
      commitShape();
    });

    createGroup.appendChild(input);

    const btnCreate = document.createElement('wa-button');
    btnCreate.innerText = '+';
    btnCreate.setAttribute('variant', 'primary');
    btnCreate.className = 'compact-btn';

    btnCreate.addEventListener('click', () => {
      if (input.style.display === 'none') {
        // First tap: reveal input and focus it
        input.style.display = '';
        btnCreate.innerText = '✓';
        // Use setTimeout so the element is visible before focus (needed on iOS)
        setTimeout(() => { try { input.focus(); } catch(_) {} }, 50);
      } else {
        commitShape();
      }
    });

    createGroup.appendChild(btnCreate);
    content.appendChild(createGroup);

    // List Container
    this._listContainer = document.createElement('div');
    this._listContainer.className = 'wa-stack';
    this._listContainer.style.gap = '0';
    content.appendChild(this._listContainer);

    sidebarDom.appendChild(content);

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

  updateMesh() {
    const mesh = this._main.getMesh();
    this.refreshList(mesh);
  }
}

export default GuiBlendshapes;
