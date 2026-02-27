// sprites.js — SNAP capture + DISPLAY blit storage
// Sprites are named captured regions from the framebuffer.

export class SpriteStore {
  constructor() {
    this.sprites = new Map();
  }

  // Store a sprite captured via framebuffer.snap()
  store(name, spriteData) {
    this.sprites.set(name.toUpperCase(), spriteData);
  }

  // Retrieve a named sprite
  get(name) {
    return this.sprites.get(name.toUpperCase()) || null;
  }

  // Delete a named sprite
  delete(name) {
    this.sprites.delete(name.toUpperCase());
  }

  // List all sprite names
  list() {
    return Array.from(this.sprites.keys());
  }
}
