
import { Util } from '@antv/g6';
import _ from 'lodash';
const abs = Math.abs;
const DRAG_OFFSET = 10;
const body = document.body;
export default {
  getDefaultCfg() {
    return {
      direction: 'both'
    };
  },

  getEvents() {
    return {
      'canvas:mousedown': 'onMouseDown',
      'canvas:mousemove': 'onMouseMove',
      'canvas:mouseup': 'onMouseUp',
      'canvas:click': 'onMouseUp',
      'canvas:mouseleave': 'onOutOfRange'
    };
  },

  updateViewport(e) {
    const origin = this.origin;
    const clientX = +e.clientX;
    const clientY = +e.clientY;

    if (isNaN(clientX) || isNaN(clientY)) {
      return;
    }

    let dx = clientX - origin.x;
    let dy = clientY - origin.y;

    if (this.get('direction') === 'x') {
      dy = 0;
    } else if (this.get('direction') === 'y') {
      dx = 0;
    }

    this.origin = {
      x: clientX,
      y: clientY
    };
    this.graph.translate(dx, dy);
    this.graph.paint();
  },

  onMouseDown(e) {
    this.origin = {
      x: e.clientX,
      y: e.clientY
    };
    this.dragging = false;
  },

  onMouseMove(e) {
    e = Util.cloneEvent(e);
    const graph = this.graph;

    if (!this.origin) {
      return;
    }

    if (this.origin && !this.dragging) {
      if (abs(this.origin.x - e.clientX) + abs(this.origin.y - e.clientY) < DRAG_OFFSET) {
        return;
      }

      if (this.shouldBegin.call(this, e)) {
        e.type = 'dragstart';
        graph.emit('canvas:dragstart', e);
        this.dragging = true;
      }
    }

    if (this.dragging) {
      e.type = 'drag';
      const self = this;
      const canvasElement = self.graph.get('canvas').get('el');
      canvasElement.style.cursor = 'grabbing';
      graph.emit('canvas:drag', e);
    }

    if (this.shouldUpdate.call(this, e)) {
      this.updateViewport(e); // console.log(e)
      // _.throttle(() => {
      //   this.updateViewport(e)
      // }, 0)
    }
  },

  onMouseUp(e) {
    if (!this.dragging) {
      this.origin = null;
      return;
    }

    e = Util.cloneEvent(e);
    const graph = this.graph;

    if (this.shouldEnd.call(this, e)) {
      this.updateViewport(e);
    }

    e.type = 'dragend';
    graph.emit('canvas:dragend', e);
    this.endDrag();
  },

  endDrag() {
    if (this.dragging) {
      const self = this;
      const canvasElement = self.graph.get('canvas').get('el');
      canvasElement.style.cursor = 'grab';
      this.origin = null;
      this.dragging = false; // ?????????????????????????????????????????????????????? mouseup ????????????????????????

      const fn = this.fn;

      if (fn) {
        body.removeEventListener('mouseup', fn, false);
        this.fn = null;
      }
    }
  },

  // ??????????????????????????????????????????????????????????????????????????? drag ??????????????????????????? mouseup ????????????????????????
  onOutOfRange(e) {
    if (this.dragging) {
      const self = this;
      const canvasElement = self.graph.get('canvas').get('el');

      const fn = ev => {
        if (ev.target !== canvasElement) {
          self.onMouseUp(e);
        }
      };

      this.fn = fn;
      body.addEventListener('mouseup', fn, false);
    }
  }

};