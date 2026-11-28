// Host interface for the original H3 Toolbox extensions.
// SPDX-License-Identifier: GPL-3.0-only
export const extensions = [];
export const app = {
  registerExtension(extension) { extensions.push(extension); },
  graph: {
    _nodes: [], links: new Map(),
    getNodeById(id) { return this._nodes.find(node => node.id === id); },
    getLink(id) { return this.links.get(id); },
    setDirtyCanvas() {},
  },
};
